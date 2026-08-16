/**
 * Compiles a LevelSpec into a straightened vertical corridor of tile rows.
 * Pure TypeScript — no Phaser — so it is unit-testable and the mapping from
 * real-world metres to game rows lives in exactly one place.
 *
 * Corridor is 6 columns wide. With the footpath on the left:
 *   col 0-1 footpath · col 2 kerb · col 3-5 road (road_1 nearest the kerb)
 * With the footpath on the right the layout mirrors.
 */
import type { Hazard, HazardType, LevelSegment, LevelSpec } from './types';
import { Rng, segmentSeed } from './rng';

export const COLS = 6;
/** Real-world metres represented by one tile row. */
export const METRES_PER_ROW = 2;

export type CellKind = 'footpath' | 'kerb' | 'road';

export interface Cell {
  kind: CellKind;
  hazard?: HazardType;
  /** Impassable cells block movement; passable hazards hurt instead. */
  passable: boolean;
  /** Impassable kerb railing between footpath and road (gaps are passable). */
  railing?: boolean;
  puddle?: { splash: boolean };
  flooded?: boolean;
  /** Part of a cross-street band at a junction. */
  crossing?: { type: 'signals' | 'zebra' | 'unmarked'; signal: boolean };
}

export interface CompiledRow {
  /** 0 = route start; the player walks toward higher indices. */
  index: number;
  segmentIndex: number;
  cells: Cell[];
  /** Set on the boundary row after a segment with a real-world bend. */
  transition?: { bendDeg: number; nextName?: string };
  finish?: boolean;
}

export interface ColumnLayout {
  footpathCols: [number, number];
  kerbCol: number;
  /** road_1 (kerbside) → road_3 (far lane). */
  roadCols: [number, number, number];
}

export function columnLayout(side: 'left' | 'right'): ColumnLayout {
  if (side === 'left') {
    return { footpathCols: [0, 1], kerbCol: 2, roadCols: [3, 4, 5] };
  }
  return { footpathCols: [4, 5], kerbCol: 3, roadCols: [2, 1, 0] };
}

/** Hazards the player cannot step onto. */
const IMPASSABLE: ReadonlySet<HazardType> = new Set([
  'hawker_stall',
  'parked_scooter',
  'barrier',
  'dead_end',
  'construction',
  'pole',
]);

/** Rows of blocked footpath a dead_end covers when the spec gives no span. */
const DEAD_END_DEFAULT_SPAN_M = 12;
/** Buffer rows of open corridor before the route starts. */
export const START_BUFFER_ROWS = 4;
/** Rows in a cross-street band at a junction with a crossing. */
export const CROSSING_BAND_ROWS = 3;

export interface CompiledLevel {
  rows: CompiledRow[];
  totalRows: number;
  segmentStartRows: number[];
  mode: LevelSpec['mode'];
}

function baseRow(index: number, segmentIndex: number, seg: LevelSegment): CompiledRow {
  const layout = columnLayout(seg.footpath.side);
  const cells: Cell[] = new Array(COLS);
  for (let c = 0; c < COLS; c++) {
    let kind: CellKind = 'road';
    if (c === layout.kerbCol) kind = 'kerb';
    else if (c === layout.footpathCols[0] || c === layout.footpathCols[1]) kind = 'footpath';
    // The kerb is a railing by default; carveKerbGaps opens crossings.
    cells[c] = kind === 'kerb' ? { kind, passable: false, railing: true } : { kind, passable: true };
  }
  // A segment with no footpath at all: the footpath strip is impassable
  // (compound walls, missing sidewalk) — the road is the only way through.
  if (!seg.footpath.present) {
    for (const c of layout.footpathCols) {
      cells[c] = { ...cells[c], passable: false, hazard: 'barrier' };
    }
  }
  return { index, segmentIndex, cells };
}

function rowsForLength(lengthM: number): number {
  return Math.max(1, Math.round(lengthM / METRES_PER_ROW));
}

function hazardRows(h: Hazard, segRows: number): [number, number] {
  const start = Math.min(segRows - 1, Math.floor(h.at_m / METRES_PER_ROW));
  const spanM = h.span_m ?? (h.type === 'dead_end' ? DEAD_END_DEFAULT_SPAN_M : METRES_PER_ROW);
  const end = Math.min(segRows - 1, start + Math.max(0, Math.ceil(spanM / METRES_PER_ROW) - 1));
  return [start, end];
}

function applyFootpathHazard(
  rows: CompiledRow[],
  seg: LevelSegment,
  h: Hazard,
  rng: Rng,
): void {
  const layout = columnLayout(seg.footpath.side);
  const [start, end] = hazardRows(h, rows.length);
  const impassable = IMPASSABLE.has(h.type);
  // A hazard with a walkable gap blocks only one of the two footpath columns;
  // full blockers (barrier, dead_end, or a gap too narrow to pass) take both.
  const hasGap =
    h.type !== 'barrier' &&
    h.type !== 'dead_end' &&
    (h.props?.passable_gap_m === undefined || h.props.passable_gap_m >= 0.6);
  const singleCell = h.type === 'broken_slab' || h.type === 'open_drain' || h.type === 'pole';
  const blockedCol = rng.chance(0.5) ? layout.footpathCols[0] : layout.footpathCols[1];

  for (let r = start; r <= end; r++) {
    const cols =
      impassable && !hasGap
        ? layout.footpathCols
        : singleCell || hasGap
          ? [blockedCol]
          : layout.footpathCols;
    for (const c of cols) {
      rows[r].cells[c] = {
        ...rows[r].cells[c],
        hazard: h.type,
        passable: !impassable,
      };
    }
  }
}

