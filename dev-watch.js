#!/usr/bin/env node
/**
 * Dev sidecar: rebuild + restart the Swift app when Sources/ change.
 * Renderer hot-reload is handled inside the app (RMP_DEV=1 + FSEvents).
 */
const { spawn, execSync } = require('child_process')
const path = require('path')
const chokidar = require('chokidar')

const ROOT = __dirname
const RENDERER = path.join(ROOT, 'renderer')
const SWIFT_DIR = path.join(ROOT, 'RemindMePlease-Swift')
const APP = path.join(SWIFT_DIR, 'RemindMePlease.app')
const EXE = path.join(APP, 'Contents/MacOS/RemindMePlease')
const BUILD = path.join(SWIFT_DIR, 'build.sh')

const devEnv = {
  ...process.env,
  RMP_DEV: '1',
  RMP_RENDERER_DIR: RENDERER
}

function killApp () {
  try { execSync('pkill -x RemindMePlease') } catch { /* not running */ }
}

function launchApp () {
  const child = spawn(EXE, [], {
    env: devEnv,
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
}

let rebuilding = false
let rebuildAgain = false
let debounce = null

function rebuildAndRestart () {
  if (rebuilding) {
    rebuildAgain = true
    return
  }
  rebuilding = true
  console.log('[dev] Swift sources changed — rebuilding…')
  try {
    execSync(BUILD, { cwd: SWIFT_DIR, stdio: 'inherit' })
    killApp()
    setTimeout(() => {
      launchApp()
      console.log('[dev] App restarted (Swift)')
      rebuilding = false
      if (rebuildAgain) {
        rebuildAgain = false
        rebuildAndRestart()
      }
    }, 400)
  } catch {
    console.error('[dev] Build failed — fix errors and save again')
    rebuilding = false
    rebuildAgain = false
  }
}

chokidar.watch(path.join(SWIFT_DIR, 'Sources'), { ignoreInitial: true })
  .on('all', () => {
    clearTimeout(debounce)
    debounce = setTimeout(rebuildAndRestart, 800)
  })

console.log('[dev] Renderer hot-reload: edit files in renderer/')
console.log('[dev] Swift auto-rebuild: watching RemindMePlease-Swift/Sources/')
