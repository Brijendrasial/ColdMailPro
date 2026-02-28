#!/usr/bin/env bash
set -euo pipefail

# ColdMail AIOps Agent (system-level)
# - Runs via systemd timer every minute
# - Checks core services (exim, dovecot, mariadb, app, worker)
# - Applies SAFE recovery actions automatically
# - Records incidents into DB when possible (best-effort) and always logs to /var/log/coldmail-aiops.log

LOG_FILE="/var/log/coldmail-aiops.log"
PROJECT_DIR="${PROJECT_DIR:-/root/coldmail-pro}"
ENV_FILE="${ENV_FILE:-${PROJECT_DIR}/.env}"

# Services installed/managed by this stack
SERVICES=(exim dovecot mariadb coldmail-app coldmail-worker)

# Safety knobs
MAX_RESTARTS_PER_RUN=3
AIOPS_LOG_TAIL_LINES="${AIOPS_LOG_TAIL_LINES:-120}"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "$(ts) $*" | tee -a "$LOG_FILE" >/dev/null; }

is_active() { systemctl is-active --quiet "$1"; }
restart_svc() {
  local svc="$1"
  log "🔁 restarting service: ${svc}"
  systemctl restart "$svc" || true
}

# SELinux helpers (safe)
selinux_enabled() { command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; }
safe_restorecon() {
  local p="$1"
  selinux_enabled || return 0
  command -v restorecon >/dev/null 2>&1 || return 0
  log "🔧 restorecon: ${p}"
  restorecon -Rv "$p" >/dev/null 2>&1 || true
}
safe_setsebool() {
  local name="$1" val="$2"
  selinux_enabled || return 0
  command -v setsebool >/dev/null 2>&1 || return 0
  if getsebool "$name" >/dev/null 2>&1; then
    log "🔧 setsebool -P ${name} ${val}"
    setsebool -P "$name" "$val" >/dev/null 2>&1 || true
  fi
}

# Health checks
check_ports() {
  local svc="$1"
  case "$svc" in
    exim) ss -lntp 2>/dev/null | grep -Eq ':(25|465|587)\b' ;;
    dovecot) ss -lntp 2>/dev/null | grep -Eq ':(143|993)\b' ;;
    mariadb) ss -lntp 2>/dev/null | grep -Eq ':(3306)\b' ;;
    *) return 0 ;;
  esac
}

tail_journal() {
  local svc="$1"
  journalctl -u "$svc" -n "$AIOPS_LOG_TAIL_LINES" --no-pager 2>/dev/null | tail -n "$AIOPS_LOG_TAIL_LINES"
}

# Best-effort DB incident writer using mysql CLI + DATABASE_URL in .env
db_write_incident() {
  local severity="$1" source="$2" signature="$3" summary="$4" evidence="$5"
  [[ -f "$ENV_FILE" ]] || return 0
  command -v mysql >/dev/null 2>&1 || return 0

  # shellcheck disable=SC1090
  source "$ENV_FILE" >/dev/null 2>&1 || true
  local url="${DATABASE_URL:-}"
  [[ -n "$url" ]] || return 0

  python3 - <<'PY' "$url" "$severity" "$source" "$signature" "$summary" "$evidence" 2>/dev/null | {
import sys, json, uuid
from urllib.parse import urlparse
url, severity, source, signature, summary, evidence = sys.argv[1:]
u=urlparse(url)
user=u.username or ""
pwd=u.password or ""
host=u.hostname or "127.0.0.1"
port=u.port or 3306
db=(u.path or "").lstrip("/") or ""
inc_id=str(uuid.uuid4())
def esc(s):
    return json.dumps(str(s), ensure_ascii=False)
sql=f"""INSERT INTO Incident (id, workspaceId, severity, source, signature, summary, status, evidenceJson, suggestedFixesJson, createdAt, updatedAt)
VALUES ({esc(inc_id)}, NULL, {esc(severity)}, {esc(source)}, {esc(signature)}, {esc(summary)}, 'open', {esc(evidence)}, NULL, NOW(3), NOW(3));"""
print(user); print(pwd); print(host); print(port); print(db); print(sql)
PY
    read -r DBU
    read -r DBP
    read -r DBH
    read -r DBPORT
    read -r DBD
    read -r SQL
    mysql -u"$DBU" -p"$DBP" -h"$DBH" -P"$DBPORT" "$DBD" -e "$SQL" >/dev/null 2>&1 || true
  }
}

safe_remediate() {
  local svc="$1" reason="$2"
  local evidence
  evidence="$(tail_journal "$svc" | tail -n 50 | sed 's/"/\\"/g')"
  local signature="${svc}:${reason}"
  local summary="[AIOps] ${svc} unhealthy: ${reason}"
  log "❗ ${summary}"

  case "$svc" in
    dovecot)
      safe_restorecon /var/vmail
      chown -R vmail:vmail /var/vmail >/dev/null 2>&1 || true
      restart_svc dovecot
      ;;
    exim)
      safe_setsebool exim_can_connect_db on
      safe_restorecon /etc/exim
      safe_restorecon /etc/exim/maps
      if [[ -x "${PROJECT_DIR}/scripts/mailstack-addon.sh" ]]; then
        log "🔧 exim-rebuild via mailstack-addon.sh"
        "${PROJECT_DIR}/scripts/mailstack-addon.sh" exim-rebuild >/dev/null 2>&1 || true
      fi
      restart_svc exim
      ;;
    mariadb)
      restart_svc mariadb
      ;;
    coldmail-app)
      restart_svc coldmail-app
      ;;
    coldmail-worker)
      restart_svc coldmail-worker
      ;;
    *)
      restart_svc "$svc"
      ;;
  esac

  db_write_incident "error" "system" "$signature" "$summary" "{\"service\":\"$svc\",\"reason\":\"$reason\",\"journal_tail\":\"$evidence\"}"
}

run_checks() {
  local restarts=0
  for svc in "${SERVICES[@]}"; do
    if ! systemctl list-unit-files | awk '{print $1}' | grep -qx "${svc}.service"; then
      continue
    fi

    if ! is_active "$svc"; then
      safe_remediate "$svc" "service_inactive"
      restarts=$((restarts+1))
    else
      if ! check_ports "$svc"; then
        safe_remediate "$svc" "ports_not_listening"
        restarts=$((restarts+1))
      fi
    fi

    if [[ "$restarts" -ge "$MAX_RESTARTS_PER_RUN" ]]; then
      log "⚠️ max restarts per run reached (${MAX_RESTARTS_PER_RUN}); stopping."
      break
    fi
  done
}

cmd="${1:-check}"
case "$cmd" in
  check|remediate) run_checks ;;
  *) echo "Usage: $0 [check|remediate]"; exit 2 ;;
esac
