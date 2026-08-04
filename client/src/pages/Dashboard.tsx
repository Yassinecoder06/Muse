import { Archive, FileText, FolderOpen, Moon, Plus, Search, Settings, Sparkles, Star, Sun, Trash2 } from 'lucide-react'
import { motion } from 'framer-motion'
import type { Note } from '../types'

type Counts = { all: number; favorites: number; archive: number; trash: number }

export function Dashboard({ notes, counts, scope, setScope, query, setQuery, create, open, dark, toggleTheme, ask, collections, settings, userEmail, userName }: { notes: Note[]; counts: Counts; scope: string; setScope: (value: string) => void; query: string; setQuery: (value: string) => void; create: () => void; open: (note: Note) => void; dark: boolean; toggleTheme: () => void; ask: () => void; collections: () => void; settings: () => void; userEmail: string; userName: string }) {
  const text = (content: string) => content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const visible = notes.filter(note => `${note.title} ${text(note.content)} ${note.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const nav = [{ id: 'all', name: 'All notes', icon: FileText }, { id: 'favorites', name: 'Favorites', icon: Star }, { id: 'archive', name: 'Archive', icon: Archive }, { id: 'trash', name: 'Trash', icon: Trash2 }]
  const heading = scope === 'favorites' ? 'Favorite notes' : scope === 'archive' ? 'Archived notes' : scope === 'trash' ? 'Trash' : 'Recent notes'
  const firstName = userName.trim().split(/\s+/)[0] || userEmail.split('@')[0]?.split(/[._-]/)[0] || 'there'
  const displayName = userName.trim() || (firstName.charAt(0).toUpperCase() + firstName.slice(1))
  const initials = userName.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || userEmail.slice(0, 2).toUpperCase() || 'ME'
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

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
        <div className="list-heading"><h2>{heading}</h2><span>{visible.length} notes</span></div>
        {visible.length ? <div className="note-grid">{visible.map((note, index) => <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .035 }} className="note-card" key={note.id} onClick={() => open(note)}><div className="note-card-top"><i/><button onClick={event => { event.stopPropagation(); open(note) }}><Star size={16} fill={note.favorite ? 'currentColor' : 'none'}/></button></div><h3>{note.title || 'Untitled note'}</h3><p>{text(note.content) || 'Start writing…'}</p><footer><span>{note.tags.slice(0, 2).map(tag => <b className="tag" key={tag}>{tag}</b>)}</span><time>{new Date(note.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></footer></motion.article>)}</div> : <div className="empty"><div><FileText size={24}/></div><h3>{query ? 'No matching notes' : 'Nothing here yet'}</h3><p>{query ? 'Try a different word or tag.' : 'Your next thought is a great place to begin.'}</p><button onClick={create}><Plus size={16}/> Create a note</button></div>}
        <div className="list-heading pinned"><h2>Pinned</h2><span>Your favorite thoughts, close at hand</span></div><article className="reflection"><div>✦</div><span><h3>Weekly reflection</h3><p>What gave me energy this week? What do I want more of?</p><b className="tag">rituals</b><b className="tag">personal</b></span><strong>↗</strong></article>
      </section>
    </main>
  </div>
}
