import assert from 'node:assert/strict'
import test from 'node:test'
import { agentToolDeclarations } from './agent-tools.service.js'

test('agent tool declarations include all required autonomous skills', () => {
  const toolNames = agentToolDeclarations.map(t => t.name)
  
  // Verify core tools exist
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
