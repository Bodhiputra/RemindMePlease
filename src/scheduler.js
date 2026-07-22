const cron = require('node-cron')
const { Notification } = require('electron')
const storage = require('./storage')

let win = null
let showTempFn = null

function init (mainWindow, showTempCallback) {
  win = mainWindow
  showTempFn = showTempCallback || null

  // Check reminders every minute
  cron.schedule('* * * * *', () => {
    checkReminders()
    checkRecurringResets()
  })

  // Weekly history snapshot every Monday at 00:01
  cron.schedule('1 0 * * 1', () => {
    saveWeeklySnapshot()
  })
}

function checkReminders () {
  const data = storage.read()
  const now = new Date()
  let changed = false

  data.tasks.forEach(task => {
    if (task.status === 'done' || task.status === 'archived') return
    if (!task.reminder || task.reminder.type === 'never') return
    if (!task.deadline && task.reminder.type === 'before-deadline') return

    // Check snooze
    if (task.reminder.snoozedUntil) {
      const snoozeEnd = new Date(task.reminder.snoozedUntil)
      if (now < snoozeEnd) return
      task.reminder.snoozedUntil = null
      changed = true
    }

    let shouldFire = false

    if (task.reminder.type === 'at-time') {
      const dateKey = task.reminder.date || todayKey()
      if (dateKey === todayKey() && matchesTime(task.reminder.time || '12:00', now)) {
        shouldFire = !firedToday(task.reminder, now)
      }
    }

    if (task.reminder.type === 'always') {
      if (matchesTime(task.reminder.time || '09:00', now)) {
        shouldFire = !firedToday(task.reminder, now)
      }
    }

    if (task.reminder.type === 'before-deadline' && task.deadline) {
      const deadline = new Date(task.deadline)
      const daysUntil = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24))
      const daysBefore = task.reminder.daysBefore || 1
      if (daysUntil <= daysBefore && daysUntil >= 0 && matchesTime(task.reminder.time || '09:00', now)) {
        shouldFire = !firedToday(task.reminder, now)
      }
    }

    if (shouldFire) {
      fireNotification(task)
      task.reminder.lastFiredAt = now.toISOString()
      if (task.reminder.type === 'at-time') task.reminder.type = 'never'
      changed = true
    }
  })

  if (changed) {
    storage.write(data)
    if (win) win.webContents.send('storage:changed')
  }
}

function todayKey () {
  return new Date().toISOString().split('T')[0]
}

function matchesTime (time, now) {
  const [h, m] = String(time || '09:00').split(':').map(Number)
  return now.getHours() === h && now.getMinutes() === m
}

function firedToday (reminder, now) {
  if (!reminder.lastFiredAt) return false
  return new Date(reminder.lastFiredAt).toDateString() === now.toDateString()
}

function fireNotification (task) {
  if (showTempFn) showTempFn()
  const deadline = task.deadline
    ? `Due ${formatDeadline(new Date(task.deadline))}`
    : 'No deadline set'

  const notification = new Notification({
    title: '⏰ RemindMePlease',
    body: `${task.title}\n${deadline}`,
    actions: [
      { type: 'button', text: 'Snooze 1h' },
      { type: 'button', text: 'Mark Done' }
    ],
    closeButtonText: 'Dismiss'
  })

  notification.on('action', (_, index) => {
    if (index === 0) snoozeTask(task.id, 60)
    if (index === 1) completeTask(task.id)
  })

  notification.show()

  // Pulse the notch
  if (win) win.webContents.send('notch:pulse')
}

function snoozeTask (taskId, minutes) {
  const data = storage.read()
  const task = data.tasks.find(t => t.id === taskId)
  if (!task) return
  const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000)
  task.reminder.snoozedUntil = snoozeUntil.toISOString()
  storage.write(data)
  if (win) win.webContents.send('storage:changed')
}

function completeTask (taskId) {
  const data = storage.read()
  const task = data.tasks.find(t => t.id === taskId)
  if (!task) return
  task.status = 'done'
  task.completedAt = new Date().toISOString()
  if (task.subtasks?.length) {
    task.subtasks.forEach(s => { s.done = true })
  }
  storage.write(data)
  if (win) win.webContents.send('storage:changed')
}

function checkRecurringResets () {
  const data = storage.read()
  const now = new Date()
  let changed = false

  data.tasks.forEach(task => {
    if (!task.recurring || !task.recurring.enabled) return
    if (!task.recurring.nextReset) {
      task.recurring.nextReset = getNextReset(task.recurring).toISOString()
      changed = true
      return
    }

    const nextReset = new Date(task.recurring.nextReset)
    if (now >= nextReset) {
      // Reset the task
      task.status = 'todo'
      task.completedAt = null
      task.strikethrough = false
      task.subtasks = task.subtasks.map(s => ({ ...s, done: false }))
      task.reminder.lastFiredAt = null
      task.reminder.snoozedUntil = null
      task.recurring.nextReset = getNextReset(task.recurring).toISOString()
      changed = true
    }
  })

  if (changed) {
    storage.write(data)
    if (win) win.webContents.send('storage:changed')
  }
}

function getNextReset (recurring) {
  const now = new Date()
  const next = new Date()

  if (recurring.interval === 'daily') {
    next.setDate(now.getDate() + 1)
    next.setHours(0, 0, 0, 0)
  } else if (recurring.interval === 'weekly') {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    const targetDay = days.indexOf((recurring.resetDay || 'monday').toLowerCase())
    const currentDay = now.getDay()
    let daysUntil = (targetDay - currentDay + 7) % 7 || 7
    next.setDate(now.getDate() + daysUntil)
    next.setHours(0, 0, 0, 0)
  } else if (recurring.interval === 'monthly') {
    next.setMonth(now.getMonth() + 1, 1)
    next.setHours(0, 0, 0, 0)
  }

  return next
}

function saveWeeklySnapshot () {
  const data = storage.read()
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - 7)
  weekStart.setHours(0, 0, 0, 0)

  const total = data.tasks.filter(t => !t.recurring?.enabled).length
  const completed = data.tasks.filter(t =>
    t.status === 'done' &&
    t.completedAt &&
    new Date(t.completedAt) >= weekStart
  ).length

  data.weeklyHistory.unshift({
    weekStart: weekStart.toISOString(),
    totalTasks: total,
    completedTasks: completed,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0
  })

  // Keep last 12 weeks
  data.weeklyHistory = data.weeklyHistory.slice(0, 12)
  storage.write(data)
}

function formatDeadline (date) {
  const now = new Date()
  const diff = Math.ceil((date - now) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

module.exports = { init, snoozeTask, completeTask }
