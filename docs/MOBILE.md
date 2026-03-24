# Pantallas mobile

Adaptaciones de la interfaz para uso desde celular.

## Navbar

En pantallas `≤ 640px` el navbar colapsa los links y muestra un botón hamburger (☰) a la derecha junto al toggle de tema.

Al tocarlo se despliega el menú completo en vertical debajo del header, con tap targets de 44px de alto. El menú se cierra automáticamente al navegar a cualquier ruta.

En desktop el navbar se mantiene igual: links horizontales visibles.

## Gasto rápido — `/expenses/quick`

Pantalla mobile-first para registrar un gasto en pocos segundos.

### Campos siempre visibles

| Campo | Comportamiento |
|---|---|
| Fecha | Input date, por defecto hoy |
| Concepto | Texto libre, obligatorio |
| Monto ARS | Input decimal con prefijo `ARS $` en tipografía grande. Siempre en ARS |
| Inversor | Solo aparece si el usuario logueado **no** tiene un inversor asociado en sesión |

El botón **Agregar** permanece deshabilitado hasta que concepto, monto > 0 e inversor (cuando aplica) estén completos.

Al guardar exitosamente, concepto y monto se limpian y queda listo para el siguiente gasto.

### Campos opcionales (`▼ Más campos`)

Un toggle discreto debajo del botón despliega:

- **Origen**: Paga inversor / Sale de caja (por defecto: paga inversor)
- **Inversor**: selector para cambiar el inversor pagador (solo si el origen es "Paga inversor" y el usuario sí tiene inversor en sesión — para cuando paga otro)
- **Compra**: selector opcional de compra asociada
- **Trabajo**: selector opcional de trabajo asociado
- **Cuenta a pagar**: selector opcional de obligación de pago
  - si hay una compra seleccionada, solo muestra obligaciones de esa compra
  - si se selecciona una obligación vinculada a una compra, la compra se completa automáticamente

### Inversor por defecto

Al cargar la pantalla se lee `investorId` de la sesión y se pre-selecciona automáticamente. Si la sesión no tiene `investorId` (usuario no asociado a ningún inversor), el selector aparece en los campos principales como obligatorio.

El `investorId` se configura desde el admin Django en el perfil de cada usuario.

### Referencia TC

Debajo del monto siempre aparece el tipo de cambio BCRA de la fecha seleccionada. Si hay monto ingresado, muestra también el equivalente en USD (`≈ U$S ...`).

### Navegación

Desde la pantalla de gastos en mobile, el botón **Nuevo gasto** redirige a esta pantalla en lugar de abrir el formulario inline.

---

## Trabajo rápido — `/works/quick`

Pantalla mobile-first para registrar un trabajo en pocos pasos.

### Campos siempre visibles

| Campo | Comportamiento |
|---|---|
| Fecha inicio | Input date, por defecto hoy |
| Tipo de trabajo | Texto libre, obligatorio |
| Cliente | Selector de clientes existentes, obligatorio |

Un toggle debajo del selector permite cambiar a modo "Nuevo cliente" (input texto libre). Al guardar, si el nombre coincide con un cliente existente se reutiliza; si no, se crea automáticamente.

El botón **Agregar** permanece deshabilitado hasta que tipo de trabajo y cliente estén completos.

Al guardar exitosamente, tipo de trabajo y cliente se limpian y queda listo para el siguiente registro.

### Campos opcionales (`▼ Más campos`)

- **Fecha fin**: fecha de fin del trabajo
- **Hectáreas**: input decimal
- **Aclaraciones**: texto libre

### Navegación

Desde la pantalla de trabajos en mobile, el botón **Nuevo trabajo** redirige a esta pantalla. En desktop el comportamiento es el de siempre (modal en la misma pantalla).

---

## Listado de gastos — `/expenses`

### Layout según dispositivo

| Dispositivo | Layout |
|---|---|
| Desktop (`> 640px`) | Tabla con columnas: fecha, concepto, obligación, quién pagó, ARS, USD, acciones |
| Mobile (`≤ 640px`) | Tarjetas apiladas por mes |

La tabla y las tarjetas se renderizan en el mismo componente y se muestran u ocultan por CSS (`.expense-table-desktop` / `.expense-cards`).

### Tarjeta de gasto (mobile)

```
┌──────────────────────────────────┐
│ Combustible           $18,500   │
│ [Ana]   23 mar · U$S 14.50     │
└──────────────────────────────────┘
```

- Primera línea: concepto (truncado) + monto ARS en bold
- Segunda línea: chip del pagador + fecha corta + equivalente USD
- Si el gasto tiene compra o trabajo asociado, aparece una tercera línea con esa referencia

Al tocar una tarjeta se expanden los botones de acción:

```
┌──────────────────────────────────┐
│ Combustible           $18,500   │
│ [Ana]   23 mar · U$S 14.50     │
│ ─────────────────────────────── │
│ [  Editar  ]    [  Eliminar  ] │
└──────────────────────────────────┘
```

Tocar de nuevo la tarjeta cierra las acciones.

### Agrupación por mes

Tanto en desktop como en mobile los gastos se agrupan en acordeones por mes. El header de cada acordeón muestra el total ARS y USD del mes. Al entrar a la pantalla el mes más reciente queda abierto por defecto.

### Nuevo gasto desde mobile

En mobile el botón **Nuevo gasto** redirige a `/expenses/quick` en lugar de mostrar el formulario inline. En desktop el comportamiento es el de siempre (toggle del formulario en la misma pantalla).

---

## Clases CSS relevantes

| Clase | Uso |
|---|---|
| `.hide-on-mobile` | Visible en desktop, oculto en mobile |
| `.show-on-mobile` | Visible en mobile, oculto en desktop |
| `.expense-table-desktop` | Tabla de gastos, solo desktop |
| `.expense-cards` | Tarjetas de gastos, solo mobile |
| `.expense-card` | Tarjeta individual de gasto |
| `.expense-card-open` | Estado activo (acciones visibles) |
| `.nav-hamburger` | Botón hamburger del nav, solo mobile |
| `.qe-amount-wrap` | Wrapper del input de monto con prefijo ARS |
| `.qe-prefix` | Badge `ARS $` del input de monto |
| `.qe-extra-toggle` | Botón `▼ Más campos` / toggles discretos en pantallas quick |

El breakpoint mobile es `640px`, definido en `frontend/app/globals.css`.
