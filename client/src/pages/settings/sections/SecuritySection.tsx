import { useState } from 'react'
import { Lock, LogOut, ShieldCheck } from 'lucide-react'
import { api } from '../../../services/api'
import { PassphraseSettings } from '../../../components/PassphraseSettings'
import { SettingsCard, SettingsRow, SettingsSection } from '../ui'
import './voice-security.css'

export function SecuritySection({ onToast }: { onToast: (message: string) => void }) {
  const [locking, setLocking] = useState(false)

  const handleLock = async () => {
    setLocking(true)
    try {
      await api.deleteAppSession()
    } finally {
      window.location.reload()
    }
  }

  return (
    <SettingsSection title="Security" description="Your owner passphrase, recovery access, and active session.">
      <PassphraseSettings onToast={onToast}/>

      <SettingsCard
        title="Session"
        description="Manage this browser's active owner session."
        icon={<Lock size={16}/>}
        tone="danger"
      >
        <SettingsRow
          label="Active session"
          description="Signed in as workspace owner on this device."
          icon={<ShieldCheck size={15}/>}
        >
          <span className="vs-status-pill success">
            <ShieldCheck size={13}/> Authenticated
          </span>
        </SettingsRow>

        <SettingsRow
          label="Lock Muse"
          description="Sign this browser out immediately. You'll need your master passphrase to unlock Muse again."
          icon={<LogOut size={15}/>}
        >
          <button
            type="button"
            className="vs-btn vs-btn-danger"
            onClick={() => void handleLock()}
            disabled={locking}
          >
            <LogOut size={14}/> {locking ? 'Locking…' : 'Lock now'}
          </button>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
