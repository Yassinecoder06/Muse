import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { Bot, Cpu, KeyRound, Moon, RefreshCw, Settings, Sun, User, X } from 'lucide-react'
import { api, type AiUsage, type SettingsResponse } from './services/api'
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
import { Toast } from './components/Toast'
import { SpecializedNotePanel } from './components/SpecializedNotePanel'
import { RobotCompanion } from './components/RobotCompanion/RobotCompanion'
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
  const [settings, setSettings] = useState(false)
  const [toast, setToast] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [apiKeyState, setApiKeyState] = useState<SettingsResponse | null>(null)
  const [geminiKeyDraft, setGeminiKeyDraft] = useState('')
  const [ollamaKeyDraft, setOllamaKeyDraft] = useState('')
  const [geminiKeySaving, setGeminiKeySaving] = useState(false)
  const [ollamaKeySaving, setOllamaKeySaving] = useState(false)
  const [geminiKeyError, setGeminiKeyError] = useState('')
  const [ollamaKeyError, setOllamaKeyError] = useState('')
  const [usage, setUsage] = useState<AiUsage | null>(null)
  const [usageError, setUsageError] = useState('')
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
    mutationFn: (input?: { title?: string; content?: string } | void) =>
      api.createNote({ title: input?.title || '', content: input?.content || '' }),
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
        color: color || customTemplate.color || 'blue'
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
    onSuccess: (_value, ids) => { queryClient.invalidateQueries({ queryKey: ['notes'] }); setToast(`${ids.length} note${ids.length === 1 ? '' : 's'} moved to trash.`) },
    onError: () => setToast('Could not move selected notes to trash.')
  })

  const restoreSelected = useMutation({
    mutationFn: (ids: string[]) => api.restoreNotes(ids),
    onSuccess: (_value, ids) => { queryClient.invalidateQueries({ queryKey: ['notes'] }); setToast(`${ids.length} note${ids.length === 1 ? '' : 's'} restored.`) },
    onError: () => setToast('Could not restore the selected notes.')
  })

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('muse-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    localStorage.setItem('muse-show-bip', showBip ? 'true' : 'false')
  }, [showBip])

  useEffect(() => {
    const current = chatModel()
    if (current && current.toLowerCase().includes('gemma') && !current.includes('cloud')) {
      setChatModel('')
    }
  }, [])

  useEffect(() => {
    if (!settings) return
    let cancelled = false
    void api.listModels().then(list => { if (!cancelled) setModels(Array.isArray(list) ? list : []) }).catch(() => { if (!cancelled) setModels([]) })
    return () => { cancelled = true }
  }, [settings])

  useEffect(() => {
    if (!settings) return
    let cancelled = false
    setGeminiKeyError(''); setOllamaKeyError(''); setUsageError('')
    void api.getSettings().then(state => {
      if (!cancelled) {
        setApiKeyState(state)
        if (!state.hasGeminiKey) setGeminiKeyDraft('')
        if (!state.hasOllamaKey) setOllamaKeyDraft('')
      }
    }).catch(() => { if (!cancelled) setApiKeyState(null) })
    void api.getAiUsage().then(value => { if (!cancelled) setUsage(value) }).catch(error => { if (!cancelled) { setUsage(null); setUsageError(error instanceof Error ? error.message : 'Usage could not be loaded.') } })
    return () => { cancelled = true }
  }, [settings])

  async function refreshUsage() {
    setUsageError('')
    try { setUsage(await api.getAiUsage()) }
    catch (error) { setUsage(null); setUsageError(error instanceof Error ? error.message : 'Usage could not be loaded.') }
  }

  async function saveGeminiKey() {
    setGeminiKeySaving(true); setGeminiKeyError('')
    try {
      const state = await api.saveApiKey(geminiKeyDraft.trim(), 'gemini')
      setApiKeyState(state)
      setGeminiKeyDraft('')
      setToast('Google Gemini API key saved! Auto-routing is active.')
      void refreshUsage()
    } catch (error) {
      setGeminiKeyError(error instanceof Error ? error.message : 'Could not save Gemini key.')
    } finally {
      setGeminiKeySaving(false)
    }
  }

  async function removeGeminiKey() {
    setGeminiKeySaving(true); setGeminiKeyError('')
    try {
      const state = await api.deleteApiKey('gemini')
      setApiKeyState(state)
      setToast('Google Gemini API key removed.')
      void refreshUsage()
    } catch (error) {
      setGeminiKeyError(error instanceof Error ? error.message : 'Could not remove Gemini key.')
    } finally {
      setGeminiKeySaving(false)
    }
  }

  async function saveOllamaKey() {
    setOllamaKeySaving(true); setOllamaKeyError('')
    try {
      const state = await api.saveApiKey(ollamaKeyDraft.trim(), 'ollama')
      setApiKeyState(state)
      setOllamaKeyDraft('')
      setToast('Ollama API key saved.')
      void refreshUsage()
    } catch (error) {
      setOllamaKeyError(error instanceof Error ? error.message : 'Could not save Ollama key.')
    } finally {
      setOllamaKeySaving(false)
    }
  }

  async function removeOllamaKey() {
    setOllamaKeySaving(true); setOllamaKeyError('')
    try {
      const state = await api.deleteApiKey('ollama')
      setApiKeyState(state)
      setToast('Ollama API key removed.')
      void refreshUsage()
    } catch (error) {
      setOllamaKeyError(error instanceof Error ? error.message : 'Could not remove Ollama key.')
    } finally {
      setOllamaKeySaving(false)
    }
  }

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
    create={() => create.mutate()}
    open={note => navigate(`/note/${note.id}`)}
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
    settings={() => setSettings(true)}
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
        <Route path="/analytics" element={<AnalyticsView onBack={() => navigate('/')}/>}/>
        <Route path="/assistant" element={<AssistantWorkspace onBack={() => navigate('/')} onCreateNote={input => create.mutate(input)} onNavigate={path => navigate(path)}/>}/>
        <Route path="*" element={dashboard}/>
      </Routes>
    )}
    <CommandPalette open={command} close={() => setCommand(false)} create={() => create.mutate()} ask={() => navigate('/assistant')} theme={() => setDark(!dark)}/>
    {ask && <ChatPanel mode="search" onClose={() => setAsk(false)} onCreateNote={input => create.mutate(input)}/>}
    {research && <ResearchPanel onClose={() => setResearch(false)} onDone={id => { setResearch(false); if (id) { queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate(`/note/${id}`) } }}/>}
    <Toast message={toast} onClose={() => setToast('')}/>
    {specialized && <SpecializedNotePanel onClose={() => setSpecialized(false)} onCreate={(category, customTemplate, color) => createSpecialized.mutate({ category, customTemplate, color })}/>}
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
    {settings && (
      <div className="command-backdrop" onMouseDown={() => setSettings(false)}>
        <section className="command settings-panel" onMouseDown={event => event.stopPropagation()}>
          <header><strong>Settings</strong><button onClick={() => setSettings(false)}><X size={17}/></button></header>
          <div className="setting-row">
            <span><User size={17}/><span><strong>Your Name</strong><small>Used locally across your notes, calendar, and tasks.</small></span></span>
            <input
              type="text"
              className="setting-input"
              value={userName}
              onChange={e => {
                setUserName(e.target.value)
                localStorage.setItem('muse-user-name', e.target.value)
              }}
              placeholder="Your name"
            />
          </div>
          <div className="setting-row">
            <span><Settings size={17}/><span><strong>Appearance</strong><small>Choose the interface theme.</small></span></span>
            <button className="setting-toggle" onClick={() => setDark(!dark)}>{dark ? <><Sun size={16}/> Light</> : <><Moon size={16}/> Dark</>}</button>
          </div>
          <div className="setting-row">
            <span>
              <KeyRound size={17}/>
              <span>
                <strong>
                  Google Gemini API key (Free Tier)
                  {apiKeyState?.hasGeminiKey ? <em className="saved-badge">Active · Priority</em> : null}
                </strong>
                <small>
                  Priority provider with auto-routing (Gemini 3.8 & 3.5).{' '}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'inherit' }}>
                    Get free key at Google AI Studio ↗
                  </a>
                </small>
              </span>
            </span>
            <span className="api-key-controls">
              <input
                type="password"
                className="setting-input"
                placeholder={apiKeyState?.hasGeminiKey ? 'Replace key…' : 'AIzaSy… (free key)'}
                value={geminiKeyDraft}
                onChange={e => setGeminiKeyDraft(e.target.value)}
              />
              <span className="api-key-actions">
                <button
                  className="setting-save"
                  onClick={() => void saveGeminiKey()}
                  disabled={geminiKeySaving || !geminiKeyDraft.trim()}
                >
                  {geminiKeySaving ? 'Saving…' : 'Save'}
                </button>
                {apiKeyState?.hasGeminiKey ? (
                  <button
                    className="setting-remove"
                    onClick={() => void removeGeminiKey()}
                    disabled={geminiKeySaving}
                  >
                    Remove
                  </button>
                ) : null}
              </span>
            </span>
          </div>
          {geminiKeyError && <p className="setting-error">{geminiKeyError}</p>}
          <div className="setting-row">
            <span>
              <KeyRound size={17}/>
              <span>
                <strong>
                  Ollama Cloud key (Optional Fallback)
                  {apiKeyState?.hasOllamaKey ? <em className="saved-badge">Saved</em> : null}
                </strong>
                <small>
                  Fallback when Gemini is unavailable. Local Ollama needs no key.{' '}
                  <a href="https://ollama.com/settings/keys" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'inherit' }}>
                    Get key at ollama.com ↗
                  </a>
                </small>
              </span>
            </span>
            <span className="api-key-controls">
              <input
                type="password"
                className="setting-input"
                placeholder={apiKeyState?.hasOllamaKey ? 'Replace key…' : 'ollama-… (optional)'}
                value={ollamaKeyDraft}
                onChange={e => setOllamaKeyDraft(e.target.value)}
              />
              <span className="api-key-actions">
                <button
                  className="setting-save"
                  onClick={() => void saveOllamaKey()}
                  disabled={ollamaKeySaving || !ollamaKeyDraft.trim()}
                >
                  {ollamaKeySaving ? 'Saving…' : 'Save'}
                </button>
                {apiKeyState?.hasOllamaKey ? (
                  <button
                    className="setting-remove"
                    onClick={() => void removeOllamaKey()}
                    disabled={ollamaKeySaving}
                  >
                    Remove
                  </button>
                ) : null}
              </span>
            </span>
          </div>
          {ollamaKeyError && <p className="setting-error">{ollamaKeyError}</p>}
          <div className="usage-card">
            <header>
              <span>
                <strong>
                  {usage?.provider === 'gemini'
                    ? 'Google Gemini API Usage'
                    : (usage?.provider === 'ollama' ? 'Ollama Cloud Usage' : 'AI Quota & Usage')}
                </strong>
                <small>
                  {usage?.provider === 'gemini'
                    ? 'Daily Free Tier requests (1,500 RPD) & token volume. Resets midnight UTC.'
                    : (usage?.provider === 'ollama' ? 'Session and weekly limits from your plan.' : 'Usage statistics and limits.')}
                </small>
              </span>
              {usage?.configured ? <button onClick={() => void refreshUsage()}><RefreshCw size={14}/> Refresh</button> : null}
            </header>
            {usage?.configured ? (
              <div className="usage-bars">
                {usage.provider === 'gemini' ? (
                  <>
                    <UsageBar
                      label="Daily Requests · 1,500 limit"
                      value={usage.session?.usedPct}
                      sublabel={`${(usage.requestsToday || 0).toLocaleString()} / 1,500 (${(usage.session?.usedPct || 0).toFixed(1)}%)`}
                      models={usage.session?.models || []}
                    />
                    <div className="usage-bar-top" style={{ marginTop: '6px', fontSize: '11.5px', color: '#8a8791' }}>
                      <span>Total Tokens Today:</span>
                      <strong style={{ color: 'inherit' }}>{(usage.totalTokens || 0).toLocaleString()} tokens</strong>
                    </div>
                    {usage.plan ? <p className="usage-plan">Plan: <strong>{usage.plan}</strong></p> : null}
                  </>
                ) : (
                  <>
                    <UsageBar label="Session · 5-hour window" value={usage.session?.usedPct} models={usage.session?.models || []}/>
                    <UsageBar label="Weekly · 7-day window" value={usage.weekly?.usedPct} models={usage.weekly?.models || []}/>
                    {usage.plan ? <p className="usage-plan">Plan: <strong style={{ textTransform: 'capitalize' }}>{usage.plan}</strong></p> : null}
                  </>
                )}
              </div>
            ) : (
              <p className="usage-empty">
                {usageError || (apiKeyState?.hasApiKey
                  ? 'Usage could not be loaded.'
                  : 'Add your Google Gemini API key above to view active quotas and token usage.')}
              </p>
            )}
          </div>
          <div className="setting-row">
            <span><Cpu size={17}/><span><strong>Chat model</strong><small>AI model used for this app's requests.</small></span></span>
            <select className="setting-select" value={chatModel()} onChange={e => { setChatModel(e.target.value); setToast(e.target.value ? `Chat model: ${e.target.value}` : 'Chat model: Default (Auto · Gemini Priority)') }}>
              {[{ value: '', label: 'Default (Auto · Gemini Priority)' }, ...(Array.isArray(models) ? models : [])
                .filter(name => !(name.toLowerCase().includes('gemma') && !name.includes('cloud')))
                .map(name => {
                  let label = name
                  if (name.startsWith('gemini-3.8')) label = `${name} (Intelligent · Gemini)`
                  else if (name.startsWith('gemini-3.5')) label = `${name} (Fastest · Gemini)`
                  else if (name.startsWith('gemini-3.1')) label = `${name} (Deep Reasoning · Gemini)`
                  else if (name.includes('cloud')) label = `${name} (Cloud)`
                  else label = `${name} (Local)`
                  return { value: name, label }
                })].map(option => <option key={option.value || 'default'} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="setting-row">
            <span><Bot size={17}/><span><strong>Bip the Robot Helper</strong><small>Cute companion that moves around and helps you.</small></span></span>
            <button className="setting-toggle" onClick={() => setShowBip(!showBip)}>{showBip ? 'Enabled' : 'Hidden'}</button>
          </div>
          <button className="sign-out" onClick={() => {
            localStorage.removeItem('muse-user-name')
            setNamePrompt(true)
            setSettings(false)
          }}>Switch / Change Name</button>
        </section>
      </div>
    )}
    {showBip && (
      <RobotCompanion
        onCreateNote={input => create.mutate(input)}
        onNavigate={path => navigate(path)}
      />
    )}
  </>
}

