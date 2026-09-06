const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wgControl', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  setOverlayDisplay: (id) => ipcRenderer.invoke('overlay:setDisplay', id),
  recreateOverlay: () => ipcRenderer.invoke('overlay:recreate'),
  toggleOverlay: (visible) => ipcRenderer.invoke('overlay:toggle', visible),
  previewOverlay: () => ipcRenderer.invoke('overlay:preview'),
  relaunchForGpu: () => ipcRenderer.invoke('app:relaunch-gpu'),
  requestStatus: () => ipcRenderer.invoke('overlay:status:request'),
  roll: (payload) => ipcRenderer.invoke('roll:request', payload),
  clearOverlay: () => ipcRenderer.invoke('overlay:clear'),
  toggleMini: () => ipcRenderer.invoke('mini:toggle'),
  setMiniHover: (hover) => ipcRenderer.invoke('mini:hover', hover),
  onMiniKey: (cb) => ipcRenderer.on('mini:key', (_e, k) => cb(k)),
  setZoom: (factor) => ipcRenderer.invoke('ui:zoom', factor),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateEvent: (cb) => ipcRenderer.on('update:event', (_e, ev) => cb(ev)),
  onMiniStatus: (cb) => ipcRenderer.on('mini:status', (_e, open) => cb(open)),
  onRollResolved: (cb) => ipcRenderer.on('roll:resolved', (_e, r) => cb(r)),
  onOverlayStatus: (cb) => ipcRenderer.on('overlay:status', (_e, s) => cb(s))
});

contextBridge.exposeInMainWorld('wgOverlay', {
  onRoll: (cb) => ipcRenderer.on('roll:do', (_e, p) => cb(p)),
  onClear: (cb) => ipcRenderer.on('roll:clear', () => cb()),
  resolve: (result) => ipcRenderer.invoke('roll:resolved', result),
  getConfig: () => ipcRenderer.invoke('config:get'),
  onConfigUpdated: (cb) => ipcRenderer.on('config:updated', (_e, c) => cb(c)),
  ready: () => ipcRenderer.invoke('overlay:ready')
});
