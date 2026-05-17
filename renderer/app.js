// ─── ICONS ───────────────────────────────────────────────────────────────────
const ICONS = {
  tasks: '●', urgent: '⚠', overdue: '⚠', dueToday: '📅',
  inProgress: '⚙', agent: '🤖', recurring: '↺',
  deadline: '📅', priority_urgent: '🔴', priority_high: '🟡',
  priority_normal: '⚪', priority_low: '🔵'
}

function ic (key) {
  return data.settings?.useIcons ? ICONS[key] + ' ' : ''
}

// ─── STATE ───────────────────────────────────────────────────────────────────
let data = { tasks: [], categories: [], weeklyHistory: [], settings: {}, quickNote: '' }
let currentView   = 'master'
let isExpanded    = false
let isHiddenMode  = false
let dragSrcIndex  = null
let calendarDate  = new Date()
let searchQuery   = ''
let filterCategory = ''

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init () {
  data = await window.rmp.read()
  renderBar()
  applyIconMode()
  setupEvents()

  window.rmp.on('storage:changed', async () => {
    data = await window.rmp.read()
    renderBar()
    applyIconMode()
    if (isExpanded) renderCurrentView()
  })

  window.rmp.on('notch:pulse', () => {
    document.getElementById('notch-bar').classList.add('pulsing')
    setTimeout(() => document.getElementById('notch-bar').classList.remove('pulsing'), 3000)
  })

  window.rmp.on('notch:show-temp', () => {
    setHiddenMode(false)
    document.getElementById('notch-bar').classList.add('pulsing')
    setTimeout(() => document.getElementById('notch-bar').classList.remove('pulsing'), 3000)
  })

  window.rmp.on('notch:entering-hidden', () => setHiddenMode(true))
  window.rmp.on('notch:leaving-hidden',  () => setHiddenMode(false))
  window.rmp.on('shortcut:toggle', () => togglePanel())

  // Popup opened: collapse panel instantly (no animation)
  window.rmp.on('panel:collapse-instant', () => {
    isExpanded = false
    const panel = document.getElementById('panel')
    panel.classList.remove('panel-entering', 'panel-leaving')
    panel.classList.add('hidden')
    document.getElementById('btn-toggle').textContent = '▾'
  })
}

// ─── BAR ──────────────────────────────────────────────────────────────────────
function applyIconMode () {
  const useIcons = data.settings?.useIcons
  document.getElementById('btn-quick-note').textContent = useIcons ? '📝 Note' : 'Note'
  document.getElementById('btn-settings').textContent   = useIcons ? '⚙ Settings' : 'Settings'
}

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

  document.getElementById('bar-count').textContent = `${ic('tasks')}${total} task${total !== 1 ? 's' : ''}`
  const urgentEl = document.getElementById('bar-urgent')
  if (urgent.length > 0) {
    urgentEl.textContent = `${ic('urgent')}${urgent.length} due`
    urgentEl.classList.remove('hidden')
  } else {
    urgentEl.classList.add('hidden')
  }
  document.getElementById('bar-progress').textContent = `${pct}%`
}

// ─── TOGGLE ───────────────────────────────────────────────────────────────────
function togglePanel () {
  if (isExpanded) collapsePanel()
  else expandPanel()
}

function expandPanel () {
  isExpanded = true
  window.rmp.closePopup()
  const panel = document.getElementById('panel')
  panel.classList.remove('hidden', 'panel-leaving')
  panel.classList.add('panel-entering')
  setTimeout(() => panel.classList.remove('panel-entering'), 180)
  document.getElementById('btn-toggle').textContent = '▴'
  renderCurrentView()
  populateCategoryFilter()
  setTimeout(() => window.rmp.expand(panel.scrollHeight), 30)
}

