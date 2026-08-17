import Phaser from 'phaser';
import type { LevelSpec } from '../../level/types';
import {
  COLS,
  METRES_PER_ROW,
  compileCorridor,
  columnLayout,
  type CompiledLevel,
  type CompiledRow,
} from '../../level/corridor';
import { Controls, type StepIntent } from '../../input/controls';
import { TrafficSystem, type LaneInfo } from '../traffic';
import { PedestrianSystem, pedDensityFor, type PedSpawnContext, type PedKind } from '../pedestrians';
import { BusStopSystem, type BusStopLocation } from '../busstops';
import { CrossTrafficSystem, type CrossingBand } from '../crosstraffic';
import { ProcessionSystem } from '../procession';
import { buildPoiZones, inSchoolZone, type PoiZones } from '../poiZones';
import { openReportForm } from '../../ui/reportForm';
import { emojiTexture } from '../emojiAtlas';
import { LabelPool, SpritePool } from '../pools';
import { sfx } from '../sound';
import {
  CAMERA_FOLLOW_OFFSET_Y,
  COLORS,
  CORRIDOR_X,
  CROWD_SHOVE_MS,
  DAMAGE,
  FOOTPATH_BONUS,
  FORWARD_STEP_COOLDOWN_MS,
  GAME_WIDTH,
  HAZARD_EMOJI,
  HONK_DISTANCE_TILES,
  INVULN_MS,
  NEAR_MISS_BONUS,
  poiEmoji,
  MAX_HEALTH,
  PRESSURE_RAMP,
  PRESSURE_ROWS_PER_S,
  PRESSURE_RUBBER_BAND_ROWS,
  PRESSURE_START_GAP,
  RES,
  SCORE_PER_ROW,
  STALL_WARES_EMOJI,
  STEP_TWEEN_MS,
  STUN_MS,
  TILE,
  MONSOON_EXTRA_TIME_S,
  TIME_BONUS_PER_S,
  TIME_BUDGET_SLACK_S,
  TIME_BUDGET_S_PER_M,
} from '../constants';

export type RunOutcome = 'finished' | 'died' | 'late';

export interface RunStats {
  outcome: RunOutcome;
  score: number;
  distanceM: number;
  totalM: number;
  damageTaken: number;
  footpathUsePct: number;
  footpathBlockedPct: number;
  timeLeftS: number;
  mode: LevelSpec['mode'];
  routeName: string;
  levelToken: string;
  minimap: LevelSpec['minimap'];
}

const PED_HIT: Record<PedKind, { damage: number; stunMs: number; toast: string }> = {
  walker: { damage: DAMAGE.pedestrian, stunMs: STUN_MS.pedestrian, toast: 'Bumped into someone!' },
  cow: { damage: DAMAGE.cow, stunMs: STUN_MS.cow, toast: 'Walked into a cow!' },
  dog: { damage: DAMAGE.dog, stunMs: STUN_MS.dog, toast: 'Tripped over a dog!' },
  bike: { damage: DAMAGE.footpathBike, stunMs: STUN_MS.footpathBike, toast: 'A bike on the footpath?!' },
};

/** Hazards drawn once per contiguous cluster instead of per cell. */
const CLUSTER_EMOJI = new Set(['dead_end', 'construction', 'barrier']);

export class GameScene extends Phaser.Scene {
  private spec!: LevelSpec;
  private level!: CompiledLevel;
  private rows!: CompiledRow[];
  private worldHeight = 0;

  /** Real route-metres reached at each row (junction bands add nothing). */
  private rowDistanceM: number[] = [];
  private player!: Phaser.GameObjects.Text;
  private playerRow = 1;
  private playerCol = 1;
  private moving = false;
  private buffered: StepIntent | null = null;
  private stunnedUntil = 0;
  private invulnUntil = 0;
  private nextForwardStepAt = 0;

  private health = MAX_HEALTH;
  private damageTaken = 0;
  private score = 0;
  private maxRow = 0;
  private rowsAdvanced = 0;
  private footpathRows = 0;
  private footpathBlockedPct = 0;

  private traffic!: TrafficSystem;
  private peds!: PedestrianSystem;
  private busStops!: BusStopSystem;
  private crossTraffic!: CrossTrafficSystem;
  private procession!: ProcessionSystem;
  private poiZones!: PoiZones;
  private templeTimer = 0;
  private reportOpen = false;
  private sprites!: SpritePool;
  private badgeLabels!: LabelPool; // yellow chips: honks, chai
  private floatLabels!: LabelPool; // green floaters: near-miss bonuses
  private worldChunks: { container: Phaser.GameObjects.Container; topY: number; bottomY: number }[] = [];
  private timeLeftMs = 0;
  private lastTickSecond = -1;
  private nearMissStreak = 0;
  private lastNearMissAt = 0;
  private pressureRow = 0;
  private pressureRect!: Phaser.GameObjects.Rectangle;
  private pressureEdge!: Phaser.GameObjects.Text;
  private pressureDamageCarry = 0;
  private caughtByCrowd = false;
  private crowdShoveTimer = 0;
  private hudTimer = 0;
  private elapsedMs = 0;
  private ended = false;

  constructor() {
    super('Game');
  }

  init(data: { spec: LevelSpec }): void {
    this.spec = data.spec;
  }

