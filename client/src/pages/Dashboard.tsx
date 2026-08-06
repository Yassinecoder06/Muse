import { Archive, Check, FileText, FolderOpen, Moon, Plus, RotateCcw, Search, Settings, Sparkles, Star, Sun, Trash2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { Note } from '../types'

type Counts = { all: number; favorites: number; archive: number; trash: number }

export function Dashboard({ notes, counts, scope, setScope, query, setQuery, create, open, dark, toggleTheme, ask, collections, settings, userEmail, userName, emptyTrash, deleteSelected, restoreSelected }: { notes: Note[]; counts: Counts; scope: string; setScope: (value: string) => void; query: string; setQuery: (value: string) => void; create: () => void; open: (note: Note) => void; dark: boolean; toggleTheme: () => void; ask: () => void; collections: () => void; settings: () => void; userEmail: string; userName: string; emptyTrash: () => void; deleteSelected: (ids: string[]) => void; restoreSelected: (ids: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const text = (content: string) => content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const visible = notes.filter(note => `${note.title} ${text(note.content)} ${note.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const nav = [{ id: 'all', name: 'All notes', icon: FileText }, { id: 'favorites', name: 'Favorites', icon: Star }, { id: 'archive', name: 'Archive', icon: Archive }, { id: 'trash', name: 'Trash', icon: Trash2 }]
  const heading = scope === 'favorites' ? 'Favorite notes' : scope === 'archive' ? 'Archived notes' : scope === 'trash' ? 'Trash' : 'Recent notes'
  const firstName = userName.trim().split(/\s+/)[0] || userEmail.split('@')[0]?.split(/[._-]/)[0] || 'there'
  const displayName = userName.trim() || (firstName.charAt(0).toUpperCase() + firstName.slice(1))
  const initials = userName.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || userEmail.slice(0, 2).toUpperCase() || 'ME'
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  useEffect(() => { setSelected([]) }, [scope])
  useEffect(() => { if (notes.length) { const idSet = new Set(notes.map(note => note.id)); setSelected(current => current.filter(id => idSet.has(id))) } }, [notes])
  const toggleSelect = (id: string) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  const confirmDelete = (action: () => void, message: string) => { if (window.confirm(message)) action() }

  return <div className="app-layout">
    <aside className="sidebar">
      <div className="brand"><i><span/></i> Muse</div>
      <button className="new-note" onClick={create}><Plus size={17}/>New note <kbd>⌘ N</kbd></button>
      <nav>{nav.map(item => { const Icon = item.icon; return <button key={item.id} className={scope === item.id ? 'active' : ''} onClick={() => setScope(item.id)}><Icon size={17}/><span>{item.name}</span><em>{counts[item.id as keyof Counts]}</em></button> })}</nav>
      <div className="sidebar-footer"><button onClick={collections}><FolderOpen size={17}/> Collections</button><button onClick={settings}><Settings size={17}/> Settings</button><div className="user"><div>{initials}</div><span><strong>{displayName}</strong><small>{userEmail || 'Personal space'}</small></span></div></div>
    </aside>
    <main className="dashboard-main">
      <header className="topbar"><div className="mobile-logo">Muse</div><div className="search-field"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your notes"/><kbd>⌘ K</kbd></div><button className="theme" onClick={toggleTheme}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="new-note top-new" onClick={create}><Plus size={17}/> <span>New note</span></button></header>
      <section className="dashboard-content">
        <div className="hero"><div><p>{today}</p><h1>Good morning, {displayName}.</h1><span>A quiet space for your thoughts.</span></div><button className="ask-muse" onClick={ask}><Sparkles size={17}/> Ask Muse</button></div>
        <div className="list-heading"><h2>{heading}</h2>{scope === 'trash' ? <div className="trash-toolbar">{selected.length ? <button onClick={() => restoreSelected(selected)}><RotateCcw size={14}/> Restore {selected.length}</button> : null}{selected.length ? <button className="danger" onClick={() => confirmDelete(() => deleteSelected(selected), `Permanently delete ${selected.length} note${selected.length === 1 ? '' : 's'}?`)}><Trash2 size={14}/> Delete</button> : null}<button onClick={() => confirmDelete(() => emptyTrash(), 'Permanently delete every note in the trash?')}><Trash2 size={14}/> Empty trash</button></div> : <span>{visible.length} notes</span>}</div>
        {visible.length ? <div className="note-grid">{visible.map((note, index) => <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .035 }} className={`note-card${scope === 'trash' && selected.includes(note.id) ? ' selected-card' : ''}`} key={note.id} onClick={() => open(note)}><div className="note-card-top">{scope === 'trash' ? <button className={`note-check${selected.includes(note.id) ? ' on' : ''}`} title="Select note" onClick={event => { event.stopPropagation(); toggleSelect(note.id) }}>{selected.includes(note.id) ? <Check size={13}/> : null}</button> : <i/>}{scope === 'trash' ? <div className="note-card-actions"><button title="Restore note" onClick={event => { event.stopPropagation(); restoreSelected([note.id]) }}><RotateCcw size={15}/></button><button className="danger" title="Delete permanently" onClick={event => { event.stopPropagation(); confirmDelete(() => deleteSelected([note.id]), 'Permanently delete this note?') }}><Trash2 size={15}/></button></div> : <button onClick={event => { event.stopPropagation(); open(note) }}><Star size={16} fill={note.favorite ? 'currentColor' : 'none'}/></button>}</div><h3>{note.title || 'Untitled note'}</h3><p>{text(note.content) || 'Start writing…'}</p><footer><span>{note.tags.slice(0, 2).map(tag => <b className="tag" key={tag}>{tag}</b>)}</span><time>{new Date(note.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></footer></motion.article>)}</div> : <div className="empty"><div><FileText size={24}/></div><h3>{query ? 'No matching notes' : 'Nothing here yet'}</h3><p>{query ? 'Try a different word or tag.' : 'Your next thought is a great place to begin.'}</p><button onClick={create}><Plus size={16}/> Create a note</button></div>}
        <div className="list-heading pinned"><h2>Pinned</h2><span>Your favorite thoughts, close at hand</span></div><article className="reflection"><div>✦</div><span><h3>Weekly reflection</h3><p>What gave me energy this week? What do I want more of?</p><b className="tag">rituals</b><b className="tag">personal</b></span><strong>↗</strong></article>
      </section>
    </main>
  </div>
}
