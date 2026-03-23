from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0018_jobcollection_collected_fx_and_converted"),
    ]

    operations = [
        migrations.AddField(
            model_name="jobdistribution",
            name="shareholder_amount_usd",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=15),
        ),
        migrations.AddField(
            model_name="jobdistribution",
            name="work_amount_usd",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=15),
        ),
    ]

