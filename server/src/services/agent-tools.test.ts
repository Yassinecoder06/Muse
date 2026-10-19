import assert from 'node:assert/strict'
import test from 'node:test'
import { agentToolDeclarations } from './agent-tools.service.js'

test('agent tool declarations include all required autonomous skills', () => {
  const toolNames = agentToolDeclarations.map(t => t.name)
  
  // Verify core and specialized tools exist
  assert.ok(toolNames.includes('create_note'), 'Missing create_note')
  assert.ok(toolNames.includes('update_note'), 'Missing update_note')
  assert.ok(toolNames.includes('search_notes'), 'Missing search_notes')
  assert.ok(toolNames.includes('create_task'), 'Missing create_task')
  assert.ok(toolNames.includes('list_tasks'), 'Missing list_tasks')
  assert.ok(toolNames.includes('update_task'), 'Missing update_task')
  assert.ok(toolNames.includes('create_calendar_event'), 'Missing create_calendar_event')
  assert.ok(toolNames.includes('list_calendar_events'), 'Missing list_calendar_events')
  assert.ok(toolNames.includes('save_memory'), 'Missing save_memory')
  assert.ok(toolNames.includes('get_memories'), 'Missing get_memories')
  assert.ok(toolNames.includes('list_specialized_templates'), 'Missing list_specialized_templates')
  assert.ok(toolNames.includes('create_specialized_template'), 'Missing create_specialized_template')
  assert.ok(toolNames.includes('create_specialized_note'), 'Missing create_specialized_note')

  // Verify deletion tools exist
  assert.ok(toolNames.includes('trash_note'), 'Missing trash_note')
  assert.ok(toolNames.includes('permanently_delete_note'), 'Missing permanently_delete_note')
  assert.ok(toolNames.includes('empty_trash'), 'Missing empty_trash')
  assert.ok(toolNames.includes('delete_task'), 'Missing delete_task')
  assert.ok(toolNames.includes('delete_calendar_event'), 'Missing delete_calendar_event')
  assert.ok(toolNames.includes('delete_memory'), 'Missing delete_memory')
  assert.ok(toolNames.includes('delete_specialized_template'), 'Missing delete_specialized_template')
  assert.ok(toolNames.includes('delete_chat_session'), 'Missing delete_chat_session')
})

test('agent tool parameter schemas define proper required fields', () => {
  const createNote = agentToolDeclarations.find(t => t.name === 'create_note')!
  assert.ok(createNote.parameters.required?.includes('title'))
  assert.ok(createNote.parameters.required?.includes('content'))

  const createTask = agentToolDeclarations.find(t => t.name === 'create_task')!
  assert.ok(createTask.parameters.required?.includes('text'))

  const createEvent = agentToolDeclarations.find(t => t.name === 'create_calendar_event')!
  assert.ok(createEvent.parameters.required?.includes('title'))
  assert.ok(createEvent.parameters.required?.includes('start_time'))

  const saveMemory = agentToolDeclarations.find(t => t.name === 'save_memory')!
  assert.ok(saveMemory.parameters.required?.includes('fact'))
})

test('matchNoteByTitle never guesses between several notes', async () => {
  const { matchNoteByTitle } = await import('./agent-tools.service.js')
  const notes = [{ id: '1', title: 'Gym log' }, { id: '2', title: 'Gym plan' }, { id: '3', title: 'Groceries' }]
  assert.equal(matchNoteByTitle(notes, 'groceries').match?.id, '3')
  assert.equal(matchNoteByTitle(notes, 'gym').ambiguous?.length, 2)
  assert.equal(matchNoteByTitle(notes, 'Gym Plan').match?.id, '2')
  assert.deepEqual(matchNoteByTitle(notes, 'taxes'), {})
})
