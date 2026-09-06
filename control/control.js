/* Control renderer — lanzar tiradas, presets, historial, ajustes. */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let cfg = {};
let mode = 'test';
let lastPayload = null;

/* ---------- estado / config ---------- */

async function init() {
  cfg = await window.wgControl.getConfig();
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
  renderPresets();
  await refreshDisplays();
  await refreshStatus();
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
    payload.pool = clamp($('#pool2').value, 1, 20);
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

/* ---------- historial ---------- */

window.wgControl.onRollResolved((r) => {
  const ul = $('#history');
  ul.querySelector('.empty')?.remove();

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
  ul.prepend(li);
  while (ul.children.length > 25) ul.lastChild.remove();
});

window.wgControl.onOverlayStatus((s) => setStatus(s.running && s.visible));

/* ---------- eventos UI ---------- */

function setMode(m) {
  mode = m;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
  $('#panel-test').classList.toggle('hidden', m !== 'test');
  $('#panel-damage').classList.toggle('hidden', m !== 'damage');
  $('#panel-free').classList.toggle('hidden', m !== 'free');
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

/* ---------- atajos de teclado ---------- */

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'number') {
    if (e.key === 'Enter') doRoll();
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); doRoll(); }
  else if (e.key === 'r' || e.key === 'R') { if (lastPayload) doRoll(lastPayload.label); }
  else if (e.key === 'Escape') window.wgControl.clearOverlay();
  else if (e.key === 't' || e.key === 'T') setMode('test');
  else if (e.key === 'd' || e.key === 'D') setMode('damage');
  else if (e.key === 'l' || e.key === 'L') setMode('free');
  else if (/^[1-9]$/.test(e.key)) { $('#pool').value = e.key; setMode('test'); }
});

init();
