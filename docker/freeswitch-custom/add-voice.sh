#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# add-voice.sh — download a Piper neural voice and install it into the
#                enjoys-freeswitch image / running container.
#
# Piper ships HUNDREDS of voices (many languages, speakers and qualities). The
# catalog is published here:
#     https://rhasspy.github.io/piper-samples/voices.json
#
# Every voice has a KEY of the form  "<language>-<voice>-<quality>"
#     e.g.  en_US-amy-medium ,  hi_IN-pratham-medium ,  fr_FR-siwis-low
# and lives on HuggingFace at a DETERMINISTIC path:
#     rhasspy/piper-voices/resolve/main/<family>/<language>/<voice>/<quality>/<key>.onnx
# where <family> is the language code BEFORE the underscore  (en_US -> en).
# Each voice is two files: <key>.onnx (the model) and <key>.onnx.json (config).
#
# The user supplies:  language, voice and (optionally) quality + speaker.
#   • quality defaults to "medium"
#   • speaker defaults to "default" (only relevant for multi-speaker models)
#
# Usage:
#   ./add-voice.sh --language en_US --voice ryan                # quality=medium
#   ./add-voice.sh -l hi_IN -v pratham -q medium
#   ./add-voice.sh en_US amy medium                             # positional shorthand
#   ./add-voice.sh --list en_US                                 # list voices for a language
#
# Options:
#   -l, --language CODE   Language code, e.g. en_US, hi_IN, fr_FR.   (required)
#   -v, --voice    NAME   Voice/speaker-model name, e.g. amy, ryan.  (required)
#   -q, --quality  Q      x_low | low | medium | high               (default: medium)
#   -s, --speaker  NAME   Speaker for multi-speaker models          (default: default)
#   -c, --container NAME  Running FS container to live-install into  (default: freeswitch-piper-test)
#                         Pass  -c ''  to only download (no docker).
#   -d, --dir DIR         Local download/cache dir                   (default: ./voices)
#       --list CODE       List catalog voices for a language and exit
#       --force           Re-download even if the files already exist
#   -h, --help            Show this help and exit
#
# After adding a voice, point the app at it (the TTS engine/voice is env-driven):
#     TTS_ENGINE=tts_commandline
#     TTS_VOICE=<key>            # e.g. en_US-ryan-medium
# in the repo .env, then restart the app.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CATALOG_URL="https://rhasspy.github.io/piper-samples/voices.json"
HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"
VALID_QUALITIES="x_low low medium high"

QUALITY="medium"
SPEAKER="default"
CONTAINER="freeswitch-piper-test"
DIR="./voices"
FORCE=0
LANGUAGE=""
VOICE=""
LIST_LANG=""

cd "$(dirname "$0")"
CATALOG_CACHE=".voices-catalog.json"

# ── Colours (disabled when not a TTY) ────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=''; RED=''; GREEN=''; YELLOW=''; CYAN=''; RESET=''
fi
info()  { printf '%s\n' "${CYAN}$*${RESET}"; }
warn()  { printf '%s\n' "${YELLOW}$*${RESET}" >&2; }
err()   { printf '%s\n' "${RED}$*${RESET}" >&2; }
ok()    { printf '%s\n' "${GREEN}$*${RESET}"; }

usage() { sed -n '2,55p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ── Pick a python interpreter for OPTIONAL catalog parsing (graceful fallback) ─
PY=""
if command -v python3 >/dev/null 2>&1; then PY="python3";
elif command -v python >/dev/null 2>&1; then PY="python"; fi

# ── Parse args (flags + up to 3 positionals: language voice quality) ─────────
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -l|--language) LANGUAGE="${2:?}"; shift 2 ;;
    -v|--voice)    VOICE="${2:?}";    shift 2 ;;
    -q|--quality)  QUALITY="${2:?}";  shift 2 ;;
    -s|--speaker)  SPEAKER="${2:?}";  shift 2 ;;
    -c|--container) CONTAINER="${2-}"; shift 2 ;;
    -d|--dir)      DIR="${2:?}";      shift 2 ;;
    --list)        LIST_LANG="${2:?}"; shift 2 ;;
    --force)       FORCE=1; shift ;;
    -h|--help)     usage 0 ;;
    -*)            err "Unknown option: $1"; usage 1 ;;
    *)             POSITIONAL+=("$1"); shift ;;
  esac
