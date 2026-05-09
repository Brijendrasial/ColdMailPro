#!/usr/bin/env bash

ensure_selinux_vmail_context() {
  # AlmaLinux/RHEL 9 SELinux safe labeling for Maildir under /var/vmail
  if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
    if ! command -v semanage >/dev/null 2>&1; then
      if command -v dnf >/dev/null 2>&1; then
        dnf -y install policycoreutils-python-utils >/dev/null 2>&1 || true
      else
        yum -y install policycoreutils-python >/dev/null 2>&1 || true
      fi
    fi

    if command -v semanage >/dev/null 2>&1; then
      semanage fcontext -a -t mail_spool_t "/var/vmail(/.*)?" 2>/dev/null || true
    fi

    restorecon -Rv /var/vmail >/dev/null 2>&1 || true
  fi
}

ensure_selinux_exim_db_access(){
  # Allow Exim to perform DB lookups under SELinux enforcing (Alma/RHEL 9)
  if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
    if command -v getsebool >/dev/null 2>&1; then
      if getsebool exim_can_connect_db >/dev/null 2>&1; then
        setsebool -P exim_can_connect_db on >/dev/null 2>&1 || true
      fi
    fi
  fi
}


fix_exim_maps_context_and_perms(){
  # Ensure Exim can read map files under SELinux enforcing (Alma/RHEL 9)
  mkdir -p /etc/exim/maps 2>/dev/null || true
  chown -R root:root /etc/exim/maps 2>/dev/null || true
  chmod 755 /etc/exim/maps 2>/dev/null || true
  chmod 644 /etc/exim/maps/*.map /etc/exim/maps/*.list 2>/dev/null || true

  if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
    restorecon -Rv /etc/exim >/dev/null 2>&1 || true
    restorecon -Rv /etc/exim/maps >/dev/null 2>&1 || true
  fi
}


set -Eeuo pipefail

# =========================
# Mailstack Addon (AlmaLinux 9)
# Cloudflare DNS + tenants + mailbox creation + Exim patch + IP rotation
# =========================

STATE_DIR="/etc/mailstack"
# Cloudflare token storage path.
# If you run multiple workspaces/tenants on one server, you can set CF_ENV_PATH to use a workspace-specific file.
CF_ENV="${CF_ENV_PATH:-${STATE_DIR}/cloudflare.env}"
SECRETS="${STATE_DIR}/secrets.txt"
TENANTS_DIR="${STATE_DIR}/tenants"

EXIM_CONF="/etc/exim/exim.conf"
EXIM_MAP_DIR="/etc/exim/maps"
EXIM_DKIM_DIR="/etc/exim/dkim"

IFMAP="${EXIM_MAP_DIR}/domain-interface.map"
HELOMAP="${EXIM_MAP_DIR}/domain-helo.map"
DKIMKEYMAP="${EXIM_MAP_DIR}/domain-dkim-key.map"
DKIMSELMAP="${EXIM_MAP_DIR}/domain-dkim-selector.map"
LOCALDOMAINS="${EXIM_MAP_DIR}/local_domains.list"

ROTATOR="/usr/local/sbin/exim-ip-rotate"
ROT_SVC="/etc/systemd/system/exim-ip-rotate.service"
ROT_TMR="/etc/systemd/system/exim-ip-rotate.timer"

MAIL_DB_DEFAULT="mailserver"
MAIL_DB_USER_DEFAULT="mailuser"

# -------------------------
# Helpers
# -------------------------
die(){ echo "❌ $*" >&2; exit 1; }
log(){ echo "✅ $*" >&2; }
warn(){ echo "⚠️  $*" >&2; }

need_root(){ [[ "${EUID}" -eq 0 ]] || die "Run as root"; }

trim(){ sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
read_list_file(){
  local f="$1"
  [[ -f "$f" ]] || return 0
  grep -vE '^[[:space:]]*($|#|;)' "$f" | tr -d '\r' | trim
}

is_ipv4(){
  local ip="$1"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local o1 o2 o3 o4
  IFS='.' read -r o1 o2 o3 o4 <<<"$ip"
  for x in "$o1" "$o2" "$o3" "$o4"; do
    [[ "$x" =~ ^[0-9]+$ ]] || return 1
    [[ "$x" -ge 0 && "$x" -le 255 ]] || return 1
  done
  return 0
}

is_domain(){
  local dom="$1"
  [[ "$dom" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]
}

rand_pass(){
  # 14 chars, safe
  openssl rand -base64 18 | tr -d '=+/ \n' | head -c 14
}

require_cmd(){
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

dnf_install_if_missing(){
  local pkg="$1"
  rpm -q "$pkg" >/dev/null 2>&1 || dnf -y install "$pkg" >/dev/null
}

ensure_deps(){
  dnf_install_if_missing jq
  dnf_install_if_missing openssl
  dnf_install_if_missing curl
  dnf_install_if_missing bind-utils
  # MySQL lookup support for Exim (if available as separate pkg)
  dnf_install_if_missing exim-mysql || true
}

# -------------------------
# Load secrets from mailstack.sh
# -------------------------
get_secret(){
  local key="$1"
  [[ -f "$SECRETS" ]] || return 1
  grep -m1 "^${key}=" "$SECRETS" | cut -d= -f2- || true
}

load_mailstack_db_vars(){
  [[ -f "$SECRETS" ]] || die "Missing ${SECRETS}. Run /root/mailstack.sh install first."
  MYSQL_ROOT_PASS="$(get_secret MYSQL_ROOT_PASSWORD || true)"
  [[ -n "$MYSQL_ROOT_PASS" ]] || die "Missing MYSQL_ROOT_PASSWORD in ${SECRETS}"

  MAIL_DB="$(get_secret MAIL_DB || true)"
  [[ -n "$MAIL_DB" ]] || MAIL_DB="$MAIL_DB_DEFAULT"

  MAIL_DB_USER="$(get_secret MAIL_DB_USER || true)"
  [[ -n "$MAIL_DB_USER" ]] || MAIL_DB_USER="$MAIL_DB_USER_DEFAULT"

  MAIL_DB_PASS="$(get_secret MAIL_DB_PASSWORD || true)"
  [[ -n "$MAIL_DB_PASS" ]] || die "Missing MAIL_DB_PASSWORD in ${SECRETS}"
}

# -------------------------
# Cloudflare API
# -------------------------
cf_load(){
  # Prefer env var if provided by caller (recommended for per-workspace runs)
  if [[ -n "${CF_API_TOKEN:-}" ]]; then
    return 0
  fi
  [[ -f "$CF_ENV" ]] || die "Cloudflare not initialized. Run: $0 init-cloudflare <TOKEN> (writes ${CF_ENV})"
  # shellcheck disable=SC1090
  source "$CF_ENV"
  [[ -n "${CF_API_TOKEN:-}" ]] || die "CF_API_TOKEN missing in ${CF_ENV}"
}

# Non-fatal check: returns 0 if Cloudflare token is available, else 1.
cf_ready(){
  # Env var wins
  if [[ -n "${CF_API_TOKEN:-}" ]]; then
    return 0
  fi
  if [[ -f "$CF_ENV" ]]; then
    # shellcheck disable=SC1090
    source "$CF_ENV"
  fi
  [[ -n "${CF_API_TOKEN:-}" ]]
}


cf_save_token(){
  local token="$1"
  local acme_email="${2:-}"
  mkdir -p "$(dirname "$CF_ENV")"
  cat > "$CF_ENV" <<EOF
# Cloudflare API token (Zone:Read, DNS:Edit, Zone:Edit/Create if using --create-zones)
CF_API_TOKEN="${token}"
# Email for Let's Encrypt account registration (certbot). Must be a real email with a dot-domain.
MAILSTACK_ACME_EMAIL="${acme_email}"
EOF
  chmod 600 "$CF_ENV"
  log "Saved: ${CF_ENV}"
}

cf_req(){
  local method="$1" path="$2" data="${3:-}"
  cf_load
  local url="https://api.cloudflare.com/client/v4${path}"
  local out http body
  out="$(mktemp)"
  if [[ -n "$data" ]]; then
    http="$(curl -sS -o "$out" -w "%{http_code}" -X "$method" "$url" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$data" || true)"
  else
    http="$(curl -sS -o "$out" -w "%{http_code}" -X "$method" "$url" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" || true)"
  fi

  body="$(cat "$out" 2>/dev/null || true)"
  rm -f "$out"

  if [[ "$http" != "200" && "$http" != "201" ]]; then
    # show Cloudflare error nicely
    local msg code
    code="$(echo "$body" | jq -r '.errors[0].code // empty' 2>/dev/null || true)"
    msg="$(echo "$body" | jq -r '.errors[0].message // .messages[0].message // empty' 2>/dev/null || true)"
    warn "Cloudflare API failed: ${method} ${path} HTTP=${http} ${code:+(code $code)} ${msg:+- $msg}"
    echo "$body" >&2
    return 1
  fi
  printf '%s' "$body"
}

cf_zone_id(){
  local domain="$1"
  local r id
  r="$(cf_req GET "/zones?name=${domain}&status=active&per_page=1" || true)"
  id="$(echo "$r" | jq -r '.result[0].id // empty' 2>/dev/null || true)"
  [[ -n "$id" ]] && { echo "$id"; return 0; }
  echo ""
}

cf_zone_create(){
  local domain="$1"
  local r id
  r="$(cf_req POST "/zones" "{\"name\":\"${domain}\",\"jump_start\":false}" )"
  id="$(echo "$r" | jq -r '.result.id // empty')"
  [[ -n "$id" ]] || die "Zone create failed for ${domain}"
  echo "$id"
}

cf_get_or_create_zone(){
  local domain="$1" create="$2"
  local id
  id="$(cf_zone_id "$domain")"
  if [[ -z "$id" ]]; then
    # If the zone doesn't exist in Cloudflare and we weren't asked to create it,
    # DON'T fail provisioning. Many tenants use manual DNS (no Cloudflare) even
    # if Cloudflare creds exist on the server.
    if [[ "$create" != "1" ]]; then
      warn "Zone not found for ${domain}. Skipping Cloudflare DNS sync for this domain (manual DNS mode)."
      echo ""
      return 1
    fi
    log "Creating zone: ${domain}"
    id="$(cf_zone_create "$domain")"
  fi
  echo "$id"
}

cf_list_records(){
  local zone="$1" type="$2" name="$3"
  cf_req GET "/zones/${zone}/dns_records?type=${type}&name=${name}&per_page=100"
}

cf_delete_record(){
  local zone="$1" id="$2"
  cf_req DELETE "/zones/${zone}/dns_records/${id}" >/dev/null
}

cf_flush_records(){
  local zone="$1" type="$2" name="$3" filter_spf="$4"
  local r ids count=0

  r="$(cf_list_records "$zone" "$type" "$name" || true)"

  if [[ "$filter_spf" == "1" ]]; then
    # delete only TXT where content starts with v=spf1
    ids="$(echo "$r" | jq -r '.result[] | select(.type=="TXT" and (.content|startswith("v=spf1"))) | .id' 2>/dev/null || true)"
  else
    ids="$(echo "$r" | jq -r '.result[]?.id' 2>/dev/null || true)"
  fi

  if [[ -n "$ids" ]]; then
    while read -r id; do
      [[ -n "$id" ]] || continue
      cf_delete_record "$zone" "$id" || true
      count=$((count+1))
    done <<<"$ids"
  fi
  echo "$count"
}

cf_create_record(){
  local zone="$1" type="$2" name="$3" content="$4" ttl="${5:-120}" proxied="${6:-false}" priority="${7:-}"
  local data
  if [[ -n "$priority" ]]; then
    data="$(jq -nc --arg t "$type" --arg n "$name" --arg c "$content" --argjson ttl "$ttl" --argjson prox "$proxied" --argjson pr "$priority" \
      '{type:$t,name:$n,content:$c,ttl:$ttl,proxied:$prox,priority:$pr}')"
  else
    data="$(jq -nc --arg t "$type" --arg n "$name" --arg c "$content" --argjson ttl "$ttl" --argjson prox "$proxied" \
      '{type:$t,name:$n,content:$c,ttl:$ttl,proxied:$prox}')"
  fi
  cf_req POST "/zones/${zone}/dns_records" "$data" >/dev/null
}

# -------------------------
# DKIM tools
# -------------------------
dkim_priv_path(){
  local dom="$1" sel="${2:-default}"
  echo "${EXIM_DKIM_DIR}/${dom}/${sel}.private"
}

ensure_dkim_keys(){
  local dom="$1" sel="${2:-default}"

  # Ensure parent dir is traversable by exim and labeled correctly (SELinux)
  mkdir -p "${EXIM_DKIM_DIR}"
  if getent group exim >/dev/null 2>&1; then
    chgrp exim "${EXIM_DKIM_DIR}" 2>/dev/null || true
  fi
  chmod 750 "${EXIM_DKIM_DIR}" 2>/dev/null || true

  # Persist SELinux context rule (if semanage exists) then relabel
  if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce 2>/dev/null || true)" == "Enforcing" ]]; then
    if command -v semanage >/dev/null 2>&1; then
      semanage fcontext -l 2>/dev/null | grep -qE '(^|[[:space:]])/etc/exim/dkim\(/\.\*\)\?\$' \
        || semanage fcontext -a -t exim_conf_t "/etc/exim/dkim(/.*)?" >/dev/null 2>&1 || true
    fi
    restorecon -Rv "${EXIM_DKIM_DIR}" >/dev/null 2>&1 || true
  fi

  # Ensure domain dir perms
  mkdir -p "${EXIM_DKIM_DIR}/${dom}"
  if getent group exim >/dev/null 2>&1; then
    chgrp exim "${EXIM_DKIM_DIR}/${dom}" 2>/dev/null || true
  fi
  chmod 750 "${EXIM_DKIM_DIR}/${dom}" 2>/dev/null || true

  local priv; priv="$(dkim_priv_path "$dom" "$sel")"
  if [[ ! -f "$priv" ]]; then
    openssl genrsa -out "$priv" 2048 >/dev/null 2>&1 || true
  fi

  # Key perms: readable by exim group
  if getent group exim >/dev/null 2>&1; then
    chown root:exim "$priv" 2>/dev/null || true
    chmod 640 "$priv" 2>/dev/null || true
  else
    chown root:root "$priv" 2>/dev/null || true
    chmod 600 "$priv" 2>/dev/null || true
  fi

  # Ensure ALL dirs are traversable (covers older/bad perms)
  find "${EXIM_DKIM_DIR}" -type d -exec chmod 750 {} \; >/dev/null 2>&1 || true
  if getent group exim >/dev/null 2>&1; then
    find "${EXIM_DKIM_DIR}" -type d -exec chgrp exim {} \; >/dev/null 2>&1 || true
  fi

  # Relabel again (covers new key)
  restorecon -Rv "${EXIM_DKIM_DIR}/${dom}" >/dev/null 2>&1 || true

  echo "$priv"
}

dkim_public_p(){
  local priv="$1"
  openssl rsa -in "$priv" -pubout -outform PEM 2>/dev/null \
    | sed '1d;$d' | tr -d '\n' | tr -d '\r'
}

rebuild_dkim_map(){
  mkdir -p "$EXIM_MAP_DIR"
  : > "$DKIMKEYMAP"
  chmod 644 "$DKIMKEYMAP"

  shopt -s nullglob
  for tconf in "${TENANTS_DIR}"/*/tenant.conf; do
    # shellcheck disable=SC1090
    source "$tconf"
    [[ -f "${DOMAINS_FILE:-}" ]] || continue
    local tdir
    tdir="$(dirname "$tconf")"
    while read -r dom; do
      [[ -n "$dom" ]] || continue
      is_domain "$dom" || continue
      # Use the active selector if present, else default.
      local sel
      sel="$(dkim_selector_active_for_domain "$tdir" "$dom")"
      priv="$(ensure_dkim_keys "$dom" "$sel")"
      printf '%s:%s\n' "$dom" "$priv" >> "$DKIMKEYMAP"
    done < <(read_list_file "$DOMAINS_FILE")
  done

  awk -F: '!seen[$1]++' "$DKIMKEYMAP" > "${DKIMKEYMAP}.tmp" && mv -f "${DKIMKEYMAP}.tmp" "$DKIMKEYMAP"
  log "Rebuilt DKIM key map: ${DKIMKEYMAP}"
}

