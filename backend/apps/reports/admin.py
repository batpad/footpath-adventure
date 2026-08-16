from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin
from django.utils.html import format_html

from .models import ConditionReport, SegmentCondition
from .services import recompute_condition


@admin.register(ConditionReport)
class ConditionReportAdmin(GISModelAdmin):
    list_display = (
        "id",
        "thumbnail",
        "category",
        "severity",
        "near_poi_name",
        "street",
        "side",
        "status",
        "created_at",
    )
    list_filter = ("status", "category", "severity")
    search_fields = ("near_poi_name", "stable_key", "note")
    readonly_fields = ("thumbnail", "stable_key", "position_fraction", "submitter_hash")
    actions = ("approve", "reject")
    ordering = ("status", "-created_at")  # pending first

    @admin.display(description="photo")
    def thumbnail(self, obj):
        if not obj.photo:
            return "—"
        return format_html('<img src="{}" style="height:60px;border-radius:4px;">', obj.photo.url)

    @admin.display(description="street")
    def street(self, obj):
        return obj.road_segment.name or obj.stable_key if obj.road_segment else obj.stable_key

    @admin.action(description="Approve and apply to the game")
    def approve(self, request, queryset):
        approved = 0
        for report in queryset.exclude(status="approved"):
            report.status = "approved"
            report.save(update_fields=["status"])
            if report.road_segment and report.side:
                recompute_condition(report.road_segment, report.side)
            approved += 1
        self.message_user(request, f"Approved {approved} report(s) — the street has changed.")

    @admin.action(description="Reject")
    def reject(self, request, queryset):
        for report in queryset.exclude(status="rejected"):
            was_approved = report.status == "approved"
            report.status = "rejected"
            report.save(update_fields=["status"])
            if was_approved and report.road_segment and report.side:
                recompute_condition(report.road_segment, report.side)
        self.message_user(request, "Rejected.")


@admin.register(SegmentCondition)
class SegmentConditionAdmin(admin.ModelAdmin):
    list_display = ("road_segment", "side", "version", "updated_at")
    search_fields = ("road_segment__stable_key", "road_segment__name")
