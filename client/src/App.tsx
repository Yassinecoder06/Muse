import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { api } from './services/api'
import { chatModel, setChatModel } from './services/settings'
import type { Note, NoteInput, SpecializedCategory } from './types'
import { Dashboard } from './pages/Dashboard'
import { Editor } from './components/Editor'
import { CalendarView } from './components/CalendarView'
import { TasksView } from './components/TasksView'
import { AnalyticsView } from './components/AnalyticsView'
import { CommandPalette } from './components/CommandPalette'
import { ChatPanel } from './components/ChatPanel'
import { AssistantWorkspace } from './components/AssistantWorkspace'
import { ResearchPanel } from './components/ResearchPanel'
import { GraphView } from './components/GraphView'
import { Toast, type ToastAction } from './components/Toast'
import { SpecializedNotePanel } from './components/SpecializedNotePanel'
import { RobotCompanion } from './components/RobotCompanion/RobotCompanion'
import { OwnerGate } from './components/OwnerGate'
import { SettingsPage } from './pages/settings/SettingsPage'
import { BipAlarmCenter } from './components/BipAlarmCenter'
import type { CustomTemplate } from './services/templates'

function MuseApp() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState('all')
  const [query, setQuery] = useState('')
  const [showBip, setShowBip] = useState(() => localStorage.getItem('muse-show-bip') !== 'false')
  const [dark, setDark] = useState(localStorage.getItem('muse-theme') === 'dark')
  const [command, setCommand] = useState(false)
  const [ask, setAsk] = useState(false)
  const [research, setResearch] = useState(false)
  const [specialized, setSpecialized] = useState(false)
  const [collections, setCollections] = useState(false)
  const [toastState, setToastState] = useState<{ message: string; action?: ToastAction } | null>(null)
  const setToast = (msg: string | { message: string; action?: ToastAction } | null) => {
    if (!msg) setToastState(null)
    else if (typeof msg === 'string') setToastState({ message: msg })
    else setToastState(msg)
  }

  useEffect(() => {
    if (!toastState) return
    const timer = setTimeout(() => setToastState(null), toastState.action ? 6000 : 4000)
    return () => clearTimeout(timer)
  }, [toastState])
  const [userName, setUserName] = useState(() => localStorage.getItem('muse-user-name') || '')
  const [namePrompt, setNamePrompt] = useState(() => !localStorage.getItem('muse-user-name'))
  const [nameInput, setNameInput] = useState('')
  const [aiWorking, setAiWorking] = useState('')
  const notesQuery = useQuery({ queryKey: ['notes', scope], queryFn: () => api.listNotes(scope) })
  const allQuery = useQuery({ queryKey: ['notes', 'all'], queryFn: () => api.listNotes('all') })
  const favoritesQuery = useQuery({ queryKey: ['notes', 'favorites'], queryFn: () => api.listNotes('favorites') })
  const archiveQuery = useQuery({ queryKey: ['notes', 'archive'], queryFn: () => api.listNotes('archive') })
  const trashQuery = useQuery({ queryKey: ['notes', 'trash'], queryFn: () => api.listNotes('trash') })

  const create = useMutation({
    mutationFn: (input?: NoteInput | void) =>
      api.createNote({
        title: input?.title || '',
        content: input?.content || '',
        tags: input?.tags || [],
        favorite: input?.favorite ?? false,
        ...input
      }),
    onSuccess: note => {
      setScope('all')
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      navigate(`/note/${note.id}`)
    },
    onError: () => setToast('Could not create a note. Is the API running?')
  })

  const createSpecialized = useMutation({
    mutationFn: ({ category, customTemplate, color }: { category: SpecializedCategory; customTemplate?: CustomTemplate; color?: string }) => {
      const templatePayload = customTemplate ? {
        title: customTemplate.title,
        fields: customTemplate.fields.reduce((acc, f) => ({ ...acc, [f.name]: f.defaultValue || '' }), {}),
        aiInstruction: customTemplate.aiInstruction,
        color: color || customTemplate.color || 'blue',
        syncWithCalendar: customTemplate.syncWithCalendar
      } : { color: color || 'blue' }
      return api.createSpecializedNote(category, templatePayload)
    },
    onSuccess: note => {
      setScope('all')
      setSpecialized(false)
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      navigate(`/note/${note.id}`)
    },
    onError: error => setToast(error instanceof Error ? error.message : 'Could not create this specialized note.')
  })

  const emptyTrash = useMutation({
    mutationFn: () => api.emptyTrash(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notes'] }); setToast('Trash emptied.') },
    onError: () => setToast('Could not empty the trash.')
  })

  const deleteSelected = useMutation({
    mutationFn: (ids: string[]) => api.deleteNotes(ids),
    onSuccess: (_value, ids) => { queryClient.invalidateQueries({ queryKey: ['notes'] }); setToast(`${ids.length} note${ids.length === 1 ? '' : 's'} deleted permanently.`) },
    onError: () => setToast('Could not delete the selected notes.')
  })

  const trashSelected = useMutation({
    mutationFn: (ids: string[]) => api.trashNotes(ids),
    onSuccess: (_value, ids) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      setToast({
        message: `${ids.length} note${ids.length === 1 ? '' : 's'} moved to trash.`,
        action: {
          label: 'Undo',
          onClick: () => {
            restoreSelected.mutate(ids)
          }
        }
      })
    },
    onError: () => setToast('Could not move selected notes to trash.')
  })

  const restoreSelected = useMutation({
    mutationFn: (ids: string[]) => api.restoreNotes(ids),
    onSuccess: (_value, ids) => { queryClient.invalidateQueries({ queryKey: ['notes'] }); setToast(`${ids.length} note${ids.length === 1 ? '' : 's'} restored.`) },
    onError: () => setToast('Could not restore the selected notes.')
  })

  const toggleFavorite = useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => api.updateNote(id, { favorite }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notes'] }) },
    onError: () => setToast('Could not update favorite status.')
  })

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('muse-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    localStorage.setItem('muse-show-bip', showBip ? 'true' : 'false')
  }, [showBip])

  // The old per-request model picker is gone (Settings → AI providers holds the
  // chat model and its fallbacks); drop a stale choice so it can't override them.
  useEffect(() => {
    const current = chatModel()
    if (current && !/^[0-9a-f-]{36}:/i.test(current)) {
      setChatModel('')
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommand(true) }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'm') { event.preventDefault(); create.mutate() }
      if (event.key === 'Escape') setCommand(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [create])

  useEffect(() => {
    let cancelled = false
    let wasRunning = false
    const poll = async () => {
      try {
        const state = await api.getAiActive()
        if (!cancelled) {
          setAiWorking(state.running ? state.type || '' : '')
          if (wasRunning && !state.running) queryClient.invalidateQueries({ queryKey: ['notes'] })
          wasRunning = state.running
        }
      } catch { /* keep the last known state on network errors */ }
    }
    void poll()
    const timerId = window.setInterval(() => { void poll() }, 4000)
    return () => { cancelled = true; window.clearInterval(timerId) }
  }, [queryClient])

  if (namePrompt) {
    return (
      <div className="local-welcome-overlay">
        <div className="local-welcome-card">
          <div className="local-welcome-badge">✦ LOCAL WORKSPACE</div>
          <h1>Welcome to Muse</h1>
          <p>Your notes, calendar, tasks, and memory are stored directly on your machine. No cloud login or passwords required.</p>
          <form onSubmit={e => {
            e.preventDefault()
            const chosen = nameInput.trim() || 'Explorer'
            localStorage.setItem('muse-user-name', chosen)
            setUserName(chosen)
            setNamePrompt(false)
          }}>
            <label htmlFor="user-name-input">What's your name?</label>
            <input
              id="user-name-input"
              type="text"
              autoFocus
              placeholder="e.g. Alex"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
            />
            <button type="submit">Open Workspace →</button>
          </form>
        </div>
      </div>
    )
  }

  const counts = {
    all: allQuery.data?.length || 0,
    favorites: favoritesQuery.data?.length || 0,
    archive: archiveQuery.data?.length || 0,
    trash: trashQuery.data?.length || 0
  }
  const tags = [...new Set((allQuery.data || []).flatMap(note => note.tags))].sort()

  const dashboard = <Dashboard
    notes={notesQuery.data || []}
    counts={counts}
    scope={scope}
    setScope={setScope}
    query={query}
    setQuery={setQuery}
    create={input => create.mutate(input)}
    open={note => navigate(`/note/${note.id}`)}
    toggleFavorite={(id, current) => toggleFavorite.mutate({ id, favorite: !current })}
    dark={dark}
    toggleTheme={() => setDark(!dark)}
    ask={() => navigate('/assistant')}
    research={() => setResearch(true)}
    specialized={() => setSpecialized(true)}
    collections={() => setCollections(true)}
    graph={() => navigate('/graph')}
    calendar={() => navigate('/calendar')}
    tasks={() => navigate('/tasks')}
    analytics={() => navigate('/analytics')}
    settings={() => navigate('/settings')}
    userEmail=""
    userName={userName || 'Local User'}
    emptyTrash={() => emptyTrash.mutate()}
    deleteSelected={ids => deleteSelected.mutate(ids)}
    trashSelected={ids => trashSelected.mutate(ids)}
    restoreSelected={ids => restoreSelected.mutate(ids)}
    aiWorking={aiWorking}
  />

  return <>
    {notesQuery.isLoading ? <div className="app-loading"><div className="loader"/>Loading your space</div> : (
      <Routes>
        <Route path="/" element={dashboard}/>
        <Route path="/note/:id" element={<NoteRoute toast={setToast}/>}/>
        <Route path="/graph" element={<GraphView onBack={() => navigate('/')} create={() => create.mutate()}/>}/>
        <Route path="/calendar" element={<CalendarView onBack={() => navigate('/')}/>}/>
        <Route path="/tasks" element={<TasksView onBack={() => navigate('/')}/>}/>
        <Route path="/analytics" element={<AnalyticsView onBack={() => navigate('/')} onOpenNote={id => navigate(`/note/${id}`)} onOpenTasks={() => navigate('/tasks')}/>}/>
        <Route path="/assistant" element={<AssistantWorkspace onBack={() => navigate('/')} onCreateNote={input => create.mutate(input)} onNavigate={path => navigate(path)}/>}/>
        <Route path="/settings/:section?" element={<SettingsPage
          onBack={() => navigate('/')}
          onToast={setToast}
          userName={userName}
          setUserName={setUserName}
          dark={dark}
          setDark={setDark}
          showBip={showBip}
          setShowBip={setShowBip}
          onChangeName={() => { localStorage.removeItem('muse-user-name'); setNamePrompt(true); navigate('/') }}
        />}/>
        <Route path="*" element={dashboard}/>
      </Routes>
    )}
    <CommandPalette open={command} close={() => setCommand(false)} create={() => create.mutate()} ask={() => navigate('/assistant')} theme={() => setDark(!dark)}/>
    {ask && <ChatPanel mode="search" onClose={() => setAsk(false)} onCreateNote={input => create.mutate(input)}/>}
    {research && <ResearchPanel onClose={() => setResearch(false)} onDone={id => { setResearch(false); if (id) { queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate(`/note/${id}`) } }}/>}
    <Toast message={toastState?.message || ''} action={toastState?.action} onClose={() => setToastState(null)}/>
    {specialized && (
      <SpecializedNotePanel
        onClose={() => setSpecialized(false)}
        onCreate={(category, customTemplate, color) => createSpecialized.mutate({ category, customTemplate, color })}
        onStartAiResearch={() => { setSpecialized(false); setResearch(true) }}
      />
    )}
    {collections && (
      <div className="command-backdrop" onMouseDown={() => setCollections(false)}>
        <section className="command collection-panel" onMouseDown={event => event.stopPropagation()}>
          <header><strong>Collections</strong><button onClick={() => setCollections(false)}><X size={17}/></button></header>
          <p>Collections are your existing note tags. Select one to filter your notes.</p>
          <div className="collection-tags">
            {tags.length ? tags.map(tag => <button key={tag} onClick={() => { setQuery(tag); setScope('all'); setCollections(false) }}>{tag}</button>) : <span>Add tags to a note to create your first collection.</span>}
          </div>
        </section>
      </div>
    )}
    <BipAlarmCenter/>
    {showBip && (
      <RobotCompanion
        onCreateNote={input => create.mutate(input)}
        onNavigate={path => navigate(path)}
      />
    )}
  </>
}

