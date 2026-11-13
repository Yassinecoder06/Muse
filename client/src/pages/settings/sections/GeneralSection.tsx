import { Bot, Moon, Sun, User } from 'lucide-react'
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

export function GeneralSection({ userName, setUserName, dark, setDark, showBip, setShowBip, onChangeName }: GeneralSectionProps) {
  return (
    <SettingsSection title="General" description="Your profile, how Muse looks, and Bip.">
      <SettingsCard title="Profile" icon={<User size={16}/>}>
        <SettingsRow label="Your name" description="Used locally across your notes, calendar, and tasks.">
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
        </SettingsRow>
        <SettingsRow label="Switch user" description="Show the welcome screen again and pick a new name.">
          <button type="button" className="setting-toggle" onClick={onChangeName}>Change name</button>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title="Appearance" icon={dark ? <Moon size={16}/> : <Sun size={16}/>}>
        <SettingsRow label="Theme" description="Choose the interface theme.">
          <button type="button" className="setting-toggle" onClick={() => setDark(!dark)}>
            {dark ? <><Sun size={16}/> Light</> : <><Moon size={16}/> Dark</>}
          </button>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title="Bip" icon={<Bot size={16}/>}>
        <SettingsRow label="Show Bip the robot" description="A companion that moves around the screen and helps you.">
          <SettingsSwitch checked={showBip} onChange={setShowBip} label="Show Bip"/>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
