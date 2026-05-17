// ─── PARAMS & STATE ───────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search)
const VIEW    = params.get('view')
const TASK_ID = params.get('taskId') || null

let data = null
let subtaskDraft = []

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init () {
  data = await window.rmp.read()
  data.categories = data.categories || []
  data.settings   = data.settings   || {}

  const root = document.getElementById('popup-root')

  if      (VIEW === 'settings')   renderSettings(root)
  else if (VIEW === 'quick-note') renderQuickNote(root)
  else if (VIEW === 'task-form')  renderTaskForm(root, TASK_ID)

  resize()

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.rmp.closePopup()
  })
}

// ─── RESIZE ───────────────────────────────────────────────────────────────────
function resize () {
  requestAnimationFrame(() => {
    window.rmp.resizePopup(document.getElementById('popup-root').scrollHeight)
  })
}

async function save () {
  await window.rmp.write(data)
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
          <div class="settings-label">Keyboard shortcut</div>
          <div class="settings-value">Cmd + Shift + Space</div>
        </div>
        <div class="settings-section">
          <div class="settings-label">Display</div>
          <label class="toggle-label">
            <input id="toggle-icons" type="checkbox" ${data.settings.useIcons ? 'checked' : ''} />
            <span>Show icons alongside text</span>
          </label>
        </div>
        <div class="settings-section">
          <div class="settings-label">Categories</div>
          <div id="category-list" class="category-list"></div>
          <div class="settings-row">
            <input id="new-category-input" type="text" class="form-input" placeholder="New category..." />
            <button id="btn-add-category" class="footer-btn small">Add</button>
          </div>
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
          <div class="settings-label">Notch visibility</div>
          <button id="btn-hide-notch" class="footer-btn small">Hide notch</button>
          <div class="settings-hint">Hover top-center or press Cmd+Shift+Space to restore</div>
        </div>
      </div>
    </div>
  `

  renderCategoryList()

  document.getElementById('btn-close').addEventListener('click', () => window.rmp.closePopup())

  document.getElementById('toggle-icons').addEventListener('change', e => {
    data.settings.useIcons = e.target.checked
    save()
  })

  document.getElementById('btn-add-category').addEventListener('click', () => {
    const inp = document.getElementById('new-category-input')
    const val = inp.value.trim()
    if (!val || data.categories.includes(val)) return
    data.categories.push(val)
    inp.value = ''
    save()
    renderCategoryList()
    resize()
  })

  document.getElementById('new-category-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-add-category').click()
  })

  document.getElementById('btn-export-json').addEventListener('click', () => window.rmp.exportJson())
  document.getElementById('btn-export-csv').addEventListener('click', () => window.rmp.exportCsv())
  document.getElementById('btn-open-folder').addEventListener('click', () => window.rmp.openDataFolder())

  document.getElementById('btn-hide-notch').addEventListener('click', () => {
    window.rmp.closePopup()
    setTimeout(() => window.rmp.hideNotch(), 50)
  })
}

function renderCategoryList () {
  const el = document.getElementById('category-list')
  if (!el) return
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
      resize()
    })
  })
}

// ─── QUICK NOTE ───────────────────────────────────────────────────────────────
function renderQuickNote (root) {
  root.innerHTML = `
    <div class="popup-window">
      <div class="popup-win-header">
        <span>Quick Note</span>
        <button id="btn-close" class="icon-btn">✕</button>
      </div>
      <textarea id="note-text" class="quick-note-text" placeholder="Jot anything down...">${escHtml(data.quickNote || '')}</textarea>
    </div>
  `

  const textarea = document.getElementById('note-text')
  textarea.addEventListener('input', () => {
    data.quickNote = textarea.value
    save()
  })

  document.getElementById('btn-close').addEventListener('click', () => window.rmp.closePopup())

  setTimeout(() => {
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, 40)
}

// ─── TASK FORM ────────────────────────────────────────────────────────────────
function renderTaskForm (root, taskId) {
  const task = taskId ? data.tasks.find(t => t.id === taskId) : null
  subtaskDraft = task ? (task.subtasks || []).map(s => ({ ...s })) : []

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
          <select id="form-status" class="form-select">
            <option value="todo"        ${sel(task?.status, 'todo',        !task)}>Todo</option>
            <option value="in-progress" ${sel(task?.status, 'in-progress')}>In Progress</option>
            <option value="done"        ${sel(task?.status, 'done')}>Done</option>
          </select>
          <select id="form-priority" class="form-select">
            <option value="urgent" ${sel(task?.priority, 'urgent')}>Urgent</option>
            <option value="high"   ${sel(task?.priority, 'high')}>High</option>
            <option value="normal" ${sel(task?.priority, 'normal', !task)}>Normal</option>
            <option value="low"    ${sel(task?.priority, 'low')}>Low</option>
          </select>
        </div>

        <div class="form-row">
          <input id="form-category" type="text" class="form-input" placeholder="Category"
            value="${escHtml(task?.category || '')}" list="category-options" autocomplete="off" />
          <datalist id="category-options">
            ${cats.map(c => `<option value="${escHtml(c)}">`).join('')}
          </datalist>
          <input id="form-deadline" type="date" class="form-input" value="${dlVal}" />
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
          <select id="form-reminder-type" class="form-select">
            <option value="never"           ${sel(task?.reminder?.type, 'never', !task)}>No reminder</option>
            <option value="always"          ${sel(task?.reminder?.type, 'always')}>Remind daily (9am)</option>
            <option value="before-deadline" ${sel(task?.reminder?.type, 'before-deadline')}>Remind before deadline</option>
          </select>
          <div id="reminder-days-row" class="hidden form-row">
            <label class="form-label">Days before:</label>
            <input id="form-reminder-days" type="number" min="1" max="30" value="${task?.reminder?.daysBefore || 1}" class="form-input small" />
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
  toggleReminderDays()
  toggleRecurringOptions()
  toggleRecurringDay()

  document.getElementById('btn-close').addEventListener('click', () => window.rmp.closePopup())
  document.getElementById('btn-cancel').addEventListener('click', () => window.rmp.closePopup())
  document.getElementById('btn-save').addEventListener('click', () => saveForm(task))

  if (task) {
    document.getElementById('btn-delete').addEventListener('click', () => {
      task.status = 'archived'
      task.strikethrough = true
      save()
      window.rmp.closePopup()
    })
  }

  document.getElementById('btn-add-subtask').addEventListener('click', () => {
    subtaskDraft.push({ id: crypto.randomUUID(), title: '', done: false })
    renderSubtaskDraft()
    const inputs = document.querySelectorAll('.subtask-form-input')
    if (inputs.length) inputs[inputs.length - 1].focus()
    resize()
  })

  document.getElementById('form-reminder-type').addEventListener('change', toggleReminderDays)
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
  })
  list.querySelectorAll('[data-remove-sub]').forEach(btn => {
    btn.addEventListener('click', () => {
      subtaskDraft.splice(parseInt(btn.dataset.removeSub), 1)
      renderSubtaskDraft()
      resize()
    })
  })
}

function toggleReminderDays () {
  const type = document.getElementById('form-reminder-type')?.value
  const row  = document.getElementById('reminder-days-row')
  if (!row) return
  row.classList.toggle('hidden', type !== 'before-deadline')
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
    status:   document.getElementById('form-status').value,
    priority: document.getElementById('form-priority').value,
    category,
    deadline: deadlineVal ? new Date(deadlineVal).toISOString() : null,
    notes:    document.getElementById('form-notes').value.trim(),
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
      addedBy: 'user',
      createdAt: new Date().toISOString(),
      completedAt: null,
      strikethrough: false,
      order: data.tasks.length
    })
  }

  save()
  window.rmp.closePopup()
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function sel (val, option, defaultSelected = false) {
  return (val === option || (!val && defaultSelected)) ? 'selected' : ''
}

function escHtml (str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ─── START ────────────────────────────────────────────────────────────────────
init()
