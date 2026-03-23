from django.shortcuts import redirect


def home_redirect(_request):
    return redirect('/admin/')
