/**
 * A baraat — wedding procession with band, dancers, and the horse — sweeps
 * down the full width of the road. For those few seconds the footpath is the
 * only way through, right where it's often at its worst.
 */
import Phaser from 'phaser';
import { TILE } from './constants';

const MEMBER_EMOJI = ['🥁', '🎺', '💃', '🕺', '🎉', '🐎', '🕺', '💃'];
const SPEED = 38;
const CHECK_EVERY_MS = 6000;
const SPAWN_CHANCE = 0.28;
const MAX_PER_RUN = 2;
const ROWS = 6;
const SPAWN_MARGIN = 200;

export interface ProcessionMember {
  obj: Phaser.GameObjects.Text;
  col: number;
}

export class ProcessionSystem {
  readonly members: ProcessionMember[] = [];
  private checkTimer = 0;
  private spawned = 0;
  /** Fires once when a procession enters, so the scene can toast/sound it. */
  onSpawn: (() => void) | null = null;

  constructor(
    private scene: Phaser.Scene,
    private roadColsAt: (y: number) => [number, number, number] | null,
    private colCenterX: (col: number) => number,
  ) {}

  update(deltaMs: number, cameraTopY: number, cameraBottomY: number): void {
    this.checkTimer += deltaMs;
    if (this.checkTimer >= CHECK_EVERY_MS) {
      this.checkTimer = 0;
      if (
        this.spawned < MAX_PER_RUN &&
        this.members.length === 0 &&
        Math.random() < SPAWN_CHANCE
      ) {
        this.spawn(cameraTopY);
      }
    }

    const dy = (SPEED * deltaMs) / 1000;
    for (let i = this.members.length - 1; i >= 0; i--) {
      const m = this.members[i];
      m.obj.y += dy;
      if (m.obj.y > cameraBottomY + SPAWN_MARGIN) {
        m.obj.destroy();
        this.members.splice(i, 1);
      }
    }
  }

  private spawn(cameraTopY: number): void {
    const yTop = cameraTopY - SPAWN_MARGIN;
    const roadCols = this.roadColsAt(yTop);
    if (!roadCols) return;
    this.spawned++;
    for (let r = 0; r < ROWS; r++) {
      for (const col of roadCols) {
        if (Math.random() < 0.25) continue; // gaps so it breathes
        const jitterX = (Math.random() - 0.5) * TILE * 0.4;
        const obj = this.scene.add
          .text(
            this.colCenterX(col) + jitterX,
            yTop - r * TILE * 0.9,
            MEMBER_EMOJI[Math.floor(Math.random() * MEMBER_EMOJI.length)],
            { fontSize: '38px' },
          )
          .setOrigin(0.5)
          .setDepth(6);
        this.members.push({ obj, col });
      }
    }
    this.onSpawn?.();
  }

  destroy(): void {
    for (const m of this.members) m.obj.destroy();
    this.members.length = 0;
  }
}
