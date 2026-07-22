const fs = require('fs')
const path = require('path')
const os = require('os')

const DEV = process.env.RMP_DEV === 'true'
const DATA_DIR = DEV
  ? path.join(__dirname, '..', 'data')
  : path.join(os.homedir(), '.remindmeplease')
const DATA_FILE = path.join(DATA_DIR, 'tasks.json')

const DEFAULT_DATA = {
  tasks: [],
  categories: ['Work', 'Personal', 'Urgent', 'Design', 'Marketing'],
  weeklyHistory: [],
  settings: {
    keyboardShortcut: 'CommandOrControl+Shift+Space',
    theme: 'dark',
    defaultView: 'list',
    listViewMode: 'list',
    useIcons: false,
    pomodoro: {
      workMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 20,
      sessionsBeforeLongBreak: 4
    }
  },
  quickNote: ''
}

function ensureDir () {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function read () {
  ensureDir()
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2))
    return DEFAULT_DATA
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch {
    return DEFAULT_DATA
  }
}

function write (data) {
  ensureDir()
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
  return true
}

function getDataFilePath () {
  return DATA_FILE
}

module.exports = { read, write, getDataFilePath }
