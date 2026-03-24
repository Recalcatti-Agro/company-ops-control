# Despliegue En AWS Lightsail

Guía operativa para desplegar esta aplicación en producción usando una sola instancia de AWS Lightsail.

Esta es la opción recomendada para la carga actual del sistema:
- muy pocos usuarios,
- uso interno,
- prioridad en simplicidad operativa,
- costo bajo.

## Índice

- [1. Arquitectura recomendada](#1-arquitectura-recomendada)
- [2. Costo estimado](#2-costo-estimado)
- [3. Qué se va a desplegar](#3-qué-se-va-a-desplegar)
- [4. Paso previo: control de costos y alertas](#4-paso-previo-control-de-costos-y-alertas)
- [5. Paso 1: Crear la instancia](#5-paso-1-crear-la-instancia)
- [6. Paso 2: Crear una IP estática](#6-paso-2-crear-una-ip-estática)
- [7. Paso 3: Abrir solo los puertos necesarios](#7-paso-3-abrir-solo-los-puertos-necesarios)
- [8. Paso 4: Configurar el dominio de nic.ar](#8-paso-4-configurar-el-dominio-de-nicar)
- [9. Paso 5: Conectarse por SSH](#9-paso-5-conectarse-por-ssh)
- [10. Paso 6: Preparar el servidor](#10-paso-6-preparar-el-servidor)
- [10.1 Agregar swap](#101-agregar-swap)
- [11. Paso 7: Instalar Docker](#11-paso-7-instalar-docker)
- [12. Paso 8: Clonar el repositorio](#12-paso-8-clonar-el-repositorio)
- [13. Paso 9: Crear el `.env` de producción](#13-paso-9-crear-el-env-de-producción)
- [14. Paso 10: Proxy HTTPS con Caddy](#14-paso-10-proxy-https-con-caddy)
- [15. Paso 11: Ajuste de `docker-compose` para producción](#15-paso-11-ajuste-de-docker-compose-para-producción)
- [16. Paso 12: Levantar la aplicación](#16-paso-12-levantar-la-aplicación)
- [17. Paso 13: Verificar](#17-paso-13-verificar)
- [18. Paso 14: Backups](#18-paso-14-backups)
  - [18.1 Snapshots automáticos de Lightsail](#181-snapshots-automáticos-de-lightsail)
  - [18.2 Dump lógico de PostgreSQL](#182-dump-lógico-de-postgresql)
  - [18.3 Backup lógico automático a S3](#183-backup-lógico-automático-a-s3)
- [19. Paso 15: Actualizar la aplicación](#19-paso-15-actualizar-la-aplicación)
- [20. Seguridad mínima obligatoria](#20-seguridad-mínima-obligatoria)
- [21. Estado recomendado del proyecto antes del deploy](#21-estado-recomendado-del-proyecto-antes-del-deploy)
- [22. Siguiente iteración recomendada](#22-siguiente-iteración-recomendada)

## 1. Arquitectura recomendada

```text
Dominio en nic.ar
  -> DNS A record
  -> Static IP de Lightsail
  -> Caddy (HTTPS)
      -> Frontend Next.js
      -> Backend Django
      -> PostgreSQL
```

## 2. Costo estimado

- Lightsail Linux `1 GB / 2 vCPU / 40 GB SSD`: `USD 7/mes`
- Snapshots: aprox. `USD 1 a 3/mes`
- S3 para dumps: normalmente menos de `USD 1/mes`
- Cognito para 3 usuarios: `USD 0/mes` en la práctica si luego se migra auth

Rango razonable esperado:
- `USD 8 a 11/mes`

Fuentes:
- Lightsail pricing: https://aws.amazon.com/lightsail/pricing/
- Cognito pricing: https://aws.amazon.com/cognito/pricing/

## 3. Qué se va a desplegar

- `frontend`: Next.js
- `web`: Django + DRF
- `db`: PostgreSQL
- `caddy`: reverse proxy + HTTPS automático

Archivos reales ya incluidos en el repo:
- `docker-compose.prod.yml`
- `Caddyfile`
- `backend/entrypoint.prod.sh`

## 4. Paso previo: control de costos y alertas

Antes de crear recursos, conviene dejar definido un control explícito para no superar el presupuesto objetivo.

Presupuesto objetivo:
- tope deseado: `USD 12/mes`

### 4.1 Qué debería entrar dentro de ese tope

Esperado para esta arquitectura:

- instancia Lightsail `1 GB`: `USD 7/mes`
- snapshots: aprox. `USD 1 a 3/mes`
- S3 para dumps: normalmente menos de `USD 1/mes`

Eso deja poco margen. Por eso no conviene:
- crear recursos extra en AWS sin revisar costo,
- dejar snapshots crecer sin control,
- agregar servicios administrados innecesarios.

### 4.2 Crear un AWS Budget

En AWS:

1. Ir a `Billing and Cost Management`
2. `Budgets`
3. `Create budget`
4. Tipo: `Cost budget`
5. Periodicidad: `Monthly`
6. Monto: `12 USD`

Alertas sugeridas:
- `80%` del presupuesto: aviso temprano
- `100%` del presupuesto: alerta crítica

Destino:
- tu correo principal

Referencia:
- https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html

### 4.3 Activar alertas de facturación

Además del Budget, conviene activar billing alerts generales.

1. En `Billing Preferences`
2. Activar:
- `Receive AWS Free Tier Alerts`
- alertas/visibilidad de facturación si están disponibles en tu cuenta

### 4.4 Qué monitorear específicamente

Revisar una vez por semana:

1. costo de la instancia Lightsail
2. storage consumido por snapshots
3. costo de S3 si decidís guardar dumps ahí

### 4.5 Regla operativa para mantenerte debajo de USD 12

Para cumplir el objetivo:

1. usar solo una instancia Lightsail de `1 GB`
2. no crear balanceadores, RDS, NAT Gateway, ECS ni servicios adicionales
3. mantener snapshots automáticos, pero revisar storage
4. guardar pocos dumps y con retención corta
5. no migrar todavía a una arquitectura distribuida

## 5. Paso 1: Crear la instancia

En la consola de AWS Lightsail:

1. `Create instance`
2. Región: elegir una cercana. Para Argentina suele ser razonable `São Paulo` si está disponible.
3. Plataforma: `Linux/Unix`
4. Blueprint: `OS Only`
5. Sistema operativo: `Ubuntu 24.04 LTS`
6. Plan: `1 GB RAM / 2 vCPU / 40 GB SSD`
7. Nombre sugerido: `ops-control-prod`

Referencia:
- https://docs.aws.amazon.com/lightsail/latest/userguide/getting-started-with-amazon-lightsail.html

## 6. Paso 2: Crear una IP estática

No conviene usar la IP pública dinámica de la instancia.

1. Ir a `Networking`
2. `Create static IP`
3. Asociarla a `ops-control-prod`

Referencias:
- https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html
- https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-static-ip-addresses-in-amazon-lightsail.html

## 7. Paso 3: Abrir solo los puertos necesarios

En la pestaña `Networking` de la instancia:

Abrir:
- `22` para SSH
- `80` para HTTP
- `443` para HTTPS

No abrir:
- `3000`
- `8000`
- `5432`

La base y los servicios internos deben quedar accesibles solo dentro del host.

## 8. Paso 4: Configurar el dominio de nic.ar

Como el dominio ya existe, no hace falta comprar uno nuevo.

En el panel DNS del dominio:

1. Crear un registro `A`
2. Host:
- `@` si querés el dominio raíz
- `control` o `app` si querés un subdominio
3. Valor:
- la IP estática de Lightsail

Ejemplo:

```text
control.tudominio.com -> 3.123.45.67
```

Recomendación:
- usar `control.tudominio.com`

## 9. Paso 5: Conectarse por SSH

Desde tu máquina:

```bash
ssh ubuntu@TU_IP
```

O con clave PEM:

```bash
ssh -i /ruta/a/lightsail-key.pem ubuntu@TU_IP
```

Referencia:
- https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-connect-to-your-instance-virtual-private-server.html

## 10. Paso 6: Preparar el servidor

Actualizar paquetes:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw
```

Activar firewall local:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

## 10.1 Agregar swap

En una instancia de `1 GB`, los builds de Docker pueden agotar la memoria y dejar la VM sin responder.

Antes de hacer rebuilds en producción, agregar swap:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

Recomendación:
- dejar este swap permanente,
- no rebuildar toda la stack si solo cambió frontend o backend.

## 11. Paso 7: Instalar Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

## 12. Paso 8: Clonar el repositorio

Como este repositorio es público, la opción más simple en el servidor es clonar por HTTPS.

### Opción recomendada: HTTPS

```bash
git clone https://github.com/Recalcatti-Agro/company-ops-control.git
cd company-ops-control
```

### Opción alternativa: SSH

Solo conviene si ya configuraste una clave SSH del servidor con acceso a GitHub.

```bash
git clone git@github.com:Recalcatti-Agro/company-ops-control.git
cd company-ops-control
```

Si el servidor no tiene una clave autorizada en GitHub, el clone por SSH va a fallar con `Permission denied (publickey)`.

## 13. Paso 9: Crear el `.env` de producción

No reutilizar el `.env` local de desarrollo sin revisar.

Crear un `.env` de producción con valores propios del servidor:

```env
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=poner-una-clave-larga-y-unica
DJANGO_ALLOWED_HOSTS=control.tudominio.com
CSRF_TRUSTED_ORIGINS=https://control.tudominio.com
CORS_ALLOWED_ORIGINS=https://control.tudominio.com
APP_DOMAIN=control.tudominio.com

COMPANY_NAME=Tu Empresa
NEXT_PUBLIC_COMPANY_NAME=Tu Empresa
NEXT_PUBLIC_API_URL=https://control.tudominio.com/api

POSTGRES_DB=opsdb
POSTGRES_USER=opsuser
POSTGRES_PASSWORD=poner-una-password-larga-y-unica

DB_NAME=opsdb
DB_USER=opsuser
DB_PASSWORD=poner-una-password-larga-y-unica
DB_HOST=db
DB_PORT=5432
```

## 14. Paso 10: Proxy HTTPS con Caddy

Para producción simple conviene usar `Caddy` porque gestiona HTTPS automáticamente.

El repo ya incluye un `Caddyfile` productivo. Usa la variable `APP_DOMAIN`.

```caddy
{$APP_DOMAIN} {
    encode gzip

    handle /api/* {
        reverse_proxy web:8000
    }

    handle /admin/* {
        reverse_proxy web:8000
    }

    handle /static/* {
        reverse_proxy web:8000
    }

    handle {
        reverse_proxy frontend:3000
    }
}
```

Requisito para que funcione:
- el dominio ya debe resolver a la IP estática,
- `80` y `443` deben estar abiertos.

Importante:
- el servicio `caddy` debe persistir `/data` y `/config`,
- eso ya está resuelto en `docker-compose.prod.yml`,
- la ruta `/static/*` va al backend para que el admin Django cargue bien sus CSS/JS.

## 15. Paso 11: Ajuste de `docker-compose` para producción

El repo ya incluye `docker-compose.prod.yml`.

En producción se corren:

- `caddy`
- `frontend`
- `web`
- `db`

Y publicar solo:
- `80`
- `443`

No publicar:
- `3000`
- `8000`
- `5432`

Objetivo:
- `frontend`, `backend` y `db` quedan privados dentro de la red Docker.

Puntos resueltos en ese compose:
- solo `80` y `443` publicados,
- `caddy_data` y `caddy_config` persistidos,
- `postgres_data` persistido,
- backend productivo con `gunicorn`,
- `migrate` y `collectstatic` automáticos en el arranque del backend.

## 16. Paso 12: Levantar la aplicación

Desde la raíz del repo:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

En una instancia de `1 GB`, si solo cambió el frontend conviene hacer:

```bash
docker compose -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.prod.yml up -d frontend
```

Y si solo cambió el backend:

```bash
docker compose -f docker-compose.prod.yml build web
docker compose -f docker-compose.prod.yml up -d web
```

Crear superusuario si hace falta:

```bash
docker compose -f docker-compose.prod.yml exec web python manage.py createsuperuser
```

## 17. Paso 13: Verificar

Validar:

- `https://control.tudominio.com`
- `https://control.tudominio.com/admin`

Chequear contenedores:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
```

## 18. Paso 14: Backups

### 18.1 Snapshots automáticos de Lightsail

Activar desde la consola:

1. Instancia
2. `Snapshots`
3. `Enable automatic snapshots`

AWS indica que conserva los 7 snapshots diarios más recientes y cobra el almacenamiento por separado.

Referencias:
- https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-configuring-automatic-snapshots.html
- https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-snapshots.html

### 18.2 Dump lógico de PostgreSQL

Además del snapshot completo, conviene generar dumps diarios:

```bash
mkdir -p ~/backups
export POSTGRES_USER=opsuser
export POSTGRES_DB=opsdb
./scripts/backup_db_prod.sh
```

Recomendación:
- retener 7 o 14 días,
- opcionalmente copiar esos dumps a S3.

Script incluido en el repo:
- `scripts/backup_db_prod.sh`

### 18.3 Backup lógico automático a S3

Guardar el dump solo dentro de la instancia no alcanza. Si perdés la VM, perdés también los archivos del backup local.

La recomendación es:

1. generar dump lógico diario,
2. subirlo a S3,
3. aplicar lifecycle rule para borrar backups viejos.

#### Paso 1: Crear bucket S3

En S3:

1. `Create bucket`
2. nombre sugerido:
   - `recalcatti-agro-db-backups`
3. completar la pantalla así:

- `AWS Region`
  - elegir la misma región principal donde te resulte cómodo operar
  - si querés simplicidad, usar la misma región donde tenés Lightsail o una cercana

- `Bucket type`
  - elegir `General purpose`
  - no usar `Directory bucket`

- `Bucket name`
  - ejemplo: `recalcatti-agro-db-backups`
  - tiene que ser único globalmente en AWS
  - usar solo minúsculas, números y guiones

- `Object Ownership`
  - dejar `ACLs disabled (recommended)`
  - dejar `Bucket owner enforced`

- `Block Public Access settings for this bucket`
  - dejar activadas las 4 opciones
  - no desactivar nada
  - este bucket no debe ser público

- `Bucket Versioning`
  - para este caso, podés dejar `Disable`
  - si querés más seguridad ante borrados accidentales, podés usar `Enable`, pero aumenta storage y complejidad
  - mi recomendación para arrancar: `Disable`

- `Tags`
  - opcional
  - recomendación:
    - key: `project`
    - value: `company-ops-control`
  - opcionalmente:
    - key: `environment`
    - value: `production`

- `Default encryption`
  - elegir `Server-side encryption with Amazon S3 managed keys (SSE-S3)`
  - no hace falta `SSE-KMS` para este caso pequeño

- `Bucket Key`
  - elegir `Disable`
  - con `SSE-S3` no aporta valor en este caso

- `Advanced settings`
  - no habilitar `Object Lock`
  - no hace falta para este flujo

4. `Create bucket`

Elección recomendada resumida:

- `General purpose`
- `ACLs disabled`
- `Bucket owner enforced`
- `Block all public access = ON`
- `Versioning = Disable`
- `Default encryption = SSE-S3`
- `Bucket Key = Disable`
- `Object Lock = OFF`

Referencias oficiales:
- Crear bucket: https://docs.aws.amazon.com/AmazonS3/latest/user-guide/create-bucket.html
- Overview de general purpose buckets: https://docs.aws.amazon.com/console/s3/usings3bucket

#### Paso 2: Crear primero la policy IAM mínima

Antes de crear el usuario, conviene crear la policy específica que va a usar.

Objetivo:
- permitir listar el bucket,
- permitir subir backups,
- permitir leer backups si necesitás verificar o restaurar.

No queremos dar:
- `AdministratorAccess`
- `AmazonS3FullAccess`
- permisos sobre otros buckets

##### 2.1 Ir a IAM

1. En AWS, buscá `IAM`
2. Entrá al servicio `IAM`
3. En el menú izquierdo, abrí:
   - `Policies`

##### 2.2 Crear policy

1. Click en `Create policy`
2. Elegí la pestaña:
   - `JSON`
3. Pegá esta policy, reemplazando el nombre del bucket si usaste otro:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::recalcatti-agro-db-backups",
        "arn:aws:s3:::recalcatti-agro-db-backups/*"
      ]
    }
  ]
}
```

##### 2.3 Guardar la policy

1. Click en `Next`
2. `Policy name`
   - sugerido: `recalcatti-agro-backup-s3-policy`
3. `Description`
   - sugerido: `Permite listar, subir y leer backups de base en S3`
4. `Create policy`

Cuando termine, ya tenés el permiso mínimo preparado.

#### Paso 3: Crear el usuario IAM para backups

Ahora sí, crear el usuario técnico que va a usar esa policy.

Objetivo:
- usuario programático,
- sin acceso a consola,
- solo para `aws cli` en la VM.

##### 3.1 Ir a Users

1. En `IAM`
2. Menú izquierdo:
   - `Users`
3. Click en:
   - `Create user`

##### 3.2 Completar datos del usuario

En la pantalla de creación:

- `User name`
  - sugerido: `lightsail-backup-bot`

- `Provide user access to the AWS Management Console`
  - elegir `No`
  - este usuario no necesita entrar a la consola web

Después:
- `Next`

##### 3.3 Asignar permisos

En `Set permissions`, AWS muestra varias opciones:

- `Add user to group`
- `Copy permissions`
- `Attach policies directly`

Elegir:
- **`Attach policies directly`**

Razón:
- es un usuario técnico simple,
- no lo queremos en `Admins`,
- no queremos copiar permisos de otro usuario,
- y tampoco hace falta crear un grupo solo para esto.

Después:
1. en el buscador de policies, buscar:
   - `recalcatti-agro-backup-s3-policy`
2. marcar esa policy

Importante:
- no agregar `AdministratorAccess`
- no agregar `AmazonS3FullAccess`
- no usar el grupo `Admins`

`Set permissions boundary`:
- dejar vacío
- no hace falta para este caso

Después:
- `Next`

##### 3.4 Revisar y crear el usuario

Revisar que quede así:

- usuario: `lightsail-backup-bot`
- acceso a consola: `No`
- permisos: solo la policy custom del bucket

Después:
- `Create user`

#### Paso 4: Crear access key para ese usuario

Ahora necesitás las credenciales que va a usar la VM para subir backups.

##### 4.1 Entrar al usuario

1. Abrí el usuario recién creado:
   - `lightsail-backup-bot`
2. Ir a la pestaña:
   - `Security credentials`

##### 4.2 Crear access key

1. Bajá hasta la sección:
   - `Access keys`
2. Click en:
   - `Create access key`

AWS te va a pedir un caso de uso.

Elegir:
- `Application running on an AWS compute service`

Razón:
- la access key se va a usar desde la instancia Lightsail,
- o sea desde una workload corriendo dentro de AWS.

Si cambia el wording en la consola, usar la opción equivalente a:
- aplicación corriendo en infraestructura AWS,
- acceso programático desde un servidor en AWS.

Si AWS muestra un checkbox de confirmación/acknowledgement:
- marcarlo

Después:
- `Next`

##### 4.3 Description tag

Opcional, pero recomendable:

- `Description tag value`
  - sugerido: `lightsail-db-backups`

Después:
- `Create access key`

##### 4.4 Guardar credenciales

AWS te va a mostrar:

- `Access key ID`
- `Secret access key`

Guardalas en ese momento:
- copiándolas,
- o descargando el `.csv`

Importante:
- la `Secret access key` después no se vuelve a mostrar

#### Paso 5: Instalar AWS CLI en la VM

```bash
sudo apt update
sudo apt install -y awscli
aws --version
```

#### Paso 6: Configurar credenciales en la VM

```bash
aws configure
```

Completar:
- `AWS Access Key ID`
- `AWS Secret Access Key`
- `Default region name`
  - usar la región donde creaste el bucket o la región principal que estés usando
- `Default output format`
  - `json`

#### Paso 7: Probar subida manual

Script incluido en el repo:
- `scripts/backup_db_prod_to_s3.sh`

Prueba manual:

```bash
cd ~/company-ops-control
export POSTGRES_USER=opsuser
export POSTGRES_DB=opsdb
export BACKUP_S3_BUCKET=recalcatti-agro-db-backups
export BACKUP_S3_PREFIX=production
./scripts/backup_db_prod_to_s3.sh
```

Verificar:

```bash
aws s3 ls s3://recalcatti-agro-db-backups/production/
```

#### Paso 8: Automatizar con cron

Editar el crontab del usuario `ubuntu`:

```bash
crontab -e
```

Ejemplo para correr todos los días a las `03:10`:

```cron
10 3 * * * export POSTGRES_USER=opsuser POSTGRES_DB=opsdb BACKUP_S3_BUCKET=recalcatti-agro-db-backups BACKUP_S3_PREFIX=production && cd /home/ubuntu/company-ops-control && /bin/sh ./scripts/backup_db_prod_to_s3.sh >> /home/ubuntu/backup_db_prod.log 2>&1
```

Ver crontab actual:

```bash
crontab -l
```

#### Paso 9: Lifecycle rule en S3

En el bucket:

1. `Management`
2. `Lifecycle rules`
3. crear regla para el prefijo `production/`
4. expirar objetos viejos, por ejemplo a los `30 días`

Eso evita crecimiento indefinido del costo.

## 19. Paso 15: Actualizar la aplicación

Cuando quieras desplegar una nueva versión:

```bash
cd ~/company-ops-control
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Si el cambio solo afecta frontend o backend, preferir rebuild parcial en una VM de `1 GB`.

Validar después:
- login,
- dashboard,
- carga de gasto,
- carga de trabajo,
- cobro y distribución.

## 20. Seguridad mínima obligatoria

Antes de considerarlo productivo:

1. `DJANGO_DEBUG=0`
2. `SECRET_KEY` y passwords largas y únicas
3. `ALLOWED_HOSTS` restringido al dominio real
4. `CORS_ALLOWED_ORIGINS` restringido al frontend real
5. no publicar `5432`, `8000`, `3000`
6. usar solo `22`, `80`, `443`
7. snapshots automáticos activos
8. dump diario de Postgres
9. acceso SSH solo por clave
10. más adelante migrar login a `Cognito`
11. mantener Cloudflare en `DNS only` mientras Caddy emite/renueva certificados

## 21. Estado recomendado del proyecto antes del deploy

Para hacer este deploy prolijo, el repo debería tener además:

- monitoreo básico de contenedores

El repo ya tiene:
- `docker-compose.prod.yml`
- `Caddyfile`
- `WhiteNoise` para estáticos Django
- `gunicorn` para backend productivo
- `scripts/backup_db_prod.sh`
- `scripts/backup_db_prod_to_s3.sh`

Todavía conviene agregar:
- alertas sobre fallos del cron de backup
- endurecimiento adicional de auth cuando se migre a Cognito

## 22. Siguiente iteración recomendada

Antes de ejecutar el deploy real en Lightsail, conviene cerrar estos puntos en el repo:

1. probar restore de backup,
2. configurar cron + S3 para backups automáticos,
3. definir estrategia final de secretos,
4. migrar auth a Cognito cuando el deploy base esté estable.
