# mod_audio_stream AI Example App

This is a simple Node.js application that demonstrates how to use FreeSWITCH's `mod_audio_stream` in combination with **Outbound Event Socket (ESL)** to build a bidirectional AI streaming architecture.

## How it works

1. **Web UI (Port 3000)**: Serves a WebRTC SIP Softphone to your browser so you can test calling.
2. **ESL Server (Port 8085)**: Listens for incoming Outbound ESL connections from FreeSWITCH. When a call connects, it answers the call and executes the `uuid_audio_stream` command.
3. **WebSocket Server (Port 8080)**: Listens for raw audio packets streamed directly from FreeSWITCH.

## Running the Example

### 1. Start this Node.js App
Make sure you have Node.js installed on your host machine, then install the dependencies and run the server:
```bash
npm install
node server.js
```
*You should see the Web UI, ESL Server, and WebSocket server start listening.*

### 2. Open the SIP UI in your Browser
Open a web browser (or two!) and navigate to:
**http://localhost:3000**

You will see a simple WebRTC SIP client.
- **WebSocket URI**: `ws://localhost:5066`
- **SIP URI**: `sip:1000@localhost` (You can use `1001` in the second browser tab)
- **Password**: `1234` (FreeSWITCH default)

Click **Connect & Register**. If FreeSWITCH is running, it will show "Registered Successfully".

### 3. Configure FreeSWITCH Dialplan
In your FreeSWITCH container (or mounted config), add a test dialplan extension that points to this app. 
For example, in `/usr/local/freeswitch/etc/freeswitch/dialplan/default.xml`, add this inside the `<context name="default">`:

```xml
<extension name="ai_test">
  <condition field="destination_number" expression="^9999$">
    <action application="answer"/>
    <!-- host.docker.internal points to your host machine where this Node app is running -->
    <action application="socket" data="host.docker.internal:8085 async full"/>
  </condition>
</extension>
```
*(After modifying the dialplan, run `fs_cli -x reloadxml`)*

### 4. Test the Stream
In the Web UI, type `9999` in the Dial Target box and click **Make Call**.

**What will happen:**
1. FreeSWITCH will hit the dialplan and connect to your Node.js app on port `8085`.
2. The Node.js app will tell FreeSWITCH to start `uuid_audio_stream`.
3. FreeSWITCH will open a WebSocket connection to `ws://host.docker.internal:8080/stream` and begin sending the caller's audio bytes.
4. Your Node.js console will log that it is receiving audio packets!
