(function () {
'use strict'

// ─── STATE ────────────────────────────────────────────────────────────────────
let sheetApi = null
let data = null
let subtaskDraft = []

function sheetClose () {
  if (sheetApi?.onClose) sheetApi.onClose()
  else if (window.rmp?.closePopup) window.rmp.closePopup()
}

function sheetCommit () {
  if (sheetApi?.onCommit) sheetApi.onCommit()
  else if (window.rmp?.commitPopup) window.rmp.commitPopup()
}

async function save () {
  if (sheetApi?.onSave) await sheetApi.onSave(data)
  else await window.rmp.write(data)
}

function resize () {
  if (sheetApi?.onResize) sheetApi.onResize()
  else {
    const legacy = document.getElementById('popup-root')
    if (legacy && window.rmp?.resizePopup) {
      requestAnimationFrame(() => {
        window.rmp.resizePopup(legacy.scrollHeight)
      })
    }
  }
}

// ─── IN-PANEL SHEET (main notch UI) ───────────────────────────────────────────
window.RMPSheet = {
  open (view, taskId, api) {
    sheetApi = api
    data = api.getData()
    data.categories = data.categories || []
    data.settings = data.settings || {}
    data.notes = data.notes || []

    const overlay = document.getElementById('sheet-overlay')
    const root = document.getElementById('sheet-root')
    if (!overlay || !root) return

    overlay.classList.remove('hidden')
    overlay.setAttribute('aria-hidden', 'false')

    if (view === 'settings') renderSettings(root)
    else if (view === 'quick-note') renderQuickNote(root)
    else if (view === 'task-form') renderTaskForm(root, taskId)

    resize()
  },

  close: sheetClose
}

// ─── LEGACY SEPARATE POPUP WINDOW ─────────────────────────────────────────────
const params = new URLSearchParams(window.location.search)
const VIEW = params.get('view')
const TASK_ID = params.get('taskId') || null

async function initLegacyPopup () {
  data = await window.rmp.read()
  data.categories = data.categories || []
  data.settings = data.settings || {}

  const root = document.getElementById('popup-root')
  if (!root) return

  if (VIEW === 'settings') renderSettings(root)
  else if (VIEW === 'quick-note') renderQuickNote(root)
  else if (VIEW === 'task-form') renderTaskForm(root, TASK_ID)

  resize()

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') sheetClose()
  })
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function renderSettings (root) {
  root.innerHTML = `
    <div class="popup-window">
      <div class="popup-win-header">
        <span>Settings</span>
        <button id="btn-close" class="icon-btn">✕</button>
      </div>
      <div class="settings-body">
        <div class="settings-section">
          <div class="settings-label">Share</div>
          <div class="settings-row">
            <button id="btn-copy-all-txt" class="footer-btn small">Copy all as text</button>
            <button id="btn-save-all-txt" class="footer-btn small">Save .txt</button>
          </div>
          <div id="share-feedback" class="settings-hint hidden"></div>
        </div>
        <div class="settings-section">
          <div class="settings-label">Export data</div>
          <div class="settings-row">
            <button id="btn-export-json" class="footer-btn small">Export JSON</button>
            <button id="btn-export-csv" class="footer-btn small">Export CSV</button>
            <button id="btn-open-folder" class="footer-btn small">Open folder</button>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-label">App</div>
          <button id="btn-restart" class="footer-btn small">Restart app</button>
        </div>
      </div>
    </div>
  `

  document.getElementById('btn-close').addEventListener('click', () => sheetClose())

  const shareFeedback = document.getElementById('share-feedback')
  const showShareFeedback = (msg) => {
    shareFeedback.textContent = msg
    shareFeedback.classList.remove('hidden')
    setTimeout(() => shareFeedback.classList.add('hidden'), 2000)
  }

  document.getElementById('btn-copy-all-txt').addEventListener('click', async () => {
    const text = formatAllTasksPlain(data)
    await window.rmp.copyToClipboard(text)
    showShareFeedback('Copied to clipboard')
    resize()
  })
  document.getElementById('btn-save-all-txt').addEventListener('click', async () => {
    const text = formatAllTasksPlain(data)
    const res = await window.rmp.exportTxt(text)
    if (res?.success) showShareFeedback('Saved')
    resize()
  })

  document.getElementById('btn-export-json').addEventListener('click', () => window.rmp.exportJson())
  document.getElementById('btn-export-csv').addEventListener('click', () => window.rmp.exportCsv())
  document.getElementById('btn-open-folder').addEventListener('click', () => window.rmp.openDataFolder())

  document.getElementById('btn-restart').addEventListener('click', () => window.rmp.restartApp())
}

// ─── QUICK NOTE ───────────────────────────────────────────────────────────────
function renderQuickNote (root) {
  data.notes = data.notes || []

  // Migrate old single quickNote
  if (data.quickNote && !data.notes.length) {
    data.notes.unshift({ id: crypto.randomUUID(), title: '', content: data.quickNote, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    data.quickNote = ''
    save()
  }

  function showList () {
    const notes = data.notes
    root.innerHTML = `
      <div class="popup-window">
        <div class="popup-win-header">
          <span>Notes</span>
          <button id="btn-close" class="icon-btn">✕</button>
        </div>
        <div class="notes-list">
          ${notes.length === 0 ? '<div class="notes-empty">No notes yet</div>' : notes.map(n => `
            <div class="note-item" data-id="${n.id}">
              <div class="note-item-title">${escHtml(n.title || noteTitle(n.content))}</div>
              <div class="note-item-date">${noteDate(n.updatedAt || n.createdAt)}</div>
            </div>
          `).join('')}
        </div>
        <div class="notes-footer">
          <button id="btn-new-note" class="footer-btn primary small">+ New Note</button>
        </div>
      </div>
    `
    document.getElementById('btn-close').addEventListener('click', () => sheetClose())
    document.getElementById('btn-new-note').addEventListener('click', () => {
      const note = { id: crypto.randomUUID(), title: '', content: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      data.notes.unshift(note)
      save()
      showEditor(note.id)
    })
    root.querySelectorAll('.note-item').forEach(el => {
      el.addEventListener('click', () => showEditor(el.dataset.id))
    })
    resize()
  }

  function showEditor (noteId) {
    const note = data.notes.find(n => n.id === noteId)
    if (!note) { showList(); return }
    root.innerHTML = `
      <div class="popup-window">
        <div class="popup-win-header">
          <button id="btn-back" class="icon-btn">←</button>
          <span>Notes</span>
          <button id="btn-delete-note" class="icon-btn">✕</button>
        </div>
        <div class="note-title-row">
          <input id="note-title-input" class="note-title-input" placeholder="Title" value="${escHtml(note.title || '')}" />
        </div>
        <textarea id="note-text" class="quick-note-text" placeholder="Start writing...">${escHtml(note.content)}</textarea>
      </div>
    `
    const textarea = document.getElementById('note-text')
    textarea.addEventListener('input', () => {
      note.content = textarea.value
      note.updatedAt = new Date().toISOString()
      save()
    })
    const titleInput = document.getElementById('note-title-input')
    titleInput.addEventListener('input', () => {
      note.title = titleInput.value
      note.updatedAt = new Date().toISOString()
      save()
    })
    titleInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); textarea.focus() }
    })
    document.getElementById('btn-back').addEventListener('click', () => {
      if (!note.content.trim() && !note.title.trim()) {
        data.notes = data.notes.filter(n => n.id !== noteId)
        save()
      }
      showList()
    })
    document.getElementById('btn-delete-note').addEventListener('click', () => {
      data.notes = data.notes.filter(n => n.id !== noteId)
      save()
      showList()
    })
    const focusEditor = () => {
      if (window.rmp?.makeKey) window.rmp.makeKey()
      if (!note.title && !note.content) {
        titleInput.focus()
      } else {
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      }
    }
    setTimeout(focusEditor, 40)
    resize()
  }

  showList()
}

