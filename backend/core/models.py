from decimal import Decimal

from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Sum

from core import work_types


class Currency(models.TextChoices):
    ARS = "ARS", "ARS"
    USD = "USD", "USD"


class ExchangeRate(models.Model):
    """Auditoría/fallback de tipo de cambio ARS/USD por fecha. No es la fuente de
    verdad de ningún cálculo: cada registro con moneda original guarda su propio
    fx_ars_usd. Esto solo sirve para consultar/loguear qué cotización se usó."""

    date = models.DateField(unique=True)
    ars_per_usd = models.DecimalField(max_digits=15, decimal_places=4)
    source = models.CharField(max_length=100, default="manual")
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date"]

    def __str__(self):
        return f"{self.date} · {self.ars_per_usd}"


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "ADMIN", "Admin"
        INVESTOR = "INVESTOR", "Inversor"

    role = models.CharField(max_length=10, choices=Role.choices, default=Role.INVESTOR)

    @property
    def is_admin_role(self):
        return self.role == self.Role.ADMIN


class Investor(models.Model):
    name = models.CharField(max_length=120, unique=True)
    active = models.BooleanField(default=True)
    user = models.OneToOneField(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="investor"
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def capital_usd(self, as_of=None, exclude_payment=None):
        events = self.capital_events.all()
        if as_of:
            events = events.filter(date__lte=as_of)
        if exclude_payment is not None:
            events = events.exclude(payment=exclude_payment)
        total = Decimal("0")
        for event in events:
            if event.kind == CapitalEvent.Kind.RESCUE:
                total -= event.amount_usd
            else:
                total += event.amount_usd
        # Pagar un gasto de su bolsillo también suma capital (MODELO_DE_DATOS.md §2).
        expenses = self.expenses_paid.all()
        if as_of:
            expenses = expenses.filter(date__lte=as_of)
        total += expenses.aggregate(total=Sum("amount_usd"))["total"] or Decimal("0")
        return total


class Client(models.Model):
    name = models.CharField(max_length=160, unique=True)
    active = models.BooleanField(default=True)
    tax_id = models.CharField("CUIT", max_length=20, blank=True)
    contact_name = models.CharField(max_length=160, blank=True)
    phone = models.CharField(max_length=60, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def debt_usd(self):
        total = Decimal("0")
        for invoice in self.invoices.all():
            if invoice.status == Invoice.Status.OPEN:
                total += invoice.balance_usd
        return total


class Account(models.Model):
    name = models.CharField(max_length=60, unique=True)
    currency = models.CharField(max_length=3, choices=Currency.choices)

    class Meta:
        ordering = ["currency"]

    def __str__(self):
        return self.name

    @property
    def balance(self):
        total = Decimal("0")
        total += self.payments.aggregate(total=Sum("amount_original"))["total"] or Decimal("0")
        total -= self.expenses.aggregate(total=Sum("amount_original"))["total"] or Decimal("0")
        for event in self.capital_events.all():
            if event.kind == CapitalEvent.Kind.RESCUE:
                total -= event.amount_original
            else:
                total += event.amount_original
        total -= self.transfers_out.aggregate(total=Sum("amount_from"))["total"] or Decimal("0")
        total += self.transfers_in.aggregate(total=Sum("amount_to"))["total"] or Decimal("0")
        return total


class Transfer(models.Model):
    """Mueve plata entre las dos cuentas de caja (p. ej. comprar USD con ARS).
    No es un gasto, no es capital, no tiene inversor: es un movimiento interno.
    `amount_from`/`amount_to` son independientes porque puede haber conversión de
    moneda de por medio (no siempre son la misma cantidad al mismo tipo de cambio
    de otro registro)."""

    date = models.DateField()
    from_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="transfers_out")
    to_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="transfers_in")
    amount_from = models.DecimalField(max_digits=15, decimal_places=2)
    amount_to = models.DecimalField(max_digits=15, decimal_places=2)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "id"]

    def __str__(self):
        return f"{self.date} · {self.from_account} → {self.to_account}"

    def clean(self):
        if self.from_account_id == self.to_account_id:
            raise ValidationError("Las cuentas de origen y destino tienen que ser distintas.")


