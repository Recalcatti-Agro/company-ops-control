# Modelo de datos — Recalcatti v2 (Modelo B)

Sigue de [README.md](README.md), que ya definió el enfoque: entidades simples y
estándar, una sola fuente de verdad por movimiento de plata, nada de tablas espejo para
sincronizar a mano.

Esto cubre las entidades que faltaban: trabajos, clientes, compras/cuotas, gastos y
aportes de capital directos.

**Regla de negocio (ver README §9):** en el reparto de un cobro, los únicos destinatarios
posibles son inversores de la empresa — tanto la parte "por haber trabajado" como la parte
"por participación accionaria" van siempre a un `Investor`, y siempre se reinvierten. No
existe una categoría separada de "equipo de campo" con personas no-inversoras: si un día
hace falta ayuda extra de alguien que no es socio, eso se registra después como un
`Expense` común, sin relación con el reparto.

## 1. Entidades

### `Investor`
Socio o accionista. Tiene capital y aparece en el cap table. Es también el único tipo de
destinatario posible en un reparto de cobro — no existe una entidad separada para "equipo
de campo": los que trabajaron un día determinado son, siempre, algunos de los inversores.

| Campo | Nota |
|---|---|
| `name` | |
| `active` | para sacarlo del cap table sin borrar historia |

### `Client`
A diferencia de hoy, `Job` referencia un `Client` real (FK), no texto suelto. Evita el
problema actual de que renombrar un cliente no actualiza los trabajos viejos. Se amplía
para poder tener una ficha completa por cliente (ver [API.md](API.md) §3 para el endpoint
de detalle).

| Campo | Nota |
|---|---|
| `name` | |
| `active` | |
| `tax_id` | CUIT, opcional |
| `contact_name` | persona de contacto, opcional |
| `phone`, `email`, `address` | opcionales |
| `notes` | |

Todo lo de "cuánto debe" y "cuándo pagó" **no se guarda acá** — se calcula a partir de sus
`Invoice`/`Payment` (ver §2 y el endpoint de detalle), igual que el resto de los saldos del
modelo.

### `Account`
Representa un pozo de caja. Hoy solo necesitamos dos, pero queda abierto a más (banco,
billetera) sin cambiar el modelo.

| Campo | Nota |
|---|---|
| `name` | ej. "Caja ARS", "Caja USD" |
| `currency` | ARS o USD |

El saldo de una cuenta **no se guarda**, se calcula sumando todos los movimientos que la
referencian (ver sección 3). Así no puede desincronizarse.

### `Transfer` (movimiento entre cuentas)
Faltaba en el diseño original — apareció migrando datos reales: convertir ARS a USD (o
viceversa) es un movimiento real de caja que no es gasto, no es capital y no tiene
inversor. Sin esta entidad, ese movimiento no tenía dónde vivir.

| Campo | Nota |
|---|---|
| `date` | |
| `from_account`, `to_account` | FK a `Account`, tienen que ser distintas |
| `amount_from`, `amount_to` | separados porque puede haber conversión de moneda de por medio |
| `notes` | |

Afecta el saldo de ambas cuentas (`from_account` −=, `to_account` +=) y de nada más.

### `Job` (trabajo de campo)
Igual que hoy, salvo `client` como FK.

| Campo | Nota |
|---|---|
| `date`, `end_date` | |
| `client` | FK a `Client` |
| `location` | texto libre — campo/predio donde se hizo, para responder "dónde se hicieron" trabajos por cliente. Si con el tiempo se repiten siempre los mismos 2-3 lugares por cliente, se puede convertir en catálogo (`ClientLocation`) más adelante; por ahora texto libre alcanza |
| `hectares`, `work_type`, `product`, `notes` | `work_type`: lista fija (Pulverización / Siembra / Fertilización / Otro); `product`: semilla o producto aplicado |
| `status` | `PENDING` / `DONE` / `INVOICED` / `COLLECTED` / `CANCELLED` — derivado, igual que hoy |
| `created_by` | FK a `User`, se completa solo al crear — sirve para permisos (ver [API.md](API.md)) |

