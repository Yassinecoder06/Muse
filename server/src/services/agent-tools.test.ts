import assert from 'node:assert/strict'
import test from 'node:test'
import { agentToolDeclarations, CONFIRMATION_REQUIRED_TOOLS, executeAgentTool, matchNoteByTitle } from './agent-tools.service.js'
import { evaluateMath } from './calculator.service.js'
import { executeInSandbox } from './sandbox.service.js'
import { parseTrackInfo } from '../controllers/music.controller.js'
import { createConfirmationToken, consumeConfirmationToken } from './agent-confirmation.service.js'
import { primeOwnerForTests } from './owner.service.js'

primeOwnerForTests({ passphrase_hash: 'unused', session_salt: 'test-salt' })

test('agent tool declarations include all required autonomous skills', () => {
  const toolNames = agentToolDeclarations.map(t => t.name)
  
  // Verify core and specialized tools exist
  assert.ok(toolNames.includes('create_note'), 'Missing create_note')
  assert.ok(toolNames.includes('update_note'), 'Missing update_note')
  assert.ok(toolNames.includes('read_note'), 'Missing read_note')
  assert.ok(toolNames.includes('search_notes'), 'Missing search_notes')
  assert.ok(toolNames.includes('search_web'), 'Missing search_web')
  assert.ok(toolNames.includes('calculate'), 'Missing calculate')
  assert.ok(toolNames.includes('execute_code'), 'Missing execute_code')
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
  assert.ok(toolNames.includes('play_music'), 'Missing play_music')
  assert.ok(toolNames.includes('plan_music_download'), 'Missing plan_music_download')
  assert.ok(toolNames.includes('get_music_download_tasks'), 'Missing get_music_download_tasks')
  assert.ok(toolNames.includes('create_playlist'), 'Missing create_playlist')
  assert.ok(toolNames.includes('list_playlists'), 'Missing list_playlists')
  assert.ok(toolNames.includes('play_playlist'), 'Missing play_playlist')
  assert.ok(toolNames.includes('generate_image'), 'Missing generate_image')
  assert.ok(toolNames.includes('edit_image'), 'Missing edit_image')

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

  const generateImage = agentToolDeclarations.find(t => t.name === 'generate_image')!
  assert.ok(generateImage.parameters.required?.includes('prompt'))

  const editImage = agentToolDeclarations.find(t => t.name === 'edit_image')!
  assert.ok(editImage.parameters.required?.includes('prompt'))
})

test('matchNoteByTitle never guesses between several notes', async () => {
  const notes = [{ id: '1', title: 'Gym log' }, { id: '2', title: 'Gym plan' }, { id: '3', title: 'Groceries' }]
  assert.equal(matchNoteByTitle(notes, 'groceries').match?.id, '3')
  assert.equal(matchNoteByTitle(notes, 'gym').ambiguous?.length, 2)
  assert.equal(matchNoteByTitle(notes, 'Gym Plan').match?.id, '2')
  assert.deepEqual(matchNoteByTitle(notes, 'taxes'), {})
})

test('calculator tool evaluates expressions, percentages, powers and functions', async () => {
  // Direct evaluateMath tests
  assert.equal(evaluateMath('10 + 25 * 2'), 60)
  assert.equal(evaluateMath('15% of 240'), 36)
  assert.equal(evaluateMath('25%'), 0.25)
  assert.equal(evaluateMath('2^8'), 256)
  assert.equal(evaluateMath('sqrt(144) + abs(-10)'), 22)
  assert.equal(evaluateMath('min(15, 8) + max(3, 12)'), 20)
  assert.equal(evaluateMath('round(4.6) + floor(4.9) + ceil(4.1)'), 14)
  assert.equal(evaluateMath('sin(0) + cos(0)'), 1)

  // Test error handling
  assert.throws(() => evaluateMath(''), /cannot be empty/)
  assert.throws(() => evaluateMath('process.exit(1)'), /Unknown mathematical token|disallowed/)
  assert.throws(() => evaluateMath('window.alert(1)'), /Unknown mathematical token|disallowed/)

  // Test tool execution via executeAgentTool
  const result = await executeAgentTool('test-user', 'calculate', { expression: 'sqrt(144) + 15% of 200' })
  assert.equal(result.toolName, 'calculate')
  assert.equal(result.result.result, 42)
})