dkim_map_get(){
  local file="$1" dom="$2"
  [[ -f "$file" ]] || { echo ""; return 0; }
  awk -F: -v d="$dom" 'tolower($1)==tolower(d){print $2; exit}' "$file" 2>/dev/null || true
}

dkim_selector_active_for_domain(){
  local tdir="$1" dom="$2"
  local f="${tdir}/dkim-selector.map"
  local sel
  sel="$(dkim_map_get "$f" "$dom" | trim)"
  [[ -n "$sel" ]] && { echo "$sel"; return 0; }
  echo "default"
}

dkim_selector_pending_for_domain(){
  local tdir="$1" dom="$2"
  local f="${tdir}/dkim-pending.map"
  dkim_map_get "$f" "$dom" | trim
}

rebuild_dkim_selector_map(){
  mkdir -p "$EXIM_MAP_DIR"
  : > "$DKIMSELMAP"
  chmod 644 "$DKIMSELMAP"

  shopt -s nullglob
  for tconf in "${TENANTS_DIR}"/*/tenant.conf; do
    # shellcheck disable=SC1090
    source "$tconf"
    [[ -f "${DOMAINS_FILE:-}" ]] || continue
    local tdir
    tdir="$(dirname "$tconf")"
    while read -r dom; do
      [[ -n "$dom" ]] || continue
      is_domain "$dom" || continue
      local sel
      sel="$(dkim_selector_active_for_domain "$tdir" "$dom")"
      printf '%s:%s\n' "$dom" "$sel" >> "$DKIMSELMAP"
    done < <(read_list_file "$DOMAINS_FILE")
  done

  awk -F: '!seen[$1]++' "$DKIMSELMAP" > "${DKIMSELMAP}.tmp" && mv -f "${DKIMSELMAP}.tmp" "$DKIMSELMAP"
  log "Rebuilt DKIM selector map: ${DKIMSELMAP}"
}

rebuild_local_domains(){
  mkdir -p "$EXIM_MAP_DIR"
  : > "$LOCALDOMAINS"
  chmod 644 "$LOCALDOMAINS"

  shopt -s nullglob
  for tconf in "${TENANTS_DIR}"/*/tenant.conf; do
    # shellcheck disable=SC1090
    source "$tconf"
    [[ -f "${DOMAINS_FILE:-}" ]] || continue
    while read -r dom; do
      [[ -n "$dom" ]] || continue
      is_domain "$dom" || continue
      echo "$dom" >> "$LOCALDOMAINS"
    done < <(read_list_file "$DOMAINS_FILE")
  done

  sort -u "$LOCALDOMAINS" -o "$LOCALDOMAINS"
  log "Rebuilt local domains file: ${LOCALDOMAINS}"
}

# -------------------------
# Mailboxes (users × domains)
# -------------------------
dovecot_hash(){
  local plain="$1"
  doveadm pw -s SHA512-CRYPT -p "$plain"
}

mysql_exec(){
  local sql="$1"
  # Always select the mail database to avoid "No database selected" errors.
  # Queries may still reference fully-qualified tables (db.table), but MariaDB
  # can require a default DB for some multi-table statements.
  local db="${MAIL_DB:-${MAIL_DB_DEFAULT}}"
  mariadb -u root -p"${MYSQL_ROOT_PASS}" -N -B "$db" -e "$sql"
}

ensure_vmail_dirs(){
  local dom="$1" user="$2"
  local VMAIL_HOME="/var/vmail"
  mkdir -p "${VMAIL_HOME}/${dom}/${user}/Maildir"
  chown -R vmail:vmail "${VMAIL_HOME}/${dom}" 2>/dev/null || true
  chmod -R 750 "${VMAIL_HOME}/${dom}" 2>/dev/null || true
}

create_mailbox(){
  local email="$1" pass="$2"
  local dom="${email#*@}"
  local user="${email%@*}"

  local hash; hash="$(dovecot_hash "$pass")"

  mysql_exec "INSERT IGNORE INTO ${MAIL_DB}.virtual_domains(name) VALUES('${dom}');" >/dev/null || true
  mysql_exec "SET @did := (SELECT id FROM ${MAIL_DB}.virtual_domains WHERE name='${dom}' LIMIT 1);
              INSERT INTO ${MAIL_DB}.virtual_users(domain_id,email,password,active)
              VALUES(@did,'${email}','${hash}',1)
              ON DUPLICATE KEY UPDATE password=VALUES(password), active=1;" >/dev/null

  ensure_vmail_dirs "$dom" "$user"
}

tenant_mailboxes_create(){
  local tenant="$1" domains_file="$2" users_file="$3"
  load_mailstack_db_vars
  [[ -f "$domains_file" ]] || die "Domains file missing: $domains_file"
  [[ -f "$users_file" ]] || die "Users file missing: $users_file"

  local outdir="${TENANTS_DIR}/${tenant}"
  mkdir -p "$outdir"
  local outcsv="${outdir}/mailboxes.csv"

  # header if new
  if [[ ! -f "$outcsv" ]]; then
    echo "email,password" > "$outcsv"
    chmod 600 "$outcsv"
  fi

  local dom u email pass
  while read -r dom; do
    [[ -n "$dom" ]] || continue
    is_domain "$dom" || continue

    while read -r u; do
      u="$(echo "$u" | trim)"
      [[ -n "$u" ]] || continue
      # basic username sanity
      [[ "$u" =~ ^[a-zA-Z0-9._-]+$ ]] || { warn "Skip invalid user: $u"; continue; }

      email="${u}@${dom}"
      pass="$(rand_pass)"
      create_mailbox "$email" "$pass"
      echo "${email},${pass}" >> "$outcsv"
    done < <(read_list_file "$users_file")
  done < <(read_list_file "$domains_file")

  log "Mailboxes created/updated. Saved passwords: ${outcsv}"
}

# -------------------------
# Exim patching (safe + idempotent)
# -------------------------
backup_exim(){
  [[ -f "$EXIM_CONF" ]] || die "Missing ${EXIM_CONF}"
  cp -a "$EXIM_CONF" "$EXIM_CONF.bak.$(date +%F-%H%M%S)"
}

exim_validate(){
  exim -C "$EXIM_CONF" -bV >/dev/null
}

ensure_mysql_servers_line(){
  load_mailstack_db_vars
  local line="hide mysql_servers = localhost/${MAIL_DB}/${MAIL_DB_USER}/${MAIL_DB_PASS}"
  local esc="${line//&/\\&}"

  if grep -qE '^[[:space:]]*(hide[[:space:]]+)?mysql_servers[[:space:]]*=' "$EXIM_CONF"; then
    sed -i -E "s@^[[:space:]]*(hide[[:space:]]+)?mysql_servers[[:space:]]*=.*@${esc}@g" "$EXIM_CONF"
  else
    awk -v ins="$line" '
      !done && $0 ~ /^begin[[:space:]]+acl/ { print ins "\n"; done=1 }
      { print }
    ' "$EXIM_CONF" > "${EXIM_CONF}.tmp" && mv -f "${EXIM_CONF}.tmp" "$EXIM_CONF"
  fi
}

