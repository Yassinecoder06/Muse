import type { GraphData, Note, Task } from '../types'

// Workspace analytics, computed from real data only: notes, tasks, the
// knowledge graph, Bip conversations and AI usage. Everything is pure so it
// runs the same for server notes and Secure Vault notes (which never leave the
// browser unencrypted), and every date is bucketed in the viewer's timezone.

export type AiUsageRow = { at: string; provider: string; model: string; task: string; tokens: number }
export type Activity = { since: string; chats: string[]; ai: AiUsageRow[] }

export type InsightInput = {
  notes: Note[] // active + archived, not trashed
  tasks: Task[]
  graph: GraphData | null
  activity: Activity | null
  range: number // days
  now?: Date
  zone?: string
}

/** A metric for the selected range next to the same-length range before it. */
export type Delta = { value: number; previous: number; change: number | null }
export type DailyPoint = { key: string; label: string; notes: number; tasks: number; chats: number }
export type HeatCell = { key: string; count: number; level: 0 | 1 | 2 | 3 | 4; future: boolean }
export type NoteRef = { id: string; title: string }
export type Highlight = { tone: 'good' | 'warn' | 'info'; text: string }

export type Insights = {
  range: number
  kpis: { notes: Delta; words: Delta; tasks: Delta; chats: Delta | null; tokens: Delta | null; activeDays: Delta }
  streak: { current: number; longest: number; activeToday: boolean }
  trend: { points: DailyPoint[]; bucket: 'day' | 'week' }
  heatmap: { weeks: HeatCell[][]; total: number; activeDays: number }
  rhythm: { grid: number[][]; total: number; peakDay: number | null; peakHour: number | null }
  tasks: {
    open: number; overdue: number; dueToday: number; dueThisWeek: number; undated: number
    openByPriority: { high: number; medium: number; low: number }
    onTimeRate: number | null; medianHoursToDone: number | null
    overdueList: { id: string; text: string; due: string; daysLate: number }[]
  }
  tags: { tag: string; count: number; recent: number; previous: number }[]
  library: { total: number; active: number; archived: number; favorites: number; byKind: Record<'note' | 'research' | 'specialized', number>; words: number; avgWords: number; longest: (NoteRef & { words: number }) | null }
  graph: { nodes: number; links: number; avgLinks: number; orphans: NoteRef[]; orphanCount: number; hubs: (NoteRef & { links: number })[] } | null
  resurface: (NoteRef & { daysAgo: number; favorite: boolean })[]
  ai: { calls: number; tokens: number; byModel: { model: string; provider: string; calls: number; tokens: number }[]; byTask: { task: string; calls: number; tokens: number }[] } | null
  highlights: Highlight[]
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
const DAY_MS = 86_400_000
const RESURFACE_AFTER_DAYS = 45

// ------------------------------------------------------------------ Dates

const formatters = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(zone: string) {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' })
    formatters.set(zone, formatter)
  }
  return formatter
}

/** Local calendar day, hour and weekday (Mon = 0) of an instant in `zone`. */
export function localParts(value: string | Date, zone: string) {
  const parts: Record<string, string> = {}
  for (const part of partsFormatter(zone).formatToParts(typeof value === 'string' ? new Date(value) : value)) parts[part.type] = part.value
  return { key: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, weekday: WEEKDAYS.indexOf(parts.weekday) }
}

// Day keys ("YYYY-MM-DD") are calendar dates, so stepping them in UTC is exact.
export function shiftKey(key: string, days: number) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
const weekdayOfKey = (key: string) => (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7
const shortDate = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })

// ---------------------------------------------------------------- Helpers

