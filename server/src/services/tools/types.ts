import type { ToolExecutionResult } from '../agent-tools.service.js'

export type ToolRisk = 'read' | 'write' | 'external' | 'destructive'

export type ToolScope =
  | 'notes:read' | 'notes:write' | 'tasks' | 'calendar' | 'memory'
  | 'templates' | 'images' | 'research' | 'web' | 'code'

export const ALL_SCOPES: readonly ToolScope[] = ['notes:read', 'notes:write', 'tasks', 'calendar', 'memory', 'templates', 'images', 'research', 'web', 'code']

/** Scopes granted when a client does not ask for specific ones. Code and web stay opt-in. */
export const DEFAULT_SCOPES: readonly ToolScope[] = ['notes:read', 'notes:write', 'tasks', 'calendar', 'memory', 'templates', 'images', 'research']

export type ToolSurface = 'bip' | 'mcp'

export interface JSONSchema {
  type?: string
  description?: string
  enum?: unknown[]
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  additionalProperties?: boolean
  maxItems?: number
}

export interface ToolContext {
  userId: string
  timezone: string
  confirmed?: boolean
}

export interface MuseTool {
  name: string
  title: string
  description: string
  inputSchema: JSONSchema
  risk: ToolRisk
  scope: ToolScope
  surfaces: ToolSurface[]
  handler(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolExecutionResult>
}
