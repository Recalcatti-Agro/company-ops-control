# Recalcatti v2 — Propuesta de rediseño

> **Documentos:** [EJECUTAR.md](EJECUTAR.md) (levantar en local) ·
> [PASE_A_PRODUCCION.md](PASE_A_PRODUCCION.md) · [REVISION_UX.md](REVISION_UX.md) ·
> [DATOS_SENSIBLES.md](DATOS_SENSIBLES.md).
> El estado del proyecto y el historial de la migración de datos están en
> `privado/docs/` (fuera del repo, porque tienen datos reales).

Esta carpeta es independiente de `Recalcatti` (el proyecto productivo). Acá pensamos el
modelo desde cero, sin código todavía. El objetivo de este primer documento es elegir
**cómo queremos modelar la plata**, antes de tocar entidades como trabajos, clientes o
pantallas.

## 1. Lo que entiendo que la app necesita hacer

Esto lo infiero del sistema actual, no de una conversación nueva de requisitos. Corregime
lo que no aplique:

1. Registrar trabajos de campo (cliente, fecha, hectáreas, tipo).
2. Facturar trabajos y cobrarlos, a veces en partes.
3. Repartir cada cobro entre equipo de campo y accionistas, con posibilidad de retirar o
   reinvertir la parte de cada uno.
4. Registrar compras grandes con cuotas, y gastos sueltos (pagados por caja o por un
   inversor).
5. Llevar caja separada por moneda (ARS y USD conviven, con tipo de cambio por fecha).
6. Saber la participación (%) de cada inversor en cualquier momento, considerando aportes,
   gastos que pagó de su bolsillo, reinversiones y rescates.

La pregunta de este documento no es *qué* registra la app (eso ya lo tenemos bastante
claro), sino *con qué estructura interna* lo registra. Elegimos un caso real y lo modelamos
de tres formas distintas para que se vea la diferencia en la práctica.

## 2. Caso de ejemplo (el mismo en las tres versiones)

> Se factura un trabajo de fumigación a un cliente por **$500.000 ARS** el 15/03
> (TC 1050 → USD 476,19).
>
> El 25/03 el cliente paga una parte: **$300.000 ARS** (TC 1080 → USD 277,78). Quedan
> **$200.000 ARS** pendientes de cobrar.
>
> Ese cobro de $300.000 se reparte:
> - 55% para equipo de campo → Juan (60% de esa porción) y Pedro (40%).
> - 45% para accionistas según cap table → Accionista A (70%) y Accionista B (30%).
>
> Juan y Pedro cobran en efectivo lo que les toca. Accionista A y Accionista B reinvierten
> el 100% de su parte — **regla fija: los accionistas siempre reinvierten lo ganado en un
> trabajo.** Si más adelante alguno quiere sacar plata, es un movimiento de caja aparte
> (un rescate de capital), que no depende de este reparto puntual.

Montos exactos del reparto de $300.000:

| Quién | % | Monto ARS | Efecto |
|---|---|---|---|
| Juan (campo) | 33% (55%×60%) | $99.000 | cobra en efectivo |
| Pedro (campo) | 22% (55%×40%) | $66.000 | cobra en efectivo |
| Accionista A | 31,5% (45%×70%) | $94.500 | se reinvierte (sube su capital) |
| Accionista B | 13,5% (45%×30%) | $40.500 | se reinvierte (sube su capital) |

Este caso toca todo lo sensible: factura, cobro parcial, multi-moneda y reparto mixto
campo/accionistas. Si un modelo lo resuelve bien, resuelve casi todo lo demás.

> **Nota:** este caso se simplificó después de decidir la regla de reinversión fija (ver
> §9 más abajo). Las secciones 3 a 6 quedaron con la versión anterior del ejemplo (con
> retiro parcial de Accionista A) porque ya habían cumplido su función de comparar
> arquitecturas — no hace falta rehacerlas, la comparación entre A/B/C sigue siendo válida
> igual. Lo vigente para el diseño real es §9.

## 3. Modelo A — El estilo actual, pero prolijo

