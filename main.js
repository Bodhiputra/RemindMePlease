const { app, BrowserWindow, ipcMain, globalShortcut, screen, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const storage = require('./src/storage')
const scheduler = require('./src/scheduler')
const watcher = require('./src/watcher')

process.env.RMP_DEV = 'true'

const COLLAPSED_WIDTH = 360
const COLLAPSED_HEIGHT = 40
const EXPANDED_WIDTH = 420
const EXPANDED_MAX_HEIGHT = 600

let win = null
let isExpanded = false

function getNotchPosition (width) {
  const display = screen.getPrimaryDisplay()
  const { width: sw } = display.bounds
  return { x: Math.round(sw / 2 - width / 2), y: 0 }
}

function createWindow () {
  const pos = getNotchPosition(COLLAPSED_WIDTH)

  win = new BrowserWindow({
    width: COLLAPSED_WIDTH,
    height: COLLAPSED_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    movable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  scheduler.init(win)
  watcher.init(win)
}

// IPC — storage
ipcMain.handle('storage:read', () => storage.read())
ipcMain.handle('storage:write', (_, data) => storage.write(data))

// IPC — window resize (expand / collapse)
ipcMain.handle('window:expand', (_, contentHeight) => {
  isExpanded = true
  const height = Math.min(contentHeight + COLLAPSED_HEIGHT, EXPANDED_MAX_HEIGHT)
  const pos = getNotchPosition(EXPANDED_WIDTH)
  win.setSize(EXPANDED_WIDTH, height, true)
  win.setPosition(pos.x, pos.y)
})

ipcMain.handle('window:collapse', () => {
  isExpanded = false
  const pos = getNotchPosition(COLLAPSED_WIDTH)
  win.setSize(COLLAPSED_WIDTH, COLLAPSED_HEIGHT, true)
  win.setPosition(pos.x, pos.y)
})

// IPC — export
ipcMain.handle('export:json', async () => {
  const data = storage.read()
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export RemindMePlease Data',
    defaultPath: `remindmeplease-backup-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (filePath) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    return { success: true, path: filePath }
  }
  return { success: false }
})

ipcMain.handle('export:csv', async () => {
  const data = storage.read()
  const rows = [
    ['ID', 'Title', 'Status', 'Priority', 'Category', 'Deadline', 'AddedBy', 'CreatedAt', 'CompletedAt', 'Notes'].join(',')
  ]
  data.tasks.forEach(task => {
    rows.push([
      task.id,
      `"${(task.title || '').replace(/"/g, '""')}"`,
      task.status,
      task.priority,
      task.category || '',
      task.deadline || '',
      task.addedBy || 'user',
      task.createdAt || '',
      task.completedAt || '',
      `"${(task.notes || '').replace(/"/g, '""')}"`
    ].join(','))
    // Subtasks as separate rows
    if (task.subtasks && task.subtasks.length) {
      task.subtasks.forEach(sub => {
        rows.push([
          `${task.id}-sub`,
          `"  └ ${(sub.title || '').replace(/"/g, '""')}"`,
          sub.done ? 'done' : 'todo',
          '', '', '', '', '', '', ''
        ].join(','))
      })
    }
  })

  const { filePath } = await dialog.showSaveDialog({
    title: 'Export as CSV',
    defaultPath: `remindmeplease-${Date.now()}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (filePath) {
    fs.writeFileSync(filePath, rows.join('\n'))
    return { success: true, path: filePath }
  }
  return { success: false }
})

// IPC — open data folder
ipcMain.handle('data:openFolder', () => {
  shell.openPath(path.dirname(storage.getDataFilePath()))
})

app.whenReady().then(() => {
  createWindow()

  // Global shortcut to toggle
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (win) win.webContents.send('shortcut:toggle')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  watcher.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
