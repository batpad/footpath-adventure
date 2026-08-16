"""Refresh all segment conditions so time decay takes effect.

Run periodically (cron/launchd): python manage.py recompute_conditions
"""

from django.core.management.base import BaseCommand

from apps.reports.models import SegmentCondition
from apps.reports.services import recompute_condition


class Command(BaseCommand):
    help = "Recompute all segment conditions (applies recency decay)"

    def handle(self, **options):
        changed = 0
        for condition in SegmentCondition.objects.select_related("road_segment"):
            before = condition.version
            after = recompute_condition(condition.road_segment, condition.side)
            if after.version != before:
                changed += 1
        self.stdout.write(self.style.SUCCESS(f"Recomputed; {changed} condition(s) changed."))
