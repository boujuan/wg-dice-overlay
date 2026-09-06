/* Tiradas W&G 3D — proceso principal
 * Dos ventanas: control (pantalla del DM) + overlay transparente click-through
 * (pantalla donde Arkenforge muestra el mapa a los jugadores).
 */
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  main();
}

function main() {
  let controlWin = null;
  let overlayWin = null;
  let overlayVisible = true;
  let overlayReady = false;
  let pendingRolls = [];
  let previewTimer = null;

  const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
  const windowedFlag = process.argv.includes('--windowed') || process.env.WG_WINDOWED === '1';
  const defaults = {
    overlayDisplayId: null,   // null = pantalla principal
    windowedOverlay: false,   // overlay como ventana normal (si la transparencia falla)
    ozonePlatform: 'x11',     // x11 (recomendado: click-through) | wayland (si XWayland no mapea ventanas)
    gpuMode: 'auto',          // auto | vulkan | software  (escalera de fallback)
    disableGpu: false,        // flag antiguo (v1.0.1) — migrado a gpuMode
    volume: 0.8,
    bannerSeconds: 7,
    presets: [
      { name: 'Azul — BS', mode: 'test', pool: 5, dn: 2, base: 7, ed: 1 },
      { name: 'Azul — Liderazgo', mode: 'test', pool: 5, dn: 2, base: 7, ed: 1 },
      { name: 'Ztrambotico — Smite', mode: 'test', pool: 7, dn: 2, base: 0, ed: 0 },
      { name: "Manu'Rak — WS", mode: 'test', pool: 7, dn: 2, base: 8, ed: 4 }
    ],
    lastRoll: null
  };
  let cfg = loadConfig();
  // migración de valores de la v1.0.1: disableGpu → software; no-gpu-sandbox → auto
  if (cfg.disableGpu && (!cfg.gpuMode || cfg.gpuMode === 'auto')) cfg.gpuMode = 'software';
  if (cfg.gpuMode === 'no-gpu-sandbox') cfg.gpuMode = 'auto';

  /* Linux: plataforma gráfica del overlay.
   * - x11 (XWayland): soporta click-through (setIgnoreMouseEvents) — recomendado.
   *   En algunos sistemas actualizados, XWayland deja de mapear ventanas nuevas
   *   de Electron (todo negro/invisible): ese es el caso de 'wayland'.
   * - wayland nativo: las ventanas siempre pintan, pero Electron no soporta
   *   click-through en Wayland → el overlay se ajusta a una banda superior
   *   para no bloquear el resto de la pantalla. */
  if (process.platform === 'linux') {
    const userForcedPlatform = process.argv.some(a => a.startsWith('--ozone-platform'));
    if (!userForcedPlatform) {
      if (cfg.ozonePlatform === 'wayland') {
        app.commandLine.appendSwitch('ozone-platform', 'wayland');
        console.log('[W&G] Linux: Ozone Wayland nativo (sin click-through; overlay en banda superior)');
      } else if (process.env.DISPLAY) {
        app.commandLine.appendSwitch('ozone-platform', 'x11');
        console.log('[W&G] Linux: forzando Ozone X11 (XWayland) para transparencia + click-through');
      } else {
        console.log('[W&G] Linux: sin DISPLAY — la transparencia puede no funcionar; usa el Modo ventana');
      }
    }
  }

  /* Escalera de gráficos:
   * auto     → backend ANGLE por defecto (en Mesa reciente, EGL_CreateWindowSurface
   *            puede segfaultar — bug de Mesa/ANGLE con AMD/otras GPU)
   * vulkan   → ANGLE sobre Vulkan (RADV) — esquiva el ANGLE-on-GL de Mesa
   * software → sin GPU (último recurso; en X11+XWayland puede no pintar) */
  if (cfg.gpuMode === 'software') {
    app.disableHardwareAcceleration();
    console.log('[W&G] Gráficos: software (sin GPU) por configuración');
  } else if (cfg.gpuMode === 'vulkan') {
    app.commandLine.appendSwitch('use-angle', 'vulkan');
    console.log('[W&G] Gráficos: ANGLE Vulkan por configuración');
  }

  // si el proceso GPU muere (segfault en Mesa/ANGLE EGL_CreateWindowSurface),
  // sube un peldaño en la escalera y relanza — hasta agotarla
  app.on('child-process-gone', (_e, details) => {
    const type = String(details.type || '').toUpperCase();
    if (!type.includes('GPU')) return;
    if (cfg.gpuMode === 'auto') {
      console.log('[W&G] GPU crasheó (¿Mesa/ANGLE?) — reintentando con ANGLE Vulkan');
      cfg.gpuMode = 'vulkan';
      saveConfig();
      relaunchApp();
    } else if (cfg.gpuMode === 'vulkan') {
      console.log('[W&G] Vulkan también crasheó — último recurso: software');
      cfg.gpuMode = 'software';
      saveConfig();
      relaunchApp();
    } else {
      console.log('[W&G] GPU crasheó incluso en modo software; sin más pasos');
    }
  });

  function loadConfig() {
    try {
      return { ...defaults, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) };
    } catch {
      return { ...defaults };
    }
  }
  function saveConfig() {
    try { fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); } catch {}
  }

  function relaunchApp() {
    // En AppImage, process.execPath apunta dentro del montaje squashfs que se
    // desmonta al salir: hay que relanzar vía la ruta del propio .AppImage.
    const relaunchOpts = process.env.APPIMAGE
      ? { args: [process.env.APPIMAGE, ...process.argv.slice(1)] }
      : {};
    app.relaunch(relaunchOpts);
    app.exit(0);
  }

  /* ---------------- ventanas ---------------- */

  function displayById(id) {
    const all = screen.getAllDisplays();
    return all.find(d => d.id === id) || screen.getPrimaryDisplay();
  }

  function createControl() {
    controlWin = new BrowserWindow({
      width: 1120, height: 780, minWidth: 940, minHeight: 640,
      backgroundColor: '#161310',
      title: 'Tiradas W&G 3D — Control',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true
      }
    });
    controlWin.loadFile(path.join(__dirname, 'control', 'index.html'));
    controlWin.on('closed', () => { controlWin = null; });
  }

  function overlayBounds() {
    const d = displayById(cfg.overlayDisplayId);
    return d.bounds;
  }

  function createOverlay(bounds) {
    destroyOverlay();
    const windowed = windowedFlag || cfg.windowedOverlay;
    const waylandBand = cfg.ozonePlatform === 'wayland' && !windowed;
    // En Wayland nativo no hay click-through: el overlay se reduce a una banda
    // superior para no bloquear el resto de la pantalla (Arkenforge sigue usable).
    const b = waylandBand
      ? {
          x: bounds.x + Math.round(bounds.width * .09),
          y: bounds.y + Math.round(bounds.height * .06),
          width: Math.round(bounds.width * .82),
          height: Math.round(bounds.height * .60)
        }
      : bounds;
    overlayWin = new BrowserWindow({
      x: windowed ? b.x + 80 : b.x,
      y: windowed ? b.y + 80 : b.y,
      width: windowed ? 1100 : b.width,
      height: windowed ? Math.min(700, b.height - 160) : b.height,
      titleBarStyle: 'hidden', // sin barra de título (KDE pinta SSD en Wayland si no se fuerza)
      transparent: !windowed,
      frame: !windowed,
      resizable: windowed,
      movable: windowed,
      minimizable: windowed,
      maximizable: windowed, fullscreenable: false,
      focusable: windowed,
      skipTaskbar: !windowed,
      hasShadow: false, show: false,
      backgroundColor: windowed ? '#12100d' : undefined,
      title: 'Overlay de Tiradas W&G',
      autoHideMenuBar: true,
      roundedCorners: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false
      }
    });
    if (!windowed) {
      overlayWin.setAlwaysOnTop(true, 'screen-saver');
      overlayWin.setIgnoreMouseEvents(true);
      overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    overlayWin.loadFile(path.join(__dirname, 'overlay', 'index.html'),
      { query: { windowed: windowed ? '1' : '0' } });
    overlayWin.once('ready-to-show', () => {
      if (overlayVisible) overlayWin.showInactive();
      controlWin?.webContents.send('overlay:status', { running: true, visible: overlayVisible });
    });
    overlayWin.on('closed', () => {
      overlayWin = null;
      controlWin?.webContents.send('overlay:status', { running: false, visible: false });
    });
  }

  function destroyOverlay() {
    overlayReady = false;
    pendingRolls = [];
    if (overlayWin) { try { overlayWin.destroy(); } catch {} overlayWin = null; }
  }

  function recreateOverlay() {
    clearTimeout(previewTimer); previewTimer = null;
    createOverlay(overlayBounds());
  }

  /* ---------------- IPC ---------------- */

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform
  }));

  ipcMain.handle('displays:list', () => {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      primary: d.id === primary.id,
      label: `Pantalla ${d.bounds.x},${d.bounds.y} — ${d.bounds.width}×${d.bounds.height}${d.id === primary.id ? ' (principal)' : ''}`
    }));
  });

  ipcMain.handle('config:get', () => ({ ...cfg, overlayRunning: !!overlayWin }));
  ipcMain.handle('config:set', (_e, patch) => {
    cfg = { ...cfg, ...patch };
    saveConfig();
    return { ...cfg };
  });

  ipcMain.handle('overlay:setDisplay', (_e, displayId) => {
    cfg.overlayDisplayId = displayId;
    saveConfig();
    recreateOverlay();
    return true;
  });

  ipcMain.handle('overlay:recreate', () => { recreateOverlay(); return true; });

  ipcMain.handle('app:relaunch-gpu', () => {
    saveConfig();
    relaunchApp();
    return true;
  });

  ipcMain.handle('overlay:toggle', (_e, visible) => {
    overlayVisible = visible ?? !overlayVisible;
    if (!overlayWin) createOverlay(overlayBounds());
    if (overlayVisible) overlayWin.showInactive(); else overlayWin.hide();
    return overlayVisible;
  });

  // Vista previa: mueve el overlay a la pantalla principal 12 s y vuelve
  ipcMain.handle('overlay:preview', () => {
    clearTimeout(previewTimer);
    if (!overlayWin) createOverlay(screen.getPrimaryDisplay().bounds);
    else {
      const b = screen.getPrimaryDisplay().bounds;
      overlayWin.setBounds(b);
    }
    overlayWin.showInactive();
    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (overlayWin && cfg.overlayDisplayId) {
        overlayWin.setBounds(displayById(cfg.overlayDisplayId).bounds);
      }
    }, 12000);
    return true;
  });

  ipcMain.handle('roll:request', (_e, payload) => {
    if (!overlayWin) createOverlay(overlayBounds());
    const rollId = Date.now() + '-' + Math.floor(Math.random() * 1e6);
    const msg = { ...payload, rollId };
    if (overlayReady) overlayWin?.webContents.send('roll:do', msg);
    else {
      // el overlay aún está cargando: encolar y entregar cuando esté listo
      pendingRolls.push(msg);
      console.log('[W&G] overlay cargando — tirada encolada');
    }
    return rollId;
  });

  ipcMain.handle('overlay:ready', () => {
    overlayReady = true;
    const q = pendingRolls;
    pendingRolls = [];
    for (const msg of q) overlayWin?.webContents.send('roll:do', msg);
    return true;
  });

  ipcMain.handle('overlay:clear', () => {
    overlayWin?.webContents.send('roll:clear');
    return true;
  });

  // el overlay informa del resultado → al control para el historial
  ipcMain.handle('roll:resolved', (_e, result) => {
    controlWin?.webContents.send('roll:resolved', result);
    return true;
  });

  ipcMain.handle('overlay:status:request', () => ({
    running: !!overlayWin, visible: overlayVisible
  }));

  /* ---------------- eventos de pantallas ---------------- */

  app.on('second-instance', () => {
    if (controlWin) { if (controlWin.isMinimized()) controlWin.restore(); controlWin.focus(); }
  });

  app.whenReady().then(() => {
    screen.on('display-removed', (_e, oldDisplay) => {
      if (cfg.overlayDisplayId === oldDisplay.id) {
        cfg.overlayDisplayId = null;
        saveConfig();
      }
      if (overlayWin) recreateOverlay();
    });
    createControl();
    // el overlay se crea bajo demanda (primer lanzamiento o al configurarlo)
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
