/**
 * Cross-street traffic at junction crossing bands. Vehicles sweep laterally
 * across the corridor; signal crossings alternate walk/traffic phases, zebra
 * crossings slow vehicles down, unmarked crossings never stop flowing.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, TILE, VEHICLE_EMOJI } from './constants';

export type CrossingType = 'signals' | 'zebra' | 'unmarked';

export interface CrossingBand {
  startRow: number;
  rows: number;
  type: CrossingType;
}

export interface CrossVehicle {
  obj: Phaser.GameObjects.Text;
  row: number;
  dirX: 1 | -1;
  speed: number;
  kind: string;
}

const SPEED: Record<CrossingType, number> = { signals: 270, zebra: 170, unmarked: 240 };
const SPAWN_EVERY_MS: Record<CrossingType, number> = {
  signals: 850,
  zebra: 1300,
  unmarked: 950,
};
/** Full signal cycle; first half is the walk phase. */
const SIGNAL_CYCLE_MS = 8000;
const VIEW_MARGIN = 240;
const MAX_VEHICLES = 12;

const KIND_WEIGHTS: [string, number][] = [
  ['car', 0.45],
  ['rickshaw', 0.35],
  ['bike', 0.2],
];

export class CrossTrafficSystem {
  readonly vehicles: CrossVehicle[] = [];
  private timers: number[];
  private indicators: (Phaser.GameObjects.Text | null)[];
  private elapsedMs = 0;

  constructor(
    private scene: Phaser.Scene,
    private bands: CrossingBand[],
    private rowCenterY: (row: number) => number,
  ) {
    this.timers = bands.map(() => 0);
    this.indicators = bands.map((band) => {
      if (band.type !== 'signals') return null;
      // Signal head beside the band, above the last row the player enters.
      return scene.add
        .text(GAME_WIDTH - 26, this.rowCenterY(band.startRow + band.rows - 1) - TILE * 0.7, '✋', {
          fontSize: '24px',
          backgroundColor: '#101020',
          padding: { x: 4, y: 3 },
        })
        .setOrigin(0.5)
        .setDepth(8);
    });
  }

  /** True while signal crossings hold traffic for pedestrians. */
  walkPhase(): boolean {
    return this.elapsedMs % SIGNAL_CYCLE_MS < SIGNAL_CYCLE_MS / 2;
  }

  update(deltaMs: number, cameraTopY: number, cameraBottomY: number): void {
    this.elapsedMs += deltaMs;
    const walk = this.walkPhase();

    this.bands.forEach((band, i) => {
      const y = this.rowCenterY(band.startRow + 1);
      if (y < cameraTopY - VIEW_MARGIN || y > cameraBottomY + VIEW_MARGIN) return;
      this.indicators[i]?.setText(walk ? '🚶' : '✋');
      if (band.type === 'signals' && walk) return; // traffic held
      this.timers[i] += deltaMs;
      if (this.timers[i] >= SPAWN_EVERY_MS[band.type]) {
        this.timers[i] = 0;
        this.trySpawn(band);
      }
    });

    const dt = deltaMs / 1000;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      v.obj.x += v.dirX * v.speed * dt;
      if (v.obj.x < -TILE || v.obj.x > GAME_WIDTH + TILE) {
        v.obj.destroy();
        this.vehicles.splice(i, 1);
      }
    }
  }

  private trySpawn(band: CrossingBand): void {
    if (this.vehicles.length >= MAX_VEHICLES) return;
    const rowOffset = Math.floor(Math.random() * band.rows);
    const row = band.startRow + rowOffset;
    // Alternate direction per row so the band reads as a two-way street.
    const dirX: 1 | -1 = rowOffset % 2 === 0 ? 1 : -1;
    const entryX = dirX === 1 ? -TILE / 2 : GAME_WIDTH + TILE / 2;
    for (const v of this.vehicles) {
      if (v.row === row && Math.abs(v.obj.x - entryX) < TILE * 2) return;
    }
    const kind = pickKind();
    const obj = this.scene.add
      .text(entryX, this.rowCenterY(row), VEHICLE_EMOJI[kind], { fontSize: '40px' })
      .setOrigin(0.5)
      .setDepth(5);
    obj.setFlipX(dirX === 1); // vehicle emoji face left by default
    this.vehicles.push({
      obj,
      row,
      dirX,
      speed: SPEED[band.type] * (0.85 + Math.random() * 0.3),
      kind,
    });
  }

  destroy(): void {
    for (const v of this.vehicles) v.obj.destroy();
    this.vehicles.length = 0;
    for (const ind of this.indicators) ind?.destroy();
  }
}

function pickKind(): string {
  let roll = Math.random();
  for (const [kind, w] of KIND_WEIGHTS) {
    roll -= w;
    if (roll <= 0) return kind;
  }
  return 'car';
}
