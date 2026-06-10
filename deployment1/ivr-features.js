// IVR Features Module
// Add this to app/ivr-features.js

const Mrf = require('drachtio-fsmrf');
const fs = require('fs').promises;
const path = require('path');

class IVRSystem {
  constructor(srf) {
    this.srf = srf;
    this.mrf = new Mrf(srf);
    this.conferences = new Map();
    this.recordings = new Map();
  }

  async initialize() {
    try {
      this.ms = await this.mrf.connect({
        address: process.env.FREESWITCH_HOST || '127.0.0.1',
        port: process.env.FREESWITCH_PORT || 8021,
        secret: process.env.FREESWITCH_SECRET
      });
      console.log('✓ IVR System initialized');
      return this.ms;
    } catch (err) {
      console.error('❌ Failed to connect to FreeSWITCH:', err);
      throw err;
    }
  }

  // Main IVR Handler
  async handleIVR(req, res) {
    try {
      const {endpoint, dialog} = await this.ms.connectCaller(req, res);
      console.log('📞 IVR call connected');

      // Play welcome message
      await endpoint.play('ivr/welcome.wav');
      
      // Main menu
      const digit = await this.playMenuAndGetDigit(endpoint, 
        'ivr/main-menu.wav', 10000);

      switch(digit) {
        case '1':
          await this.routeToSales(endpoint, dialog);
          break;
        case '2':
          await this.routeToSupport(endpoint, dialog);
          break;
        case '3':
          await this.leaveVoicemail(endpoint, dialog);
          break;
        case '4':
          await this.checkBusinessHours(endpoint);
          break;
        case '9':
          await this.joinConference(endpoint, dialog);
          break;
        case '0':
          await this.routeToOperator(endpoint, dialog);
          break;
        default:
          await endpoint.play('ivr/invalid-option.wav');
          await this.handleIVR(req, res); // Repeat menu
      }
    } catch (err) {
      console.error('IVR Error:', err);
    }
  }

  async playMenuAndGetDigit(endpoint, soundFile, timeout = 10000) {
    try {
      await endpoint.play(soundFile);
      const result = await endpoint.waitForDtmf(timeout);
      return result.dtmf;
    } catch (err) {
      return null;
    }
  }

  // Route to Sales Department
  async routeToSales(endpoint, dialog) {
    await endpoint.play('ivr/transferring-sales.wav');
    
    // Transfer to sales queue
    const salesAgents = ['user1', 'user2', 'user3'];
    await this.queueCall(endpoint, dialog, 'sales', salesAgents);
  }

  // Route to Support
  async routeToSupport(endpoint, dialog) {
    await endpoint.play('ivr/transferring-support.wav');
    
    const supportAgents = ['user4', 'user5'];
    await this.queueCall(endpoint, dialog, 'support', supportAgents);
  }

  // Voicemail System
  async leaveVoicemail(endpoint, dialog) {
    await endpoint.play('ivr/voicemail-beep.wav');
    
    const recordingPath = path.join(
      '/usr/local/freeswitch/recordings',
      `voicemail-${Date.now()}.wav`
    );

    try {
      await endpoint.startRecording(recordingPath);
      
      // Record for max 3 minutes
      await new Promise(resolve => setTimeout(resolve, 180000));
      
      await endpoint.stopRecording();
      await endpoint.play('ivr/voicemail-saved.wav');
      
      this.recordings.set(recordingPath, {
        type: 'voicemail',
        timestamp: Date.now(),
        callId: dialog.sip.callId
      });

      console.log(`📼 Voicemail saved: ${recordingPath}`);
      
      dialog.destroy();
    } catch (err) {
      console.error('Voicemail error:', err);
    }
  }

  // Business Hours Check
  async checkBusinessHours(endpoint) {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    // Business hours: Mon-Fri 9AM-6PM
    const isBusinessHours = day >= 1 && day <= 5 && hour >= 9 && hour < 18;

    if (isBusinessHours) {
      await endpoint.play('ivr/business-hours-open.wav');
    } else {
      await endpoint.play('ivr/business-hours-closed.wav');
    }
  }

