import { useEffect, useState } from 'react'
import { Gauge, RefreshCw } from 'lucide-react'
import { api, type AiUsage, type SettingsResponse } from '../../../services/api'
import { chatModel } from '../../../services/settings'
import { AiProvidersPanel } from '../../../components/AiProvidersPanel'
import { SettingsCard, SettingsSection } from '../ui'

type ProviderTab = 'auto' | 'gemini' | 'ollama'

export function AiSection({ onToast }: { onToast: (message: string) => void }) {
  return (
    <SettingsSection title="AI providers" description="Models Bip uses for chat, research, images, voice and dictation, and how much quota is left.">
      <AiProvidersPanel onToast={onToast}/>
      <UsageCard/>
    </SettingsSection>
  )
}

function UsageCard() {
  const [apiKeyState, setApiKeyState] = useState<SettingsResponse | null>(null)
  const [usage, setUsage] = useState<AiUsage | null>(null)
  const [usageError, setUsageError] = useState('')
  const [tab, setTab] = useState<ProviderTab>('auto')
  const activeModel = chatModel()

  async function refresh(provider: ProviderTab = tab) {
    setUsageError('')
    try {
      setUsage(await api.getAiUsage({ model: chatModel() || undefined, provider: provider === 'auto' ? undefined : provider }))
    } catch (error) {
      setUsage(null)
      setUsageError(error instanceof Error ? error.message : 'Usage could not be loaded.')
    }
  }

  useEffect(() => {
    let cancelled = false
    void api.getSettings().then(state => { if (!cancelled) setApiKeyState(state) }).catch(() => { if (!cancelled) setApiKeyState(null) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { void refresh(tab) }, [tab])

  const title = usage?.provider === 'gemini' ? 'Google Gemini usage' : usage?.provider === 'ollama' ? 'Ollama Cloud usage' : 'Quota & usage'
  const description = usage?.provider === 'gemini'
    ? 'Daily free-tier requests (1,500 per day) and token volume. Resets at midnight UTC.'
    : usage?.provider === 'ollama' ? 'Session and weekly limits from your plan.' : 'Usage statistics and limits.'

  return (
    <SettingsCard
      title={title}
      description={description}
      icon={<Gauge size={16}/>}
      actions={usage?.configured ? <button type="button" className="setting-toggle" onClick={() => void refresh()}><RefreshCw size={14}/> Refresh</button> : null}
    >
      <div className="usage-card">
        {apiKeyState?.hasGeminiKey && apiKeyState?.hasOllamaKey ? (
          <div className="usage-provider-tabs">
            <button type="button" className={`usage-provider-tab ${tab === 'auto' ? 'active' : ''}`} onClick={() => setTab('auto')} title="Show quota for the active chat model">
              Auto ({activeModel ? (activeModel.startsWith('gemini') ? 'Gemini' : 'Ollama') : 'Gemini'})
            </button>
            <button type="button" className={`usage-provider-tab ${tab === 'gemini' ? 'active' : ''}`} onClick={() => setTab('gemini')}>Gemini (1,500 RPD)</button>
            <button type="button" className={`usage-provider-tab ${tab === 'ollama' ? 'active' : ''}`} onClick={() => setTab('ollama')}>Ollama Cloud</button>
          </div>
        ) : null}
        {usage?.configured ? (
          <div className="usage-bars">
            {usage.provider === 'gemini' ? (
              <>
                <UsageBar
                  label="Daily requests · 1,500 limit"
                  value={usage.session?.usedPct}
                  sublabel={`${(usage.requestsToday || 0).toLocaleString()} / 1,500 (${(usage.session?.usedPct || 0).toFixed(1)}%)`}
                  models={usage.session?.models || []}
                />
                <div className="usage-bar-top usage-total">
                  <span>Total tokens today</span>
                  <strong>{(usage.totalTokens || 0).toLocaleString()} tokens</strong>
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
            {usageError || (apiKeyState?.hasApiKey ? 'Usage could not be loaded.' : 'Add your Google Gemini API key above to see quotas and token usage.')}
          </p>
        )}
      </div>
    </SettingsCard>
  )
}

function UsageBar({ label, value, sublabel, models }: {
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
      <div className="usage-track"><i style={{ width: `${pct}%` }}/></div>
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
