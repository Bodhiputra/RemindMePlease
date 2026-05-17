// ─── ICONS ───────────────────────────────────────────────────────────────────
const ICONS = {
  tasks: '●', urgent: '⚠', overdue: '⚠', dueToday: '📅',
  inProgress: '⚙', agent: '🤖', recurring: '↺', note: '📝',
  settings: '⚙', deadline: '📅', priority_urgent: '🔴',
  priority_high: '🟡', priority_normal: '⚪', priority_low: '🔵'
}

function ic (key) {
  return data.settings?.useIcons ? ICONS[key] + ' ' : ''
}

// ─── STATE ───────────────────────────────────────────────────────────────────
let data = { tasks: [], categories: [], weeklyHistory: [], settings: {}, quickNote: '' }
let currentView = 'master'
let isExpanded = false
let isHiddenMode = false
let editingTaskId = null
let dragSrcIndex = null
let calendarDate = new Date()
let searchQuery = ''
let filterCategory = ''
let subtaskDraft = []

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init () {
  data = await window.rmp.read()
  renderBar()
  applyIconMode()
  setupEvents()

  window.rmp.on('storage:changed', async () => {
    data = await window.rmp.read()
    renderBar()
    if (isExpanded) renderCurrentView()
  })

  window.rmp.on('notch:pulse', () => {
    document.getElementById('notch-bar').classList.add('pulsing')
    setTimeout(() => document.getElementById('notch-bar').classList.remove('pulsing'), 3000)
  })

  // Notification fired while hidden — pulse, main already restored height
  window.rmp.on('notch:show-temp', () => {
    setHiddenMode(false)
    document.getElementById('notch-bar').classList.add('pulsing')
    setTimeout(() => document.getElementById('notch-bar').classList.remove('pulsing'), 3000)
  })

  // Entering hidden mode — show hairline + hint
  window.rmp.on('notch:entering-hidden', () => setHiddenMode(true))

  // Leaving hidden mode — restore bar
  window.rmp.on('notch:leaving-hidden', () => setHiddenMode(false))

  window.rmp.on('shortcut:toggle', () => togglePanel())
}

// ─── BAR ──────────────────────────────────────────────────────────────────────
function applyIconMode () {
  const useIcons = data.settings?.useIcons
  document.getElementById('btn-quick-note').textContent = useIcons ? '📝 Note' : 'Note'
  document.getElementById('btn-settings').textContent = useIcons ? '⚙ Settings' : 'Settings'
  document.getElementById('quick-note-label').textContent = useIcons ? '📝 Quick Note' : 'Quick Note'
  document.getElementById('toggle-icons').checked = !!useIcons
}

function renderBar () {
  const active = data.tasks.filter(t => t.status !== 'archived')
  const done = active.filter(t => t.status === 'done').length
  const total = active.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const now = new Date()
  const urgent = active.filter(t => {
    if (!t.deadline || t.status === 'done') return false
    const d = new Date(t.deadline)
    return (d - now) / (1000 * 60 * 60 * 24) <= 2
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
  const panel = document.getElementById('panel')
  panel.classList.remove('hidden')
  panel.classList.remove('panel-leaving')
  panel.classList.add('panel-entering')
  setTimeout(() => panel.classList.remove('panel-entering'), 180)
  document.getElementById('btn-toggle').textContent = '▴'
  renderCurrentView()
  populateCategoryFilter()
  setTimeout(() => window.rmp.expand(panel.scrollHeight), 30)
}

function collapsePanel () {
  isExpanded = false
  const panel = document.getElementById('panel')
  document.getElementById('btn-toggle').textContent = '▾'
  // Close all popups immediately
  ;['task-form-overlay', 'settings-overlay', 'quick-note-overlay'].forEach(id => {
    document.getElementById(id).classList.add('hidden')
  })
  editingTaskId = null
  subtaskDraft = []
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

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase()
    tasks = tasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q)
    )
  }
  if (filterCategory) tasks = tasks.filter(t => t.category === filterCategory)

  // Sort: urgent first, then by deadline, then by order
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

  // Weekly progress row
  const done = data.tasks.filter(t => {
    if (t.status !== 'done' || !t.completedAt) return false
    const completed = new Date(t.completedAt)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    return completed >= weekAgo
  }).length
  const total = data.tasks.filter(t => t.status !== 'archived').length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  area.innerHTML = `
    <div class="progress-ring">This week: <span>${pct}% complete</span> (${done}/${total})</div>
  `
  if (tasks.length === 0) {
    area.innerHTML += '<div class="empty-msg">No tasks yet — add one below</div>'
    return
  }
  tasks.forEach((task, i) => area.appendChild(buildTaskEl(task, i)))
}

