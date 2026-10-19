import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Bot, CalendarCheck, CheckSquare, Clock, Cpu, FileText, Flame, Hash, History, Info, Network, PenLine, RefreshCw, Sparkles, Star } from 'lucide-react'
import { api } from '../services/api'
import { computeInsights, WEEKDAYS, type Delta, type Highlight } from '../services/insights'
import type { Task } from '../types'
import { BarList, formatNumber, Heatmap, Legend, Punchcard, TrendChart } from './AnalyticsVisuals'

const RANGES = [{ days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: 'Year' }]
const RANGE_KEY = 'muse.analytics.range'

function storedRange() {
  try { return RANGES.some(r => r.days === Number(localStorage.getItem(RANGE_KEY))) ? Number(localStorage.getItem(RANGE_KEY)) : 30 } catch { return 30 }
}

const hourName = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`
const durationName = (hours: number) => hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} days`

function Change({ delta }: { delta: Delta | null }) {
  if (!delta || delta.change === null) return null
  const up = delta.change >= 0
  return (
    <span className={`an-change ${delta.change === 0 ? '' : up ? 'up' : 'down'}`} title={`Previous period: ${formatNumber(delta.previous)}`}>
      {delta.change !== 0 && (up ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>)}{Math.abs(delta.change)}%
    </span>
  )
}

function Kpi({ icon, tone, label, value, delta, hint }: { icon: React.ReactNode; tone: string; label: string; value: React.ReactNode; delta?: Delta | null; hint?: React.ReactNode }) {
  return (
    <div className="an-kpi">
      <div className={`an-kpi-icon ${tone}`}>{icon}</div>
      <div>
        <span className="an-kpi-label">{label}</span>
        <div className="an-kpi-value">{value}<Change delta={delta ?? null}/></div>
        {hint && <small className="an-kpi-hint">{hint}</small>}
      </div>
    </div>
  )
}

