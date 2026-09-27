# Diseño de API — Recalcatti v2

Sigue de [MODELO_DE_DATOS.md](MODELO_DE_DATOS.md) y [PERMISOS_USUARIOS.md](PERMISOS_USUARIOS.md).
Un endpoint por recurso, sin acciones raras — y donde hace falta una acción custom (cobrar,
repartir, marcar hecho) queda explícita, como ya funciona bien hoy.

Convención de permisos: **AA** = solo `ADMIN`. **A+I** = `ADMIN` e `INVESTOR`. **A+I·own**
= ambos, pero `INVESTOR` solo sobre lo que él mismo creó.

## 0. Ajuste chico al modelo de datos

Para poder aplicar "own" en permisos, `Job` y `Expense` necesitan un campo
`created_by` (FK a `User`, se completa solo al crear). No estaba en
[MODELO_DE_DATOS.md](MODELO_DE_DATOS.md) — lo agrego ahí de paso.

## 1. Auth

| Método | Path | Rol | Nota |
|---|---|---|---|
| POST | `/auth/login/` | público | Igual que hoy: usuario/contraseña → token + `investor_id` si `user.investor` existe |
| POST | `/auth/logout/` | A+I | Invalida el token |

### 1.1 Users (faltaba en el diseño original, se agregó al construir)

| Método | Path | Rol | Nota |
|---|---|---|---|
| GET/POST | `/users/` | AA | Alta de usuarios (`username`, `password`, `role`) |
| PATCH | `/users/{id}/` | AA | |
| POST | `/users/{id}/link-investor/` | AA | `{investor_id}` — vincula/desvincula el `Investor.user` de ese usuario, en vez de exponer un campo `investor` editable directo en `User` |

## 2. Investors / cap table

| Método | Path | Rol | Nota |
|---|---|---|---|
| GET | `/investors/` | A+I | Lista de inversores activos |
| POST/PATCH/DELETE | `/investors/{id}/` | AA | |
| GET | `/investors/cap-table/?date=` | A+I | % de todos, a una fecha (decisión §4 de permisos: visible para cualquier inversor) |
| GET | `/investors/{id}/capital-events/` | AA cualquiera · INVESTOR solo si `id` es el suyo | Detalle de aportes/rescates/repartos |
| POST | `/capital-events/` | AA | Alta manual de `CONTRIBUTION`/`RESCUE`. `JOB_DISTRIBUTION` no se crea acá directo, sale de `apply-distribution` (§6) |

## 3. Clients

| Método | Path | Rol | Nota |
|---|---|---|---|
| GET | `/clients/` | A+I | |
| POST | `/clients/` | A+I | Investor lo necesita para crear cliente inline al cargar un trabajo rápido, igual que hoy |
| PATCH/DELETE | `/clients/{id}/` | AA | |
| GET | `/clients/{id}/detail/` | A+I | Ficha completa: ver abajo |

**`GET /clients/{id}/detail/`** — todo lo que necesita la pantalla de un cliente en una
sola llamada, sin que el frontend tenga que pedir cuatro endpoints y cruzarlos:

```
{
  client: { name, tax_id, contact_name, phone, email, address, notes },
  debt_usd, debt_ars,              // suma de saldos abiertos (§2 de MODELO_DE_DATOS)
  jobs: [ { date, location, work_type, hectares, status } ],
  invoices: [ { date, amount_usd, status, balance_usd } ],
  payments: [ { date, amount_usd, invoice_id } ],
}
```

`jobs`, `invoices` y `payments` ordenados por fecha descendente. No hay cálculo nuevo acá
— son los mismos campos derivados que ya expone `/jobs/`, `/invoices/` y `/payments/`,
solo que pre-filtrados por cliente para no tener que traer todo y filtrar en el
frontend.

## 4. Accounts

