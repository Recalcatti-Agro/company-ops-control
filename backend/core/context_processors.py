from django.conf import settings


def branding(_request):
    return {"company_name": getattr(settings, "COMPANY_NAME", "Control Empresarial")}
