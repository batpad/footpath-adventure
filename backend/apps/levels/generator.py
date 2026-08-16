"""Route -> LevelSpec compiler.

Deterministic: the same route + mode (+ condition versions, from M4) always
produces byte-identical output, so a street plays the same for everyone until
its real-world conditions change. Keep the JSON shape in lockstep with
frontend/src/level/types.ts.
"""

import random
import zlib

from apps.geodata.geoutil import bearing_deg, side_of_line
from apps.geodata.models import CrossingNode, Poi, RoadSegment
from apps.reports.models import SegmentCondition

POI_MATCH_DIST_DEG = 0.00027  # ~30 m
MAX_POIS_PER_SEGMENT = 10

MIN_ROUTE_M = 120
MAX_ROUTE_M = 3000

TRAFFIC_DENSITY = {
    "primary": 1.0,
    "secondary": 0.85,
    "tertiary": 0.6,
    "unclassified": 0.4,
    "residential": 0.35,
    "living_street": 0.2,
    "service": 0.25,
}

VEHICLE_MIX = {
    "primary": {"car": 0.45, "rickshaw": 0.3, "bus": 0.15, "bike": 0.1},
    "secondary": {"car": 0.45, "rickshaw": 0.3, "bus": 0.15, "bike": 0.1},
    "tertiary": {"car": 0.3, "rickshaw": 0.5, "bus": 0.05, "bike": 0.15},
}
DEFAULT_MIX = {"car": 0.2, "rickshaw": 0.5, "bus": 0.0, "bike": 0.3}

# Hawker-stall pressure per road class (denser on market-y streets).
STALL_CHANCE = {
    "residential": 0.5,
    "tertiary": 0.45,
    "unclassified": 0.4,
    "living_street": 0.45,
    "secondary": 0.35,
    "primary": 0.3,
    "service": 0.2,
}

BAD_SURFACES = {"unpaved", "gravel", "dirt", "ground", "sand", "compacted"}


class GenerationError(Exception):
    pass


def _crc(text: str) -> int:
    return zlib.crc32(text.encode()) & 0xFFFFFFFF


def _oriented_coords(seg: RoadSegment, reverse: bool):
    coords = list(seg.geom.coords)
    return coords[::-1] if reverse else coords


def _footpath_for(seg: RoadSegment, reverse: bool) -> dict:
    links = {link.side: link for link in seg.footpaths.all()}
    if not links:
        return {"present": False, "side": "left", "width_class": "normal", "confidence": 0.6}
    # Prefer the better-known side; side labels are relative to the segment's
    # stored direction, so flip when we traverse it backwards.
    link = max(links.values(), key=lambda fl: fl.confidence)
    side = link.side
    if reverse:
        side = "left" if side == "right" else "right"
    if link.width_m is not None:
        width_class = "narrow" if link.width_m < 1.5 else "normal" if link.width_m < 2.5 else "wide"
    else:
        width_class = "narrow" if seg.highway_class in ("residential", "living_street") else "normal"
    return {
        "present": True,
        "side": side,
        "width_class": width_class,
        "confidence": link.confidence,
    }


# Approved report categories -> in-game hazards (type, default span, props).
CATEGORY_HAZARD = {
    "blocked_hawker": ("hawker_stall", 10.0, {"passable_gap_m": 0.7}),
    "encroachment": ("hawker_stall", 12.0, {"passable_gap_m": 0.4}),
    "blocked_parked_vehicle": ("parked_scooter", 8.0, {"passable_gap_m": 0.7}),
    "narrow": ("parked_scooter", 6.0, {"passable_gap_m": 0.4}),
    "broken_surface": ("broken_slab", 2.0, {}),
    "open_drain": ("open_drain", 2.0, {"fall_damage": True}),
    "dead_end": ("dead_end", 16.0, {"forced_exit": "road"}),
    "construction": ("construction", 12.0, {}),
    "obstacle_pole": ("pole", 2.0, {}),
    # no_kerb_ramp: persona-only (wheelchair/pram); no walker hazard yet.
    # waterlogging: handled through the monsoon block instead.
}


