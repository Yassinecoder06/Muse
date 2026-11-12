import { createHash, timingSafeEqual } from 'node:crypto'
import type { ApprovalMode } from './internal.js'

export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')
export function constantTimeEqual(a: string, b: string) {
  const aa = Buffer.from(a)
  const bb = Buffer.from(b)
  return aa.length === bb.length && timingSafeEqual(aa, bb)
}
const listeners = new Set<(userId: string, clientId: string | null, mode: ApprovalMode) => void>()
export function onModeChange(cb: (userId: string, clientId: string | null, mode: ApprovalMode) => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
export function notifyModeChange(userId: string, clientId: string | null, mode: ApprovalMode) {
  for (const cb of listeners) cb(userId, clientId, mode)
}
