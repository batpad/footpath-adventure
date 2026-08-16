/**
 * Emoji → shared GPU texture, rasterized once per (emoji, size) for the whole
 * game session. Spawning an entity then costs a texture lookup instead of a
 * canvas rasterization, and identical entities batch on the GPU.
 *
 * Textures live in the game-level TextureManager (DynamicTexture), so they
 * survive scene restarts ("walk again").
 */
import Phaser from 'phaser';

export function emojiTexture(scene: Phaser.Scene, emoji: string, fontPx: number): string {
  const key = `emoji:${emoji}:${fontPx}`;
  if (scene.textures.exists(key)) return key;

  const text = scene.make.text(
    { text: emoji, style: { fontSize: `${fontPx}px` } },
    false, // never added to the display list
  );
  const w = Math.max(2, Math.ceil(text.width));
  const h = Math.max(2, Math.ceil(text.height));
  const dt = scene.textures.addDynamicTexture(key, w, h);
  if (dt) {
    dt.draw(text, 0, 0);
  }
  text.destroy();
  return key;
}
