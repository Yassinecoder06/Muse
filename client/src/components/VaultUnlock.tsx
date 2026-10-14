import { KeyRound, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { saveRecoveryKey, verifyVaultCheck } from '../services/vault'

export function VaultUnlock({ userId, vaultCheck, onUnlocked }: { userId: string; vaultCheck: string; onUnlocked: () => Promise<void> | void }) {
  const [recoveryKey, setRecoveryKey] = useState('')
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  async function unlock(event: React.FormEvent) {
    event.preventDefault(); setMessage(''); setWorking(true)
    try { await saveRecoveryKey(userId, recoveryKey); await verifyVaultCheck(userId, vaultCheck); await onUnlocked() }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Muse could not unlock this vault.') }
    finally { setWorking(false) }
  }
  return <main className="vault-page"><section className="vault-card unlock-card"><div className="brand"><i><span/></i> Muse</div><div className="vault-icon"><LockKeyhole size={24}/></div><h1>Unlock your vault</h1><p>This device needs your recovery AES key to decrypt your Muse data. If you do not have it, Muse cannot recover the vault.</p><form onSubmit={unlock}><label>Recovery AES key<span className="auth-input"><KeyRound size={17}/><input value={recoveryKey} onChange={event => setRecoveryKey(event.target.value.trim())} autoComplete="off" spellCheck={false} placeholder="Paste your saved recovery key" required/></span></label>{message && <small className="auth-message" role="status">{message}</small>}<button disabled={working}>{working ? 'Unlocking…' : 'Unlock Secure Vault'}</button></form></section></main>
}
