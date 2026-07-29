const { Server } = require('modesl');
const WebSocket = require('ws');
const express = require('express');
 

// ---------------------------------------------------------
// 0. Web Server (Serves the WebRTC SIP UI)
// ---------------------------------------------------------
const HTTP_PORT = 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.listen(HTTP_PORT, () => {
    console.log(`[HTTP] Web UI listening on http://localhost:${HTTP_PORT}`);
});

// ---------------------------------------------------------
// 1. WebSocket Server (Receives Audio from FreeSWITCH)
// ---------------------------------------------------------
const WS_PORT = 8080;
const fs = require('fs');
const wav = require('wav');

const wss = new WebSocket.Server({ host: '0.0.0.0', port: WS_PORT }, () => {
    console.log(`[WS] WebSocket Audio Receiver listening on ws://0.0.0.0:${WS_PORT}`);
});

wss.on('connection', (ws) => {
    console.log('[WS] New audio stream connected from FreeSWITCH!');
    let pktCount = 0;
    
    // Create a new wav writer for this stream
    const filename = `recording_${Date.now()}.wav`;
    const filepath = path.join(__dirname, 'public', filename);
    const writer = new wav.FileWriter(filepath, {
        channels: 1,
        sampleRate: 8000,
        bitDepth: 16
    });
    console.log(`[WS] Saving audio stream to ${filepath}`);
    
    ws.on('message', (message) => {
        // The message is raw PCM binary data from FreeSWITCH
        pktCount++;
        writer.write(message);
        
        // Print progress every 100 packets to avoid spamming the console
        if (pktCount % 100 === 0) {
            console.log(`[WS] Received 100 audio packets (total: ${pktCount}). Saved to wav.`);
        }
    });

    ws.on('close', () => {
        console.log(`[WS] Audio stream closed. File saved to: ${filename}`);
        writer.end();
    });
});

// ---------------------------------------------------------
// 2. Outbound ESL Server (Controls the Call)
// ---------------------------------------------------------
const ESL_PORT = 8085;
const eslServer = new Server({ host: '0.0.0.0', port: ESL_PORT, myevents: true }, () => {
    console.log(`[ESL] Outbound ESL Call Control listening on port ${ESL_PORT}`);
});

eslServer.on('connection::ready', (conn, id) => {
    const uuid = conn.getInfo().getHeader('Channel-Call-UUID');
    console.log(`[ESL] New call received! UUID: ${uuid}`);
    
    conn.on('esl::end', () => {
        console.log(`[ESL] Call ended (UUID: ${uuid})`);
    });

    // 1. Answer the incoming call
    conn.execute('answer', '', () => {
        console.log(`[ESL] Call answered. Starting audio_stream...`);
        
        // 2. Start streaming the caller's audio to our WebSocket server
        // "node-app" is the docker compose service name so they can reach each other seamlessly!
        const wsUrl = `ws://node-app:${WS_PORT}/stream`;
        
        // Command syntax: uuid_audio_stream <uuid> start <ws_url> [mono|stereo] [8000|16000|32000|48000] [mix|read|write]
        conn.api(`uuid_audio_stream ${uuid} start ${wsUrl} mono 8000 read`, (res) => {
            console.log(`[ESL] uuid_audio_stream response: ${res.getBody()}`);
            
            // 3. Play an automated AI TTS greeting!
            console.log(`[ESL] Playing AI greeting to the caller...`);
            conn.execute('speak', 'tts_commandline|en_US-amy-medium|Hello, welcome to the AI automated IVR. Please start speaking and your audio will be streamed.');
        });
    });
});
