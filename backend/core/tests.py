from datetime import date
from decimal import Decimal

from django.test import SimpleTestCase, TestCase
from rest_framework.exceptions import ValidationError as ApiValidationError

from .api_views import (
    _alloc_by_weights,
    _collection_work_reference_date,
    _build_distribution_plan,
    _investor_capital_snapshot,
    _monthly_dashboard_data,
    add_months,
    recompute_job_status,
    sync_payment_obligation_status,
    sync_purchase_installments,
)
from .models import (
    CapitalContribution,
    Currency,
    Expense,
    Investor,
    Job,
    JobCollection,
    PaymentObligation,
    Purchase,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_investor(name, active=True):
    return Investor.objects.create(name=name, active=active)


def make_contribution(investor, kind, amount_usd, on_date):
    return CapitalContribution.objects.create(
        date=on_date, investor=investor, kind=kind, amount_usd=amount_usd
    )


def make_expense_by_investor(investor, amount_usd, on_date):
    return Expense.objects.create(
        date=on_date,
        concept="test",
        amount=amount_usd,
        currency=Currency.USD,
        fx_ars_usd=Decimal("1.0000"),
        amount_usd=amount_usd,
        paid_by=Expense.PaidBy.INVESTOR,
        payer_investor=investor,
    )


def make_job(on_date=date(2024, 1, 15), status=Job.Status.DONE):
    return Job.objects.create(date=on_date, status=status)


def make_collection(amount_usd, on_date=date(2024, 2, 1), status=JobCollection.Status.COLLECTED, collected_amount_usd=None):
    return JobCollection.objects.create(
        collection_date=on_date,
        amount_usd=amount_usd,
        collected_amount_usd=collected_amount_usd,
        status=status,
    )


# ---------------------------------------------------------------------------
# _alloc_by_weights — pure function, no DB
# ---------------------------------------------------------------------------

class AllocByWeightsTest(SimpleTestCase):

    def test_equal_weights_exact_division(self):
        result = _alloc_by_weights(
            Decimal("30.00"),
            [(1, Decimal("1")), (2, Decimal("1")), (3, Decimal("1"))],
        )
        self.assertEqual(result[1], Decimal("10.00"))
        self.assertEqual(result[2], Decimal("10.00"))
        self.assertEqual(result[3], Decimal("10.00"))

    def test_remainder_distributed_by_largest_remainder(self):
        # 10.00 / 3 = 3.33 + 3.33 + 3.34 — must sum exactly
        result = _alloc_by_weights(
            Decimal("10.00"),
            [(1, Decimal("1")), (2, Decimal("1")), (3, Decimal("1"))],
        )
        self.assertEqual(sum(result.values()), Decimal("10.00"))
        values = sorted(result.values())
        self.assertEqual(values[-1] - values[0], Decimal("0.01"))

    def test_total_preserved_with_many_items(self):
        # 7 equal shares of 100.00 must still sum exactly
        items = [(i, Decimal("1")) for i in range(7)]
        result = _alloc_by_weights(Decimal("100.00"), items)
        self.assertEqual(sum(result.values()), Decimal("100.00"))

    def test_unequal_weights_60_40(self):
        result = _alloc_by_weights(
            Decimal("100.00"),
            [(1, Decimal("60")), (2, Decimal("40"))],
        )
        self.assertEqual(result[1], Decimal("60.00"))
        self.assertEqual(result[2], Decimal("40.00"))

    def test_single_item_gets_whole_total(self):
        result = _alloc_by_weights(Decimal("42.57"), [(1, Decimal("1"))])
        self.assertEqual(result[1], Decimal("42.57"))

    def test_empty_returns_empty_dict(self):
        self.assertEqual(_alloc_by_weights(Decimal("100.00"), []), {})

    def test_all_zero_weights_return_zero(self):
        result = _alloc_by_weights(
            Decimal("100.00"),
            [(1, Decimal("0")), (2, Decimal("0"))],
        )
        self.assertEqual(result[1], Decimal("0.00"))
        self.assertEqual(result[2], Decimal("0.00"))

    def test_zero_total(self):
        result = _alloc_by_weights(
            Decimal("0.00"),
            [(1, Decimal("1")), (2, Decimal("1"))],
        )
        self.assertEqual(result[1], Decimal("0.00"))
        self.assertEqual(result[2], Decimal("0.00"))


# ---------------------------------------------------------------------------
# add_months — pure function, no DB
# ---------------------------------------------------------------------------

class AddMonthsTest(SimpleTestCase):

    def test_simple_addition(self):
        self.assertEqual(add_months(date(2024, 3, 15), 1), date(2024, 4, 15))

    def test_cross_year_boundary(self):
        self.assertEqual(add_months(date(2024, 12, 15), 1), date(2025, 1, 15))

    def test_month_end_clamp_leap_year(self):
        self.assertEqual(add_months(date(2024, 1, 31), 1), date(2024, 2, 29))

    def test_month_end_clamp_non_leap_year(self):
        self.assertEqual(add_months(date(2023, 1, 31), 1), date(2023, 2, 28))

    def test_multiple_months(self):
        self.assertEqual(add_months(date(2024, 1, 15), 6), date(2024, 7, 15))

    def test_zero_months_is_identity(self):
        self.assertEqual(add_months(date(2024, 5, 10), 0), date(2024, 5, 10))


# ---------------------------------------------------------------------------
# _investor_capital_snapshot
# ---------------------------------------------------------------------------

class CapitalSnapshotTest(TestCase):

    def test_proportional_percentages(self):
        inv_a = make_investor("Ana")
        inv_b = make_investor("Bruno")
        make_contribution(inv_a, CapitalContribution.Kind.DIRECT, Decimal("60.00"), date(2024, 1, 1))
        make_contribution(inv_b, CapitalContribution.Kind.DIRECT, Decimal("40.00"), date(2024, 1, 1))

        snapshot = _investor_capital_snapshot(date(2024, 6, 1))

        by_name = {row["investor"].name: row for row in snapshot}
        self.assertAlmostEqual(float(by_name["Ana"]["company_percentage"]), 0.6)
        self.assertAlmostEqual(float(by_name["Bruno"]["company_percentage"]), 0.4)

    def test_expense_counts_as_capital(self):
        inv = make_investor("Ana")
        make_expense_by_investor(inv, Decimal("50.00"), date(2024, 1, 1))

        snapshot = _investor_capital_snapshot(date(2024, 6, 1))

        self.assertEqual(snapshot[0]["capital"], Decimal("50.00"))
        self.assertEqual(snapshot[0]["company_percentage"], Decimal("1"))

    def test_reinvestment_adds_to_capital(self):
        inv = make_investor("Ana")
        make_contribution(inv, CapitalContribution.Kind.DIRECT, Decimal("50.00"), date(2024, 1, 1))
        make_contribution(inv, CapitalContribution.Kind.REINVESTMENT, Decimal("25.00"), date(2024, 2, 1))

        snapshot = _investor_capital_snapshot(date(2024, 6, 1))

        self.assertEqual(snapshot[0]["capital"], Decimal("75.00"))

    def test_withdrawal_reduces_capital(self):
        inv = make_investor("Ana")
        make_contribution(inv, CapitalContribution.Kind.DIRECT, Decimal("100.00"), date(2024, 1, 1))
        make_contribution(inv, CapitalContribution.Kind.WITHDRAWAL, Decimal("30.00"), date(2024, 2, 1))

        snapshot = _investor_capital_snapshot(date(2024, 6, 1))

        self.assertEqual(snapshot[0]["capital"], Decimal("70.00"))

    def test_withdrawal_floors_at_zero(self):
        inv = make_investor("Ana")
        make_contribution(inv, CapitalContribution.Kind.DIRECT, Decimal("10.00"), date(2024, 1, 1))
        make_contribution(inv, CapitalContribution.Kind.WITHDRAWAL, Decimal("50.00"), date(2024, 2, 1))

        snapshot = _investor_capital_snapshot(date(2024, 6, 1))

        self.assertEqual(snapshot[0]["capital"], Decimal("0"))

    def test_equal_distribution_when_total_capital_is_zero(self):
        make_investor("Ana")
        make_investor("Bruno")

        snapshot = _investor_capital_snapshot(date(2024, 6, 1))

        percentages = [row["company_percentage"] for row in snapshot]
        self.assertEqual(len(set(percentages)), 1)  # all equal
        self.assertAlmostEqual(float(sum(percentages)), 1.0)

    def test_date_filter_excludes_future_contributions(self):
        inv = make_investor("Ana")
        make_contribution(inv, CapitalContribution.Kind.DIRECT, Decimal("100.00"), date(2024, 6, 1))

        snapshot = _investor_capital_snapshot(date(2024, 5, 31))

        self.assertEqual(snapshot[0]["capital"], Decimal("0"))

    def test_inactive_investors_excluded(self):
        make_investor("Inactivo", active=False)

        snapshot = _investor_capital_snapshot(date(2024, 6, 1))

        self.assertEqual(snapshot, [])

    def test_no_investors_returns_empty(self):
        self.assertEqual(_investor_capital_snapshot(date(2024, 6, 1)), [])


# ---------------------------------------------------------------------------
# _build_distribution_plan
# ---------------------------------------------------------------------------

class BuildDistributionPlanTest(TestCase):

    def _two_investors_60_40(self, on_date=date(2024, 1, 1)):
        inv_a = make_investor("Ana")
        inv_b = make_investor("Bruno")
        make_contribution(inv_a, CapitalContribution.Kind.DIRECT, Decimal("60.00"), on_date)
        make_contribution(inv_b, CapitalContribution.Kind.DIRECT, Decimal("40.00"), on_date)
        return inv_a, inv_b

    def test_basic_math_field_team_plus_shareholders(self):
        inv_a, inv_b = self._two_investors_60_40()
        collection = make_collection(Decimal("100.00"), collected_amount_usd=Decimal("100.00"))

        plan = _build_distribution_plan(
            collection=collection,
            field_team_percentage=Decimal("20"),
            worker_investor_ids=[inv_a.id],
        )

        self.assertEqual(plan["field_team_total_usd"], Decimal("20.00"))
        self.assertEqual(plan["shareholder_total_usd"], Decimal("80.00"))

        rows = {r["investor_id"]: r for r in plan["investor_rows"]}
        # Ana: $20 field team + $48 shareholder (60% of $80)
        self.assertEqual(rows[inv_a.id]["worker_amount_usd"], Decimal("20.00"))
        self.assertEqual(rows[inv_a.id]["shareholder_amount_usd"], Decimal("48.00"))
        self.assertEqual(rows[inv_a.id]["total_amount_usd"], Decimal("68.00"))
        # Bruno: $0 field team + $32 shareholder (40% of $80)
        self.assertEqual(rows[inv_b.id]["worker_amount_usd"], Decimal("0.00"))
        self.assertEqual(rows[inv_b.id]["shareholder_amount_usd"], Decimal("32.00"))
        self.assertEqual(rows[inv_b.id]["total_amount_usd"], Decimal("32.00"))

    def test_field_plus_shareholder_totals_equal_target(self):
        # Checks rounding never loses or gains a cent
        self._two_investors_60_40()
        collection = make_collection(Decimal("99.99"), collected_amount_usd=Decimal("99.99"))

        plan = _build_distribution_plan(
            collection=collection,
            field_team_percentage=Decimal("33"),
            worker_investor_ids=[inv.id for inv in Investor.objects.all()],
        )

        self.assertEqual(
            plan["field_team_total_usd"] + plan["shareholder_total_usd"],
            plan["target_usd"],
        )

    def test_zero_field_team_all_goes_to_shareholders(self):
        make_investor("Ana")
        collection = make_collection(Decimal("100.00"), collected_amount_usd=Decimal("100.00"))

        plan = _build_distribution_plan(
            collection=collection,
            field_team_percentage=Decimal("0"),
            worker_investor_ids=[],
        )

        self.assertEqual(plan["field_team_total_usd"], Decimal("0.00"))
        self.assertEqual(plan["shareholder_total_usd"], Decimal("100.00"))
        for row in plan["investor_rows"]:
            self.assertEqual(row["worker_amount_usd"], Decimal("0.00"))

    def test_uses_collected_amount_usd_over_amount_usd(self):
        make_investor("Ana")
        # amount_usd = 200, collected = 150 — should use 150
        collection = make_collection(Decimal("200.00"), collected_amount_usd=Decimal("150.00"))

        plan = _build_distribution_plan(
            collection=collection,
            field_team_percentage=Decimal("0"),
            worker_investor_ids=[],
        )

        self.assertEqual(plan["target_usd"], Decimal("150.00"))

    def test_raises_if_not_collected_status(self):
        make_investor("Ana")
        collection = make_collection(Decimal("100.00"), status=JobCollection.Status.BILLED)

        with self.assertRaises(ApiValidationError):
            _build_distribution_plan(
                collection=collection,
                field_team_percentage=Decimal("20"),
                worker_investor_ids=[],
            )

    def test_raises_if_percentage_over_100(self):
        make_investor("Ana")
        collection = make_collection(Decimal("100.00"), collected_amount_usd=Decimal("100.00"))

        with self.assertRaises(ApiValidationError):
            _build_distribution_plan(
                collection=collection,
                field_team_percentage=Decimal("101"),
                worker_investor_ids=[],
            )

    def test_raises_if_field_team_nonzero_with_no_workers(self):
        make_investor("Ana")
        collection = make_collection(Decimal("100.00"), collected_amount_usd=Decimal("100.00"))

        with self.assertRaises(ApiValidationError):
            _build_distribution_plan(
                collection=collection,
                field_team_percentage=Decimal("20"),
                worker_investor_ids=[],
            )

    def test_inactive_worker_id_is_ignored(self):
        inv_active = make_investor("Ana")
        inv_inactive = make_investor("Inactivo", active=False)
        make_contribution(inv_active, CapitalContribution.Kind.DIRECT, Decimal("100.00"), date(2024, 1, 1))
        collection = make_collection(Decimal("100.00"), collected_amount_usd=Decimal("100.00"))

        # Passing an inactive investor as worker should be silently filtered,
        # leaving no valid workers → raises because field_team_percentage > 0.
        with self.assertRaises(ApiValidationError):
            _build_distribution_plan(
                collection=collection,
                field_team_percentage=Decimal("20"),
                worker_investor_ids=[inv_inactive.id],
            )


# ---------------------------------------------------------------------------
# recompute_job_status
# ---------------------------------------------------------------------------

class RecomputeJobStatusTest(TestCase):

    def test_no_collections_keeps_done(self):
        job = make_job(status=Job.Status.DONE)
        recompute_job_status(job)
        job.refresh_from_db()
        self.assertEqual(job.status, Job.Status.DONE)

    def test_billed_collection_sets_invoiced(self):
        job = make_job(status=Job.Status.DONE)
        col = make_collection(Decimal("100.00"), status=JobCollection.Status.BILLED)
        col.jobs.add(job)

        recompute_job_status(job)

        job.refresh_from_db()
        self.assertEqual(job.status, Job.Status.INVOICED)

    def test_collected_collection_sets_collected(self):
        job = make_job(status=Job.Status.DONE)
        col = make_collection(Decimal("100.00"), status=JobCollection.Status.COLLECTED)
        col.jobs.add(job)

        recompute_job_status(job)

        job.refresh_from_db()
        self.assertEqual(job.status, Job.Status.COLLECTED)

    def test_collected_takes_precedence_over_billed(self):
        job = make_job(status=Job.Status.DONE)
        billed = make_collection(Decimal("50.00"), status=JobCollection.Status.BILLED)
        billed.jobs.add(job)
        collected = make_collection(Decimal("50.00"), status=JobCollection.Status.COLLECTED)
        collected.jobs.add(job)

        recompute_job_status(job)

        job.refresh_from_db()
        self.assertEqual(job.status, Job.Status.COLLECTED)

    def test_cancelled_job_is_not_touched(self):
        job = make_job(status=Job.Status.CANCELLED)
        col = make_collection(Decimal("100.00"), status=JobCollection.Status.COLLECTED)
        col.jobs.add(job)

        recompute_job_status(job)

        job.refresh_from_db()
        self.assertEqual(job.status, Job.Status.CANCELLED)

    def test_invoiced_job_reverts_to_done_when_no_collections(self):
        job = make_job(status=Job.Status.INVOICED)
        recompute_job_status(job)
        job.refresh_from_db()
        self.assertEqual(job.status, Job.Status.DONE)


# ---------------------------------------------------------------------------
# sync_payment_obligation_status
# ---------------------------------------------------------------------------

class SyncPaymentObligationStatusTest(TestCase):

    def _make_obligation(self, amount, currency=Currency.USD):
        estimated = amount if currency == Currency.USD else (amount / Decimal("1000"))
        return PaymentObligation.objects.create(
            concept="test",
            due_date=date(2024, 3, 1),
            amount=amount,
            currency=currency,
            estimated_amount_usd=estimated,
            status=PaymentObligation.Status.PENDING,
        )

    def _pay(self, obligation, amount, currency=Currency.USD, fx=Decimal("1.0000")):
        amount_usd = amount if currency == Currency.USD else (amount / fx)
        return Expense.objects.create(
            date=date(2024, 3, 1),
            concept="pago",
            amount=amount,
            currency=currency,
            fx_ars_usd=fx,
            amount_usd=amount_usd,
            paid_by=Expense.PaidBy.CASH,
            payment_obligation=obligation,
        )

    def test_full_payment_sets_paid(self):
        ob = self._make_obligation(Decimal("100.00"))
        self._pay(ob, Decimal("100.00"))

        sync_payment_obligation_status(ob.id)

        ob.refresh_from_db()
        self.assertEqual(ob.status, PaymentObligation.Status.PAID)

    def test_partial_payment_sets_partial(self):
        ob = self._make_obligation(Decimal("100.00"))
        self._pay(ob, Decimal("50.00"))

        sync_payment_obligation_status(ob.id)

        ob.refresh_from_db()
        self.assertEqual(ob.status, PaymentObligation.Status.PARTIAL)

    def test_no_payment_stays_pending(self):
        ob = self._make_obligation(Decimal("100.00"))

        sync_payment_obligation_status(ob.id)

        ob.refresh_from_db()
        self.assertEqual(ob.status, PaymentObligation.Status.PENDING)

    def test_multiple_expenses_summed(self):
        ob = self._make_obligation(Decimal("100.00"))
        self._pay(ob, Decimal("60.00"))
        self._pay(ob, Decimal("40.00"))

        sync_payment_obligation_status(ob.id)

        ob.refresh_from_db()
        self.assertEqual(ob.status, PaymentObligation.Status.PAID)

    def test_within_epsilon_counts_as_paid(self):
        # $99.99 paid on $100.00 obligation — within epsilon of $0.01
        ob = self._make_obligation(Decimal("100.00"))
        self._pay(ob, Decimal("99.99"))

        sync_payment_obligation_status(ob.id)

        ob.refresh_from_db()
        self.assertEqual(ob.status, PaymentObligation.Status.PAID)

    def test_ars_obligation_paid_in_ars(self):
        ob = self._make_obligation(Decimal("1000.00"), currency=Currency.ARS)
        self._pay(ob, Decimal("1000.00"), currency=Currency.ARS, fx=Decimal("1000.0000"))

        sync_payment_obligation_status(ob.id)

        ob.refresh_from_db()
        self.assertEqual(ob.status, PaymentObligation.Status.PAID)

    def test_ars_obligation_partial_in_ars(self):
        ob = self._make_obligation(Decimal("1000.00"), currency=Currency.ARS)
        self._pay(ob, Decimal("400.00"), currency=Currency.ARS, fx=Decimal("1000.0000"))

        sync_payment_obligation_status(ob.id)

        ob.refresh_from_db()
        self.assertEqual(ob.status, PaymentObligation.Status.PARTIAL)

    def test_nonexistent_id_does_nothing(self):
        sync_payment_obligation_status(99999)  # should not raise

    def test_cancelled_obligation_is_not_modified(self):
        ob = self._make_obligation(Decimal("100.00"))
        ob.status = PaymentObligation.Status.CANCELLED
        ob.save()
        self._pay(ob, Decimal("100.00"))

        sync_payment_obligation_status(ob.id)

        ob.refresh_from_db()
        self.assertEqual(ob.status, PaymentObligation.Status.CANCELLED)


# ---------------------------------------------------------------------------
# sync_purchase_installments
# ---------------------------------------------------------------------------

class SyncPurchaseInstallmentsTest(TestCase):

    def _make_purchase(self, total, currency=Currency.USD, installments=0, first_due=None, fx=None):
        return Purchase.objects.create(
            created_date=date(2024, 1, 1),
            concept="Compra test",
            total_amount=total,
            total_currency=currency,
            fx_ars_usd=fx,
            installment_count=installments,
            first_due_date=first_due,
        )

    def test_generates_correct_number_of_installments(self):
        purchase = self._make_purchase(Decimal("300.00"), installments=3, first_due=date(2024, 2, 1))
        sync_purchase_installments(purchase)

        self.assertEqual(purchase.obligations.count(), 3)

    def test_installment_amounts_sum_to_total(self):
        purchase = self._make_purchase(Decimal("100.00"), installments=3, first_due=date(2024, 2, 1))
        sync_purchase_installments(purchase)

        total = sum(ob.amount for ob in purchase.obligations.all())
        self.assertEqual(total, Decimal("100.00"))

    def test_remainder_goes_to_first_installments(self):
        # 100.00 / 3: first gets $33.34, rest get $33.33
        purchase = self._make_purchase(Decimal("100.00"), installments=3, first_due=date(2024, 2, 1))
        sync_purchase_installments(purchase)

        obligations = list(purchase.obligations.order_by("installment_number"))
        self.assertEqual(obligations[0].amount, Decimal("33.34"))
        self.assertEqual(obligations[1].amount, Decimal("33.33"))
        self.assertEqual(obligations[2].amount, Decimal("33.33"))

    def test_due_dates_increment_monthly(self):
        purchase = self._make_purchase(Decimal("300.00"), installments=3, first_due=date(2024, 1, 31))
        sync_purchase_installments(purchase)

        obligations = list(purchase.obligations.order_by("installment_number"))
        self.assertEqual(obligations[0].due_date, date(2024, 1, 31))
        self.assertEqual(obligations[1].due_date, date(2024, 2, 29))  # 2024 is leap
        self.assertEqual(obligations[2].due_date, date(2024, 3, 31))

    def test_concept_includes_installment_fraction(self):
        purchase = self._make_purchase(Decimal("300.00"), installments=3, first_due=date(2024, 2, 1))
        sync_purchase_installments(purchase)

        obligations = list(purchase.obligations.order_by("installment_number"))
        self.assertIn("1/3", obligations[0].concept)
        self.assertIn("3/3", obligations[2].concept)

    def test_ars_purchase_estimates_usd_via_fx(self):
        # 1000 ARS / 1000 ARS per USD = 1.00 USD each (2 installments of 500 ARS)
        purchase = self._make_purchase(
            Decimal("1000.00"),
            currency=Currency.ARS,
            installments=2,
            first_due=date(2024, 2, 1),
            fx=Decimal("1000.0000"),
        )
        sync_purchase_installments(purchase)

        for ob in purchase.obligations.all():
            self.assertEqual(ob.currency, Currency.ARS)
            self.assertEqual(ob.estimated_amount_usd, Decimal("0.50"))

    def test_zero_installments_removes_existing(self):
        purchase = self._make_purchase(Decimal("300.00"), installments=3, first_due=date(2024, 2, 1))
        sync_purchase_installments(purchase)
        self.assertEqual(purchase.obligations.count(), 3)

        purchase.installment_count = 0
        purchase.save()
        sync_purchase_installments(purchase)

        self.assertEqual(purchase.obligations.count(), 0)

    def test_increasing_installment_count(self):
        purchase = self._make_purchase(Decimal("300.00"), installments=2, first_due=date(2024, 2, 1))
        sync_purchase_installments(purchase)
        self.assertEqual(purchase.obligations.count(), 2)

        purchase.installment_count = 4
        purchase.save()
        sync_purchase_installments(purchase)

        self.assertEqual(purchase.obligations.count(), 4)
        for ob in purchase.obligations.all():
            self.assertEqual(ob.installment_total, 4)

    def test_decreasing_installment_count(self):
        purchase = self._make_purchase(Decimal("300.00"), installments=4, first_due=date(2024, 2, 1))
        sync_purchase_installments(purchase)

        purchase.installment_count = 2
        purchase.save()
        sync_purchase_installments(purchase)

        obligations = list(purchase.obligations.order_by("installment_number"))
        self.assertEqual(len(obligations), 2)
        self.assertEqual(obligations[0].installment_total, 2)
        self.assertEqual(obligations[1].installment_total, 2)


# ---------------------------------------------------------------------------
# Dashboard monthly aggregation
# ---------------------------------------------------------------------------

class DashboardMonthlyDataTest(TestCase):

    def test_collected_gain_is_grouped_by_work_date_not_collection_date(self):
        job = make_job(on_date=date(2024, 1, 15))
        collection = make_collection(
            Decimal("100.00"),
            on_date=date(2024, 3, 10),
            collected_amount_usd=Decimal("100.00"),
        )
        collection.job = job
        collection.save(update_fields=["job"])

        monthly_data = _monthly_dashboard_data()

        self.assertEqual(monthly_data, [{"month": "2024-01", "expenses": 0.0, "gains": 100.0}])

    def test_grouped_collection_uses_latest_work_date_reference(self):
        january_job = make_job(on_date=date(2024, 1, 15))
        february_job = make_job(on_date=date(2024, 2, 20))
        collection = make_collection(
            Decimal("90.00"),
            on_date=date(2024, 3, 5),
            collected_amount_usd=Decimal("90.00"),
        )
        collection.jobs.add(january_job, february_job)

        self.assertEqual(_collection_work_reference_date(collection), date(2024, 2, 20))

        monthly_data = _monthly_dashboard_data()

        self.assertEqual(monthly_data, [{"month": "2024-02", "expenses": 0.0, "gains": 90.0}])