### `Invoice` (factura a cliente)
Reemplaza al `JobCollection` raíz de hoy. Un solo rol: representa lo facturado a un
cliente por uno o más trabajos.

| Campo | Nota |
|---|---|
| `client` | FK a `Client` — antes esto solo se inferían de los `jobs`; ahora queda explícito para poder listar todo lo de un cliente sin recorrer el M2M |
| `jobs` | M2M a `Job` — validación: todos deben tener `job.client == invoice.client` |
| `date` | |
| `amount_original`, `currency`, `fx_ars_usd`, `amount_usd` | moneda original + equivalente, como hoy |
| `status` | `OPEN` / `SETTLED` — **derivado**, comparando en la **moneda original** (no en USD): `SETTLED` cuando `amount_original − suma(Payment.amount_original de la misma moneda)` cae dentro de una tolerancia chica. Comparar en USD fallaba en la práctica: una factura 100% cobrada en ARS podía quedar con un "saldo" de un par de dólares solo porque cada cobro parcial usa el tipo de cambio de su propio día. |

### `Payment` (cobro, total o parcial)
| Campo | Nota |
|---|---|
| `invoice` | FK |
| `date` | |
| `amount_original`, `currency`, `fx_ars_usd`, `amount_usd` | |
| `tax_loss_usd` | diferencia al cerrar saldo, igual que hoy |

Al crearse, el `Payment` es un movimiento de caja **de entrada** contra el `Account` que
corresponda a su moneda (categoría "cobro trabajo").

### `CapitalEvent` (todo lo que cambia el capital de un inversor)
Como el reparto de un cobro **siempre** reinvierte y **nunca** toca caja (regla del README
§9), no hace falta una tabla aparte tipo `SettlementLine` para eso — es exactamente lo
mismo que un aporte, solo que con otro origen. Una sola entidad para las tres cosas:

| Campo | Nota |
|---|---|
| `date` | |
| `investor` | FK |
| `kind` | `CONTRIBUTION` (aporte directo) / `RESCUE` (rescate) / `JOB_DISTRIBUTION` (parte de un cobro repartido) |
| `amount_original`, `currency`, `fx_ars_usd`, `amount_usd` | |
| `account` | FK a `Account`, **solo si `kind` es `CONTRIBUTION` o `RESCUE`** (esos sí mueven caja: aporte entra, rescate sale) |
| `payment` | FK a `Payment`, **solo si `kind=JOB_DISTRIBUTION`** (de qué cobro viene) |
| `work_amount_usd`, `shareholder_amount_usd` | opcionales, **solo si `kind=JOB_DISTRIBUTION`** — para poder mostrarle a cada inversor cuánto le tocó por haber trabajado y cuánto por su % accionario. Su suma da `amount_usd`. |

Regla fija por `kind`, sin campos de elección: `CONTRIBUTION`/`RESCUE` mueven caja y
capital; `JOB_DISTRIBUTION` mueve solo capital, nunca caja.

### `Purchase` (compra/inversión grande)
Igual que hoy: monto total, categoría, si tiene cuotas genera `Bill` automáticamente.

| Campo | Nota |
|---|---|
| `date`, `concept`, `category` | |
| `total_amount`, `currency`, `fx_ars_usd`, `total_amount_usd` | |
| `installment_count`, `first_due_date` | si `installment_count > 0` |
| `status` | `ACTIVE` / `COMPLETED` / `CANCELLED` |

### `Bill` (cuenta a pagar)
Es el espejo de `Invoice`, pero para plata que **debemos** nosotros. Reemplaza al
`PaymentObligation` de hoy. Nace de una cuota de compra o se crea manual.

| Campo | Nota |
|---|---|
| `purchase` | FK, nullable (nullable = manual) |
| `installment_number`, `installment_total` | solo si viene de compra |
| `due_date` | |
| `amount_original`, `currency`, `estimated_amount_usd` | |
| `status` | `PENDING` / `PARTIAL` / `PAID` / `CANCELLED` — **derivado** de `Expense` asociados, con la misma tolerancia de centavos que hoy |

Las cuotas siguen repartiendo el total exacto por mayor resto y sumando meses con ajuste
de fin de mes — esa lógica de `Purchase → Bill` no cambia, ya funciona bien hoy.

