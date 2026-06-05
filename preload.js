const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('rmp', {
  // Storage
  read: () => ipcRenderer.invoke('storage:read'),
  write: (data) => ipcRenderer.invoke('storage:write', data),

  // Window
  expand: (height) => ipcRenderer.invoke('window:expand', height),
  collapse: () => ipcRenderer.invoke('window:collapse'),
  setHeight: (h) => ipcRenderer.invoke('window:set-height', h),

  // App
  restartApp: () => ipcRenderer.invoke('app:restart'),
  ignoreMouse: (ignore) => ipcRenderer.send('window:ignore-mouse', ignore),
  bringToFront: () => ipcRenderer.send('window:bring-front'),

  // Export
  exportJson: () => ipcRenderer.invoke('export:json'),
  exportCsv: () => ipcRenderer.invoke('export:csv'),
  exportTxt: (text) => ipcRenderer.invoke('export:txt', text),
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  openDataFolder: () => ipcRenderer.invoke('data:openFolder'),

  // Popup window
  openPopup: (view, taskId) => ipcRenderer.invoke('popup:open', { view, taskId: taskId || null }),
  closePopup: () => ipcRenderer.invoke('popup:close'),
  resizePopup: (height) => ipcRenderer.invoke('popup:resize', height),
  commitPopup: () => ipcRenderer.invoke('popup:commit'),
  moveWindow: (dx, dy) => ipcRenderer.send('window:move', { dx, dy }),
  setTrayTitle: (title) => ipcRenderer.send('tray:setTitle', title),

  // Events from main
  on: (channel, fn) => {
    const allowed = ['storage:changed', 'notch:pulse', 'shortcut:toggle', 'panel:collapse-instant', 'panel:reopen', 'popup:dismissed']
    if (allowed.includes(channel)) ipcRenderer.on(channel, fn)
  },
  off: (channel, fn) => ipcRenderer.removeListener(channel, fn)
})
