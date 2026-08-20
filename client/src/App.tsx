import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { Cpu, KeyRound, Moon, RefreshCw, Settings, Sun, X } from 'lucide-react'
import { api, type AiUsage } from './services/api'
import { chatModel, setChatModel } from './services/settings'
import type { Note, NoteInput } from './types'
import { Dashboard } from './pages/Dashboard'
import { Editor } from './components/Editor'
import { CommandPalette } from './components/CommandPalette'
import { ChatPanel } from './components/ChatPanel'
import { ResearchPanel } from './components/ResearchPanel'
import { GraphView } from './components/GraphView'
import { Toast } from './components/Toast'
import { AuthPage } from './components/AuthPage'
import { AccountSettings } from './components/AccountSettings'
import { supabase } from './services/supabase'

function isRecoveryLink() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  return hash.get('type') === 'recovery' || query.get('type') === 'recovery'
}

function MuseApp() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState('all')
  const [query, setQuery] = useState('')
  const [dark, setDark] = useState(localStorage.getItem('muse-theme') === 'dark')
  const [command, setCommand] = useState(false)
  const [ask, setAsk] = useState(false)
  const [research, setResearch] = useState(false)
  const [collections, setCollections] = useState(false)
  const [settings, setSettings] = useState(false)
  const [toast, setToast] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [apiKeyState, setApiKeyState] = useState<{ hasApiKey: boolean } | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [apiKeySaving, setApiKeySaving] = useState(false)
  const [apiKeyError, setApiKeyError] = useState('')
  const [usage, setUsage] = useState<AiUsage | null>(null)
  const [usageError, setUsageError] = useState('')
  const [authenticated, setAuthenticated] = useState<boolean | undefined>(undefined)
  const [passwordRecovery, setPasswordRecovery] = useState(isRecoveryLink)
  const [userEmail, setUserEmail] = useState('')
  const [userName, setUserName] = useState('')
  const [aiWorking, setAiWorking] = useState('')
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
  const emptyTrash = useMutation({ mutationFn: () => api.emptyTrash(), onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notes'] }); setToast('Trash emptied.') }, onError: () => setToast('Could not empty the trash.') })
  const deleteSelected = useMutation({ mutationFn: (ids: string[]) => api.deleteNotes(ids), onSuccess: (_value, ids) => { queryClient.invalidateQueries({ queryKey: ['notes'] }); setToast(`${ids.length} note${ids.length === 1 ? '' : 's'} deleted permanently.`) }, onError: () => setToast('Could not delete the selected notes.') })
  const restoreSelected = useMutation({ mutationFn: (ids: string[]) => api.restoreNotes(ids), onSuccess: (_value, ids) => { queryClient.invalidateQueries({ queryKey: ['notes'] }); setToast(`${ids.length} note${ids.length === 1 ? '' : 's'} restored.`) }, onError: () => setToast('Could not restore the selected notes.') })

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('muse-theme', dark ? 'dark' : 'light') }, [dark])
  useEffect(() => { if (!settings) return; let cancelled = false; void api.listModels().then(list => { if (!cancelled) setModels(list) }).catch(() => { if (!cancelled) setModels([]) }); return () => { cancelled = true } }, [settings])
  useEffect(() => {
    if (!settings) return
    let cancelled = false
    setApiKeyError(''); setUsageError('')
    void api.getSettings().then(state => { if (!cancelled) { setApiKeyState(state); if (!state.hasApiKey) setApiKeyDraft('') } }).catch(() => { if (!cancelled) setApiKeyState(null) })
    void api.getAiUsage().then(value => { if (!cancelled) setUsage(value) }).catch(error => { if (!cancelled) { setUsage(null); setUsageError(error instanceof Error ? error.message : 'Usage could not be loaded.') } })
    return () => { cancelled = true }
  }, [settings])
  async function refreshUsage() { setUsageError(''); try { setUsage(await api.getAiUsage()) } catch (error) { setUsage(null); setUsageError(error instanceof Error ? error.message : 'Usage could not be loaded.') } }
  async function saveKey() { setApiKeySaving(true); setApiKeyError(''); try { setApiKeyState(await api.saveApiKey(apiKeyDraft.trim())); setApiKeyDraft(''); setToast('Ollama API key saved.') } catch (error) { setApiKeyError(error instanceof Error ? error.message : 'Could not save the API key.') } finally { setApiKeySaving(false) } }
  async function removeKey() { setApiKeySaving(true); setApiKeyError(''); try { setApiKeyState(await api.deleteApiKey()); setUsage(null); setToast('Ollama API key removed.') } catch (error) { setApiKeyError(error instanceof Error ? error.message : 'Could not remove the API key.') } finally { setApiKeySaving(false) } }
  function accountUpdated(user: { email?: string; user_metadata?: { full_name?: string } }) {
    setUserEmail(user.email || '')
    setUserName(typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : '')
  }
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setAuthenticated(!!data.session)
      setUserEmail(data.session?.user.email || '')
      setUserName(typeof data.session?.user.user_metadata?.full_name === 'string' ? data.session.user.user_metadata.full_name : '')
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthenticated(!!session)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
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
  useEffect(() => {
    if (authenticated !== true) return
    let cancelled = false
    const poll = async () => {
      try {
        const state = await api.getAiActive()
        if (!cancelled) setAiWorking(state.running ? state.type || '' : '')
      } catch { /* keep the last known state on network errors */ }
    }
    void poll()
    const timerId = window.setInterval(() => { void poll() }, 4000)
    return () => { cancelled = true; window.clearInterval(timerId) }
  }, [authenticated])

  const counts = { all: allQuery.data?.length || 0, favorites: favoritesQuery.data?.length || 0, archive: archiveQuery.data?.length || 0, trash: trashQuery.data?.length || 0 }
  const tags = [...new Set((allQuery.data || []).flatMap(note => note.tags))].sort()
  const dashboard = <Dashboard notes={notesQuery.data || []} counts={counts} scope={scope} setScope={setScope} query={query} setQuery={setQuery} create={() => create.mutate()} open={note => navigate(`/note/${note.id}`)} dark={dark} toggleTheme={() => setDark(!dark)} ask={() => setAsk(true)} research={() => setResearch(true)} collections={() => setCollections(true)} graph={() => navigate('/graph')} settings={() => setSettings(true)} userEmail={userEmail} userName={userName} emptyTrash={() => emptyTrash.mutate()} deleteSelected={ids => deleteSelected.mutate(ids)} restoreSelected={ids => restoreSelected.mutate(ids)} aiWorking={aiWorking} />
  if (authenticated === undefined) return <div className="app-loading"><div className="loader"/>Loading your space</div>
  if (!authenticated || passwordRecovery) return <AuthPage recovery={passwordRecovery} onPasswordUpdated={() => setPasswordRecovery(false)}/>
  return <>
    {notesQuery.isLoading ? <div className="app-loading"><div className="loader"/>Loading your space</div> : <Routes><Route path="/" element={dashboard}/><Route path="/note/:id" element={<NoteRoute toast={setToast}/>}/><Route path="/graph" element={<GraphView onBack={() => navigate('/')} create={() => create.mutate()}/>}/><Route path="*" element={dashboard}/></Routes>}
    <CommandPalette open={command} close={() => setCommand(false)} create={() => create.mutate()} ask={() => setAsk(true)} theme={() => setDark(!dark)}/>
    {ask && <ChatPanel mode="search" onClose={() => setAsk(false)}/>}
    {research && <ResearchPanel onClose={() => setResearch(false)} onDone={id => { setResearch(false); if (id) { queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate(`/note/${id}`) } }}/>}<Toast message={toast} onClose={() => setToast('')}/>
    {collections && <div className="command-backdrop" onMouseDown={() => setCollections(false)}><section className="command collection-panel" onMouseDown={event => event.stopPropagation()}><header><strong>Collections</strong><button onClick={() => setCollections(false)}><X size={17}/></button></header><p>Collections are your existing note tags. Select one to filter your notes.</p><div className="collection-tags">{tags.length ? tags.map(tag => <button key={tag} onClick={() => { setQuery(tag); setScope('all'); setCollections(false) }}>{tag}</button>) : <span>Add tags to a note to create your first collection.</span>}</div></section></div>}
    {settings && <div className="command-backdrop" onMouseDown={() => setSettings(false)}><section className="command settings-panel" onMouseDown={event => event.stopPropagation()}><header><strong>Settings</strong><button onClick={() => setSettings(false)}><X size={17}/></button></header><AccountSettings email={userEmail} name={userName} onUpdated={accountUpdated} onMessage={setToast}/><div className="setting-row"><span><Settings size={17}/><span><strong>Appearance</strong><small>Choose the interface theme.</small></span></span><button className="setting-toggle" onClick={() => setDark(!dark)}>{dark ? <><Sun size={16}/> Light</> : <><Moon size={16}/> Dark</>}</button></div><div className="setting-row"><span><KeyRound size={17}/><span><strong>Ollama API key{apiKeyState?.hasApiKey ? <em className="saved-badge">Saved</em> : null}</strong><small>Your own key — AI goes straight to Ollama Cloud, no queue. Create one at <a href="https://ollama.com/settings/keys" target="_blank" rel="noreferrer">ollama.com/settings/keys</a>.</small></span></span><span className="api-key-controls"><input type="password" className="setting-input" placeholder={apiKeyState?.hasApiKey ? 'Replace key…' : 'ollama-…'} value={apiKeyDraft} onChange={e => setApiKeyDraft(e.target.value)}/><span className="api-key-actions"><button className="setting-save" onClick={() => void saveKey()} disabled={apiKeySaving || !apiKeyDraft.trim()}>{apiKeySaving ? 'Saving…' : 'Save'}</button>{apiKeyState?.hasApiKey ? <button className="setting-remove" onClick={() => void removeKey()} disabled={apiKeySaving}>Remove</button> : null}</span></span></div>{apiKeyError && <p className="setting-error">{apiKeyError}</p>}<div className="usage-card"><header><span><strong>Ollama Cloud usage</strong><small>Session and weekly limits from your plan.</small></span>{usage?.configured ? <button onClick={() => void refreshUsage()}><RefreshCw size={14}/> Refresh</button> : null}</header>{usage?.configured ? <div className="usage-bars"><UsageBar label="Session · 5-hour window" value={usage.session?.usedPct} models={usage.session?.models || []}/><UsageBar label="Weekly · 7-day window" value={usage.weekly?.usedPct} models={usage.weekly?.models || []}/>{usage.plan ? <p className="usage-plan">Plan: <strong style={{ textTransform: 'capitalize' }}>{usage.plan}</strong></p> : null}</div> : <p className="usage-empty">{usageError || (apiKeyState?.hasApiKey ? 'Usage could not be loaded.' : 'Add your Ollama API key above to see your Ollama Cloud usage.')}</p>}</div><div className="setting-row"><span><Cpu size={17}/><span><strong>Chat model</strong><small>AI model used for this app's requests.</small></span></span><select className="setting-select" value={chatModel()} onChange={e => { setChatModel(e.target.value); setToast(e.target.value ? `Chat model: ${e.target.value}` : 'Chat model: default') }}>{[{ value: '', label: 'Default' }, ...models.map(name => ({ value: name, label: name }))].map(option => <option key={option.value || 'default'} value={option.value}>{option.label}</option>)}</select></div><button className="sign-out" onClick={() => void supabase.auth.signOut()}>Sign out</button><p className="settings-note">Local embedding service and defaults are configured in the project’s root <code>.env</code> file; API keys are per-user, encrypted in the database.</p></section></div>}
  </>
}

