import { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { supabase } from '../services/supabase'
import { type AuthMode, validateAuthCredentials } from '../schemas/auth'
import { startAuthentication } from '@simplewebauthn/browser'
import { api } from '../services/api'

export function AuthPage({ recovery = false, onPasswordUpdated, onPasskeyAuthenticated }: { recovery?: boolean; onPasswordUpdated?: () => void; onPasskeyAuthenticated?: () => void }) {
  const [mode, setMode] = useState<AuthMode>(recovery ? 'reset-password' : 'sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)

  useEffect(() => { if (recovery) { setMode('reset-password'); setMessage('Choose a new password for your account.') } }, [recovery])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    const validationMessage = validateAuthCredentials(mode, { name, email, password, confirmPassword })
    if (validationMessage) { setMessage(validationMessage); return }
    setWorking(true)
    if (mode === 'forgot-password') {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
      setWorking(false)
      setMessage(error ? error.message : 'If an account uses that email, we sent a password-reset link. Check Spam or Junk too.')
      return
    }
    if (mode === 'reset-password') {
      const { error } = await supabase.auth.updateUser({ password })
      setWorking(false)
      if (error) { setMessage(error.message); return }
      setPassword(''); setConfirmPassword('')
      window.history.replaceState({}, document.title, window.location.pathname)
      setMessage('Your password has been updated.')
      onPasswordUpdated?.()
      return
    }
    const credentials = { email: email.trim(), password }
    const result = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword(credentials)
      : await supabase.auth.signUp({ ...credentials, options: { data: { full_name: name.trim() } } })
    setWorking(false)
    if (result.error) setMessage(result.error.message)
    else if (mode === 'sign-up' && result.data.user?.identities?.length === 0) setMessage('An account already uses this email. Sign in or reset your password.')
    else if (mode === 'sign-up') setMessage('Check your inbox to confirm your email before signing in. If it is not there shortly, check Spam or Junk.')
  }

  function changeMode(next: AuthMode) {
    setMode(next)
    setConfirmPassword('')
    setPassword('')
    setMessage('')
  }

  async function passkeySignIn() {
    setMessage(''); setWorking(true)
    try {
      const authentication = await api.authenticationOptions()
      const response = await startAuthentication({ optionsJSON: authentication.options })
      await api.verifyAuthentication(authentication.challengeId, response)
      onPasskeyAuthenticated?.()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Muse could not sign in with that passkey.') }
    finally { setWorking(false) }
  }

  const title = mode === 'sign-in' ? 'Welcome back' : mode === 'sign-up' ? 'Create your space' : mode === 'forgot-password' ? 'Reset your password' : 'Choose a new password'
  const submitLabel = mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : mode === 'forgot-password' ? 'Send reset link' : 'Update password'
  const showEmail = mode !== 'reset-password'
  const showPasswordField = mode !== 'forgot-password'
  const showConfirmation = mode === 'sign-up' || mode === 'reset-password'

  return <main className="auth-page"><section className="auth-card"><div className="brand"><i><span/></i> Muse</div><h1>{title}</h1><p>{mode === 'forgot-password' ? 'Enter your email and we will send a secure password-reset link.' : mode === 'reset-password' ? 'Use a new password you have not used for this account.' : 'Your notes and AI workspace are private to your account.'}</p><form onSubmit={submit}>{mode === 'sign-up' && <label>Your name<span className="auth-input"><UserRound size={17}/><input value={name} onChange={event => setName(event.target.value)} required autoComplete="name" placeholder="How should Muse greet you?"/></span></label>}{showEmail && <label>Email<span className="auth-input"><Mail size={17}/><input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com"/></span></label>}{showPasswordField && <label>{mode === 'reset-password' ? 'New password' : 'Password'}<span className="auth-input"><LockKeyhole size={17}/><input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} required minLength={6} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} placeholder="At least 6 characters"/><button type="button" className="password-visibility" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>}{showConfirmation && <label>Confirm password<span className="auth-input"><LockKeyhole size={17}/><input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required minLength={6} autoComplete="new-password" placeholder="Repeat your password"/><button type="button" className="password-visibility" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? 'Hide confirmed password' : 'Show password'} aria-pressed={showConfirmPassword}>{showConfirmPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>}{message && <small className="auth-message" role="status">{message}</small>}<button disabled={working}>{working ? 'Please wait…' : submitLabel}</button></form>{mode === 'sign-in' && <button className="auth-switch passkey-sign-in" disabled={working} onClick={() => void passkeySignIn()}><KeyRound size={16}/> Use a passkey</button>}{mode === 'sign-in' && <button className="auth-switch" onClick={() => changeMode('forgot-password')}>Forgot your password?</button>}{mode === 'sign-in' && <button className="auth-switch" onClick={() => changeMode('sign-up')}>Need an account? Sign up</button>}{mode === 'sign-up' && <button className="auth-switch" onClick={() => changeMode('sign-in')}>Already have an account? Sign in</button>}{mode === 'forgot-password' && <button className="auth-switch" onClick={() => changeMode('sign-in')}>Back to sign in</button>}{mode === 'reset-password' && <button className="auth-switch" onClick={() => changeMode('sign-in')}>Back to sign in</button>}</section></main>
}
