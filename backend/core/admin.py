from django.contrib import admin

from .models import (
    CapitalContribution,
    CashMovement,
    Client,
    ExchangeRate,
    Expense,
    Investor,
    Job,
    JobCollection,
    JobDistribution,
    PaymentObligation,
    Purchase,
    Reinvestment,
)

admin.site.register(Investor)
admin.site.register(Client)
admin.site.register(ExchangeRate)
admin.site.register(CapitalContribution)
admin.site.register(CashMovement)
admin.site.register(Purchase)
admin.site.register(PaymentObligation)
admin.site.register(Expense)
admin.site.register(Job)
admin.site.register(JobCollection)
admin.site.register(JobDistribution)
admin.site.register(Reinvestment)
