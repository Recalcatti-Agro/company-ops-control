from django.db import migrations


def normalize_installments(apps, schema_editor):
    PaymentObligation = apps.get_model("core", "PaymentObligation")
    Purchase = apps.get_model("core", "Purchase")

    for purchase in Purchase.objects.all():
        qs = PaymentObligation.objects.filter(
            source="PURCHASE_INSTALLMENT",
            purchase_id=purchase.id,
        ).order_by("installment_number", "id")
        total = qs.count()
        if total == 0:
            continue
        for idx, obligation in enumerate(qs, start=1):
            changed = False
            if obligation.installment_number != idx:
                obligation.installment_number = idx
                changed = True
            if obligation.installment_total != total:
                obligation.installment_total = total
                changed = True
            if changed:
                obligation.save(update_fields=["installment_number", "installment_total"])

        if purchase.installment_count != total:
            purchase.installment_count = total
            purchase.save(update_fields=["installment_count"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0020_remove_job_code_and_collection_settlement"),
    ]

    operations = [
        migrations.RunPython(normalize_installments, migrations.RunPython.noop),
    ]

