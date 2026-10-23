import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, LockKeyhole, Terminal } from 'lucide-react'
import { api, AUTH_REQUIRED_EVENT } from '../services/api'

type GateState = 'loading' | 'setup' | 'login' | 'ready' | 'offline'
type LoginMode = 'unlock' | 'change' | 'reset'

// Muse is single-owner: the API only answers requests carrying the owner's
// session cookie (or a paired phone's device token). This gate shows the
// first-run setup or the unlock form until that cookie exists.
export function OwnerGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<GateState>('loading')
  const [loginMode, setLoginMode] = useState<LoginMode>('unlock')
  const [currentPassphrase, setCurrentPassphrase] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [message, setMessage] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [working, setWorking] = useState(false)
  const [codeWorking, setCodeWorking] = useState(false)

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

  function switchMode(newMode: LoginMode) {
    setLoginMode(newMode)
    setMessage('')
    setSuccessMsg('')
    setPassphrase('')
    setConfirm('')
    setCurrentPassphrase('')
    setSetupCode('')
  }

  async function handlePrintCode() {
    setCodeWorking(true)
    setMessage('')
    setSuccessMsg('')
    try {
      await api.requestOwnerResetCode()
      setSuccessMsg('Setup code logged! View it in "docker logs muse-server-1" or "docker compose logs server".')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not request setup code.')
    } finally {
      setCodeWorking(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    setSuccessMsg('')

    if (state === 'setup' && passphrase !== confirm) {
      setMessage('The passphrases do not match.')
      return
    }

    if ((loginMode === 'change' || loginMode === 'reset') && passphrase !== confirm) {
      setMessage('The new passphrases do not match.')
      return
    }

    setWorking(true)
    try {
      if (state === 'setup') {
        await api.setupOwner(passphrase, setupCode)
      } else if (loginMode === 'change') {
        await api.changeOwnerPassphrase(currentPassphrase, passphrase)
      } else if (loginMode === 'reset') {
        await api.resetOwnerPassphrase(setupCode, passphrase)
      } else {
        await api.loginOwner(passphrase)
      }

      setPassphrase('')
      setConfirm('')
      setCurrentPassphrase('')
      setSetupCode('')
      setLoginMode('unlock')
      setState('ready')
      await queryClient.invalidateQueries()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Muse could not authenticate.')
    } finally { setWorking(false) }
  }

  if (state === 'ready') return <>{children}</>
  if (state === 'loading') return <div className="app-loading"><div className="loader"/>Opening Muse</div>
  if (state === 'offline') return <div className="app-loading">Muse API is not reachable. <button onClick={() => void check()}>Retry</button></div>

  const setup = state === 'setup'
  const isReset = !setup && loginMode === 'reset'
  const isChange = !setup && loginMode === 'change'

  return <main className="vault-page">
    <section className="vault-card unlock-card">
      <div className="brand"><i><span/></i> Muse</div>
      <div className="vault-icon"><LockKeyhole size={24}/></div>

      <h1>
        {setup
          ? 'Protect your Muse'
          : isChange
          ? 'Change Passphrase'
          : isReset
          ? 'Reset Passphrase'
          : 'Unlock Muse'}
      </h1>

      <p>
        {setup
          ? 'Choose a passphrase. Anyone on your network who opens Muse will need it to see your notes. Paired phones keep working with their own device keys.'
          : isChange
          ? 'Enter your current owner passphrase, then choose a new one.'
          : isReset
          ? 'Enter the setup code printed in the Muse server log to choose a new passphrase.'
          : 'Enter your owner passphrase to open your notes.'}
      </p>

      <form onSubmit={submit}>
        {/* Setup code for initial setup or reset */}
        {(setup || isReset) && (
          <label>
            Setup code
            <small>
              Printed in the Muse server log (<Terminal size={11}/> <code>docker compose logs server</code> or <code>docker logs muse-server-1</code>).
            </small>
            <div className="auth-code-row">
              <span className="auth-input">
                <KeyRound size={17}/>
                <input
                  value={setupCode}
                  onChange={event => setSetupCode(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="XXXX-XXXX"
                  required
                />
              </span>
              {isReset && (
                <button
                  type="button"
                  onClick={handlePrintCode}
                  disabled={codeWorking}
                  title="Print a fresh setup code to the server log"
                >
                  <Terminal size={13}/> {codeWorking ? 'Logging…' : 'Print code in log'}
                </button>
              )}
            </div>
          </label>
        )}

        {/* Current passphrase for change mode */}
        {isChange && (
          <label>Current Passphrase
            <span className="auth-input">
              <LockKeyhole size={17}/>
              <input
                type="password"
                value={currentPassphrase}
                onChange={event => setCurrentPassphrase(event.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </span>
          </label>
        )}

        {/* Passphrase (new for setup/change/reset, normal for unlock) */}
        <label>
          {isChange || isReset ? 'New Passphrase' : 'Passphrase'}
          <span className="auth-input">
            <LockKeyhole size={17}/>
            <input
              type="password"
              value={passphrase}
              onChange={event => setPassphrase(event.target.value)}
              autoComplete={setup || isChange || isReset ? 'new-password' : 'current-password'}
              minLength={setup || isChange || isReset ? 10 : 1}
              autoFocus={!isChange}
              required
            />
          </span>
        </label>

        {/* Confirm passphrase for setup/change/reset */}
        {(setup || isChange || isReset) && (
          <label>Confirm {isChange || isReset ? 'new ' : ''}passphrase
            <span className="auth-input">
              <LockKeyhole size={17}/>
              <input
                type="password"
                value={confirm}
                onChange={event => setConfirm(event.target.value)}
                autoComplete="new-password"
                minLength={10}
                required
              />
            </span>
          </label>
        )}

        {message && <small className="auth-message" role="status">{message}</small>}
        {successMsg && <small className="auth-message-success" role="status">{successMsg}</small>}

        <button disabled={working}>
          {working
            ? 'Please wait…'
            : setup
            ? 'Set passphrase'
            : isChange
            ? 'Change passphrase'
            : isReset
            ? 'Reset passphrase'
            : 'Unlock'}
        </button>

        {/* Navigation links when not in first-time setup */}
        {!setup && (
          <div className="auth-links-row">
            {loginMode === 'unlock' ? (
              <>
                <button type="button" className="auth-link-btn" onClick={() => switchMode('reset')}>
                  Forgot passphrase?
                </button>
                <button type="button" className="auth-link-btn" onClick={() => switchMode('change')}>
                  Change passphrase
                </button>
              </>
            ) : loginMode === 'change' ? (
              <>
                <button type="button" className="auth-link-btn" onClick={() => switchMode('unlock')}>
                  ← Back to Unlock
                </button>
                <button type="button" className="auth-link-btn" onClick={() => switchMode('reset')}>
                  Forgot current passphrase?
                </button>
              </>
            ) : (
              <>
                <button type="button" className="auth-link-btn" onClick={() => switchMode('unlock')}>
                  ← Back to Unlock
                </button>
                <button type="button" className="auth-link-btn" onClick={() => switchMode('change')}>
                  Know current passphrase?
                </button>
              </>
            )}
          </div>
        )}
      </form>
    </section>
  </main>
}
