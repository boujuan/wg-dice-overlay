/* Overlay renderer — orquesta la secuencia completa:
 * lanzar → física → asentarse → conteo con beeps → veredicto + efectos → fundido. */
import { DiceScene } from './dice.js';
import { FX } from './particles.js';
import { Sound } from './sound.js';
import { rollTest, rollDamage, rollFree, describe } from './wng.js';

const canvas3d = document.getElementById('three');
const canvasFx = document.getElementById('fx');
const bannerEl = document.getElementById('banner');
const tallyEl = document.getElementById('tally');
const labelEl = document.getElementById('rolllabel');
const vignetteEl = document.getElementById('vignette');
const flashEl = document.getElementById('flash');

const scene = new DiceScene(canvas3d, { onClack: v => sound.clack(v) });
const fx = new FX(canvasFx);
const sound = new Sound();

if (new URLSearchParams(location.search).get('windowed') === '1') {
  document.body.classList.add('windowed');
}

// handle de depuración (inofensivo en producción)
window.__wg = { scene, sound, fx };

let cfg = { volume: .8, bannerSeconds: 7, diceArea: null, diceScale: 1, cameraAngle: 50, accent: 'gold', baseColor: 'ochre' };
let currentRoll = null;   // { timers: [], cleared }
let animId = 0;           // invalida animaciones de tiradas anteriores

const ACCENT_HEX = { gold: '#ffd24a', red: '#ff6a4a', blue: '#6fa2ff', green: '#7fe07a' };
const BASE_HEX = { ochre: '#b3924a', grafito: '#8a919c', azul: '#5f8fe0', verde: '#5cb571', purpura: '#a07ad6' };
const isHex = v => /^#[0-9a-f]{6}$/i.test(String(v || '').trim());
const resolveHex = (v, map, fb) => {
  const s = String(v || '').trim();
  return isHex(s) ? s : map[s] || fb;
};
const hexToRgbArr = h => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
function hexToHsl(hex) {
  const [r0, g0, b0] = hexToRgbArr(hex).map(v => v / 255);
  const max = Math.max(r0, g0, b0), min = Math.min(r0, g0, b0);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    if (max === r0) h = (g0 - b0) / d + (g0 < b0 ? 6 : 0);
    else if (max === g0) h = (b0 - r0) / d + 2;
    else h = (r0 - g0) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
const hslStr = (h, s, l) =>
  `hsl(${Math.round(h)} ${Math.round(Math.min(1, Math.max(0, s)) * 100)}% ${Math.round(Math.min(1, Math.max(0, l)) * 100)}%)`;

/* aplica volumen, acento/base, zona de dados y ángulo de cámara */
function applyConfig(c) {
  cfg = { ...cfg, ...c };
  sound.setVolume(cfg.volume);
  scene.setAccent(cfg.accent);
  if (cfg.cameraAngle != null) scene.setCameraAngle(cfg.cameraAngle);
  if (cfg.diceArea) scene.setViewport(cfg.diceArea);

  const accent = resolveHex(cfg.accent, ACCENT_HEX, ACCENT_HEX.gold);
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  // números y textos del overlay según el color base
  const { h, s } = hexToHsl(resolveHex(cfg.baseColor, BASE_HEX, BASE_HEX.ochre));
  root.setProperty('--base', hslStr(h, Math.min(1, s + .05), .72));
  root.setProperty('--base-soft', hslStr(h, s * .8, .55));
  root.setProperty('--base-dim', hslStr(h, s * .6, .62));
  // chispas de gloria y ascuas del color del acento
  const { h: ah, s: as_, l: al } = hexToHsl(accent);
  fx.setSparkPalette(
    hexToRgbArr(hslToHex(ah, Math.min(1, as_ + .05), Math.min(1, al + .12))),
    hexToRgbArr(accent),
    hexToRgbArr(hslToHex(ah, as_ * .9, Math.max(0, al - .22)))
  );
}
function hslToHex(h, s, l) {
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255);
  };
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}

