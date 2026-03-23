from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


class Currency(models.TextChoices):
    USD = "USD", "USD"
    ARS = "ARS", "ARS"


class Investor(models.Model):
    name = models.CharField(max_length=120, unique=True)
    active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Client(models.Model):
    name = models.CharField(max_length=160, unique=True)
    active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ExchangeRate(models.Model):
    date = models.DateField(unique=True)
    ars_per_usd = models.DecimalField(max_digits=15, decimal_places=4)
    source = models.CharField(max_length=100, default="manual")
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return f"{self.date} {self.ars_per_usd} ARS/USD"


class CapitalContribution(models.Model):
    class Kind(models.TextChoices):
        EXPENSE = "EXPENSE", "Gasto pagado"
        REINVESTMENT = "REINVESTMENT", "Reinversión"
        DIRECT = "DIRECT", "Aporte directo"
        WITHDRAWAL = "WITHDRAWAL", "Rescate de capital"

    date = models.DateField()
    investor = models.ForeignKey(Investor, on_delete=models.PROTECT, related_name="capital_contributions")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    cash_movement = models.ForeignKey("CashMovement", on_delete=models.SET_NULL, null=True, blank=True, related_name="contributions")
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "id"]


class CashMovement(models.Model):
    class Direction(models.TextChoices):
        IN = "IN", "Ingreso"
        OUT = "OUT", "Egreso"

    class Category(models.TextChoices):
        JOB_COLLECTION = "JOB_COLLECTION", "Cobro trabajo"
        FIELD_TEAM_PAYOUT = "FIELD_TEAM_PAYOUT", "Pago equipo campo"
        PROFIT_REINVESTMENT = "PROFIT_REINVESTMENT", "Reinversión de utilidad"
        CAPITAL_CONTRIBUTION = "CAPITAL_CONTRIBUTION", "Aporte de capital"
        CAPITAL_RESCUE = "CAPITAL_RESCUE", "Rescate de capital"
        INVESTOR_WITHDRAWAL = "INVESTOR_WITHDRAWAL", "Retiro de inversor"
        EXPENSE = "EXPENSE", "Gasto"
        PURCHASE_PAYMENT = "PURCHASE_PAYMENT", "Pago compra"
        ADJUSTMENT = "ADJUSTMENT", "Ajuste"

    date = models.DateField()
    direction = models.CharField(max_length=3, choices=Direction.choices)
    category = models.CharField(max_length=20, choices=Category.choices)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)
    amount_original = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    fx_ars_usd = models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True)
    amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    investor = models.ForeignKey(Investor, on_delete=models.PROTECT, null=True, blank=True)
    expense = models.OneToOneField("Expense", on_delete=models.SET_NULL, null=True, blank=True, related_name="cash_movement")
    job_distribution = models.OneToOneField(
        "JobDistribution", on_delete=models.SET_NULL, null=True, blank=True, related_name="cash_movement"
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "id"]


class Purchase(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Activa"
        COMPLETED = "COMPLETED", "Completada"
        CANCELLED = "CANCELLED", "Cancelada"

    created_date = models.DateField()
    concept = models.CharField(max_length=255)
    category = models.CharField(max_length=120, blank=True)
    total_amount = models.DecimalField(max_digits=15, decimal_places=2)
    total_currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)
    fx_ars_usd = models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True)
    total_amount_usd = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    total_amount_ars = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    installment_count = models.PositiveIntegerField(default=0)
    first_due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_date", "id"]


class PaymentObligation(models.Model):
    class Source(models.TextChoices):
        MANUAL = "MANUAL", "Manual"
        PURCHASE_INSTALLMENT = "PURCHASE_INSTALLMENT", "Cuota de compra"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pendiente"
        PARTIAL = "PARTIAL", "Parcial"
        PAID = "PAID", "Pagada"
        CANCELLED = "CANCELLED", "Cancelada"

    concept = models.CharField(max_length=255, blank=True)
    source = models.CharField(max_length=25, choices=Source.choices, default=Source.MANUAL)
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name="obligations", null=True, blank=True)
    installment_number = models.PositiveIntegerField(null=True, blank=True)
    installment_total = models.PositiveIntegerField(null=True, blank=True)
    due_date = models.DateField()
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)
    estimated_amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["due_date", "id"]
        constraints = [
            models.CheckConstraint(
                check=Q(source="MANUAL") | Q(purchase__isnull=False),
                name="obligation_purchase_required_for_installment",
            ),
        ]

    def clean(self):
        if self.source == self.Source.PURCHASE_INSTALLMENT and not self.purchase_id:
            raise ValidationError("Las cuotas de compra deben estar asociadas a una compra.")
        if self.source == self.Source.MANUAL:
            self.installment_number = None
            self.installment_total = None