function NoteRoute({ toast }: { toast: (message: string | { message: string; action?: ToastAction }) => void }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const noteQuery = useQuery({ queryKey: ['note', id], queryFn: () => api.getNote(id!), enabled: !!id, refetchInterval: 4000 })
  const update = useMutation({
    mutationFn: (input: NoteInput) => api.updateNote(id!, input),
    onSuccess: note => { queryClient.setQueryData(['note', id], note); queryClient.invalidateQueries({ queryKey: ['notes'] }) },
    onError: () => toast('Unable to save changes.')
  })
  async function refresh(): Promise<Note> { const note = await api.getNote(id!); queryClient.setQueryData(['note', id], note); queryClient.invalidateQueries({ queryKey: ['notes'] }); return note }
  async function trash() {
    await api.deleteNote(id!)
    queryClient.invalidateQueries({ queryKey: ['notes'] })
    navigate('/')
    toast({
      message: '1 note moved to trash.',
      action: {
        label: 'Undo',
        onClick: () => {
          api.restoreNote(id!).then(() => {
            queryClient.invalidateQueries({ queryKey: ['notes'] })
            toast('Note restored.')
          })
        }
      }
    })
  }
  async function restore() { await api.restoreNote(id!); queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate('/') }
  async function removePermanently() { await api.permanentlyDeleteNote(id!); queryClient.removeQueries({ queryKey: ['note', id] }); queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate('/') }
  if (noteQuery.isLoading) return <div className="app-loading"><div className="loader"/>Opening note</div>
  if (!noteQuery.data) return <div className="app-loading">That note could not be found.</div>
  return <Editor note={noteQuery.data} onBack={() => navigate('/')} save={input => update.mutateAsync(input)} refresh={refresh} trash={trash} restore={restore} permanentlyDelete={removePermanently} onToast={toast}/>
}

export default function App() { return <OwnerGate><MuseApp/></OwnerGate> }