test('execute_code tool runs safely in isolated sandbox with helpers and security', async () => {
  // Basic math and return
  const r1 = executeInSandbox('return 40 + 2;')
  assert.equal(r1.success, true)
  assert.equal(r1.result, 42)

  // Multi-line loop algorithm (sum 1 to 10)
  const r2 = executeInSandbox(`
    let total = 0;
    for (let i = 1; i <= 10; i++) total += i;
    return total;
  `)
  assert.equal(r2.success, true)
  assert.equal(r2.result, 55)

  // Statistical & array helper functions
  const r3 = executeInSandbox(`
    const numbers = [10, 20, 30, 40];
    return {
      sum: sum(numbers),
      avg: avg(numbers),
      median: median([5, 1, 9, 3, 7]),
      round: roundTo(3.14159, 2),
      fact: factorial(5),
      pct: percent(25, 200)
    };
  `)
  assert.equal(r3.success, true)
  assert.deepEqual(r3.result, {
    sum: 100,
    avg: 25,
    median: 5,
    round: 3.14,
    fact: 120,
    pct: 12.5
  })

  // Console.log capturing
  const r4 = executeInSandbox(`
    console.log('computed step 1');
    console.warn('warning notice');
    return true;
  `)
  assert.equal(r4.success, true)
  assert.ok(r4.logs.includes('computed step 1'))
  assert.ok(r4.logs.some(l => l.includes('[warn] warning notice')))

  // Security guard prevents forbidden access
  const bad1 = executeInSandbox('return process.env;')
  assert.equal(bad1.success, false)
  assert.ok(bad1.error?.includes('Security violation'))

  const bad2 = executeInSandbox('const fs = require("fs");')
  assert.equal(bad2.success, false)
  assert.ok(bad2.error?.includes('Security violation'))

  // Tool execution via executeAgentTool
  const toolExec = await executeAgentTool('test-user', 'execute_code', {
    code: 'return range(1, 6).map(n => n * 2);'
  })
  assert.equal(toolExec.toolName, 'execute_code')
  assert.deepEqual(toolExec.result.output, [2, 4, 6, 8, 10])
})

test('parseTrackInfo parses standard artist-title formats and cleans suffixes', () => {
  const t1 = parseTrackInfo('Imagine Dragons - Demons.mp3')
  assert.equal(t1.artist, 'Imagine Dragons')
  assert.equal(t1.title, 'Demons')

  const t2 = parseTrackInfo('Blinding Lights by The Weeknd.wav')
  assert.equal(t2.artist, 'The Weeknd')
  assert.equal(t2.title, 'Blinding Lights')

  const t3 = parseTrackInfo('Queen - Bohemian Rhapsody - Official Video.mp3')
  assert.equal(t3.artist, 'Queen')
  assert.equal(t3.title, 'Bohemian Rhapsody')

  const t4 = parseTrackInfo('Billie Eilish - Birds of a Feather-SnapYT.App.flac')
  assert.equal(t4.artist, 'Billie Eilish')
  assert.equal(t4.title, 'Birds of a Feather')
})

test('plan_music_download tool structures download items and action cards', async () => {
  const result = await executeAgentTool('test-user', 'plan_music_download', {
    songs: [
      { title: 'Demons', artist: 'Imagine Dragons' },
      { title: 'Starboy', artist: 'The Weeknd' }
    ]
  })

  assert.equal(result.toolName, 'plan_music_download')
  assert.equal(result.result.success, true)
  assert.equal(result.actionCard?.type, 'music_download_plan')
  assert.ok(Array.isArray(result.actionCard?.data?.items))
  const items = result.actionCard?.data?.items as any[]
  assert.equal(items.length, 2)
  assert.equal(items[0].title, 'Demons')
  assert.equal(items[0].artist, 'Imagine Dragons')
})

test('agent confirmation token protects destructive tools from unconfirmed execution', async () => {
  // Verify all destructive tools require confirmation
  assert.ok(CONFIRMATION_REQUIRED_TOOLS.has('permanently_delete_note'))
  assert.ok(CONFIRMATION_REQUIRED_TOOLS.has('empty_trash'))
  assert.ok(CONFIRMATION_REQUIRED_TOOLS.has('delete_task'))
  assert.ok(CONFIRMATION_REQUIRED_TOOLS.has('delete_calendar_event'))
  assert.ok(CONFIRMATION_REQUIRED_TOOLS.has('delete_memory'))
  assert.ok(CONFIRMATION_REQUIRED_TOOLS.has('delete_specialized_template'))
  assert.ok(CONFIRMATION_REQUIRED_TOOLS.has('delete_chat_session'))

  // Create token
  const userId = 'user-abc-123'
  const token = createConfirmationToken(userId, 'delete_task', { id: 'task-456' })
  assert.ok(token && typeof token === 'string')

  // Successful single consumption
  const consumed = consumeConfirmationToken(userId, token)
  assert.ok(consumed)
  assert.equal(consumed?.tool, 'delete_task')
  assert.equal(consumed?.args.id, 'task-456')

  // Replay attack prevention: consuming the same token twice fails
  const replay = consumeConfirmationToken(userId, token)
  assert.equal(replay, null)

  // Cross-user isolation: token created for user-abc cannot be used by user-xyz
  const token2 = createConfirmationToken(userId, 'empty_trash', {})
  const wrongUser = consumeConfirmationToken('user-other-999', token2)
  assert.equal(wrongUser, null)

  // Tampered token rejection
  const token3 = createConfirmationToken(userId, 'delete_task', { id: 'task-789' })
  const tampered = token3.slice(0, -4) + 'abcd'
  assert.equal(consumeConfirmationToken(userId, tampered), null)
})

