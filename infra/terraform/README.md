# Terraform

Terraform mínimo para reproducir la base de la infraestructura productiva actual.

## Qué crea

- 1 instancia `AWS Lightsail`
- 1 IP estática asociada a esa instancia
- reglas públicas `22`, `80`, `443`
- 1 bucket S3 privado para backups
- lifecycle rule para borrar backups viejos
- 1 policy IAM mínima para el bucket
- 1 usuario IAM para subir backups
- presupuesto mensual opcional (`AWS Budget`)

## Qué no crea

Esto queda fuera del scope de esta primera versión:

- DNS en Cloudflare
- `.env` productivo
- deploy de la app dentro de la VM
- restore de base
- snapshots automáticos de Lightsail
- certificados TLS
- acceso key IAM por defecto (`create_backup_access_key = false`)

## Prerrequisitos

1. AWS CLI autenticado o credenciales válidas para Terraform
2. Terraform instalado localmente
3. Un key pair de Lightsail ya creado en la región elegida

## Uso

### 1. Crear variables locales

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
```

Editar `terraform.tfvars`:
- `lightsail_key_pair_name`
- `budget_alert_email`
- cualquier nombre que quieras ajustar

### 2. Inicializar

```bash
terraform init
```

### 3. Ver plan

```bash
terraform plan
```

### 4. Aplicar

```bash
terraform apply
```

### 5. Ver outputs

```bash
terraform output
```

Para outputs sensibles:

```bash
terraform output -raw backup_access_key_id
terraform output -raw backup_secret_access_key
```

Solo si `create_backup_access_key = true`.

## Flujo después del apply

Una vez creada la infraestructura:

1. entrar por SSH a la instancia
2. clonar el repo
3. crear `.env`
4. instalar Docker
5. levantar:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

6. configurar backup a S3 con el bucket/user creados por Terraform

## Destrucción

```bash
terraform destroy
```

No correr esto sobre infraestructura con datos productivos sin backup previo.

## Notas de diseño

- Se dejó `create_backup_access_key = false` por defecto para no generar secretos automáticamente si no hace falta.
- El bucket de backups se cifra con `SSE-S3`.
- El frontend y el deploy de la app siguen fuera de Terraform a propósito: separar infraestructura de runtime simplifica la primera versión.
