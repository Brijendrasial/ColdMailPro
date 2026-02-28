#!/usr/bin/env bash

install_aiops_agent_systemd() {
  # Install & enable AIOps agent (system-level monitoring + safe remediation)
  if [[ -f "${SCRIPT_DIR}/systemd/coldmail-aiops.service" ]]; then
    cp -f "${SCRIPT_DIR}/systemd/coldmail-aiops.service" /etc/systemd/system/coldmail-aiops.service || true
    cp -f "${SCRIPT_DIR}/systemd/coldmail-aiops.timer" /etc/systemd/system/coldmail-aiops.timer || true
    chmod 644 /etc/systemd/system/coldmail-aiops.service /etc/systemd/system/coldmail-aiops.timer || true
    systemctl daemon-reload || true
    systemctl enable --now coldmail-aiops.timer || true

    # Install agent into /usr/local/bin (avoids SELinux admin_home_t execution blocks)
    if [[ -f "${SCRIPT_DIR}/aiops-agent.sh" ]]; then
      cp -f "${SCRIPT_DIR}/aiops-agent.sh" /usr/local/bin/coldmail-aiops-agent || true
      chmod 755 /usr/local/bin/coldmail-aiops-agent || true
      chown root:root /usr/local/bin/coldmail-aiops-agent || true
      if command -v restorecon >/dev/null 2>&1; then
        restorecon -v /usr/local/bin/coldmail-aiops-agent >/dev/null 2>&1 || true
      fi
    fi
  fi
}


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


set -Eeuo pipefail

# ==========================================================
# Mailstack for AlmaLinux 9 (SSL-only, IPv4-only outbound)
# Exim + Dovecot (MySQL virtual users) + Roundcube + phpMyAdmin
# + Nginx + MariaDB + Let's Encrypt (certs preserved on uninstall)
#
# Key fixes included:
# - Roundcube defaults.inc.php fixed via /usr/share/roundcubemail/config -> /etc/roundcubemail
# - phpMyAdmin session cookie fix: ForceSSL + PmaAbsoluteUri + TempDir + correct PHP session perms
# - Exim TLS permission denied fix: /etc/exim + /etc/exim/ssl perms + SELinux cert_t
# - Exim relay for authenticated + localhost: ACL binding + accept authenticated + accept localhost
# - Dovecot "Garbage after '{'" fix: NO one-line braces; only multi-line blocks
# - Dovecot "Unknown database driver mysql" fix: installs dovecot-mysql and config uses driver=mysql
# - Stops PAM auth (reduces pam_unix auth failures) => SQL-only
# - IPv6 disabled at OS level + Exim outbound interface bound to primary IPv4
# - Uninstall keeps /etc/letsencrypt and /etc/mailstack/secrets.txt for reuse
# ==========================================================

STATE_DIR="/etc/mailstack"
SECRETS_FILE="${STATE_DIR}/secrets.txt"

NGINX_CONF="/etc/nginx/conf.d/mailstack.conf"
NGINX_ACME_ROOT="/var/www/letsencrypt"

EXIM_CONF="/etc/exim/exim.conf"
EXIM_SSL_DIR="/etc/exim/ssl"

DOVECOT_SSL_DIR="/etc/dovecot/ssl"
DOVECOT_OVERRIDE="/etc/dovecot/conf.d/99-mailstack.conf"
DOVECOT_SQL_CONF="/etc/dovecot/dovecot-sql.conf.ext"
DOVECOT_EXIM_AUTH_ABS="/run/dovecot/exim-auth"

ROUNDCUBE_ETC_DIR="/etc/roundcubemail"
ROUNDCUBE_WEB_DIR="/usr/share/roundcubemail"
ROUNDCUBE_WEB_CONFIG_DIR="/usr/share/roundcubemail/config"
ROUNDCUBE_CONF="${ROUNDCUBE_ETC_DIR}/config.inc.php"

PHPMYADMIN_CONF="/etc/phpMyAdmin/config.inc.php"
LE_HOOK="/etc/letsencrypt/renewal-hooks/deploy/00-mailstack-copy.sh"

VMAIL_USER="vmail"
VMAIL_GROUP="vmail"
VMAIL_HOME="/var/vmail"

RC_DB="roundcube"
RC_DB_USER="roundcube"

MAIL_DB="mailserver"
MAIL_DB_USER="mailuser"

die(){ echo "❌ $*" >&2; exit 1; }
log(){ echo "✅ $*" >&2; }
warn(){ echo "⚠️  $*" >&2; }

need_root(){ [[ "${EUID}" -eq 0 ]] || die "Run as root"; }
rand_hex(){ openssl rand -hex 32; }
is_hex64(){ [[ "${1:-}" =~ ^[0-9a-f]{64}$ ]]; }

get_secret() {
  local key="$1"
  [[ -f "${SECRETS_FILE}" ]] || return 1
  grep -m1 "^${key}=" "${SECRETS_FILE}" | cut -d= -f2- || true
}
set_secret() {
  local key="$1" val="$2"
  mkdir -p "${STATE_DIR}"
  if [[ -f "${SECRETS_FILE}" ]] && grep -q "^${key}=" "${SECRETS_FILE}"; then
    sed -i "s/^${key}=.*/${key}=${val}/" "${SECRETS_FILE}"
  else
    echo "${key}=${val}" >> "${SECRETS_FILE}"
  fi
  chmod 600 "${SECRETS_FILE}"
}

dnf_install(){ dnf -y install "$@"; }
svc_enable_start(){ systemctl enable --now "$@"; }
svc_disable_stop(){ systemctl disable --now "$@" 2>/dev/null || true; }