function UsageBar({ label, value, models }: { label: string; value?: number; models: { name: string; requests: number }[] }) {
  const pct = Math.min(typeof value === 'number' ? value : 0, 100)
  return <div className="usage-bar"><div className="usage-bar-top"><span>{label}</span><strong>{pct.toFixed(1)}%</strong></div><div className="usage-track"><i style={{ width: `${pct}%` }}/></div>{models.length ? <ul className="usage-models">{models.map(item => <li key={item.name}><span>{item.name}</span><em>{item.requests} requests</em></li>)}</ul> : null}</div>
}

function NoteRoute({ toast }: { toast: (message: string) => void }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const noteQuery = useQuery({ queryKey: ['note', id], queryFn: () => api.getNote(id!), enabled: !!id, refetchInterval: query => query.state.data?.aiStatus === 'processing' ? 2500 : false })
  const update = useMutation({ mutationFn: (input: NoteInput) => api.updateNote(id!, input), onSuccess: note => { queryClient.setQueryData(['note', id], note); queryClient.invalidateQueries({ queryKey: ['notes'] }) }, onError: () => toast('Unable to save changes.') })
  async function refresh(): Promise<Note> { const note = await api.getNote(id!); queryClient.setQueryData(['note', id], note); queryClient.invalidateQueries({ queryKey: ['notes'] }); return note }
  async function trash() { await api.deleteNote(id!); queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate('/') }
  async function restore() { await api.restoreNote(id!); queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate('/') }
  async function removePermanently() { await api.permanentlyDeleteNote(id!); queryClient.removeQueries({ queryKey: ['note', id] }); queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate('/') }
  if (noteQuery.isLoading) return <div className="app-loading"><div className="loader"/>Opening note</div>
  if (!noteQuery.data) return <div className="app-loading">That note could not be found.</div>
  return <Editor note={noteQuery.data} onBack={() => navigate('/')} save={input => update.mutateAsync(input)} refresh={refresh} trash={trash} restore={restore} permanentlyDelete={removePermanently} onToast={toast}/>
}

export default function App() { return <MuseApp/> }