Es lo que ya tenés, sacando el uso de tags de texto (`[settlement:id]`) y reemplazándolo
por relaciones explícitas. Estructura: `Invoice`, `Collection` (cobro parcial), `Payout`
(fila de reparto por persona), `CashMovement`, `CapitalContribution`.

**La regla de fondo:** cada evento de negocio dispara la creación de varios registros
"espejo" que hay que mantener sincronizados a mano.

Registros que genera *este único cobro*:

```
Invoice #1          → job=Trabajo#1, amount_ars=500000, saldo abierto=200000
Collection #1        → invoice=#1, amount_ars=300000, fx=1080

Payout Juan          → collection=#1, rol=CAMPO, amount_ars=99000, accion=RETIRO
Payout Pedro         → collection=#1, rol=CAMPO, amount_ars=66000, accion=RETIRO
Payout AccionistaA-1 → collection=#1, rol=ACCIONISTA, amount_ars=47250, accion=RETIRO
Payout AccionistaA-2 → collection=#1, rol=ACCIONISTA, amount_ars=47250, accion=REINVERSION
Payout AccionistaB   → collection=#1, rol=ACCIONISTA, amount_ars=40500, accion=REINVERSION

CashMovement OUT ×3  → uno por cada retiro (Juan, Pedro, Accionista A)
CashMovement IN ×2   → uno por cada reinversión (Accionista A, Accionista B)
CapitalContribution ×2 → uno por cada reinversión, para que suba el capital de A y B
```

**Total: 2 registros de factura/cobro + 5 payouts + 5 movimientos de caja + 2 aportes de
capital = 14 filas para un solo cobro.**

Ventaja: mucha trazabilidad, cada peso queda escrito en algún lado.
Problema real (lo viviste en el proyecto actual): si alguien edita o borra el `Collection`,
hay que acordarse de borrar/recrear las 12 filas derivadas. Si una sincronización falla,
la caja o el capital quedan mal sin que nada te avise.

## 4. Modelo B — Simplificado, estilo software de gestión (QuickBooks/Xero por dentro)

Se colapsan `Payout` + `CashMovement` + `CapitalContribution` en **una sola entidad**:
`SettlementLine`. Cada fila ya sabe si mueve caja, si mueve capital, o ambas cosas — no
hace falta sincronizar tres tablas porque hay una sola fuente.

```
Invoice #1     → amount_ars=500000, saldo abierto=200000
Payment #1     → invoice=#1, amount_ars=300000, fx=1080

SettlementLine Juan   → payment=#1, recipient=Juan,    amount_ars=99000,  affects_cash=OUT, affects_capital=no
SettlementLine Pedro  → payment=#1, recipient=Pedro,   amount_ars=66000,  affects_cash=OUT, affects_capital=no
SettlementLine A-ret  → payment=#1, recipient=Inv.A,   amount_ars=47250,  affects_cash=OUT, affects_capital=no
SettlementLine A-rein → payment=#1, recipient=Inv.A,   amount_ars=47250,  affects_cash=no,  affects_capital=+47250
SettlementLine B-rein → payment=#1, recipient=Inv.B,   amount_ars=40500,  affects_cash=no,  affects_capital=+40500
```

**Total: 2 (factura/cobro) + 5 líneas = 7 filas**, contra las 14 del modelo A. La caja y el
capital ya no son tablas separadas que hay que mantener iguales: **se calculan sumando
`SettlementLine` filtrando por `affects_cash` o `affects_capital`.** Es imposible que se
desincronicen porque no hay nada que sincronizar — hay una sola fuente de verdad por línea.

Esto sigue de cerca cómo modelan esto herramientas de gestión reales: una factura, un pago,
y líneas de aplicación de ese pago. No es contabilidad formal, pero es un vocabulario que
cualquier contador entiende al toque (factura, cobro, cuenta corriente).

## 5. Modelo C — Partida doble real (contabilidad formal)

Acá no hay "caja" ni "capital" como conceptos sueltos: hay un **plan de cuentas** y cada
evento genera un **asiento** con líneas que suman cero (debe = haber). Es el estándar
contable de verdad.

