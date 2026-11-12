import { agentToolDeclarations, executeAgentTool, type ToolExecutionResult } from '../agent-tools.service.js'
import { jobs as aiJobs } from '../ai-job.service.js'
import { getJob, jobView, settleWithin, startJob } from './jobs.js'
import { normalizeSchema, objectSchema } from './schema.js'
import type { JSONSchema, MuseTool, ToolContext, ToolRisk, ToolScope } from './types.js'

// Single source of truth for what Muse can do. Bip keeps calling
// executeAgentTool directly; MCP clients go through these entries, which add
// risk (drives approval behaviour) and scope (drives token permissions).

interface ToolMeta { title: string; risk: ToolRisk; scope: ToolScope; mcp?: boolean }

const META: Record<string, ToolMeta> = {
  create_note: { title: 'Create note', risk: 'write', scope: 'notes:write' },
  update_note: { title: 'Update note', risk: 'write', scope: 'notes:write' },
  search_notes: { title: 'Search notes', risk: 'read', scope: 'notes:read' },
  read_note: { title: 'Read note', risk: 'read', scope: 'notes:read' },
  search_web: { title: 'Search the web', risk: 'external', scope: 'web' },
  calculate: { title: 'Calculate', risk: 'read', scope: 'notes:read' },
  execute_code: { title: 'Run code in sandbox', risk: 'external', scope: 'code' },
  create_task: { title: 'Create task', risk: 'write', scope: 'tasks' },
  list_tasks: { title: 'List tasks', risk: 'read', scope: 'tasks' },
  update_task: { title: 'Update task', risk: 'write', scope: 'tasks' },
  create_calendar_event: { title: 'Create calendar event', risk: 'write', scope: 'calendar' },
  list_calendar_events: { title: 'List calendar events', risk: 'read', scope: 'calendar' },
  save_memory: { title: 'Save memory', risk: 'write', scope: 'memory' },
  get_memories: { title: 'Get memories', risk: 'read', scope: 'memory' },
  list_specialized_templates: { title: 'List templates', risk: 'read', scope: 'templates' },
  create_specialized_template: { title: 'Create template', risk: 'write', scope: 'templates' },
  create_specialized_note: { title: 'Create note from template', risk: 'write', scope: 'templates' },
  trash_note: { title: 'Move note to trash', risk: 'write', scope: 'notes:write' },
  permanently_delete_note: { title: 'Delete note forever', risk: 'destructive', scope: 'notes:write' },
  empty_trash: { title: 'Empty trash', risk: 'destructive', scope: 'notes:write' },
  delete_task: { title: 'Delete task', risk: 'destructive', scope: 'tasks' },
  delete_calendar_event: { title: 'Delete calendar event', risk: 'destructive', scope: 'calendar' },
  delete_memory: { title: 'Delete memory', risk: 'destructive', scope: 'memory' },
  delete_specialized_template: { title: 'Delete template', risk: 'destructive', scope: 'templates' },
  delete_chat_session: { title: 'Delete Bip conversation', risk: 'destructive', scope: 'memory' },
  generate_image: { title: 'Generate image', risk: 'external', scope: 'images' },
  edit_image: { title: 'Edit image', risk: 'external', scope: 'images' }
}

/** How long a slow tool may block before it hands back a job id (Gemini cuts calls at ~8 s). */
export const JOB_WAIT_MS = 6_000
const SLOW_TOOLS = new Set(['generate_image', 'edit_image'])
export const MAX_BATCH_TASKS = 25

function run(name: string) {
  return (ctx: ToolContext, args: Record<string, unknown>) =>
    executeAgentTool(ctx.userId, name, args, { timezone: ctx.timezone, confirmed: ctx.confirmed })
}

function asJob(name: string) {
  return async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const job = startJob(ctx.userId, name, async () => {
      const execution = await executeAgentTool(ctx.userId, name, args, { timezone: ctx.timezone })
      if (execution.error) throw new Error(execution.error)
      return execution.result
    })
    const settled = await settleWithin(job, JOB_WAIT_MS)
    return { toolName: name, args, result: settled.status === 'done' ? settled.result ?? {} : jobView(settled), error: settled.error }
  }
}

