#!/bin/sh
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Uso: sh scripts/restore-db-backup.sh /caminho/arquivo.dump [DATABASE_URL]" >&2
  exit 1
fi

BACKUP_FILE="$1"
TARGET_DATABASE_URL="${2:-${DATABASE_URL:-}}"

if [ -z "$TARGET_DATABASE_URL" ]; then
  echo "DATABASE_URL ausente. Informe como segundo argumento ou exporte a variavel." >&2
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Arquivo de backup nao encontrado: $BACKUP_FILE" >&2
  exit 1
fi

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname "$TARGET_DATABASE_URL" \
  "$BACKUP_FILE"