# Despliegue AWS Desde Cero

Guía práctica para desplegar la aplicación desde cero en AWS, preservando datos y con configuración segura para producción.

## 1. Objetivo y alcance

Esta guía cubre:
- infraestructura base en AWS,
- despliegue de backend/frontend en contenedores,
- base PostgreSQL administrada,
- dominio + HTTPS,
- variables de entorno y operación inicial.

Arquitectura objetivo:
- Frontend: `Next.js` en `ECS Fargate`
- Backend: `Django API` en `ECS Fargate`
- DB: `RDS PostgreSQL`
- DNS: `Route 53`
- TLS: `ACM`
- Tráfico: `ALB`
- Imágenes: `ECR`
- Secretos: `Secrets Manager`
- Logs/alertas: `CloudWatch`

## 2. Prerrequisitos

- Cuenta AWS activa.
- Dominio en Route 53 (o transferido/delegado).
- AWS CLI configurado localmente (`aws configure`).
- Docker local para build/push.
- Repo del proyecto listo con `.env.example`.

## 3. Variables de entorno de producción

Definir al menos:

- `COMPANY_NAME`
- `NEXT_PUBLIC_COMPANY_NAME`
- `DJANGO_SECRET_KEY`
- `DJANGO_DEBUG=0`
- `DJANGO_ALLOWED_HOSTS`
- `CORS_ALLOWED_ORIGINS`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_HOST` (endpoint RDS)
- `DB_PORT=5432`
- `NEXT_PUBLIC_API_URL`

Recomendado:
- guardar secretos en `AWS Secrets Manager`,
- no usar credenciales hardcodeadas en task definitions.

## 4. Infraestructura base (orden sugerido)

1. Crear VPC con 2 AZ.
2. Crear subredes públicas (ALB/NAT) y privadas (ECS/RDS).
3. Crear Security Groups:
- `alb-sg`: permite `443` desde internet.
- `ecs-sg`: permite tráfico solo desde `alb-sg`.
- `rds-sg`: permite `5432` solo desde `ecs-sg`.
4. Crear RDS PostgreSQL (Multi-AZ recomendado).
5. Crear cluster ECS Fargate.
6. Crear repositorios ECR:
- `business-web`
- `business-frontend`
7. Solicitar certificado ACM para dominio (`api.tudominio.com`, `app.tudominio.com`).
8. Crear ALB + listeners HTTPS + target groups.
9. Crear registros DNS en Route 53 apuntando al ALB.

## 5. Build y push de imágenes

Ejemplo (ajustar `ACCOUNT_ID`, `REGION`):

```bash
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

# Backend
docker build -t business-web:latest ./backend
docker tag business-web:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/business-web:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/business-web:latest

# Frontend
docker build -t business-frontend:latest ./frontend
docker tag business-frontend:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/business-frontend:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/business-frontend:latest
```

## 6. Deploy en ECS

Crear dos task definitions:

### Backend task
- Imagen: `business-web:latest`
- Puerto contenedor: `8000`
- Env vars + secrets (RDS + Django + branding)
- Health check interno HTTP (opcional)

### Frontend task
- Imagen: `business-frontend:latest`
- Puerto contenedor: `3000`
- `NEXT_PUBLIC_API_URL=https://api.tudominio.com/api`
- `NEXT_PUBLIC_COMPANY_NAME`

Crear servicios ECS:
- `web-service` -> target group API
- `frontend-service` -> target group APP

Configurar ALB rules:
- Host `api.tudominio.com` -> backend TG
- Host `app.tudominio.com` -> frontend TG

## 7. Inicialización de base y usuario admin

Ejecutar una sola vez (vía ECS Exec o task puntual):

```bash
python manage.py migrate
python manage.py createsuperuser
```

Validar:
- Admin: `https://api.tudominio.com/admin`
- App: `https://app.tudominio.com/login`

## 8. Datos productivos: backup y restauración

Antes de cualquier cambio mayor:

```bash
pg_dump -Fc -h <RDS_HOST> -U <DB_USER> <DB_NAME> > backup_YYYYMMDD.dump
```

Restore:

```bash
pg_restore --clean --if-exists -h <RDS_HOST> -U <DB_USER> -d <DB_NAME> backup_YYYYMMDD.dump
```

Recomendado:
- habilitar snapshots automáticos de RDS,
- política de retención + prueba mensual de restore.

## 9. Seguridad mínima para producción

- `DJANGO_DEBUG=0`
- `ALLOWED_HOSTS` restringido al dominio real
- `CORS_ALLOWED_ORIGINS` solo frontend real
- Secrets en Secrets Manager
- TLS obligatorio (solo HTTPS)
- WAF delante del ALB
- IAM mínimo privilegio

## 10. Observabilidad y alertas

Configurar CloudWatch para:
- logs de backend/frontend,
- métricas ALB (4xx/5xx/latencia),
- métricas RDS (CPU, conexiones, storage).

Alertas mínimas (SNS):
- error rate alto,
- backend unhealthy,
- RDS storage alto,
- reinicios anómalos de tasks.

## 11. Actualización de versión (runbook)

1. Build/push de nuevas imágenes.
2. Actualizar task definitions con nuevo tag.
3. Deploy rolling en ECS.
4. Verificar health checks.
5. Smoke test funcional:
- login,
- dashboard,
- alta de gasto,
- alta de trabajo,
- cobro/distribución.
6. Si falla: rollback a task definition anterior.

## 12. Evolución recomendada (auth)

Actualmente la app funciona con token DRF.
Para hardening recomendado:
- migrar a Cognito (Hosted UI + PKCE),
- validar JWT en backend,
- pasar sesión a cookies seguras.

Ver arquitectura de referencia en `docs/ARQUITECTURA_AWS.md`.