function applyRoadHazard(rows: CompiledRow[], seg: LevelSegment, h: Hazard): void {
  const layout = columnLayout(seg.footpath.side);
  const laneIndex = { road_1: 0, road_2: 1, road_3: 2 }[h.lane as 'road_1' | 'road_2' | 'road_3'];
  if (laneIndex === undefined) return;
  const col = layout.roadCols[laneIndex];
  const [start, end] = hazardRows(h, rows.length);
  for (let r = start; r <= end; r++) {
    rows[r].cells[col] = {
      ...rows[r].cells[col],
      hazard: h.type,
      passable: !IMPASSABLE.has(h.type),
    };
  }
}

function applyMonsoon(rows: CompiledRow[], seg: LevelSegment): void {
  const layout = columnLayout(seg.footpath.side);
  for (const p of seg.monsoon?.puddles ?? []) {
    const laneIndex = { road_1: 0, road_2: 1, road_3: 2 }[
      p.lane as 'road_1' | 'road_2' | 'road_3'
    ];
    if (laneIndex === undefined) continue;
    const col = layout.roadCols[laneIndex];
    const start = Math.min(rows.length - 1, Math.floor(p.at_m / METRES_PER_ROW));
    const end = Math.min(rows.length - 1, start + Math.ceil(p.span_m / METRES_PER_ROW) - 1);
    for (let r = start; r <= end; r++) {
      rows[r].cells[col] = { ...rows[r].cells[col], puddle: { splash: p.splash } };
    }
  }
  if (seg.monsoon?.waterlogged) {
    for (const row of rows) {
      for (const c of layout.footpathCols) {
        row.cells[c] = { ...row.cells[c], flooded: true, passable: false };
      }
    }
  }
}

/**
 * Open gaps in the kerb railing at seeded intervals (roughly every 10-20 m).
 * These are the only places to switch between footpath and road mid-segment,
 * so a dead-end can force a genuine backtrack to the last gap.
 */
function carveKerbGaps(rows: CompiledRow[], seg: LevelSegment, rng: Rng): void {
  const layout = columnLayout(seg.footpath.side);
  let next = rng.int(2, 5);
  while (next < rows.length) {
    const span = rng.chance(0.3) ? 2 : 1;
    for (let r = next; r < Math.min(next + span, rows.length); r++) {
      const cell = rows[r].cells[layout.kerbCol];
      rows[r].cells[layout.kerbCol] = { ...cell, passable: true, railing: false };
    }
    next += span + rng.int(4, 8);
  }
}

/** An all-open row used for the start buffer and side-flip transitions. */
function openRow(index: number, segmentIndex: number): CompiledRow {
  const cells: Cell[] = [];
  for (let c = 0; c < COLS; c++) cells.push({ kind: 'road', passable: true });
  return { index, segmentIndex, cells };
}

export function compileCorridor(spec: LevelSpec): CompiledLevel {
  const rows: CompiledRow[] = [];
  const segmentStartRows: number[] = [];

  for (let i = 0; i < START_BUFFER_ROWS; i++) {
    rows.push(openRow(rows.length, 0));
  }

  spec.segments.forEach((seg, si) => {
    segmentStartRows.push(rows.length);
    const segRows: CompiledRow[] = [];
    const n = rowsForLength(seg.length_m);
    for (let r = 0; r < n; r++) {
      segRows.push(baseRow(0, si, seg));
    }

    const rng = new Rng(segmentSeed(spec.seed, seg.key));
    carveKerbGaps(segRows, seg, rng);
    for (const h of seg.hazards) {
      if (h.lane === 'footpath') applyFootpathHazard(segRows, seg, h, rng);
      else applyRoadHazard(segRows, seg, h);
    }
    if (spec.mode === 'monsoon') applyMonsoon(segRows, seg);

    for (const row of segRows) {
      row.index = rows.length;
      rows.push(row);
    }

    // Junction band between segments: open rows so side flips and bends
    // never trap the player, annotated for the signpost/minimap. A junction
    // with a crossing becomes a wider cross-street band instead.
    const next = spec.segments[si + 1];
    if (next) {
      const bandRows = seg.crossing_after ? CROSSING_BAND_ROWS : 1;
      for (let k = 0; k < bandRows; k++) {
        const t = openRow(rows.length, si);
        if (seg.crossing_after) {
          for (const cell of t.cells) {
            cell.crossing = {
              type: seg.crossing_after.type,
              signal: seg.crossing_after.signal,
            };
          }
        }
        const isAnnotationRow = k === Math.floor(bandRows / 2);
        if (isAnnotationRow) {
          if (seg.bend_after_deg) {
            t.transition = { bendDeg: seg.bend_after_deg, nextName: next.name };
          } else if (next.footpath.side !== seg.footpath.side || next.name !== seg.name) {
            t.transition = { bendDeg: 0, nextName: next.name };
          }
        }
        rows.push(t);
      }
    }
  });

  const finish = openRow(rows.length, spec.segments.length - 1);
  finish.finish = true;
  rows.push(finish);

  return { rows, totalRows: rows.length, segmentStartRows, mode: spec.mode };
}
