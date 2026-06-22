#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  run.sh — interactive Docker Compose helper for Enjoys Voice
#
#  Lets you pick:
#    1. environment  → dev (docker/docker-compose.dev.yml)
#                      prod (docker/docker-compose.prod.yml)
#    2. action       → up / build / down / restart / logs / ps /
#                      pull / cache-clean / etc.
#    3. service(s)   → all, or one OR MORE specific services (read
#                      live from the chosen compose file; compose
#                      acts on the selected services in parallel)
#
#  Usage:
#    ./run.sh                    # fully interactive
#    ./run.sh dev up             # skip the first prompts (env + action)
#    ./run.sh prod build api     # env + action + one service
#    ./run.sh prod build api web # env + action + multiple services
# ════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Resolve paths relative to THIS script (run from anywhere) ────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_FILE="$SCRIPT_DIR/docker/docker-compose.dev.yml"
PROD_FILE="$SCRIPT_DIR/docker/docker-compose.prod.yml"
PROD_ENV="$SCRIPT_DIR/docker/.env"

# ── Colors (disabled if not a TTY) ───────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; RESET=''
fi

info()  { printf '%s\n' "${CYAN}$*${RESET}"; }
warn()  { printf '%s\n' "${YELLOW}$*${RESET}"; }
err()   { printf '%s\n' "${RED}$*${RESET}" >&2; }
ok()    { printf '%s\n' "${GREEN}$*${RESET}"; }
title() { printf '\n%s\n' "${BOLD}${BLUE}$*${RESET}"; }

# ── Pre-flight: docker + compose available ───────────────────────
if ! command -v docker >/dev/null 2>&1; then
  err "Docker is not installed or not on PATH."
  exit 1
fi
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  err "Neither 'docker compose' nor 'docker-compose' is available."
  exit 1
fi

# ── Generic numbered-menu picker ─────────────────────────────────
#   choose "Prompt" VAR opt1 opt2 ...
choose() {
  local prompt="$1"; local __out="$2"; shift 2
  local options=("$@") i choice
  title "$prompt"
  for i in "${!options[@]}"; do
    printf '  %s%2d%s) %s\n' "$BOLD" "$((i + 1))" "$RESET" "${options[$i]}"
  done
  while true; do
    printf '%s' "${DIM}Enter number [1-${#options[@]}]: ${RESET}"
    read -r choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#options[@]} )); then
      printf -v "$__out" '%s' "${options[$((choice - 1))]}"
      return 0
    fi
    warn "Invalid selection. Try again."
  done
}

