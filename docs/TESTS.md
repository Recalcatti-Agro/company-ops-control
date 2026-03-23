# Tests

Tests unitarios e de integración para la lógica de negocio del backend.

## Cómo correr los tests

### Localmente (sin Docker)

Requiere tener el venv con Django instalado:

```bash
cd backend
python manage.py test core.tests --settings=server_config.settings_test
```

Con salida detallada:

```bash
python manage.py test core.tests --settings=server_config.settings_test --verbosity=2
```

### Desde Docker

```bash
docker compose exec web python manage.py test core.tests --settings=server_config.settings_test
```

## Configuración de test

`server_config/settings_test.py` extiende el settings principal y reemplaza la base de datos por SQLite en memoria. Esto permite correr los tests sin necesitar una instancia de PostgreSQL.

No requiere variables de entorno ni conexión a servicios externos. Los tests de tipo de cambio no se incluyen porque `fx_service.py` llama a la API del BCRA; esa lógica se prueba manualmente o en staging.

## Archivos

- `backend/core/tests.py` — suite de tests
- `backend/server_config/settings_test.py` — settings con SQLite para tests

## Cobertura

### `_alloc_by_weights` (8 tests)

Algoritmo de distribución de montos por pesos con corrección de centavos (método de mayor resto). Garantiza que el total distribuido siempre sea exactamente igual al total de entrada.

| Test | Qué verifica |
|---|---|
| `test_equal_weights_exact_division` | 3 ítems iguales, división exacta |
| `test_remainder_distributed_by_largest_remainder` | 10.00 / 3 = 3.34 + 3.33 + 3.33, suma exacta |
| `test_total_preserved_with_many_items` | 100.00 / 7 ítems, sin pérdida de centavos |
| `test_unequal_weights_60_40` | Pesos distintos, resultado proporcional exacto |
| `test_single_item_gets_whole_total` | Un solo ítem recibe todo |
| `test_empty_returns_empty_dict` | Lista vacía devuelve dict vacío |
| `test_all_zero_weights_return_zero` | Todos con peso cero reciben cero |
| `test_zero_total` | Total cero distribuye cero |

### `add_months` (6 tests)

Suma meses a una fecha con clamp al último día del mes destino (evita fechas inválidas como 31 de febrero).

| Test | Qué verifica |
|---|---|
| `test_simple_addition` | Suma básica de un mes |
| `test_cross_year_boundary` | Diciembre + 1 mes → enero del año siguiente |
| `test_month_end_clamp_leap_year` | 31 ene + 1 mes → 29 feb (año bisiesto) |
| `test_month_end_clamp_non_leap_year` | 31 ene + 1 mes → 28 feb (año no bisiesto) |
| `test_multiple_months` | Suma de 6 meses |
| `test_zero_months_is_identity` | Sumar 0 meses devuelve la misma fecha |

### `_investor_capital_snapshot` (9 tests)

Calcula el capital de cada inversor activo a una fecha dada y su porcentaje de participación en la empresa. El capital se compone de gastos pagados por el inversor + aportes directos + reinversiones - rescates.

| Test | Qué verifica |
|---|---|
| `test_proportional_percentages` | 60/40 en aportes → 60%/40% de participación |
| `test_expense_counts_as_capital` | Gasto pagado por inversor suma a su capital |
| `test_reinvestment_adds_to_capital` | Reinversión suma al capital |
| `test_withdrawal_reduces_capital` | Rescate resta del capital |
| `test_withdrawal_floors_at_zero` | Rescate mayor al capital no genera capital negativo |
| `test_equal_distribution_when_total_capital_is_zero` | Sin capital, todos reciben participación igual |
| `test_date_filter_excludes_future_contributions` | Aportes posteriores a la fecha de corte no cuentan |
| `test_inactive_investors_excluded` | Inversores inactivos no aparecen en el snapshot |
| `test_no_investors_returns_empty` | Sin inversores devuelve lista vacía |

### `_build_distribution_plan` (8 tests)

Genera el plan de distribución de un cobro entre equipo de campo y accionistas. El equipo de campo recibe un porcentaje fijo dividido en partes iguales; los accionistas reciben el resto según su participación en el cap table a la fecha del trabajo.

