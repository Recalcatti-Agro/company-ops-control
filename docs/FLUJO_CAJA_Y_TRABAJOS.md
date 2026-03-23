# Flujo Operativo: Trabajos, Cobros, Distribución, Caja y Capital

## 1. Objetivo

Definir cómo se registra un trabajo, cómo se factura/cobra, cómo se distribuye y cómo eso impacta caja y participación.

## 2. Entidades clave

- `Job`: trabajo operativo (puede durar más de un día).
- `JobCollection`: facturación/cobro de uno o más trabajos.
- `JobDistribution`: distribución de un cobro por inversor y tipo.
- `Expense`: gasto real (pagado por inversor o por caja).
- `PaymentObligation`: cuentas a pagar y cuotas de compras.
- `CashMovement`: libro de caja (ingresos/egresos, ARS/USD).
- `CapitalContribution`: eventos de capital para cap table.

## 3. Flujo de trabajos

### Paso A. Crear trabajo

1. Cargar trabajo en estado `PENDING`.
2. Cuando se ejecuta, marcar `DONE`.

### Paso B. Facturar trabajos

1. Desde `Trabajos`, usar `Facturar trabajos`.
2. Seleccionar trabajos del mismo cliente (regla UI).
3. Guardar importe facturado (ARS/USD con TC por fecha).
4. Se crea un `JobCollection` en estado `BILLED`.

### Paso C. Pasar factura a cobrada

1. En `Distribuciones`, botón `Cobrar` sobre un cobro facturado.
2. Elegir fecha de cobro, moneda original e importe cobrado.
3. Si es ARS, se guarda TC y cálculo USD equivalente.
4. El sistema calcula `tax_loss_usd` vs facturado (diferencia/impuestos).
5. El `JobCollection` queda en estado `COLLECTED`.

### Paso D. Distribuir cobro

1. Solo para cobros `COLLECTED`.
2. Abrir `Distribuir`.
3. Definir `%` para equipo de campo.
4. Elegir qué inversores trabajaron en campo.
5. El resto se reparte entre accionistas por `% empresa` a la fecha de referencia del trabajo.
6. Para cada inversor, indicar cuánto retira (default 0).
7. Lo no retirado queda como reinversión a caja.

## 4. Resultado al aplicar distribución

Cuando se aplica la distribución (`apply-distribution`):

1. Se reemplazan las distribuciones existentes del cobro.
2. Se registran movimientos de caja por reinversión efectiva por inversor.
3. Se generan eventos de capital (`REINVESTMENT`) vinculados a esos movimientos.
4. El histórico de `JobDistribution` permite ver separada la parte:
- `work_amount_usd` (por trabajo de campo)
- `shareholder_amount_usd` (por participación accionaria)

## 5. Flujo de compras/cuotas/gastos

1. `Purchase` representa la compra total (ej: trailer).
2. Si tiene cuotas, el sistema genera obligaciones (`PaymentObligation`) por cuota.
3. Cada cuota puede pagarse con varios `Expense` (ej: dos socios pagan partes distintas).
4. La cuota cambia automáticamente de estado `PENDING -> PARTIAL -> PAID` según pagos acumulados.
5. Si un gasto se paga desde caja (`paid_by=CASH`), genera egreso en `CashMovement`.

## 6. Cap table (participación)

Por inversor:

`capital = gastos_pagados_por_inversor + aportes_directos + reinversiones - rescates`

Porcentaje empresa:

`% = capital_inversor / capital_total`

Notas:
- Retiro de utilidad no suma capital.
- Reinvertir sí suma capital.

## 7. Caja

Caja se registra en dos monedas (`ARS`, `USD`) y se informa también equivalente USD en dashboard.

Categorías de caja más relevantes:
- `PROFIT_REINVESTMENT`
- `CAPITAL_CONTRIBUTION`
- `CAPITAL_RESCUE`
- `INVESTOR_WITHDRAWAL`
- `EXPENSE`
- `PURCHASE_PAYMENT`
- `ADJUSTMENT`

## 8. Pantallas operativas recomendadas

1. `Trabajos`: alta, edición, marcar realizado, facturar.
2. `Distribuciones`: cobrar, distribuir, editar/eliminar cobros.
3. `Gastos` / `Gasto rápido`: egresos diarios.
4. `Compras` + `Cuentas a pagar`: control de inversiones y cuotas.
5. `Caja`: ingresos/egresos y balance por moneda.
6. `Dashboard`: KPIs operativos y cap table.