function noteTitle (content) {
  return (content || '').split('\n')[0].trim().slice(0, 60) || 'Untitled'
}

function noteDate (iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── TASK FORM ────────────────────────────────────────────────────────────────
function renderTaskForm (root, taskId) {
  const task = taskId ? data.tasks.find(t => t.id === taskId) : null
  subtaskDraft = task ? (task.subtasks || []).map(s => ({ ...s })) : []
  if (!subtaskDraft.length) {
    subtaskDraft.push({ id: crypto.randomUUID(), title: '', done: false })
  }

  const cats = data.categories || []
  const dlVal = task?.deadline ? new Date(task.deadline).toISOString().split('T')[0] : ''

  root.innerHTML = `
    <div class="popup-window">
      <div class="popup-win-header">
        <span>${task ? 'Edit Task' : 'New Task'}</span>
        <button id="btn-close" class="icon-btn">✕</button>
      </div>
      <div class="popup-task-body">
        <input id="form-name" type="text" class="form-input" placeholder="Task title *" value="${escHtml(task?.title || '')}" />

        <div class="form-row">
          <div class="combo-wrap">
            <input id="form-category" type="text" class="form-input" placeholder="Category"
              value="${escHtml(task?.category || '')}" autocomplete="off" />
            <div id="category-dropdown" class="combo-dropdown hidden"></div>
          </div>
          <div class="date-field-wrap">
            <button id="form-deadline-btn" type="button" class="form-input date-field-btn">${dlVal ? fmtDeadlineBtn(dlVal) : 'No deadline'}</button>
            <input type="hidden" id="form-deadline" value="${dlVal}" />
          </div>
        </div>

        <textarea id="form-notes" class="form-textarea" placeholder="Notes (optional)">${escHtml(task?.notes || '')}</textarea>

        <div class="subtasks-section">
          <div class="subtasks-header">
            <span>Subtasks</span>
            <button id="btn-add-subtask" class="icon-btn small">+ Add</button>
          </div>
          <div id="subtask-list" class="subtask-list"></div>
        </div>

        <div class="reminder-section">
          <div class="form-labeled-field">
            <span class="form-field-label">Reminder</span>
            <select id="form-reminder-type" class="form-select">
              <option value="never"           ${sel(task?.reminder?.type, 'never', !task)}>None</option>
              <option value="always"          ${sel(task?.reminder?.type, 'always')}>Daily at time</option>
              <option value="before-deadline" ${sel(task?.reminder?.type, 'before-deadline')}>Before deadline</option>
            </select>
          </div>
          <div id="reminder-time-row" class="hidden">
            <div class="reminder-templates">
              <button type="button" class="reminder-chip" data-time="08:00">8 AM</button>
              <button type="button" class="reminder-chip" data-time="09:00">9 AM</button>
              <button type="button" class="reminder-chip" data-time="12:00">12 PM</button>
              <button type="button" class="reminder-chip" data-time="18:00">6 PM</button>
              <button type="button" class="reminder-chip" data-time="21:00">9 PM</button>
            </div>
            <div class="form-labeled-field" style="margin-top:6px">
              <span class="form-field-label">Custom</span>
              <input id="form-reminder-time" type="time" value="${task?.reminder?.time || '09:00'}" class="form-select" />
            </div>
          </div>
          <div id="reminder-days-row" class="hidden">
            <div class="reminder-templates">
              <button type="button" class="reminder-chip" data-days="1">1 day</button>
              <button type="button" class="reminder-chip" data-days="2">2 days</button>
              <button type="button" class="reminder-chip" data-days="3">3 days</button>
              <button type="button" class="reminder-chip" data-days="5">5 days</button>
              <button type="button" class="reminder-chip" data-days="7">1 week</button>
            </div>
            <div class="form-labeled-field" style="margin-top:6px">
              <span class="form-field-label">Custom days</span>
              <input id="form-reminder-days" type="number" min="1" max="30" value="${task?.reminder?.daysBefore || 1}" class="form-select" style="max-width:80px" />
            </div>
            <div class="form-labeled-field" style="margin-top:6px">
              <span class="form-field-label">At</span>
              <input id="form-reminder-deadline-time" type="time" value="${task?.reminder?.time || '09:00'}" class="form-select" />
            </div>
          </div>
        </div>

        <div class="recurring-section">
          <label class="toggle-label">
            <input id="form-recurring" type="checkbox" ${task?.recurring?.enabled ? 'checked' : ''} />
            <span>Recurring task</span>
          </label>
          <div id="recurring-options" class="hidden form-row">
            <select id="form-recurring-interval" class="form-select">
              <option value="daily"   ${sel(task?.recurring?.interval, 'daily')}>Daily</option>
              <option value="weekly"  ${sel(task?.recurring?.interval, 'weekly', !task?.recurring?.interval)}>Weekly</option>
              <option value="monthly" ${sel(task?.recurring?.interval, 'monthly')}>Monthly</option>
            </select>
            <div id="recurring-day-row" class="hidden">
              <select id="form-recurring-day" class="form-select">
                ${['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d =>
                  `<option value="${d}" ${task?.recurring?.resetDay === d ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`
                ).join('')}
              </select>
            </div>
          </div>
        </div>

        <div class="form-actions">
          ${task ? '<button id="btn-delete" class="form-btn danger">Delete</button>' : ''}
          <button id="btn-cancel" class="form-btn">Cancel</button>
          <button id="btn-save" class="form-btn primary">Save</button>
        </div>
      </div>
    </div>
  `

  renderSubtaskDraft()
  setupCategoryCombo()
  setupDeadlinePicker()
  toggleReminderDays()
  setupReminderChips()
  toggleRecurringOptions()
  toggleRecurringDay()

  document.getElementById('btn-close').addEventListener('click', () => sheetClose())
  document.getElementById('btn-cancel').addEventListener('click', () => sheetClose())
  document.getElementById('btn-save').addEventListener('click', () => saveForm(task))

  if (task) {
    document.getElementById('btn-delete').addEventListener('click', () => {
      task.status = 'archived'
      task.strikethrough = true
      save()
      sheetCommit()
    })
  }

  document.getElementById('btn-add-subtask').addEventListener('click', () => {
    subtaskDraft.push({ id: crypto.randomUUID(), title: '', done: false })
    renderSubtaskDraft()
    const inputs = document.querySelectorAll('.subtask-form-input')
    if (inputs.length) inputs[inputs.length - 1].focus()
    resize()
  })

  document.getElementById('form-reminder-type').addEventListener('change', () => { toggleReminderDays(); setupReminderChips(); resize() })
  document.getElementById('form-recurring').addEventListener('change', () => { toggleRecurringOptions(); resize() })
  document.getElementById('form-recurring-interval').addEventListener('change', toggleRecurringDay)
  document.getElementById('form-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveForm(task)
  })

  setTimeout(() => document.getElementById('form-name').focus(), 30)
}

function renderSubtaskDraft () {
  const list = document.getElementById('subtask-list')
  if (!list) return
  list.innerHTML = subtaskDraft.map((s, i) => `
    <div class="subtask-form-item">
      <input class="subtask-form-input" value="${escHtml(s.title)}" data-sub-idx="${i}" placeholder="Step ${i+1}..." />
      <button class="icon-btn small" data-remove-sub="${i}">✕</button>
    </div>
  `).join('')

  list.querySelectorAll('.subtask-form-input').forEach(inp => {
    inp.addEventListener('input', () => { subtaskDraft[parseInt(inp.dataset.subIdx)].title = inp.value })
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      const idx = parseInt(inp.dataset.subIdx, 10)
      subtaskDraft[idx].title = inp.value
      const insertAt = idx + 1
      subtaskDraft.splice(insertAt, 0, { id: crypto.randomUUID(), title: '', done: false })
      renderSubtaskDraft()
      document.querySelectorAll('.subtask-form-input')[insertAt]?.focus()
      resize()
    })
  })
  list.querySelectorAll('[data-remove-sub]').forEach(btn => {
    btn.addEventListener('click', () => {
      subtaskDraft.splice(parseInt(btn.dataset.removeSub), 1)
      renderSubtaskDraft()
      resize()
    })
  })
}