### `Expense` (gasto real / pago de una `Bill`)
| Campo | Nota |
|---|---|
| `date`, `concept` | |
| `amount_original`, `currency`, `fx_ars_usd`, `amount_usd` | |
| `bill` | FK, nullable (gasto suelto si no hay `Bill`) |
| `job` | FK, nullable (gasto asociado a un trabajo) |
| `paid_by` | `CASH` / `INVESTOR` |
| `account` | FK, **solo si `paid_by=CASH`** (sale caja) |
| `investor` | FK, **solo si `paid_by=INVESTOR`** — pagar de su bolsillo suma capital automáticamente, igual que hoy |
| `created_by` | FK a `User`, se completa solo al crear — sirve para permisos (ver [API.md](API.md)) |

Mismo patrón que `CapitalEvent`: el campo `paid_by` ya define el efecto, no hace falta
sincronizar una tabla aparte.

Acá es donde entra la ayuda extra no-socia: si un día se necesitó una persona que no es
inversor, no participa del reparto del cobro — se le paga como `Expense` normal, con
`job` apuntando al trabajo donde ayudó, `concept` describiendo quién/por qué, y
`paid_by=CASH` (o `INVESTOR` si alguien lo pagó de su bolsillo). No hay ninguna entidad ni
campo especial para esto; es el mismo `Expense` que se usa para cualquier otro gasto.

## 2. Cómo se calcula todo (nada se guarda duplicado)

**Saldo de una `Account`** = suma de todos los movimientos que la referencian:
`Payment` (+), `Expense` con `paid_by=CASH` (−), `CapitalEvent` con `kind=CONTRIBUTION`
(+) o `kind=RESCUE` (−). Los `CapitalEvent` de `kind=JOB_DISTRIBUTION` **no** tienen
`account` y por lo tanto no entran en esta suma — nunca mueven caja.

**Capital de un `Investor`** = suma de todos los `CapitalEvent` de ese inversor
(`CONTRIBUTION` y `JOB_DISTRIBUTION` suman, `RESCUE` resta) más los `Expense` con
`paid_by=INVESTOR` de ese inversor (+, pagar de su bolsillo también suma capital).

**Cap table** = capital de cada inversor / capital total, a una fecha dada (se filtran los
eventos hasta esa fecha, igual que hoy).

**Saldo de una `Invoice`** = `amount_usd` − suma de `Payment.amount_usd` asociados.

**Estado de una `Bill`** = se recalcula comparando `amount` contra la suma de `Expense`
asociados (tolerancia $0,01), igual que hoy.

**Deuda de un `Client`** = suma del saldo de sus `Invoice` con `status=OPEN`
(`amount_usd` − pagos asociados de cada una). **Historial de pagos de un `Client`** = todos
los `Payment` de sus `Invoice`, ordenados por fecha.

Ninguno de estos cinco cálculos requiere que dos tablas se mantengan sincronizadas: son
consultas (`SUM ... WHERE ...`) sobre una sola fuente por concepto.

## 3. El ejemplo del README, completo con compras y aportes

Ajustamos el caso del README §2 para que los que "trabajaron" sean inversores, y
agregamos ayuda extra no-socia para mostrar cómo se registra aparte. Hay tres inversores
(A, B, C), con cap table 50%/30%/20% antes de este cobro. En el trabajo trabajaron A y B
(C no); además ayudó Tomás, que no es socio.

```
Payment #1  → invoice=#1, amount_ars=300000, fx=1080

Bucket campo (55% = 165.000), repartido A 60% / B 40% (porcentaje de trabajo del día):
  A: 99.000    B: 66.000

Bucket accionista (45% = 135.000), repartido por cap table A 50% / B 30% / C 20%:
  A: 67.500    B: 40.500    C: 27.000

CapitalEvent A → investor=A, kind=JOB_DISTRIBUTION, payment=#1,
                 work_amount_ars=99000, shareholder_amount_ars=67500, amount_ars=166500
CapitalEvent B → investor=B, kind=JOB_DISTRIBUTION, payment=#1,
                 work_amount_ars=66000, shareholder_amount_ars=40500, amount_ars=106500
CapitalEvent C → investor=C, kind=JOB_DISTRIBUTION, payment=#1,
                 work_amount_ars=0,     shareholder_amount_ars=27000, amount_ars=27000
```