# ── Multi-select numbered-menu picker ────────────────────────────
#   choose_multi "Prompt" ARRAY_VAR opt1 opt2 ...
#   Lets the user pick ONE OR MANY options at once — enter the
#   numbers separated by spaces or commas (e.g. "2 5 8" or "2,5,8"),
#   or "a"/"all" to select every option. The chosen option strings
#   are stored (de-duplicated, in menu order) in the named array.
choose_multi() {
  local prompt="$1"; local -n __choose_ref="$2"; shift 2
  local options=("$@") i line tok idx
  title "$prompt"
  for i in "${!options[@]}"; do
    printf '  %s%2d%s) %s\n' "$BOLD" "$((i + 1))" "$RESET" "${options[$i]}"
  done
  printf '%s\n' "${DIM}Pick one or many — e.g. '2 5 8' or '2,5,8'  (a = all).${RESET}"
  while true; do
    printf '%s' "${DIM}Enter number(s) [1-${#options[@]}]: ${RESET}"
    read -r line
    line="${line//,/ }"                       # commas → spaces
    local -a picks=(); local valid=1
    if [[ "$line" =~ ^[[:space:]]*[Aa]([Ll][Ll])?[[:space:]]*$ ]]; then
      picks=("${!options[@]}")                 # every index
    else
      for tok in $line; do
        if [[ "$tok" =~ ^[0-9]+$ ]] && (( tok >= 1 && tok <= ${#options[@]} )); then
          picks+=("$((tok - 1))")
        else
          valid=0; break
        fi
      done
    fi
    if (( valid )) && (( ${#picks[@]} > 0 )); then
      __choose_ref=()
      for idx in "${picks[@]}"; do
        # de-dupe while preserving menu order
        local dup=0 seen
        for seen in "${__choose_ref[@]}"; do
          [[ "$seen" == "${options[$idx]}" ]] && { dup=1; break; }
        done
        (( dup )) || __choose_ref+=("${options[$idx]}")
      done
      return 0
    fi
    warn "Invalid selection. Try again."
  done
}

confirm() {
  local prompt="$1" reply
  printf '%s' "${YELLOW}${prompt} [y/N]: ${RESET}"
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

# ════════════════════════════════════════════════════════════════
#  STEP 1 — Environment
# ════════════════════════════════════════════════════════════════
ENV_ARG="${1:-}"; ACTION_ARG="${2:-}"; SERVICE_ARG="${3:-}"

case "$ENV_ARG" in
  dev|prod) ENV_CHOICE="$ENV_ARG" ;;
  *)        choose "Which environment?" ENV_CHOICE "dev" "prod" ;;
esac

if [[ "$ENV_CHOICE" == "dev" ]]; then
  COMPOSE_FILE="$DEV_FILE"
  COMPOSE_ARGS=(-f "$COMPOSE_FILE")
else
  COMPOSE_FILE="$PROD_FILE"
  COMPOSE_ARGS=(-f "$COMPOSE_FILE")
  # Prod uses an env_file (.env). Warn (don't block) if missing.
  if [[ -f "$PROD_ENV" ]]; then
    COMPOSE_ARGS+=(--env-file "$PROD_ENV")
  else
    warn "prod/.env not found — compose will use shell env / defaults."
  fi
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  err "Compose file not found: $COMPOSE_FILE"
  exit 1
fi

compose() { "${DC[@]}" "${COMPOSE_ARGS[@]}" "$@"; }
ok "Using: ${BOLD}${COMPOSE_FILE#$SCRIPT_DIR/}${RESET}"

# ════════════════════════════════════════════════════════════════
#  STEP 2 — Action
# ════════════════════════════════════════════════════════════════
ACTIONS=(
  "up                — build (if needed) + start in background"
  "up-fresh          — recreate containers (--force-recreate)"
  "build             — build images only"
  "build-no-cache    — build images from scratch (no cache)"
  "rebuild           — build --no-cache then up -d --force-recreate"
  "down              — stop + remove containers"
  "down-volumes      — stop + remove containers AND volumes (DATA LOSS)"
  "restart           — restart running containers"
  "stop              — stop without removing"
  "start             — start existing stopped containers"
  "logs              — follow logs"
  "ps                — list containers + status"
  "pull              — pull latest base images"
  "exec-sh           — open a shell in a service"
  "config            — validate + render the merged compose config"
  "prune-cache       — remove Docker build cache (builder prune)"
  "prune-system      — remove unused images/containers/networks (system prune)"
)

if [[ -n "$ACTION_ARG" ]]; then
  ACTION="$ACTION_ARG"
else
  choose "What do you want to do?" ACTION_LINE "${ACTIONS[@]}"
  ACTION="${ACTION_LINE%% *}"   # first word = the action key
fi

# ════════════════════════════════════════════════════════════════
#  Actions that DON'T need a service selection — handle + exit
# ════════════════════════════════════════════════════════════════
case "$ACTION" in
  prune-cache)
    warn "This removes the Docker BUILD CACHE (not your images/volumes)."
    confirm "Proceed with 'docker builder prune'?" && docker builder prune -f || info "Cancelled."
    exit 0
    ;;
  prune-system)
    warn "This removes ALL unused images, stopped containers, and networks."
    confirm "Proceed with 'docker system prune'?" && docker system prune -f || info "Cancelled."
    exit 0
    ;;
  config)
    compose config
    exit 0
    ;;
  ps)
    compose ps
    exit 0
    ;;
  pull)
    compose pull
    exit 0
    ;;
  down)
    confirm "Stop + remove containers for ${ENV_CHOICE}?" && compose down || info "Cancelled."
    exit 0
    ;;
  down-volumes)
    err "WARNING: this DELETES volumes (Postgres data, recordings, etc.)."
    confirm "Are you SURE you want to remove volumes for ${ENV_CHOICE}?" \
      && compose down -v || info "Cancelled."
    exit 0
    ;;
