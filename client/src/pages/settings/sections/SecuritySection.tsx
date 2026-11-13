import { Lock } from 'lucide-react'
import { api } from '../../../services/api'
import { PassphraseSettings } from '../../../components/PassphraseSettings'
import { SettingsCard, SettingsRow, SettingsSection } from '../ui'

export function SecuritySection({ onToast }: { onToast: (message: string) => void }) {
  return (
    <SettingsSection title="Security" description="Your owner passphrase and this browser's session.">
      <PassphraseSettings onToast={onToast}/>
      <SettingsCard title="Session" icon={<Lock size={16}/>}>
        <SettingsRow label="Lock Muse" description="Sign this browser out. You'll need your passphrase to get back in.">
          <button type="button" className="setting-remove" onClick={() => { void api.deleteAppSession().finally(() => window.location.reload()) }}>
            Lock now
          </button>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
