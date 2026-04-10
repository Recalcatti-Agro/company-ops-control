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


def collection_settled_total_usd(collection: JobCollection, *, exclude_id: int | None = None) -> Decimal:
    partials = _prefetched_partial_collections(collection)
    if partials is not None:
        total = sum(
            (item.amount_usd or Decimal("0"))
            for item in partials
            if exclude_id is None or item.id != exclude_id
        )
        return q2(total)
    if not collection.pk:
        return Decimal("0.00")
    qs = collection.partial_collections.filter(status=JobCollection.Status.COLLECTED)
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)
    total = qs.aggregate(total=Sum("amount_usd"))["total"] or Decimal("0")
    return q2(total)


def collection_remaining_usd(collection: JobCollection, *, exclude_partial_id: int | None = None) -> Decimal:
    if collection.parent_collection_id or collection.status != JobCollection.Status.BILLED:
        return Decimal("0.00")
    total = q2(collection.amount_usd)
    remaining = total - collection_settled_total_usd(collection, exclude_id=exclude_partial_id)
    if remaining < Decimal("0"):
        remaining = Decimal("0")
    return q2(remaining)


def collection_remaining_ars(collection: JobCollection, *, exclude_partial_id: int | None = None) -> Decimal:
    if collection.parent_collection_id or collection.status != JobCollection.Status.BILLED:
        return Decimal("0.00")
    billed_ars = q2(collection.amount_ars)
    billed_usd = q2(collection.amount_usd)
    if billed_ars <= Decimal("0") or billed_usd <= Decimal("0"):
        return Decimal("0.00")
    remaining_usd = collection_remaining_usd(collection, exclude_partial_id=exclude_partial_id)
    if remaining_usd <= Decimal("0"):
        return Decimal("0.00")
    return q2(billed_ars * remaining_usd / billed_usd)


def collection_settled_slice_ars(collection: JobCollection, settled_amount_usd: Decimal) -> Decimal:
    billed_ars = q2(collection.amount_ars)
    billed_usd = q2(collection.amount_usd)
    settled_usd = q2(settled_amount_usd)
    if billed_ars <= Decimal("0") or billed_usd <= Decimal("0") or settled_usd <= Decimal("0"):
        return Decimal("0.00")
    if settled_usd >= billed_usd:
        return billed_ars
    return q2(billed_ars * settled_usd / billed_usd)


def collection_has_open_balance(collection: JobCollection) -> bool:
    return collection_remaining_usd(collection) > Decimal("0.00")
