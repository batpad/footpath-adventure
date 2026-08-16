import hashlib
from io import BytesIO

from django.conf import settings
from django.contrib.gis.geos import Point
from django.core.files.uploadedfile import InMemoryUploadedFile
from PIL import Image
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from apps.levels.models import GeneratedLevel
from .models import ConditionReport, SegmentCondition
from .services import SnapError, locate_in_level, nearest_poi_name, snap_point

VALID_CATEGORIES = {c for c, _ in ConditionReport.CATEGORIES}


class ReportThrottle(AnonRateThrottle):
    rate = "20/hour"


def _strip_exif(upload) -> InMemoryUploadedFile | None:
    """Re-encode the photo without metadata (EXIF GPS included)."""
    try:
        img = Image.open(upload)
        img = img.convert("RGB")
    except Exception:
        return None
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=82)
    buf.seek(0)
    name = (upload.name.rsplit(".", 1)[0] or "photo") + ".jpg"
    return InMemoryUploadedFile(buf, None, name, "image/jpeg", buf.getbuffer().nbytes, None)


@api_view(["GET"])
def segments_geojson(request):
    """Reported street conditions as GeoJSON for the route-picker heatmap.

    One feature per segment, both sides merged: ``bad`` is the summed decayed
    weight of problem reports, ``good`` of positive ones.
    """
    by_segment: dict[int, dict] = {}
    for condition in SegmentCondition.objects.select_related("road_segment"):
        seg = condition.road_segment
        entry = by_segment.setdefault(
            seg.id,
            {"seg": seg, "bad": 0.0, "good": 0.0, "categories": {}},
        )
        for category, weight in condition.scores.items():
            if category == "good":
                entry["good"] += weight
            else:
                entry["bad"] += weight
                entry["categories"][category] = entry["categories"].get(category, 0.0) + weight

    features = []
    for entry in by_segment.values():
        if entry["bad"] < 0.05 and entry["good"] < 0.05:
            continue
        seg = entry["seg"]
        worst = max(entry["categories"], key=entry["categories"].get, default="")
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[round(x, 6), round(y, 6)] for x, y in seg.geom.coords],
                },
                "properties": {
                    "name": seg.name or seg.highway_class,
                    "bad": round(entry["bad"], 2),
                    "good": round(entry["good"], 2),
                    "worst": worst.replace("_", " "),
                },
            }
        )
    return Response({"type": "FeatureCollection", "features": features})


@api_view(["POST"])
@throttle_classes([ReportThrottle])
def create_report(request):
    data = request.data
    category = data.get("category")
    if category not in VALID_CATEGORIES:
        return Response({"detail": "Invalid category."}, status=400)
    try:
        severity = min(3, max(1, int(data.get("severity", 2))))
    except (TypeError, ValueError):
        severity = 2

    try:
        if data.get("level_token"):
            level = GeneratedLevel.objects.filter(token=data["level_token"]).first()
            if level is None:
                return Response({"detail": "Unknown level token."}, status=400)
            located = locate_in_level(
                level, float(data.get("distance_m", 0)), data.get("lane", "footpath")
            )
            point = located["point"]
        elif data.get("lng") and data.get("lat"):
            point = Point(float(data["lng"]), float(data["lat"]), srid=4326)
            located = snap_point(point)
        else:
            return Response(
                {"detail": "Provide level_token+distance_m or lng+lat."}, status=400
            )
    except (SnapError, TypeError, ValueError) as exc:
        return Response({"detail": str(exc)}, status=422)

    submitter_id = str(data.get("submitter_id", ""))[:64]
    submitter_hash = (
        hashlib.sha256(f"{settings.SECRET_KEY}:{submitter_id}".encode()).hexdigest()[:32]
        if submitter_id
        else ""
    )

    photo = None
    if request.FILES.get("photo"):
        photo = _strip_exif(request.FILES["photo"])
        if photo is None:
            return Response({"detail": "Could not read that photo."}, status=400)

    segment = located["segment"]
    report = ConditionReport.objects.create(
        photo=photo,
        category=category,
        severity=severity,
        note=str(data.get("note", ""))[:500],
        point=point,
        road_segment=segment,
        stable_key=segment.stable_key,
        side=located["side"],
        position_fraction=located["fraction"],
        near_poi_name=nearest_poi_name(point),
        submitter_hash=submitter_hash,
    )
    return Response(
        {
            "id": report.id,
            "status": report.status,
            "street": segment.name or segment.highway_class,
            "near": report.near_poi_name,
        },
        status=201,
    )
