import { Archive, BarChart3, Bot, Calendar, Check, CheckSquare, FileText, FolderOpen, Globe, Layers3, Moon, Music, PanelLeft, Plus, RotateCcw, Search, Settings, Smartphone, Sparkles, Star, Sun, Trash2, Waypoints } from 'lucide-react'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { Note } from '../types'
import { ConfirmModal } from '../components/ConfirmModal'

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
  toggleFavorite,
  dark,
  toggleTheme,
  ask,
  research,
  specialized,
  collections,
  graph,
  calendar,
  tasks,
  analytics,
  music,
  settings,
  linkPhone,
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
  toggleFavorite?: (id: string, current: boolean) => void
  dark: boolean
  toggleTheme: () => void
  ask: () => void
  research: () => void
  specialized: () => void
  collections: () => void
  graph: () => void
  calendar: () => void
  tasks: () => void
  analytics: () => void
  music?: () => void
  settings: () => void
  linkPhone?: () => void
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

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    title?: string
    message: string
    confirmText?: string
    danger?: boolean
    onConfirm: () => void
  } | null>(null)

  const confirmDelete = (action: () => void, message: string, title?: string, confirmText?: string) => {
    setConfirmDialog({
      isOpen: true,
      title: title || (message.toLowerCase().includes('trash') && message.toLowerCase().includes('every') ? 'Empty Trash' : 'Confirm Deletion'),
      message,
      confirmText: confirmText || 'Delete',
      danger: true,
      onConfirm: action
    })
  }
  const toggleSidebar = () => setCollapsed(current => {
    localStorage.setItem('muse-sidebar', current ? 'expanded' : 'collapsed')
    return !current
  })

  return (
    <div className={`app-layout${collapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <i><span/></i> Muse
        </div>
        <button className="new-note" onClick={create} title="New note (Ctrl+M / ⌘M)">
          <Plus size={17}/>New note <kbd>⌘ M</kbd>
        </button>
        <nav>
          {nav.map(item => {
            const Icon = item.icon
            const isFav = item.id === 'favorites'
            return (
              <button
                key={item.id}
                title={item.name}
                className={`${scope === item.id ? 'active' : ''} ${isFav ? 'nav-item-favorites' : ''}`}
                onClick={() => setScope(item.id)}
              >
                <Icon
                  size={17}
                  className={isFav ? 'fav-star-icon' : undefined}
                  fill={isFav && scope === 'favorites' ? 'currentColor' : 'none'}
                />
                <span>{item.name}</span>
                <em>{counts[item.id as keyof Counts]}</em>
              </button>
            )
          })}
        </nav>
        <div className="sidebar-tools">
          <button title="AI Assistant" onClick={ask}><Bot size={17}/><span> AI Assistant</span></button>
          <button title="Calendar" onClick={calendar}><Calendar size={17}/><span> Calendar</span></button>
          <button title="Tasks" onClick={tasks}><CheckSquare size={17}/><span> Tasks</span></button>
          <button title="Analytics" onClick={analytics}><BarChart3 size={17}/><span> Analytics</span></button>
          {music && <button title="Music" onClick={music}><Music size={17}/><span> Music</span></button>}
        </div>
        <div className="sidebar-footer">
          <button title="Collections" onClick={collections}><FolderOpen size={17}/><span> Collections</span></button>
          <button title="Graph" onClick={graph}><Waypoints size={17}/><span> Graph</span></button>
          {linkPhone && (
            <button title="Link Phone Companion" onClick={linkPhone} className="link-phone-btn">
              <Smartphone size={17}/><span> Link Phone</span>
            </button>
          )}
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
          <div className="topbar-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {linkPhone && (
              <button className="theme" style={{ margin: 0 }} onClick={linkPhone} title="Link Phone Companion">
                <Smartphone size={18}/>
              </button>
            )}
            <button className="theme" style={{ margin: 0 }} onClick={toggleTheme} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {dark ? <Sun size={18}/> : <Moon size={18}/>}
            </button>
          </div>
        </header>

        <section className="dashboard-content">
          <div className="hero">
            <div>
              <p>{today}</p>
              <h1>Good morning, {displayName}.</h1>
              <span>A quiet space for your thoughts.</span>
            </div>
            <div className="hero-actions">
              <button className="specialized-muse" onClick={specialized}><Layers3 size={17}/> Specialized</button>
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
                  <button className="danger" onClick={() => confirmDelete(() => { deleteSelected(selected); setSelected([]) }, `Permanently delete ${selected.length} note${selected.length === 1 ? '' : 's'}? This action cannot be undone.`, 'Permanently Delete', 'Delete permanently')}>
                    <Trash2 size={14}/> Delete
                  </button>
                ) : null}
                {counts.trash > 0 && (
                  <button onClick={() => confirmDelete(() => emptyTrash(), 'Permanently delete every note in the trash? This action cannot be undone.', 'Empty Trash', 'Empty trash')}>
                    <Trash2 size={14}/> Empty trash
                  </button>
                )}
              </div>
            ) : selected.length > 0 ? (
              <div className="trash-toolbar">
                <button onClick={() => setSelected([])}>Deselect</button>
                <button onClick={() => setSelected(visible.map(n => n.id))}>Select all ({visible.length})</button>
                <button
                  className="danger"
                  onClick={() => confirmDelete(() => { trashSelected(selected); setSelected([]) }, `Move ${selected.length} note${selected.length === 1 ? '' : 's'} to trash?`, 'Move to Trash', 'Move to trash')}
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
                const isResearch = note.kind === 'research' || note.specialized?.category === 'research'
                const specColor = isResearch ? (note.specialized?.color || 'emerald') : note.specialized?.color
                const specColorClass = specColor ? `specialized-color-${specColor}` : ''
                const isSelected = selected.includes(note.id)

                return (
                  <motion.article
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * .035 }}
                    className={`note-card${isResearch ? ' research-card' : ''}${note.kind === 'specialized' || isResearch ? ' specialized-card' : ''} ${specColorClass}${isSelected ? ' selected-card' : ''}`}
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
                        {isResearch ? (
                          <span className="specialized-card-label" style={{ color: '#059669', background: 'rgba(5, 150, 105, 0.12)' }}>Research</span>
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
                          <button className="danger" title="Delete permanently" onClick={event => { event.stopPropagation(); confirmDelete(() => deleteSelected([note.id]), 'Permanently delete this note? This action cannot be undone.', 'Delete Note', 'Delete permanently') }}>
                            <Trash2 size={15}/>
                          </button>
                        </div>
                      ) : (
                        <button
                          className={`note-favorite-btn ${note.favorite ? 'is-favorite' : ''}`}
                          title={note.favorite ? 'Remove from favorites' : 'Add to favorites'}
                          onClick={event => {
                            event.stopPropagation()
                            if (toggleFavorite) {
                              toggleFavorite(note.id, note.favorite)
                            } else {
                              open(note)
                            }
                          }}
                        >
                          <Star
                            size={16}
                            className={`star-icon ${note.favorite ? 'fav-star-icon is-favorite' : ''}`}
                            fill={note.favorite ? 'currentColor' : 'none'}
                          />
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
            <div className={`empty ${scope === 'favorites' ? 'empty-favorites' : ''}`}>
              <div className={scope === 'favorites' ? 'empty-icon-favorites' : undefined}>
                {scope === 'trash' ? (
                  <Trash2 size={24}/>
                ) : scope === 'favorites' ? (
                  <Star size={24} className="fav-star-icon is-favorite" fill="currentColor"/>
                ) : scope === 'archive' ? (
                  <Archive size={24}/>
                ) : (
                  <FileText size={24}/>
                )}
              </div>
              <h3>
                {query
                  ? 'No matching notes'
                  : scope === 'trash'
                  ? 'Trash is empty'
                  : scope === 'favorites'
                  ? 'No favorites yet'
                  : scope === 'archive'
                  ? 'Archive is empty'
                  : 'Nothing here yet'}
              </h3>
              <p style={!query && scope !== 'all' ? { marginBottom: 0 } : undefined}>
                {query
                  ? 'Try a different word or tag.'
                  : scope === 'trash'
                  ? 'Notes you delete will appear here.'
                  : scope === 'favorites'
                  ? 'Star your favorite notes to keep them close at hand.'
                  : scope === 'archive'
                  ? 'Archived notes will be stored here.'
                  : 'Your next thought is a great place to begin.'}
              </p>
              {query ? (
                <button onClick={() => setQuery('')}>
                  <RotateCcw size={15}/> Clear search
                </button>
              ) : scope === 'all' ? (
                <button onClick={create}>
                  <Plus size={16}/> Create a note
                </button>
              ) : null}
            </div>
          )}

          {scope === 'all' && (
            <>
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
            </>
          )}
        </section>
      </main>

      {confirmDialog && (
        <ConfirmModal
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          danger={confirmDialog.danger}
          onConfirm={() => {
            const action = confirmDialog.onConfirm
            setConfirmDialog(null)
            action()
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}
