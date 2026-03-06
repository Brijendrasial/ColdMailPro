#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="/var/log/coldmail-aiops.log"
mkdir -p "$(dirname "$LOG_FILE")" >/dev/null 2>&1 || true
touch "$LOG_FILE" >/dev/null 2>&1 || true
chmod 644 "$LOG_FILE" >/dev/null 2>&1 || true

PROJECT_DIR="${PROJECT_DIR:-/root/coldmail-pro}"
ENV_FILE="${ENV_FILE:-${PROJECT_DIR}/.env}"
SERVICES=(exim dovecot mariadb coldmail-app coldmail-worker)
MAX_RESTARTS_PER_RUN=3
AIOPS_LOG_TAIL_LINES="${AIOPS_LOG_TAIL_LINES:-120}"
WORKSPACE_ID_CACHE=""
EXIM_QUEUE_WARN_THRESHOLD="${EXIM_QUEUE_WARN_THRESHOLD:-150}"
DOVECOT_AUTHFAIL_WARN_THRESHOLD="${DOVECOT_AUTHFAIL_WARN_THRESHOLD:-8}"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "$(ts) $*" | tee -a "$LOG_FILE" >/dev/null; }
is_active() { systemctl is-active --quiet "$1"; }
restart_svc() {
  local svc="$1"
  log "🔁 restarting service: ${svc}"
  systemctl restart "$svc" || true
}

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

exim_queue_count() {
  if command -v exim >/dev/null 2>&1; then
    exim -bpc 2>/dev/null || echo 0
  else
    echo 0
  fi
}

dovecot_authfail_count() {
  tail_journal dovecot | grep -ci 'auth failed' || true
}

worker_recent_failure_reason() {
  local j
  j="$(tail_journal coldmail-worker | tail -n 80)"
  if echo "$j" | grep -Eq 'TransformError|Unexpected "}"|SyntaxError|Cannot find module|ReferenceError|TypeError'; then
    echo 'worker_boot_failure'
  fi
}

root_cause_summary() {
  local svc="$1" reason="$2"
  case "$svc:$reason" in
    exim:service_inactive) echo 'Exim stopped responding. Safe remediation restarted the mail transport and repaired common SELinux / map issues.' ;;&
    exim:ports_not_listening) echo 'Exim stayed active but SMTP ports were not listening. This usually points to config drift or a broken runtime state.' ;;&
    exim:config_drift*) echo 'Exim permission drift was detected under /etc/exim/maps. Safe remediation normalized permissions, contexts, and rebuilt maps.' ;;&
    exim:queue_backlog) echo 'Exim queue backlog exceeded the configured threshold. This may indicate stuck delivery, throttling, or auth problems downstream.' ;;&
    dovecot:service_inactive) echo 'Dovecot was not active. Safe remediation restored mailbox ownership / contexts and restarted the IMAP/POP3 service.' ;;&
    dovecot:config_drift*) echo 'Mailbox storage drift was detected under /var/vmail. Safe remediation restored the expected owner, mode, and SELinux context.' ;;&
    dovecot:auth_fail_spike) echo 'Dovecot auth failures spiked above the configured threshold. This usually means mailbox credential drift or local probe failures.' ;;&
    coldmail-worker:worker_boot_failure) echo 'The Coldmail worker journal shows a startup/runtime failure pattern. Review recent worker logs and deployment changes.' ;;&
    *) echo 'AIOps detected an unhealthy service state and applied the configured safe remediation path.' ;;&
  esac
}

file_mode() {
  local p="$1"
  stat -c '%a' "$p" 2>/dev/null || echo "missing"
}

file_owner_group() {
  local p="$1"
  stat -c '%U:%G' "$p" 2>/dev/null || echo "missing"
}

append_pipe() {
  local current="$1" extra="$2"
  if [[ -z "$current" ]]; then
    printf '%s' "$extra"
  else
    printf '%s||%s' "$current" "$extra"
  fi
}

