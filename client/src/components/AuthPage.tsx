import { useState } from 'react'
import { supabase } from '../services/supabase'

export function AuthPage() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setMessage('')
    const result = mode === 'sign-in' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password })
    setWorking(false)
    if (result.error) setMessage(result.error.message)
    else if (mode === 'sign-up') setMessage('Account created. You can now use Muse.')
  }
  return <main className="auth-page"><section className="auth-card"><div className="brand"><i><span/></i> Muse</div><h1>{mode === 'sign-in' ? 'Welcome back' : 'Create your space'}</h1><p>Your notes and AI workspace are private to your account.</p><form onSubmit={submit}><label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email"/></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={6} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}/></label>{message && <small className="auth-message">{message}</small>}<button disabled={working}>{working ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button></form><button className="auth-switch" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage('') }}>{mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}</button></section></main>
}
