declare global {
  namespace Express { interface Request { userId?: string; userEmail?: string; authMethod?: 'session' | 'supabase' | 'device' } }
}
export {}
