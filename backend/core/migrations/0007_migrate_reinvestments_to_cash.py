from django.db import migrations


def forwards(apps, schema_editor):
    Reinvestment = apps.get_model("core", "Reinvestment")
    CashMovement = apps.get_model("core", "CashMovement")
    CapitalContribution = apps.get_model("core", "CapitalContribution")

    for r in Reinvestment.objects.all().iterator():
        movement = CashMovement.objects.filter(
            date=r.date,
            category="PROFIT_REINVESTMENT",
            amount_usd=r.amount_usd,
            investor_id=r.investor_id,
            notes__contains=f"legacy_reinvestment:{r.id}",
        ).first()
        if not movement:
            movement = CashMovement.objects.create(
                date=r.date,
                direction="IN",
                category="PROFIT_REINVESTMENT",
                amount_usd=r.amount_usd,
                investor_id=r.investor_id,
                notes=f"Migrado desde reinversion histórica legacy_reinvestment:{r.id}",
            )

        exists = CapitalContribution.objects.filter(cash_movement_id=movement.id).exists()
        if not exists:
            CapitalContribution.objects.create(
                date=r.date,
                investor_id=r.investor_id,
                kind="REINVESTMENT",
                amount_usd=r.amount_usd,
                cash_movement_id=movement.id,
                notes="Migrado desde reinversion histórica",
            )


def backwards(apps, schema_editor):
    CashMovement = apps.get_model("core", "CashMovement")
    CapitalContribution = apps.get_model("core", "CapitalContribution")

    movements = CashMovement.objects.filter(notes__contains="legacy_reinvestment:")
    CapitalContribution.objects.filter(cash_movement__in=movements).delete()
    movements.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0006_capitalcontribution_cash_movement_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