def _reported_hazards(
    condition: SegmentCondition | None, seg: RoadSegment, reverse: bool
) -> tuple[list[dict], list[dict]]:
    """Guaranteed hazards (and waterlogging points) from approved reports."""
    if condition is None:
        return [], []
    hazards = []
    waterlogging = []
    for point in condition.hazard_points:
        fraction = 1.0 - point["fraction"] if reverse else point["fraction"]
        at_m = round(fraction * seg.length_m, 1)
        if point["category"] == "waterlogging":
            waterlogging.append({"at_m": at_m, "severity": point["severity"]})
            continue
        mapped = CATEGORY_HAZARD.get(point["category"])
        if not mapped:
            continue
        hazard_type, span, props = mapped
        hazards.append(
            {
                "type": hazard_type,
                "lane": "footpath",
                "at_m": at_m,
                "span_m": span,
                "props": {**props, "reported": True},
            }
        )
    return hazards, waterlogging


def _hazards_for(
    seg: RoadSegment, footpath: dict, rng: random.Random, stall_damp: float = 1.0
) -> list[dict]:
    if not footpath["present"]:
        return []
    hazards: list[dict] = []
    length = seg.length_m
    stall_p = STALL_CHANCE.get(seg.highway_class, 0.3) * stall_damp
    bad_surface = seg.surface in BAD_SURFACES or seg.tags.get("smoothness") in (
        "bad",
        "very_bad",
        "horrible",
    )

    pos = rng.uniform(6, 14)
    while pos < length - 6:
        roll = rng.random()
        if roll < stall_p:
            span = rng.uniform(6, 14)
            hazards.append(
                {
                    "type": "hawker_stall",
                    "lane": "footpath",
                    "at_m": round(pos, 1),
                    "span_m": round(span, 1),
                    "props": {"passable_gap_m": 0.4 if rng.random() < 0.2 else 0.7},
                }
            )
            pos += span
        elif roll < stall_p + 0.18:
            span = rng.uniform(4, 8)
            hazards.append(
                {
                    "type": "parked_scooter",
                    "lane": "footpath",
                    "at_m": round(pos, 1),
                    "span_m": round(span, 1),
                    "props": {"passable_gap_m": 0.4 if rng.random() < 0.15 else 0.7},
                }
            )
            pos += span
        elif roll < stall_p + 0.18 + (0.22 if bad_surface else 0.1):
            hazards.append(
                {"type": "broken_slab", "lane": "footpath", "at_m": round(pos, 1), "props": {}}
            )
        elif roll < stall_p + 0.18 + (0.22 if bad_surface else 0.1) + 0.07:
            hazards.append(
                {
                    "type": "open_drain",
                    "lane": "footpath",
                    "at_m": round(pos, 1),
                    "span_m": 2,
                    "props": {"fall_damage": True},
                }
            )
        elif roll < stall_p + 0.18 + (0.22 if bad_surface else 0.1) + 0.07 + 0.08:
            hazards.append({"type": "pole", "lane": "footpath", "at_m": round(pos, 1), "props": {}})
        elif roll < stall_p + 0.18 + (0.22 if bad_surface else 0.1) + 0.07 + 0.08 + 0.05:
            span = rng.uniform(8, 14)
            hazards.append(
                {
                    "type": "construction",
                    "lane": "footpath",
                    "at_m": round(pos, 1),
                    "span_m": round(span, 1),
                    "props": {},
                }
            )
            pos += span
        pos += rng.uniform(14, 34)

    # The signature trap: low-confidence footpaths sometimes just... end.
    if footpath["confidence"] < 0.5 and length > 60 and rng.random() < 0.2:
        hazards.append(
            {
                "type": "dead_end",
                "lane": "footpath",
                "at_m": round(length * rng.uniform(0.4, 0.75), 1),
                "span_m": round(rng.uniform(12, 20), 1),
                "props": {"forced_exit": "road"},
            }
        )
    return hazards


