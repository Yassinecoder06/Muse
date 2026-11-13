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

  const displayName = general.userName?.trim() || 'Local User'
  const initials = general.userName?.trim().split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'MU'

  return (
    <div className="settings-page">
      <aside className="settings-nav" aria-label="Settings sections">
        <div className="settings-nav-top">
          <button type="button" className="settings-back" onClick={onBack} title="Return to your notes (Esc)">
            <ArrowLeft size={16}/>
            <span>Back to notes</span>
          </button>
          <div className="settings-nav-title-row">
            <h1>Settings</h1>
          </div>
        </div>

        <nav className="settings-nav-links">
          {SECTIONS.map(({ id, label, hint, icon: Icon }) => (
            <NavLink
              key={id}
              to={`/settings/${id}`}
              replace
              className={({ isActive }) => `settings-nav-item${isActive ? ' active' : ''}`}
            >
              <span className="settings-nav-item-icon" aria-hidden="true">
                <Icon size={17}/>
              </span>
              <span className="settings-nav-item-text">
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
            </NavLink>
          ))}
        </nav>

        {/* Compact switcher for narrow screens, where the nav collapses. */}
        <div className="settings-nav-mobile-bar">
          <select
            className="settings-nav-select"
            value={active}
            onChange={e => navigate(`/settings/${e.target.value}`, { replace: true })}
            aria-label="Settings section"
          >
            {SECTIONS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <footer className="settings-nav-footer">
          <div className="settings-nav-user-badge">
            <div className="settings-nav-avatar" aria-hidden="true">{initials}</div>
            <div className="settings-nav-user-meta">
              <span className="settings-nav-user-name" title={displayName}>{displayName}</span>
              <span className="settings-nav-app-version">Muse v1.0</span>
            </div>
          </div>
        </footer>
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
