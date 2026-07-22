// ─── STATE ───────────────────────────────────────────────────────────────────
let data = { tasks: [], categories: [], weeklyHistory: [], settings: {}, quickNote: '' }
let listViewMode  = 'list'
/** 'tasks' | 'pomodoro' — Pomodoro is a separate panel, not a list layout. */
let panelMode     = 'tasks'
let isExpanded    = false
/** 'hover' = peek (auto-collapse on leave); 'user' = clicked/toggled (stay open). */
let expandSource  = null
let popupOpen     = false
let dragSrcId     = null
let calendarDate        = new Date()
let calendarSelectedDay = null
let searchQuery   = ''
let filterCategory = ''
let carouselTimer = null
let carouselIdx   = 0
let searchOpen = false
let footerMenuOpen = false
let hoverCollapseTimer = null
let toastTimer = null
const HOVER_LEAVE_MS = 200

let notchGeo = {
  width: 420,
  barHeight: 40,
  chinHeight: 0,
  collapsedHeight: 40,
  expandedMax: 480
}

function shellCollapsedH () {
  return notchGeo.collapsedHeight ?? (notchGeo.barHeight + (notchGeo.chinHeight || 0))
}

function shellExpandedH () {
  return notchGeo.expandedMax ?? 480
}

function applyNotchGeometry (geo) {
  if (!geo || typeof geo !== 'object') return
  notchGeo = { ...notchGeo, ...geo }
  const collapsed = notchGeo.collapsedHeight
    ?? (notchGeo.barHeight + (notchGeo.chinHeight || 0))
  notchGeo.collapsedHeight = collapsed

  const root = document.documentElement
  root.style.setProperty('--notch-width', `${notchGeo.width}px`)
  root.style.setProperty('--notch-bar-height', `${notchGeo.barHeight}px`)
  root.style.setProperty('--chin-height', `${notchGeo.chinHeight || 0}px`)
  root.style.setProperty('--shell-collapsed-height', `${collapsed}px`)
  root.style.setProperty('--shell-expanded-height', `${shellExpandedH()}px`)

  // Native panel already uses collapsedHeight from NotchGeometry — CSS vars only here.
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init () {
  data = await window.rmp.read()
  window.RMPFocus?.ensureDefaults(data)
  listViewMode = migrateListViewMode(data.settings)
  try {
    applyNotchGeometry(await window.rmp.getGeometry())
  } catch (_) { /* fallback defaults */ }
  renderBar()
  setupEvents()
  syncViewToggleUI()
  setupMousePassthrough()

  window.RMPFocus?.init({
    getData: () => data,
    getFocusableTasks: () => getFocusableTasksForPomo(),
    getCurrentView: () => (panelMode === 'pomodoro' ? 'pomodoro' : listViewMode),
    onSave: async () => { await save() },
    onBarUpdate: () => renderBar(),
    onToast: (msg) => showToast(msg),
    onPomoEvent: (event) => showPomoEvent(event),
    onConfetti: () => fireConfetti(),
    onPulse: () => {
      document.getElementById('notch-bar').classList.add('pulsing')
      setTimeout(() => document.getElementById('notch-bar').classList.remove('pulsing'), 3000)
    },
    onNotify: (payload) => window.rmp.notify?.(payload)
  })

  window.rmp.on('notch:geometry', applyNotchGeometry)
  setupNativeHover()

  window.rmp.on('storage:changed', async () => {
    data = await window.rmp.read()
    renderBar()
    if (isExpanded) renderCurrentView()
  })

  window.rmp.on('notch:pulse', () => {
    document.getElementById('notch-bar').classList.add('pulsing')
    setTimeout(() => document.getElementById('notch-bar').classList.remove('pulsing'), 3000)
  })

  window.rmp.on('shortcut:toggle', () => togglePanel())

  window.rmp.on('panel:collapse-instant', () => collapsePanelInstant())

  window.rmp.on('app:resign-active', () => {
    clearHoverTimers()
    if (popupOpen) closeSheet(false)
    if (isExpanded) collapsePanelInstant()
    window.rmp.refreshHover?.()
  })

  // Popup opened: collapse panel instantly (no animation)
  window.rmp.on('sheet:open', (payload) => {
    const view = payload?.view
    const taskId = payload?.taskId || null
    if (view) openSheet(view, taskId)
  })

  document.getElementById('sheet-backdrop')?.addEventListener('click', () => {
    if (popupOpen) closeSheet(false)
  })
}

// ─── BAR ──────────────────────────────────────────────────────────────────────

function todayKey () {
  return new Date().toISOString().split('T')[0]
}

function formatTime12 (time) {
  const [h, m] = String(time || '09:00').split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function reminderTag (task) {
  const r = task.reminder
  if (!r || r.type === 'never') return ''
  if (r.type === 'at-time' && r.date && r.time) {
    const t = formatTime12(r.time)
    if (r.date === todayKey()) return `<span class="tag remind">🔔 ${t}</span>`
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (r.date === tomorrow.toISOString().split('T')[0]) {
      return `<span class="tag remind">🔔 tomorrow ${t}</span>`
    }
    return `<span class="tag remind">🔔 ${r.date} ${t}</span>`
  }
  if (r.type === 'always' && r.time) {
    return `<span class="tag remind">🔔 daily ${formatTime12(r.time)}</span>`
  }
  return ''
}

function taskSubtitle (task) {
  const r = task.reminder
  if (r?.type === 'at-time' && r.date && r.time) {
    const t = formatTime12(r.time)
    if (r.date === todayKey()) return { text: `Remind at ${t}`, cls: 'remind' }
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (r.date === tomorrow.toISOString().split('T')[0]) return { text: `Tomorrow ${t}`, cls: 'remind' }
    return { text: `${r.date} · ${t}`, cls: 'remind' }
  }
  if (r?.type === 'always' && r.time) {
    return { text: `Every day at ${formatTime12(r.time)}`, cls: 'remind' }
  }
  if (task.deadline && task.status !== 'done') {
    const diff = Math.ceil((new Date(task.deadline) - new Date()) / (1000 * 60 * 60 * 24))
    if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, cls: 'overdue' }
    if (diff === 0) return { text: 'Due today', cls: 'soon' }
    if (diff === 1) return { text: 'Due tomorrow', cls: 'soon' }
    return { text: `Due ${new Date(task.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, cls: '' }
  }
  if (task.category) return { text: task.category, cls: '' }
  return null
}

function getBarCarouselText () {
  const active = data.tasks.filter(t => t.status !== 'done' && t.status !== 'archived')
  const key = todayKey()
  const reminders = active
    .filter(t => t.reminder?.type === 'at-time' && t.reminder.date === key && t.reminder.time)
    .sort((a, b) => (a.reminder.time || '').localeCompare(b.reminder.time || ''))
  if (reminders.length) {
    const next = reminders[0]
    return `🔔 ${next.title} · ${formatTime12(next.reminder.time)}`
  }
  const { activeToday } = getTodayBuckets()
  if (activeToday.length) return `${activeToday.length} for today`
  if (active.length) return active[0].title
  return 'Add a reminder'
}

function todayStart () {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now
}

/** Task manually added to today's plan. */
function isPlannedForToday (t, key = todayKey()) {
  if (t.status === 'archived') return false
  return t.plannedFor === key
}

function deadlineIsToday (t) {
  if (!t.deadline) return false
  const d = new Date(t.deadline)
  d.setHours(0, 0, 0, 0)
  return d.getTime() === todayStart().getTime()
}

/** Today view + progress: planned for today OR deadline is today. */
function isOnTodayList (t) {
  if (t.status === 'archived') return false
  return isPlannedForToday(t) || deadlineIsToday(t)
}

function isTodayTask (t) {
  return isOnTodayList(t)
}

function getTodayBuckets () {
  const activeToday = data.tasks.filter(t => isOnTodayList(t) && t.status !== 'done')
  const doneToday = data.tasks.filter(t => isOnTodayList(t) && t.status === 'done')
  return { activeToday, doneToday }
}

function getFocusableTasksForPomo () {
  return getTodayBuckets().activeToday
}

function getTodayProgressStats () {
  const todayTasks = data.tasks.filter(t => isOnTodayList(t))
  const done = todayTasks.filter(t => t.status === 'done').length
  const total = todayTasks.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return { done, total, pct }
}

function renderBar () {
  const active = data.tasks.filter(t => t.status !== 'archived')
  const { done, total, pct } = getTodayProgressStats()

  const now = new Date()
  const urgent = active.filter(t => {
    if (!t.deadline || t.status === 'done') return false
    return (new Date(t.deadline) - now) / (1000 * 60 * 60 * 24) <= 2
  })

  const urgentEl = document.getElementById('bar-urgent')
  if (urgent.length > 0) {
    urgentEl.textContent = `${urgent.length} due`
    urgentEl.classList.remove('hidden')
  } else {
    urgentEl.classList.add('hidden')
  }
  const progressText = total > 0 ? `${done}/${total}` : ''
  const progressEl = document.getElementById('bar-progress')
  if (progressEl) {
    progressEl.textContent = progressText
    progressEl.classList.toggle('hidden', !progressText)
  }

  const notch = document.getElementById('notch-bar')
  const carousel = document.getElementById('bar-carousel')
  const barPomo = document.getElementById('bar-pomo')
  const pomoActive = window.RMPFocus?.isActive?.()

  if (pomoActive) {
    if (carouselTimer) clearInterval(carouselTimer)
    carousel?.classList.add('hidden')
    barPomo?.classList.remove('hidden')
    const timeEl = document.getElementById('bar-pomo-time')
    const labelEl = document.getElementById('bar-pomo-label')
    if (timeEl) timeEl.textContent = window.RMPFocus.barTime()
    const taskTitle = window.RMPFocus.linkedTaskTitle?.()
    const phase = window.RMPFocus.barPhaseShort()
    if (labelEl) {
      if (taskTitle && phase === 'focus') {
        labelEl.textContent = taskTitle.length > 28 ? `${taskTitle.slice(0, 26)}…` : taskTitle
      } else {
        labelEl.textContent = phase
      }
    }
    barPomo?.classList.toggle('break', window.RMPFocus.isBreakPhase?.())
    notch?.classList.toggle('bar-pomo-break', window.RMPFocus.isBreakPhase?.())
    notch?.classList.add('focus-active')
    window.rmp.setTrayTitle(window.RMPFocus.trayLabel() || (total > 0 ? ` ${pct}%` : ''))
  } else {
    carousel?.classList.remove('hidden')
    barPomo?.classList.add('hidden')
    notch?.classList.remove('focus-active', 'bar-pomo-break')
    window.rmp.setTrayTitle(total > 0 ? ` ${pct}%` : '')
    startCarousel()
  }
}

function showPomoEvent (event) {
  const overlay = document.getElementById('pomo-event-overlay')
  if (!overlay || !event) return

  clearHoverTimers()
  expandSource = 'event'
  if (!isExpanded) expandPanel('event')
  else window.rmp.bringToFront?.()

  if (panelMode !== 'pomodoro') {
    panelMode = 'pomodoro'
    syncPanelChrome()
    renderPomodoro()
  }

  const iconEl = document.getElementById('pomo-event-icon')
  const titleEl = document.getElementById('pomo-event-title')
  const bodyEl = document.getElementById('pomo-event-body')
  const okBtn = document.getElementById('pomo-event-ok')

  const phase = event.completedPhase || event.nextPhase
  const isWorkComplete = event.completedPhase === 'work'
  const isLong = phase === 'longBreak' || event.nextPhase === 'longBreak'

  if (iconEl) {
    iconEl.textContent = isWorkComplete ? '🍅' : (isLong ? '☕' : '🚶')
    iconEl.classList.toggle('break', !isWorkComplete)
  }
  if (titleEl) titleEl.textContent = event.title || 'Pomodoro'
  if (bodyEl) bodyEl.textContent = event.body || ''

  overlay.classList.remove('hidden')
  overlay.setAttribute('aria-hidden', 'false')
  window.rmp.makeKey?.()

  let dismissTimer = null
  const dismiss = () => {
    if (dismissTimer) clearTimeout(dismissTimer)
    overlay.classList.add('hidden')
    overlay.setAttribute('aria-hidden', 'true')
    okBtn?.removeEventListener('click', dismiss)
  }
  okBtn?.addEventListener('click', dismiss)
  dismissTimer = setTimeout(dismiss, 4000)
}

function fireConfetti () {
  const shell = document.getElementById('app-shell')
  if (!shell) return

  const canvas = document.createElement('canvas')
  canvas.className = 'pomo-confetti-canvas'
  const w = shell.clientWidth
  const h = shell.clientHeight
  canvas.width = w
  canvas.height = h
  shell.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  const colors = ['#e85d4c', '#4ade80', '#fbbf24', '#fafafa', '#f87171', '#86efac']
  const particles = Array.from({ length: 90 }, () => ({
    x: Math.random() * w,
    y: -8 - Math.random() * 40,
    w: 5 + Math.random() * 7,
    h: 3 + Math.random() * 5,
    vx: (Math.random() - 0.5) * 5,
    vy: 2 + Math.random() * 5,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.2,
    color: colors[Math.floor(Math.random() * colors.length)]
  }))

  let frame = 0
  const tick = () => {
    ctx.clearRect(0, 0, w, h)
    particles.forEach(p => {
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.12
      p.rot += p.vr
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    })
    frame += 1
    if (frame < 130) requestAnimationFrame(tick)
    else canvas.remove()
  }
  requestAnimationFrame(tick)

  // Optional: also ping system confetti shortcut if something listens for ⌃L
  window.rmp.confetti?.()
}

// ─── TOGGLE ───────────────────────────────────────────────────────────────────
function togglePanel () {
  if (popupOpen) { closeSheet(false); return }
  if (isExpanded) collapsePanel()
  else expandPanel()
}

function pinExpandInteraction () {
  if (!isExpanded) return
  expandSource = 'user'
  clearHoverTimers()
}

function expandPanel (source = 'user') {
  clearHoverTimers()
  expandSource = source
  isExpanded = true
  if (popupOpen) closeSheet(false)
  window.rmp.bringToFront()
  const shell = document.getElementById('app-shell')
  const panel = document.getElementById('panel')
  const notch = document.getElementById('notch-bar')
  document.body.classList.add('expanded')
  shell.classList.add('expanded')
  window.rmp.setHeight(shellExpandedH())
  notch.classList.add('panel-open')
  panel.classList.remove('hidden', 'panel-leaving')
  panel.classList.add('panel-entering')
  setTimeout(() => panel.classList.remove('panel-entering'), 180)
  document.getElementById('btn-toggle').textContent = '▴'
  renderCurrentView()
  syncViewToggleUI()
  syncPanelChrome()
}

function clearHoverTimers () {
  if (hoverCollapseTimer) { clearTimeout(hoverCollapseTimer); hoverCollapseTimer = null }
}

function collapsePanel () {
  clearHoverTimers()
  expandSource = null
  isExpanded = false
  if (popupOpen) closeSheet(false)
  const shell = document.getElementById('app-shell')
  const panel = document.getElementById('panel')
  const notch = document.getElementById('notch-bar')
  document.getElementById('btn-toggle').textContent = '▾'
  panel.classList.remove('panel-entering')
  panel.classList.add('panel-leaving')
  setTimeout(() => {
    panel.classList.remove('panel-leaving')
    panel.classList.add('hidden')
    notch.classList.remove('panel-open')
    document.body.classList.remove('expanded')
    shell.classList.remove('expanded')
    window.rmp.setHeight(shellCollapsedH())
    window.rmp.refreshHover?.()
  }, 180)
}

/** Native collapse (hotkey / focus loss) — keep JS in sync without animation. */
function collapsePanelInstant () {
  clearHoverTimers()
  expandSource = null
  isExpanded = false
  const shell = document.getElementById('app-shell')
  const panel = document.getElementById('panel')
  const notch = document.getElementById('notch-bar')
  document.getElementById('btn-toggle').textContent = '▾'
  panel.classList.remove('panel-entering', 'panel-leaving')
  panel.classList.add('hidden')
  notch.classList.remove('panel-open')
  document.body.classList.remove('expanded')
  shell.classList.remove('expanded')
  window.rmp.setHeight(shellCollapsedH())
}

async function collapseIfPointerOutsideNotch () {
  if (popupOpen || !isExpanded || notchDragActive) return
  try {
    const over = await window.rmp.pointerOverNotch?.()
    if (over === false) collapsePanel()
  } catch (_) { /* ignore */ }
}

// ─── VIEW ROUTING ─────────────────────────────────────────────────────────────

function migrateListViewMode (settings) {
  const raw = settings?.listViewMode || settings?.defaultView || 'today'
  if (raw === 'pomodoro' || raw === 'focus') return 'today'
  const map = {
    master: 'list',
    list: 'list',
    today: 'today',
    category: 'list',
    calendar: 'list'
  }
  return map[raw] || 'today'
}

function openPomodoro () {
  panelMode = 'pomodoro'
  syncPanelChrome()
  renderPomodoro()
  if (window.rmp?.makeKey) window.rmp.makeKey()
}

function showTasksPanel () {
  panelMode = 'tasks'
  syncPanelChrome()
  renderCurrentView()
}

function syncPanelChrome () {
  document.getElementById('toolbar-tasks')?.classList.toggle('hidden', panelMode !== 'tasks')
  document.getElementById('toolbar-pomodoro')?.classList.toggle('hidden', panelMode !== 'pomodoro')
  document.getElementById('btn-add')?.classList.toggle('hidden', panelMode === 'pomodoro')
  updateSearchRowVisibility()
}

function closeFooterMenu () {
  footerMenuOpen = false
  document.getElementById('footer-menu')?.classList.add('hidden')
  document.getElementById('btn-more')?.setAttribute('aria-expanded', 'false')
}

function toggleFooterMenu () {
  footerMenuOpen = !footerMenuOpen
  document.getElementById('footer-menu')?.classList.toggle('hidden', !footerMenuOpen)
  document.getElementById('btn-more')?.setAttribute('aria-expanded', footerMenuOpen ? 'true' : 'false')
}

function setListViewMode (mode) {
  listViewMode = mode
  if (!data.settings) data.settings = {}
  data.settings.listViewMode = mode
  syncViewToggleUI()
  updateSearchRowVisibility()
  renderCurrentView()
  save()
}

function syncViewToggleUI () {
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    const on = btn.dataset.layout === listViewMode
    btn.classList.toggle('active', on)
    btn.setAttribute('aria-selected', on ? 'true' : 'false')
  })
}

function renderCurrentView () {
  if (panelMode === 'pomodoro') {
    renderPomodoro()
    syncPanelChrome()
    return
  }
  switch (listViewMode) {
    case 'list': renderMaster(); break
    case 'today': renderToday(); break
    default: renderToday(); break
  }
  syncPanelChrome()
  updateExpandHeight()
}

function renderPomodoro () {
  window.RMPFocus?.render(document.getElementById('task-area'))
}

function updateSearchRowVisibility () {
  const row = document.getElementById('search-row')
  const btn = document.getElementById('btn-search-toggle')
  const showRow = panelMode === 'tasks' && searchOpen && listViewMode === 'list'
  if (row) row.classList.toggle('hidden', !showRow)
  btn?.classList.toggle('active', searchOpen && listViewMode === 'list')
  if (listViewMode !== 'list') {
    searchOpen = false
    if (row) row.classList.add('hidden')
    btn?.classList.remove('active')
  }
}

function updateExpandHeight () {
  // Window size is fixed in Swift — shell height handles expand/collapse.
}

// ─── MASTER VIEW ──────────────────────────────────────────────────────────────
function renderMaster () {
  const area = document.getElementById('task-area')
  let tasks = data.tasks.filter(t => t.status !== 'archived')

  if (searchQuery) {
    const q = searchQuery.toLowerCase()
    tasks = tasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q)
    )
  }
  if (filterCategory) tasks = tasks.filter(t => t.category === filterCategory)

  tasks.sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1
    if (b.status === 'done' && a.status !== 'done') return -1
    return (a.order ?? 0) - (b.order ?? 0)
  })

  if (tasks.length === 0) {
    area.innerHTML = `
      <div class="empty-msg">
        <span class="empty-icon">✓</span>
        All clear
        <span class="empty-hint">Tap <strong>+ Add reminder</strong> to remember something.</span>
      </div>`
    return
  }
  area.innerHTML = ''
  tasks.forEach(task => area.appendChild(buildTaskEl(task)))
}

// ─── TODAY VIEW ───────────────────────────────────────────────────────────────
function sortTodaySection (tasks) {
  return [...tasks].sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1
    if (b.status === 'done' && a.status !== 'done') return -1
    return (a.order ?? 0) - (b.order ?? 0)
  })
}

function renderToday () {
  const area = document.getElementById('task-area')
  const { activeToday, doneToday } = getTodayBuckets()

  area.innerHTML = ''

  if (!activeToday.length && !doneToday.length) {
    area.innerHTML = `
      <div class="empty-msg">
        <span class="empty-icon">☀️</span>
        Nothing for today
        <span class="empty-hint">Add a reminder — e.g. buy eggs at 12 PM.</span>
      </div>`
    return
  }

  const appendSection = (title, tasks) => {
    const header = document.createElement('div')
    header.className = 'section-header'
    header.textContent = title
    area.appendChild(header)
    sortTodaySection(tasks).forEach(t => area.appendChild(buildTaskEl(t)))
  }

  if (activeToday.length) appendSection('Today', activeToday)
  if (doneToday.length) appendSection('Done', doneToday)
}

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────
function renderCalendar () {
  const area  = document.getElementById('task-area')
  const year  = calendarDate.getFullYear()
  const month = calendarDate.getMonth()
  const monthName = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const tasksByDate = {}
  const ensure = key => { if (!tasksByDate[key]) tasksByDate[key] = [] }

  data.tasks.forEach(t => {
    if (!t.deadline || t.status === 'archived') return
    const d = new Date(t.deadline)
    if (d.getFullYear() === year && d.getMonth() === month) {
      const key = d.getDate()
      ensure(key)
      tasksByDate[key].push(t)
    }
  })

  const today = new Date()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const dayLabels = ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => `<div class="cal-day-label">${d}</div>`).join('')
  let cells = ''
  for (let i = 0; i < firstDay; i++) cells += '<div class="cal-day other-month"></div>'
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday    = today.getDate() === d && today.getMonth() === month && today.getFullYear() === year
    const isSelected = calendarSelectedDay === d
    const entry      = tasksByDate[d]
    const allTasks   = entry || []
    const hasOverdue = allTasks.some(t => t.status !== 'done' && new Date(t.deadline) < today)
    const allDone    = allTasks.length > 0 && allTasks.every(t => t.status === 'done')

    let countHtml = ''
    if (allTasks.length) {
      const cls = hasOverdue ? 'overdue' : allDone ? 'done' : 'pending'
      countHtml = `<span class="cal-task-count ${cls}">${allTasks.length}</span>`
    }

    let cls = 'cal-day'
    if (isToday)       cls += ' today'
    if (isSelected)    cls += ' selected'
    if (allTasks.length) cls += ' has-tasks'

    cells += `<div class="${cls}" data-day="${d}">
      <span class="cal-date">${d}</span>
      ${countHtml}
    </div>`
  }

  area.innerHTML = `
    <div class="calendar-wrap">
      <div class="calendar-header">
        <button class="cal-nav" id="cal-prev">‹</button>
        <span class="cal-month">${monthName}</span>
        <button class="cal-nav" id="cal-next">›</button>
      </div>
      <div class="calendar-grid">${dayLabels}${cells}</div>
      <div id="cal-day-panel" class="cal-day-panel"></div>
    </div>
  `

  document.getElementById('cal-prev').addEventListener('click', e => {
    e.stopPropagation()
    calendarSelectedDay = null
    calendarDate.setMonth(month - 1)
    renderCalendar()
  })
  document.getElementById('cal-next').addEventListener('click', e => {
    e.stopPropagation()
    calendarSelectedDay = null
    calendarDate.setMonth(month + 1)
    renderCalendar()
  })

  area.querySelectorAll('.cal-day[data-day]').forEach(el => {
    el.addEventListener('click', () => {
      const day = parseInt(el.dataset.day)
      if (calendarSelectedDay === day) {
        calendarSelectedDay = null
        renderCalendar()
        return
      }
      calendarSelectedDay = day
      const tasks = tasksByDate[day] || []
      const label = new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      showCalendarDayPanel(tasks, label)
      area.querySelectorAll('.cal-day').forEach(c => c.classList.remove('selected'))
      el.classList.add('selected')
    })
  })

  if (calendarSelectedDay !== null) {
    const tasks = tasksByDate[calendarSelectedDay] || []
    const label = new Date(year, month, calendarSelectedDay).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    showCalendarDayPanel(tasks, label)
    area.querySelector(`.cal-day[data-day="${calendarSelectedDay}"]`)?.classList.add('selected')
  }
}

function showCalendarDayPanel (tasks, label) {
  const panel = document.getElementById('cal-day-panel')
  if (!panel) return

  panel.innerHTML = `<div class="cal-panel-header">${label}</div>`

  if (!tasks.length) {
    const empty = document.createElement('div')
    empty.className = 'cal-panel-empty'
    empty.textContent = 'No tasks scheduled'
    panel.appendChild(empty)
    updateExpandHeight()
    return
  }

  const list = document.createElement('div')
  list.className = 'cal-panel-tasks'
  tasks.forEach(t => list.appendChild(buildTaskEl(t)))
  panel.appendChild(list)

  updateExpandHeight()
}

// ─── CATEGORY VIEW ────────────────────────────────────────────────────────────
function renderCategory () {
  const area       = document.getElementById('task-area')
  const categories = {}

  data.tasks.filter(t => t.status !== 'archived').forEach(t => {
    const cat = t.category || 'Uncategorized'
    if (!categories[cat]) categories[cat] = []
    categories[cat].push(t)
  })

  area.innerHTML = ''
  if (!Object.keys(categories).length) {
    area.innerHTML = '<div class="empty-msg">No tasks yet</div>'
    return
  }

  Object.entries(categories).sort().forEach(([cat, tasks]) => {
    const header = document.createElement('div')
    header.className = 'section-header'
    header.textContent = `${cat} (${tasks.length})`
    area.appendChild(header)
    tasks.forEach(t => area.appendChild(buildTaskEl(t)))
  })
}

function showToast (message) {
  const toast = document.getElementById('app-toast')
  if (!toast) return
  toast.textContent = message
  toast.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2000)
}

// ─── TASK ELEMENT ─────────────────────────────────────────────────────────────
function buildTaskEl (task) {
  const el = document.createElement('div')
  el.className = 'task-item'
  el.dataset.id = task.id
  el.draggable = true

  const isDone   = task.status === 'done'
  const isStrike = isDone
  const sub = taskSubtitle(task)
  const subHtml = sub
    ? `<div class="task-subtitle${sub.cls ? ` ${sub.cls}` : ''}">${escHtml(sub.text)}</div>`
    : ''

  el.innerHTML = `
    <div class="task-main">
      <div class="task-check ${isDone ? 'done' : ''}" role="button" aria-label="${isDone ? 'Mark incomplete' : 'Mark complete'}" tabindex="0"></div>
      <span class="task-title task-title--clickable ${isStrike ? 'strike' : ''}">${escHtml(task.title)}</span>
      <div class="task-actions">
        <button type="button" class="task-icon-btn task-delete-btn" data-tooltip="Delete" aria-label="Delete">✕</button>
      </div>
    </div>
    ${subHtml}
  `

  el.querySelector('.task-title').addEventListener('click', e => {
    e.stopPropagation()
    pinExpandInteraction()
    openForm(task.id)
  })

  el.querySelector('.task-check').addEventListener('click', e => {
    e.stopPropagation()
    cycleStatus(task.id)
  })

  el.querySelector('.task-delete-btn').addEventListener('click', e => {
    e.stopPropagation()
    deleteTask(task.id)
  })
  el.addEventListener('dragstart', e => {
    if (e.target.closest('.task-action-btn, .task-icon-btn, .subtask-inline')) { e.preventDefault(); return }
    dragSrcId = task.id
    el.classList.add('dragging')
  })
  el.addEventListener('dragend',   () => {
    el.classList.remove('dragging')
    document.querySelectorAll('.task-item.drag-over').forEach(x => x.classList.remove('drag-over'))
  })
  el.addEventListener('dragover',  e => {
    e.preventDefault()
    document.querySelectorAll('.task-item.drag-over').forEach(x => x.classList.remove('drag-over'))
    el.classList.add('drag-over')
  })
  el.addEventListener('drop', e => {
    e.preventDefault()
    el.classList.remove('drag-over')
    if (dragSrcId && dragSrcId !== task.id) reorderTask(dragSrcId, task.id)
    dragSrcId = null
  })

  return el
}

// ─── TASK ACTIONS ─────────────────────────────────────────────────────────────
function deleteTask (id) {
  const task = data.tasks.find(t => t.id === id)
  if (!task) return
  task.status = 'archived'
  task.strikethrough = true
  save()
  showToast('Task deleted')
}

function toggleTodayPlan (id) {
  const task = data.tasks.find(t => t.id === id)
  if (!task || task.status === 'archived') return
  const key = todayKey()
  if (task.plannedFor === key) {
    task.plannedFor = null
    showToast('Removed from today')
  } else {
    task.plannedFor = key
    showToast('Added to today')
  }
  save()
}

function syncSubtasksWithTaskStatus (task) {
  if (!task?.subtasks?.length) return
  if (task.status === 'done') {
    task.subtasks.forEach(s => { s.done = true })
  }
}

function cycleStatus (id) {
  const task = data.tasks.find(t => t.id === id)
  if (!task) return
  task.status = task.status === 'done' ? 'todo' : 'done'
  task.strikethrough = task.status === 'done'
  task.completedAt = task.status === 'done' ? new Date().toISOString() : null
  syncSubtasksWithTaskStatus(task)
  save()
}

async function copyTaskToClipboard (task, btn) {
  await window.rmp.copyToClipboard(task.title)
  showToast('Title copied')
  if (btn) {
    const prev = btn.textContent
    btn.textContent = 'Copied'
    btn.classList.add('copied')
    setTimeout(() => {
      btn.textContent = prev
      btn.classList.remove('copied')
    }, 1500)
  }
}

function toggleSubtask (taskId, subId) {
  const task = data.tasks.find(t => t.id === taskId)
  const sub  = task?.subtasks?.find(s => s.id === subId)
  if (!sub) return
  sub.done = !sub.done
  save()
}

function reorderTask (fromId, toId) {
  const active = data.tasks.filter(t => t.status !== 'archived')
  const fromIdx = active.findIndex(t => t.id === fromId)
  const toIdx   = active.findIndex(t => t.id === toId)
  if (fromIdx === -1 || toIdx === -1) return
  const [moved] = active.splice(fromIdx, 1)
  active.splice(toIdx, 0, moved)
  active.forEach((t, i) => t.order = i)
  save()
}

async function save () {
  await window.rmp.write(data)
  renderBar()
  if (isExpanded) renderCurrentView()
}

// ─── IN-PANEL SHEETS (task form, notes, settings) ─────────────────────────────
function openSheet (view, taskId = null, options = {}) {
  clearHoverTimers()
  if (!isExpanded) expandPanel('user')
  else pinExpandInteraction()

  popupOpen = true
  window.rmp.setNotchHoverSuspended?.(true)
  if (window.rmp?.makeKey) window.rmp.makeKey()
  window.RMPSheet.open(view, taskId, {
    getData: () => data,
    formDefaults: options.formDefaults || {},
    onSave: async (d) => {
      data = d
      await window.rmp.write(data)
      renderBar()
      if (isExpanded) renderCurrentView()
    },
    onClose: () => closeSheet(false),
    onCommit: () => closeSheet(true),
    onResize: () => {}
  })
}

function closeSheet (wasCommit) {
  const overlay = document.getElementById('sheet-overlay')
  const root = document.getElementById('sheet-root')
  if (overlay) {
    overlay.classList.add('hidden')
    overlay.setAttribute('aria-hidden', 'true')
  }
  if (root) root.innerHTML = ''
  popupOpen = false
  window.rmp.setNotchHoverSuspended?.(false)
  window.rmp.refreshHover?.()
  if (wasCommit && isExpanded) renderCurrentView()
  collapseIfPointerOutsideNotch()
}

function openForm (taskId, options = {}) {
  openSheet('task-form', taskId || null, options)
}

// ─── CATEGORY FILTER ──────────────────────────────────────────────────────────
function populateCategoryFilter () {
  const sel  = document.getElementById('filter-category')
  const cats = data.categories || []
  sel.innerHTML = '<option value="">All</option>' +
    cats.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')
  sel.value = filterCategory
}

// ─── CAROUSEL ────────────────────────────────────────────────────────────────
function startCarousel () {
  if (carouselTimer) clearInterval(carouselTimer)
  const tasks = data.tasks.filter(t => t.status !== 'done' && t.status !== 'archived')
  carouselIdx = 0
  setCarouselText(getBarCarouselText(), false)
  if (tasks.length > 1) {
    carouselTimer = setInterval(() => {
      carouselIdx = (carouselIdx + 1) % tasks.length
      const t = tasks[carouselIdx]
      const sub = taskSubtitle(t)
      const hint = sub?.cls === 'remind' ? ` · ${sub.text}` : ''
      setCarouselText(`${t.title}${hint}`, true)
    }, 4000)
  }
}

function setCarouselText (text, animate) {
  const el = document.getElementById('carousel-text')
  if (!el) return
  if (!animate) { el.textContent = text; el.style.animation = ''; return }
  el.style.animation = 'carouselSlideOut 0.25s ease forwards'
  setTimeout(() => {
    el.textContent = text
    el.style.animation = 'carouselSlideIn 0.25s ease forwards'
  }, 260)
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
function setupMousePassthrough () {
  // Intentionally empty — see comment in setHeight / prior mousemove passthrough bug.
}

/** Native NotchPanel tracks the cursor (WKWebView misses transparent areas). */
function setupNativeHover () {
  window.rmp.on('notch:hover-enter', () => {
    if (popupOpen || notchDragActive) return
    clearHoverTimers()
    if (!isExpanded) expandPanel('hover')
    else window.rmp.bringToFront()
  })

  window.rmp.on('notch:hover-leave', () => {
    if (popupOpen || !isExpanded || notchDragActive || expandSource !== 'hover') return
    clearHoverTimers()
    hoverCollapseTimer = setTimeout(() => {
      hoverCollapseTimer = null
      if (!popupOpen && isExpanded && !notchDragActive && expandSource === 'hover') {
        collapsePanel()
      }
    }, HOVER_LEAVE_MS)
  })
}

let notchDragActive = false

function setupEvents () {
  const notchBar = document.getElementById('notch-bar')
  const appShell = document.getElementById('app-shell')
  let didDrag = false
  let dragStartX = null
  let dragStartY = null

  appShell?.addEventListener('mouseenter', pinExpandInteraction)
  appShell?.addEventListener('mousedown', pinExpandInteraction, true)

  notchBar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    window.rmp.bringToFront()
    didDrag = false
    dragStartX = e.screenX
    dragStartY = e.screenY
  })

  document.addEventListener('mousemove', (e) => {
    if (dragStartX === null || dragStartY === null) return
    const dx = e.screenX - dragStartX
    const dy = e.screenY - dragStartY
    if (!didDrag && Math.hypot(dx, dy) < 6) return
    didDrag = true
    notchDragActive = true
    clearHoverTimers()
    window.rmp.moveWindow(dx, 0)
    dragStartX = e.screenX
    dragStartY = e.screenY
  })

  document.addEventListener('mouseup', () => {
    dragStartX = null
    dragStartY = null
    notchDragActive = false
  })

  notchBar.addEventListener('click', (e) => {
    if (didDrag) { didDrag = false; return }
    if (e.target.closest('button')) return
    if (!isExpanded) expandPanel('user')
    else pinExpandInteraction()
  })

  document.getElementById('btn-toggle').addEventListener('click', e => {
    e.stopPropagation()
    togglePanel()
  })

  // View mode toggle
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      setListViewMode(btn.dataset.layout)
    })
  })

  // Search
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value
    renderCurrentView()
  })
  document.getElementById('filter-category')?.addEventListener('change', e => {
    filterCategory = e.target.value
    renderCurrentView()
  })

  document.getElementById('btn-back-tasks')?.addEventListener('click', e => {
    e.stopPropagation()
    showTasksPanel()
  })
  document.getElementById('btn-add').addEventListener('click', e => {
    e.stopPropagation()
    closeFooterMenu()
    pinExpandInteraction()
    openForm(null, {
      formDefaults: {
        planForToday: listViewMode === 'today',
        remindEnabled: true
      }
    })
  })

  document.getElementById('btn-more').addEventListener('click', e => {
    e.stopPropagation()
    toggleFooterMenu()
  })

  document.getElementById('footer-menu')?.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action
    if (!action) return
    e.stopPropagation()
    closeFooterMenu()
    pinExpandInteraction()
    if (action === 'focus') {
      if (panelMode === 'pomodoro') showTasksPanel()
      else openPomodoro()
    } else if (action === 'note') {
      openSheet('quick-note', null)
    } else if (action === 'settings') {
      openSheet('settings', null)
    }
  })

  document.getElementById('btn-search-toggle')?.addEventListener('click', e => {
    e.stopPropagation()
    if (listViewMode !== 'list') setListViewMode('list')
    searchOpen = !searchOpen
    updateSearchRowVisibility()
    if (searchOpen) document.getElementById('search-input')?.focus()
  })

  document.addEventListener('click', () => closeFooterMenu())

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    if (popupOpen) { closeSheet(false); return }
    if (isExpanded) collapsePanel()
  })
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function escHtml (str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ─── START ────────────────────────────────────────────────────────────────────
init()
