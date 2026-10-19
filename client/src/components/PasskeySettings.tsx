import { KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { api, type Passkey } from '../services/api'
import { ConfirmModal } from './ConfirmModal'

export function PasskeySettings({ onMessage }: { onMessage: (message: string) => void }) {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<Passkey | null>(null)

  async function refresh() { try { setPasskeys(await api.listPasskeys()) } catch { setError('Could not load your passkeys.') } }
  useEffect(() => { void refresh() }, [])
  async function add() {
    setError(''); setWorking(true)
    try {
      const registration = await api.registrationOptions()
      const response = await startRegistration({ optionsJSON: registration.options })
      await api.verifyRegistration(registration.challengeId, response, 'Additional device')
      await refresh(); onMessage('Passkey added.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add this passkey.') }
    finally { setWorking(false) }
  }
  async function handleConfirmRevoke(passkey: Passkey) {
    setRevokeTarget(null)
    try { await api.revokePasskey(passkey.id); await refresh(); onMessage('Passkey revoked.') } catch { setError('Could not revoke this passkey.') }
  }
  return (
    <>
      <section className="account-card passkey-settings">
        <header>
          <span>
            <strong><ShieldCheck size={16}/> Devices & Security</strong>
            <small>Each device can have its own passkey. Your recovery key is still required to unlock a new device.</small>
          </span>
          <button className="setting-save" onClick={() => void add()} disabled={working}>
            <Plus size={15}/>{working ? 'Adding…' : 'Add passkey'}
          </button>
        </header>
        {error && <p className="setting-error">{error}</p>}
        <ul>
          {passkeys.length ? passkeys.map(passkey => (
            <li key={passkey.id}>
              <span>
                <KeyRound size={15}/>
                <span>
                  <strong>{passkey.name}</strong>
                  <small>{passkey.last_used_at ? `Last used ${new Date(passkey.last_used_at).toLocaleDateString()}` : `Added ${new Date(passkey.created_at).toLocaleDateString()}`}{passkey.backed_up ? ' · Synced passkey' : ''}</small>
                </span>
              </span>
              <button title="Revoke passkey" onClick={() => setRevokeTarget(passkey)}>
                <Trash2 size={15}/>
              </button>
            </li>
          )) : <li className="passkey-empty">No passkeys are registered yet.</li>}
        </ul>
      </section>

      {revokeTarget && (
        <ConfirmModal
          isOpen={true}
          title="Revoke Passkey"
          message={`Revoke “${revokeTarget.name}”? That device will no longer be able to sign in with this passkey.`}
          confirmText="Revoke passkey"
          danger={true}
          onConfirm={() => void handleConfirmRevoke(revokeTarget)}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </>
  )
}

