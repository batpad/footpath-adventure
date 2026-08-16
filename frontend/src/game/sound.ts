/**
 * All SFX are synthesized with raw WebAudio — no audio assets to load.
 * The context unlocks on the first user gesture (menu start).
 */

const MASTER_GAIN = 0.16;
const MUTE_KEY = 'fa-muted';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = localStorage.getItem(MUTE_KEY) === '1';

  /** Create/resume the context. Must be called from a user-gesture handler. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
    return this.muted;
  }

  private beep(
    freq: number,
    startMs: number,
    durMs: number,
    type: OscillatorType = 'square',
    gain = 1,
  ): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + startMs / 1000;
    const t1 = t0 + durMs / 1000;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.01, t1);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t1);
  }

  private noise(durMs: number, filterFreq: number, type: BiquadFilterType, sweepTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const frames = Math.floor((this.ctx.sampleRate * durMs) / 1000);
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(filterFreq, t0);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + durMs / 1000);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9, t0);
    g.gain.exponentialRampToValueAtTime(0.01, t0 + durMs / 1000);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  }

  honk(wrongSide = false): void {
    if (wrongSide) {
      this.beep(340, 0, 130);
      this.beep(340, 170, 130);
      this.beep(300, 340, 220);
    } else {
      this.beep(470, 0, 110);
      this.beep(470, 150, 160);
    }
  }

  thud(): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.16);
    g.gain.setValueAtTime(1.4, t0);
    g.gain.exponentialRampToValueAtTime(0.01, t0 + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.2);
    this.noise(70, 900, 'lowpass');
  }

  splash(): void {
    this.noise(280, 750, 'lowpass');
  }

  nearMiss(): void {
    this.noise(180, 350, 'bandpass', 2600);
  }

  tick(): void {
    this.beep(1150, 0, 45, 'square', 0.5);
  }

  slurp(): void {
    this.beep(320, 0, 70, 'sine', 0.7);
    this.beep(250, 90, 110, 'sine', 0.7);
    this.noise(90, 1400, 'bandpass');
    this.beep(500, 260, 140, 'triangle', 0.5); // satisfied "aah"
  }

  bell(): void {
    // Procession dhol-ish thump + bell.
    this.beep(196, 0, 90, 'sine', 1.2);
    this.beep(1568, 30, 200, 'triangle', 0.4);
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.beep(f, i * 130, 160, 'triangle', 0.8));
  }

  lose(): void {
    [392, 330, 262].forEach((f, i) => this.beep(f, i * 160, 220, 'sawtooth', 0.5));
  }
}

export const sfx = new Sfx();
