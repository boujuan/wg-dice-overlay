/* Control renderer — lanzar tiradas, presets, historial, ajustes. */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let cfg = {};
let mode = 'test';
let lastPayload = null;
let platform = 'unknown';

/* ---------- estado / config ---------- */

async function init() {
  cfg = await window.wgControl.getConfig();
  try { platform = (await window.wgControl.appInfo()).platform; } catch {}
  mode = 'test';
  $('#pool').value = cfg.lastRoll?.pool ?? 5;
  $('#dn').value = cfg.lastRoll?.dn ?? 2;
  $('#base').value = cfg.lastRoll?.base ?? 7;
  $('#ed').value = cfg.lastRoll?.ed ?? 2;
  $('#pool2').value = cfg.lastRoll?.pool2 ?? 2;
  $('#volume').value = Math.round((cfg.volume ?? .8) * 100);
  $('#volume-num').textContent = Math.round((cfg.volume ?? .8) * 100) + '%';
  $('#banner-secs').value = cfg.bannerSeconds ?? 7;
  $('#banner-num').textContent = (cfg.bannerSeconds ?? 7) + 's';
  $('#chk-windowed').checked = !!cfg.windowedOverlay;
  initPlatformUI();
  scaleSlider.value = Math.round((cfg.diceScale ?? 1) * 100);
  $('#dice-scale-num').textContent = scaleSlider.value + '%';
  angleSlider.value = cfg.cameraAngle ?? 50;
  $('#camera-angle-num').textContent = angleSlider.value + '°';
  setAccent(cfg.accent || 'gold', false);
  setBase(cfg.baseColor || 'ochre', false);
  zoomNum.textContent = Math.round((cfg.uiZoom ?? 1) * 100) + '%';
  renderPresets();
  renderHistory();
  await refreshDisplays();
  await refreshStatus();
}

/* selectores y notas según el OS: los ajustes de GPU/plataforma solo tienen
 * sentido en Linux (en Windows todo funciona de serie) */
function initPlatformUI() {
  const note = $('#platform-note');
  if (platform === 'win32') {
    $('#linux-only').classList.add('hidden');
    note.innerHTML = '<b>Windows</b> — transparencia, click-through y GPU funcionan de serie; no hace falta configurar nada.';
  } else if (platform === 'linux') {
    note.innerHTML = '<b>Linux</b> — si la GPU crashea o XWayland no muestra ventanas, usa los selectores de abajo.';
  } else {
    note.textContent = '';
  }
}

async function refreshDisplays() {
  const displays = await window.wgControl.listDisplays();
  const sel = $('#display-select');
  sel.innerHTML = '';
  for (const d of displays) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.label;
    sel.appendChild(opt);
  }
  if (cfg.overlayDisplayId && displays.some(d => d.id === cfg.overlayDisplayId)) {
    sel.value = cfg.overlayDisplayId;
  } else {
    const primary = displays.find(d => d.primary);
    if (primary) sel.value = primary.id;
  }
  // la miniatura de la zona de dados copia el aspect ratio de la pantalla activa
  const active = displays.find(d => String(d.id) === String(sel.value)) || displays[0];
  if (active) {
    setAreaCanvasAspect(active.bounds.width / active.bounds.height);
    $('#area-note').textContent =
      `Miniatura a escala de: ${active.bounds.width}×${active.bounds.height}` +
      ` · ${active.aspect || ''}${active.hz ? ` · ${active.hz} Hz` : ''}`;
  }
}

async function refreshStatus() {
  const st = await window.wgControl.requestStatus();
  setStatus(st.running && st.visible);
}
function setStatus(on) {
  $('#status-dot').className = 'dot ' + (on ? 'on' : 'off');
  $('#status-text').textContent = on ? 'Overlay activo' : 'Overlay apagado (se enciende al lanzar)';
}

/* ---------- presets ---------- */

