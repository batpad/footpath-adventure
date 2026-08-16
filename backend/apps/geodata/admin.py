from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import CrossingNode, FootpathLink, Junction, Poi, RoadSegment


@admin.register(RoadSegment)
class RoadSegmentAdmin(GISModelAdmin):
    list_display = ("stable_key", "name", "highway_class", "length_m", "oneway", "surface")
    list_filter = ("highway_class", "oneway")
    search_fields = ("stable_key", "name")


@admin.register(FootpathLink)
class FootpathLinkAdmin(admin.ModelAdmin):
    list_display = ("road_segment", "side", "source", "width_m", "confidence")
    list_filter = ("source", "side")
    search_fields = ("road_segment__stable_key", "road_segment__name")


@admin.register(Junction)
class JunctionAdmin(GISModelAdmin):
    list_display = ("osm_node_id",)


@admin.register(CrossingNode)
class CrossingNodeAdmin(admin.ModelAdmin):
    list_display = ("junction", "crossing_type", "kerb")


@admin.register(Poi)
class PoiAdmin(GISModelAdmin):
    list_display = ("name", "category")
    list_filter = ("category",)
    search_fields = ("name",)
