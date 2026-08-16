"""Ingest an OSM extract into the street-network tables.

Usage: python manage.py ingest_osm data/bandra-west.osm [--replace]

Pipeline: pyosmium parse -> split ways at shared nodes into Junction +
RoadSegment -> FootpathLink from sidewalk tags / nearby footway=sidewalk
geometries / class heuristics -> CrossingNode for crossings at junctions.
"""

from collections import Counter

import osmium
from django.contrib.gis.geos import LineString, Point
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.geodata.geoutil import (
    angle_diff_deg,
    bearing_deg,
    line_length_m,
    parse_float,
    parse_int,
    side_of_line,
)
from apps.geodata.models import CrossingNode, FootpathLink, Junction, RoadSegment

ROAD_CLASS_MAP = {
    "trunk": "primary",
    "trunk_link": "primary",
    "primary": "primary",
    "primary_link": "primary",
    "secondary": "secondary",
    "secondary_link": "secondary",
    "tertiary": "tertiary",
    "tertiary_link": "tertiary",
    "residential": "residential",
    "unclassified": "unclassified",
    "living_street": "living_street",
    "service": "service",
}

FOOT_HIGHWAYS = {"footway", "path", "pedestrian", "steps"}

# Road classes assumed to have some footpath even when OSM says nothing.
ASSUME_FOOTPATH_CLASSES = {
    "primary",
    "secondary",
    "tertiary",
    "residential",
    "unclassified",
    "living_street",
}

SIDEWALK_MATCH_DIST_DEG = 0.00022  # ~24 m at Mumbai's latitude
SIDEWALK_MAX_ANGLE_DEG = 35.0


class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.roads = []  # {id, tags, refs, coords}
        self.footways = []  # {id, tags, coords}
        self.crossing_nodes = {}  # osm node id -> tags

    def node(self, n):
        if n.tags.get("highway") == "crossing":
            self.crossing_nodes[n.id] = dict(n.tags)

    def way(self, w):
        highway = w.tags.get("highway")
        if not highway:
            return
        refs, coords = [], []
        for nd in w.nodes:
            if nd.location.valid():
                refs.append(nd.ref)
                coords.append((nd.location.lon, nd.location.lat))
        if len(coords) < 2:
            return
        tags = dict(w.tags)
        if highway in ROAD_CLASS_MAP:
            self.roads.append({"id": w.id, "tags": tags, "refs": refs, "coords": coords})
        elif highway in FOOT_HIGHWAYS:
            self.footways.append({"id": w.id, "tags": tags, "coords": coords})


