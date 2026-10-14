import { Download, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { api } from '../services/api'
import { createVaultCheck, generateRecoveryKey, saveRecoveryKey } from '../services/vault'

export function SecureVaultSetup({ userId, onComplete }: { userId: string; onComplete: () => Promise<void> | void }) {
  const [recoveryKey, setRecoveryKey] = useState(() => generateRecoveryKey())
  const [confirmation, setConfirmation] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [addPasskey, setAddPasskey] = useState(false)
  const [deviceName, setDeviceName] = useState('This device')
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const suffix = useMemo(() => recoveryKey.slice(-6), [recoveryKey])

  function downloadRecoveryKey() {
    const blob = new Blob([`Muse Secure Vault recovery key\n\n${recoveryKey}\n\nKeep this key private. Muse cannot recover it.\n`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = 'muse-recovery-key.txt'; link.click()
    URL.revokeObjectURL(url)
  }

  async function setup(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    if (confirmation.trim() !== suffix) return setMessage(`Enter the final six characters: ${suffix}`)
    if (!apiKey.trim()) return setMessage('Enter your Ollama API key to complete Secure Vault setup.')
    setWorking(true)
    try {
      await saveRecoveryKey(userId, recoveryKey)
      await api.saveApiKey(apiKey.trim())
      const vaultCheck = await createVaultCheck(userId)
      if (addPasskey) {
        const registration = await api.registrationOptions()
        const response = await startRegistration({ optionsJSON: registration.options })
        await api.verifyRegistration(registration.challengeId, response, deviceName.trim() || 'This device')
      }
      await api.setupVault(vaultCheck)
      await onComplete()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Muse could not set up your Secure Vault.') }
    finally { setWorking(false) }
  }

  return <main className="vault-page"><section className="vault-card"><div className="brand"><i><span/></i> Muse</div><div className="vault-icon"><ShieldCheck size={24}/></div><h1>Secure your vault</h1><p>Save your recovery key before adding private notes. It is required to decrypt your vault on a new device. A passkey is optional.</p><form onSubmit={setup}>
    <label>Recovery AES key <span className="vault-key-row"><input value={recoveryKey} onChange={event => setRecoveryKey(event.target.value.trim())} autoComplete="off" spellCheck={false}/><button type="button" title="Download recovery key" onClick={downloadRecoveryKey}><Download size={16}/> Save</button></span></label>
    <p className="vault-warning"><LockKeyhole size={15}/> Save this recovery key somewhere safe. Muse cannot recover it, email it, or store it in the cloud for you.</p>
    <label>Confirm the last six characters: <strong>{suffix}</strong><input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" placeholder="Last six characters" required/></label>
    <label>Ollama API key <small>stored in Muse’s server Vault; it is required to finish setup</small><span className="auth-input"><KeyRound size={17}/><input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" placeholder="ollama-…" required/></span></label>
    <label className="vault-passkey-option"><span>Passkey <small>optional: use your device’s fingerprint, face, or screen lock to sign in faster</small></span><span className="vault-checkbox"><input type="checkbox" checked={addPasskey} onChange={event => setAddPasskey(event.target.checked)}/> Add a passkey on this device</span></label>
    {addPasskey && <label>Passkey name<input value={deviceName} onChange={event => setDeviceName(event.target.value)} maxLength={80}/></label>}
    {message && <small className="auth-message" role="status">{message}</small>}
    <button disabled={working}>{working ? 'Securing your vault…' : addPasskey ? 'Save key and create passkey' : 'Save recovery key'}</button>
  </form></section></main>
}
