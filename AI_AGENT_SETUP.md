# AI Voice Agent — Full Setup

This guide walks you through configuring a **per-user AI voice agent**: a
real-time `speech → LLM → speech` pipeline that answers a call, converses with
the caller, and is configured entirely from the dashboard. It builds on the media-streaming
feature ([SETUP.md → "PSTN → Browser via Twilio Media Streams"](SETUP.md)) — read
that first if you have not set up streaming yet.

> **TL;DR** — drop in the provider API keys, flip `MEDIA_STREAM_AI_ENABLED=true`,
> create an agent under **Admin → AI Agents**, then attach it to a call (offline
> DID default, a routing rule, or an IVR node).

---

## 1. How it works

```
Caller (PSTN) ─▶ Twilio / Plivo number
     │  webhook → CallNet decides the call is an AI call
     ▼
<Connect><Stream wss://…/media?token=…&agentId=42>   (μ-law 8 kHz, two-way)
     ▼
Media Stream WS ──▶ resolve agent #42 from DB (cached)
                    │
                    ├─ STT   (Speechmatics | Deepgram)   what the caller said
                    ├─ LLM   (OpenAI | Gemini)           the reply
                    └─ TTS   (Sarvam | Deepgram | Speechmatics)  the voice
                         │
                         ▼  μ-law 8 kHz back down the same stream
```

- An **agent** is just configuration — it names *which* STT/LLM/TTS provider,
  model, voice, system prompt and greeting to use. **No API keys are stored on
  the agent row;** the runtime reads them from its own environment, so a leaked
  agent record never exposes a credential.
- Agents are **owner-scoped** (self-service). A user only ever manages the
  agents they own.
- The agent runtime is **event-driven**: editing an agent in the dashboard fires
  a Postgres `LISTEN/NOTIFY` that invalidates the runtime cache, so changes take
  effect on the **next call** with no restart.
- Works over **both Twilio and Plivo** media streams (see §6).

---

## 2. Provider API keys

The agent only *selects* a provider; the matching key must exist in the **Node
engine's** environment. Add to `.env` (only the providers you actually use):

```bash
# ─── AI voice agent — master switch ───────────────────
MEDIA_STREAM_AI_ENABLED=true            # let AI answer (offline path / ai routes)
MEDIA_STREAM_AI_LANGUAGE=en             # default language when an agent leaves it blank

# ─── Speech-to-text (STT) ─────────────────────────────
SPEECHMATICS_API_KEY=                   # provider "speechmatics"
SPEECHMATICS_RT_URL=                    # optional region endpoint (blank = default)
DEEPGRAM_API_KEY=                       # provider "deepgram" (STT *and* TTS)

# ─── LLM (the reply) ──────────────────────────────────
OPENAI_API_KEY=                         # provider "openai"  (e.g. gpt-4o-mini)
GEMINI_API_KEY=                         # provider "gemini"  (e.g. gemini-1.5-flash)

# ─── Text-to-speech (TTS / the voice) ─────────────────
SARVAM_API_KEY=                         # provider "sarvam"
# DEEPGRAM_API_KEY (above) also powers Deepgram TTS
# SPEECHMATICS_API_KEY (above) also powers Speechmatics TTS
```

| Provider | Used for | Key | Notes |
|----------|----------|-----|-------|
| Speechmatics | STT, TTS | `SPEECHMATICS_API_KEY` | Real-time ASR; feeds μ-law straight in (no transcode) |
| Deepgram | STT, TTS | `DEEPGRAM_API_KEY` | TTS returns μ-law 8 kHz directly |
| OpenAI | LLM | `OPENAI_API_KEY` | `gpt-4o-mini` is a good default |
| Gemini | LLM | `GEMINI_API_KEY` | `gemini-1.5-flash` |
| Sarvam | TTS | `SARVAM_API_KEY` | WAV → resampled to 8 kHz μ-law |

> All providers are called over plain HTTPS / WebSocket (`fetch` + `ws`) — there
> are **no extra SDK dependencies** to install.

---

## 3. Create an agent (dashboard)

Open **Admin → AI Agents → New agent** and fill in:

| Field | What it does | Options / default |
|-------|--------------|-------------------|
| **Name** | Label shown in pickers | — |
| **Greeting** | Spoken once on connect (blank = silent) | — |
| **Language** | Passed to STT/TTS | `en` (default) |
| **STT provider** | Transcribes the caller | `speechmatics` (default) · `deepgram` |
| **LLM provider** | Generates the reply | `openai` (default) · `gemini` |
| **LLM model** | Model id for the LLM | `gpt-4o-mini` (default) |
| **System prompt** | Persona / instructions for the LLM | — |
| **Temperature** | LLM creativity, `0`–`2` | `0.7` (default) |
| **TTS provider** | Speaks the reply | `sarvam` · `deepgram` (default) · `speechmatics` |
| **TTS voice** | Provider voice id | provider-specific |
| **Enabled** | Off = ignored by routing | on (default) |

