import { ErrorCode, McpError, type Resource, type ResourceTemplate } from '@modelcontextprotocol/sdk/types.js'
import type { ToolExecutionResult } from '../services/agent-tools.service.js'
import type { McpIdentity } from './ports.js'

export interface ResourceContent { uri: string; mimeType: string; text: string }

export interface ResourceProvider {
  list(): Resource[]
  templates(): ResourceTemplate[]
  read(identity: McpIdentity, uri: string, timezone: string): Promise<ResourceContent>
}

export interface ResourceDeps {
  listNotes(userId: string): Promise<{ id: string; title: string; tags: string[]; updated_at: string }[]>
  getNote(userId: string, id: string): Promise<{ id: string; title: string; content: string; tags: string[]; updated_at: string }>
  execute(userId: string, name: string, args: Record<string, unknown>, options: { timezone: string }): Promise<ToolExecutionResult>
}

const NOTE_URI = /^muse:\/\/notes\/([0-9a-f-]{36})$/i
const RECENT_LIMIT = 25

const FIXED: (Resource & { scope: string })[] = [
  { uri: 'muse://notes/recent', name: 'recent-notes', title: 'Recent notes', description: `The ${RECENT_LIMIT} most recently updated notes`, mimeType: 'text/markdown', scope: 'notes:read' },
  { uri: 'muse://tasks/today', name: 'tasks-today', title: 'Open tasks', description: 'Open tasks, soonest due first', mimeType: 'application/json', scope: 'tasks' },
  { uri: 'muse://calendar/week', name: 'calendar-week', title: 'Calendar: next 7 days', description: 'Events from today through the next 7 days', mimeType: 'application/json', scope: 'calendar' }
]

function requireScope(identity: McpIdentity, scope: string) {
  if (!identity.scopes.includes(scope)) throw new McpError(ErrorCode.InvalidRequest, `This connection does not have the "${scope}" scope.`)
}

export function createResourceProvider(deps: ResourceDeps, scopes: readonly string[]): ResourceProvider {
  const granted = new Set(scopes)
  return {
    list: () => FIXED.filter(resource => granted.has(resource.scope)).map(({ scope: _scope, ...resource }) => resource),
    templates: () => granted.has('notes:read')
      ? [{ uriTemplate: 'muse://notes/{id}', name: 'note', title: 'Note by id', description: 'Full Markdown content of one note', mimeType: 'text/markdown' }]
      : [],
    async read(identity, uri, timezone) {
      const note = NOTE_URI.exec(uri)
      if (note) {
        requireScope(identity, 'notes:read')
        const found = await deps.getNote(identity.userId, note[1])
        const tags = found.tags.length ? `\n\nTags: ${found.tags.map(tag => `#${tag}`).join(' ')}` : ''
        return { uri, mimeType: 'text/markdown', text: `# ${found.title}\n\n${found.content}${tags}` }
      }
      if (uri === 'muse://notes/recent') {
        requireScope(identity, 'notes:read')
        const list = (await deps.listNotes(identity.userId)).slice(0, RECENT_LIMIT)
        const lines = list.map(item => `- [${item.title || 'Untitled'}](muse://notes/${item.id}) · updated ${item.updated_at.slice(0, 10)}${item.tags.length ? ` · ${item.tags.map(tag => `#${tag}`).join(' ')}` : ''}`)
        return { uri, mimeType: 'text/markdown', text: lines.length ? `# Recent notes\n\n${lines.join('\n')}` : 'No notes yet.' }
      }
      if (uri === 'muse://tasks/today') {
        requireScope(identity, 'tasks')
        const result = await deps.execute(identity.userId, 'list_tasks', { completed: false }, { timezone })
        return { uri, mimeType: 'application/json', text: JSON.stringify(result.result) }
      }
      if (uri === 'muse://calendar/week') {
        requireScope(identity, 'calendar')
        const result = await deps.execute(identity.userId, 'list_calendar_events', { from: 'today', to: 'in 7 days' }, { timezone })
        return { uri, mimeType: 'application/json', text: JSON.stringify(result.result) }
      }
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource "${uri}".`)
    }
  }
}
