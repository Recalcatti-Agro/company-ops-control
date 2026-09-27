# Revisión UX/UI — Recalcatti v2

Revisión heurística del frontend v2 (http://localhost:3010), hecha el 26/09/2026
recorriendo la app real con datos migrados, en desktop y mobile (375px).
Criterios: heurísticas de Nielsen (H1–H10), leyes de UX (jerarquía visual,
proximidad, Fitts) y consistencia entre pantallas.

**Veredicto general:** la base visual está bien — paleta coherente, buena
jerarquía tipográfica, sidebar claro. Los problemas están en la *consistencia de
los datos que se muestran* y en *mobile*.

Estado: ✅ resuelto · ⬜ pendiente

---

## 🔴 Alta prioridad — confunden o muestran datos contradictorios

### 1. ✅ Misma factura, estado distinto según la pantalla (H4 Consistencia)

Una factura cobrada en parte se veía **"Parcial"** en
`/invoices` pero **"Abierta"** en la ficha del cliente y en el detalle del
trabajo. Cada pantalla calculaba el label por su cuenta y solo `/invoices`
distinguía "Parcial" (`OPEN` + `collected_usd > 0`).

**Resuelto (26/09/2026 18:03):** componente único
[`frontend/components/InvoiceStatus.tsx`](frontend/components/InvoiceStatus.tsx)
con `InvoiceChip` e `InvoiceBalance`, usado en `invoices/page.tsx`,
`clients/[id]/page.tsx` y `jobs/[id]/page.tsx`. Verificado en el browser: la
factura se ve "Parcial" en ambos lados.

> Regla: cualquier pantalla nueva que muestre el estado o saldo de una factura
> tiene que usar `InvoiceChip` / `InvoiceBalance`, nunca armar el label a mano.

### 2. ✅ Saldo negativo mostrado como "Cobrada" (H9, H1)

Una factura mostraba saldo negativo con chip verde "Cobrada", como si
estuviera todo en orden.

**Resuelto:** el backend expone `is_overpaid` (`Invoice.is_overpaid` en
`models.py`, serializado en `serializers.py`) y `InvoiceChip` muestra
**"Cobrada de más"** (naranja); `InvoiceBalance` muestra "$ X de más" con
tooltip. Además, con la re-migración de la base esa factura quedó cobrada
exacta, así que hoy no hay ningún caso para verlo en pantalla.

### 3. ✅ Monedas mezcladas en la misma fila o bloque (H4, carga cognitiva)

> Resuelto en la revisión 2: Vencimientos muestra monto y pagado en la misma moneda; ficha de cliente con saldo en moneda original (USD como dato secundario); el dashboard ya no muestra "Facturado sin cobrar" en USD ("Para hacer" usa moneda original).

- **Cuentas a pagar:** columna "Monto" en ARS y "Pagado" en USD → no se pueden
  comparar a simple vista.
- **Ficha de cliente:** "Deuda actual" grande en USD (ej. USD 300) y chico en ARS,
  pero todas sus facturas están en ARS.
- **Dashboard:** "Facturado sin cobrar" en USD.

**Propuesta:** número principal siempre en la moneda original; equivalente USD
como dato secundario (chico, gris).

### 4. ✅ Filas de Trabajos casi no clickeables (Fitts, affordance)

> Resuelto: toda la fila navega a la ficha (también en Clientes, Inversores y la ficha de cliente).

En `/jobs` solo la fecha es link (`jobs/page.tsx`, `<Link>` en la celda de
fecha) y no se ve como link. Clickear el cliente no hace nada.
**Propuesta:** toda la fila navega al detalle, igual que en Clientes.

### 5. ⬜ Mobile de Trabajos y Facturas = tabla desktop con scroll horizontal

A 375px la columna **Estado** / **Saldo** (lo más importante) queda fuera de
pantalla y los montos se parten en dos líneas. **Propuesta:** cards en mobile
(como ya tiene la v1 con `.expense-cards`). Es el cambio más trabajoso de la lista.

---

## 🟡 Media

### 6. ✅ Estados de carga que mienten o no terminan (H1)

> Resuelto: Facturación no muestra contadores mientras carga; las fichas de cliente y trabajo muestran "No se encontró…" con link de vuelta.

- `/invoices` muestra **"0 facturas · 0 abiertas"** mientras carga y después
  salta a 26. Mientras carga, no mostrar el contador (o skeleton).
- **Detalle con ID inexistente → "Cargando..." eterno.** Encontrado al revisar:
  tras la re-migración los IDs cambiaron (un cliente pasó de `/clients/104` a
  `/clients/121`). La API responde 404, el error queda como promesa no
  manejada en consola y la pantalla nunca sale de "Cargando...".
  **Propuesta:** manejar el error y mostrar "No se encontró el cliente" + link
  a la lista. Aplica a todos los detalles (`clients/[id]`, `jobs/[id]`).

### 7. ✅ Cuentas a pagar arranca por lo menos relevante

> Resuelto: Vencimientos agrupado por urgencia (Vencidas → Esta semana → …), pagadas plegadas al final.

Orden ascendente: arriba aparece octubre 2025, todo pagado. Lo urgente
(vencidas, próximas) queda al fondo. **Propuesta:** filtro "Pendientes" por
defecto, o ordenar por urgencia.

### 8. ⬜ Home mobile: "Próximos vencimientos" incluye vencidos

Muestra 15/11/25 (ya vencido) sin distinguirlo. **Propuesta:** separar
"Vencidas" (rojo) de "Próximas".

### 9. ✅ Chips del Dashboard parecen botones pero no hacen nada

> Resuelto: reemplazados por "Para hacer", cada ítem linkea a la lista filtrada.

"4 vencidos", "4 en los próximos 7 días". **Propuesta:** que linkeen a Cuentas
a pagar con el filtro correspondiente.

### 10. ✅ Trabajos: jerarquía de botones y alineación

> Jerarquía resuelta (26/09): "Facturar" se movió a Facturación → Por facturar y "Nuevo trabajo" quedó como primario. Falta la alineación de columnas.

- La acción primaria (verde) es "Facturar seleccionados (0)", deshabilitada;
  "Nuevo trabajo" queda como secundaria. **Propuesta:** invertir, o mostrar
  "Facturar" solo en una barra contextual cuando hay selección.
- Cada bloque de mes es una tabla aparte y las columnas cambian de ancho entre
  bloques → se ve desalineado al scrollear. **Propuesta:** anchos de columna
  fijos (`table-layout: fixed` + `<colgroup>`).

### 11. ✅ Gastos sin búsqueda ni filtros

> Resuelto: buscador, "Quién pagó", período y total de lo filtrado.

138 filas sin buscador, sin filtro por fecha / pagado por, sin total del período.

---

## 🟢 Prolijidad

### 12. ✅ Columnas y cards siempre vacías

> Resuelto: Clientes con columnas de actividad; ficha de cliente muestra solo los datos de contacto cargados; Trabajos sin columna Ubicación (el lugar va chico al lado del tipo).

"Ubicación" en Trabajos, "Contacto" y "Teléfono" en Clientes están siempre en
"–". La card "Contacto" de la ficha de cliente tiene los 6 campos en "–".
**Propuesta:** ocultar la columna si ninguna fila tiene dato; en la ficha,
empty state "Agregar datos de contacto".

### 13. ✅ Íconos del nav

> Resuelto: Inversores con gráfico de torta, Gastos con ícono propio.

Inversores (`IconInvestors` en `components/icons.tsx`) se ve como un trazo
suelto; Usuarios usa un escudo.

### 14. ✅ Caja

> Resuelto: ver "Caja" en la revisión de pantallas de abajo.

- Select "Todas las cuentas" cortado ("Todas las cuenta").
- Date pickers nativos que no combinan con el resto de los inputs.
- Descripción de "Movimientos de caja" demasiado larga → una línea o tooltip.

### 15. ✅ "Activa" en Compras es ambiguo

> Resuelto: "Pagando cuotas" / "Pagada".

**Propuesta:** "En cuotas" o "Con saldo".

---

## Estructura de pantallas (revisión 2, 26/09/2026) — ✅ hecho

- **Menú agrupado** por flujo: Dashboard · *Ingresos* (Trabajos, Facturación, Clientes) · *Egresos* (Gastos, Compras) · *Dinero* (Caja, Inversores) · *Administración*. `components/Nav.tsx`.
- **Facturación** (ex "Facturas y cobros") tiene el ciclo completo en pestañas: **Por facturar** (trabajos pendientes/hechos agrupados por cliente, se tildan y se factura ahí; los hechos vienen tildados) · **Por cobrar** · **Cobradas** · **Todas**. La pestaña va en `?tab=` (`to-invoice`, `open`, `paid`, `all`). Trabajos ya no factura; muestra un link "N sin facturar →".
- **Compras + Cuentas a pagar** unidas: pestañas *Compras* / *Vencimientos* (`/purchases`, `/bills`), un solo ítem en el menú.
- Componentes nuevos: `components/Tabs.tsx`, `components/InvoiceCreateModal.tsx`.

## Trabajos, clientes, cobros y dashboard (revisión 2, 26/09/2026) — ✅ hecho

- **Ficha de trabajo** (`jobs/[id]`): breadcrumb, chip de estado, línea de tiempo Realizado → Facturado → Cobrado → Repartido con fechas, datos, facturas con sus cobros, **reparto aplicado** por inversor y acciones contextuales (Marcar hecho / Facturar). El endpoint `/jobs/{id}/detail/` ahora devuelve `payments` y `distributions` (un INVESTOR ve solo su parte; test en `core/tests.py`).
- **Trabajos**: filas clickeables → ficha; subtotal por mes (trabajos · ha); anchos de columna fijos entre meses (resuelve el pendiente del punto 10).
- **Facturación → Por cobrar**: tarjetas con total por cobrar, cantidad y la más vieja; columna **Días** (antigüedad, en ámbar > 30); cliente linkea a su ficha; montos alineados a la derecha.
- **Clientes**: buscador; columnas Último trabajo · Trabajos · Ha · Facturado · Saldo (ordenables); fila clickeable. Reemplaza Contacto/Teléfono vacías (punto 12).
- **Ficha de cliente**: 3 KPIs (Saldo pendiente en moneda original, ámbar si hay deuda · Facturado histórico · Trabajos/ha); contacto muestra solo lo cargado o un empty state con "Agregar datos de contacto".
- **Dashboard**: tarjetas clickeables; **Para hacer** (sin facturar, por cobrar con antigüedad, cobros sin repartir, vencidas, próximas 7 días — solo lo que tiene algo); gráfico **Cobrado vs gastos por mes** (12 meses, ARS, tooltip). Colores `--series-1/2` validados para daltonismo en claro y oscuro. Reemplaza los chips "0 vencidos" en rojo (punto 9).
- Helpers nuevos en `lib/format.ts`: `JOB_STATUS_CHIP`, `fmtHa`, `daysSince`, `sumByCurrency`. Componente `components/MonthlyChart.tsx`.

## Filtros y nombres (revisión 2, 26/09/2026) — ✅ hecho

**Filtros** (patrón: buscador + filtros + total de lo filtrado + "Limpiar filtros"):
- Trabajos: el estado pasó de select a **pestañas con contador** (Todos · Sin cobrar · Pendientes · Realizados · Facturados · Cobrados); los contadores respetan el resto de los filtros.
- Facturación: buscador y filtro por cliente, comunes a las 4 pestañas.
- Gastos: filtro "Quién pagó" y rango de fechas; total en ARS de lo filtrado; con filtros se abren todos los meses. (Resuelve el punto 11.)
- Vencimientos: agrupado por urgencia (**Vencidas · Esta semana · Próximos 30 días · Más adelante · Pagadas** plegadas) con días al vencimiento. (Resuelve los puntos 7 y 8.)
- Compras: buscador, filtro por estado y **barra de cuotas pagadas**.

**Nombres**: Dashboard/Home → **Inicio** · trabajo "Hecho" → **Realizado** ("Marcar realizado") · factura "Abierta"/"Parcial" → **Por cobrar** / **Cobro parcial** · cuenta "Parcial" → **Pago parcial** · compra "Activa"/"Completada" → **Pagando cuotas** / **Pagada** (resuelve el 15) · "Cap table" → **Participación** · "Pipeline" (home mobile) → "Trabajos" · encabezados de mes con mayúscula solo inicial (`capitalize()` en `lib/format.ts`).
- Chip de usuario: muestra "Administrador"/"Inversor"; el clic abre un menú con **Cerrar sesión** (antes un clic deslogueaba sin aviso).

## Estilo visual (revisión 2, 26/09/2026) — ✅ hecho

- **Chips con significado fijo** (comentado en `globals.css`): gris = no empezó · teal = listo para el paso siguiente · azul = en curso · ámbar = atención · **rojo = vencido/error** (`c-danger`, nuevo) · verde apagado = cerrado OK · cancelado = gris tachado (antes rojo). Cuotas vencidas muestran chip "Vencida"; "Inactivo" en Usuarios pasó a gris.
- **Botones**: primario plano (sin degradé) con hover; en tema oscuro el texto del primario es oscuro (`--on-primary`) — antes era blanco sobre verde claro, sin contraste. Hover en ghost/secundario y `:focus-visible` para teclado.
- **Números**: `tabular-nums` en todas las tablas; montos alineados a la derecha (Inversores, Compras, Vencimientos, Facturación…).
- Ámbar/rojo hardcodeados → clases (`.overdue`, `.warn-box`). Mapas de chip de trabajos unificados en `JOB_STATUS_CHIP`.
- Íconos: Gastos tiene el suyo (billetera; compartía con Cuentas a pagar), Inversores es un gráfico de torta legible. Modal: "Cerrar" → cruz.
- Inversores: fila clickeable abre el detalle (sin botón "Ver detalle") y barra de participación.
- `color-scheme` por tema: los date pickers nativos se ven bien en oscuro.

**Componentes compartidos** (`components/ui.tsx`, hecho): `PageHeader` (breadcrumb + título + chip + subtítulo + acciones; lo usan las 13 pantallas de escritorio), `Kpi` (con `href` y `tone="warn"`), `Field`, `FilterBar` (con "Limpiar filtros"), `CardHead`, `ProgressBar`. Clases nuevas: `.kpi-row`, `.detail-layout`, `.section-label`, `.link-strong`, `.card-warn`. `.btn` ya alinea ícono + texto solo (se sacaron los `<span>` envoltorios). Estilos inline: 232 → 194 (lo que queda son sobre todo anchos de inputs).
> Regla: pantalla nueva → `PageHeader` + `FilterBar` + `Kpi`; no volver a armarlos con estilos inline.

## Barra de filtros (26/09/2026) — ✅ hecho

- Controles compactos (36px, 13px), ancho según el contenido, sin achicarse (si no entran, bajan de línea): se terminaron los textos cortados ("Producto / semilla: t…").
- **Filtro aplicado = resaltado en verde** (CSS con `:has()`, sin tocar cada pantalla).
- Buscador con lupa (`SearchInput`).
- Fechas sueltas `dd/mm/aaaa` → **`PeriodFilter`**: Todo · Este mes · Mes pasado · Últimos 3 meses · Este año · Año pasado · Personalizado (recién ahí aparecen "Desde"/"Hasta" con etiqueta). En Trabajos, Gastos y Caja.
- Trabajos: pestañas de estado **arriba** de los filtros.
- Labels unificados "Campo: todos" (Caja decía "Todos los tipos").

## Clientes, ficha de cliente, Caja y Trabajos (26/09/2026) — ✅ hecho

- **Clientes**: el cliente comodín "Sin cliente / a confirmar" va siempre al final, apagado y con chip "A confirmar" (`isPlaceholderClient()` en `lib/format.ts`: no hay campo que lo marque, se reconoce por el nombre, que es único). "Último trabajo" con antigüedad ("hace 6 meses"). Fila de totales. Buscador con `FilterBar`.
- **Ficha de cliente**: con 11 facturas era una pila de tarjetas → pestañas **Facturas · Trabajos · Cobros** con tablas compactas; cada factura se despliega (trabajos + cobros con estado de reparto). Aviso "N trabajos sin facturar → Facturar" (abre Facturación filtrada por el cliente, `?client=`). Columna izquierda: Contacto, **Resumen** (cliente desde, trabajos más hechos, lugares) y Notas en texto normal. Botón **Nuevo trabajo** con el cliente precargado (`JobForm defaultClient`).
- **Facturación → Por facturar**: no deja facturar al cliente comodín ("Asigná el cliente real en cada trabajo antes de facturar").
- **Caja**: pestañas por cuenta (**Caja ARS** por defecto · Caja USD · Todas) y columna **Saldo** acumulado por cuenta, como un extracto (verificado: partiendo del saldo actual hacia atrás, las dos cuentas cierran en 0). Columna **Tipo** separada del detalle. Egresos en color de texto con "−" (el rojo queda para errores), ingresos en verde. Descripción en una línea. Las tarjetas de saldo cambian de cuenta.
- **Trabajos**: sin columna Ubicación.

## Lo que está bien (no tocar)

- Paleta y tipografía coherentes; KPIs del dashboard claros.
- Home mobile: acciones grandes arriba (Nuevo trabajo / Nuevo gasto), caja y
  pipeline de un vistazo, bottom nav.
- Carga rápida de gasto (`/expenses/quick`): pocos campos, fecha por defecto,
  botón grande.
- Ficha de cliente: breadcrumb, KPI de deuda destacado, facturas con sus
  trabajos y pagos agrupados.
