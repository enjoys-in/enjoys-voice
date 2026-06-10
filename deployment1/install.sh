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
mkdir -p $PROJECT_DIR/{drachtio,freeswitch/{conf,sounds,recordings},rtpengine,ssl,app/{