Tres filas, ninguna con `account` — nada de esto mueve caja, los $300.000 quedan enteros
en la empresa como capital de A, B y C. La ayuda de Tomás no es parte de este reparto en
absoluto; se registra después, cuando se sepa cuánto cobra, como un gasto suelto:

```
Expense#1 → job=Job#1, concept="Ayuda de campo 25/03 - Tomás", amount_ars=30000,
            paid_by=CASH, account=Caja ARS
```

Esa plata sale de caja como cualquier otro gasto — no reduce lo que capitalizaron A, B y C,
y no depende de que exista un cobro repartido ese mismo día.

Agregamos dos eventos más para mostrar el resto del modelo:

**Compra en cuotas:** se compra una pulverizadora por USD 12.000 en 3 cuotas.
- `Purchase#1`: total_amount_usd=12000, installment_count=3, first_due_date=01/04.
- Genera automáticamente `Bill#1,2,3` de USD 4.000 c/u, vencimientos 01/04, 01/05, 01/06.
- Se paga la primera cuota con caja: `Expense#1` → `bill=Bill#1`, `paid_by=CASH`,
  `account=Caja USD`, `amount_usd=4000`. `Bill#1.status` pasa a `PAID`.

**Aporte directo:** Accionista C pone USD 2.000 de capital fresco (no viene de un cobro).
- `CapitalEvent` → `investor=C`, `kind=CONTRIBUTION`, `amount_usd=2000`,
  `account=Caja USD`.
- Efecto: `Caja USD` sube 2.000, capital de C sube 2.000. Una sola fila, dos efectos, sin
  nada que sincronizar. Misma tabla que usaron A, B y C para lo del trabajo, solo que con
  otro `kind`.

## 4. Qué mejora esto respecto al proyecto actual

- **`Client` es FK real**, no texto — arregla una deuda técnica que el proyecto actual
  tiene marcada y nunca resolvió.
- **`Invoice`/`Bill` son simétricos** (a cobrar / a pagar) en vez de que un mismo modelo
  (`JobCollection`) cumpla dos roles distintos según un campo `parent_collection`.
- **No hay tags en texto** (`[settlement:id]`) para ubicar registros derivados — todo es
  FK.
- **Reinversión no ensucia la caja**: al no moverla, no hace falta el movimiento de caja
  "fantasma" que genera hoy el sistema actual.
- **Saldos calculados, no guardados**: cero riesgo de que caja/capital queden
  desincronizados del historial real, porque no hay copia que desincronizar.
- **Una sola tabla (`CapitalEvent`) para todo lo que cambia el capital de un inversor** —
  aporte, rescate o reparto de cobro son el mismo tipo de registro con distinto `kind`, en
  vez de tres mecanismos distintos como hoy (`CashMovement` + `CapitalContribution` +
  reparto).

## 5. Qué falta definir

- Pantallas y flujo de carga (todavía no lo tocamos — esto es solo el modelo de datos).
- Permisos por usuario (hoy no hay roles; podría valer la pena definirlo desde el arranque
  en vez de agregarlo después).

## 6. Cómo seguimos

1. Confirmás si este modelo de datos te cierra tal como quedó (reinversión fija +
   `CapitalEvent` unificado, sin entidad `Worker`).
2. Definimos permisos/usuarios.
3. Recién ahí pasamos a diseño de API y pantallas.


## Job: tipo de trabajo y producto (26/09/2026)

`Job.work_type` es una lista fija (`core/work_types.py`): PULVERIZACION
(Pulverización), SIEMBRA (Siembra), FERTILIZACION (Fertilización), OTRO. La semilla o el producto aplicado va en `Job.product` (urea,
centeno, fungicida...). El cultivo de una pulverización (soja, maíz) va en notas.
La API expone `work_type_label` ("Siembra (centeno)") para mostrar.
Migración 0004 convierte el texto libre anterior con `work_types.parse_legacy`.
