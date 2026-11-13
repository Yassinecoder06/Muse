import { useState } from 'react'
import { AlertCircle, Check, CheckCircle2, Eye, EyeOff, KeyRound, Lock, Terminal } from 'lucide-react'
import { api } from '../services/api'
import { SettingsCard, SettingsRow } from '../pages/settings/ui'

export function PassphraseSettings({ onToast }: { onToast: (message: string) => void }) {
  const [activeTab, setActiveTab] = useState<'change' | 'reset'>('change')
  const [currentPassphrase, setCurrentPassphrase] = useState('')
  const [newPassphrase, setNewPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [setupCode, setSetupCode] = useState('')

  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [working, setWorking] = useState(false)
  const [codeWorking, setCodeWorking] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const switchTab = (tab: 'change' | 'reset') => {
    setActiveTab(tab)
    setError('')
    setSuccess('')
  }

  async function handlePrintCode() {
    setCodeWorking(true)
    setError('')
    setSuccess('')
    try {
      await api.requestOwnerResetCode()
      setSuccess('Code printed to server logs! Check "docker compose logs server" or "docker logs muse-server-1".')
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
        const msg = res.message || 'Passphrase changed successfully.'
        setSuccess(msg)
        onToast(msg)
      } else {
        const res = await api.resetOwnerPassphrase(setupCode, newPassphrase)
        setSetupCode('')
        setNewPassphrase('')
        setConfirmPassphrase('')
        const msg = res.message || 'Passphrase reset successfully.'
        setSuccess(msg)
        onToast(msg)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed.')
    } finally {
      setWorking(false)
    }
  }

  const isMinLength = newPassphrase.length >= 10
  const hasTypedNew = newPassphrase.length > 0
  const hasTypedConfirm = confirmPassphrase.length > 0
  const passwordsMatch = hasTypedConfirm && newPassphrase === confirmPassphrase
  const passwordsMismatch = hasTypedConfirm && newPassphrase !== confirmPassphrase

  return (
    <SettingsCard
      title="Owner passphrase"
      description="The owner passphrase unlocks Muse on this server and confirms connected-app access."
      icon={<KeyRound size={16}/>}
    >
      <div className="vs-tabs-bar">
        <div className="vs-segmented" role="tablist" aria-label="Passphrase actions">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'change'}
            className={`vs-segmented-btn ${activeTab === 'change' ? 'active' : ''}`}
            onClick={() => switchTab('change')}
          >
            <KeyRound size={13}/> Change passphrase
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'reset'}
            className={`vs-segmented-btn ${activeTab === 'reset' ? 'active' : ''}`}
            onClick={() => switchTab('reset')}
          >
            <Terminal size={13}/> Reset with recovery code
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate={false}>
        {activeTab === 'change' ? (
          <SettingsRow
            label="Current passphrase"
            description="Enter your existing owner passphrase to verify ownership."
            icon={<Lock size={15}/>}
          >
            <div className="vs-input-wrap">
              <input
                type={showCurrent ? 'text' : 'password'}
                className="vs-input"
                value={currentPassphrase}
                onChange={e => { setCurrentPassphrase(e.target.value); setError('') }}
                placeholder="Current passphrase"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="vs-input-eye"
                onClick={() => setShowCurrent(!showCurrent)}
                aria-label={showCurrent ? 'Hide current passphrase' : 'Show current passphrase'}
              >
                {showCurrent ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
          </SettingsRow>
        ) : (
          <SettingsRow
            label="Recovery code"
            description={
              <span>
                One-time code generated in your server logs.
                <span className="vs-terminal-hint">
                  <Terminal size={12}/> Run <code>docker compose logs server</code> or <code>docker logs muse-server-1</code>.
                </span>
              </span>
            }
            icon={<Terminal size={15}/>}
          >
            <div className="vs-code-row">
              <div className="vs-input-wrap">
                <input
                  type="text"
                  className="vs-input vs-code-input"
                  value={setupCode}
                  onChange={e => { setSetupCode(e.target.value); setError('') }}
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </div>
              <button
                type="button"
                className="vs-btn vs-btn-secondary"
                onClick={handlePrintCode}
                disabled={codeWorking}
                title="Print a fresh setup code into your server container logs"
              >
                <Terminal size={14}/>
                {codeWorking ? 'Printing…' : 'Print code in log'}
              </button>
            </div>
          </SettingsRow>
        )}

        <SettingsRow
          label="New passphrase"
          description={
            <span>
              Must be at least 10 characters long.
              {hasTypedNew && (
                <span className={`vs-validation-inline ${isMinLength ? 'valid' : 'invalid'}`}>
                  {isMinLength ? '✓ Length OK' : `(${newPassphrase.length}/10 chars)`}
                </span>
              )}
            </span>
          }
          icon={<KeyRound size={15}/>}
        >
          <div className="vs-input-wrap">
            <input
              type={showNew ? 'text' : 'password'}
              className="vs-input"
              value={newPassphrase}
              onChange={e => { setNewPassphrase(e.target.value); setError('') }}
              placeholder="At least 10 characters"
              minLength={10}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              className="vs-input-eye"
              onClick={() => setShowNew(!showNew)}
              aria-label={showNew ? 'Hide new passphrase' : 'Show new passphrase'}
            >
              {showNew ? <EyeOff size={14}/> : <Eye size={14}/>}
            </button>
          </div>
        </SettingsRow>

        <SettingsRow
          label="Confirm new passphrase"
          description={
            <span>
              Re-type your new passphrase to ensure no typos.
              {hasTypedConfirm && (
                <span className={`vs-validation-inline ${passwordsMatch ? 'valid' : 'invalid'}`}>
                  {passwordsMatch ? '✓ Passphrases match' : '✕ Passphrases do not match'}
                </span>
              )}
            </span>
          }
          icon={<Check size={15}/>}
        >
          <div className="vs-input-wrap">
            <input
              type={showConfirm ? 'text' : 'password'}
              className="vs-input"
              value={confirmPassphrase}
              onChange={e => { setConfirmPassphrase(e.target.value); setError('') }}
              placeholder="Confirm new passphrase"
              minLength={10}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              className="vs-input-eye"
              onClick={() => setShowConfirm(!showConfirm)}
              aria-label={showConfirm ? 'Hide confirm passphrase' : 'Show confirm passphrase'}
            >
              {showConfirm ? <EyeOff size={14}/> : <Eye size={14}/>}
            </button>
          </div>
        </SettingsRow>

        {error && (
          <div className="vs-alert vs-alert-error" role="alert">
            <AlertCircle size={15}/>
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="vs-alert vs-alert-success" role="status">
            <CheckCircle2 size={15}/>
            <span>{success}</span>
          </div>
        )}

        <div className="vs-form-footer">
          <span className="vs-form-footer-hint">
            {activeTab === 'change'
              ? 'You will need the new passphrase the next time you unlock Muse.'
              : 'Submitting a valid setup code overwrites the owner passphrase.'}
          </span>
          <button
            type="submit"
            className="vs-btn vs-btn-primary"
            disabled={working || (hasTypedConfirm && passwordsMismatch)}
          >
            <Check size={14}/>
            {working ? 'Saving…' : activeTab === 'change' ? 'Update passphrase' : 'Reset passphrase'}
          </button>
        </div>
      </form>
    </SettingsCard>
  )
}
