from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP
import calendar
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.db.models import Prefetch, Q, Sum
from django.db import transaction
from django.db.models.functions import TruncMonth
from rest_framework import permissions, viewsets
from rest_framework.exceptions import ValidationError as ApiValidationError
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .collection_utils import collection_has_open_balance, collection_remaining_ars, collection_remaining_usd, collection_settled_slice_ars
from .fx_service import get_ars_per_usd
from .models import (
    CapitalContribution,
    CashMovement,
    Client,
    Currency,
    ExchangeRate,
    Expense,
    Investor,
    Job,
    JobCollection,
    JobDistribution,
    PaymentObligation,
    Purchase,
    Reinvestment,
)
from .serializers import (
    CapitalContributionSerializer,
    CashMovementSerializer,
    ClientSerializer,
    ExchangeRateSerializer,
    ExpenseSerializer,
    InvestorSerializer,
    JobCollectionSerializer,
    JobDistributionSerializer,
    JobSerializer,
    LoginSerializer,
    PaymentObligationSerializer,
    PurchaseSerializer,
    ReinvestmentSerializer,
)


def _collection_jobs(collection: JobCollection):
    jobs = list(collection.jobs.all())
    if collection.job_id and not any(j.id == collection.job_id for j in jobs):
        jobs.append(collection.job)
    return jobs


def _collection_work_reference_date(collection: JobCollection) -> date:
    jobs = _collection_jobs(collection)
    if not jobs:
        return collection.collection_date
    work_dates = [(job.end_date or job.date) for job in jobs if (job.end_date or job.date)]
    if not work_dates:
        return collection.collection_date
    # For grouped jobs, use the latest completion date as the reference snapshot.
    return max(work_dates)


def _job_related_collections(job: Job) -> list[JobCollection]:
    partial_qs = (
        JobCollection.objects.select_related("job", "parent_collection")
        .prefetch_related("jobs", "distributions__investor")
        .order_by("collection_date", "id")
    )
    return list(
        JobCollection.objects.filter(Q(job=job) | Q(jobs=job))
        .select_related("job", "parent_collection")
        .prefetch_related("jobs", "distributions__investor", Prefetch("partial_collections", queryset=partial_qs))
        .distinct()
        .order_by("collection_date", "id")
    )


def _collection_display_status(collection: JobCollection) -> str:
    if collection.parent_collection_id:
        return collection.status

    partials = list(collection.partial_collections.all())
    remaining = collection_remaining_usd(collection)
    if collection.status == JobCollection.Status.COLLECTED or (partials and remaining <= Decimal("0")):
        return JobCollection.Status.COLLECTED
    if partials:
        return "PARTIAL"
    return JobCollection.Status.BILLED


def _serialize_job_reference(job: Job) -> dict:
    return {
        "id": job.id,
        "date": job.date.isoformat(),
        "end_date": job.end_date.isoformat() if job.end_date else None,
        "client": job.client,
        "work_type": job.work_type,
        "status": job.status,
    }


def _serialize_job_distribution(distribution: JobDistribution) -> dict:
    return {
        "id": distribution.id,
        "kind": distribution.kind,
        "kind_label": distribution.get_kind_display(),
        "investor_id": distribution.investor_id,
        "investor_name": distribution.investor.name if distribution.investor_id else None,
        "percentage": str(distribution.percentage) if distribution.percentage is not None else None,
        "amount_usd": str(_q2(distribution.amount_usd or Decimal("0"))),
        "work_amount_usd": str(_q2(distribution.work_amount_usd or Decimal("0"))),
        "shareholder_amount_usd": str(_q2(distribution.shareholder_amount_usd or Decimal("0"))),
        "reinvest_to_cash_usd": str(_q2(distribution.reinvest_to_cash_usd or Decimal("0"))),
        "notes": distribution.notes,
    }


def _serialize_job_collection_detail(collection: JobCollection, *, include_partials: bool = True) -> dict:
    remaining_amount_usd = collection_remaining_usd(collection)
    remaining_amount_ars = collection_remaining_ars(collection)
    settled_total_usd = (
        _q2((collection.amount_usd or Decimal("0")) - remaining_amount_usd)
        if not collection.parent_collection_id
        else _q2(collection.collected_amount_usd or collection.amount_usd or Decimal("0"))
    )
    partials = list(collection.partial_collections.all()) if include_partials and not collection.parent_collection_id else []

    return {
        "id": collection.id,
        "parent_collection": collection.parent_collection_id,
        "collection_type": "PAYMENT" if collection.parent_collection_id else "INVOICE",
        "display_status": _collection_display_status(collection),
        "collection_date": collection.collection_date.isoformat(),
        "status": collection.status,
        "amount_ars": str(_q2(collection.amount_ars or Decimal("0"))),
        "amount_usd": str(_q2(collection.amount_usd or Decimal("0"))),
        "collected_currency": collection.collected_currency,
        "collected_amount_original": (
            str(_q2(collection.collected_amount_original)) if collection.collected_amount_original is not None else None
        ),
        "collected_fx_ars_usd": str(collection.collected_fx_ars_usd) if collection.collected_fx_ars_usd is not None else None,
        "converted_to_usd": bool(collection.converted_to_usd),
        "collected_amount_usd": str(_q2(collection.collected_amount_usd)) if collection.collected_amount_usd is not None else None,
        "tax_loss_usd": str(_q2(collection.tax_loss_usd or Decimal("0"))),
        "remaining_amount_usd": str(remaining_amount_usd),
        "remaining_amount_ars": str(remaining_amount_ars),
        "settled_total_usd": str(settled_total_usd),
        "notes": collection.notes,
        "related_jobs": [_serialize_job_reference(job) for job in _collection_jobs(collection)],
        "distributions": [_serialize_job_distribution(distribution) for distribution in collection.distributions.all()],
        "partial_collections": [
            _serialize_job_collection_detail(partial, include_partials=False) for partial in partials
        ],
    }