  create(): void {
    this.level = compileCorridor(this.spec);
    this.rows = this.level.rows;
    this.worldHeight = this.level.totalRows * TILE;
    this.resetRunState();

    this.sprites = new SpritePool(this);
    this.badgeLabels = new LabelPool(this, {
      fontSize: '16px',
      color: '#1a1a2e',
      backgroundColor: '#f4d35e',
      padding: { x: 6, y: 2 },
    });
    this.floatLabels = new LabelPool(this, {
      fontSize: '18px',
      color: '#8fd18f',
      fontStyle: 'bold',
    });

    // Pre-rasterize every emoji the run can spawn, so no frame mid-game ever
    // pays for a canvas rasterization.
    const warm: [string, number][] = [
      ['🚗', 44], ['🛺', 44], ['🚌', 44], ['🏍️', 44],
      ['🚗', 40], ['🛺', 40], ['🏍️', 40], // cross-traffic size
      ['🚶‍♀️', 40], ['🚶‍♂️', 40], ['👵', 40], ['🧍‍♂️', 40], ['🧕', 40], ['👨‍🦯', 40],
      ['🧒', 40], ['👦', 40], ['👧', 40], ['🎒', 40],
      ['🐄', 46], ['🐕', 34], ['🏍️', 42],
      ['🥁', 38], ['🎺', 38], ['💃', 38], ['🕺', 38], ['🎉', 38], ['🐎', 38],
      ['🚌', 50], ['🧍🧍', 20], ['💦', 38],
    ];
    for (const [emoji, size] of warm) emojiTexture(this, emoji, size);

    this.poiZones = buildPoiZones(this.spec, this.level);
    this.buildRowDistances();
    this.buildChunks();
    this.drawWorld();
    this.drawChaiStops();
    this.computeBlockedPct();

    this.player = this.add
      .text(this.colCenterX(this.playerCol), this.rowCenterY(this.playerRow), '🚶', {
        fontSize: '44px',
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.traffic = new TrafficSystem(
      this.sprites,
      this.worldHeight,
      (lane, y) => this.laneInfoAt(lane, y),
      (col) => this.colCenterX(col),
    );
    this.peds = new PedestrianSystem(
      this,
      this.sprites,
      this.worldHeight,
      (y) => this.pedContextAt(y),
      (col) => this.colCenterX(col),
    );

    this.timeLeftMs =
      (this.spec.total_length_m * TIME_BUDGET_S_PER_M +
        TIME_BUDGET_SLACK_S +
        (this.spec.mode === 'monsoon' ? MONSOON_EXTRA_TIME_S : 0)) *
      1000;

    const stops: BusStopLocation[] = [];
    for (const row of this.rows) {
      if (row.cells.some((c) => c.hazard === 'pole')) {
        const seg = this.spec.segments[row.segmentIndex];
        if (seg) stops.push({ row: row.index, roadCol: columnLayout(seg.footpath.side).roadCols[0] });
      }
    }
    this.busStops = new BusStopSystem(
      this.sprites,
      stops,
      (row) => this.rowCenterY(row),
      (col) => this.colCenterX(col),
    );

    const bands: CrossingBand[] = [];
    for (const row of this.rows) {
      const crossing = row.cells[0].crossing;
      if (!crossing) continue;
      const last = bands[bands.length - 1];
      if (last && last.startRow + last.rows === row.index) last.rows++;
      else bands.push({ startRow: row.index, rows: 1, type: crossing.type });
    }
    this.crossTraffic = new CrossTrafficSystem(this, this.sprites, bands, (row) => this.rowCenterY(row));

    this.procession = new ProcessionSystem(
      this.sprites,
      (y) => {
        const seg = this.segmentAtRow(this.yToRow(y));
        return seg ? columnLayout(seg.footpath.side).roadCols : null;
      },
      (col) => this.colCenterX(col),
    );
    this.procession.onSpawn = () => {
      sfx.bell();
      this.game.events.emit('hud:toast', '🎺 Baraat ahead! The road is taken over!');
    };

    this.pressureRow = this.playerRow - PRESSURE_START_GAP;
    const pressureColor = this.spec.mode === 'monsoon' ? COLORS.pressureWet : COLORS.pressureDry;
    this.pressureRect = this.add
      .rectangle(GAME_WIDTH / 2, this.worldHeight, GAME_WIDTH, this.worldHeight * 2, pressureColor, 0.4)
      .setOrigin(0.5, 0)
      .setDepth(20);
    const edgeEmoji = this.spec.mode === 'monsoon' ? '🌊🌊🌊🌊🌊🌊' : '👥👥👥👥👥👥';
    this.pressureEdge = this.add
      .text(GAME_WIDTH / 2, this.worldHeight, edgeEmoji, { fontSize: '40px' })
      .setOrigin(0.5, 1)
      .setDepth(21);

    const cam = this.cameras.main;
    cam.setZoom(RES); // HiDPI: framebuffer is RES x logical size
    cam.setBounds(0, 0, GAME_WIDTH, this.worldHeight);
    cam.startFollow(this.player, false, 0.12, 0.12);
    cam.setFollowOffset(0, CAMERA_FOLLOW_OFFSET_Y);

    const controls = new Controls(this);
    controls.onStep((intent) => this.tryStep(intent));
    this.input.keyboard?.on('keydown-ESC', () => {
      this.scene.stop('HUD');
      this.scene.start('Menu');
    });
    this.input.keyboard?.on('keydown-R', () => this.openReport());
    const onReport = () => this.openReport();
    this.game.events.on('report:open', onReport);
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('report:open', onReport);
    });

    this.scene.launch('HUD', { minimap: this.spec.minimap });
    this.emitHud();

    if (import.meta.env.DEV) {
      // Dev/test hook: teleport with __scene.debugTeleport(row) in devtools.
      (window as unknown as { __scene: GameScene }).__scene = this;
    }
  }

