from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("users", views.UserViewSet, basename="user")
router.register("investors", views.InvestorViewSet, basename="investor")
router.register("clients", views.ClientViewSet, basename="client")
router.register("accounts", views.AccountViewSet, basename="account")
router.register("transfers", views.TransferViewSet, basename="transfer")
router.register("jobs", views.JobViewSet, basename="job")
router.register("invoices", views.InvoiceViewSet, basename="invoice")
router.register("payments", views.PaymentViewSet, basename="payment")
router.register("capital-events", views.CapitalEventViewSet, basename="capital-event")
router.register("purchases", views.PurchaseViewSet, basename="purchase")
router.register("bills", views.BillViewSet, basename="bill")
router.register("expenses", views.ExpenseViewSet, basename="expense")
router.register("exchange-rates", views.ExchangeRateViewSet, basename="exchange-rate")

urlpatterns = [
    path("auth/login/", views.login_view),
    path("fx/ars-usd/", views.ars_usd_view),
    path("dashboard/summary/", views.DashboardSummaryView.as_view()),
    path("", include(router.urls)),
]
