#!/bin/bash

# User Management Script for Drachtio WebRTC Platform

PROJECT_DIR="/opt/drachtio-webrtc"
USERS_FILE="$PROJECT_DIR/users.json"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Initialize users file if it doesn't exist
if [ ! -f "$USERS_FILE" ]; then
    echo '[]' > "$USERS_FILE"
fi

show_menu() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Drachtio WebRTC - User Management${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "1. Add User"
    echo "2. List Users"
    echo "3. Delete User"
    echo "4. Change Password"
    echo "5. Export User Credentials"
    echo "6. Exit"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1) add_user ;;
        2) list_users ;;
        3) delete_user ;;
        4) change_password ;;
        5) export_credentials ;;
        6) exit 0 ;;
        *) echo -e "${RED}Invalid option${NC}" && show_menu ;;
    esac
}

add_user() {
    echo ""
    echo -e "${YELLOW}Add New User${NC}"
    echo ""
    
    read -p "Username: " username
    if [ -z "$username" ]; then
        echo -e "${RED}Username cannot be empty${NC}"
        show_menu
        return
    fi
    
    # Check if user exists
    existing=$(cat "$USERS_FILE" | grep -o "\"$username\"" || true)
    if [ ! -z "$existing" ]; then
        echo -e "${RED}User already exists${NC}"
        show_menu
        return
    fi
    
    read -sp "Password: " password
    echo ""
    if [ -z "$password" ]; then
        echo -e "${RED}Password cannot be empty${NC}"
        show_menu
        return
    fi
    
    read -p "Display Name (optional): " display_name
    read -p "Extension Number (optional): " extension
    
    # Add user to JSON file
    python3 << EOF
import json

users = []
try:
    with open('$USERS_FILE', 'r') as f:
        users = json.load(f)
except:
    users = []

users.append({
    'username': '$username',
    'password': '$password',
    'display_name': '$display_name',
    'extension': '$extension',
    'created': '$(date -Iseconds)'
})

with open('$USERS_FILE', 'w') as f:
    json.dump(users, f, indent=2)
EOF
    
    # Add to Redis
    docker exec redis redis-cli SET "user:$username:password" "$password" > /dev/null
    docker exec redis redis-cli SET "user:$username:display_name" "$display_name" > /dev/null
    
    if [ ! -z "$extension" ]; then
        docker exec redis redis-cli SET "user:$username:extension" "$extension" > /dev/null
        docker exec redis redis-cli SET "extension:$extension" "$username" > /dev/null
    fi
    
    echo ""
    echo -e "${GREEN}✓ User created successfully${NC}"
    echo ""
    echo "Username: $username"
    echo "Password: $password"
    echo "Display Name: $display_name"
    echo "Extension: $extension"
    
    show_menu
}

list_users() {
    echo ""
    echo -e "${YELLOW}Registered Users${NC}"
    echo ""
    
    python3 << EOF
import json
from datetime import datetime

try:
    with open('$USERS_FILE', 'r') as f:
        users = json.load(f)
    
    if not users:
        print("No users found")
    else:
        print(f"{'Username':<20} {'Display Name':<25} {'Extension':<12} {'Created':<20}")
        print("-" * 80)
        for user in users:
            username = user.get('username', '')
            display = user.get('display_name', '')
            ext = user.get('extension', '')
            created = user.get('created', '')[:10]
            print(f"{username:<20} {display:<25} {ext:<12} {created:<20}")
except Exception as e:
    print(f"Error: {e}")
EOF
    
    show_menu
}

delete_user() {
    echo ""
    echo -e "${YELLOW}Delete User${NC}"
    echo ""
    
    read -p "Username to delete: " username
    if [ -z "$username" ]; then
        echo -e "${RED}Username cannot be empty${NC}"
        show_menu
        return
    fi
    
    read -p "Are you sure you want to delete user '$username'? (y/n): " confirm
    if [ "$confirm" != "y" ]; then
        echo "Cancelled"
        show_menu
        return
    fi
    
    # Remove from JSON
    python3 << EOF
import json

try:
    with open('$USERS_FILE', 'r') as f:
        users = json.load(f)
    
    users = [u for u in users if u.get('username') != '$username']
    
    with open('$USERS_FILE', 'w') as f:
        json.dump(users, f, indent=2)
    
    print("User removed from database")
except Exception as e:
    print(f"Error: {e}")
EOF
    
    # Remove from Redis
    docker exec redis redis-cli DEL "user:$username:password" > /dev/null
    docker exec redis redis-cli DEL "user:$username:display_name" > /dev/null
    docker exec redis redis-cli DEL "user:$username:extension" > /dev/null
    
    echo -e "${GREEN}✓ User deleted successfully${NC}"
    
    show_menu
}

change_password() {
    echo ""
    echo -e "${YELLOW}Change Password${NC}"
    echo ""
    
    read -p "Username: " username
    if [ -z "$username" ]; then
        echo -e "${RED}Username cannot be empty${NC}"
        show_menu
        return
    fi
    
    read -sp "New Password: " password
    echo ""
    if [ -z "$password" ]; then
        echo -e "${RED}Password cannot be empty${NC}"
        show_menu
        return
    fi
    
    # Update JSON
    python3 << EOF
import json

try:
    with open('$USERS_FILE', 'r') as f:
        users = json.load(f)
    
    for user in users:
        if user.get('username') == '$username':
            user['password'] = '$password'
            break
    
    with open('$USERS_FILE', 'w') as f:
        json.dump(users, f, indent=2)
except Exception as e:
    print(f"Error: {e}")
EOF
    
    # Update Redis
    docker exec redis redis-cli SET "user:$username:password" "$password" > /dev/null
    
    echo -e "${GREEN}✓ Password changed successfully${NC}"
    
    show_menu
}

export_credentials() {
    echo ""
    echo -e "${YELLOW}Export User Credentials${NC}"
    echo ""
    
    OUTPUT_FILE="$PROJECT_DIR/user-credentials-$(date +%Y%m%d-%H%M%S).txt"
    
    source $PROJECT_DIR/.env
    
    cat > "$OUTPUT_FILE" << CREDS
========================================
Drachtio WebRTC - User Credentials
Generated: $(date)
========================================

Server Domain: $DOMAIN
WebSocket URL: wss://$DOMAIN:8443

Users:
CREDS
    
    python3 << EOF >> "$OUTPUT_FILE"
import json

try:
    with open('$USERS_FILE', 'r') as f:
        users = json.load(f)
    
    for user in users:
        print(f"""
Username: {user.get('username')}
Password: {user.get('password')}
Display Name: {user.get('display_name', 'N/A')}
Extension: {user.get('extension', 'N/A')}
----------------------------------------""")
except Exception as e:
    print(f"Error: {e}")
EOF
    
    echo -e "${GREEN}✓ Credentials exported to: $OUTPUT_FILE${NC}"
    cat "$OUTPUT_FILE"
    
    show_menu
}

# Main
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root or with sudo${NC}"
    exit 1
fi

if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}Drachtio project not found at $PROJECT_DIR${NC}"
    exit 1
fi

cd "$PROJECT_DIR"
show_menu