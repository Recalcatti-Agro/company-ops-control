from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0023_fix_cash_movement_currency_from_expenses"),
    ]

    operations = [
        migrations.AddField(
            model_name="jobcollection",
            name="parent_collection",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.CASCADE,
                related_name="partial_collections",
                to="core.jobcollection",
            ),
        ),
    ]
