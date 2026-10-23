import { useState } from 'react'
import { KeyRound, LockKeyhole, Terminal, Check } from 'lucide-react'
import { api } from '../services/api'

export function PassphraseSettings({ onToast }: { onToast: (message: string) => void }) {
  const [activeTab, setActiveTab] = useState<'change' | 'reset'>('change')
  const [currentPassphrase, setCurrentPassphrase] = useState('')
  const [newPassphrase, setNewPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [working, setWorking] = useState(false)
  const [codeWorking, setCodeWorking] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handlePrintCode() {
    setCodeWorking(true)
    setError('')
    setSuccess('')
    try {
      await api.requestOwnerResetCode()
      setSuccess('Code printed to server logs! Check "docker logs muse-server-1" or "docker compose logs server".')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request setup code.')
    } finally {
      setCodeWorking(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (newPassphrase !== confirmPassphrase) {
      setError('The new passphrases do not match.')
      return
    }

    if (newPassphrase.length < 10) {
      setError('Passphrase must be at least 10 characters long.')
      return
    }

    setWorking(true)
    try {
      if (activeTab === 'change') {
        const res = await api.changeOwnerPassphrase(currentPassphrase, newPassphrase)
        setCurrentPassphrase('')
        setNewPassphrase('')
        setConfirmPassphrase('')
        setSuccess(res.message || 'Passphrase changed successfully.')
        onToast('Passphrase changed successfully.')
      } else {
        const res = await api.resetOwnerPassphrase(setupCode, newPassphrase)
        setSetupCode('')
        setNewPassphrase('')
        setConfirmPassphrase('')
        setSuccess(res.message || 'Passphrase reset successfully.')
        onToast('Passphrase reset successfully.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="account-card passphrase-settings">
      <header>
        <span>
          <strong><LockKeyhole size={16}/> Owner Passphrase</strong>
          <small>Manage the master passphrase used to unlock Muse on this server.</small>
        </span>
      </header>

      <div className="usage-provider-tabs" style={{ marginTop: '12px' }}>
        <button
          type="button"
          className={`usage-provider-tab ${activeTab === 'change' ? 'active' : ''}`}
          onClick={() => { setActiveTab('change'); setError(''); setSuccess('') }}
        >
          Change Passphrase
        </button>
        <button
          type="button"
          className={`usage-provider-tab ${activeTab === 'reset' ? 'active' : ''}`}
          onClick={() => { setActiveTab('reset'); setError(''); setSuccess('') }}
        >
          Reset with Setup Code
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ marginTop: '14px', display: 'grid', gap: '10px' }}>
        {activeTab === 'change' ? (
          <div>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, marginBottom: '5px', color: '#66626e' }}>
              Current Passphrase
            </label>
            <input
              type="password"
              className="setting-input"
              style={{ width: '100%' }}
              value={currentPassphrase}
              onChange={e => setCurrentPassphrase(e.target.value)}
              placeholder="Enter current passphrase"
              required
            />
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#66626e' }}>
                Setup Code (from server logs)
              </label>
              <button
                type="button"
                className="setting-toggle"
                style={{ padding: '3px 8px', fontSize: '11px' }}
                onClick={handlePrintCode}
                disabled={codeWorking}
              >
                <Terminal size={12}/> {codeWorking ? 'Logging…' : 'Print code in server log'}
              </button>
            </div>
            <div className="auth-code-row">
              <span className="auth-input" style={{ width: '100%' }}>
                <KeyRound size={15}/>
                <input
                  type="text"
                  value={setupCode}
                  onChange={e => setSetupCode(e.target.value)}
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </span>
            </div>
          </div>
        )}

        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, marginBottom: '5px', color: '#66626e' }}>
            New Passphrase (min 10 characters)
          </label>
          <input
            type="password"
            className="setting-input"
            style={{ width: '100%' }}
            value={newPassphrase}
            onChange={e => setNewPassphrase(e.target.value)}
            placeholder="At least 10 characters"
            minLength={10}
            required
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, marginBottom: '5px', color: '#66626e' }}>
            Confirm New Passphrase
          </label>
          <input
            type="password"
            className="setting-input"
            style={{ width: '100%' }}
            value={confirmPassphrase}
            onChange={e => setConfirmPassphrase(e.target.value)}
            placeholder="Re-type new passphrase"
            minLength={10}
            required
          />
        </div>

        {error && <small className="auth-message" style={{ color: '#b91c1c', borderColor: '#fca5a5', background: '#fef2f2' }}>{error}</small>}
        {success && <small className="auth-message-success">{success}</small>}

        <button
          type="submit"
          className="setting-save"
          style={{ width: '100%', marginTop: '4px', padding: '9px 12px', justifyContent: 'center' }}
          disabled={working}
        >
          {working ? 'Processing…' : activeTab === 'change' ? 'Update Passphrase' : 'Reset Passphrase'}
        </button>
      </form>
    </section>
  )
}
