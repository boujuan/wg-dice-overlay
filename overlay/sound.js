/* Sonido 100% procedural con Web Audio — sin archivos de audio.
 * clacks por colisión · beeps de conteo · stingers de veredicto. */

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = .8;
    this.lastClack = 0;
  }

  _ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      // buffer de ruido blanco reutilizable
      const len = this.ctx.sampleRate * .5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /* golpe seco de dado contra superficie — intensidad 0..1 */
  clack(intensity = .5) {
    const now = performance.now();
    if (now - this.lastClack < 22) return;
    this.lastClack = now;
    const ctx = this._ensure();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = .9 + Math.random() * .5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + Math.random() * 1600 + intensity * 900;
    bp.Q.value = 1.4;
    const gain = ctx.createGain();
    const vol = .12 + intensity * .5;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(.001, t + .05 + intensity * .06);
    src.connect(bp).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + .12);
  }

  /* beep del conteo — i sube por cada dado contado */
  tick(i) {
    const ctx = this._ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 620 + i * 46 + Math.random() * 12;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(.22, t);
    gain.gain.exponentialRampToValueAtTime(.001, t + .11);
    o.connect(gain).connect(this.master);
    o.start(t);
    o.stop(t + .13);
  }

  /* conteo del dado de Ira — doble tono ascendente, inconfundible */
  tickWrath() {
    const ctx = this._ensure();
    const t = ctx.currentTime;
    [[740, 0, .08], [1108.7, .09, .2]].forEach(([f, dt, dur]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(.0001, t + dt);
      g.gain.exponentialRampToAtTime(.26, t + dt + .015);
      g.gain.exponentialRampToAtTime(.001, t + dt + dur);
      o.connect(g).connect(this.master);
      o.start(t + dt); o.stop(t + dt + dur + .05);
    });
  }

  /* sting del dado de Ira al contarlo */
  wrathSting(good) {
    const ctx = this._ensure();
    const t = ctx.currentTime;
    const freqs = good ? [880, 1108.7, 1318.5] : [311, 233];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = good ? 'sine' : 'sawtooth';
      o.frequency.setValueAtTime(f, t + i * .06);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(.0001, t + i * .06);
      gain.gain.exponentialRampToValueAtTime(.16, t + i * .06 + .02);
      gain.gain.exponentialRampToValueAtTime(.001, t + i * .06 + .5);
      o.connect(gain).connect(this.master);
      o.start(t + i * .06);
      o.stop(t + i * .06 + .55);
    });
  }

  success() {
    const ctx = this._ensure();
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      const t0 = t + i * .07;
      g.gain.setValueAtTime(.0001, t0);
      g.gain.exponentialRampToValueAtTime(.2, t0 + .025);
      g.gain.exponentialRampToValueAtTime(.001, t0 + .55);
      o.connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + .6);
    });
  }

  fail() {
    const ctx = this._ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(196, t);
    o.frequency.exponentialRampToValueAtTime(138, t + .3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(.26, t);
    g.gain.exponentialRampToValueAtTime(.001, t + .42);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + .45);
  }

  /* whoosh de fuego + golpe grave — Pifia */
  pifia() {
    const ctx = this._ensure();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1600, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + .9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(.34, t + .1);
    g.gain.exponentialRampToValueAtTime(.001, t + 1.1);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 1.2);
    // golpe grave
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(72, t + .05);
    o.frequency.exponentialRampToValueAtTime(38, t + .5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(.0001, t);
    og.gain.exponentialRampToValueAtTime(.5, t + .12);
    og.gain.exponentialRampToValueAtTime(.001, t + .8);
    o.connect(og).connect(this.master);
    o.start(t + .05); o.stop(t + .85);
  }

  /* shimmer dorado — Glory */
  glory() {
    const ctx = this._ensure();
    const t = ctx.currentTime;
    [659.25, 830.6, 987.77, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const t0 = t + i * .09;
      g.gain.setValueAtTime(.0001, t0);
      g.gain.exponentialRampToValueAtTime(.18, t0 + .03);
      g.gain.exponentialRampToValueAtTime(.001, t0 + .9);
      o.connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 1);
    });
    // chispa de aire
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(.0001, t);
    ng.gain.exponentialRampToValueAtTime(.1, t + .15);
    ng.gain.exponentialRampToValueAtTime(.001, t + .9);
    src.connect(hp).connect(ng).connect(this.master);
    src.start(t); src.stop(t + 1);
  }
}
