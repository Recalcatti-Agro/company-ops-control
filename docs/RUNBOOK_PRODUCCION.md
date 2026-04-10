# Runbook Producción

Comandos operativos del entorno productivo actual.

Stack actual:
- AWS Lightsail
- `docker-compose.prod.yml`
- `caddy`
- `frontend` (Next.js)
- `web` (Django + Gunicorn)
- `db` (PostgreSQL)

Suposiciones:
- repo clonado en `/home/ubuntu/company-ops-control`
- variables reales definidas en `/home/ubuntu/company-ops-control/.env`
- se ejecuta todo desde la instancia productiva

## 0. Deploy remoto desde esta máquina / Codex

Además del flujo "entrar al servidor y correr comandos ahí", este proyecto también se puede desplegar
remotamente desde una terminal local o desde Codex usando `ssh`.

Requisitos:
- tener la clave SSH con acceso a la instancia
- conocer la IP pública o el host SSH de producción
- que el commit a desplegar ya esté pusheado a GitHub
- que el repo remoto esté clonado en `/home/ubuntu/company-ops-control`

Chequeos previos que conviene hacer:

```bash
ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new ubuntu@TU_IP 'cd ~/company-ops-control && git status --short && git branch --show-current && git log --oneline -1'
ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new ubuntu@TU_IP 'cd ~/company-ops-control && docker compose -f docker-compose.prod.yml ps'
```

Si el `git status --short` remoto devuelve algo, frenar y revisar antes de hacer `git pull`.

### Flujo remoto que sigo yo

1. Confirmar que el cambio ya está en GitHub.
2. Entrar por `ssh` y verificar que el repo remoto esté limpio y en la rama esperada.
3. Ejecutar `git pull --ff-only` para evitar merges accidentales en producción.
4. Elegir deploy parcial o completo según el alcance del cambio.
5. Verificar commit activo, estado del contenedor afectado y logs de arranque.

### Actualizar código remotamente

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@TU_IP 'cd ~/company-ops-control && git pull --ff-only'
```

### Deploy remoto solo frontend

Usar cuando el cambio afecta únicamente Next.js / `frontend`.

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@TU_IP 'cd ~/company-ops-control && docker compose -f docker-compose.prod.yml build frontend && docker compose -f docker-compose.prod.yml up -d frontend'
```

Validación:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@TU_IP 'cd ~/company-ops-control && git rev-parse --short HEAD && git log --oneline -1'
ssh -i ~/.ssh/id_ed25519 ubuntu@TU_IP 'cd ~/company-ops-control && docker compose -f docker-compose.prod.yml ps frontend'
ssh -i ~/.ssh/id_ed25519 ubuntu@TU_IP 'cd ~/company-ops-control && docker compose -f docker-compose.prod.yml logs --tail=40 frontend'
```

### Deploy remoto solo backend

Usar cuando el cambio afecta únicamente Django / `backend`.

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@TU_IP 'cd ~/company-ops-control && docker compose -f docker-compose.prod.yml build web && docker compose -f docker-compose.prod.yml up -d web'
```

Validación:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@TU_IP 'cd ~/company-ops-control && docker compose -f docker-compose.prod.yml ps web'
ssh -i ~/.ssh/id_ed25519 ubuntu@TU_IP 'cd ~/company-ops-control && docker compose -f docker-compose.prod.yml logs --tail=40 web'
```

### Deploy remoto completo

Usar si cambiaron frontend y backend, o si el alcance del cambio no está claro.

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@TU_IP 'cd ~/company-ops-control && docker compose -f docker-compose.prod.yml up -d --build'
```

Validación:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@TU_IP 'cd ~/company-ops-control && docker compose -f docker-compose.prod.yml ps'
ssh -i ~/.ssh/id_ed25519 ubuntu@TU_IP 'cd ~/company-ops-control && docker compose -f docker-compose.prod.yml logs --tail=40'
```

Notas operativas:
- en esta VM de `1 GB`, preferir deploy parcial siempre que sea posible
- si el cambio fue solo frontend, no hace falta rebuild de `web`
- después del deploy puede hacer falta `hard refresh` en el navegador para ver assets nuevos
- no usar `git pull` si el repo remoto tiene cambios locales no versionados o modificaciones manuales

## 1. Entrar al servidor

```bash
ssh ubuntu@TU_IP
cd ~/company-ops-control
```

## 2. Ver estado general

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=50
free -h
df -h
```

