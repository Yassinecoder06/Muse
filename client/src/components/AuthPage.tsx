import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { supabase } from '../services/supabase'
import { type AuthMode, validateAuthCredentials } from '../schemas/auth'

export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    const validationMessage = validateAuthCredentials(mode, { name, email, password, confirmPassword })
    if (validationMessage) { setMessage(validationMessage); return }
    setWorking(true)
    const credentials = { email: email.trim(), password }
    const result = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword(credentials)
      : await supabase.auth.signUp({ ...credentials, options: { data: { full_name: name.trim() } } })
    setWorking(false)
    if (result.error) setMessage(result.error.message)
    else if (mode === 'sign-up') setMessage('Account created. You can now use Muse.')
  }

  function changeMode() {
    setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
    setConfirmPassword('')
    setMessage('')
  }

  return <main className="auth-page"><section className="auth-card"><div className="brand"><i><span/></i> Muse</div><h1>{mode === 'sign-in' ? 'Welcome back' : 'Create your space'}</h1><p>Your notes and AI workspace are private to your account.</p><form onSubmit={submit}>{mode === 'sign-up' && <label>Your name<span className="auth-input"><UserRound size={17}/><input value={name} onChange={event => setName(event.target.value)} required autoComplete="name" placeholder="How should Muse greet you?"/></span></label>}<label>Email<span className="auth-input"><Mail size={17}/><input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" placeholder="you@example.com"/></span></label><label>Password<span className="auth-input"><LockKeyhole size={17}/><input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} required minLength={6} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} placeholder="At least 6 characters"/><button type="button" className="password-visibility" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>{mode === 'sign-up' && <label>Confirm password<span className="auth-input"><LockKeyhole size={17}/><input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required minLength={6} autoComplete="new-password" placeholder="Repeat your password"/><button type="button" className="password-visibility" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'} aria-pressed={showConfirmPassword}>{showConfirmPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>}{message && <small className="auth-message" role="status">{message}</small>}<button disabled={working}>{working ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button></form><button className="auth-switch" onClick={changeMode}>{mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}</button></section></main>
}
