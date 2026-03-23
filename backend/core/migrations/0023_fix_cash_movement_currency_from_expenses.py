from django.db import migrations


def sync_cash_movements_from_expenses(apps, schema_editor):
    CashMovement = apps.get_model("core", "CashMovement")

    qs = CashMovement.objects.filter(expense__isnull=False).select_related("expense")
    for movement in qs.iterator():
        expense = movement.expense
        changed = False

        if movement.currency != expense.currency:
            movement.currency = expense.currency
            changed = True
        if movement.amount_original != expense.amount:
            movement.amount_original = expense.amount
            changed = True
        desired_fx = expense.fx_ars_usd if expense.currency == "ARS" else None
        if movement.fx_ars_usd != desired_fx:
            movement.fx_ars_usd = desired_fx
            changed = True
        if movement.amount_usd != expense.amount_usd:
            movement.amount_usd = expense.amount_usd
            changed = True

        if changed:
            movement.save(update_fields=["currency", "amount_original", "fx_ars_usd", "amount_usd"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0022_cash_movement_currency_split"),
    ]

    operations = [
        migrations.RunPython(sync_cash_movements_from_expenses, migrations.RunPython.noop),
    ]

