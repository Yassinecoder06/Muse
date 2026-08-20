import { supabase } from '../supabase/client.js'
import { encryptIfPresent } from '../utils/crypto.js'

// One-time, idempotent backfill: encrypts any user text that is still stored in
// plaintext. Rows already carrying the v1: prefix are skipped, so the script can
// be re-run safely. Run with: npx tsx src/scripts/backfill-encrypt.ts

const PAGE = 500
let total = 0

async function encryptColumn(table: string, column: string) {
  let offset = 0
  let changed = 0
  for (;;) {
    const { data, error } = await supabase.from(table).select(`id,user_id,${column}`).range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || !data.length) break
    for (const raw of data) {
      const row = raw as unknown as Record<string, string | null | undefined>
      const value = row[column]
      const encrypted = encryptIfPresent(String(row.user_id), value)
      if (typeof value === 'string' && value && encrypted !== value) {
        const { error: updateError } = await supabase.from(table).update({ [column]: encrypted }).eq('id', row.id)
        if (updateError) throw updateError
        changed++
      }
    }
    if (data.length < PAGE) break
    offset += PAGE
  }
  total += changed
  console.log(`[${table}.${column}] encrypted ${changed} rows`)
}

async function main() {
  await encryptColumn('notes', 'title')
  await encryptColumn('notes', 'content')
  await encryptColumn('notes', 'summary')
  await encryptColumn('research_documents', 'content')
  await encryptColumn('research_artifacts', 'content')
  console.log(`backfill complete: ${total} values encrypted`)
  const { count: leftover, error } = await supabase.from('notes').select('id', { count: 'exact', head: true }).not('content', 'is', null)
  if (error) throw error
  console.log(`notes with non-null content: ${leftover}`)
}

main().catch(error => { console.error(error); process.exit(1) })