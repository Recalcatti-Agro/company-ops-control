# Arquitectura AWS Objetivo (Producción)

Este documento define la arquitectura recomendada para desplegar la aplicación en AWS con autenticación segura en Cognito.

Implementación paso a paso: `docs/DESPLIEGUE_AWS_DESDE_CERO.md`.

## 1. Diagrama (Mermaid)

```mermaid
flowchart TD
  U[Usuarios Web/Móvil] --> R53[Route 53]
  R53 --> CF[CloudFront + AWS WAF]
  CF --> ALB[Application Load Balancer + ACM TLS]

  ALB --> FE[ECS Fargate Service - Next.js]
  ALB --> API[ECS Fargate Service - Django API]

  FE --> COG[Cognito User Pool + Hosted UI]
  API --> COGJWT[Validación JWT Cognito (JWKS)]

  API --> RDS[(RDS PostgreSQL Multi-AZ)]
  API --> S3[S3 (exports, adjuntos opcionales)]
  API --> SM[AWS Secrets Manager]
  API --> FX[BCRA API externa]

  FE --> CW[CloudWatch Logs/Metrics]
  API --> CW
  ALB --> CW

  CW --> SNS[SNS Alarmas]
  RDS --> BAK[AWS Backup / snapshots]
```

## 2. Componentes

- `Route 53`: DNS del dominio.
- `CloudFront`: CDN + edge cache.
- `AWS WAF`: protección básica (rate-limit, reglas managed).
- `ALB`: terminación HTTPS con certificados ACM.
- `ECS Fargate`:
- servicio frontend Next.js,
- servicio backend Django API.
- `RDS PostgreSQL`: base principal (Multi-AZ recomendado).
- `Secrets Manager`: secretos de app y DB.
- `CloudWatch`: logs y métricas.
- `AWS Backup`: retención de snapshots.

## 3. Red y seguridad (VPC)

- VPC en al menos 2 AZ.
- Subredes públicas: ALB (y NAT Gateway si aplica).
- Subredes privadas: ECS tasks + RDS.
- Security Groups estrictos:
- internet -> ALB (443),
- ALB -> ECS,
- ECS -> RDS,
- sin acceso público directo a RDS.

## 4. Login/registro con Cognito

## Modelo recomendado

- `Cognito User Pool` para identidad.
- Frontend con `Hosted UI`.
- Flujo `Authorization Code + PKCE`.
- Django valida JWT de Cognito en cada request.

## Registro de usuarios para este proyecto

- No habilitar registro público.
- Alta por invitación/admin (`AdminCreateUser`).
- MFA obligatorio para los usuarios administradores.

## Mapeo de negocio

- Mantener tabla de mapeo `usuario auth -> investor` en base de datos para precargar inversor por defecto en formularios.

## 5. Observabilidad y operación

- Logs estructurados de frontend y backend en CloudWatch.
- Alarmas de:
- errores 5xx,
- picos de latencia,
- fallas de login,
- caída de servicio.
- Tablero operativo en CloudWatch Dashboard.

## 6. Hardening mínimo

- Forzar HTTPS end-to-end.
- Rotación de secretos.
- Política IAM de mínimo privilegio.
- Backups diarios y pruebas de restore.
- Protección WAF en `/api/*` y login.
- CORS y hosts restringidos en producción.

## 7. Fases sugeridas de despliegue

1. Fase 1: ECS + RDS + ALB + dominio.
2. Fase 2: Migración auth a Cognito.
3. Fase 3: WAF, alarmas y backups formales.
4. Fase 4: IaC (Terraform) para reproducibilidad.

## 8. Variables de entorno de producción (mínimas)

Backend:
- `DJANGO_SECRET_KEY`
- `DJANGO_DEBUG=0`
- `DJANGO_ALLOWED_HOSTS`
- `CORS_ALLOWED_ORIGINS`
- credenciales DB (ideal vía Secrets Manager)
- parámetros Cognito (issuer, audience, jwks)

Frontend:
- URL pública API
- parámetros de cliente Cognito (domain/client_id/redirects)