function fromDeclaration(declaration: (typeof agentToolDeclarations)[number]): MuseTool {
  const meta = META[declaration.name]
  if (!meta) throw new Error(`Tool "${declaration.name}" has no registry metadata. Add it to META in services/tools/registry.ts.`)
  return {
    name: declaration.name,
    title: meta.title,
    description: declaration.description,
    inputSchema: objectSchema(normalizeSchema(declaration.parameters)),
    risk: meta.risk,
    scope: meta.scope,
    surfaces: ['bip', 'mcp'],
    handler: SLOW_TOOLS.has(declaration.name) ? asJob(declaration.name) : run(declaration.name)
  }
}

const taskItemSchema: JSONSchema = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'What needs to be done' },
    due_date: { type: 'string', description: 'Due date, natural language or YYYY-MM-DD (e.g. "tomorrow")' },
    due_time: { type: 'string', description: 'Due time, e.g. "15:00" or "3pm"' },
    priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    remind_minutes_before: { type: 'number', description: 'Remind this many minutes before the due time' }
  },
  required: ['text']
}

const mcpOnlyTools: MuseTool[] = [
  {
    name: 'create_tasks',
    title: 'Create several tasks',
    description: `Create up to ${MAX_BATCH_TASKS} tasks in one call. Prefer this over repeated create_task calls.`,
    inputSchema: { type: 'object', properties: { tasks: { type: 'array', items: taskItemSchema, maxItems: MAX_BATCH_TASKS } }, required: ['tasks'] },
    risk: 'write',
    scope: 'tasks',
    surfaces: ['mcp'],
    async handler(ctx, args) {
      const items = Array.isArray(args.tasks) ? args.tasks.slice(0, MAX_BATCH_TASKS) : []
      if (!items.length) throw new Error('Provide at least one task in "tasks".')
      const results = []
      for (const item of items) {
        const execution = await executeAgentTool(ctx.userId, 'create_task', item as Record<string, unknown>, { timezone: ctx.timezone })
        results.push({ text: (item as Record<string, unknown>).text, ok: !execution.error, ...(execution.error ? { error: execution.error } : { id: execution.result.id }) })
      }
      return { toolName: 'create_tasks', args, result: { created: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, tasks: results } }
    }
  },
  {
    name: 'start_research',
    title: 'Start research report',
    description: 'Start a multi-stage web research report on a topic. Runs in the background and saves a research note; poll get_job_status with the returned job_id.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'What to research' },
        depth: { type: 'string', enum: ['concise', 'standard', 'in-depth'] },
        objective: { type: 'string', description: 'What the report should help decide or explain' }
      },
      required: ['topic']
    },
    risk: 'external',
    scope: 'research',
    surfaces: ['mcp'],
    async handler(ctx, args) {
      const topic = String(args.topic ?? '').trim().slice(0, 500)
      if (!topic) throw new Error('A research topic is required.')
      const job = await aiJobs.enqueue(ctx.userId, null, 'research', { topic, depth: args.depth, objective: args.objective })
      return { toolName: 'start_research', args, result: { job_id: job.id, status: 'running', message: 'Research started. Call get_job_status with this job_id every 20-30 seconds.' } }
    }
  },
  {
    name: 'get_job_status',
    title: 'Get background job status',
    description: 'Check a background job started by generate_image, edit_image or start_research.',
    inputSchema: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'] },
    risk: 'read',
    scope: 'notes:read',
    surfaces: ['mcp'],
    async handler(ctx, args) {
      const id = String(args.job_id ?? '')
      const local = getJob(ctx.userId, id)
      if (local) return { toolName: 'get_job_status', args, result: jobView(local) }
      const stored = await aiJobs.get(ctx.userId, id).catch(() => null)
      if (!stored) return { toolName: 'get_job_status', args, result: { job_id: id, status: 'unknown', message: 'No job with this id.' } }
      const status = stored.status === 'complete' ? 'done' : stored.status === 'failed' ? 'failed' : 'running'
      return { toolName: 'get_job_status', args, result: { job_id: id, status, tool: stored.type, result: stored.result ?? undefined, error: stored.error ?? undefined } }
    }
  }
]

export const museTools: MuseTool[] = [...agentToolDeclarations.map(fromDeclaration), ...mcpOnlyTools]

const byName = new Map(museTools.map(tool => [tool.name, tool]))

export function getMuseTool(name: string): MuseTool | undefined { return byName.get(name) }

export function toolsForScopes(scopes: readonly string[], tools: readonly MuseTool[] = museTools): MuseTool[] {
  const granted = new Set(scopes)
  return tools.filter(tool => tool.surfaces.includes('mcp') && granted.has(tool.scope))
}