def _job_detail_payload(job: Job) -> dict:
    related_collections = _job_related_collections(job)
    root_collections = [collection for collection in related_collections if not collection.parent_collection_id]

    invoiced_total_usd = Decimal("0")
    collected_total_usd = Decimal("0")
    remaining_total_usd = Decimal("0")
    tax_loss_total_usd = Decimal("0")
    payment_count = 0
    timeline: list[dict] = [
        {
            "date": job.date.isoformat(),
            "kind": "WORK",
            "label": "Trabajo programado",
            "detail": job.work_type or job.client or f"Trabajo #{job.id}",
            "notes": job.notes,
            "_sort": 1,
        }
    ]
    if job.end_date and job.end_date != job.date:
        timeline.append(
            {
                "date": job.end_date.isoformat(),
                "kind": "WORK_END",
                "label": "Trabajo finalizado",
                "detail": job.work_type or job.client or f"Trabajo #{job.id}",
                "notes": job.notes,
                "_sort": 2,
            }
        )

    collections_data = []
    for collection in root_collections:
        collections_data.append(_serialize_job_collection_detail(collection))
        invoiced_total_usd += _q2(collection.amount_usd or Decimal("0"))
        remaining_total_usd += collection_remaining_usd(collection)

        related_jobs = _collection_jobs(collection)
        shared_label = f" · {len(related_jobs)} trabajos" if len(related_jobs) > 1 else ""
        timeline.append(
            {
                "date": collection.collection_date.isoformat(),
                "kind": "INVOICE",
                "label": "Facturado",
                "detail": f"USD {str(_q2(collection.amount_usd or Decimal('0')))}{shared_label}",
                "notes": collection.notes,
                "_sort": 3,
            }
        )

        payments = list(collection.partial_collections.all())
        if not payments and collection.status == JobCollection.Status.COLLECTED:
            payments = [collection]

        payment_count += len(payments)
        for payment in payments:
            collected_total_usd += _q2(payment.collected_amount_usd or payment.amount_usd or Decimal("0"))
            tax_loss_total_usd += _q2(payment.tax_loss_usd or Decimal("0"))

            detail_parts = []
            if payment.collected_amount_original is not None and payment.collected_currency:
                detail_parts.append(f"{payment.collected_currency} {str(_q2(payment.collected_amount_original))}")
            detail_parts.append(f"USD {str(_q2(payment.collected_amount_usd or payment.amount_usd or Decimal('0')))}")
            if _q2(payment.tax_loss_usd or Decimal("0")) > Decimal("0"):
                detail_parts.append(f"Impuestos USD {str(_q2(payment.tax_loss_usd))}")

            timeline.append(
                {
                    "date": payment.collection_date.isoformat(),
                    "kind": "PAYMENT",
                    "label": "Cobro parcial" if payment.parent_collection_id else "Cobro",
                    "detail": " · ".join(detail_parts),
                    "notes": payment.notes,
                    "_sort": 4,
                }
            )

    timeline.sort(key=lambda item: (item["date"], item["_sort"]), reverse=True)
    for item in timeline:
        item.pop("_sort", None)

    return {
        "job": JobSerializer(job).data,
        "summary": {
            "invoice_count": len(root_collections),
            "payment_count": payment_count,
            "invoiced_total_usd": str(_q2(invoiced_total_usd)),
            "collected_total_usd": str(_q2(collected_total_usd)),
            "remaining_total_usd": str(_q2(remaining_total_usd)),
            "tax_loss_total_usd": str(_q2(tax_loss_total_usd)),
        },
        "collections": collections_data,
        "timeline": timeline,
    }


def _monthly_dashboard_data() -> list[dict]:
    monthly_map = defaultdict(lambda: {"expenses": Decimal("0"), "gains": Decimal("0"), "billed": Decimal("0")})

    expenses_month = (
        Expense.objects.annotate(month=TruncMonth("date")).values("month").annotate(total=Sum("amount_usd")).order_by("month")
    )
    for item in expenses_month:
        monthly_map[item["month"]]["expenses"] = item["total"] or Decimal("0")

    billed_collections = (
        JobCollection.objects.filter(status=JobCollection.Status.BILLED, parent_collection__isnull=True)
        .prefetch_related("jobs", "partial_collections")
        .select_related("job")
    )
    for collection in billed_collections:
        remaining = collection_remaining_usd(collection)
        if remaining <= Decimal("0"):
            continue
        reference_date = _collection_work_reference_date(collection)
        month = reference_date.replace(day=1)
        monthly_map[month]["billed"] += remaining

    collected_collections = (
        JobCollection.objects.filter(status=JobCollection.Status.COLLECTED)
        .prefetch_related("jobs")
        .select_related("job")
    )
    for collection in collected_collections:
        reference_date = _collection_work_reference_date(collection)
        month = reference_date.replace(day=1)
        monthly_map[month]["gains"] += collection.collected_amount_usd or collection.amount_usd or Decimal("0")

    return [
        {
            "month": month.strftime("%Y-%m"),
            "expenses": float(data["expenses"]),
            "gains": float(data["gains"]),
            "billed": float(data["billed"]),
        }
        for month, data in sorted(monthly_map.items())
        if month
    ]


def _q2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _alloc_by_weights(total_amount: Decimal, weighted_items: list[tuple[int, Decimal]]) -> dict[int, Decimal]:
    if not weighted_items:
        return {}
    total = _q2(total_amount)
    total_cents = int((total * Decimal("100")).to_integral_value(rounding=ROUND_HALF_UP))
    positive_items = [(key, Decimal(str(weight))) for key, weight in weighted_items if Decimal(str(weight)) > Decimal("0")]
    if not positive_items:
        return {key: Decimal("0.00") for key, _ in weighted_items}

    weight_sum = sum((weight for _, weight in positive_items), Decimal("0"))
    base_cents: dict[int, int] = {}
    remainders: list[tuple[Decimal, int]] = []
    assigned = 0
    for key, weight in positive_items:
        raw_cents = (Decimal(total_cents) * weight / weight_sum)
        floor_cents = int(raw_cents.to_integral_value(rounding=ROUND_DOWN))
        base_cents[key] = floor_cents
        assigned += floor_cents
        remainders.append((raw_cents - Decimal(floor_cents), key))

    missing = total_cents - assigned
    remainders.sort(key=lambda item: item[0], reverse=True)
    idx = 0
    while missing > 0 and remainders:
        _, key = remainders[idx % len(remainders)]
        base_cents[key] += 1
        missing -= 1
        idx += 1

    result: dict[int, Decimal] = {key: Decimal("0.00") for key, _ in weighted_items}
    for key, cents in base_cents.items():
        result[key] = _q2(Decimal(cents) / Decimal("100"))
    return result


def _parse_worker_percentages(raw_worker_percentages) -> dict[int, Decimal]:
    if raw_worker_percentages in (None, ""):
        return {}
    if not isinstance(raw_worker_percentages, dict):
        raise ApiValidationError("worker_percentages debe ser un objeto.")

    parsed: dict[int, Decimal] = {}
    for raw_key, raw_value in raw_worker_percentages.items():
        if raw_value in (None, ""):
            continue
        try:
            investor_id = int(raw_key)
        except (TypeError, ValueError) as exc:
            raise ApiValidationError("Las claves de worker_percentages deben ser IDs de inversor.") from exc
        try:
            parsed[investor_id] = Decimal(str(raw_value))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ApiValidationError("Los porcentajes de trabajo deben ser numéricos.") from exc
    return parsed


def _resolve_field_team_percentage(raw_field_team_percentage, worker_percentages: dict[int, Decimal]) -> Decimal:
    if raw_field_team_percentage not in (None, ""):
        try:
            return Decimal(str(raw_field_team_percentage))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ApiValidationError("El porcentaje para equipo de campo debe ser numérico.") from exc
    return sum((value for value in worker_percentages.values()), Decimal("0"))