ensure_main_knobs(){
  # disable_ipv6 = true
  if grep -qE '^[[:space:]]*disable_ipv6[[:space:]]*=' "$EXIM_CONF"; then
    sed -i -E 's/^[[:space:]]*disable_ipv6[[:space:]]*=.*/disable_ipv6 = true/' "$EXIM_CONF"
  else
    awk '
      !done && $0 ~ /^primary_hostname[[:space:]]*=/ {
        print
        print "disable_ipv6 = true"
        done=1
        next
      }
      { print }
    ' "$EXIM_CONF" > "${EXIM_CONF}.tmp" && mv -f "${EXIM_CONF}.tmp" "$EXIM_CONF"
  fi

  # keep_environment = * (silence purge warnings)
  if grep -qE '^[[:space:]]*keep_environment[[:space:]]*=' "$EXIM_CONF"; then
    sed -i -E 's/^[[:space:]]*keep_environment[[:space:]]*=.*/keep_environment = \*/' "$EXIM_CONF"
  else
    awk '
      !done && $0 ~ /^disable_ipv6[[:space:]]*=/ {
        print
        print "keep_environment = *"
        done=1
        next
      }
      { print }
    ' "$EXIM_CONF" > "${EXIM_CONF}.tmp" && mv -f "${EXIM_CONF}.tmp" "$EXIM_CONF"
  fi

  # log_selector add dkim_verbose
  if grep -qE '^[[:space:]]*log_selector[[:space:]]*=' "$EXIM_CONF"; then
    grep -q 'dkim_verbose' "$EXIM_CONF" || \
      sed -i -E 's@^[[:space:]]*log_selector[[:space:]]*=@log_selector = +dkim_verbose @' "$EXIM_CONF"
  else
    awk '
      !done && $0 ~ /^keep_environment[[:space:]]*=/ {
        print
        print "log_selector = +dkim_verbose"
        done=1
        next
      }
      { print }
    ' "$EXIM_CONF" > "${EXIM_CONF}.tmp" && mv -f "${EXIM_CONF}.tmp" "$EXIM_CONF"
  fi
}

ensure_domainlist_local_domains(){
  mkdir -p "$EXIM_MAP_DIR"
  [[ -f "$LOCALDOMAINS" ]] || : > "$LOCALDOMAINS"
  chmod 644 "$LOCALDOMAINS"

  # replace domainlist local_domains line to use lsearch file
  if grep -qE '^[[:space:]]*domainlist[[:space:]]+local_domains[[:space:]]*=' "$EXIM_CONF"; then
    sed -i -E "s|^[[:space:]]*domainlist[[:space:]]+local_domains[[:space:]]*=.*|domainlist local_domains = @ : localhost : lsearch;${LOCALDOMAINS}|" "$EXIM_CONF"
  else
    awk '
      !done && $0 ~ /^primary_hostname[[:space:]]*=/ {
        print
        print "domainlist local_domains = @ : localhost : lsearch;/etc/exim/maps/local_domains.list"
        done=1
        next
      }
      { print }
    ' "$EXIM_CONF" > "${EXIM_CONF}.tmp" && mv -f "${EXIM_CONF}.tmp" "$EXIM_CONF"
  fi
}

ensure_acl_relay_ok(){
  load_mailstack_db_vars

  local ACL_BLOCK
  ACL_BLOCK="$(cat <<EOF
begin acl
acl_check_rcpt:

  # Require TLS for submission port 587
  deny
    condition = \${if and{{eq{\$received_port}{587}}{!def:tls_in_cipher}}{yes}{no}}
    message   = TLS required on submission (587)

  # Allow authenticated users to relay OUT
  accept authenticated = *

  # Allow localhost relays
  accept hosts = +relay_from_hosts

  # Local delivery only if mailbox exists in DB
  accept
    domains = +local_domains
    condition = \${lookup mysql{SELECT 1 FROM ${MAIL_DB}.virtual_users WHERE email='\${quote_mysql:\$local_part@\$domain}' AND active=1 LIMIT 1}{yes}{no}}

  deny
    domains = +local_domains
    message = Unknown local user

  deny message = Relay not permitted
EOF
)"

  # ensure acl_smtp_rcpt = acl_check_rcpt
  if ! grep -qE '^[[:space:]]*acl_smtp_rcpt[[:space:]]*=' "$EXIM_CONF"; then
    awk '
      BEGIN{done=0}
      {
        if(!done && $0 ~ /^begin[[:space:]]+acl/){
          print "acl_smtp_rcpt = acl_check_rcpt\n"
          done=1
        }
        print
      }
    ' "$EXIM_CONF" > "${EXIM_CONF}.tmp" && mv -f "${EXIM_CONF}.tmp" "$EXIM_CONF"
  else
    sed -i -E 's/^[[:space:]]*acl_smtp_rcpt[[:space:]]*=.*/acl_smtp_rcpt = acl_check_rcpt/' "$EXIM_CONF"
  fi

  # Replace everything from begin acl to begin routers
  awk -v block="$ACL_BLOCK" '
    BEGIN { in_acl=0; done=0 }
    {
      if (!done && $0 ~ /^begin[[:space:]]+acl/) { print block; in_acl=1; next }
      if (in_acl && $0 ~ /^begin[[:space:]]+routers/) { print; in_acl=0; done=1; next }
      if (!in_acl) print
    }
  ' "$EXIM_CONF" > "${EXIM_CONF}.tmp" && mv -f "${EXIM_CONF}.tmp" "$EXIM_CONF"
}

ensure_remote_smtp_tenant_routing(){
  mkdir -p "$EXIM_MAP_DIR" "$EXIM_DKIM_DIR"
  touch "$IFMAP" "$HELOMAP" "$DKIMKEYMAP" "$DKIMSELMAP"
  chmod 644 "$IFMAP" "$HELOMAP" "$DKIMKEYMAP" "$DKIMSELMAP"

  # Replace remote_smtp transport with managed block
  local RBLK
  RBLK="$(cat <<'EOF'
remote_smtp:
  driver = smtp

  # --- mailstack-addon tenant routing (prefer authenticated user domain) ---
  interface = ${lookup{${if def:authenticated_id{${domain:${authenticated_id}}}{$sender_address_domain}}}lsearch{/etc/exim/maps/domain-interface.map}{$value}{}}
  helo_data  = ${lookup{${if def:authenticated_id{${domain:${authenticated_id}}}{$sender_address_domain}}}lsearch{/etc/exim/maps/domain-helo.map}{$value}{$primary_hostname}}

  # --- DKIM signing (untainted via lsearch map) ---
  dkim_domain = ${if def:authenticated_id{${domain:${authenticated_id}}}{$sender_address_domain}}
  # selector comes from a safe lsearch map (defaults to 'default')
  dkim_selector = ${lookup{${if def:authenticated_id{${domain:${authenticated_id}}}{$sender_address_domain}}}lsearch{/etc/exim/maps/domain-dkim-selector.map}{$value}{default}}
  dkim_private_key = ${lookup{${if def:authenticated_id{${domain:${authenticated_id}}}{$sender_address_domain}}}lsearch{/etc/exim/maps/domain-dkim-key.map}{$value}{}}
  dkim_canon = relaxed
EOF
)"

  awk -v rblk="$RBLK" '
    BEGIN{in_trans=0; in_remote=0}
    /^begin[[:space:]]+transports/ { in_trans=1; print; next }
    in_trans && /^remote_smtp:/ { print rblk; in_remote=1; next }
    in_remote {
      # end remote_smtp block when next transport label appears (word+colon) or begin authenticators
      if ($0 ~ /^[A-Za-z0-9_]+:/ && $0 !~ /^remote_smtp:/) { in_remote=0; print; next }
      if ($0 ~ /^begin[[:space:]]+authenticators/) { in_remote=0; print; next }
      next
    }
    { print }
  ' "$EXIM_CONF" > "${EXIM_CONF}.tmp" && mv -f "${EXIM_CONF}.tmp" "$EXIM_CONF"
}

ensure_virtual_delivery_mysql_path(){
  load_mailstack_db_vars

  # Replace virtual_maildir_delivery transport with MySQL lookup path to avoid taint errors
  local VBLK
  VBLK="$(cat <<EOF
virtual_maildir_delivery:
  driver = appendfile
  maildir_format
  directory = \${lookup mysql{SELECT CONCAT('/var/vmail/', d.name, '/', SUBSTRING_INDEX(u.email,'@',1), '/Maildir') FROM ${MAIL_DB}.virtual_users u JOIN ${MAIL_DB}.virtual_domains d ON u.domain_id=d.id WHERE u.email='\${quote_mysql:\$local_part@\$domain}' AND u.active=1 LIMIT 1}{\$value}{/var/vmail/\$domain/\$local_part/Maildir}}
  create_directory
  directory_mode = 0750
  mode = 0640
  user = vmail
  group = vmail
EOF
)"

  awk -v vblk="$VBLK" '
    BEGIN{in_trans=0; in_v=0}
    /^begin[[:space:]]+transports/ { in_trans=1; print; next }
    in_trans && /^virtual_maildir_delivery:/ { print vblk; in_v=1; next }
    in_v {
      if ($0 ~ /^[A-Za-z0-9_]+:/ && $0 !~ /^virtual_maildir_delivery:/) { in_v=0; print; next }
      if ($0 ~ /^begin[[:space:]]+authenticators/) { in_v=0; print; next }
      next
    }
    { print }
  ' "$EXIM_CONF" > "${EXIM_CONF}.tmp" && mv -f "${EXIM_CONF}.tmp" "$EXIM_CONF"
}


ensure_relay_from_hosts(){
  # Some patches may remove this; ACL uses +relay_from_hosts
  if grep -qE '^[[:space:]]*hostlist[[:space:]]+relay_from_hosts[[:space:]]*=' "$EXIM_CONF"; then
    sed -i -E 's/^[[:space:]]*hostlist[[:space:]]+relay_from_hosts[[:space:]]*=.*/hostlist relay_from_hosts = 127.0.0.1 : ::1/' "$EXIM_CONF"
  else
    awk '
      !done && $0 ~ /^domainlist[[:space:]]+local_domains/ {
        print
        print "hostlist relay_from_hosts = 127.0.0.1 : ::1"
        done=1
        next
      }
      { print }
    ' "$EXIM_CONF" > "${EXIM_CONF}.tmp" && mv -f "${EXIM_CONF}.tmp" "$EXIM_CONF"
  fi
}


exim_fix(){
  [[ -f "$EXIM_CONF" ]] || die "Missing ${EXIM_CONF}"
  backup_exim

  ensure_deps
ensure_selinux_exim_db_access
  rebuild_dkim_map
  rebuild_dkim_selector_map
  rebuild_local_domains

  ensure_mysql_servers_line
  ensure_main_knobs
  ensure_domainlist_local_domains
  ensure_relay_from_hosts
  ensure_acl_relay_ok
  ensure_remote_smtp_tenant_routing
  ensure_virtual_delivery_mysql_path

  exim_validate || die "Exim validation failed. Restore: ${EXIM_CONF}.bak.*"
  systemctl restart exim || true
  log "Exim fixed: IPv4-only + mysql_servers + local_domains list + relay ACL + interface/helo + DKIM key+selector maps + safe local delivery"
}

