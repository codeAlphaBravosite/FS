document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const iceServers = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };
    const dataChannelOptions = {
        ordered: true // Guarantee order for text messages and file chunks
    };
    const CHUNK_SIZE = 64 * 1024; // 64KB chunk size - adjust as needed
    const MAX_BUFFERED_AMOUNT = CHUNK_SIZE * 10; // Allow buffering ~10 chunks

    // --- State Variables ---
    let peerConnection = null;
    let dataChannel = null;
    let localOffer = null;
    let remoteOffer = null;
    let localAnswer = null;
    let remoteAnswer = null;
    let isHost = false;
    let connectionEstablished = false;
    let fileToSend = null;
    let fileReader = null;
    let currentChunk = 0;
    let receivingFileInfo = null;
    let receivedFileChunks = [];
    let receivedFileSize = 0;

    // --- UI Elements (Same as before) ---
    const screens = { /* ... Same as before ... */ };
    const statusElem = document.getElementById('status');
    const hostStatusElem = document.getElementById('hostStatus');
    const clientStatusElem = document.getElementById('clientStatus');
    const connectionStatusElem = document.getElementById('connectionStatus');
    const messagesDiv = document.getElementById('messages');
    const messageInput = document.getElementById('messageInput');
    const fileInput = document.getElementById('fileInput');
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
    const sendFileBtn = document.getElementById('sendFileBtn');
    const offerQrCodeDiv = document.getElementById('offerQrCode');
    const answerQrCodeDiv = document.getElementById('answerQrCode');
    const clientOfferInputSection = document.getElementById('clientOfferInputSection');
    const clientAnswerDisplaySection = document.getElementById('clientAnswerDisplaySection');

    // --- UI Elements Lookup (Simplified for brevity, assume they exist as in HTML) ---
    // Assign elements to variables (e.g., const screens = {...}; etc.)
    Object.assign(screens, {
        initial: document.getElementById('initialScreen'),
        host: document.getElementById('hostScreen'),
        client: document.getElementById('clientScreen'),
        connected: document.getElementById('connectedScreen'),
    });
    // ... assign other elements like statusElem, messageInput, fileInput, etc. ...


    // --- UI State Management (showScreen, updateStatus - Same as before) ---
    function showScreen(screenName) {
        Object.values(screens).forEach(screen => screen.classList.remove('active'));
        if (screens[screenName]) {
            screens[screenName].classList.add('active');
        }
        console.log(`Navigated to screen: ${screenName}`);
    }

    function updateStatus(message, element = statusElem) {
        console.log("Status Update:", message);
        if (element) element.textContent = `Status: ${message}`;
    }

    function resetState() {
        console.log("Resetting state...");
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        // dataChannel closed automatically when peerConnection closes
        dataChannel = null;
        localOffer = null;
        remoteOffer = null;
        localAnswer = null;
        remoteAnswer = null;
        isHost = false;
        connectionEstablished = false;
        fileToSend = null;
        if (fileReader) { fileReader.abort(); fileReader = null; }
        currentChunk = 0;
        receivingFileInfo = null;
        receivedFileChunks = [];
        receivedFileSize = 0;

        // Reset UI elements (Same as before)
        offerCodeText.value = '';
        answerInputHostText.value = '';
        offerInputClientText.value = '';
        answerCodeText.value = '';
        messagesDiv.innerHTML = '';
        messageInput.value = '';
        fileInput.value = '';
        fileStatusElem.textContent = '';
        sendFileBtn.disabled = true;
        clientOfferInputSection.style.display = 'block';
        clientAnswerDisplaySection.style.display = 'none';
        updateStatus("Idle");
        updateStatus("Waiting for Answer...", hostStatusElem);
        updateStatus("Waiting for host to connect...", clientStatusElem);
        updateStatus("Connected", connectionStatusElem);
        showScreen('initial');
    }


    // --- WebRTC Core Logic (createPeerConnection, setupDataChannelEvents, handleConnectionEstablished - Mostly Same) ---
    function createPeerConnection() {
        console.log("Creating PeerConnection with config:", iceServers);
        peerConnection = new RTCPeerConnection(iceServers);

        peerConnection.onicecandidate = (event) => {
            // Simplified ICE handling: wait for null candidate
            if (!event.candidate) {
                console.log("All local ICE candidates gathered.");
                handleIceGatheringComplete();
            } else {
                console.log("Local ICE candidate found (ignored for now in simple signaling)");
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log("ICE Connection State:", peerConnection.iceConnectionState);
            const statusElement = connectionEstablished ? connectionStatusElem : (isHost ? hostStatusElem : clientStatusElem);
            updateStatus(`ICE State: ${peerConnection.iceConnectionState}`, statusElement);

            switch(peerConnection.iceConnectionState) {
                case 'connected':
                case 'completed':
                    // Might already be handled by ondatachannel open
                    if (!connectionEstablished && dataChannel && dataChannel.readyState === 'open') {
                        handleConnectionEstablished();
                    }
                    break;
                case 'disconnected':
                case 'failed':
                case 'closed':
                    if (connectionEstablished) {
                        alert("Connection lost or closed!");
                        resetState();
                    } else {
                         // Failed before establishing fully
                         console.warn("Connection failed before completing.");
                         // Optionally alert the user here too if stuck in connecting state
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

        // Set binary type to arraybuffer for file transfers
        dataChannel.binaryType = 'arraybuffer';

        dataChannel.onopen = () => {
            console.log("Data Channel is open!");
            handleConnectionEstablished();
        };

        dataChannel.onclose = () => {
            console.log("Data Channel is closed!");
            if (connectionEstablished) {
                alert("Connection closed.");
                resetState();
            }
        };

        dataChannel.onerror = (error) => {
            console.error("Data Channel Error:", error);
            alert(`Data channel error: ${error.error ? error.error.message : 'Unknown error'}`);
            resetState();
        };

        dataChannel.onmessage = (event) => {
            handleReceivedData(event.data);
        };

         // Monitor buffered amount to pause sending if necessary
        dataChannel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2; // Threshold for 'bufferedamountlow'
        dataChannel.onbufferedamountlow = () => {
            // console.log(`Buffered amount low (${dataChannel.bufferedAmount}), resuming send.`);
            // Resume sending file chunks if paused
            if (fileToSend && fileReader) {
                sendNextChunk();
            }
        };
    }

    function handleConnectionEstablished() {
        if (connectionEstablished) return;
        console.log("Connection established!");
        connectionEstablished = true;
        updateStatus("Connected!", connectionStatusElem);
        showScreen('connected');
        sendFileBtn.disabled = false;
        sendMessageBtn.disabled = false; // Ensure message sending is enabled too
    }

    // Simplified signaling: wait for all candidates (null event)
    function handleIceGatheringComplete() {
         if (!peerConnection || !peerConnection.localDescription) {
             console.error("Cannot finalize signal: PeerConnection or localDescription missing.");
             return;
         }
         console.log("ICE Gathering Complete. Finalizing Offer/Answer.");
         const signalData = {
            type: peerConnection.localDescription.type,
            sdp: peerConnection.localDescription.sdp,
         };
         const signalString = JSON.stringify(signalData);

         if (isHost) {
            localOffer = signalData;
            offerCodeText.value = signalString;
            updateStatus("Offer generated. Waiting for Answer...", hostStatusElem);
            // generateQrCode(offerQrCodeDiv, signalString); // Placeholder
         } else {
            localAnswer = signalData;
            answerCodeText.value = signalString;
            clientAnswerDisplaySection.style.display = 'block';
            updateStatus("Answer generated. Share it with the host.", clientStatusElem);
            // generateQrCode(answerQrCodeDiv, signalString); // Placeholder
         }
    }

    // --- Host Actions (startSessionBtn, submitAnswerBtn, cancelHostBtn - Same logic as before) ---
    startSessionBtn.onclick = async () => {
        isHost = true;
        resetState();
        createPeerConnection();
        console.log("Host creating data channel 'fileTransferChannel'");
        dataChannel = peerConnection.createDataChannel('fileTransferChannel', dataChannelOptions);
        setupDataChannelEvents(); // Setup listeners immediately
        try {
            console.log("Host creating offer...");
            updateStatus("Creating Offer...", hostStatusElem);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            // ICE gathering starts, handleIceGatheringComplete called when done
            showScreen('host');
        } catch (error) {
            console.error("Error creating offer:", error);
            updateStatus(`Error: ${error.message}`, hostStatusElem); resetState();
        }
    };
    submitAnswerBtn.onclick = async () => {
        const answerString = answerInputHostText.value.trim();
        if (!answerString) return alert("Please paste the Answer Code first.");
        try {
            remoteAnswer = JSON.parse(answerString);
            if (remoteAnswer.type !== 'answer' || !remoteAnswer.sdp) throw new Error("Invalid Answer format.");
            console.log("Received Answer, setting remote description...");
            updateStatus("Received Answer, connecting...", hostStatusElem);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteAnswer));
            console.log("Remote description (Answer) set successfully.");
        } catch (error) {
            console.error("Error processing Answer:", error); alert(`Error: ${error.message}`); updateStatus(`Error: ${error.message}`, hostStatusElem);
        }
    };
    cancelHostBtn.onclick = resetState;

    // --- Client Actions (joinSessionBtn, submitOfferBtn, cancelClientBtn - Same logic as before) ---
    joinSessionBtn.onclick = () => {
        isHost = false;
        resetState();
        showScreen('client'); updateStatus("Ready to join. Paste Offer Code.", clientStatusElem);
    };
    submitOfferBtn.onclick = async () => {
         const offerString = offerInputClientText.value.trim();
         if (!offerString) return alert("Please paste the Offer Code first.");
         try {
             remoteOffer = JSON.parse(offerString);
             if (remoteOffer.type !== 'offer' || !remoteOffer.sdp) throw new Error("Invalid Offer format.");
             console.log("Received Offer, processing..."); updateStatus("Processing Offer...", clientStatusElem);
             createPeerConnection(); // Create connection AFTER getting offer
             await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteOffer));
             console.log("Remote description (Offer) set.");
             console.log("Client creating answer..."); updateStatus("Creating Answer...", clientStatusElem);
             const answer = await peerConnection.createAnswer();
             await peerConnection.setLocalDescription(answer);
             // ICE gathering starts, handleIceGatheringComplete called when done
             clientOfferInputSection.style.display = 'none';
         } catch (error) {
             console.error("Error processing Offer/creating Answer:", error); alert(`Error: ${error.message}`); updateStatus(`Error: ${error.message}`, clientStatusElem); resetState();
         }
    };
    cancelClientBtn.onclick = resetState;

     // --- Connected Actions (Text Messaging - Same logic as before) ---
    sendMessageBtn.onclick = () => {
        const message = messageInput.value.trim();
        if (message && dataChannel && dataChannel.readyState === 'open') {
            try {
                const dataToSend = JSON.stringify({ type: 'text', payload: message });
                if (dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT) { // Check buffer before sending
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
    messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessageBtn.click(); });

    // --- Connected Actions (File Transfer - ENHANCED) ---
    sendFileBtn.onclick = () => {
        if (fileToSend) {
            alert("Please wait for the current file transfer to complete.");
            return;
        }
        fileInput.click(); // Trigger hidden file input
    };

    fileInput.onchange = () => {
        const files = fileInput.files;
        if (files.length > 0 && dataChannel && dataChannel.readyState === 'open') {
            if (fileToSend) { // Double check if another transfer started somehow
                 alert("Please wait for the current file transfer to complete.");
                 fileInput.value = ''; // Clear selection
                 return;
            }
            fileToSend = files[0];
            console.log(`Selected file: ${fileToSend.name} (${fileToSend.size} bytes)`);
            fileStatusElem.textContent = `Starting send: ${fileToSend.name}...`;
            sendFileBtn.disabled = true; // Disable button during transfer

            // 1. Send file metadata first
            const fileInfo = {
                type: 'file-info',
                payload: {
                    name: fileToSend.name,
                    size: fileToSend.size,
                    type: fileToSend.type // MIME type
                }
            };
            try {
                 if (dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT) {
                    dataChannel.send(JSON.stringify(fileInfo));
                    console.log("Sent file info:", fileInfo.payload.name);
                    currentChunk = 0; // Reset chunk counter
                    // Use timeout to allow metadata message to likely go through before chunks
                    setTimeout(startSendingChunks, 100);
                 } else {
                     throw new Error("Buffer full before sending file info");
                 }
            } catch (error) {
                console.error("Error sending file info:", error);
                fileStatusElem.textContent = `Error starting send: ${error.message}`;
                resetFileSendState();
            }
        }
         // Clear the input value so the same file can be selected again if needed
         fileInput.value = '';
    };

    function startSendingChunks() {
        if (!fileToSend) return;
        fileReader = new FileReader();
        fileReader.onload = (event) => {
            // Chunk loaded into event.target.result (ArrayBuffer)
            try {
                 if (dataChannel.readyState === 'open') {
                    // Check buffer BEFORE sending chunk
                    if (dataChannel.bufferedAmount >= MAX_BUFFERED_AMOUNT) {
                         console.warn(`Buffer full (${dataChannel.bufferedAmount}). Pausing send.`);
                         // Don't proceed. Wait for onbufferedamountlow event.
                         // Re-schedule reading the *same* chunk later might be complex.
                         // Simpler approach: Just wait and hope onbufferedamountlow triggers soon.
                         // A more robust system might use Promises or async/await with delays.
                         setTimeout(() => sendChunk(event.target.result), 500); // Retry sending same chunk later
                         return;
                     }
                    // Send the actual chunk data
                    sendChunk(event.target.result);
                 } else {
                     throw new Error("Data channel closed during transfer.");
                 }
            } catch (error) {
                console.error("Error sending chunk:", error);
                fileStatusElem.textContent = `Error sending ${fileToSend.name}: ${error.message}`;
                resetFileSendState();
            }
        };
        fileReader.onerror = (error) => {
            console.error("FileReader Error:", error);
            fileStatusElem.textContent = `Error reading file: ${fileToSend.name}`;
            resetFileSendState();
        };
        // Start reading the first chunk
        readNextChunk();
    }

    function readNextChunk() {
        if (!fileToSend || !fileReader) return;

        const start = currentChunk * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileToSend.size);

        if (start < fileToSend.size) {
            // console.log(`Reading chunk ${currentChunk}: bytes ${start}-${end-1}`);
            const chunkBlob = fileToSend.slice(start, end);
            fileReader.readAsArrayBuffer(chunkBlob);
        } else {
            // All chunks read and sent (or waiting to be sent)
            console.log("Finished reading all file chunks.");
            // Send completion message *after* last chunk is sent
            // sendFileComplete(); // Let's send completion *after* the last chunk is ACK'd or buffer clears
        }
    }

    function sendChunk(chunkData) {
         try {
            dataChannel.send(chunkData); // Send the ArrayBuffer
            currentChunk++;
            const progress = Math.min(100, Math.floor((currentChunk * CHUNK_SIZE / fileToSend.size) * 100));
            fileStatusElem.textContent = `Sending ${fileToSend.name}: ${progress}%`;

            if (currentChunk * CHUNK_SIZE >= fileToSend.size) {
                 console.log("All chunks sent for", fileToSend.name);
                 // Optionally send a completion message (though receiver can know by size)
                 // sendFileComplete();
                 resetFileSendState(); // Transfer seems complete from sender side
                 fileStatusElem.textContent = `Sent: ${fileToSend.name}`;
             } else {
                 // Check buffer before reading next chunk immediately
                 if (dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT * 0.8) { // Keep buffer reasonably clear
                    readNextChunk(); // Read the next chunk
                 } else {
                     console.log(`Buffer high (${dataChannel.bufferedAmount}), delaying next read.`);
                     // Rely on onbufferedamountlow to trigger sendNextChunk -> readNextChunk
                     // Or use a small timeout as fallback
                     setTimeout(readNextChunk, 100);
                 }
             }
         } catch (error) {
             console.error("Error during sendChunk:", error);
             fileStatusElem.textContent = `Error sending ${fileToSend.name}: ${error.message}`;
             resetFileSendState();
         }
    }

    // Helper to clean up after sending or error
    function resetFileSendState() {
        fileToSend = null;
        if (fileReader) { fileReader.abort(); fileReader = null; }
        currentChunk = 0;
        sendFileBtn.disabled = false; // Re-enable button
    }

    disconnectBtn.onclick = resetState;

    // --- Data Handling (ENHANCED for Files) ---
    function handleReceivedData(data) {
        try {
            if (typeof data === 'string') {
                const message = JSON.parse(data);
                if (message.type === 'text') {
                    console.log("Received text message:", message.payload);
                    displayMessage(message.payload, 'received');
                } else if (message.type === 'file-info') {
                    // Start receiving a new file
                    receivingFileInfo = message.payload;
                    receivedFileChunks = [];
                    receivedFileSize = 0;
                    console.log("Receiving file info:", receivingFileInfo);
                    fileStatusElem.textContent = `Receiving: ${receivingFileInfo.name} (0%)`;
                    // Prepare UI if needed
                } else {
                    console.warn("Received unknown string message type:", message.type);
                }
            } else if (data instanceof ArrayBuffer) {
                // Received a file chunk (binary data)
                if (receivingFileInfo) {
                    receivedFileChunks.push(data);
                    receivedFileSize += data.byteLength;

                    const progress = Math.min(100, Math.floor((receivedFileSize / receivingFileInfo.size) * 100));
                    fileStatusElem.textContent = `Receiving ${receivingFileInfo.name}: ${progress}%`;

                    // Check if file is complete
                    if (receivedFileSize === receivingFileInfo.size) {
                        console.log("File fully received:", receivingFileInfo.name);
                        const fileBlob = new Blob(receivedFileChunks, { type: receivingFileInfo.type });
                        displayReceivedFile(fileBlob, receivingFileInfo.name);

                        // Reset for next file
                        receivingFileInfo = null;
                        receivedFileChunks = [];
                        receivedFileSize = 0;
                    } else if (receivedFileSize > receivingFileInfo.size) {
                        // This shouldn't happen with reliable transport
                        console.error("Received more data than expected for file!");
                        fileStatusElem.textContent = `Error receiving ${receivingFileInfo.name}: Size mismatch.`;
                        // Reset state
                        receivingFileInfo = null;
                        receivedFileChunks = [];
                        receivedFileSize = 0;
                    }
                } else {
                    console.warn("Received ArrayBuffer data but no file info was active.");
                }
            } else {
                console.warn("Received unexpected data type:", typeof data);
            }
        } catch (error) {
            console.error("Error processing received data:", error);
            // Attempt to log the problematic data if it's small and stringifiable
            try {
                 if (typeof data === 'string' && data.length < 200) console.error("Data was:", data);
            } catch {}
        }
    }

    // --- UI Display Functions (displayMessage, displayReceivedFile - Same as before) ---
    function displayMessage(message, type) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add(type);
        msgDiv.textContent = message;
        messagesDiv.appendChild(msgDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

     function displayReceivedFile(fileBlob, fileName) {
         const downloadLink = document.createElement('a');
         const objectURL = URL.createObjectURL(fileBlob);
         downloadLink.href = objectURL;
         downloadLink.download = fileName;
         downloadLink.textContent = `Download ${fileName}`;
         downloadLink.style.display = 'block';
         downloadLink.style.marginTop = '10px';

         // Append link to status area, replacing previous progress/status text
         fileStatusElem.innerHTML = `Received: `; // Clear previous status text
         fileStatusElem.appendChild(downloadLink);

         // Clean up the Object URL - revoking immediately might prevent download in some cases
         // Revoke after a short delay or when link is clicked. Clicking is safer.
         downloadLink.addEventListener('click', () => {
             // Revoke after a delay to ensure download can start
             setTimeout(() => {
                URL.revokeObjectURL(objectURL);
                console.log("Revoked Object URL for", fileName);
             }, 1500); // 1.5 seconds delay
         }, { once: true }); // Only listen for the first click
     }

    // --- Utility Functions (copyOfferBtn, copyAnswerBtn - Same as before) ---
    copyOfferBtn.onclick = () => { offerCodeText.select(); document.execCommand('copy'); alert('Offer Code copied!'); };
    copyAnswerBtn.onclick = () => { answerCodeText.select(); document.execCommand('copy'); alert('Answer Code copied!'); };

    // --- QR Code Placeholders (Same as before) ---
    function generateQrCode(element, text) { /* ... Placeholder ... */ element.textContent = "[QR Placeholder]"; }
    function startQrScanner(onScanSuccess) { /* ... Placeholder ... */ alert("QR Scanner not implemented."); }
    function stopQrScanner() { /* ... Placeholder ... */ }

    // --- Initial Setup ---
    resetState(); // Initialize state variables and UI
    showScreen('initial'); // Show the first screen

});