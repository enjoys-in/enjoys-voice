#!/bin/bash

set -e

echo "============================================"
echo "Drachtio WebRTC Platform Deployment"
echo "Complete SIP + RTP + IVR Stack"
echo "============================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root or with sudo${NC}"
    exit 1
fi

# Get domain
read -p "Enter your domain (e.g., sip.example.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Domain is required${NC}"
    exit 1
fi

# Get public IP
PUBLIC_IP=$(curl -s ifconfig.me)
echo -e "${BLUE}Detected public IP: ${PUBLIC_IP}${NC}"
read -p "Is this correct? (y/n): " confirm
if [ "$confirm" != "y" ]; then
    read -p "Enter your public IP: " PUBLIC_IP
fi

# Get email for SSL
read -p "Enter your email for SSL certificate: " EMAIL
if [ -z "$EMAIL" ]; then
    echo -e "${RED}Email is required${NC}"
    exit 1
fi

# SIP Trunk Configuration (optional)
echo -e "${YELLOW}Do you want to configure a SIP trunk for PSTN calling? (y/n)${NC}"
read -p "> " configure_trunk

if [ "$configure_trunk" = "y" ]; then
    read -p "SIP Trunk Host (e.g., sip.twilio.com): " SIP_TRUNK_HOST
    read -p "SIP Trunk Username: " SIP_TRUNK_USER
    read -sp "SIP Trunk Password: " SIP_TRUNK_PASSWORD
    echo ""
else
    SIP_TRUNK_HOST="sip.example.com"
    SIP_TRUNK_USER="username"
    SIP_TRUNK_PASSWORD="password"
fi

# Generate secrets
DRACHTIO_SECRET=$(openssl rand -hex 16)
FREESWITCH_SECRET=$(openssl rand -hex 16)
APP_SECRET=$(openssl rand -hex 32)

echo -e "${GREEN}Generated secure secrets${NC}"

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
apt-get update
apt-get install -y docker.io docker-compose certbot git curl

# Start Docker service
systemctl start docker
systemctl enable docker

# Create project directory
PROJECT_DIR="/opt/drachtio-webrtc"
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

# Create directory structure
mkdir -p drachtio freeswitch/conf freeswitch/sounds freeswitch/recordings \
         rtpengine ssl app logs

# Create .env file
cat > .env <<EOF
DOMAIN=$DOMAIN
PUBLIC_IP=$PUBLIC_IP
DRACHTIO_SECRET=$DRACHTIO_SECRET
FREESWITCH_SECRET=$FREESWITCH_SECRET
APP_SECRET=$APP_SECRET
SIP_TRUNK_HOST=$SIP_TRUNK_HOST
SIP_TRUNK_USER=$SIP_TRUNK_USER
SIP_TRUNK_PASSWORD=$SIP_TRUNK_PASSWORD
EOF

# Generate SSL certificate
echo -e "${YELLOW}Generating SSL certificate...${NC}"
systemctl stop docker 2>/dev/null || true
certbot certonly --standalone -d $DOMAIN --email $EMAIL --agree-tos --non-interactive

# Copy SSL certificates
mkdir -p ssl/$DOMAIN
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem ssl/$DOMAIN/
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem ssl/$DOMAIN/
cp /etc/letsencrypt/live/$DOMAIN/chain.pem ssl/$DOMAIN/

# Create Drachtio configuration
cat > drachtio/drachtio.conf.xml <<DRACHTIOCONF
<drachtio>
  <admin port="9022" secret="$DRACHTIO_SECRET">127.0.0.1</admin>
  
  <sip>
    <contacts>
      <contact external-ip="$PUBLIC_IP">sip:*:5060;transport=udp</contact>
      <contact external-ip="$PUBLIC_IP">sips:*:8443;transport=wss</contact>
    </contacts>
    
    <tls>
      <key-file>/etc/letsencrypt/live/$DOMAIN/privkey.pem</key-file>
      <cert-file>/etc/letsencrypt/live/$DOMAIN/fullchain.pem</cert-file>
      <chain-file>/etc/letsencrypt/live/$DOMAIN/chain.pem</chain-file>
    </tls>
    
    <timers>
      <t1>500</t1>
      <t2>4000</t2>
      <t4>5000</t4>
    </timers>
    
    <spammers action="reject" tcp-action="discard">
      <header name="User-Agent">
        <value>sip-cli</value>
        <value>sipcli</value>
        <value>friendly-scanner</value>
        <value>sipvicious</value>
      </header>
    </spammers>
  </sip>
  
  <logging>
    <sofia-loglevel>3</sofia-loglevel>
    <loglevel>info</loglevel>
  </logging>
