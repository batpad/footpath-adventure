import { describe, expect, it } from 'vitest';
import {
  compileCorridor,
  columnLayout,
  CROSSING_BAND_ROWS,
  METRES_PER_ROW,
  START_BUFFER_ROWS,
} from './corridor';
import { sampleLevel } from './sample-level';
import { Rng } from './rng';

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('compileCorridor', () => {
  it('is deterministic: same spec compiles to identical rows', () => {
    const a = compileCorridor(sampleLevel);
    const b = compileCorridor(sampleLevel);
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows));
  });

  it('allocates rows for every segment plus buffers and junction bands', () => {
    const level = compileCorridor(sampleLevel);
    const segmentRows = sampleLevel.segments.reduce(
      (sum, s) => sum + Math.max(1, Math.round(s.length_m / METRES_PER_ROW)),
      0,
    );
    const junctionRows = sampleLevel.segments
      .slice(0, -1)
      .reduce((sum, s) => sum + (s.crossing_after ? CROSSING_BAND_ROWS : 1), 0);
    expect(level.totalRows).toBe(START_BUFFER_ROWS + segmentRows + junctionRows + 1);
    expect(level.rows[level.totalRows - 1].finish).toBe(true);
  });

  it('builds passable crossing bands at junctions with crossings', () => {
    const level = compileCorridor(sampleLevel);
    // Segment 0 (Station Road) has a signal crossing after it.
    const bandStart = level.segmentStartRows[1] - CROSSING_BAND_ROWS;
    for (let k = 0; k < CROSSING_BAND_ROWS; k++) {
      const row = level.rows[bandStart + k];
      for (const cell of row.cells) {
        expect(cell.crossing).toEqual({ type: 'signals', signal: true });
        expect(cell.passable).toBe(true);
      }
    }
    // Segment 2 ends in a zebra crossing; segment 1's junction has no
    // crossing, so it stays a single open row.
    expect(level.rows[level.segmentStartRows[3] - 1].cells[0].crossing?.type).toBe('zebra');
    expect(level.rows[level.segmentStartRows[2] - 1].cells[0].crossing).toBeUndefined();
    expect(level.rows[level.segmentStartRows[2] - 2].cells[0].crossing).toBeUndefined();
  });

  it('makes dead_end rows impassable across the whole footpath', () => {
    const level = compileCorridor(sampleLevel);
    // Segment 1 has a dead_end at 70 m spanning 16 m.
    const segStart = level.segmentStartRows[1];
    const seg = sampleLevel.segments[1];
    const layout = columnLayout(seg.footpath.side);
    const deadEndRow = segStart + Math.floor(70 / METRES_PER_ROW);
    for (const c of layout.footpathCols) {
      expect(level.rows[deadEndRow].cells[c].passable).toBe(false);
      expect(level.rows[deadEndRow].cells[c].hazard).toBe('dead_end');
    }
    // The road stays open at the dead end.
    for (const c of layout.roadCols) {
      expect(level.rows[deadEndRow].cells[c].passable).toBe(true);
    }
  });

  it('leaves a walkable gap next to a passable hawker stall', () => {
    const level = compileCorridor(sampleLevel);
    // Segment 0 hawker at 18 m has passable_gap_m 0.7 — one footpath col free.
    const segStart = level.segmentStartRows[0];
    const layout = columnLayout('left');
    const row = level.rows[segStart + Math.floor(18 / METRES_PER_ROW)];
    const blocked = layout.footpathCols.filter((c) => !row.cells[c].passable);
    expect(blocked).toHaveLength(1);
  });

  it('mirrors the layout when the footpath side flips', () => {
    const level = compileCorridor(sampleLevel);
    // Segment 2 has footpath on the right.
    const segStart = level.segmentStartRows[2];
    const row = level.rows[segStart];
    expect(row.cells[4].kind).toBe('footpath');
    expect(row.cells[5].kind).toBe('footpath');
    expect(row.cells[3].kind).toBe('kerb');
    expect(row.cells[0].kind).toBe('road');
  });

  it('adds monsoon puddles and waterlogging only in monsoon mode', () => {
    const dry = compileCorridor({ ...sampleLevel, mode: 'dry' });
    const wet = compileCorridor({ ...sampleLevel, mode: 'monsoon' });
    const hasPuddles = (rows: typeof dry.rows) =>
      rows.some((r) => r.cells.some((c) => c.puddle));
    expect(hasPuddles(dry.rows)).toBe(false);
    expect(hasPuddles(wet.rows)).toBe(true);
    // Segment 2 is waterlogged: its footpath must be flooded and impassable.
    const segStart = wet.segmentStartRows[2];
    expect(wet.rows[segStart].cells[4].flooded).toBe(true);
    expect(wet.rows[segStart].cells[4].passable).toBe(false);
  });

  it('builds an impassable kerb railing with periodic crossing gaps', () => {
    const level = compileCorridor(sampleLevel);
    sampleLevel.segments.forEach((seg, si) => {
      const layout = columnLayout(seg.footpath.side);
      const start = level.segmentStartRows[si];
      const end =
        si + 1 < level.segmentStartRows.length
          ? level.segmentStartRows[si + 1] - 1 // exclude the junction band
          : level.totalRows - 1;
      const kerbCells = level.rows
        .slice(start, end)
        .filter((r) => r.segmentIndex === si)
        .map((r) => r.cells[layout.kerbCol]);
      const gaps = kerbCells.filter((c) => c.passable).length;
      const railings = kerbCells.filter((c) => c.railing && !c.passable).length;
      expect(gaps).toBeGreaterThan(0); // you can always switch somewhere
      expect(railings).toBeGreaterThan(gaps); // but mostly you are committed
    });
  });

  it('always leaves at least one passable column in every row', () => {
    for (const mode of ['dry', 'monsoon'] as const) {
      const level = compileCorridor({ ...sampleLevel, mode });
      for (const row of level.rows) {
        expect(row.cells.some((c) => c.passable)).toBe(true);
      }
    }
  });
});
