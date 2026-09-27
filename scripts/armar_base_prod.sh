#!/bin/sh
# Arma, en local, la base de v2 que se sube a producción, a partir de un backup
# de la base de v1. Usa las mismas imágenes que producción (docker-compose.prod.yml,
# solo db + web) en un proyecto de compose aparte, y los datos de privado/.
#
# Uso (desde la raíz del repo):
#   scripts/armar_base_prod.sh /ruta/opsdb_AAAA-MM-DD_HHMMSS.sql [salida.dump]
#
# Deja un dump de Postgres (formato custom) en privado/prod/ — tiene datos reales,
# no va al repo. Se restaura en el servidor con pg_restore (ver PASE_A_PRODUCCION.md).
set -e

BACKUP="$1"
if [ -z "$BACKUP" ] || [ ! -f "$BACKUP" ]; then
  echo "Uso: $0 /ruta/backup_v1.sql [salida.dump]" >&2
  exit 1
fi
if [ ! -f privado/migracion_v1_datos.py ] || [ ! -f privado/pendientes_sep2026_datos.py ]; then
  echo "Falta privado/ (datos reales, fuera del repo)." >&2
  exit 1
fi
OUT="${2:-privado/prod/opsdb_v2_$(date +%F_%H%M%S).dump}"
mkdir -p "$(dirname "$OUT")"

PROJECT=recalcatti-armado
ENV_FILE="$(mktemp)"
cat > "$ENV_FILE" <<EOF
POSTGRES_DB=opsdb
POSTGRES_USER=opsuser
POSTGRES_PASSWORD=armado
DB_NAME=opsdb
DB_USER=opsuser
DB_PASSWORD=armado
DJANGO_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")
DJANGO_ALLOWED_HOSTS=localhost
APP_DOMAIN=:80
NEXT_PUBLIC_API_URL=/api
EOF

dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"; }
cleanup() { dc down -v >/dev/null 2>&1 || true; rm -f "$ENV_FILE"; }
trap cleanup EXIT

echo "==> Levantando db + web (base vacía)"
dc down -v >/dev/null 2>&1 || true
dc up -d --build db web
tries=0
until dc exec -T web python manage.py showmigrations core >/dev/null 2>&1 && \
      ! dc exec -T web python manage.py showmigrations core | grep -q "\[ \]"; do
  tries=$((tries + 1))
  [ "$tries" -ge 60 ] && { echo "web no terminó de migrar" >&2; dc logs web | tail -30; exit 1; }
  sleep 2
done

echo "==> Restaurando el backup de v1 como opsdb_v1"
dc exec -T db psql -q -U opsuser -d postgres -c "create database opsdb_v1"
dc exec -T db psql -q -U opsuser -d opsdb_v1 < "$BACKUP" >/dev/null

echo "==> Migrando y cargando pendientes del chat"
dc cp privado/. web:/app/privado/
dc exec -T web python manage.py migrate_v1 --source-dsn "postgresql://opsuser:armado@db:5432/opsdb_v1"
dc exec -T web python manage.py cargar_pendientes_sep2026

echo "==> Resultado"
dc exec -T web python manage.py shell -c "
from core import models, calc
for a in models.Account.objects.all(): print(f'Caja {a.currency}: {a.balance:.2f}')
rows, total = calc.cap_table()
print(f'Capital total: {total:.2f}')
for r in rows: print(f\"  {r['investor'].name}: {r['capital_usd']:.2f} ({r['percentage']:.1f}%)\")"

echo "==> Exportando la base de v2"
dc exec -T db pg_dump -U opsuser -d opsdb -Fc --no-owner --no-privileges > "$OUT"
echo "Base lista: $OUT ($(du -h "$OUT" | cut -f1))"
