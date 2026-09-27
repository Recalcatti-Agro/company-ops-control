from datetime import date
from decimal import Decimal

from rest_framework.test import APITestCase

from . import models


class EditDeleteGuardsTests(APITestCase):
    def setUp(self):
        self.admin = models.User.objects.create_user("admin", password="x", role=models.User.Role.ADMIN)
        self.client.force_authenticate(self.admin)
        self.ars = models.Account.objects.create(name="Caja ARS", currency="ARS")
        self.investor = models.Investor.objects.create(name="Inv")
        self.cli = models.Client.objects.create(name="Cliente")
        self.job = models.Job.objects.create(date=date(2026, 1, 1), client=self.cli, status="DONE")

    def _invoice(self):
        res = self.client.post("/api/invoices/", {
            "client": self.cli.id, "jobs": [self.job.id], "date": "2026-01-10",
            "amount_original": "1000", "currency": "ARS", "fx_ars_usd": "1000", "amount_usd": "1",
        }, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        return models.Invoice.objects.get(pk=res.data["id"])

    def _payment(self, invoice, amount="1000"):
        res = self.client.post("/api/payments/", {
            "invoice": invoice.id, "account": self.ars.id, "date": "2026-01-15",
            "amount_original": amount, "currency": "ARS", "fx_ars_usd": "1000",
            "amount_usd": str(Decimal(amount) / 1000),
        }, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        return models.Payment.objects.get(pk=res.data["id"])

    def test_invoiced_job_cannot_be_deleted(self):
        self._invoice()
        res = self.client.delete(f"/api/jobs/{self.job.id}/")
        self.assertEqual(res.status_code, 400)
        self.assertTrue(models.Job.objects.filter(pk=self.job.id).exists())

    def test_invoice_with_payments_cannot_be_deleted(self):
        invoice = self._invoice()
        self._payment(invoice)
        res = self.client.delete(f"/api/invoices/{invoice.id}/")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(models.Payment.objects.count(), 1)

    def test_deleting_invoice_returns_job_to_done(self):
        invoice = self._invoice()
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "INVOICED")
        self.assertEqual(self.client.delete(f"/api/invoices/{invoice.id}/").status_code, 204)
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "DONE")

    def test_editing_invoice_amount_recomputes_status(self):
        invoice = self._invoice()
        self._payment(invoice, "800")
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, "OPEN")
        res = self.client.patch(f"/api/invoices/{invoice.id}/", {"amount_original": "800", "amount_usd": "0.8"}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, "SETTLED")

    def test_editing_payment_amount_drops_distribution(self):
        payment = self._payment(self._invoice())
        res = self.client.post(f"/api/payments/{payment.id}/apply-distribution/", {}, format="json")
        self.assertEqual(res.status_code, 201)
        self.client.patch(f"/api/payments/{payment.id}/", {"date": "2026-01-16"}, format="json")
        self.assertEqual(payment.capital_events.count(), 1)
        self.client.patch(f"/api/payments/{payment.id}/", {"amount_original": "900", "amount_usd": "0.9"}, format="json")
        self.assertEqual(payment.capital_events.count(), 0)

    def test_distribution_event_cannot_be_deleted_directly(self):
        payment = self._payment(self._invoice())
        ev = models.CapitalEvent.objects.create(
            date=payment.date, investor=self.investor, kind="JOB_DISTRIBUTION", amount_original="1000",
            currency="ARS", fx_ars_usd="1000", amount_usd="1", payment=payment,
        )
        self.assertEqual(self.client.delete(f"/api/capital-events/{ev.id}/").status_code, 400)

    def test_protected_delete_returns_400(self):
        res = self.client.delete(f"/api/clients/{self.cli.id}/")
        self.assertEqual(res.status_code, 400)
        self.assertIn("detail", res.data)

    def test_investor_can_only_edit_own_expense(self):
        other = models.User.objects.create_user("inv", password="x", role=models.User.Role.INVESTOR)
        expense = models.Expense.objects.create(
            date=date(2026, 1, 1), concept="x", amount_original="10", currency="ARS",
            fx_ars_usd="1000", amount_usd="0.01", account=self.ars, created_by=self.admin,
        )
        self.client.force_authenticate(other)
        self.assertEqual(self.client.patch(f"/api/expenses/{expense.id}/", {"concept": "y"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/expenses/{expense.id}/").status_code, 403)

    def test_job_detail_includes_payments_and_distribution(self):
        payment = self._payment(self._invoice())
        models.CapitalEvent.objects.create(
            date=payment.date, investor=self.investor, kind="JOB_DISTRIBUTION", amount_original="1000",
            currency="ARS", fx_ars_usd="1000", amount_usd="1", payment=payment,
        )
        res = self.client.get(f"/api/jobs/{self.job.id}/detail/")
        self.assertEqual([p["id"] for p in res.data["payments"]], [payment.id])
        self.assertEqual(len(res.data["distributions"]), 1)

        # Un inversor ve el trabajo, pero solo su propia parte del reparto.
        other = models.User.objects.create_user("inv2", password="x", role=models.User.Role.INVESTOR)
        self.client.force_authenticate(other)
        res = self.client.get(f"/api/jobs/{self.job.id}/detail/")
        self.assertEqual(len(res.data["payments"]), 1)
        self.assertEqual(res.data["distributions"], [])


class PurchaseInstallmentsTests(APITestCase):
    def setUp(self):
        self.admin = models.User.objects.create_user("admin", password="x", role=models.User.Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def _bills(self, **body):
        res = self.client.post("/api/purchases/", {
            "date": "2026-09-27", "concept": "Generador", "installment_count": 2,
            "first_due_date": "2026-10-01", **body,
        }, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        purchase = models.Purchase.objects.get(pk=res.data["id"])
        return [
            (b.amount_original, b.currency, b.estimated_amount_usd)
            for b in purchase.bills.order_by("installment_number")
        ]

    def test_ars_installments_keep_pesos_and_estimate_usd(self):
        bills = self._bills(total_amount="9600000", currency="ARS", total_amount_usd="6400")
        self.assertEqual(bills, [(Decimal("4800000"), "ARS", Decimal("3200"))] * 2)

    def test_ars_installments_estimate_usd_from_fx(self):
        bills = self._bills(total_amount="9600000", currency="ARS", fx_ars_usd="1500")
        self.assertEqual(bills, [(Decimal("4800000"), "ARS", Decimal("3200"))] * 2)

    def test_usd_installments(self):
        bills = self._bills(total_amount="3000", currency="USD")
        self.assertEqual(bills, [(Decimal("1500"), "USD", Decimal("1500"))] * 2)