window.wgOverlay.getConfig().then(applyConfig);
// cambios hechos en la ventana de control (volumen, acento, zona, banner…)
window.wgOverlay.onConfigUpdated(applyConfig);

window.addEventListener('resize', () => {
  scene.resize();
  fx.resize();
});
fx.resize();

/* utilidades de secuencia con cancelación */
function later(ms, fn) {
  const id = setTimeout(fn, ms);
  currentRoll?.timers.push(id);
  return id;
}
function clearRollState() {
  if (currentRoll) currentRoll.timers.forEach(clearTimeout);
  currentRoll = { timers: [] };
  bannerEl.className = '';
  bannerEl.classList.add('hidden');
  tallyEl.classList.add('hidden');
  labelEl.classList.add('hidden');
  vignetteEl.classList.remove('on');
  flashEl.classList.remove('on');
  scene.startFade(300);
}

window.wgOverlay.onRoll(async (payload) => {
  const { mode, pool, dn, base, ed, label, rollId } = payload;
  animId++;
  const myAnim = animId;
  clearRollState();

  const count = mode === 'damage' ? (ed || 1) : pool;
  // el dado de Ira solo existe en los tests de W&G: daño/libre son dados normales
  const hasWrath = mode === 'test' && count > 0;
  const wrathIndex = hasWrath ? count - 1 : -1;

  const settledPromise = new Promise(resolve => { scene.onSettled = resolve; });
  scene.throwDice(count, { wrathIndex, scale: cfg.diceScale ?? 1 });
  if (label) {
    labelEl.textContent = label;
    labelEl.classList.remove('hidden');
  }

  // ascuas del dado de Ira mientras vuela
  const emberTimer = hasWrath ? setInterval(() => {
    if (myAnim !== animId) { clearInterval(emberTimer); return; }
    if (scene.rollActive && scene.wrathSpeed() > 2.5) {
      const p = scene.wrathScreenPos();
      if (p) fx.ember(p.x, p.y);
    } else {
      clearInterval(emberTimer);
    }
  }, 40) : null;
  if (emberTimer) currentRoll.timers.push(emberTimer); // clearInterval via clearTimeout no funciona — ver abajo

  const values = await settledPromise;
  if (myAnim !== animId) return;

  /* resultado según modo */
  let result, wrathIdx = wrathIndex;
  if (mode === 'test') result = rollTest(values, dn);
  else if (mode === 'damage') result = rollDamage(values, base);
  else result = rollFree(values);
  const desc = describe(
    mode === 'test' ? result : { ...result, values },
    mode, label
  );

  /* conteo rápido: izquierda → derecha solo los dados que puntúan, y la Ira
   * SIEMPRE al final con su sonido propio. En modo libre se recorren todos. */
  const positions = scene.screenPositions();
  const leftToRight = positions
    .map((p, i) => ({ i, x: p.x }))
    .sort((a, b) => a.x - b.x)
    .map(o => o.i);
  const gainedOf = (v) => mode === 'free' ? v : (v >= 6 ? 2 : v >= 4 ? 1 : 0);

  const seq = [];
  for (const i of leftToRight) {
    if (i === wrathIdx) continue;
    if (mode !== 'free' && gainedOf(values[i]) === 0) continue; // sin icono → sin highlight
    seq.push(i);
  }
  if (hasWrath) seq.push(wrathIdx);   // la Ira cierra el conteo

  tallyEl.classList.remove('hidden');
  tallyEl.querySelector('.cap').textContent =
    mode === 'test' ? 'ICONOS' : mode === 'damage' ? 'DAÑO' : 'TOTAL';
  // en daño el contador parte de la base (el banner final es base + ED)
  tallyEl.querySelector('.num').textContent = mode === 'damage' ? result.base : 0;
  let icons = 0;
  // ~2.6 s de conteo total: pocos dados = despacio, 200 dados = rápida
  const per = Math.max(12, Math.min(240, 2600 / Math.max(1, seq.length)));
  let t = 0;
  for (let k = 0; k < seq.length; k++) {
    const idx = seq[k];
    const isWrath = idx === wrathIdx;
    t += per;
    later(t, () => {
      if (myAnim !== animId) return;
      const gained = gainedOf(values[idx]);
      scene.highlight(idx, isWrath ? (scene.accent.glow) : (scene.accent.soft), isWrath ? 1.8 : 1.1, per * .95);
      if (isWrath) sound.tickWrath();                 // sonidito propio de la Ira
      else if (gained > 0 && (per >= 60 || k % 4 === 0)) sound.tick(k); // sin metralleta en pools enormes
      if (gained > 0 || isWrath) icons += gained;
      tallyEl.querySelector('.num').textContent =
        mode === 'test' ? icons : (mode === 'damage' ? result.base + icons : icons);
    });
  }

  /* veredicto */
  t += per + 240;
  later(t, () => {
    if (myAnim !== animId) return;

    // enviar al control (historial) en cuanto hay veredicto
    window.wgOverlay.resolve({
      rollId, mode, label, values,
      ...(mode === 'test' ? {
        icons: result.icons, dn: result.dn,
        success: result.success, shifts: result.shifts,
        complication: result.complication, glory: result.glory,
        wrath: result.wrath
      } : mode === 'damage' ? {
        total: result.total, base: result.base, ed: result.ed, wrath: result.wrath
      } : { total: result.total, wrath: result.wrath })
    });

    // banner + efectos
    bannerEl.querySelector('.title').textContent = desc.title;
    bannerEl.querySelector('.detail').textContent = desc.detail;
    bannerEl.className = 'show ' + desc.cls;
    tallyEl.classList.add('hidden');

    const pifs = positions.filter(p => mode === 'test' && p.value === 1 && p.wrath);
    const glor = positions.filter(p => p.wrath && p.value === 6);

    if (mode === 'test') {
      if (result.complication) {
        sound.pifia();
        vignetteEl.classList.add('on');
        later(1400, () => vignetteEl.classList.remove('on'));
        const src = pifs[0] || positions[Math.floor(positions.length / 2)] || { x: innerWidth / 2, y: innerHeight / 2 };
        let wave = 0;
        const fireLoop = setInterval(() => {
          wave++;
          fx.fireBurst(src.x + (Math.random() - .5) * 60, src.y + (Math.random() - .5) * 30, 1);
          if (wave >= 3) clearInterval(fireLoop);
        }, 260);
      } else if (result.glory) {
        sound.glory();
        flashEl.classList.add('on');
        later(900, () => flashEl.classList.remove('on'));
        const src = glor[0] || { x: innerWidth / 2, y: innerHeight / 2 };
        fx.gloryFountain(src.x, src.y, 1.2);
      } else if (result.success) {
        sound.success();
        const c = positions[Math.floor(positions.length / 2)] || { x: innerWidth / 2, y: innerHeight / 2 };
        fx.gloryFountain(c.x, c.y, .35);
      } else {
        sound.fail();
      }
      // mantén encendido el dado de Ira si pifia o gloria (gloria = color de acento)
      if (result.complication) scene.lockGlow(wrathIdx, 0xff3818, 2.2);
      if (result.glory) scene.lockGlow(wrathIdx, scene.accent.glow, 2.4);
    } else {
      sound.success();
      const c = positions[Math.floor(positions.length / 2)] || { x: innerWidth / 2, y: innerHeight / 2 };
      fx.gloryFountain(c.x, c.y, .3);
    }

    /* fundido final */
    later(cfg.bannerSeconds * 1000, () => {
      if (myAnim !== animId) return;
      scene.startFade(650);
      later(700, () => {
        bannerEl.className = '';
        bannerEl.classList.add('hidden');
        labelEl.classList.add('hidden');
      });
    });
  });
});

window.wgOverlay.onClear(() => {
  animId++;
  clearRollState();
});

// el overlay está listo para recibir tiradas (las que llegaron antes van encoladas)
window.wgOverlay.ready();
