# Permisos y usuarios — Recalcatti v2

Sigue de [MODELO_DE_DATOS.md](MODELO_DE_DATOS.md). El proyecto actual no tiene roles: todo
usuario autenticado puede hacer cualquier cosa, y la relación usuario↔inversor se resuelve
comparando nombres (frágil). Acá lo dejamos explícito desde el arranque.

## 1. Relación usuario ↔ inversor

`Investor` tiene un campo `user` (FK a `User`, **nullable**, uno a uno). Nullable porque no
todo inversor necesita login (puede haber socios silenciosos que no usan la app).

## 2. Roles propuestos

| Rol | Para quién |
|---|---|
| `ADMIN` | Vos. Acceso total. |
| `INVESTOR` | Un inversor con login. Requiere `user.investor` seteado. |

Solo dos roles para arrancar — nada de un tercer rol "carga rápida sin ver plata" salvo
que realmente haya alguien no-socio que vaya a cargar datos en la app (ver pregunta al
final).

## 3. Qué puede hacer cada rol

| Acción | ADMIN | INVESTOR |
|---|---|---|
| Cargar/editar trabajo propio (rápido, mobile) | sí | sí |
| Editar/borrar cualquier trabajo | sí | no |
| Facturar un trabajo | sí | no |
| Registrar un cobro | sí | no |
| Aplicar reparto de un cobro | sí | no |
| Cargar gasto rápido (mobile) | sí | sí |
| Editar/borrar cualquier gasto | sí | no |
| Alta/gestión de compras y cuotas (`Purchase`/`Bill`) | sí | no |
| Ver dashboard financiero (caja, pipeline, vencimientos) | sí | sí, solo lectura |
| Ver su propio capital y su detalle (`CapitalEvent`) | sí (de todos) | sí, el propio |
| Ver cap table completo (% de todos) | sí | sí |
| Alta/gestión de usuarios | sí | no |

La regla general: `INVESTOR` puede cargar (trabajos y gastos rápidos, como ya hace hoy en
mobile) y ver finanzas, pero no puede facturar, cobrar, repartir ni tocar compras — eso
queda como operación centralizada tuya.

## 4. Decisiones

1. **Cap table completo para todo inversor logueado** — no se restringe por socio.
2. **Solo `ADMIN` e `INVESTOR` por ahora.** Sin tercer rol de "carga sin ver plata"; se
   agrega el día que aparezca alguien no-socio que lo necesite.

## 5. Cómo seguimos

Modelo de datos y permisos cerrados. Sigue: diseño de API (endpoints, qué devuelve cada
rol) y recién después pantallas.