function collapsePanel () {
  isExpanded = false
  window.rmp.closePopup()
  const panel = document.getElementById('panel')
  document.getElementById('btn-toggle').textContent = '▾'
  panel.classList.remove('panel-entering')
  panel.classList.add('panel-leaving')
  setTimeout(() => {
    panel.classList.remove('panel-leaving')
    panel.classList.add('hidden')
    window.rmp.collapse()
  }, 180)
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
  setTimeout(() => {
    const panel = document.getElementById('panel')
    window.rmp.expand(panel.scrollHeight)
  }, 30)
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

  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 }
  tasks.sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1
    if (b.status === 'done' && a.status !== 'done') return -1
    const pa = priorityOrder[a.priority] ?? 2
    const pb = priorityOrder[b.priority] ?? 2
    if (pa !== pb) return pa - pb
    if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline)
    if (a.deadline) return -1
    if (b.deadline) return 1
    return (a.order ?? 0) - (b.order ?? 0)
  })

  const done  = data.tasks.filter(t => {
    if (t.status !== 'done' || !t.completedAt) return false
    return new Date(t.completedAt) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  }).length
  const total = data.tasks.filter(t => t.status !== 'archived').length
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0

  area.innerHTML = `<div class="progress-ring">This week: <span>${pct}% complete</span> (${done}/${total})</div>`

  if (tasks.length === 0) {
    area.innerHTML += '<div class="empty-msg">No tasks yet — add one below</div>'
    return
  }
  tasks.forEach((task, i) => area.appendChild(buildTaskEl(task, i)))
}

// ─── TODAY VIEW ───────────────────────────────────────────────────────────────
function renderToday () {
  const area = document.getElementById('task-area')
  const now  = new Date(); now.setHours(0, 0, 0, 0)

  const overdue    = data.tasks.filter(t => !['done','archived'].includes(t.status) && t.deadline && new Date(t.deadline) < now)
  const today      = data.tasks.filter(t => {
    if (['done','archived'].includes(t.status) || !t.deadline) return false
    const d = new Date(t.deadline); d.setHours(0,0,0,0)
    return d.getTime() === now.getTime()
  })
  const inProgress = data.tasks.filter(t => t.status === 'in-progress')

  area.innerHTML = ''

  if (!overdue.length && !today.length && !inProgress.length) {
    area.innerHTML = '<div class="empty-msg">You\'re all clear today 🎉</div>'
    return
  }

  if (overdue.length)    { area.innerHTML += `<div class="section-header">${ic('overdue')}Overdue</div>`; overdue.forEach(t => area.appendChild(buildTaskEl(t))) }
  if (today.length)      { area.innerHTML += `<div class="section-header">${ic('dueToday')}Due Today</div>`; today.forEach(t => area.appendChild(buildTaskEl(t))) }
  if (inProgress.length) { area.innerHTML += `<div class="section-header">${ic('inProgress')}In Progress</div>`; inProgress.forEach(t => area.appendChild(buildTaskEl(t))) }
}

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────
function renderCalendar () {
  const area  = document.getElementById('task-area')
  const year  = calendarDate.getFullYear()
  const month = calendarDate.getMonth()
  const monthName = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const tasksByDate = {}
  data.tasks.forEach(t => {
    if (!t.deadline || t.status === 'archived') return
    const d = new Date(t.deadline)
    if (d.getFullYear() === year && d.getMonth() === month) {
      const key = d.getDate()
      if (!tasksByDate[key]) tasksByDate[key] = []
      tasksByDate[key].push(t)
    }
  })

  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today       = new Date()

  const dayLabels = ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => `<div class="cal-day-label">${d}</div>`).join('')
  let cells = ''
  for (let i = 0; i < firstDay; i++) cells += '<div class="cal-day other-month"></div>'
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday  = today.getDate() === d && today.getMonth() === month && today.getFullYear() === year
    const tasks    = tasksByDate[d] || []
    const hasUrgent = tasks.some(t => t.priority === 'urgent')
    cells += `<div class="cal-day${isToday ? ' today' : ''}${tasks.length ? ' has-tasks' : ''}${hasUrgent ? ' has-urgent' : ''}"
      data-day="${d}" title="${tasks.map(t => t.title).join(', ')}">${d}</div>`
  }

  area.innerHTML = `
    <div class="calendar-wrap">
      <div class="calendar-header">
        <button class="cal-nav" id="cal-prev">‹</button>
        <span class="cal-month">${monthName}</span>
        <button class="cal-nav" id="cal-next">›</button>
      </div>
      <div class="calendar-grid">${dayLabels}${cells}</div>
    </div>
  `

  document.getElementById('cal-prev').addEventListener('click', e => { e.stopPropagation(); calendarDate.setMonth(month - 1); renderCalendar() })
  document.getElementById('cal-next').addEventListener('click', e => { e.stopPropagation(); calendarDate.setMonth(month + 1); renderCalendar() })

  area.querySelectorAll('.cal-day[data-day]').forEach(el => {
    el.addEventListener('click', () => {
      const tasks = tasksByDate[parseInt(el.dataset.day)] || []
      if (tasks.length) showCalendarDayTasks(tasks, `${monthName} ${el.dataset.day}`)
    })
  })
}

