// SIP Trunk Integration Module
// Add this to app/sip-trunks.js

class SIPTrunkManager {
  constructor() {
    this.providers = {
      twilio: this.getTwilioConfig(),
      vonage: this.getVonageConfig(),
      bandwidth: this.getBandwidthConfig(),
      telnyx: this.getTelnyxConfig(),
      plivo: this.getPlivoConfig()
    };
    
    this.activeProvider = process.env.SIP_TRUNK_PROVIDER || 'twilio';
  }

  // Twilio Configuration
  getTwilioConfig() {
    return {
      name: 'Twilio',
      host: process.env.TWILIO_SIP_DOMAIN || 'yourcompany.pstn.twilio.com',
      port: 5060,
      transport: 'udp',
      username: process.env.TWILIO_SIP_USERNAME,
      password: process.env.TWILIO_SIP_PASSWORD,
      authUsername: process.env.TWILIO_SIP_USERNAME,
      realm: process.env.TWILIO_SIP_DOMAIN,
      
      // Outbound call formatting
      formatOutbound: (number) => {
        // Twilio expects E.164 format
        if (!number.startsWith('+')) {
          number = '+1' + number; // Assume US if no country code
        }
        return `sip:${number}@${process.env.TWILIO_SIP_DOMAIN}`;
      },
      
      // Inbound number parsing
      parseInbound: (fromHeader) => {
        const match = fromHeader.match(/sip:(\+?\d+)@/);
        return match ? match[1] : null;
      },
      
      // Custom headers for Twilio
      customHeaders: {
        'X-Twilio-AccountSid': process.env.TWILIO_ACCOUNT_SID
      }
    };
  }

  // Vonage (Nexmo) Configuration
  getVonageConfig() {
    return {
      name: 'Vonage',
      host: process.env.VONAGE_SIP_HOST || 'sip.nexmo.com',
      port: 5060,
      transport: 'udp',
      username: process.env.VONAGE_API_KEY,
      password: process.env.VONAGE_API_SECRET,
      
      formatOutbound: (number) => {
        if (!number.startsWith('+')) {
          number = '+1' + number;
        }
        return `sip:${number}@sip.nexmo.com`;
      },
      
      parseInbound: (fromHeader) => {
        const match = fromHeader.match(/sip:(\+?\d+)@/);
        return match ? match[1] : null;
      }
    };
  }

  // Bandwidth Configuration
  getBandwidthConfig() {
    return {
      name: 'Bandwidth',
      host: process.env.BANDWIDTH_SIP_HOST || 'sip.bandwidth.com',
      port: 5060,
      transport: 'udp',
      username: process.env.BANDWIDTH_USERNAME,
      password: process.env.BANDWIDTH_PASSWORD,
      
      formatOutbound: (number) => {
        if (!number.startsWith('+')) {
          number = '+1' + number;
        }
        return `sip:${number}@sip.bandwidth.com`;
      },
      
      parseInbound: (fromHeader) => {
        const match = fromHeader.match(/sip:(\+?\d+)@/);
        return match ? match[1] : null;
      }
    };
  }

  // Telnyx Configuration
  getTelnyxConfig() {
    return {
      name: 'Telnyx',
      host: process.env.TELNYX_SIP_HOST || 'sip.telnyx.com',
      port: 5060,
      transport: 'udp',
      username: process.env.TELNYX_USERNAME,
      password: process.env.TELNYX_PASSWORD,
      
      formatOutbound: (number) => {
        if (!number.startsWith('+')) {
          number = '+1' + number;
        }
        return `sip:${number}@sip.telnyx.com`;
      },
      
      parseInbound: (fromHeader) => {
        const match = fromHeader.match(/sip:(\+?\d+)@/);
        return match ? match[1] : null;
      },
      
      customHeaders: {
        'X-Telnyx-Connection-Id': process.env.TELNYX_CONNECTION_ID
      }
    };
  }

  // Plivo Configuration
  getPlivoConfig() {
    return {
      name: 'Plivo',
      host: process.env.PLIVO_SIP_HOST || 'sip.plivo.com',
      port: 5060,
      transport: 'udp',
      username: process.env.PLIVO_AUTH_ID,
      password: process.env.PLIVO_AUTH_TOKEN,
      
      formatOutbound: (number) => {
        if (!number.startsWith('+')) {
          number = '+1' + number;
        }
        return `sip:${number}@sip.plivo.com`;
      },
      
      parseInbound: (fromHeader) => {
        const match = fromHeader.match(/sip:(\+?\d+)@/);
        return match ? match[1] : null;
      }
    };
  }