</drachtio>
DRACHTIOCONF

# Create docker-compose.yml
cat > docker-compose.yml <<'DOCKERCOMPOSE'
version: '3.8'

services:
  drachtio:
    image: drachtio/drachtio-server:latest
    container_name: drachtio-server
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./drachtio/drachtio.conf.xml:/etc/drachtio.conf.xml
      - ./ssl:/etc/letsencrypt/live/${DOMAIN}
    environment:
      - DRACHTIO_LOGLEVEL=info
      - SOFIA_LOGLEVEL=3

  rtpengine:
    image: drachtio/rtpengine:latest
    container_name: rtpengine
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./rtpengine:/etc/rtpengine
    environment:
      - INTERFACES=public/${PUBLIC_IP}
    command: >
      rtpengine
      --interface=public/${PUBLIC_IP}
      --listen-ng=127.0.0.1:22222
      --port-min=10000
      --port-max=20000
      --log-level=6
    cap_add:
      - NET_ADMIN

  freeswitch:
    image: drachtio/drachtio-freeswitch-mrf:latest
    container_name: freeswitch
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./freeswitch/conf:/usr/local/freeswitch/conf
      - ./freeswitch/sounds:/usr/local/freeswitch/sounds
      - ./freeswitch/recordings:/usr/local/freeswitch/recordings

  app:
    build: ./app
    container_name: webrtc-app
    restart: unless-stopped
    network_mode: host
    depends_on:
      - drachtio
      - rtpengine
      - freeswitch
    volumes:
      - ./app:/app
      - /app/node_modules
    environment:
      - DRACHTIO_HOST=127.0.0.1
      - DRACHTIO_PORT=9022
      - DRACHTIO_SECRET=${DRACHTIO_SECRET}
      - RTPENGINE_HOST=127.0.0.1
      - RTPENGINE_PORT=22222
      - FREESWITCH_HOST=127.0.0.1
      - FREESWITCH_PORT=8021
      - FREESWITCH_SECRET=${FREESWITCH_SECRET}
      - DOMAIN=${DOMAIN}
      - PUBLIC_IP=${PUBLIC_IP}
      - SIP_TRUNK_HOST=${SIP_TRUNK_HOST}
      - SIP_TRUNK_USER=${SIP_TRUNK_USER}
      - SIP_TRUNK_PASSWORD=${SIP_TRUNK_PASSWORD}
    command: npm start

  redis:
    image: redis:alpine
    container_name: redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

volumes:
  redis-data:
DOCKERCOMPOSE

# Create Application Dockerfile
mkdir -p app
cat > app/Dockerfile <<'APPDOCKERFILE'
FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
APPDOCKERFILE

# Create package.json
cat > app/package.json <<'PACKAGEJSON'
{
  "name": "drachtio-webrtc-app",
  "version": "1.0.0",
  "description": "Drachtio WebRTC Platform",
  "main": "app.js",
  "scripts": {
    "start": "node app.js"
  },
  "dependencies": {
    "drachtio-srf": "^4.5.0",
    "rtpengine-client": "^0.3.0",
    "drachtio-fsmrf": "^1.3.0",
    "express": "^4.18.2",
    "redis": "^4.6.5",
    "ws": "^8.13.0",
    "uuid": "^9.0.0",
    "debug": "^4.3.4"
  }
}
PACKAGEJSON

# Create main application
cat > app/app.js <<'APPJS'
const Srf = require('drachtio-srf');
const srf = new Srf();
const Mrf = require('drachtio-fsmrf');
const mrf = new Mrf(srf);
const rtpengine = require('rtpengine-client');
const express = require('express');
const redis = require('redis');
const { v4: uuidv4 } = require('uuid');

const config = {
  drachtio: {
    host: process.env.DRACHTIO_HOST || '127.0.0.1',
    port: process.env.DRACHTIO_PORT || 9022,
    secret: process.env.DRACHTIO_SECRET
  },
  rtpengine: {
    host: process.env.RTPENGINE_HOST || '127.0.0.1',
    port: process.env.RTPENGINE_PORT || 22222
  },
  freeswitch: {
    host: process.env.FREESWITCH_HOST || '127.0.0.1',
    port: process.env.FREESWITCH_PORT || 8021,
    secret: process.env.FREESWITCH_SECRET
  },
  domain: process.env.DOMAIN,
  publicIp: process.env.PUBLIC_IP,
  trunk: {
    host: process.env.SIP_TRUNK_HOST,
    user: process.env.SIP_TRUNK_USER,
    password: process.env.SIP_TRUNK_PASSWORD
  }
};