Pick a provider only if its key (§2) is set, otherwise that leg will fail at
call time.

### REST equivalent (Go API)

Owner-scoped, mounted under `/api/g` (admin-gated writes):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/g/ai-agents` | List your agents |
| POST | `/api/g/ai-agents` | Create |
| GET | `/api/g/ai-agents/:id` | Fetch one |
| PUT | `/api/g/ai-agents/:id` | Update |
| DELETE | `/api/g/ai-agents/:id` | Delete |

---

## 4. Attach the agent to a call

There are **three** ways to send a call to an agent. They are resolved in this
order when a call is routed to the AI branch:

```
1. Routing rule   (explicit override — wins)
2. Owner default  (the owner's enabled agent for an offline DID)
```

### A) Offline DID default

When an inbound call to an owner's DID falls through to the **AI branch** (owner
offline, no forward — see the decision chain in
[SETUP.md](SETUP.md#decision-chain-what-the-caller-gets)) and
`MEDIA_STREAM_AI_ENABLED=true`, the owner's enabled agent answers
automatically. Nothing else to configure beyond creating one enabled agent.

### B) Routing rule

**Admin → Routing → New rule** → *Send to* = **AI agent** → pick the agent.
This is an explicit override and takes precedence over the owner default for the
matched number. Stored as `destinationType: "ai_agent"`, `destinationValue: <agentId>`.

### C) IVR "AI agent" node

In the **IVR builder**, drag the **AI agent** block onto the canvas, wire a
branch into it, and pick the agent in the inspector. It is a **terminal** block —
the agent owns the call from that point on.

---

## 5. Turn it on & test

```bash
# Node engine with streaming + AI enabled
MEDIA_STREAM_ENABLED=true MEDIA_STREAM_AI_ENABLED=true bun dev
# startup log: Media: enabled (mode=auto, ws :3003)
#              PSTN: twilio (enabled)
```

1. Create one **enabled** agent (§3) with a greeting and a system prompt.
2. Make sure the called DID maps to that owner (offline path) **or** add a
   routing rule / IVR node pointing at the agent (§4).
3. Call the number while the owner is **offline** (or via the rule/IVR path).
4. You should hear the greeting, then a back-and-forth conversation.

Quick webhook sanity check (no real call) — the TwiML/PXML should contain a
`<Stream>` whose URL carries `agentId=`:

```bash
curl -s -X POST https://your-domain.com/api/n/media/voice \
  -d 'To=+14155550123' -d 'From=+14155559999'
```

---

## 6. Stream AI audio over Plivo

The agent path is provider-agnostic. To carry calls over **Plivo** instead of
Twilio:

```bash
# either var works; MEDIA_STREAM_PROVIDER wins if both are set
MEDIA_STREAM_PROVIDER=plivo      # twilio (default) | plivo
SIP_TRUNK_PROVIDER=plivo         # also selects the outbound trunk provider
```

What changes automatically:

- The voice webhook returns **Plivo XML** (`<Stream bidirectional>`) instead of
  TwiML.
- Inbound/outbound audio frames are decoded/encoded with the Plivo media
  protocol (`playAudio` / `clearAudio` / `checkpoint`).
- Plivo has **no native custom-parameter** field, so the resolved `agentId` is
  passed on the stream **URL query string** and lifted back out on the WS
  handshake — agent resolution works identically to Twilio.

Point your **Plivo number's Answer URL** at
`https://your-domain.com/api/n/media/voice` (HTTP POST), exactly like Twilio.

---

## 7. Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Call connects but silence | Provider key missing/invalid for the agent's STT/LLM/TTS, or `MEDIA_STREAM_AI_ENABLED` not `true` |
| Caller heard but no reply | LLM key wrong (`OPENAI_API_KEY` / `GEMINI_API_KEY`) or model id invalid |
| Reply text but no voice | TTS key/voice wrong for the selected `ttsProvider` |
| AI never triggers on a DID | Owner was **online**, a forward target was set, or no enabled agent exists for the owner |
| Edits don't take effect | Postgres `LISTEN/NOTIFY` not reaching the engine — check the engine logs; a restart always reloads |
| Agent picker empty in Routing/IVR | No agents created yet, or you are signed in as a different owner |

---

See also: [SETUP.md](SETUP.md) (media streaming, ports, env), and
[ARCHITECTURE.md](ARCHITECTURE.md) for call-flow internals.
