from django.contrib.gis.db import models


class ConditionReport(models.Model):
    """One crowdsourced observation about a real stretch of footpath/road."""

    CATEGORIES = [
        ("blocked_hawker", "Blocked by hawkers"),
        ("blocked_parked_vehicle", "Blocked by parked vehicles"),
        ("broken_surface", "Broken surface"),
        ("open_drain", "Open drain"),
        ("no_kerb_ramp", "No kerb ramp"),
        ("dead_end", "Footpath dead-ends"),
        ("construction", "Construction"),
        ("waterlogging", "Waterlogging"),
        ("encroachment", "Encroachment"),
        ("obstacle_pole", "Pole/obstacle"),
        ("narrow", "Too narrow"),
        ("good", "Actually good!"),
    ]
    STATUS = [("pending", "pending"), ("approved", "approved"), ("rejected", "rejected")]
    SIDES = [("left", "left"), ("right", "right"), ("road", "road")]

    photo = models.ImageField(upload_to="reports/%Y/%m/", blank=True)
    category = models.CharField(max_length=32, choices=CATEGORIES)
    severity = models.PositiveSmallIntegerField(default=2)  # 1 mild .. 3 severe
    note = models.TextField(blank=True, max_length=500)
    point = models.PointField(srid=4326)
    road_segment = models.ForeignKey(
        "geodata.RoadSegment", null=True, blank=True, on_delete=models.SET_NULL
    )
    # Survives re-ingest even if the FK row is replaced.
    stable_key = models.CharField(max_length=32, blank=True)
    side = models.CharField(max_length=5, choices=SIDES, blank=True)
    position_fraction = models.FloatField(null=True, blank=True)
    near_poi_name = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=8, choices=STATUS, default="pending")
    submitter_hash = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        where = self.near_poi_name or self.stable_key or "unsnapped"
        return f"{self.category} near {where} ({self.status})"


class SegmentCondition(models.Model):
    """Aggregated, recency-weighted condition per (segment, side).

    ``version`` feeds the level seed, so a street's levels only change when
    its real-world condition does.
    """

    road_segment = models.ForeignKey("geodata.RoadSegment", on_delete=models.CASCADE)
    side = models.CharField(max_length=5)
    scores = models.JSONField(default=dict)  # {category: decayed weight}
    hazard_points = models.JSONField(default=list)  # [{category, fraction, severity, weight}]
    version = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("road_segment", "side")

    def __str__(self) -> str:
        return f"{self.road_segment.stable_key}/{self.side} v{self.version}"