| Test | Qué verifica |
|---|---|
| `test_basic_math_field_team_plus_shareholders` | Ana (worker + 60% cap): $20 campo + $48 accionista = $68; Bruno (40%): $32 |
| `test_field_plus_shareholder_totals_equal_target` | Con montos y porcentajes irregulares, la suma total es exactamente el cobro |
| `test_zero_field_team_all_goes_to_shareholders` | 0% campo → todo a accionistas, sin montos de campo |
| `test_uses_collected_amount_usd_over_amount_usd` | Usa `collected_amount_usd` cuando está presente |
| `test_raises_if_not_collected_status` | Falla si el cobro no está en estado COLLECTED |
| `test_raises_if_percentage_over_100` | Falla si el porcentaje de campo supera 100 |
| `test_raises_if_field_team_nonzero_with_no_workers` | Falla si hay porcentaje de campo pero ningún trabajador |
| `test_inactive_worker_id_is_ignored` | IDs de inversores inactivos son filtrados silenciosamente |

### `recompute_job_status` (6 tests)

Recalcula el estado de un trabajo según el estado de sus cobros asociados. La precedencia es: COBRADO > FACTURADO > REALIZADO.

| Test | Qué verifica |
|---|---|
| `test_no_collections_keeps_done` | Sin cobros, trabajo DONE no cambia |
| `test_billed_collection_sets_invoiced` | Cobro en BILLED → trabajo pasa a INVOICED |
| `test_collected_collection_sets_collected` | Cobro en COLLECTED → trabajo pasa a COLLECTED |
| `test_collected_takes_precedence_over_billed` | Si hay un COLLECTED y un BILLED, gana COLLECTED |
| `test_cancelled_job_is_not_touched` | Trabajos CANCELLED nunca se modifican |
| `test_invoiced_job_reverts_to_done_when_no_collections` | INVOICED sin cobros vuelve a DONE |

### `sync_payment_obligation_status` (9 tests)

Recalcula el estado de una obligación de pago (PENDING / PARTIAL / PAID) sumando todos los gastos asociados. Soporta ARS y USD, y tolera una diferencia de hasta $0.01 para marcar como pagada (epsilon para redondeos).

| Test | Qué verifica |
|---|---|
| `test_full_payment_sets_paid` | Pago exacto → PAID |
| `test_partial_payment_sets_partial` | Pago parcial → PARTIAL |
| `test_no_payment_stays_pending` | Sin pagos → PENDING |
| `test_multiple_expenses_summed` | Dos gastos suman para cubrir el total → PAID |
| `test_within_epsilon_counts_as_paid` | $99.99 sobre $100.00 → PAID (dentro del epsilon) |
| `test_ars_obligation_paid_in_ars` | Obligación ARS pagada en ARS → PAID |
| `test_ars_obligation_partial_in_ars` | Obligación ARS con pago parcial en ARS → PARTIAL |
| `test_nonexistent_id_does_nothing` | ID inexistente no lanza excepción |
| `test_cancelled_obligation_is_not_modified` | Obligaciones CANCELLED no se tocan |

### `sync_purchase_installments` (8 tests)

Genera o sincroniza las cuotas automáticas de una compra. Distribuye el monto total en N cuotas, asignando los centavos sobrantes a las primeras cuotas. Soporta compras en ARS con conversión a USD estimado vía tipo de cambio.

| Test | Qué verifica |
|---|---|
| `test_generates_correct_number_of_installments` | Genera exactamente N cuotas |
| `test_installment_amounts_sum_to_total` | La suma de cuotas es exactamente el total de la compra |
| `test_remainder_goes_to_first_installments` | 100.00 / 3 → primera cuota recibe el centavo extra ($33.34) |
| `test_due_dates_increment_monthly` | Fechas de vencimiento usan `add_months`, con clamp correcto en fin de mes |
| `test_concept_includes_installment_fraction` | El concepto incluye "1/3", "3/3", etc. |
| `test_ars_purchase_estimates_usd_via_fx` | Cuotas ARS calculan `estimated_amount_usd` dividiendo por el TC |
| `test_zero_installments_removes_existing` | Cambiar a 0 cuotas elimina las existentes |
| `test_increasing_installment_count` | Agregar cuotas actualiza `installment_total` en todas |
| `test_decreasing_installment_count` | Quitar cuotas (sin pagos) actualiza la numeración |