// ─── TODAY VIEW ───────────────────────────────────────────────────────────────
function renderToday () {
  const area = document.getElementById('task-area')
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  const overdue = data.tasks.filter(t => {
    if (t.status === 'done' || t.status === 'archived' || !t.deadline) return false
    return new Date(t.deadline) < now
  })

  const today = data.tasks.filter(t => {
    if (t.status === 'done' || t.status === 'archived' || !t.deadline) return false
    const d = new Date(t.deadline)
    d.setHours(0, 0, 0, 0)
    return d.getTime() === now.getTime()
  })

  const inProgress = data.tasks.filter(t =>
    t.status === 'in-progress' && t.status !== 'archived'
  )

  area.innerHTML = ''

  if (overdue.length === 0 && today.length === 0 && inProgress.length === 0) {
    area.innerHTML = '<div class="empty-msg">You\'re all clear today 🎉</div>'
    return
  }

  if (overdue.length > 0) {
    area.innerHTML += `<div class="section-header">${ic('overdue')}Overdue</div>`
    overdue.forEach(t => area.appendChild(buildTaskEl(t)))
  }

  if (today.length > 0) {
    area.innerHTML += `<div class="section-header">${ic('dueToday')}Due Today</div>`
    today.forEach(t => area.appendChild(buildTaskEl(t)))
  }

  if (inProgress.length > 0) {
    area.innerHTML += `<div class="section-header">${ic('inProgress')}In Progress</div>`
    inProgress.forEach(t => area.appendChild(buildTaskEl(t)))
  }
}

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────
function renderCalendar () {
  const area = document.getElementById('task-area')
  const year = calendarDate.getFullYear()
  const month = calendarDate.getMonth()

  const monthName = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // Build task-by-date map
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

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = new Date()

  const dayLabels = ['Su','Mo','Tu','We','Th','Fr','Sa']
    .map(d => `<div class="cal-day-label">${d}</div>`).join('')

  let cells = ''
  for (let i = 0; i < firstDay; i++) cells += '<div class="cal-day other-month"></div>'
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = today.getDate() === d && today.getMonth() === month && today.getFullYear() === year
    const tasks = tasksByDate[d] || []
    const hasUrgent = tasks.some(t => t.priority === 'urgent')
    const hasTasks = tasks.length > 0
    cells += `<div class="cal-day${isToday ? ' today' : ''}${hasTasks ? ' has-tasks' : ''}${hasUrgent ? ' has-urgent' : ''}"
      data-day="${d}" title="${tasks.map(t => t.title).join(', ')}">${d}</div>`
  }

  area.innerHTML = `
    <div class="calendar-wrap">
      <div class="calendar-header">
        <button class="cal-nav" id="cal-prev">‹</button>
        <span class="cal-month">${monthName}</span>
        <button class="cal-nav" id="cal-next">›</button>
      </div>
      <div class="calendar-grid">
        ${dayLabels}
        ${cells}
      </div>
    </div>
  `

  document.getElementById('cal-prev').addEventListener('click', e => {
    e.stopPropagation()
    calendarDate.setMonth(calendarDate.getMonth() - 1)
    renderCalendar()
  })
  document.getElementById('cal-next').addEventListener('click', e => {
    e.stopPropagation()
    calendarDate.setMonth(calendarDate.getMonth() + 1)
    renderCalendar()
  })

  // Click day → show tasks for that day
  area.querySelectorAll('.cal-day[data-day]').forEach(el => {
    el.addEventListener('click', () => {
      const day = parseInt(el.dataset.day)
      const tasks = tasksByDate[day] || []
      if (tasks.length === 0) return
      showCalendarDayTasks(tasks, `${monthName} ${day}`)
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
  backBtn.textContent = '← Back to calendar'
  backBtn.style.margin = '6px 10px'
  backBtn.addEventListener('click', () => renderCalendar())
  el.appendChild(backBtn)

  area.innerHTML = ''
  area.appendChild(el)
  updateExpandHeight()
}

// ─── CATEGORY VIEW ────────────────────────────────────────────────────────────
function renderCategory () {
  const area = document.getElementById('task-area')
  const categories = {}

  data.tasks
    .filter(t => t.status !== 'archived')
    .forEach(t => {
      const cat = t.category || 'Uncategorized'
      if (!categories[cat]) categories[cat] = []
      categories[cat].push(t)
    })

  area.innerHTML = ''

  if (Object.keys(categories).length === 0) {
    area.innerHTML = '<div class="empty-msg">No tasks yet</div>'
    return
  }

  Object.entries(categories).sort().forEach(([cat, tasks]) => {
    area.innerHTML += `<div class="section-header">${cat} (${tasks.length})</div>`
    tasks.forEach(t => area.appendChild(buildTaskEl(t)))
  })
}

// ─── TASK ELEMENT BUILDER ─────────────────────────────────────────────────────
function buildTaskEl (task, idx) {
  const el = document.createElement('div')
  el.className = 'task-item'
  el.dataset.id = task.id
  el.draggable = true

  const isDone = task.status === 'done'
  const isStrike = task.strikethrough

  // Status cycle: todo → in-progress → done → todo
  const statusIcon = isDone ? '✓' : (task.status === 'in-progress' ? '◐' : '')
  const checkClass = isDone ? 'done' : (task.status === 'in-progress' ? 'in-progress' : '')

  // Deadline tag
  let deadlineTag = ''
  if (task.deadline) {
    const now = new Date()
    const d = new Date(task.deadline)
    const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24))
    let cls = 'deadline'
    let label = ''
    if (diff < 0) { cls = 'deadline overdue'; label = `${Math.abs(diff)}d overdue` }
    else if (diff === 0) { cls = 'deadline soon'; label = 'due today' }
    else if (diff === 1) { cls = 'deadline soon'; label = 'tomorrow' }
    else if (diff <= 3) { cls = 'deadline soon'; label = `${diff}d left` }
    else label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    deadlineTag = `<span class="tag ${cls}">${ic('deadline')}${label}</span>`
  }

  // Agent tag
  const agentTag = task.addedBy && task.addedBy !== 'user'
    ? `<span class="tag agent">${ic('agent')}via ${task.addedBy}</span>` : ''

  // Category tag
  const catTag = task.category
    ? `<span class="tag category">${task.category}</span>` : ''

  // Status tag for in-progress
  const statusTag = task.status === 'in-progress'
    ? `<span class="tag status-inprogress">In Progress</span>` : ''

  // Recurring tag
  const recTag = task.recurring && task.recurring.enabled
    ? `<span class="tag recurring">${ic('recurring')}${task.recurring.interval}</span>` : ''

  // Subtask progress
  let subtaskHTML = ''
  if (task.subtasks && task.subtasks.length > 0) {
    const doneSubs = task.subtasks.filter(s => s.done).length
    const totalSubs = task.subtasks.length
    const pct = Math.round((doneSubs / totalSubs) * 100)
    subtaskHTML = `
      <div class="subtask-progress">
        <div class="subtask-bar-bg"><div class="subtask-bar-fill" style="width:${pct}%"></div></div>
        <span class="subtask-count">${doneSubs}/${totalSubs}</span>
      </div>
      <div class="subtask-inline">
        ${task.subtasks.map(s => `
          <div class="subtask-inline-item">
            <div class="subtask-inline-check ${s.done ? 'done' : ''}" data-sub-id="${s.id}" data-task-id="${task.id}">
              ${s.done ? '✓' : ''}
            </div>
            <span class="subtask-inline-title ${s.done ? 'done' : ''}">${escHtml(s.title)}</span>
          </div>
        `).join('')}
      </div>
    `
  }

  el.innerHTML = `
    <div class="task-main">
      <div class="task-check ${checkClass}" data-id="${task.id}" title="Click to cycle status">${statusIcon}</div>
      <div class="priority-dot ${task.priority || 'normal'}"></div>
      <span class="task-title ${isStrike ? 'strike' : ''} ${isDone ? 'done-text' : ''}">${escHtml(task.title)}</span>
    </div>
    <div class="task-meta">
      ${deadlineTag}${statusTag}${catTag}${agentTag}${recTag}
    </div>
    ${subtaskHTML}
  `

  // Status click (cycle)
  el.querySelector('.task-check').addEventListener('click', e => {
    e.stopPropagation()
    cycleStatus(task.id)
  })

  // Subtask check clicks
  el.querySelectorAll('.subtask-inline-check').forEach(chk => {
    chk.addEventListener('click', e => {
      e.stopPropagation()
      toggleSubtask(chk.dataset.taskId, chk.dataset.subId)
    })
  })

  // Task click → open form for editing
  el.addEventListener('click', () => openForm(task.id))

  // Drag
  el.addEventListener('dragstart', () => { dragSrcIndex = idx; el.classList.add('dragging') })
  el.addEventListener('dragend', () => el.classList.remove('dragging'))
  el.addEventListener('dragover', e => e.preventDefault())
  el.addEventListener('drop', () => {
    if (dragSrcIndex !== null && dragSrcIndex !== idx) {
      reorderTask(dragSrcIndex, idx)
    }
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
  if (task.status === 'done') task.completedAt = new Date().toISOString()
  else task.completedAt = null
  save()
}

function toggleSubtask (taskId, subId) {
  const task = data.tasks.find(t => t.id === taskId)
  if (!task) return
  const sub = task.subtasks.find(s => s.id === subId)
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

// ─── FORM ─────────────────────────────────────────────────────────────────────
function openForm (taskId) {
  editingTaskId = taskId || null
  subtaskDraft = []
  openPopup('task-form-overlay')

  // Populate category dropdown
  const catSel = document.getElementById('form-category')
  catSel.innerHTML = (data.categories || []).map(c =>
    `<option value="${escHtml(c)}">${escHtml(c)}</option>`
  ).join('')

  if (taskId) {
    const task = data.tasks.find(t => t.id === taskId)
    if (!task) return
    document.getElementById('form-title').textContent = 'Edit Task'
    document.getElementById('btn-form-delete').classList.remove('hidden')
    document.getElementById('form-name').value = task.title || ''
    document.getElementById('form-status').value = task.status || 'todo'
    document.getElementById('form-priority').value = task.priority || 'normal'
    catSel.value = task.category || ''
    document.getElementById('form-deadline').value = task.deadline
      ? new Date(task.deadline).toISOString().split('T')[0] : ''
    document.getElementById('form-notes').value = task.notes || ''
    document.getElementById('form-reminder-type').value = task.reminder?.type || 'never'
    document.getElementById('form-reminder-days').value = task.reminder?.daysBefore || 1
    document.getElementById('form-recurring').checked = task.recurring?.enabled || false
    document.getElementById('form-recurring-interval').value = task.recurring?.interval || 'weekly'
    document.getElementById('form-recurring-day').value = task.recurring?.resetDay || 'monday'
    subtaskDraft = (task.subtasks || []).map(s => ({ ...s }))
    toggleReminderDays()
    toggleRecurringOptions()
    toggleRecurringDay()
  } else {
    document.getElementById('form-title').textContent = 'New Task'
    document.getElementById('btn-form-delete').classList.add('hidden')
    document.getElementById('form-name').value = ''
    document.getElementById('form-status').value = 'todo'
    document.getElementById('form-priority').value = 'normal'
    document.getElementById('form-deadline').value = ''
    document.getElementById('form-notes').value = ''
    document.getElementById('form-reminder-type').value = 'never'
    document.getElementById('form-reminder-days').value = 1
    document.getElementById('form-recurring').checked = false
    toggleReminderDays()
    toggleRecurringOptions()
    toggleRecurringDay()
  }

  renderSubtaskDraft()
  document.getElementById('form-name').focus()
}

function closeForm () {
  closePopup('task-form-overlay', () => {
    editingTaskId = null
    subtaskDraft = []
  })
}

function renderSubtaskDraft () {
  const list = document.getElementById('subtask-list')
  list.innerHTML = subtaskDraft.map((s, i) => `
    <div class="subtask-form-item">
      <input class="subtask-form-input" value="${escHtml(s.title)}" data-sub-idx="${i}" placeholder="Step ${i+1}..." />
      <button class="icon-btn small" data-remove-sub="${i}">✕</button>
    </div>
  `).join('')

  list.querySelectorAll('.subtask-form-input').forEach(inp => {
    inp.addEventListener('input', () => {
      subtaskDraft[parseInt(inp.dataset.subIdx)].title = inp.value
    })
  })

  list.querySelectorAll('[data-remove-sub]').forEach(btn => {
    btn.addEventListener('click', () => {
      subtaskDraft.splice(parseInt(btn.dataset.removeSub), 1)
      renderSubtaskDraft()
    })
  })
}

function saveForm () {
  const title = document.getElementById('form-name').value.trim()
  if (!title) { document.getElementById('form-name').focus(); return }

  const deadlineVal = document.getElementById('form-deadline').value
  const reminderType = document.getElementById('form-reminder-type').value
  const recurring = document.getElementById('form-recurring').checked
  const interval = document.getElementById('form-recurring-interval').value

  const taskData = {
    title,
    status: document.getElementById('form-status').value,
    priority: document.getElementById('form-priority').value,
    category: document.getElementById('form-category').value,
    deadline: deadlineVal ? new Date(deadlineVal).toISOString() : null,
    notes: document.getElementById('form-notes').value.trim(),
    subtasks: subtaskDraft.filter(s => s.title.trim()),
    reminder: {
      type: reminderType,
      daysBefore: parseInt(document.getElementById('form-reminder-days').value) || 1,
      snoozedUntil: null,
      lastFiredAt: null
    },
    recurring: {
      enabled: recurring,
      interval,
      resetDay: document.getElementById('form-recurring-day').value,
      nextReset: null
    }
  }

  if (editingTaskId) {
    const idx = data.tasks.findIndex(t => t.id === editingTaskId)
    if (idx !== -1) {
      const existing = data.tasks[idx]
      data.tasks[idx] = {
        ...existing,
        ...taskData,
        reminder: { ...existing.reminder, ...taskData.reminder },
        recurring: { ...existing.recurring, ...taskData.recurring }
      }
    }
  } else {
    const { v4: uuidv4 } = { v4: () => crypto.randomUUID() }
    data.tasks.push({
      id: crypto.randomUUID(),
      ...taskData,
      addedBy: 'user',
      createdAt: new Date().toISOString(),
      completedAt: null,
      strikethrough: false,
      order: data.tasks.length
    })
  }

  closeForm()
  save()
}

function deleteTask () {
  if (!editingTaskId) return
  const task = data.tasks.find(t => t.id === editingTaskId)
  if (!task) return
  task.status = 'archived'
  task.strikethrough = true
  closeForm()
  save()
}

function toggleReminderDays () {
  const type = document.getElementById('form-reminder-type').value
  const row = document.getElementById('reminder-days-row')
  if (type === 'before-deadline') row.classList.remove('hidden')
  else row.classList.add('hidden')
}

function toggleRecurringOptions () {
  const enabled = document.getElementById('form-recurring').checked
  const opts = document.getElementById('recurring-options')
  if (enabled) opts.classList.remove('hidden')
  else opts.classList.add('hidden')
}

function toggleRecurringDay () {
  const interval = document.getElementById('form-recurring-interval').value
  const dayRow = document.getElementById('recurring-day-row')
  if (interval === 'weekly') dayRow.classList.remove('hidden')
  else dayRow.classList.add('hidden')
}

// ─── QUICK NOTE ───────────────────────────────────────────────────────────────
function loadQuickNote () {
  document.getElementById('quick-note-text').value = data.quickNote || ''
}

async function saveQuickNote () {
  data.quickNote = document.getElementById('quick-note-text').value
  await window.rmp.write(data)
}

// ─── CATEGORY FILTER ──────────────────────────────────────────────────────────
function populateCategoryFilter () {
  const sel = document.getElementById('filter-category')
  const cats = data.categories || []
  sel.innerHTML = '<option value="">All</option>' +
    cats.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')
  sel.value = filterCategory
}

// ─── POPUP HELPERS ───────────────────────────────────────────────────────────
function openPopup (id) {
  const overlay = document.getElementById(id)
  const card = overlay.querySelector('.popup-card')
  card.classList.remove('leaving')
  overlay.classList.remove('hidden')
}

function closePopup (id, cb) {
  const overlay = document.getElementById(id)
  const card = overlay.querySelector('.popup-card')
  card.classList.add('leaving')
  setTimeout(() => {
    card.classList.remove('leaving')
    overlay.classList.add('hidden')
    if (cb) cb()
  }, 150)
}

function openSettings () {
  renderCategoryList()
  openPopup('settings-overlay')
}

function closeSettings () {
  closePopup('settings-overlay')
}

function openNote () {
  loadQuickNote()
  openPopup('quick-note-overlay')
  setTimeout(() => document.getElementById('quick-note-text').focus(), 20)
}

function closeNote () {
  saveQuickNote()
  closePopup('quick-note-overlay')
}

// ─── HIDDEN MODE ─────────────────────────────────────────────────────────────
function setHiddenMode (hidden) {
  isHiddenMode = hidden
  const bar = document.getElementById('notch-bar')
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
  // Notch bar click
  document.getElementById('notch-bar').addEventListener('click', togglePanel)
  document.getElementById('btn-toggle').addEventListener('click', e => {
    e.stopPropagation()
    togglePanel()
  })

  // Hidden hint — hover to expand hairline, click to restore
  const hint = document.getElementById('hidden-hint')
  hint.addEventListener('mouseenter', () => { if (isHiddenMode) window.rmp.hintExpand() })
  hint.addEventListener('mouseleave', () => { if (isHiddenMode) window.rmp.hintCollapse() })
  hint.addEventListener('click', () => { if (isHiddenMode) window.rmp.showNotch() })

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

  // Footer buttons
  document.getElementById('btn-add').addEventListener('click', e => {
    e.stopPropagation()
    openForm(null)
  })

  document.getElementById('btn-quick-note').addEventListener('click', e => {
    e.stopPropagation()
    openNote()
  })

  document.getElementById('btn-close-note').addEventListener('click', closeNote)
  document.getElementById('quick-note-text').addEventListener('input', saveQuickNote)
  document.querySelector('#quick-note-overlay .popup-backdrop').addEventListener('click', closeNote)

  // Settings popup
  document.getElementById('btn-settings').addEventListener('click', e => {
    e.stopPropagation()
    openSettings()
  })

  document.getElementById('btn-close-settings').addEventListener('click', closeSettings)
  document.querySelector('#settings-overlay .popup-backdrop').addEventListener('click', closeSettings)

  document.getElementById('toggle-icons').addEventListener('change', e => {
    data.settings.useIcons = e.target.checked
    save()
    applyIconMode()
    renderBar()
    if (isExpanded) renderCurrentView()
  })

  document.getElementById('btn-add-category').addEventListener('click', e => {
    e.stopPropagation()
    const inp = document.getElementById('new-category-input')
    const val = inp.value.trim()
    if (!val || data.categories.includes(val)) return
    data.categories.push(val)
    inp.value = ''
    save()
    renderCategoryList()
  })

  document.getElementById('new-category-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-add-category').click()
  })

  document.getElementById('btn-export-json').addEventListener('click', e => {
    e.stopPropagation()
    window.rmp.exportJson()
  })

  document.getElementById('btn-export-csv').addEventListener('click', e => {
    e.stopPropagation()
    window.rmp.exportCsv()
  })

  document.getElementById('btn-open-folder').addEventListener('click', e => {
    e.stopPropagation()
    window.rmp.openDataFolder()
  })

  document.getElementById('btn-hide-from-settings').addEventListener('click', e => {
    e.stopPropagation()
    document.getElementById('settings-overlay').classList.add('hidden')
    if (isExpanded) collapsePanel()
    setTimeout(() => window.rmp.hideNotch(), isExpanded ? 200 : 0)
  })

  // Form events
  document.querySelector('#task-form-overlay .popup-backdrop').addEventListener('click', closeForm)
  document.getElementById('btn-form-close').addEventListener('click', closeForm)
  document.getElementById('btn-form-cancel').addEventListener('click', closeForm)
  document.getElementById('btn-form-save').addEventListener('click', saveForm)
  document.getElementById('btn-form-delete').addEventListener('click', deleteTask)

  document.getElementById('form-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveForm()
    if (e.key === 'Escape') closeForm()
  })

  document.getElementById('btn-add-subtask').addEventListener('click', e => {
    e.stopPropagation()
    subtaskDraft.push({ id: crypto.randomUUID(), title: '', done: false })
    renderSubtaskDraft()
    const inputs = document.querySelectorAll('.subtask-form-input')
    if (inputs.length) inputs[inputs.length - 1].focus()
  })

  document.getElementById('form-reminder-type').addEventListener('change', toggleReminderDays)
  document.getElementById('form-recurring').addEventListener('change', toggleRecurringOptions)
  document.getElementById('form-recurring-interval').addEventListener('change', toggleRecurringDay)

  // Escape closes popups in order, then collapses panel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('task-form-overlay').classList.contains('hidden')) {
        closeForm()
      } else if (!document.getElementById('settings-overlay').classList.contains('hidden')) {
        closeSettings()
      } else if (!document.getElementById('quick-note-overlay').classList.contains('hidden')) {
        closeNote()
      } else if (isExpanded) {
        collapsePanel()
      }
    }
  })
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function renderCategoryList () {
  const el = document.getElementById('category-list')
  el.innerHTML = (data.categories || []).map((c, i) => `
    <div class="category-item">
      <span>${escHtml(c)}</span>
      <button class="icon-btn small" data-del-cat="${i}">✕</button>
    </div>
  `).join('')

  el.querySelectorAll('[data-del-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      data.categories.splice(parseInt(btn.dataset.delCat), 1)
      save()
      renderCategoryList()
    })
  })
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function escHtml (str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ─── START ────────────────────────────────────────────────────────────────────
init()
