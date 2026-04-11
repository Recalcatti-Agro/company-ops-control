from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Sum

from .models import JobCollection


_CENT = Decimal("0.01")


def q2(value: Decimal | int | float | str | None) -> Decimal:
    return Decimal(str(value or 0)).quantize(_CENT, rounding=ROUND_HALF_UP)


def _prefetched_partial_collections(collection: JobCollection):
    cache = getattr(collection, "_prefetched_objects_cache", {})
    partials = cache.get("partial_collections")
    if partials is None:
        return None
    return [item for item in partials if item.status == JobCollection.Status.COLLECTED]


def _collection_fx(collection: JobCollection) -> Decimal:
    return Decimal(str(collection.fx_ars_usd or 0))


def collection_settled_total_ars(collection: JobCollection, *, exclude_id: int | None = None) -> Decimal:
    partials = _prefetched_partial_collections(collection)
    if partials is not None:
        total = sum(
            (item.amount_ars or Decimal("0"))
            for item in partials
            if exclude_id is None or item.id != exclude_id
        )
        return q2(total)
    if not collection.pk:
        return Decimal("0.00")
    qs = collection.partial_collections.filter(status=JobCollection.Status.COLLECTED)
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)
    total = qs.aggregate(total=Sum("amount_ars"))["total"] or Decimal("0")
    return q2(total)


def collection_settled_total_usd(collection: JobCollection, *, exclude_id: int | None = None) -> Decimal:
    remaining_ars = collection_settled_total_ars(collection, exclude_id=exclude_id)
    fx = _collection_fx(collection)
    if fx <= Decimal("0"):
        return Decimal("0.00")
    return q2(remaining_ars / fx)


def collection_remaining_usd(collection: JobCollection, *, exclude_partial_id: int | None = None) -> Decimal:
    if collection.parent_collection_id or collection.status != JobCollection.Status.BILLED:
        return Decimal("0.00")
    remaining_ars = collection_remaining_ars(collection, exclude_partial_id=exclude_partial_id)
    fx = _collection_fx(collection)
    if fx <= Decimal("0") or remaining_ars <= Decimal("0"):
        return Decimal("0.00")
    return q2(remaining_ars / fx)


def collection_remaining_ars(collection: JobCollection, *, exclude_partial_id: int | None = None) -> Decimal:
    if collection.parent_collection_id or collection.status != JobCollection.Status.BILLED:
        return Decimal("0.00")
    billed_ars = q2(collection.amount_ars)
    remaining = billed_ars - collection_settled_total_ars(collection, exclude_id=exclude_partial_id)
    if remaining < Decimal("0"):
        remaining = Decimal("0")
    return q2(remaining)


def collection_settled_slice_ars(collection: JobCollection, settled_amount_ars: Decimal) -> Decimal:
    billed_ars = q2(collection.amount_ars)
    settled_ars = q2(settled_amount_ars)
    if billed_ars <= Decimal("0") or settled_ars <= Decimal("0"):
        return Decimal("0.00")
    if settled_ars >= billed_ars:
        return billed_ars
    return settled_ars


def collection_has_open_balance(collection: JobCollection) -> bool:
    return collection_remaining_usd(collection) > Decimal("0.00")
