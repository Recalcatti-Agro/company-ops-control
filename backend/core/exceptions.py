from django.db.models import ProtectedError
from rest_framework.response import Response
from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    """Un borrado bloqueado por on_delete=PROTECT (cliente con trabajos, inversor con
    movimientos, etc.) vuelve como 400 con un mensaje legible, no como 500."""
    if isinstance(exc, ProtectedError):
        return Response(
            {"detail": "No se puede borrar: tiene registros asociados. Borrá o reasigná esos primero."},
            status=400,
        )
    return exception_handler(exc, context)