function UsageBar({
  label,
  value,
  sublabel,
  models
}: {
  label: string
  value?: number
  sublabel?: string
  models: { name: string; requests: number; tokens?: number }[]
}) {
  const pct = Math.min(typeof value === 'number' ? value : 0, 100)
  const list = Array.isArray(models) ? models : []
  return (
    <div className="usage-bar">
      <div className="usage-bar-top">
        <span>{label}</span>
        <strong>{sublabel || `${pct.toFixed(1)}%`}</strong>
      </div>
      <div className="usage-track">
        <i style={{ width: `${pct}%` }}/>
      </div>
      {list.length ? (
        <ul className="usage-models">
          {list.map(item => (
            <li key={item.name}>
              <span>{item.name}</span>
              <em>
                {item.requests} {item.requests === 1 ? 'request' : 'requests'}
                {typeof item.tokens === 'number' && item.tokens > 0 ? ` · ${item.tokens.toLocaleString()} tokens` : ''}
              </em>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function NoteRoute({ toast }: { toast: (message: string) => void }) {
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
  async function trash() { await api.deleteNote(id!); queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate('/') }
  async function restore() { await api.restoreNote(id!); queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate('/') }
  async function removePermanently() { await api.permanentlyDeleteNote(id!); queryClient.removeQueries({ queryKey: ['note', id] }); queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate('/') }
  if (noteQuery.isLoading) return <div className="app-loading"><div className="loader"/>Opening note</div>
  if (!noteQuery.data) return <div className="app-loading">That note could not be found.</div>
  return <Editor note={noteQuery.data} onBack={() => navigate('/')} save={input => update.mutateAsync(input)} refresh={refresh} trash={trash} restore={restore} permanentlyDelete={removePermanently} onToast={toast}/>
}

export default function App() { return <MuseApp/> }
