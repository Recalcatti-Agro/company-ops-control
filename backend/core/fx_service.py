import json
import ssl
from datetime import date, timedelta
from decimal import Decimal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.core.exceptions import ValidationError


def _fallback_rate_from_db(on_date: date) -> tuple[Decimal, date] | None:
    from .models import ExchangeRate

    conversion = (
        ExchangeRate.objects.filter(date__lte=on_date)
        .order_by("-date")
        .only("date", "ars_per_usd")
        .first()
    )
    if conversion is None:
        conversion = ExchangeRate.objects.order_by("-date").only("date", "ars_per_usd").first()
    if conversion is None:
        return None
    return Decimal(str(conversion.ars_per_usd)).quantize(Decimal("0.0001")), conversion.date


def _fetch_bcra_series(fecha_desde: date, fecha_hasta: date) -> list[dict]:
    url = (
        "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD"
        f"?fechaDesde={fecha_desde.isoformat()}&fechaHasta={fecha_hasta.isoformat()}"
    )
    request = Request(url, headers={"User-Agent": "BusinessControl/1.0"})
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError):
        # El endpoint de BCRA puede presentar cadena TLS incompleta en algunos entornos.
        # Reintentamos sin verificación TLS para no perder disponibilidad.
        try:
            insecure_ctx = ssl._create_unverified_context()
            with urlopen(request, timeout=10, context=insecure_ctx) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError):
            return []

    if payload.get("status") != 200:
        return []
    return payload.get("results", [])


def _latest_bcra_rate_until(on_date: date) -> tuple[Decimal, date] | None:
    # Cubre fines de semana/feriados y meses con menor actividad.
    from_date = on_date - timedelta(days=60)
    series: list[dict] = []
    query_end = on_date
    for _ in range(7):
        series = _fetch_bcra_series(from_date, query_end)
        if series:
            break
        query_end -= timedelta(days=1)

    best_date: date | None = None
    best_rate: Decimal | None = None

    for item in series:
        try:
            item_date = date.fromisoformat(item["fecha"])
        except (KeyError, ValueError):
            continue
        if item_date > on_date:
            continue

        detail = item.get("detalle") or []
        if not detail:
            continue

        entry = detail[0]
        try:
            rate = Decimal(str(entry["tipoCotizacion"]))
        except (KeyError, ValueError):
            continue

        if rate <= 0:
            continue
        if best_date is None or item_date > best_date:
            best_date = item_date
            best_rate = rate

    if best_date is None or best_rate is None:
        return None

    return best_rate.quantize(Decimal("0.0001")), best_date


def get_ars_per_usd(on_date: date) -> tuple[Decimal, date]:
    # Regla: cotización por fecha; si ese día no hay dato, usa el último día anterior disponible.
    bcra = _latest_bcra_rate_until(on_date)
    if bcra is not None:
        return bcra

    fallback = _fallback_rate_from_db(on_date)
    if fallback is not None:
        return fallback

    raise ValidationError("No se pudo obtener el tipo de cambio desde BCRA.")
