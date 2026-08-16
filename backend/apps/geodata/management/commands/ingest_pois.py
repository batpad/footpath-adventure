"""Ingest named POIs from an Overpass JSON export (``out center`` format).

Usage: python manage.py ingest_pois data/bandra-west-pois.json [--replace]
"""

import json

from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.geodata.models import Poi


def categorize(tags: dict) -> str | None:
    if "amenity" in tags:
        return tags["amenity"]
    if "shop" in tags:
        return f"shop:{tags['shop']}"
    if "tourism" in tags:
        return tags["tourism"]
    if "historic" in tags:
        return f"historic:{tags['historic']}"
    return None


class Command(BaseCommand):
    help = "Ingest named POIs from an Overpass JSON export"

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--replace", action="store_true")

    @transaction.atomic
    def handle(self, path, replace, **options):
        try:
            with open(path) as f:
                elements = json.load(f)["elements"]
        except (OSError, KeyError, json.JSONDecodeError) as exc:
            raise CommandError(f"Could not read {path}: {exc}") from exc

        if replace:
            Poi.objects.all().delete()
        elif Poi.objects.exists():
            raise CommandError("POIs already ingested; pass --replace to re-ingest.")

        rows = []
        for el in elements:
            tags = el.get("tags", {})
            name = tags.get("name")
            category = categorize(tags)
            if not name or not category:
                continue
            if el["type"] == "node":
                lng, lat = el["lon"], el["lat"]
            elif "center" in el:
                lng, lat = el["center"]["lon"], el["center"]["lat"]
            else:
                continue
            rows.append(
                Poi(
                    osm_id=el["id"],
                    osm_type=el["type"],
                    name=name[:200],
                    category=category[:48],
                    point=Point(lng, lat, srid=4326),
                    tags=tags,
                )
            )
        Poi.objects.bulk_create(rows, batch_size=500, ignore_conflicts=True)
        self.stdout.write(self.style.SUCCESS(f"Ingested {len(rows)} POIs"))
