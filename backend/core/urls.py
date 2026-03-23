from django.urls import path

from .views import home_redirect

urlpatterns = [
    path('', home_redirect, name='home'),
]
