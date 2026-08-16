import pytest
from django.contrib.gis.geos import LineString, Point

from apps.geodata.models import FootpathLink, Junction, RoadSegment
from apps.levels.generator import generate_spec
from apps.levels.models import GeneratedLevel
from apps.reports.models import ConditionReport
from apps.reports.services import (
    SnapError,
    locate_in_level,
    recompute_condition,
    snap_point,
)


@pytest.fixture
def street(db):
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


def make_level(route, mode="dry"):
    spec, offsets = generate_spec(route, mode)
    level = GeneratedLevel.objects.create(spec=spec, segment_offsets=offsets)
    spec["level_token"] = level.token
    level.spec = spec
    level.save(update_fields=["spec"])
    return level


def test_snap_point_fraction_and_side(street):
    # East of a northbound street = the walker's right-hand side.
    result = snap_point(Point(72.8302, 19.05075, srid=4326))
    assert result["segment"].stable_key == "100:0"
    assert result["side"] == "right"
    assert 0.4 < result["fraction"] < 0.6


def test_snap_point_on_road(street):
    result = snap_point(Point(72.830001, 19.0508, srid=4326))
    assert result["side"] == "road"


def test_snap_too_far(street):
    with pytest.raises(SnapError):
        snap_point(Point(72.85, 19.06, srid=4326))


def test_locate_in_level_maps_distance(street):
    level = make_level(street)
    located = locate_in_level(level, 50.0, "footpath")
    assert located["segment"].stable_key == "100:0"
    assert located["fraction"] == pytest.approx(50 / 166, abs=0.01)
    assert located["side"] == "left"  # not reversed, footpath side left
    located2 = locate_in_level(level, 200.0, "road_1")
    assert located2["segment"].stable_key == "100:1"
    assert located2["side"] == "road"


def test_full_feedback_loop(street):
    """Report → approve → the street changes for the next player."""
    level = make_level(street)
    original_seed = level.spec["seed"]

    located = locate_in_level(level, 60.0, "footpath")
    report = ConditionReport.objects.create(
        category="open_drain",
        severity=3,
        point=located["point"],
        road_segment=located["segment"],
        stable_key=located["segment"].stable_key,
        side=located["side"],
        position_fraction=located["fraction"],
        status="approved",
    )
    condition = recompute_condition(report.road_segment, report.side)
    assert condition.version == 1
    assert condition.hazard_points[0]["category"] == "open_drain"

    spec2, _ = generate_spec(street, "dry")
    assert spec2["seed"] != original_seed
    seg1 = spec2["segments"][0]
    reported = [h for h in seg1["hazards"] if h["props"].get("reported")]
    assert len(reported) == 1
    assert reported[0]["type"] == "open_drain"
    assert reported[0]["at_m"] == pytest.approx(60.0, abs=2.0)


def test_good_reports_reduce_version_bump_only_on_change(street):
    seg = street[0][0]
    ConditionReport.objects.create(
        category="good",
        severity=2,
        point=Point(72.83, 19.0507, srid=4326),
        road_segment=seg,
        stable_key=seg.stable_key,
        side="left",
        position_fraction=0.5,
        status="approved",
    )
    condition = recompute_condition(seg, "left")
    assert condition.version == 1
    assert condition.scores["good"] > 0
    assert condition.hazard_points == []  # good reports never spawn hazards
    # Recomputing with no changes must not bump the version.
    condition = recompute_condition(seg, "left")
    assert condition.version == 1


def test_report_api_with_pin(street, client):
    response = client.post(
        "/api/reports/",
        {
            "category": "blocked_hawker",
            "severity": "2",
            "lng": "72.8302",
            "lat": "19.0507",
            "note": "Full of stalls in the evening",
            "submitter_id": "test-client",
        },
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["status"] == "pending"
    report = ConditionReport.objects.get(id=body["id"])
    assert report.stable_key == "100:0"
    assert report.side == "right"
    assert report.submitter_hash