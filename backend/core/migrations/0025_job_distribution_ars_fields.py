from decimal import Decimal, ROUND_HALF_UP

from django.db import migrations, models


def q2(value):
    return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def backfill_collection_and_distribution_ars(apps, schema_editor):
    JobCollection = apps.get_model("core", "JobCollection")
    JobDistribution = apps.get_model("core", "JobDistribution")

    for collection in JobCollection.objects.all().iterator():
        fx = collection.collected_fx_ars_usd or collection.fx_ars_usd or Decimal("0")
        amount_ars = q2(collection.amount_ars)
        if collection.status == "COLLECTED":
            if collection.collected_currency == "ARS" and collection.collected_amount_original is not None:
                collected_ars = q2(collection.collected_amount_original)
            elif fx > Decimal("0") and collection.collected_amount_usd is not None:
                collected_ars = q2(collection.collected_amount_usd * fx)
            else:
                collected_ars = amount_ars
            tax_loss_ars = amount_ars - collected_ars
            if tax_loss_ars < Decimal("0"):
                tax_loss_ars = Decimal("0")
        else:
            tax_loss_ars = Decimal("0")
        collection.tax_loss_ars = q2(tax_loss_ars)
        collection.save(update_fields=["tax_loss_ars"])

    for distribution in JobDistribution.objects.select_related("collection").all().iterator():
        fx = distribution.collection.collected_fx_ars_usd or distribution.collection.fx_ars_usd or Decimal("0")
        distribution.fx_ars_usd = fx if fx > Decimal("0") else None
        if fx > Decimal("0"):
            distribution.amount_ars = q2(distribution.amount_usd * fx)
            distribution.work_amount_ars = q2(distribution.work_amount_usd * fx)
            distribution.shareholder_amount_ars = q2(distribution.shareholder_amount_usd * fx)
            distribution.reinvest_to_cash_ars = q2(distribution.reinvest_to_cash_usd * fx)
        else:
            distribution.amount_ars = Decimal("0.00")
            distribution.work_amount_ars = Decimal("0.00")
            distribution.shareholder_amount_ars = Decimal("0.00")
            distribution.reinvest_to_cash_ars = Decimal("0.00")
        distribution.save(
            update_fields=[
                "fx_ars_usd",
                "amount_ars",
                "work_amount_ars",
                "shareholder_amount_ars",
                "reinvest_to_cash_ars",
            ]
        )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0024_jobcollection_parent_collection"),
    ]

    operations = [
        migrations.AddField(
            model_name="jobcollection",
            name="tax_loss_ars",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=15),
        ),
        migrations.AddField(
            model_name="jobdistribution",
            name="amount_ars",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=15),
        ),
        migrations.AddField(
            model_name="jobdistribution",
            name="fx_ars_usd",
            field=models.DecimalField(blank=True, decimal_places=4, max_digits=15, null=True),
        ),
        migrations.AddField(
            model_name="jobdistribution",
            name="reinvest_to_cash_ars",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=15),
        ),
        migrations.AddField(
            model_name="jobdistribution",
            name="shareholder_amount_ars",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=15),
        ),
        migrations.AddField(
            model_name="jobdistribution",
            name="work_amount_ars",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=15),
        ),
        migrations.RunPython(backfill_collection_and_distribution_ars, migrations.RunPython.noop),
    ]
