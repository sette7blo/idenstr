#!/usr/bin/env bash
# Detect this host's primary LAN IPv4 and write it into .env so the private relay
# advertises a LAN-reachable URL (ws://<LAN_IP>:<port>). Run once on the host
# before `docker compose up -d --build`. Idempotent and safe to re-run.
#
# The container cannot see the host's LAN IP on a normal Docker bridge (it only
# sees the 172.x bridge address), so detection has to happen here on the host.
#
# Usage: scripts/detect-lan-ip.sh [--force]
#   --force  overwrite IDENSTR_PRIVATE_RELAY_URL even if it was customized.

set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${IDENSTR_ENV_FILE:-.env}"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

if [ ! -f "$ENV_FILE" ]; then
  echo "No $ENV_FILE found. Copy .env.example to .env first." >&2
  exit 1
fi

# Prefer the source address the kernel would use to reach the internet; fall back
# to the first address from hostname -I.
lan_ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
[ -z "$lan_ip" ] && lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"

if [ -z "$lan_ip" ]; then
  echo "Could not detect a LAN IP. Set IDENSTR_LAN_IP and IDENSTR_PRIVATE_RELAY_URL in $ENV_FILE by hand." >&2
  exit 1
fi

get_env() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2-; }

set_env() {
  local key="$1" value="$2"
  if grep -qE "^$key=" "$ENV_FILE"; then
    # In-place replace, escaping & and / for sed's replacement.
    local esc; esc="$(printf '%s' "$value" | sed -e 's/[&/\\]/\\&/g')"
    sed -i "s/^$key=.*/$key=$esc/" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

port="$(get_env IDENSTR_PRIVATE_RELAY_PORT)"
[ -z "$port" ] && port=7777
url="ws://$lan_ip:$port"
current="$(get_env IDENSTR_PRIVATE_RELAY_URL)"

set_env IDENSTR_LAN_IP "$lan_ip"

if [ "$FORCE" -eq 1 ] || [ -z "$current" ] || [ "$current" = "ws://private-relay:$port" ] || printf '%s' "$current" | grep -qE '^ws://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+$'; then
  set_env IDENSTR_PRIVATE_RELAY_URL "$url"
  echo "Set IDENSTR_LAN_IP=$lan_ip and IDENSTR_PRIVATE_RELAY_URL=$url in $ENV_FILE"
  echo "Recreate the stack to apply: docker compose up -d"
else
  echo "Set IDENSTR_LAN_IP=$lan_ip. Left customized IDENSTR_PRIVATE_RELAY_URL=$current as-is (use --force to overwrite)."
fi
