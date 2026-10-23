import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  (typeof window !== 'undefined' && window.location.origin)
    ? window.location.origin
    : ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || 'http://localhost:8080')
const supabaseAnonKey =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjE3ODY0NjM5MTcsImV4cCI6MjEwMTgyNDUxN30.hw3neQhuzgepbhTMt9zM_l534cF6zf__djPYO9m6j80'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
