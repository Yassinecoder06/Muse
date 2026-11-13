import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Cpu, KeyRound, Loader2, MessageSquare, Mic, Plus, RefreshCw, Server, Trash2, Volume2, X, Zap } from 'lucide-react'
import { api, type AiCapability, type AiCatalogModel, type AiPreferences, type AiProvidersState } from '../services/api'
import { saveVoiceSettings } from '../services/robot-audio.service'
import { SettingsCard, SettingsRow } from '../pages/settings/ui'

const CAPABILITY_LABEL: Record<AiCapability, string> = { chat: 'chat', embedding: 'embedding', tts: 'voice', stt: 'dictation' }
const COMPATIBLE_EXAMPLES = 'Groq: https://api.groq.com/openai/v1 · Mistral: https://api.mistral.ai/v1 · DeepSeek: https://api.deepseek.com/v1 · OpenRouter: https://openrouter.ai/api/v1 · LM Studio: http://localhost:1234/v1'

/** Settings → AI providers: keys for any provider, "Fetch models", and which model does which job. */
export function AiProvidersPanel({ onToast }: { onToast: (message: string) => void }) {
  const [state, setState] = useState<AiProvidersState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ kind: 'openai', name: '', baseUrl: '', apiKey: '' })
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({})
  const [prefs, setPrefs] = useState<AiPreferences | null>(null)
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string } | 'running'>>({})

  const load = (next: AiProvidersState) => {
    setState(next)
    setPrefs(next.preferences)
  }

  useEffect(() => {
    api.aiProviders().then(load).catch(err => setError(err instanceof Error ? err.message : 'Could not load AI providers.'))
  }, [])

  // Follow a background re-index after the embedding model changes.
  useEffect(() => {
    if (!state?.reindex?.running) return
    const timer = window.setInterval(() => {
      api.aiReindexStatus().then(reindex => setState(current => current && { ...current, reindex })).catch(() => {})
    }, 2000)
    return () => window.clearInterval(timer)
  }, [state?.reindex?.running])

  async function run(label: string, action: () => Promise<AiProvidersState>, success?: string) {
    setBusy(label)
    setError('')
    try {
      load(await action())
      if (success) onToast(success)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  const kindInfo = state?.kinds.find(k => k.kind === form.kind)
  const byCapability = (capability: AiCapability) => (state?.catalog || []).filter(m => m.capabilities.includes(capability))
  const dirty = useMemo(() => JSON.stringify(prefs) !== JSON.stringify(state?.preferences), [prefs, state?.preferences])

  async function addProvider() {
    await run('add', () => api.addAiProvider({
      kind: form.kind,
      name: form.name.trim() || undefined,
      // Empty = default (local Ollama's address is resolved by the server).
      baseUrl: form.baseUrl.trim() || null,
      apiKey: form.apiKey.trim() || null
    }), 'Provider added. Its models were fetched.')
    setForm({ kind: form.kind, name: '', baseUrl: '', apiKey: '' })
    setAdding(false)
  }

  async function savePrefs() {
    if (!prefs) return
    await run('prefs', () => api.saveAiPreferences(prefs), 'AI model choices saved.')
    saveVoiceSettings({
      ttsEngine: prefs.tts === 'builtin:browser' ? 'native' : 'neural',
      sttEngine: prefs.stt === 'builtin:browser' ? 'native' : 'gemini'
    })
  }

  async function test(ref: string | null, capability: AiCapability) {
    if (!ref) return
    const key = `${capability}:${ref}`
    setTests(t => ({ ...t, [key]: 'running' }))
    try {
      const result = await api.testAiModel(ref, capability, prefs?.ttsVoice)
      setTests(t => ({ ...t, [key]: { ok: result.ok, text: result.ok ? `${result.detail} (${(result.ms / 1000).toFixed(1)} s)` : result.error || 'Failed' } }))
    } catch (err) {
      setTests(t => ({ ...t, [key]: { ok: false, text: err instanceof Error ? err.message : 'Failed' } }))
    }
  }

  const testBadge = (ref: string | null, capability: AiCapability) => {
    const result = ref ? tests[`${capability}:${ref}`] : undefined
    if (!result) return null
    if (result === 'running') return <small className="ai-test running"><Loader2 size={12} className="spin"/> Testing…</small>
    return <small className={`ai-test ${result.ok ? 'ok' : 'fail'}`}>{result.ok ? <Check size={12}/> : <X size={12}/>} {result.text}</small>
  }

  const modelSelect = (capability: AiCapability, value: string | null, onChange: (ref: string | null) => void, allowNone: string) => {
    const models = byCapability(capability)
    const groups = models.reduce<Record<string, AiCatalogModel[]>>((acc, m) => { (acc[m.providerName] ||= []).push(m); return acc }, {})
    return (
      <select className="setting-select" value={value || ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">{allowNone}</option>
        {Object.entries(groups).map(([provider, list]) => (
          <optgroup key={provider} label={provider}>
            {list.map(m => <option key={m.ref} value={m.ref}>{m.label}</option>)}
          </optgroup>
        ))}
      </select>
    )
  }

  if (!state || !prefs) {
    return <div className="ai-panel">{error ? <p className="setting-error">{error}</p> : <p className="ai-muted"><Loader2 size={14} className="spin"/> Loading AI providers…</p>}</div>
  }

  const ttsModel = state.catalog.find(m => m.ref === prefs.tts)
  const voiceKind = prefs.tts === 'builtin:edge' ? 'edge' : ttsModel?.kind?.startsWith('openai') ? 'openai' : ttsModel?.kind === 'gemini' ? 'gemini' : null
  const fallbacks = prefs.chat.slice(1)

  return (
    <div className="ai-panel">
      <SettingsCard
        title="Provider accounts & API keys"
        description="Connect providers, manage saved credentials, and refresh the available model list."
        icon={<Server size={16}/>}
        actions={<button type="button" className="setting-toggle" disabled={busy === 'fetch'} onClick={() => run('fetch', () => api.fetchAiModels(), 'Models fetched from all providers.')}>{busy === 'fetch' ? <Loader2 size={15} className="spin"/> : <RefreshCw size={15}/>} Fetch models</button>}
      >
        <div className="ai-providers">
          {state.providers.map(p => {
            const counts = (['chat', 'embedding', 'tts', 'stt'] as AiCapability[])
              .map(c => [c, p.models.filter(m => m.capabilities.includes(c)).length] as const)
              .filter(([, n]) => n > 0)
            return (
              <article key={p.id} className={`ai-provider${p.enabled ? '' : ' disabled'}`}>
                <div className="ai-provider-top">
                  <div className="ai-provider-meta">
                    <strong>{p.name}</strong>
                    <small>{p.kindLabel}{p.baseUrl ? ` · ${p.baseUrl}` : ''}{p.keyHint ? ` · key ${p.keyHint}` : ''}</small>
                  </div>
                  <div className="ai-provider-actions">
                    <button type="button" title={p.enabled ? 'Disable' : 'Enable'} aria-label={`${p.enabled ? 'Disable' : 'Enable'} ${p.name}`} onClick={() => run(`toggle-${p.id}`, () => api.updateAiProvider(p.id, { enabled: !p.enabled }))}>{p.enabled ? 'On' : 'Off'}</button>
                    <button type="button" title="Fetch this provider's models" aria-label={`Fetch ${p.name} models`} onClick={() => run(`fetch-${p.id}`, () => api.fetchAiModels(p.id))}>{busy === `fetch-${p.id}` ? <Loader2 size={13} className="spin"/> : <RefreshCw size={13}/>}</button>
                    <button type="button" title="Remove provider" aria-label={`Remove ${p.name}`} className="danger" onClick={() => { if (window.confirm(`Remove ${p.name}? Its key is deleted and models using it are unselected.`)) void run(`del-${p.id}`, () => api.deleteAiProvider(p.id), 'Provider removed.') }}><Trash2 size={13}/></button>
                  </div>
                </div>
                {p.lastError
                  ? <small className="ai-error">⚠ {p.lastError}</small>
                  : counts.length
                    ? <small className="ai-models">{counts.map(([c, n]) => `${n} ${CAPABILITY_LABEL[c]}`).join(' · ')}</small>
                    : <small className="ai-muted">{p.lastFetchedAt ? 'No usable models found.' : 'Not fetched yet.'}</small>}
                {p.needsKey && (
                  <div className="ai-key-row">
                    <KeyRound size={14}/>
                    <input aria-label={`${p.name} API key`} type="password" placeholder={p.hasKey ? 'Replace API key' : 'API key'} value={keyDraft[p.id] || ''} onChange={e => setKeyDraft(d => ({ ...d, [p.id]: e.target.value }))}/>
                    <button type="button" disabled={!keyDraft[p.id]?.trim()} onClick={async () => { await run(`key-${p.id}`, () => api.updateAiProvider(p.id, { apiKey: keyDraft[p.id].trim() }), 'Key saved and checked.'); setKeyDraft(d => ({ ...d, [p.id]: '' })) }}>Save key</button>
                  </div>
                )}
              </article>
            )
          })}
        </div>

        {adding ? (
          <div className="ai-add">
            <div className="ai-add-grid">
              <label>Provider
                <select className="setting-select" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value, baseUrl: '' })}>
                  {state.kinds.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>
              </label>
              <label>Name{kindInfo?.needsBaseUrl ? '' : ' (optional)'}
                <input className="setting-input" value={form.name} placeholder={kindInfo?.needsBaseUrl ? 'e.g. Groq' : kindInfo?.label} onChange={e => setForm({ ...form, name: e.target.value })}/>
              </label>
              {(kindInfo?.needsBaseUrl || form.kind === 'ollama_local') && (
                <label className="wide">Base URL
                  <input className="setting-input" value={form.baseUrl} placeholder={kindInfo?.defaultBaseUrl || (form.kind === 'anthropic_compatible' ? 'https://api.example.com' : 'https://api.example.com/v1')} onChange={e => setForm({ ...form, baseUrl: e.target.value })}/>
                  {form.kind === 'openai_compatible' && <small>{COMPATIBLE_EXAMPLES}</small>}
                </label>
              )}
              {kindInfo?.needsKey && (
                <label className="wide">API key
                  <input className="setting-input" type="password" value={form.apiKey} placeholder="Paste the key" onChange={e => setForm({ ...form, apiKey: e.target.value })}/>
                </label>
              )}
            </div>
            <div className="ai-add-actions">
              <button type="button" className="setting-toggle" onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className="setting-toggle primary" disabled={busy === 'add'} onClick={() => void addProvider()}>{busy === 'add' ? <Loader2 size={15} className="spin"/> : <Plus size={15}/>} Add & fetch models</button>
            </div>
          </div>
        ) : (
          <button type="button" className="ai-add-button" onClick={() => setAdding(true)}><Plus size={15}/> Add provider</button>
        )}
        {error && <p className="setting-error">{error}</p>}
      </SettingsCard>

      <SettingsCard title="Chat model & fallbacks" description="Choose the model for Bip and the order to try alternatives." icon={<MessageSquare size={16}/> }>
        <SettingsRow label="Primary chat model" description="Used for chat, summaries, titles, tags, rewriting, Q&A, and research.">
          <div className="ai-default-control">
            {modelSelect('chat', prefs.chat[0] || null, ref => setPrefs({ ...prefs, chat: ref ? [ref, ...fallbacks.filter(f => f !== ref)] : [] }), 'Muse automatic (Gemini cascade / Ollama)')}
            <button type="button" className="setting-toggle" disabled={!prefs.chat[0]} onClick={() => void test(prefs.chat[0], 'chat')}>Test</button>
          </div>
        </SettingsRow>
        {testBadge(prefs.chat[0] || null, 'chat')}
        {prefs.chat[0] && <div className="ai-fallback-block">
          <div><strong>Fallback order</strong><small>Tried in order if the chat model fails or is out of quota.</small></div>
          {fallbacks.length ? <ol className="ai-fallbacks">
            {fallbacks.map((ref, i) => {
              const m = state.catalog.find(x => x.ref === ref)
              const move = (to: number) => { const list = [...fallbacks]; list.splice(i, 1); list.splice(to, 0, ref); setPrefs({ ...prefs, chat: [prefs.chat[0], ...list] }) }
              return <li key={ref}><span>{m ? `${m.providerName} · ${m.label}` : ref}</span><button type="button" disabled={i === 0} onClick={() => move(i - 1)} title="Move up"><ArrowUp size={13}/></button><button type="button" disabled={i === fallbacks.length - 1} onClick={() => move(i + 1)} title="Move down"><ArrowDown size={13}/></button><button type="button" onClick={() => setPrefs({ ...prefs, chat: prefs.chat.filter(r => r !== ref) })} title="Remove"><X size={13}/></button></li>
            })}
          </ol> : <p className="ai-muted">No fallback models selected yet.</p>}
          {modelSelect('chat', null, ref => { if (ref && !prefs.chat.includes(ref)) setPrefs({ ...prefs, chat: [...prefs.chat, ref] }) }, '+ Add a fallback…')}
        </div>}
      </SettingsCard>

      <SettingsCard title="Embeddings" description="Power semantic search, Ask my notes, and the knowledge graph." icon={<Cpu size={16}/> }>
        <SettingsRow label="Embedding model" description="Changing this model re-indexes your notes.">
          <div className="ai-default-control">
            {modelSelect('embedding', prefs.embedding, ref => setPrefs({ ...prefs, embedding: ref }), 'Muse automatic (local Ollama)')}
            <button type="button" className="setting-toggle" disabled={!prefs.embedding} onClick={() => void test(prefs.embedding, 'embedding')}>Test</button>
          </div>
        </SettingsRow>
        {testBadge(prefs.embedding, 'embedding')}
        {state.reindex && (state.reindex.running || state.reindex.error) && <small className={state.reindex.error ? 'ai-error' : 'ai-muted'}>{state.reindex.running ? <><Loader2 size={12} className="spin"/> Re-indexing notes: {state.reindex.done}/{state.reindex.total}</> : `Re-index finished with problems: ${state.reindex.error}`}</small>}
      </SettingsCard>

      <SettingsCard title="Read aloud" description="Choose the voice model Bip uses for spoken replies and reading notes." icon={<Volume2 size={16}/> }>
        <SettingsRow label="Text-to-speech model">
          <div className="ai-default-control">
            {modelSelect('tts', prefs.tts, ref => setPrefs({ ...prefs, tts: ref, ttsVoice: null }), 'Muse automatic (Edge neural voice)')}
            <button type="button" className="setting-toggle" disabled={!prefs.tts} onClick={() => void test(prefs.tts, 'tts')}>Test</button>
          </div>
        </SettingsRow>
        {voiceKind && <SettingsRow label="Voice" description="Leave empty to use the model's default voice.">
          <input className="setting-input" list="ai-voices" value={prefs.ttsVoice || ''} placeholder="Default voice" onChange={e => setPrefs({ ...prefs, ttsVoice: e.target.value || null })}/>
          <datalist id="ai-voices">{(state.voices[voiceKind] || []).map(v => <option key={v} value={v}/>)}</datalist>
        </SettingsRow>}
        {testBadge(prefs.tts, 'tts')}
      </SettingsCard>

      <SettingsCard title="Dictation" description="Select the speech recognition model used by microphone dictation on the web." icon={<Mic size={16}/> }>
        <SettingsRow label="Speech-to-text model">
          {modelSelect('stt', prefs.stt, ref => setPrefs({ ...prefs, stt: ref }), 'Muse automatic (Gemini)')}
        </SettingsRow>
      </SettingsCard>

      <div className="ai-save-row">
        {dirty && <button type="button" className="setting-toggle" onClick={() => setPrefs(state.preferences)}>Discard changes</button>}
        <button type="button" className="setting-toggle primary" disabled={!dirty || busy === 'prefs'} onClick={() => void savePrefs()}>{busy === 'prefs' ? <Loader2 size={15} className="spin"/> : <Check size={15}/>} Save model choices</button>
      </div>
    </div>
  )
}
