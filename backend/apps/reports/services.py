"""Snapping, in-level location mapping, and condition aggregation."""

import math
from datetime import datetime, timezone

from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point

from apps.geodata.geoutil import side_of_line
from apps.geodata.models import Poi, RoadSegment
from apps.levels.models import GeneratedLevel
from .models import ConditionReport, SegmentCondition

SNAP_MAX_DEG = 0.0005  # ~55 m
ROAD_SIDE_DEG = 0.00003  # ~3.3 m of the centreline counts as "on the road"
POI_ANCHOR_DEG = 0.00055  # ~60 m
DECAY_DAYS = 60.0
# A single fresh severity-2 report is enough to materialise in the game.
HAZARD_POINT_MIN_WEIGHT = 0.9


class SnapError(Exception):
    pass


def snap_point(point: Point) -> dict:
    """Map-pin reports: nearest road segment, position along it, and side."""
    seg = (
        RoadSegment.objects.filter(geom__dwithin=(point, SNAP_MAX_DEG))
        .annotate(d=Distance("geom", point))
        .order_by("d")
        .first()
    )
    if seg is None:
        raise SnapError("That spot is too far from any mapped street (~50 m).")
    fraction = seg.geom.project_normalized(point)
    if seg.geom.distance(point) < ROAD_SIDE_DEG:
        side = "road"
    else:
        p0 = seg.geom.interpolate_normalized(max(0.0, fraction - 0.02))
        p1 = seg.geom.interpolate_normalized(min(1.0, fraction + 0.02))
        side = side_of_line((p0.x, p0.y), (p1.x, p1.y), (point.x, point.y))
    return {"segment": seg, "fraction": fraction, "side": side}


def locate_in_level(level: GeneratedLevel, distance_m: float, lane: str) -> dict:
    """In-game reports: exact segment/fraction/side from route distance.

    ``segment_offsets`` rows are travel-ordered ``{key, start_m, end_m,
    reversed}``; sides in the spec are travel-relative, so flip back to
    segment-relative when the segment was traversed backwards.
    """
    entry = None
    index = 0
    for i, off in enumerate(level.segment_offsets):
        if off["start_m"] <= distance_m <= off["end_m"]:
            entry, index = off, i
            break
    if entry is None:
        raise SnapError("That distance is outside the played route.")
    seg = RoadSegment.objects.filter(stable_key=entry["key"]).first()
    if seg is None:
        raise SnapError("Route segment no longer exists.")
    span = max(0.1, entry["end_m"] - entry["start_m"])
    fraction = (distance_m - entry["start_m"]) / span
    if entry["reversed"]:
        fraction = 1.0 - fraction
    if lane.startswith("road"):
        side = "road"
    else:
        travel_side = level.spec["segments"][index]["footpath"]["side"]
        side = travel_side
        if entry["reversed"]:
            side = "left" if side == "right" else "right"
    pt = seg.geom.interpolate_normalized(min(1.0, max(0.0, fraction)))
    return {"segment": seg, "fraction": fraction, "side": side, "point": Point(pt.x, pt.y, srid=4326)}


def nearest_poi_name(point: Point) -> str:
    poi = (
        Poi.objects.filter(point__dwithin=(point, POI_ANCHOR_DEG))
        .annotate(d=Distance("point", point))
        .order_by("d")
        .first()
    )
    return poi.name if poi else ""


def recompute_condition(road_segment: RoadSegment, side: str) -> SegmentCondition:
    """Recency-weighted aggregation of approved reports for one segment side."""
    now = datetime.now(timezone.utc)
    reports = ConditionReport.objects.filter(
        stable_key=road_segment.stable_key, side=side, status="approved"
    )
    scores: dict[str, float] = {}
    hazard_points: list[dict] = []
    for report in reports:
        age_days = max(0.0, (now - report.created_at).total_seconds() / 86400)
        weight = report.severity * math.exp(-age_days / DECAY_DAYS)
        scores[report.category] = round(scores.get(report.category, 0.0) + weight, 3)
        if (
            report.category != "good"
            and report.position_fraction is not None
            and weight >= HAZARD_POINT_MIN_WEIGHT
        ):
            hazard_points.append(
                {
                    "category": report.category,
                    "fraction": round(report.position_fraction, 4),
                    "severity": report.severity,
                    "weight": round(weight, 3),
                }
            )
    hazard_points.sort(key=lambda h: h["fraction"])

    condition, _ = SegmentCondition.objects.get_or_create(
        road_segment=road_segment, side=side
    )
    if condition.scores != scores or condition.hazard_points != hazard_points:
        condition.scores = scores
        condition.hazard_points = hazard_points
        condition.version += 1
        condition.save()
    return condition