# -------------------------
# Firewall
# -------------------------
firewalld_open() {
  if systemctl is-enabled --quiet firewalld 2>/dev/null; then
    firewall-cmd --permanent --add-service=http  || true
    firewall-cmd --permanent --add-service=https || true
    firewall-cmd --permanent --add-service=smtp  || true
    firewall-cmd --permanent --add-service=smtps || true
    firewall-cmd --permanent --add-port=587/tcp || true # submission
    firewall-cmd --permanent --add-port=993/tcp || true # imaps
    firewall-cmd --permanent --add-port=995/tcp || true # pop3s
    firewall-cmd --reload || true
  fi
}
firewalld_close() {
  if systemctl is-enabled --quiet firewalld 2>/dev/null; then
    firewall-cmd --permanent --remove-service=http  || true
    firewall-cmd --permanent --remove-service=https || true
    firewall-cmd --permanent --remove-service=smtp  || true
    firewall-cmd --permanent --remove-service=smtps || true
    firewall-cmd --permanent --remove-port=587/tcp || true
    firewall-cmd --permanent --remove-port=993/tcp || true
    firewall-cmd --permanent --remove-port=995/tcp || true
    firewall-cmd --reload || true
  fi
}

# -------------------------
# IPv6 disable (OS level)
# -------------------------
disable_ipv6_os() {
  log "Disabling IPv6 on OS (forces IPv4-only outbound)..."
  cat >/etc/sysctl.d/99-disable-ipv6.conf <<'EOT'
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
net.ipv6.conf.lo.disable_ipv6 = 1
EOT
  sysctl --system >/dev/null 2>&1 || true

  for dev in $(ip -o link show | awk -F': ' '{print $2}'); do
    ip -6 addr flush dev "$dev" 2>/dev/null || true
  done
}

get_primary_ipv4() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}'
}

# -------------------------
# MariaDB robust start + root password bootstrap
# -------------------------
mariadb_fix_stale_socket() {
  systemctl stop mariadb 2>/dev/null || true
  pkill -9 -f mariadbd 2>/dev/null || true
  pkill -9 -f mysqld 2>/dev/null || true
  pkill -9 -f mysqld_safe 2>/dev/null || true

  rm -f /var/lib/mysql/mysql.sock /var/lib/mysql/mysql.sock.lock
  rm -f /var/run/mariadb/mariadb.pid /var/run/mariadb/mariadb.pid.lock 2>/dev/null || true
  rm -f /var/run/mysqld/mysqld.sock /var/run/mysqld/mysqld.pid 2>/dev/null || true

  mkdir -p /var/run/mariadb /var/run/mysqld
  chown -R mysql:mysql /var/run/mariadb /var/run/mysqld /var/lib/mysql || true
}

mariadb_can_login_no_pass(){ mariadb -u root -e "SELECT 1;" >/dev/null 2>&1; }
mariadb_can_login_with_pass(){ mariadb -u root -p"$1" -e "SELECT 1;" >/dev/null 2>&1; }

bootstrap_mariadb_root_password() {
  local newpass="$1"
  log "Bootstrapping MariaDB root password (skip-grant-tables temporary)..."

  mariadb_fix_stale_socket
  nohup mysqld_safe --skip-grant-tables --skip-networking >/tmp/mysqld_safe_mailstack.log 2>&1 &
  sleep 6

  mariadb -u root <<SQL
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY '${newpass}';
FLUSH PRIVILEGES;
SQL

  pkill -f "mysqld_safe --skip-grant-tables" 2>/dev/null || true
  pkill -f "mysqld --skip-grant-tables" 2>/dev/null || true
  sleep 3

  mariadb_fix_stale_socket
  systemctl start mariadb
  sleep 2

  mariadb_can_login_with_pass "${newpass}" || die "MariaDB root bootstrap failed."
}

ensure_mariadb_access() {
  local desired="$1"

  mariadb_fix_stale_socket
  systemctl enable --now mariadb || true

  if ! systemctl is-active --quiet mariadb; then
    journalctl -xeu mariadb -n 200 --no-pager || true
    die "MariaDB is not running."
  fi

  local saved
  saved="$(get_secret "MYSQL_ROOT_PASSWORD" || true)"
  if is_hex64 "${saved}" && mariadb_can_login_with_pass "${saved}"; then
    log "Reusing MariaDB root password from ${SECRETS_FILE}"
    printf '%s\n' "${saved}"; return 0
  fi

  if mariadb_can_login_no_pass; then
    log "MariaDB root works without password; setting one..."
    mariadb -u root <<SQL
ALTER USER 'root'@'localhost' IDENTIFIED BY '${desired}';
FLUSH PRIVILEGES;
SQL
    mariadb_can_login_with_pass "${desired}" || die "Failed to set MariaDB root password."
    printf '%s\n' "${desired}"; return 0
  fi

  if mariadb_can_login_with_pass "${desired}"; then
    printf '%s\n' "${desired}"; return 0
  fi

  bootstrap_mariadb_root_password "${desired}"
  printf '%s\n' "${desired}"
}

write_root_mycnf() {
  local rootpass="$1"
  cat > /root/.my.cnf <<EOF2
[client]
user=root
password=${rootpass}
host=localhost
EOF2
  chmod 600 /root/.my.cnf
}

