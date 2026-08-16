import json

import pytest
from django.contrib.gis.geos import LineString, Point

from apps.geodata.models import FootpathLink, Junction, RoadSegment
from apps.levels.generator import GenerationError, generate_spec


@pytest.fixture
def street(db):
    """A ~330 m two-segment street heading north through Bandra-ish coords."""
    j1 = Junction.objects.create(osm_node_id=1, point=Point(72.83, 19.05, srid=4326))
    j2 = Junction.objects.create(osm_node_id=2, point=Point(72.83, 19.0515, srid=4326))
    j3 = Junction.objects.create(osm_node_id=3, point=Point(72.8305, 19.0530, srid=4326))
    s1 = RoadSegment.objects.create(
        stable_key="100:0",
        from_junction=j1,
        to_junction=j2,
        geom=LineString([(72.83, 19.05), (72.83, 19.0515)], srid=4326),
        length_m=166.0,
        highway_class="residential",
        name="Test Gully",
    )
    s2 = RoadSegment.objects.create(
        stable_key="100:1",
        from_junction=j2,
        to_junction=j3,
        geom=LineString([(72.83, 19.0515), (72.8305, 19.0530)], srid=4326),
        length_m=175.0,
        highway_class="residential",
        name="Test Gully",
    )
    FootpathLink.objects.create(road_segment=s1, side="left", source="tagged", confidence=0.8)
    FootpathLink.objects.create(road_segment=s2, side="left", source="assumed", confidence=0.3)
    return [(s1, False), (s2, False)]


def test_deterministic(street):
    a, _ = generate_spec(street, "dry")
    b, _ = generate_spec(street, "dry")
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_mode_changes_seed_and_spec(street):
    dry, _ = generate_spec(street, "dry")
    wet, _ = generate_spec(street, "monsoon")
    assert dry["seed"] != wet["seed"]
    assert wet["mode"] == "monsoon"


def test_segment_shape_matches_frontend_contract(street):
    spec, offsets = generate_spec(street, "dry")
    seg = spec["segments"][0]
    for field in ("key", "length_m", "road_class", "traffic_density", "vehicle_mix", "footpath", "hazards", "monsoon", "pois"):
        assert field in seg
    assert seg["footpath"]["side"] in ("left", "right")
    for h in seg["hazards"]:
        assert h["lane"] == "footpath"
        assert 0 <= h["at_m"] <= seg["length_m"]
    assert offsets[0]["start_m"] == 0
    assert offsets[-1]["end_m"] == spec["total_length_m"]


def test_reversed_traversal_flips_footpath_side(street):
    forward, _ = generate_spec(street, "dry")
    reversed_route = [(seg, not rev) for seg, rev in street]
    backward, _ = generate_spec(reversed_route, "dry")
    assert forward["segments"][0]["footpath"]["side"] == "left"
    assert backward["segments"][0]["footpath"]["side"] == "right"


def test_rejects_too_short_route(street):
    short_seg, _ = street[0]
    short_seg.length_m = 50
    with pytest.raises(GenerationError):
        generate_spec([(short_seg, False)], "dry")
