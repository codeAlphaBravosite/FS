document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const iceServers = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };
    const dataChannelOptions = { ordered: true };
    const CHUNK_SIZE = 64 * 1024; // 64KB
    const MAX_BUFFERED_AMOUNT = CHUNK_SIZE * 16; // Allow slightly more buffer

    // --- State Variables ---
    let peerConnection = null;
    let dataChannel = null;
    // Removed localOffer/Answer/remoteOffer/Answer state - get directly from textareas when needed
    let isHost = false;
    let connectionEstablished = false;
    let fileToSend = null;
    let fileReader = null;
    let currentChunk = 0;
    let receivingFileInfo = null;
    let receivedFileChunks = [];
    let receivedFileSize = 0;

    // --- UI Elements ---
    const screens = {
        initial: document.getElementById('initialScreen'),
        host: document.getElementById('hostScreen'),
        client: document.getElementById('clientScreen'),
        connected: document.getElementById('connectedScreen'),
    };
    const statusElem = document.getElementById('status');
    const hostStatusElem = document.getElementById('hostStatus');
    const clientStatusElem = document.getElementById('clientStatus');
    const connectionStatusElem = document.getElementById('connectionStatus');
    const messagesDiv = document.getElementById('messages');
    const messageInput = document.getElementById('messageInput');
    const fileInput = document.getElementById('fileInput'); // Hidden input
    const selectFileBtn = document.getElementById('selectFileBtn'); // Button to trigger file input
    const selectedFileNameElem = document.getElementById('selectedFileName');
    const fileStatusElem = document.getElementById('fileStatus');
    const offerCodeText = document.getElementById('offerCode');
    const answerInputHostText = document.getElementById('answerInputHost');
    const offerInputClientText = document.getElementById('offerInputClient');
    const answerCodeText = document.getElementById('answerCode');
    const copyOfferBtn = document.getElementById('copyOfferBtn');
    const copyAnswerBtn = document.getElementById('copyAnswerBtn');
    const startSessionBtn = document.getElementById('startSessionBtn');
    const joinSessionBtn = document.getElementById('joinSessionBtn');
    const submitAnswerBtn = document.getElementById('submitAnswerBtn');
    const submitOfferBtn = document.getElementById('submitOfferBtn');
    const cancelHostBtn = document.getElementById('cancelHostBtn');
    const cancelClientBtn = document.getElementById('cancelClientBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const sendMessageBtn = document.getElementById('sendMessageBtn');
    const sendFileBtn = document.getElementById('sendFileBtn'); // Send button
    const clientOfferInputSection = document.getElementById('clientOfferInputSection');
    const clientAnswerDisplaySection = document.getElementById('clientAnswerDisplaySection');

    // --- UI State Management ---
    function showScreen(screenName) {
        Object.values(screens).forEach(screen => screen.classList.remove('active'));
        if (screens[screenName]) screens[screenName].classList.add('active');
        console.log(`Navigated to screen: ${screenName}`);
    }
    function updateStatus(message, element = statusElem) {
        console.log("Status Update:", message);
        if (element) element.textContent = `Status: ${message}`;
    }
    function resetState() {
        console.log("Resetting state...");
        if (peerConnection) { peerConnection.close(); peerConnection = null; }
        dataChannel = null;
        isHost = false;
        connectionEstablished = false;
        if (fileReader) { fileReader.abort(); fileReader = null; }
        resetFileSendState(); // Also clear file sending state
        receivingFileInfo = null;
        receivedFileChunks = [];
        receivedFileSize = 0;

        // Reset UI elements
        offerCodeText.value = '';
        answerInputHostText.value = '';
        offerInputClientText.value = '';
        answerCodeText.value = '';
        messagesDiv.innerHTML = '';
        messageInput.value = '';
        fileInput.value = ''; // Clear hidden input
        selectedFileNameElem.textContent = 'No file selected';
        fileStatusElem.textContent = '';
        sendFileBtn.disabled = true;
        selectFileBtn.disabled = true; // Disabled until connected
        sendMessageBtn.disabled = true; // Disabled until connected
        clientOfferInputSection.style.display = 'block';
        clientAnswerDisplaySection.style.display = 'none';
        updateStatus("Idle");
        updateStatus("Waiting for Answer...", hostStatusElem);
        updateStatus("Waiting for host to connect...", clientStatusElem);
        updateStatus("Connected", connectionStatusElem);
        showScreen('initial');
    }

    // --- WebRTC Core Logic ---
    function createPeerConnection() {
        console.log("Creating PeerConnection with config:", iceServers);
        peerConnection = new RTCPeerConnection(iceServers);

        peerConnection.onicecandidate = (event) => {
            // We are primarily using the SDP generated after setLocalDescription.
            // ICE candidates are exchanged automatically via STUN.
            // This handler is now mainly for debugging.
            if (event.candidate) {
                // console.log("Local ICE candidate found:", event.candidate.candidate.substring(0, 40) + "..."); // Log candidate (optional)
            } else {
                console.log("All local ICE candidates gathered (event.candidate is null).");
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log("ICE Connection State:", peerConnection.iceConnectionState);
            const statusElement = connectionEstablished ? connectionStatusElem : (isHost ? hostStatusElem : clientStatusElem);
            if (statusElement) updateStatus(`ICE State: ${peerConnection.iceConnectionState}`, statusElement);

            switch(peerConnection.iceConnectionState) {
                case 'connected':
                case 'completed':
                    if (!connectionEstablished && dataChannel && dataChannel.readyState === 'open') {
                        handleConnectionEstablished();
                    }
                    break;
                case 'disconnected':
                    if(connectionEstablished) {
                         console.warn("Peer disconnected.");
                         alert("Connection disconnected.");
                         resetState();
                    }
                    break;
                case 'failed':
                    console.error("Connection failed.");
                     if (!connectionEstablished) {
                         alert("Connection failed. Please check network or try again.");
                     }
                     resetState();
                    break;
                case 'closed':
                     console.log("Connection closed.");
                     if(connectionEstablished) { // Only reset if it was connected before
                          resetState();
                     }
                     break;
            }
        };

         peerConnection.ondatachannel = (event) => {
            console.log("Data channel received!");
            dataChannel = event.channel;
            setupDataChannelEvents();
         };
    }

    function setupDataChannelEvents() {
        if (!dataChannel) return;
        console.log("Setting up DataChannel event listeners");
        dataChannel.binaryType = 'arraybuffer';

        dataChannel.onopen = () => {
            console.log("Data Channel is open!");
            handleConnectionEstablished();
        };
        dataChannel.onclose = () => {
            console.log("Data Channel is closed!");
             if (connectionEstablished) {
                // Don't alert here, iceconnectionstatechange 'closed' handles reset
                console.log("DataChannel closed, likely part of disconnect.");
             }
        };
        dataChannel.onerror = (error) => {
            console.error("Data Channel Error:", error);
            alert(`Data channel error: ${error.error ? error.error.message : 'Unknown error'}`);
            // Don't reset here, rely on ICE state changes for major failures
        };
        dataChannel.onmessage = (event) => { handleReceivedData(event.data); };
        dataChannel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2;
        dataChannel.onbufferedamountlow = () => { if (fileToSend && fileReader) sendNextChunk(); };
    }

    function handleConnectionEstablished() {
        if (connectionEstablished) return;
        console.log("Connection established!");
        connectionEstablished = true;
        updateStatus("Connected!", connectionStatusElem);
        showScreen('connected');
        // Enable controls on connected screen
        selectFileBtn.disabled = false;
        sendMessageBtn.disabled = false;
        // Send button enabled when file is selected
    }

    // --- Host Actions ---
    startSessionBtn.onclick = async () => {
        isHost = true;
        resetState(); // Start fresh
        createPeerConnection();
        console.log("Host creating data channel 'p2pChannel'");
        // Use a consistent channel name
        dataChannel = peerConnection.createDataChannel('p2pChannel', dataChannelOptions);
        setupDataChannelEvents();

        try {
            console.log("Host creating offer...");
            updateStatus("Creating Offer...", hostStatusElem);
            const offer = await peerConnection.createOffer();
            console.log("Offer created, setting local description...");
            // IMPORTANT: Set local description FIRST
            await peerConnection.setLocalDescription(offer);
            console.log("Local description set.");

            // **FIX:** Populate the offer code text area *immediately* after setLocalDescription
            if (peerConnection.localDescription) {
                const offerSignal = {
                    type: peerConnection.localDescription.type,
                    sdp: peerConnection.localDescription.sdp,
                };
                offerCodeText.value = JSON.stringify(offerSignal);
                console.log("Offer code generated and displayed.");
                updateStatus("Offer Generated. Copy and send it.", hostStatusElem);
                showScreen('host');
            } else {
                 throw new Error("Local description not available after setLocalDescription.");
            }

        } catch (error) {
            console.error("Error during Offer creation/setting:", error);
            updateStatus(`Error: ${error.message}`, hostStatusElem);
            resetState(); // Reset on error
        }
    };

    submitAnswerBtn.onclick = async () => {
        const answerString = answerInputHostText.value.trim();
        if (!answerString || !peerConnection) return alert("Please paste the Answer Code first.");

        try {
            const remoteAnswer = JSON.parse(answerString);
            if (remoteAnswer.type !== 'answer' || !remoteAnswer.sdp) throw new Error("Invalid Answer format.");

            console.log("Received Answer, setting remote description...");
            updateStatus("Received Answer, connecting...", hostStatusElem);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteAnswer));
            console.log("Remote description (Answer) set successfully.");
            // Connection establishment logic now happens via oniceconnectionstatechange and ondatachannel events

        } catch (error) {
            console.error("Error processing Answer:", error);
            alert(`Error processing Answer: ${error.message}`);
            updateStatus(`Error: ${error.message}`, hostStatusElem);
        }
    };
    cancelHostBtn.onclick = resetState;

    // --- Client Actions ---
    joinSessionBtn.onclick = () => {
        isHost = false;
        resetState();
        showScreen('client');
        updateStatus("Ready to join. Paste Offer Code.", clientStatusElem);
    };

    submitOfferBtn.onclick = async () => {
         const offerString = offerInputClientText.value.trim();
         if (!offerString) return alert("Please paste the Offer Code first.");

         try {
             const remoteOffer = JSON.parse(offerString);
             if (remoteOffer.type !== 'offer' || !remoteOffer.sdp) throw new Error("Invalid Offer format.");

             console.log("Received Offer, processing..."); updateStatus("Processing Offer...", clientStatusElem);
             createPeerConnection(); // Create connection *after* getting offer as client

             console.log("Setting remote description (Offer)...");
             await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteOffer));
             console.log("Remote description (Offer) set.");

             console.log("Client creating answer..."); updateStatus("Creating Answer...", clientStatusElem);
             const answer = await peerConnection.createAnswer();
             console.log("Answer created, setting local description...");
             // IMPORTANT: Set local description FIRST
             await peerConnection.setLocalDescription(answer);
             console.log("Local description (Answer) set.");

             // **FIX:** Populate the answer code text area *immediately* after setLocalDescription
             if (peerConnection.localDescription) {
                const answerSignal = {
                    type: peerConnection.localDescription.type,
                    sdp: peerConnection.localDescription.sdp,
                };
                answerCodeText.value = JSON.stringify(answerSignal);
                console.log("Answer code generated and displayed.");
                clientOfferInputSection.style.display = 'none'; // Hide offer input
                clientAnswerDisplaySection.style.display = 'block'; // Show answer section
                updateStatus("Answer generated. Copy and send it back.", clientStatusElem);
             } else {
                 throw new Error("Local description not available after setLocalDescription (Answer).");
             }

         } catch (error) {
             console.error("Error processing Offer/creating Answer:", error);
             alert(`Error: ${error.message}`);
             updateStatus(`Error: ${error.message}`, clientStatusElem);
             resetState(); // Go back to initial on error
         }
    };
    cancelClientBtn.onclick = resetState;

     // --- Connected Actions (Text Messaging - Same logic as before) ---
    sendMessageBtn.onclick = () => {
        const message = messageInput.value.trim();
        if (message && dataChannel && dataChannel.readyState === 'open') {
            try {
                const dataToSend = JSON.stringify({ type: 'text', payload: message });
                if (dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT) {
                    dataChannel.send(dataToSend);
                    displayMessage(message, 'sent');
                    messageInput.value = '';
                } else {
                    console.warn("Data channel buffer full, delaying message send.");
                    alert("Cannot send message right now, buffer full. Please wait.");
                }
            } catch (error) { console.error("Error sending message:", error); alert("Failed to send message."); }
        }
    };
    messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessageBtn.click(); } });


    // --- Connected Actions (File Transfer - Enhanced Chunking) ---
    selectFileBtn.onclick = () => {
         if (fileToSend) {
            alert("Please wait for the current file transfer to complete or cancel it."); // Add cancel later maybe
            return;
        }
        fileInput.click(); // Trigger hidden file input
    };

    fileInput.onchange = () => {
        const files = fileInput.files;
        if (files.length > 0) {
            fileToSend = files[0];
            selectedFileNameElem.textContent = `${fileToSend.name} (${formatBytes(fileToSend.size)})`;
            sendFileBtn.disabled = false; // Enable send button now
            fileStatusElem.textContent = 'Ready to send.';
        } else {
             // No file selected or selection cancelled
             fileToSend = null;
             selectedFileNameElem.textContent = 'No file selected';
             sendFileBtn.disabled = true;
             fileStatusElem.textContent = '';
        }
         // Clear the input value so the same file can be selected again
         fileInput.value = '';
    };

    sendFileBtn.onclick = () => {
        if (!fileToSend || !dataChannel || dataChannel.readyState !== 'open') {
            alert("No file selected or not connected.");
            return;
        }
        console.log(`Starting send for: ${fileToSend.name} (${fileToSend.size} bytes)`);
        fileStatusElem.textContent = `Starting send: ${fileToSend.name}...`;
        sendFileBtn.disabled = true; // Disable during transfer
        selectFileBtn.disabled = true; // Disable selecting new file during transfer

        // 1. Send file metadata
        const fileInfo = { type: 'file-info', payload: { name: fileToSend.name, size: fileToSend.size, type: fileToSend.type } };
        try {
             if (dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT) {
                dataChannel.send(JSON.stringify(fileInfo));
                console.log("Sent file info:", fileInfo.payload.name);
                currentChunk = 0;
                setTimeout(startSendingChunks, 100); // Slight delay before chunks
             } else {
                 throw new Error("Buffer full before sending file info");
             }
        } catch (error) {
            console.error("Error sending file info:", error);
            fileStatusElem.textContent = `Error starting send: ${error.message}`;
            resetFileSendState(); // Reset buttons etc.
        }
    };

    function startSendingChunks() {
        if (!fileToSend) return;
        fileReader = new FileReader();
        fileReader.onload = (event) => {
            try {
                 if (dataChannel.readyState === 'open') {
                     sendChunk(event.target.result); // Send the loaded chunk
                 } else { throw new Error("Data channel closed during transfer."); }
            } catch (error) { handleFileSendError(error); }
        };
        fileReader.onerror = (error) => { handleFileSendError(new Error("FileReader error: " + error)); };
        readNextChunk(); // Start reading the first chunk
    }

    function readNextChunk() {
        if (!fileToSend || !fileReader || fileReader.readyState === FileReader.LOADING) {
             // console.log("Skipping readNextChunk - reader busy or no file");
             return; // Prevent issues if called while reader is busy
        }
        const start = currentChunk * CHUNK_SIZE;
        if (start < fileToSend.size) {
            const end = Math.min(start + CHUNK_SIZE, fileToSend.size);
            const chunkBlob = fileToSend.slice(start, end);
            fileReader.readAsArrayBuffer(chunkBlob);
        } else {
            // End of file reached by reader logic
            console.log("Finished reading all file chunks.");
        }
    }

    function sendChunk(chunkData) {
        if (!dataChannel || dataChannel.readyState !== 'open') {
             throw new Error("Data channel not open for sending chunk.");
        }

        // Check buffer BEFORE trying to send
        if (dataChannel.bufferedAmount >= MAX_BUFFERED_AMOUNT) {
            console.warn(`Buffer full (${dataChannel.bufferedAmount}). Pausing send. Waiting for 'bufferedamountlow'.`);
            // Don't increment currentChunk or read next. Wait for onbufferedamountlow.
            // Re-queue sending this *same* chunk? Or just let onbufferedamountlow trigger readNextChunk?
            // Let's have onbufferedamountlow call sendNextChunk which tries to send again.
            setTimeout(sendNextChunk, 250); // Add a timeout fallback just in case
            return; // Stop processing this chunk for now
        }

        try {
            dataChannel.send(chunkData);
            currentChunk++;
            const progress = Math.min(100, Math.floor((currentChunk * CHUNK_SIZE / fileToSend.size) * 100));
            fileStatusElem.textContent = `Sending ${fileToSend.name}: ${progress}%`;

            if (currentChunk * CHUNK_SIZE >= fileToSend.size) {
                console.log("All chunks appear sent for", fileToSend.name);
                fileStatusElem.textContent = `Sent: ${fileToSend.name}`;
                resetFileSendState(); // Transfer complete from sender side
            } else {
                // Trigger reading the next chunk asynchronously
                 // Check buffer before scheduling next read
                 if (dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT * 0.8) {
                    // Using setTimeout allows the event loop to handle other things (like receiving messages)
                    setTimeout(readNextChunk, 0);
                 } else {
                     // Buffer getting high, wait for bufferedamountlow or timeout
                     // console.log(`Buffer high (${dataChannel.bufferedAmount}), delaying next read.`);
                     setTimeout(readNextChunk, 100); // Short delay
                 }
            }
        } catch (error) {
             handleFileSendError(error);
        }
    }
    // Helper function to be called by onbufferedamountlow or timeout fallback
    function sendNextChunk() {
        // console.log("Trying to send next chunk (triggered by bufferlow or timeout)");
         readNextChunk(); // Re-initiate the read/send cycle for the current chunk index
    }

    function handleFileSendError(error) {
         console.error("Error during file send:", error);
         fileStatusElem.textContent = `Error sending ${fileToSend ? fileToSend.name : 'file'}: ${error.message}`;
         resetFileSendState();
    }

    function resetFileSendState() {
        if (fileReader) { fileReader.abort(); fileReader = null; }
        fileToSend = null;
        currentChunk = 0;
        selectedFileNameElem.textContent = 'No file selected';
        sendFileBtn.disabled = true; // Disable send until new file selected
         if (connectionEstablished) { // Only re-enable select if connected
             selectFileBtn.disabled = false;
         }
    }

    disconnectBtn.onclick = resetState;

    // --- Data Handling (Receiving - Same as before, slightly refined logging) ---
    function handleReceivedData(data) {
        try {
            if (typeof data === 'string') {
                const message = JSON.parse(data); // Assume JSON for string messages
                if (message.type === 'text') {
                    displayMessage(message.payload, 'received');
                } else if (message.type === 'file-info') {
                    receivingFileInfo = message.payload;
                    receivedFileChunks = []; receivedFileSize = 0;
                    console.log("Receiving file info:", receivingFileInfo);
                    fileStatusElem.textContent = `Receiving: ${receivingFileInfo.name} (0%)`;
                } else { console.warn("Received unknown string message type:", message.type); }
            } else if (data instanceof ArrayBuffer) {
                if (receivingFileInfo) {
                    receivedFileChunks.push(data);
                    receivedFileSize += data.byteLength;
                    const progress = receivingFileInfo.size ? Math.min(100, Math.floor((receivedFileSize / receivingFileInfo.size) * 100)) : 0;
                    fileStatusElem.textContent = `Receiving ${receivingFileInfo.name}: ${progress}%`;

                    if (receivedFileSize === receivingFileInfo.size) {
                        console.log("File fully received:", receivingFileInfo.name);
                        const fileBlob = new Blob(receivedFileChunks, { type: receivingFileInfo.type });
                        displayReceivedFile(fileBlob, receivingFileInfo.name);
                        receivingFileInfo = null; receivedFileChunks = []; receivedFileSize = 0; // Reset
                    } else if (receivedFileSize > receivingFileInfo.size && receivingFileInfo.size > 0) {
                        console.error("Received more data than expected!");
                        fileStatusElem.textContent = `Error receiving ${receivingFileInfo.name}: Size mismatch.`;
                        receivingFileInfo = null; receivedFileChunks = []; receivedFileSize = 0; // Reset
                    } else if (receivingFileInfo.size === 0 && receivedFileSize > 0) {
                         // Handle 0-byte file completion case
                         console.log("Zero-byte file received:", receivingFileInfo.name);
                         const fileBlob = new Blob(receivedFileChunks, { type: receivingFileInfo.type });
                         displayReceivedFile(fileBlob, receivingFileInfo.name);
                         receivingFileInfo = null; receivedFileChunks = []; receivedFileSize = 0; // Reset
                    }
                } else { console.warn("Received ArrayBuffer data but no file info was active."); }
            } else { console.warn("Received unexpected data type:", typeof data); }
        } catch (error) { console.error("Error processing received data:", error); }
    }

    // --- UI Display Functions ---
    function displayMessage(message, type) { /* ... Same as before ... */ }
    function displayReceivedFile(fileBlob, fileName) { /* ... Same as before ... */ }
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    // --- Utility Functions ---
    copyOfferBtn.onclick = () => { offerCodeText.select(); document.execCommand('copy'); alert('Offer Code copied!'); };
    copyAnswerBtn.onclick = () => { answerCodeText.select(); document.execCommand('copy'); alert('Answer Code copied!'); };

    // --- Initial Setup ---
    resetState(); // Initialize state variables and UI
    showScreen('initial'); // Show the first screen

});