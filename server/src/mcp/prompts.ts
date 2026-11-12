import { McpError, ErrorCode, type GetPromptResult, type Prompt } from '@modelcontextprotocol/sdk/types.js'

type PromptDef = Prompt & { render(args: Record<string, string>): string }

export const PROMPTS: PromptDef[] = [
  {
    name: 'daily_review',
    title: 'Daily review',
    description: 'Review today in Muse: open tasks, today\'s events and recent notes, then suggest priorities.',
    render: () => 'Use Muse to review my day. List my open tasks (list_tasks), today\'s calendar events (list_calendar_events) and notes I changed recently (search_notes). Then suggest my top three priorities and anything I should reschedule. Do not change anything unless I confirm.'
  },
  {
    name: 'plan_my_day',
    title: 'Plan my day',
    description: 'Turn a brain dump into tasks and calendar blocks in Muse.',
    arguments: [{ name: 'brain_dump', description: 'Everything on your mind for today', required: true }],
    render: args => `Here is my brain dump for today:\n\n${args.brain_dump ?? ''}\n\nCheck my existing tasks and events in Muse first, then propose a plan. After I agree, create the tasks with create_tasks (with due times and reminders) and block time with create_calendar_event.`
  },
  {
    name: 'capture_meeting_notes',
    title: 'Capture meeting notes',
    description: 'Save meeting notes as a Muse note and extract action items as tasks.',
    arguments: [
      { name: 'notes', description: 'Raw meeting notes or transcript', required: true },
      { name: 'meeting', description: 'Meeting name', required: false }
    ],
    render: args => `Turn these ${args.meeting ? `"${args.meeting}" ` : ''}meeting notes into a clean Muse note (create_note) with a summary, decisions and open questions, then create one task per action item (create_tasks) with owners and due dates when mentioned:\n\n${args.notes ?? ''}`
  },
  {
    name: 'weekly_reflection',
    title: 'Weekly reflection',
    description: 'Reflect on the past week from notes, completed tasks and events.',
    render: () => 'Look at my Muse notes, completed tasks and calendar events from the past 7 days. Write a short weekly reflection (wins, blockers, lessons, focus for next week) and save it as a note titled "Weekly reflection" with today\'s date.'
  }
]

export function renderPrompt(name: string, args: Record<string, string>): GetPromptResult {
  const prompt = PROMPTS.find(candidate => candidate.name === name)
  if (!prompt) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt "${name}".`)
  const missing = (prompt.arguments ?? []).filter(arg => arg.required && !args[arg.name]?.trim()).map(arg => arg.name)
  if (missing.length) throw new McpError(ErrorCode.InvalidParams, `Missing prompt argument(s): ${missing.join(', ')}.`)
  return { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.render(args) } }] }
}
