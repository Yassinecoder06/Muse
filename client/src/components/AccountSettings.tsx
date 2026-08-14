import { useEffect, useState } from 'react'
import { KeyRound, Mail, UserRound } from 'lucide-react'
import { supabase } from '../services/supabase'

type Props = {
  email: string
  name: string
  onUpdated: (user: { email?: string; user_metadata?: { full_name?: string } }) => void
  onMessage: (message: string) => void
}

export function AccountSettings({ email, name, onUpdated, onMessage }: Props) {
  const [nameDraft, setNameDraft] = useState(name)
  const [emailDraft, setEmailDraft] = useState(email)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState<'name' | 'email' | 'password' | null>(null)

  useEffect(() => { setNameDraft(name) }, [name])
  useEffect(() => { setEmailDraft(email) }, [email])

  async function saveName(event: React.FormEvent) {
    event.preventDefault()
    const fullName = nameDraft.trim()
    if (!fullName) return onMessage('Enter your name before saving.')
    setSaving('name')
    const { data, error } = await supabase.auth.updateUser({ data: { full_name: fullName } })
    setSaving(null)
    if (error || !data.user) return onMessage(error?.message || 'Could not update your name.')
    onUpdated(data.user)
    onMessage('Your name has been updated.')
  }

  async function saveEmail(event: React.FormEvent) {
    event.preventDefault()
    const nextEmail = emailDraft.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(nextEmail)) return onMessage('Enter a valid email address.')
    if (nextEmail === email.toLowerCase()) return onMessage('That is already your account email address.')
    setSaving('email')
    const { error } = await supabase.auth.updateUser({ email: nextEmail })
    setSaving(null)
    if (error) return onMessage(error.message)
    onMessage('Confirmation links were sent to your current and new email addresses. Check both inboxes and Spam or Junk folders.')
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault()
    if (password.length < 6) return onMessage('Use a password with at least 6 characters.')
    setSaving('password')
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(null)
    if (error) return onMessage(error.message)
    setPassword('')
    onMessage('Your password has been updated. A security notification was sent to your email; check Spam or Junk if needed.')
  }

  return <section className="account-card">
    <header><span><strong>Account</strong><small>Update the information attached to your Muse account.</small></span></header>
    <form onSubmit={saveName} className="account-form"><label><UserRound size={15}/> Name<input value={nameDraft} onChange={event => setNameDraft(event.target.value)} autoComplete="name" maxLength={120}/></label><button className="setting-save" disabled={saving !== null}>{saving === 'name' ? 'Saving…' : 'Save name'}</button></form>
    <form onSubmit={saveEmail} className="account-form"><label><Mail size={15}/> Email<input type="email" value={emailDraft} onChange={event => setEmailDraft(event.target.value)} autoComplete="email"/></label><button className="setting-save" disabled={saving !== null}>{saving === 'email' ? 'Sending…' : 'Change email'}</button></form>
    <form onSubmit={savePassword} className="account-form"><label><KeyRound size={15}/> New password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={6} placeholder="At least 6 characters"/></label><button className="setting-save" disabled={saving !== null || !password}>{saving === 'password' ? 'Saving…' : 'Update password'}</button></form>
    <p>For security, changing your email requires confirmation from both your current and new email address. If any notification is missing, check Spam or Junk.</p>
  </section>
}
