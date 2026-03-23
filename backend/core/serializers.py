from decimal import Decimal, ROUND_HALF_UP

from django.contrib.auth import authenticate
from rest_framework import serializers

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


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        user = authenticate(username=attrs["username"], password=attrs["password"])
        if not user:
            raise serializers.ValidationError("Credenciales inválidas")
        attrs["user"] = user
        return attrs


class InvestorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Investor
        fields = "__all__"


class ClientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Client
        fields = "__all__"


class ExchangeRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExchangeRate
        fields = "__all__"


class CapitalContributionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CapitalContribution
        fields = "__all__"


class CashMovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = CashMovement
        fields = "__all__"

    def validate(self, attrs):
        attrs = super().validate(attrs)
        movement_date = attrs.get("date", getattr(self.instance, "date", None))
        category = attrs.get("category", getattr(self.instance, "category", None))
        investor = attrs.get("investor", getattr(self.instance, "investor", None))
        direction = attrs.get("direction", getattr(self.instance, "direction", None))
        currency = attrs.get("currency", getattr(self.instance, "currency", Currency.USD))
        amount_original = attrs.get("amount_original", getattr(self.instance, "amount_original", None))
        amount_usd_input = attrs.get("amount_usd", getattr(self.instance, "amount_usd", None))
        fx_input = attrs.get("fx_ars_usd", getattr(self.instance, "fx_ars_usd", None))

        if category in {
            CashMovement.Category.CAPITAL_CONTRIBUTION,
            CashMovement.Category.PROFIT_REINVESTMENT,
            CashMovement.Category.CAPITAL_RESCUE,
            CashMovement.Category.INVESTOR_WITHDRAWAL,
        } and not investor:
            raise serializers.ValidationError({"investor": "Este tipo de movimiento requiere inversor."})

        if category in {CashMovement.Category.CAPITAL_CONTRIBUTION, CashMovement.Category.PROFIT_REINVESTMENT}:
            if direction != CashMovement.Direction.IN:
                raise serializers.ValidationError({"direction": "Este tipo debe ser ingreso (IN)."})
        if category in {CashMovement.Category.CAPITAL_RESCUE, CashMovement.Category.INVESTOR_WITHDRAWAL}:
            if direction != CashMovement.Direction.OUT:
                raise serializers.ValidationError({"direction": "Este tipo debe ser egreso (OUT)."})

        if amount_original is None:
            amount_original = amount_usd_input
        amount_original = Decimal(str(amount_original or 0))
        if amount_original <= Decimal("0"):
            raise serializers.ValidationError({"amount_original": "El monto debe ser mayor a 0."})

        if currency == Currency.ARS:
            if fx_input is None and movement_date is not None:
                fx_input, _ = get_ars_per_usd(movement_date)
            fx = Decimal(str(fx_input or 0)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            if fx <= Decimal("0"):
                raise serializers.ValidationError({"fx_ars_usd": "Indicá TC ARS/USD válido para movimientos en ARS."})
            amount_usd = (amount_original / fx).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            attrs["fx_ars_usd"] = fx
        else:
            fx = None
            amount_usd = amount_original.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            attrs["fx_ars_usd"] = None

        attrs["currency"] = currency
        attrs["amount_original"] = amount_original.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        attrs["amount_usd"] = amount_usd
        return attrs


class PurchaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Purchase
        fields = "__all__"
        extra_kwargs = {
            "fx_ars_usd": {"required": False},
            "total_amount_usd": {"required": False},
            "total_amount_ars": {"required": False},
        }

    def validate(self, attrs):
        attrs = super().validate(attrs)
        movement_date = attrs.get("created_date", getattr(self.instance, "created_date", None))
        amount = Decimal(str(attrs.get("total_amount", getattr(self.instance, "total_amount", 0))))
        currency = attrs.get("total_currency", getattr(self.instance, "total_currency", Currency.USD))
        installment_count = int(attrs.get("installment_count", getattr(self.instance, "installment_count", 0)) or 0)
        first_due_date = attrs.get("first_due_date", getattr(self.instance, "first_due_date", None))

        if installment_count < 0:
            raise serializers.ValidationError({"installment_count": "La cantidad de cuotas no puede ser negativa."})
        if installment_count > 0 and not first_due_date:
            raise serializers.ValidationError({"first_due_date": "Indicá primer vencimiento para generar cuotas."})

        fx_input = attrs.get("fx_ars_usd")
        if fx_input is None and self.instance is not None:
            fx_input = getattr(self.instance, "fx_ars_usd", None)
        if fx_input is None and movement_date is not None:
            fx_input, _ = get_ars_per_usd(movement_date)

        fx = Decimal(str(fx_input or 1)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

        if currency == Currency.USD:
            amount_usd = amount
            amount_ars = (amount * fx)
        else:
            amount_ars = amount
            amount_usd = (amount / fx) if fx else Decimal("0")

        attrs["fx_ars_usd"] = fx
        attrs["total_amount_usd"] = amount_usd.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        attrs["total_amount_ars"] = amount_ars.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return attrs


class PaymentObligationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentObligation
        fields = "__all__"

    def validate(self, attrs):
        attrs = super().validate(attrs)
        movement_date = attrs.get("due_date", getattr(self.instance, "due_date", None))
        source = attrs.get("source", getattr(self.instance, "source", PaymentObligation.Source.MANUAL))
        concept = attrs.get("concept", getattr(self.instance, "concept", ""))
        purchase = attrs.get("purchase", getattr(self.instance, "purchase", None))
        amount = Decimal(str(attrs.get("amount", getattr(self.instance, "amount", 0)) or 0))
        currency = attrs.get("currency", getattr(self.instance, "currency", Currency.USD))

        if self.instance and self.instance.source == PaymentObligation.Source.PURCHASE_INSTALLMENT:
            if source != PaymentObligation.Source.PURCHASE_INSTALLMENT:
                raise serializers.ValidationError({"source": "No podés cambiar el tipo de una cuota de compra."})
            if purchase and self.instance.purchase_id and purchase.id != self.instance.purchase_id:
                raise serializers.ValidationError({"purchase": "No podés mover una cuota a otra compra."})

        if source == PaymentObligation.Source.PURCHASE_INSTALLMENT and not purchase:
            raise serializers.ValidationError({"purchase": "Las cuotas de compra deben tener una compra asociada."})
        if source == PaymentObligation.Source.MANUAL and not (concept or "").strip():
            raise serializers.ValidationError({"concept": "El compromiso manual requiere un concepto."})

        if movement_date is not None:
            fx_input, _ = get_ars_per_usd(movement_date)
        else:
            fx_input = Decimal("1")
        fx = Decimal(str(fx_input or 1)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        estimated_usd = amount if currency == Currency.USD else (amount / fx if fx else Decimal("0"))
        attrs["estimated_amount_usd"] = estimated_usd.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return attrs


class ExpenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Expense
        fields = "__all__"
        extra_kwargs = {"fx_ars_usd": {"required": False}, "amount_usd": {"required": False}}

    def validate(self, attrs):
        attrs = super().validate(attrs)
        movement_date = attrs.get("date", getattr(self.instance, "date", None))
        amount = Decimal(str(attrs.get("amount", getattr(self.instance, "amount", 0))))
        currency = attrs.get("currency", getattr(self.instance, "currency", Currency.USD))
        obligation = attrs.get("payment_obligation", getattr(self.instance, "payment_obligation", None))
        purchase = attrs.get("purchase", getattr(self.instance, "purchase", None))

        if obligation and purchase and obligation.purchase_id != purchase.id:
            raise serializers.ValidationError("El compromiso seleccionado no pertenece a la compra indicada.")
        if obligation and not purchase:
            attrs["purchase"] = obligation.purchase

        fx_input = attrs.get("fx_ars_usd")
        if fx_input is None and self.instance is not None:
            fx_input = getattr(self.instance, "fx_ars_usd", None)

        if fx_input is None and movement_date is not None:
            fx_input, _ = get_ars_per_usd(movement_date)

        fx = Decimal(str(fx_input or 1)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        amount_usd = amount if currency == Currency.USD else (amount / fx)
        attrs["fx_ars_usd"] = fx
        attrs["amount_usd"] = amount_usd.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return attrs


class JobSerializer(serializers.ModelSerializer):
    class Meta:
        model = Job
        fields = "__all__"

    def validate(self, attrs):
        attrs = super().validate(attrs)
        start_date = attrs.get("date", getattr(self.instance, "date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if end_date and start_date and end_date < start_date:
            raise serializers.ValidationError({"end_date": "La fecha de fin no puede ser menor a la fecha de inicio."})
        return attrs


class JobCollectionSerializer(serializers.ModelSerializer):
    jobs = serializers.PrimaryKeyRelatedField(queryset=Job.objects.all(), many=True, required=False)

    class Meta:
        model = JobCollection
        fields = "__all__"

    def validate(self, attrs):
        attrs = super().validate(attrs)
        job = attrs.get("job", getattr(self.instance, "job", None))
        jobs = attrs.get("jobs", None)
        has_jobs = bool(jobs) if jobs is not None else bool(self.instance and self.instance.jobs.exists())
        billed_amount = Decimal(str(attrs.get("amount_usd", getattr(self.instance, "amount_usd", 0)) or 0))
        status = attrs.get("status", getattr(self.instance, "status", None))
        collected_amount = attrs.get("collected_amount_usd", getattr(self.instance, "collected_amount_usd", None))
        collected_currency = attrs.get("collected_currency", getattr(self.instance, "collected_currency", None))
        collected_original = attrs.get("collected_amount_original", getattr(self.instance, "collected_amount_original", None))
        collected_fx = attrs.get("collected_fx_ars_usd", getattr(self.instance, "collected_fx_ars_usd", None))
        converted_to_usd = attrs.get("converted_to_usd", getattr(self.instance, "converted_to_usd", True))

        if not job and not has_jobs:
            raise serializers.ValidationError({"jobs": "El cobro debe tener al menos un trabajo."})

        if jobs and not job:
            attrs["job"] = jobs[0]

        if status == JobCollection.Status.COLLECTED:
            if collected_amount is None:
                collected_amount = billed_amount
            collected_amount = Decimal(str(collected_amount))
            if collected_amount <= Decimal("0"):
                raise serializers.ValidationError({"collected_amount_usd": "El monto cobrado debe ser mayor a 0."})
            if not collected_currency:
                collected_currency = Currency.USD
            if collected_original is None:
                collected_original = collected_amount
            collected_original = Decimal(str(collected_original))
            if collected_original <= Decimal("0"):
                raise serializers.ValidationError({"collected_amount_original": "El monto cobrado original debe ser mayor a 0."})
            if collected_currency == Currency.ARS:
                if collected_fx is None:
                    collected_fx = attrs.get("fx_ars_usd", getattr(self.instance, "fx_ars_usd", None))
                collected_fx = Decimal(str(collected_fx or 0))
                if collected_fx <= Decimal("0"):
                    raise serializers.ValidationError({"collected_fx_ars_usd": "Para cobros en ARS, indicá TC ARS/USD válido."})
                recalculated_usd = (collected_original / collected_fx).quantize(Decimal("0.01"))
                if abs(recalculated_usd - collected_amount) > Decimal("0.01"):
                    collected_amount = recalculated_usd
                attrs["collected_fx_ars_usd"] = collected_fx.quantize(Decimal("0.0001"))
                billed_ars = Decimal(str(attrs.get("amount_ars", getattr(self.instance, "amount_ars", 0)) or 0))
                ars_shortfall = billed_ars - collected_original
                if ars_shortfall < Decimal("0"):
                    ars_shortfall = Decimal("0")
                tax_loss = (ars_shortfall / collected_fx).quantize(Decimal("0.01"))
            else:
                if collected_amount > billed_amount:
                    raise serializers.ValidationError(
                        {"collected_amount_usd": "El monto cobrado no puede superar el facturado."}
                    )
                attrs["collected_fx_ars_usd"] = None
                tax_loss = (billed_amount - collected_amount).quantize(Decimal("0.01"))
            attrs["collected_amount_usd"] = collected_amount.quantize(Decimal("0.01"))
            attrs["collected_currency"] = collected_currency
            attrs["collected_amount_original"] = collected_original.quantize(Decimal("0.01"))
            attrs["converted_to_usd"] = bool(converted_to_usd)
            attrs["tax_loss_usd"] = tax_loss
        else:
            attrs["collected_amount_usd"] = None
            attrs["collected_currency"] = None
            attrs["collected_amount_original"] = None
            attrs["collected_fx_ars_usd"] = None
            attrs["converted_to_usd"] = False
            attrs["tax_loss_usd"] = Decimal("0.00")
        return attrs

    def create(self, validated_data):
        jobs = validated_data.pop("jobs", [])
        instance = super().create(validated_data)
        if jobs:
            instance.jobs.set(jobs)
        elif instance.job_id:
            instance.jobs.set([instance.job_id])
        if not instance.job_id and instance.jobs.exists():
            instance.job = instance.jobs.first()
            instance.save(update_fields=["job"])
        return instance

    def update(self, instance, validated_data):
        jobs = validated_data.pop("jobs", None)
        instance = super().update(instance, validated_data)
        if jobs is not None:
            instance.jobs.set(jobs)
        elif instance.job_id and not instance.jobs.exists():
            instance.jobs.set([instance.job_id])
        if not instance.job_id and instance.jobs.exists():
            instance.job = instance.jobs.first()
            instance.save(update_fields=["job"])
        return instance


class JobDistributionSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobDistribution
        fields = "__all__"

    def validate(self, attrs):
        attrs = super().validate(attrs)
        collection = attrs.get("collection", getattr(self.instance, "collection", None))
        if collection and collection.status != JobCollection.Status.COLLECTED:
            raise serializers.ValidationError("Solo podés distribuir cobros en estado Cobrado.")

        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        amount = Decimal(str(attrs.get("amount_usd", getattr(self.instance, "amount_usd", 0)) or 0))
        reinvest = Decimal(str(attrs.get("reinvest_to_cash_usd", getattr(self.instance, "reinvest_to_cash_usd", 0)) or 0))
        investor = attrs.get("investor", getattr(self.instance, "investor", None))

        if reinvest < Decimal("0"):
            raise serializers.ValidationError({"reinvest_to_cash_usd": "No puede ser negativo."})
        if reinvest > amount:
            raise serializers.ValidationError({"reinvest_to_cash_usd": "No puede superar el monto USD asignado."})
        if kind == JobDistribution.Kind.SHAREHOLDER and not investor:
            raise serializers.ValidationError({"investor": "En distribuciones accionista debés indicar inversor."})
        if kind != JobDistribution.Kind.SHAREHOLDER and reinvest > Decimal("0"):
            raise serializers.ValidationError({"reinvest_to_cash_usd": "Solo aplica a tipo Accionista."})
        return attrs


class ReinvestmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Reinvestment
        fields = "__all__"