service_drift_reason() {
  local svc="$1"
  local reason=""
  case "$svc" in
    dovecot)
      [[ -d /var/vmail ]] || reason="$(append_pipe "$reason" "missing:/var/vmail")"
      [[ "$(file_mode /var/vmail)" == "755" ]] || reason="$(append_pipe "$reason" "perm:/var/vmail")"
      [[ "$(file_owner_group /var/vmail)" == "vmail:vmail" ]] || reason="$(append_pipe "$reason" "owner:/var/vmail")"
      ;;
    exim)
      [[ -d /etc/exim ]] || reason="$(append_pipe "$reason" "missing:/etc/exim")"
      [[ -d /etc/exim/maps ]] || reason="$(append_pipe "$reason" "missing:/etc/exim/maps")"
      [[ "$(file_mode /etc/exim/maps)" == "755" ]] || reason="$(append_pipe "$reason" "perm:/etc/exim/maps")"
      if find /etc/exim/maps -maxdepth 1 -type f ! -perm 0644 2>/dev/null | grep -q .; then
        reason="$(append_pipe "$reason" "perm:/etc/exim/maps/files")"
      fi
      ;;
  esac
  printf '%s' "$reason"
}

service_complex_reason() {
  local svc="$1"
  case "$svc" in
    exim)
      local q
      q=$(exim_queue_count)
      if [[ "${q:-0}" =~ ^[0-9]+$ ]] && (( q >= EXIM_QUEUE_WARN_THRESHOLD )); then
        echo 'queue_backlog'
        return 0
      fi
      ;;
    dovecot)
      local af
      af=$(dovecot_authfail_count)
      if [[ "${af:-0}" =~ ^[0-9]+$ ]] && (( af >= DOVECOT_AUTHFAIL_WARN_THRESHOLD )); then
        echo 'auth_fail_spike'
        return 0
      fi
      ;;
    coldmail-worker)
      worker_recent_failure_reason
      return 0
      ;;
  esac
  return 0
}

verify_service() {
  local svc="$1"
  local status="still_unhealthy"
  local details=""
  local drift=""

  if is_active "$svc"; then
    details="$(append_pipe "$details" "service active")"
  else
    details="$(append_pipe "$details" "service inactive")"
  fi

  case "$svc" in
    exim|dovecot|mariadb)
      if check_ports "$svc"; then
        details="$(append_pipe "$details" "ports listening")"
      else
        details="$(append_pipe "$details" "ports not listening")"
      fi
      ;;
  esac

  drift="$(service_drift_reason "$svc")"
  local complex=""
  complex="$(service_complex_reason "$svc")"
  if [[ -z "$drift" ]]; then
    details="$(append_pipe "$details" "drift cleared")"
  else
    details="$(append_pipe "$details" "remaining drift:${drift}")"
  fi

  case "$svc" in
    exim|dovecot|mariadb)
      if is_active "$svc" && check_ports "$svc" && [[ -z "$drift" ]]; then
        status="healthy"
      elif is_active "$svc"; then
        status="degraded"
      fi
      [[ -n "$complex" ]] && status="degraded"
      ;;
    *)
      if is_active "$svc" && [[ -z "$drift" ]]; then
        status="healthy"
      elif is_active "$svc"; then
        status="degraded"
      fi
      [[ -n "$complex" ]] && status="degraded"
      ;;
  esac

  printf '%s
%s
' "$status" "$details"
}

get_workspace_id() {
  if [[ -n "${AIOPS_WORKSPACE_ID:-}" ]]; then
    echo "$AIOPS_WORKSPACE_ID"
    return 0
  fi
  if [[ -n "$WORKSPACE_ID_CACHE" ]]; then
    echo "$WORKSPACE_ID_CACHE"
    return 0
  fi
  [[ -f "$ENV_FILE" ]] || return 0
  command -v mysql >/dev/null 2>&1 || return 0
  source "$ENV_FILE" >/dev/null 2>&1 || true
  local url="${DATABASE_URL:-}"
  [[ -n "$url" ]] || return 0

  python3 - <<'PY' "$url" 2>/dev/null | {
import sys
from urllib.parse import urlparse
u=urlparse(sys.argv[1])
print(u.username or "")
print(u.password or "")
print(u.hostname or "127.0.0.1")
print(u.port or 3306)
print((u.path or "").lstrip("/") or "")
PY
    read -r DBU
    read -r DBP
    read -r DBH
    read -r DBPORT
    read -r DBD
    local wid
    wid=$(mysql -N -B -u"$DBU" -p"$DBP" -h"$DBH" -P"$DBPORT" "$DBD" -e "SELECT id FROM Workspace ORDER BY createdAt ASC LIMIT 1;" 2>/dev/null | head -n 1 || true)
    if [[ -n "$wid" ]]; then
      WORKSPACE_ID_CACHE="$wid"
      echo "$wid"
    fi
  }
}

