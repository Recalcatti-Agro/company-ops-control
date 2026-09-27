# Pase a producción — v1 → v2

Paso a paso para reemplazar v1 por v2 en el servidor de producción (AWS
Lightsail, `~/company-ops-control`). Ensayado en local el 27/09/2026 con
`docker-compose.prod.yml` completo (imágenes de producción, Caddy, Postgres) y el
backup del 26/09: cajas y capital de cada inversor iguales al centavo que la base
de desarrollo, y el script de backup funcionando contra la base de v2. La base que
se sube se arma con `scripts/armar_base_prod.sh` (verificada fila por fila contra
la base de desarrollo el 27/09).

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

1. Tener la rama `v2` al día en GitHub (`git push`), sin datos reales (ver
   [DATOS_SENSIBLES.md](DATOS_SENSIBLES.md)).
2. En el repo de v1 (`Recalcatti`), marcar el último estado de v1:
   ```bash
   git tag v1-final main
   git push origin v1-final
   ```
3. Revisar que el `.env` del servidor tenga todas las variables de
   `.env.prod.example` (en particular `NEXT_PUBLIC_API_URL=https://<dominio>/api`
   y `CORS_ALLOWED_ORIGINS=https://<dominio>`).
4. Avisar a los usuarios: desde el paso 1 del día del pase no se carga nada en v1.

## El día del pase

La base de v2 se arma **en la Mac** (con los datos de `privado/`, que nunca van
al servidor) y se sube lista. `S>` = en el servidor, `M>` = en la Mac, desde
`Recalcatti-v2`.

```bash
S> ssh ubuntu@TU_IP
S> cd ~/company-ops-control
S> git status --short          # tiene que estar vacío
S> set -a; . ./.env; set +a    # variables para los scripts y comandos de abajo
```

**1. Congelar v1 y hacer el backup final** (queda en `~/backups/` y en S3):
```bash
S> ./scripts/backup_db_prod_to_s3.sh
S> ls -t ~/backups/*.sql | head -1     # anotar el nombre
```

**2. Bajar el backup a la Mac:**
```bash
M> scp ubuntu@TU_IP:~/backups/opsdb_AAAA-MM-DD_HHMMSS.sql ~/Downloads/
```

**3. Armar la base de v2** (levanta db + web con las imágenes de producción en un
proyecto de compose aparte, migra, carga los pendientes del chat, muestra cajas y
capital, y deja un dump en `privado/prod/`):
```bash
M> scripts/armar_base_prod.sh ~/Downloads/opsdb_AAAA-MM-DD_HHMMSS.sql privado/prod/opsdb_v2_final.dump
```
Comparar los números con los esperados (`privado/docs/ESTADO_ACTUAL.md`). Si no
cierran, **frenar acá**: v1 sigue intacta, alcanza con descongelarla.

**4. Subir la base al servidor:**
```bash
M> scp privado/prod/opsdb_v2_final.dump ubuntu@TU_IP:~/opsdb_v2_final.dump
```

**5. Bajar v1 y pasar el código a v2** (los volúmenes de v1 quedan):
```bash
S> docker compose -f docker-compose.prod.yml down
S> git fetch origin
S> git checkout -b v2 origin/v2
```

**6. Restaurar la base de v2** en el volumen nuevo (`postgres_v2_data`, vacío):
```bash
S> docker compose -f docker-compose.prod.yml up -d db
S> until docker compose -f docker-compose.prod.yml exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 2; done
S> docker compose -f docker-compose.prod.yml exec -T db pg_restore --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" < ~/opsdb_v2_final.dump
```

**7. Levantar todo** (el backend ve las tablas ya migradas y arranca):
```bash
S> docker compose -f docker-compose.prod.yml up -d --build
S> docker compose -f docker-compose.prod.yml ps
S> docker compose -f docker-compose.prod.yml logs --tail=30 web
```

**8. Verificar los números en producción** (tienen que dar igual que en el paso 3):
```bash
S> docker compose -f docker-compose.prod.yml exec web python manage.py shell -c "
from core import models, calc
for a in models.Account.objects.all(): print(a.currency, round(a.balance, 2))
rows, total = calc.cap_table(); print('capital', round(total, 2))"
```

**9. Probar en el navegador:** entrar con el usuario `admin` (contraseña de v1;
los usuarios se migran con su contraseña) y revisar Inicio, Caja, Facturación y
Trabajos. El resto de los usuarios entra con su contraseña de siempre.

**10. Probar el backup de v2 y limpiar:**
```bash
S> ./scripts/backup_db_prod_to_s3.sh
S> rm ~/opsdb_v2_final.dump
```
Desde acá los backups diarios son de v2 (esquema nuevo).

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
