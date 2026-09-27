from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from . import models


@admin.register(models.User)
class UserAdmin(DjangoUserAdmin):
    fieldsets = DjangoUserAdmin.fieldsets + (("Recalcatti", {"fields": ("role",)}),)
    list_display = ("username", "email", "role", "is_staff", "is_active")


@admin.register(models.Investor)
class InvestorAdmin(admin.ModelAdmin):
    list_display = ("name", "active", "user")


@admin.register(models.Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ("name", "active", "tax_id", "phone", "email")
    search_fields = ("name", "tax_id")


@admin.register(models.Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ("name", "currency", "balance")


@admin.register(models.Transfer)
class TransferAdmin(admin.ModelAdmin):
    list_display = ("date", "from_account", "to_account", "amount_from", "amount_to")


@admin.register(models.Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ("date", "client", "location", "work_type", "hectares", "status", "created_by")
    list_filter = ("status", "work_type")
    search_fields = ("client__name", "location")


class PaymentInline(admin.TabularInline):
    model = models.Payment
    extra = 0


@admin.register(models.Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ("date", "client", "amount_original", "currency", "status")
    list_filter = ("status", "currency")
    inlines = [PaymentInline]


@admin.register(models.Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("date", "invoice", "amount_original", "currency", "account")


@admin.register(models.CapitalEvent)
class CapitalEventAdmin(admin.ModelAdmin):
    list_display = ("date", "investor", "kind", "amount_original", "currency", "account", "payment")
    list_filter = ("kind",)


@admin.register(models.Purchase)
class PurchaseAdmin(admin.ModelAdmin):
    list_display = ("date", "concept", "total_amount", "currency", "installment_count", "status")


@admin.register(models.Bill)
class BillAdmin(admin.ModelAdmin):
    list_display = ("due_date", "concept", "purchase", "estimated_amount_usd", "status")
    list_filter = ("status", "source")


@admin.register(models.Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ("date", "concept", "amount_original", "currency", "paid_by", "account", "investor")
    list_filter = ("paid_by",)


@admin.register(models.ExchangeRate)
class ExchangeRateAdmin(admin.ModelAdmin):
    list_display = ("date", "ars_per_usd", "source")
