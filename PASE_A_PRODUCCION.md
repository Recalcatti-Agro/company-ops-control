# Pase a producción — v1 → v2

Paso a paso para reemplazar v1 por v2 en el servidor de producción (AWS
Lightsail, `~/company-ops-control`). Ensayado en local el 27/09/2026 con
`docker-compose.prod.yml` completo (imágenes de producción, Caddy, Postgres) y el
backup del 26/09, siguiendo los pasos 4–10 de este documento: cajas y capital de
cada inversor iguales al centavo que la base de desarrollo, y el script de backup
funcionando contra la base de v2.

## Cómo queda armado

- v2 vive en la rama `v2` del mismo repo que v1 (`Recalcatti-Agro/company-ops-control`).
  El servidor pasa de `main` a `v2` con un `git checkout`.
- `docker-compose.prod.yml` de v2 usa **el mismo `.env` del servidor** que v1 y los
  mismos nombres de servicio/contenedor (`db`, `business-db`, ...), así que
  `scripts/backup_db_prod*.sh` y el cron del backup diario a S3 siguen andando.
- La base de v2 está en el volumen `postgres_v2_data`. **El volumen de v1
  (`postgres_data`) no se toca**: volver a v1 es cambiar de rama y levantar.
- El backend corre con gunicorn; al arrancar aplica migraciones y `collectstatic`
  solo (`backend/entrypoint.sh`).

## Antes del día del pase (desde la Mac)

1. Subir la rama `v2` a GitHub (desde `Recalcatti-v2`):
   ```bash
   git remote add origin git@github.com:Recalcatti-Agro/company-ops-control.git
   git push -u origin v2
   ```
2. En el repo de v1 (`Recalcatti`), resolver los cambios sin commitear y marcar
   el último estado de v1:
   ```bash
   git tag v1-final main
   git push origin v1-final
   ```
3. Revisar que el `.env` del servidor tenga todas las variables de
   `.env.prod.example` (en particular `NEXT_PUBLIC_API_URL=https://<dominio>/api`
   y `CORS_ALLOWED_ORIGINS=https://<dominio>`).
4. Avisar a los usuarios: desde el paso 1 del día del pase no se carga nada en v1.

## El día del pase (en el servidor)

```bash
ssh ubuntu@TU_IP
cd ~/company-ops-control
git status --short          # tiene que estar vacío
set -a; . ./.env; set +a    # variables para los scripts y comandos de abajo
```

**1. Backup final de v1** (queda en `~/backups/` y en S3):
```bash
./scripts/backup_db_prod_to_s3.sh
ls -lt ~/backups | head -3   # anotar el nombre del .sql recién creado
```

**2. Bajar v1** (los volúmenes quedan):
```bash
docker compose -f docker-compose.prod.yml down
```

**3. Pasar el código a v2:**
```bash
git fetch origin
git checkout -b v2 origin/v2
```

**4. Levantar la base y el backend de v2** (crea las tablas vacías):
```bash
docker compose -f docker-compose.prod.yml up -d --build db web
docker compose -f docker-compose.prod.yml logs --tail=30 web
```

**5. Restaurar el backup de v1 como base aparte `opsdb_v1`**, en el mismo Postgres:
```bash
BACKUP=~/backups/opsdb_AAAA-MM-DD_HHMMSS.sql
docker compose -f docker-compose.prod.yml exec -T db psql -U "$POSTGRES_USER" -d postgres -c "create database opsdb_v1"
cat "$BACKUP" | docker compose -f docker-compose.prod.yml exec -T db psql -q -U "$POSTGRES_USER" -d opsdb_v1
```

**6. Migrar y cargar los pendientes del chat.** Los comandos necesitan los datos
privados (`privado/`, que no está en el repo): copiarlos desde la Mac al servidor
y de ahí al contenedor.
```bash
# desde la Mac, en Recalcatti-v2:
scp -r privado ubuntu@TU_IP:~/privado-v2
# en el servidor:
docker compose -f docker-compose.prod.yml cp ~/privado-v2/. web:/app/privado/
docker compose -f docker-compose.prod.yml exec web python manage.py migrate_v1 \
  --source-dsn "postgresql://$DB_USER:$DB_PASSWORD@db:5432/opsdb_v1"
docker compose -f docker-compose.prod.yml exec web python manage.py cargar_pendientes_sep2026
```
(Si la contraseña de la base tiene caracteres como `@`, `/` o `:`, hay que
escaparlos en el DSN.)

Después de migrar, borrar la copia de los datos privados del servidor
(`rm -rf ~/privado-v2`). La del contenedor desaparece sola en el próximo rebuild.

**7. Verificar los números** antes de abrir la app:
```bash
docker compose -f docker-compose.prod.yml exec web python manage.py shell -c "
from core import models, calc
for a in models.Account.objects.all(): print(a.currency, round(a.balance, 2))
rows, total = calc.cap_table(); print('capital', round(total, 2))"
```
Los números esperados (resultado del ensayo con el último backup, y la
diferencia conocida con la caja que muestra v1) están en
`privado/docs/ESTADO_ACTUAL.md` — no se anotan acá porque son datos reales.

**8. Levantar todo:**
```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

**9. Probar en el navegador:** entrar con el usuario `admin` (contraseña de
v1; los usuarios se migran con su contraseña) y revisar Inicio, Caja, Facturación
y Trabajos. El resto de los usuarios entra con su contraseña de siempre.

**10. Probar el backup de v2:**
```bash
./scripts/backup_db_prod_to_s3.sh
```
Desde acá los backups diarios son de v2 (esquema nuevo). `opsdb_v1` puede
quedar un tiempo como referencia; se borra con `drop database opsdb_v1`.

## Volver a v1 si algo sale mal

```bash
docker compose -f docker-compose.prod.yml down
git checkout main
docker compose -f docker-compose.prod.yml up -d --build
```
v1 vuelve con su base intacta (volumen `postgres_data`). Lo que se haya cargado
en v2 mientras tanto no pasa a v1.

## Notas

- La VM tiene 1 GB: el build del frontend es lo más pesado. Si se queda sin
  memoria, buildear con `web` levantado pero sin nada más corriendo, o agregar
  swap.
- v2 consulta el tipo de cambio al BCRA desde el servidor, igual que v1.
