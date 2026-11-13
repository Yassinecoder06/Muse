import { Bot, Check, Moon, Sun, User } from 'lucide-react'
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from '../ui'

export interface GeneralSectionProps {
  userName: string
  setUserName: (name: string) => void
  dark: boolean
  setDark: (dark: boolean) => void
  showBip: boolean
  setShowBip: (show: boolean) => void
  onChangeName: () => void
}

export function GeneralSection({
  userName,
  setUserName,
  dark,
  setDark,
  showBip,
  setShowBip,
  onChangeName
}: GeneralSectionProps) {
  const trimmedName = userName.trim()
  const displayName = trimmedName || 'Local User'
  const initials = trimmedName
    ? trimmedName.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()
    : 'MU'

  return (
    <SettingsSection title="General" description="Your profile, how Muse looks, and Bip.">
      <SettingsCard title="Profile" icon={<User size={16}/>}>
        <div className="profile-hero">
          <div className="profile-avatar" aria-hidden="true">
            {initials}
          </div>
          <div className="profile-hero-meta">
            <h4 className="profile-hero-name">{displayName}</h4>
            <div className="profile-hero-badge">
              <span className="profile-status-dot" aria-hidden="true"/>
              <span>Active local profile · Saved on this device</span>
            </div>
          </div>
        </div>

        <SettingsRow label="Your name" description="Used locally across your notes, calendar, and tasks.">
          <input
            type="text"
            className="setting-input profile-name-input"
            value={userName}
            onChange={e => {
              setUserName(e.target.value)
              localStorage.setItem('muse-user-name', e.target.value)
            }}
            placeholder="Your name"
            aria-label="Your name"
          />
        </SettingsRow>
        <SettingsRow label="Switch user" description="Show the welcome screen again and pick a new name.">
          <button type="button" className="setting-toggle" onClick={onChangeName}>Change name</button>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title="Appearance" icon={dark ? <Moon size={16}/> : <Sun size={16}/>}>
        <div className="theme-picker-section">
          <div className="theme-picker-header">
            <strong>Interface theme</strong>
            <small>Select light or dark mode for the workspace and editor.</small>
          </div>

          <div className="theme-picker-grid" role="radiogroup" aria-label="Interface theme">
            <button
              type="button"
              role="radio"
              aria-checked={!dark}
              className={`theme-tile light${!dark ? ' active' : ''}`}
              onClick={() => setDark(false)}
            >
              <div className="theme-tile-preview light" aria-hidden="true">
                <div className="theme-preview-sidebar">
                  <div className="theme-preview-brand"/>
                  <div className="theme-preview-nav-item active"/>
                  <div className="theme-preview-nav-item"/>
                  <div className="theme-preview-nav-item"/>
                </div>
                <div className="theme-preview-content">
                  <div className="theme-preview-header"/>
                  <div className="theme-preview-card">
                    <div className="theme-preview-line line-1"/>
                    <div className="theme-preview-line line-2"/>
                    <div className="theme-preview-line line-3"/>
                  </div>
                </div>
              </div>
              <div className="theme-tile-meta">
                <span className="theme-tile-label">
                  <Sun size={15}/> Light
                </span>
                <span className={`theme-tile-check${!dark ? ' checked' : ''}`} aria-hidden="true">
                  {!dark ? <Check size={12} strokeWidth={3}/> : null}
                </span>
              </div>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={dark}
              className={`theme-tile dark${dark ? ' active' : ''}`}
              onClick={() => setDark(true)}
            >
              <div className="theme-tile-preview dark" aria-hidden="true">
                <div className="theme-preview-sidebar">
                  <div className="theme-preview-brand"/>
                  <div className="theme-preview-nav-item active"/>
                  <div className="theme-preview-nav-item"/>
                  <div className="theme-preview-nav-item"/>
                </div>
                <div className="theme-preview-content">
                  <div className="theme-preview-header"/>
                  <div className="theme-preview-card">
                    <div className="theme-preview-line line-1"/>
                    <div className="theme-preview-line line-2"/>
                    <div className="theme-preview-line line-3"/>
                  </div>
                </div>
              </div>
              <div className="theme-tile-meta">
                <span className="theme-tile-label">
                  <Moon size={15}/> Dark
                </span>
                <span className={`theme-tile-check${dark ? ' checked' : ''}`} aria-hidden="true">
                  {dark ? <Check size={12} strokeWidth={3}/> : null}
                </span>
              </div>
            </button>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Bip" icon={<Bot size={16}/>}>
        <SettingsRow label="Show Bip the robot" description="A companion that moves around the screen and helps you.">
          <SettingsSwitch checked={showBip} onChange={setShowBip} label="Show Bip"/>
        </SettingsRow>

        <div className="bip-hero-banner">
          <div className="bip-hero-badge" aria-hidden="true">
            <Bot size={20}/>
          </div>
          <div className="bip-hero-text">
            <div className="bip-hero-title">
              <span>Floating companion</span>
              <span className={`bip-status-tag ${showBip ? 'active' : 'hidden'}`}>
                <i aria-hidden="true"/>
                {showBip ? 'Visible' : 'Hidden'}
              </span>
            </div>
            <p className="bip-hero-desc">
              {showBip
                ? 'Bip is active and floating on your screen. Click or drag Bip anywhere to chat, summarize notes, or dictate.'
                : 'Bip is hidden from your screen. Toggle on to bring back your robotic companion.'}
            </p>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