Plan de cuentas mínimo para el ejemplo:

- `Caja ARS` (activo)
- `Cuentas por Cobrar` (activo)
- `Ingresos por Servicios` (resultado)
- `Costo Mano de Obra Campo` (resultado)
- `Resultados del Ejercicio` (puente entre resultado y capital)
- `Capital — Accionista A` (patrimonio)
- `Capital — Accionista B` (patrimonio)

Asientos:

```
15/03 Facturación (devengado)
  Debe  Cuentas por Cobrar         500.000
  Haber Ingresos por Servicios              500.000

25/03 Cobro parcial
  Debe  Caja ARS                   300.000
  Haber Cuentas por Cobrar                  300.000

25/03 Pago a equipo de campo (gasto real, sale caja)
  Debe  Costo Mano de Obra Campo   165.000   (99.000 Juan + 66.000 Pedro)
  Haber Caja ARS                            165.000

25/03 Retiro de utilidad — Accionista A
  Debe  Resultados del Ejercicio    47.250
  Haber Caja ARS                            47.250

25/03 Reinversión — Accionista A
  Debe  Resultados del Ejercicio    47.250
  Haber Capital — Accionista A              47.250

25/03 Reinversión — Accionista B
  Debe  Resultados del Ejercicio    40.500
  Haber Capital — Accionista B              40.500
```

Detalle importante que **corrige algo conceptualmente raro del sistema actual**: cuando un
accionista reinvierte, la plata físicamente nunca sale de la caja. Hoy la app igual genera
un `CashMovement` de tipo "ingreso" para la reinversión, que no representa un movimiento de
caja real, sino un traspaso interno. En partida doble esto se modela bien: la reinversión
es un asiento entre `Resultados` y `Capital`, y **no toca la cuenta Caja en absoluto.**

El multi-moneda se resuelve con cuentas separadas por moneda (`Caja ARS`, `Caja USD`) y, si
hace falta, asientos explícitos de "diferencia de cambio" cuando revaluás saldos — en vez de
guardar un `fx_ars_usd` suelto en cada fila como hace hoy la app.

## 6. Comparación

| | A — Actual prolijo | B — Simplificado | C — Partida doble |
|---|---|---|---|
| Filas por evento (nuestro caso) | 14 | 7 | 6 (3 asientos + 3 más) |
| Riesgo de desincronización | Alto (3 tablas espejo) | Bajo (1 tabla, flags) | Nulo (el asiento balancea o no compila) |
| Vocabulario para vos/contador | Mixto, propio del proyecto | Estándar de gestión (factura/cobro/cuenta) | Estándar contable (debe/haber/cuentas) |
| Costo de construir | Medio (ya lo conocés) | Medio-bajo | Alto (motor de asientos, validaciones) |
| Costo de mantener/extender | Alto | Bajo | Medio (pero muy sólido una vez armado) |
| Le podés dar los números a un contador tal cual | No | Parcial | Sí, directamente |
| Corrige el bug conceptual de la reinversión "fantasma" en caja | No, lo hereda | Sí (con el flag `affects_cash=no`) | Sí, de raíz |

## 7. Mi recomendación

**Modelo B.** Da el salto grande en simplicidad y robustez (7 filas vs. 14, una sola fuente
de verdad en vez de tres tablas para sincronizar) sin el costo de construir un motor
contable de partida doble, que es mucho para una empresa que hoy no necesita balances
formales ni auditoría externa. El vocabulario (`Invoice`, `Payment`, `SettlementLine`,
`Account`) además es el que vas a encontrarte si en algún momento integrás con un sistema
contable real o un contador quiere revisar los números.

El Modelo C queda como "techo": si algún día la empresa crece, necesita balance formal o
un contador quiere auditar en serio, se migra — y el Modelo B ya deja el vocabulario
(factura, pago, cuenta) bastante cerca de eso.

## 9. Regla nueva: los accionistas siempre reinvierten