function setupCategoryCombo () {
  const inp = document.getElementById('form-category')
  const dd  = document.getElementById('category-dropdown')
  if (!inp || !dd) return

  function buildDropdown () {
    const filter   = inp.value.trim()
    const cats     = data.categories || []
    const filtered = cats.filter(c => !filter || c.toLowerCase().includes(filter.toLowerCase()))
    const showNew  = filter && !cats.find(c => c.toLowerCase() === filter.toLowerCase())

    if (!filtered.length && !showNew) { dd.classList.add('hidden'); return }

    const rect = inp.getBoundingClientRect()
    dd.style.top   = (rect.bottom + 2) + 'px'
    dd.style.left  = rect.left + 'px'
    dd.style.width = rect.width + 'px'

    dd.innerHTML = [
      ...filtered.map(c => `
        <div class="combo-option" data-val="${escHtml(c)}">
          <span>${escHtml(c)}</span>
          <button class="combo-del-btn" data-del="${escHtml(c)}">✕</button>
        </div>`),
      ...(showNew ? [`<div class="combo-option combo-new" data-val="${escHtml(filter)}">+ "${escHtml(filter)}"</div>`] : [])
    ].join('')

    dd.classList.remove('hidden')

    dd.querySelectorAll('.combo-option').forEach(opt => {
      opt.addEventListener('mousedown', e => {
        if (e.target.closest('.combo-del-btn')) return
        e.preventDefault()
        inp.value = opt.dataset.val
        dd.classList.add('hidden')
      })
    })

    dd.querySelectorAll('.combo-del-btn').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault()
        e.stopPropagation()
        data.categories = data.categories.filter(c => c !== btn.dataset.del)
        save()
        buildDropdown()
      })
    })
  }

  inp.addEventListener('focus', buildDropdown)
  inp.addEventListener('input', buildDropdown)
  inp.addEventListener('blur',  () => setTimeout(() => dd.classList.add('hidden'), 120))
  inp.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const val = inp.value.trim()
    if (!val) return
    if (!data.categories.includes(val)) data.categories.push(val)
    dd.classList.add('hidden')
    document.getElementById('form-name').focus()
  })
}

