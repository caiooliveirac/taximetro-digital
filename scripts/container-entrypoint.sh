#!/bin/sh
set -eu

export TZ="${TZ:-${DB_BACKUP_TZ:-America/Bahia}}"

write_cron_env() {
  env | while IFS='=' read -r key value; do
    escaped=$(printf "%s" "$value" | sed "s/'/'\\\\''/g")
    printf "export %s='%s'\n" "$key" "$escaped"
  done > /app/.cron-env.sh

  chmod 600 /app/.cron-env.sh
}

start_backup_cron() {
  schedule="${DB_BACKUP_CRON:-37 3 * * *}"
  backup_dir="${DB_BACKUP_DIR:-/var/backups/taximetro}"

  mkdir -p "$backup_dir"
  write_cron_env

  cat > /etc/crontabs/root <<EOF
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
TZ=${TZ}
${schedule} /bin/sh -lc '. /app/.cron-env.sh; node /app/scripts/daily-db-backup.mjs' >> /proc/1/fd/1 2>> /proc/1/fd/2
EOF

  crond -l 2 -L /dev/stdout
  echo "[entrypoint] backup diario habilitado em ${schedule} (${TZ}) -> ${backup_dir}"
}

if [ "${DB_BACKUP_ENABLED:-true}" = "false" ]; then
  echo "[entrypoint] backup diario desabilitado por DB_BACKUP_ENABLED=false"
else
  start_backup_cron
fi

exec node server.js