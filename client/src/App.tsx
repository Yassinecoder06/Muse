import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { Moon, Settings, Sun, X } from 'lucide-react'
import { api } from './services/api'
import type { Note, NoteInput } from './types'
import { Dashboard } from './pages/Dashboard'
import { Editor } from './components/Editor'
import { CommandPalette } from './components/CommandPalette'
import { ChatPanel } from './components/ChatPanel'
import { Toast } from './components/Toast'
import { AuthPage } from './components/AuthPage'
import { supabase } from './services/supabase'

function MuseApp() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState('all')
  const [query, setQuery] = useState('')
  const [dark, setDark] = useState(localStorage.getItem('muse-theme') === 'dark')
  const [command, setCommand] = useState(false)
  const [ask, setAsk] = useState(false)
  const [collections, setCollections] = useState(false)
  const [settings, setSettings] = useState(false)
  const [toast, setToast] = useState('')
  const [authenticated, setAuthenticated] = useState<boolean | undefined>(undefined)
  const [userEmail, setUserEmail] = useState('')
  const [userName, setUserName] = useState('')
  const notesQuery = useQuery({ queryKey: ['notes', scope], queryFn: () => api.listNotes(scope), enabled: authenticated === true })
  const allQuery = useQuery({ queryKey: ['notes', 'all'], queryFn: () => api.listNotes('all'), enabled: authenticated === true })
  const favoritesQuery = useQuery({ queryKey: ['notes', 'favorites'], queryFn: () => api.listNotes('favorites'), enabled: authenticated === true })
  const archiveQuery = useQuery({ queryKey: ['notes', 'archive'], queryFn: () => api.listNotes('archive'), enabled: authenticated === true })
  const trashQuery = useQuery({ queryKey: ['notes', 'trash'], queryFn: () => api.listNotes('trash'), enabled: authenticated === true })
  const create = useMutation({
    mutationFn: () => api.createNote({ title: '', content: '' }),
    onSuccess: note => { queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate(`/note/${note.id}`) },
    onError: () => setToast('Could not create a note. Is the API running?')
  })

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('muse-theme', dark ? 'dark' : 'light') }, [dark])
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setAuthenticated(!!data.session)
      setUserEmail(data.session?.user.email || '')
      setUserName(typeof data.session?.user.user_metadata?.full_name === 'string' ? data.session.user.user_metadata.full_name : '')
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(!!session)
      setUserEmail(session?.user.email || '')
      setUserName(typeof session?.user.user_metadata?.full_name === 'string' ? session.user.user_metadata.full_name : '')
      queryClient.clear()
    })
    return () => listener.subscription.unsubscribe()
  }, [queryClient])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommand(true) }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); create.mutate() }
      if (event.key === 'Escape') setCommand(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [create])

  const counts = { all: allQuery.data?.length || 0, favorites: favoritesQuery.data?.length || 0, archive: archiveQuery.data?.length || 0, trash: trashQuery.data?.length || 0 }
  const tags = [...new Set((allQuery.data || []).flatMap(note => note.tags))].sort()
  const dashboard = <Dashboard notes={notesQuery.data || []} counts={counts} scope={scope} setScope={setScope} query={query} setQuery={setQuery} create={() => create.mutate()} open={note => navigate(`/note/${note.id}`)} dark={dark} toggleTheme={() => setDark(!dark)} ask={() => setAsk(true)} collections={() => setCollections(true)} settings={() => setSettings(true)} userEmail={userEmail} userName={userName}/>
  if (authenticated === undefined) return <div className="app-loading"><div className="loader"/>Loading your space</div>
  if (!authenticated) return <AuthPage/>
  return <>
    {notesQuery.isLoading ? <div className="app-loading"><div className="loader"/>Loading your space</div> : <Routes><Route path="/" element={dashboard}/><Route path="/note/:id" element={<NoteRoute toast={setToast}/>}/><Route path="*" element={dashboard}/></Routes>}
    <CommandPalette open={command} close={() => setCommand(false)} create={() => create.mutate()} ask={() => setAsk(true)} theme={() => setDark(!dark)}/>
    {ask && <ChatPanel mode="search" onClose={() => setAsk(false)}/>}<Toast message={toast} onClose={() => setToast('')}/>
    {collections && <div className="command-backdrop" onMouseDown={() => setCollections(false)}><section className="command collection-panel" onMouseDown={event => event.stopPropagation()}><header><strong>Collections</strong><button onClick={() => setCollections(false)}><X size={17}/></button></header><p>Collections are your existing note tags. Select one to filter your notes.</p><div className="collection-tags">{tags.length ? tags.map(tag => <button key={tag} onClick={() => { setQuery(tag); setScope('all'); setCollections(false) }}>{tag}</button>) : <span>Add tags to a note to create your first collection.</span>}</div></section></div>}
    {settings && <div className="command-backdrop" onMouseDown={() => setSettings(false)}><section className="command settings-panel" onMouseDown={event => event.stopPropagation()}><header><strong>Settings</strong><button onClick={() => setSettings(false)}><X size={17}/></button></header><div className="setting-row"><span><Settings size={17}/><span><strong>Appearance</strong><small>Choose the interface theme.</small></span></span><button className="setting-toggle" onClick={() => setDark(!dark)}>{dark ? <><Sun size={16}/> Light</> : <><Moon size={16}/> Dark</>}</button></div><button className="sign-out" onClick={() => void supabase.auth.signOut()}>Sign out</button><p className="settings-note">AI models and local service addresses are configured in the project’s root <code>.env</code> file.</p></section></div>}
  </>
}

function NoteRoute({ toast }: { toast: (message: string) => void }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const noteQuery = useQuery({ queryKey: ['note', id], queryFn: () => api.getNote(id!), enabled: !!id, refetchInterval: query => query.state.data?.aiStatus === 'processing' ? 2500 : false })
  const update = useMutation({ mutationFn: (input: NoteInput) => api.updateNote(id!, input), onSuccess: note => { queryClient.setQueryData(['note', id], note); queryClient.invalidateQueries({ queryKey: ['notes'] }) }, onError: () => toast('Unable to save changes.') })
  async function refresh(): Promise<Note> { const note = await api.getNote(id!); queryClient.setQueryData(['note', id], note); queryClient.invalidateQueries({ queryKey: ['notes'] }); return note }
  async function complete(input: NoteInput) { await update.mutateAsync(input); return api.organizeNote(id!) }
  async function trash() { await api.deleteNote(id!); queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate('/') }
  async function restore() { await api.restoreNote(id!); queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate('/') }
  async function removePermanently() { await api.permanentlyDeleteNote(id!); queryClient.removeQueries({ queryKey: ['note', id] }); queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate('/') }
  if (noteQuery.isLoading) return <div className="app-loading"><div className="loader"/>Opening note</div>
  if (!noteQuery.data) return <div className="app-loading">That note could not be found.</div>
  return <Editor note={noteQuery.data} onBack={() => navigate('/')} save={input => update.mutateAsync(input)} refresh={refresh} complete={complete} trash={trash} restore={restore} permanentlyDelete={removePermanently} onToast={toast}/>
}

export default function App() { return <MuseApp/> }
