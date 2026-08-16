/**
 * Footpath chaos: oncoming pedestrians, parked cows, darting dogs, and the
 * occasional two-wheeler riding down the footpath. They spawn ahead of the
 * camera on the footpath columns and force constant lateral negotiation.
 */
import Phaser from 'phaser';
import { TILE } from './constants';
import type { Cell } from '../level/corridor';
import type { SpritePool } from './pools';

export type PedKind = 'walker' | 'cow' | 'dog' | 'bike';

export interface Pedestrian {
  obj: Phaser.GameObjects.Image;
  col: number;
  /** Pixels per second toward the player (downscreen). */
  speed: number;
  kind: PedKind;
  sidestepCooldownMs: number;
}

const WALKER_EMOJI = ['🚶‍♀️', '🚶‍♂️', '👵', '🧍‍♂️', '🧕', '👨‍🦯'];
const KID_EMOJI = ['🧒', '👦', '👧', '🎒'];

interface KindConfig {
  weight: number;
  emoji: (rand: () => number) => string;
  speed: () => number;
  fontPx: number;
}

const KINDS: Record<PedKind, KindConfig> = {
  walker: {
    weight: 0.8,
    emoji: (rand) => WALKER_EMOJI[Math.floor(rand() * WALKER_EMOJI.length)],
    speed: () => 40 + Math.random() * 35,
    fontPx: 40,
  },
  cow: {
    weight: 0.06,
    emoji: () => '🐄',
    speed: () => (Math.random() < 0.6 ? 0 : 10),
    fontPx: 46,
  },
  dog: {
    weight: 0.08,
    emoji: () => '🐕',
    speed: () => 60 + Math.random() * 50,
    fontPx: 34,
  },
  bike: {
    weight: 0.06,
    emoji: () => '🏍️',
    speed: () => 130 + Math.random() * 40,
    fontPx: 42,
  },
};

const MAX_PEDS = 12;
const SPAWN_EVERY_MS = 750;
const SPAWN_MARGIN = 110;
const SIDESTEP_CHECK_MS = 400;

/** How busy the footpath is, by road class (residential lanes are packed). */
const DENSITY: Record<string, number> = {
  primary: 0.5,
  secondary: 0.55,
  tertiary: 0.6,
  residential: 0.85,
  living_street: 0.9,
};

export interface PedSpawnContext {
  /** Footpath columns at this y, or null when the footpath is absent/flooded. */
  footpathCols: [number, number] | null;
  density: number;
  /** School zones etc. crowd the footpath and skew spawns toward kids. */
  densityMultiplier?: number;
  kids?: boolean;
  cellAt: (row: number, col: number) => Cell | undefined;
  rowAtY: (y: number) => number;
}

export function pedDensityFor(roadClass: string): number {
  return DENSITY[roadClass] ?? 0.6;
}

export class PedestrianSystem {
  readonly peds: Pedestrian[] = [];
  private spawnTimer = 0;

  constructor(
    private scene: Phaser.Scene,
    private pool: SpritePool,
    private worldHeight: number,
    private contextAt: (y: number) => PedSpawnContext,
    private colCenterX: (col: number) => number,
  ) {}

