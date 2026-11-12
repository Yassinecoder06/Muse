import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { approvalCanBeDecided, codeCanBeConsumed, downgradedScopes, refreshAction, validAccessRow, validDcr, verifyPkce } from './oauth-logic.js'

test('PKCE accepts S256 verifier and rejects mismatches',()=>{
  const verifier='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'
  const challenge=createHash('sha256').update(verifier).digest('base64url')
  assert.equal(verifyPkce(verifier,challenge),true)
  assert.equal(verifyPkce(`${verifier}x`,challenge),false)
  assert.equal(verifyPkce('short',challenge),false)
})
test('authorization code can be consumed only once and only before expiry',()=>{
  const fresh={consumed_at:null,expires_at:new Date(Date.now()+60_000).toISOString()}
  assert.equal(codeCanBeConsumed(fresh),true)
  assert.equal(codeCanBeConsumed({...fresh,consumed_at:new Date().toISOString()}),false)
  assert.equal(codeCanBeConsumed({...fresh,expires_at:new Date(Date.now()-1).toISOString()}),false)
})
test('refresh rotates a live token and flags reuse for family revocation',()=>{
  const old={type:'oauth_refresh',revoked_at:null}
  assert.equal(refreshAction(old),'rotate')
  assert.equal(refreshAction({...old,revoked_at:new Date().toISOString()}),'revoke-family')
  assert.equal(refreshAction({type:'oauth_access',revoked_at:null}),'reject')
})
test('revoked and expired access credentials are rejected',()=>{
  assert.equal(validAccessRow({type:'pat',revoked_at:null,expires_at:null}),true)
  assert.equal(validAccessRow({type:'oauth_access',revoked_at:new Date().toISOString(),expires_at:null}),false)
  assert.equal(validAccessRow({type:'oauth_access',revoked_at:null,expires_at:new Date(Date.now()-1).toISOString()}),false)
})
test('consent can only downgrade to client-registered scopes',()=>{
  assert.deepEqual(downgradedScopes(['notes:read','notes:write','code'],['notes:read','code']),['notes:read','code'])
  assert.deepEqual(downgradedScopes('notes:read',['notes:read','code']),['notes:read'])
})
test('approval decision is pending-only and single-use',()=>{
  const approval={status:'pending',expires_at:new Date(Date.now()+60_000).toISOString()}
  assert.equal(approvalCanBeDecided(approval),true)
  assert.equal(approvalCanBeDecided({...approval,status:'approved'}),false)
  assert.equal(approvalCanBeDecided({...approval,expires_at:new Date(Date.now()-1).toISOString()}),false)
})
test('dynamic registration validates client metadata and redirect URIs',()=>{
  assert.equal(validDcr({client_name:'Notebook',redirect_uris:['https://client.example/callback']}),true)
  assert.equal(validDcr({client_name:'Bad',redirect_uris:['https://good.example/cb','https://evil.example/cb']}),true)
  assert.equal(validDcr({client_name:'Bad',redirect_uris:['http://evil.example/cb']}),false)
  assert.equal(validDcr({client_name:'',redirect_uris:['https://client.example/cb']}),false)
})