class Expense(models.Model):
    class PaidBy(models.TextChoices):
        INVESTOR = "INVESTOR", "Inversor"
        CASH = "CASH", "Caja"

    date = models.DateField()
    concept = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)
    fx_ars_usd = models.DecimalField(max_digits=15, decimal_places=4)
    amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    purchase = models.ForeignKey("Purchase", on_delete=models.PROTECT, null=True, blank=True, related_name="expenses")
    job = models.ForeignKey("Job", on_delete=models.SET_NULL, null=True, blank=True, related_name="expenses")
    payment_obligation = models.ForeignKey(
        "PaymentObligation", on_delete=models.SET_NULL, null=True, blank=True, related_name="expenses"
    )
    paid_by = models.CharField(max_length=10, choices=PaidBy.choices, default=PaidBy.INVESTOR)
    payer_investor = models.ForeignKey(Investor, on_delete=models.PROTECT, null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "id"]

    def clean(self):
        if self.paid_by == self.PaidBy.INVESTOR and not self.payer_investor:
            raise ValidationError("Si paga inversor, debe indicar quién paga.")
        if self.paid_by == self.PaidBy.CASH:
            self.payer_investor = None
        if self.payment_obligation and self.purchase and self.payment_obligation.purchase_id != self.purchase_id:
            raise ValidationError("El compromiso seleccionado no pertenece a la compra indicada.")
        if self.payment_obligation and not self.purchase:
            self.purchase = self.payment_obligation.purchase


class Job(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pendiente"
        DONE = "DONE", "Realizado"
        INVOICED = "INVOICED", "Facturado"
        COLLECTED = "COLLECTED", "Cobrado"
        CANCELLED = "CANCELLED", "Cancelado"

    date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    client = models.CharField(max_length=255, blank=True)
    hectares = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    work_type = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "id"]

    def clean(self):
        if self.end_date and self.end_date < self.date:
            raise ValidationError("La fecha de fin no puede ser menor a la fecha de inicio.")


class JobCollection(models.Model):
    class Status(models.TextChoices):
        BILLED = "BILLED", "Facturado"
        COLLECTED = "COLLECTED", "Cobrado"

    job = models.ForeignKey(Job, on_delete=models.SET_NULL, null=True, blank=True, related_name="collections")
    jobs = models.ManyToManyField(Job, related_name="grouped_collections", blank=True)
    collection_date = models.DateField()
    amount_ars = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    fx_ars_usd = models.DecimalField(max_digits=15, decimal_places=4, default=Decimal("1"))
    amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    collected_currency = models.CharField(max_length=3, choices=Currency.choices, null=True, blank=True)
    collected_amount_original = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    collected_fx_ars_usd = models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True)
    converted_to_usd = models.BooleanField(default=False)
    collected_amount_usd = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    tax_loss_usd = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.BILLED)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-collection_date", "id"]


class JobDistribution(models.Model):
    class Kind(models.TextChoices):
        FIELD_TEAM = "FIELD_TEAM", "Equipo de campo"
        SHAREHOLDER = "SHAREHOLDER", "Accionista"
        REINVESTMENT = "REINVESTMENT", "Reinversión"

    collection = models.ForeignKey(JobCollection, on_delete=models.CASCADE, related_name="distributions")
    investor = models.ForeignKey(Investor, on_delete=models.PROTECT, null=True, blank=True)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    percentage = models.DecimalField(max_digits=7, decimal_places=4, null=True, blank=True)
    amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    work_amount_usd = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    shareholder_amount_usd = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    reinvest_to_cash_usd = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["id"]


class Reinvestment(models.Model):
    date = models.DateField()
    investor = models.ForeignKey(Investor, on_delete=models.PROTECT, related_name="reinvestments")
    amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "id"]