esac

# ════════════════════════════════════════════════════════════════
#  STEP 3 — Service selection (live from the compose file)
# ════════════════════════════════════════════════════════════════
mapfile -t SERVICES < <(compose config --services 2>/dev/null | sort)
if [[ ${#SERVICES[@]} -eq 0 ]]; then
  err "Could not read services from $COMPOSE_FILE."
  exit 1
fi

# Build the service argument list (empty = every service).
# Supports MULTIPLE services at once — docker compose builds/starts
# the selected services in parallel.
SVC_ARGS=()
ALL_SENTINEL="all (every service)"

if [[ -n "$SERVICE_ARG" ]]; then
  # CLI: every positional arg from #3 onward is a service ("all" = every service).
  for svc in "${@:3}"; do
    if [[ "$svc" == "all" || "$svc" == "$ALL_SENTINEL" ]]; then
      SVC_ARGS=(); break
    fi
    SVC_ARGS+=("$svc")
  done
else
  choose_multi "Which service?" SVC_ARGS "$ALL_SENTINEL" "${SERVICES[@]}"
fi

# Picking the "all" sentinel (alone or alongside others) means every service.
for svc in "${SVC_ARGS[@]}"; do
  if [[ "$svc" == "$ALL_SENTINEL" || "$svc" == "all" ]]; then
    SVC_ARGS=(); break
  fi
done

if (( ${#SVC_ARGS[@]} == 0 )); then
  SVC_LABEL="all services"
else
  SVC_LABEL="${SVC_ARGS[*]}"
fi

# ════════════════════════════════════════════════════════════════
#  STEP 4 — Run the chosen action against the chosen service(s)
# ════════════════════════════════════════════════════════════════
title "Running '${ACTION}' on ${SVC_LABEL} (${ENV_CHOICE})"
case "$ACTION" in
  up)
    compose up -d --build "${SVC_ARGS[@]}"
    ;;
  up-fresh)
    compose up -d --build --force-recreate "${SVC_ARGS[@]}"
    ;;
  build)
    compose build "${SVC_ARGS[@]}"
    ;;
  build-no-cache)
    compose build --no-cache "${SVC_ARGS[@]}"
    ;;
  rebuild)
    compose build --no-cache "${SVC_ARGS[@]}"
    compose up -d --force-recreate "${SVC_ARGS[@]}"
    ;;
  restart)
    compose restart "${SVC_ARGS[@]}"
    ;;
  stop)
    compose stop "${SVC_ARGS[@]}"
    ;;
  start)
    compose start "${SVC_ARGS[@]}"
    ;;
  logs)
    compose logs -f --tail=200 "${SVC_ARGS[@]}"
    ;;
  exec-sh)
    if [[ ${#SVC_ARGS[@]} -eq 0 ]]; then
      err "'exec-sh' needs a specific service (not 'all')."
      exit 1
    fi
    # Try bash, fall back to sh.
    compose exec "${SVC_ARGS[0]}" bash 2>/dev/null \
      || compose exec "${SVC_ARGS[0]}" sh
    ;;
  *)
    err "Unknown action: $ACTION"
    exit 1
    ;;
esac

ok "Done."
