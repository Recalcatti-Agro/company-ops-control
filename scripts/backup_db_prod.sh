#!/bin/sh
set -e

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
TIMESTAMP="$(date +%F_%H%M%S)"

mkdir -p "$BACKUP_DIR"

docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  > "$BACKUP_DIR/${POSTGRES_DB}_${TIMESTAMP}.sql"

echo "Backup creado en: $BACKUP_DIR/${POSTGRES_DB}_${TIMESTAMP}.sql"
