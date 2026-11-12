declare global {
  namespace Express { interface Request { userId?: string; userEmail?: string; authMethod?: 'session' | 'supabase' } }
}
export {}
