#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-db-backups}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"

if [ -z "$BACKUP_S3_BUCKET" ]; then
  echo "Falta BACKUP_S3_BUCKET"
  exit 1
fi

"$SCRIPT_DIR/backup_db_prod.sh"

LATEST_FILE="$(ls -1t "$BACKUP_DIR"/*.sql 2>/dev/null | head -n 1)"

if [ -z "$LATEST_FILE" ]; then
  echo "No se encontró ningún backup SQL en $BACKUP_DIR"
  exit 1
fi

aws s3 cp "$LATEST_FILE" "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/$(basename "$LATEST_FILE")"

echo "Backup subido a s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/$(basename "$LATEST_FILE")"
