/**
 * Object pools for the entities that spawn and despawn constantly.
 * obtain() recycles a hidden instance instead of allocating; release()
 * hides it instead of destroying — no GC churn mid-game.
 */
import Phaser from 'phaser';
import { emojiTexture } from './emojiAtlas';
import { RES, withRes } from './constants';

export class SpritePool {
  private free: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene) {}

  obtain(emoji: string, fontPx: number, x: number, y: number): Phaser.GameObjects.Image {
    const key = emojiTexture(this.scene, emoji, fontPx);
    let img = this.free.pop();
    if (img) {
      img.setTexture(key);
      img.setActive(true).setVisible(true);
    } else {
      img = this.scene.add.image(0, 0, key);
    }
    img
      .setPosition(x, y)
      .setOrigin(0.5)
      .setAlpha(1)
      .setAngle(0)
      .setFlip(false, false)
      .setScale(1 / RES)
      .setDepth(0);
    return img;
  }

  release(img: Phaser.GameObjects.Image): void {
    this.scene.tweens.killTweensOf(img);
    img.setVisible(false).setActive(false);
    this.free.push(img);
  }
}

/**
 * Pool of Text labels for transient popups (honks, score pops). setText still
 * rasterizes, but only once per event on a recycled object — no allocation.
 */
export class LabelPool {
  private free: Phaser.GameObjects.Text[] = [];

  constructor(
    private scene: Phaser.Scene,
    private style: Phaser.Types.GameObjects.Text.TextStyle,
  ) {}

  obtain(text: string, x: number, y: number): Phaser.GameObjects.Text {
    let label = this.free.pop();
    if (label) {
      label.setText(text);
      label.setActive(true).setVisible(true);
    } else {
      label = this.scene.add.text(0, 0, text, withRes(this.style));
    }
    label.setPosition(x, y).setOrigin(0.5).setAlpha(1);
    return label;
  }

  release(label: Phaser.GameObjects.Text): void {
    this.scene.tweens.killTweensOf(label);
    label.setVisible(false).setActive(false);
    this.free.push(label);
  }
}
