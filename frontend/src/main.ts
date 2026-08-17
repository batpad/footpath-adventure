import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, RES } from './game/constants';
import { BootScene } from './game/scenes/BootScene';
import { MenuScene } from './game/scenes/MenuScene';
import { GameScene } from './game/scenes/GameScene';
import { HUDScene } from './game/scenes/HUDScene';
import { ResultsScene } from './game/scenes/ResultsScene';

// Phaser 3.8x ignores the game-config `resolution` for Text (a style
// resolution of 0 is forced to 1), so re-register the `text` factory with a
// device-resolution default — every scene's add.text() rasterizes crisply on
// HiDPI screens without touching each call site.
Phaser.GameObjects.GameObjectFactory.remove('text');
Phaser.GameObjects.GameObjectFactory.register(
  'text',
  function (
    this: Phaser.GameObjects.GameObjectFactory,
    x: number,
    y: number,
    text: string | string[],
    style?: Phaser.Types.GameObjects.Text.TextStyle,
  ) {
    const obj = new Phaser.GameObjects.Text(this.scene, x, y, text, { resolution: RES, ...style });
    this.displayList.add(obj);
    return obj;
  },
);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a1a2e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Framebuffer at device resolution; cameras zoom by RES so all scene
    // code keeps working in logical 480x800 coordinates.
    width: GAME_WIDTH * RES,
    height: GAME_HEIGHT * RES,
  },
  scene: [BootScene, MenuScene, GameScene, HUDScene, ResultsScene],
});
