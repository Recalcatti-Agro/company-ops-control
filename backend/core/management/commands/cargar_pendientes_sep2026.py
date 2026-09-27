"""
Carga los trabajos, facturas, cobros, gastos y compras que se hablaron en el chat
del grupo entre junio y septiembre de 2026 y no llegaron a cargarse en producción
(se dejó de cargar en v1 mientras se preparaba la migración a v2). Los datos están
en privado/pendientes_sep2026_datos.py (ver core/private_data.py).

Va por la API (APIClient, como ADMIN) para usar las mismas validaciones y el mismo
reparto que la app. Es idempotente: cada trabajo lleva una marca en notas y si ya
existe se saltea. Después de un `migrate_v1 --wipe` hay que volver a correrlo.
"""

from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from rest_framework.test import APIClient

from core import fx_service, models, private_data

MARK = "[carga chat sep-2026 #{n}]"

def d(value):
    return Decimal(str(value))


class Command(BaseCommand):
    help = "Carga trabajos, cobros, gastos y compras de 2026 que están en el chat y no en producción."

    def handle(self, *args, **opts):
        datos = private_data.load("pendientes_sep2026_datos.py")
        self.bcra_rates = datos.BCRA_RATES
        admin = models.User.objects.filter(role=models.User.Role.ADMIN, is_active=True).order_by("id").first()
        if admin is None:
            raise CommandError("No hay usuario ADMIN para cargar por la API.")
        # Con DEBUG apagado Django rechaza el host "testserver" que usa APIClient
        # por defecto; se usa uno de ALLOWED_HOSTS (el dominio real en producción).
        host = next((h for h in settings.ALLOWED_HOSTS if h != "*" and not h.startswith(".")), "testserver")
        self.api = APIClient(SERVER_NAME=host)
        self.api.force_authenticate(admin)
        self.investors = {i.name: i for i in models.Investor.objects.all()}
        self.ars = models.Account.objects.get(name="Caja ARS")

        for item in datos.PENDING:
            mark = MARK.format(n=item["n"])
            if models.Job.objects.filter(notes__contains=mark).exists():
                self.stdout.write(f"#{item['n']}: ya cargado, se saltea")
                continue
            self._load(item, mark)

        for item in datos.EXPENSES:
            mark = MARK.format(n=item["n"])
            if models.Expense.objects.filter(notes__contains=mark).exists():
                self.stdout.write(f"#{item['n']}: ya cargado, se saltea")
                continue
            fx = self._fx(item["date"])
            amount = d(item["amount"])
            data = {
                "date": item["date"], "concept": item["concept"], "amount_original": str(amount),
                "currency": "ARS", "fx_ars_usd": str(fx), "amount_usd": str((amount / fx).quantize(Decimal("0.01"))),
                "paid_by": item["paid_by"], "notes": f"{item['note']} {mark}",
            }
            if item["paid_by"] == "CASH":
                data["account"] = self.ars.id
            else:
                data["investor"] = self.investors[item["investor"]].id
            self._post("/api/expenses/", data)
            self.stdout.write(f"#{item['n']}: cargado")

        for item in datos.PURCHASES:
            mark = MARK.format(n=item["n"])
            if models.Purchase.objects.filter(notes__contains=mark).exists():
                self.stdout.write(f"#{item['n']}: ya cargado, se saltea")
                continue
            total = d(item["total"])
            fx = self._fx(item["date"]) if item["currency"] == "ARS" else None
            purchase = self._post("/api/purchases/", {
                "date": item["date"], "concept": item["concept"], "category": item["category"],
                "total_amount": str(total), "currency": item["currency"],
                "fx_ars_usd": str(fx) if fx else None,
                "total_amount_usd": str((total / fx).quantize(Decimal("0.01")) if fx else total),
                "installment_count": item["installments"], "first_due_date": item["first_due"],
                "notes": f"{item['note']} {mark}",
            })
            bills = list(models.Bill.objects.filter(purchase_id=purchase["id"]).order_by("installment_number"))
            # Cuotas desparejas: la API las reparte en partes iguales; se ajustan acá
            # (antes de cualquier pago, así que no hay reparto que recalcular).
            for bill, amount in zip(bills, item.get("installment_amounts", [])):
                bill.amount_original = d(amount)
                bill.estimated_amount_usd = (d(amount) / fx).quantize(Decimal("0.01")) if fx else d(amount)
                bill.save(update_fields=["amount_original", "estimated_amount_usd"])
            for paid in item.get("paid", []):
                bill = bills[paid["installment"] - 1]
                pay_fx = self._fx(paid["date"]) if item["currency"] == "ARS" else Decimal("1")
                self._post("/api/expenses/", {
                    "date": paid["date"], "concept": bill.concept, "amount_original": str(bill.amount_original),
                    "currency": item["currency"], "fx_ars_usd": str(pay_fx),
                    "amount_usd": str((bill.amount_original / pay_fx).quantize(Decimal("0.01"))),
                    "paid_by": paid["paid_by"], "account": self.ars.id, "bill": bill.id,
                    "notes": f"Cuota pagada según el chat. {mark}",
                })
            self.stdout.write(f"#{item['n']}: cargado")

    def _post(self, url, data):
        resp = self.api.post(url, data, format="json")
        if resp.status_code >= 300:
            raise CommandError(f"POST {url} → {resp.status_code}: {resp.data}")
        return resp.data

    def _patch(self, url, data):
        resp = self.api.patch(url, data, format="json")
        if resp.status_code >= 300:
            raise CommandError(f"PATCH {url} → {resp.status_code}: {resp.data}")
        return resp.data

    def _fx(self, date, given=None):
        if given:
            return d(given)
        if date in self.bcra_rates:
            rate = d(self.bcra_rates[date])
            # Se guarda como lo haría fx_service al bajarlo del BCRA: si el último TC
            # guardado hasta esa fecha ya es este, es el publicado ese día; si no,
            # es de esta fecha y falta en la tabla.
            last = models.ExchangeRate.objects.filter(date__lte=date).order_by("-date").first()
            if last is None or last.ars_per_usd != rate:
                models.ExchangeRate.objects.get_or_create(date=date, defaults={"ars_per_usd": rate, "source": "bcra"})
            return rate
        rate, _ = fx_service.get_ars_per_usd(models.ExchangeRate._meta.get_field("date").to_python(date))
        return d(rate)

    def _load(self, item, mark):
        note = f"{item['note']} {mark}"

        if "existing_invoice_amount" in item:
            # Trabajo y factura ya existen (vienen de producción): solo se completa.
            invoice = models.Invoice.objects.get(
                client__name=item["existing_invoice_client"], amount_original=d(item["existing_invoice_amount"])
            )
            job = invoice.jobs.get()
            self._patch(f"/api/jobs/{job.id}/", {"date": item["job_date"], "notes": f"{job.notes} {note}".strip()})
            invoice_id = invoice.id
        else:
            if "client" in item:
                client_id = self._post("/api/clients/", item["client"])["id"]
            else:
                client_id = models.Client.objects.get(name=item["client_existing"]).id
            job_data = {"client": client_id, "notes": note, **item["job"]}
            job_id = self._post("/api/jobs/", job_data)["id"]
            self._post(f"/api/jobs/{job_id}/mark-done/", {})
            invoice_id = None
            if "invoice" in item:
                inv = item["invoice"]
                fx = self._fx(inv["date"], inv.get("fx"))
                amount = d(inv["amount"])
                invoice_id = self._post("/api/invoices/", {
                    "client": client_id, "jobs": [job_id], "date": inv["date"],
                    "amount_original": str(amount), "currency": "ARS", "fx_ars_usd": str(fx),
                    "amount_usd": str((amount / fx).quantize(Decimal("0.01"))),
                })["id"]

        if "payment" in item:
            pay = item["payment"]
            fx = self._fx(pay["date"], pay.get("fx"))
            amount = d(pay["amount"])
            payment_id = self._post("/api/payments/", {
                "invoice": invoice_id, "account": self.ars.id, "date": pay["date"],
                "amount_original": str(amount), "currency": "ARS", "fx_ars_usd": str(fx),
                "amount_usd": str((amount / fx).quantize(Decimal("0.01"))),
            })["id"]
            workers = [
                {"investor_id": self.investors[name].id, "weight": w} for name, w in item["work"].items()
            ]
            self._post(f"/api/payments/{payment_id}/apply-distribution/", {
                "field_team_percentage": item["work_pct"], "field_workers": workers,
            })

        self.stdout.write(f"#{item['n']}: cargado")