done
[[ ${#POSITIONAL[@]} -ge 1 && -z "$LANGUAGE" ]] && LANGUAGE="${POSITIONAL[0]}"
[[ ${#POSITIONAL[@]} -ge 2 && -z "$VOICE"    ]] && VOICE="${POSITIONAL[1]}"
[[ ${#POSITIONAL[@]} -ge 3                    ]] && QUALITY="${POSITIONAL[2]}"

# ── Fetch + cache the catalog (best-effort; only required for --list/validation) ─
fetch_catalog() {
  [[ -s "$CATALOG_CACHE" ]] && return 0
  curl -fsSL "$CATALOG_URL" -o "$CATALOG_CACHE" 2>/dev/null || return 1
  [[ -s "$CATALOG_CACHE" ]]
}

# ── --list: print every voice for a language code/family, then exit ──────────
if [[ -n "$LIST_LANG" ]]; then
  [[ -z "$PY" ]] && { err "Listing needs python3/python on PATH."; exit 1; }
  fetch_catalog || { err "Could not download the voice catalog."; exit 1; }
  info "${BOLD}Piper voices for '${LIST_LANG}':${RESET}"
  "$PY" - "$CATALOG_CACHE" "$LIST_LANG" <<'PYEOF'
import json, sys
cat = json.load(open(sys.argv[1], encoding="utf-8"))
lang = sys.argv[2]
rows = [(k, v["quality"], v.get("num_speakers", 1), v["language"]["name_english"])
        for k, v in cat.items()
        if lang in (v["language"]["code"], v["language"]["family"])]
for k, q, n, en in sorted(rows):
    extra = f", speakers={n}" if n > 1 else ""
    print(f"  {k:<34} quality={q}{extra}  [{en}]")
if not rows:
    print(f"  (no voices found for '{lang}' — try a code like en_US, hi_IN, fr_FR)")
PYEOF
  exit 0
fi

# ── Validate required inputs ─────────────────────────────────────────────────
[[ -z "$LANGUAGE" || -z "$VOICE" ]] && { err "Both --language and --voice are required."; usage 1; }
case " $VALID_QUALITIES " in
  *" $QUALITY "*) ;;
  *) err "Invalid --quality '$QUALITY' (use one of: $VALID_QUALITIES)"; exit 1 ;;
esac

KEY="${LANGUAGE}-${VOICE}-${QUALITY}"
FAMILY="${LANGUAGE%%_*}"                       # en_US -> en
RELPATH="${FAMILY}/${LANGUAGE}/${VOICE}/${QUALITY}"
ONNX_REL="${RELPATH}/${KEY}.onnx"              # default deterministic path

# ── Best-effort catalog validation + speaker resolution ──────────────────────
SPEAKER_ID="-1"   # -1 = single-speaker / unknown; >=0 = resolved multi-speaker id
if [[ -n "$PY" ]] && fetch_catalog; then
  LOOKUP="$("$PY" - "$CATALOG_CACHE" "$KEY" "$SPEAKER" <<'PYEOF'
import json, sys
cat = json.load(open(sys.argv[1], encoding="utf-8"))
key, spk = sys.argv[2], sys.argv[3]
v = cat.get(key)
if v is None:                      # accept an alias as the key too
    for k, val in cat.items():
        if key in val.get("aliases", []):
            v, key = val, k
            break
if v is None:
    print("NOTFOUND"); sys.exit(0)
onnx = next((f for f in v["files"] if f.endswith(".onnx")), "")
m = v.get("speaker_id_map") or {}
sid = "-1"
if spk and spk != "default" and m:
    sid = str(m.get(spk, "-2"))    # -2 = named speaker not in this model
print("OK")
print(key)
print(onnx)
print(v.get("num_speakers", 1))
print(sid)
print(",".join(sorted(m.keys())))
PYEOF
)"
  if [[ "$(printf '%s' "$LOOKUP" | head -n1)" == "OK" ]]; then
    KEY="$(printf '%s' "$LOOKUP" | sed -n '2p')"
    ONNX_REL="$(printf '%s' "$LOOKUP" | sed -n '3p')"
    NUM_SPK="$(printf '%s' "$LOOKUP" | sed -n '4p')"
    SPEAKER_ID="$(printf '%s' "$LOOKUP" | sed -n '5p')"
    SPK_LIST="$(printf '%s' "$LOOKUP" | sed -n '6p')"
    if [[ "$SPEAKER_ID" == "-2" ]]; then
      err "Speaker '$SPEAKER' not found in $KEY. Available: ${SPK_LIST:-<none>}"
      exit 1
    fi
  else
    warn "Voice key '$KEY' not found in the catalog — trying the deterministic path anyway."
  fi
else
  warn "Catalog/python unavailable — using the deterministic path (no validation)."
fi

ONNX_JSON_REL="${ONNX_REL}.json"
ONNX_URL="${HF_BASE}/${ONNX_REL}"
ONNX_JSON_URL="${HF_BASE}/${ONNX_JSON_REL}"

mkdir -p "$DIR"
ONNX_OUT="${DIR}/${KEY}.onnx"
ONNX_JSON_OUT="${DIR}/${KEY}.onnx.json"

# ── Download the model + its config (curl -fL fails loudly on a 404) ─────────
download() {  # $1=url  $2=out
  if [[ -s "$2" && $FORCE -eq 0 ]]; then
    info "  ✔ cached  $(basename "$2")"
    return 0
  fi
  info "  ↓ $1"
  curl -fL --progress-bar -o "$2" "$1" || {
    err "Download failed: $1"
    err "Check the language/voice/quality — list options with:  ./add-voice.sh --list ${LANGUAGE}"
    rm -f "$2"
    exit 1
  }
}

info "${BOLD}Adding Piper voice:${RESET} ${KEY}  (quality=${QUALITY})"
download "$ONNX_URL"      "$ONNX_OUT"
download "$ONNX_JSON_URL" "$ONNX_JSON_OUT"
ok "✅ Downloaded to ${DIR}/"

# ── Live-install into the running container (no rebuild needed) ───────────────
INSTALLED=0
if [[ -n "$CONTAINER" ]]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
    info "▶ Installing into container '${CONTAINER}':/opt/piper/voices/"
    docker cp "$ONNX_OUT"      "${CONTAINER}:/opt/piper/voices/${KEY}.onnx"
    docker cp "$ONNX_JSON_OUT" "${CONTAINER}:/opt/piper/voices/${KEY}.onnx.json"
    # Smoke-test: synthesize a word so a broken model is caught now, not on a call.
    if docker exec "$CONTAINER" sh -c \
        "echo 'voice check' | /opt/piper/piper --model /opt/piper/voices/${KEY}.onnx --espeak_data /opt/piper/espeak-ng-data --output_file /tmp/_voicecheck.wav && test -s /tmp/_voicecheck.wav && rm -f /tmp/_voicecheck.wav" \
        >/dev/null 2>&1; then
      ok "✅ Piper synthesized OK with ${KEY} inside ${CONTAINER}"
      INSTALLED=1
    else
      warn "Installed the files but the Piper smoke-test failed — check 'docker logs ${CONTAINER}'."
    fi
  else
    warn "Container '${CONTAINER}' is not running — skipped live install (files are cached in ${DIR})."
  fi
fi

# ── Next steps ───────────────────────────────────────────────────────────────
cat <<EOF

${BOLD}Use this voice${RESET}
  Set the env-driven TTS in the repo .env, then restart the app:
      TTS_ENGINE=tts_commandline
      TTS_VOICE=${KEY}
EOF

if [[ "$SPEAKER_ID" =~ ^[0-9]+$ ]] && [[ "$SPEAKER_ID" -ge 0 ]]; then
  cat <<EOF

  This is a MULTI-SPEAKER model and you chose speaker '${SPEAKER}' (id ${SPEAKER_ID}).
  Piper uses speaker 0 unless told otherwise; to pin '${SPEAKER}', add
      --speaker ${SPEAKER_ID}
  to the piper command in  config/tts_commandline.conf.xml.
EOF
fi

cat <<EOF

${BOLD}Make it permanent${RESET} (docker cp is lost when the container is recreated)
  • Bake it into the image:   PIPER_VOICE=${KEY} PIPER_VOICE_PATH=${RELPATH} ./run.sh
  • …or bind-mount the cache. Seed it once so the baked voices aren't hidden:
      docker cp ${CONTAINER}:/opt/piper/voices/. ${DIR}/
    then add to the FS service in docker-compose.test.yml:
      - ./voices:/opt/piper/voices:ro
EOF

[[ $INSTALLED -eq 1 ]] && ok "
Done — ${KEY} is live now. No app restart needed unless you change TTS_VOICE."
