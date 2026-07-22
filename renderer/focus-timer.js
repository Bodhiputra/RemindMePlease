// Pomodoro — configurable cycle: ordered work / break steps.
(function () {
  'use strict'

  const DEFAULT_NOTICES = {
    workStart: 'Time to focus',
    workEnd: '',
    shortBreakStart: 'Walk around!',
    shortBreakEnd: '',
    longBreakStart: 'Stretch and hydrate',
    longBreakEnd: ''
  }

  const DEFAULT_POMO = {
    workMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 20,
    sessionsBeforeLongBreak: 4,
    cycleMode: 'classic',
    confettiOnComplete: true,
    notices: { ...DEFAULT_NOTICES },
    cycle: null
  }

  const PHASE = {
    work: 'work',
    shortBreak: 'shortBreak',
    longBreak: 'longBreak'
  }

  const AWAIT = {
    break: 'break',
    longBreak: 'longBreak',
    work: 'work'
  }

  let api = null
  let tickInterval = null
  let pomoFocusHandler = null

  function bindPomoFocus (area) {
    const block = area.querySelector('.pomo-settings-block')
    if (!block) return
    if (pomoFocusHandler) {
      block.removeEventListener('focusin', pomoFocusHandler)
      block.removeEventListener('mousedown', pomoFocusHandler)
    }
    pomoFocusHandler = () => {
      if (window.rmp?.makeKey) window.rmp.makeKey()
    }
    block.addEventListener('focusin', pomoFocusHandler)
    block.addEventListener('mousedown', pomoFocusHandler)
  }

  function isClassicCycle (cycle, s) {
    const built = buildClassicCycle(s)
    if (cycle.length !== built.length) return false
    return cycle.every((step, i) =>
      step.phase === built[i].phase && step.minutes === built[i].minutes
    )
  }

  function getCycleMode (s) {
    if (s.cycleMode === 'custom') return 'custom'
    if (s.cycleMode === 'classic') return 'classic'
    return isClassicCycle(s.cycle, s) ? 'classic' : 'custom'
  }

  function classicCycleSummary (s) {
    const n = s.sessionsBeforeLongBreak
    const w = s.workMinutes
    const sh = s.shortBreakMinutes
    const lg = s.longBreakMinutes
    if (n <= 1) return `${w} min focus → ${lg} min long break`
    return `${n}× ${w} min focus, ${sh} min break → ${lg} min long`
  }

  function resetFocusToCycleStart (d, cycle) {
    const f = ensureFocusTimer(d)
    f.cycleIndex = 0
    f.pomodorosInCycle = 0
    f.nextCycleIndex = null
    f.awaitingAction = null
    const first = cycle[0]
    f.mode = first.phase
    f.remainingSec = stepDurationSec(first)
  }

  function readClassicFromDom () {
    const workEl = document.getElementById('pomo-work')
    const shortEl = document.getElementById('pomo-short')
    const longEl = document.getElementById('pomo-long')
    const countEl = document.getElementById('pomo-count')
    const work = clampMinutes(parseInt(workEl?.value, 10), PHASE.work)
    const short = clampMinutes(parseInt(shortEl?.value, 10), PHASE.shortBreak)
    const long = clampMinutes(parseInt(longEl?.value, 10), PHASE.longBreak)
    const count = parseInt(countEl?.value, 10)
    const sessionsBeforeLongBreak = Math.min(8, Math.max(1, Number.isFinite(count) ? count : 4))
    return { workMinutes: work, shortBreakMinutes: short, longBreakMinutes: long, sessionsBeforeLongBreak }
  }

  function mergeNotices (raw) {
    return { ...DEFAULT_NOTICES, ...(raw || {}) }
  }

  function getPhaseNotice (s, phase, when) {
    const n = mergeNotices(s.notices)
    let key
    if (when === 'start') {
      if (phase === PHASE.work) key = 'workStart'
      else if (phase === PHASE.shortBreak) key = 'shortBreakStart'
      else key = 'longBreakStart'
    } else {
      if (phase === PHASE.work) key = 'workEnd'
      else if (phase === PHASE.shortBreak) key = 'shortBreakEnd'
      else key = 'longBreakEnd'
    }
    return (n[key] || '').trim()
  }

  function linkedTask (data) {
    const ft = ensureFocusTimer(data)
    if (!ft.linkedTaskId) return null
    return data.tasks?.find(t => t.id === ft.linkedTaskId) || null
  }

  function linkedTaskTitle (data) {
    const task = linkedTask(data)
    return task?.title?.trim() || ''
  }

  function buildRingEvent (step, nextStep, s, data) {
    let title = ''
    const bodyParts = []
    if (step.phase === PHASE.work) {
      title = 'Pomodoro complete!'
      const taskTitle = linkedTaskTitle(data)
      if (taskTitle) bodyParts.push(taskTitle)
      const end = getPhaseNotice(s, step.phase, 'end')
      if (end) bodyParts.push(end)
      if (nextStep.phase === PHASE.longBreak) {
        const start = getPhaseNotice(s, nextStep.phase, 'start')
        if (start) bodyParts.push(start)
        else bodyParts.push('Time for a long break')
      } else {
        const start = getPhaseNotice(s, nextStep.phase, 'start')
        if (start) bodyParts.push(start)
        else bodyParts.push('Take a short break')
      }
    } else if (step.phase === PHASE.longBreak) {
      title = 'Long break over'
      const end = getPhaseNotice(s, step.phase, 'end')
      if (end) bodyParts.push(end)
      const start = getPhaseNotice(s, PHASE.work, 'start')
      if (start) bodyParts.push(start)
      else bodyParts.push('Ready for your next pomodoro')
    } else {
      title = 'Break over'
      const end = getPhaseNotice(s, step.phase, 'end')
      if (end) bodyParts.push(end)
      const start = getPhaseNotice(s, PHASE.work, 'start')
      if (start) bodyParts.push(start)
      else bodyParts.push('Ready for your next pomodoro')
    }
    return {
      title,
      body: bodyParts.join('\n'),
      completedPhase: step.phase,
      nextPhase: nextStep.phase
    }
  }

  function inferClassicFromCycle (cycle) {
    const workSlots = cycle.filter(st => st.phase === PHASE.work)
    if (!workSlots.length) return null
    const workMinutes = workSlots[0].minutes
    if (workSlots.some(st => st.minutes !== workMinutes)) return null

    const longs = cycle.filter(st => st.phase === PHASE.longBreak)
    if (longs.length !== 1) return null
    const longBreakMinutes = longs[0].minutes

    const shorts = cycle.filter(st => st.phase === PHASE.shortBreak)
    const shortBreakMinutes = shorts[0]?.minutes ?? 5
    if (shorts.some(st => st.minutes !== shortBreakMinutes)) return null

    const inferred = {
      workMinutes,
      shortBreakMinutes,
      longBreakMinutes,
      sessionsBeforeLongBreak: workSlots.length
    }
    return isClassicCycle(cycle, inferred) ? inferred : null
  }

  function pomoSettings (data) {
    const s = { ...DEFAULT_POMO, ...(data.settings?.pomodoro || {}) }
    s.cycle = ensureCycle(s)
    const inferred = inferClassicFromCycle(s.cycle)
    if (inferred && s.cycleMode !== 'custom') {
      Object.assign(s, inferred)
      s.cycleMode = 'classic'
    } else if (!s.cycleMode) {
      s.cycleMode = inferred ? 'classic' : 'custom'
    }
    s.notices = mergeNotices(s.notices)
    return s
  }

  function normalizeCycle (raw) {
    return raw
      .map(step => ({
        phase: step.phase === 'longBreak' || step.phase === 'shortBreak' ? step.phase : PHASE.work,
        minutes: clampMinutes(step.minutes, step.phase)
      }))
      .filter(step => step.minutes > 0)
  }

  function clampMinutes (n, phase) {
    const v = parseInt(n, 10)
    if (!Number.isFinite(v)) return phase === PHASE.work ? 25 : 5
    if (phase === PHASE.work) return Math.min(120, Math.max(5, v))
    if (phase === PHASE.shortBreak) return Math.min(30, Math.max(1, v))
    return Math.min(60, Math.max(5, v))
  }

  function buildClassicCycle (s) {
    const n = Math.min(8, Math.max(1, s.sessionsBeforeLongBreak || 4))
    const cycle = []
    for (let i = 0; i < n; i++) {
      cycle.push({ phase: PHASE.work, minutes: s.workMinutes })
      if (i < n - 1) {
        cycle.push({ phase: PHASE.shortBreak, minutes: s.shortBreakMinutes })
      }
    }
    cycle.push({ phase: PHASE.longBreak, minutes: s.longBreakMinutes })
    return cycle
  }

  function ensureCycle (s) {
    if (s.cycle && Array.isArray(s.cycle) && s.cycle.length > 0) {
      return normalizeCycle(s.cycle)
    }
    return buildClassicCycle(s)
  }

  function stepDurationSec (step) {
    return step.minutes * 60
  }

  function currentStep (data, ft) {
    const cycle = pomoSettings(data).cycle
    const idx = Math.min(ft.cycleIndex || 0, cycle.length - 1)
    return cycle[idx]
  }

  function workSlotsInCycle (cycle) {
    return cycle.filter(s => s.phase === PHASE.work).length
  }

  function todayKey () {
    return new Date().toISOString().split('T')[0]
  }

  function ensureFocusTimer (data) {
    if (!data.settings) data.settings = {}
    if (!data.settings.pomodoro) data.settings.pomodoro = { ...DEFAULT_POMO }

    const s = pomoSettings(data)
    if (!data.settings.pomodoro.cycle) {
      data.settings.pomodoro.cycle = s.cycle
    }

    if (!data.focusTimer) {
      data.focusTimer = {
        cycleIndex: 0,
        mode: s.cycle[0]?.phase || PHASE.work,
        running: false,
        endsAt: null,
        remainingSec: stepDurationSec(s.cycle[0] || { minutes: 25, phase: PHASE.work }),
        pomodorosInCycle: 0,
        pomodorosToday: 0,
        todayDate: todayKey(),
        linkedTaskId: null,
        awaitingAction: null,
        nextCycleIndex: null
      }
    }

    const ft = data.focusTimer
    if (ft.sessionsCompleted != null && ft.pomodorosInCycle == null) {
      ft.pomodorosInCycle = ft.sessionsCompleted
      delete ft.sessionsCompleted
    }
    if (ft.linkedTaskId == null) ft.linkedTaskId = null
    else if (ft.linkedTaskId) {
      const task = data.tasks?.find(t => t.id === ft.linkedTaskId)
      if (!task || task.status === 'archived' || task.status === 'done') {
        ft.linkedTaskId = null
      } else if (api?.getFocusableTasks) {
        const allowed = api.getFocusableTasks()
        if (!allowed.some(t => t.id === ft.linkedTaskId)) ft.linkedTaskId = null
      }
    }
    if (ft.cycleIndex == null) ft.cycleIndex = 0
    if (ft.nextCycleIndex == null) ft.nextCycleIndex = null
    if (ft.todayDate !== todayKey()) {
      ft.todayDate = todayKey()
      ft.pomodorosToday = 0
    }
    if (ft.pomodorosInCycle == null) ft.pomodorosInCycle = 0
    if (ft.pomodorosToday == null) ft.pomodorosToday = 0

    const cycle = s.cycle
    if (ft.cycleIndex >= cycle.length) ft.cycleIndex = 0
    if (!ft.running && !ft.awaitingAction) {
      const step = cycle[ft.cycleIndex]
      ft.mode = step.phase
      if (ft.remainingSec == null) ft.remainingSec = stepDurationSec(step)
    }

    return ft
  }

  function getRemainingSec (data) {
    const ft = ensureFocusTimer(data)
    if (ft.running && ft.endsAt) {
      return Math.max(0, Math.ceil((new Date(ft.endsAt) - Date.now()) / 1000))
    }
    return ft.remainingSec ?? stepDurationSec(currentStep(data, ft))
  }

  function fmtTime (totalSec) {
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  function esc (str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function persist () {
    if (api?.onSave) return api.onSave()
    return Promise.resolve()
  }

  function stopTick () {
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null }
  }

  function startTick () {
    stopTick()
    tickInterval = setInterval(() => {
      const data = api.getData()
      const left = getRemainingSec(data)
      if (left <= 0) {
        onTimerRing(data)
        return
      }
      ensureFocusTimer(data).remainingSec = left
      api.onBarUpdate?.()
      const area = document.getElementById('task-area')
      if (area?.querySelector('.pomo-page')) updateCountdownDisplay(left)
    }, 250)
  }

  function awaitingForPhase (phase) {
    if (phase === PHASE.work) return AWAIT.work
    if (phase === PHASE.longBreak) return AWAIT.longBreak
    return AWAIT.break
  }

  function phaseLabelText (phase, minutes) {
    if (phase === PHASE.work) return `${minutes} minute focus`
    if (phase === PHASE.shortBreak) return `${minutes} minute break`
    return `${minutes} minute long break`
  }

  function onTimerRing (data) {
    const ft = ensureFocusTimer(data)
    const s = pomoSettings(data)
    const cycle = s.cycle
    const step = cycle[ft.cycleIndex]
    stopTick()
    ft.running = false
    ft.endsAt = null

    if (step.phase === PHASE.work) {
      ft.pomodorosToday = (ft.pomodorosToday || 0) + 1
      ft.pomodorosInCycle = (ft.pomodorosInCycle || 0) + 1
    }
    if (step.phase === PHASE.longBreak) ft.pomodorosInCycle = 0

    const nextIdx = (ft.cycleIndex + 1) % cycle.length
    ft.nextCycleIndex = nextIdx
    const nextStep = cycle[nextIdx]
    ft.awaitingAction = awaitingForPhase(nextStep.phase)
    ft.mode = nextStep.phase
    ft.remainingSec = stepDurationSec(nextStep)

    let message = ''
    if (step.phase === PHASE.work) {
      message = nextStep.phase === PHASE.longBreak
        ? 'Pomodoro complete — time for a long break'
        : 'Pomodoro complete — take a short break'
    } else if (step.phase === PHASE.longBreak) {
      message = 'Long break over — ready for your next pomodoro'
    } else {
      message = 'Break over — ready for your next pomodoro'
    }

    const event = buildRingEvent(step, nextStep, s, data)

    persist().then(() => {
      api.onBarUpdate?.()
      api.onToast?.(message)
      api.onPulse?.()
      api.onNotify?.({ title: event.title, body: event.body || message })
      api.onPomoEvent?.(event)
      if (step.phase === PHASE.work && s.confettiOnComplete) {
        api.onConfetti?.()
      }
      beginAwaitingPhase(data)
    })
  }

  function startTimer (data) {
    const ft = ensureFocusTimer(data)
    const step = currentStep(data, ft)
    if (getRemainingSec(data) <= 0) ft.remainingSec = stepDurationSec(step)

    ft.running = true
    ft.endsAt = new Date(Date.now() + getRemainingSec(data) * 1000).toISOString()
    ft.awaitingAction = null
    ft.nextCycleIndex = null
    ft.mode = step.phase

    persist().then(() => {
      api.onBarUpdate?.()
      startTick()
      if (api.getCurrentView?.() === 'pomodoro') render(document.getElementById('task-area'))
    })
  }

  function pauseTimer (data) {
    const ft = ensureFocusTimer(data)
    ft.remainingSec = getRemainingSec(data)
    ft.running = false
    ft.endsAt = null
    stopTick()
    persist().then(() => {
      api.onBarUpdate?.()
      if (api.getCurrentView?.() === 'pomodoro') render(document.getElementById('task-area'))
    })
  }

  function voidPomodoro (data) {
    const cycle = pomoSettings(data).cycle
    stopTick()
    const ft = ensureFocusTimer(data)
    ft.running = false
    ft.endsAt = null
    resetFocusToCycleStart(data, cycle)
    persist().then(() => {
      api.onBarUpdate?.()
      if (api.getCurrentView?.() === 'pomodoro') render(document.getElementById('task-area'))
    })
    api.onToast?.('Pomodoro voided — start fresh')
  }

  function beginAwaitingPhase (data) {
    const ft = ensureFocusTimer(data)
    const cycle = pomoSettings(data).cycle
    if (ft.nextCycleIndex != null) {
      ft.cycleIndex = ft.nextCycleIndex
      ft.nextCycleIndex = null
    }
    const step = cycle[ft.cycleIndex]
    ft.mode = step.phase
    ft.remainingSec = stepDurationSec(step)
    ft.awaitingAction = null
    startTimer(data)
  }

  function phaseLabel (ft, data) {
    const s = pomoSettings(data)
    if (ft.awaitingAction === AWAIT.break) {
      const next = s.cycle[ft.nextCycleIndex ?? (ft.cycleIndex + 1) % s.cycle.length]
      return `Time for a ${next.minutes} min break`
    }
    if (ft.awaitingAction === AWAIT.longBreak) {
      const next = s.cycle[ft.nextCycleIndex ?? (ft.cycleIndex + 1) % s.cycle.length]
      return `Time for a ${next.minutes} min long break`
    }
    if (ft.awaitingAction === AWAIT.work) return 'Ready for a pomodoro'
    const step = currentStep(data, ft)
    return phaseLabelText(step.phase, step.minutes)
  }

  function isPomodoroActive (data, ft) {
    if (ft.running) return true
    if (ft.awaitingAction) return true
    const step = currentStep(data, ft)
    if (ft.remainingSec < stepDurationSec(step)) return true
    if ((ft.pomodorosInCycle || 0) > 0) return true
    if ((ft.cycleIndex || 0) > 0) return true
    return false
  }

  function primaryButton (data, ft, s) {
    const nextIdx = ft.nextCycleIndex ?? (ft.cycleIndex + 1) % s.cycle.length
    const nextStep = s.cycle[nextIdx]
    if (ft.awaitingAction === AWAIT.break) {
      return { label: `Start ${nextStep.minutes} min break`, action: 'beginAwaiting' }
    }
    if (ft.awaitingAction === AWAIT.longBreak) {
      return { label: `Start ${nextStep.minutes} min break`, action: 'beginAwaiting' }
    }
    if (ft.awaitingAction === AWAIT.work) {
      return { label: 'Start pomodoro', action: 'beginAwaiting' }
    }
    if (ft.running) return { label: 'Pause', action: 'pause' }
    const step = currentStep(data, ft)
    const full = stepDurationSec(step)
    if (ft.remainingSec < full) return { label: 'Resume', action: 'start' }
    if (step.phase === PHASE.work) return { label: 'Start pomodoro', action: 'start' }
    return { label: 'Resume break', action: 'start' }
  }

  function cyclePreview (cycle) {
    return cycle.map(step => {
      if (step.phase === PHASE.work) return `${step.minutes}m focus`
      if (step.phase === PHASE.longBreak) return `${step.minutes}m long`
      return `${step.minutes}m break`
    }).join(' → ')
  }

  function updateCountdownDisplay (left) {
    const el = document.getElementById('pomo-countdown')
    if (el) el.textContent = fmtTime(left)
    const ring = document.getElementById('pomo-ring')
    if (ring) {
      const data = api.getData()
      const ft = ensureFocusTimer(data)
      const cycle = pomoSettings(data).cycle
      const step = currentStep(data, ft)
      const displayStep = (ft.awaitingAction && ft.nextCycleIndex != null)
        ? cycle[ft.nextCycleIndex]
        : step
      const total = stepDurationSec(displayStep)
      const pct = total > 0 ? left / total : 0
      ring.style.setProperty('--pomo-pct', String(pct))
      const isBreak = displayStep.phase === PHASE.shortBreak || displayStep.phase === PHASE.longBreak
      ring.classList.toggle('break', isBreak)
      ring.classList.toggle('work', !isBreak)
    }
  }

  function readCycleFromDom () {
    const steps = []
    document.querySelectorAll('.pomo-cycle-step').forEach(row => {
      const phase = row.querySelector('.pomo-step-phase').value
      const minutes = parseInt(row.querySelector('.pomo-step-min').value, 10)
      steps.push({ phase, minutes })
    })
    return normalizeCycle(steps.length ? steps : [{ phase: PHASE.work, minutes: 25 }])
  }

  function render (area) {
    if (!area) return
    const data = api.getData()
    const ft = ensureFocusTimer(data)
    const s = pomoSettings(data)
    const cycle = s.cycle
    const left = getRemainingSec(data)
    const step = currentStep(data, ft)
    const displayStep = (ft.awaitingAction && ft.nextCycleIndex != null)
      ? cycle[ft.nextCycleIndex]
      : step
    const total = stepDurationSec(displayStep)
    const pct = total > 0 ? left / total : 0
    const primary = primaryButton(data, ft, s)
    const isBreak = displayStep.phase === PHASE.shortBreak || displayStep.phase === PHASE.longBreak
    const ringClass = isBreak ? 'pomo-ring break' : 'pomo-ring work'
    const workSlots = workSlotsInCycle(cycle)
    const editingLocked = ft.running
    const cycleMode = getCycleMode(s)
    const cycleSummary = cycleMode === 'classic'
      ? classicCycleSummary(s)
      : cyclePreview(cycle)
    const focusTasks = api.getFocusableTasks?.() || []
    const taskPickLocked = ft.running && step.phase === PHASE.work
    const selectedTask = linkedTask(data)

    area.innerHTML = `
      <div class="pomo-page">
        <div class="pomo-meta">
          <span class="pomo-today-count">${ft.pomodorosToday || 0} today</span>
          <div class="pomo-tomatoes" aria-label="${ft.pomodorosInCycle || 0} of ${workSlots} focus sessions completed this cycle">
            ${Array.from({ length: workSlots }, (_, i) => {
              const filled = i < (ft.pomodorosInCycle || 0)
              return `<span class="pomo-tomato${filled ? ' filled' : ''}" aria-hidden="true"></span>`
            }).join('')}
          </div>
        </div>

        <div class="pomo-task-section">
          <div class="pomo-task-header">
            <span class="pomo-task-heading">Today</span>
            ${taskPickLocked ? '<span class="pomo-task-hint">Pause to change</span>' : ''}
          </div>
          ${focusTasks.length === 0
            ? '<p class="pomo-task-empty">Nothing for today — tasks due today appear here, or use <strong>Today</strong> on a task</p>'
            : `
          <div class="pomo-task-scroll">
            <div class="pomo-task-bar" role="listbox" aria-label="Select task for this pomodoro">
              <button type="button" class="pomo-task-chip${!ft.linkedTaskId ? ' active' : ''}"
                data-task-id="" ${taskPickLocked ? 'disabled' : ''}>None</button>
              ${focusTasks.map(t => `
                <button type="button" class="pomo-task-chip${ft.linkedTaskId === t.id ? ' active' : ''}"
                  data-task-id="${esc(t.id)}" ${taskPickLocked ? 'disabled' : ''}
                  title="${esc(t.title)}">${esc(t.title)}</button>
              `).join('')}
            </div>
          </div>
          `}
          ${selectedTask
            ? `<p class="pomo-task-selected">Working on: <strong>${esc(selectedTask.title)}</strong></p>`
            : ''}
        </div>

        <p class="pomo-phase-label">${esc(phaseLabel(ft, data))}</p>

        <div class="pomo-ring-wrap">
          <div id="pomo-ring" class="${ringClass}" style="--pomo-pct: ${pct}">
            <span id="pomo-countdown" class="pomo-countdown">${fmtTime(left)}</span>
          </div>
        </div>

        <p class="pomo-cycle-preview">${esc(cycleSummary)}</p>

        <div class="pomo-actions">
          <button type="button" id="pomo-primary" class="footer-btn primary pomo-primary-btn">${esc(primary.label)}</button>
          ${isPomodoroActive(data, ft)
            ? '<button type="button" id="pomo-void" class="footer-btn small">Void</button>'
            : ''}
        </div>

        <section class="pomo-settings-block">
          <div class="pomo-settings-heading-row">
            <h3 class="pomo-settings-heading">Cycle</h3>
            ${cycleMode === 'custom' ? '<span class="pomo-mode-badge">Custom</span>' : ''}
          </div>

          <div class="pomo-cycle-grid">
            <label class="pomo-setting">
              <span>Focus</span>
              <div class="pomo-setting-input">
                <input type="number" id="pomo-work" class="form-input small" min="5" max="120"
                  value="${s.workMinutes}" ${editingLocked ? 'disabled' : ''} />
                <span class="pomo-step-unit">min</span>
              </div>
            </label>
            <label class="pomo-setting">
              <span>Short break</span>
              <div class="pomo-setting-input">
                <input type="number" id="pomo-short" class="form-input small" min="1" max="30"
                  value="${s.shortBreakMinutes}" ${editingLocked ? 'disabled' : ''} />
                <span class="pomo-step-unit">min</span>
              </div>
            </label>
            <label class="pomo-setting">
              <span>Long break</span>
              <div class="pomo-setting-input">
                <input type="number" id="pomo-long" class="form-input small" min="5" max="60"
                  value="${s.longBreakMinutes}" ${editingLocked ? 'disabled' : ''} />
                <span class="pomo-step-unit">min</span>
              </div>
            </label>
            <label class="pomo-setting">
              <span>Per cycle <span class="pomo-field-hint-inline">max 8</span></span>
              <div class="pomo-setting-input">
                <input type="number" id="pomo-count" class="form-input small" min="1" max="8"
                  value="${s.sessionsBeforeLongBreak}" ${editingLocked ? 'disabled' : ''}
                  title="Pomodoros before long break (max 8)" />
                <span class="pomo-step-unit">×</span>
              </div>
            </label>
          </div>

          <p class="pomo-cycle-summary">${esc(classicCycleSummary(s))}</p>

          ${editingLocked
            ? '<p class="pomo-settings-locked">Pause the timer to edit your cycle.</p>'
            : ''}

          <details class="pomo-notices-fold">
            <summary class="pomo-notices-summary">
              <span>Event notices</span>
              <span class="fold-chevron" aria-hidden="true">›</span>
            </summary>
            <p class="pomo-settings-hint">Custom messages when a phase starts or ends — e.g. “Walk around!” when a break begins.</p>
            <div class="pomo-notices-grid">
              <label class="pomo-notice-field">
                <span>Focus starts</span>
                <input type="text" id="pomo-notice-work-start" class="form-input" maxlength="120"
                  value="${esc(s.notices.workStart)}" placeholder="Time to focus" ${editingLocked ? 'disabled' : ''} />
              </label>
              <label class="pomo-notice-field">
                <span>Focus ends</span>
                <input type="text" id="pomo-notice-work-end" class="form-input" maxlength="120"
                  value="${esc(s.notices.workEnd)}" placeholder="Optional" ${editingLocked ? 'disabled' : ''} />
              </label>
              <label class="pomo-notice-field">
                <span>Short break starts</span>
                <input type="text" id="pomo-notice-short-start" class="form-input" maxlength="120"
                  value="${esc(s.notices.shortBreakStart)}" placeholder="Walk around!" ${editingLocked ? 'disabled' : ''} />
              </label>
              <label class="pomo-notice-field">
                <span>Short break ends</span>
                <input type="text" id="pomo-notice-short-end" class="form-input" maxlength="120"
                  value="${esc(s.notices.shortBreakEnd)}" placeholder="Optional" ${editingLocked ? 'disabled' : ''} />
              </label>
              <label class="pomo-notice-field">
                <span>Long break starts</span>
                <input type="text" id="pomo-notice-long-start" class="form-input" maxlength="120"
                  value="${esc(s.notices.longBreakStart)}" placeholder="Stretch and hydrate" ${editingLocked ? 'disabled' : ''} />
              </label>
              <label class="pomo-notice-field">
                <span>Long break ends</span>
                <input type="text" id="pomo-notice-long-end" class="form-input" maxlength="120"
                  value="${esc(s.notices.longBreakEnd)}" placeholder="Optional" ${editingLocked ? 'disabled' : ''} />
              </label>
            </div>
            <label class="pomo-confetti-toggle">
              <input type="checkbox" id="pomo-confetti" ${s.confettiOnComplete ? 'checked' : ''} ${editingLocked ? 'disabled' : ''} />
              <span>Confetti when a pomodoro completes</span>
            </label>
          </details>

          <details class="pomo-custom-fold" ${cycleMode === 'custom' ? 'open' : ''}>
            <summary class="pomo-custom-summary">
              <span>Custom sequence</span>
              <span class="fold-chevron" aria-hidden="true">›</span>
            </summary>
            <p class="pomo-settings-hint">Build a non-standard order — e.g. two short breaks, or focus without a long break at the end.</p>

            <div id="pomo-cycle-steps" class="pomo-cycle-steps">
              ${cycle.map((step, i) => `
                <div class="pomo-cycle-step" data-idx="${i}">
                  <select class="pomo-step-phase form-select" ${editingLocked ? 'disabled' : ''}>
                    <option value="work" ${step.phase === PHASE.work ? 'selected' : ''}>Focus</option>
                    <option value="shortBreak" ${step.phase === PHASE.shortBreak ? 'selected' : ''}>Short break</option>
                    <option value="longBreak" ${step.phase === PHASE.longBreak ? 'selected' : ''}>Long break</option>
                  </select>
                  <input type="number" class="pomo-step-min form-input small" min="1" max="120"
                    value="${step.minutes}" ${editingLocked ? 'disabled' : ''} />
                  <span class="pomo-step-unit">min</span>
                  <button type="button" class="pomo-step-remove icon-btn small" data-idx="${i}"
                    ${editingLocked || cycle.length <= 1 ? 'disabled' : ''} title="Remove step">✕</button>
                </div>
              `).join('')}
            </div>

            <div class="pomo-cycle-add">
              <button type="button" class="footer-btn small" data-add="work" ${editingLocked ? 'disabled' : ''}>+ Focus</button>
              <button type="button" class="footer-btn small" data-add="shortBreak" ${editingLocked ? 'disabled' : ''}>+ Short</button>
              <button type="button" class="footer-btn small" data-add="longBreak" ${editingLocked ? 'disabled' : ''}>+ Long</button>
            </div>

            <button type="button" id="pomo-use-classic" class="footer-btn small pomo-use-classic"
              ${editingLocked ? 'disabled' : ''}>Use classic cycle</button>
          </details>
        </section>
      </div>
    `

    area.querySelector('#pomo-primary').addEventListener('click', () => {
      const d = api.getData()
      const act = primary.action
      if (act === 'pause') pauseTimer(d)
      else if (act === 'beginAwaiting') beginAwaitingPhase(d)
      else startTimer(d)
    })

    area.querySelectorAll('.pomo-task-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        if (taskPickLocked) return
        const d = api.getData()
        const ft = ensureFocusTimer(d)
        const id = btn.dataset.taskId || ''
        ft.linkedTaskId = id || null
        persist().then(() => {
          api.onBarUpdate?.()
          render(area)
        })
      })
    })

    const voidBtn = area.querySelector('#pomo-void')
    if (voidBtn) voidBtn.addEventListener('click', () => voidPomodoro(api.getData()))

    const saveCustomCycle = () => {
      if (ensureFocusTimer(api.getData()).running) return
      const d = api.getData()
      const settings = pomoSettings(d)
      const newCycle = readCycleFromDom()
      settings.cycle = newCycle
      settings.cycleMode = 'custom'
      settings.workMinutes = newCycle.find(st => st.phase === PHASE.work)?.minutes ?? settings.workMinutes
      settings.shortBreakMinutes = newCycle.find(st => st.phase === PHASE.shortBreak)?.minutes ?? settings.shortBreakMinutes
      settings.longBreakMinutes = newCycle.find(st => st.phase === PHASE.longBreak)?.minutes ?? settings.longBreakMinutes
      settings.sessionsBeforeLongBreak = workSlotsInCycle(newCycle)
      d.settings.pomodoro = settings
      resetFocusToCycleStart(d, newCycle)
      persist().then(() => render(area))
    }

    const applyClassicCycle = () => {
      if (ensureFocusTimer(api.getData()).running) return
      const d = api.getData()
      const settings = pomoSettings(d)
      const classic = readClassicFromDom()
      Object.assign(settings, classic)
      settings.cycle = buildClassicCycle(settings)
      settings.cycleMode = 'classic'
      d.settings.pomodoro = settings
      resetFocusToCycleStart(d, settings.cycle)
      persist().then(() => render(area))
    }

    area.querySelectorAll('#pomo-work, #pomo-short, #pomo-long, #pomo-count').forEach(el => {
      el.addEventListener('change', applyClassicCycle)
    })

    area.querySelectorAll('.pomo-step-phase, .pomo-step-min').forEach(el => {
      el.addEventListener('change', saveCustomCycle)
    })

    area.querySelectorAll('.pomo-step-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = api.getData()
        const settings = pomoSettings(d)
        const idx = parseInt(btn.dataset.idx, 10)
        settings.cycle = settings.cycle.filter((_, i) => i !== idx)
        settings.cycleMode = 'custom'
        d.settings.pomodoro = settings
        resetFocusToCycleStart(d, settings.cycle)
        persist().then(() => render(area))
      })
    })

    area.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = api.getData()
        const settings = pomoSettings(d)
        const phase = btn.dataset.add
        const defaultMin = phase === PHASE.work ? settings.workMinutes
          : phase === PHASE.longBreak ? settings.longBreakMinutes
          : settings.shortBreakMinutes
        settings.cycle = [...settings.cycle, { phase, minutes: defaultMin }]
        settings.cycleMode = 'custom'
        d.settings.pomodoro = settings
        persist().then(() => render(area))
      })
    })

    area.querySelector('#pomo-use-classic')?.addEventListener('click', applyClassicCycle)

    bindPomoFocus(area)

    const saveNotices = () => {
      if (ensureFocusTimer(api.getData()).running) return
      const d = api.getData()
      const settings = pomoSettings(d)
      settings.notices = {
        workStart: document.getElementById('pomo-notice-work-start')?.value?.trim() || '',
        workEnd: document.getElementById('pomo-notice-work-end')?.value?.trim() || '',
        shortBreakStart: document.getElementById('pomo-notice-short-start')?.value?.trim() || '',
        shortBreakEnd: document.getElementById('pomo-notice-short-end')?.value?.trim() || '',
        longBreakStart: document.getElementById('pomo-notice-long-start')?.value?.trim() || '',
        longBreakEnd: document.getElementById('pomo-notice-long-end')?.value?.trim() || ''
      }
      settings.confettiOnComplete = document.getElementById('pomo-confetti')?.checked ?? true
      d.settings.pomodoro = settings
      persist()
    }

    area.querySelectorAll('.pomo-notices-fold input').forEach(el => {
      el.addEventListener('change', saveNotices)
    })
  }

  function restore (data) {
    ensureFocusTimer(data)
    const ft = data.focusTimer
    if (ft.running && ft.endsAt) {
      const left = Math.ceil((new Date(ft.endsAt) - Date.now()) / 1000)
      if (left <= 0) onTimerRing(data)
      else {
        ft.remainingSec = left
        startTick()
      }
    }
  }

  function barPhaseShort (data) {
    const ft = ensureFocusTimer(data)
    if (ft.awaitingAction === AWAIT.break) return 'break'
    if (ft.awaitingAction === AWAIT.longBreak) return 'long'
    if (ft.awaitingAction === AWAIT.work) return 'ready'
    if (ft.running) {
      const step = currentStep(data, ft)
      if (step.phase === PHASE.work) return 'focus'
      if (step.phase === PHASE.longBreak) return 'long'
      return 'break'
    }
    return ''
  }

  function isBreakDisplay (data) {
    const ft = ensureFocusTimer(data)
    if (ft.awaitingAction === AWAIT.break || ft.awaitingAction === AWAIT.longBreak) return true
    if (!ft.running) return false
    const step = currentStep(data, ft)
    return step.phase === PHASE.shortBreak || step.phase === PHASE.longBreak
  }

  function isActive (data) {
    const ft = ensureFocusTimer(data)
    return ft.running || ft.awaitingAction != null
  }

  function barLabelText (data) {
    const ft = ensureFocusTimer(data)
    if (ft.awaitingAction === AWAIT.break) return 'break time'
    if (ft.awaitingAction === AWAIT.longBreak) return 'long break'
    if (ft.awaitingAction === AWAIT.work) return 'ready'
    if (ft.running) {
      const left = getRemainingSec(data)
      const step = currentStep(data, ft)
      if (step.phase === PHASE.work) return `${fmtTime(left)} pomodoro`
      return `${fmtTime(left)} break`
    }
    return ''
  }

  window.RMPFocus = {
    init (callbacks) {
      api = callbacks
      const data = api.getData()
      ensureFocusTimer(data)
      restore(data)
    },

    render (area) {
      render(area)
    },

    ensureDefaults (data) {
      return ensureFocusTimer(data)
    },

    isRunning () {
      if (!api) return false
      return ensureFocusTimer(api.getData()).running
    },

    isActive () {
      if (!api) return false
      return isActive(api.getData())
    },

    barTime () {
      if (!api) return ''
      return fmtTime(getRemainingSec(api.getData()))
    },

    barPhaseShort () {
      if (!api) return ''
      return barPhaseShort(api.getData())
    },

    isBreakPhase () {
      if (!api) return false
      return isBreakDisplay(api.getData())
    },

    linkedTaskTitle () {
      if (!api) return ''
      return linkedTaskTitle(api.getData())
    },

    barLabel () {
      if (!api) return ''
      return barLabelText(api.getData())
    },

    trayLabel () {
      if (!api) return ''
      const data = api.getData()
      if (!isActive(data)) return ''
      return ` ${fmtTime(getRemainingSec(data))}`
    }
  }
})()
