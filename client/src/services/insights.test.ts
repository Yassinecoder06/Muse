import assert from 'node:assert/strict'
import test from 'node:test'
import { computeInsights, countWords, localParts, shiftKey } from './insights'
import type { Note, Task } from '../types'

const zone = 'Africa/Tunis' // UTC+1, no DST
const now = new Date('2026-10-19T10:00:00Z') // Monday 11:00 in Tunis

let ids = 0
const note = (created: string, extra: Partial<Note> = {}): Note => ({
  id: `n${++ids}`, title: `Note ${ids}`, content: 'one two three', summary: null, favorite: false, archived: false,
  deleted_at: null, created_at: created, updated_at: created, kind: 'note', tags: [], tasks: [], ...extra
})
const task = (extra: Partial<Task> = {}): Task => ({ id: `t${++ids}`, note_id: null, text: `Task ${ids}`, completed: false, created_at: '2026-10-01T08:00:00Z', ...extra })

test('local dates follow the viewer timezone, not UTC', () => {
  // 23:30 UTC on the 18th is already the 19th in Tunis.
  assert.deepEqual(localParts('2026-10-18T23:30:00Z', zone), { key: '2026-10-19', hour: 0, weekday: 0 })
  assert.equal(shiftKey('2026-03-01', -1), '2026-02-28')
})

test('word counts ignore markup and inline images', () => {
  assert.equal(countWords('<p>Hello <strong>world</strong>&nbsp;again</p>![img](data:image/png;base64,AAAA)'), 3)
  assert.equal(countWords("l'été est là — c'est 2026"), 5)
})

test('KPIs compare the range with the one before it', () => {
  const notes = [
    note('2026-10-18T09:00:00Z'), note('2026-10-15T09:00:00Z'), note('2026-10-14T09:00:00Z'), // this week
    note('2026-10-10T09:00:00Z') // previous week
  ]
  const result = computeInsights({ notes, tasks: [], graph: null, activity: null, range: 7, now, zone })
  assert.equal(result.kpis.notes.value, 3)
  assert.equal(result.kpis.notes.previous, 1)
  assert.equal(result.kpis.notes.change, 200)
  assert.equal(result.kpis.words.value, 9)
  assert.equal(result.trend.points.length, 7)
  assert.equal(result.trend.points[6].key, '2026-10-19')
  assert.equal(result.kpis.chats, null) // no activity feed → no made-up numbers
})

test('streak survives a quiet morning and counts the longest run', () => {
  const notes = ['2026-10-18', '2026-10-17', '2026-10-16', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07'].map(day => note(`${day}T12:00:00Z`))
  const result = computeInsights({ notes, tasks: [], graph: null, activity: null, range: 30, now, zone })
  assert.equal(result.streak.activeToday, false)
  assert.equal(result.streak.current, 3)
  assert.equal(result.streak.longest, 4)
})

test('task health uses real completion times', () => {
  const tasks = [
    task({ due_date: '2026-10-10', text: 'File taxes' }), // overdue 9 days
    task({ due_date: '2026-10-19' }), // due today
    task({ due_date: '2026-10-22', priority: 'high' }), // this week
    task(), // undated
    task({ completed: true, due_date: '2026-10-15', created_at: '2026-10-14T08:00:00Z', completed_at: '2026-10-14T20:00:00Z' }), // on time, 12h
    task({ completed: true, due_date: '2026-10-12', created_at: '2026-10-11T08:00:00Z', completed_at: '2026-10-13T08:00:00Z' }) // late, 48h
  ]
  const result = computeInsights({ notes: [], tasks, graph: null, activity: null, range: 30, now, zone })
  assert.equal(result.tasks.open, 4)
  assert.equal(result.tasks.overdue, 1)
  assert.equal(result.tasks.dueToday, 1)
  assert.equal(result.tasks.dueThisWeek, 1)
  assert.equal(result.tasks.undated, 1)
  assert.equal(result.tasks.openByPriority.high, 1)
  assert.equal(result.tasks.onTimeRate, 50)
  assert.equal(result.tasks.medianHoursToDone, 30)
  assert.deepEqual(result.tasks.overdueList[0], { id: tasks[0].id, text: 'File taxes', due: '2026-10-10', daysLate: 9 })
  assert.match(result.highlights[0].text, /1 task is overdue/)
})

test('graph orphans and hubs come from real edges', () => {
  const nodes = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id.toUpperCase(), kind: 'note', tags: [], updated_at: '2026-10-01T00:00:00Z' }))
  const edges = [{ source: 'a', target: 'b', strength: 1, reason: 'tag' as const }, { source: 'a', target: 'c', strength: 1, reason: 'similar' as const }]
  const result = computeInsights({ notes: [], tasks: [], graph: { nodes, edges }, activity: null, range: 30, now, zone })
  assert.equal(result.graph!.orphanCount, 1)
  assert.deepEqual(result.graph!.orphans, [{ id: 'd', title: 'D' }])
  assert.deepEqual(result.graph!.hubs[0], { id: 'a', title: 'A', links: 2 })
})

test('chats and AI usage are bucketed and only compared when fully covered', () => {
  const activity = {
    since: '2026-10-05T00:00:00Z', // covers this week but not the whole previous one
    chats: ['2026-10-18T19:00:00Z', '2026-10-18T19:30:00Z'],
    ai: [
      { at: '2026-10-18T19:00:00Z', provider: 'gemini', model: 'gemini-2.5-flash', task: 'chat', tokens: 1200 },
      { at: '2026-10-17T10:00:00Z', provider: 'anthropic', model: 'claude-sonnet-5-5', task: 'summary', tokens: 300 }
    ]
  }
  const result = computeInsights({ notes: [], tasks: [], graph: null, activity, range: 7, now, zone })
  assert.equal(result.kpis.chats!.value, 2)
  assert.equal(result.kpis.chats!.change, null)
  assert.equal(result.ai!.tokens, 1500)
  assert.equal(result.ai!.byModel[0].model, 'gemini-2.5-flash')
  assert.equal(result.rhythm.grid[6][20], 2) // Sunday 8 PM in Tunis
})

test('long ranges are bucketed by week and the heatmap spans 53 weeks', () => {
  const result = computeInsights({ notes: [note('2026-01-05T12:00:00Z')], tasks: [], graph: null, activity: null, range: 365, now, zone })
  assert.equal(result.trend.bucket, 'week')
  assert.equal(result.trend.points.reduce((sum, point) => sum + point.notes, 0), 1)
  assert.equal(result.heatmap.weeks.length, 53)
  assert.equal(result.heatmap.weeks[52][0].key, '2026-10-19') // this Monday
  assert.equal(result.heatmap.activeDays, 1)
})

test('resurfaces substantial notes left untouched', () => {
  const stale = note('2026-07-01T12:00:00Z', { title: 'Old idea', content: 'word '.repeat(40), favorite: true })
  const short = note('2026-07-01T12:00:00Z', { content: 'tiny' })
  const result = computeInsights({ notes: [stale, short, note('2026-10-18T12:00:00Z')], tasks: [], graph: null, activity: null, range: 30, now, zone })
  assert.deepEqual(result.resurface.map(item => item.title), ['Old idea'])
  assert.equal(result.resurface[0].daysAgo, 110)
})
