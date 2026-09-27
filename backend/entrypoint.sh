#!/bin/sh
set -e

# Postgres puede tardar unos segundos en aceptar conexiones después de levantar.
tries=0
until python manage.py migrate --noinput; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "migrate falló 30 veces, abortando" >&2
    exit 1
  fi
  echo "Esperando la base de datos ($tries)..."
  sleep 2
done

python manage.py collectstatic --noinput -v0

exec "$@"
