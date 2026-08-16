/**
 * Vehicle spawning and movement. Lanes (per segment layout):
 *   road_1 kerbside — slow, same direction as the player
 *   road_2 middle   — fast, same direction
 *   road_3 far lane — oncoming
 * Spawn probability scales with the local segment's traffic_density.
 */
import Phaser from 'phaser';
import { TILE, VEHICLE_EMOJI } from './constants';
import type { VehicleMix } from '../level/types';

export interface Vehicle {
  obj: Phaser.GameObjects.Text;
  col: number;
  /** -1 = moving up (with the player), +1 = oncoming. */
  dirY: -1 | 1;
  speed: number;
  kind: keyof VehicleMix;
  /** Driving against the lane's direction — it happens. */
  wrongSide: boolean;
  honked: boolean;
  nearMissed: boolean;
  splashCooldownMs: number;
}

export interface LaneInfo {
  /** Corridor column for this lane at the given row, or null when off-road. */
  col: number | null;
  density: number;
  mix: VehicleMix;
}

interface LaneConfig {
  lane: 0 | 1 | 2;
  dirY: -1 | 1;
  speed: number;
  spawnEveryMs: number;
}

const LANES: LaneConfig[] = [
  { lane: 0, dirY: -1, speed: 300, spawnEveryMs: 800 },
  { lane: 1, dirY: -1, speed: 480, spawnEveryMs: 700 },
  { lane: 2, dirY: 1, speed: 380, spawnEveryMs: 650 },
];

const MAX_VEHICLES = 30;
const SPAWN_MARGIN = 160;
/** Chance a vehicle comes down the wrong side of its lane. */
const WRONG_SIDE_CHANCE = 0.12;

export class TrafficSystem {
  readonly vehicles: Vehicle[] = [];
  private timers: number[] = LANES.map(() => 0);

  constructor(
    private scene: Phaser.Scene,
    private worldHeight: number,
    private laneInfoAt: (lane: 0 | 1 | 2, y: number) => LaneInfo,
    private colCenterX: (col: number) => number,
  ) {}

  update(deltaMs: number, cameraTopY: number, cameraBottomY: number): void {
    LANES.forEach((cfg, i) => {
      this.timers[i] += deltaMs;
      if (this.timers[i] >= cfg.spawnEveryMs) {
        this.timers[i] = 0;
        this.trySpawn(cfg, cameraTopY, cameraBottomY);
      }
    });

    const dt = deltaMs / 1000;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      v.obj.y += v.dirY * v.speed * dt;
      v.splashCooldownMs = Math.max(0, v.splashCooldownMs - deltaMs);
      const off =
        v.obj.y < cameraTopY - SPAWN_MARGIN * 2 || v.obj.y > cameraBottomY + SPAWN_MARGIN * 2;
      if (off || v.obj.y < -TILE || v.obj.y > this.worldHeight + TILE) {
        v.obj.destroy();
        this.vehicles.splice(i, 1);
      }
    }
  }

  private trySpawn(cfg: LaneConfig, cameraTopY: number, cameraBottomY: number): void {
    if (this.vehicles.length >= MAX_VEHICLES) return;
    const wrongSide = Math.random() < WRONG_SIDE_CHANCE;
    const dirY = wrongSide ? ((-cfg.dirY) as -1 | 1) : cfg.dirY;
    // Up-moving traffic enters from behind the player, oncoming from ahead.
    const y = dirY === -1 ? cameraBottomY + SPAWN_MARGIN : cameraTopY - SPAWN_MARGIN;
    if (y < 0 || y > this.worldHeight) return;
    const info = this.laneInfoAt(cfg.lane, y);
    if (info.col === null) return;
    if (Math.random() > info.density) return;

    // Avoid stacking on a same-lane vehicle just spawned.
    for (const v of this.vehicles) {
      if (v.col === info.col && Math.abs(v.obj.y - y) < TILE * 2) return;
    }

    const kind = wrongSide ? (Math.random() < 0.6 ? 'rickshaw' : 'bike') : pickKind(info.mix);
    const obj = this.scene.add
      .text(this.colCenterX(info.col), y, VEHICLE_EMOJI[kind], { fontSize: '44px' })
      .setOrigin(0.5)
      .setAngle(dirY === -1 ? 90 : -90)
      .setDepth(5);
    this.vehicles.push({
      obj,
      col: info.col,
      dirY,
      speed: cfg.speed * (wrongSide ? 0.55 : 0.85 + Math.random() * 0.3),
      kind,
      wrongSide,
      honked: false,
      nearMissed: false,
      splashCooldownMs: 0,
    });
  }

  destroy(): void {
    for (const v of this.vehicles) v.obj.destroy();
    this.vehicles.length = 0;
  }
}

function pickKind(mix: VehicleMix): keyof VehicleMix {
  const entries = Object.entries(mix) as [keyof VehicleMix, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0) || 1;
  let roll = Math.random() * total;
  for (const [kind, w] of entries) {
    roll -= w;
    if (roll <= 0) return kind;
  }
  return 'car';
}
