document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const iceServers = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
            // Add TURN servers here if needed for complex networks
        ]
    };
    const dataChannelOptions = { ordered: true }; // Guarantee order for text and file chunks
    const CHUNK_SIZE = 64 * 1024; // 64KB chunk size
    const MAX_BUFFERED_AMOUNT = CHUNK_SIZE * 16; // Allow buffering (~1MB)

    // --- State Variables ---
    let peerConnection = null;
    let dataChannel = null;
    let isHost = false;
    let connectionEstablished = false;
    let fileToSend = null;
    let fileReader = null;
    let currentChunk = 0;
    let receivingFileInfo = null;
    let receivedFileChunks = [];
    let receivedFileSize = 0;
    let html5QrCodeScanner = null; // Scanner instance

    // --- UI Elements ---
    const screens = {
        initial: document.getElementById('initialScreen'),
        host: document.getElementById('hostScreen'),
        client: document.getElementById('clientScreen'),
        connected: document.getElementById('connectedScreen'),
        scanner: document.getElementById('scannerScreen'), // Scanner screen
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
    const submitAnswerBtn = document.getElementById('submitAnswerBtn'); // Text submit
    const submitOfferBtn = document.getElementById('submitOfferBtn'); // Text submit
    const cancelHostBtn = document.getElementById('cancelHostBtn');
    const cancelClientBtn = document.getElementById('cancelClientBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const sendMessageBtn = document.getElementById('sendMessageBtn');
    const sendFileBtn = document.getElementById('sendFileBtn'); // Send file button
    const clientOfferInputSection = document.getElementById('clientOfferInputSection');
    const clientAnswerDisplaySection = document.getElementById('clientAnswerDisplaySection');
    // QR Elements
    const offerQrCodeDiv = document.getElementById('offerQrCode');
    const answerQrCodeDiv = document.getElementById('answerQrCode');
    const qrReaderDivId = 'qrReader'; // ID of the div for html5-qrcode
    const scannerStatusElem = document.getElementById('scannerStatus');
    const scanOfferBtn = document.getElementById('scanOfferBtn');
    const scanAnswerBtn = document.getElementById('scanAnswerBtn');
    const cancelScanBtn = document.getElementById('cancelScanBtn');


    // --- UI State Management ---
    function showScreen(screenName) {
        // Hide all regular screens first
        Object.entries(screens).forEach(([key, screen]) => {
            if (key !== 'scanner' && screen) screen.classList.remove('active');
        });
        // Hide scanner screen separately unless explicitly requested
        if (screens.scanner) screens.scanner.classList.remove('active');

        if (screens[screenName]) {
            screens[screenName].classList.add('active');
            console.log(`Navigated to screen: ${screenName}`);
        } else {
            console.warn(`Screen ${screenName} not found.`);
        }
    }

    function updateStatus(message, element = statusElem) {
        console.log("Status Update:", message);
        if (element) element.textContent = `Status: ${message}`;
    }

    function resetState() {
        console.log("Resetting state...");
        stopQrScanner(false); // Ensure scanner is stopped without navigating back immediately

        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        dataChannel = null; // Closed automatically with peerConnection
        isHost = false;
        connectionEstablished = false;
        if (fileReader) {
            fileReader.abort();
            fileReader = null;
        }
        resetFileSendState(); // Clear sending state
        receivingFileInfo = null;
        receivedFileChunks = [];
        receivedFileSize = 0;

        // Reset UI elements
        offerCodeText.value = '';
        answerInputHostText.value = '';
        offerInputClientText.value = '';
        answerCodeText.value = '';
        if (offerQrCodeDiv) offerQrCodeDiv.innerHTML = ''; // Clear QR codes
        if (answerQrCodeDiv) answerQrCodeDiv.innerHTML = '';
        if (messagesDiv) messagesDiv.innerHTML = '';
        if (messageInput) messageInput.value = '';
        if (fileInput) fileInput.value = ''; // Clear hidden input
        if (selectedFileNameElem) selectedFileNameElem.textContent = 'No file selected';
        if (fileStatusElem) fileStatusElem.textContent = '';
        if (sendFileBtn) sendFileBtn.disabled = true;
        if (selectFileBtn) selectFileBtn.disabled = true;
        if (sendMessageBtn) sendMessageBtn.disabled = true;
        if (clientOfferInputSection) clientOfferInputSection.style.display = 'block';
        if (clientAnswerDisplaySection) clientAnswerDisplaySection.style.display = 'none';

        updateStatus("Idle");
        updateStatus("Waiting for Answer...", hostStatusElem);
        updateStatus("Waiting for host to connect...", clientStatusElem);
        updateStatus("Connected", connectionStatusElem);

        showScreen('initial'); // Navigate to initial screen *after* resetting
    }


    // --- WebRTC Core Logic ---
    function createPeerConnection() {
        console.log("Creating PeerConnection with config:", iceServers);
        try {
            peerConnection = new RTCPeerConnection(iceServers);
        } catch (error) {
             console.error("Failed to create RTCPeerConnection:", error);
             alert("Failed to initialize connection. Your browser might not support WebRTC or it might be disabled.");
             resetState();
             return; // Stop execution if PC fails
        }


        peerConnection.onicecandidate = (event) => {
            // Primarily for debugging in this simplified signaling model
            if (event.candidate) {
                 // console.log("Local ICE candidate found (usually handled automatically via STUN)");
            } else {
                console.log("All local ICE candidates gathered (event.candidate is null).");
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            if (!peerConnection) return; // Guard against race conditions after reset
            console.log("ICE Connection State:", peerConnection.iceConnectionState);
            const statusElement = connectionEstablished ? connectionStatusElem : (isHost ? hostStatusElem : clientStatusElem);
            if (statusElement) updateStatus(`ICE State: ${peerConnection.iceConnectionState}`, statusElement);

            switch (peerConnection.iceConnectionState) {
                case 'connected':
                case 'completed':
                    // Connection is up. Ensure data channel is open too.
                    if (!connectionEstablished && dataChannel && dataChannel.readyState === 'open') {
                        handleConnectionEstablished();
                    }
                    break;
                case 'disconnected':
                    // Connection lost temporarily, might recover. WebRTC spec suggests waiting.
                    // However, for simplicity in this app, we'll treat it as a closure.
                    if (connectionEstablished) {
                        console.warn("Peer disconnected.");
                        alert("Connection disconnected.");
                        resetState();
                    }
                    break;
                case 'failed':
                    // Connection failed permanently.
                    console.error("Connection failed.");
                    if (!connectionEstablished) {
                        alert("Connection failed. Please check network or try again.");
                    }
                    resetState();
                    break;
                case 'closed':
                    // Connection closed gracefully or after failure/disconnect.
                    console.log("Connection closed.");
                    // resetState handles UI/cleanup if we were previously connected
                    if (connectionEstablished) {
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
        dataChannel.binaryType = 'arraybuffer'; // Crucial for file transfer

        dataChannel.onopen = () => {
            console.log("Data Channel is open!");
            // Ensure connectionEstablished is called even if ICE state is slightly delayed
            handleConnectionEstablished();
        };
        dataChannel.onclose = () => {
            console.log("Data Channel is closed!");
            // Let iceconnectionstatechange handle the main reset logic
        };
        dataChannel.onerror = (error) => {
            console.error("Data Channel Error:", error);
            // Inform user, but don't necessarily reset immediately unless connection fails
            alert(`Data channel error: ${error.error ? error.error.message : 'Unknown error'}`);
        };
        dataChannel.onmessage = (event) => {
            handleReceivedData(event.data);
        };
        // Setup buffer handling for flow control
        dataChannel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2;
        dataChannel.onbufferedamountlow = () => {
             // console.log(`Buffered amount low (${dataChannel.bufferedAmount}), resuming send.`);
            if (fileToSend && fileReader) {
                // Try reading/sending the next chunk if paused
                sendNextChunk();
            }
        };
    }

    function handleConnectionEstablished() {
        if (connectionEstablished || !dataChannel || dataChannel.readyState !== 'open') return; // Prevent multiple calls or calls before ready

        console.log("Connection established and Data Channel open!");
        connectionEstablished = true;
        updateStatus("Connected!", connectionStatusElem);
        showScreen('connected');
        // Enable controls on connected screen
        if (selectFileBtn) selectFileBtn.disabled = false;
        if (sendMessageBtn) sendMessageBtn.disabled = false;
        // Send button remains disabled until a file is selected
    }

    // --- QR Code Generation ---
    function generateQrCode(element, text) {
        if (!element) return console.error("QR Code container element not found");
        element.innerHTML = ''; // Clear previous QR
        if (!text) return console.warn("No text provided for QR code generation.");
        try {
            // Using qrcode-generator library loaded via CDN
            const typeNumber = 0; // Auto-detect complexity based on text length
            const errorCorrectionLevel = 'L'; // Low error correction for smaller QR codes
            const qr = qrcode(typeNumber, errorCorrectionLevel);
            qr.addData(text);
            qr.make();
            // Create img tag (more reliable than canvas/table sometimes)
            element.innerHTML = qr.createImgTag(6, 10); // (cellSize=6px, margin=10px)
            console.log("QR Code generated successfully.");
        } catch (e) {
            console.error("QR Code generation failed:", e);
            element.textContent = "[QR Gen Error]";
            element.style.fontSize = '12px';
            element.style.color = 'red';
        }
    }

    // --- QR Code Scanning ---
    function startQrScanner(scanType) { // scanType = 'offer' or 'answer'
        if (html5QrCodeScanner && html5QrCodeScanner.isScanning) {
            console.warn("Scanner is already running.");
            return;
        }

        // Ensure the scanner library is loaded
        if (typeof Html5Qrcode === "undefined") {
             alert("QR Scanner library not loaded!");
             return;
        }

        html5QrCodeScanner = new Html5Qrcode(qrReaderDivId);
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 }, // Define scanning area
            aspectRatio: 1.0, // Suggest square aspect ratio
            rememberLastUsedCamera: true // Try to reuse last camera
        };

        const qrCodeSuccessCallback = (decodedText, decodedResult) => {
            console.log(`QR Code detected: ${decodedText.substring(0, 50)}...`);
            stopQrScanner(false); // Stop scanning but don't navigate yet
            updateStatus("QR Code Scanned! Processing...", scannerStatusElem);

            // Add a small delay before processing to allow UI update
            setTimeout(() => {
                 // Process based on scan type
                 try {
                     if (scanType === 'offer') {
                         offerInputClientText.value = decodedText;
                         submitOfferBtn.click(); // Automatically try to generate answer via text logic
                     } else if (scanType === 'answer') {
                         answerInputHostText.value = decodedText;
                         submitAnswerBtn.click(); // Automatically try to connect via text logic
                     }
                     // Navigate back after processing starts
                     showScreen(isHost ? 'host' : 'client');
                 } catch (e) {
                     console.error("Error processing scanned code:", e);
                     alert(`Error processing scanned code: ${e.message}`);
                     stopQrScanner(); // Ensure navigation back happens on error too
                 }
            }, 100); // 100ms delay
        };

        const qrCodeErrorCallback = (errorMessage) => {
            // Avoid logging "QR code not found" constantly
            if (!errorMessage || !errorMessage.includes("NotFound")) {
                console.warn(`QR Scanner Error: ${errorMessage}`);
                 // updateStatus(`Scanner Error: ${errorMessage}`, scannerStatusElem); // Can be annoying
            }
        };

        updateStatus("Starting QR Scanner...", scannerStatusElem);
        showScreen('scanner'); // Show the scanner overlay

        // Start scanning
        html5QrCodeScanner.start(
            { facingMode: "environment" }, // Prioritize back camera
            config,
            qrCodeSuccessCallback,
            qrCodeErrorCallback
        ).then(() => {
            console.log("QR Scanner started successfully.");
            updateStatus("Scanning... Align QR code within the frame", scannerStatusElem);
        }).catch(err => {
            console.error("Unable to start QR Scanner:", err);
            alert(`Error starting scanner: ${err}. Please ensure camera permissions are granted.`);
            updateStatus(`Error: ${err}`, scannerStatusElem);
            stopQrScanner(); // Stop and navigate back on start error
        });
    }

    function stopQrScanner(navigateBack = true) {
        if (html5QrCodeScanner && html5QrCodeScanner.isScanning) {
            html5QrCodeScanner.stop()
                .then(() => { console.log("QR Scanner stopped successfully."); })
                .catch(err => { console.warn("Error stopping QR scanner (might be already stopped):", err); })
                .finally(() => {
                    html5QrCodeScanner = null;
                    if (navigateBack) showScreen(isHost ? 'host' : 'client'); // Hide scanner screen
                });
        } else {
            html5QrCodeScanner = null; // Ensure instance is cleared
             if (navigateBack) showScreen(isHost ? 'host' : 'client'); // Hide scanner screen even if not active
        }
    }


    // --- Host Actions ---
    startSessionBtn.onclick = async () => {
        isHost = true;
        resetState(); // Ensure clean start
        createPeerConnection();
        if (!peerConnection) return; // Stop if PC creation failed

        console.log("Host creating data channel 'p2pChannel'");
        dataChannel = peerConnection.createDataChannel('p2pChannel', dataChannelOptions);
        setupDataChannelEvents();

        try {
            updateStatus("Creating Offer...", hostStatusElem);
            const offer = await peerConnection.createOffer();
            console.log("Offer created, setting local description...");
            await peerConnection.setLocalDescription(offer); // Set local description FIRST

            if (peerConnection.localDescription) {
                const offerSignal = { type: 'offer', sdp: peerConnection.localDescription.sdp };
                const offerString = JSON.stringify(offerSignal);
                offerCodeText.value = offerString;
                generateQrCode(offerQrCodeDiv, offerString); // Generate QR for offer
                updateStatus("Offer Generated. Ask peer to Scan QR or Copy text.", hostStatusElem);
                showScreen('host');
            } else { throw new Error("Local description is missing after setLocalDescription."); }

        } catch (error) {
            console.error("Error during Offer creation/setting:", error);
            updateStatus(`Error creating Offer: ${error.message}`, hostStatusElem);
            resetState(); // Reset on critical error
        }
    };

    scanAnswerBtn.onclick = () => { startQrScanner('answer'); };

    // Handles connection attempt using the pasted Answer text
    submitAnswerBtn.onclick = async () => {
        const answerString = answerInputHostText.value.trim();
        if (!answerString) return alert("Please paste the Answer Code first or use Scan QR.");
        if (!peerConnection) return alert("Connection not initialized. Please restart.");

        try {
            const remoteAnswer = JSON.parse(answerString);
            if (remoteAnswer.type !== 'answer' || !remoteAnswer.sdp) throw new Error("Invalid Answer format.");

            console.log("Received Answer via text, setting remote description...");
            updateStatus("Received Answer, connecting...", hostStatusElem);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteAnswer));
            console.log("Remote description (Answer) set successfully.");
            // Connection establishment now handled by ICE state changes / Data Channel events

        } catch (error) {
            console.error("Error processing Answer text:", error);
            alert(`Error processing Answer: ${error.message}`);
            updateStatus(`Error processing Answer: ${error.message}`, hostStatusElem);
        }
    };

    cancelHostBtn.onclick = resetState;


    // --- Client Actions ---
    joinSessionBtn.onclick = () => {
        isHost = false;
        resetState();
        showScreen('client');
        updateStatus("Ready to join. Scan or paste Offer Code.", clientStatusElem);
    };

    scanOfferBtn.onclick = () => { startQrScanner('offer'); };

    // Handles generating the Answer based on the pasted Offer text
    submitOfferBtn.onclick = async () => {
        const offerString = offerInputClientText.value.trim();
        if (!offerString) return alert("Offer Code is empty. Scan QR or paste text first.");

        try {
            const remoteOffer = JSON.parse(offerString);
            if (remoteOffer.type !== 'offer' || !remoteOffer.sdp) throw new Error("Invalid Offer format.");

            console.log("Received Offer via text, processing...");
            updateStatus("Processing Offer...", clientStatusElem);
            createPeerConnection(); // Create PC after getting offer
             if (!peerConnection) return; // Stop if PC creation failed

            console.log("Setting remote description (Offer)...");
            await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteOffer));
            console.log("Remote description (Offer) set.");

            console.log("Client creating answer...");
            updateStatus("Creating Answer...", clientStatusElem);
            const answer = await peerConnection.createAnswer();
            console.log("Answer created, setting local description...");
            await peerConnection.setLocalDescription(answer); // Set local description FIRST
            console.log("Local description (Answer) set.");

            if (peerConnection.localDescription) {
                const answerSignal = { type: 'answer', sdp: peerConnection.localDescription.sdp };
                const answerString = JSON.stringify(answerSignal);
                answerCodeText.value = answerString;
                generateQrCode(answerQrCodeDiv, answerString); // Generate QR for answer
                clientOfferInputSection.style.display = 'none';
                clientAnswerDisplaySection.style.display = 'block';
                updateStatus("Answer Generated. Ask host to Scan QR or Copy text.", clientStatusElem);
            } else { throw new Error("Local description missing after creating Answer."); }

        } catch (error) {
            console.error("Error processing Offer or creating Answer:", error);
            alert(`Error: ${error.message}`);
            updateStatus(`Error processing Offer: ${error.message}`, clientStatusElem);
            resetState(); // Reset on critical error
        }
    };

    cancelClientBtn.onclick = resetState;


    // --- Scanner Cancel Button ---
    cancelScanBtn.onclick = () => { stopQrScanner(true); }; // Stop and navigate back


    // --- Connected Actions (Text Messaging) ---
    sendMessageBtn.onclick = () => {
        const message = messageInput.value.trim();
        if (message && dataChannel && dataChannel.readyState === 'open') {
            try {
                const dataToSend = JSON.stringify({ type: 'text', payload: message });
                // Check buffer before sending
                if (dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT) {
                    dataChannel.send(dataToSend);
                    displayMessage(message, 'sent');
                    messageInput.value = '';
                } else {
                    console.warn("Data channel buffer full, delaying message send.");
                    alert("Cannot send message right now, buffer full. Please wait.");
                }
            } catch (error) {
                console.error("Error sending message:", error);
                alert("Failed to send message.");
            }
        }
    };
    // Send message on Enter key, unless Shift is pressed
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Prevent newline in input
            sendMessageBtn.click();
        }
    });


    // --- Connected Actions (File Transfer - Chunking Logic) ---
    selectFileBtn.onclick = () => {
        if (fileToSend) { // Check if a file is already being sent
            alert("Please wait for the current file transfer to complete.");
            return;
        }
        fileInput.click(); // Trigger hidden file input
    };

    fileInput.onchange = () => {
        const files = fileInput.files;
        if (files && files.length > 0) {
            fileToSend = files[0];
            selectedFileNameElem.textContent = `${fileToSend.name} (${formatBytes(fileToSend.size)})`;
            sendFileBtn.disabled = false; // Enable send button
            fileStatusElem.textContent = 'Ready to send.';
        } else {
            // Reset if no file selected
            fileToSend = null;
            selectedFileNameElem.textContent = 'No file selected';
            sendFileBtn.disabled = true;
            fileStatusElem.textContent = '';
        }
        // Clear the input's value to allow selecting the same file again later
        fileInput.value = '';
    };

    sendFileBtn.onclick = () => {
        if (!fileToSend) return alert("No file selected.");
        if (!dataChannel || dataChannel.readyState !== 'open') return alert("Not connected.");

        console.log(`Starting send for: ${fileToSend.name} (${fileToSend.size} bytes)`);
        fileStatusElem.textContent = `Starting send: ${fileToSend.name}...`;
        sendFileBtn.disabled = true; // Disable during transfer
        selectFileBtn.disabled = true; // Disable selecting new file

        // 1. Send file metadata
        const fileInfo = {
            type: 'file-info',
            payload: { name: fileToSend.name, size: fileToSend.size, type: fileToSend.type || 'application/octet-stream' }
        };
        try {
            // Check buffer before sending metadata
            if (dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT) {
                dataChannel.send(JSON.stringify(fileInfo));
                console.log("Sent file info:", fileInfo.payload.name);
                currentChunk = 0;
                // Start sending chunks shortly after metadata
                setTimeout(startSendingChunks, 100);
            } else {
                throw new Error("Buffer full before sending file info");
            }
        } catch (error) {
            handleFileSendError(error);
        }
    };

    function startSendingChunks() {
        if (!fileToSend) return; // Guard against state changes
        fileReader = new FileReader();

        fileReader.onload = (event) => {
             if (!event.target || !event.target.result) return handleFileSendError(new Error("FileReader failed to load chunk."));
            try {
                if (dataChannel.readyState === 'open') {
                    sendChunk(event.target.result); // Send the loaded ArrayBuffer
                } else { throw new Error("Data channel closed during transfer."); }
            } catch (error) { handleFileSendError(error); }
        };
        fileReader.onerror = (errorEvent) => {
            handleFileSendError(new Error("FileReader error: " + (errorEvent.target?.error?.message || 'Unknown error')));
        };
        readNextChunk(); // Start reading the first chunk
    }

    function readNextChunk() {
        // Ensure reader is ready and file still selected
        if (!fileToSend || !fileReader || fileReader.readyState === FileReader.LOADING) return;

        const start = currentChunk * CHUNK_SIZE;
        if (start < fileToSend.size) {
            const end = Math.min(start + CHUNK_SIZE, fileToSend.size);
            const chunkBlob = fileToSend.slice(start, end);
            fileReader.readAsArrayBuffer(chunkBlob); // Read next chunk
        } else {
            // All chunks have been *read* by the FileReader
             // The completion logic is handled *after* the last chunk is successfully *sent* in sendChunk
            console.log("Finished reading all file chunks.");
        }
    }

    function sendChunk(chunkData) {
        if (!dataChannel || dataChannel.readyState !== 'open') {
            return handleFileSendError(new Error("Data channel not open for sending chunk."));
        }

        // Check buffer BEFORE trying to send
        if (dataChannel.bufferedAmount >= MAX_BUFFERED_AMOUNT) {
            console.warn(`Buffer full (${dataChannel.bufferedAmount}). Pausing send. Waiting for 'bufferedamountlow'.`);
            // Don't proceed. Wait for onbufferedamountlow event to trigger sendNextChunk.
            // Add a timeout fallback in case bufferedamountlow doesn't fire reliably.
            setTimeout(sendNextChunk, 500); // Retry processing queue after delay
            return;
        }

        try {
            dataChannel.send(chunkData); // Send the ArrayBuffer
            currentChunk++; // Increment chunk only after successful send (or queueing)
            const progress = fileToSend.size ? Math.min(100, Math.floor((currentChunk * CHUNK_SIZE / fileToSend.size) * 100)) : 100;
            fileStatusElem.textContent = `Sending ${fileToSend.name}: ${progress}%`;

            // Check if this was the last chunk based on byte position
            if (currentChunk * CHUNK_SIZE >= fileToSend.size) {
                console.log("All chunks sent for", fileToSend.name);
                fileStatusElem.textContent = `Sent: ${fileToSend.name}`;
                resetFileSendState(); // Clean up sender state
            } else {
                // Schedule reading the next chunk asynchronously
                // Check buffer before scheduling next read to avoid immediate pause
                 if (dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT * 0.8) {
                     setTimeout(readNextChunk, 0); // Yield to event loop, then read next
                 } else {
                     // Buffer getting high, rely on bufferedamountlow or timeout
                     setTimeout(readNextChunk, 100);
                 }
            }
        } catch (error) {
            handleFileSendError(error);
        }
    }

    // Helper to try processing the queue again, called by onbufferedamountlow or timeout
    function sendNextChunk() {
        if (fileToSend && fileReader && fileReader.readyState !== FileReader.LOADING && dataChannel.readyState === 'open') {
             // console.log("Retrying send/read cycle due to buffer low or timeout...");
             readNextChunk(); // Re-initiate the read -> onload -> send cycle
        }
    }

    function handleFileSendError(error) {
        console.error("Error during file send:", error);
        fileStatusElem.textContent = `Error sending ${fileToSend ? fileToSend.name : 'file'}: ${error.message}`;
        resetFileSendState(); // Reset buttons and state
    }

    function resetFileSendState() {
        if (fileReader) {
            fileReader.abort(); // Stop any ongoing read operation
            fileReader = null;
        }
        fileToSend = null;
        currentChunk = 0;
        if (selectedFileNameElem) selectedFileNameElem.textContent = 'No file selected';
        if (sendFileBtn) sendFileBtn.disabled = true; // Disable send until new file selected
        // Re-enable select button only if connected
        if (selectFileBtn) selectFileBtn.disabled = !connectionEstablished;
    }

    disconnectBtn.onclick = resetState;


    // --- Data Handling (Receiving File Chunks) ---
    function handleReceivedData(data) {
        try {
            if (typeof data === 'string') {
                const message = JSON.parse(data); // Expecting JSON for string messages
                if (message.type === 'text') {
                    displayMessage(message.payload, 'received');
                } else if (message.type === 'file-info') {
                    // Prepare to receive a file
                    receivingFileInfo = message.payload;
                    receivedFileChunks = [];
                    receivedFileSize = 0;
                    console.log("Receiving file info:", receivingFileInfo);
                    fileStatusElem.textContent = `Receiving: ${receivingFileInfo.name} (0%)`;
                } else {
                    console.warn("Received unknown string message type:", message.type);
                }
            } else if (data instanceof ArrayBuffer) {
                // Received a binary file chunk
                if (receivingFileInfo) {
                    receivedFileChunks.push(data);
                    receivedFileSize += data.byteLength;
                    const progress = receivingFileInfo.size ? Math.min(100, Math.floor((receivedFileSize / receivingFileInfo.size) * 100)) : 0;
                    fileStatusElem.textContent = `Receiving ${receivingFileInfo.name}: ${progress}%`;

                    // Check if file is complete
                    if (receivedFileSize === receivingFileInfo.size) {
                        console.log("File fully received:", receivingFileInfo.name);
                        const fileBlob = new Blob(receivedFileChunks, { type: receivingFileInfo.type });
                        displayReceivedFile(fileBlob, receivingFileInfo.name);
                        // Reset for next file
                        receivingFileInfo = null; receivedFileChunks = []; receivedFileSize = 0;
                    } else if (receivedFileSize > receivingFileInfo.size && receivingFileInfo.size > 0) {
                        // Error case: received too much data
                        console.error("Received more data than expected for file!");
                        fileStatusElem.textContent = `Error receiving ${receivingFileInfo.name}: Size mismatch.`;
                        // Reset state
                        receivingFileInfo = null; receivedFileChunks = []; receivedFileSize = 0;
                    }
                     // Handle zero-byte file case (where receivedSize starts and stays 0)
                    else if (receivingFileInfo.size === 0 && receivedFileSize === 0) {
                         // Check if this is the first (and only) chunk for a 0-byte file
                         // This needs a way to signal completion from sender for 0-byte files reliably.
                         // Let's assume the sender still sends the file-info and maybe *no* ArrayBuffer chunks.
                         // We need a separate completion signal or check if size is 0 in file-info.
                         // For now, the current logic only completes when receivedFileSize === receivingFileInfo.size
                         // A zero-byte file will thus only complete if the sender explicitly sends a 0-byte ArrayBuffer chunk?
                         // Let's refine the completion check:
                         if (receivingFileInfo.size === 0) { // If expecting 0 bytes, complete immediately after info?
                              console.log("Zero-byte file received (based on info):", receivingFileInfo.name);
                              const fileBlob = new Blob([], { type: receivingFileInfo.type });
                              displayReceivedFile(fileBlob, receivingFileInfo.name);
                              receivingFileInfo = null; receivedFileChunks = []; receivedFileSize = 0; // Reset
                         }
                    }


                } else {
                    console.warn("Received ArrayBuffer data but no file info was active. Ignoring.");
                }
            } else {
                console.warn("Received unexpected data type:", typeof data);
            }
        } catch (error) {
            console.error("Error processing received data:", error);
            // Attempt to log problematic data if small and stringifiable
            try {
                if (typeof data === 'string' && data.length < 200) console.error("Data was:", data);
            } catch { /* ignore logging error */ }
        }
    }


    // --- UI Display Functions ---
    function displayMessage(message, type) { // type = 'sent' or 'received'
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${type}`; // Use classes for styling
        msgDiv.textContent = message;
        messagesDiv.appendChild(msgDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight; // Scroll to bottom
    }

    function displayReceivedFile(fileBlob, fileName) {
        const downloadLink = document.createElement('a');
        const objectURL = URL.createObjectURL(fileBlob);
        downloadLink.href = objectURL;
        downloadLink.download = fileName;
        downloadLink.textContent = `Download ${fileName} (${formatBytes(fileBlob.size)})`;
        downloadLink.style.display = 'block';
        downloadLink.style.marginTop = '10px';
        downloadLink.style.fontWeight = 'bold';

        // Clear previous status and append link
        fileStatusElem.innerHTML = 'Received: ';
        fileStatusElem.appendChild(downloadLink);

        // Clean up the Object URL after click (with delay)
        downloadLink.addEventListener('click', () => {
            setTimeout(() => {
                URL.revokeObjectURL(objectURL);
                console.log("Revoked Object URL for", fileName);
            }, 1500); // Delay to ensure download starts
        }, { once: true }); // Remove listener after first click
    }

    // Helper to format file sizes
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        // Ensure i is within the bounds of the sizes array
        const index = Math.min(i, sizes.length - 1);
        return parseFloat((bytes / Math.pow(k, index)).toFixed(dm)) + ' ' + sizes[index];
    }


    // --- Utility Functions ---
    copyOfferBtn.onclick = () => {
        if (!offerCodeText.value) return;
        navigator.clipboard.writeText(offerCodeText.value)
            .then(() => alert('Offer Code copied!'))
            .catch(err => { console.error('Failed to copy offer:', err); alert('Copy failed.'); });
    };

    copyAnswerBtn.onclick = () => {
        if (!answerCodeText.value) return;
        navigator.clipboard.writeText(answerCodeText.value)
            .then(() => alert('Answer Code copied!'))
            .catch(err => { console.error('Failed to copy answer:', err); alert('Copy failed.'); });
    };


    // --- Initial Setup ---
    resetState(); // Initialize state variables and UI on load
    showScreen('initial'); // Show the first screen

}); // End DOMContentLoaded