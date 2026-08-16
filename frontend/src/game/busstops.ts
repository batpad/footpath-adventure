/**
 * BEST buses pull into the kerbside lane at bus-stop poles (the 🚏 hazards),
 * halt to board passengers, and block that lane while stopped.
 */
import Phaser from 'phaser';
import { TILE } from './constants';
import type { SpritePool } from './pools';

export interface BusStopLocation {
  row: number;
  /** Kerbside road lane column beside the pole. */
  roadCol: number;
}

interface Bus {
  obj: Phaser.GameObjects.Image;
  boarders: Phaser.GameObjects.Image | null;
  col: number;
  state: 'arriving' | 'stopped' | 'leaving';
  stopY: number;
  waitMs: number;
}

const SPAWN_EVERY_MS = 9000;
const WAIT_MS = 3200;
const ARRIVE_SPEED = 300;
const LEAVE_SPEED = 340;
const SPAWN_MARGIN = 140;

export class BusStopSystem {
  readonly buses: Bus[] = [];
  private spawnTimer = SPAWN_EVERY_MS * 0.6; // first bus comes fairly soon

  constructor(
    private pool: SpritePool,
    private stops: BusStopLocation[],
    private rowCenterY: (row: number) => number,
    private colCenterX: (col: number) => number,
  ) {}

  update(deltaMs: number, cameraTopY: number, cameraBottomY: number): void {
    this.spawnTimer += deltaMs;
    if (this.spawnTimer >= SPAWN_EVERY_MS) {
      this.spawnTimer = 0;
      this.trySpawn(cameraTopY, cameraBottomY);
    }

    const dt = deltaMs / 1000;
    for (let i = this.buses.length - 1; i >= 0; i--) {
      const bus = this.buses[i];
      if (bus.state === 'arriving') {
        bus.obj.y -= ARRIVE_SPEED * dt;
        if (bus.obj.y <= bus.stopY) {
          bus.obj.y = bus.stopY;
          bus.state = 'stopped';
          bus.waitMs = WAIT_MS;
          bus.boarders = this.pool
            .obtain('🧍🧍', 20, bus.obj.x - TILE * 0.75, bus.obj.y + TILE * 0.4)
            .setDepth(5);
        }
      } else if (bus.state === 'stopped') {
        bus.waitMs -= deltaMs;
        if (bus.waitMs <= 0) {
          bus.state = 'leaving';
          if (bus.boarders) this.pool.release(bus.boarders);
          bus.boarders = null;
        }
      } else {
        bus.obj.y -= LEAVE_SPEED * dt;
      }
      if (bus.obj.y < cameraTopY - SPAWN_MARGIN * 2) {
        this.pool.release(bus.obj);
        if (bus.boarders) this.pool.release(bus.boarders);
        this.buses.splice(i, 1);
      }
    }
  }

  private trySpawn(cameraTopY: number, cameraBottomY: number): void {
    if (this.buses.length >= 2) return;
    // A stop somewhere in or just ahead of the view.
    const candidates = this.stops.filter((s) => {
      const y = this.rowCenterY(s.row);
      return y > cameraTopY - SPAWN_MARGIN && y < cameraBottomY;
    });
    if (!candidates.length) return;
    const stop = candidates[Math.floor(Math.random() * candidates.length)];
    const obj = this.pool
      .obtain('🚌', 50, this.colCenterX(stop.roadCol), cameraBottomY + SPAWN_MARGIN)
      .setAngle(90)
      .setDepth(5);
    this.buses.push({
      obj,
      boarders: null,
      col: stop.roadCol,
      state: 'arriving',
      stopY: this.rowCenterY(stop.row),
      waitMs: 0,
    });
  }

  destroy(): void {
    for (const bus of this.buses) {
      this.pool.release(bus.obj);
      if (bus.boarders) this.pool.release(bus.boarders);
    }
    this.buses.length = 0;
  }
}