class Job(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pendiente"
        DONE = "DONE", "Realizado"
        INVOICED = "INVOICED", "Facturado"
        COLLECTED = "COLLECTED", "Cobrado"
        CANCELLED = "CANCELLED", "Cancelado"

    date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="jobs")
    location = models.CharField(max_length=160, blank=True)
    hectares = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    work_type = models.CharField(max_length=20, choices=work_types.CHOICES, blank=True)
    product = models.CharField("Producto / semilla", max_length=120, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="jobs_created"
    )

    class Meta:
        ordering = ["-date", "id"]

    def __str__(self):
        return f"{self.date} · {self.client} · {self.work_type_label}"

    @property
    def work_type_label(self):
        label = self.get_work_type_display()
        return f"{label} ({self.product})" if label and self.product else label

    def clean(self):
        if self.end_date and self.end_date < self.date:
            raise ValidationError("La fecha de fin no puede ser menor a la fecha de inicio.")

    def recompute_status(self):
        if self.status == self.Status.CANCELLED:
            return
        invoices = self.invoices.all()
        if not invoices.exists():
            new_status = self.status if self.status in (self.Status.PENDING, self.Status.DONE) else self.Status.DONE
        elif any(inv.status == Invoice.Status.OPEN for inv in invoices):
            new_status = self.Status.INVOICED
        else:
            new_status = self.Status.COLLECTED
        if new_status != self.status:
            self.status = new_status
            self.save(update_fields=["status"])


class Invoice(models.Model):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Abierta"
        SETTLED = "SETTLED", "Cobrada"

    client = models.ForeignKey(Client, on_delete=models.PROTECT, related_name="invoices")
    jobs = models.ManyToManyField(Job, related_name="invoices")
    date = models.DateField()
    amount_original = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.ARS)
    fx_ars_usd = models.DecimalField(max_digits=15, decimal_places=4)
    amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)

    class Meta:
        ordering = ["-date", "id"]

    def __str__(self):
        return f"Factura {self.date} · {self.client}"

    # La consistencia cliente/jobs se valida en InvoiceSerializer.validate(): en
    # creación, jobs todavía no está asignado (M2M requiere instancia guardada).

    @property
    def collected_usd(self):
        return self.payments.aggregate(total=Sum("amount_usd"))["total"] or Decimal("0")

    @property
    def tax_loss_usd(self):
        return self.payments.aggregate(total=Sum("tax_loss_usd"))["total"] or Decimal("0")

    @property
    def collected_original(self):
        """Suma de pagos en la MISMA moneda que la factura. El saldo se decide en
        moneda original (como en la app anterior) — comparar en USD arrastra el
        tipo de cambio de cada pago individual y una factura totalmente cobrada en
        ARS puede terminar con un "saldo" de unos pocos dólares que nunca va a
        cerrar solo por el movimiento del dólar entre pagos parciales."""
        return self.payments.filter(currency=self.currency).aggregate(total=Sum("amount_original"))["total"] or Decimal("0")

    @property
    def balance_original(self):
        return self.amount_original - self.collected_original

    @property
    def balance_usd(self):
        if self.currency == Currency.ARS and self.fx_ars_usd:
            return self.balance_original / self.fx_ars_usd
        return self.balance_original

    @property
    def balance_tolerance(self):
        return max(Decimal("1"), abs(self.amount_original) * Decimal("0.001"))

    @property
    def is_overpaid(self):
        """Se cobró más que el monto facturado (por encima de la tolerancia). Sigue
        siendo SETTLED, pero se muestra aparte para que no pase por 'todo en orden'."""
        return self.balance_original < -self.balance_tolerance

    def recompute_status(self):
        # Un saldo negativo (se cobró de más) sigue siendo "cobrada": solo un saldo
        # positivo por encima de la tolerancia deja la factura abierta.
        new_status = self.Status.OPEN if self.balance_original > self.balance_tolerance else self.Status.SETTLED
        if new_status != self.status:
            self.status = new_status
            self.save(update_fields=["status"])
        for job in self.jobs.all():
            job.recompute_status()