# -------------------------
# Let's Encrypt -> copy certs for Exim/Dovecot + perms + SELinux
# -------------------------
copy_tls_for_services() {
  local fqdn="$1"

  mkdir -p "${EXIM_SSL_DIR}" "${DOVECOT_SSL_DIR}"
  chmod 0750 "${EXIM_SSL_DIR}" "${DOVECOT_SSL_DIR}"

  install -m 0644 -o root -g root "/etc/letsencrypt/live/${fqdn}/fullchain.pem" "${EXIM_SSL_DIR}/fullchain.pem"
  install -m 0644 -o root -g root "/etc/letsencrypt/live/${fqdn}/fullchain.pem" "${DOVECOT_SSL_DIR}/fullchain.pem"

  getent group exim >/dev/null 2>&1 || groupadd exim
  install -m 0640 -o root -g exim "/etc/letsencrypt/live/${fqdn}/privkey.pem" "${EXIM_SSL_DIR}/privkey.pem" \
    || install -m 0600 -o root -g root "/etc/letsencrypt/live/${fqdn}/privkey.pem" "${EXIM_SSL_DIR}/privkey.pem"

  if getent group dovecot >/dev/null 2>&1; then
    install -m 0640 -o root -g dovecot "/etc/letsencrypt/live/${fqdn}/privkey.pem" "${DOVECOT_SSL_DIR}/privkey.pem" \
      || install -m 0600 -o root -g root "/etc/letsencrypt/live/${fqdn}/privkey.pem" "${DOVECOT_SSL_DIR}/privkey.pem"
  else
    install -m 0600 -o root -g root "/etc/letsencrypt/live/${fqdn}/privkey.pem" "${DOVECOT_SSL_DIR}/privkey.pem"
  fi

  # Fix exim traversal permissions (for fullchain read)
  chgrp exim /etc/exim /etc/exim/ssl 2>/dev/null || true
  chmod 0750 /etc/exim /etc/exim/ssl 2>/dev/null || true

  dnf -y install policycoreutils-python-utils >/dev/null 2>&1 || true
  semanage fcontext -a -t cert_t "/etc/exim/ssl(/.*)?" 2>/dev/null || true
  restorecon -Rv /etc/exim/ssl /etc/dovecot/ssl >/dev/null 2>&1 || true
}

install_certbot_hook() {
  log "Installing certbot deploy hook..."
  mkdir -p "$(dirname "${LE_HOOK}")"
  cat > "${LE_HOOK}" <<'EOH'
#!/usr/bin/env bash
set -euo pipefail
copy_file() {
  local src="$1" dst="$2" mode="$3" owner="$4" group="$5"
  [[ -f "$src" ]] || exit 0
  mkdir -p "$(dirname "$dst")"
  install -m "$mode" -o "$owner" -g "$group" "$src" "$dst"
}
if [[ -n "${RENEWED_LINEAGE:-}" ]]; then
  fullchain="${RENEWED_LINEAGE}/fullchain.pem"
  privkey="${RENEWED_LINEAGE}/privkey.pem"

  if [[ -d /etc/exim/ssl ]]; then
    copy_file "$fullchain" "/etc/exim/ssl/fullchain.pem" 0644 root root
    if getent group exim >/dev/null 2>&1; then
      copy_file "$privkey" "/etc/exim/ssl/privkey.pem" 0640 root exim || true
    else
      copy_file "$privkey" "/etc/exim/ssl/privkey.pem" 0600 root root
    fi
    chmod 0750 /etc/exim /etc/exim/ssl 2>/dev/null || true
    chgrp exim /etc/exim /etc/exim/ssl 2>/dev/null || true
    semanage fcontext -a -t cert_t "/etc/exim/ssl(/.*)?" 2>/dev/null || true
    restorecon -Rv /etc/exim/ssl >/dev/null 2>&1 || true
  fi

  if [[ -d /etc/dovecot/ssl ]]; then
    copy_file "$fullchain" "/etc/dovecot/ssl/fullchain.pem" 0644 root root
    if getent group dovecot >/dev/null 2>&1; then
      copy_file "$privkey" "/etc/dovecot/ssl/privkey.pem" 0640 root dovecot || true
    else
      copy_file "$privkey" "/etc/dovecot/ssl/privkey.pem" 0600 root root
    fi
    restorecon -Rv /etc/dovecot/ssl >/dev/null 2>&1 || true
  fi

  systemctl reload nginx 2>/dev/null || true
  systemctl restart exim 2>/dev/null || true
  systemctl restart dovecot 2>/dev/null || true
fi
EOH
  chmod +x "${LE_HOOK}"
}

