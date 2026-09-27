from django.db import migrations, models

from core import work_types


def forwards(apps, schema_editor):
    Job = apps.get_model("core", "Job")
    for job in Job.objects.all():
        work_type, product, crop = work_types.parse_legacy(job.work_type)
        job.work_type = work_type
        job.product = product
        if crop and f"Cultivo: {crop}" not in job.notes:
            job.notes = f"Cultivo: {crop}. {job.notes}".strip()
        job.save(update_fields=["work_type", "product", "notes"])


class Migration(migrations.Migration):
    dependencies = [("core", "0003_transfer")]

    operations = [
        migrations.AddField(
            model_name="job",
            name="product",
            field=models.CharField(blank=True, max_length=120, verbose_name="Producto / semilla"),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="job",
            name="work_type",
            field=models.CharField(blank=True, choices=work_types.CHOICES, max_length=20),
        ),
    ]
