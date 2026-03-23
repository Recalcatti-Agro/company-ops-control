from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0019_jobdistribution_work_and_shareholder_amounts"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="job",
            name="code",
        ),
        migrations.RemoveField(
            model_name="jobcollection",
            name="settled_at",
        ),
        migrations.RemoveField(
            model_name="jobcollection",
            name="settlement_status",
        ),
    ]

