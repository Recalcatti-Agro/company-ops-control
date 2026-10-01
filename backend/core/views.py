import json
from decimal import Decimal

from django.contrib.auth import authenticate
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import calc, fx_service, models, serializers
from .permissions import (
    IsAdminOnly,
    IsAdminOrCreateForClient,
    IsAdminOrOwnerForWrite,
    IsAdminOrReadOnly,
    IsAdminOrSelfInvestor,
    is_admin,
)


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get("username")
    password = request.data.get("password")
    user = authenticate(username=username, password=password)
    if not user:
        return Response({"detail": "Credenciales inválidas."}, status=401)
    token, _ = Token.objects.get_or_create(user=user)
    investor = getattr(user, "investor", None)
    return Response(
        {
            "token": token.key,
            "username": user.username,
            "role": user.role,
            "user_id": user.id,
            "investor_id": investor.id if investor else None,
        }
    )


@api_view(["GET"])
def ars_usd_view(request):
    on_date = parse_date(request.query_params.get("date", "")) or timezone.localdate()
    rate, rate_date = fx_service.get_ars_per_usd(on_date)
    return Response({"date": rate_date.isoformat(), "ars_per_usd": str(rate)})


class UserViewSet(viewsets.ModelViewSet):
    queryset = models.User.objects.select_related("investor").all()
    serializer_class = serializers.UserSerializer
    permission_classes = [IsAdminOnly]

    @action(detail=True, methods=["post"], url_path="link-investor")
    def link_investor(self, request, pk=None):
        user = self.get_object()
        investor_id = request.data.get("investor_id")
        models.Investor.objects.filter(user=user).update(user=None)
        if investor_id:
            investor = models.Investor.objects.get(pk=investor_id)
            investor.user = user
            investor.save(update_fields=["user"])
        return Response(serializers.UserSerializer(user).data)


class InvestorViewSet(viewsets.ModelViewSet):
    queryset = models.Investor.objects.all()
    serializer_class = serializers.InvestorSerializer
    permission_classes = [IsAdminOrReadOnly]

    @action(detail=False, methods=["get"], url_path="cap-table")
    def cap_table_view(self, request):
        as_of = parse_date(request.query_params.get("date")) if request.query_params.get("date") else None
        rows, total = calc.cap_table(as_of=as_of)
        data = [
            {
                "investor_id": r["investor"].id,
                "name": r["investor"].name,
                "capital_usd": str(r["capital_usd"]),
                "percentage": str(r["percentage"].quantize(Decimal("0.01"))),
            }
            for r in rows
        ]
        return Response({"rows": data, "total_capital_usd": str(total)})

    @action(
        detail=True,
        methods=["get"],
        url_path="capital-events",
        permission_classes=[IsAuthenticated, IsAdminOrSelfInvestor],
    )
    def capital_events_view(self, request, pk=None):
        investor = self.get_object()
        events = investor.capital_events.all()
        return Response(serializers.CapitalEventSerializer(events, many=True).data)


class ClientViewSet(viewsets.ModelViewSet):
    queryset = models.Client.objects.all()
    serializer_class = serializers.ClientSerializer
    permission_classes = [IsAdminOrCreateForClient]

    @action(detail=True, methods=["get"], url_path="detail")
    def detail_view(self, request, pk=None):
        client = self.get_object()
        payload = {
            "client": client,
            "debt_usd": client.debt_usd,
            "jobs": client.jobs.all(),
            "invoices": client.invoices.all(),
            "payments": models.Payment.objects.filter(invoice__client=client).select_related("invoice"),
        }
        return Response(serializers.ClientDetailSerializer(payload).data)


class AccountViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = models.Account.objects.all()
    serializer_class = serializers.AccountSerializer
    permission_classes = [IsAuthenticated]


class TransferViewSet(viewsets.ModelViewSet):
    queryset = models.Transfer.objects.select_related("from_account", "to_account").all()
    serializer_class = serializers.TransferSerializer
    permission_classes = [IsAdminOrReadOnly]