# -------------------------
# Nginx
# -------------------------
write_nginx_http_acme() {
  cat > "${NGINX_CONF}" <<EOF2
server {
  listen 80;
  server_name ${HOSTNAME_FQDN};

  location ^~ /.well-known/acme-challenge/ {
    root ${NGINX_ACME_ROOT};
    default_type "text/plain";
    try_files \$uri =404;
  }

  location / { return 301 https://\$host\$request_uri; }
}
EOF2
}

write_nginx_https_apps() {
  cat > "${NGINX_CONF}" <<EOF2
server {
  listen 80;
  server_name ${HOSTNAME_FQDN};

  location ^~ /.well-known/acme-challenge/ {
    root ${NGINX_ACME_ROOT};
    default_type "text/plain";
    try_files \$uri =404;
  }

  location / { return 301 https://\$host\$request_uri; }
}

server {
  listen 443 ssl http2;
  server_name ${HOSTNAME_FQDN};

  ssl_certificate     /etc/letsencrypt/live/${HOSTNAME_FQDN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${HOSTNAME_FQDN}/privkey.pem;

  add_header Strict-Transport-Security "max-age=31536000" always;

  location = / { return 302 /roundcube/; }

  location /roundcube/ {
    alias /usr/share/roundcubemail/;
    index index.php;
  }
  location ~ ^/roundcube/(.+\.php)(/.*)?$ {
    include fastcgi_params;
    fastcgi_param HTTPS on;
    fastcgi_param REQUEST_SCHEME https;
    fastcgi_param SERVER_PORT 443;
    fastcgi_pass unix:/run/php-fpm/www.sock;
    fastcgi_param SCRIPT_FILENAME /usr/share/roundcubemail/\$1;
    fastcgi_param PATH_INFO \$2;
    fastcgi_read_timeout 180;
    fastcgi_connect_timeout 30;
    fastcgi_send_timeout 180;
  }

  location /phpmyadmin/ {
    alias /usr/share/phpMyAdmin/;
    index index.php;
  }
  location ~ ^/phpmyadmin/(.+\.php)(/.*)?$ {
    include fastcgi_params;
    fastcgi_param HTTPS on;
    fastcgi_param REQUEST_SCHEME https;
    fastcgi_param SERVER_PORT 443;
    fastcgi_pass unix:/run/php-fpm/www.sock;
    fastcgi_param SCRIPT_FILENAME /usr/share/phpMyAdmin/\$1;
    fastcgi_param PATH_INFO \$2;
    fastcgi_read_timeout 180;
    fastcgi_connect_timeout 30;
    fastcgi_send_timeout 180;
  }

  location ~ /\. { deny all; }
}
EOF2
}

# -------------------------
# PHP-FPM + session perms
# -------------------------
configure_php_fpm() {
  log "Configuring PHP-FPM..."

  systemctl disable --now php-fpm.socket 2>/dev/null || true

  sed -i -E 's/^(listen\.acl_users\s*=.*)/;\1/' /etc/php-fpm.d/www.conf || true
  sed -i -E 's/^(listen\.acl_groups\s*=.*)/;\1/' /etc/php-fpm.d/www.conf || true

  sed -i 's/^user = .*/user = nginx/' /etc/php-fpm.d/www.conf
  sed -i 's/^group = .*/group = nginx/' /etc/php-fpm.d/www.conf
  sed -i 's|^listen = .*|listen = /run/php-fpm/www.sock|' /etc/php-fpm.d/www.conf
  grep -q '^listen.owner' /etc/php-fpm.d/www.conf || echo "listen.owner = nginx" >> /etc/php-fpm.d/www.conf
  grep -q '^listen.group' /etc/php-fpm.d/www.conf || echo "listen.group = nginx" >> /etc/php-fpm.d/www.conf
  grep -q '^listen.mode'  /etc/php-fpm.d/www.conf || echo "listen.mode = 0660"  >> /etc/php-fpm.d/www.conf

  setsebool -P httpd_can_network_connect on || true
  setsebool -P httpd_can_network_connect_db on || true

  mkdir -p /var/lib/php/session /var/lib/php/wsdlcache
  chown -R nginx:nginx /var/lib/php/session /var/lib/php/wsdlcache
  chmod 1733 /var/lib/php/session
  chmod 0770 /var/lib/php/wsdlcache
  restorecon -Rv /var/lib/php >/dev/null 2>&1 || true

  svc_enable_start php-fpm
}

# -------------------------
# phpMyAdmin
# -------------------------
configure_phpmyadmin() {
  log "Configuring phpMyAdmin..."
  [[ -f "${PHPMYADMIN_CONF}" ]] || return 0

  local blow; blow="$(rand_hex)"
  if grep -q "blowfish_secret" "${PHPMYADMIN_CONF}"; then
    sed -i "s/\(\$cfg\['blowfish_secret'\]\s*=\s*\).*/\1'${blow}';/" "${PHPMYADMIN_CONF}" || true
  else
    echo "\$cfg['blowfish_secret'] = '${blow}';" >> "${PHPMYADMIN_CONF}"
  fi

  mkdir -p /var/lib/phpMyAdmin/tmp
  chown -R nginx:nginx /var/lib/phpMyAdmin
  chmod 700 /var/lib/phpMyAdmin/tmp
  restorecon -Rv /var/lib/phpMyAdmin >/dev/null 2>&1 || true

  grep -q "PmaAbsoluteUri" "${PHPMYADMIN_CONF}" || cat >> "${PHPMYADMIN_CONF}" <<EOF2
\$cfg['PmaAbsoluteUri'] = 'https://${HOSTNAME_FQDN}/phpmyadmin/';
\$cfg['ForceSSL'] = true;
\$cfg['TempDir'] = '/var/lib/phpMyAdmin/tmp';
EOF2
}

# -------------------------
# Roundcube fixes + DB
# -------------------------
fix_roundcube_layout_and_perms() {
  log "Fixing Roundcube config layout + permissions..."

  [[ -d "${ROUNDCUBE_ETC_DIR}" ]] || mkdir -p "${ROUNDCUBE_ETC_DIR}"

  rm -rf "${ROUNDCUBE_WEB_CONFIG_DIR}"
  ln -s "${ROUNDCUBE_ETC_DIR}" "${ROUNDCUBE_WEB_CONFIG_DIR}"

  [[ -f "${ROUNDCUBE_ETC_DIR}/defaults.inc.php" ]] || die "Roundcube defaults.inc.php missing in ${ROUNDCUBE_ETC_DIR}"

  chgrp -R nginx "${ROUNDCUBE_ETC_DIR}" || true
  chmod 0750 "${ROUNDCUBE_ETC_DIR}" || true
  chmod 0640 "${ROUNDCUBE_ETC_DIR}"/*.php "${ROUNDCUBE_ETC_DIR}"/*.inc.php 2>/dev/null || true
  restorecon -Rv "${ROUNDCUBE_ETC_DIR}" >/dev/null 2>&1 || true
}

roundcube_schema_file() {
  [[ -f "${ROUNDCUBE_WEB_DIR}/SQL/mysql.initial.sql" ]] && echo "${ROUNDCUBE_WEB_DIR}/SQL/mysql.initial.sql" && return
  [[ -f "${ROUNDCUBE_WEB_DIR}/SQL/mysql.sql" ]] && echo "${ROUNDCUBE_WEB_DIR}/SQL/mysql.sql" && return
  echo ""
}

setup_roundcube_db() {
  log "Configuring Roundcube DB..."
  mariadb -u root -p"${MYSQL_ROOT_PASS}" <<SQL
CREATE DATABASE IF NOT EXISTS ${RC_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS '${RC_DB_USER}'@'localhost' IDENTIFIED BY '${RC_DB_PASS}';
ALTER USER '${RC_DB_USER}'@'localhost' IDENTIFIED BY '${RC_DB_PASS}';
GRANT ALL PRIVILEGES ON ${RC_DB}.* TO '${RC_DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

  local schema; schema="$(roundcube_schema_file)"
  [[ -n "${schema}" ]] || { warn "Roundcube schema not found; skipping import."; return 0; }

  local cnt
  cnt="$(mariadb -u root -p"${MYSQL_ROOT_PASS}" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${RC_DB}';" 2>/dev/null || echo "0")"
  if [[ "${cnt}" == "0" ]]; then
    log "Importing Roundcube schema..."
    mariadb -u root -p"${MYSQL_ROOT_PASS}" "${RC_DB}" < "${schema}" || true
  else
    log "Roundcube tables exist; skipping schema import."
  fi
}

configure_roundcube() {
  log "Configuring Roundcube..."

  mkdir -p "${ROUNDCUBE_ETC_DIR}"

  # SMTPS 465 (implicit TLS) avoids Roundcube "SMTP error (220) auth failed"
  cat > "${ROUNDCUBE_CONF}" <<EOF2
<?php
\$config = [];
\$config['db_dsnw'] = 'mysql://${RC_DB_USER}:${RC_DB_PASS}@localhost/${RC_DB}';

\$config['default_host'] = 'ssl://127.0.0.1';
\$config['default_port'] = 993;

\$config['smtp_server'] = 'ssl://127.0.0.1';
\$config['smtp_port'] = 465;
\$config['smtp_user'] = '%u';
\$config['smtp_pass'] = '%p';

\$config['imap_timeout'] = 10;
\$config['smtp_timeout'] = 10;

\$config['imap_conn_options'] = [
  'ssl' => [
    'verify_peer' => false,
    'verify_peer_name' => false,
    'allow_self_signed' => true,
  ],
];

\$config['smtp_conn_options'] = [
  'ssl' => [
    'verify_peer' => false,
    'verify_peer_name' => false,
    'allow_self_signed' => true,
  ],
];

\$config['skin'] = 'elastic';
\$config['des_key'] = '$(rand_hex)';
EOF2

  fix_roundcube_layout_and_perms
}

# -------------------------
# Virtual users DB + vmail + mailbox
# -------------------------
ensure_vmail_user() {
  getent group "${VMAIL_GROUP}" >/dev/null 2>&1 || groupadd "${VMAIL_GROUP}"
  id -u "${VMAIL_USER}" >/dev/null 2>&1 || useradd -g "${VMAIL_GROUP}" -d "${VMAIL_HOME}" -s /sbin/nologin "${VMAIL_USER}"
  mkdir -p "${VMAIL_HOME}"
  chown -R "${VMAIL_USER}:${VMAIL_GROUP}" "${VMAIL_HOME}"
  chmod 0750 "${VMAIL_HOME}"
  restorecon -Rv "${VMAIL_HOME}" >/dev/null 2>&1 || true
}

dovecot_hash_password() { doveadm pw -s SHA512-CRYPT -p "$1"; }

setup_mail_db() {
  log "Configuring Mail users DB (virtual mailboxes in MySQL)..."

  mariadb -u root -p"${MYSQL_ROOT_PASS}" <<SQL
CREATE DATABASE IF NOT EXISTS ${MAIL_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS ${MAIL_DB}.virtual_domains (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ${MAIL_DB}.virtual_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  domain_id INT NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (domain_id) REFERENCES ${MAIL_DB}.virtual_domains(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ${MAIL_DB}.virtual_aliases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  domain_id INT NOT NULL,
  source VARCHAR(190) NOT NULL,
  destination VARCHAR(190) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (domain_id) REFERENCES ${MAIL_DB}.virtual_domains(id) ON DELETE CASCADE,
  INDEX(source),
  INDEX(destination)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE USER IF NOT EXISTS '${MAIL_DB_USER}'@'localhost' IDENTIFIED BY '${MAIL_DB_PASS}';
ALTER USER '${MAIL_DB_USER}'@'localhost' IDENTIFIED BY '${MAIL_DB_PASS}';
GRANT SELECT, INSERT, UPDATE, DELETE ON ${MAIL_DB}.* TO '${MAIL_DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

  mariadb -u root -p"${MYSQL_ROOT_PASS}" -e "INSERT IGNORE INTO ${MAIL_DB}.virtual_domains(name) VALUES('${MAIL_DOMAIN}');"
}

ensure_mailbox() {
  local mailbox="$1" pass_plain="$2"
  [[ "${mailbox}" == *"@"* ]] || die "--mailbox must be user@domain"

  local m_user="${mailbox%@*}"
  local m_domain="${mailbox#*@}"
  local hash; hash="$(dovecot_hash_password "${pass_plain}")"

  mariadb -u root -p"${MYSQL_ROOT_PASS}" <<SQL
INSERT IGNORE INTO ${MAIL_DB}.virtual_domains(name) VALUES('${m_domain}');
SET @did := (SELECT id FROM ${MAIL_DB}.virtual_domains WHERE name='${m_domain}' LIMIT 1);

INSERT INTO ${MAIL_DB}.virtual_users(domain_id,email,password,active)
VALUES(@did,'${mailbox}','${hash}',1)
ON DUPLICATE KEY UPDATE password=VALUES(password), active=1;
SQL

  mkdir -p "${VMAIL_HOME}/${m_domain}/${m_user}/Maildir"
  chown -R "${VMAIL_USER}:${VMAIL_GROUP}" "${VMAIL_HOME}/${m_domain}"
  chmod -R 0750 "${VMAIL_HOME}/${m_domain}"
}

# -------------------------
# Dovecot SQL-only + SSL-only IMAP/POP
# - FIXED: no one-line braces (prevents "Garbage after '{'")
# - FIXED: disables PAM auth-system
# -------------------------
disable_dovecot_pam_auth() {
  cp -a /etc/dovecot/conf.d/10-auth.conf /etc/dovecot/conf.d/10-auth.conf.bak.$(date +%F-%H%M%S) || true
  sed -i -E 's@^[[:space:]]*(!include[[:space:]]+auth-system\.conf\.ext)@# \1@g' /etc/dovecot/conf.d/10-auth.conf
  grep -qE '^[[:space:]]*!include[[:space:]]+auth-sql\.conf\.ext' /etc/dovecot/conf.d/10-auth.conf \
    || echo '!include auth-sql.conf.ext' >> /etc/dovecot/conf.d/10-auth.conf
}

configure_dovecot_sql() {
  log "Configuring Dovecot SQL auth (MySQL virtual users)..."
  ensure_vmail_user

  dnf_install dovecot dovecot-mysql dovecot-pigeonhole

  local v_uid v_gid
  v_uid="$(id -u "${VMAIL_USER}")"
  v_gid="$(getent group "${VMAIL_GROUP}" | cut -d: -f3)"

  cat > "${DOVECOT_SQL_CONF}" <<EOF2
driver = mysql
connect = host=localhost dbname=${MAIL_DB} user=${MAIL_DB_USER} password=${MAIL_DB_PASS}
default_pass_scheme = SHA512-CRYPT
password_query = SELECT email as user, password FROM virtual_users WHERE email='%u' AND active=1
user_query = SELECT '${v_uid}' as uid, '${v_gid}' as gid, '${VMAIL_HOME}/%d/%n' as home, 'maildir:${VMAIL_HOME}/%d/%n/Maildir' as mail FROM virtual_users WHERE email='%u' AND active=1
EOF2
  chmod 0640 "${DOVECOT_SQL_CONF}"
  chown root:dovecot "${DOVECOT_SQL_CONF}" 2>/dev/null || true
  restorecon -Rv "${DOVECOT_SQL_CONF}" >/dev/null 2>&1 || true

  # FIXED SYNTAX: multi-line blocks only
  sed -i 's/\r$//' "${DOVECOT_OVERRIDE}" 2>/dev/null || true
  cat > "${DOVECOT_OVERRIDE}" <<EOF2
protocols = imap pop3
mail_location = maildir:${VMAIL_HOME}/%d/%n/Maildir

disable_plaintext_auth = yes
auth_mechanisms = plain login

ssl = required
ssl_cert = </etc/dovecot/ssl/fullchain.pem
ssl_key  = </etc/dovecot/ssl/privkey.pem

service imap-login {
  inet_listener imap {
    port = 0
  }
  inet_listener imaps {
    port = 993
    ssl = yes
  }
}

service pop3-login {
  inet_listener pop3 {
    port = 0
  }
  inet_listener pop3s {
    port = 995
    ssl = yes
  }
}

service auth {
  unix_listener exim-auth {
    path = exim-auth
    mode = 0660
    user = exim
    group = exim
  }
}

passdb {
  driver = sql
  args = ${DOVECOT_SQL_CONF}
}

userdb {
  driver = sql
  args = ${DOVECOT_SQL_CONF}
}
EOF2

  disable_dovecot_pam_auth

  systemctl stop dovecot 2>/dev/null || true
  rm -f /run/dovecot/* /var/run/dovecot/* 2>/dev/null || true

  doveconf -n >/dev/null
  svc_enable_start dovecot
}

# -------------------------
# Exim (AUTH via Dovecot, IPv4 outbound)
# - ACL bound (acl_smtp_rcpt)
# - accept authenticated + accept localhost
# - local virtual delivery to vmail
# -------------------------
configure_exim_virtual() {
  log "Configuring Exim..."

  local IPV4
  IPV4="$(get_primary_ipv4 || true)"
  [[ -n "${IPV4}" ]] || IPV4="0.0.0.0"
  set_secret PRIMARY_IPV4 "${IPV4}"

  chgrp exim /etc/exim /etc/exim/ssl 2>/dev/null || true
  chmod 0750 /etc/exim /etc/exim/ssl 2>/dev/null || true

  cat > "${EXIM_CONF}" <<EOF2
primary_hostname = ${HOSTNAME_FQDN}

# TLS
tls_certificate = ${EXIM_SSL_DIR}/fullchain.pem
tls_privatekey  = ${EXIM_SSL_DIR}/privkey.pem

daemon_smtp_ports = 25 : 587 : 465
tls_on_connect_ports = 465

# AUTH only on submission ports
auth_advertise_hosts = \${if or{{eq{\$received_port}{587}}{eq{\$received_port}{465}}}{*}{}}

# Use our ACL
acl_smtp_rcpt = acl_check_rcpt

begin acl
acl_check_rcpt:

  # TLS required on 587
  deny
    condition = \${if and{{eq{\$received_port}{587}}{!def:tls_in_cipher}}{yes}{no}}
    message   = TLS required on submission (587)

  # Accept local recipients if they exist in DB
  accept
    condition = \${if eq{\${lookup mysql{SELECT 1 FROM ${MAIL_DB}.virtual_users WHERE email='\${quote_mysql:\$local_part@\$domain}' AND active=1 LIMIT 1}{yes}{no}}}{yes}{yes}{no}}

  # Allow relay from localhost
  accept hosts = 127.0.0.1 : ::1

  # Allow relay for authenticated clients
  accept authenticated = *

  deny message = relay not permitted

begin routers
local_virtual:
  driver = accept
  condition = \${if eq{\${lookup mysql{SELECT 1 FROM ${MAIL_DB}.virtual_users WHERE email='\${quote_mysql:\$local_part@\$domain}' AND active=1 LIMIT 1}{yes}{no}}}{yes}{yes}{no}}
  transport = virtual_maildir_delivery
  no_more

dnslookup_router:
  driver = dnslookup
  domains = ! +local_domains
  transport = remote_smtp
  no_more

begin transports
remote_smtp:
  driver = smtp
  interface = ${IPV4}

virtual_maildir_delivery:
  driver = appendfile
  maildir_format
  directory = ${VMAIL_HOME}/\$domain/\$local_part/Maildir
  create_directory
  directory_mode = 0750
  mode = 0640
  user = ${VMAIL_USER}
  group = ${VMAIL_GROUP}

begin authenticators
dovecot_plain:
  driver = dovecot
  public_name = PLAIN
  server_socket = ${DOVECOT_EXIM_AUTH_ABS}
  server_set_id = \$auth1

dovecot_login:
  driver = dovecot
  public_name = LOGIN
  server_socket = ${DOVECOT_EXIM_AUTH_ABS}
  server_set_id = \$auth1
EOF2

  exim -bV >/dev/null
  systemctl restart exim
  systemctl enable exim
}

# -------------------------
# Install / Adduser / Uninstall
# -------------------------
do_install() {
  [[ -n "${HOSTNAME_FQDN}" ]] || die "Missing --hostname"
  [[ -n "${LE_EMAIL}" ]] || die "Missing --email"

  # Requirement: hostname == mail domain
  MAIL_DOMAIN="${HOSTNAME_FQDN}"

  log "Using hostname: ${HOSTNAME_FQDN}"
  log "Using mail domain: ${MAIL_DOMAIN} (same as hostname)"
  log "Let's Encrypt email: ${LE_EMAIL}"

  hostnamectl set-hostname "${HOSTNAME_FQDN}" || true

  disable_ipv6_os

  dnf -y update
  dnf_install epel-release
  dnf -y makecache

  rpm -q postfix >/dev/null 2>&1 && { svc_disable_stop postfix || true; dnf -y remove postfix || true; }

  log "Installing packages..."
  dnf_install \
    nginx \
    mariadb-server \
    php php-cli php-fpm php-mysqlnd php-gd php-xml php-mbstring php-intl php-json php-opcache php-zip unzip \
    certbot \
    exim \
    dovecot dovecot-mysql dovecot-pigeonhole \
    roundcubemail \
    phpMyAdmin \
    policycoreutils-python-utils \
    firewalld

  systemctl enable --now firewalld || true
  firewalld_open

  log "Configuring MariaDB..."
  local desired_root; desired_root="$(rand_hex)"
  MYSQL_ROOT_PASS="$(ensure_mariadb_access "${desired_root}")"
  set_secret MYSQL_ROOT_PASSWORD "${MYSQL_ROOT_PASS}"
  write_root_mycnf "${MYSQL_ROOT_PASS}"

  # Persist secrets
  RC_DB_PASS="$(get_secret ROUNDCUBE_PASSWORD || true)"
  is_hex64 "${RC_DB_PASS}" || RC_DB_PASS="$(rand_hex)"
  set_secret ROUNDCUBE_PASSWORD "${RC_DB_PASS}"

  MAIL_DB_PASS="$(get_secret MAIL_DB_PASSWORD || true)"
  is_hex64 "${MAIL_DB_PASS}" || MAIL_DB_PASS="$(rand_hex)"
  set_secret MAIL_DB_PASSWORD "${MAIL_DB_PASS}"

  set_secret HOSTNAME "${HOSTNAME_FQDN}"
  set_secret MAIL_DOMAIN "${MAIL_DOMAIN}"
  set_secret ROUNDCUBE_DB "${RC_DB}"
  set_secret ROUNDCUBE_USER "${RC_DB_USER}"
  set_secret MAIL_DB "${MAIL_DB}"
  set_secret MAIL_DB_USER "${MAIL_DB_USER}"

  setup_roundcube_db
  setup_mail_db

  configure_php_fpm

  log "Preparing Nginx (ACME)..."
  mkdir -p "${NGINX_ACME_ROOT}/.well-known/acme-challenge"
  chown -R nginx:nginx "${NGINX_ACME_ROOT}" || true
  write_nginx_http_acme
  nginx -t
  svc_enable_start nginx

  log "Obtaining/using Let's Encrypt certificate..."
  if [[ -d "/etc/letsencrypt/live/${HOSTNAME_FQDN}" ]]; then
    log "Existing cert found at /etc/letsencrypt/live/${HOSTNAME_FQDN} (reusing)."
  else
    certbot certonly --webroot -w "${NGINX_ACME_ROOT}" -d "${HOSTNAME_FQDN}" \
      -m "${LE_EMAIL}" --agree-tos --no-eff-email --non-interactive
  fi

  log "Copying TLS for Exim/Dovecot..."
  copy_tls_for_services "${HOSTNAME_FQDN}"
  install_certbot_hook

  log "Configuring Nginx HTTPS..."
  write_nginx_https_apps
  nginx -t
  systemctl reload nginx

  configure_phpmyadmin
  configure_roundcube

  log "Configuring Dovecot..."
  configure_dovecot_sql

  log "Configuring Exim..."
  configure_exim_virtual

  # Create initial mailbox
  if [[ -n "${MAILBOX_EMAIL}" ]]; then
    [[ -n "${MAILBOX_PASS}" ]] || die "You provided --mailbox but not --mailpass"
    ensure_mailbox "${MAILBOX_EMAIL}" "${MAILBOX_PASS}"
    set_secret MAILBOX_CREATED "${MAILBOX_EMAIL}"
    set_secret MAILBOX_PASSWORD "${MAILBOX_PASS}"
  fi

  systemctl restart php-fpm || true
  systemctl reload nginx || true

  log "INSTALL COMPLETE"
  echo "Secrets: ${SECRETS_FILE}"
  echo "Roundcube:  https://${HOSTNAME_FQDN}/roundcube/"
  echo "phpMyAdmin: https://${HOSTNAME_FQDN}/phpmyadmin/"
  echo "MySQL root auto-login: run 'mysql' (uses /root/.my.cnf)"
  echo
  if [[ -n "${MAILBOX_EMAIL}" ]]; then
    echo "Mail login (Roundcube/SMTP/IMAP):"
    echo "  Mailbox:   ${MAILBOX_EMAIL}"
    echo "  Password:  ${MAILBOX_PASS}"
  else
    echo "Create mailbox:"
    echo "  /root/mailstack.sh adduser --mailbox user@${HOSTNAME_FQDN} --mailpass 'PASS'"
  fi
}

do_adduser() {
  MYSQL_ROOT_PASS="$(get_secret MYSQL_ROOT_PASSWORD || true)"
  MAIL_DB_PASS="$(get_secret MAIL_DB_PASSWORD || true)"
  [[ -n "${MYSQL_ROOT_PASS}" && -n "${MAIL_DB_PASS}" ]] || die "Run install first."

  [[ -n "${MAILBOX_EMAIL}" && -n "${MAILBOX_PASS}" ]] || die "adduser needs --mailbox and --mailpass"

  setup_mail_db
  ensure_vmail_user
  ensure_mailbox "${MAILBOX_EMAIL}" "${MAILBOX_PASS}"
  log "Mailbox added/updated: ${MAILBOX_EMAIL}"
}

do_uninstall() {
  warn "Stopping services..."
  svc_disable_stop exim dovecot nginx php-fpm mariadb || true
  svc_disable_stop php-fpm.socket || true

  warn "Removing configs (keeping /etc/letsencrypt and secrets)..."
  rm -f "${NGINX_CONF}" "${DOVECOT_OVERRIDE}" "${DOVECOT_SQL_CONF}" "${EXIM_CONF}" || true
  rm -f "${LE_HOOK}" || true

  warn "Removing packages (preserving /etc/letsencrypt)..."
  dnf -y remove \
    roundcubemail phpMyAdmin \
    exim dovecot dovecot-mysql dovecot-pigeonhole \
    nginx mariadb-server \
    php-fpm php-mysqlnd php-gd php-xml php-mbstring php-intl php-json php-opcache php-zip unzip \
    certbot || true

  firewalld_close

  warn "Preserved: /etc/letsencrypt"
  warn "Preserved: ${SECRETS_FILE}"
  log "Uninstall complete."
}

usage() {
  cat <<EOF2
Usage:
  /root/mailstack.sh install --hostname mail.example.com --email admin@example.com [--mailbox user@mail.example.com --mailpass 'PASS']
  /root/mailstack.sh adduser --mailbox user@mail.example.com --mailpass 'PASS'
  /root/mailstack.sh uninstall

Notes:
  - Hostname and mail domain are the SAME.
  - IPv6 is disabled on OS so outbound mail uses IPv4 only.
  - Uninstall keeps /etc/letsencrypt and /etc/mailstack/secrets.txt.
EOF2
}

# -------------------------
# Arg parsing
# -------------------------
need_root
ACTION="${1:-}"; shift || true

HOSTNAME_FQDN=""
LE_EMAIL=""
MAILBOX_EMAIL=""
MAILBOX_PASS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hostname) HOSTNAME_FQDN="${2:-}"; shift 2;;
    --email)    LE_EMAIL="${2:-}"; shift 2;;
    --mailbox)  MAILBOX_EMAIL="${2:-}"; shift 2;;
    --mailpass) MAILBOX_PASS="${2:-}"; shift 2;;
    *) die "Unknown arg: $1";;
  esac
done

case "${ACTION}" in
  install)  do_install ;;
  adduser)  do_adduser ;;
  uninstall) do_uninstall ;;
  *) usage; exit 1 ;;
esac


# Enable AIOps monitoring
install_aiops_agent_systemd
