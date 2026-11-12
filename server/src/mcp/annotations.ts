import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { ToolRisk } from '../services/tools/types.js'

export type ApprovalMode = 'trust' | 'minimal' | 'standard'
export const APPROVAL_MODES: readonly ApprovalMode[] = ['trust', 'minimal', 'standard']

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === 'string' && (APPROVAL_MODES as readonly string[]).includes(value)
}

/**
 * Maps tool risk to the hints ChatGPT, Claude and Gemini use to decide whether
 * to ask before running a tool (read-only tools never ask; destructive or
 * open-world tools ask every time).
 *
 * - trust: everything is advertised read-only, so clients never ask. Muse still
 *   keeps an undo snapshot of every deletion.
 * - minimal (default): writes look safe and closed-world, so clients ask once
 *   ("Always allow"); deletions stay destructive and are confirmed every time.
 * - standard: every change is destructive and external tools are open-world;
 *   deletions additionally need approval inside Muse (enforced server-side).
 */
export function annotationsFor(risk: ToolRisk, title: string, mode: ApprovalMode): ToolAnnotations {
  if (risk === 'read' || mode === 'trust') {
    return { title, readOnlyHint: true, destructiveHint: false, idempotentHint: risk === 'read', openWorldHint: false }
  }
  if (mode === 'minimal') {
    return risk === 'destructive'
      ? { title, readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
      : { title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }
  return { title, readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: risk === 'external' }
}