db_write_incident() {
  log "[DB] begin incident write"
  local severity="$1" source="$2" signature="$3" summary="$4" svc="$5" reason="$6" evidence="$7" remediation_steps="${8:-}" recovered_status="${9:-}" verification_details="${10:-}"

  if [[ ! -f "$ENV_FILE" ]]; then
    log "[DB] skip: ENV_FILE not found at $ENV_FILE"
    return 0
  fi
  if ! command -v mysql >/dev/null 2>&1; then
    log "[DB] skip: mysql client not installed"
    return 0
  fi

  source "$ENV_FILE" >/dev/null 2>&1 || true
  local url="${DATABASE_URL:-}"
  if [[ -z "$url" ]]; then
    log "[DB] skip: DATABASE_URL empty"
    return 0
  fi

  local wid
  wid="$(get_workspace_id || true)"

  python3 - <<'PY' "$url" "$wid" "$severity" "$source" "$signature" "$summary" "$svc" "$reason" "$evidence" "$remediation_steps" "$recovered_status" "$verification_details" 2>/tmp/coldmail-aiops-dbparse.err | {
import sys, json, uuid
from urllib.parse import urlparse
url, wid, severity, source, signature, summary, svc, reason, evidence, remediation_steps, recovered_status, verification_details = sys.argv[1:]
u=urlparse(url)
user=u.username or ""
pwd=u.password or ""
host=u.hostname or "127.0.0.1"
port=u.port or 3306
db=(u.path or "").lstrip("/") or ""
inc_id=str(uuid.uuid4())

def esc(s):
    return json.dumps(str(s), ensure_ascii=False)

ws_sql = "NULL" if not wid else esc(wid)
actions = [x for x in remediation_steps.split("||") if x]
safe_actions = [{"kind":"safe","actionType":"system","command":step,"args":{}} for step in actions]
verification_items = [x for x in verification_details.split("||") if x]
remediation_status = "resolved" if recovered_status == "healthy" else ("needs_review" if recovered_status == "still_unhealthy" else "degraded")
evidence_obj = {
    "service": svc,
    "reason": reason,
    "journal_tail": evidence,
    "remediation": {
        "steps": actions,
        "autoRemediated": bool(actions),
        "currentHealth": recovered_status or "unknown",
        "status": remediation_status,
        "verification": {
            "summary": "; ".join(verification_items),
            "items": verification_items,
        },
    },
}
suggested_fix_obj = {"actions": safe_actions, "summary": "System agent auto-remediation"}
incident_tables = ["Incident", "incidents", "incident"]
cols = "(id, workspaceId, severity, source, signature, summary, status, evidenceJson, suggestedFixesJson, occurrenceCount, firstSeenAt, lastSeenAt, needsHumanReview, createdAt, updatedAt)"
vals = f"({esc(inc_id)}, {ws_sql}, {esc(severity)}, {esc(source)}, {esc(signature)}, {esc(summary)}, 'open', {esc(json.dumps(evidence_obj, ensure_ascii=False))}, {esc(json.dumps(suggested_fix_obj, ensure_ascii=False))}, 1, NOW(3), NOW(3), FALSE, NOW(3), NOW(3))"
print(user)
print(pwd)
print(host)
print(port)
print(db)
print("|".join(incident_tables))
print(cols)
print(vals)
print(esc(wid) if wid else "NULL")
print(esc(signature))
print(esc(summary))
print(esc(source))
print(esc(severity))
print(esc(json.dumps(evidence_obj, ensure_ascii=False)))
print(esc(json.dumps(suggested_fix_obj, ensure_ascii=False)))
PY
    read -r DBU
    read -r DBP
    read -r DBH
    read -r DBPORT
    read -r DBD
    read -r INCIDENT_TABLES
    read -r COLS
    read -r VALS
    read -r WS_SQL
    read -r SIG_SQL
    read -r SUMMARY_SQL
    read -r SOURCE_SQL
    read -r SEVERITY_SQL
    read -r EVIDENCE_SQL
    read -r FIXES_SQL

    if [[ -z "$DBD" ]]; then
      log "[DB] skip: DATABASE_URL has empty DB name"
      return 0
    fi

    mysql_run() {
      mysql -N -B -u"$DBU" -p"$DBP" -h"$DBH" -P"$DBPORT" "$DBD" -e "$1" 2>/tmp/coldmail-aiops-mysql.err
    }

    local inc_tbl=""
    IFS='|' read -r -a candidates <<< "$INCIDENT_TABLES"
    for t in "${candidates[@]}"; do
      if mysql_run "SHOW TABLES LIKE '$t';" | grep -Fxq "$t"; then
        inc_tbl="$t"
        break
      fi
    done

    if [[ -z "$inc_tbl" ]]; then
      log "[DB] write failed: Incident table not found (tried: $INCIDENT_TABLES)"
      [[ -s /tmp/coldmail-aiops-mysql.err ]] && log "[DB] mysql err: $(tail -n 1 /tmp/coldmail-aiops-mysql.err | tr -d '\r')"
      [[ -s /tmp/coldmail-aiops-dbparse.err ]] && log "[DB] parse err: $(tail -n 1 /tmp/coldmail-aiops-dbparse.err | tr -d '\r')"
      return 0
    fi

    local existing_id=""
    existing_id=$(mysql_run "SELECT id FROM $inc_tbl WHERE status='open' AND signature=$SIG_SQL AND ((workspaceId IS NULL AND $WS_SQL IS NULL) OR workspaceId=$WS_SQL) ORDER BY createdAt DESC LIMIT 1;" | head -n 1 || true)

    if [[ -n "$existing_id" ]]; then
      local next_count=""
      next_count=$(mysql_run "SELECT COALESCE(occurrenceCount,1)+1 FROM $inc_tbl WHERE id='${existing_id}' LIMIT 1;" | head -n 1 || true)
      [[ -z "$next_count" ]] && next_count=2
      local needs_review="FALSE"
      local sev_sql="$SEVERITY_SQL"
      if [[ "$next_count" -ge 3 ]]; then
        needs_review="TRUE"
        sev_sql="'error'"
      fi
      if [[ "$next_count" -ge 5 ]]; then
        sev_sql="'critical'"
      fi
      local update_sql="UPDATE $inc_tbl SET summary=$SUMMARY_SQL, source=$SOURCE_SQL, severity=$sev_sql, evidenceJson=$EVIDENCE_SQL, suggestedFixesJson=$FIXES_SQL, occurrenceCount=COALESCE(occurrenceCount,1)+1, lastSeenAt=NOW(3), needsHumanReview=$needs_review, updatedAt=NOW(3) WHERE id='${existing_id}';"
      if mysql_run "$update_sql" >/dev/null; then
        log "[DB] incident updated in $inc_tbl (workspaceId=${wid:-NULL}, occurrenceCount=${next_count})"
      else
        log "[DB] update failed in $inc_tbl (workspaceId=${wid:-NULL})"
        [[ -s /tmp/coldmail-aiops-mysql.err ]] && log "[DB] mysql err: $(tail -n 1 /tmp/coldmail-aiops-mysql.err | tr -d '\r')"
        [[ -s /tmp/coldmail-aiops-dbparse.err ]] && log "[DB] parse err: $(tail -n 1 /tmp/coldmail-aiops-dbparse.err | tr -d '\r')"
      fi
    else
      local sql="INSERT INTO $inc_tbl $COLS VALUES $VALS;"
      if mysql_run "$sql" >/dev/null; then
        log "[DB] incident inserted into $inc_tbl (workspaceId=${wid:-NULL})"
      else
        log "[DB] insert failed into $inc_tbl (workspaceId=${wid:-NULL})"
        [[ -s /tmp/coldmail-aiops-mysql.err ]] && log "[DB] mysql err: $(tail -n 1 /tmp/coldmail-aiops-mysql.err | tr -d '\r')"
        [[ -s /tmp/coldmail-aiops-dbparse.err ]] && log "[DB] parse err: $(tail -n 1 /tmp/coldmail-aiops-dbparse.err | tr -d '\r')"
      fi
    fi
  }
}