function toggleReminderDays () {
  const type    = document.getElementById('form-reminder-type')?.value
  const timeRow = document.getElementById('reminder-time-row')
  const daysRow = document.getElementById('reminder-days-row')
  if (!timeRow || !daysRow) return
  timeRow.classList.toggle('hidden', type !== 'always')
  daysRow.classList.toggle('hidden', type !== 'before-deadline')
}

function setupReminderChips () {
  document.querySelectorAll('.reminder-chip[data-time]').forEach(chip => {
    const timeInp = document.getElementById('form-reminder-time')
    if (!timeInp) return
    chip.classList.toggle('active', chip.dataset.time === timeInp.value)
    chip.addEventListener('click', () => {
      timeInp.value = chip.dataset.time
      document.querySelectorAll('.reminder-chip[data-time]').forEach(c => c.classList.remove('active'))
      chip.classList.add('active')
    })
  })
  document.querySelectorAll('.reminder-chip[data-days]').forEach(chip => {
    const daysInp = document.getElementById('form-reminder-days')
    if (!daysInp) return
    chip.classList.toggle('active', chip.dataset.days === String(daysInp.value))
    chip.addEventListener('click', () => {
      daysInp.value = chip.dataset.days
      document.querySelectorAll('.reminder-chip[data-days]').forEach(c => c.classList.remove('active'))
      chip.classList.add('active')
    })
  })
}