export function countWords(content: string) {
  const text = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // markdown images
    .replace(/data:[^\s"')]+/g, ' ') // inline image data
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0
}

function delta(value: number, previous: number, comparable = true): Delta {
  return { value, previous, change: comparable && previous > 0 ? Math.round((value - previous) / previous * 100) : null }
}

/** When a task was checked off. Tasks from Secure Vault (or before migration 019) have no timestamp. */
const doneAt = (task: Task) => task.completed ? task.completed_at || task.created_at : null

const titleOf = (note: { title?: string }) => note.title?.trim() || 'Untitled'

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function hourLabel(hour: number) {
  const suffix = hour < 12 ? 'AM' : 'PM'
  return `${hour % 12 || 12} ${suffix}`
}

// ------------------------------------------------------------------ Engine

export function computeInsights(input: InsightInput): Insights {
  const zone = input.zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const now = input.now || new Date()
  const range = Math.max(1, Math.round(input.range))
  const today = localParts(now, zone).key
  const start = shiftKey(today, -(range - 1)) // first day of the selected range
  const prevStart = shiftKey(start, -range)
  const inRange = (key: string) => key >= start && key <= today
  const inPrev = (key: string) => key >= prevStart && key < start
  // Chats and AI usage are fetched for a limited window; only compare when
  // the previous range is fully covered by it.
  const activitySince = input.activity ? localParts(input.activity.since, zone).key : null
  const activityComparable = activitySince !== null && activitySince <= prevStart

  const notes = input.notes.filter(note => !note.deleted_at)
  const noteWords = new Map(notes.map(note => [note.id, countWords(note.content || '')]))
  const created = notes.map(note => ({ note, ...localParts(note.created_at, zone) }))
  const edited = notes
    .filter(note => note.updated_at && note.updated_at !== note.created_at)
    .map(note => localParts(note.updated_at, zone))
  const done = input.tasks
    .map(task => ({ task, at: doneAt(task) }))
    .filter((item): item is { task: Task; at: string } => Boolean(item.at))
    .map(item => ({ ...item, ...localParts(item.at, zone) }))
  const chats = (input.activity?.chats || []).map(at => localParts(at, zone))
  const aiRows = (input.activity?.ai || []).map(row => ({ row, ...localParts(row.at, zone) }))

  // Every day with any activity, for streaks and active-day counts.
  const perDay = new Map<string, number>()
  const bump = (key: string) => perDay.set(key, (perDay.get(key) || 0) + 1)
  created.forEach(item => bump(item.key))
  edited.forEach(item => bump(item.key))
  done.forEach(item => bump(item.key))
  chats.forEach(item => bump(item.key))

  // ---------------------------------------------------------------- KPIs
  const countIn = <T extends { key: string }>(items: T[], test: (key: string) => boolean) => items.filter(item => test(item.key)).length
  const wordsIn = (test: (key: string) => boolean) => created.filter(item => test(item.key)).reduce((sum, item) => sum + (noteWords.get(item.note.id) || 0), 0)
  const activeIn = (test: (key: string) => boolean) => [...perDay.keys()].filter(test).length
  const tokensIn = (test: (key: string) => boolean) => aiRows.filter(item => test(item.key)).reduce((sum, item) => sum + item.row.tokens, 0)

  const kpis: Insights['kpis'] = {
    notes: delta(countIn(created, inRange), countIn(created, inPrev)),
    words: delta(wordsIn(inRange), wordsIn(inPrev)),
    tasks: delta(countIn(done, inRange), countIn(done, inPrev)),
    chats: input.activity ? delta(countIn(chats, inRange), countIn(chats, inPrev), activityComparable) : null,
    tokens: input.activity ? delta(tokensIn(inRange), tokensIn(inPrev), activityComparable) : null,
    activeDays: delta(activeIn(inRange), activeIn(inPrev))
  }

  // -------------------------------------------------------------- Streaks
  const activeToday = perDay.has(today)
  let current = 0
  for (let key = activeToday ? today : shiftKey(today, -1); perDay.has(key); key = shiftKey(key, -1)) current++
  let longest = 0
  let run = 0
  let last: string | null = null
  for (const key of [...perDay.keys()].sort()) {
    run = last && daysBetween(last, key) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    last = key
  }

  // ---------------------------------------------------------------- Trend
  const bucket: 'day' | 'week' = range > 90 ? 'week' : 'day'
  const points: DailyPoint[] = []
  const pointIndex = new Map<string, number>()
  if (bucket === 'day') {
    for (let i = 0; i < range; i++) {
      const key = shiftKey(start, i)
      pointIndex.set(key, points.length)
      points.push({ key, label: range <= 7 ? WEEKDAYS[weekdayOfKey(key)] : shortDate(key), notes: 0, tasks: 0, chats: 0 })
    }
  } else {
    // Weeks start on Monday; the first one may begin before the range does.
    for (let week = shiftKey(start, -weekdayOfKey(start)); week <= today; week = shiftKey(week, 7)) {
      for (let d = 0; d < 7; d++) pointIndex.set(shiftKey(week, d), points.length)
      points.push({ key: week, label: shortDate(week), notes: 0, tasks: 0, chats: 0 })
    }
  }
  const add = (key: string, field: 'notes' | 'tasks' | 'chats') => {
    const index = inRange(key) ? pointIndex.get(key) : undefined
    if (index !== undefined) points[index][field]++
  }
  created.forEach(item => add(item.key, 'notes'))
  done.forEach(item => add(item.key, 'tasks'))
  chats.forEach(item => add(item.key, 'chats'))

  // -------------------------------------------------------------- Heatmap
  // 53 Monday-first weeks ending with the current one, like a contribution graph.
  const heatStart = shiftKey(today, -weekdayOfKey(today) - 52 * 7)
  const nonZero = [...perDay.entries()].filter(([key]) => key >= heatStart && key <= today).map(([, count]) => count).sort((a, b) => a - b)
  const quantile = (q: number) => nonZero.length ? nonZero[Math.min(nonZero.length - 1, Math.floor(q * nonZero.length))] : 0
  const [q1, q2, q3] = [quantile(0.25), quantile(0.5), quantile(0.75)]
  const level = (count: number): HeatCell['level'] => count === 0 ? 0 : count <= q1 ? 1 : count <= q2 ? 2 : count <= q3 ? 3 : 4
  const weeks: HeatCell[][] = []
  for (let week = 0; week < 53; week++) {
    const column: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const key = shiftKey(heatStart, week * 7 + d)
      const count = key > today ? 0 : perDay.get(key) || 0
      column.push({ key, count, level: level(count), future: key > today })
    }
    weeks.push(column)
  }

  // --------------------------------------------------------------- Rhythm
  const grid = WEEKDAYS.map(() => Array.from({ length: 24 }, () => 0))
  const plot = (item: { key: string; hour: number; weekday: number }) => { if (inRange(item.key) && item.weekday >= 0) grid[item.weekday][item.hour]++ }
  created.forEach(plot)
  done.filter(item => item.task.completed_at).forEach(plot) // only real completion times
  chats.forEach(plot)
  const rhythmTotal = grid.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0)
  const dayTotals = grid.map(row => row.reduce((a, b) => a + b, 0))
  const hourTotals = grid[0].map((_, hour) => grid.reduce((sum, row) => sum + row[hour], 0))
  const peakDay = rhythmTotal ? dayTotals.indexOf(Math.max(...dayTotals)) : null
  const peakHour = rhythmTotal ? hourTotals.indexOf(Math.max(...hourTotals)) : null

  // ---------------------------------------------------------------- Tasks
  const open = input.tasks.filter(task => !task.completed)
  const weekAhead = shiftKey(today, 7)
  const overdue = open.filter(task => task.due_date && task.due_date < today).sort((a, b) => a.due_date!.localeCompare(b.due_date!))
  const doneInRange = done.filter(item => inRange(item.key))
  const withDue = doneInRange.filter(item => item.task.due_date)
  const durations = doneInRange
    .filter(item => item.task.completed_at && item.task.completed_at !== item.task.created_at)
    .map(item => (Date.parse(item.at) - Date.parse(item.task.created_at)) / 3_600_000)
    .filter(hours => hours >= 0)
  const priority = (task: Task) => task.priority === 'high' || task.priority === 'low' ? task.priority : 'medium'
  const tasks: Insights['tasks'] = {
    open: open.length,
    overdue: overdue.length,
    dueToday: open.filter(task => task.due_date === today).length,
    dueThisWeek: open.filter(task => task.due_date && task.due_date > today && task.due_date <= weekAhead).length,
    undated: open.filter(task => !task.due_date).length,
    openByPriority: {
      high: open.filter(task => priority(task) === 'high').length,
      medium: open.filter(task => priority(task) === 'medium').length,
      low: open.filter(task => priority(task) === 'low').length
    },
    onTimeRate: withDue.length ? Math.round(withDue.filter(item => item.key <= item.task.due_date!).length / withDue.length * 100) : null,
    medianHoursToDone: median(durations),
    overdueList: overdue.slice(0, 5).map(task => ({ id: task.id, text: task.text, due: task.due_date!, daysLate: daysBetween(task.due_date!, today) }))
  }

  // ----------------------------------------------------------------- Tags
  const tagStats = new Map<string, { count: number; recent: number; previous: number }>()
  for (const item of created) {
    if (item.note.archived) continue
    for (const tag of new Set(item.note.tags)) {
      const stat = tagStats.get(tag) || { count: 0, recent: 0, previous: 0 }
      stat.count++
      if (inRange(item.key)) stat.recent++
      if (inPrev(item.key)) stat.previous++
      tagStats.set(tag, stat)
    }
  }
  const tags = [...tagStats.entries()].map(([tag, stat]) => ({ tag, ...stat })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 10)

  // -------------------------------------------------------------- Library
  const active = notes.filter(note => !note.archived)
  const words = notes.reduce((sum, note) => sum + (noteWords.get(note.id) || 0), 0)
  const longestNote = notes.reduce<Note | null>((best, note) => !best || (noteWords.get(note.id) || 0) > (noteWords.get(best.id) || 0) ? note : best, null)
  const library: Insights['library'] = {
    total: notes.length,
    active: active.length,
    archived: notes.length - active.length,
    favorites: notes.filter(note => note.favorite).length,
    byKind: {
      note: notes.filter(note => (note.kind || 'note') === 'note').length,
      research: notes.filter(note => note.kind === 'research').length,
      specialized: notes.filter(note => note.kind === 'specialized').length
    },
    words,
    avgWords: notes.length ? Math.round(words / notes.length) : 0,
    longest: longestNote && noteWords.get(longestNote.id) ? { id: longestNote.id, title: titleOf(longestNote), words: noteWords.get(longestNote.id)! } : null
  }

  // ---------------------------------------------------------------- Graph
  let graph: Insights['graph'] = null
  if (input.graph) {
    const degree = new Map(input.graph.nodes.map(node => [node.id, 0]))
    for (const edge of input.graph.edges) {
      // react-force-graph mutates edges into node objects once rendered.
      const source = typeof edge.source === 'string' ? edge.source : (edge.source as { id: string }).id
      const target = typeof edge.target === 'string' ? edge.target : (edge.target as { id: string }).id
      degree.set(source, (degree.get(source) || 0) + 1)
      degree.set(target, (degree.get(target) || 0) + 1)
    }
    const byRecency = [...input.graph.nodes].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    const orphans = byRecency.filter(node => !degree.get(node.id))
    graph = {
      nodes: input.graph.nodes.length,
      links: input.graph.edges.length,
      avgLinks: input.graph.nodes.length ? Math.round(input.graph.edges.length * 2 / input.graph.nodes.length * 10) / 10 : 0,
      orphanCount: orphans.length,
      orphans: orphans.slice(0, 5).map(node => ({ id: node.id, title: titleOf(node) })),
      hubs: input.graph.nodes
        .map(node => ({ id: node.id, title: titleOf(node), links: degree.get(node.id) || 0 }))
        .filter(node => node.links > 0)
        .sort((a, b) => b.links - a.links || a.title.localeCompare(b.title))
        .slice(0, 5)
    }
  }

  // ------------------------------------------------------------ Resurface
  // Substantial notes you haven't opened in a while: favorites first, then the meatiest.
  const resurface = active
    .map(note => ({ note, daysAgo: daysBetween(localParts(note.updated_at || note.created_at, zone).key, today) }))
    .filter(item => item.daysAgo >= RESURFACE_AFTER_DAYS && (noteWords.get(item.note.id) || 0) >= 20)
    .sort((a, b) => Number(b.note.favorite) - Number(a.note.favorite) || (noteWords.get(b.note.id) || 0) - (noteWords.get(a.note.id) || 0))
    .slice(0, 4)
    .map(item => ({ id: item.note.id, title: titleOf(item.note), daysAgo: item.daysAgo, favorite: item.note.favorite }))

  // ------------------------------------------------------------------- AI
  let ai: Insights['ai'] = null
  if (input.activity) {
    const rows = aiRows.filter(item => inRange(item.key)).map(item => item.row)
    const models = new Map<string, { model: string; provider: string; calls: number; tokens: number }>()
    const jobs = new Map<string, { task: string; calls: number; tokens: number }>()
    for (const row of rows) {
      const model = models.get(`${row.provider}|${row.model}`) || { model: row.model, provider: row.provider, calls: 0, tokens: 0 }
      model.calls++; model.tokens += row.tokens
      models.set(`${row.provider}|${row.model}`, model)
      const job = jobs.get(row.task) || { task: row.task, calls: 0, tokens: 0 }
      job.calls++; job.tokens += row.tokens
      jobs.set(row.task, job)
    }
    ai = {
      calls: rows.length,
      tokens: rows.reduce((sum, row) => sum + row.tokens, 0),
      byModel: [...models.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 6),
      byTask: [...jobs.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 6)
    }
  }

  const insights: Omit<Insights, 'highlights'> = {
    range, kpis, streak: { current, longest, activeToday }, trend: { points, bucket },
    heatmap: { weeks, total: nonZero.reduce((a, b) => a + b, 0), activeDays: nonZero.length },
    rhythm: { grid, total: rhythmTotal, peakDay, peakHour },
    tasks, tags, library, graph, resurface, ai
  }
  return { ...insights, highlights: highlightsFor(insights) }
}