  /** Pause the run and report the footpath at the player's position. */
  private openReport(): void {
    if (this.ended || this.reportOpen) return;
    this.reportOpen = true;
    this.scene.pause();
    this.input.keyboard?.disableGlobalCapture();
    const seg = this.segmentAtRow(this.playerRow);
    const cellKind = this.rows[this.playerRow]?.cells[this.playerCol]?.kind;
    void openReportForm({
      levelToken: this.spec.level_token,
      distanceM: this.distanceAt(this.playerRow),
      lane: cellKind === 'road' ? 'road_1' : 'footpath',
      placeHint: seg?.name,
    }).then(() => {
      this.reportOpen = false;
      this.input.keyboard?.enableGlobalCapture();
      this.scene.resume();
    });
  }

  /** Dev-only helper for play-testing distant parts of a route. */
  debugTeleport(row: number): void {
    this.playerRow = Phaser.Math.Clamp(row, 0, this.rows.length - 1);
    this.maxRow = Math.max(this.maxRow, this.playerRow);
    this.pressureRow = this.playerRow - PRESSURE_START_GAP;
    this.player.setPosition(this.colCenterX(this.playerCol), this.rowCenterY(this.playerRow));
  }

  private resetRunState(): void {
    this.playerRow = 1;
    this.playerCol = 1;
    this.moving = false;
    this.buffered = null;
    this.stunnedUntil = 0;
    this.invulnUntil = 0;
    this.nextForwardStepAt = 0;
    this.health = MAX_HEALTH;
    this.damageTaken = 0;
    this.score = 0;
    this.maxRow = 1;
    this.rowsAdvanced = 0;
    this.footpathRows = 0;
    this.pressureDamageCarry = 0;
    this.caughtByCrowd = false;
    this.crowdShoveTimer = 0;
    this.hudTimer = 0;
    this.elapsedMs = 0;
    this.lastTickSecond = -1;
    this.nearMissStreak = 0;
    this.lastNearMissAt = 0;
    this.ended = false;
  }

  /** Rows per static-world chunk; each chunk culls as one unit. */
  private static readonly CHUNK_ROWS = 32;

  private buildChunks(): void {
    this.worldChunks = [];
    const count = Math.ceil(this.rows.length / GameScene.CHUNK_ROWS);
    for (let c = 0; c < count; c++) {
      const startRow = c * GameScene.CHUNK_ROWS;
      const endRow = Math.min(this.rows.length, startRow + GameScene.CHUNK_ROWS) - 1;
      this.worldChunks.push({
        container: this.add.container(0, 0).setDepth(1),
        topY: this.worldHeight - (endRow + 1) * TILE,
        bottomY: this.worldHeight - startRow * TILE,
      });
    }
  }

  private chunkFor(row: number): Phaser.GameObjects.Container {
    const idx = Math.min(
      this.worldChunks.length - 1,
      Math.max(0, Math.floor(row / GameScene.CHUNK_ROWS)),
    );
    return this.worldChunks[idx].container;
  }

  /** Phaser skips invisible containers entirely — the world costs O(viewport). */
  private cullChunks(cameraTopY: number, cameraBottomY: number): void {
    const margin = 220;
    for (const chunk of this.worldChunks) {
      chunk.container.visible =
        chunk.bottomY >= cameraTopY - margin && chunk.topY <= cameraBottomY + margin;
    }
  }

  /** Junction bands and buffers occupy rows but no real distance. */
  private buildRowDistances(): void {
    this.rowDistanceM = new Array(this.rows.length).fill(0);
    let cumulative = 0;
    this.spec.segments.forEach((seg, si) => {
      const startRow = this.level.segmentStartRows[si];
      const segRows = Math.max(1, Math.round(seg.length_m / METRES_PER_ROW));
      const nextStart =
        si + 1 < this.level.segmentStartRows.length
          ? this.level.segmentStartRows[si + 1]
          : this.rows.length;
      for (let r = startRow; r < nextStart; r++) {
        const into = Math.min(seg.length_m, (r - startRow + 1) * METRES_PER_ROW);
        this.rowDistanceM[r] = Math.round(cumulative + (r < startRow + segRows ? into : seg.length_m));
      }
      cumulative += seg.length_m;
    });
    if (this.rows.length) this.rowDistanceM[this.rows.length - 1] = Math.round(cumulative);
  }

  private distanceAt(row: number): number {
    return this.rowDistanceM[Math.min(row, this.rowDistanceM.length - 1)] ?? 0;
  }

  // ── coordinates ────────────────────────────────────────────────

  private rowCenterY(row: number): number {
    return this.worldHeight - (row + 0.5) * TILE;
  }

  private colCenterX(col: number): number {
    return CORRIDOR_X + (col + 0.5) * TILE;
  }

  private yToRow(y: number): number {
    return Phaser.Math.Clamp(Math.floor((this.worldHeight - y) / TILE), 0, this.rows.length - 1);
  }

  private segmentAtRow(row: number) {
    return this.spec.segments[this.rows[row]?.segmentIndex ?? 0];
  }

