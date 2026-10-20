import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { Bot, Cpu, Mic, Moon, RefreshCw, Settings, Smartphone, Sparkles, Sun, User, Volume2, X } from 'lucide-react'
import { api, type AiUsage, type SettingsResponse } from './services/api'
import { chatModel, setChatModel } from './services/settings'
import { robotAudio, loadVoiceSettings, saveVoiceSettings } from './services/robot-audio.service'
import { tts } from './services/tts.service'
import { CURATED_NEURAL_VOICES } from './services/voice.types'
import type { Note, NoteInput, SpecializedCategory } from './types'
import { Dashboard } from './pages/Dashboard'
import { Editor } from './components/Editor'
import { CalendarView } from './components/CalendarView'
import { TasksView } from './components/TasksView'
import { AnalyticsView } from './components/AnalyticsView'
import { MusicView } from './components/music/MusicView'
import { CommandPalette } from './components/CommandPalette'
import { ChatPanel } from './components/ChatPanel'
import { AssistantWorkspace } from './components/AssistantWorkspace'
import { ResearchPanel } from './components/ResearchPanel'
import { GraphView } from './components/GraphView'
import { Toast } from './components/Toast'
import { SpecializedNotePanel } from './components/SpecializedNotePanel'
import { RobotCompanion } from './components/RobotCompanion/RobotCompanion'
import { RemotePairingModal } from './components/RemotePairingModal'
import { OwnerGate } from './components/OwnerGate'
import { AiProvidersPanel } from './components/AiProvidersPanel'
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
  const [settings, setSettings] = useState(false)
  const [remoteModalOpen, setRemoteModalOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [apiKeyState, setApiKeyState] = useState<SettingsResponse | null>(null)
  const [usage, setUsage] = useState<AiUsage | null>(null)
  const [usageError, setUsageError] = useState('')
  const [activeModel, setActiveModel] = useState<string>(() => chatModel())
  const [usageProviderTab, setUsageProviderTab] = useState<'auto' | 'gemini' | 'ollama'>('auto')
  const [userName, setUserName] = useState(() => localStorage.getItem('muse-user-name') || '')
  const [namePrompt, setNamePrompt] = useState(() => !localStorage.getItem('muse-user-name'))
  const [nameInput, setNameInput] = useState('')
  const [aiWorking, setAiWorking] = useState('')
  const [voiceSettings, setVoiceSettings] = useState(() => loadVoiceSettings())
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    if (settings) {
      setVoiceSettings(loadVoiceSettings())
      const english = tts.getEnglishVoices()
      setAvailableVoices(english.length > 0 ? english : tts.getVoices())
    }
  }, [settings])

  const updateVoicePref = (updates: Partial<typeof voiceSettings>) => {
    const next = saveVoiceSettings(updates)
    setVoiceSettings(next)
  }

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
    onSuccess: (_value, ids) => { queryClient.invalidateQueries({ queryKey: ['notes'] }); setToast(`${ids.length} note${ids.length === 1 ? '' : 's'} moved to trash.`) },
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
      setActiveModel('')
    }
  }, [])

  useEffect(() => {
    if (!settings) return
    let cancelled = false
    setUsageError('')
    const currentM = chatModel()
    setActiveModel(currentM)
    void api.getSettings().then(state => {
      if (!cancelled) setApiKeyState(state)
    }).catch(() => { if (!cancelled) setApiKeyState(null) })
    void api.getAiUsage({
      model: currentM || undefined,
      provider: usageProviderTab === 'auto' ? undefined : usageProviderTab
    }).then(value => { if (!cancelled) setUsage(value) }).catch(error => { if (!cancelled) { setUsage(null); setUsageError(error instanceof Error ? error.message : 'Usage could not be loaded.') } })
    return () => { cancelled = true }
  }, [settings, usageProviderTab])

  async function refreshUsage(customModel?: string, customProvider?: 'gemini' | 'ollama' | 'auto') {
    setUsageError('')
    try {
      const modelToUse = customModel !== undefined ? customModel : (activeModel || chatModel())
      const providerTabToUse = customProvider !== undefined ? customProvider : usageProviderTab
      const providerParam = providerTabToUse === 'auto' ? undefined : providerTabToUse
      setUsage(await api.getAiUsage({
        model: modelToUse || undefined,
        provider: providerParam
      }))
    }
    catch (error) { setUsage(null); setUsageError(error instanceof Error ? error.message : 'Usage could not be loaded.') }
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
    music={() => navigate('/music')}
    settings={() => setSettings(true)}
    linkPhone={() => setRemoteModalOpen(true)}
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
        <Route path="/music" element={<MusicView onBack={() => navigate('/')} onNavigate={path => navigate(path)}/>}/>
        <Route path="/assistant" element={<AssistantWorkspace onBack={() => navigate('/')} onCreateNote={input => create.mutate(input)} onNavigate={path => navigate(path)}/>}/>
        <Route path="*" element={dashboard}/>
      </Routes>
    )}
    <CommandPalette open={command} close={() => setCommand(false)} create={() => create.mutate()} ask={() => navigate('/assistant')} theme={() => setDark(!dark)}/>
    {ask && <ChatPanel mode="search" onClose={() => setAsk(false)} onCreateNote={input => create.mutate(input)}/>}
    {research && <ResearchPanel onClose={() => setResearch(false)} onDone={id => { setResearch(false); if (id) { queryClient.invalidateQueries({ queryKey: ['notes'] }); navigate(`/note/${id}`) } }}/>}
    <Toast message={toast} onClose={() => setToast('')}/>
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
          <AiProvidersPanel onToast={setToast}/>
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
              {usage?.configured ? <button onClick={() => void refreshUsage(activeModel, usageProviderTab)}><RefreshCw size={14}/> Refresh</button> : null}
            </header>
            {apiKeyState?.hasGeminiKey && apiKeyState?.hasOllamaKey ? (
              <div className="usage-provider-tabs">
                <button
                  type="button"
                  className={`usage-provider-tab ${usageProviderTab === 'auto' ? 'active' : ''}`}
                  onClick={() => {
                    setUsageProviderTab('auto')
                    void refreshUsage(activeModel, 'auto')
                  }}
                  title="Automatically show quota for active chat model"
                >
                  Auto ({activeModel ? (activeModel.startsWith('gemini') ? 'Gemini' : 'Ollama') : 'Gemini'})
                </button>
                <button
                  type="button"
                  className={`usage-provider-tab ${usageProviderTab === 'gemini' ? 'active' : ''}`}
                  onClick={() => {
                    setUsageProviderTab('gemini')
                    void refreshUsage(activeModel, 'gemini')
                  }}
                >
                  Gemini (1,500 RPD)
                </button>
                <button
                  type="button"
                  className={`usage-provider-tab ${usageProviderTab === 'ollama' ? 'active' : ''}`}
                  onClick={() => {
                    setUsageProviderTab('ollama')
                    void refreshUsage(activeModel, 'ollama')
                  }}
                >
                  Ollama Cloud
                </button>
              </div>
            ) : null}
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
            <span><Bot size={17}/><span><strong>Bip the Robot Helper</strong><small>Cute companion that moves around and helps you.</small></span></span>
            <button className="setting-toggle" onClick={() => setShowBip(!showBip)}>{showBip ? 'Enabled' : 'Hidden'}</button>
          </div>

          {/* Voice & Sound Settings */}
          <div className="setting-section-header">
            <span><Volume2 size={16}/> Voice & Sound</span>
          </div>

          <div className="setting-row">
            <span>
              <Volume2 size={17}/>
              <span>
                <strong>Text-to-Speech (TTS) Engine</strong>
                <small>Voice synthesis engine for reading notes and Bip speech.</small>
              </span>
            </span>
            <select
              className="setting-select"
              value={voiceSettings.ttsEngine || 'neural'}
              onChange={e => updateVoicePref({ ttsEngine: e.target.value as 'neural' | 'native' })}
            >
              <option value="neural">Muse voice (your read-aloud choice in AI providers)</option>
              <option value="native">Browser built-in voice (offline)</option>
            </select>
          </div>

          {(voiceSettings.ttsEngine || 'neural') === 'neural' ? (
            <div className="setting-row">
              <span>
                <Sparkles size={17}/>
                <span>
                  <strong>Edge neural voice</strong>
                  <small>Used when read-aloud is set to the Edge voices.</small>
                </span>
              </span>
              <select
                className="setting-select"
                value={voiceSettings.neuralVoice || 'en-US-JennyNeural'}
                onChange={e => updateVoicePref({ neuralVoice: e.target.value })}
              >
                {CURATED_NEURAL_VOICES.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="setting-row">
              <span>
                <Volume2 size={17}/>
                <span>
                  <strong>Browser English Voice</strong>
                  <small>Voice used when running browser native speech.</small>
                </span>
              </span>
              <select
                className="setting-select"
                value={voiceSettings.voiceURI}
                onChange={e => updateVoicePref({ voiceURI: e.target.value })}
              >
                <option value="">Default (Auto-select best English female voice)</option>
                {availableVoices.map(v => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="setting-row">
            <span>
              <Mic size={17}/>
              <span>
                <strong>Speech-to-Text (STT) Model</strong>
                <small>Audio transcription engine for microphone dictation.</small>
              </span>
            </span>
            <select
              className="setting-select"
              value={voiceSettings.sttEngine || 'gemini'}
              onChange={e => updateVoicePref({ sttEngine: e.target.value as 'gemini' | 'native' })}
            >
              <option value="gemini">Muse server (your dictation choice in AI providers)</option>
              <option value="native">Browser speech recognition (built-in)</option>
            </select>
          </div>

          <div className="setting-row">
            <span>
              <Cpu size={17}/>
              <span>
                <strong>Speech Speed ({voiceSettings.rate.toFixed(1)}x)</strong>
                <small>Pace of voice read-aloud playback.</small>
              </span>
            </span>
            <div className="setting-slider-wrap">
              <input
                type="range"
                min="0.8"
                max="1.4"
                step="0.05"
                value={voiceSettings.rate}
                onChange={e => updateVoicePref({ rate: parseFloat(e.target.value) })}
              />
            </div>
          </div>

          <div className="setting-row">
            <span>
              <Volume2 size={17}/>
              <span>
                <strong>Auto-read Bip replies aloud</strong>
                <small>Automatically speak Bip's answers when they arrive.</small>
              </span>
            </span>
            <button
              className="setting-toggle"
              onClick={() => updateVoicePref({ autoReadAloud: !voiceSettings.autoReadAloud })}
            >
              {voiceSettings.autoReadAloud ? 'Enabled' : 'Off'}
            </button>
          </div>

          <div className="setting-row">
            <span>
              <Bot size={17}/>
              <span>
                <strong>Bip Robotic Sound Effects</strong>
                <small>Chirps, boops, thinking pulses, and drag reactions.</small>
              </span>
            </span>
            <button
              className="setting-toggle"
              onClick={() => {
                const next = !voiceSettings.soundEffectsEnabled
                updateVoicePref({ soundEffectsEnabled: next })
                if (next) robotAudio.play('chirp')
              }}
            >
              {voiceSettings.soundEffectsEnabled ? 'Enabled' : 'Muted'}
            </button>
          </div>

          {voiceSettings.soundEffectsEnabled && (
            <div className="setting-row">
              <span>
                <Volume2 size={17}/>
                <span>
                  <strong>Sound Effects Volume ({Math.round(voiceSettings.soundEffectsVolume * 100)}%)</strong>
                  <small>Loudness of Bip's interactive sounds.</small>
                </span>
              </span>
              <div className="setting-slider-wrap">
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={voiceSettings.soundEffectsVolume}
                  onChange={e => {
                    const vol = parseFloat(e.target.value)
                    updateVoicePref({ soundEffectsVolume: vol })
                  }}
                />
              </div>
            </div>
          )}

          <div className="setting-actions-row">
            <button
              className="setting-test-btn"
              onClick={() => {
                robotAudio.play('chirp')
                tts.speak("Hello! I'm Bip, your Muse AI assistant. My voice is smooth, clear, and ready to assist you!")
              }}
            >
              <Volume2 size={14}/> Test Voice
            </button>
            <button
              className="setting-test-btn"
              onClick={() => {
                robotAudio.play('excited')
              }}
            >
              <Bot size={14}/> Test Robot Sound
            </button>
          </div>

          {/* Mobile Companion */}
          <div className="setting-section-header">
            <span><Smartphone size={16}/> Mobile Companion</span>
          </div>

          <div className="setting-row">
            <span>
              <Smartphone size={17}/>
              <span>
                <strong>Pair Phone & Devices</strong>
                <small>Pair your Android phone to access notes, tasks, and talk with Bip remotely.</small>
              </span>
            </span>
            <button
              className="setting-toggle"
              onClick={() => {
                setSettings(false)
                setRemoteModalOpen(true)
              }}
            >
              Pair Phone / Devices
            </button>
          </div>

          <button className="sign-out" onClick={() => {
            localStorage.removeItem('muse-user-name')
            setNamePrompt(true)
            setSettings(false)
          }}>Switch / Change Name</button>
          <button className="sign-out" onClick={() => { void api.deleteAppSession().finally(() => window.location.reload()) }}>Lock Muse</button>
        </section>
      </div>
    )}
    <RemotePairingModal isOpen={remoteModalOpen} onClose={() => setRemoteModalOpen(false)}/>
    <BipAlarmCenter/>
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

export default function App() { return <OwnerGate><MuseApp/></OwnerGate> }
