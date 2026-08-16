import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import type { RunStats } from './GameScene';
import { openReportForm } from '../../ui/reportForm';

/** Blocked-footpath share → walkability letter grade for the real route. */
function walkabilityGrade(blockedPct: number): string {
  if (blockedPct < 10) return 'A';
  if (blockedPct < 20) return 'B';
  if (blockedPct < 35) return 'C';
  if (blockedPct < 50) return 'D';
  return 'F';
}

export class ResultsScene extends Phaser.Scene {
  constructor() {
    super('Results');
  }

  create(stats: RunStats): void {
    const cx = GAME_WIDTH / 2;
    // Opaque backdrop — the world behind must never bleed into the stats.
    this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x1a1a2e, 1);

    const title =
      stats.outcome === 'finished'
        ? '🏁 Made it to work!'
        : stats.outcome === 'late'
          ? '⏰ Late for work…'
          : '💥 The street won…';
    this.add
      .text(cx, GAME_HEIGHT * 0.14, title, {
        fontSize: '36px',
        color: stats.outcome === 'finished' ? '#8fd18f' : '#e07060',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, GAME_HEIGHT * 0.21, stats.routeName, {
        fontSize: '15px',
        color: '#9a9ab5',
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 40 },
      })
      .setOrigin(0.5);

    const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const lines = [
      `Score            ${stats.score}`,
      `Distance         ${stats.distanceM} of ${stats.totalM} m`,
      stats.outcome === 'finished'
        ? `Time to spare    ${mmss(stats.timeLeftS)}  (+${stats.timeLeftS * 5} pts)`
        : stats.outcome === 'late'
          ? `Time             ran out ⏰`
          : `Time left        ${mmss(stats.timeLeftS)}`,
      `Damage taken     ${stats.damageTaken} HP`,
      `Footpath used    ${stats.footpathUsePct}% of the way`,
      `Weather          ${stats.mode === 'monsoon' ? 'Monsoon 🌧️' : 'Dry ☀️'}`,
    ];
    this.add
      .text(cx, GAME_HEIGHT * 0.36, lines.join('\n'), {
        fontFamily: 'Menlo, monospace',
        fontSize: '17px',
        color: '#e8e3d0',
        lineSpacing: 10,
      })
      .setOrigin(0.5);

    const grade = walkabilityGrade(stats.footpathBlockedPct);
    this.add
      .text(
        cx,
        GAME_HEIGHT * 0.54,
        `Walkability grade: ${grade}\n${stats.footpathBlockedPct}% of this route's footpath was blocked or missing`,
        {
          fontSize: '16px',
          color: '#f4d35e',
          align: 'center',
          lineSpacing: 8,
          wordWrap: { width: GAME_WIDTH - 40 },
        },
      )
      .setOrigin(0.5);

    this.add
      .text(cx, GAME_HEIGHT * 0.62, 'Walked this street for real? Tell us what it’s like:', {
        fontSize: '14px',
        color: '#9a9ab5',
      })
      .setOrigin(0.5);
    const reportBtn = this.add
      .text(cx, GAME_HEIGHT * 0.675, '📸  REPORT WHAT YOU SAW', {
        fontSize: '18px',
        color: '#e8e3d0',
        backgroundColor: '#2a5a3a',
        padding: { x: 16, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    reportBtn.on('pointerup', () => {
      // Fully mute the game's keyboard while typing in the form — otherwise
      // Enter/Space in the note field would restart the game underneath.
      const kb = this.input.keyboard;
      if (kb) {
        kb.enabled = false;
        kb.disableGlobalCapture();
      }
      void openReportForm({
        levelToken: stats.levelToken,
        distanceM: stats.distanceM,
        lane: 'footpath',
        placeHint: stats.routeName,
      }).then(() => {
        if (kb) {
          kb.enabled = true;
          kb.enableGlobalCapture();
        }
      });
    });

    const again = this.add
      .text(cx, GAME_HEIGHT * 0.78, '↻  WALK AGAIN', {
        fontSize: '24px',
        color: '#1a1a2e',
        backgroundColor: '#f4d35e',
        padding: { x: 20, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    again.on('pointerup', () => this.scene.start('Menu'));
    this.input.keyboard?.once('keydown-ENTER', () => this.scene.start('Menu'));
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.start('Menu'));
  }
}