class Payment(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="payments")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="payments")
    date = models.DateField()
    amount_original = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.ARS)
    fx_ars_usd = models.DecimalField(max_digits=15, decimal_places=4)
    amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    tax_loss_usd = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0"))

    class Meta:
        ordering = ["-date", "id"]

    def __str__(self):
        return f"Cobro {self.date} · {self.invoice}"

    @property
    def distributed_usd(self):
        return self.capital_events.aggregate(total=Sum("amount_usd"))["total"] or Decimal("0")

    def cap_table_reference_date(self):
        """Fecha del cap table para repartir la parte accionaria: cuándo terminó
        el trabajo (máx. end_date/date de los jobs de la factura), no cuándo se
        cobró. Misma regla que v1."""
        work_dates = [j.end_date or j.date for j in self.invoice.jobs.all() if (j.end_date or j.date)]
        return max(work_dates) if work_dates else self.date


class CapitalEvent(models.Model):
    class Kind(models.TextChoices):
        CONTRIBUTION = "CONTRIBUTION", "Aporte directo"
        RESCUE = "RESCUE", "Rescate"
        JOB_DISTRIBUTION = "JOB_DISTRIBUTION", "Reparto de cobro"

    date = models.DateField()
    investor = models.ForeignKey(Investor, on_delete=models.PROTECT, related_name="capital_events")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    amount_original = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.ARS)
    fx_ars_usd = models.DecimalField(max_digits=15, decimal_places=4)
    amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    account = models.ForeignKey(
        Account, on_delete=models.PROTECT, null=True, blank=True, related_name="capital_events"
    )
    payment = models.ForeignKey(
        Payment, on_delete=models.CASCADE, null=True, blank=True, related_name="capital_events"
    )
    work_amount_usd = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    shareholder_amount_usd = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "id"]

    def __str__(self):
        return f"{self.get_kind_display()} · {self.investor} · {self.date}"

    def clean(self):
        moves_cash = self.kind in (self.Kind.CONTRIBUTION, self.Kind.RESCUE)
        if moves_cash and not self.account_id:
            raise ValidationError("Un aporte o rescate necesita una cuenta de caja.")
        if not moves_cash and self.account_id:
            raise ValidationError("Un reparto de cobro no mueve caja: no debe tener cuenta.")
        if self.kind == self.Kind.JOB_DISTRIBUTION and not self.payment_id:
            raise ValidationError("Un reparto de cobro debe indicar de qué cobro viene.")
        if self.kind != self.Kind.JOB_DISTRIBUTION and self.payment_id:
            raise ValidationError("Solo un reparto de cobro puede referenciar un cobro.")


class Purchase(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Activa"
        COMPLETED = "COMPLETED", "Completada"
        CANCELLED = "CANCELLED", "Cancelada"

    date = models.DateField()
    concept = models.CharField(max_length=255)
    category = models.CharField(max_length=120, blank=True)
    total_amount = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)
    fx_ars_usd = models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True)
    total_amount_usd = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    installment_count = models.PositiveIntegerField(default=0)
    first_due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "id"]

    def __str__(self):
        return self.concept

    def clean(self):
        if self.installment_count > 0 and not self.first_due_date:
            raise ValidationError("Una compra en cuotas necesita la fecha de la primera cuota.")

    def recompute_status(self):
        """Una compra en cuotas queda Completada cuando todas sus cuotas (no canceladas)
        están pagadas, y vuelve a Activa si alguna deja de estarlo. Las compras sin
        cuotas y las canceladas se manejan a mano."""
        if self.status == self.Status.CANCELLED or self.installment_count == 0:
            return
        bills = self.bills.exclude(status=Bill.Status.CANCELLED)
        if not bills.exists():
            return
        all_paid = not bills.exclude(status=Bill.Status.PAID).exists()
        new_status = self.Status.COMPLETED if all_paid else self.Status.ACTIVE
        if new_status != self.status:
            self.status = new_status
            self.save(update_fields=["status"])


