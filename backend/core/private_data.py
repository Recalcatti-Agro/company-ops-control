"""Datos reales que no van al repo.

Las correcciones de la migración de v1 y la carga de pendientes del chat usan
nombres, montos y citas reales. Viven en la carpeta `privado/` (fuera de git y de
las imágenes Docker) y los comandos las cargan de acá. Se busca, en orden:
`$RECALCATTI_PRIVADO`, `<repo>/privado` y `backend/privado` (esta última es donde
se copia dentro del contenedor en el servidor, ver PASE_A_PRODUCCION.md).
"""

import importlib.util
import os
from pathlib import Path

from django.conf import settings
from django.core.management.base import CommandError


def load(filename):
    folders = []
    if os.environ.get("RECALCATTI_PRIVADO"):
        folders.append(Path(os.environ["RECALCATTI_PRIVADO"]))
    folders += [Path(settings.BASE_DIR).parent / "privado", Path(settings.BASE_DIR) / "privado"]
    for folder in folders:
        path = folder / filename
        if path.is_file():
            spec = importlib.util.spec_from_file_location(f"privado_{path.stem}", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    searched = ", ".join(str(f) for f in folders)
    raise CommandError(
        f"No encuentro {filename} (busqué en: {searched}). Son datos privados que no "
        "están en el repo: copiar la carpeta privado/ o setear RECALCATTI_PRIVADO."
    )