// Initialize Redis client
const redisClient = redis.createClient({
  url: 'redis://127.0.0.1:6379'
});
redisClient.connect();

// Initialize RTPEngine client
const rtpClient = rtpengine.Client(config.rtpengine);

// Store active calls
const activeCalls = new Map();
const registeredUsers = new Map();

// Connect to Drachtio
srf.connect(config.drachtio);

srf.on('connect', (err, hostport) => {
  console.log(`Connected to Drachtio at ${hostport}`);
});

srf.on('error', (err) => {
  console.error('Drachtio connection error:', err);
});

// Connect to FreeSWITCH for media
mrf.connect({
  address: config.freeswitch.host,
  port: config.freeswitch.port,
  secret: config.freeswitch.secret
}).then((ms) => {
  console.log('Connected to FreeSWITCH media server');
  return ms;
}).catch((err) => {
  console.error('Failed to connect to FreeSWITCH:', err);
});

// Handle REGISTER requests
srf.register((req, res) => {
  console.log('REGISTER request from:', req.get('From'));
  
  const from = req.getParsedHeader('From');
  const contact = req.getParsedHeader('Contact');
  const expires = req.get('Expires') || 3600;
  
  const username = from.uri.match(/sip:([^@]+)@/)[1];
  
  // Store registration
  registeredUsers.set(username, {
    contact: contact.uri,
    expires: parseInt(expires),
    registered: Date.now()
  });
  
  // Save to Redis
  redisClient.setEx(`reg:${username}`, parseInt(expires), JSON.stringify({
    contact: contact.uri,
    expires: parseInt(expires)
  }));
  
  res.send(200, {
    headers: {
      'Contact': contact.uri,
      'Expires': expires
    }
  });
  
  console.log(`User ${username} registered successfully`);
});

// Handle INVITE requests (incoming calls)
srf.invite(async (req, res) => {
  try {
    console.log('INVITE request from:', req.get('From'));
    console.log('Request URI:', req.uri);
    
    const from = req.getParsedHeader('From');
    const to = req.getParsedHeader('To');
    const callId = req.get('Call-ID');
    
    // Extract caller and callee
    const caller = from.uri.match(/sip:([^@]+)@/)[1];
    const callee = req.uri.match(/sip:([^@]+)@/)[1];
    
    console.log(`Call from ${caller} to ${callee}`);
    
    // Check if it's a WebRTC call (from browser)
    const isWebRTC = req.protocol === 'wss' || req.source.includes('wss');
    
    // Allocate RTPEngine for media proxy
    const rtpOffer = await rtpClient.offer({
      'call-id': callId,
      'from-tag': from.params.tag,
      'sdp': req.body,
      'ICE': isWebRTC ? 'force' : 'remove',
      'DTLS': isWebRTC ? 'passive' : 'off',
      'transport-protocol': isWebRTC ? 'RTP/SAVPF' : 'RTP/AVP',
      'rtcp-mux': isWebRTC ? ['offer'] : []
    });
    
    console.log('RTPEngine offer allocated');
    
    // Check if calling a mobile number (starts with +)
    if (callee.startsWith('+') || /^\d{10,}$/.test(callee)) {
      // Route to SIP trunk for PSTN
      console.log(`Routing to PSTN: ${callee}`);
      
      const trunkUri = `sip:${callee}@${config.trunk.host}`;
      
      srf.createB2BUA(req, res, trunkUri, {
        localSdpB: rtpOffer.sdp,
        localSdpA: async (sdp, res) => {
          const rtpAnswer = await rtpClient.answer({
            'call-id': callId,
            'from-tag': from.params.tag,
            'to-tag': res.getParsedHeader('To').params.tag,
            'sdp': sdp,
            'ICE': 'remove',
            'transport-protocol': 'RTP/AVP'
          });
          return rtpAnswer.sdp;
        },
        headers: {
          'From': `sip:${caller}@${config.domain}`,
          'User-Agent': 'Drachtio WebRTC Platform'
        },
        auth: {
          username: config.trunk.user,
          password: config.trunk.password
        }
      }, (err, {uas, uac}) => {
        if (err) {
          console.error('Error creating B2BUA:', err);
          return;
        }
        
        console.log('Call connected to PSTN');
        
        // Store active call
        activeCalls.set(callId, {
          uas, uac,
          caller, callee,
          startTime: Date.now()
        });
        
        // Handle call termination
        [uas, uac].forEach(dlg => {
          dlg.on('destroy', () => {
            console.log('Call ended:', callId);
            rtpClient.delete({'call-id': callId});
            activeCalls.delete(callId);
          });
        });
      });
    } else {
      // Internal call to another registered user
      const targetUser = registeredUsers.get(callee);
      
      if (!targetUser) {
        console.log(`User ${callee} not found or not registered`);
        return res.send(404, 'User Not Found');
      }
      
      console.log(`Routing internal call to ${callee}`);
      
      srf.createB2BUA(req, res, targetUser.contact, {
        localSdpB: rtpOffer.sdp,
        localSdpA: async (sdp, res) => {
          const rtpAnswer = await rtpClient.answer({
            'call-id': callId,
            'from-tag': from.params.tag,
            'to-tag': res.getParsedHeader('To').params.tag,
            'sdp': sdp,
            'ICE': isWebRTC ? 'force' : 'remove',
            'DTLS': isWebRTC ? 'passive' : 'off',
            'transport-protocol': isWebRTC ? 'RTP/SAVPF' : 'RTP/AVP'
          });
          return rtpAnswer.sdp;
        }
      }, (err, {uas, uac}) => {
        if (err) {
          console.error('Error creating B2BUA:', err);
          return;
        }
        
        console.log('Internal call connected');
        
        activeCalls.set(callId, {
          uas, uac,
          caller, callee,
          startTime: Date.now()
        });
        
        [uas, uac].forEach(dlg => {
          dlg.on('destroy', () => {
            console.log('Call ended:', callId);
            rtpClient.delete({'call-id': callId});
            activeCalls.delete(callId);
          });
        });
      });
    }
  } catch (err) {
    console.error('Error handling INVITE:', err);
    res.send(500, 'Server Error');
  }
});