  // Conference Bridge
  async joinConference(endpoint, dialog) {
    const roomNumber = await this.getConferenceNumber(endpoint);
    
    if (!roomNumber) {
      await endpoint.play('ivr/invalid-conference.wav');
      return;
    }

    await endpoint.play('ivr/joining-conference.wav');

    let conference = this.conferences.get(roomNumber);
    
    if (!conference) {
      conference = await this.ms.createConference(`conf-${roomNumber}`);
      this.conferences.set(roomNumber, conference);
      console.log(`📞 Conference created: ${roomNumber}`);
    }

    await conference.join(endpoint, {
      startConferenceOnEnter: true,
      endConferenceOnExit: false
    });

    dialog.on('destroy', () => {
      conference.leave(endpoint);
      console.log(`User left conference: ${roomNumber}`);
      
      // Clean up empty conferences
      if (conference.members.length === 0) {
        this.conferences.delete(roomNumber);
      }
    });
  }

  async getConferenceNumber(endpoint) {
    await endpoint.play('ivr/enter-conference-number.wav');
    
    let digits = '';
    for (let i = 0; i < 4; i++) {
      const result = await endpoint.waitForDtmf(5000);
      if (result.dtmf) {
        digits += result.dtmf;
      }
    }
    
    return digits.length === 4 ? digits : null;
  }

  // Route to Operator
  async routeToOperator(endpoint, dialog) {
    await endpoint.play('ivr/transferring-operator.wav');
    
    // Transfer to operator
    const operatorUri = 'sip:operator@' + process.env.DOMAIN;
    
    try {
      await this.srf.createB2BUA(dialog, operatorUri);
    } catch (err) {
      await endpoint.play('ivr/operator-unavailable.wav');
      console.error('Operator transfer failed:', err);
    }
  }

  // Call Queue System
  async queueCall(endpoint, dialog, queueName, agents) {
    const callId = dialog.sip.callId;
    
    await endpoint.play('music/hold-music.wav', {repeat: 100});

    let answered = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!answered && attempts < maxAttempts) {
      for (const agent of agents) {
        if (answered) break;

        console.log(`Trying agent: ${agent}`);
        
        try {
          const agentUri = `sip:${agent}@${process.env.DOMAIN}`;
          
          // Try to reach agent (10 second timeout)
          const result = await Promise.race([
            this.tryAgent(endpoint, dialog, agentUri),
            new Promise(resolve => setTimeout(() => resolve(false), 10000))
          ]);

          if (result) {
            answered = true;
            await endpoint.stopPlay();
            console.log(`✓ Call connected to ${agent}`);
          }
        } catch (err) {
          console.log(`Agent ${agent} unavailable`);
        }
      }
      
      attempts++;
      
      if (!answered && attempts < maxAttempts) {
        await endpoint.stopPlay();
        await endpoint.play('ivr/still-waiting.wav');
        await endpoint.play('music/hold-music.wav', {repeat: 100});
      }
    }

    if (!answered) {
      await endpoint.stopPlay();
      await endpoint.play('ivr/no-agents-available.wav');
      await this.leaveVoicemail(endpoint, dialog);
    }
  }

  async tryAgent(endpoint, dialog, agentUri) {
    return new Promise((resolve, reject) => {
      this.srf.createB2BUA(dialog, agentUri, {
        localSdpB: endpoint.local.sdp,
        localSdpA: (sdp) => sdp
      }, (err, {uas, uac}) => {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }

  // Generate audio files for IVR (TTS)
  async generateAudioFiles() {
    const messages = {
      'welcome': 'Welcome to our phone system',
      'main-menu': 'Press 1 for sales, 2 for support, 3 for voicemail, 4 for business hours, 9 for conference, 0 for operator',
      'transferring-sales': 'Transferring you to sales',
      'transferring-support': 'Transferring you to support',
      'voicemail-beep': 'Please leave your message after the beep',
      'voicemail-saved': 'Your message has been saved. Goodbye',
      'invalid-option': 'Invalid option. Please try again',
      'no-agents-available': 'All agents are busy. Please leave a message',
      'still-waiting': 'You are still in queue. Please continue holding',
      'operator-unavailable': 'The operator is unavailable',
      'business-hours-open': 'We are currently open from 9 AM to 6 PM, Monday through Friday',
      'business-hours-closed': 'We are currently closed. Please call back during business hours',
      'enter-conference-number': 'Please enter your 4 digit conference number',
      'invalid-conference': 'Invalid conference number',
      'joining-conference': 'Joining your conference now'
    };

    // Note: In production, use a TTS service like Google Cloud TTS, AWS Polly, or record actual audio files
    console.log('📢 Generate these audio files for IVR:');
    Object.keys(messages).forEach(key => {
      console.log(`  - ivr/${key}.wav: "${messages[key]}"`);
    });
  }
}

module.exports = IVRSystem;