class Command(BaseCommand):
    help = "Ingest an OSM extract (.osm/.osm.gz/.pbf) into the street network tables"

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--replace", action="store_true", help="Truncate tables first")

    @transaction.atomic
    def handle(self, path, replace, **options):
        collector = Collector()
        try:
            collector.apply_file(path, locations=True)
        except (OSError, RuntimeError) as exc:
            raise CommandError(f"Could not read {path}: {exc}") from exc

        if replace:
            CrossingNode.objects.all().delete()
            FootpathLink.objects.all().delete()
            RoadSegment.objects.all().delete()
            Junction.objects.all().delete()
        elif RoadSegment.objects.exists():
            raise CommandError("Tables are not empty; pass --replace to re-ingest.")

        segments = self._build_topology(collector.roads)
        junctions = self._create_junctions(segments, collector.roads)
        seg_rows = self._create_segments(segments, junctions)
        tagged, assumed = self._footpaths_from_tags(seg_rows)
        mapped = self._associate_sidewalks(collector.footways)
        crossings = self._create_crossings(collector.crossing_nodes, junctions)

        from apps.levels.graph import GraphService

        GraphService.reset()
        self.stdout.write(
            self.style.SUCCESS(
                f"Ingested {len(seg_rows)} segments, {len(junctions)} junctions, "
                f"{tagged} tagged + {assumed} assumed + {mapped} mapped footpath links, "
                f"{crossings} crossings"
            )
        )

    def _build_topology(self, roads):
        """Split ways at nodes shared by more than one road way."""
        usage = Counter()
        for way in roads:
            for ref in way["refs"]:
                usage[ref] += 1
            # Endpoints always split, even on dead ends.
            usage[way["refs"][0]] += 1
            usage[way["refs"][-1]] += 1

        segments = []
        for way in roads:
            start = 0
            split_index = 0
            for i in range(1, len(way["refs"])):
                if usage[way["refs"][i]] > 1 or i == len(way["refs"]) - 1:
                    coords = way["coords"][start : i + 1]
                    if len(coords) >= 2 and line_length_m(coords) > 1.0:
                        segments.append(
                            {
                                "key": f"{way['id']}:{split_index}",
                                "way": way,
                                "from_ref": way["refs"][start],
                                "to_ref": way["refs"][i],
                                "coords": coords,
                            }
                        )
                        split_index += 1
                    start = i
        return segments

    def _create_junctions(self, segments, roads):
        coord_by_ref = {}
        for way in roads:
            for ref, coord in zip(way["refs"], way["coords"]):
                coord_by_ref[ref] = coord
        needed = {s["from_ref"] for s in segments} | {s["to_ref"] for s in segments}
        Junction.objects.bulk_create(
            Junction(osm_node_id=ref, point=Point(*coord_by_ref[ref], srid=4326))
            for ref in needed
        )
        return {j.osm_node_id: j for j in Junction.objects.all()}

    def _create_segments(self, segments, junctions):
        rows = []
        for seg in segments:
            tags = seg["way"]["tags"]
            rows.append(
                RoadSegment(
                    stable_key=seg["key"],
                    from_junction=junctions[seg["from_ref"]],
                    to_junction=junctions[seg["to_ref"]],
                    geom=LineString(seg["coords"], srid=4326),
                    length_m=line_length_m(seg["coords"]),
                    highway_class=ROAD_CLASS_MAP[tags["highway"]],
                    name=tags.get("name", "")[:200],
                    oneway=tags.get("oneway") in ("yes", "1", "-1"),
                    lanes=parse_int(tags.get("lanes")),
                    surface=tags.get("surface", "")[:40],
                    tags=tags,
                )
            )
        RoadSegment.objects.bulk_create(rows, batch_size=500)
        return list(RoadSegment.objects.all())

    def _footpaths_from_tags(self, seg_rows):
        tagged = assumed = 0
        links = []
        for seg in seg_rows:
            tags = seg.tags
            sides = set()
            sidewalk = tags.get("sidewalk", "")
            if sidewalk in ("both", "left", "right"):
                sides = {"left", "right"} if sidewalk == "both" else {sidewalk}
            for side in ("left", "right"):
                if tags.get(f"sidewalk:{side}") in ("yes", "separate"):
                    sides.add(side)
            if sides:
                for side in sides:
                    links.append(
                        FootpathLink(
                            road_segment=seg, side=side, source="tagged", confidence=0.8
                        )
                    )
                    tagged += 1
            elif sidewalk in ("no", "none"):
                continue
            elif seg.highway_class in ASSUME_FOOTPATH_CLASSES:
                for side in ("left", "right"):
                    links.append(
                        FootpathLink(
                            road_segment=seg, side=side, source="assumed", confidence=0.3
                        )
                    )
                    assumed += 1
        FootpathLink.objects.bulk_create(links, batch_size=500)
        return tagged, assumed

    def _associate_sidewalks(self, footways):
        """Attach separate footway=sidewalk geometries to a road side."""
        mapped = 0
        for fw in footways:
            if fw["tags"].get("footway") != "sidewalk":
                continue
            coords = fw["coords"]
            mid_i = len(coords) // 2
            mid = coords[mid_i]
            fw_bearing = bearing_deg(coords[max(0, mid_i - 1)], coords[min(len(coords) - 1, mid_i + 1)])
            pt = Point(*mid, srid=4326)

            candidates = RoadSegment.objects.filter(
                geom__dwithin=(pt, SIDEWALK_MATCH_DIST_DEG)
            ).exclude(highway_class="service")
            best = None
            best_dist = 1e9
            for seg in candidates:
                dist = seg.geom.distance(pt)
                # Local direction of the road at the closest point.
                frac = seg.geom.project_normalized(pt)
                p0 = seg.geom.interpolate_normalized(max(0.0, frac - 0.02))
                p1 = seg.geom.interpolate_normalized(min(1.0, frac + 0.02))
                road_bearing = bearing_deg((p0.x, p0.y), (p1.x, p1.y))
                diff = angle_diff_deg(fw_bearing, road_bearing)
                if min(diff, 180 - diff) > SIDEWALK_MAX_ANGLE_DEG:
                    continue
                if dist < best_dist:
                    best, best_dist, best_p0, best_p1 = seg, dist, p0, p1
            if not best:
                continue
            side = side_of_line((best_p0.x, best_p0.y), (best_p1.x, best_p1.y), mid)
            FootpathLink.objects.update_or_create(
                road_segment=best,
                side=side,
                defaults={
                    "source": "mapped",
                    "confidence": 0.95,
                    "width_m": parse_float(
                        fw["tags"].get("width") or fw["tags"].get("est_width")
                    ),
                    "surface": fw["tags"].get("surface", "")[:40],
                    "wheelchair": fw["tags"].get("wheelchair", "")[:20],
                    "kerb": fw["tags"].get("kerb", "")[:20],
                },
            )
            mapped += 1
        return mapped

    def _create_crossings(self, crossing_nodes, junctions):
        rows = []
        for node_id, tags in crossing_nodes.items():
            junction = junctions.get(node_id)
            if not junction:
                continue
            crossing = tags.get("crossing", "")
            if crossing in ("traffic_signals",) or tags.get("crossing:signals") == "yes":
                ctype = "signals"
            elif crossing in ("zebra", "marked"):
                ctype = "zebra"
            else:
                ctype = "unmarked"
            rows.append(
                CrossingNode(junction=junction, crossing_type=ctype, kerb=tags.get("kerb", "")[:20])
            )
        CrossingNode.objects.bulk_create(rows)
        return len(rows)