def _investor_capital_snapshot(on_date: date) -> list[dict]:
    rows: list[dict] = []
    investors = list(Investor.objects.filter(active=True).order_by("name"))
    total_capital = Decimal("0")
    for inv in investors:
        expenses_paid = (
            Expense.objects.filter(
                paid_by=Expense.PaidBy.INVESTOR,
                payer_investor=inv,
                date__lte=on_date,
            ).aggregate(total=Sum("amount_usd"))["total"]
            or Decimal("0")
        )
        direct = (
            inv.capital_contributions.filter(
                kind=CapitalContribution.Kind.DIRECT,
                date__lte=on_date,
            ).aggregate(total=Sum("amount_usd"))["total"]
            or Decimal("0")
        )
        reinvested = (
            inv.capital_contributions.filter(
                kind=CapitalContribution.Kind.REINVESTMENT,
                date__lte=on_date,
            ).aggregate(total=Sum("amount_usd"))["total"]
            or Decimal("0")
        )
        withdrawn = (
            inv.capital_contributions.filter(
                kind=CapitalContribution.Kind.WITHDRAWAL,
                date__lte=on_date,
            ).aggregate(total=Sum("amount_usd"))["total"]
            or Decimal("0")
        )
        capital = expenses_paid + direct + reinvested - withdrawn
        if capital < Decimal("0"):
            capital = Decimal("0")
        rows.append({"investor": inv, "capital": capital})
        total_capital += capital

    if not rows:
        return []
    if total_capital <= Decimal("0"):
        equal = Decimal("1") / Decimal(len(rows))
        for row in rows:
            row["company_percentage"] = equal
    else:
        for row in rows:
            row["company_percentage"] = row["capital"] / total_capital
    return rows


def _build_distribution_plan(
    *,
    collection: JobCollection,
    field_team_percentage: Decimal,
    worker_investor_ids: list[int],
    worker_percentages: dict[int, Decimal] | None = None,
) -> dict:
    if field_team_percentage < Decimal("0") or field_team_percentage > Decimal("100"):
        raise ApiValidationError("El porcentaje para equipo de campo debe estar entre 0 y 100.")
    if collection.status != JobCollection.Status.COLLECTED:
        raise ApiValidationError("Solo podés distribuir cobros en estado Cobrado.")

    target = _q2(collection.collected_amount_usd or collection.amount_usd or Decimal("0"))
    if target <= Decimal("0"):
        raise ApiValidationError("El cobro no tiene monto disponible para distribuir.")

    active_investor_map = {inv.id: inv for inv in Investor.objects.filter(active=True)}
    worker_investor_ids = list(dict.fromkeys(iid for iid in worker_investor_ids if iid in active_investor_map))
    worker_percentages = worker_percentages or {}
    if field_team_percentage > Decimal("0") and not worker_investor_ids:
        raise ApiValidationError("Indicá al menos una persona para equipo de campo.")

    field_team_total = _q2(target * field_team_percentage / Decimal("100"))
    shareholder_total = _q2(target - field_team_total)

    if worker_percentages:
        missing = [iid for iid in worker_investor_ids if iid not in worker_percentages]
        if missing:
            raise ApiValidationError("Indicá % de trabajo para cada persona seleccionada.")
        worker_weights: list[tuple[int, Decimal]] = []
        for iid in worker_investor_ids:
            weight = worker_percentages[iid]
            if weight <= Decimal("0"):
                raise ApiValidationError("Cada % de trabajo debe ser mayor a 0.")
            worker_weights.append((iid, weight))
        total_worker_percentage = sum((weight for _, weight in worker_weights), Decimal("0"))
        if abs(total_worker_percentage - field_team_percentage) > Decimal("0.01"):
            raise ApiValidationError("Los % de trabajo no coinciden con el total distribuido al equipo de campo.")
    else:
        worker_weights = [(iid, Decimal("1")) for iid in worker_investor_ids]

    worker_alloc = _alloc_by_weights(
        field_team_total,
        worker_weights,
    )
    worker_percentage_alloc = _alloc_by_weights(field_team_percentage, worker_weights)
    field_team_rows = [
        {
            "investor_id": iid,
            "investor_name": active_investor_map[iid].name,
            "worker_percentage": worker_percentage_alloc.get(iid, Decimal("0.00")),
            "amount_usd": worker_alloc.get(iid, Decimal("0.00")),
        }
        for iid in worker_investor_ids
    ]

    percentage_reference_date = _collection_work_reference_date(collection)
    snapshot = _investor_capital_snapshot(percentage_reference_date)
    shareholder_alloc = _alloc_by_weights(
        shareholder_total,
        [(row["investor"].id, row["company_percentage"]) for row in snapshot],
    )
    shareholder_rows = []
    worker_by_investor = {row["investor_id"]: row["amount_usd"] for row in field_team_rows}
    investor_rows = []
    for row in snapshot:
        investor = row["investor"]
        shareholder_amount = shareholder_alloc.get(investor.id, Decimal("0.00"))
        worker_amount = worker_by_investor.get(investor.id, Decimal("0.00"))
        total_amount = _q2(shareholder_amount + worker_amount)
        shareholder_rows.append(
            {
                "investor_id": investor.id,
                "investor_name": investor.name,
                "company_percentage": row["company_percentage"] * Decimal("100"),
                "amount_usd": shareholder_amount,
            }
        )
        investor_rows.append(
            {
                "investor_id": investor.id,
                "investor_name": investor.name,
                "company_percentage": row["company_percentage"] * Decimal("100"),
                "worker_amount_usd": worker_amount,
                "shareholder_amount_usd": shareholder_amount,
                "total_amount_usd": total_amount,
            }
        )

    return {
        "collection_id": collection.id,
        "target_usd": target,
        "field_team_percentage": field_team_percentage,
        "field_team_total_usd": field_team_total,
        "shareholder_total_usd": shareholder_total,
        "percentage_reference_date": percentage_reference_date,
        "field_team_rows": field_team_rows,
        "shareholder_rows": shareholder_rows,
        "investor_rows": investor_rows,
    }


def recompute_job_status(job: Job) -> None:
    if job.status == Job.Status.CANCELLED:
        return
    collections = list(
        JobCollection.objects.filter(jobs=job).prefetch_related("partial_collections")
    )
    has_open_billed = any(
        collection_has_open_balance(collection) for collection in collections if not collection.parent_collection_id
    )
    has_collected = any(collection.status == JobCollection.Status.COLLECTED for collection in collections)

    new_status = job.status
    if has_open_billed:
        new_status = Job.Status.INVOICED
    elif has_collected:
        new_status = Job.Status.COLLECTED
    elif job.status in {Job.Status.INVOICED, Job.Status.COLLECTED}:
        new_status = Job.Status.DONE

    if new_status != job.status:
        job.status = new_status
        job.save(update_fields=["status"])


def recompute_jobs_from_collection(collection: JobCollection) -> None:
    for job in _collection_jobs(collection):
        recompute_job_status(job)


def sync_payment_obligation_status(obligation_id: int | None) -> None:
    if not obligation_id:
        return
    obligation = PaymentObligation.objects.filter(id=obligation_id).first()
    if not obligation:
        return
    if obligation.status == PaymentObligation.Status.CANCELLED:
        return

    paid = Decimal("0")
    if obligation.currency == Currency.ARS:
        target = obligation.amount or Decimal("0")
        for exp in obligation.expenses.all():
            if exp.currency == Currency.ARS:
                paid += exp.amount or Decimal("0")
            else:
                fx = exp.fx_ars_usd or Decimal("0")
                paid += (exp.amount * fx) if fx else Decimal("0")
    else:
        target = obligation.estimated_amount_usd or Decimal("0")
        for exp in obligation.expenses.all():
            if exp.currency == Currency.USD:
                paid += exp.amount or Decimal("0")
            else:
                fx = exp.fx_ars_usd or Decimal("0")
                paid += (exp.amount / fx) if fx else Decimal("0")
    epsilon = Decimal("0.01")

    if paid >= (target - epsilon):
        new_status = PaymentObligation.Status.PAID
    elif paid > Decimal("0"):
        new_status = PaymentObligation.Status.PARTIAL
    else:
        new_status = PaymentObligation.Status.PENDING

    if obligation.status != new_status:
        obligation.status = new_status
        obligation.save(update_fields=["status"])


