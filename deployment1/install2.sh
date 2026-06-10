#!/bin/bash
# 
# Drachtio WebRTC Platform - One-Click Deployment
# Includes: Drachtio + RTPEngine + FreeSWITCH + Node.js App
# 
# Usage: sudo bash install.sh
#

set -e

echo "╔════════════════════════════════════════════╗"
echo "║  Drachtio WebRTC Platform Installer       ║"
echo "║  Complete SIP + RTP + IVR Solution        ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# Check root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run as root: sudo bash install.sh"
    exit 1
fi

# Get configuration
echo "📋 Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -p "Domain (e.g., sip.example.com): " DOMAIN
read -p "Email for SSL: " EMAIL
PUBLIC_IP=$(curl -s ifconfig.me)
echo "Detected IP: $PUBLIC_IP"
read -p "Is this correct? (y/n): " ip_confirm
if [ "$ip_confirm" != "y" ]; then
    read -p "Enter your public IP: " PUBLIC_IP
fi

echo ""
read -p "Configure SIP Trunk for PSTN? (y/n): " trunk_config
if [ "$trunk_config" = "y" ]; then
    read -p "SIP Trunk Host: " SIP_TRUNK_HOST
    read -p "SIP Trunk User: " SIP_TRUNK_USER
    read -sp "SIP Trunk Password: " SIP_TRUNK_PASSWORD
    echo ""
else
    SIP_TRUNK_HOST="sip.provider.com"
    SIP_TRUNK_USER="user"
    SIP_TRUNK_PASSWORD="pass"
fi

# Generate secrets
DRACHTIO_SECRET=$(openssl rand -hex 16)
FREESWITCH_SECRET=$(openssl rand -hex 16)

echo ""
echo "🚀 Starting installation..."
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
apt-get update -qq
apt-get install -y docker.io docker-compose certbot git curl python3 jq > /dev/null 2>&1

systemctl start docker
systemctl enable docker

# Setup project
PROJECT_DIR="/opt/drachtio-webrtc"
mkdir -p $PROJECT_DIR/{drachtio,freeswitch/{conf,sounds,recordings},rtpengine,ssl,app/{public},logs}
cd $PROJECT_DIR

echo "✓ Project structure created"

# Generate SSL certificate
echo "🔒 Generating SSL certificate..."
systemctl stop docker 2>/dev/null || true
certbot certonly --standalone -d $DOMAIN --email $EMAIL --agree-tos --non-interactive -q

