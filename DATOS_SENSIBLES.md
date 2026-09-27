# Datos sensibles — qué va al repo y qué no

El repo `Recalcatti-Agro/company-ops-control` es **público**. Nada de lo que se
commitea puede tener credenciales ni datos reales del negocio (nombres de
clientes o inversores, montos, cap table, citas del chat).

## Reglas

- **Credenciales:** solo en `.env` / `backend/.env` / `frontend/.env.local`
  (ignorados por git). En el repo van únicamente los `*.env.example` con valores
  de ejemplo (`change-me`, `tudominio.com`, `localhost`).
- **Infraestructura:** IPs, bucket de S3, cuenta de AWS y dominios reales no se
  escriben en el código ni en los docs. Los scripts los leen de variables de
  entorno (ej. `BACKUP_S3_BUCKET` en `scripts/backup_db_prod_to_s3.sh`) y los docs
  usan placeholders (`TU_IP`, `control.tudominio.com`).
- **Datos del negocio:** viven en `privado/` (fuera de git y de las imágenes
  Docker). Los comandos `migrate_v1` y `cargar_pendientes_sep2026` los cargan con
  `core/private_data.py`; el código no tiene nombres ni montos reales.
- **Bases y backups:** `*.sqlite3`, dumps `.sql` y backups nunca van al repo.
- **Mockups y ejemplos:** usan datos inventados (clientes, personas, montos). El
  usuario de los mockups es genérico ("Admin").

## Revisión del 27/09/2026 (rama `v2`)

Se revisó la rama completa y el historial de todas las ramas buscando datos
expuestos.

**Qué se revisó**

- Patrones de secretos: claves de AWS, `SECRET_KEY`, contraseñas, claves
  privadas, tokens (GitHub, Slack, API), DSN de base de datos con contraseña.
- Emails, IPs, teléfonos, CUIT, IDs de cuenta AWS, ARNs, buckets y dominios.
- Nombres de personas, clientes y lugares de `privado/` cruzados contra todos los
  archivos de la rama.
- Historial de `main` y `v2`: archivos `.env`, `.sqlite3`, `.sql`, dumps, `.pem`,
  `privado/`.

**Resultado:** sin credenciales ni datos reales expuestos. `v2` tiene un solo
commit, así que no arrastra historial viejo.

**Cambios hechos** (nombres reales menores, sin montos):

| Archivo | Cambio |
|---|---|
| `mockups/*.dc.html`, `mockups/recalcatti-v2-mockups.html` | El usuario del mockup pasó de nombre real a "Admin" (avatar "AD") |
| `backend/core/management/commands/migrate_v1.py` | El docstring de `_migrate_purchases` ya no nombra compras reales; quedó con ejemplos genéricos |

## Cómo repetir la revisión

Antes de pushear algo grande, desde la raíz del repo:

```bash
git grep -nIE '(AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|EC|PRIVATE)|ghp_|sk-[A-Za-z0-9]{20,}|postgres(ql)?://[^ ]*:[^ ]*@)' -- ':!*package-lock.json'
```

```bash
git log --all --name-only --format= | sort -u | grep -iE '(^|/)\.env$|sqlite3|\.sql$|dump|\.pem$|privado/'
```

Y verificar que ningún nombre real de `privado/` aparezca en los archivos
versionados.
