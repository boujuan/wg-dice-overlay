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
  let previewTimer = null;

  const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
  const windowedFlag = process.argv.includes('--windowed') || process.env.WG_WINDOWED === '1';
  const defaults = {
    overlayDisplayId: null,   // null = pantalla principal
    windowedOverlay: false,   // overlay como ventana normal (si la transparencia falla)
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
    overlayWin = new BrowserWindow({
      x: windowed ? bounds.x + 80 : bounds.x,
      y: windowed ? bounds.y + 80 : bounds.y,
      width: windowed ? 1100 : bounds.width,
      height: windowed ? Math.min(700, bounds.height - 160) : bounds.height,
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
    overlayWin?.webContents.send('roll:do', { ...payload, rollId });
    return rollId;
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
