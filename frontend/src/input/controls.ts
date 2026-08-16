/**
 * Unified input: keyboard (arrows/WASD) and touch swipes both emit StepIntent
 * events, so the game logic never knows which device it is running on.
 */
import Phaser from 'phaser';

export type StepIntent = 'up' | 'down' | 'left' | 'right';

const SWIPE_THRESHOLD_PX = 24;

export class Controls {
  private listeners: ((intent: StepIntent) => void)[] = [];

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (kb) {
      const bind = (keys: string[], intent: StepIntent) => {
        for (const k of keys) {
          // emitOnRepeat: holding a key keeps walking — essential for pace.
          kb.addKey(k, true, true).on('down', () => this.emit(intent));
        }
      };
      bind(['UP', 'W'], 'up');
      bind(['DOWN', 'S'], 'down');
      bind(['LEFT', 'A'], 'left');
      bind(['RIGHT', 'D'], 'right');
    }

    scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const dx = pointer.upX - pointer.downX;
      const dy = pointer.upY - pointer.downY;
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX && Math.abs(dy) < SWIPE_THRESHOLD_PX) {
        this.emit('up'); // tap = step forward
      } else if (Math.abs(dx) > Math.abs(dy)) {
        this.emit(dx > 0 ? 'right' : 'left');
      } else {
        this.emit(dy > 0 ? 'down' : 'up');
      }
    });
  }

  onStep(fn: (intent: StepIntent) => void): void {
    this.listeners.push(fn);
  }

  private emit(intent: StepIntent): void {
    for (const fn of this.listeners) fn(intent);
  }
}
