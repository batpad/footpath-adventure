from django.contrib.gis.db import models


class Junction(models.Model):
    """A topological node: intersection or dead end of the street network."""

    osm_node_id = models.BigIntegerField(unique=True)
    point = models.PointField(srid=4326)

    def __str__(self) -> str:
        return f"junction {self.osm_node_id}"


class RoadSegment(models.Model):
    """One edge of the street network, split at junctions.

    ``stable_key`` (``{osm_way_id}:{split_index}``) survives re-ingest so
    condition reports can reference segments across data refreshes.
    """

    HIGHWAY_CLASSES = [
        "primary",
        "secondary",
        "tertiary",
        "residential",
        "unclassified",
        "living_street",
        "service",
    ]

    stable_key = models.CharField(max_length=32, unique=True)
    from_junction = models.ForeignKey(Junction, on_delete=models.CASCADE, related_name="+")
    to_junction = models.ForeignKey(Junction, on_delete=models.CASCADE, related_name="+")
    geom = models.LineStringField(srid=4326)
    length_m = models.FloatField()
    highway_class = models.CharField(max_length=24)
    name = models.CharField(max_length=200, blank=True)
    oneway = models.BooleanField(default=False)
    lanes = models.PositiveSmallIntegerField(null=True, blank=True)
    surface = models.CharField(max_length=40, blank=True)
    tags = models.JSONField(default=dict, blank=True)

    def __str__(self) -> str:
        return f"{self.stable_key} {self.name or self.highway_class}"


class FootpathLink(models.Model):
    """Footpath presence and properties on one side of a road segment."""

    SIDE_CHOICES = [("left", "left"), ("right", "right")]
    SOURCE_CHOICES = [
        ("mapped", "mapped"),  # a separate footway=sidewalk geometry nearby
        ("tagged", "tagged"),  # sidewalk=* tag on the road itself
        ("assumed", "assumed"),  # class-based heuristic, low confidence
    ]

    road_segment = models.ForeignKey(
        RoadSegment, on_delete=models.CASCADE, related_name="footpaths"
    )
    side = models.CharField(max_length=5, choices=SIDE_CHOICES)
    source = models.CharField(max_length=8, choices=SOURCE_CHOICES)
    width_m = models.FloatField(null=True, blank=True)
    surface = models.CharField(max_length=40, blank=True)
    wheelchair = models.CharField(max_length=20, blank=True)
    kerb = models.CharField(max_length=20, blank=True)
    confidence = models.FloatField(default=0.5)

    class Meta:
        unique_together = ("road_segment", "side")

    def __str__(self) -> str:
        return f"{self.road_segment.stable_key} {self.side} ({self.source})"


class Poi(models.Model):
    """A named place — restaurant, shop, landmark — for route flavour."""

    osm_id = models.BigIntegerField()
    osm_type = models.CharField(max_length=8)  # node/way
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=48)  # e.g. restaurant, shop:clothes
    point = models.PointField(srid=4326)
    tags = models.JSONField(default=dict, blank=True)

    class Meta:
        unique_together = ("osm_type", "osm_id")

    def __str__(self) -> str:
        return f"{self.name} ({self.category})"


class CrossingNode(models.Model):
    """A mapped pedestrian crossing at a junction."""

    junction = models.OneToOneField(Junction, on_delete=models.CASCADE)
    crossing_type = models.CharField(max_length=24, blank=True)  # signals/zebra/unmarked
    kerb = models.CharField(max_length=20, blank=True)

    def __str__(self) -> str:
        return f"crossing at {self.junction.osm_node_id} ({self.crossing_type})"
