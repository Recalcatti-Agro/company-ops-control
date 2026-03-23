from decimal import Decimal

from django.db import migrations, models


def backfill_cash_movement_currency(apps, schema_editor):
    CashMovement = apps.get_model("core", "CashMovement")
    for movement in CashMovement.objects.all().iterator():
        changed = False
        if not movement.currency:
            movement.currency = "USD"
            changed = True
        if movement.amount_original in (None, Decimal("0")) and movement.amount_usd is not None:
            movement.amount_original = movement.amount_usd
            changed = True
        if movement.currency == "USD" and movement.fx_ars_usd is not None:
            movement.fx_ars_usd = None
            changed = True
        if changed:
            movement.save(update_fields=["currency", "amount_original", "fx_ars_usd"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0021_normalize_purchase_installments"),
    ]

    operations = [
        migrations.AddField(
            model_name="cashmovement",
            name="currency",
            field=models.CharField(choices=[("USD", "USD"), ("ARS", "ARS")], default="USD", max_length=3),
        ),
        migrations.AddField(
            model_name="cashmovement",
            name="amount_original",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=15),
        ),
        migrations.AddField(
            model_name="cashmovement",
            name="fx_ars_usd",
            field=models.DecimalField(blank=True, decimal_places=4, max_digits=15, null=True),
        ),
        migrations.RunPython(backfill_cash_movement_currency, migrations.RunPython.noop),
    ]