  private laneInfoAt(lane: 0 | 1 | 2, y: number): LaneInfo {
    const seg = this.segmentAtRow(this.yToRow(y));
    if (!seg) return { col: null, density: 0, mix: { car: 1, rickshaw: 0, bus: 0, bike: 0 } };
    const layout = columnLayout(seg.footpath.side);
    return { col: layout.roadCols[lane], density: seg.traffic_density, mix: seg.vehicle_mix };
  }

  private pedContextAt(y: number): PedSpawnContext {
    const row = this.yToRow(y);
    const seg = this.segmentAtRow(row);
    const footpathCols =
      seg && seg.footpath.present ? columnLayout(seg.footpath.side).footpathCols : null;
    const school = this.poiZones ? inSchoolZone(this.poiZones.schoolZones, row) : false;
    return {
      footpathCols,
      density: seg ? pedDensityFor(seg.road_class) : 0,
      densityMultiplier: school ? 1.8 : 1,
      kids: school,
      cellAt: (r, col) => this.rows[r]?.cells[col],
      rowAtY: (yy) => this.yToRow(yy),
    };
  }

  // ── world rendering ────────────────────────────────────────────

  private drawWorld(): void {
    let g!: Phaser.GameObjects.Graphics;
    let chunkIndex = -1;
    for (const row of this.rows) {
      // New chunk boundary: start a fresh Graphics inside that chunk's container.
      const rowChunk = Math.floor(row.index / GameScene.CHUNK_ROWS);
      if (rowChunk !== chunkIndex) {
        chunkIndex = rowChunk;
        g = this.add.graphics();
        this.worldChunks[Math.min(chunkIndex, this.worldChunks.length - 1)].container.add(g);
      }
      const top = this.worldHeight - (row.index + 1) * TILE;
      for (let c = 0; c < COLS; c++) {
        const cell = row.cells[c];
        const x = CORRIDOR_X + c * TILE;
        let color: number = COLORS.road;
        if (cell.flooded) color = COLORS.flooded;
        else if (cell.kind === 'footpath') {
          color = cell.passable === false && cell.hazard
            ? COLORS.blocked
            : (row.index + c) % 2 === 0
              ? COLORS.footpath
              : COLORS.footpathDark;
        } else if (cell.kind === 'kerb') color = cell.railing ? COLORS.railingFill : COLORS.kerb;
        else color = row.index % 2 === 0 ? COLORS.road : COLORS.roadDark;
        g.fillStyle(color, 1);
        g.fillRect(x, top, TILE, TILE);

        if (cell.railing) {
          // Railing: a rail line with two posts — reads as "can't cross here".
          g.fillStyle(COLORS.railingPost, 1);
          g.fillRect(x + TILE * 0.42, top, TILE * 0.16, TILE);
          g.fillRect(x + TILE * 0.3, top + TILE * 0.12, TILE * 0.4, TILE * 0.1);
          g.fillRect(x + TILE * 0.3, top + TILE * 0.62, TILE * 0.4, TILE * 0.1);
        }

        if (cell.crossing && cell.crossing.type !== 'unmarked') {
          // Zebra stripes run in the walking direction.
          g.fillStyle(0xd8d8dc, 0.55);
          g.fillRect(x + TILE * 0.12, top, TILE * 0.18, TILE);
          g.fillRect(x + TILE * 0.55, top, TILE * 0.18, TILE);
        }

        if (cell.puddle) {
          g.fillStyle(COLORS.puddle, 0.85);
          g.fillEllipse(x + TILE / 2, top + TILE / 2, TILE * 0.8, TILE * 0.55);
        }
        // Dashed lane marking between two road cells.
        const right = row.cells[c + 1];
        if (cell.kind === 'road' && right?.kind === 'road' && row.index % 2 === 0) {
          g.fillStyle(COLORS.laneMark, 0.7);
          g.fillRect(x + TILE - 2, top + TILE * 0.25, 4, TILE * 0.5);
        }
      }
    }

    this.drawHazardEmoji();
    this.drawSignposts();
    this.drawPois();

    // Start and finish bands.
    this.chunkFor(1).add(
      this.add
        .text(GAME_WIDTH / 2, this.rowCenterY(1) + TILE, `START — ${this.spec.minimap.origin_name}`, {
          fontSize: '16px',
          color: '#ffffff',
          backgroundColor: '#2a7a2a',
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5),
    );
    const finishRow = this.rows[this.rows.length - 1];
    this.chunkFor(finishRow.index).add(
      this.add
        .text(GAME_WIDTH / 2, this.rowCenterY(finishRow.index), `🏁 ${this.spec.minimap.dest_name}`, {
          fontSize: '22px',
          color: '#ffffff',
          backgroundColor: '#2a7a2a',
          padding: { x: 10, y: 6 },
        })
        .setOrigin(0.5),
    );
  }

  private drawHazardEmoji(): void {
    for (const row of this.rows) {
      for (let c = 0; c < COLS; c++) {
        const cell = row.cells[c];
        if (!cell.hazard) continue;
        let emoji = HAZARD_EMOJI[cell.hazard];
        if (!emoji) continue;
        if (CLUSTER_EMOJI.has(cell.hazard)) {
          const below = this.rows[row.index - 1]?.cells[c];
          if (below?.hazard === cell.hazard) continue; // only at cluster start
        }
        if (cell.hazard === 'hawker_stall') {
          // Umbrella at the stall front, wares piled behind it.
          const below = this.rows[row.index - 1]?.cells[c];
          if (below?.hazard === 'hawker_stall') {
            emoji = STALL_WARES_EMOJI[(row.index + c) % STALL_WARES_EMOJI.length];
          }
        }
        // Skip the synthetic barrier marking a missing footpath — the dark
        // fill alone reads as "no footpath here".
        if (cell.hazard === 'barrier' && !this.segmentHasBarrier(row)) continue;
        this.chunkFor(row.index).add(
          this.add
            .image(this.colCenterX(c), this.rowCenterY(row.index), emojiTexture(this, emoji, 40))
            .setScale(1 / RES),
        );
      }
    }
  }

  private segmentHasBarrier(row: CompiledRow): boolean {
    const seg = this.spec.segments[row.segmentIndex];
    return seg ? seg.footpath.present : true;
  }

  /**
   * Real named places as little shopfront signs at the corridor edges —
   * "you're walking past Candies" is what makes a route feel like Bandra.
   */
  private drawPois(): void {
    const lastRowUsed: Record<'left' | 'right', number> = { left: -10, right: -10 };
    this.spec.segments.forEach((seg, si) => {
      const startRow = this.level.segmentStartRows[si];
      const segRows = Math.max(1, Math.round(seg.length_m / METRES_PER_ROW));
      for (const poi of seg.pois ?? []) {
        let row = startRow + Math.min(segRows - 1, Math.floor(poi.at_m / METRES_PER_ROW));
        // Nudge the sign to a nearby row whose edge cell has no hazard icon.
        const edgeCol = poi.side === 'left' ? 0 : COLS - 1;
        for (const delta of [0, 1, -1, 2, -2]) {
          const cell = this.rows[row + delta]?.cells[edgeCol];
          if (cell && !cell.hazard) {
            row += delta;
            break;
          }
        }
        if (Math.abs(row - lastRowUsed[poi.side]) < 2) continue; // avoid stacked signs
        lastRowUsed[poi.side] = row;
        const name = poi.name.length > 20 ? `${poi.name.slice(0, 19)}…` : poi.name;
        const label = `${poiEmoji(poi.category)} ${name}`;
        const onLeft = poi.side === 'left';
        this.chunkFor(row).add(
          this.add
            .text(onLeft ? CORRIDOR_X + 4 : GAME_WIDTH - CORRIDOR_X - 4, this.rowCenterY(row), label, {
              fontSize: '12px',
              color: '#e8e3d0',
              backgroundColor: '#22223add',
              padding: { x: 5, y: 2 },
            })
            .setOrigin(onLeft ? 0 : 1, 0.5)
            .setAlpha(0.92),
        );
      }
    });
  }

  private drawChaiStops(): void {
    for (const stop of this.poiZones.chaiStops) {
      const x = this.colCenterX(stop.col);
      const y = this.rowCenterY(stop.row);
      const chunk = this.chunkFor(stop.row);
      chunk.add(this.add.circle(x, y, TILE * 0.42, 0xf4d35e, 0.22));
      chunk.add(this.add.image(x, y, emojiTexture(this, '☕', 30)).setScale(1 / RES));
    }
  }

  private drawSignposts(): void {
    for (const row of this.rows) {
      if (!row.transition) continue;
      const arrow = row.transition.bendDeg < 0 ? '⬅️' : row.transition.bendDeg > 0 ? '➡️' : '⬆️';
      const label = row.transition.nextName ? `${arrow}  ${row.transition.nextName}` : arrow;
      this.chunkFor(row.index).add(
        this.add
          .text(GAME_WIDTH / 2, this.rowCenterY(row.index), label, {
            fontSize: '18px',
            color: '#1a1a2e',
            backgroundColor: '#e8e3d0',
            padding: { x: 10, y: 4 },
          })
          .setOrigin(0.5),
      );
    }
  }

  private computeBlockedPct(): void {
    let total = 0;
    let blocked = 0;
    for (const row of this.rows) {
      for (const cell of row.cells) {
        if (cell.kind !== 'footpath') continue;
        total++;
        if (!cell.passable) blocked++;
      }
    }
    this.footpathBlockedPct = total ? Math.round((blocked / total) * 100) : 0;
  }

  // ── movement ───────────────────────────────────────────────────

  private tryStep(intent: StepIntent): void {
    if (this.ended) return;
    if (this.moving || this.time.now < this.stunnedUntil) {
      this.buffered = intent;
      return;
    }
    if (intent === 'up' && this.time.now < this.nextForwardStepAt) {
      this.buffered = intent;
      return;
    }
    let row = this.playerRow;
    let col = this.playerCol;
    if (intent === 'up') row++;
    else if (intent === 'down') row--;
    else if (intent === 'left') col--;
    else col++;

    if (row < 0 || row >= this.rows.length || col < 0 || col >= COLS) return;
    const cell = this.rows[row].cells[col];
    if (!cell.passable) {
      this.bump(intent);
      return;
    }

    this.moving = true;
    if (intent === 'up') this.nextForwardStepAt = this.time.now + FORWARD_STEP_COOLDOWN_MS;
    this.playerRow = row;
    this.playerCol = col;
    this.tweens.add({
      targets: this.player,
      x: this.colCenterX(col),
      y: this.rowCenterY(row),
      duration: STEP_TWEEN_MS,
      onComplete: () => {
        this.moving = false;
        this.arrive();
        const next = this.buffered;
        this.buffered = null;
        if (next) this.tryStep(next);
      },
    });
  }

  private bump(intent: StepIntent): void {
    const dx = intent === 'left' ? -6 : intent === 'right' ? 6 : 0;
    const dy = intent === 'up' ? -6 : intent === 'down' ? 6 : 0;
    this.tweens.add({
      targets: this.player,
      x: this.player.x + dx,
      y: this.player.y + dy,
      duration: 50,
      yoyo: true,
    });
  }

  private arrive(): void {
    const row = this.rows[this.playerRow];
    const cell = row.cells[this.playerCol];

    if (row.finish) {
      this.endRun('finished');
      return;
    }

    if (cell.hazard === 'broken_slab') {
      this.hurt(DAMAGE.brokenSlab, 'Tripped on a broken slab!');
      this.stunnedUntil = this.time.now + STUN_MS.brokenSlab;
    } else if (cell.hazard === 'open_drain') {
      this.hurt(DAMAGE.openDrain, 'Fell in an open drain!');
      this.stunnedUntil = this.time.now + STUN_MS.openDrain;
    }
    if (cell.puddle && this.spec.mode === 'monsoon') {
      this.stunnedUntil = this.time.now + 250;
    }

    const chai = this.poiZones.chaiStops.find(
      (s) => !s.used && s.row === this.playerRow && s.col === this.playerCol,
    );
    if (chai) {
      chai.used = true;
      this.stunnedUntil = this.time.now + 1500; // sipping takes time
      this.health = Math.min(MAX_HEALTH, this.health + 10);
      sfx.slurp();
      const pop = this.badgeLabels
        .obtain(`☕ +10 ❤ Cutting chai at ${chai.name}!`, this.player.x, this.player.y - TILE * 0.8)
        .setDepth(16);
      this.tweens.add({
        targets: pop,
        alpha: 0,
        y: pop.y - 26,
        duration: 1600,
        onComplete: () => this.badgeLabels.release(pop),
      });
      this.emitHud();
    }

    if (this.playerRow > this.maxRow) {
      const newRows = this.playerRow - this.maxRow;
      this.maxRow = this.playerRow;
      this.rowsAdvanced += newRows;
      const onFootpath = cell.kind === 'footpath';
      if (onFootpath) this.footpathRows += newRows;
      this.score += Math.round(newRows * SCORE_PER_ROW * (onFootpath ? FOOTPATH_BONUS : 1));
      this.emitHud();
    }
  }

  private hurt(amount: number, reason: string): void {
    if (this.ended) return;
    this.health = Math.max(0, this.health - amount);
    this.damageTaken += amount;
    sfx.thud();
    this.cameras.main.shake(120, 0.008);
    this.player.setTint(0xff6666);
    this.time.delayedCall(200, () => this.player.clearTint());
    this.game.events.emit('hud:toast', reason);
    this.emitHud();
    if (this.health <= 0) this.endRun('died');
  }

  // ── per-frame systems ──────────────────────────────────────────

  update(_time: number, deltaMs: number): void {
    if (this.ended) return;
    this.elapsedMs += deltaMs;
    const cam = this.cameras.main;
    this.cullChunks(cam.scrollY, cam.scrollY + cam.height);
    this.traffic.update(deltaMs, cam.scrollY, cam.scrollY + cam.height);
    this.peds.update(deltaMs, cam.scrollY, cam.scrollY + cam.height);
    this.busStops.update(deltaMs, cam.scrollY, cam.scrollY + cam.height);
    this.crossTraffic.update(deltaMs, cam.scrollY, cam.scrollY + cam.height);
    this.procession.update(deltaMs, cam.scrollY, cam.scrollY + cam.height);
    this.checkVehicleCollisions();
    this.checkHonksAndNearMisses();
    this.checkPedCollisions();
    this.checkProcessionCollisions();

    // Drain a buffered forward step once its cooldown expires.
    if (this.buffered && !this.moving && this.time.now >= this.stunnedUntil) {
      if (this.buffered !== 'up' || this.time.now >= this.nextForwardStepAt) {
        const next = this.buffered;
        this.buffered = null;
        this.tryStep(next);
      }
    }
    if (this.spec.mode === 'monsoon') this.checkSplashes();
    this.updatePressure(deltaMs);

    this.timeLeftMs -= deltaMs;
    if (this.timeLeftMs <= 0) {
      this.timeLeftMs = 0;
      this.endRun('late');
      return;
    }
    const sec = Math.ceil(this.timeLeftMs / 1000);
    if (sec <= 10 && sec !== this.lastTickSecond) {
      this.lastTickSecond = sec;
      sfx.tick();
    }

    this.hudTimer += deltaMs;
    if (this.hudTimer > 150) {
      this.hudTimer = 0;
      this.emitHud();
    }

    this.templeTimer += deltaMs;
    if (this.templeTimer > 4000) {
      this.templeTimer = 0;
      this.maybeTempleBurst(cam.scrollY);
    }
  }

  /** Temples ahead occasionally let the aarti crowd out onto the footpath. */
  private maybeTempleBurst(cameraTopY: number): void {
    for (const temple of this.poiZones.temples) {
      const y = this.rowCenterY(temple.row);
      if (y < cameraTopY - 200 || y > cameraTopY + 300) continue; // just ahead
      if (this.time.now - temple.lastBurstMs < 20000) continue;
      if (Math.random() > 0.5) continue;
      temple.lastBurstMs = this.time.now;
      this.peds.burst(y, 5);
      sfx.bell();
      this.game.events.emit('hud:toast', `🔔 Crowd pouring out of ${temple.name}!`);
      return;
    }
  }

  private checkVehicleCollisions(): void {
    if (this.time.now < this.invulnUntil) return;
    for (const v of this.traffic.vehicles) {
      if (v.col !== this.playerCol) continue;
      if (Math.abs(v.obj.y - this.player.y) > TILE * 0.55) continue;
      this.invulnUntil = this.time.now + INVULN_MS;
      this.hurt(DAMAGE.vehicle, `Hit by a ${v.kind}!`);
      this.stunnedUntil = this.time.now + 600;
      return;
    }
    for (const bus of this.busStops.buses) {
      if (bus.col !== this.playerCol) continue;
      if (Math.abs(bus.obj.y - this.player.y) > TILE * 0.75) continue;
      this.invulnUntil = this.time.now + INVULN_MS;
      this.hurt(DAMAGE.vehicle, 'Hit by the bus!');
      this.stunnedUntil = this.time.now + 600;
      return;
    }
    for (const v of this.crossTraffic.vehicles) {
      if (Math.abs(v.obj.y - this.player.y) > TILE * 0.5) continue;
      if (Math.abs(v.obj.x - this.player.x) > TILE * 0.6) continue;
      this.invulnUntil = this.time.now + INVULN_MS;
      this.hurt(DAMAGE.vehicle, `Hit by crossing ${v.kind === 'rickshaw' ? 'rickshaw' : 'traffic'}!`);
      this.stunnedUntil = this.time.now + 600;
      return;
    }
  }

  private checkProcessionCollisions(): void {
    if (this.time.now < this.invulnUntil) return;
    for (const m of this.procession.members) {
      if (m.col !== this.playerCol) continue;
      if (Math.abs(m.obj.y - this.player.y) > TILE * 0.5) continue;
      this.invulnUntil = this.time.now + INVULN_MS;
      this.stunnedUntil = this.time.now + 400;
      this.hurt(DAMAGE.pedestrian, 'Swept into the baraat!');
      return;
    }
  }

  private checkHonksAndNearMisses(): void {
    const onRoad = this.rows[this.playerRow]?.cells[this.playerCol]?.kind === 'road';
    for (const v of this.traffic.vehicles) {
      // Honk: same lane, closing in from behind or ahead.
      if (!v.honked && v.col === this.playerCol) {
        const gap = (v.obj.y - this.player.y) * -v.dirY;
        // gap > 0 means the vehicle is moving toward the player.
        if (gap > 0 && gap < TILE * HONK_DISTANCE_TILES) {
          v.honked = true;
          sfx.honk(v.wrongSide);
          const honk = this.badgeLabels
            .obtain(v.wrongSide ? '📢 WRONG SIDE!' : '📢 HONK!', v.obj.x, v.obj.y - TILE * 0.6)
            .setDepth(16);
          this.tweens.add({
            targets: honk,
            alpha: 0,
            y: honk.y - 18,
            duration: 700,
            onComplete: () => this.badgeLabels.release(honk),
          });
        }
      }
      // Near miss: it blasts past one column over while you're on the road.
      if (!v.nearMissed && onRoad && Math.abs(v.col - this.playerCol) === 1) {
        if (Math.abs(v.obj.y - this.player.y) < TILE * 0.5) {
          v.nearMissed = true;
          // Chained near-misses multiply — reward the daredevil line.
          this.nearMissStreak =
            this.time.now - this.lastNearMissAt < 4000 ? this.nearMissStreak + 1 : 1;
          this.lastNearMissAt = this.time.now;
          const bonus = NEAR_MISS_BONUS * this.nearMissStreak;
          this.score += bonus;
          sfx.nearMiss();
          const label = this.nearMissStreak > 1 ? `😅 +${bonus} ×${this.nearMissStreak}` : `😅 +${bonus}`;
          const pop = this.floatLabels
            .obtain(label, this.player.x, this.player.y - TILE * 0.7)
            .setDepth(16);
          this.tweens.add({
            targets: pop,
            alpha: 0,
            y: pop.y - 24,
            duration: 600,
            onComplete: () => this.floatLabels.release(pop),
          });
        }
      }
    }
  }

  private checkPedCollisions(): void {
    if (this.time.now < this.invulnUntil) return;
    for (const p of this.peds.peds) {
      if (p.col !== this.playerCol) continue;
      if (Math.abs(p.obj.y - this.player.y) > TILE * 0.55) continue;
      const hit = PED_HIT[p.kind];
      this.invulnUntil = this.time.now + INVULN_MS;
      this.stunnedUntil = this.time.now + hit.stunMs;
      this.hurt(hit.damage, hit.toast);
      return;
    }
  }

  private checkSplashes(): void {
    for (const v of this.traffic.vehicles) {
      if (v.splashCooldownMs > 0) continue;
      const row = this.yToRow(v.obj.y);
      const cell = this.rows[row]?.cells[v.col];
      if (!cell?.puddle?.splash) continue;
      v.splashCooldownMs = 1200;
      const splash = this.sprites.obtain('💦', 38, this.colCenterX(v.col), v.obj.y).setDepth(15);
      this.tweens.add({
        targets: splash,
        alpha: 0,
        scale: 1.8,
        duration: 500,
        onComplete: () => this.sprites.release(splash),
      });
      if (Math.abs(this.playerCol - v.col) <= 1 && Math.abs(this.playerRow - row) <= 1) {
        sfx.splash();
        this.hurt(DAMAGE.splash, 'Splashed by a passing vehicle!');
      }
    }
  }

  private updatePressure(deltaMs: number): void {
    const speed = PRESSURE_ROWS_PER_S + PRESSURE_RAMP * this.elapsedMs;
    this.pressureRow += (speed * deltaMs) / 1000;
    // Rubber band: the crowd never falls hopelessly behind.
    this.pressureRow = Math.max(this.pressureRow, this.playerRow - PRESSURE_RUBBER_BAND_ROWS);

    const edgeY = this.rowCenterY(this.pressureRow);
    this.pressureRect.setPosition(GAME_WIDTH / 2, edgeY);
    this.pressureEdge.setPosition(GAME_WIDTH / 2, edgeY + 20);
    this.peds.despawnBelowY(edgeY);

    if (this.playerRow > this.pressureRow) {
      this.caughtByCrowd = false;
      this.crowdShoveTimer = 0;
      return;
    }

    // Swallowed: steady drain (no shake spam), and the crowd carries you
    // forward — surf it to escape instead of dying in place.
    if (!this.caughtByCrowd) {
      this.caughtByCrowd = true;
      this.game.events.emit(
        'hud:toast',
        this.spec.mode === 'monsoon'
          ? 'The water has you — wade forward!'
          : 'Swallowed by the crowd — push through!',
      );
    }
    this.pressureDamageCarry += (DAMAGE.pressurePerSecond * deltaMs) / 1000;
    if (this.pressureDamageCarry >= 1) {
      const whole = Math.floor(this.pressureDamageCarry);
      this.pressureDamageCarry -= whole;
      this.drain(whole);
    }
    this.crowdShoveTimer += deltaMs;
    if (this.crowdShoveTimer >= CROWD_SHOVE_MS && !this.moving) {
      this.crowdShoveTimer = 0;
      this.crowdShove();
    }
  }

  /** Quiet damage for the crowd drain — no camera shake, no toast per tick. */
  private drain(amount: number): void {
    if (this.ended) return;
    this.health = Math.max(0, this.health - amount);
    this.damageTaken += amount;
    this.player.setTint(0xffaa88);
    this.time.delayedCall(150, () => this.player.clearTint());
    this.emitHud();
    if (this.health <= 0) this.endRun('died');
  }

  /** The crowd pushes you one row forward, dodging into a free column. */
  private crowdShove(): void {
    const nextRow = this.playerRow + 1;
    if (nextRow >= this.rows.length) return;
    const cols = [this.playerCol, this.playerCol - 1, this.playerCol + 1].filter(
      (c) => c >= 0 && c < COLS && this.rows[nextRow].cells[c].passable,
    );
    if (!cols.length) return;
    this.playerRow = nextRow;
    this.playerCol = cols[0];
    this.moving = true;
    this.tweens.add({
      targets: this.player,
      x: this.colCenterX(this.playerCol),
      y: this.rowCenterY(this.playerRow),
      duration: 140,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.moving = false;
        this.arrive();
      },
    });
  }