safe_remediate() {
  local svc="$1" reason="$2"
  local evidence remediation_steps recovered_status
  evidence="$(tail_journal "$svc" | tail -n 50 | sed 's/"/\\"/g')"
  local signature="${svc}:${reason}"
  local summary="[AIOps] ${svc} unhealthy: ${reason}"
  log "❗ ${summary}"

  remediation_steps=""
  recovered_status=""

  case "$svc" in
    dovecot)
      if [[ -d /var/vmail ]]; then
        local vmail_mode vmail_owner
        vmail_mode="$(file_mode /var/vmail)"
        vmail_owner="$(file_owner_group /var/vmail)"
        if [[ "$vmail_mode" != "755" ]]; then
          log "🔧 chmod 755 /var/vmail (was ${vmail_mode})"
          chmod 755 /var/vmail >/dev/null 2>&1 || true
          remediation_steps="$(append_pipe "$remediation_steps" "chmod 755 /var/vmail")"
        fi
        if [[ "$vmail_owner" != "vmail:vmail" ]]; then
          log "🔧 chown -R vmail:vmail /var/vmail (was ${vmail_owner})"
        fi
        chown -R vmail:vmail /var/vmail >/dev/null 2>&1 || true
        remediation_steps="$(append_pipe "$remediation_steps" "chown -R vmail:vmail /var/vmail")"
      fi
      safe_restorecon /var/vmail
      remediation_steps="$(append_pipe "$remediation_steps" "restorecon /var/vmail")"
      restart_svc dovecot
      remediation_steps="$(append_pipe "$remediation_steps" "systemctl restart dovecot")"
      ;;
    exim)
      safe_setsebool exim_can_connect_db on
      remediation_steps="$(append_pipe "$remediation_steps" "setsebool -P exim_can_connect_db on")"
      if [[ -d /etc/exim/maps ]]; then
        local maps_mode
        maps_mode="$(file_mode /etc/exim/maps)"
        if [[ "$maps_mode" != "755" ]]; then
          log "🔧 chmod 755 /etc/exim/maps (was ${maps_mode})"
          chmod 755 /etc/exim/maps >/dev/null 2>&1 || true
          remediation_steps="$(append_pipe "$remediation_steps" "chmod 755 /etc/exim/maps")"
        fi
        if compgen -G '/etc/exim/maps/*' >/dev/null 2>&1; then
          log "🔧 chmod 644 /etc/exim/maps/*"
          chmod 644 /etc/exim/maps/* >/dev/null 2>&1 || true
          remediation_steps="$(append_pipe "$remediation_steps" "chmod 644 /etc/exim/maps/*")"
        fi
      fi
      safe_restorecon /etc/exim
      remediation_steps="$(append_pipe "$remediation_steps" "restorecon /etc/exim")"
      safe_restorecon /etc/exim/maps
      remediation_steps="$(append_pipe "$remediation_steps" "restorecon /etc/exim/maps")"
      if [[ -x "${PROJECT_DIR}/scripts/mailstack-addon.sh" ]]; then
        log "🔧 exim-rebuild via mailstack-addon.sh"
        "${PROJECT_DIR}/scripts/mailstack-addon.sh" exim-rebuild >/dev/null 2>&1 || true
        remediation_steps="$(append_pipe "$remediation_steps" "mailstack-addon.sh exim-rebuild")"
      fi
      restart_svc exim
      remediation_steps="$(append_pipe "$remediation_steps" "systemctl restart exim")"
      ;;
    mariadb)
      restart_svc mariadb
      remediation_steps="$(append_pipe "$remediation_steps" "systemctl restart mariadb")"
      ;;
    coldmail-app)
      restart_svc coldmail-app
      remediation_steps="$(append_pipe "$remediation_steps" "systemctl restart coldmail-app")"
      ;;
    coldmail-worker)
      restart_svc coldmail-worker
      remediation_steps="$(append_pipe "$remediation_steps" "systemctl restart coldmail-worker")"
      ;;
    *)
      restart_svc "$svc"
      remediation_steps="$(append_pipe "$remediation_steps" "systemctl restart ${svc}")"
      ;;
  esac

  local verification_output verification_details
  verification_output="$(verify_service "$svc")"
  recovered_status="$(printf '%s
' "$verification_output" | sed -n '1p')"
  verification_details="$(printf '%s
' "$verification_output" | sed -n '2p')"

  db_write_incident "error" "system" "$signature" "$summary" "$svc" "$reason" "$evidence" "$remediation_steps" "$recovered_status" "$verification_details"
}

run_checks() {
  local restarts=0
  local load_state=""
  local drift_reason=""
  for svc in "${SERVICES[@]}"; do
    load_state="$(systemctl show -p LoadState --value "${svc}.service" 2>/dev/null || echo not-found)"
    if [[ "$load_state" == "not-found" || -z "$load_state" ]]; then
      continue
    fi

    drift_reason="$(service_drift_reason "$svc")"
    if ! is_active "$svc"; then
      if [[ -n "$drift_reason" ]]; then
        safe_remediate "$svc" "service_inactive||${drift_reason}"
      else
        safe_remediate "$svc" "service_inactive"
      fi
      restarts=$((restarts+1))
    else
      if ! check_ports "$svc"; then
        if [[ -n "$drift_reason" ]]; then
          safe_remediate "$svc" "ports_not_listening||${drift_reason}"
        else
          safe_remediate "$svc" "ports_not_listening"
        fi
        restarts=$((restarts+1))
      elif [[ -n "$drift_reason" ]]; then
        safe_remediate "$svc" "config_drift||${drift_reason}"
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