| Método | Path | Rol | Nota |
|---|---|---|---|
| GET | `/accounts/` | A+I | Devuelve `Caja ARS`/`Caja USD` con saldo **calculado** (§2 de MODELO_DE_DATOS), no hay alta/edición — son fijas |
| GET | `/transfers/` | A+I | |
| POST/PATCH/DELETE | `/transfers/{id}/` | AA | Mover plata entre `Caja ARS`/`Caja USD` (ej. comprar USD) — no afecta capital ni gastos |

## 5. Jobs

| Método | Path | Rol | Nota |
|---|---|---|---|
| GET | `/jobs/` | A+I | Lista completa (para pipeline/tabla), no solo los propios |
| GET | `/jobs/{id}/detail/` | A+I | Resumen facturado/cobrado/pendiente + timeline |
| POST | `/jobs/` | A+I | Carga rápida o completa; `created_by=request.user` |
| PATCH/DELETE | `/jobs/{id}/` | A+I·own | |
| POST | `/jobs/{id}/mark-done/` | A+I·own | |
| POST | `/jobs/{id}/mark-pending/` | A+I·own | Solo si no tiene factura/cobro asociado, igual que hoy |

## 6. Invoices / Payments / distribución

| Método | Path | Rol | Nota |
|---|---|---|---|
| GET | `/invoices/` | A+I | Incluye `status` derivado (`OPEN`/`SETTLED`) |
| POST | `/invoices/` | AA | Facturar uno o más `jobs` |
| PATCH/DELETE | `/invoices/{id}/` | AA | |
| GET | `/invoices/{id}/payments/` | A+I | |
| POST | `/payments/` | AA | Registrar cobro total/parcial contra una factura |
| PATCH/DELETE | `/payments/{id}/` | AA | |
| GET | `/payments/{id}/distribution-preview/` | AA | Simula el reparto (bucket campo + bucket accionista) sin guardar nada |
| POST | `/payments/{id}/apply-distribution/` | AA | Crea los `CapitalEvent(kind=JOB_DISTRIBUTION)`. Reemplaza los de un `apply` anterior sobre el mismo `payment` si se repite |

## 7. Purchases / Bills / Expenses

| Método | Path | Rol | Nota |
|---|---|---|---|
| GET | `/purchases/` | A+I | |
| POST/PATCH/DELETE | `/purchases/{id}/` | AA | Genera/sincroniza `Bill` de cuotas, igual que hoy |
| GET | `/bills/` | A+I | Incluye `status` derivado |
| POST/PATCH/DELETE | `/bills/{id}/` | AA | Solo aplica a `Bill` manuales (`purchase=null`) |
| GET | `/expenses/` | A+I | |
| POST | `/expenses/` | A+I | Carga rápida o completa; `created_by=request.user` |
| PATCH/DELETE | `/expenses/{id}/` | A+I·own | |

## 8. Auxiliares

| Método | Path | Rol | Nota |
|---|---|---|---|
| GET | `/fx/ars-usd/?date=` | A+I | Igual que hoy: BCRA con fallback |
| GET/POST | `/exchange-rates/` | AA | Auditoría/fallback manual, no hace falta que lo vea INVESTOR |
| GET | `/dashboard/summary/` | A+I | Misma respuesta para los dos roles — lo que cambia es qué acciones puede disparar cada uno desde la pantalla, no los datos que ve |

## 9. Lo que no lleva endpoint propio

- Saldo de `Account`, capital de `Investor`, estado de `Invoice`/`Bill`: son campos
  calculados que viajan embebidos en las respuestas de arriba (`/accounts/`,
  `/investors/cap-table/`, `/invoices/`, `/bills/`). No hay un endpoint "calcular saldo"
  aparte.

## 10. Cómo seguimos

1. ~~Confirmás el criterio "own"~~ → confirmado: `INVESTOR` puede editar/borrar los
   trabajos y gastos que él mismo cargó.
2. API cerrada. Sigue: pantallas — qué pantallas existen, cuáles ve cada rol, y cuál es
   mobile-first vs. desktop.