  // ── HUD + end ──────────────────────────────────────────────────

  private emitHud(): void {
    const seg = this.segmentAtRow(this.playerRow);
    this.game.events.emit('hud:update', {
      health: this.health,
      score: this.score,
      distanceM: this.distanceAt(this.maxRow),
      totalM: Math.round(this.spec.total_length_m),
      streetName: seg?.name ?? '',
      mode: this.spec.mode,
      timeLeftS: Math.ceil(this.timeLeftMs / 1000),
      onFootpath: this.rows[this.playerRow]?.cells[this.playerCol]?.kind === 'footpath',
    });
  }

  private endRun(outcome: RunOutcome): void {
    if (this.ended) return;
    this.ended = true;
    const timeLeftS = Math.ceil(this.timeLeftMs / 1000);
    if (outcome === 'finished') this.score += timeLeftS * TIME_BONUS_PER_S;
    if (outcome === 'finished') sfx.win();
    else sfx.lose();
    const stats: RunStats = {
      outcome,
      timeLeftS,
      score: this.score,
      distanceM: outcome === 'finished' ? Math.round(this.spec.total_length_m) : this.distanceAt(this.maxRow),
      totalM: Math.round(this.spec.total_length_m),
      damageTaken: this.damageTaken,
      footpathUsePct: this.rowsAdvanced
        ? Math.round((this.footpathRows / this.rowsAdvanced) * 100)
        : 0,
      footpathBlockedPct: this.footpathBlockedPct,
      mode: this.spec.mode,
      routeName: `${this.spec.minimap.origin_name} → ${this.spec.minimap.dest_name}`,
      levelToken: this.spec.level_token,
      minimap: this.spec.minimap,
    };
    this.time.delayedCall(outcome === 'finished' ? 400 : 700, () => {
      this.traffic.destroy();
      this.peds.destroy();
      this.busStops.destroy();
      this.crossTraffic.destroy();
      this.procession.destroy();
      this.scene.stop('HUD');
      this.scene.start('Results', stats);
    });
  }
}