function toggleRecurringOptions () {
  const enabled = document.getElementById('form-recurring')?.checked
  const opts    = document.getElementById('recurring-options')
  if (!opts) return
  opts.classList.toggle('hidden', !enabled)
}

function toggleRecurringDay () {
  const interval = document.getElementById('form-recurring-interval')?.value
  const dayRow   = document.getElementById('recurring-day-row')
  if (!dayRow) return
  dayRow.classList.toggle('hidden', interval !== 'weekly')
}

function saveForm (existingTask) {
  const title = document.getElementById('form-name').value.trim()
  if (!title) { document.getElementById('form-name').focus(); return }

  const deadlineVal  = document.getElementById('form-deadline').value
  const reminderType = document.getElementById('form-reminder-type').value
  const recurring    = document.getElementById('form-recurring').checked
  const interval     = document.getElementById('form-recurring-interval').value

  const category = document.getElementById('form-category').value.trim()
  if (category && !data.categories.includes(category)) {
    data.categories.push(category)
  }

  const taskData = {
    title,
    category,
    deadline: deadlineVal ? new Date(deadlineVal).toISOString() : null,
    notes:    document.getElementById('form-notes').value.trim(),
    subtasks: subtaskDraft.filter(s => s.title.trim()),
    reminder: {
      type: reminderType,
      time: reminderType === 'before-deadline'
        ? (document.getElementById('form-reminder-deadline-time')?.value || '09:00')
        : (document.getElementById('form-reminder-time')?.value || '09:00'),
      daysBefore: parseInt(document.getElementById('form-reminder-days')?.value) || 1,
      snoozedUntil: null,
      lastFiredAt: null
    },
    recurring: {
      enabled: recurring,
      interval,
      resetDay: document.getElementById('form-recurring-day')?.value || 'monday',
      nextReset: null
    }
  }

  if (existingTask) {
    const idx = data.tasks.findIndex(t => t.id === existingTask.id)
    if (idx !== -1) {
      data.tasks[idx] = {
        ...existingTask, ...taskData,
        reminder:  { ...existingTask.reminder,  ...taskData.reminder  },
        recurring: { ...existingTask.recurring, ...taskData.recurring }
      }
    }
  } else {
    data.tasks.push({
      id: crypto.randomUUID(),
      ...taskData,
      status: 'todo',
      addedBy: 'user',
      createdAt: new Date().toISOString(),
      completedAt: null,
      strikethrough: false,
      order: data.tasks.length
    })
  }

  save()
  sheetCommit()
}

