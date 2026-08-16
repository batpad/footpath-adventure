from django.urls import path

from . import views

urlpatterns = [
    path("area/", views.area),
    path("levels/", views.create_level),
    path("levels/<str:token>/", views.get_level),
]
