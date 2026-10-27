import test from 'node:test'
import assert from 'node:assert/strict'
import { OfflineMusicService } from './offline-music.service'

test('OfflineMusicService tracks offline state and prevents duplicate downloads', async () => {
  const service = new OfflineMusicService()

  // Initially not offline
  assert.equal(service.isTrackOffline('ambient-loop.mp3'), false)
  assert.equal(service.isTrackDownloading('ambient-loop.mp3'), false)

  // Seed internal offline set for testing
  ;(service as any).offlineFilenames.add('ambient-loop.mp3')
  assert.equal(service.isTrackOffline('ambient-loop.mp3'), true)

  // When downloadTrackOffline is called on an already cached track:
  // It MUST immediately return { success: true, alreadyDownloaded: true } without fetching
  let fetchCalled = false
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    fetchCalled = true
    throw new Error('fetch should not be called for already downloaded track')
  }) as any

  try {
    const res = await service.downloadTrackOffline({
      filename: 'ambient-loop.mp3',
      title: 'Ambient Loop'
    })

    assert.equal(res.success, true)
    assert.equal(res.alreadyDownloaded, true)
    assert.equal(fetchCalled, false, 'Network fetch was bypassed for duplicate track')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('downloadAllOffline accurately skips already-downloaded tracks', async () => {
  const service = new OfflineMusicService()
  ;(service as any).offlineFilenames.add('song1.mp3')
  ;(service as any).offlineFilenames.add('song2.mp3')

  const tracks = [
    { filename: 'song1.mp3', title: 'Song 1' },
    { filename: 'song2.mp3', title: 'Song 2' }
  ]

  // All are already downloaded
  const resAllCached = await service.downloadAllOffline(tracks)
  assert.equal(resAllCached.downloaded, 0)
  assert.equal(resAllCached.skipped, 2)
  assert.equal(resAllCached.total, 2)
})

test('OfflineMusicService subscribe notifies listeners on update', () => {
  const service = new OfflineMusicService()
  let notifiedSet: Set<string> | null = null

  const unsubscribe = service.subscribe(filenames => {
    notifiedSet = filenames
  })

  // Initial call on subscribe
  assert.ok(notifiedSet !== null)
  assert.equal((notifiedSet as Set<string>).size, 0)

  // Simulate internal update and notification
  ;(service as any).offlineFilenames.add('meditation.mp3')
  ;(service as any).notifyListeners()

  assert.equal((notifiedSet as Set<string>).has('meditation.mp3'), true)

  unsubscribe()
})
