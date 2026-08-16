from django.contrib.gis.db.models.aggregates import Extent
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.geodata.models import Junction
from .generator import GenerationError, generate_spec
from .graph import GraphService, RouteError
from .models import GeneratedLevel


# The area we actually asked Overpass for; ways crossing the boundary drag
# junction extents far outside it, so clamp what the map zooms to.
CLIP_BBOX = (72.826, 19.042, 72.848, 19.065)


@api_view(["GET"])
def area(request):
    extent = Junction.objects.aggregate(bbox=Extent("point"))["bbox"]
    if not extent:
        return Response({"detail": "No data ingested yet."}, status=503)
    bbox = (
        max(extent[0], CLIP_BBOX[0]),
        max(extent[1], CLIP_BBOX[1]),
        min(extent[2], CLIP_BBOX[2]),
        min(extent[3], CLIP_BBOX[3]),
    )
    return Response(
        {
            "bbox": bbox,  # (min_lng, min_lat, max_lng, max_lat)
            "center": [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
            "name": "Bandra West, Mumbai",
        }
    )


@api_view(["POST"])
def create_level(request):
    data = request.data
    try:
        origin = [float(v) for v in data["origin"]]
        destination = [float(v) for v in data["destination"]]
    except (KeyError, TypeError, ValueError):
        return Response({"detail": "origin and destination must be [lng, lat]."}, status=400)
    mode = data.get("mode", "dry")
    if mode not in ("dry", "monsoon"):
        return Response({"detail": "mode must be 'dry' or 'monsoon'."}, status=400)

    try:
        route = GraphService.get().route(tuple(origin), tuple(destination))
        spec, offsets = generate_spec(route, mode)
    except (RouteError, GenerationError) as exc:
        return Response({"detail": str(exc)}, status=422)

    level = GeneratedLevel.objects.create(spec=spec, segment_offsets=offsets)
    spec["level_token"] = level.token
    level.spec = spec
    level.save(update_fields=["spec"])
    return Response(spec, status=201)


@api_view(["GET"])
def get_level(request, token):
    level = get_object_or_404(GeneratedLevel, token=token)
    return Response(level.spec)