# -------------------------
# IP Rotator (fixed variable scoping)
# -------------------------
install_rotator(){
  mkdir -p "$TENANTS_DIR" "$EXIM_MAP_DIR"

  cat > "$ROTATOR" <<'ROT'
#!/usr/bin/env bash
set -Eeuo pipefail

STATE_DIR="/etc/mailstack"
TENANTS_DIR="${STATE_DIR}/tenants"
EXIM_MAP_DIR="/etc/exim/maps"
EXIM_DKIM_DIR="/etc/exim/dkim"
EXIM_DKIM_MAP="${EXIM_MAP_DIR}/domain-dkim-key.map"

IFMAP="${EXIM_MAP_DIR}/domain-interface.map"
HELOMAP="${EXIM_MAP_DIR}/domain-helo.map"

trim(){ sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
read_list_file(){ local f="$1"; [[ -f "$f" ]] || return 0; grep -vE '^[[:space:]]*($|#|;)' "$f" | tr -d '\r' | trim; }

is_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local o1 o2 o3 o4
  IFS='.' read -r o1 o2 o3 o4 <<<"$ip"
  for x in "$o1" "$o2" "$o3" "$o4"; do
    [[ "$x" =~ ^[0-9]+$ ]] || return 1
    [[ "$x" -ge 0 && "$x" -le 255 ]] || return 1
  done
  return 0
}

is_domain() {
  local dom="$1"
  [[ "$dom" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]
}

declare -A RDNS_CACHE
rdns_of_ip() {
  local ip="$1"
  if [[ -n "${RDNS_CACHE[$ip]:-}" ]]; then printf '%s' "${RDNS_CACHE[$ip]}"; return 0; fi
  local r=""
  if command -v dig >/dev/null 2>&1; then
    r="$(dig +short -x "$ip" +time=1 +tries=1 | head -n1 | tr -d '\r' | sed 's/\.$//')"
  fi
  if [[ -z "$r" ]] && command -v getent >/dev/null 2>&1; then
    r="$(getent hosts "$ip" 2>/dev/null | awk '{print $2}' | head -n1 | tr -d '\r' | sed 's/\.$//')"
  fi
  RDNS_CACHE[$ip]="$r"
  printf '%s' "$r"
}

dkim_private_path(){ local dom="$1"; echo "/etc/exim/dkim/${dom}/default.private"; }
ensure_dkim_key_for_domain() {
  local dom="$1"
  mkdir -p "/etc/exim/dkim/${dom}"
  chmod 750 "/etc/exim/dkim/${dom}" 2>/dev/null || true
  local priv; priv="$(dkim_private_path "$dom")"
  [[ -f "$priv" ]] || openssl genrsa -out "$priv" 2048 >/dev/null 2>&1 || true

  if getent group exim >/dev/null 2>&1; then
    chown root:exim "$priv" 2>/dev/null || true
    chmod 640 "$priv" 2>/dev/null || true
  else
    chown root:root "$priv" 2>/dev/null || true
    chmod 600 "$priv" 2>/dev/null || true
  fi
  restorecon -Rv "/etc/exim/dkim/${dom}" >/dev/null 2>&1 || true
  echo "$priv"
}

rebuild_domain_dkim_key_map() {
  mkdir -p "$EXIM_MAP_DIR" "/etc/exim/dkim"
  : > "$EXIM_DKIM_MAP"
  chmod 644 "$EXIM_DKIM_MAP"

  shopt -s nullglob
  for tconf in "${TENANTS_DIR}"/*/tenant.conf; do
    # shellcheck disable=SC1090
    source "$tconf"
    [[ -f "${DOMAINS_FILE:-}" ]] || continue
    while read -r dom; do
      [[ -n "$dom" ]] || continue
      is_domain "$dom" || continue
      priv="$(ensure_dkim_key_for_domain "$dom")"
      printf '%s:%s\n' "$dom" "$priv" >> "$EXIM_DKIM_MAP"
    done < <(read_list_file "$DOMAINS_FILE")
  done

  awk -F: '!seen[$1]++' "$EXIM_DKIM_MAP" > "${EXIM_DKIM_MAP}.tmp" && mv -f "${EXIM_DKIM_MAP}.tmp" "$EXIM_DKIM_MAP"
}

pick_ip_for_domain_minute() {
  local dom="$1"; shift
  local -a ips=( "$@" )
  local n="${#ips[@]}"
  (( n > 0 )) || { echo ""; return 0; }

  local epoch_min=$(( $(date +%s) / 60 ))
  local seed="${dom}-${epoch_min}"
  local hex part num idx
  hex="$(printf '%s' "$seed" | sha256sum | awk '{print $1}')"
  part="${hex:0:8}"
  num=$((16#${part}))
  idx=$(( num % n ))
  echo "${ips[$idx]}"
}

rotate_all() {
  mkdir -p "$EXIM_MAP_DIR"
  : > "$IFMAP"
  : > "$HELOMAP"
  chmod 644 "$IFMAP" "$HELOMAP"

  rebuild_domain_dkim_key_map || true

  shopt -s nullglob
  for tconf in "${TENANTS_DIR}"/*/tenant.conf; do
    # shellcheck disable=SC1090
    source "$tconf"
    local domains_file="${DOMAINS_FILE:-}"
    local ips_file="${IPS_FILE:-}"
    local helo_tpl="${HELO_TEMPLATE:-mail.%d}"
    [[ -f "$domains_file" && -f "$ips_file" ]] || continue

    mapfile -t ips < <(read_list_file "$ips_file" | awk 'NF{print}')
    [[ "${#ips[@]}" -gt 0 ]] || continue

    while read -r dom; do
      [[ -n "$dom" ]] || continue
      is_domain "$dom" || continue

      local ip rdns
      ip="$(pick_ip_for_domain_minute "$dom" "${ips[@]}")"
      is_ipv4 "$ip" || continue

      rdns="$(rdns_of_ip "$ip")"
      if [[ -z "$rdns" ]]; then
        rdns="${helo_tpl//%d/$dom}"
        [[ -n "$rdns" ]] || rdns="mail.${dom}"
      fi

      printf '%s:%s\n' "$dom" "$ip"   >> "$IFMAP"
      printf '%s:%s\n' "$dom" "$rdns" >> "$HELOMAP"
    done < <(read_list_file "$domains_file")
  done

  systemctl reload exim 2>/dev/null || systemctl restart exim 2>/dev/null || true
  echo "✅ Rotated (per-minute deterministic) + exim reloaded"
}

case "${1:-all}" in
  all) rotate_all ;;
  *) echo "Usage: exim-ip-rotate all" >&2; exit 1 ;;
esac
ROT

  chmod +x "$ROTATOR"

  # systemd unit + timer
  cat > "$ROT_SVC" <<EOF
[Unit]
Description=Rotate Exim outbound interface/helo per tenant
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${ROTATOR} all
EOF

  cat > "$ROT_TMR" <<'EOF'
[Unit]
Description=Run Exim IP rotation every minute

[Timer]
OnBootSec=30
OnUnitActiveSec=60
AccuracySec=5
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now exim-ip-rotate.timer
  log "IP rotation timer enabled: exim-ip-rotate.timer"
}

# -------------------------
# DNS sync per domain
# -------------------------
spf_value_from_ips(){
  local ips_file="$1"
  local spf="v=spf1"
  while read -r ip; do
    [[ -n "$ip" ]] || continue
    is_ipv4 "$ip" || continue
    spf="${spf} ip4:${ip}"
  done < <(read_list_file "$ips_file")
  spf="${spf} -all"
  echo "$spf"
}

# Write DNS record instructions for manual DNS panels (when Cloudflare is not used).
# Output: /etc/mailstack/tenants/<tenant>/dns-records.txt
write_dns_records_tenant(){
  local tenant="$1"
  local tdir="${TENANTS_DIR}/${tenant}"
  local tconf="${tdir}/tenant.conf"
  [[ -f "$tconf" ]] || die "Tenant not found: ${tenant} (missing ${tconf})"

  # shellcheck disable=SC1090
  source "$tconf"

  local out="${tdir}/dns-records.txt"
  : > "$out"
  chmod 600 "$out" >/dev/null 2>&1 || true

  [[ -f "${DOMAINS_FILE:-}" ]] || die "DOMAINS_FILE missing in ${tconf}"
  [[ -f "${IPS_FILE:-}" ]] || die "IPS_FILE missing in ${tconf}"
  [[ -n "${SERVER_IP:-}" ]] || die "SERVER_IP missing in ${tconf}"


  local spf; spf="$(spf_value_from_ips "$IPS_FILE")"

  echo "# Manual DNS records for tenant: ${tenant}" >> "$out"
  echo "# Generated by mailstack-addon.sh on $(date -Is)" >> "$out"
  echo "" >> "$out"

  local dom mailhost dkim_name dmarc_name priv pub dkim_txt rua dmarc_txt
  while read -r dom; do
    dom="$(echo "$dom" | trim)"
    [[ -n "$dom" ]] || continue
    is_domain "$dom" || { warn "Skip invalid domain in list: $dom"; continue; }

    mailhost="mail.${dom}"
    local sel_active sel_pending
    sel_active="$(dkim_selector_active_for_domain "$tdir" "$dom")"
    sel_pending="$(dkim_selector_pending_for_domain "$tdir" "$dom")"
    dkim_name="${sel_active}._domainkey.${dom}"
    dmarc_name="_dmarc.${dom}"

    # Ensure DKIM key exists (used by Exim signing map)
    priv="$(ensure_dkim_keys "$dom" "$sel_active")"
    pub="$(dkim_public_p "$priv")"
    dkim_txt="v=DKIM1; k=rsa; p=${pub}"

    rua="dmarc@${dom}"
    if [[ -n "${DMARC_RUA:-}" ]]; then
      rua="${DMARC_RUA//%d/$dom}"
    fi
    dmarc_txt="v=DMARC1; p=${DMARC_P:-none}; rua=mailto:${rua}; adkim=s; aspf=s"

    echo "## ${dom}" >> "$out"
    echo "A,${mailhost},${SERVER_IP},120" >> "$out"
    echo "MX,${dom},${mailhost},120,10" >> "$out"
    echo "TXT,${dom},${spf},120" >> "$out"
    echo "TXT,${dkim_name},${dkim_txt},120" >> "$out"

    # If we have a staged DKIM selector, include it too (zero-downtime rotation).
    if [[ -n "$sel_pending" && "$sel_pending" != "$sel_active" ]]; then
      local p_name p_priv p_pub p_txt
      p_name="${sel_pending}._domainkey.${dom}"
      p_priv="$(ensure_dkim_keys "$dom" "$sel_pending")"
      p_pub="$(dkim_public_p "$p_priv")"
      p_txt="v=DKIM1; k=rsa; p=${p_pub}"
      echo "TXT,${p_name},${p_txt},120" >> "$out"
    fi
    echo "TXT,${dmarc_name},${dmarc_txt},120" >> "$out"
    echo "" >> "$out"
  done < <(read_list_file "$DOMAINS_FILE")

  log "Wrote manual DNS records: ${out}"
}


