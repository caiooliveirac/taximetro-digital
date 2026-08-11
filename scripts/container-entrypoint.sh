#!/bin/sh
set -eu

export TZ="${TZ:-${DB_BACKUP_TZ:-America/Bahia}}"
CRON_FILE="/etc/crontabs/root"
CRON_HEADER="SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
TZ=${TZ}"

write_cron_env() {
  env | while IFS='=' read -r key value; do
    escaped=$(printf "%s" "$value" | sed "s/'/'\\\\''/g")
    printf "export %s='%s'\n" "$key" "$escaped"
  done > /app/.cron-env.sh

  chmod 600 /app/.cron-env.sh
}

init_cron_file() {
  write_cron_env
  printf "%s\n" "$CRON_HEADER" > "$CRON_FILE"
}

append_backup_cron() {
  schedule="${DB_BACKUP_CRON:-37 3 * * *}"
  backup_dir="${DB_BACKUP_DIR:-/var/backups/taximetro}"

  mkdir -p "$backup_dir"
  printf "%s\n" "${schedule} /bin/sh -lc '. /app/.cron-env.sh; node /app/scripts/daily-db-backup.mjs' >> /proc/1/fd/1 2>> /proc/1/fd/2" >> "$CRON_FILE"
  echo "[entrypoint] backup diario habilitado em ${schedule} (${TZ}) -> ${backup_dir}"
}

append_telegram_checkin_reminder_cron() {
  schedule="${TELEGRAM_CHECKIN_REMINDER_CRON:-0 8,9 * * *}"

  printf "%s\n" "${schedule} /bin/sh -lc '. /app/.cron-env.sh; node /app/scripts/trigger-telegram-checkin-pending-reminder.mjs' >> /proc/1/fd/1 2>> /proc/1/fd/2" >> "$CRON_FILE"
  echo "[entrypoint] lembrete de check-in pendente habilitado em ${schedule} (${TZ})"
}

append_cohort_lifecycle_cron() {
  schedule="${COHORT_LIFECYCLE_CRON:-30 4 * * *}"

  printf "%s\n" "${schedule} /bin/sh -lc '. /app/.cron-env.sh; node /app/scripts/trigger-cohort-lifecycle.mjs' >> /proc/1/fd/1 2>> /proc/1/fd/2" >> "$CRON_FILE"
  echo "[entrypoint] lifecycle de turmas habilitado em ${schedule} (${TZ})"
}

append_absence_sweep_cron() {
  schedule="${ABSENCE_SWEEP_CRON:-40 12 * * *}"

  printf "%s\n" "${schedule} /bin/sh -lc '. /app/.cron-env.sh; node /app/scripts/trigger-absence-sweep.mjs' >> /proc/1/fd/1 2>> /proc/1/fd/2" >> "$CRON_FILE"
  echo "[entrypoint] varredura de faltas habilitada em ${schedule} (${TZ})"
}

start_cron_daemon() {
  crond -l 2 -L /dev/stdout
}

init_cron_file

if [ "${DB_BACKUP_ENABLED:-true}" = "false" ]; then
  echo "[entrypoint] backup diario desabilitado por DB_BACKUP_ENABLED=false"
else
  append_backup_cron
fi

if [ "${TELEGRAM_CHECKIN_REMINDER_ENABLED:-true}" = "false" ]; then
  echo "[entrypoint] lembrete de check-in pendente desabilitado por TELEGRAM_CHECKIN_REMINDER_ENABLED=false"
elif [ -z "${TELEGRAM_BOT_TOKEN_NEXT:-${TELEGRAM_BOT_TOKEN:-}}" ] || [ -z "${TELEGRAM_GROUP_ID:-}" ] || [ -z "${AUTH_SECRET:-}" ]; then
  echo "[entrypoint] lembrete de check-in pendente desabilitado por configuração incompleta"
else
  append_telegram_checkin_reminder_cron
fi

if [ "${COHORT_LIFECYCLE_ENABLED:-true}" = "false" ]; then
  echo "[entrypoint] lifecycle de turmas desabilitado por COHORT_LIFECYCLE_ENABLED=false"
elif [ -z "${AUTH_SECRET:-}" ]; then
  echo "[entrypoint] lifecycle de turmas desabilitado por configuração incompleta (AUTH_SECRET)"
else
  append_cohort_lifecycle_cron
fi

if [ "${ABSENCE_SWEEP_ENABLED:-true}" = "false" ]; then
  echo "[entrypoint] varredura de faltas desabilitada por ABSENCE_SWEEP_ENABLED=false"
elif [ -z "${AUTH_SECRET:-}" ]; then
  echo "[entrypoint] varredura de faltas desabilitada por configuração incompleta (AUTH_SECRET)"
else
  append_absence_sweep_cron
fi

start_cron_daemon

exec node server.js