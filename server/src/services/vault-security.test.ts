import assert from 'node:assert/strict'
import test from 'node:test'
import { challengeHashMatches, challengeIsUsable, counterAdvanced, hashChallenge } from './vault-security.js'

test('challenge hashes are one-way and reject replayed or altered values', () => {
  const hash = hashChallenge('one-time-challenge')
  assert.notEqual(hash, 'one-time-challenge')
  assert.equal(challengeHashMatches('one-time-challenge', hash), true)
  assert.equal(challengeHashMatches('other-challenge', hash), false)
  assert.equal(challengeIsUsable({ expires_at: new Date(Date.now() + 1_000).toISOString(), used_at: null }), true)
  assert.equal(challengeIsUsable({ expires_at: new Date(Date.now() + 1_000).toISOString(), used_at: new Date().toISOString() }), false)
  assert.equal(challengeIsUsable({ expires_at: new Date(Date.now() - 1_000).toISOString(), used_at: null }), false)
})

test('signature counters reject a detected cloned authenticator', () => {
  assert.equal(counterAdvanced(0, 0), true)
  assert.equal(counterAdvanced(0, 7), true)
  assert.equal(counterAdvanced(7, 8), true)
  assert.equal(counterAdvanced(7, 7), false)
  assert.equal(counterAdvanced(7, 6), false)
})
