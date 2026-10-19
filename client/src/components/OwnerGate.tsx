import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, LockKeyhole, Terminal } from 'lucide-react'
import { api, AUTH_REQUIRED_EVENT } from '../services/api'

type GateState = 'loading' | 'setup' | 'login' | 'ready' | 'offline'

// Muse is single-owner: the API only answers requests carrying the owner's
// session cookie (or a paired phone's device token). This gate shows the
// first-run setup or the unlock form until that cookie exists.
export function OwnerGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<GateState>('loading')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)

  async function check() {
    try {
      const status = await api.ownerStatus()
      setState(!status.configured ? 'setup' : status.authenticated ? 'ready' : 'login')
    } catch { setState('offline') }
  }

  useEffect(() => {
    void check()
    const onAuthRequired = () => setState(current => current === 'ready' ? 'login' : current)
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    if (state === 'setup' && passphrase !== confirm) { setMessage('The passphrases do not match.'); return }
    setWorking(true)
    try {
      if (state === 'setup') await api.setupOwner(passphrase, setupCode)
      else await api.loginOwner(passphrase)
      setPassphrase(''); setConfirm(''); setSetupCode('')
      setState('ready')
      await queryClient.invalidateQueries()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Muse could not unlock.')
    } finally { setWorking(false) }
  }

  if (state === 'ready') return <>{children}</>
  if (state === 'loading') return <div className="app-loading"><div className="loader"/>Opening Muse</div>
  if (state === 'offline') return <div className="app-loading">Muse API is not reachable. <button onClick={() => void check()}>Retry</button></div>

  const setup = state === 'setup'
  return <main className="vault-page">
    <section className="vault-card unlock-card">
      <div className="brand"><i><span/></i> Muse</div>
      <div className="vault-icon"><LockKeyhole size={24}/></div>
      <h1>{setup ? 'Protect your Muse' : 'Unlock Muse'}</h1>
      <p>{setup
        ? 'Choose a passphrase. Anyone on your network who opens Muse will need it to see your notes. Paired phones keep working with their own device keys.'
        : 'Enter your owner passphrase to open your notes.'}</p>
      <form onSubmit={submit}>
        {setup && <label>Setup code<small>Printed in the Muse server log (<Terminal size={11}/> <code>docker compose logs server</code> or your <code>npm run dev</code> terminal).</small>
          <span className="auth-input"><KeyRound size={17}/><input value={setupCode} onChange={event => setSetupCode(event.target.value)} autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX" required/></span>
        </label>}
        <label>Passphrase
          <span className="auth-input"><LockKeyhole size={17}/><input type="password" value={passphrase} onChange={event => setPassphrase(event.target.value)} autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 10 : 1} autoFocus required/></span>
        </label>
        {setup && <label>Confirm passphrase
          <span className="auth-input"><LockKeyhole size={17}/><input type="password" value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" minLength={10} required/></span>
        </label>}
        {message && <small className="auth-message" role="status">{message}</small>}
        <button disabled={working}>{working ? 'Please wait…' : setup ? 'Set passphrase' : 'Unlock'}</button>
      </form>
    </section>
  </main>
}
