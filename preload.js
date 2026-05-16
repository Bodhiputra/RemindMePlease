const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('rmp', {
  // Storage
  read: () => ipcRenderer.invoke('storage:read'),
  write: (data) => ipcRenderer.invoke('storage:write', data),

  // Window
  expand: (height) => ipcRenderer.invoke('window:expand', height),
  collapse: () => ipcRenderer.invoke('window:collapse'),

  // Export
  exportJson: () => ipcRenderer.invoke('export:json'),
  exportCsv: () => ipcRenderer.invoke('export:csv'),
  openDataFolder: () => ipcRenderer.invoke('data:openFolder'),

  // Events from main
  on: (channel, fn) => {
    const allowed = ['storage:changed', 'notch:pulse', 'shortcut:toggle']
    if (allowed.includes(channel)) ipcRenderer.on(channel, fn)
  },
  off: (channel, fn) => ipcRenderer.removeListener(channel, fn)
})
