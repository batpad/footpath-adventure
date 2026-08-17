import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, RES } from '../constants';
import type { Mode } from '../../level/types';
import { sampleLevel } from '../../level/sample-level';
import { sfx } from '../sound';
import { pickRoute } from '../../ui/routeSelect';

export class MenuScene extends Phaser.Scene {
  private mode: Mode = 'dry';
  private modeButtons: Record<Mode, Phaser.GameObjects.Text> | null = null;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.cameras.main.setZoom(RES).centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    const cx = GAME_WIDTH / 2;
    this.add
      .text(cx, GAME_HEIGHT * 0.16, 'FOOTPATH\nADVENTURE', {
        fontFamily: 'Georgia, serif',
        fontSize: '52px',
        color: '#f4d35e',
        align: 'center',
        stroke: '#1a1a2e',
        strokeThickness: 8,
      })
      .setOrigin(0.5);

    this.add
      .text(cx, GAME_HEIGHT * 0.29, 'Office at 9. The street has other plans.\nFootpath ya road? Choose fast.', {
        fontFamily: 'sans-serif',
        fontSize: '17px',
        color: '#cfcfe0',
        align: 'center',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, GAME_HEIGHT * 0.40, `${sampleLevel.minimap.origin_name} → ${sampleLevel.minimap.dest_name}`, {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        color: '#8fd18f',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, GAME_HEIGHT * 0.48, 'Weather', {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        color: '#8888a0',
      })
      .setOrigin(0.5);

    const dry = this.makeModeButton(cx - 85, GAME_HEIGHT * 0.54, '☀️ Dry', 'dry');
    const wet = this.makeModeButton(cx + 85, GAME_HEIGHT * 0.54, '🌧️ Monsoon', 'monsoon');
    this.modeButtons = { dry, monsoon: wet };
    this.refreshModeButtons();

    const realRoute = this.add
      .text(cx, GAME_HEIGHT * 0.64, '🗺  PICK A REAL ROUTE', {
        fontFamily: 'sans-serif',
        fontSize: '24px',
        color: '#1a1a2e',
        backgroundColor: '#f4d35e',
        padding: { x: 20, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    realRoute.on('pointerup', () => this.pickRealRoute());

    const start = this.add
      .text(cx, GAME_HEIGHT * 0.73, '▶  Quick play: Station → Hill Road', {
        fontFamily: 'sans-serif',
        fontSize: '18px',
        color: '#cfcfe0',
        backgroundColor: '#2a2a45',
        padding: { x: 16, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    start.on('pointerup', () => this.startGame());
    // on(), not once(): cancelling the route picker must not eat the key.
    let started = false;
    const startOnce = () => {
      if (!started) {
        started = true;
        this.startGame();
      }
    };
    this.input.keyboard?.on('keydown-ENTER', startOnce);
    this.input.keyboard?.on('keydown-SPACE', startOnce);

    this.add
      .text(
        cx,
        GAME_HEIGHT * 0.82,
        'Arrows / WASD (hold to keep walking) · swipe on mobile\n' +
          'Footpath scores more — but cross the railing only at gaps.\n' +
          "Beat the clock. Don't let the crowd catch you.",
        {
          fontFamily: 'sans-serif',
          fontSize: '14px',
          color: '#9a9ab5',
          align: 'center',
          lineSpacing: 6,
        },
      )
      .setOrigin(0.5);
  }

  private makeModeButton(x: number, y: number, label: string, mode: Mode): Phaser.GameObjects.Text {
    const btn = this.add
      .text(x, y, label, {
        fontFamily: 'sans-serif',
        fontSize: '20px',
        color: '#cfcfe0',
        backgroundColor: '#2a2a45',
        padding: { x: 16, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerup', () => {
      this.mode = mode;
      this.refreshModeButtons();
    });
    return btn;
  }

  private refreshModeButtons(): void {
    if (!this.modeButtons) return;
    for (const [mode, btn] of Object.entries(this.modeButtons)) {
      const active = mode === this.mode;
      btn.setBackgroundColor(active ? '#f4d35e' : '#2a2a45');
      btn.setColor(active ? '#1a1a2e' : '#cfcfe0');
    }
  }

  private startGame(): void {
    sfx.unlock(); // audio context needs a user gesture
    const spec = { ...sampleLevel, mode: this.mode };
    this.scene.start('Game', { spec });
  }

  private pickRealRoute(): void {
    sfx.unlock();
    const kb = this.input.keyboard;
    if (kb) kb.enabled = false; // Enter must not quick-start behind the map
    void pickRoute(this.mode).then((spec) => {
      if (kb) kb.enabled = true;
      if (spec) this.scene.start('Game', { spec });
    });
  }
}
