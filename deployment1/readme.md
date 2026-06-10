# Drachtio WebRTC Platform

Complete SIP signaling + RTP media + IVR platform using Docker.

## Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Browser   │◄───WSS──►│   Drachtio   │◄───SIP──►│ SIP Trunk   │
│  (WebRTC)   │         │   (Signal)   │         │   (PSTN)    │
└─────────────┘         └──────────────┘         └─────────────┘
       │                       │
       │                       │
       ▼                       ▼
┌─────────────┐         ┌──────────────┐
│  RTPEngine  │◄────────►│ FreeSWITCH  │
│   (Media)   │         │    (IVR)     │
└─────────────┘         └──────────────┘
```

## Components

1. **Drachtio Server** - SIP signaling server with WebSocket support
2. **RTPEngine** - Media proxy for RTP/SRTP handling
3. **FreeSWITCH** - Media server for IVR, conferencing, recording
4. **Node.js App** - Application logic controlling call flow
5. **Redis** - Session and user data storage

## Features

✅ Browser to Browser calls (WebRTC)  
✅ Browser to Mobile calls (via SIP trunk)  
✅ Mobile to Browser calls (inbound routing)  
✅ IVR capabilities with FreeSWITCH  
✅ Call recording  
✅ Conference bridges  
✅ DTMF support  
✅ NAT traversal with STUN/TURN  

## Quick Start

### Prerequisites

- Ubuntu 20.04+ or Debian 11+
- Root/sudo access
- Public IP address
- Domain name pointing to your server
- SIP trunk account (optional, for PSTN calls)

### Installation

```bash
# Download the deployment script
wget https://raw.githubusercontent.com/yourrepo/deploy-drachtio.sh

# Make it executable
chmod +x deploy-drachtio.sh

# Run deployment
sudo ./deploy-drachtio.sh
```

The script will ask for:
- Your domain name (e.g., sip.example.com)
- Your email (for SSL certificate)
- SIP trunk credentials (optional)

Installation takes about 15-20 minutes.

## Configuration

### Environment Variables

Edit `.env` file:

```env
DOMAIN=sip.example.com
PUBLIC_IP=1.2.3.4
DRACHTIO_SECRET=your_secret
FREESWITCH_SECRET=your_secret
SIP_TRUNK_HOST=sip.provider.com
SIP_TRUNK_USER=your_username
SIP_TRUNK_PASSWORD=your_password
```

### Drachtio Configuration

Edit `drachtio/drachtio.conf.xml` to customize:
- SIP ports
- TLS settings
- Authentication
- Rate limiting

### Application Logic

Edit `app/app.js` to customize:
- Call routing logic
- User authentication
- IVR flows
- Call handling

## Usage

### Web Client

1. Open `https://yourdomain.com/`
2. Enter username and password
3. Click "Connect"
4. Enter number to call (username or +phone)
5. Click "Call"

### API Endpoints

```bash
# Check system status
curl http://yourdomain.com:3000/status

# List active calls
curl http://yourdomain.com:3000/calls

# List registered users
curl http://yourdomain.com:3000/users
```

### Call Scenarios

#### 1. Browser to Browser
```
User1 (browser) → user2 → User2 (browser)
```

#### 2. Browser to Mobile
```
User (browser) → +1234567890 → SIP Trunk → PSTN → Mobile
```

#### 3. Mobile to Browser
```
Mobile → PSTN → SIP Trunk → Drachtio → user1 → User (browser)
```

#### 4. IVR Flow
```
Caller → IVR Menu → Press 1 → Agent
                  → Press 2 → Voicemail
```

## Advanced Features

### Adding IVR

Edit `app/app.js` to add IVR handling:

```javascript
// Handle IVR extension
if (callee === 'ivr') {
  const ms = await mrf.connect();
  const {endpoint, dialog} = await ms.connectCaller(req, res);
  
  await endpoint.play('ivr/welcome.wav');
  const digit = await endpoint.waitForDtmf(5000);
  
  if (digit === '1') {
    // Route to sales
  } else if (digit === '2') {
    // Route to support
  }
}
```