Cambio de negocio, no solo de modelo: **la parte de un accionista en un cobro repartido
siempre se reinvierte, sin excepción.** No existe más la opción de retirar directamente
desde un reparto.

Si un accionista quiere sacar plata, es un evento totalmente aparte — un flujo de caja
independiente que no depende de ningún cobro puntual (`CapitalEvent` con `kind=RESCUE` en
[MODELO_DE_DATOS.md](MODELO_DE_DATOS.md)). Reduce su capital y saca caja, cuando él decida,
por el monto que decida.

Corrección importante sobre quién participa del reparto: los que se marcan como "trabajaron
ese día" para calcular la parte de campo son **siempre inversores de la empresa** — no
existe una categoría de "equipo de campo" con gente que no es socia. Si un día hace falta
ayuda extra de alguien externo, eso no entra en el reparto en absoluto: se registra después
como un gasto (`Expense`) común, ligado al trabajo, por lo que se le pague a esa persona.
(Esto ya era así en el proyecto actual — lo tenía mal modelado yo, no es una regla nueva.)

Con las dos cosas juntas, el modelo B se simplifica más de lo que pensaba originalmente:

- Ya no hace falta una tabla `SettlementLine` separada. Como el reparto de un cobro nunca
  mueve caja (siempre reinvierte) y siempre es a un `Investor`, es exactamente el mismo
  tipo de evento que un aporte o un rescate — solo cambia el origen. Las tres cosas quedan
  en una única tabla, `CapitalEvent`, con un campo `kind` (`CONTRIBUTION` / `RESCUE` /
  `JOB_DISTRIBUTION`).
- Ya no hay reparto mixto por persona (antes un accionista podía partirse en retiro +
  reinversión). Una fila por inversor alcanza.

## 10. Cómo seguimos

1. ~~Confirmás si el Modelo B te convence~~ → confirmado, vamos con B.
2. ~~Definir el resto de las entidades~~ → hecho, con reinversión fija y un `CapitalEvent`
   único para aportes, rescates y repartos: ver [MODELO_DE_DATOS.md](MODELO_DE_DATOS.md).
3. ~~Permisos/usuarios~~ → hecho, dos roles (`ADMIN`/`INVESTOR`), cap table visible para
   cualquier inversor: ver [PERMISOS_USUARIOS.md](PERMISOS_USUARIOS.md).
4. ~~Diseño de API~~ → hecho, endpoints por recurso + criterio "own" para
   trabajos/gastos (confirmado: el inversor puede editar/borrar lo suyo): ver
   [API.md](API.md).
5. ~~Pantallas~~ → hecho, con ficha de cliente nueva: ver [PANTALLAS.md](PANTALLAS.md).
6. ~~Mockups~~ → aprobados. Ver `mockups/` en esta carpeta (canvas con las 6 pantallas
   principales, publicado como artifact).
7. ~~Backend~~ → completo: Django + DRF en `backend/`, con todos los modelos de
   [MODELO_DE_DATOS.md](MODELO_DE_DATOS.md) (+ `ExchangeRate`, que faltaba en el
   diseño original), permisos de [PERMISOS_USUARIOS.md](PERMISOS_USUARIOS.md), y
   todos los endpoints de [API.md](API.md) incluido `/fx/ars-usd/` (BCRA con
   fallback). También se agregó `/users/` para administrar usuarios y roles, que
   faltaba en el diseño original.
8. ~~Frontend~~ → completo: Next.js en `frontend/`, mismas 17 pantallas de
   [PANTALLAS.md](PANTALLAS.md), con la paleta y tipografía de los mockups.
   Verificado a mano en el navegador (no solo compilado): login, dashboard, alta de
   trabajo, facturación, cobro parcial, reparto con vista previa en vivo (reinversión
   exacta, cap table actualizándose), ficha de cliente, tema claro/oscuro, y las
   pantallas mobile (`/home`, `/jobs/quick`) con bottom nav.
9. Ver [EJECUTAR.md](EJECUTAR.md) para levantar todo en local.
10. Queda pendiente: cargar los datos reales (backup de producción) en vez de los de
    prueba, y tests automatizados de backend.
