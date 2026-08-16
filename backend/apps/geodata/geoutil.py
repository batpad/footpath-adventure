"""Small geographic helpers shared by ingest, level generation, and reports."""

import math

Coord = tuple[float, float]  # (lng, lat)


def haversine_m(a: Coord, b: Coord) -> float:
    r = 6_371_000.0
    lng1, lat1 = math.radians(a[0]), math.radians(a[1])
    lng2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def line_length_m(coords: list[Coord]) -> float:
    return sum(haversine_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def bearing_deg(a: Coord, b: Coord) -> float:
    """Forward azimuth from a to b, degrees clockwise from north."""
    lat1 = math.radians(a[1])
    lat2 = math.radians(b[1])
    dlng = math.radians(b[0] - a[0])
    x = math.sin(dlng) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlng)
    return math.degrees(math.atan2(x, y)) % 360


def angle_diff_deg(a: float, b: float) -> float:
    """Smallest absolute difference between two bearings, 0..180."""
    d = abs(a - b) % 360
    return min(d, 360 - d)


def side_of_line(seg_a: Coord, seg_b: Coord, pt: Coord) -> str:
    """Which side of directed segment a->b the point lies on.

    Uses the raw lng/lat cross product — uniform axis scaling preserves the
    sign, so no projection is needed for a side test.
    """
    dx = seg_b[0] - seg_a[0]
    dy = seg_b[1] - seg_a[1]
    ox = pt[0] - seg_a[0]
    oy = pt[1] - seg_a[1]
    return "left" if (dx * oy - dy * ox) > 0 else "right"


def parse_float(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value.split(";")[0].replace("m", "").strip())
    except ValueError:
        return None


def parse_int(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(value.split(";")[0])
    except ValueError:
        return None