class JobViewSet(viewsets.ModelViewSet):
    queryset = models.Job.objects.select_related("client", "created_by").all()
    serializer_class = serializers.JobSerializer
    permission_classes = [IsAdminOrOwnerForWrite]

    def perform_destroy(self, instance):
        if instance.invoices.exists():
            raise ValidationError("No se puede borrar: el trabajo está facturado. Borrá primero la factura.")
        instance.delete()

    @action(detail=True, methods=["post"], url_path="mark-done")
    def mark_done(self, request, pk=None):
        job = self.get_object()
        job.status = models.Job.Status.DONE
        job.save(update_fields=["status"])
        return Response(serializers.JobSerializer(job).data)

    @action(detail=True, methods=["post"], url_path="mark-pending")
    def mark_pending(self, request, pk=None):
        job = self.get_object()
        if job.invoices.exists():
            raise ValidationError("No se puede volver a pendiente: ya tiene factura.")
        job.status = models.Job.Status.PENDING
        job.save(update_fields=["status"])
        return Response(serializers.JobSerializer(job).data)

    @action(detail=True, methods=["get"], url_path="detail")
    def detail_view(self, request, pk=None):
        job = self.get_object()
        payments = models.Payment.objects.filter(invoice__jobs=job).select_related("invoice__client").distinct()
        # El reparto es por cobro (y un cobro puede cubrir varios trabajos). Mismas
        # reglas de visibilidad que /capital-events/: un INVESTOR ve solo lo suyo.
        distributions = models.CapitalEvent.objects.filter(
            payment__in=payments, kind=models.CapitalEvent.Kind.JOB_DISTRIBUTION
        ).select_related("investor", "payment__invoice__client")
        if not is_admin(request.user):
            investor = getattr(request.user, "investor", None)
            distributions = distributions.filter(investor=investor) if investor else distributions.none()
        return Response(
            {
                "job": serializers.JobSerializer(job).data,
                "invoices": serializers.InvoiceSerializer(job.invoices.all(), many=True).data,
                "payments": serializers.PaymentSerializer(payments, many=True).data,
                "distributions": serializers.CapitalEventSerializer(distributions, many=True).data,
                "expenses": serializers.ExpenseSerializer(job.expenses.all(), many=True).data,
            }
        )


class InvoiceViewSet(viewsets.ModelViewSet):
    queryset = models.Invoice.objects.select_related("client").prefetch_related("jobs").all()
    serializer_class = serializers.InvoiceSerializer
    permission_classes = [IsAdminOrReadOnly]

    def perform_create(self, serializer):
        invoice = serializer.save()
        for job in invoice.jobs.all():
            job.recompute_status()

    def perform_update(self, serializer):
        old_jobs = list(serializer.instance.jobs.all())
        invoice = serializer.save()
        invoice.recompute_status()
        for job in {*old_jobs, *invoice.jobs.all()}:
            job.recompute_status()

    def perform_destroy(self, instance):
        if instance.payments.exists():
            raise ValidationError("No se puede borrar: la factura tiene cobros. Borrá primero los cobros.")
        jobs = list(instance.jobs.all())
        instance.delete()
        for job in jobs:
            job.recompute_status()

    @action(detail=True, methods=["get"])
    def payments(self, request, pk=None):
        invoice = self.get_object()
        return Response(serializers.PaymentSerializer(invoice.payments.all(), many=True).data)