def _monsoon_for(seg: RoadSegment, rng: random.Random) -> dict:
    puddles = []
    pos = rng.uniform(10, 30)
    while pos < seg.length_m - 8:
        if rng.random() < 0.4:
            lane = rng.choices(["road_1", "road_2", "road_3"], weights=[0.6, 0.3, 0.1])[0]
            puddles.append(
                {
                    "lane": lane,
                    "at_m": round(pos, 1),
                    "span_m": round(rng.uniform(6, 14), 1),
                    "splash": rng.random() < 0.85,
                }
            )
        pos += rng.uniform(25, 45)
    waterlogged = seg.highway_class in ("residential", "unclassified") and rng.random() < 0.07
    return {"puddles": puddles, "waterlogged": waterlogged}


def _pois_for(seg: RoadSegment, reverse: bool) -> list[dict]:
    """Named places within ~30 m of the segment, positioned along it."""
    pois = []
    for poi in Poi.objects.filter(point__dwithin=(seg.geom, POI_MATCH_DIST_DEG)):
        frac = seg.geom.project_normalized(poi.point)
        p0 = seg.geom.interpolate_normalized(max(0.0, frac - 0.02))
        p1 = seg.geom.interpolate_normalized(min(1.0, frac + 0.02))
        side = side_of_line((p0.x, p0.y), (p1.x, p1.y), (poi.point.x, poi.point.y))
        at_m = frac * seg.length_m
        if reverse:
            at_m = seg.length_m - at_m
            side = "left" if side == "right" else "right"
        pois.append(
            {
                "name": poi.name,
                "category": poi.category,
                "at_m": round(at_m, 1),
                "side": side,
            }
        )
    pois.sort(key=lambda p: p["at_m"])
    return pois[:MAX_POIS_PER_SEGMENT]


def _endpoint_name(seg: RoadSegment, coord, street_name: str, fallback: str) -> str:
    """A recognisable endpoint label: real street name, else the nearest POI."""
    if seg.name:
        return seg.name
    from django.contrib.gis.geos import Point

    poi = (
        Poi.objects.filter(point__dwithin=(Point(*coord, srid=4326), 0.001))
        .exclude(category="atm")
        .first()
    )
    if poi:
        return f"Near {poi.name}"
    return street_name or fallback


def _bend_deg(prev_coords, next_coords) -> float:
    out_bearing = bearing_deg(prev_coords[-2], prev_coords[-1])
    in_bearing = bearing_deg(next_coords[0], next_coords[1])
    diff = (in_bearing - out_bearing + 540) % 360 - 180
    return diff


MAJOR_ROADS = {"primary", "secondary", "tertiary"}


def _crossing_after(seg: RoadSegment, next_seg: RoadSegment, reverse: bool) -> dict | None:
    junction_id = seg.from_junction_id if reverse else seg.to_junction_id
    crossing = CrossingNode.objects.filter(junction_id=junction_id).first()
    if crossing:
        return {
            "type": crossing.crossing_type or "unmarked",
            "kerb": crossing.kerb or None,
            "signal": crossing.crossing_type == "signals",
        }
    # Mapped crossings are rare in Bandra; infer one when the route steps
    # between road classes and a major road is involved — you're crossing it.
    if seg.highway_class != next_seg.highway_class and (
        seg.highway_class in MAJOR_ROADS or next_seg.highway_class in MAJOR_ROADS
    ):
        return {"type": "unmarked", "kerb": None, "signal": False}
    return None


