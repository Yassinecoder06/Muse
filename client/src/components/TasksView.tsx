import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, CheckSquare, ChevronRight, FileText, Plus, Trash2, Calendar, AlertCircle } from 'lucide-react'
import { api } from '../services/api'
import { localDateKey } from '../services/reminders'
import { ReminderPicker } from './ReminderPicker'
import type { Task } from '../types'

export function TasksView({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const todayStr = localDateKey() // local day; toISOString() is the UTC day
  const [selectedDay, setSelectedDay] = useState(todayStr)
  const [newTaskText, setNewTaskText] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [newTaskTime, setNewTaskTime] = useState('')

  const { data: allTasks = [], isLoading } = useQuery({
    queryKey: ['all-tasks'],
    queryFn: () => api.listTasks()
  })

  const createTask = useMutation({
    mutationFn: (data: { text: string; due_date: string | null; due_time: string | null; priority: 'low' | 'medium' | 'high' }) =>
      api.createTask({ text: data.text, due_date: data.due_date, due_time: data.due_time, priority: data.priority }),
    onSuccess: () => {
      setNewTaskText('')
      setNewTaskTime('')
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] })
    }
  })

  const toggleTask = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.updateTask(id, { completed }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] })
    }
  })

  const saveReminder = (id: string, patch: Partial<Task>) =>
    api.updateTask(id, patch).then(() => queryClient.invalidateQueries({ queryKey: ['all-tasks'] }))

  const deleteTask = useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] })
    }
  })

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTaskText.trim()) return
    createTask.mutate({
      text: newTaskText.trim(),
      due_date: selectedDay === 'unscheduled' ? null : selectedDay,
      due_time: newTaskTime || null,
      priority: newTaskPriority
    })
  }

  // Generate 14 day rows starting from 2 days ago up to next 12 days
  const dayRows: { dateStr: string; label: string; isToday: boolean; count: number; completedCount: number }[] = []
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 1) // Yesterday

  for (let i = 0; i < 14; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    const iso = localDateKey(d)
    const isToday = iso === todayStr
    const isYesterday = i === 0
    const isTomorrow = i === 2

    let label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    if (isToday) label = `Today · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    if (isTomorrow) label = `Tomorrow · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    if (isYesterday) label = `Yesterday · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`

    const tasksForDay = allTasks.filter(t => t.due_date === iso)
    const completedForDay = tasksForDay.filter(t => t.completed).length

    dayRows.push({
      dateStr: iso,
      label,
      isToday,
      count: tasksForDay.length,
      completedCount: completedForDay
    })
  }

  // Also include "No date" row
  const unscheduledTasks = allTasks.filter(t => !t.due_date)
  const activeDayTasks = selectedDay === 'unscheduled'
    ? unscheduledTasks
    : allTasks.filter(t => t.due_date === selectedDay)

  return (
    <div className="tasks-page">
      <header className="tasks-topbar">
        <div className="tasks-top-left">
          <button className="back-btn" onClick={onBack} title="Back to Notes">
            <ArrowLeft size={18} />
          </button>
          <h2>Tasks Table</h2>
        </div>
        <div className="tasks-summary-pill">
          <CheckSquare size={16} />
          <span>{allTasks.filter(t => t.completed).length} / {allTasks.length} Completed</span>
        </div>
      </header>

      <div className="tasks-layout-grid">
        {/* Left Side: Days as Rows */}
        <section className="days-column-card">
          <header className="days-column-header">
            <h3>Schedule by Day</h3>
            <small>Select a day to view and add tasks</small>
          </header>

          <div className="days-rows-list">
            {dayRows.map(row => {
              const isSelected = selectedDay === row.dateStr
              return (
                <div
                  key={row.dateStr}
                  className={`day-row-item ${isSelected ? 'active' : ''} ${row.isToday ? 'is-today' : ''}`}
                  onClick={() => setSelectedDay(row.dateStr)}
                >
                  <div className="day-row-info">
                    <span className="day-row-label">{row.label}</span>
                  </div>
                  <div className="day-row-metrics">
                    {row.count > 0 ? (
                      <span className={`task-badge ${row.completedCount === row.count ? 'all-done' : ''}`}>
                        {row.completedCount}/{row.count}
                      </span>
                    ) : (
                      <span className="task-badge-empty">—</span>
                    )}
                    <ChevronRight size={14} className="row-arrow" />
                  </div>
                </div>
              )
            })}

            {/* Unscheduled Row */}
            <div
              className={`day-row-item ${selectedDay === 'unscheduled' ? 'active' : ''}`}
              onClick={() => setSelectedDay('unscheduled')}
            >
              <div className="day-row-info">
                <span className="day-row-label">No Due Date (Anytime)</span>
              </div>
              <div className="day-row-metrics">
                {unscheduledTasks.length > 0 ? (
                  <span className="task-badge">{unscheduledTasks.length}</span>
                ) : (
                  <span className="task-badge-empty">—</span>
                )}
                <ChevronRight size={14} className="row-arrow" />
              </div>
            </div>
          </div>
        </section>

        {/* Right Side: Tasks Table for Selected Day */}
        <section className="day-tasks-table-card">
          <header className="day-tasks-header">
            <div>
              <h3>
                {selectedDay === 'unscheduled'
                  ? 'Unscheduled Tasks'
                  : new Date(selectedDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </h3>
              <small>{activeDayTasks.length} task{activeDayTasks.length === 1 ? '' : 's'} assigned to this day</small>
            </div>
          </header>

          {/* Quick Add Task Input for Selected Day */}
          <form onSubmit={handleAddTask} className="add-task-form">
            <input
              type="text"
              placeholder={`+ Add a task for ${selectedDay === 'unscheduled' ? 'anytime' : 'this day'}...`}
              value={newTaskText}
              onChange={e => setNewTaskText(e.target.value)}
              disabled={createTask.isPending}
            />
            <input
              type="time"
              className="task-time-input"
              value={newTaskTime}
              onChange={e => setNewTaskTime(e.target.value)}
              title="Due time (optional)"
              disabled={selectedDay === 'unscheduled'}
            />
            <select
              value={newTaskPriority}
              onChange={e => setNewTaskPriority(e.target.value as any)}
              className="priority-select"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button type="submit" disabled={createTask.isPending || !newTaskText.trim()}>
              <Plus size={16} /> Add
            </button>
          </form>

          {/* Tasks Table */}
          <div className="tasks-table-wrapper">
            {isLoading ? (
              <p className="table-loading">Loading tasks…</p>
            ) : activeDayTasks.length === 0 ? (
              <div className="tasks-empty-state">
                <CheckSquare size={32} />
                <p>No tasks for this day yet.</p>
                <small>Type a task above to schedule it for this day.</small>
              </div>
            ) : (
              <table className="tasks-table">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>Done</th>
                    <th>Task</th>
                    <th style={{ width: 100 }}>Priority</th>
                    <th style={{ width: 150 }}>Reminder</th>
                    <th style={{ width: 140 }}>Linked Note</th>
                    <th style={{ width: 60 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDayTasks.map(task => (
                    <tr key={task.id} className={task.completed ? 'task-done' : ''}>
                      <td className="cell-checkbox">
                        <button
                          className={`task-checkbox ${task.completed ? 'checked' : ''}`}
                          onClick={() => toggleTask.mutate({ id: task.id, completed: !task.completed })}
                          title={task.completed ? 'Mark incomplete' : 'Mark complete'}
                        >
                          {task.completed && <Check size={13} />}
                        </button>
                      </td>
                      <td className="cell-text">
                        <span>{task.text}</span>
                        {task.due_time && <small className="task-due-time">{task.due_time.slice(0, 5)}</small>}
                      </td>
                      <td className="cell-priority">
                        <span className={`priority-tag priority-${task.priority || 'medium'}`}>
                          {task.priority || 'medium'}
                        </span>
                      </td>
                      <td className="cell-reminder">
                        {!task.completed && <ReminderPicker task={task} onSave={patch => saveReminder(task.id, patch)} />}
                      </td>
                      <td className="cell-note">
                        {task.note_id ? (
                          <button
                            className="task-note-link"
                            onClick={() => navigate(`/note/${task.note_id}`)}
                            title="Open note"
                          >
                            <FileText size={13} /> View Note
                          </button>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="cell-actions">
                        <button
                          className="delete-task-btn"
                          onClick={() => deleteTask.mutate(task.id)}
                          title="Delete task"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