dns_sync_domain(){
  local tenant="$1" dom="$2" zone="$3" server_ip="$4" ips_file="$5" dmarc_p="$6" dmarc_rua_tpl="$7"

  is_domain "$dom" || { warn "Skip invalid domain: $dom"; return 0; }
  is_ipv4 "$server_ip" || die "--server-ip invalid: $server_ip"

  local mailhost="mail.${dom}"
  local tdir="${TENANTS_DIR}/${tenant}"
  local sel_active sel_pending
  sel_active="$(dkim_selector_active_for_domain "$tdir" "$dom")"
  sel_pending="$(dkim_selector_pending_for_domain "$tdir" "$dom")"
  local dkim_name="${sel_active}._domainkey.${dom}"
  local dmarc_name="_dmarc.${dom}"

  # Flush first (user requested)
  local c

  c="$(cf_flush_records "$zone" "A"   "$mailhost" 0)";   [[ "$c" != "0" ]] && log "Flushing A ${mailhost} (count=${c})"
  c="$(cf_flush_records "$zone" "MX"  "$dom" 0)";        [[ "$c" != "0" ]] && log "Flushing MX ${dom} (count=${c})"
  c="$(cf_flush_records "$zone" "TXT" "$dom" 1)";        [[ "$c" != "0" ]] && log "Flushing SPF TXT at ${dom} (count=${c})"
  c="$(cf_flush_records "$zone" "TXT" "$dkim_name" 0)";  [[ "$c" != "0" ]] && log "Flushing TXT ${dkim_name} (count=${c})"
  if [[ -n "$sel_pending" && "$sel_pending" != "$sel_active" ]]; then
    local p_name="${sel_pending}._domainkey.${dom}"
    c="$(cf_flush_records "$zone" "TXT" "$p_name" 0)";  [[ "$c" != "0" ]] && log "Flushing TXT ${p_name} (count=${c})"
  fi
  c="$(cf_flush_records "$zone" "TXT" "$dmarc_name" 0)"; [[ "$c" != "0" ]] && log "Flushing TXT ${dmarc_name} (count=${c})"

  # Create A (ONLY server-ip as requested)
  cf_create_record "$zone" "A" "$mailhost" "$server_ip" 120 false
  log "DNS created: A ${mailhost}"

  # MX
  cf_create_record "$zone" "MX" "$dom" "$mailhost" 120 false 10
  log "DNS created: MX ${dom}"

  # SPF TXT (all IPs)
  local spf; spf="$(spf_value_from_ips "$ips_file")"
  cf_create_record "$zone" "TXT" "$dom" "$spf" 120 false
  log "DNS created: TXT ${dom}"

  # DKIM TXT
  local priv pub dkim_txt
  priv="$(ensure_dkim_keys "$dom" "$sel_active")"
  pub="$(dkim_public_p "$priv")"
  dkim_txt="v=DKIM1; k=rsa; p=${pub}"
  cf_create_record "$zone" "TXT" "$dkim_name" "$dkim_txt" 120 false
  log "DNS created: TXT ${dkim_name}"

  # Staged DKIM selector (if present)
  if [[ -n "$sel_pending" && "$sel_pending" != "$sel_active" ]]; then
    local p_name p_priv p_pub p_txt
    p_name="${sel_pending}._domainkey.${dom}"
    p_priv="$(ensure_dkim_keys "$dom" "$sel_pending")"
    p_pub="$(dkim_public_p "$p_priv")"
    p_txt="v=DKIM1; k=rsa; p=${p_pub}"
    cf_create_record "$zone" "TXT" "$p_name" "$p_txt" 120 false
    log "DNS created: TXT ${p_name}"
  fi

  # DMARC TXT (rua auto)
  local rua="dmarc@${dom}"
  if [[ -n "$dmarc_rua_tpl" ]]; then
    rua="${dmarc_rua_tpl//%d/$dom}"
  fi
  local dmarc_txt="v=DMARC1; p=${dmarc_p}; rua=mailto:${rua}; adkim=s; aspf=s"
  cf_create_record "$zone" "TXT" "$dmarc_name" "$dmarc_txt" 120 false
  log "DNS created: TXT ${dmarc_name}"
}

dns_sync_tenant(){
  local tenant="$1" create_zones="$2"
  local tdir="${TENANTS_DIR}/${tenant}"
  local tconf="${tdir}/tenant.conf"
  [[ -f "$tconf" ]] || die "Tenant not found: ${tenant} (missing ${tconf})"

  # shellcheck disable=SC1090
  source "$tconf"

  [[ -f "${DOMAINS_FILE:-}" ]] || die "DOMAINS_FILE missing in ${tconf}"
  [[ -f "${IPS_FILE:-}" ]] || die "IPS_FILE missing in ${tconf}"
  [[ -n "${SERVER_IP:-}" ]] || die "SERVER_IP missing in ${tconf}"


# If Cloudflare isn't configured, fall back to manual DNS output and continue.
if ! cf_ready; then
  warn "Cloudflare not initialized (no token). Skipping Cloudflare DNS sync for tenant '${tenant}'."
  write_dns_records_tenant "${tenant}"
  rebuild_dkim_map
  rebuild_dkim_selector_map
  return 0
fi



  local dom zone
  while read -r dom; do
    [[ -n "$dom" ]] || continue
    is_domain "$dom" || { warn "Skip invalid domain in list: $dom"; continue; }

    log "---- DNS sync for ${dom} ----"
    zone="$(cf_get_or_create_zone "$dom" "$create_zones" || true)"
    if [[ -z "$zone" ]]; then
      warn "Cloudflare zone missing for ${dom}. Skipping Cloudflare DNS sync for this domain (manual DNS mode)."
      continue
    fi
    dns_sync_domain "$tenant" "$dom" "$zone" "$SERVER_IP" "$IPS_FILE" "${DMARC_P:-none}" "${DMARC_RUA:-dmarc@%d}"
  done < <(read_list_file "$DOMAINS_FILE")

  # Always write a manual DNS checklist for users who manage DNS outside Cloudflare.
  # This is safe even when Cloudflare sync succeeded.
  write_dns_records_tenant "${tenant}" || true

  rebuild_dkim_map
  rebuild_dkim_selector_map
  log "DNS sync done for tenant: ${tenant}"
}

# -------------------------
# Tenant setup
# -------------------------
tenant_save(){
  local tenant="$1" domains="$2" ips="$3" users="$4" server_ip="$5" helo_tpl="$6" dmarc_p="$7" dmarc_rua="$8"
  [[ -n "$tenant" ]] || die "--tenant missing"
  [[ -f "$domains" ]] || die "--domains missing: $domains"
  [[ -f "$ips" ]] || die "--ips missing: $ips"
  [[ -f "$users" ]] || die "--users missing: $users"
  is_ipv4 "$server_ip" || die "--server-ip invalid: $server_ip"

  # Persist input lists inside the tenant folder so future actions (dns-sync, tls-issue, etc)
  # don't depend on temporary paths like /tmp/....
  local tdir="${TENANTS_DIR}/${tenant}"
  mkdir -p "$tdir"
  local dom_dst="${tdir}/domains.txt"
  local ips_dst="${tdir}/ips.txt"
  local usr_dst="${tdir}/users.txt"
  cp -f "$domains" "$dom_dst"
  cp -f "$ips" "$ips_dst"
  cp -f "$users" "$usr_dst"
  chmod 600 "$dom_dst" "$ips_dst" "$usr_dst" >/dev/null 2>&1 || true

  cat > "${tdir}/tenant.conf" <<EOF
TENANT_NAME="${tenant}"
DOMAINS_FILE="${dom_dst}"
IPS_FILE="${ips_dst}"
USERS_FILE="${usr_dst}"
SERVER_IP="${server_ip}"
HELO_TEMPLATE="${helo_tpl}"
DMARC_RUA="${dmarc_rua}"
DMARC_P="${dmarc_p}"
EOF
  chmod 600 "${tdir}/tenant.conf"
  log "Tenant saved: ${tenant}"
}



tenant_set_active(){
  local tenant="$1" new_active="$2"
  local tdir="${TENANTS_DIR}/${tenant}"
  local tconf="${tdir}/tenant.conf"
  [[ -f "$tconf" ]] || die "Tenant not found: ${tenant} (missing ${tconf})"

  # shellcheck disable=SC1090
  source "$tconf"

  [[ -f "${DOMAINS_FILE:-}" ]] || die "DOMAINS_FILE missing in ${tconf}"

  load_mailstack_db_vars

  local dom
  while read -r dom; do
    [[ -n "$dom" ]] || continue
    is_domain "$dom" || { warn "Skip invalid domain: $dom"; continue; }

    # Suspend/unsuspend all users for this domain
    mysql_exec "UPDATE ${MAIL_DB}.virtual_users SET active=${new_active} WHERE email LIKE CONCAT('%@','${dom}');" >/dev/null || true

    # Also suspend/unsuspend aliases (if used)
    mysql_exec "UPDATE ${MAIL_DB}.virtual_aliases SET active=${new_active} WHERE source LIKE CONCAT('%@','${dom}') OR destination LIKE CONCAT('%@','${dom}');" >/dev/null || true
  done < <(read_list_file "$DOMAINS_FILE")

  if [[ "$new_active" == "0" ]]; then
    log "Tenant suspended (active=0 for all mailboxes): ${tenant}"
  else
    log "Tenant unsuspended (active=1 for all mailboxes): ${tenant}"
  fi
}

cmd_tenant_suspend(){
  local tenant=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tenant) tenant="${2:-}"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done
  [[ -n "$tenant" ]] || die "tenant-suspend requires --tenant"
  tenant_set_active "$tenant" 0
  systemctl restart dovecot >/dev/null 2>&1 || true
  systemctl restart exim >/dev/null 2>&1 || true
}

cmd_tenant_unsuspend(){
  local tenant=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tenant) tenant="${2:-}"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done
  [[ -n "$tenant" ]] || die "tenant-unsuspend requires --tenant"
  tenant_set_active "$tenant" 1
  systemctl restart dovecot >/dev/null 2>&1 || true
  systemctl restart exim >/dev/null 2>&1 || true
}

cmd_tenant_purge_dns(){
  local tenant="" create_zones=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tenant) tenant="${2:-}"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done
  [[ -n "$tenant" ]] || die "tenant-purge-dns requires --tenant"

  ensure_deps

ensure_selinux_exim_db_access
  local tdir="${TENANTS_DIR}/${tenant}"
  local tconf="${tdir}/tenant.conf"
  [[ -f "$tconf" ]] || die "Tenant not found on server: ${tconf}"
  # shellcheck disable=SC1090
  source "$tconf"
  [[ -f "${DOMAINS_FILE:-}" ]] || die "DOMAINS_FILE missing in ${tconf}"

  # Best-effort: if Cloudflare isn't configured, just skip
  if ! cf_has_creds; then
    warn "Cloudflare creds not configured. Nothing to purge."
    return 0
  fi

  local dom zone mailhost sel_active sel_pending dkim_name dmarc_name c
  while read -r dom; do
    dom="$(echo "$dom" | trim | tr '[:upper:]' '[:lower:]' | sed 's/\.$//')"
    [[ -n "$dom" ]] || continue
    is_domain "$dom" || { warn "Skip invalid domain: $dom"; continue; }

    zone="$(cf_zone_id "$dom")"
    if [[ -z "$zone" ]]; then
      warn "Zone not found for ${dom}. Skipping DNS purge (manual DNS mode)."
      continue
    fi

    mailhost="mail.${dom}"
    sel_active="$(dkim_selector_active_for_domain "$tdir" "$dom")"
    sel_pending="$(dkim_selector_pending_for_domain "$tdir" "$dom")"
    dkim_name="${sel_active}._domainkey.${dom}"
    dmarc_name="_dmarc.${dom}"

    c="$(cf_flush_records "$zone" "A"   "$mailhost" 0)";   [[ "$c" != "0" ]] && log "Purged A ${mailhost} (count=${c})"
    c="$(cf_flush_records "$zone" "MX"  "$dom" 0)";        [[ "$c" != "0" ]] && log "Purged MX ${dom} (count=${c})"
    c="$(cf_flush_records "$zone" "TXT" "$dom" 1)";        [[ "$c" != "0" ]] && log "Purged SPF TXT at ${dom} (count=${c})"
    c="$(cf_flush_records "$zone" "TXT" "$dkim_name" 0)";  [[ "$c" != "0" ]] && log "Purged TXT ${dkim_name} (count=${c})"
    if [[ -n "$sel_pending" && "$sel_pending" != "$sel_active" ]]; then
      local p_name="${sel_pending}._domainkey.${dom}"
      c="$(cf_flush_records "$zone" "TXT" "$p_name" 0)";  [[ "$c" != "0" ]] && log "Purged TXT ${p_name} (count=${c})"
    fi
    c="$(cf_flush_records "$zone" "TXT" "$dmarc_name" 0)"; [[ "$c" != "0" ]] && log "Purged TXT ${dmarc_name} (count=${c})"
  done < <(read_list_file "$DOMAINS_FILE")

  log "DNS purge complete for tenant: ${tenant}"
}




