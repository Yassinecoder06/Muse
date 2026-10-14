import { Archive, Calendar, Check, CheckSquare, FileText, FolderOpen, Globe, Layers3, Moon, PanelLeft, PanelLeftClose, Plus, RotateCcw, Search, Settings, Sparkles, Star, Sun, Trash2, Waypoints } from 'lucide-react'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { Note } from '../types'

type Counts = { all: number; favorites: number; archive: number; trash: number }

export function Dashboard({
  notes,
  counts,
  scope,
  setScope,
  query,
  setQuery,
  create,
  open,
  dark,
  toggleTheme,
  ask,
  research,
  specialized,
  collections,
  graph,
  calendar,
  tasks,
  settings,
  userEmail,
  userName,
  emptyTrash,
  deleteSelected,
  trashSelected,
  restoreSelected,
  aiWorking
}: {
  notes: Note[]
  counts: Counts
  scope: string
  setScope: (value: string) => void
  query: string
  setQuery: (value: string) => void
  create: () => void
  open: (note: Note) => void
  dark: boolean
  toggleTheme: () => void
  ask: () => void
  research: () => void
  specialized: () => void
  collections: () => void
  graph: () => void
  calendar: () => void
  tasks: () => void
  settings: () => void
  userEmail: string
  userName: string
  emptyTrash: () => void
  deleteSelected: (ids: string[]) => void
  trashSelected: (ids: string[]) => void
  restoreSelected: (ids: string[]) => void
  aiWorking: string
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('muse-sidebar') === 'collapsed')
  const text = (content: string) => content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const visible = notes.filter(note => `${note.title} ${text(note.content)} ${note.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const nav = [
    { id: 'all', name: 'All notes', icon: FileText },
    { id: 'favorites', name: 'Favorites', icon: Star },
    { id: 'archive', name: 'Archive', icon: Archive },
    { id: 'trash', name: 'Trash', icon: Trash2 }
  ]
  const heading = scope === 'favorites' ? 'Favorite notes' : scope === 'archive' ? 'Archived notes' : scope === 'trash' ? 'Trash' : 'Recent notes'
  const displayName = userName.trim() || 'Local User'
  const initials = userName.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'MU'
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  useEffect(() => { setSelected([]) }, [scope])
  useEffect(() => {
    if (notes.length) {
      const idSet = new Set(notes.map(note => note.id))
      setSelected(current => current.filter(id => idSet.has(id)))
    }
  }, [notes])

  const toggleSelect = (id: string) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  const confirmDelete = (action: () => void, message: string) => { if (window.confirm(message)) action() }
  const toggleSidebar = () => setCollapsed(current => {
    localStorage.setItem('muse-sidebar', current ? 'expanded' : 'collapsed')
    return !current
  })

  return (
    <div className={`app-layout${collapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <i><span/></i> Muse
          <button className="sidebar-toggle" onClick={toggleSidebar} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeft size={18}/> : <PanelLeftClose size={18}/>}
          </button>
        </div>
        <button className="new-note" onClick={create} title="New note (Ctrl+M / ⌘M)">
          <Plus size={17}/>New note <kbd>⌘ M</kbd>
        </button>
        <nav>
          {nav.map(item => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                title={item.name}
                className={scope === item.id ? 'active' : ''}
                onClick={() => setScope(item.id)}
              >
                <Icon size={17}/>
                <span>{item.name}</span>
                <em>{counts[item.id as keyof Counts]}</em>
              </button>
            )
          })}
        </nav>
        <div className="sidebar-tools">
          <button title="Calendar" onClick={calendar}><Calendar size={17}/><span> Calendar</span></button>
          <button title="Tasks" onClick={tasks}><CheckSquare size={17}/><span> Tasks</span></button>
        </div>
        <div className="sidebar-footer">
          <button title="Collections" onClick={collections}><FolderOpen size={17}/><span> Collections</span></button>
          <button title="Graph" onClick={graph}><Waypoints size={17}/><span> Graph</span></button>
          <button title="Settings" onClick={settings}><Settings size={17}/><span> Settings</span></button>
          <div className="user">
            <div>{initials}</div>
            <span><strong>{displayName}</strong><small>{userEmail || 'Local Space'}</small></span>
          </div>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="topbar">
          <button className="sidebar-collapse" onClick={toggleSidebar} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <PanelLeft size={18}/>
          </button>
          <div className="mobile-logo">Muse</div>
          <div className="search-field">
            <Search size={18}/>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your notes"/>
            <kbd>⌘ K</kbd>
          </div>
          {aiWorking ? (
            <span className="working-pill" title="Muse is finishing background work">
              <i className="pulse"/>{aiWorking === 'research' ? 'Researching' : 'Working'}
            </span>
          ) : null}
          <button className="theme" onClick={toggleTheme}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>
          <button className="ask-muse top-ask" onClick={ask} title="Ask Muse AI"><Sparkles size={17}/> <span>Ask Muse</span></button>
          <button className="new-note top-new" onClick={create} title="New note (Ctrl+M / ⌘M)"><Plus size={17}/> <span>New note</span></button>
        </header>

        <section className="dashboard-content">
          <div className="hero">
            <div>
              <p>{today}</p>
              <h1>Good morning, {displayName}.</h1>
              <span>A quiet space for your thoughts.</span>
            </div>
            <div className="hero-actions">
              <button className="calendar-muse" onClick={calendar}><Calendar size={17}/> Calendar</button>
              <button className="tasks-muse" onClick={tasks}><CheckSquare size={17}/> Tasks</button>
              <button className="specialized-muse" onClick={specialized}><Layers3 size={17}/> Specialized</button>
              <button className="research-muse" onClick={research}><Globe size={17}/> Research</button>
            </div>
          </div>

          <div className="list-heading">
            <h2>{heading}</h2>
            {scope === 'trash' ? (
              <div className="trash-toolbar">
                {selected.length ? (
                  <button onClick={() => restoreSelected(selected)}><RotateCcw size={14}/> Restore {selected.length}</button>
                ) : null}
                {selected.length ? (
                  <button className="danger" onClick={() => confirmDelete(() => deleteSelected(selected), `Permanently delete ${selected.length} note${selected.length === 1 ? '' : 's'}?`)}>
                    <Trash2 size={14}/> Delete
                  </button>
                ) : null}
                <button onClick={() => confirmDelete(() => emptyTrash(), 'Permanently delete every note in the trash?')}>
                  <Trash2 size={14}/> Empty trash
                </button>
              </div>
            ) : selected.length > 0 ? (
              <div className="trash-toolbar">
                <button onClick={() => setSelected([])}>Deselect</button>
                <button onClick={() => setSelected(visible.map(n => n.id))}>Select all ({visible.length})</button>
                <button
                  className="danger"
                  onClick={() => confirmDelete(() => { trashSelected(selected); setSelected([]) }, `Move ${selected.length} note${selected.length === 1 ? '' : 's'} to trash?`)}
                >
                  <Trash2 size={14}/> Move to trash ({selected.length})
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{visible.length} notes</span>
                {visible.length > 0 && (
                  <button
                    className="select-mode-toggle"
                    onClick={() => setSelected([visible[0].id])}
                    title="Select multiple notes to delete or manage"
                  >
                    <CheckSquare size={13} /> Select
                  </button>
                )}
              </div>
            )}
          </div>

          {visible.length ? (
            <div className="note-grid">
              {visible.map((note, index) => {
                const specColorClass = note.specialized?.color ? `specialized-color-${note.specialized.color}` : ''
                const isSelected = selected.includes(note.id)

                return (
                  <motion.article
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * .035 }}
                    className={`note-card${note.kind === 'research' ? ' research-card' : ''}${note.kind === 'specialized' ? ' specialized-card' : ''} ${specColorClass}${isSelected ? ' selected-card' : ''}`}
                    key={note.id}
                    onClick={() => {
                      if (selected.length > 0) {
                        toggleSelect(note.id)
                      } else {
                        open(note)
                      }
                    }}
                  >
                    <div className="note-card-top">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <button
                          className={`note-check ${isSelected ? 'on' : ''} ${selected.length > 0 ? 'visible' : 'hover-only'}`}
                          title={isSelected ? 'Deselect note' : 'Select note'}
                          onClick={event => {
                            event.stopPropagation()
                            toggleSelect(note.id)
                          }}
                        >
                          {isSelected ? <Check size={13}/> : null}
                        </button>
                        {note.kind === 'research' ? (
                          <span className="research-card-label">Research</span>
                        ) : note.kind === 'specialized' ? (
                          <span className="specialized-card-label">{note.specialized?.category || 'Specialized'}</span>
                        ) : (
                          <i/>
                        )}
                      </div>

                      {scope === 'trash' ? (
                        <div className="note-card-actions">
                          <button title="Restore note" onClick={event => { event.stopPropagation(); restoreSelected([note.id]) }}>
                            <RotateCcw size={15}/>
                          </button>
                          <button className="danger" title="Delete permanently" onClick={event => { event.stopPropagation(); confirmDelete(() => deleteSelected([note.id]), 'Permanently delete this note?') }}>
                            <Trash2 size={15}/>
                          </button>
                        </div>
                      ) : (
                        <button onClick={event => { event.stopPropagation(); open(note) }}>
                          <Star size={16} fill={note.favorite ? 'currentColor' : 'none'}/>
                        </button>
                      )}
                    </div>

                    <h3>{note.title || 'Untitled note'}</h3>
                    <p>{text(note.content) || 'Start writing…'}</p>
                    <footer>
                      <span>{note.tags.slice(0, 2).map(tag => <b className="tag" key={tag}>{tag}</b>)}</span>
                      <time>{new Date(note.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                    </footer>
                  </motion.article>
                )
              })}
            </div>
          ) : (
            <div className="empty">
              <div><FileText size={24}/></div>
              <h3>{query ? 'No matching notes' : 'Nothing here yet'}</h3>
              <p>{query ? 'Try a different word or tag.' : 'Your next thought is a great place to begin.'}</p>
              <button onClick={create}><Plus size={16}/> Create a note</button>
            </div>
          )}

          <div className="list-heading pinned">
            <h2>Pinned</h2>
            <span>Your favorite thoughts, close at hand</span>
          </div>
          <article className="reflection">
            <div>✦</div>
            <span>
              <h3>Weekly reflection</h3>
              <p>What gave me energy this week? What do I want more of?</p>
              <b className="tag">rituals</b>
              <b className="tag">personal</b>
            </span>
            <strong>↗</strong>
          </article>
        </section>
      </main>
    </div>
  )
}