### Adding Call Recording

```javascript
// Start recording
activeCalls.forEach((call) => {
  if (call.endpoint) {
    call.endpoint.startRecording(
      `/recordings/${call.callId}.wav`
    );
  }
});
```

### Adding Conference Bridge

```javascript
// Create conference
const conference = await ms.createConference('room123');

// Add participants
await conference.join(endpoint1);
await conference.join(endpoint2);
```

## Docker Commands

```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f drachtio
docker-compose logs -f app
docker-compose logs -f rtpengine

# Restart services
docker-compose restart

# Stop all services
docker-compose down

# Start services
docker-compose up -d

# Rebuild after changes
docker-compose build && docker-compose up -d
```

## Monitoring

### System Status

```bash
# Check if all containers are running
docker-compose ps

# Check resource usage
docker stats
```

### Logs

```bash
# Drachtio logs
docker logs -f drachtio-server

# Application logs
docker logs -f webrtc-app

# RTPEngine logs
docker logs -f rtpengine
```

### Active Calls

```bash
# Via API
curl http://localhost:3000/calls

# Via Drachtio CLI
docker exec -it drachtio-server drachtio-client \
  -h 127.0.0.1 -P 9022 -s YOUR_SECRET
```

## Troubleshooting

### Cannot Register

1. Check WebSocket connection:
```bash
openssl s_client -connect yourdomain.com:8443
```

2. Check Drachtio logs:
```bash
docker-compose logs drachtio
```

3. Verify SSL certificate:
```bash
ls -la /etc/letsencrypt/live/yourdomain.com/
```

### No Audio in Calls

1. Check RTPEngine:
```bash
docker-compose logs rtpengine
```

2. Verify firewall ports 10000-20000/udp are open
3. Check NAT configuration in RTPEngine

### Calls Not Connecting to PSTN

1. Verify SIP trunk credentials in `.env`
2. Check trunk provider allows your IP
3. View outbound call logs:
```bash
docker-compose logs app | grep "PSTN"
```

### High CPU Usage

1. Check active calls:
```bash
curl http://localhost:3000/calls
```

2. Monitor RTPEngine:
```bash
docker stats rtpengine
```

3. Reduce RTP port range if needed

## Security

### Best Practices

1. **Change default secrets** in `.env` file
2. **Use strong passwords** for SIP accounts
3. **Enable firewall** - only open required ports
4. **Regular updates**:
```bash
docker-compose pull
docker-compose up -d
```

5. **Monitor logs** for suspicious activity
6. **Rate limiting** - configure in drachtio.conf.xml

### SSL Certificate Renewal

```bash
# Renew certificate
certbot renew

# Copy new certificates
cp /etc/letsencrypt/live/yourdomain.com/* ./ssl/yourdomain.com/

# Restart Drachtio
docker-compose restart drachtio
```

## Scaling

### Horizontal Scaling

1. **Multiple Drachtio instances** - use load balancer
2. **Redis cluster** - for session data
3. **Multiple RTPEngine instances** - for media
4. **FreeSWITCH cluster** - for IVR

### Performance Tuning

Edit `docker-compose.yml`:

```yaml
rtpengine:
  deploy:
    resources:
      limits:
        cpus: '4'
        memory: 4G
```

## Integration

### SIP Trunk Providers

Tested with:
- Twilio
- Vonage (Nexmo)
- Bandwidth
- Telnyx
- Plivo

### WebRTC Libraries

Compatible with:
- JsSIP (used in web client)
- SIP.js
- PeerJS (with adapter)

## License

MIT License

## Support

- GitHub Issues: https://github.com/yourrepo/issues
- Documentation: https://docs.yourdomain.com
- Community: https://community.yourdomain.com

## Credits

Built with:
- [Drachtio](https://drachtio.org)
- [RTPEngine](https://github.com/sipwise/rtpengine)
- [FreeSWITCH](https://freeswitch.org)
- [JsSIP](https://jssip.net)