mkdir -p ssl/$DOMAIN
cp /etc/letsencrypt/live/$DOMAIN/* ssl/$DOMAIN/
echo "✓ SSL certificate generated"

# Create .env
cat > .env <<EOF
DOMAIN=$DOMAIN
PUBLIC_IP=$PUBLIC_IP
DRACHTIO_SECRET=$DRACHTIO_SECRET
FREESWITCH_SECRET=$FREESWITCH_SECRET
SIP_TRUNK_HOST=$SIP_TRUNK_HOST
SIP_TRUNK_USER=$SIP_TRUNK_USER
SIP_TRUNK_PASSWORD=$SIP_TRUNK_PASSWORD
EOF

# Drachtio config
cat > drachtio/drachtio.conf.xml <<'DRACHTIO'
<drachtio>
  <admin port="9022" secret="${DRACHTIO_SECRET}">127.0.0.1</admin>
  <sip>
    <contacts>
      <contact external-ip="${PUBLIC_IP}">sip:*:5060;transport=udp</contact>
      <contact external-ip="${PUBLIC_IP}">sips:*:8443;transport=wss</contact>
    </contacts>
    <tls>
      <key-file>/etc/letsencrypt/live/${DOMAIN}/privkey.pem</key-file>
      <cert-file>/etc/letsencrypt/live/${DOMAIN}/fullchain.pem</cert-file>
      <chain-file>/etc/letsencrypt/live/${DOMAIN}/chain.pem</chain-file>
    </tls>
  </sip>
</drachtio>
DRACHTIO

sed -i "s/\${DRACHTIO_SECRET}/$DRACHTIO_SECRET/g" drachtio/drachtio.conf.xml
sed -i "s/\${PUBLIC_IP}/$PUBLIC_IP/g" drachtio/drachtio.conf.xml
sed -i "s/\${DOMAIN}/$DOMAIN/g" drachtio/drachtio.conf.xml

# Docker Compose
cat > docker-compose.yml <<'COMPOSE'
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

  rtpengine:
    image: drachtio/rtpengine:latest
    container_name: rtpengine
    restart: unless-stopped
    network_mode: host
    command: >
      rtpengine --interface=public/${PUBLIC_IP}
      --listen-ng=127.0.0.1:22222
      --port-min=10000 --port-max=20000
      --log-level=6
    cap_add:
      - NET_ADMIN

  freeswitch:
    image: drachtio/drachtio-freeswitch-mrf:latest
    container_name: freeswitch
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./freeswitch/recordings:/usr/local/freeswitch/recordings

  app:
    build: ./app
    container_name: webrtc-app
    restart: unless-stopped
    network_mode: host
    depends_on:
      - drachtio
      - rtpengine
    volumes:
      - ./app:/app
      - /app/node_modules
    environment:
      - DRACHTIO_HOST=127.0.0.1
      - DRACHTIO_PORT=9022
      - DRACHTIO_SECRET=${DRACHTIO_SECRET}
      - RTPENGINE_HOST=127.0.0.1
      - RTPENGINE_PORT=22222
      - DOMAIN=${DOMAIN}
      - PUBLIC_IP=${PUBLIC_IP}
      - SIP_TRUNK_HOST=${SIP_TRUNK_HOST}
      - SIP_TRUNK_USER=${SIP_TRUNK_USER}
      - SIP_TRUNK_PASSWORD=${SIP_TRUNK_PASSWORD}

  redis:
    image: redis:alpine
    container_name: redis
    restart: unless-stopped
    ports:
      - "6379:6379"

volumes:
  redis-data:
COMPOSE

# App Dockerfile
cat > app/Dockerfile <<'APPDOCKER'
FROM node:18-alpine
WORKDIR /app
RUN apk add --no-cache git
COPY package*.json ./
RUN npm install --quiet
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
APPDOCKER

# Package.json
cat > app/package.json <<'PKG'
{
  "name": "drachtio-webrtc-app",
  "version": "1.0.0",
  "main": "app.js",
  "scripts": {
    "start": "node app.js"
  },
  "dependencies": {
    "drachtio-srf": "^4.5.0",
    "rtpengine-client": "^0.3.0",
    "express": "^4.18.2",
    "redis": "^4.6.5",
    "uuid": "^9.0.0"
  }
}
PKG

# Main App
cat > app/app.js <<'APP'
const Srf = require('drachtio-srf');
const srf = new Srf();
const rtpengine = require('rtpengine-client');
const express = require('express');
const redis = require('redis');
const path = require('path');

const config = {
  drachtio: {
    host: process.env.DRACHTIO_HOST,
    port: process.env.DRACHTIO_PORT,
    secret: process.env.DRACHTIO_SECRET
  },
  rtpengine: {
    host: process.env.RTPENGINE_HOST,
    port: parseInt(process.env.RTPENGINE_PORT)
  },
  domain: process.env.DOMAIN,
  publicIp: process.env.PUBLIC_IP,
  trunk: {
    host: process.env.SIP_TRUNK_HOST,
    user: process.env.SIP_TRUNK_USER,
    password: process.env.SIP_TRUNK_PASSWORD
  }
};

const redisClient = redis.createClient({url: 'redis://127.0.0.1:6379'});
redisClient.connect().catch(console.error);

const rtpClient = rtpengine.Client(config.rtpengine);
const activeCalls = new Map();
const registeredUsers = new Map();

srf.connect(config.drachtio);
srf.on('connect', (err, hostport) => {
  console.log(`✓ Connected to Drachtio at ${hostport}`);
});

// Handle REGISTER
srf.register((req, res) => {
  const from = req.getParsedHeader('From');
  const contact = req.getParsedHeader('Contact');
  const expires = req.get('Expires') || 3600;
  const username = from.uri.match(/sip:([^@]+)@/)[1];
  
  registeredUsers.set(username, {
    contact: contact.uri,
    expires: parseInt(expires),
    registered: Date.now()
  });
  
  redisClient.setEx(`reg:${username}`, parseInt(expires), 
    JSON.stringify({contact: contact.uri, expires}));
  
  res.send(200, {
    headers: {'Contact': contact.uri, 'Expires': expires}
  });
  console.log(`✓ User ${username} registered`);
});

// Handle INVITE
srf.invite(async (req, res) => {
  try {
    const from = req.getParsedHeader('From');
    const callId = req.get('Call-ID');
    const caller = from.uri.match(/sip:([^@]+)@/)[1];
    const callee = req.uri.match(/sip:([^@]+)@/)[1];
    
    console.log(`📞 Call: ${caller} → ${callee}`);
    
    const isWebRTC = req.protocol === 'wss';
    
    const rtpOffer = await rtpClient.offer({
      'call-id': callId,
      'from-tag': from.params.tag,
      'sdp': req.body,
      'ICE': isWebRTC ? 'force' : 'remove',
      'DTLS': isWebRTC ? 'passive' : 'off',
      'transport-protocol': isWebRTC ? 'RTP/SAVPF' : 'RTP/AVP',
      'rtcp-mux': isWebRTC ? ['offer'] : []
    });
    
    // Route to PSTN or internal
    const isPSTN = callee.startsWith('+') || /^\d{10,}$/.test(callee);
    const targetUri = isPSTN 
      ? `sip:${callee}@${config.trunk.host}`
      : registeredUsers.get(callee)?.contact;
    
    if (!targetUri) {
      return res.send(404, 'Not Found');
    }
    
    const opts = {
      localSdpB: rtpOffer.sdp,
      localSdpA: async (sdp, res) => {
        const rtpAnswer = await rtpClient.answer({
          'call-id': callId,
          'from-tag': from.params.tag,
          'to-tag': res.getParsedHeader('To').params.tag,
          'sdp': sdp,
          'ICE': isPSTN ? 'remove' : (isWebRTC ? 'force' : 'remove'),
          'transport-protocol': isPSTN ? 'RTP/AVP' : (isWebRTC ? 'RTP/SAVPF' : 'RTP/AVP')
        });
        return rtpAnswer.sdp;
      }
    };
    
    if (isPSTN) {
      opts.auth = {
        username: config.trunk.user,
        password: config.trunk.password
      };
    }
    
    srf.createB2BUA(req, res, targetUri, opts, (err, {uas, uac}) => {
      if (err) {
        console.error('❌ Call failed:', err);
        return;
      }
      
      console.log(`✓ Call connected`);
      activeCalls.set(callId, {uas, uac, caller, callee, startTime: Date.now()});
      
      [uas, uac].forEach(dlg => {
        dlg.on('destroy', () => {
          console.log(`✓ Call ended: ${callId}`);
          rtpClient.delete({'call-id': callId});
          activeCalls.delete(callId);
        });
      });
    });
  } catch (err) {
    console.error('❌ Error:', err);
    res.send(500);
  }
});

// HTTP API
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    activeCalls: activeCalls.size,
    registeredUsers: registeredUsers.size
  });
});

app.get('/calls', (req, res) => {
  const calls = Array.from(activeCalls.values()).map(c => ({
    caller: c.caller,
    callee: c.callee,
    duration: Math.floor((Date.now() - c.startTime) / 1000)
  }));
  res.json(calls);
});

app.get('/users', (req, res) => {
  const users = Array.from(registeredUsers.entries()).map(([u, d]) => ({
    username: u,
    contact: d.contact,
    expires: d.expires
  }));
  res.json(users);
});

app.listen(3000, () => {
  console.log('✓ HTTP API: http://localhost:3000');
  console.log('✓ Web Client: http://localhost:3000');
});

console.log('🚀 Drachtio WebRTC Application started');
APP

# Web Client
cat > app/public/index.html <<'HTML'
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>WebRTC Phone</title>
    <script src="https://cdn.jsdelivr.net/npm/jssip@3.10.0/dist/jssip.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .phone {
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
            font-size: 32px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .subtitle { color: #999; margin-bottom: 30px; font-size: 14px; }
        .status {
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 25px;
            font-weight: 500;
            text-align: center;
            transition: all 0.3s;
        }
        .status.offline { background: #fee; color: #c33; }
        .status.online { background: #d4edda; color: #155724; }
        .status.calling { background: #fff3cd; color: #856404; }
        .form-group { margin-bottom: 20px; }
        label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 600;
            font-size: 14px;
        }
        input {
            width: 100%;
            padding: 14px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 15px;
            transition: all 0.3s;
        }
        input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102,126,234,0.1);
        }
        button {
            width: 100%;
            padding: 16px;
            border: none;
            border-radius: 10px;
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
        .btn-success { background: #28a745; color: white; }
        .btn-success:hover { background: #218838; }
        .btn-danger { background: #dc3545; color: white; }
        .btn-danger:hover { background: #c82333; }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
        }
        .help { font-size: 12px; color: #999; margin-top: 5px; }
        audio { display: none; }
    </style>
</head>
<body>
    <div class="phone">
        <h1><span>📞</span> WebRTC Phone</h1>
        <p class="subtitle">Powered by Drachtio</p>
        
        <div id="status" class="status offline">● Offline</div>
        
        <div class="form-group">
            <label>Username</label>
            <input type="text" id="username" placeholder="Enter username" value="user1">
        </div>
        
        <div class="form-group">
            <label>Password</label>
            <input type="password" id="password" placeholder="Enter password" value="pass123">
        </div>
        
        <div class="form-group">
            <label>Server Domain</label>
            <input type="text" id="domain" placeholder="sip.example.com">
            <div class="help">Your Drachtio server domain</div>
        </div>
        
        <button id="register" class="btn-primary">Connect</button>
        <button id="unregister" class="btn-danger" disabled>Disconnect</button>
        
        <div class="form-group" style="margin-top: 30px;">
            <label>Call To</label>
            <input type="text" id="callNumber" placeholder="user2 or +1234567890">
            <div class="help">Username or phone number with country code</div>
        </div>
        
        <button id="call" class="btn-success" disabled>📞 Make Call</button>
        <button id="hangup" class="btn-danger" disabled>End Call</button>
        
        <audio id="remoteAudio" autoplay></audio>
    </div>

    <script>
        let phone, session;
        const status = document.getElementById('status');
        
        function updateStatus(msg, cls) {
            status.textContent = '● ' + msg;
            status.className = 'status ' + cls;
        }
        
        document.getElementById('register').onclick = () => {
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
                register: true
            };
            
            phone = new JsSIP.UA(configuration);
            
            phone.on('connected', () => updateStatus('Connected', 'online'));
            phone.on('registered', () => {
                updateStatus('Registered - Ready', 'online');
                document.getElementById('register').disabled = true;
                document.getElementById('unregister').disabled = false;
                document.getElementById('call').disabled = false;
            });
            phone.on('registrationFailed', (e) => updateStatus('Failed: ' + e.cause, 'offline'));
            
            phone.on('newRTCSession', (e) => {
                session = e.session;
                
                if (session.direction === 'incoming') {
                    updateStatus('Incoming call...', 'calling');
                    session.answer({mediaConstraints: {audio: true, video: false}});
                }
                
                session.on('accepted', () => {
                    updateStatus('Call active', 'online');
                    const stream = new MediaStream();
                    session.connection.getReceivers().forEach(r => stream.addTrack(r.track));
                    document.getElementById('remoteAudio').srcObject = stream;
                    document.getElementById('call').disabled = true;
                    document.getElementById('hangup').disabled = false;
                });
                
                session.on('ended', () => {
                    updateStatus('Call ended', 'online');
                    document.getElementById('call').disabled = false;
                    document.getElementById('hangup').disabled = true;
                });
                
                session.on('failed', () => {
                    updateStatus('Call failed', 'online');
                    document.getElementById('call').disabled = false;
                    document.getElementById('hangup').disabled = true;
                });
            });
            
            phone.start();
            updateStatus('Connecting...', 'calling');
        };
        
        document.getElementById('unregister').onclick = () => {
            if (phone) {
                phone.stop();
                updateStatus('Disconnected', 'offline');
                document.getElementById('register').disabled = false;
                document.getElementById('unregister').disabled = true;
                document.getElementById('call').disabled = true;
            }
        };
        
        document.getElementById('call').onclick = () => {
            const number = document.getElementById('callNumber').value;
            const domain = document.getElementById('domain').value;
            
            if (!number) {
                alert('Enter number to call');
                return;
            }
            
            const options = {
                mediaConstraints: {audio: true, video: false},
                eventHandlers: {
                    'progress': () => updateStatus('Calling...', 'calling'),
                    'accepted': () => updateStatus('Call active', 'online'),
                    'ended': () => {
                        updateStatus('Call ended', 'online');
                        document.getElementById('call').disabled = false;
                        document.getElementById('hangup').disabled = true;
                    }
                }
            };
            
            session = phone.call(`sip:${number}@${domain}`, options);
            session.connection.addEventListener('addstream', (e) => {
                document.getElementById('remoteAudio').srcObject = e.stream;
            });
        };
        
        document.getElementById('hangup').onclick = () => {
            if (session) session.terminate();
        };
        
        // Set domain from URL
        document.getElementById('domain').value = window.location.hostname;
    </script>
</body>
</html>
HTML

echo "✓ Application files created"

# Configure firewall
echo "🔥 Configuring firewall..."
ufw --force enable
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw allow 5060/udp
ufw allow 8443/tcp
ufw allow 10000:20000/udp
echo "✓ Firewall configured"

# Build and start
echo "🐳 Building Docker images..."
docker-compose build --quiet

echo "🚀 Starting services..."
docker-compose up -d

# Wait for services
sleep 10

# Create credentials file
cat > CREDENTIALS.txt <<CREDS
╔════════════════════════════════════════════╗
║     Drachtio WebRTC Platform               ║
║     Installation Complete!                 ║
╚════════════════════════════════════════════╝

🌐 Access Points:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Web Client: https://$DOMAIN/
Web Client (IP): http://$PUBLIC_IP:3000/
API Status: http://$PUBLIC_IP:3000/status

🔑 Credentials:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Domain: $DOMAIN
Public IP: $PUBLIC_IP
Drachtio Secret: $DRACHTIO_SECRET
FreeSWITCH Secret: $FREESWITCH_SECRET

📞 SIP Configuration:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WebSocket URI: wss://$DOMAIN:8443
SIP URI: sip:$DOMAIN:5060

🔌 SIP Trunk (PSTN):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Host: $SIP_TRUNK_HOST
Username: $SIP_TRUNK_USER
Password: $SIP_TRUNK_PASSWORD

📋 Usage:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Browser to Browser:
   - Open web client in two browsers
   - Register as user1 and user2
   - Call each other by username

2. Browser to Phone:
   - Register in web client
   - Call: +1234567890 (with country code)
   - Routes through SIP trunk to PSTN

3. Phone to Browser:
   - Configure trunk to route to: $DOMAIN
   - Calls route to registered users

🛠️  Docker Commands:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
View logs: docker-compose logs -f
Restart: docker-compose restart
Stop: docker-compose down
Start: docker-compose up -d

📊 Monitoring:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status: curl http://$PUBLIC_IP:3000/status
Active Calls: curl http://$PUBLIC_IP:3000/calls
Users: curl http://$PUBLIC_IP:3000/users

Installation directory: $PROJECT_DIR

CREDS

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║     ✅ Installation Complete!              ║"
echo "╚════════════════════════════════════════════╝"
echo ""
cat CREDENTIALS.txt
echo ""
echo "📝 Credentials saved to: $PROJECT_DIR/CREDENTIALS.txt"
echo ""
echo "🌐 Open your browser: http://$PUBLIC_IP:3000/"
echo ""