// ─── DEADLINE PICKER ──────────────────────────────────────────────────────────
function fmtDeadlineBtn (isoDate) {
  if (!isoDate) return 'No deadline'
  const d = new Date(isoDate + 'T00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function setupDeadlinePicker () {
  const btn       = document.getElementById('form-deadline-btn')
  const hidden    = document.getElementById('form-deadline')
  if (!btn || !hidden) return

  let calEl      = null
  let viewDate   = hidden.value ? new Date(hidden.value + 'T00:00') : new Date()

  function buildGrid () {
    const year  = viewDate.getFullYear()
    const month = viewDate.getMonth()
    const label = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    const today = new Date(); today.setHours(0,0,0,0)
    const sel   = hidden.value

    const firstDay    = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    const dayLabels = ['Su','Mo','Tu','We','Th','Fr','Sa']
      .map(d => `<div class="dp-label">${d}</div>`).join('')

    let cells = ''
    for (let i = 0; i < firstDay; i++) cells += '<div class="dp-cell empty"></div>'
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      const isToday = new Date(year, month, d).getTime() === today.getTime()
      const isSel   = iso === sel
      cells += `<div class="dp-cell${isToday ? ' today' : ''}${isSel ? ' selected' : ''}" data-date="${iso}">${d}</div>`
    }

    calEl.innerHTML = `
      <div class="dp-header">
        <button type="button" class="dp-nav" id="dp-prev">‹</button>
        <span class="dp-month">${label}</span>
        <button type="button" class="dp-nav" id="dp-next">›</button>
      </div>
      <div class="dp-grid">${dayLabels}${cells}</div>
      <button type="button" class="dp-clear">Clear deadline</button>
    `

    calEl.querySelector('#dp-prev').addEventListener('click', e => {
      e.stopPropagation(); viewDate.setMonth(viewDate.getMonth() - 1); buildGrid()
    })
    calEl.querySelector('#dp-next').addEventListener('click', e => {
      e.stopPropagation(); viewDate.setMonth(viewDate.getMonth() + 1); buildGrid()
    })
    calEl.querySelectorAll('.dp-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', e => {
        e.stopPropagation()
        hidden.value  = cell.dataset.date
        btn.textContent = fmtDeadlineBtn(cell.dataset.date)
        btn.classList.add('has-value')
        closeCalendar()
      })
    })
    calEl.querySelector('.dp-clear').addEventListener('click', e => {
      e.stopPropagation()
      hidden.value    = ''
      btn.textContent = 'No deadline'
      btn.classList.remove('has-value')
      closeCalendar()
    })
  }

  function openCalendar () {
    if (calEl) return
    calEl = document.createElement('div')
    calEl.className = 'deadline-calendar'
    btn.closest('.form-row').after(calEl)
    buildGrid()
    resize()
  }

  function closeCalendar () {
    if (!calEl) return
    calEl.remove(); calEl = null
    resize()
  }

  btn.addEventListener('click', e => {
    e.stopPropagation()
    calEl ? closeCalendar() : openCalendar()
  })
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function sel (val, option, defaultSelected = false) {
  return (val === option || (!val && defaultSelected)) ? 'selected' : ''
}

function escHtml (str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

if (document.getElementById('popup-root') && !document.getElementById('sheet-overlay')) {
  initLegacyPopup()
}

})();
