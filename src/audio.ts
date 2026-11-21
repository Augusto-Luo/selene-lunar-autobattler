import type { GameEvent, UnitKind } from './types';

export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ui: GainNode | null = null;
  private ambience: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private muted = false;

  async ensureStarted() {
    if (!this.context) this.createGraph();
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : 0.62, this.context.currentTime, 0.025);
  }

  get isMuted() { return this.muted; }

  playEvent(event: GameEvent) {
    if (!this.context || this.muted || this.voices > 28) return;
    if (event.type === 'shot') this.weapon(event.kind);
    else if (event.type === 'flame') this.flame();
    else if (event.type === 'explosion') this.explosion(event.heavy ? 1 : 0.65);
    else if (event.type === 'hit' && event.heavy) this.impact(0.45);
    else if (event.type === 'death') this.impact(0.35);
  }

  click(confirm = false) {
    if (!this.context || !this.ui) return;
    this.tone(confirm ? 660 : 480, confirm ? 920 : 560, 0.055, 0.07, this.ui, 'square');
  }

  deploy(valid: boolean) {
    if (!this.context || !this.ui) return;
    this.tone(valid ? 280 : 145, valid ? 510 : 110, 0.09, 0.1, this.ui, valid ? 'triangle' : 'sawtooth');
  }

  result(victory: boolean) {
    if (!this.context || !this.ui) return;
    const notes = victory ? [330, 440, 660] : [260, 210, 160];
    notes.forEach((note, index) => {
      if (!this.context || !this.ui) return;
      const start = this.context.currentTime + index * 0.13;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(note, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.11, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      oscillator.connect(gain).connect(this.ui);
      oscillator.start(start);
      oscillator.stop(start + 0.36);
    });
  }

  private createGraph() {
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.sfx = this.context.createGain();
    this.ui = this.context.createGain();
    this.ambience = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.62;
    this.sfx.gain.value = 0.48;
    this.ui.gain.value = 0.38;
    this.ambience.gain.value = 0.12;
    this.sfx.connect(this.master);
    this.ui.connect(this.master);
    this.ambience.connect(this.master);
    this.master.connect(this.context.destination);
    const length = this.context.sampleRate * 2;
    this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  private startAmbience() {
    if (!this.context || !this.ambience || !this.noise) return;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 145;
    filter.Q.value = 0.55;
    const gain = this.context.createGain();
    gain.gain.value = 0.15;
    source.connect(filter).connect(gain).connect(this.ambience);
    source.start();
    const hum = this.context.createOscillator();
    const humGain = this.context.createGain();
    hum.type = 'sine';
    hum.frequency.value = 48;
    humGain.gain.value = 0.08;
    hum.connect(humGain).connect(this.ambience);
    hum.start();
  }

  private weapon(kind: UnitKind) {
    if (!this.context || !this.sfx) return;
    const variation = 0.94 + Math.random() * 0.12;
    if (kind === 'rifle' || kind === 'drone') {
      this.noiseBurst(0.055, 950 * variation, 0.12);
      this.tone(150 * variation, 70, 0.065, 0.1, this.sfx, 'square');
    } else if (kind === 'sniper') {
      this.noiseBurst(0.045, 1700 * variation, 0.23, 'highpass');
      this.noiseBurst(0.11, 420 * variation, 0.13);
      this.tone(155 * variation, 58, 0.1, 0.11, this.sfx, 'triangle');
    } else if (kind === 'missile') {
      this.noiseBurst(0.38, 1250 * variation, 0.15, 'highpass');
      this.noiseBurst(0.22, 480 * variation, 0.11);
      this.tone(190 * variation, 82, 0.2, 0.065, this.sfx, 'triangle');
    } else if (kind === 'tank') {
      this.noiseBurst(0.24, 310 * variation, 0.28);
      this.tone(105 * variation, 38, 0.34, 0.24, this.sfx, 'sine');
    } else if (kind === 'artillery') {
      this.noiseBurst(0.18, 520 * variation, 0.18);
      this.tone(220 * variation, 70, 0.25, 0.12, this.sfx, 'sawtooth');
    } else if (kind === 'electric') {
      this.tone(840 * variation, 170, 0.1, 0.09, this.sfx, 'square');
    } else {
      this.noiseBurst(0.1, 420 * variation, 0.12);
    }
  }

  private flame() {
    this.noiseBurst(0.16, 680 + Math.random() * 160, 0.06);
  }

  private explosion(scale: number) {
    if (!this.context || !this.sfx) return;
    this.noiseBurst(0.42, 190 + Math.random() * 70, 0.24 * scale);
    this.tone(82, 28, 0.45, 0.22 * scale, this.sfx, 'sine');
  }

  private impact(scale: number) {
    this.noiseBurst(0.09, 1200 + Math.random() * 500, 0.08 * scale);
  }

  private tone(startFrequency: number, endFrequency: number, duration: number, volume: number, bus: GainNode, type: OscillatorType) {
    if (!this.context) return;
    this.voices++;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(bus);
    oscillator.start(now);
    oscillator.stop(now + duration);
    oscillator.onended = () => { this.voices--; };
  }

  private noiseBurst(duration: number, frequency: number, volume: number, filterType: BiquadFilterType = 'lowpass') {
    if (!this.context || !this.sfx || !this.noise) return;
    this.voices++;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(this.sfx);
    source.start(now);
    source.stop(now + duration);
    source.onended = () => { this.voices--; };
  }
}
