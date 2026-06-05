const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const storage = require('./src/storage')
const scheduler = require('./src/scheduler')
const watcher = require('./src/watcher')

process.env.RMP_DEV = 'true'

const NOTCH_WIDTH = 420
const COLLAPSED_HEIGHT = 40
const EXPANDED_MAX_HEIGHT = 600

let win = null
let popupWin = null
let tray = null
let isExpanded = false
let closedWithReopen = false

// ─── POSITION ─────────────────────────────────────────────────────────────────
function getNotchPosition () {
  const { bounds } = screen.getPrimaryDisplay()
  return {
    x: Math.round(bounds.x + bounds.width / 2 - NOTCH_WIDTH / 2),
    y: bounds.y   // y=0 — works because frame: false bypasses Electron's y-floor
  }
}

// ─── MAIN WINDOW ──────────────────────────────────────────────────────────────
function createWindow () {
  const pos = getNotchPosition()

  win = new BrowserWindow({
    width: NOTCH_WIDTH,
    height: COLLAPSED_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    movable: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setPosition(pos.x, 0)  // must be called AFTER setAlwaysOnTop — that's when y=0 bypass applies
  win.setIgnoreMouseEvents(true, { forward: true })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  scheduler.init(win)
  watcher.init(win)
}

// ─── POPUP WINDOW ─────────────────────────────────────────────────────────────
function createPopupWindow (view, taskId) {
  if (popupWin && !popupWin.isDestroyed()) popupWin.close()

  if (isExpanded) {
    isExpanded = false
    win.setSize(NOTCH_WIDTH, COLLAPSED_HEIGHT)
    win.webContents.send('panel:collapse-instant')
  }

  const [wx, wy] = win.getPosition()
  const query = { view, ...(taskId ? { taskId } : {}) }

  popupWin = new BrowserWindow({
    width: NOTCH_WIDTH,
    height: 100,
    x: wx,
    y: wy + COLLAPSED_HEIGHT,
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

  popupWin.setAlwaysOnTop(true, 'screen-saver')
  popupWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  popupWin.loadFile(path.join(__dirname, 'renderer', 'popup.html'), { query })

  if (view !== 'task-form') {
    popupWin.on('blur', () => { if (popupWin && !popupWin.isDestroyed()) popupWin.close() })
  }

  popupWin.on('closed', () => {
    popupWin = null
    if (win && !win.isDestroyed()) {
      if (closedWithReopen) {
        closedWithReopen = false
        win.webContents.send('panel:reopen')
      } else {
        win.webContents.send('popup:dismissed')
      }
    }
  })
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('popup:open',   (_, { view, taskId }) => createPopupWindow(view, taskId || null))
ipcMain.handle('popup:close',  () => { if (popupWin && !popupWin.isDestroyed()) popupWin.close() })
ipcMain.handle('popup:resize', (_, height) => {
  if (!popupWin || popupWin.isDestroyed()) return
  popupWin.setSize(NOTCH_WIDTH, Math.min(Math.max(height, 80), 560), true)
})
ipcMain.handle('popup:commit', () => {
  closedWithReopen = true
  if (popupWin && !popupWin.isDestroyed()) popupWin.close()
})

ipcMain.on('window:move', (_, { dx, dy }) => {
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  win.setPosition(x + dx, y + dy)
})

ipcMain.on('window:ignore-mouse', (_, ignore) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignore, { forward: true })
})

ipcMain.on('tray:setTitle', (_, title) => {
  if (tray) tray.setTitle(title)
})

ipcMain.handle('app:restart', () => {
  const { spawn } = require('child_process')
  spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore' }).unref()
  app.exit(0)
})

ipcMain.handle('storage:read',  () => storage.read())
ipcMain.handle('storage:write', (_, data) => storage.write(data))

ipcMain.handle('window:expand', (_, contentHeight) => {
  isExpanded = true
  const height = Math.min(contentHeight + COLLAPSED_HEIGHT, EXPANDED_MAX_HEIGHT)
  win.setSize(NOTCH_WIDTH, height, true)
})

ipcMain.handle('window:collapse', () => {
  isExpanded = false
  win.setSize(NOTCH_WIDTH, COLLAPSED_HEIGHT, true)
})

ipcMain.handle('export:json', async () => {
  const data = storage.read()
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export RemindMePlease Data',
    defaultPath: `remindmeplease-backup-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (filePath) { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); return { success: true } }
  return { success: false }
})

ipcMain.handle('export:csv', async () => {
  const data = storage.read()
  const rows = [['ID','Title','Status','Priority','Category','Deadline','AddedBy','CreatedAt','CompletedAt','Notes'].join(',')]
  data.tasks.forEach(task => {
    rows.push([task.id, `"${(task.title||'').replace(/"/g,'""')}"`, task.status,
      task.priority||'', task.category||'', task.deadline||'', task.addedBy||'user',
      task.createdAt||'', task.completedAt||'', `"${(task.notes||'').replace(/"/g,'""')}"`].join(','))
    ;(task.subtasks||[]).forEach(sub => {
      rows.push([`${task.id}-sub`, `"  └ ${(sub.title||'').replace(/"/g,'""')}"`,
        sub.done?'done':'todo','','','','','','',''].join(','))
    })
  })
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export as CSV',
    defaultPath: `remindmeplease-${Date.now()}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (filePath) { fs.writeFileSync(filePath, rows.join('\n')); return { success: true } }
  return { success: false }
})

ipcMain.handle('export:txt', async (_, text) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Save as Text',
    defaultPath: `remindmeplease-${Date.now()}.txt`,
    filters: [{ name: 'Text', extensions: ['txt'] }]
  })
  if (filePath) { fs.writeFileSync(filePath, text, 'utf8'); return { success: true } }
  return { success: false }
})

ipcMain.handle('clipboard:write', (_, text) => {
  const { clipboard } = require('electron')
  clipboard.writeText(text)
  return true
})

ipcMain.handle('data:openFolder', () => {
  shell.openPath(path.dirname(storage.getDataFilePath()))
})

// ─── BOOT ─────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (app.dock) app.dock.hide()

  createWindow()

  // Tray for quit only — notch bar in menu bar is the main UI presence
  tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'))
  tray.setToolTip('RemindMePlease')
  tray.on('right-click', () => {
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: 'Restart', click: () => {
          const { spawn } = require('child_process')
          spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore' }).unref()
          app.exit(0)
        }
      },
      { type: 'separator' },
      { label: 'Quit RemindMePlease', click: () => app.quit() }
    ]))
  })

  // Global shortcut — collapse/expand toggle
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!win) return
    if (popupWin && !popupWin.isDestroyed()) popupWin.close()
    isExpanded = false
    win.setSize(NOTCH_WIDTH, COLLAPSED_HEIGHT)
    win.webContents.send('panel:collapse-instant')
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  watcher.stop()
})

app.on('window-all-closed', () => {
  // Keep alive as always-on menu bar widget
})
