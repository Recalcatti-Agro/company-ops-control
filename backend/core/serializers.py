from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from . import models


class ModelCleanSerializer(serializers.ModelSerializer):
    """Runs the model's clean() as part of serializer validation, so the business
    rules living in models.py (paid_by consistency, CapitalEvent.kind rules, etc.)
    apply on every write, not just when something calls full_clean() by hand."""

    def validate(self, attrs):
        instance = self.instance
        m2m_fields = {f.name for f in self.Meta.model._meta.many_to_many}
        simple_attrs = {k: v for k, v in attrs.items() if k not in m2m_fields}
        if instance is not None:
            for key, value in simple_attrs.items():
                setattr(instance, key, value)
        else:
            instance = self.Meta.model(**simple_attrs)
        try:
            instance.clean()
        except DjangoValidationError as exc:
            detail = exc.message_dict if hasattr(exc, "message_dict") and exc.message_dict != {"__all__": exc.messages} else exc.messages
            raise serializers.ValidationError(detail)
        return attrs


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False)
    investor_id = serializers.SerializerMethodField()
    investor_name = serializers.SerializerMethodField()

    class Meta:
        model = models.User
        fields = ["id", "username", "email", "role", "is_active", "password", "investor_id", "investor_name"]

    def get_investor_id(self, obj):
        return getattr(getattr(obj, "investor", None), "id", None)

    def get_investor_name(self, obj):
        return getattr(getattr(obj, "investor", None), "name", None)

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = models.User(**validated_data)
        user.set_password(password or models.User.objects.make_random_password())
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class InvestorSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.Investor
        fields = ["id", "name", "active", "user"]


class ClientSerializer(serializers.ModelSerializer):
    debt_usd = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = models.Client
        fields = [
            "id", "name", "active", "tax_id", "contact_name", "phone", "email", "address",
            "notes", "debt_usd",
        ]


class AccountSerializer(serializers.ModelSerializer):
    balance = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = models.Account
        fields = ["id", "name", "currency", "balance"]


class TransferSerializer(ModelCleanSerializer):
    from_account_name = serializers.CharField(source="from_account.name", read_only=True)
    to_account_name = serializers.CharField(source="to_account.name", read_only=True)

    class Meta:
        model = models.Transfer
        fields = [
            "id", "date", "from_account", "from_account_name", "to_account", "to_account_name",
            "amount_from", "amount_to", "notes",
        ]


class JobSerializer(ModelCleanSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    work_type_label = serializers.CharField(read_only=True)

    class Meta:
        model = models.Job
        fields = [
            "id", "date", "end_date", "client", "client_name", "location", "hectares",
            "work_type", "product", "work_type_label", "notes", "status", "created_by",
        ]
        read_only_fields = ["status", "created_by"]

    def validate(self, attrs):
        client = attrs.get("client")
        if self.instance is not None and client is not None and client.id != self.instance.client_id:
            if self.instance.invoices.exists():
                raise serializers.ValidationError("No se puede cambiar el cliente: el trabajo ya está facturado.")
        return super().validate(attrs)

    def create(self, validated_data):
        request = self.context.get("request")
        if request:
            validated_data["created_by"] = request.user
        return super().create(validated_data)


class InvoiceSerializer(ModelCleanSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    collected_usd = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    balance_usd = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    collected_original = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    balance_original = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    is_overpaid = serializers.BooleanField(read_only=True)

    class Meta:
        model = models.Invoice
        fields = [
            "id", "client", "client_name", "jobs", "date", "amount_original", "currency",
            "fx_ars_usd", "amount_usd", "status", "collected_usd", "balance_usd",
            "collected_original", "balance_original", "is_overpaid",
        ]
        read_only_fields = ["status"]

    def validate(self, attrs):
        client = attrs.get("client") or getattr(self.instance, "client", None)
        jobs = attrs.get("jobs")
        if jobs is not None and client is not None:
            for job in jobs:
                if job.client_id != client.id:
                    raise serializers.ValidationError(
                        "Todos los trabajos de la factura deben ser del mismo cliente."
                    )
        return super().validate(attrs)


class PaymentSerializer(serializers.ModelSerializer):
    distributed_usd = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    client_name = serializers.CharField(source="invoice.client.name", read_only=True)

    class Meta:
        model = models.Payment
        fields = [
            "id", "invoice", "client_name", "account", "date", "amount_original", "currency",
            "fx_ars_usd", "amount_usd", "tax_loss_usd", "distributed_usd",
        ]


class CapitalEventSerializer(ModelCleanSerializer):
    investor_name = serializers.CharField(source="investor.name", read_only=True)
    payment_client_name = serializers.SerializerMethodField()
    payment_job_label = serializers.SerializerMethodField()

    class Meta:
        model = models.CapitalEvent
        fields = [
            "id", "date", "investor", "investor_name", "kind", "amount_original", "currency",
            "fx_ars_usd", "amount_usd", "account", "payment", "payment_client_name",
            "payment_job_label", "work_amount_usd", "shareholder_amount_usd", "notes",
        ]

    def get_payment_client_name(self, obj):
        if obj.payment_id:
            return obj.payment.invoice.client.name
        return None

    def get_payment_job_label(self, obj):
        if not obj.payment_id:
            return None
        parts = []
        for job in obj.payment.invoice.jobs.all():
            label = job.work_type_label or "Trabajo"
            if job.location:
                label += f" ({job.location})"
            parts.append(label)
        return " + ".join(parts) if parts else None


class PurchaseSerializer(ModelCleanSerializer):
    class Meta:
        model = models.Purchase
        fields = [
            "id", "date", "concept", "category", "total_amount", "currency", "fx_ars_usd",
            "total_amount_usd", "installment_count", "first_due_date", "status", "notes",
        ]


class BillSerializer(ModelCleanSerializer):
    paid_amount_usd = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    paid_amount_original = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = models.Bill
        fields = [
            "id", "concept", "source", "purchase", "installment_number", "installment_total",
            "due_date", "amount_original", "currency", "estimated_amount_usd", "status",
            "notes", "paid_amount_usd", "paid_amount_original",
        ]
        read_only_fields = ["status", "source", "installment_number", "installment_total"]


class ExpenseSerializer(ModelCleanSerializer):
    class Meta:
        model = models.Expense
        fields = [
            "id", "date", "concept", "amount_original", "currency", "fx_ars_usd", "amount_usd",
            "bill", "job", "paid_by", "account", "investor", "created_by", "notes",
        ]
        read_only_fields = ["created_by"]

    def create(self, validated_data):
        request = self.context.get("request")
        if request:
            validated_data["created_by"] = request.user
        return super().create(validated_data)


class ExchangeRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.ExchangeRate
        fields = ["id", "date", "ars_per_usd", "source", "notes"]


class ClientDetailSerializer(serializers.Serializer):
    client = ClientSerializer()
    debt_usd = serializers.DecimalField(max_digits=15, decimal_places=2)
    jobs = JobSerializer(many=True)
    invoices = InvoiceSerializer(many=True)
    payments = PaymentSerializer(many=True)