class PaymentViewSet(viewsets.ModelViewSet):
    queryset = models.Payment.objects.select_related("invoice__client", "account").all()
    serializer_class = serializers.PaymentSerializer
    permission_classes = [IsAdminOrReadOnly]

    def perform_create(self, serializer):
        payment = serializer.save()
        payment.invoice.recompute_status()

    # Campos que cambian cuánto se reparte: si se tocan, el reparto aplicado deja de
    # cuadrar con el cobro y se borra para volver a aplicarlo.
    DISTRIBUTION_FIELDS = ("amount_original", "currency", "fx_ars_usd", "amount_usd", "tax_loss_usd")

    def perform_update(self, serializer):
        old_invoice = serializer.instance.invoice
        before = {f: getattr(serializer.instance, f) for f in self.DISTRIBUTION_FIELDS}
        payment = serializer.save()
        if any(getattr(payment, f) != v for f, v in before.items()):
            payment.capital_events.filter(kind=models.CapitalEvent.Kind.JOB_DISTRIBUTION).delete()
        payment.invoice.recompute_status()
        if old_invoice.id != payment.invoice_id:
            old_invoice.recompute_status()

    def perform_destroy(self, instance):
        invoice = instance.invoice
        instance.delete()
        invoice.recompute_status()

    @action(detail=True, methods=["get"], url_path="distribution-preview")
    def distribution_preview(self, request, pk=None):
        payment = self.get_object()
        return Response(self._build_distribution(request, payment))

    @action(detail=True, methods=["post"], url_path="apply-distribution")
    def apply_distribution(self, request, pk=None):
        payment = self.get_object()
        breakdown = self._build_distribution(request, payment)
        payment.capital_events.filter(kind=models.CapitalEvent.Kind.JOB_DISTRIBUTION).delete()
        created = []
        for row in breakdown["rows"]:
            created.append(
                models.CapitalEvent.objects.create(
                    date=payment.date,
                    investor_id=row["investor_id"],
                    kind=models.CapitalEvent.Kind.JOB_DISTRIBUTION,
                    amount_original=row["amount_original"],
                    currency=payment.currency,
                    fx_ars_usd=payment.fx_ars_usd,
                    amount_usd=row["amount_usd"],
                    payment=payment,
                    work_amount_usd=row["work_amount_usd"],
                    shareholder_amount_usd=row["shareholder_amount_usd"],
                )
            )
        return Response(serializers.CapitalEventSerializer(created, many=True).data, status=201)

    def _build_distribution(self, request, payment):
        source = request.data if request.method == "POST" else request.query_params
        field_team_pct = Decimal(str(source.get("field_team_percentage", "0") or "0"))
        workers = source.get("field_workers") or []
        if isinstance(workers, str):
            workers = json.loads(workers)

        distributable_usd = payment.amount_usd - payment.tax_loss_usd
        if workers and field_team_pct > 0:
            # Split via allocate_by_weights (not plain multiplication) so the two
            # buckets are already cent-exact and sum to distributable_usd — otherwise
            # each bucket's independent rounding below could drop a stray cent overall.
            work_bucket, shareholder_bucket = calc.allocate_by_weights(
                distributable_usd, [field_team_pct, Decimal("100") - field_team_pct]
            )
        else:
            work_bucket, shareholder_bucket = Decimal("0"), distributable_usd

        rows_by_investor = {}
        if workers and work_bucket > 0:
            weights = [Decimal(str(w.get("weight", 0))) for w in workers]
            amounts = calc.allocate_by_weights(work_bucket, weights)
            for worker, amount in zip(workers, amounts):
                entry = rows_by_investor.setdefault(
                    worker["investor_id"], {"work": Decimal("0"), "shareholder": Decimal("0")}
                )
                entry["work"] += amount

        cap_table_date = payment.cap_table_reference_date()
        cap_rows, total_capital = calc.cap_table(as_of=cap_table_date, exclude_payment=payment)
        if cap_rows and shareholder_bucket > 0:
            weights = [r["capital_usd"] if total_capital > 0 else Decimal("1") for r in cap_rows]
            amounts = calc.allocate_by_weights(shareholder_bucket, weights)
            for row, amount in zip(cap_rows, amounts):
                entry = rows_by_investor.setdefault(
                    row["investor"].id, {"work": Decimal("0"), "shareholder": Decimal("0")}
                )
                entry["shareholder"] += amount

        fx = payment.fx_ars_usd
        rows = []
        for investor_id, parts in rows_by_investor.items():
            total_usd = parts["work"] + parts["shareholder"]
            if total_usd <= 0:
                continue
            rows.append(
                {
                    "investor_id": investor_id,
                    "work_amount_usd": parts["work"],
                    "shareholder_amount_usd": parts["shareholder"],
                    "amount_usd": total_usd,
                    "amount_original": (total_usd * fx)
                    if payment.currency == models.Currency.ARS
                    else total_usd,
                }
            )
        distributable_original = (
            distributable_usd * fx if payment.currency == models.Currency.ARS else distributable_usd
        )
        return {
            "rows": rows,
            "distributable_usd": distributable_usd,
            "distributable_original": distributable_original,
            "currency": payment.currency,
            "cap_table_date": cap_table_date,
        }


class CapitalEventViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.CapitalEventSerializer

    def get_queryset(self):
        qs = models.CapitalEvent.objects.select_related(
            "investor", "payment__invoice__client"
        ).prefetch_related("payment__invoice__jobs").all()
        if is_admin(self.request.user):
            return qs
        investor = getattr(self.request.user, "investor", None)
        return qs.filter(investor=investor) if investor else qs.none()

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [IsAdminOnly()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        if serializer.validated_data.get("kind") == models.CapitalEvent.Kind.JOB_DISTRIBUTION:
            raise ValidationError("Un reparto de cobro se crea desde apply-distribution, no directamente.")
        serializer.save()

    def perform_update(self, serializer):
        if serializer.instance.kind == models.CapitalEvent.Kind.JOB_DISTRIBUTION or (
            serializer.validated_data.get("kind") == models.CapitalEvent.Kind.JOB_DISTRIBUTION
        ):
            raise ValidationError("Un reparto se modifica rehaciendo el reparto del cobro.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.kind == models.CapitalEvent.Kind.JOB_DISTRIBUTION:
            raise ValidationError("Un reparto se modifica rehaciendo el reparto del cobro.")
        instance.delete()


class PurchaseViewSet(viewsets.ModelViewSet):
    queryset = models.Purchase.objects.all()
    serializer_class = serializers.PurchaseSerializer
    permission_classes = [IsAdminOrReadOnly]

    def perform_create(self, serializer):
        purchase = serializer.save()
        self._sync_installments(purchase)

    def perform_update(self, serializer):
        purchase = serializer.save()
        self._sync_installments(purchase)
        purchase.recompute_status()

    def perform_destroy(self, instance):
        if models.Expense.objects.filter(bill__purchase=instance).exists():
            raise ValidationError("No se puede borrar: la compra tiene cuotas con pagos. Cancelala en su lugar.")
        instance.delete()

    def _sync_installments(self, purchase):
        existing = list(
            purchase.bills.filter(source=models.Bill.Source.PURCHASE_INSTALLMENT).order_by("installment_number")
        )
        target_count = purchase.installment_count
        if target_count <= 0:
            for bill in existing:
                if bill.paid_amount_usd <= Decimal("0.01"):
                    bill.delete()
            return

        # La cuota se guarda en la moneda de la compra; el USD es solo estimado.
        if purchase.currency == models.Currency.USD:
            total_usd = purchase.total_amount
        elif purchase.total_amount_usd:
            total_usd = purchase.total_amount_usd
        else:
            fx = purchase.fx_ars_usd or fx_service.get_ars_per_usd(purchase.date)[0]
            total_usd = (purchase.total_amount / fx).quantize(Decimal("0.01"))
        weights = [Decimal("1")] * target_count
        amounts = calc.allocate_by_weights(purchase.total_amount, weights)
        amounts_usd = calc.allocate_by_weights(total_usd, weights)

        for i in range(target_count):
            number = i + 1
            due = calc.add_months(purchase.first_due_date, i)
            if i < len(existing):
                bill = existing[i]
                if bill.paid_amount_usd <= Decimal("0.01"):
                    bill.due_date = due
                    bill.amount_original = amounts[i]
                    bill.currency = purchase.currency
                    bill.estimated_amount_usd = amounts_usd[i]
                    bill.installment_total = target_count
                    bill.concept = f"{purchase.concept} · cuota {number}/{target_count}"
                    bill.save()
            else:
                models.Bill.objects.create(
                    purchase=purchase,
                    source=models.Bill.Source.PURCHASE_INSTALLMENT,
                    installment_number=number,
                    installment_total=target_count,
                    due_date=due,
                    amount_original=amounts[i],
                    currency=purchase.currency,
                    estimated_amount_usd=amounts_usd[i],
                    concept=f"{purchase.concept} · cuota {number}/{target_count}",
                )

        for bill in existing[target_count:]:
            if bill.paid_amount_usd <= Decimal("0.01"):
                bill.delete()


class BillViewSet(viewsets.ModelViewSet):
    queryset = models.Bill.objects.select_related("purchase").all()
    serializer_class = serializers.BillSerializer
    permission_classes = [IsAdminOrReadOnly]

    def perform_create(self, serializer):
        serializer.save(source=models.Bill.Source.MANUAL)

    def perform_update(self, serializer):
        if serializer.instance.source == models.Bill.Source.PURCHASE_INSTALLMENT:
            raise ValidationError("Las cuotas de compra se editan desde la compra, no directamente.")
        serializer.save().recompute_status()

    def perform_destroy(self, instance):
        if instance.source == models.Bill.Source.PURCHASE_INSTALLMENT:
            raise ValidationError("Las cuotas de compra se administran desde la compra.")
        instance.delete()


class ExpenseViewSet(viewsets.ModelViewSet):
    queryset = models.Expense.objects.select_related("bill", "job", "account", "investor", "created_by").all()
    serializer_class = serializers.ExpenseSerializer
    permission_classes = [IsAdminOrOwnerForWrite]

    def perform_create(self, serializer):
        expense = serializer.save()
        if expense.bill_id:
            expense.bill.recompute_status()

    def perform_update(self, serializer):
        old_bill = serializer.instance.bill
        expense = serializer.save()
        if old_bill:
            old_bill.recompute_status()
        if expense.bill_id and expense.bill_id != getattr(old_bill, "id", None):
            expense.bill.recompute_status()

    def perform_destroy(self, instance):
        bill = instance.bill
        instance.delete()
        if bill:
            bill.recompute_status()


class ExchangeRateViewSet(viewsets.ModelViewSet):
    queryset = models.ExchangeRate.objects.all()
    serializer_class = serializers.ExchangeRateSerializer
    permission_classes = [IsAdminOnly]


class DashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        accounts = list(models.Account.objects.all())
        latest_fx = models.ExchangeRate.objects.order_by("-date").first()

        cash_by_account = []
        cash_total_usd = Decimal("0")
        for acc in accounts:
            balance = acc.balance
            cash_by_account.append({"name": acc.name, "currency": acc.currency, "balance": str(balance)})
            if acc.currency == models.Currency.USD:
                cash_total_usd += balance
            elif latest_fx:
                cash_total_usd += balance / latest_fx.ars_per_usd

        cap_rows, total_capital = calc.cap_table()
        cap_table_data = [
            {
                "investor": r["investor"].name,
                "capital_usd": str(r["capital_usd"]),
                "percentage": str(r["percentage"].quantize(Decimal("0.01"))),
            }
            for r in cap_rows
        ]

        open_invoices = models.Invoice.objects.filter(status=models.Invoice.Status.OPEN)
        billed_uncollected_usd = sum((inv.balance_usd for inv in open_invoices), Decimal("0"))

        active_bills = models.Bill.objects.exclude(
            status__in=[models.Bill.Status.PAID, models.Bill.Status.CANCELLED]
        )
        today = timezone.localdate()

        return Response(
            {
                "cash_by_account": cash_by_account,
                "cash_total_usd": str(cash_total_usd),
                "total_capital_usd": str(total_capital),
                "cap_table": cap_table_data,
                "pipeline": {
                    "jobs_pending": models.Job.objects.filter(status=models.Job.Status.PENDING).count(),
                    "jobs_done_uninvoiced": models.Job.objects.filter(status=models.Job.Status.DONE).count(),
                    "billed_uncollected_count": open_invoices.count(),
                    "billed_uncollected_usd": str(billed_uncollected_usd),
                },
                "bills": {
                    "overdue_count": active_bills.filter(due_date__lt=today).count(),
                    "due_soon_count": active_bills.filter(due_date__lte=today + timezone.timedelta(days=7)).count(),
                    "active_count": active_bills.count(),
                },
            }
        )
