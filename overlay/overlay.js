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

let cfg = { volume: .8, bannerSeconds: 7 };
let currentRoll = null;   // { timers: [], cleared }
let animId = 0;           // invalida animaciones de tiradas anteriores

window.wgOverlay.getConfig().then(c => {
  cfg = { ...cfg, ...c };
  sound.setVolume(cfg.volume);
});

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
  const wrathIndex = count > 0 ? count - 1 : -1;
  const scale = count <= 10 ? 1 : count <= 16 ? .85 : .72;

  const settledPromise = new Promise(resolve => { scene.onSettled = resolve; });
  scene.throwDice(count, { wrathIndex, scale });
  if (label) {
    labelEl.textContent = label;
    labelEl.classList.remove('hidden');
  }

  // ascuas del dado de Ira mientras vuela
  const emberTimer = setInterval(() => {
    if (myAnim !== animId) { clearInterval(emberTimer); return; }
    if (scene.rollActive && scene.wrathSpeed() > 2.5) {
      const p = scene.wrathScreenPos();
      if (p) fx.ember(p.x, p.y);
    } else {
      clearInterval(emberTimer);
    }
  }, 40);
  currentRoll.timers.push(emberTimer); // clearInterval via clearTimeout no funciona — ver abajo

  const values = await settledPromise;
  if (myAnim !== animId) return;

  /* resultado según modo */
  let result, wrathIdx = count - 1;
  if (mode === 'test') result = rollTest(values, dn);
  else if (mode === 'damage') result = rollDamage(values, base);
  else result = rollFree(values);
  const desc = describe(
    mode === 'test' ? result : { ...result, values },
    mode, label
  );

  /* orden de conteo: izquierda → derecha, la Ira al final */
  const positions = scene.screenPositions();
  const order = positions
    .map((p, i) => ({ i, x: p.x }))
    .sort((a, b) => a.x - b.x)
    .map(o => o.i);
  if (mode === 'test' || mode === 'damage' || mode === 'free') {
    // la Ira (último lanzado) se cuenta al final del recorrido
    const without = order.filter(i => i !== wrathIdx);
    without.push(wrathIdx);
    order.length = 0;
    order.push(...without);
  }

  /* conteo animado */
  tallyEl.classList.remove('hidden');
  let icons = 0;
  const per = Math.max(140, Math.min(340, 4200 / Math.max(1, count)));
  let t = 0;
  for (let k = 0; k < order.length; k++) {
    const idx = order[k];
    const isWrath = idx === wrathIdx;
    t += per;
    later(t, () => {
      if (myAnim !== animId) return;
      const v = values[idx];
      const gained = mode === 'test' ? (v >= 6 ? 2 : v >= 4 ? 1 : 0) : v;
      scene.highlight(idx, isWrath ? 0xffd24a : 0xffe9b0, isWrath ? 1.8 : 1.1, per * .95);
      if (gained > 0 || isWrath) {
        sound.tick(k);
        icons += gained;
      }
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
      // mantén encendido el dado de Ira si pifia o gloria
      if (result.complication) scene.lockGlow(wrathIdx, 0xff3818, 2.2);
      if (result.glory) scene.lockGlow(wrathIdx, 0xffd24a, 2.4);
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
