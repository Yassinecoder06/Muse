export type AuthMode = 'sign-in' | 'sign-up'

export type AuthCredentials = {
  name?: string
  email: string
  password: string
  confirmPassword?: string
}

/**
 * Client-side feedback for the fields that GoTrue will ultimately authenticate.
 * Credentials are never stored in the application database; Supabase Auth owns
 * the `auth.users` records and password hashing.
 */
export function validateAuthCredentials(mode: AuthMode, credentials: AuthCredentials) {
  const name = credentials.name?.trim() || ''
  const email = credentials.email.trim()
  if (mode === 'sign-up' && name.length < 2) return 'Enter the name you would like to use in Muse.'
  if (!email) return 'Enter your email address.'
  if (!/^\S+@\S+\.\S+$/.test(email)) return 'Enter a valid email address.'
  if (credentials.password.length < 6) return 'Your password must contain at least 6 characters.'
  if (mode === 'sign-up' && !credentials.confirmPassword) return 'Confirm your password.'
  if (mode === 'sign-up' && credentials.password !== credentials.confirmPassword) return 'Passwords do not match.'
  return null
}
