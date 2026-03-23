from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .api_views import (
    CapitalContributionViewSet,
    CashMovementViewSet,
    ClientViewSet,
    DashboardViewSet,
    ExchangeRateViewSet,
    ExpenseViewSet,
    FxQuoteApiView,
    InvestorViewSet,
    JobCollectionViewSet,
    JobDistributionViewSet,
    JobViewSet,
    LoginApiView,
    PaymentObligationViewSet,
    PurchaseViewSet,
    ReinvestmentViewSet,
)

router = DefaultRouter()
router.register("investors", InvestorViewSet, basename="api-investors")
router.register("clients", ClientViewSet, basename="api-clients")
router.register("exchange-rates", ExchangeRateViewSet, basename="api-exchange-rates")
router.register("capital-contributions", CapitalContributionViewSet, basename="api-capital-contributions")
router.register("cash-movements", CashMovementViewSet, basename="api-cash-movements")
router.register("purchases", PurchaseViewSet, basename="api-purchases")
router.register("payment-obligations", PaymentObligationViewSet, basename="api-payment-obligations")
router.register("expenses", ExpenseViewSet, basename="api-expenses")
router.register("jobs", JobViewSet, basename="api-jobs")
router.register("job-collections", JobCollectionViewSet, basename="api-job-collections")
router.register("job-distributions", JobDistributionViewSet, basename="api-job-distributions")
router.register("reinvestments", ReinvestmentViewSet, basename="api-reinvestments")
router.register("dashboard", DashboardViewSet, basename="api-dashboard")

urlpatterns = [
    path("auth/login/", LoginApiView.as_view(), name="api-login"),
    path("fx/ars-usd/", FxQuoteApiView.as_view(), name="api-fx-ars-usd"),
    path("", include(router.urls)),
]