function renderPresets() {
  const box = $('#presets');
  box.innerHTML = '';
  if (!cfg.presets?.length) {
    box.innerHTML = '<span style="color:var(--dim);font-size:12px">Sin presets — guarda uno con los valores actuales.</span>';
    return;
  }
  for (let i = 0; i < cfg.presets.length; i++) {
    const p = cfg.presets[i];
    const chip = document.createElement('div');
    chip.className = 'chip';
    const info = p.mode === 'test' ? `${p.pool}d · DN${p.dn}`
      : p.mode === 'damage' ? `${p.base}+${p.ed}ED`
      : `${p.pool2 ?? p.pool}d`;
    chip.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="info">${info}</span><span class="x" title="Eliminar">✕</span>`;
    chip.addEventListener('click', (e) => {
      if (e.target.classList.contains('x')) {
        cfg.presets.splice(i, 1);
        window.wgControl.setConfig({ presets: cfg.presets });
        renderPresets();
        return;
      }
      applyPreset(p);
      doRoll(p.name);
    });
    box.appendChild(chip);
  }
}

function applyPreset(p) {
  setMode(p.mode || 'test');
  if (p.pool != null) $('#pool').value = p.pool;
  if (p.dn != null) $('#dn').value = p.dn;
  if (p.base != null) $('#base').value = p.base;
  if (p.ed != null) $('#ed').value = p.ed;
  if (p.pool2 != null) $('#pool2').value = p.pool2;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- lanzar ---------- */

function currentPayload(label) {
  const payload = { mode, label: label || null };
  if (mode === 'test') {
    payload.pool = clamp($('#pool').value, 1, 20);
    payload.dn = clamp($('#dn').value, 1, 10);
  } else if (mode === 'damage') {
    payload.base = clamp($('#base').value, 0, 99);
    payload.ed = clamp($('#ed').value, 1, 20);
  } else {
    payload.pool = clamp($('#pool2').value, 1, 200);
  }
  return payload;
}

function clamp(v, min, max) {
  v = parseInt(v, 10);
  if (isNaN(v)) v = min;
  return Math.min(max, Math.max(min, v));
}

async function doRoll(label) {
  const payload = currentPayload(label);
  lastPayload = payload;
  cfg.lastRoll = {
    pool: payload.pool ?? $('#pool').value,
    dn: payload.dn ?? $('#dn').value,
    base: payload.base ?? $('#base').value,
    ed: payload.ed ?? $('#ed').value,
    pool2: $('#pool2').value
  };
  await window.wgControl.setConfig({ lastRoll: cfg.lastRoll });
  await window.wgControl.roll(payload);
  setStatus(true);
}

/* ---------- historial (persistente: lo guarda el proceso main) ---------- */

function historyItem(r) {
  const li = document.createElement('li');
  let cls = 'free', right = '', left = '';
  const name = r.label ? escapeHtml(r.label) + ' — ' : '';
  if (r.mode === 'test') {
    cls = r.complication ? 'complication' : r.glory ? 'glory' : r.success ? 'success' : 'fail';
    left = `<b>${name}${r.complication ? 'PIFIA' : r.glory ? 'GLORIA' : r.success ? 'Éxito' : 'Fallo'}</b>
      <span class="meta">${r.values.length}d vs DN ${r.dn} · ${r.icons} iconos${r.shifts ? ` · +${r.shifts} shift` : ''}${r.complication ? ' · Ira 1' : r.glory ? ' · Ira 6' : ''}</span>`;
    right = `${r.icons}/${r.dn}`;
  } else if (r.mode === 'damage') {
    cls = 'damage';
    left = `<b>${name}Daño ${r.total}</b><span class="meta">${r.base} base + ${r.ed} ED (${r.values.length}d)</span>`;
    right = `${r.total}`;
  } else {
    cls = 'free';
    left = `<b>${name}Total ${r.total}</b><span class="meta">${r.values.length}d · [${r.values.join(', ')}]</span>`;
    right = `${r.total}`;
  }
  li.className = cls;
  li.innerHTML = `<span class="l">${left}</span><span class="r">${right}</span>`;
  return li;
}

function renderHistory() {
  const ul = $('#history');
  ul.innerHTML = '';
  if (!cfg.history?.length) {
    ul.innerHTML = '<li class="empty">Sin tiradas todavía.</li>';
    return;
  }
  for (const r of cfg.history) ul.appendChild(historyItem(r));
}

window.wgControl.onRollResolved((r) => {
  const ul = $('#history');
  ul.querySelector('.empty')?.remove();
  ul.prepend(historyItem(r));
  while (ul.children.length > 50) ul.lastChild.remove();
});

$('#btn-hist-clear').addEventListener('click', async () => {
  cfg.history = [];
  await window.wgControl.setConfig({ history: [] });
  renderHistory();
});

window.wgControl.onOverlayStatus((s) => setStatus(s.running && s.visible));

/* ---------- eventos UI ---------- */

/* páginas: Tiradas / Historial / Ajustes */
function switchPage(name) {
  $$('.page-tab').forEach(t => t.classList.toggle('active', t.dataset.page === name));
  $$('.page').forEach(p => p.classList.toggle('hidden', p.id !== 'page-' + name));
}
$$('.page-tab').forEach(t => t.addEventListener('click', () => switchPage(t.dataset.page)));

/* mini lanzador flotante (esquina, siempre encima, semitransparente) */
const btnMini = $('#btn-mini');
btnMini.addEventListener('click', async () => {
  const open = await window.wgControl.toggleMini();
  btnMini.textContent = open ? '✕ Cerrar mini' : '🪟 Mini lanzador';
});
window.wgControl.onMiniStatus((open) => {
  btnMini.textContent = open ? '✕ Cerrar mini' : '🪟 Mini lanzador';
});

function setMode(m) {
  mode = m;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
  $('#panel-test').classList.toggle('hidden', m !== 'test');
  $('#panel-damage').classList.toggle('hidden', m !== 'damage');
  $('#panel-free').classList.toggle('hidden', m !== 'free');
  switchPage('tiradas');
}

$$('.tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));

$$('.stepper-box button').forEach(b => b.addEventListener('click', () => {
  const input = $('#' + b.dataset.target);
  const step = parseInt(b.dataset.step, 10);
  const min = parseInt(input.min, 10), max = parseInt(input.max, 10);
  input.value = clamp((parseInt(input.value, 10) || min) + step, min, max);
}));

$('#btn-roll').addEventListener('click', () => doRoll());
$('#btn-repeat').addEventListener('click', () => { if (lastPayload) doRoll(lastPayload.label); });
$('#btn-clear').addEventListener('click', () => window.wgControl.clearOverlay());

$('#btn-preset-save').addEventListener('click', async () => {
  const name = $('#preset-name').value.trim() || 'Preset';
  const p = { name, mode, ...currentPayload() };
  cfg.presets = [...(cfg.presets || []), p];
  await window.wgControl.setConfig({ presets: cfg.presets });
  $('#preset-name').value = '';
  renderPresets();
});

$('#display-select').addEventListener('change', async (e) => {
  await window.wgControl.setOverlayDisplay(parseInt(e.target.value, 10));
});

$('#btn-preview').addEventListener('click', () => window.wgControl.previewOverlay());

const chkWindowed = $('#chk-windowed');
chkWindowed.addEventListener('change', async () => {
  await window.wgControl.setConfig({ windowedOverlay: chkWindowed.checked });
  await window.wgControl.recreateOverlay();
});

const gpuSelect = $('#gpu-mode');
gpuSelect.value = cfg.gpuMode || 'auto';
gpuSelect.addEventListener('change', async () => {
  await window.wgControl.setConfig({ gpuMode: gpuSelect.value });
  // la escalera de gráficos requiere reiniciar la app entera
  await window.wgControl.relaunchForGpu();
});

const ozoneSelect = $('#ozone-select');
ozoneSelect.value = cfg.ozonePlatform || 'x11';
ozoneSelect.addEventListener('change', async () => {
  await window.wgControl.setConfig({ ozonePlatform: ozoneSelect.value });
  await window.wgControl.relaunchForGpu(); // también requiere reinicio completo
});

$('#btn-toggle').addEventListener('click', async () => {
  const visible = await window.wgControl.toggleOverlay();
  $('#btn-toggle').textContent = visible ? 'Ocultar overlay' : 'Mostrar overlay';
  setStatus(visible);
});

$('#volume').addEventListener('input', async (e) => {
  const v = e.target.value / 100;
  $('#volume-num').textContent = e.target.value + '%';
  await window.wgControl.setConfig({ volume: v });
});

$('#banner-secs').addEventListener('input', async (e) => {
  $('#banner-num').textContent = e.target.value + 's';
  await window.wgControl.setConfig({ bannerSeconds: parseInt(e.target.value, 10) });
});

/* ---------- zona de dados (recuadro dibujable con el aspect de la pantalla) ---------- */

const areaCanvas = $('#area-canvas');
const areaCtx = areaCanvas.getContext('2d');
let areaAspect = 16 / 9;
let areaSaveTimer = null;

function setAreaCanvasAspect(aspect) {
  areaAspect = Math.max(.5, Math.min(4, aspect || 16 / 9));
  // el canvas debe medir en píxeles reales lo que muestra en pantalla:
  // si está dentro de un <details> plegado, clientWidth es 0 y se recalcula
  // al desplegarlo (ResizeObserver de abajo)
  const cw = areaCanvas.clientWidth || 0;
  if (cw > 0) {
    areaCanvas.width = Math.round(cw);
    areaCanvas.height = Math.max(80, Math.round(cw / areaAspect));
  }
  drawArea();
}

// cualquier cambio de tamaño (desplegar el details, redimensionar la ventana…)
// reajusta el canvas para que mantenga las proporciones de la pantalla elegida
new ResizeObserver(() => {
  if (areaCanvas.clientWidth > 0) setAreaCanvasAspect(areaAspect);
}).observe(areaCanvas);

function drawArea() {
  const w = areaCanvas.width, h = areaCanvas.height;
  areaCtx.clearRect(0, 0, w, h);
  areaCtx.fillStyle = '#0d0a07';
  areaCtx.fillRect(0, 0, w, h);
  // rejilla tenue
  areaCtx.strokeStyle = 'rgba(255,255,255,.05)';
  for (let gx = w / 6; gx < w; gx += w / 6) {
    areaCtx.beginPath(); areaCtx.moveTo(gx, 0); areaCtx.lineTo(gx, h); areaCtx.stroke();
  }
  for (let gy = h / 4; gy < h; gy += h / 4) {
    areaCtx.beginPath(); areaCtx.moveTo(0, gy); areaCtx.lineTo(w, gy); areaCtx.stroke();
  }
  const a = cfg.diceArea || { x: .2, y: .2, w: .6, h: .6 };
  const rx = a.x * w, ry = a.y * h, rw = a.w * w, rh = a.h * h;
  areaCtx.fillStyle = 'rgba(233,196,106,.13)';
  areaCtx.fillRect(rx, ry, rw, rh);
  areaCtx.strokeStyle = '#e9c46a';
  areaCtx.lineWidth = 2;
  areaCtx.strokeRect(rx, ry, rw, rh);
  // asa de redimensión (esquina inferior derecha)
  areaCtx.fillStyle = '#e9c46a';
  areaCtx.beginPath();
  areaCtx.arc(rx + rw, ry + rh, 5, 0, Math.PI * 2);
  areaCtx.fill();
}

function saveArea() {
  clearTimeout(areaSaveTimer);
  areaSaveTimer = setTimeout(() => {
    window.wgControl.setConfig({ diceArea: { ...cfg.diceArea } });
  }, 150);
}

let areaDrag = null; // {mode:'move'|'resize', start:{x,y}, orig:{...}}
function areaHit(px, py, r) {
  const a = cfg.diceArea || { x: .2, y: .2, w: .6, h: .6 };
  const nearCorner = Math.hypot(px - (a.x + a.w) * r.width, py - (a.y + a.h) * r.height) < 14;
  const inside = px >= a.x * r.width && px <= (a.x + a.w) * r.width &&
    py >= a.y * r.height && py <= (a.y + a.h) * r.height;
  return nearCorner ? 'resize' : inside ? 'move' : null;
}
areaCanvas.addEventListener('pointerdown', (e) => {
  const r = areaCanvas.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  cfg.diceArea || (cfg.diceArea = { x: .2, y: .2, w: .6, h: .6 });
  const hit = areaHit(px, py, r);
  if (!hit) return; // fuera del recuadro → ignorar
  areaDrag = { mode: hit, start: { x: px, y: py }, orig: { ...cfg.diceArea }, rect: r };
  areaCanvas.setPointerCapture(e.pointerId);
});
areaCanvas.addEventListener('pointermove', (e) => {
  const r = areaCanvas.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  if (!areaDrag) {
    // cursor según zona: esquina = redimensionar, interior = mover
    const hit = areaHit(px, py, r);
    areaCanvas.style.cursor = hit === 'resize' ? 'nwse-resize' : hit === 'move' ? 'move' : 'default';
    return;
  }
  const dx = (e.clientX - areaDrag.start.x) / areaDrag.rect.width;
  const dy = (e.clientY - areaDrag.start.y) / areaDrag.rect.height;
  const a = cfg.diceArea, o = areaDrag.orig;
  if (areaDrag.mode === 'move') {
    a.x = Math.max(0, Math.min(1 - o.w, o.x + dx));
    a.y = Math.max(0, Math.min(1 - o.h, o.y + dy));
  } else {
    a.w = Math.max(.15, Math.min(1 - a.x, o.w + dx));
    a.h = Math.max(.15, Math.min(1 - a.y, o.h + dy));
  }
  drawArea();
  saveArea();
});
areaCanvas.addEventListener('pointerup', () => { areaDrag = null; saveArea(); });

/* tamaño de los dados */
const scaleSlider = $('#dice-scale');
scaleSlider.value = Math.round((cfg.diceScale ?? 1) * 100);
$('#dice-scale-num').textContent = scaleSlider.value + '%';
scaleSlider.addEventListener('input', async (e) => {
  $('#dice-scale-num').textContent = e.target.value + '%';
  await window.wgControl.setConfig({ diceScale: e.target.value / 100 });
});

/* ángulo de cámara (10–90°) */
const angleSlider = $('#camera-angle');
angleSlider.value = cfg.cameraAngle ?? 50;
$('#camera-angle-num').textContent = angleSlider.value + '°';
angleSlider.addEventListener('input', async (e) => {
  $('#camera-angle-num').textContent = e.target.value + '°';
  await window.wgControl.setConfig({ cameraAngle: parseInt(e.target.value, 10) });
});

/* ---------- colores: acento (overlay) y base (interfaz + números) ---------- */

const ACCENT_PRESETS = { gold: '#ffd24a', red: '#ff6a4a', blue: '#6fa2ff', green: '#7fe07a' };
const BASE_PRESETS = { ochre: '#b3924a', grafito: '#8a919c', azul: '#5f8fe0', verde: '#5cb571', purpura: '#a07ad6' };
const isHex = v => /^#[0-9a-f]{6}$/i.test(String(v || '').trim());
const normHex = v => {
  const s = String(v || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return '#' + s.toLowerCase();
  return null;
};
const resolveColor = (v, presets, fb) => normHex(v) || presets[v] || fb;

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
const hslStr = (h, s, l) =>
  `hsl(${Math.round(h)} ${Math.round(Math.min(1, Math.max(0, s)) * 100)}% ${Math.round(Math.min(1, Math.max(0, l)) * 100)}%)`;

/* la interfaz entera se tiñe a partir del color base (paleta derivada) */
function applyBaseVars(hex) {
  const { h, s } = hexToHsl(hex);
  const root = document.documentElement.style;
  root.setProperty('--bg', hslStr(h, s * .35, .075));
  root.setProperty('--panel', hslStr(h, s * .4, .11));
  root.setProperty('--panel-2', hslStr(h, s * .45, .15));
  root.setProperty('--band', hslStr(h, s * .35, .09));
  root.setProperty('--line', hslStr(h, s * .4, .21));
  root.setProperty('--text', hslStr(h, s * .3, .86));
  root.setProperty('--dim', hslStr(h, s * .28, .55));
  root.setProperty('--gold', hslStr(h, Math.min(1, s + .1), .6));
  root.setProperty('--ochre', hslStr(h, s * .8, .55));
}

function setAccent(v, save = true) {
  const hex = resolveColor(v, ACCENT_PRESETS, ACCENT_PRESETS.gold);
  cfg.accent = normHex(v) || (ACCENT_PRESETS[v] ? v : 'gold');
  $$('#accent-picker .accent-btn').forEach(b => b.classList.toggle('active', b.dataset.color === hex));
  const hin = $('#accent-hex');
  if (document.activeElement !== hin) hin.value = isHex(cfg.accent) ? cfg.accent : '';
  if (save) window.wgControl.setConfig({ accent: cfg.accent });
}

function setBase(v, save = true) {
  const hex = resolveColor(v, BASE_PRESETS, BASE_PRESETS.ochre);
  cfg.baseColor = normHex(v) || (BASE_PRESETS[v] ? v : 'ochre');
  applyBaseVars(hex);
  $$('#base-picker .accent-btn').forEach(b => b.classList.toggle('active', b.dataset.color === hex));
  const hin = $('#base-hex');
  if (document.activeElement !== hin) hin.value = isHex(cfg.baseColor) ? cfg.baseColor : '';
  if (save) window.wgControl.setConfig({ baseColor: cfg.baseColor });
}

$$('#accent-picker .accent-btn').forEach(b => b.addEventListener('click', () => setAccent(b.dataset.color)));
$$('#base-picker .accent-btn').forEach(b => b.addEventListener('click', () => setBase(b.dataset.color)));
$('#accent-hex').addEventListener('change', e => {
  const h = normHex(e.target.value);
  if (h) setAccent(h); else e.target.value = '';
});
$('#base-hex').addEventListener('change', e => {
  const h = normHex(e.target.value);
  if (h) setBase(h); else e.target.value = '';
});

/* ---------- zoom de la interfaz ---------- */
const zoomNum = $('#zoom-num');
async function applyZoom(factor) {
  const z = await window.wgControl.setZoom(factor);
  cfg.uiZoom = z;   // acumula: cada clic parte del valor actual
  zoomNum.textContent = Math.round(z * 100) + '%';
}
$('#zoom-in').addEventListener('click', () => applyZoom((cfg.uiZoom ?? 1) + .1));
$('#zoom-out').addEventListener('click', () => applyZoom((cfg.uiZoom ?? 1) - .1));

/* ---------- actualizaciones automáticas ---------- */
const btnUpdate = $('#btn-update');
const updateNote = $('#update-note');
let updateState = 'idle';   // idle | available | downloading | downloaded

btnUpdate.addEventListener('click', () => {
  if (updateState === 'available') {
    updateState = 'downloading';
    btnUpdate.classList.add('downloading');
    btnUpdate.textContent = '⬇ Preparando…';
    window.wgControl.downloadUpdate();
  } else if (updateState === 'downloaded') {
    window.wgControl.installUpdate();
  }
});

$('#btn-check-update').addEventListener('click', () => {
  updateNote.textContent = 'Comprobando…';
  window.wgControl.checkUpdates();
});

window.wgControl.onUpdateEvent((ev) => {
  if (ev.type === 'available') {
    updateState = 'available';
    btnUpdate.classList.remove('hidden', 'downloading', 'ready');
    btnUpdate.textContent = `🔄 Actualizar${ev.version ? ' (v' + ev.version + ')' : ''}`;
    updateNote.textContent = `Nueva versión disponible: v${ev.version || '?'}`;
  } else if (ev.type === 'none') {
    updateState = 'idle';
    btnUpdate.classList.add('hidden');
    updateNote.textContent = 'Estás al día.';
  } else if (ev.type === 'progress') {
    btnUpdate.textContent = `⬇ ${ev.percent}% · ${ev.mb}/${ev.total} MB`;
    updateNote.textContent = `Descargando… ${ev.percent}%`;
  } else if (ev.type === 'downloaded') {
    updateState = 'downloaded';
    btnUpdate.classList.remove('downloading');
    btnUpdate.classList.add('ready');
    btnUpdate.textContent = '↻ Reiniciar y actualizar';
    updateNote.textContent = 'Descarga lista — reinicia para aplicar.';
  } else if (ev.type === 'error') {
    if (updateState !== 'downloading') btnUpdate.classList.add('hidden');
    updateState = 'idle';
    updateNote.textContent = 'No se pudo comprobar: ' + (ev.message || 'error de red');
  } else if (ev.type === 'dev') {
    updateNote.textContent = 'Modo desarrollo: el actualizador solo funciona instalado.';
  }
});

/* ---------- atajos de teclado ---------- */

document.addEventListener('keydown', (e) => {
  // escribiendo en un campo: los dígitos van al campo, sin atajos
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    if (e.key === 'Enter') doRoll();
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); doRoll(); }
  else if (e.key === 'r' || e.key === 'R') { if (lastPayload) doRoll(lastPayload.label); }
  else if (e.key === 'Escape') window.wgControl.clearOverlay();
  else if (e.key === 't' || e.key === 'T') { setMode('test'); }
  else if (e.key === 'd' || e.key === 'D') setMode('damage');
  else if (e.key === 'l' || e.key === 'L') setMode('free');
  else if (/^[1-9]$/.test(e.key)) {
    // número de dados según el modo actual, sin saltar de pestaña
    if (mode === 'damage') $('#ed').value = e.key;
    else if (mode === 'free') $('#pool2').value = e.key;
    else $('#pool').value = e.key;
  }
});

init();