# -------------------------
# Commands
# -------------------------
usage(){
  cat <<EOF
Usage:
  $0 init-cloudflare <TOKEN>

  $0 tenant-setup --tenant NAME --domains /path/domains.txt --ips /path/ips.txt --users /path/users.txt --server-ip X.X.X.X [--create-zones]
                  [--helo-template "mail.%d"] [--dmarc-policy none|quarantine|reject] [--dmarc-rua "dmarc@%d"]

  # Prepare tenant for DNS ONLY (no TLS/mailboxes/Cloudflare). Generates DKIM keys and dns-records.txt.
  $0 tenant-prepare --tenant NAME --domains /path/domains.txt --ips /path/ips.txt --users /path/users.txt --server-ip X.X.X.X
                    [--helo-template "mail.%d"] [--dmarc-policy none|quarantine|reject] [--dmarc-rua "dmarc@%d"]

  $0 dns-sync --tenant NAME [--create-zones]

  $0 exim-fix
  $0 exim-rebuild
  $0 rotate-now
  $0 dkim-stage  --tenant NAME --domain example.com
  $0 dkim-activate --tenant NAME --domain example.com
  $0 dkim-rotate --tenant NAME --domain example.com   # legacy: replaces active key immediately
  $0 tenant-remove-domain --tenant NAME --domain example.com
  $0 tenant-suspend --tenant NAME
  $0 tenant-unsuspend --tenant NAME
  $0 tls-issue --tenant NAME
  $0 tls-auto-install
  $0 tls-auto-run
  $0 tls-sync-renewed

Notes:
- A record mail.<domain> uses ONLY --server-ip
- SPF uses ALL IPs from --ips
- DMARC rua defaults to dmarc@<domain> (template supported)
- Mailboxes created for every user in --users on every domain in --domains (passwords saved to /etc/mailstack/tenants/<tenant>/mailboxes.csv)
- tenant-remove-domain removes the domain from the tenant, deletes mail users for that domain from Mailstack DB, removes vmail + DKIM keys, and rebuilds Exim maps.
- dkim-stage generates a NEW DKIM selector + key for a domain and writes both TXT records (active + staged) for zero-downtime rotation.
- dkim-activate switches Exim signing to the staged selector (DNS already present), and rebuilds Exim maps.
- dkim-rotate regenerates the DKIM keypair for ONE domain immediately (legacy; may temporarily fail until DNS updates).
- TLS automation installs a certbot deploy hook plus mailstack-tls-auto.timer. Cert issue/renew copies certs to MailStack SNI and restarts dovecot + exim.
EOF
}

cmd_dkim_rotate(){
  local tenant="" dom=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tenant) tenant="${2:-}"; shift 2;;
      --domain) dom="${2:-}"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done

  [[ -n "$tenant" ]] || die "dkim-rotate requires --tenant"
  [[ -n "$dom" ]] || die "dkim-rotate requires --domain"
  dom="$(echo "$dom" | trim | tr '[:upper:]' '[:lower:]')"
  is_domain "$dom" || die "Invalid domain: $dom"

  local tdir="${TENANTS_DIR}/${tenant}"
  local tconf="${tdir}/tenant.conf"
  [[ -f "$tconf" ]] || die "Tenant not found on server: ${tconf}"
  # shellcheck disable=SC1090
  source "$tconf"
  [[ -f "${DOMAINS_FILE:-}" ]] || die "DOMAINS_FILE missing in ${tconf}"

  # Ensure the domain belongs to the tenant (avoid rotating the wrong key)
  if ! grep -qiE "^${dom}$" "${DOMAINS_FILE}" 2>/dev/null; then
    die "Domain ${dom} is not listed in ${DOMAINS_FILE} for tenant ${tenant}"
  fi

  ensure_deps

ensure_selinux_exim_db_access
  # Rotate (replace) the key for the ACTIVE selector
  local sel_active
  sel_active="$(dkim_selector_active_for_domain "$tdir" "$dom")"
  local priv; priv="$(dkim_priv_path "$dom" "$sel_active")"
  mkdir -p "$(dirname "$priv")"
  if [[ -f "$priv" ]]; then
    cp -a "$priv" "${priv}.bak.$(date +%s)" >/dev/null 2>&1 || true
  fi

  openssl genrsa -out "$priv" 2048 >/dev/null 2>&1 || die "Failed to generate DKIM key (openssl genrsa)"
  # Fix ownership/perms + SELinux contexts
  ensure_dkim_keys "$dom" "$sel_active" >/dev/null

  # Safety: ensure Exim maps contain an entry for this domain immediately.
  # This prevents DKIM=fail after rotation if maps are stale or were never rebuilt.
  map_upsert "$DKIMKEYMAP" "$dom" "$priv"
  map_upsert "$DKIMSELMAP" "$dom" "$sel_active"

  rebuild_dkim_map
  rebuild_dkim_selector_map
  systemctl reload exim >/dev/null 2>&1 || systemctl restart exim >/dev/null 2>&1 || true

  # Rewrite manual DNS record file so the app can sync the new p= value
  write_dns_records_tenant "$tenant"

  # If Cloudflare is configured AND a zone exists for this domain, update the DKIM TXT immediately.
  # This avoids the common "DKIM fail after rotation" confusion when users manage DNS in Cloudflare.
  # We DO NOT auto-create zones here (safer); use tenant-setup/dns-sync with --create-zones if needed.
  if cf_ready; then
    local zone
    zone="$(cf_get_or_create_zone "$dom" 0 || true)"
    if [[ -n "$zone" ]]; then
      # shellcheck disable=SC1090
      source "$tconf"
      dns_sync_domain "$tenant" "$dom" "$zone" "${SERVER_IP:-}" "${IPS_FILE:-}" "${DMARC_P:-none}" "${DMARC_RUA:-dmarc@%d}" || true
    else
      warn "Cloudflare zone not found for ${dom}. DKIM rotated on server; update DNS manually using dns-records.txt."
    fi
  else
    warn "Cloudflare not initialized (no token). DKIM rotated on server; update DNS manually using dns-records.txt."
  fi

  log "DKIM rotated: ${dom} (selector=${sel_active})"
}

map_upsert(){
  local file="$1" dom="$2" val="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file" >/dev/null 2>&1 || true
  awk -F: -v d="$dom" -v v="$val" '
    BEGIN{done=0}
    {
      if (tolower($1)==tolower(d)) { print d ":" v; done=1; next }
      if (NF>0) print
    }
    END{ if (!done) print d ":" v }
  ' "$file" > "${file}.tmp" && mv -f "${file}.tmp" "$file"
}

map_delete(){
  local file="$1" dom="$2"
  [[ -f "$file" ]] || return 0
  awk -F: -v d="$dom" 'tolower($1)!=tolower(d){print}' "$file" > "${file}.tmp" && mv -f "${file}.tmp" "$file"
}

new_dkim_selector(){
  # Short + DNS-safe selector
  echo "s$(date +%Y%m%d%H%M%S)"
}

cmd_dkim_stage(){
  local tenant="" dom=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tenant) tenant="${2:-}"; shift 2;;
      --domain) dom="${2:-}"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done

  [[ -n "$tenant" ]] || die "dkim-stage requires --tenant"
  [[ -n "$dom" ]] || die "dkim-stage requires --domain"
  dom="$(echo "$dom" | trim | tr '[:upper:]' '[:lower:]')"
  is_domain "$dom" || die "Invalid domain: $dom"

  local tdir="${TENANTS_DIR}/${tenant}"
  local tconf="${tdir}/tenant.conf"
  [[ -f "$tconf" ]] || die "Tenant not found on server: ${tconf}"
  # shellcheck disable=SC1090
  source "$tconf"
  [[ -f "${DOMAINS_FILE:-}" ]] || die "DOMAINS_FILE missing in ${tconf}"

  if ! grep -qiE "^${dom}$" "${DOMAINS_FILE}" 2>/dev/null; then
    die "Domain ${dom} is not listed in ${DOMAINS_FILE} for tenant ${tenant}"
  fi

  ensure_deps

ensure_selinux_exim_db_access
  local sel_active sel_pending
  sel_active="$(dkim_selector_active_for_domain "$tdir" "$dom")"
  sel_pending="$(dkim_selector_pending_for_domain "$tdir" "$dom")"
  if [[ -n "$sel_pending" ]]; then
    log "DKIM already staged for ${dom}: pending=${sel_pending} (active=${sel_active})"
    write_dns_records_tenant "$tenant" || true
    return 0
  fi

  local sel_new
  sel_new="$(new_dkim_selector)"
  ensure_dkim_keys "$dom" "$sel_new" >/dev/null
  map_upsert "${tdir}/dkim-pending.map" "$dom" "$sel_new"
  write_dns_records_tenant "$tenant" || true

  # If Cloudflare is configured AND a zone exists for this domain, create the staged DKIM TXT now.
  if cf_ready; then
    local zone
    zone="$(cf_get_or_create_zone "$dom" 0 || true)"
    if [[ -n "$zone" ]]; then
      local p_name p_priv p_pub p_txt
      p_name="${sel_new}._domainkey.${dom}"
      p_priv="$(dkim_priv_path "$dom" "$sel_new")"
      p_pub="$(dkim_public_p "$p_priv")"
      p_txt="v=DKIM1; k=rsa; p=${p_pub}"
      cf_flush_records "$zone" "TXT" "$p_name" 0 >/dev/null || true
      cf_create_record "$zone" "TXT" "$p_name" "$p_txt" 120 false || true
      log "✅ Staged DKIM TXT created in Cloudflare: ${p_name}"
    else
      warn "Cloudflare zone not found for ${dom}. Staged DKIM created on server; update DNS manually using dns-records.txt."
    fi
  fi

  log "✅ DKIM staged: ${dom} (active=${sel_active}, pending=${sel_new})"
}

cmd_dkim_activate(){
  local tenant="" dom=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tenant) tenant="${2:-}"; shift 2;;
      --domain) dom="${2:-}"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done

  [[ -n "$tenant" ]] || die "dkim-activate requires --tenant"
  [[ -n "$dom" ]] || die "dkim-activate requires --domain"
  dom="$(echo "$dom" | trim | tr '[:upper:]' '[:lower:]')"
  is_domain "$dom" || die "Invalid domain: $dom"

  local tdir="${TENANTS_DIR}/${tenant}"
  local tconf="${tdir}/tenant.conf"
  [[ -f "$tconf" ]] || die "Tenant not found on server: ${tconf}"
  # shellcheck disable=SC1090
  source "$tconf"
  [[ -f "${DOMAINS_FILE:-}" ]] || die "DOMAINS_FILE missing in ${tconf}"

  if ! grep -qiE "^${dom}$" "${DOMAINS_FILE}" 2>/dev/null; then
    die "Domain ${dom} is not listed in ${DOMAINS_FILE} for tenant ${tenant}"
  fi

  ensure_deps

