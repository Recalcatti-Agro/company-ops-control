# Recalcatti - Control

Aplicación web para administrar operaciones de una empresa con marca parametrizable:
- compras y cuotas,
- gastos,
- trabajos,
- facturación/cobro,
- distribución de ganancias,
- caja (ARS y USD),
- cap table.

## Stack actual

- Frontend: Next.js 14 (App Router, React)
- Backend: Django + Django REST Framework
- Base de datos: PostgreSQL
- Contenedores: Docker Compose
- Auth actual: TokenAuthentication (DRF)
- Tipo de cambio: BCRA por fecha con fallback al día hábil anterior

## Branding

- El repo trae defaults versionados en `config/branding.json`
- Hoy esos defaults están seteados para `Recalcatti`
- Los assets visuales versionados viven en `frontend/public/`
  - `logo.png` para el navbar
  - `favicon.png` y `favicon.svg` para metadata/iconos
- Dominio real y URL de API siguen yendo solo por `.env`
- Overrides soportados:
  - `COMPANY_NAME`
  - `NEXT_PUBLIC_COMPANY_NAME`

Precedencia recomendada:
1. `.env` del entorno
2. `config/branding.json`
3. fallback final del código

## Módulos funcionales

- `Dashboard`
- `Inversores`
- `Compras`
- `Cuentas a pagar` (obligaciones/cuotas)
- `Gastos`
- `Gasto rápido` (mobile-first)
- `Trabajos`
- `Distribuciones` (facturación/cobro/distribución)
- `Caja`
- `TC` (auditoría de tipo de cambio)

## Reglas de negocio implementadas (resumen)

1. Moneda dual: los registros guardan moneda original y equivalente USD según TC de la fecha.
2. Caja separada en ARS y USD; además se calcula equivalente USD para métricas.
3. Gasto pagado por caja genera automáticamente egreso de caja.
4. Compra puede tener cuotas (`PaymentObligation` auto-generadas) y cada cuota se paga con uno o más gastos.
5. Un cobro puede agrupar varios trabajos (mismo cliente desde UI).
6. Distribución de cobro:
- parte para equipo de campo,
- parte para accionistas según % empresa al momento del trabajo,
- cada accionista decide retiro o reinversión.
7. La reinversión genera ingreso de caja y suma capital del inversor.
8. El cap table se calcula con: gastos pagados por inversor + aportes directos + reinversiones - rescates.

## Estructura del repositorio

- `backend/`
- `backend/core/models.py` -> modelo de dominio
- `backend/core/serializers.py` -> validaciones y conversiones
- `backend/core/api_views.py` -> endpoints + lógica operativa
- `backend/core/api_urls.py` -> rutas API
- `backend/server_config/` -> configuración Django (settings/urls/wsgi/asgi)
- `frontend/`
- `frontend/app/` -> pantallas
- `frontend/components/Nav.tsx` -> navbar y brand visual
- `frontend/lib/api.ts` -> cliente API + sesión local
- `config/branding.json` -> defaults versionados de marca
- `docker-compose.yml` -> stack local/desarrollo
- `docker-compose.prod.yml` -> stack de producción para Lightsail
- `infra/terraform/` -> infraestructura mínima reproducible (Lightsail + S3 + IAM + budget)
- `Caddyfile` -> reverse proxy y TLS automático
- `scripts/backup_db_prod.sh` -> backup lógico simple de PostgreSQL en producción
- `scripts/backup_db_prod_to_s3.sh` -> backup lógico + subida a S3
- `docs/RUNBOOK_PRODUCCION.md` -> comandos operativos reales de producción
- `docs/BASE_DE_DATOS.md` -> esquema de base de datos (tablas, relaciones y reglas)
- `docs/FLUJO_CAJA_Y_TRABAJOS.md` -> flujo operativo detallado
- `docs/DESPLIEGUE_AWS_LIGHTSAIL.md` -> guía operativa recomendada para deploy simple en Lightsail

## Endpoints API principales

Base local: `http://localhost:8000/api`

