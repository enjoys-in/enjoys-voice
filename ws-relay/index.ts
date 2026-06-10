import dgram from 'dgram'
import WebSocket, { WebSocketServer } from 'ws'
import config from './config.js'

// UDP client to send SIP packets
const udpSocket = dgram.createSocket('udp4')

// WebSocket server for browsers
const wss = new WebSocketServer({ port: config.websocketPort })

console.log(`🛰️  WebSocket server running on ws://localhost:${config.websocketPort}`)

wss.on('connection', (ws) => {
    console.log('✅ WebSocket client connected')

    ws.on('message', (message: Buffer) => {
        console.log('✅ Message Received from WebSocket:')
        udpSocket.send(message, config.sip.port, config.sip.host, (err,bytes) => {
            if (err) console.error('❌ Error sending SIP:', err)
                console.log("📤 SIP message sent to SIP server")
        })
    })
})

// Listen to responses from SIP server
udpSocket.on('message', (msg, rinfo) => {
    console.log(`📩 SIP Response from ${rinfo.address}:${rinfo.port}`)

    // Broadcast to all connected WebSocket clients
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg)
        }
    })
})
