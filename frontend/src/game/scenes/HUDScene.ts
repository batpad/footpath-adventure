import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, MAX_HEALTH } from '../constants';
import type { LevelSpec } from '../../level/types';
import { sfx } from '../sound';

type MinimapSpec = LevelSpec['minimap'];

interface HudState {
  health: number;
  score: number;
  distanceM: number;
  totalM: number;
  streetName: string;
  mode: 'dry' | 'monsoon';
  timeLeftS: number;
  onFootpath: boolean;
}

export class HUDScene extends Phaser.Scene {
  private healthBar!: Phaser.GameObjects.Rectangle;
  private scoreText!: Phaser.GameObjects.Text;
  private distanceText!: Phaser.GameObjects.Text;
  private streetText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private laneBadge!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private toastTween: Phaser.Tweens.Tween | null = null;
  /** Route points projected into minimap-panel pixels. */
  private mapPoints: Phaser.Math.Vector2[] = [];
  /** Cumulative distance along mapPoints, normalised to 0..1. */
  private mapCumulative: number[] = [];
  private mapDot: Phaser.GameObjects.Arc | null = null;

  constructor() {
    super('HUD');
  }

  create(data: { minimap?: MinimapSpec }): void {
    const pad = 12;
    this.add.rectangle(GAME_WIDTH / 2, 30, GAME_WIDTH, 60, 0x101020, 0.75).setDepth(0);

    this.add.text(pad, 10, '❤️', { fontSize: '18px' });
    this.add.rectangle(pad + 30, 20, 120, 14, 0x333344).setOrigin(0, 0.5);
    this.healthBar = this.add.rectangle(pad + 30, 20, 120, 14, 0x4caf50).setOrigin(0, 0.5);

    this.scoreText = this.add
      .text(GAME_WIDTH - pad, 10, '0', {
        fontSize: '22px',
        color: '#f4d35e',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0);

    this.distanceText = this.add
      .text(pad, 36, '', { fontSize: '14px', color: '#cfcfe0' })
      .setOrigin(0, 0);

    // The commute clock: the loudest thing on screen.
    this.timerText = this.add
      .text(GAME_WIDTH / 2, 6, '', { fontSize: '26px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5, 0);

    this.streetText = this.add
      .text(GAME_WIDTH / 2, 38, '', { fontSize: '14px', color: '#8fd18f' })
      .setOrigin(0.5, 0);

    this.laneBadge = this.add
      .text(GAME_WIDTH - pad, 38, '', { fontSize: '13px', color: '#9a9ab5' })
      .setOrigin(1, 0);

    if (data.minimap) this.buildMinimap(data.minimap);

    const mute = this.add
      .text(10, GAME_HEIGHT - 10, sfx.muted ? '🔇' : '🔊', { fontSize: '24px' })
      .setOrigin(0, 1)
      .setAlpha(0.7)
      .setInteractive({ useHandCursor: true });
    mute.on('pointerup', () => {
      mute.setText(sfx.toggleMute() ? '🔇' : '🔊');
    });

    const report = this.add
      .text(GAME_WIDTH - 10, GAME_HEIGHT - 10, '📸 report', {
        fontSize: '15px',
        color: '#1a1a2e',
        backgroundColor: '#f4d35e',
        padding: { x: 8, y: 5 },
      })
      .setOrigin(1, 1)
      .setAlpha(0.85)
      .setInteractive({ useHandCursor: true });
    report.on('pointerup', () => this.game.events.emit('report:open'));

    this.toast = this.add
      .text(GAME_WIDTH / 2, 110, '', {
        fontSize: '18px',
        color: '#ffffff',
        backgroundColor: '#b3362b',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.game.events.on('hud:update', this.onUpdate, this);
    this.game.events.on('hud:toast', this.onToast, this);
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('hud:update', this.onUpdate, this);
      this.game.events.off('hud:toast', this.onToast, this);
    });
  }

  /**
   * Schematic map of the real route (true OSM geometry from the level spec)
   * with a moving you-are-here dot. Real map tiles arrive with the route
   * picker in M3; the polyline already is the real street shape.
   */
  private buildMinimap(minimap: MinimapSpec): void {
    if (minimap.polyline.length < 2) return;
    const W = 112;
    const H = 132;
    const PAD = 14;
    const x0 = GAME_WIDTH - W - 10;
    const y0 = 72;

    const panel = this.add.rectangle(x0, y0, W, H, 0x101020, 0.72).setOrigin(0, 0);
    panel.setStrokeStyle(1, 0x44445c);

    // Equirectangular projection, north up.
    const lats = minimap.polyline.map((p) => p[1]);
    const lngs = minimap.polyline.map((p) => p[0]);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const xs = lngs.map((lng) => lng * kx);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const scale = Math.min(
      (W - PAD * 2) / Math.max(1e-9, maxX - minX),
      (H - PAD * 2) / Math.max(1e-9, maxLat - minLat),
    );
    const offX = x0 + (W - (maxX - minX) * scale) / 2;
    const offY = y0 + (H - (maxLat - minLat) * scale) / 2;
    this.mapPoints = minimap.polyline.map(
      (p, i) =>
        new Phaser.Math.Vector2(
          offX + (xs[i] - minX) * scale,
          offY + (maxLat - p[1]) * scale,
        ),
    );

    let total = 0;
    const cum = [0];
    for (let i = 1; i < this.mapPoints.length; i++) {
      total += this.mapPoints[i].distance(this.mapPoints[i - 1]);
      cum.push(total);
    }
    this.mapCumulative = cum.map((d) => (total > 0 ? d / total : 0));

    const g = this.add.graphics();
    g.lineStyle(3, 0xf4d35e, 0.95);
    g.strokePoints(this.mapPoints, false);
    const start = this.mapPoints[0];
    const end = this.mapPoints[this.mapPoints.length - 1];
    this.add.circle(start.x, start.y, 4, 0x4caf50);
    this.add.text(end.x, end.y, '🏁', { fontSize: '12px' }).setOrigin(0.5);

    this.mapDot = this.add.circle(start.x, start.y, 4.5, 0xffffff);
    this.mapDot.setStrokeStyle(2, 0xd0392b);
    this.tweens.add({ targets: this.mapDot, scale: 1.5, yoyo: true, repeat: -1, duration: 450 });
  }

  private updateMapDot(progress: number): void {
    if (!this.mapDot || this.mapPoints.length < 2) return;
    const p = Phaser.Math.Clamp(progress, 0, 1);
    let i = 1;
    while (i < this.mapCumulative.length - 1 && this.mapCumulative[i] < p) i++;
    const p0 = this.mapCumulative[i - 1];
    const p1 = this.mapCumulative[i];
    const t = p1 > p0 ? (p - p0) / (p1 - p0) : 0;
    const a = this.mapPoints[i - 1];
    const b = this.mapPoints[i];
    this.mapDot.setPosition(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }

  /** setText re-rasterizes a canvas — only touch Texts whose value changed. */
  private setIfChanged(text: Phaser.GameObjects.Text, value: string): void {
    if (text.text !== value) text.setText(value);
  }

  private onUpdate(s: HudState): void {
    const frac = Phaser.Math.Clamp(s.health / MAX_HEALTH, 0, 1);
    this.healthBar.width = 120 * frac;
    this.healthBar.fillColor = frac > 0.5 ? 0x4caf50 : frac > 0.25 ? 0xe0a030 : 0xd0392b;
    this.setIfChanged(this.scoreText, String(s.score));
    this.setIfChanged(
      this.distanceText,
      `${s.distanceM} / ${s.totalM} m ${s.mode === 'monsoon' ? '🌧️' : ''}`,
    );
    const m = Math.floor(s.timeLeftS / 60);
    const sec = String(s.timeLeftS % 60).padStart(2, '0');
    this.setIfChanged(this.timerText, `⏰ ${m}:${sec}`);
    const timerColor = s.timeLeftS <= 15 ? '#ff5544' : s.timeLeftS <= 30 ? '#f4a63e' : '#ffffff';
    if (this.timerText.style.color !== timerColor) this.timerText.setColor(timerColor);
    this.setIfChanged(this.streetText, s.streetName);
    const lane = s.onFootpath ? 'on footpath ×1.5' : 'on road';
    if (this.laneBadge.text !== lane) {
      this.laneBadge.setText(lane);
      this.laneBadge.setColor(s.onFootpath ? '#8fd18f' : '#e0a030');
    }
    this.updateMapDot(s.totalM > 0 ? s.distanceM / s.totalM : 0);
  }

  private onToast(message: string): void {
    this.toast.setText(message).setAlpha(1);
    this.toastTween?.stop();
    this.toastTween = this.tweens.add({
      targets: this.toast,
      alpha: 0,
      delay: 1100,
      duration: 400,
    });
  }
}
