#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  clear.sh — truncate Docker container logs for Enjoys Voice
#
#  Empties the json-file logs of the stack's containers WITHOUT
#  recreating them (containers keep running). Useful when logs have
#  grown large; the json-file rotation in docker-compose.prod.yml
#  caps NEW logs, this wipes whatever already accumulated.
#
#  Usage:
#    ./clear.sh                       # clear ALL voip-stack containers
#    ./clear.sh drachtio-freeswitch   # clear one container
#    ./clear.sh callnet-api callnet-web   # clear several
#
#  Note: the log files live under /var/lib/docker and are owned by
#  root, so this uses sudo automatically when needed.
# ════════════════════════════════════════════════════════════════
set -euo pipefail

PROJECT="voip-stack"   # matches `name:` in the compose files

# ── Colors (disabled if not a TTY) ───────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=''; RED=''; GREEN=''; YELLOW=''; CYAN=''; RESET=''
fi
info() { printf '%s\n' "${CYAN}$*${RESET}"; }
warn() { printf '%s\n' "${YELLOW}$*${RESET}"; }
err()  { printf '%s\n' "${RED}$*${RESET}" >&2; }
ok()   { printf '%s\n' "${GREEN}$*${RESET}"; }

# ── Pre-flight: docker available ─────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  err "Docker is not installed or not on PATH."
  exit 1
fi

# ── Resolve target containers: args, else all in the project ─────
declare -a containers
if [[ $# -gt 0 ]]; then
  containers=("$@")
else
  mapfile -t containers < <(
    docker ps -a \
      --filter "label=com.docker.compose.project=${PROJECT}" \
      --format '{{.Names}}'
  )
fi

if [[ ${#containers[@]} -eq 0 ]]; then
  warn "No containers found for project '${PROJECT}'. Is the stack up?"
  exit 0
fi

# ── Pick a way to write to the root-owned log files ──────────────
SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    warn "Not root and 'sudo' not found — truncation may fail (permission denied)."
  fi
fi

printf '%s\n' "${BOLD}Clearing logs for ${#containers[@]} container(s)…${RESET}"

cleared=0
for c in "${containers[@]}"; do
  logpath="$(docker inspect --format '{{.LogPath}}' "$c" 2>/dev/null || true)"
  if [[ -z "$logpath" ]]; then
    warn "  skip ${c} (not found / no log file)"
    continue
  fi
  if $SUDO truncate -s 0 "$logpath" 2>/dev/null; then
    ok "  cleared ${c}"
    cleared=$((cleared + 1))
  else
    err "  failed ${c} (could not truncate ${logpath})"
  fi
done

info "Done — ${cleared}/${#containers[@]} container log(s) cleared."