function Card({ title, icon, action, className = '', children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`an-card ${className}`}>
      <header><h3>{icon}{title}</h3>{action}</header>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="an-empty">{children}</p>

const HIGHLIGHT_ICON: Record<Highlight['tone'], React.ReactNode> = { good: <Sparkles size={15}/>, warn: <AlertTriangle size={15}/>, info: <Info size={15}/> }

export function AnalyticsView({ onBack, onOpenNote, onOpenTasks }: { onBack: () => void; onOpenNote: (id: string) => void; onOpenTasks: () => void }) {
  const [range, setRangeState] = useState(storedRange)
  const setRange = (days: number) => { setRangeState(days); try { localStorage.setItem(RANGE_KEY, String(days)) } catch { /* private mode */ } }
  // Enough history for the year heatmap and for comparing with the previous range.
  const activityDays = Math.min(400, Math.max(371, range * 2))

  const notes = useQuery({ queryKey: ['notes', 'all'], queryFn: () => api.listNotes('all') })
  const archived = useQuery({ queryKey: ['notes', 'archive'], queryFn: () => api.listNotes('archive') })
  const tasks = useQuery({ queryKey: ['all-tasks'], queryFn: () => api.listTasks() })
  const graph = useQuery({ queryKey: ['graph'], queryFn: () => api.getGraph().catch(() => null), staleTime: 60_000 })
  const activity = useQuery({ queryKey: ['analytics-activity', activityDays], queryFn: () => api.analyticsActivity(activityDays).catch(() => null), staleTime: 60_000 })
  const queries = [notes, archived, tasks, graph, activity]
  const loading = queries.some(query => query.isLoading)
  const fetching = queries.some(query => query.isFetching)

  const insights = useMemo(() => {
    const allNotes = [...(notes.data || []), ...(archived.data || [])]
    const unique = [...new Map(allNotes.map(note => [note.id, note])).values()]
    // Note tasks live inside notes in Secure Vault mode; standalone tasks come from /tasks.
    const allTasks = new Map<string, Task>()
    for (const note of unique) for (const task of note.tasks || []) allTasks.set(task.id, task)
    for (const task of tasks.data || []) allTasks.set(task.id, task)
    return computeInsights({ notes: unique, tasks: [...allTasks.values()], graph: graph.data ?? null, activity: activity.data ?? null, range })
  }, [notes.data, archived.data, tasks.data, graph.data, activity.data, range])

  const { kpis, streak, tasks: taskHealth, library } = insights
  const hasChats = Boolean(insights.kpis.chats)
  const isEmpty = !loading && library.total === 0 && taskHealth.open === 0 && kpis.tasks.value === 0
  const period = range === 365 ? 'past year' : `last ${range} days`

  return (
    <div className="analytics-page">
      <header className="analytics-topbar">
        <div className="an-title">
          <button className="back-btn" onClick={onBack} title="Back to notes"><ArrowLeft size={18}/></button>
          <h2><BarChart3 size={20}/> Insights</h2>
        </div>
        <div className="an-controls">
          <div className="an-range" role="tablist" aria-label="Time range">
            {RANGES.map(option => (
              <button key={option.days} role="tab" aria-selected={range === option.days} className={range === option.days ? 'active' : ''} onClick={() => setRange(option.days)}>{option.label}</button>
            ))}
          </div>
          <button className="an-refresh" onClick={() => queries.forEach(query => query.refetch())} title="Refresh">
            <RefreshCw size={14} className={fetching ? 'animate-spin' : ''}/>
          </button>
        </div>
      </header>

      <main className="analytics-container">
        {loading ? (
          <div className="an-loading"><div className="loader"/>Crunching your workspace…</div>
        ) : isEmpty ? (
          <div className="an-card an-welcome">
            <BarChart3 size={28}/>
            <h3>Nothing to measure yet</h3>
            <p>Write a few notes, add tasks or chat with Bip. Your streaks, rhythms and trends will show up here.</p>
          </div>
        ) : (
          <>
            {insights.highlights.length > 0 && (
              <div className="an-highlights">
                {insights.highlights.map(item => (
                  <div key={item.text} className={`an-highlight ${item.tone}`}>{HIGHLIGHT_ICON[item.tone]}<span>{item.text}</span></div>
                ))}
              </div>
            )}

            <div className="an-kpis">
              <Kpi icon={<FileText size={18}/>} tone="violet" label="Notes created" value={formatNumber(kpis.notes.value)} delta={kpis.notes}/>
              <Kpi icon={<PenLine size={18}/>} tone="pink" label="Words written" value={formatNumber(kpis.words.value)} delta={kpis.words} hint={`${formatNumber(library.words)} in your library`}/>
              <Kpi icon={<CheckSquare size={18}/>} tone="green" label="Tasks completed" value={formatNumber(kpis.tasks.value)} delta={kpis.tasks} hint={`${taskHealth.open} still open`}/>
              {kpis.chats && <Kpi icon={<Bot size={18}/>} tone="blue" label="Messages to Bip" value={formatNumber(kpis.chats.value)} delta={kpis.chats}/>}
              <Kpi icon={<CalendarCheck size={18}/>} tone="amber" label="Active days" value={<>{kpis.activeDays.value}<small>/{range}</small></>} delta={kpis.activeDays}/>
              <Kpi icon={<Flame size={18}/>} tone="orange" label="Current streak" value={<>{streak.current}<small> day{streak.current === 1 ? '' : 's'}</small></>} hint={`Best: ${streak.longest} day${streak.longest === 1 ? '' : 's'}`}/>
            </div>

            <div className="an-grid">
              <Card title="Activity" icon={<BarChart3 size={16}/>} className="an-span-2" action={<Legend showChats={hasChats}/>}>
                <TrendChart points={insights.trend.points} bucket={insights.trend.bucket} showChats={hasChats}/>
              </Card>

              <Card title="Task health" icon={<CheckSquare size={16}/>} action={<button className="an-link" onClick={onOpenTasks}>Open tasks <ArrowRight size={12}/></button>}>
                <div className="an-task-stats">
                  <div className={taskHealth.overdue ? 'warn' : ''}><strong>{taskHealth.overdue}</strong><span>Overdue</span></div>
                  <div><strong>{taskHealth.dueToday}</strong><span>Due today</span></div>
                  <div><strong>{taskHealth.dueThisWeek}</strong><span>Next 7 days</span></div>
                  <div><strong>{taskHealth.undated}</strong><span>No date</span></div>
                </div>
                <div className="an-meta-row">
                  <span><CalendarCheck size={13}/> On time: <b>{taskHealth.onTimeRate === null ? '—' : `${taskHealth.onTimeRate}%`}</b></span>
                  <span><Clock size={13}/> Typical finish: <b>{taskHealth.medianHoursToDone === null ? '—' : durationName(taskHealth.medianHoursToDone)}</b></span>
                </div>
                {taskHealth.open > 0 && (
                  <div className="an-priority" title="Open tasks by priority">
                    {(['high', 'medium', 'low'] as const).map(level => taskHealth.openByPriority[level] > 0 && (
                      <i key={level} className={level} style={{ flex: taskHealth.openByPriority[level] }}>{taskHealth.openByPriority[level]} {level}</i>
                    ))}
                  </div>
                )}
                {taskHealth.overdueList.length > 0 && (
                  <ul className="an-list">
                    {taskHealth.overdueList.map(task => (
                      <li key={task.id}><button onClick={onOpenTasks}><span>{task.text}</span><em className="warn">{task.daysLate}d late</em></button></li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Your year" icon={<CalendarCheck size={16}/>} className="an-span-3" action={<span className="an-sub">{insights.heatmap.activeDays} active days · {formatNumber(insights.heatmap.total)} actions</span>}>
                <Heatmap weeks={insights.heatmap.weeks}/>
              </Card>

              <Card title="When you work" icon={<Clock size={16}/>} className="an-span-2" action={insights.rhythm.peakDay !== null && insights.rhythm.peakHour !== null ? <span className="an-sub">Peak: {WEEKDAYS[insights.rhythm.peakDay]} around {hourName(insights.rhythm.peakHour)}</span> : undefined}>
                {insights.rhythm.total ? <div className="an-scroll"><Punchcard grid={insights.rhythm.grid}/></div> : <Empty>No timed activity in the {period}.</Empty>}
              </Card>

              <Card title="Topics" icon={<Hash size={16}/>}>
                {insights.tags.length ? (
                  <BarList color="var(--an-chats)" items={insights.tags.map(tag => ({
                    key: tag.tag,
                    label: `#${tag.tag}`,
                    value: tag.count,
                    detail: tag.recent > 0 ? <em className={`an-tag-trend ${tag.recent > tag.previous ? 'up' : ''}`} title={`${tag.recent} new in the ${period} (${tag.previous} before)`}>+{tag.recent}</em> : undefined
                  }))}/>
                ) : <Empty>Tag your notes (or let Muse organize them) to see your topics.</Empty>}
              </Card>

              <Card title="Knowledge graph" icon={<Network size={16}/>}>
                {insights.graph ? (
                  <>
                    <div className="an-meta-row">
                      <span><b>{insights.graph.links}</b> links</span>
                      <span><b>{insights.graph.avgLinks}</b> per note</span>
                      <span className={insights.graph.orphanCount ? 'warn' : ''}><b>{insights.graph.orphanCount}</b> unlinked</span>
                    </div>
                    {insights.graph.hubs.length > 0 && <>
                      <h4>Most connected</h4>
                      <BarList items={insights.graph.hubs.map(hub => ({ key: hub.id, label: hub.title, value: hub.links, onClick: () => onOpenNote(hub.id) }))}/>
                    </>}
                    {insights.graph.orphans.length > 0 && <>
                      <h4>Not linked yet</h4>
                      <ul className="an-list">{insights.graph.orphans.map(note => <li key={note.id}><button onClick={() => onOpenNote(note.id)}><span>{note.title}</span><ArrowRight size={12}/></button></li>)}</ul>
                    </>}
                  </>
                ) : <Empty>The graph isn't available right now.</Empty>}
              </Card>

              <Card title="Rediscover" icon={<History size={16}/>}>
                {insights.resurface.length ? (
                  <ul className="an-list an-resurface">
                    {insights.resurface.map(note => (
                      <li key={note.id}><button onClick={() => onOpenNote(note.id)}>
                        <span>{note.favorite && <Star size={12}/>}{note.title}</span><em>{note.daysAgo}d ago</em>
                      </button></li>
                    ))}
                  </ul>
                ) : <Empty>Nothing gathering dust. Every substantial note was opened in the last 45 days.</Empty>}
              </Card>

              <Card title="Library" icon={<FileText size={16}/>}>
                <BarList items={[
                  { key: 'note', label: 'Notes', value: library.byKind.note },
                  { key: 'research', label: 'Research reports', value: library.byKind.research },
                  { key: 'specialized', label: 'Specialized notes', value: library.byKind.specialized }
                ]}/>
                <div className="an-meta-row">
                  <span><Star size={13}/> <b>{library.favorites}</b> favorites</span>
                  <span><b>{library.archived}</b> archived</span>
                  <span><b>{formatNumber(library.avgWords)}</b> words / note</span>
                </div>
                {library.longest && <button className="an-link an-longest" onClick={() => onOpenNote(library.longest!.id)}>Longest: {library.longest.title} · {formatNumber(library.longest.words)} words</button>}
              </Card>

              {insights.ai && (
                <Card title="AI usage" icon={<Cpu size={16}/>} className="an-span-3" action={<span className="an-sub">{formatNumber(insights.ai.calls)} calls · {formatNumber(insights.ai.tokens)} tokens<Change delta={kpis.tokens}/></span>}>
                  {insights.ai.calls ? (
                    <div className="an-two-col">
                      <div><h4>By model</h4><BarList color="var(--an-tasks)" items={insights.ai.byModel.map(row => ({ key: `${row.provider}|${row.model}`, label: <>{row.model} <small>{row.provider}</small></>, value: row.tokens }))}/></div>
                      <div><h4>By job</h4><BarList color="var(--an-notes)" items={insights.ai.byTask.map(row => ({ key: row.task, label: row.task.replace(/_/g, ' '), value: row.tokens }))}/></div>
                    </div>
                  ) : <Empty>No AI calls recorded in the {period}.</Empty>}
                </Card>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
