#!/usr/bin/env bash
# Started by systemd (osu-party.service) when USE_SCREEN=1.
# Config: /etc/osu-link-party.env (written by install-pi.sh)
set -euo pipefail

if [[ ! -f /etc/osu-link-party.env ]]; then
  echo "Missing /etc/osu-link-party.env — run install-pi.sh" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source /etc/osu-link-party.env
set +a

: "${INSTALL_ROOT:?}" "${LOGDIR:?}" "${HOST:?}" "${PORT:?}" "${LOG_LEVEL:?}"

SESSION="osu-party"

mkdir -p "${LOGDIR}"
cd "${INSTALL_ROOT}"

screen -S "${SESSION}" -X quit 2>/dev/null || true
sleep 0.4

screen -dmS "${SESSION}" -L -Logfile "${LOGDIR}/console.log" bash -lc "
  cd '${INSTALL_ROOT}'
  export HOST='${HOST}' PORT='${PORT}' NODE_ENV=production LOG_LEVEL='${LOG_LEVEL}'
  while true; do
    echo \"[\$(date -Is)] starting node...\"
    node index.mjs || true
    echo \"[\$(date -Is)] node exited, restarting in 3s\"
    sleep 3
  done
"

for _ in $(seq 1 30); do
  if screen -ls 2>/dev/null | grep -qE "[0-9]+\\.${SESSION}[[:space:]]"; then
    break
  fi
  sleep 0.2
done

while screen -ls 2>/dev/null | grep -qE "[0-9]+\\.${SESSION}[[:space:]]"; do
  sleep 15
done

echo "screen session ${SESSION} ended unexpectedly" >&2
exit 1