class Bill(models.Model):
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
    purchase = models.ForeignKey(
        Purchase, on_delete=models.CASCADE, null=True, blank=True, related_name="bills"
    )
    installment_number = models.PositiveIntegerField(null=True, blank=True)
    installment_total = models.PositiveIntegerField(null=True, blank=True)
    due_date = models.DateField()
    amount_original = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.USD)
    estimated_amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["due_date", "id"]

    def __str__(self):
        return self.concept or f"Cuota {self.installment_number}/{self.installment_total}"

    def clean(self):
        if self.source == self.Source.PURCHASE_INSTALLMENT and not self.purchase_id:
            raise ValidationError("Las cuotas de compra deben estar asociadas a una compra.")
        if self.source == self.Source.MANUAL:
            self.installment_number = None
            self.installment_total = None

    @property
    def paid_amount_usd(self):
        return self.expenses.aggregate(total=Sum("amount_usd"))["total"] or Decimal("0")

    @property
    def paid_amount_original(self):
        """Pagado en la moneda de la cuota. Mismo criterio que Invoice.collected_original:
        comparar en USD hace que una cuota en ARS pagada completa quede "parcial" solo
        porque el dólar subió entre la estimación y el pago. Un gasto en otra moneda se
        convierte con el tipo de cambio de ese gasto."""
        total = Decimal("0")
        for e in self.expenses.all():
            if e.currency == self.currency:
                total += e.amount_original
            elif self.currency == Currency.USD:
                total += e.amount_usd
            else:
                total += e.amount_usd * e.fx_ars_usd
        return total

    @property
    def balance_tolerance(self):
        return max(Decimal("1"), abs(self.amount_original) * Decimal("0.001"))

    def recompute_status(self):
        if self.status == self.Status.CANCELLED:
            return
        paid = self.paid_amount_original
        if paid <= Decimal("0.01"):
            new_status = self.Status.PENDING
        elif paid >= self.amount_original - self.balance_tolerance:
            new_status = self.Status.PAID
        else:
            new_status = self.Status.PARTIAL
        if new_status != self.status:
            self.status = new_status
            self.save(update_fields=["status"])
        if self.purchase_id:
            self.purchase.recompute_status()


class Expense(models.Model):
    class PaidBy(models.TextChoices):
        CASH = "CASH", "Caja"
        INVESTOR = "INVESTOR", "Inversor"

    date = models.DateField()
    concept = models.CharField(max_length=255)
    amount_original = models.DecimalField(max_digits=15, decimal_places=2)
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.ARS)
    fx_ars_usd = models.DecimalField(max_digits=15, decimal_places=4)
    amount_usd = models.DecimalField(max_digits=15, decimal_places=2)
    bill = models.ForeignKey(Bill, on_delete=models.SET_NULL, null=True, blank=True, related_name="expenses")
    job = models.ForeignKey(Job, on_delete=models.SET_NULL, null=True, blank=True, related_name="expenses")
    paid_by = models.CharField(max_length=10, choices=PaidBy.choices, default=PaidBy.CASH)
    account = models.ForeignKey(
        Account, on_delete=models.PROTECT, null=True, blank=True, related_name="expenses"
    )
    investor = models.ForeignKey(
        Investor, on_delete=models.PROTECT, null=True, blank=True, related_name="expenses_paid"
    )
    created_by = models.ForeignKey(
        "core.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="expenses_created"
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "id"]

    def __str__(self):
        return f"{self.date} · {self.concept}"

    def clean(self):
        if self.paid_by == self.PaidBy.CASH and not self.account_id:
            raise ValidationError("Un gasto pagado por caja necesita una cuenta.")
        if self.paid_by == self.PaidBy.INVESTOR and not self.investor_id:
            raise ValidationError("Un gasto pagado por un inversor necesita indicar quién paga.")
        if self.paid_by == self.PaidBy.CASH:
            self.investor = None
        if self.paid_by == self.PaidBy.INVESTOR:
            self.account = None