def generate_spec(route: list[tuple[RoadSegment, bool]], mode: str) -> tuple[dict, list[dict]]:
    """Build the LevelSpec plus segment offsets for report mapping."""
    total = sum(seg.length_m for seg, _ in route)
    if total < MIN_ROUTE_M:
        raise GenerationError(f"Route is only {total:.0f} m — pick points further apart.")
    if total > MAX_ROUTE_M:
        raise GenerationError(f"Route is {total:.0f} m — keep it under {MAX_ROUTE_M} m for now.")

    keys = [seg.stable_key for seg, _ in route]
    conditions = {
        (c.road_segment_id, c.side): c
        for c in SegmentCondition.objects.filter(
            road_segment_id__in=[seg.id for seg, _ in route]
        )
    }
    # Condition versions are part of the seed: a street's levels change the
    # moment an approved report changes its real-world condition.
    version_str = "|".join(
        ",".join(
            str(conditions[(seg.id, side)].version) if (seg.id, side) in conditions else "0"
            for side in ("left", "right", "road")
        )
        for seg, _ in route
    )
    seed = _crc("|".join(keys) + f"|{mode}|{version_str}")

    segments = []
    offsets = []
    polyline: list[list[float]] = []
    cursor = 0.0
    seen_poi_names: set[str] = set()
    oriented = [(seg, rev, _oriented_coords(seg, rev)) for seg, rev in route]

    for i, (seg, rev, coords) in enumerate(oriented):
        rng = random.Random(seed ^ _crc(seg.stable_key))
        footpath = _footpath_for(seg, rev)
        # A POI near a junction matches several segments — keep its first spot.
        pois = [p for p in _pois_for(seg, rev) if p["name"] not in seen_poi_names]
        seen_poi_names.update(p["name"] for p in pois)

        # Approved reports apply to the segment-relative side we walk on.
        segment_side = footpath["side"]
        if rev:
            segment_side = "left" if segment_side == "right" else "right"
        condition = conditions.get((seg.id, segment_side))
        reported, waterlogging_points = _reported_hazards(condition, seg, rev)
        good_weight = condition.scores.get("good", 0.0) if condition else 0.0
        stall_damp = max(0.4, 1.0 - 0.15 * good_weight)
        entry = {
            "key": seg.stable_key,
            "name": seg.name or seg.highway_class.replace("_", " ").title(),
            "length_m": round(seg.length_m, 1),
            "road_class": seg.highway_class,
            "traffic_density": TRAFFIC_DENSITY.get(seg.highway_class, 0.4),
            "vehicle_mix": VEHICLE_MIX.get(seg.highway_class, DEFAULT_MIX),
            "footpath": footpath,
            "hazards": reported + _hazards_for(seg, footpath, rng, stall_damp),
            "monsoon": _monsoon_for(seg, rng),
            "pois": pois,
        }
        for wl in waterlogging_points:
            if wl["severity"] >= 3:
                entry["monsoon"]["waterlogged"] = True
            else:
                entry["monsoon"]["puddles"].append(
                    {"lane": "road_1", "at_m": wl["at_m"], "span_m": 10.0, "splash": True}
                )
        if i + 1 < len(oriented):
            bend = _bend_deg(coords, oriented[i + 1][2])
            if abs(bend) > 20:
                entry["bend_after_deg"] = round(bend, 1)
            crossing = _crossing_after(seg, oriented[i + 1][0], rev)
            if crossing:
                entry["crossing_after"] = crossing
        segments.append(entry)
        offsets.append(
            {
                "key": seg.stable_key,
                "start_m": round(cursor, 1),
                "end_m": round(cursor + seg.length_m, 1),
                "reversed": rev,
            }
        )
        cursor += seg.length_m
        for c in coords if not polyline else coords[1:]:
            polyline.append([round(c[0], 6), round(c[1], 6)])

    first_named = _endpoint_name(route[0][0], oriented[0][2][0], segments[0]["name"], "Start")
    last_named = _endpoint_name(
        route[-1][0], oriented[-1][2][-1], segments[-1]["name"], "Destination"
    )

    spec = {
        "seed": seed,
        "mode": mode,
        "total_length_m": round(total, 1),
        "minimap": {
            "polyline": polyline,
            "origin_name": first_named,
            "dest_name": last_named,
        },
        "segments": segments,
    }
    return spec, offsets
