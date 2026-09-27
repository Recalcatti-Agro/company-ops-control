# Cómo correrlo en local

## Con Docker (lo más rápido)

```bash
docker compose up -d --build        # http://localhost:3010 (API en :8123)
docker compose up -d --build frontend   # después de cambiar el frontend
docker compose down
```

El backend usa `backend/db.sqlite3` montada como volumen (los datos que cargues
quedan en esa base) y corre `runserver`, así que los cambios de backend se
recargan solos. El frontend es un build de producción: hay que reconstruirlo
para ver cambios. `NEXT_PUBLIC_API_URL` se fija en build (`docker-compose.yml`).

## Sin Docker

## Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
# editar .env si hace falta (por defecto usa SQLite, no requiere Postgres)
.venv/bin/python manage.py migrate
.venv/bin/python manage.py createsuperuser
.venv/bin/python manage.py runserver 127.0.0.1:8123
```

Con SQLite (default) no hace falta Postgres para probar local. Para usar Postgres,
setear en `.env`: `DB_ENGINE=postgres` + `DB_NAME`/`DB_USER`/`DB_PASSWORD`/`DB_HOST`/`DB_PORT`.

**Cuentas de caja:** `Account` (Caja ARS / Caja USD) no se crean solas — son
manuales, una vez, desde el admin (`/admin/`) o por shell:

```python
from core.models import Account, Currency
Account.objects.get_or_create(name="Caja ARS", defaults={"currency": Currency.ARS})
Account.objects.get_or_create(name="Caja USD", defaults={"currency": Currency.USD})
```

## Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
# NEXT_PUBLIC_API_URL debe apuntar al backend, ej http://localhost:8123/api
npm run dev
```

Por defecto Next corre en `:3000`. Si el backend corre en otro puerto, hay que
agregar el origen del frontend a `CORS_ALLOWED_ORIGINS` en `backend/.env`.

> El `backend/Dockerfile` es el de producción (gunicorn). El `docker-compose.yml`
> de desarrollo lo usa con `runserver`; producción usa `docker-compose.prod.yml`
> (ver [PASE_A_PRODUCCION.md](PASE_A_PRODUCCION.md)).

## Migrar datos reales desde el proyecto productivo

Necesita la carpeta `privado/` (datos reales, fuera de git — ver
`privado/README.md` en la Mac donde está).

`core/management/commands/migrate_v1.py` migra un dump de la base productiva
(modelo A) a este proyecto (modelo B). Necesita el dump restaurado en un Postgres
accesible (por ejemplo un contenedor temporal):

```bash
docker run -d --name recalcatti_migration_pg -e POSTGRES_USER=migrator \
  -e POSTGRES_PASSWORD=migrator -e POSTGRES_DB=opsdb -p 55432:5432 postgres:16
docker cp /ruta/al/backup.sql recalcatti_migration_pg:/tmp/backup.sql
docker exec recalcatti_migration_pg psql -U migrator -d opsdb -f /tmp/backup.sql

cd backend
.venv/bin/python manage.py migrate_v1 \
  --source-dsn "postgresql://migrator:migrator@localhost:55432/opsdb" \
  --wipe
```

`--wipe` borra los datos migrables actuales antes de cargar (no toca usuarios
`is_superuser`). Al final imprime un resumen y los "gaps" conocidos — casos de v1
sin equivalente limpio en v2 (ajustes de caja sin inversor, retiros históricos sin
efecto en capital, diferencias tipo "tax_loss" no migradas). Revisar esa salida
después de cada corrida.

## Primer usuario

El primer usuario (`createsuperuser`) queda con `role=INVESTOR` por default del
modelo — para operar como ADMIN, entrar a `/admin/` (Django admin) y cambiarle el
rol a `ADMIN` a mano, o hacerlo desde el shell:

```python
from core.models import User
u = User.objects.get(username="tu_usuario")
u.role = User.Role.ADMIN
u.is_staff = u.is_superuser = True
u.save()
```

**Antes de un `--wipe` sobre la base real, conviene migrar a una sqlite aparte y
comparar.** `settings.py` no toma la ruta de sqlite de env, así que se usa un
módulo de settings temporal (fuera del repo) que la pisa:

```python
# /tmp/x/settings_newdb.py
from server_config.settings import *  # noqa
DATABASES["default"]["NAME"] = "/tmp/x/db_nueva.sqlite3"
```

```bash
PYTHONPATH=/tmp/x:. DJANGO_SETTINGS_MODULE=settings_newdb .venv/bin/python manage.py migrate
PYTHONPATH=/tmp/x:. DJANGO_SETTINGS_MODULE=settings_newdb .venv/bin/python manage.py migrate_v1 --source-dsn "..."
```

Hacer siempre una copia (`cp db.sqlite3 db.sqlite3.bak-FECHA`) antes del `--wipe`.