ensure_selinux_exim_db_access
  local sel_pending
  sel_pending="$(dkim_selector_pending_for_domain "$tdir" "$dom")"
  [[ -n "$sel_pending" ]] || die "No staged DKIM selector found for ${dom}. Run dkim-stage first."

  map_upsert "${tdir}/dkim-selector.map" "$dom" "$sel_pending"
  map_delete "${tdir}/dkim-pending.map" "$dom"

  rebuild_dkim_map
  rebuild_dkim_selector_map
  systemctl reload exim >/dev/null 2>&1 || systemctl restart exim >/dev/null 2>&1 || true
  write_dns_records_tenant "$tenant" || true

  # If Cloudflare is configured AND a zone exists for this domain, sync the NEW active selector TXT now.
  # This prevents DKIM mismatches after activation when users manage DNS in Cloudflare.
  if cf_ready; then
    local zone
    zone="$(cf_get_or_create_zone "$dom" 0 || true)"
    if [[ -n "$zone" ]]; then
      # shellcheck disable=SC1090
      source "$tconf"
      dns_sync_domain "$tenant" "$dom" "$zone" "${SERVER_IP:-}" "${IPS_FILE:-}" "${DMARC_P:-none}" "${DMARC_RUA:-dmarc@%d}" || true
      log "✅ Cloudflare DKIM synced after activation: ${sel_pending}._domainkey.${dom}"
    else
      warn "Cloudflare zone not found for ${dom}. Update DNS manually using dns-records.txt."
    fi
  fi

  log "✅ DKIM activated: ${dom} (selector=${sel_pending})"
}

cmd_init_cloudflare(){
  local token="${1:-}"
  local email="${2:-}"
  [[ -n "$token" ]] || die "Usage: $0 init-cloudflare <TOKEN> [ACME_EMAIL]"
  cf_save_token "$token" "$email"
  install_mailstack_tls_automation || true
}

cmd_tenant_setup(){
  local tenant="" domains="" ips="" users="" server_ip=""
  local create_zones=0
  local helo_tpl="mail.%d"
  local dmarc_p="none"
  local dmarc_rua="dmarc@%d"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tenant) tenant="${2:-}"; shift 2;;
      --domains) domains="${2:-}"; shift 2;;
      --ips) ips="${2:-}"; shift 2;;
      --users) users="${2:-}"; shift 2;;
      --server-ip) server_ip="${2:-}"; shift 2;;
      --create-zones) create_zones=1; shift 1;;
      --helo-template) helo_tpl="${2:-}"; shift 2;;
      --dmarc-policy) dmarc_p="${2:-}"; shift 2;;
      --dmarc-rua) dmarc_rua="${2:-}"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done

  ensure_deps
ensure_selinux_exim_db_access
  tenant_save "$tenant" "$domains" "$ips" "$users" "$server_ip" "$helo_tpl" "$dmarc_p" "$dmarc_rua"
  install_mailstack_tls_automation

  # DNS sync first (creates DKIM + records)
  dns_sync_tenant "$tenant" "$create_zones"

  # Try TLS issuance for mail.<domain> (will skip if domain not delegated yet)
  cmd_tls_issue --tenant "$tenant" || true

  # Create mailboxes (users × domains)
  tenant_mailboxes_create "$tenant" "$domains" "$users"

  # Install rotator + patch exim + rebuild maps
  install_rotator
  exim_fix
  rebuild_dkim_map
  rebuild_dkim_selector_map
  rebuild_local_domains
  "$ROTATOR" all >/dev/null || true

  log "Tenant setup complete: ${tenant}"
}

# Prepare tenant WITHOUT creating mailboxes / issuing TLS / touching Cloudflare.
# Intended to run immediately when a domain is added in the app, so DKIM keys exist
# and manual DNS records show the REAL server key (no fake/guessed DKIM from the app).
cmd_tenant_prepare(){
  local tenant="" domains="" ips="" users="" server_ip=""
  local helo_tpl="mail.%d"
  local dmarc_p="none"
  local dmarc_rua="dmarc@%d"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tenant) tenant="${2:-}"; shift 2;;
      --domains) domains="${2:-}"; shift 2;;
      --ips) ips="${2:-}"; shift 2;;
      --users) users="${2:-}"; shift 2;;
      --server-ip) server_ip="${2:-}"; shift 2;;
      --helo-template) helo_tpl="${2:-}"; shift 2;;
      --dmarc-policy) dmarc_p="${2:-}"; shift 2;;
      --dmarc-rua) dmarc_rua="${2:-}"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done

  ensure_deps
ensure_selinux_exim_db_access
  tenant_save "$tenant" "$domains" "$ips" "$users" "$server_ip" "$helo_tpl" "$dmarc_p" "$dmarc_rua"

  # Generate manual DNS file (ensures DKIM keys exist).
  write_dns_records_tenant "$tenant"

  # Ensure Exim has the DKIM map lookups, then rebuild maps.
  install_rotator
  exim_fix
  rebuild_dkim_map
  rebuild_dkim_selector_map
  rebuild_local_domains
  "$ROTATOR" all >/dev/null || true
  systemctl restart exim >/dev/null 2>&1 || true

  log "Tenant prepared (no TLS/mailboxes): ${tenant}"
}

cmd_dns_sync(){
  local tenant="" create_zones=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tenant) tenant="${2:-}"; shift 2;;
      --create-zones) create_zones=1; shift 1;;
      *) die "Unknown arg: $1";;
    esac
  done
  [[ -n "$tenant" ]] || die "dns-sync requires --tenant"
  ensure_deps
ensure_selinux_exim_db_access
  dns_sync_tenant "$tenant" "$create_zones"
  "$ROTATOR" all >/dev/null || true
  install_mailstack_tls_automation
  cmd_tls_issue --tenant "$tenant" || true
}

cmd_exim_fix(){
  ensure_deps
ensure_selinux_exim_db_access
  install_rotator
  exim_fix
  "$ROTATOR" all >/dev/null || true
}

cmd_exim_rebuild(){
  ensure_selinux_exim_db_access
  ensure_deps
ensure_selinux_exim_db_access
  rebuild_dkim_map
  rebuild_local_domains
  install_rotator
  "$ROTATOR" all || true
  exim_validate || die "Exim validation failed after rebuild"
    fix_exim_maps_context_and_perms
systemctl restart exim || true
  log "Rebuild complete."
}

cmd_rotate_now(){
  install_rotator
  "$ROTATOR" all
}

delete_domain_mail_data(){
  local dom="$1"
  load_mailstack_db_vars

  # Delete users for this domain (best-effort)
  mysql_exec "DELETE FROM ${MAIL_DB}.virtual_users WHERE email LIKE '%@${dom}';" >/dev/null || true

  # Delete domain row if no users reference it anymore
  mysql_exec "DELETE d FROM ${MAIL_DB}.virtual_domains d LEFT JOIN ${MAIL_DB}.virtual_users u ON u.domain_id=d.id WHERE d.name='${dom}' AND u.id IS NULL;" >/dev/null || true

  # Remove maildir data
  rm -rf "/var/vmail/${dom}" 2>/dev/null || true
}

cmd_tenant_remove_domain(){
  local tenant="" dom=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tenant) tenant="${2:-}"; shift 2;;
      --domain) dom="${2:-}"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done
  [[ -n "$tenant" ]] || die "tenant-remove-domain requires --tenant"
  [[ -n "$dom" ]] || die "tenant-remove-domain requires --domain"
  dom="$(echo "$dom" | trim | tr '[:upper:]' '[:lower:]' | sed 's/\.$//')"
  is_domain "$dom" || die "Invalid domain: $dom"

  ensure_deps

ensure_selinux_exim_db_access
  local tdir="${TENANTS_DIR}/${tenant}"
  local domains_file="${tdir}/domains.txt"
  [[ -d "$tdir" ]] || die "Tenant not found on server: ${tdir}"

  # Remove from tenant domains list (keep file if it becomes empty)
  if [[ -f "$domains_file" ]]; then
    grep -v -E "^[[:space:]]*${dom//./\\.}[[:space:]]*$" "$domains_file" > "${domains_file}.tmp" || true
    mv -f "${domains_file}.tmp" "$domains_file"
    chmod 600 "$domains_file" 2>/dev/null || true
  fi

  # Remove DKIM keys for this domain (will also be removed from map rebuild)
  rm -rf "/etc/exim/dkim/${dom}" 2>/dev/null || true

  # Remove any staged/active selector mappings for this domain
  map_delete "${tdir}/dkim-selector.map" "$dom" || true
  map_delete "${tdir}/dkim-pending.map" "$dom" || true

  # Remove mailbox users + maildirs for this domain
  delete_domain_mail_data "$dom"

  # Rebuild maps + rotate
  rebuild_dkim_map || true
  rebuild_dkim_selector_map || true
  rebuild_local_domains || true
  install_rotator
  "$ROTATOR" all >/dev/null || true
  systemctl restart dovecot >/dev/null 2>&1 || true
  systemctl restart exim >/dev/null 2>&1 || true

  log "Removed domain from tenant + deleted mailboxes on server: tenant=${tenant} domain=${dom}"
}


# -------------------------
# -------------------------
# TLS (Let's Encrypt) via certbot + Cloudflare DNS-01
# -------------------------
CERTS_DIR="${STATE_DIR}/certs"
DOVECOT_SNI_FILE="/etc/dovecot/conf.d/99-mailstack-sni.conf"
CF_CREDS_FILE="/etc/letsencrypt/cloudflare.ini"
TENANT_LE_HOOK="/etc/letsencrypt/renewal-hooks/deploy/20-mailstack-tenant-sni.sh"
MAILSTACK_TLS_AUTO_SCRIPT="/usr/local/sbin/mailstack-addon"
MAILSTACK_TLS_AUTO_SERVICE="/etc/systemd/system/mailstack-tls-auto.service"
MAILSTACK_TLS_AUTO_TIMER="/etc/systemd/system/mailstack-tls-auto.timer"


restart_mail_services(){
  # Dovecot/Exim must reload the copied SNI certs immediately after issue/renew.
  # User explicitly wants restarts, not only reloads, because Dovecot can keep old TLS material in memory.
  systemctl restart dovecot >/dev/null 2>&1 || systemctl reload dovecot >/dev/null 2>&1 || true
  systemctl restart exim >/dev/null 2>&1 || systemctl reload exim >/dev/null 2>&1 || true
}

ensure_certbot_cloudflare(){
  ensure_deps
ensure_selinux_exim_db_access
  require_cmd certbot
  # Cloudflare DNS plugin for certbot (EPEL)
  # Package name on AlmaLinux/RHEL: python3-certbot-dns-cloudflare
  rpm -q python3-certbot-dns-cloudflare >/dev/null 2>&1 || dnf -y install python3-certbot-dns-cloudflare >/dev/null
}


