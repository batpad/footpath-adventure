/**
 * Turns the real POIs in a level spec into gameplay zones:
 *   chai stops (cafes/restaurants) — step in to sip and heal
 *   school zones — kid swarms on the footpath around schools
 *   temples — periodic crowd bursts when the aarti lets out
 */
import type { LevelSpec } from '../level/types';
import {
  columnLayout,
  METRES_PER_ROW,
  type CompiledLevel,
} from '../level/corridor';

export interface ChaiStop {
  row: number;
  col: number;
  name: string;
  used: boolean;
}

export interface SchoolZone {
  startRow: number;
  endRow: number;
  name: string;
}

export interface TempleZone {
  row: number;
  name: string;
  lastBurstMs: number;
}

export interface PoiZones {
  chaiStops: ChaiStop[];
  schoolZones: SchoolZone[];
  temples: TempleZone[];
}

const CHAI_CATEGORIES = new Set(['cafe', 'restaurant', 'fast_food']);
const SCHOOL_CATEGORIES = new Set(['school', 'college', 'university']);
const SCHOOL_RADIUS_ROWS = 8;
const CHAI_MIN_SPACING_ROWS = 8;

export function buildPoiZones(spec: LevelSpec, level: CompiledLevel): PoiZones {
  const chaiStops: ChaiStop[] = [];
  const schoolZones: SchoolZone[] = [];
  const temples: TempleZone[] = [];

  spec.segments.forEach((seg, si) => {
    const startRow = level.segmentStartRows[si];
    const segRows = Math.max(1, Math.round(seg.length_m / METRES_PER_ROW));
    const layout = columnLayout(seg.footpath.side);
    // Outer footpath column — the shopfront side, away from the kerb.
    const outerCol = seg.footpath.side === 'left' ? layout.footpathCols[0] : layout.footpathCols[1];

    for (const poi of seg.pois ?? []) {
      const row = startRow + Math.min(segRows - 1, Math.floor(poi.at_m / METRES_PER_ROW));

      if (CHAI_CATEGORIES.has(poi.category)) {
        // Chai is served from the shopfront: only where the footpath actually
        // runs past the place, on a walkable cell.
        if (poi.side !== seg.footpath.side || !seg.footpath.present) continue;
        const last = chaiStops[chaiStops.length - 1];
        if (last && Math.abs(row - last.row) < CHAI_MIN_SPACING_ROWS) continue;
        for (const delta of [0, 1, -1]) {
          const cell = level.rows[row + delta]?.cells[outerCol];
          if (cell?.kind === 'footpath' && cell.passable) {
            chaiStops.push({ row: row + delta, col: outerCol, name: poi.name, used: false });
            break;
          }
        }
      } else if (SCHOOL_CATEGORIES.has(poi.category)) {
        schoolZones.push({
          startRow: Math.max(0, row - SCHOOL_RADIUS_ROWS),
          endRow: Math.min(level.totalRows - 1, row + SCHOOL_RADIUS_ROWS),
          name: poi.name,
        });
      } else if (poi.category === 'place_of_worship') {
        temples.push({ row, name: poi.name, lastBurstMs: -Infinity });
      }
    }
  });

  return { chaiStops, schoolZones, temples };
}

export function inSchoolZone(zones: SchoolZone[], row: number): boolean {
  return zones.some((z) => row >= z.startRow && row <= z.endRow);
}