- `POST /auth/login/`
- `GET /fx/ars-usd/?date=YYYY-MM-DD`
- CRUD:
- `/investors/`
- `/clients/`
- `/purchases/`
- `/payment-obligations/`
- `/expenses/`
- `/jobs/`
- `/job-collections/`
- `/job-distributions/`
- `/cash-movements/`
- `/capital-contributions/`
- `/exchange-rates/`
- Dashboard:
- `GET /dashboard/summary/`

Acciones custom relevantes:
- `POST /jobs/{id}/mark-done/`
- `POST /jobs/{id}/mark-pending/`
- `POST /job-collections/{id}/mark-collected/`
- `POST /job-collections/{id}/distribution-preview/`
- `POST /job-collections/{id}/apply-distribution/`

## Ejecución local

1. Crear entorno local desde plantilla:

```bash
cp .env.example .env
```

2. Ajustar credenciales/puertos en `.env`.

3. Levantar servicios:

```bash
docker compose up --build -d
```

Si solo cambió el frontend:

```bash
docker compose build frontend
docker compose up -d frontend
```

Si solo cambió el backend:

```bash
docker compose build web
docker compose up -d web
```

4. Migrar DB:

```bash
docker compose exec web python manage.py migrate
```

5. Crear usuario admin (opcional):

```bash
docker compose exec web python manage.py createsuperuser
```

6. URLs:
- Frontend: `http://localhost:3000`
- API/Admin: `http://localhost:8000/admin`

## Variables de entorno importantes

Backend (`docker-compose.yml`):
- `COMPANY_NAME`
- `DJANGO_SECRET_KEY`
- `DJANGO_DEBUG`
- `DJANGO_ALLOWED_HOSTS`
- `CSRF_TRUSTED_ORIGINS`
- `CORS_ALLOWED_ORIGINS`
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`

Frontend:
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_COMPANY_NAME`

Notas:
- `NEXT_PUBLIC_*` se inyecta en build time de Next.js
- si cambia `NEXT_PUBLIC_API_URL` o `NEXT_PUBLIC_COMPANY_NAME`, hace falta rebuild del frontend
- `config/branding.json` entra al frontend a través del build desde la raíz del repo

Producción (`docker-compose.prod.yml` / `Caddyfile`):
- `APP_DOMAIN`

Nota:
- `APP_DOMAIN` y `NEXT_PUBLIC_API_URL` no deben versionarse con valores reales de producción
- `COMPANY_NAME` y `NEXT_PUBLIC_COMPANY_NAME` sí pueden quedar con defaults de `Recalcatti` en el repo

## Documentación vigente

- `docs/DESPLIEGUE_AWS_LIGHTSAIL.md`
  - cómo está desplegado hoy el sistema en AWS Lightsail
- `docs/RUNBOOK_PRODUCCION.md`
  - comandos operativos cortos para deploy, restart, logs y backups
- `docs/BASE_DE_DATOS.md`
  - modelo de datos y relaciones
- `docs/FLUJO_CAJA_Y_TRABAJOS.md`
  - reglas operativas del negocio
- `docs/MOBILE.md`
  - decisiones de UX mobile y flujos rápidos
- `docs/TESTS.md`
  - cómo correr y qué cubren los tests backend
- `infra/terraform/README.md`
  - cómo recrear la infraestructura base actual con Terraform

## Seguridad y producción

Estado actual:
- Login con token DRF + almacenamiento local.

Infra actual:
- AWS Lightsail
- Docker Compose
- Caddy
- PostgreSQL en la misma instancia
- backup lógico diario a S3 + snapshots de Lightsail

Deploy recomendado hoy para esta carga:
- `docs/DESPLIEGUE_AWS_LIGHTSAIL.md`
- `docs/RUNBOOK_PRODUCCION.md`

## GitHub público (higiene mínima)

- No versionar datos reales ni backups (`data/`, `backend/data/`, `backups/`).
- No versionar secretos (`.env`, `.env.*`) salvo plantillas `*.env.example`.
- Usar siempre variables de entorno para credenciales y branding.