  update(deltaMs: number, cameraTopY: number, cameraBottomY: number): void {
    this.spawnTimer += deltaMs;
    if (this.spawnTimer >= SPAWN_EVERY_MS) {
      this.spawnTimer = 0;
      this.trySpawn(cameraTopY);
    }

    const dt = deltaMs / 1000;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      p.obj.y += p.speed * dt;
      if (p.obj.y > cameraBottomY + SPAWN_MARGIN * 2 || p.obj.y > this.worldHeight + TILE) {
        this.pool.release(p.obj);
        this.peds.splice(i, 1);
        continue;
      }
      // Last per-ped step: may splice this ped out, so nothing follows it.
      this.maybeSidestep(p, deltaMs);
    }
  }

  /** Walk around blocked cells instead of ghosting through hawker stalls. */
  private maybeSidestep(p: Pedestrian, deltaMs: number): void {
    p.sidestepCooldownMs -= deltaMs;
    if (p.sidestepCooldownMs > 0 || p.speed === 0) return;
    p.sidestepCooldownMs = SIDESTEP_CHECK_MS;
    const ctx = this.contextAt(p.obj.y);
    const nextRow = ctx.rowAtY(p.obj.y + TILE);
    const ahead = ctx.footpathCols ? ctx.cellAt(nextRow, p.col) : undefined;
    // No footpath at all here, or the way ahead is blocked with nowhere to go:
    // the ped ducks into a shop instead of ghosting through the obstruction.
    if (!ctx.footpathCols) {
      this.despawn(p);
      return;
    }
    if (ahead && !ahead.passable) {
      const other = ctx.footpathCols[0] === p.col ? ctx.footpathCols[1] : ctx.footpathCols[0];
      const otherCell = ctx.cellAt(nextRow, other);
      if (otherCell?.passable) {
        p.col = other;
        this.scene.tweens.add({ targets: p.obj, x: this.colCenterX(other), duration: 150 });
      } else {
        this.despawn(p);
      }
    }
  }

  /** Fade out and remove — used when a ped has nowhere left to walk. */
  private despawn(p: Pedestrian): void {
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
    this.scene.tweens.add({
      targets: p.obj,
      alpha: 0,
      duration: 250,
      onComplete: () => this.pool.release(p.obj),
    });
  }

  /** Remove peds swallowed by the crowd/pressure line (they join it). */
  despawnBelowY(y: number): void {
    for (let i = this.peds.length - 1; i >= 0; i--) {
      if (this.peds[i].obj.y > y) this.despawn(this.peds[i]);
    }
  }

  private trySpawn(cameraTopY: number): void {
    if (this.peds.length >= MAX_PEDS) return;
    const y = cameraTopY - SPAWN_MARGIN;
    if (y < 0 || y > this.worldHeight) return;
    const ctx = this.contextAt(y);
    if (!ctx.footpathCols) return;
    if (Math.random() > Math.min(1, ctx.density * (ctx.densityMultiplier ?? 1))) return;

    const col = ctx.footpathCols[Math.random() < 0.5 ? 0 : 1];
    const cell = ctx.cellAt(ctx.rowAtY(y), col);
    if (!cell || !cell.passable || cell.kind !== 'footpath') return;
    for (const p of this.peds) {
      if (p.col === col && Math.abs(p.obj.y - y) < TILE * 1.5) return;
    }
    this.spawnAt(y, col, ctx.kids ?? false);
  }

  private spawnAt(y: number, col: number, kids: boolean): void {
    const kind = pickKind();
    const cfg = KINDS[kind];
    let emoji = cfg.emoji(Math.random);
    let speed = cfg.speed();
    if (kids && kind === 'walker' && Math.random() < 0.7) {
      emoji = KID_EMOJI[Math.floor(Math.random() * KID_EMOJI.length)];
      speed *= 1.2; // kids dart
    }
    const obj = this.pool.obtain(emoji, cfg.fontPx, this.colCenterX(col), y).setDepth(6);
    this.peds.push({ obj, col, speed, kind, sidestepCooldownMs: 0 });
  }

  /** A crowd burst (temple letting out): several walkers at once near y. */
  burst(y: number, count: number): void {
    const ctx = this.contextAt(y);
    if (!ctx.footpathCols) return;
    for (let i = 0; i < count && this.peds.length < MAX_PEDS + 4; i++) {
      const col = ctx.footpathCols[i % 2];
      const yy = y - i * TILE * 0.9;
      const cell = ctx.cellAt(ctx.rowAtY(yy), col);
      if (!cell || !cell.passable || cell.kind !== 'footpath') continue;
      this.spawnAt(yy, col, false);
    }
  }

  destroy(): void {
    for (const p of this.peds) this.pool.release(p.obj);
    this.peds.length = 0;
  }
}

function pickKind(): PedKind {
  let roll = Math.random();
  for (const [kind, cfg] of Object.entries(KINDS) as [PedKind, KindConfig][]) {
    roll -= cfg.weight;
    if (roll <= 0) return kind;
  }
  return 'walker';
}
