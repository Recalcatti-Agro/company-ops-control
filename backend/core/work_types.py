"""Tipos de trabajo estandarizados y conversión desde el texto libre que se usaba
antes (v1 y la primera versión de v2). La usan la migración de esquema 0004 y
`migrate_v1`, por eso no depende de los modelos."""

import re

PULVERIZACION = "PULVERIZACION"
SIEMBRA = "SIEMBRA"
FERTILIZACION = "FERTILIZACION"
OTRO = "OTRO"

CHOICES = [
    (PULVERIZACION, "Pulverización"),
    (SIEMBRA, "Siembra"),
    (FERTILIZACION, "Fertilización"),
    (OTRO, "Otro"),
]

# Productos de pulverización: van al campo producto. Cualquier otro detalle de
# una pulverización (soja, maíz, "contra gramón") es el cultivo y va a notas.
SPRAY_PRODUCTS = {"fungicida", "insecticida", "herbicida", "cipermetrina"}


def parse_legacy(text):
    """Texto libre -> (work_type, producto, cultivo). Ejemplos:
    "Fertilización al voleo (urea)" -> (FERTILIZACION, "urea", "")
    "Pulverización (soja)" -> (PULVERIZACION, "", "soja")
    "Voleada de semilla" -> (SIEMBRA, "", "")"""
    raw = (text or "").strip()
    if not raw:
        return "", "", ""
    m = re.match(r"^(.*?)\s*\((.*)\)\s*$", raw)
    base, detail = (m.group(1), m.group(2).strip()) if m else (raw, "")
    b = base.lower()

    if b.startswith("pulveriz") or b in SPRAY_PRODUCTS:
        if b in SPRAY_PRODUCTS:
            return PULVERIZACION, b, ""
        if detail.lower() in SPRAY_PRODUCTS:
            return PULVERIZACION, detail.lower(), ""
        return PULVERIZACION, "", detail
    if b.startswith("fertiliz") or b == "urea":
        return FERTILIZACION, detail or ("urea" if b == "urea" else ""), ""
    if b.startswith(("siembra", "sembrado", "voleada de semilla")) or b in {"centeno", "avena", "alfalfa", "moha"}:
        if b in {"centeno", "avena", "alfalfa", "moha"}:
            return SIEMBRA, b, ""
        seed = detail or re.sub(r"^(voleada de semilla|siembra al voleo|siembra|sembrado)\s*", "", b).strip()
        return SIEMBRA, seed, ""
    return OTRO, raw, ""
