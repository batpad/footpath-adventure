import Phaser from 'phaser';

/** No binary assets in M1 (everything is shapes + emoji); go straight to menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('Menu');
  }
}