def add_months(base_date: date, months: int) -> date:
    month = base_date.month - 1 + months
    year = base_date.year + month // 12
    month = month % 12 + 1
    day = min(base_date.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def sync_purchase_installments(purchase: Purchase) -> None:
    auto_qs = purchase.obligations.filter(source=PaymentObligation.Source.PURCHASE_INSTALLMENT)
    has_paid_links = auto_qs.filter(expenses__isnull=False).exists()

    installment_count = int(purchase.installment_count or 0)
    if installment_count <= 0 or not purchase.first_due_date:
        if has_paid_links:
            raise ApiValidationError(
                "Esta compra ya tiene cuotas con pagos asociados; no podés quitar cuotas automáticamente."
            )
        auto_qs.delete()
        return

    existing = list(auto_qs.order_by("installment_number", "id"))
    existing_count = len(existing)
    if existing_count:
        if has_paid_links and existing_count != installment_count:
            raise ApiValidationError(
                "Esta compra ya tiene cuotas con pagos asociados; no podés cambiar cantidad de cuotas."
            )
        if installment_count < existing_count:
            to_remove = existing[installment_count:]
            if any(ob.expenses.exists() for ob in to_remove):
                raise ApiValidationError(
                    "No podés quitar cuotas que ya tienen pagos asociados."
                )
            PaymentObligation.objects.filter(id__in=[ob.id for ob in to_remove]).delete()
            existing = existing[:installment_count]
        elif installment_count > existing_count:
            missing = installment_count - existing_count
            due_base = purchase.first_due_date
            if not due_base:
                raise ApiValidationError("Indicá primer vencimiento para generar cuotas.")
            allocated = sum((ob.amount or Decimal("0")) for ob in existing)
            remaining = purchase.total_amount - allocated
            if remaining < Decimal("0"):
                remaining = Decimal("0")
            remaining_cents = int((remaining * Decimal("100")).to_integral_value(rounding=ROUND_HALF_UP))
            cents_per_installment, remainder = divmod(remaining_cents, missing)
            new_rows = []
            for idx in range(existing_count, installment_count):
                cents = cents_per_installment + (1 if (idx - existing_count) < remainder else 0)
                amount = (Decimal(cents) / Decimal("100")).quantize(Decimal("0.01"))
                if purchase.total_currency == Currency.USD:
                    estimated_usd = amount
                else:
                    fx = purchase.fx_ars_usd or Decimal("1")
                    estimated_usd = (amount / fx).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                new_rows.append(
                    PaymentObligation(
                        source=PaymentObligation.Source.PURCHASE_INSTALLMENT,
                        purchase=purchase,
                        concept=f"Cuota {idx + 1}/{installment_count} - {purchase.concept}",
                        installment_number=idx + 1,
                        installment_total=installment_count,
                        due_date=add_months(due_base, idx),
                        amount=amount,
                        currency=purchase.total_currency,
                        estimated_amount_usd=estimated_usd,
                        status=PaymentObligation.Status.PENDING,
                    )
                )
            PaymentObligation.objects.bulk_create(new_rows)
            existing.extend(new_rows)

        # Keep manually edited amounts/due dates intact; only keep numbering/total consistent.
        for idx, obligation in enumerate(existing, start=1):
            changed_fields = []
            if obligation.installment_number != idx:
                obligation.installment_number = idx
                changed_fields.append("installment_number")
            if obligation.installment_total != installment_count:
                obligation.installment_total = installment_count
                changed_fields.append("installment_total")
            if changed_fields:
                obligation.save(update_fields=changed_fields)
        return

    auto_qs.delete()

    total_cents = int((purchase.total_amount * Decimal("100")).to_integral_value(rounding=ROUND_HALF_UP))
    cents_per_installment, remainder = divmod(total_cents, installment_count)

    obligations = []
    for idx in range(installment_count):
        cents = cents_per_installment + (1 if idx < remainder else 0)
        amount = (Decimal(cents) / Decimal("100")).quantize(Decimal("0.01"))
        if purchase.total_currency == "USD":
            estimated_usd = amount
        else:
            fx = purchase.fx_ars_usd or Decimal("1")
            estimated_usd = (amount / fx).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        obligations.append(
            PaymentObligation(
                source=PaymentObligation.Source.PURCHASE_INSTALLMENT,
                purchase=purchase,
                concept=f"Cuota {idx + 1}/{installment_count} - {purchase.concept}",
                installment_number=idx + 1,
                installment_total=installment_count,
                due_date=add_months(purchase.first_due_date, idx),
                amount=amount,
                currency=purchase.total_currency,
                estimated_amount_usd=estimated_usd,
                status=PaymentObligation.Status.PENDING,
            )
        )
    PaymentObligation.objects.bulk_create(obligations)


def sync_capital_contribution_from_cash_movement(movement: CashMovement) -> None:
    CapitalContribution.objects.filter(cash_movement=movement).delete()
    if not movement.investor_id:
        return

    if movement.category == CashMovement.Category.CAPITAL_CONTRIBUTION:
        CapitalContribution.objects.create(
            date=movement.date,
            investor=movement.investor,
            kind=CapitalContribution.Kind.DIRECT,
            amount_usd=movement.amount_usd,
            cash_movement=movement,
            notes=movement.notes or "Aporte de capital desde caja",
        )
        return

    if movement.category == CashMovement.Category.PROFIT_REINVESTMENT:
        CapitalContribution.objects.create(
            date=movement.date,
            investor=movement.investor,
            kind=CapitalContribution.Kind.REINVESTMENT,
            amount_usd=movement.amount_usd,
            cash_movement=movement,
            notes=movement.notes or "Reinversión desde distribución",
        )
        return

    if movement.category == CashMovement.Category.CAPITAL_RESCUE:
        CapitalContribution.objects.create(
            date=movement.date,
            investor=movement.investor,
            kind=CapitalContribution.Kind.WITHDRAWAL,
            amount_usd=movement.amount_usd,
            cash_movement=movement,
            notes=movement.notes or "Rescate de capital",
        )


def sync_cash_movement_for_expense(expense: Expense) -> None:
    existing = CashMovement.objects.filter(expense=expense).first()
    if expense.paid_by != Expense.PaidBy.CASH:
        if existing:
            existing.delete()
        return
    if existing:
        existing.date = expense.date
        existing.direction = CashMovement.Direction.OUT
        existing.category = CashMovement.Category.EXPENSE
        existing.currency = expense.currency
        existing.amount_original = expense.amount
        existing.fx_ars_usd = expense.fx_ars_usd if expense.currency == Currency.ARS else None
        existing.amount_usd = expense.amount_usd
        existing.investor = None
        existing.notes = expense.notes or f"Gasto desde caja: {expense.concept}"
        existing.save()
        return
    CashMovement.objects.create(
        date=expense.date,
        direction=CashMovement.Direction.OUT,
        category=CashMovement.Category.EXPENSE,
        currency=expense.currency,
        amount_original=expense.amount,
        fx_ars_usd=expense.fx_ars_usd if expense.currency == Currency.ARS else None,
        amount_usd=expense.amount_usd,
        expense=expense,
        notes=expense.notes or f"Gasto desde caja: {expense.concept}",
    )


def _delete_collection_settlement_side_effects(collection: JobCollection) -> None:
    tag = f"[settlement:{collection.id}]"
    CashMovement.objects.filter(notes__contains=tag).delete()
    CapitalContribution.objects.filter(notes__contains=tag).delete()


def _materialize_collection_settlement_side_effects(collection: JobCollection) -> None:
    tag = f"[settlement:{collection.id}]"
    distributions = list(collection.distributions.select_related("investor").all())
    jobs = _collection_jobs(collection)
    job_label = " + ".join([f"#{job.id}" for job in jobs]) if jobs else f"#{collection.id}"
    keep_cash_in_ars = collection.collected_currency == Currency.ARS and not bool(collection.converted_to_usd)
    fx_for_ars = collection.collected_fx_ars_usd or collection.fx_ars_usd

    def create_reinvestment_movement(investor: Investor, amount_usd: Decimal) -> None:
        amount_usd = (amount_usd or Decimal("0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if amount_usd <= Decimal("0"):
            return

        currency = Currency.USD
        amount_original = amount_usd
        fx_value = None
        if keep_cash_in_ars and fx_for_ars and fx_for_ars > Decimal("0"):
            currency = Currency.ARS
            fx_value = fx_for_ars.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            amount_original = (amount_usd * fx_value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        movement = CashMovement.objects.create(
            date=collection.collection_date,
            direction=CashMovement.Direction.IN,
            category=CashMovement.Category.PROFIT_REINVESTMENT,
            currency=currency,
            amount_original=amount_original,
            fx_ars_usd=fx_value,
            amount_usd=amount_usd,
            investor=investor,
            notes=f"{tag} Redistribución ganancias trabajo {job_label} - reinversión {investor.name}",
        )
        sync_capital_contribution_from_cash_movement(movement)

    # Caja refleja solo reinversión efectiva por socio.
    for distribution in distributions:
        dist_amount = distribution.amount_usd or Decimal("0")
        reinvest = distribution.reinvest_to_cash_usd or Decimal("0")

        if distribution.kind == JobDistribution.Kind.SHAREHOLDER and distribution.investor_id and reinvest > Decimal("0"):
            create_reinvestment_movement(distribution.investor, reinvest)
            continue

        if distribution.kind == JobDistribution.Kind.REINVESTMENT and distribution.investor_id and dist_amount > Decimal("0"):
            create_reinvestment_movement(distribution.investor, dist_amount)


def close_collection_liquidation(collection: JobCollection) -> None:
    distributions = list(collection.distributions.select_related("investor").all())
    total_assigned = sum((d.amount_usd or Decimal("0")) for d in distributions)
    target = collection.collected_amount_usd or collection.amount_usd or Decimal("0")
    if abs(total_assigned - target) > Decimal("0.01"):
        raise ApiValidationError(
            f"La suma distribuida ({total_assigned}) no coincide con el cobro ({target}). Ajustá distribuciones antes de cerrar."
        )

    _delete_collection_settlement_side_effects(collection)
    _materialize_collection_settlement_side_effects(collection)


class LoginApiView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, _ = Token.objects.get_or_create(user=user)
        investor = Investor.objects.filter(name__iexact=user.username, active=True).first()
        return Response(
            {
                "token": token.key,
                "user": {"id": user.id, "username": user.username, "email": user.email},
                "investor_id": investor.id if investor else None,
            }
        )


class FxQuoteApiView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        date_str = request.query_params.get("date")
        if date_str:
            try:
                requested_date = date.fromisoformat(date_str)
            except ValueError:
                return Response({"detail": "Parámetro date inválido (usar YYYY-MM-DD)."}, status=400)
        else:
            requested_date = date.today()

        try:
            ars_per_usd, used_date = get_ars_per_usd(requested_date)
        except ValidationError as exc:
            return Response({"detail": str(exc)}, status=400)
        ExchangeRate.objects.update_or_create(
            date=used_date,
            defaults={
                "ars_per_usd": ars_per_usd,
                "source": "bcra",
            },
        )

        usd_per_ars = (Decimal("1") / ars_per_usd) if ars_per_usd else Decimal("0")
        return Response(
            {
                "requested_date": requested_date.isoformat(),
                "rate_date": used_date.isoformat(),
                "ars_per_usd": float(ars_per_usd),
                "usd_per_ars": float(usd_per_ars),
                "source": "bcra",
            }
        )


class BaseViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]


class InvestorViewSet(BaseViewSet):
    queryset = Investor.objects.all()
    serializer_class = InvestorSerializer


class ClientViewSet(BaseViewSet):
    queryset = Client.objects.all()
    serializer_class = ClientSerializer


class ExchangeRateViewSet(BaseViewSet):
    queryset = ExchangeRate.objects.all()
    serializer_class = ExchangeRateSerializer


class CapitalContributionViewSet(BaseViewSet):
    queryset = CapitalContribution.objects.select_related("investor").all()
    serializer_class = CapitalContributionSerializer


class CashMovementViewSet(BaseViewSet):
    queryset = CashMovement.objects.select_related("investor", "expense", "job_distribution").all()
    serializer_class = CashMovementSerializer

    def perform_create(self, serializer):
        movement = serializer.save()
        sync_capital_contribution_from_cash_movement(movement)

    def perform_update(self, serializer):
        movement = serializer.save()
        sync_capital_contribution_from_cash_movement(movement)

    def perform_destroy(self, instance):
        CapitalContribution.objects.filter(cash_movement=instance).delete()
        instance.delete()


class PurchaseViewSet(BaseViewSet):
    queryset = Purchase.objects.all()
    serializer_class = PurchaseSerializer

    def perform_create(self, serializer):
        purchase = serializer.save()
        sync_purchase_installments(purchase)

    def perform_update(self, serializer):
        purchase = serializer.save()
        sync_purchase_installments(purchase)


class PaymentObligationViewSet(BaseViewSet):
    queryset = PaymentObligation.objects.select_related("purchase").all()
    serializer_class = PaymentObligationSerializer

    def perform_create(self, serializer):
        source = serializer.validated_data.get("source", PaymentObligation.Source.MANUAL)
        if source == PaymentObligation.Source.PURCHASE_INSTALLMENT:
            raise ApiValidationError("Las cuotas de compra se generan únicamente desde Compras.")
        serializer.save()

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        if instance.source == PaymentObligation.Source.PURCHASE_INSTALLMENT:
            raise ApiValidationError("Las cuotas de compra se eliminan únicamente desde Compras.")
        instance.delete()


class ExpenseViewSet(BaseViewSet):
    queryset = Expense.objects.select_related("payer_investor", "purchase", "payment_obligation").all()
    serializer_class = ExpenseSerializer

    def perform_create(self, serializer):
        expense = serializer.save()
        sync_payment_obligation_status(expense.payment_obligation_id)
        sync_cash_movement_for_expense(expense)

    def perform_update(self, serializer):
        prev = self.get_object()
        prev_obligation_id = prev.payment_obligation_id
        expense = serializer.save()
        sync_payment_obligation_status(prev_obligation_id)
        sync_payment_obligation_status(expense.payment_obligation_id)
        sync_cash_movement_for_expense(expense)

    def perform_destroy(self, instance):
        obligation_id = instance.payment_obligation_id
        CashMovement.objects.filter(expense=instance).delete()
        instance.delete()
        sync_payment_obligation_status(obligation_id)


class JobViewSet(BaseViewSet):
    queryset = Job.objects.all()
    serializer_class = JobSerializer

    @action(detail=True, methods=["get"], url_path="detail")
    def job_detail(self, _request, pk=None):
        job = self.get_object()
        return Response(_job_detail_payload(job))

    @action(detail=True, methods=["post"], url_path="mark-done")
    def mark_done(self, request, pk=None):
        job = self.get_object()
        if job.status == Job.Status.CANCELLED:
            raise ApiValidationError("No podés marcar realizado un trabajo cancelado.")
        job.status = Job.Status.DONE
        job.save(update_fields=["status"])
        return Response({"detail": "Trabajo marcado como realizado."})

    @action(detail=True, methods=["post"], url_path="mark-pending")
    def mark_pending(self, request, pk=None):
        job = self.get_object()
        if job.status == Job.Status.CANCELLED:
            raise ApiValidationError("No podés pasar a pendiente un trabajo cancelado.")
        if JobCollection.objects.filter(jobs=job).exists():
            raise ApiValidationError("Este trabajo ya tiene factura/cobro asociado. No se puede volver a pendiente.")
        job.status = Job.Status.PENDING
        job.save(update_fields=["status"])
        return Response({"detail": "Trabajo marcado como pendiente."})


class JobCollectionViewSet(BaseViewSet):
    queryset = JobCollection.objects.select_related("job", "parent_collection").prefetch_related("jobs", "partial_collections").all()
    serializer_class = JobCollectionSerializer

    def perform_create(self, serializer):
        collection = serializer.save()
        recompute_jobs_from_collection(collection)

    def perform_update(self, serializer):
        collection = serializer.save()
        recompute_jobs_from_collection(collection)
        close_collection_liquidation(collection)

    def perform_destroy(self, instance):
        related_collections = [instance]
        if not instance.parent_collection_id:
            related_collections.extend(list(instance.partial_collections.all()))

        related_jobs_map = {}
        for collection in related_collections:
            for job in _collection_jobs(collection):
                related_jobs_map[job.id] = job

        dist_ids = list(JobDistribution.objects.filter(collection__in=related_collections).values_list("id", flat=True))
        if dist_ids:
            movements = CashMovement.objects.filter(job_distribution_id__in=dist_ids)
            CapitalContribution.objects.filter(cash_movement__in=movements).delete()
            movements.delete()
        for collection in related_collections:
            _delete_collection_settlement_side_effects(collection)
        instance.delete()
        for job in related_jobs_map.values():
            recompute_job_status(job)

    @action(detail=True, methods=["post"], url_path="mark-collected")
    def mark_collected(self, request, pk=None):
        collection = self.get_object()
        if collection.parent_collection_id:
            raise ApiValidationError("No podés registrar un cobro sobre un cobro parcial existente.")
        if collection.status != JobCollection.Status.BILLED:
            raise ApiValidationError("Solo podés registrar cobros sobre facturas pendientes.")

        remaining = collection_remaining_usd(collection)
        if remaining <= Decimal("0"):
            raise ApiValidationError("La factura no tiene saldo pendiente.")

        raw_collected = request.data.get("collected_amount_usd")
        raw_currency = request.data.get("collected_currency") or Currency.USD
        raw_original = request.data.get("collected_amount_original")
        raw_fx = request.data.get("collected_fx_ars_usd")
        raw_converted = request.data.get("converted_to_usd")
        raw_close_remaining = request.data.get("close_remaining")
        raw_date = request.data.get("collection_date")
        if raw_converted is None:
            converted_to_usd = True
        elif isinstance(raw_converted, bool):
            converted_to_usd = raw_converted
        else:
            converted_to_usd = str(raw_converted).strip().lower() in {"1", "true", "t", "yes", "si", "sí"}
        if raw_close_remaining is None:
            close_remaining = False
        elif isinstance(raw_close_remaining, bool):
            close_remaining = raw_close_remaining
        else:
            close_remaining = str(raw_close_remaining).strip().lower() in {"1", "true", "t", "yes", "si", "sí"}

        original = Decimal(str(raw_original)) if raw_original not in (None, "") else remaining
        if original <= Decimal("0"):
            raise ApiValidationError("El monto cobrado original debe ser mayor a 0.")
        if raw_currency not in {Currency.USD, Currency.ARS}:
            raise ApiValidationError("Moneda de cobro inválida.")
        if raw_currency == Currency.ARS:
            fx = Decimal(str(raw_fx or 0))
            if fx <= Decimal("0"):
                raise ApiValidationError("Para cobros en ARS, indicá TC ARS/USD válido.")
            collected = (original / fx).quantize(Decimal("0.01"))
        else:
            fx = None
            collected = Decimal(str(raw_collected)) if raw_collected not in (None, "") else original
        if collected <= Decimal("0"):
            raise ApiValidationError("El monto cobrado en USD debe ser mayor a 0.")
        if collected > remaining:
            raise ApiValidationError("El monto cobrado no puede superar el saldo pendiente.")

        if raw_date:
            try:
                payment_date = date.fromisoformat(str(raw_date))
            except ValueError as exc:
                raise ApiValidationError("Fecha de cobro inválida. Usá YYYY-MM-DD.") from exc
        else:
            payment_date = collection.collection_date

        settled_amount = remaining if close_remaining else collected
        if settled_amount > remaining:
            settled_amount = remaining
        if settled_amount < collected:
            raise ApiValidationError("El tramo liquidado no puede ser menor al monto efectivamente cobrado.")

        settled_amount = settled_amount.quantize(Decimal("0.01"))
        collected = collected.quantize(Decimal("0.01"))
        original = original.quantize(Decimal("0.01"))
        tax_loss = (settled_amount - collected).quantize(Decimal("0.01"))
        settled_ars = collection_settled_slice_ars(collection, settled_amount)

        with transaction.atomic():
            partial_collection = JobCollection.objects.create(
                job=collection.job,
                parent_collection=collection,
                collection_date=payment_date,
                amount_ars=settled_ars,
                fx_ars_usd=collection.fx_ars_usd,
                amount_usd=settled_amount,
                collected_currency=raw_currency,
                collected_amount_original=original,
                collected_fx_ars_usd=fx.quantize(Decimal("0.0001")) if fx else None,
                converted_to_usd=converted_to_usd,
                collected_amount_usd=collected,
                tax_loss_usd=tax_loss,
                status=JobCollection.Status.COLLECTED,
                notes=collection.notes,
            )
            parent_jobs = list(collection.jobs.all())
            if parent_jobs:
                partial_collection.jobs.set(parent_jobs)
            elif collection.job_id:
                partial_collection.jobs.set([collection.job_id])

        recompute_jobs_from_collection(collection)
        recompute_jobs_from_collection(partial_collection)
        remaining_after = collection_remaining_usd(collection)
        if remaining_after > Decimal("0"):
            detail = "Cobro parcial registrado."
        else:
            detail = "Cobro registrado y factura saldada."
        return Response(
            {
                "detail": detail,
                "collection_id": partial_collection.id,
                "remaining_amount_usd": str(remaining_after),
            }
        )

    @action(detail=True, methods=["post"], url_path="distribution-preview")
    def distribution_preview(self, request, pk=None):
        collection = self.get_object()
        worker_percentages = _parse_worker_percentages(request.data.get("worker_percentages"))
        field_team_percentage = _resolve_field_team_percentage(request.data.get("field_team_percentage"), worker_percentages)
        worker_investor_ids = request.data.get("worker_investor_ids") or []
        if not isinstance(worker_investor_ids, list):
            raise ApiValidationError("worker_investor_ids debe ser una lista.")
        worker_ids = [int(i) for i in worker_investor_ids if str(i).strip()]
        plan = _build_distribution_plan(
            collection=collection,
            field_team_percentage=field_team_percentage,
            worker_investor_ids=worker_ids,
            worker_percentages=worker_percentages,
        )
        return Response(
            {
                "collection_id": plan["collection_id"],
                "target_usd": float(plan["target_usd"]),
                "field_team_percentage": float(plan["field_team_percentage"]),
                "field_team_total_usd": float(plan["field_team_total_usd"]),
                "shareholder_total_usd": float(plan["shareholder_total_usd"]),
                "percentage_reference_date": plan["percentage_reference_date"].isoformat(),
                "field_team_rows": [
                    {
                        "investor_id": row["investor_id"],
                        "investor_name": row["investor_name"],
                        "worker_percentage": float(row["worker_percentage"]),
                        "amount_usd": float(row["amount_usd"]),
                    }
                    for row in plan["field_team_rows"]
                ],
                "shareholder_rows": [
                    {
                        "investor_id": row["investor_id"],
                        "investor_name": row["investor_name"],
                        "company_percentage": float(row["company_percentage"]),
                        "amount_usd": float(row["amount_usd"]),
                    }
                    for row in plan["shareholder_rows"]
                ],
                "investor_rows": [
                    {
                        "investor_id": row["investor_id"],
                        "investor_name": row["investor_name"],
                        "company_percentage": float(row["company_percentage"]),
                        "worker_amount_usd": float(row["worker_amount_usd"]),
                        "shareholder_amount_usd": float(row["shareholder_amount_usd"]),
                        "total_amount_usd": float(row["total_amount_usd"]),
                    }
                    for row in plan["investor_rows"]
                ],
            }
        )

    @action(detail=True, methods=["post"], url_path="apply-distribution")
    def apply_distribution(self, request, pk=None):
        collection = self.get_object()
        worker_percentages = _parse_worker_percentages(request.data.get("worker_percentages"))
        field_team_percentage = _resolve_field_team_percentage(request.data.get("field_team_percentage"), worker_percentages)
        worker_investor_ids = request.data.get("worker_investor_ids") or []
        if not isinstance(worker_investor_ids, list):
            raise ApiValidationError("worker_investor_ids debe ser una lista.")
        worker_ids = [int(i) for i in worker_investor_ids if str(i).strip()]
        raw_withdrawals = request.data.get("withdrawals_by_investor") or {}
        if not isinstance(raw_withdrawals, dict):
            raise ApiValidationError("withdrawals_by_investor debe ser un objeto.")

        plan = _build_distribution_plan(
            collection=collection,
            field_team_percentage=field_team_percentage,
            worker_investor_ids=worker_ids,
            worker_percentages=worker_percentages,
        )

        with transaction.atomic():
            existing_ids = list(collection.distributions.values_list("id", flat=True))
            if existing_ids:
                movements = CashMovement.objects.filter(job_distribution_id__in=existing_ids)
                CapitalContribution.objects.filter(cash_movement__in=movements).delete()
                movements.delete()
                collection.distributions.all().delete()

            created: list[JobDistribution] = []
            for row in plan["investor_rows"]:
                amount = row["total_amount_usd"]
                if amount <= Decimal("0"):
                    continue
                raw_withdraw = raw_withdrawals.get(str(row["investor_id"]), raw_withdrawals.get(row["investor_id"], 0))
                withdraw = Decimal(str(raw_withdraw or 0))
                if withdraw < Decimal("0"):
                    raise ApiValidationError("El retiro no puede ser negativo.")
                if withdraw > amount:
                    raise ApiValidationError(f"El retiro de {row['investor_name']} no puede superar su monto asignado.")
                reinvest = _q2(amount - withdraw)
                dist = JobDistribution.objects.create(
                    collection=collection,
                    investor_id=row["investor_id"],
                    kind=JobDistribution.Kind.SHAREHOLDER,
                    amount_usd=amount,
                    work_amount_usd=_q2(row["worker_amount_usd"]),
                    shareholder_amount_usd=_q2(row["shareholder_amount_usd"]),
                    percentage=_q2(row["company_percentage"]),
                    reinvest_to_cash_usd=reinvest,
                    notes=(
                        "Distribución automática "
                        f"(trabajo USD {_q2(row['worker_amount_usd'])} + accionista USD {_q2(row['shareholder_amount_usd'])})"
                    ),
                )
                created.append(dist)
            close_collection_liquidation(collection)

        serializer = JobDistributionSerializer(created, many=True)
        return Response(
            {
                "detail": "Distribución aplicada.",
                "distributions": serializer.data,
            }
        )


class JobDistributionViewSet(BaseViewSet):
    queryset = JobDistribution.objects.select_related("collection", "investor").all()
    serializer_class = JobDistributionSerializer

    def perform_create(self, serializer):
        distribution = serializer.save()
        close_collection_liquidation(distribution.collection)

    def perform_update(self, serializer):
        distribution = serializer.save()
        close_collection_liquidation(distribution.collection)

    def perform_destroy(self, instance):
        collection = instance.collection
        CashMovement.objects.filter(job_distribution=instance).delete()
        instance.delete()
        close_collection_liquidation(collection)


class ReinvestmentViewSet(BaseViewSet):
    queryset = Reinvestment.objects.select_related("investor").all()
    serializer_class = ReinvestmentSerializer


class DashboardViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, _request):
        today = date.today()
        cap_table = []
        total_contributions = Decimal("0")
        for inv in Investor.objects.filter(active=True).order_by("name"):
            expenses_paid = (
                Expense.objects.filter(paid_by=Expense.PaidBy.INVESTOR, payer_investor=inv).aggregate(total=Sum("amount_usd"))["total"]
                or Decimal("0")
            )
            direct = (
                inv.capital_contributions.filter(kind=CapitalContribution.Kind.DIRECT).aggregate(total=Sum("amount_usd"))["total"]
                or Decimal("0")
            )
            reinvested = (
                inv.capital_contributions.filter(kind=CapitalContribution.Kind.REINVESTMENT).aggregate(total=Sum("amount_usd"))["total"]
                or Decimal("0")
            )
            withdrawn = (
                inv.capital_contributions.filter(kind=CapitalContribution.Kind.WITHDRAWAL).aggregate(total=Sum("amount_usd"))["total"]
                or Decimal("0")
            )
            contrib = expenses_paid + reinvested + direct - withdrawn
            total_contributions += contrib
            cap_table.append(
                {
                    "investor_id": inv.id,
                    "investor_name": inv.name,
                    "expenses_paid_usd": float(expenses_paid),
                    "reinvested_usd": float(reinvested),
                    "direct_usd": float(direct),
                    "withdrawn_usd": float(withdrawn),
                    "contribution_usd": float(contrib),
                    "percentage": 0.0,
                }
            )

        if total_contributions:
            for row in cap_table:
                row["percentage"] = float(Decimal(str(row["contribution_usd"])) / total_contributions * Decimal("100"))

        cash_in = CashMovement.objects.filter(direction=CashMovement.Direction.IN).aggregate(total=Sum("amount_usd"))["total"] or Decimal("0")
        cash_out = CashMovement.objects.filter(direction=CashMovement.Direction.OUT).aggregate(total=Sum("amount_usd"))["total"] or Decimal("0")
        cash_balance = cash_in - cash_out
        cash_ars_in = (
            CashMovement.objects.filter(direction=CashMovement.Direction.IN, currency=Currency.ARS).aggregate(total=Sum("amount_original"))["total"]
            or Decimal("0")
        )
        cash_ars_out = (
            CashMovement.objects.filter(direction=CashMovement.Direction.OUT, currency=Currency.ARS).aggregate(total=Sum("amount_original"))["total"]
            or Decimal("0")
        )
        cash_usd_in = (
            CashMovement.objects.filter(direction=CashMovement.Direction.IN, currency=Currency.USD).aggregate(total=Sum("amount_original"))["total"]
            or Decimal("0")
        )
        cash_usd_out = (
            CashMovement.objects.filter(direction=CashMovement.Direction.OUT, currency=Currency.USD).aggregate(total=Sum("amount_original"))["total"]
            or Decimal("0")
        )
        cash_balance_ars = cash_ars_in - cash_ars_out
        cash_balance_usd = cash_usd_in - cash_usd_out

        total_expenses = Expense.objects.aggregate(total=Sum("amount_usd"))["total"] or Decimal("0")
        total_reinvestments = (
            CapitalContribution.objects.filter(kind=CapitalContribution.Kind.REINVESTMENT).aggregate(total=Sum("amount_usd"))["total"]
            or Decimal("0")
        )

        monthly_data = _monthly_dashboard_data()

        # Pipeline comercial
        jobs_pending = Job.objects.filter(status=Job.Status.PENDING).count()
        jobs_done_uninvoiced_qs = Job.objects.filter(status=Job.Status.DONE)
        jobs_done_uninvoiced = jobs_done_uninvoiced_qs.count()
        jobs_done_uninvoiced_ha = jobs_done_uninvoiced_qs.aggregate(total=Sum("hectares"))["total"] or Decimal("0")
        billed_open_qs = JobCollection.objects.filter(
            status=JobCollection.Status.BILLED,
            parent_collection__isnull=True,
        ).prefetch_related("partial_collections")
        open_billed_collections = [collection for collection in billed_open_qs if collection_has_open_balance(collection)]
        billed_uncollected_count = len(open_billed_collections)
        billed_uncollected_ars = sum(
            (collection_settled_slice_ars(collection, collection_remaining_usd(collection)) for collection in open_billed_collections),
            Decimal("0"),
        )
        billed_uncollected_usd = sum(
            (collection_remaining_usd(collection) for collection in open_billed_collections),
            Decimal("0"),
        )
        collected_month_qs = JobCollection.objects.filter(
            status=JobCollection.Status.COLLECTED,
            collection_date__year=today.year,
            collection_date__month=today.month,
        )
        collected_month_ars = (
            collected_month_qs.filter(collected_currency=Currency.ARS).aggregate(total=Sum("collected_amount_original"))["total"]
            or Decimal("0")
        )
        collected_month_usd_original = (
            collected_month_qs.filter(collected_currency=Currency.USD).aggregate(total=Sum("collected_amount_original"))["total"]
            or Decimal("0")
        )
        collected_month_usd_equiv = collected_month_qs.aggregate(total=Sum("collected_amount_usd"))["total"] or Decimal("0")

        # Compromisos / cuotas
        active_obligation_qs = PaymentObligation.objects.exclude(status__in=[PaymentObligation.Status.PAID, PaymentObligation.Status.CANCELLED])
        due_7_count = active_obligation_qs.filter(due_date__lte=today + timedelta(days=7)).count()
        due_30_count = active_obligation_qs.filter(due_date__lte=today + timedelta(days=30)).count()
        overdue_count = active_obligation_qs.filter(due_date__lt=today).count()

        installment_qs = PaymentObligation.objects.filter(source=PaymentObligation.Source.PURCHASE_INSTALLMENT)
        installments_total = installment_qs.count()
        installments_paid = installment_qs.filter(status=PaymentObligation.Status.PAID).count()

        # Alertas
        old_billed_count = sum(1 for collection in open_billed_collections if collection.collection_date < today - timedelta(days=30))
        upcoming_due = list(
            active_obligation_qs.filter(due_date__gte=today)
            .order_by("due_date")
            .values("id", "concept", "due_date", "status")[:5]
        )
        alerts = []
        if overdue_count:
            alerts.append({"type": "overdue_obligations", "message": f"Hay {overdue_count} compromisos vencidos."})
        if old_billed_count:
            alerts.append({"type": "old_billed", "message": f"Hay {old_billed_count} cobros facturados con más de 30 días sin cobrar."})

        return Response(
            {
                "total_capital": float(total_contributions),
                "cash_balance": float(cash_balance),
                "cash_balance_ars": float(cash_balance_ars),
                "cash_balance_usd": float(cash_balance_usd),
                "total_expenses": float(total_expenses),
                "total_reinvestments": float(total_reinvestments),
                "cap_table": cap_table,
                "monthly_data": monthly_data,
                "pipeline": {
                    "jobs_pending": jobs_pending,
                    "jobs_done_uninvoiced": jobs_done_uninvoiced,
                    "jobs_done_uninvoiced_ha": float(jobs_done_uninvoiced_ha),
                    "billed_uncollected_count": billed_uncollected_count,
                    "billed_uncollected_ars": float(billed_uncollected_ars),
                    "billed_uncollected_usd": float(billed_uncollected_usd),
                    "collected_month_ars": float(collected_month_ars),
                    "collected_month_usd_original": float(collected_month_usd_original),
                    "collected_month_usd_equiv": float(collected_month_usd_equiv),
                },
                "commitments": {
                    "due_7_count": due_7_count,
                    "due_30_count": due_30_count,
                    "overdue_count": overdue_count,
                    "installments_total": installments_total,
                    "installments_paid": installments_paid,
                    "upcoming_due": [
                        {
                            "id": item["id"],
                            "concept": item["concept"],
                            "due_date": item["due_date"].isoformat() if item["due_date"] else None,
                            "status": item["status"],
                        }
                        for item in upcoming_due
                    ],
                },
                "alerts": alerts,
            }
        )
