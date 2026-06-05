// ─── STATE ───────────────────────────────────────────────────────────────────
let data = { tasks: [], categories: [], weeklyHistory: [], settings: {}, quickNote: '' }
let currentView   = 'master'
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
  try {
    applyNotchGeometry(await window.rmp.getGeometry())
  } catch (_) { /* fallback defaults */ }
  renderBar()
  setupEvents()
  setupMousePassthrough()

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

function renderBar () {
  const active = data.tasks.filter(t => t.status !== 'archived')
  const done   = active.filter(t => t.status === 'done').length
  const total  = active.length
  const pct    = total > 0 ? Math.round((done / total) * 100) : 0

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
  const progressText = total > 0 ? `${pct}% · ${done}/${total}` : '—'
  document.getElementById('bar-progress').textContent = progressText
  window.rmp.setTrayTitle(total > 0 ? ` ${pct}%` : '')
  startCarousel()
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
  populateCategoryFilter()
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
function renderCurrentView () {
  if (currentView === 'master')   renderMaster()
  if (currentView === 'today')    renderToday()
  if (currentView === 'calendar') renderCalendar()
  if (currentView === 'category') renderCategory()
  updateExpandHeight()
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
    area.innerHTML = '<div class="empty-msg">No tasks yet — add one below</div>'
    return
  }
  area.innerHTML = ''
  tasks.forEach(task => area.appendChild(buildTaskEl(task)))
}

// ─── TODAY VIEW ───────────────────────────────────────────────────────────────
function renderToday () {
  const area = document.getElementById('task-area')
  const now  = new Date(); now.setHours(0, 0, 0, 0)

  const overdue = data.tasks.filter(t => !['done','archived'].includes(t.status) && t.deadline && new Date(t.deadline) < now)
  const today   = data.tasks.filter(t => {
    if (['done','archived'].includes(t.status) || !t.deadline) return false
    const d = new Date(t.deadline); d.setHours(0,0,0,0)
    return d.getTime() === now.getTime()
  })
  const overdueIds = new Set(overdue.map(t => t.id))
  const todayIds   = new Set(today.map(t => t.id))
  const pinned = data.tasks.filter(t =>
    t.pinnedToToday &&
    !['done','archived'].includes(t.status) &&
    !overdueIds.has(t.id) &&
    !todayIds.has(t.id)
  )

  area.innerHTML = ''

  if (!overdue.length && !today.length && !pinned.length) {
    area.innerHTML = '<div class="empty-msg">You\'re all clear today</div>'
    return
  }

  if (overdue.length) { area.innerHTML += `<div class="section-header">Overdue</div>`; overdue.forEach(t => area.appendChild(buildTaskEl(t))) }
  if (today.length)   { area.innerHTML += `<div class="section-header">Due Today</div>`; today.forEach(t => area.appendChild(buildTaskEl(t))) }
  if (pinned.length)  { area.innerHTML += `<div class="section-header">Pinned to Today</div>`; pinned.forEach(t => area.appendChild(buildTaskEl(t))) }
}

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────
function renderCalendar () {
  const area  = document.getElementById('task-area')
  const year  = calendarDate.getFullYear()
  const month = calendarDate.getMonth()
  const monthName = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // tasksByDate[day] = { due: [], doing: [] }
  // "due"   = tasks whose deadline falls on this date
  // "doing" = tasks pinned to today (only on today's date)
  const tasksByDate = {}
  const ensure = key => { if (!tasksByDate[key]) tasksByDate[key] = { due: [], doing: [] } }

  data.tasks.forEach(t => {
    if (!t.deadline || t.status === 'archived') return
    const d = new Date(t.deadline)
    if (d.getFullYear() === year && d.getMonth() === month) {
      const key = d.getDate()
      ensure(key)
      tasksByDate[key].due.push(t)
    }
  })

  const today    = new Date()
  const todayKey = today.getDate()
  if (today.getFullYear() === year && today.getMonth() === month) {
    data.tasks.forEach(t => {
      if (!t.pinnedToToday || t.status === 'archived') return
      ensure(todayKey)
      // avoid duplicate if task also has today as its deadline
      if (!tasksByDate[todayKey].due.find(x => x.id === t.id)) {
        tasksByDate[todayKey].doing.push(t)
      }
    })
  }

  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const dayLabels = ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => `<div class="cal-day-label">${d}</div>`).join('')
  let cells = ''
  for (let i = 0; i < firstDay; i++) cells += '<div class="cal-day other-month"></div>'
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday    = today.getDate() === d && today.getMonth() === month && today.getFullYear() === year
    const isSelected = calendarSelectedDay === d
    const entry      = tasksByDate[d]
    const allTasks   = entry ? [...entry.due, ...entry.doing] : []
    const hasOverdue = entry?.due.some(t => t.status !== 'done' && new Date(t.deadline) < today)
    const hasDoing   = entry?.doing.length > 0
    const allDone    = allTasks.length > 0 && allTasks.every(t => t.status === 'done')

    let countHtml = ''
    if (allTasks.length) {
      const cls = hasOverdue ? 'overdue' : allDone ? 'done' : hasDoing ? 'doing' : 'pending'
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
      const entry = tasksByDate[day] || { due: [], doing: [] }
      const label = new Date(year, month, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      showCalendarDayPanel(entry, label)
      area.querySelectorAll('.cal-day').forEach(c => c.classList.remove('selected'))
      el.classList.add('selected')
    })
  })

  if (calendarSelectedDay !== null && tasksByDate[calendarSelectedDay] !== undefined) {
    const entry = tasksByDate[calendarSelectedDay] || { due: [], doing: [] }
    const label = new Date(year, month, calendarSelectedDay).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    showCalendarDayPanel(entry, label)
  }
}

