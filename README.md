# Footpath Adventure

A browser game about walking Mumbai's footpaths — and an accessibility-advocacy
platform in disguise.

You walk a **real route** (starting with Bandra West) as a top-down lane runner:
dodge hawker stalls, parked scooters, open drains, and footpaths that dead-end
without warning — or step onto the road and take your chances with the traffic.
The core skill is the same judgement every Mumbai pedestrian makes daily:
*footpath ya road?*

Crowdsourced photo/condition reports about real streets will change those
streets' in-game conditions: play → notice → report → the street changes for
everyone.

## Quick start

```sh
# one-time backend setup (needs Postgres w/ PostGIS, uv, brew gdal+geos)
createdb footpath_adventure
psql -c "CREATE EXTENSION IF NOT EXISTS postgis;" footpath_adventure
cd backend && uv sync && uv run python manage.py migrate && cd ..
make ingest        # loads data/bandra-west.osm into PostGIS (~3 s)

make dev           # Django :8000 + Vite :5173 → open http://localhost:5173
```

In the menu, **Pick a real route** opens a map of Bandra West — click origin
and destination, and the level is generated from those actual streets.

## Status

**Done (M1–M3):**

- Playable core loop: kerb railings crossable only at gaps, oncoming
  pedestrians/cows/dogs/footpath bikers, fast traffic with wrong-side drivers
  and honks, near-miss streak bonuses, dead-end backtracking, the advancing
  crowd, a commute deadline timer, bus stops, baraat processions, monsoon mode
  with puddles/splash/waterlogging, synthesized sound, and a walkability grade.
- Real data: Django + PostGIS ingests `data/bandra-west.osm` (2,613 street
  segments), routes A→B over the real network (networkx), and generates
  deterministic seeded levels from actual street tags — pick any route on the
  map and walk it.

- **The feedback loop (M4)**: report footpath conditions anonymously — in-game
  (press **R** or the 📸 button), from the results screen, or by dropping a pin
  on the map ("Report a spot" in the route picker). Photo optional (EXIF
  stripped), POI-anchored ("near Candies"). Moderate at
  http://127.0.0.1:8000/admin/ (dev login: `admin` / `footpath-dev` — change
  it). Approving a report bumps that street's condition version: the next level
  generated over it gets a guaranteed hazard at the reported spot, for
  everyone. "Actually good!" reports thin out the baseline hazards.
- **POI gameplay**: chai stops (☕ step in to sip: +10 HP, costs time), school
  zones with kid swarms, temple crowd bursts.
- **Crossing bands**: junctions with (mapped or inferred) crossings become
  cross-traffic bands — signal crossings cycle walk/traffic phases.

- **Condition heatmap**: the route-picker map colors streets people have
  reported on (red = problems, green = good) with hover details.

**Next:** personas (wheelchair/elderly/pram), sound/art polish.

## Deploy (Ubuntu, no Docker)

On a box with nginx, certbot, and PostgreSQL already running:

```sh
curl -fsSL https://raw.githubusercontent.com/batpad/footpath-adventure/main/deploy/setup-server.sh -o setup-server.sh
sudo bash setup-server.sh     # user `footpath`, /srv/footpath, gunicorn on 127.0.0.1:8043
sudo certbot --nginx -d footpaths.whydidweevendothis.com
```

The script is idempotent — re-run it after fixing any failure. Updates:
`sudo bash /srv/footpath/footpath-adventure/deploy/update.sh`.

## Run it

```sh
cd frontend
npm install
npm run dev     # http://localhost:5173
```

- **Desktop:** arrows / WASD to step (hold to keep walking). Enter/Space to start.
- **Mobile:** swipe to step; tap = step forward.
- Walking on a usable footpath scores 1.5×; cross the railing only at gaps.
- Beat the commute clock — and don't let the crowd catch you.

## Tests

```sh
cd frontend
npm test        # vitest: corridor compiler + seeded RNG
npm run build   # type-check + production build
```

## Repo layout

```
frontend/   Vite + TypeScript + Phaser 3 game
  src/level/     LevelSpec types, seeded RNG, corridor compiler (pure TS)
  src/input/     unified keyboard + swipe controls
  src/game/      Phaser scenes + traffic/pedestrian/bus/procession systems
  src/ui/        MapLibre route picker (DOM overlay)
backend/    Django 5 + PostGIS (uv-managed, Python 3.12)
  apps/geodata/  Junction/RoadSegment/FootpathLink models, ingest_osm command
  apps/levels/   networkx routing graph, seeded level generator, DRF API
data/       pinned Bandra West OSM extract (from Overpass, ODbL)
```

Note: the Vite proxy targets `127.0.0.1:8000`, not `localhost:8000` — on some
machines another service listens on the IPv6 loopback at that port.