// ------------------------------------------------------------- Highlights

/** Plain-language observations, most useful first. Rule-based: no AI call, nothing invented. */
export function highlightsFor(data: Omit<Insights, 'highlights'>): Highlight[] {
  const found: Highlight[] = []
  const period = data.range === 7 ? 'week' : `${data.range} days`
  const { notes, tasks } = data.kpis

  if (data.tasks.overdue) {
    const oldest = data.tasks.overdueList[0]
    found.push({ tone: 'warn', text: `${data.tasks.overdue} task${data.tasks.overdue === 1 ? ' is' : 's are'} overdue. The oldest, “${oldest.text.slice(0, 60)}”, is ${oldest.daysLate} day${oldest.daysLate === 1 ? '' : 's'} late.` })
  }
  if (data.streak.current >= 3) {
    found.push({ tone: 'good', text: data.streak.activeToday ? `${data.streak.current}-day streak and counting.` : `You're on a ${data.streak.current}-day streak. Do one thing today to keep it.` })
  }
  if (notes.change !== null && notes.previous >= 3 && Math.abs(notes.change) >= 20) {
    found.push(notes.change > 0
      ? { tone: 'good', text: `You wrote ${notes.change}% more notes than the previous ${period}.` }
      : { tone: 'info', text: `Note writing is down ${Math.abs(notes.change)}% from the previous ${period}.` })
  }
  if (tasks.change !== null && tasks.previous >= 3 && tasks.change >= 20) {
    found.push({ tone: 'good', text: `You finished ${tasks.change}% more tasks than the previous ${period}.` })
  }
  if (data.rhythm.total >= 10 && data.rhythm.peakDay !== null && data.rhythm.peakHour !== null) {
    found.push({ tone: 'info', text: `You're most active on ${WEEKDAY_NAMES[data.rhythm.peakDay]} around ${hourLabel(data.rhythm.peakHour)}.` })
  }
  const rising = data.tags.filter(tag => tag.recent >= 3 && tag.recent >= tag.previous * 2).sort((a, b) => b.recent - a.recent)[0]
  if (rising) found.push({ tone: 'info', text: `#${rising.tag} is trending: ${rising.recent} new notes, up from ${rising.previous}.` })
  if (data.tasks.onTimeRate !== null && data.tasks.onTimeRate < 60) {
    found.push({ tone: 'warn', text: `Only ${data.tasks.onTimeRate}% of tasks with a due date were finished on time. Try shorter deadlines or fewer of them.` })
  }
  if (data.graph && data.graph.nodes >= 5 && data.graph.orphanCount / data.graph.nodes >= 0.3) {
    found.push({ tone: 'info', text: `${data.graph.orphanCount} notes aren't connected to anything yet. Tags or related content will link them into your graph.` })
  }
  if (data.resurface.length) {
    found.push({ tone: 'info', text: `“${data.resurface[0].title}” hasn't been opened in ${data.resurface[0].daysAgo} days. Worth another look?` })
  }
  return found.slice(0, 4)
}