// HTTP API for monitoring
const app = express();
app.use(express.json());

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    activeCalls: activeCalls.size,
    registeredUsers: registeredUsers.size
  });
});

app.get('/calls', (req, res) => {
  const calls = Array.from(activeCalls.values()).map(call => ({
    caller: call.caller,
    callee: call.callee,
    duration: Math.floor((Date.now() - call.startTime) / 1000)
  }));
  res.json(calls);
});

app.get('/users', (req, res) => {
  const users = Array.from(registeredUsers.entries()).map(([username, data]) => ({
    username,
    contact: data.contact,
    expires: data.expires
  }));
  res.json(users);
});

app.listen(3000, () => {
  console.log('HTTP API listening on port 3000');
});

console.log('Drachtio WebRTC Application started');
console.log('Domain:', config.domain);
console.log('Public IP:', config.publicIp);
APPJS

# Create web client
cat > app/public/index.html <<'WEBCLIENT'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Drachtio WebRTC Phone</title>
    <script src="https://cdn.jsdelivr.net/npm/jssip@3.10.0/dist/jssip.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 40px;
            max-width: 500px;
            width: 100%;
        }
        h1 {
            color: #667eea;
            margin-bottom: 10px;
            font-size: 28px;
        }
        .subtitle {
            color: #999;
            margin-bottom: 30px;
            font-size: 14px;
        }
        .status {
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 14px;
            font-weight: 500;
        }
        .status.offline { background: #fee; color: #c33; }
        .status.online { background: #efe; color: #3c3; }
        .status.calling { background: #ffc; color: #cc6; }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 500;
            font-size: 14px;
        }
        input {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            transition: border 0.3s;
        }
        input:focus {
            outline: none;
            border-color: #667eea;
        }
        button {
            width: 100%;
            padding: 14px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            margin-bottom: 10px;
        }
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(102,126,234,0.3); }
        .btn-success {
            background: #4CAF50;
            color: white;
        }
        .btn-success:hover { background: #45a049; }
        .btn-danger {
            background: #f44336;
            color: white;
        }
        .btn-danger:hover { background: #da190b; }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
        }
        .help-text {
            font-size: 12px;
            color: #999;
            margin-top: 5px;
        }
        audio { display: none; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📞 WebRTC Phone</h1>
        <p class="subtitle">Powered by Drachtio</p>
        
        <div id="status" class="status offline">● Offline</div>
        
        <div class="form-group">
            <label>Username</label>
            <input type="text" id="username" placeholder="your_username" value="user1">
        </div>
        
        <div class="form-group">
            <label>Password</label>
            <input type="password" id="password" placeholder="your_password" value="password123">
        </div>
        
        <div class="form-group">
            <label>SIP Server</label>
            <input type="text" id="domain" placeholder="sip.example.com" value="">
            <div class="help-text">WebSocket URI will be: wss://domain:8443</div>
        </div>
        
        <button id="register" class="btn-primary">Connect</button>
        <button id="unregister" class="btn-danger" disabled>Disconnect</button>
        
        <div class="form-group" style="margin-top: 30px;">
            <label>Call To</label>
            <input type="text" id="callNumber" placeholder="user2 or +1234567890">
            <div class="help-text">Enter username or phone number with country code</div>
        </div>
        
        <button id="call" class="btn-success" disabled>📞 Call</button>
        <button id="hangup" class="btn-danger" disabled>End Call</button>
        
        <audio id="remoteAudio" autoplay></audio>
        <audio id="localAudio" muted autoplay></audio>
    </div>

    <script>
        let phone, session;
        
        const status = document.getElementById('status');
        const registerBtn = document.getElementById('register');
        const unregisterBtn = document.getElementById('unregister');
        const callBtn = document.getElementById('call');
        const hangupBtn = document.getElementById('hangup');
        
        function updateStatus(msg, className) {
            status.textContent = '● ' + msg;
            status.className = 'status ' + className;
        }
        
        registerBtn.onclick = () => {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const domain = document.getElementById('domain').value;
            
            if (!username || !password || !domain) {
                alert('Please fill all fields');
                return;
            }
            
            const socket = new JsSIP.WebSocketInterface(`wss://${domain}:8443`);
            
            const configuration = {
                sockets: [socket],
                uri: `sip:${username}@${domain}`,
                password: password,
                display_name: username,
                register: true,
                session_timers: false
            };
            
            phone = new JsSIP.UA(configuration);
            
            phone.on('connected', () => {
                updateStatus('Connected', 'online');
            });
            
            phone.on('registered', () => {
                updateStatus('Registered - Ready to call', 'online');
                registerBtn.disabled = true;
                unregisterBtn.disabled = false;
                callBtn.disabled = false;
            });
            
            phone.on('registrationFailed', (e) => {
                updateStatus('Registration Failed: ' + e.cause, 'offline');
            });
            
            phone.on('newRTCSession', (e) => {
                session = e.session;
                
                if (session.direction === 'incoming') {
                    updateStatus('Incoming call...', 'calling');
                    
                    session.on('accepted', () => {
                        updateStatus('Call connected', 'online');
                        const stream = new MediaStream();
                        const receivers = session.connection.getReceivers();
                        receivers.forEach(receiver => {
                            stream.addTrack(receiver.track);
                        });
                        document.getElementById('remoteAudio').srcObject = stream;
                        callBtn.disabled = true;
                        hangupBtn.disabled = false;
                    });
                    
                    session.answer({
                        mediaConstraints: { audio: true, video: false }
                    });
                }
                
                session.on('ended', () => {
                    updateStatus('Call ended', 'online');
                    callBtn.disabled = false;
                    hangupBtn.disabled = true;
                });
                
                session.on('failed', () => {
                    updateStatus('Call failed', 'online');
                    callBtn.disabled = false;
                    hangupBtn.disabled = true;
                });
            });
            
            phone.start();
            updateStatus('Connecting...', 'calling');
        };
        
        unregisterBtn.onclick = () => {
            if (phone) {
                phone.stop();
                updateStatus('Disconnected', 'offline');
                registerBtn.disabled = false;
                unregisterBtn.disabled = true;
                callBtn.disabled = true;
            }
        };
        
        callBtn.onclick = () => {
            const number = document.getElementById('callNumber').value;
            const domain = document.getElementById('domain').value;
            
            if (!number) {
                alert('Please enter a number to call');
                return;
            }
            
            const eventHandlers = {
                'progress': () => {
                    updateStatus('Calling...', 'calling');
                },
                'accepted': () => {
                    updateStatus('Call connected', 'online');
                    callBtn.disabled = true;
                    hangupBtn.disabled = false;
                },
                'ended': () => {
                    updateStatus('Call ended', 'online');
                    callBtn.disabled = false;
                    hangupBtn.disabled = true;
                },
                'failed': () => {
                    updateStatus('Call failed', 'online');
                    callBtn.disabled = false;
                    hangupBtn.disabled = true;
                }
            };
            
            const options = {
                eventHandlers: eventHandlers,
                mediaConstraints: { audio: true, video: false }
            };
            
            session = phone.call(`sip:${number}@${domain}`, options);
            
            session.connection.addEventListener('addstream', (e) => {
                document.getElementById('remoteAudio').srcObject = e.stream;
            });
        };
        
        hangupBtn.onclick = () => {
            if (session) {
                session.terminate();
            }
        };
    </script>
</body>
</html>
WEBCLIENT

# Configure firewall
echo -e "${YELLOW}Configuring firewall...${NC}"
ufw allow 5060/udp     # SIP
ufw allow 8443/tcp     # WSS (WebRTC)
ufw allow 10000:20000/udp  # RTP
ufw allow 80/tcp       # HTTP
ufw allow 443/tcp      # HTTPS
ufw allow 3000/tcp     # API
ufw allow 5080/tcp     # FreeSWITCH SIP
ufw allow 8021/tcp     # FreeSWITCH Event Socket
ufw allow 16384:32768/udp  # FreeSWITCH RTP

# Build and start
echo -e "${YELLOW}Building Docker images (this may take 10-15 minutes)...${NC}"
docker-compose build

echo -e "${YELLOW}Starting all services...${NC}"
docker-compose up -d

# Wait for services to start
echo -e "${YELLOW}Waiting for services to initialize...${NC}"
sleep 10

# Create credentials file
cat > $PROJECT_DIR/CREDENTIALS.txt <<CREDS
============================================
Drachtio WebRTC Platform - Credentials
============================================

Domain: $DOMAIN
Public IP: $PUBLIC_IP

WebRTC Client: https://$DOMAIN/
API Endpoint: http://$DOMAIN:3000

=== Drachtio Server ===
Host: 127.0.0.1
Port: 9022
Secret: $DRACHTIO_SECRET

=== FreeSWITCH ===
Host: 127.0.0.1
Port: 8021
Secret: $FREESWITCH_SECRET

=== SIP Trunk (PSTN) ===
Host: $SIP_TRUNK_HOST
Username: $SIP_TRUNK_USER
Password: $SIP_TRUNK_PASSWORD

=== Test Users ===
Create users in your application or use:
Username: user1
Password: password123

Username: user2
Password: password123

=== Usage Examples ===

1. Browser to Browser Call:
   - User1 registers as 'user1'
   - User2 registers as 'user2'
   - User1 calls 'user2'

2. Browser to Mobile:
   - User registers in browser
   - Calls: +1234567890 (with country code)
   - Routes through SIP trunk to PSTN

3. Mobile to Browser:
   - Configure your SIP trunk to route incoming calls to your domain
   - Calls will be routed to registered users

=== Docker Commands ===
View logs:
  docker-compose logs -f
  docker-compose logs -f drachtio
  docker-compose logs -f app

Restart services:
  docker-compose restart

Stop services:
  docker-compose down

Start services:
  docker-compose up -d

Access Drachtio CLI:
  docker exec -it drachtio-server drachtio-client -h 127.0.0.1 -P 9022 -s $DRACHTIO_SECRET

=== API Endpoints ===
Status: http://$DOMAIN:3000/status
Active Calls: http://$DOMAIN:3000/calls
Registered Users: http://$DOMAIN:3000/users

=== Monitoring ===
Drachtio logs: docker-compose logs -f drachtio
App logs: docker-compose logs -f app
RTPEngine logs: docker-compose logs -f rtpengine
FreeSWITCH logs: docker-compose logs -f freeswitch

=== Troubleshooting ===
1. Check if all containers are running:
   docker-compose ps

2. Test WebSocket connection:
   openssl s_client -connect $DOMAIN:8443

3. Check registration:
   curl http://$DOMAIN:3000/users

4. View active calls:
   curl http://$DOMAIN:3000/calls

============================================
CREDS

echo ""
echo -e "${GREEN}============================================"
echo "✅ Deployment completed successfully!"
echo "============================================${NC}"
echo ""
cat $PROJECT_DIR/CREDENTIALS.txt
echo ""
echo -e "${YELLOW}Important:${NC}"
echo "1. Web client HTML is in: $PROJECT_DIR/app/public/index.html"
echo "2. Copy it to your web server or access via API server"
echo "3. Configure your SIP trunk provider to route calls to $DOMAIN"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "1. Open web client: https://$DOMAIN/"
echo "2. Register with username/password"
echo "3. Start making calls!"
echo ""
echo -e "${GREEN}Credentials saved to: $PROJECT_DIR/CREDENTIALS.txt${NC}"