"""In-process routing graph over the ingested street network.

Bandra West is a few thousand nodes — networkx in memory beats running a
routing extension at this scale. Rebuilt lazily after each ingest (server
restart) via ``GraphService.reset()``.
"""

import threading

import networkx as nx
from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point

from apps.geodata.models import Junction, RoadSegment

SNAP_MAX_DEG = 0.005  # ~550 m


class RouteError(Exception):
    pass


class GraphService:
    _lock = threading.Lock()
    _instance: "GraphService | None" = None

    def __init__(self):
        self.graph = nx.Graph()
        # Walking is undirected; keep the shortest segment per junction pair.
        for seg in RoadSegment.objects.only(
            "stable_key", "from_junction_id", "to_junction_id", "length_m"
        ):
            u, v = seg.from_junction_id, seg.to_junction_id
            if u == v:
                continue
            existing = self.graph.get_edge_data(u, v)
            if existing and existing["length_m"] <= seg.length_m:
                continue
            self.graph.add_edge(u, v, stable_key=seg.stable_key, length_m=seg.length_m)

    @classmethod
    def get(cls) -> "GraphService":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @classmethod
    def reset(cls) -> None:
        with cls._lock:
            cls._instance = None

    def snap(self, lng: float, lat: float) -> int:
        """Nearest junction id, or RouteError when too far from the network."""
        pt = Point(lng, lat, srid=4326)
        junction = (
            Junction.objects.filter(point__dwithin=(pt, SNAP_MAX_DEG))
            .annotate(d=Distance("point", pt))
            .order_by("d")
            .first()
        )
        if junction is None:
            raise RouteError("That point is too far from the mapped area.")
        return junction.id

    def route(self, origin: tuple[float, float], destination: tuple[float, float]):
        """Ordered [(stable_key, reversed)] along the shortest walking path."""
        u = self.snap(*origin)
        v = self.snap(*destination)
        if u == v:
            raise RouteError("Origin and destination snap to the same junction.")
        try:
            path = nx.shortest_path(self.graph, u, v, weight="length_m")
        except (nx.NetworkXNoPath, nx.NodeNotFound) as exc:
            raise RouteError("No walkable route found between those points.") from exc

        keys = [self.graph.edges[a, b]["stable_key"] for a, b in zip(path, path[1:])]
        segments = RoadSegment.objects.filter(stable_key__in=keys).in_bulk(
            keys, field_name="stable_key"
        )
        ordered = []
        for (a, _b), key in zip(zip(path, path[1:]), keys):
            seg = segments[key]
            ordered.append((seg, seg.from_junction_id != a))
        return ordered
