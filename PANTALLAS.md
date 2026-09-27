# Pantallas — Recalcatti v2

Sigue de [API.md](API.md). Rutas y quién ve qué, no todavía diseño visual. Nombres
renombrados para que coincidan con las entidades nuevas (el proyecto actual ya tenía
marcado que `/reinvestments` debería llamarse `/cash`, por ejemplo — acá se corrige de
entrada).

Convención: **A+I** = accede ambos roles (`INVESTOR` puede ver todo, pero solo actuar
sobre lo que el rol le permite en [API.md](API.md)). **AA** = solo `ADMIN`.

| Ruta | Rol | Plataforma | Qué hace |
|---|---|---|---|
| `/login` | público | ambas | Login |
| `/` | A+I | ambas | Redirige a `/dashboard` (desktop) o `/home` (mobile) |
| `/dashboard` | A+I | desktop | Panel financiero completo: caja, capital, pipeline, vencimientos, alertas, cap table, evolución mensual. Para `INVESTOR` es de solo lectura — mismos datos, sin botones de acción |
| `/home` | A+I | mobile | Síntesis + accesos rápidos a carga de trabajo/gasto |
| `/jobs` | A+I | desktop | Listado y ABM de trabajos, filtros, agrupado por mes. `INVESTOR` edita/borra solo los que cargó él (`created_by`) |
| `/jobs/[id]` | A+I | ambas | Detalle: facturado/cobrado/pendiente, reparto aplicado, timeline |
| `/jobs/quick` | A+I | mobile | Carga rápida de trabajo, con alta de cliente inline |
| `/invoices` | A+I lectura · AA acciones | desktop | Facturas y cobros: facturar trabajos, registrar cobro, previsualizar y aplicar reparto. `INVESTOR` ve todo pero sin botones de facturar/cobrar/repartir |
| `/clients` | A+I | desktop | Listado y ABM de clientes |
| `/clients/[id]` | A+I | ambas | **Ficha de cliente** (nueva): datos de contacto, deuda actual, trabajos realizados y dónde, facturas, historial de pagos — todo desde `GET /clients/{id}/detail/` |
| `/expenses` | A+I | desktop | Listado y ABM de gastos. `INVESTOR` edita/borra solo los propios |
| `/expenses/quick` | A+I | mobile | Carga rápida de gasto, siempre en ARS, con equivalente USD |
| `/purchases` | A+I lectura · AA ABM | desktop | Compras/inversiones grandes y sus cuotas |
| `/bills` | A+I lectura | desktop | Cuentas a pagar: cuotas de compra + obligaciones manuales, por vencimiento |
| `/cash` | A+I lectura · AA aportes/rescates | desktop | Saldos por cuenta (`Caja ARS`/`Caja USD`) y el historial de `CapitalEvent` |
| `/investors` | A+I | desktop | Cap table completo (visible para cualquier inversor, decisión ya tomada). Detalle de `CapitalEvent` por inversor: `ADMIN` ve el de cualquiera, `INVESTOR` solo el propio |
| `/users` | AA | desktop | Alta de usuarios, asignación de rol y de `Investor` asociado |
| `/exchange-rates` | AA | desktop | Auditoría/fallback manual de tipo de cambio |

## Renombres respecto al proyecto actual

| Antes | Ahora | Por qué |
|---|---|---|
| `/works` | `/jobs` | consistente con la entidad `Job` |
| `/work-participations` | `/invoices` | ya no mezcla factura+cobro+reparto bajo un nombre confuso |
| `/reinvestments` | `/cash` | el proyecto actual ya tenía esto marcado como deuda pendiente |
| `/investments` | `/purchases` | consistente con `Purchase` |
| `/commitments` | `/bills` | consistente con `Bill` |
| `/conversions` | `/exchange-rates` | más descriptivo |

## Pantalla nueva

`/clients/[id]` no existía en el proyecto actual — es la que pediste. No hace falta
ninguna entidad nueva para armarla, es 100% lectura de datos que ya modelamos
(`Client` + su `Invoice`/`Payment`/`Job` asociados vía el endpoint de detalle).

## Cómo seguimos

Con esto, la parte de diseño (modelo de datos, permisos, API, pantallas) está completa.
Lo que sigue es alguna de estas dos cosas:

1. **Wireframes/mockups** de las pantallas más importantes antes de programar, para
   validar layout antes de escribir código.
2. **Arrancar directo a construir** (backend primero: modelos + API; frontend después),
   ya con todo lo anterior como referencia.