  // Get current provider config
  getProviderConfig(providerName = null) {
    const provider = providerName || this.activeProvider;
    return this.providers[provider];
  }

  // Format outbound number for current provider
  formatOutboundNumber(number, providerName = null) {
    const config = this.getProviderConfig(providerName);
    return config.formatOutbound(number);
  }

  // Parse inbound number from current provider
  parseInboundNumber(fromHeader, providerName = null) {
    const config = this.getProviderConfig(providerName);
    return config.parseInbound(fromHeader);
  }

  // Get SIP URI for outbound call
  getOutboundUri(number, providerName = null) {
    const config = this.getProviderConfig(providerName);
    
    // Format the number
    let formattedNumber = number;
    if (config.formatOutbound) {
      formattedNumber = config.formatOutbound(number);
    }
    
    return formattedNumber;
  }

  // Get auth credentials for provider
  getAuthCredentials(providerName = null) {
    const config = this.getProviderConfig(providerName);
    
    return {
      username: config.username || config.authUsername,
      password: config.password,
      realm: config.realm || config.host
    };
  }

  // Get custom headers for provider
  getCustomHeaders(providerName = null) {
    const config = this.getProviderConfig(providerName);
    return config.customHeaders || {};
  }

  // Validate phone number
  isValidPhoneNumber(number) {
    // Remove common formatting characters
    const cleaned = number.replace(/[\s\-\(\)\.]/g, '');
    
    // Check if it's a valid E.164 format or 10-digit US number
    const e164Pattern = /^\+[1-9]\d{1,14}$/;
    const usPattern = /^\d{10}$/;
    
    return e164Pattern.test(cleaned) || usPattern.test(cleaned);
  }

  // Format number to E.164
  toE164(number, defaultCountryCode = '1') {
    // Remove formatting
    let cleaned = number.replace(/[\s\-\(\)\.]/g, '');
    
    // Add + if not present
    if (!cleaned.startsWith('+')) {
      // If 10 digits, assume it needs country code
      if (cleaned.length === 10) {
        cleaned = '+' + defaultCountryCode + cleaned;
      } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
        cleaned = '+' + cleaned;
      } else {
        cleaned = '+' + cleaned;
      }
    }
    
    return cleaned;
  }

  // Get provider status
  async getProviderStatus(providerName = null) {
    const config = this.getProviderConfig(providerName);
    
    return {
      provider: config.name,
      host: config.host,
      port: config.port,
      transport: config.transport,
      configured: !!(config.username && config.password),
      active: this.activeProvider === providerName
    };
  }

  // Switch active provider
  switchProvider(providerName) {
    if (!this.providers[providerName]) {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    
    this.activeProvider = providerName;
    console.log(`✓ Switched to ${this.providers[providerName].name}`);
    
    return this.getProviderConfig();
  }

  // Test provider connection
  async testProvider(srf, providerName = null) {
    const config = this.getProviderConfig(providerName);
    
    try {
      // Send OPTIONS request to test connectivity
      const result = await srf.request(
        `sip:${config.host}:${config.port}`,
        {
          method: 'OPTIONS',
          headers: {
            'User-Agent': 'Drachtio-WebRTC-Test'
          }
        }
      );
      
      console.log(`✓ ${config.name} connection test successful`);
      return { success: true, provider: config.name };
    } catch (err) {
      console.error(`❌ ${config.name} connection test failed:`, err);
      return { success: false, provider: config.name, error: err.message };
    }
  }

  // Get call pricing (if supported by provider)
  async getCallPricing(number, providerName = null) {
    const config = this.getProviderConfig(providerName);
    
    // This is a placeholder - implement actual API calls to providers
    console.log(`Getting pricing for ${number} from ${config.name}`);
    
    return {
      provider: config.name,
      number: number,
      pricePerMinute: 0.01, // Example
      currency: 'USD'
    };
  }

  // Get available phone numbers from provider
  async getAvailableNumbers(areaCode, providerName = null) {
    const config = this.getProviderConfig(providerName);
    
    // Placeholder - implement actual API calls
    console.log(`Getting available numbers in ${areaCode} from ${config.name}`);
    
    return [];
  }
}

module.exports = SIPTrunkManager;