## 3. Actualizar código desde GitHub

```bash
cd ~/company-ops-control
git pull
```

## 4. Deploy completo

Usar solo si cambiaron frontend y backend o si el cambio no está claramente aislado.

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml up -d --build
```

## 5. Deploy parcial

En esta instancia `1 GB` conviene rebuild parcial siempre que sea posible.

### Solo frontend

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.prod.yml up -d frontend
```

### Solo backend

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml build web
docker compose -f docker-compose.prod.yml up -d web
```

### Solo Caddy

Cuando cambió el `Caddyfile`:

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml restart caddy
```

## 6. Stop / start / restart

### Frenar solo frontend

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml stop frontend
```

### Levantar solo frontend

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml start frontend
```

### Restart solo frontend

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml restart frontend
```

### Frenar toda la app

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml stop
```

### Levantar toda la app

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml start
```

## 7. Logs útiles

### Todos los servicios

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml logs -f
```

### Solo frontend

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml logs -f frontend
```

### Solo backend

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml logs -f web
```

### Solo Caddy

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml logs -f caddy
```

### Solo Postgres

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml logs -f db
```

## 8. Django admin y usuarios

### Crear superusuario

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml exec web python manage.py createsuperuser
```

### Cambiar contraseña de un usuario

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml exec web python manage.py changepassword admin
```

### Listar usernames

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml exec web python manage.py shell -c "from django.contrib.auth.models import User; print(list(User.objects.values_list('username', flat=True)))"
```

## 9. Backup lógico manual

Requiere `POSTGRES_USER` y `POSTGRES_DB` en el entorno o exportados antes.

```bash
cd ~/company-ops-control
export POSTGRES_USER=opsuser
export POSTGRES_DB=opsdb
./scripts/backup_db_prod.sh
```

Salida esperada:
- archivo `.sql` en `~/backups/`

## 10. Backup manual a S3

Requiere además `BACKUP_S3_BUCKET`.

```bash
cd ~/company-ops-control
export POSTGRES_USER=opsuser
export POSTGRES_DB=opsdb
export BACKUP_S3_BUCKET=tu-bucket
export BACKUP_S3_PREFIX=production
./scripts/backup_db_prod_to_s3.sh
```

Verificación:

```bash
aws s3 ls s3://tu-bucket/production/
```

## 11. Cron del backup diario

Ver crontab actual:

```bash
crontab -l
```

Ver log del cron:

```bash
tail -n 100 /home/ubuntu/backup_db_prod.log
```

## 12. Restore de base desde dump local en la VM

### Restaurar un `.sql`

```bash
cat ~/backups/archivo.sql | docker compose -f docker-compose.prod.yml exec -T db psql -U opsuser -d opsdb
```

### Restaurar un dump custom `.dump`

```bash
docker compose -f docker-compose.prod.yml exec -T db dropdb -U opsuser --if-exists opsdb
docker compose -f docker-compose.prod.yml exec -T db createdb -U opsuser opsdb
cat ~/prod_seed.dump | docker compose -f docker-compose.prod.yml exec -T db pg_restore -U opsuser -d opsdb --no-owner --no-privileges
```

## 13. Checks post deploy

### Estado contenedores

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml ps
```

### Abrir sitio

- `https://control.tudominio.com/login`
- `https://control.tudominio.com/admin`

### Validaciones mínimas

1. login
2. navbar visible
3. dashboard carga
4. alta de gasto rápido
5. alta de trabajo rápido

## 14. Recuperación rápida si algo falla

### Frontend roto después de un cambio

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml logs --tail=100 frontend
docker compose -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.prod.yml up -d frontend
```

### Backend roto después de un cambio

```bash
cd ~/company-ops-control
docker compose -f docker-compose.prod.yml logs --tail=100 web
docker compose -f docker-compose.prod.yml build web
docker compose -f docker-compose.prod.yml up -d web
```

### Instancia lenta o al límite

```bash
free -h
df -h
docker compose -f docker-compose.prod.yml ps
```

Si hubo OOM o la instancia está inestable:
- evitar rebuild completo
- rebuildar solo el servicio afectado
- revisar que el swap siga activo

## 15. Nota operativa

No ejecutar cambios en producción sin validar antes el alcance del cambio.