install_tenant_certbot_hook(){
  log "Installing MailStack tenant certbot deploy hook..."
  mkdir -p "$(dirname "$TENANT_LE_HOOK")"
  cat > "$TENANT_LE_HOOK" <<'EOH'
#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="/etc/mailstack"
CERTS_DIR="${STATE_DIR}/certs"
DOVECOT_SNI_FILE="/etc/dovecot/conf.d/99-mailstack-sni.conf"

sync_one(){
  local live="$1"
  local host
  host="$(basename "$live")"
  [[ "$host" == mail.* ]] || return 0
  [[ -f "${live}/fullchain.pem" && -f "${live}/privkey.pem" ]] || return 0
  mkdir -p "${CERTS_DIR}/${host}"
  install -m 0644 -o root -g root "${live}/fullchain.pem" "${CERTS_DIR}/${host}/fullchain.pem"
  install -m 0600 -o root -g root "${live}/privkey.pem" "${CERTS_DIR}/${host}/privkey.pem"
}

if [[ -n "${RENEWED_LINEAGE:-}" ]]; then
  sync_one "$RENEWED_LINEAGE"
else
  for live in /etc/letsencrypt/live/mail.*; do
    [[ -d "$live" ]] || continue
    sync_one "$live"
  done
fi

mkdir -p "$(dirname "$DOVECOT_SNI_FILE")"
{
  echo "# Auto-generated by MailStack tenant certbot deploy hook"
  echo "# DO NOT EDIT MANUALLY"
  echo ""
  if [[ -d "$CERTS_DIR" ]]; then
    for d in "$CERTS_DIR"/mail.*; do
      [[ -d "$d" ]] || continue
      host="$(basename "$d")"
      cert="$d/fullchain.pem"
      key="$d/privkey.pem"
      [[ -f "$cert" && -f "$key" ]] || continue
      echo "local_name ${host} {"
      echo "  ssl_cert = <${cert}"
      echo "  ssl_key  = <${key}"
      echo "}"
      echo ""
    done
  fi
} > "$DOVECOT_SNI_FILE"

systemctl restart dovecot >/dev/null 2>&1 || systemctl reload dovecot >/dev/null 2>&1 || true
systemctl restart exim >/dev/null 2>&1 || systemctl reload exim >/dev/null 2>&1 || true
EOH
  chmod +x "$TENANT_LE_HOOK"

  # Make sure certbot's renewal timer exists/runs on systems where it is packaged as a systemd timer.
  systemctl enable --now certbot-renew.timer >/dev/null 2>&1 || \
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
}

sync_existing_tenant_certs(){
  install_tenant_certbot_hook
  if [[ -x "$TENANT_LE_HOOK" ]]; then
    "$TENANT_LE_HOOK" || true
  fi
}

install_mailstack_tls_automation(){
  install_tenant_certbot_hook

  # Install the latest addon script to a stable path so systemd can retry TLS issuance
  # even if the project directory changes after an app deploy.
  mkdir -p "$(dirname "$MAILSTACK_TLS_AUTO_SCRIPT")"
  install -m 0755 -o root -g root "$(readlink -f "$0")" "$MAILSTACK_TLS_AUTO_SCRIPT" 2>/dev/null || true

  cat > "$MAILSTACK_TLS_AUTO_SERVICE" <<EOF
[Unit]
Description=MailStack automatic TLS issuer and SNI sync
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${MAILSTACK_TLS_AUTO_SCRIPT} tls-auto-run
EOF

  cat > "$MAILSTACK_TLS_AUTO_TIMER" <<'EOF'
[Unit]
Description=Retry MailStack TLS issuance automatically

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable --now mailstack-tls-auto.timer >/dev/null 2>&1 || true
  systemctl enable --now certbot-renew.timer >/dev/null 2>&1 || \
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
}

cmd_tls_auto_run(){
  ensure_deps
  ensure_selinux_exim_db_access
  install_tenant_certbot_hook

  if ! cf_ready; then
    warn "Cloudflare not initialized; automatic TLS issuance cannot run yet."
    sync_existing_tenant_certs
    return 0
  fi

  local found=0
  if [[ -d "$TENANTS_DIR" ]]; then
    for tdir in "$TENANTS_DIR"/*; do
      [[ -d "$tdir" ]] || continue
      [[ -f "$tdir/domains.txt" ]] || continue
      local tenant
      tenant="$(basename "$tdir")"
      found=1
      log "Auto TLS check: tenant=${tenant}"
      cmd_tls_issue --tenant "$tenant" || true
    done
  fi

  if [[ "$found" -eq 0 ]]; then
    log "Auto TLS check: no tenants found."
  fi

  sync_existing_tenant_certs
  rebuild_dovecot_sni
  restart_mail_services
}

cmd_tls_auto_install(){
  ensure_deps
  ensure_selinux_exim_db_access
  install_mailstack_tls_automation
  sync_existing_tenant_certs
  restart_mail_services
  log "MailStack TLS automation installed: mailstack-tls-auto.timer + certbot deploy hook"
}

write_cf_creds(){
  cf_load
  mkdir -p "$(dirname "$CF_CREDS_FILE")"
  cat > "$CF_CREDS_FILE" <<EOF
dns_cloudflare_api_token = ${CF_API_TOKEN}
EOF
  chmod 600 "$CF_CREDS_FILE"
}

# Check if a domain is actually delegated to Cloudflare (nameservers set at registrar)
# Returns 0 if likely delegated, else 1.
cf_is_delegated(){
  local domain="$1"
  # get Cloudflare-assigned nameservers (works even for pending zones)
  local zid zinfo ns1 ns2
  zid="$(cf_get_or_create_zone "$domain" 0 || true)"
  if [[ -n "$zid" ]]; then
    zinfo="$(cf_req GET "/zones/${zid}" || true)"
    ns1="$(echo "$zinfo" | jq -r '.result.name_servers[0] // empty' 2>/dev/null || true)"
    ns2="$(echo "$zinfo" | jq -r '.result.name_servers[1] // empty' 2>/dev/null || true)"
  fi
  # current authoritative NS (public DNS)
  local cur
  # NOTE: keep this parsing very simple; dig output has one NS per line.
  # (Complex quoting here can break and cause errors like: sed: unknown command: '"'.)
  cur="$(dig +short NS "$domain" 2>/dev/null | tr -d '\r' | sort -u | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  if [[ "$cur" == *"cloudflare.com"* ]]; then
    return 0
  fi
  warn "Nameservers not pointing to Cloudflare yet for ${domain}. Current NS: ${cur:-<none>}"
  if [[ -n "${ns1:-}" && -n "${ns2:-}" ]]; then
    warn "Set registrar nameservers for ${domain} to: ${ns1}, ${ns2}"
  fi
  return 1
}

certbot_issue_host(){
  local host="$1" tenant="$2"
  local domain="${host#mail.}"

  cf_load
  ensure_certbot_cloudflare
  write_cf_creds
  install_tenant_certbot_hook

  # Email used for Let's Encrypt registration (certbot). Must contain a dot in domain.
  local email="${MAILSTACK_ACME_EMAIL:-}"
  if [[ -z "$email" ]]; then
    email="sales@bullten.com"
  fi
  if [[ ! "$email" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then
    warn "Invalid MAILSTACK_ACME_EMAIL='${email}'. Falling back to postmaster@${domain}"
    email="postmaster@${domain}"
  fi

  if ! cf_is_delegated "$domain"; then
    warn "TLS skipped for ${host} until domain is delegated to Cloudflare."
    return 2
  fi

  mkdir -p "${CERTS_DIR}/${host}"

  local out
  out="$(certbot certonly -n --agree-tos -m "$email" \
      --dns-cloudflare --dns-cloudflare-credentials "$CF_CREDS_FILE" \
      --dns-cloudflare-propagation-seconds 60 \
      --cert-name "$host" -d "$host" 2>&1)" || {
    warn "certbot issue failed for ${host}. Output:"; echo "$out" >&2
    return 1
  }

  local live="/etc/letsencrypt/live/${host}"
  if [[ ! -f "${live}/fullchain.pem" || ! -f "${live}/privkey.pem" ]]; then
    warn "certbot succeeded but expected files missing in ${live}"
    return 1
  fi

  install -m 644 "${live}/fullchain.pem" "${CERTS_DIR}/${host}/fullchain.pem"
  install -m 600 "${live}/privkey.pem"   "${CERTS_DIR}/${host}/privkey.pem"

  restart_mail_services

  log "TLS OK: ${host}"
  echo "${host}" >> "${TENANTS_DIR}/${tenant}/certs-ok.txt"
  return 0
}

rebuild_dovecot_sni(){
  mkdir -p "$(dirname "$DOVECOT_SNI_FILE")"
  {
    echo "# Auto-generated by mailstack-addon.sh (MailStack SNI)"
    echo "# DO NOT EDIT MANUALLY"
    echo ""
    if [[ -d "$CERTS_DIR" ]]; then
      for d in "$CERTS_DIR"/mail.*; do
        [[ -d "$d" ]] || continue
        host="$(basename "$d")"
        cert="$d/fullchain.pem"
        key="$d/privkey.pem"
        [[ -f "$cert" && -f "$key" ]] || continue
        echo "local_name ${host} {"
        echo "  ssl_cert = <${cert}"
        echo "  ssl_key  = <${key}"
        echo "}"
        echo ""
      done
    fi
  } > "$DOVECOT_SNI_FILE"

  restart_mail_services
}

cmd_tls_issue(){
  local tenant="" domains_file=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tenant) tenant="${2:-}"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done
  [[ -n "$tenant" ]] || die "tls-issue requires --tenant"

  local tdir="${TENANTS_DIR}/${tenant}"
  domains_file="${tdir}/domains.txt"
  [[ -d "$tdir" ]] || die "Tenant not found on server: ${tdir}"
  [[ -f "$domains_file" ]] || die "Missing domains list: ${domains_file}"

  : > "${tdir}/certs-ok.txt" || true

  ensure_deps

  ensure_selinux_exim_db_access
  install_mailstack_tls_automation
if ! cf_ready; then
  warn "Cloudflare not initialized (no token). TLS issuance requires Cloudflare DNS-01 in this build. Skipping."
  return 0
fi

  require_cmd dig
  require_cmd curl

  local ok=0 fail=0 skip=0
  while read -r dom; do
    dom="$(echo "$dom" | trim)"
    [[ -n "$dom" ]] || continue
    local host="mail.${dom}"
    log "Issuing TLS cert (DNS-01): ${host}"

    # Retry 3 times but show output
    local attempt rc=1
    for attempt in 1 2 3; do
      certbot_issue_host "$host" "$tenant"; rc=$?
      if [[ $rc -eq 0 ]]; then ok=$((ok+1)); break; fi
      if [[ $rc -eq 2 ]]; then skip=$((skip+1)); break; fi
      warn "certbot issue failed for ${host} (attempt ${attempt}/3). Retrying..."
      sleep 10
    done

    if [[ $rc -ne 0 && $rc -ne 2 ]]; then
      fail=$((fail+1))
      warn "TLS FAILED: ${host}. (Check: domain delegated to Cloudflare + token permissions)"
    fi
  done < <(read_list_file "$domains_file")

  sync_existing_tenant_certs
  rebuild_dovecot_sni
  restart_mail_services
  log "TLS issuance done. OK=${ok} FAIL=${fail} SKIP=${skip}. OK list: ${tdir}/certs-ok.txt"
}

# -------------------------
# Main
# -------------------------
need_root
ACTION="${1:-}"; shift || true

case "$ACTION" in
  init-cloudflare) cmd_init_cloudflare "$@";;
  tenant-setup) cmd_tenant_setup "$@";;
  tenant-prepare) cmd_tenant_prepare "$@";;
  dns-sync) cmd_dns_sync "$@";;
  exim-fix) cmd_exim_fix;;
  exim-rebuild) cmd_exim_rebuild;;
  rotate-now) cmd_rotate_now;;
  dkim-stage) cmd_dkim_stage "$@";;
  dkim-activate) cmd_dkim_activate "$@";;
  dkim-rotate) cmd_dkim_rotate "$@";;
  tenant-remove-domain) cmd_tenant_remove_domain "$@";;
  tenant-suspend) cmd_tenant_suspend "$@";;
  tenant-unsuspend) cmd_tenant_unsuspend "$@";;
  tls-issue) cmd_tls_issue "$@";;
  tls-auto-install) cmd_tls_auto_install;;
  tls-auto-run) cmd_tls_auto_run;;
  tls-sync-renewed) sync_existing_tenant_certs; restart_mail_services;;
  ""|-h|--help|help) usage;;
  *) die "Unknown command: $ACTION (try: $0 --help)";;
esac

