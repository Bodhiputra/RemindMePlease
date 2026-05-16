const chokidar = require('chokidar')
const storage = require('./storage')

let watcher = null

function init (win) {
  const filePath = storage.getDataFilePath()

  watcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
  })

  watcher.on('change', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('storage:changed')
    }
  })
}

function stop () {
  if (watcher) watcher.close()
}

module.exports = { init, stop }