function showCalendarDayTasks (tasks, label) {
  const area = document.getElementById('task-area')
  const existing = area.querySelector('.cal-day-tasks')
  if (existing) existing.remove()

  const el = document.createElement('div')
  el.className = 'cal-day-tasks'
  el.innerHTML = `<div class="section-header">${label}</div>`
  tasks.forEach(t => el.appendChild(buildTaskEl(t)))

  const backBtn = document.createElement('button')
  backBtn.className = 'footer-btn small'
  backBtn.textContent = '← Back'
  backBtn.style.margin = '6px 10px'
  backBtn.addEventListener('click', () => renderCalendar())
  el.appendChild(backBtn)

  area.innerHTML = ''
  area.appendChild(el)
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

// ─── TASK ELEMENT ─────────────────────────────────────────────────────────────
function buildTaskEl (task, idx) {
  const el = document.createElement('div')
  el.className = 'task-item'
  el.dataset.id = task.id
  el.draggable = true

  const isDone   = task.status === 'done'
  const isStrike = task.strikethrough
  const statusIcon  = isDone ? '✓' : (task.status === 'in-progress' ? '◐' : '')
  const checkClass  = isDone ? 'done' : (task.status === 'in-progress' ? 'in-progress' : '')

  let deadlineTag = ''
  if (task.deadline) {
    const diff = Math.ceil((new Date(task.deadline) - new Date()) / (1000 * 60 * 60 * 24))
    let cls = 'deadline', label = ''
    if (diff < 0)      { cls = 'deadline overdue'; label = `${Math.abs(diff)}d overdue` }
    else if (diff === 0) { cls = 'deadline soon';   label = 'due today' }
    else if (diff === 1) { cls = 'deadline soon';   label = 'tomorrow' }
    else if (diff <= 3)  { cls = 'deadline soon';   label = `${diff}d left` }
    else label = new Date(task.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    deadlineTag = `<span class="tag ${cls}">${ic('deadline')}${label}</span>`
  }

  const agentTag  = task.addedBy && task.addedBy !== 'user'  ? `<span class="tag agent">${ic('agent')}via ${task.addedBy}</span>` : ''
  const catTag    = task.category                            ? `<span class="tag category">${task.category}</span>` : ''
  const statusTag = task.status === 'in-progress'            ? `<span class="tag status-inprogress">In Progress</span>` : ''
  const recTag    = task.recurring?.enabled                  ? `<span class="tag recurring">${ic('recurring')}${task.recurring.interval}</span>` : ''

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
      <div class="task-check ${checkClass}" data-id="${task.id}">${statusIcon}</div>
      <div class="priority-dot ${task.priority || 'normal'}"></div>
      <span class="task-title ${isStrike ? 'strike' : ''} ${isDone ? 'done-text' : ''}">${escHtml(task.title)}</span>
    </div>
    <div class="task-meta">${deadlineTag}${statusTag}${catTag}${agentTag}${recTag}</div>
    ${subtaskHTML}
  `

  el.querySelector('.task-check').addEventListener('click', e => { e.stopPropagation(); cycleStatus(task.id) })
  el.querySelectorAll('.subtask-inline-check').forEach(chk => {
    chk.addEventListener('click', e => { e.stopPropagation(); toggleSubtask(chk.dataset.taskId, chk.dataset.subId) })
  })
  el.addEventListener('click', () => openForm(task.id))
  el.addEventListener('dragstart', () => { dragSrcIndex = idx; el.classList.add('dragging') })
  el.addEventListener('dragend',   () => el.classList.remove('dragging'))
  el.addEventListener('dragover',  e => e.preventDefault())
  el.addEventListener('drop', () => {
    if (dragSrcIndex !== null && dragSrcIndex !== idx) reorderTask(dragSrcIndex, idx)
    dragSrcIndex = null
  })

  return el
}

// ─── TASK ACTIONS ─────────────────────────────────────────────────────────────
function cycleStatus (id) {
  const task = data.tasks.find(t => t.id === id)
  if (!task) return
  const cycle = { 'todo': 'in-progress', 'in-progress': 'done', 'done': 'todo' }
  task.status = cycle[task.status] || 'todo'
  task.completedAt = task.status === 'done' ? new Date().toISOString() : null
  save()
}

function toggleSubtask (taskId, subId) {
  const task = data.tasks.find(t => t.id === taskId)
  const sub  = task?.subtasks?.find(s => s.id === subId)
  if (!sub) return
  sub.done = !sub.done
  save()
}

function reorderTask (fromIdx, toIdx) {
  const active = data.tasks.filter(t => t.status !== 'archived')
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

// ─── OPEN FORM ────────────────────────────────────────────────────────────────
function openForm (taskId) {
  window.rmp.openPopup('task-form', taskId || null)
}

// ─── CATEGORY FILTER ──────────────────────────────────────────────────────────
function populateCategoryFilter () {
  const sel  = document.getElementById('filter-category')
  const cats = data.categories || []
  sel.innerHTML = '<option value="">All</option>' +
    cats.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')
  sel.value = filterCategory
}

// ─── HIDDEN MODE ─────────────────────────────────────────────────────────────
function setHiddenMode (hidden) {
  isHiddenMode = hidden
  const bar  = document.getElementById('notch-bar')
  const hint = document.getElementById('hidden-hint')
  if (hidden) {
    bar.style.display = 'none'
    hint.classList.add('visible')
    if (isExpanded) collapsePanel()
  } else {
    bar.style.display = ''
    hint.classList.remove('visible')
  }
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
function setupEvents () {
  document.getElementById('notch-bar').addEventListener('click', togglePanel)
  document.getElementById('btn-toggle').addEventListener('click', e => { e.stopPropagation(); togglePanel() })

  // Hidden hint
  const hint = document.getElementById('hidden-hint')
  hint.addEventListener('mouseenter', () => { if (isHiddenMode) window.rmp.hintExpand() })
  hint.addEventListener('mouseleave', () => { if (isHiddenMode) window.rmp.hintCollapse() })
  hint.addEventListener('click',      () => { if (isHiddenMode) window.rmp.showNotch() })

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
  document.getElementById('btn-add').addEventListener('click', e => { e.stopPropagation(); openForm(null) })
  document.getElementById('btn-quick-note').addEventListener('click', e => { e.stopPropagation(); window.rmp.openPopup('quick-note', null) })
  document.getElementById('btn-settings').addEventListener('click', e => { e.stopPropagation(); window.rmp.openPopup('settings', null) })

  // Escape collapses panel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isExpanded) collapsePanel()
  })
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function escHtml (str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ─── START ────────────────────────────────────────────────────────────────────
init()
