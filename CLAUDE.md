# company-ops-control

Aplicación web interna para administrar compras, gastos, trabajos, cobros, distribuciones, caja y cap table de una empresa con pocos usuarios y marca parametrizable.

## Tech Stack

- Next.js 14 (App Router)
- React
- TypeScript
- Django
- Django REST Framework
- PostgreSQL
- Docker Compose
- Python
- CSS global custom
- BCRA exchange-rate integration by date

## Architecture

- `/frontend` -> aplicación Next.js
- `/frontend/app` -> pantallas con App Router
- `/frontend/components` -> componentes reutilizables de UI
- `/frontend/lib/api.ts` -> cliente API, auth token y compatibilidad de sesión legacy
- `/frontend/lib/brand.ts` -> branding por variable de entorno
- `/backend` -> proyecto Django
- `/backend/server_config` -> configuración Django (`settings`, `urls`, `wsgi`, `asgi`)
- `/backend/core` -> modelos, serializers, endpoints API, admin y lógica principal de negocio
- `/backend/templates` -> templates Django para login/admin base
- `/docs` -> documentación operativa, AWS, base de datos y flujos
- `docker-compose.yml` -> stack local actual
- `docker-compose.example.yml` -> ejemplo seguro para bootstrap

## Commands

### Frontend
- `docker compose up -d --build` -> levanta toda la stack local
- `docker compose exec web python manage.py migrate` -> aplica migraciones
- `docker compose exec web python manage.py createsuperuser` -> crea admin Django
- `docker compose exec web python manage.py check` -> chequeo general Django
- `docker compose logs -f` -> logs de todos los servicios

### Frontend
- `cd frontend && npm install`
- `cd frontend && npm run dev` -> frontend local en `3000`
- `cd frontend && npm run build` -> build de producción

### Backend
- `cd backend && python3 -m venv .venv && source .venv/bin/activate`
- `cd backend && pip install -r requirements.txt`
- `cd backend && python manage.py runserver 0.0.0.0:8000`
- `cd backend && python manage.py migrate`
- `cd backend && python manage.py createsuperuser`
- `cd backend && python manage.py shell`

## Modules

- Dashboard -> métricas operativas, caja, pipeline y alertas
- Inversores -> catálogo de socios/inversores
- Compras -> registro de compras y relación con cuotas/obligaciones
- Cuentas a pagar -> cuotas y obligaciones pendientes o pagadas
- Gastos -> egresos pagados por inversor o desde caja
- Gasto rápido -> alta mobile-first para registrar un gasto desde celular
- Trabajos -> registro operativo de trabajos realizados
- Distribuciones -> facturación, cobro y distribución de ganancias de trabajos
- Caja -> movimientos de caja separados en ARS y USD
- TC -> auditoría de tipo de cambio
- Cap Table -> cálculo de participación societaria en base a aportes, gastos, reinversión y rescates

## Code Conventions

- El idioma funcional del dominio está en español aunque los nombres técnicos del código estén mayormente en inglés.
- Los endpoints principales cuelgan de `/api/`.
- El frontend usa `fetch` centralizado en `frontend/lib/api.ts`.
- La sesión actual sigue con token DRF; hay compatibilidad temporal con claves legacy de `localStorage`.
- La marca visible no debe quedar hardcodeada: usar `COMPANY_NAME` y `NEXT_PUBLIC_COMPANY_NAME`.
- El tipo de cambio ARS/USD se toma por fecha y con fallback al día hábil anterior.
- Los montos se manejan en moneda original y equivalente USD según el módulo.
- Caja ARS y caja USD son conceptualmente distintas; no asumir que todo se convierte a USD.

## Important Notes

- No commitear `.env`, datos reales, backups ni builds.
- Los archivos sensibles/locales deben quedar ignorados: `data/`, `backend/data/`, `backups/`, `.env`, `.venv/`, `frontend/.next/`.
- El archivo `backend/data/R - numeros.xlsx` existe localmente como dato real y no debe subirse a GitHub.
- Las migraciones y comandos Django se ejecutan desde `/backend` o vía `docker compose exec web`.
- El frontend no accede directo a la base; toda la lógica pasa por la API Django.
- No cambiar nombres de DB/credenciales en `.env` local sin entender que eso puede apuntar a otra base y hacer parecer que “faltan datos”.
- Antes de cambios estructurales importantes, hacer backup de Postgres.
- Deploy recomendado hoy: `AWS Lightsail` con 1 instancia, no arquitectura distribuida.
