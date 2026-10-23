import assert from 'node:assert/strict'
import test from 'node:test'
import {
  owner,
  OwnerError,
  primeOwnerForTests,
  disableOwnerPersistForTests,
  setSetupCodeForTests,
  getSetupCodeForTests
} from './owner.service.js'

test('owner service setup, change, and reset', async (t) => {
  disableOwnerPersistForTests(true)

  await t.test('setup requires correct setup code', async () => {
    primeOwnerForTests(null)
    setSetupCodeForTests('WXYZ-1234')

    // Wrong setup code
    await assert.rejects(
      () => owner.setup('a-strong-passphrase-123', 'WRONG-CODE'),
      (err: any) => err instanceof OwnerError && err.statusCode === 403
    )

    // Correct setup code
    await owner.setup('a-strong-passphrase-123', 'wxyz-1234')
    assert.equal(await owner.configured(), true)
    assert.equal(await owner.verify('a-strong-passphrase-123'), true)
    assert.equal(await owner.verify('wrong-passphrase'), false)
  })

  await t.test('change passphrase requires valid current passphrase', async () => {
    // Current is 'a-strong-passphrase-123'
    // Wrong current passphrase
    await assert.rejects(
      () => owner.changePassphrase('incorrect-old-passphrase', 'new-passphrase-456'),
      (err: any) => err instanceof OwnerError && err.statusCode === 401
    )

    // Correct current passphrase
    await owner.changePassphrase('a-strong-passphrase-123', 'new-passphrase-456')
    assert.equal(await owner.verify('new-passphrase-456'), true)
    assert.equal(await owner.verify('a-strong-passphrase-123'), false)
  })

  await t.test('reset passphrase with setup code succeeds and rotates code', async () => {
    setSetupCodeForTests('ABCD-5678')

    // Wrong reset code
    await assert.rejects(
      () => owner.resetWithCode('fresh-passphrase-789', 'FAIL-0000'),
      (err: any) => err instanceof OwnerError && err.statusCode === 403
    )

    // Correct reset code
    await owner.resetWithCode('fresh-passphrase-789', 'abcd-5678')
    assert.equal(await owner.verify('fresh-passphrase-789'), true)
    assert.equal(await owner.verify('new-passphrase-456'), false)

    // Code is rotated after use
    assert.notEqual(getSetupCodeForTests(), 'ABCD-5678')
  })

  await t.test('requestResetCode generates and logs a new setup code', async () => {
    const code = await owner.requestResetCode()
    assert.ok(typeof code === 'string' && code.length >= 8)
    assert.equal(getSetupCodeForTests(), code)
  })
})
