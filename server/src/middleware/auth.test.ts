import assert from 'node:assert/strict'
import test from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import { requireAuth, DEFAULT_LOCAL_USER_ID } from './auth.js'
import { primeOwnerForTests } from '../services/owner.service.js'
import { createSession, SESSION_COOKIE } from '../services/session.service.js'
import { consumeConfirmationToken, createConfirmationToken } from '../services/agent-confirmation.service.js'

primeOwnerForTests({ passphrase_hash: 'unused', session_salt: 'test-salt' })

async function run(headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const req = { get: (name: string) => headers[name.toLowerCase()], cookies } as unknown as Request
  let status = 200
  let body: any
  const res = { status(code: number) { status = code; return this }, json(value: unknown) { body = value; return this } } as unknown as Response
  let nextCalled = false
  await requireAuth(req, res, (() => { nextCalled = true }) as NextFunction)
  return { status, body, nextCalled, userId: req.userId }
}

test('no credentials → 401', async () => {
  const result = await run()
  assert.equal(result.status, 401)
  assert.equal(result.body.code, 'auth_required')
  assert.equal(result.nextCalled, false)
})

test('the old x-muse-user-id header no longer grants access', async () => {
  const result = await run({ 'x-muse-user-id': DEFAULT_LOCAL_USER_ID })
  assert.equal(result.status, 401)
  assert.equal(result.userId, undefined)
})

test('a valid owner session cookie is accepted', async () => {
  const result = await run({}, { [SESSION_COOKIE]: createSession(DEFAULT_LOCAL_USER_ID) })
  assert.equal(result.nextCalled, true)
  assert.equal(result.userId, DEFAULT_LOCAL_USER_ID)
})

test('a forged or tampered cookie is rejected', async () => {
  const [, signature] = createSession(DEFAULT_LOCAL_USER_ID).split('.')
  const otherUser = Buffer.from(JSON.stringify({ sub: '11111111-1111-1111-1111-111111111111', exp: 9_999_999_999 })).toString('base64url')
  assert.equal((await run({}, { [SESSION_COOKIE]: `${otherUser}.${signature}` })).status, 401)
  assert.equal((await run({}, { [SESSION_COOKIE]: 'garbage' })).status, 401)
})

test('agent confirmation tokens: single use, owner-bound, tamper-proof', () => {
  const token = createConfirmationToken('user-a', 'delete_task', { id: 't1' })
  assert.equal(consumeConfirmationToken('user-b', token), null)
  assert.equal(consumeConfirmationToken('user-a', `${token}x`), null)
  assert.deepEqual(consumeConfirmationToken('user-a', token), { tool: 'delete_task', args: { id: 't1' } })
  assert.equal(consumeConfirmationToken('user-a', token), null)
})
