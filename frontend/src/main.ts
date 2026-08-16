import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './game/constants';
import { BootScene } from './game/scenes/BootScene';
import { MenuScene } from './game/scenes/MenuScene';
import { GameScene } from './game/scenes/GameScene';
import { HUDScene } from './game/scenes/HUDScene';
import { ResultsScene } from './game/scenes/ResultsScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a1a2e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  scene: [BootScene, MenuScene, GameScene, HUDScene, ResultsScene],
});
