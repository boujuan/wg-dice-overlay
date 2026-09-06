/* Mini lanzador — misma IPC que la ventana de control, en versión esquina.
 * La ventana se vuelve semitransparente cuando el ratón no está encima. */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let mode = 'test';
let lastPayload = null;

function clamp(v, min, max) {
  v = parseInt(v, 10);
  if (isNaN(v)) v = min;
  return Math.min(max, Math.max(min, v));
}

function currentPayload(label) {
  const payload = { mode, label: label || null };
  if (mode === 'test') {
    payload.pool = clamp($('#pool').value, 1, 20);
    payload.dn = clamp($('#dn').value, 1, 10);
  } else if (mode === 'damage') {
    payload.base = clamp($('#base').value, 0, 99);
    payload.ed = clamp($('#ed').value, 1, 20);
  } else {
    payload.pool = clamp($('#pool2').value, 1, 20);
  }
  return payload;
}

function setMode(m) {
  mode = m;
  $$('.mtab').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
  $('#mpanel-test').classList.toggle('hidden', m !== 'test');
  $('#mpanel-damage').classList.toggle('hidden', m !== 'damage');
  $('#mpanel-free').classList.toggle('hidden', m !== 'free');
}

async function doRoll(label) {
  const payload = currentPayload(label);
  lastPayload = payload;
  await window.wgControl.setConfig({ lastRoll: {
    pool: payload.pool ?? $('#pool').value,
    dn: payload.dn ?? $('#dn').value,
    base: payload.base ?? $('#base').value,
    ed: payload.ed ?? $('#ed').value,
    pool2: $('#pool2').value
  } });
  await window.wgControl.roll(payload);
}

async function init() {
  const cfg = await window.wgControl.getConfig();
  $('#pool').value = cfg.lastRoll?.pool ?? 5;
  $('#dn').value = cfg.lastRoll?.dn ?? 2;
  $('#base').value = cfg.lastRoll?.base ?? 7;
  $('#ed').value = cfg.lastRoll?.ed ?? 2;
  $('#pool2').value = cfg.lastRoll?.pool2 ?? 2;
  const sel = $('#mpresets');
  for (const p of cfg.presets || []) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    const p = (cfg.presets || []).find(x => x.name === sel.value);
    if (!p) return;
    setMode(p.mode || 'test');
    if (p.pool != null) $('#pool').value = p.pool;
    if (p.dn != null) $('#dn').value = p.dn;
    if (p.base != null) $('#base').value = p.base;
    if (p.ed != null) $('#ed').value = p.ed;
    if (p.pool2 != null) $('#pool2').value = p.pool2;
    doRoll(p.name);
    sel.value = '';
  });
}

$$('.mtab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
$('#btn-roll').addEventListener('click', () => doRoll());
$('#btn-repeat').addEventListener('click', () => { if (lastPayload) doRoll(lastPayload.label); });
$('#mclose').addEventListener('click', () => window.wgControl.toggleMini());

/* atajos unificados: teclado normal y teclas globales capturadas al hacer hover */
function handleKey(key) {
  if (key === 'Space') { doRoll(); return; }
  const k = String(key).toLowerCase();
  if (k === 'enter') { doRoll(); return; }
  if (k === 'r') { if (lastPayload) doRoll(lastPayload.label); }
  else if (k === 't') setMode('test');
  else if (k === 'd') setMode('damage');
  else if (k === 'l') setMode('free');
  else if (/^[1-9]$/.test(k)) {
    // número de dados según el modo actual, sin saltar a test
    if (mode === 'damage') $('#ed').value = k;
    else if (mode === 'free') $('#pool2').value = k;
    else $('#pool').value = k;
  }
}

document.addEventListener('keydown', (e) => {
  // escribiendo en un campo: los dígitos van al campo, sin atajos
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter') { doRoll(); e.target.blur(); }
    return;
  }
  handleKey(e.code === 'Space' ? 'Space' : e.key);
});

// teclas globales registradas por el proceso main mientras el ratón está encima
window.wgControl.onMiniKey(handleKey);

/* opacidad: semitransparente salvo que el ratón esté encima (o enfocado) */
let hover = false, focus = true; // nace opaco; al perder el foco se atenúa
function syncOpacity() {
  window.wgControl.setMiniHover(hover || focus);
}
document.body.addEventListener('mouseenter', () => {
  hover = true;
  syncOpacity();
  // los atajos con hover los captura el proceso main (globalShortcut):
  // llegan por wgControl.onMiniKey
});
document.body.addEventListener('mouseleave', () => { hover = false; syncOpacity(); });
window.addEventListener('blur', () => { focus = false; syncOpacity(); });
window.addEventListener('focus', () => { focus = true; syncOpacity(); });
setTimeout(() => { focus = document.hasFocus(); syncOpacity(); }, 250);

init();
