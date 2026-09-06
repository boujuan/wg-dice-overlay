/* FX — capa 2D sobre el canvas 3D: partículas aditivas.
 * Pifia → fuego rojo/naranja + humo · Glory → fuente dorada + chispas
 * El dado de Ira suelta ascuas mientras vuela. */

const FIRE = { hot: [255, 236, 160], mid: [255, 150, 40], low: [220, 60, 18], smoke: [70, 62, 58] };
const GOLD = { hot: [255, 248, 214], mid: [255, 214, 92], low: [255, 170, 40] };

export class FX {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.parts = [];
    this.running = false;
    this._loop = this._loop.bind(this);
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _spawn(p) {
    this.parts.push(p);
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this._loop);
    }
  }

  /* ráfaga de fuego (pifia) — partículas que suben parpadeando + humo */
  fireBurst(x, y, big = 1) {
    const n = Math.floor(55 * big);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1 + Math.random() * 3.4) * big;
      this._spawn({
        type: 'fire',
        x: x + (Math.random() - .5) * 26 * big,
        y: y + (Math.random() - .5) * 14 * big,
        vx: Math.cos(a) * sp * .55,
        vy: -Math.abs(Math.sin(a)) * sp - 1.6 * big,
        life: 0, ttl: 480 + Math.random() * 520,
        r: (3 + Math.random() * 7) * big,
        palette: FIRE
      });
    }
    for (let i = 0; i < Math.floor(16 * big); i++) {
      this._spawn({
        type: 'smoke',
        x: x + (Math.random() - .5) * 34 * big,
        y: y + (Math.random() - .5) * 18 * big,
        vx: (Math.random() - .5) * .9,
        vy: -(.5 + Math.random() * 1.1),
        life: 0, ttl: 900 + Math.random() * 900,
        r: (6 + Math.random() * 12) * big,
        palette: FIRE
      });
    }
  }

  /* fuente dorada (glory) — chispas con gravedad */
  gloryFountain(x, y, big = 1) {
    const n = Math.floor(70 * big);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - .5) * 1.7;
      const sp = (3 + Math.random() * 8) * big;
      this._spawn({
        type: 'spark',
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0, ttl: 700 + Math.random() * 800,
        r: 1.4 + Math.random() * 2.8,
        palette: GOLD,
        gravity: 5.2,
        streak: Math.random() < .5
      });
    }
    // destello suave
    for (let i = 0; i < 18; i++) {
      this._spawn({
        type: 'fire',
        x: x + (Math.random() - .5) * 60,
        y: y + (Math.random() - .5) * 30,
        vx: (Math.random() - .5) * 1.4,
        vy: -(Math.random() * 1.6 + .4),
        life: 0, ttl: 600 + Math.random() * 500,
        r: 8 + Math.random() * 14,
        palette: GOLD
      });
    }
  }

  /* ascua individual del dado de Ira en vuelo */
  ember(x, y) {
    this._spawn({
      type: 'fire',
      x: x + (Math.random() - .5) * 12,
      y: y + (Math.random() - .5) * 12,
      vx: (Math.random() - .5) * .8,
      vy: -(.8 + Math.random() * 1.4),
      life: 0, ttl: 350 + Math.random() * 300,
      r: 2 + Math.random() * 3.5,
      palette: GOLD
    });
  }

  _loop() {
    const g = this.g;
    const w = this.canvas.width, h = this.canvas.height;
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';

    const now = performance.now();
    this.parts = this.parts.filter(p => now - p.birth === 0 || now - (p.birth ?? 0) < p.ttl);

    for (const p of this.parts) {
      if (p.birth === undefined) p.birth = now;
      const k = (now - p.birth) / p.ttl;            // 0→1 vida
      if (k >= 1) continue;
      const fade = 1 - k;
      p.x += p.vx;
      p.y += p.vy;
      if (p.gravity) p.vy += p.gravity * .16;

      if (p.type === 'smoke') {
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = `rgba(${p.palette.smoke[0]},${p.palette.smoke[1]},${p.palette.smoke[2]},${.16 * fade})`;
        g.beginPath();
        g.arc(p.x, p.y, p.r * (1 + k * 1.6), 0, Math.PI * 2);
        g.fill();
        g.globalCompositeOperation = 'lighter';
        continue;
      }

      // color: hot→mid→low según vida
      const c = k < .35 ? p.palette.hot : k < .7 ? p.palette.mid : p.palette.low;
      const flicker = p.type === 'fire' ? (.75 + Math.random() * .25) : 1;
      const alpha = fade * flicker * (p.type === 'spark' ? .95 : .8);
      const r = p.type === 'fire' ? p.r * (1 - k * .45) : p.r;

      if (p.streak && p.type === 'spark') {
        g.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
        g.lineWidth = r;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4);
        g.stroke();
      } else {
        const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
        grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${alpha})`);
        grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2);
        g.fill();
      }
    }

    if (this.parts.length) requestAnimationFrame(this._loop);
    else { this.running = false; g.clearRect(0, 0, w, h); }
  }
}
