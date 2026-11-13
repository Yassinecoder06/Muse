import { useEffect } from 'react'
import { ArrowLeft, Cpu, Plug, Settings as SettingsIcon, Shield, Volume2 } from 'lucide-react'
import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom'
import { GeneralSection, type GeneralSectionProps } from './sections/GeneralSection'
import { AiSection } from './sections/AiSection'
import { VoiceSection } from './sections/VoiceSection'
import { SecuritySection } from './sections/SecuritySection'
import { ConnectedAppsSection } from './sections/ConnectedAppsSection'
import './settings.css'

const SECTIONS = [
  { id: 'general', label: 'General', hint: 'Profile, theme, Bip', icon: SettingsIcon },
  { id: 'ai', label: 'AI providers', hint: 'Models and usage', icon: Cpu },
  { id: 'voice', label: 'Voice & sound', hint: 'Read aloud, dictation', icon: Volume2 },
  { id: 'security', label: 'Security', hint: 'Passphrase, lock', icon: Shield },
  { id: 'connected-apps', label: 'Connected apps', hint: 'muse-mcp for AI apps', icon: Plug }
] as const

type SectionId = typeof SECTIONS[number]['id']

export interface SettingsPageProps extends GeneralSectionProps {
  onBack: () => void
  onToast: (message: string) => void
}

/** Full-page Settings at /settings/:section, with a section nav on the left. */
export function SettingsPage({ onBack, onToast, ...general }: SettingsPageProps) {
  const { section } = useParams()
  const navigate = useNavigate()
  const active = SECTIONS.find(item => item.id === section)?.id as SectionId | undefined

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  if (!active) return <Navigate to="/settings/general" replace/>

  return (
    <div className="settings-page">
      <aside className="settings-nav" aria-label="Settings sections">
        <button type="button" className="settings-back" onClick={onBack}><ArrowLeft size={16}/> Back to notes</button>
        <h1>Settings</h1>
        <nav>
          {SECTIONS.map(({ id, label, hint, icon: Icon }) => (
            <NavLink key={id} to={`/settings/${id}`} replace className={({ isActive }) => `settings-nav-item${isActive ? ' active' : ''}`}>
              <Icon size={17}/>
              <span><strong>{label}</strong><small>{hint}</small></span>
            </NavLink>
          ))}
        </nav>
        {/* Compact switcher for narrow screens, where the nav collapses. */}
        <select className="settings-nav-select" value={active} onChange={e => navigate(`/settings/${e.target.value}`, { replace: true })} aria-label="Settings section">
          {SECTIONS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select>
      </aside>
      <main className="settings-content">
        {active === 'general' && <GeneralSection {...general}/>}
        {active === 'ai' && <AiSection onToast={onToast}/>}
        {active === 'voice' && <VoiceSection/>}
        {active === 'security' && <SecuritySection onToast={onToast}/>}
        {active === 'connected-apps' && <ConnectedAppsSection onToast={onToast}/>}
      </main>
    </div>
  )
}
