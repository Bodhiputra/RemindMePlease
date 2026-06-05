// Plain-text formatting for share / copy / export
function formatTaskPlain (task) {
  const done = task.status === 'done'
  const mark = done ? '[x]' : '[ ]'
  let lines = [`${mark} ${task.title}`]
  if (task.subtasks?.length) {
    for (const s of task.subtasks) {
      const subMark = s.done ? '[x]' : '[ ]'
      lines.push(`  ${subMark} ${s.title}`)
    }
  }
  return lines.join('\n')
}

function formatAllTasksPlain (data) {
  const tasks = (data.tasks || []).filter(t => t.status !== 'archived')
  const header = [
    'RemindMePlease',
    `Exported ${new Date().toLocaleString()}`,
    '—'.repeat(40),
    ''
  ].join('\n')

  if (!tasks.length) return header + '(no tasks)'

  const active = tasks.filter(t => t.status !== 'done')
  const done = tasks.filter(t => t.status === 'done')

  const sections = []
  if (active.length) {
    sections.push('TODO', ...active.map(formatTaskPlain), '')
  }
  if (done.length) {
    sections.push('DONE', ...done.map(formatTaskPlain), '')
  }
  return header + sections.join('\n').trimEnd()
}