function showCalendarDayPanel (entry, label) {
  const panel = document.getElementById('cal-day-panel')
  if (!panel) return

  const { due = [], doing = [] } = entry
  panel.innerHTML = `<div class="cal-panel-header">${label}</div>`

  if (!due.length && !doing.length) {
    panel.innerHTML += '<div class="cal-panel-empty">No tasks scheduled</div>'
    updateExpandHeight()
    return
  }

  if (due.length) {
    const section = document.createElement('div')
    section.innerHTML = `<div class="cal-panel-section-label deadline-label">Deadline</div>`
    const list = document.createElement('div')
    due.forEach(t => list.appendChild(buildTaskEl(t)))
    section.appendChild(list)
    panel.appendChild(section)
  }

  if (doing.length) {
    const section = document.createElement('div')
    section.innerHTML = `<div class="cal-panel-section-label doing-label">Doing Today</div>`
    const list = document.createElement('div')
    doing.forEach(t => list.appendChild(buildTaskEl(t)))
    section.appendChild(list)
    panel.appendChild(section)
  }

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
    area.innerHTML += `<div class="section-header">${cat} (${tasks.length})</div>`
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

  let deadlineTag = ''
  if (task.deadline) {
    const diff = Math.ceil((new Date(task.deadline) - new Date()) / (1000 * 60 * 60 * 24))
    let cls = 'deadline', label = ''
    if (diff < 0)      { cls = 'deadline overdue'; label = `${Math.abs(diff)}d overdue` }
    else if (diff === 0) { cls = 'deadline soon';   label = 'due today' }
    else if (diff === 1) { cls = 'deadline soon';   label = 'tomorrow' }
    else if (diff <= 3)  { cls = 'deadline soon';   label = `${diff}d left` }
    else label = new Date(task.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    deadlineTag = `<span class="tag ${cls}">${label}</span>`
  }

  const agentTag = task.addedBy && task.addedBy !== 'user' ? `<span class="tag agent">via ${task.addedBy}</span>` : ''
  const catTag   = task.category                           ? `<span class="tag category">${task.category}</span>` : ''
  const recTag   = task.recurring?.enabled                 ? `<span class="tag recurring">${task.recurring.interval}</span>` : ''

  let subtaskHTML = ''
  if (task.subtasks?.length) {
    const doneSubs = task.subtasks.filter(s => s.done).length
    const pct = Math.round((doneSubs / task.subtasks.length) * 100)
    subtaskHTML = `
      <div class="subtask-progress">
        <div class="subtask-bar-bg"><div class="subtask-bar-fill" style="width:${pct}%"></div></div>
        <span class="subtask-count">${doneSubs}/${task.subtasks.length}</span>
      </div>
      <div class="subtask-inline">
        ${task.subtasks.map(s => `
          <div class="subtask-inline-item">
            <div class="subtask-inline-check ${s.done ? 'done' : ''}" data-sub-id="${s.id}" data-task-id="${task.id}">${s.done ? '✓' : ''}</div>
            <span class="subtask-inline-title ${s.done ? 'done' : ''}">${escHtml(s.title)}</span>
          </div>
        `).join('')}
      </div>`
  }

  el.innerHTML = `
    <div class="task-main">
      <div class="task-check ${isDone ? 'done' : ''}" role="button" aria-label="${isDone ? 'Mark incomplete' : 'Mark complete'}" tabindex="0" data-tooltip="${isDone ? 'Mark incomplete' : 'Mark complete'}"></div>
      <span class="task-title task-title--clickable ${isStrike ? 'strike' : ''}">${escHtml(task.title)}</span>
      <div class="task-actions">
        <button type="button" class="task-action-btn task-today-btn ${task.pinnedToToday ? 'pinned' : ''}" data-tooltip="${task.pinnedToToday ? 'Unpin from Today' : 'Pin to Today'}">${task.pinnedToToday ? 'Pinned' : 'Today'}</button>
        <button type="button" class="task-icon-btn task-copy-btn" data-tooltip="Copy" aria-label="Copy task">⎘</button>
        <button type="button" class="task-icon-btn task-icon-btn--danger task-delete-btn" data-tooltip="Delete" aria-label="Delete task">🗑</button>
      </div>
    </div>
    <div class="task-meta">${deadlineTag}${catTag}${agentTag}${recTag}</div>
    ${subtaskHTML}
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

  el.querySelector('.task-today-btn').addEventListener('click', e => {
    e.stopPropagation()
    task.pinnedToToday = !task.pinnedToToday
    save()
  })
  el.querySelector('.task-copy-btn').addEventListener('click', e => {
    e.stopPropagation()
    copyTaskToClipboard(task, e.currentTarget)
  })
  el.querySelector('.task-delete-btn').addEventListener('click', e => {
    e.stopPropagation()
    deleteTask(task.id)
  })
  el.querySelectorAll('.subtask-inline-check').forEach(chk => {
    chk.addEventListener('click', e => { e.stopPropagation(); toggleSubtask(chk.dataset.taskId, chk.dataset.subId) })
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
    btn.classList.add('copied')
    setTimeout(() => btn.classList.remove('copied'), 1500)
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
function openSheet (view, taskId = null) {
  clearHoverTimers()
  if (!isExpanded) expandPanel('user')
  else pinExpandInteraction()

  popupOpen = true
  window.rmp.setNotchHoverSuspended?.(true)
  if (window.rmp?.makeKey) window.rmp.makeKey()
  window.RMPSheet.open(view, taskId, {
    getData: () => data,
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

function openForm (taskId) {
  openSheet('task-form', taskId || null)
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
  setCarouselText(tasks.length ? tasks[0].title : 'No tasks', false)
  if (tasks.length > 1) {
    carouselTimer = setInterval(() => {
      carouselIdx = (carouselIdx + 1) % tasks.length
      setCarouselText(tasks[carouselIdx].title, true)
    }, 3000)
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

  // View tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', e => {
      e.stopPropagation()
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      currentView = tab.dataset.view
      renderCurrentView()
    })
  })

  // Search
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value
    renderCurrentView()
  })
  document.getElementById('filter-category').addEventListener('change', e => {
    filterCategory = e.target.value
    renderCurrentView()
  })

  // Footer buttons → open popups
  document.getElementById('btn-add').addEventListener('click', e => {
    e.stopPropagation()
    pinExpandInteraction()
    openForm(null)
  })
  document.getElementById('btn-quick-note').addEventListener('click', e => {
    e.stopPropagation()
    openSheet('quick-note', null)
  })
  document.getElementById('btn-settings').addEventListener('click', e => {
    e.stopPropagation()
    openSheet('settings', null)
  })

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
