import { openDB, type IDBPDatabase } from 'idb'

export interface OfflineTrackRecord {
  filename: string
  title: string
  artist?: string
  size: number
  audioBlob: Blob
  coverBlob?: Blob
  cachedAt: number
  duration?: number
}

export interface BatchOfflineStatus {
  current: number
  total: number
  active: boolean
  currentTitle?: string
}

type OfflineChangeListener = (filenames: Set<string>) => void
type BatchProgressListener = (status: BatchOfflineStatus) => void

const DB_NAME = 'muse-offline-music'
const DB_VERSION = 1
const STORE_TRACKS = 'tracks'
const STORE_METADATA = 'metadata'

export class OfflineMusicService {
  private dbPromise: Promise<IDBPDatabase> | null = null
  private offlineFilenames = new Set<string>()
  private downloadingFilenames = new Set<string>()
  private activeAudioUrls = new Map<string, string>()
  private activeCoverUrls = new Map<string, string>()
  private listeners = new Set<OfflineChangeListener>()
  private batchListeners = new Set<BatchProgressListener>()
  private isInitialized = false
  private batchStatus: BatchOfflineStatus = { current: 0, total: 0, active: false }

  constructor() {
    if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
      void this.init()
    }
  }

  private async getDB(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE_TRACKS)) {
            db.createObjectStore(STORE_TRACKS, { keyPath: 'filename' })
          }
          if (!db.objectStoreNames.contains(STORE_METADATA)) {
            db.createObjectStore(STORE_METADATA)
          }
        }
      })
    }
    return this.dbPromise
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return
    try {
      const db = await this.getDB()
      const keys = await db.getAllKeys(STORE_TRACKS)
      this.offlineFilenames = new Set(keys.map(k => String(k)))
      this.isInitialized = true
      this.notifyListeners()
    } catch (err) {
      console.warn('[OfflineMusic] Failed to initialize IndexedDB offline music store:', err)
    }
  }

  public isTrackOffline(filename: string): boolean {
    return this.offlineFilenames.has(filename)
  }

  public isTrackDownloading(filename: string): boolean {
    return this.downloadingFilenames.has(filename)
  }

  public getOfflineFilenames(): Set<string> {
    return new Set(this.offlineFilenames)
  }

  public getBatchStatus(): BatchOfflineStatus {
    return { ...this.batchStatus }
  }

  public subscribe(listener: OfflineChangeListener): () => void {
    this.listeners.add(listener)
    listener(this.getOfflineFilenames())
    return () => {
      this.listeners.delete(listener)
    }
  }

  public subscribeBatch(listener: BatchProgressListener): () => void {
    this.batchListeners.add(listener)
    listener(this.getBatchStatus())
    return () => {
      this.batchListeners.delete(listener)
    }
  }

  private notifyListeners(): void {
    const filenames = this.getOfflineFilenames()
    for (const listener of this.listeners) {
      try {
        listener(filenames)
      } catch (err) {
        console.error('[OfflineMusic] Listener error:', err)
      }
    }
  }

  private notifyBatch(status: BatchOfflineStatus): void {
    this.batchStatus = { ...status }
    for (const listener of this.batchListeners) {
      try {
        listener(this.batchStatus)
      } catch (err) {
        console.error('[OfflineMusic] Batch listener error:', err)
      }
    }
  }

  /**
   * Retrieves an active blob URL for offline playback.
   * Reuses the existing object URL if already created.
   */
  public async getOfflineAudioUrl(filename: string): Promise<string | null> {
    if (!this.offlineFilenames.has(filename)) return null
    if (this.activeAudioUrls.has(filename)) {
      return this.activeAudioUrls.get(filename)!
    }
    try {
      const db = await this.getDB()
      const record = (await db.get(STORE_TRACKS, filename)) as OfflineTrackRecord | undefined
      if (!record || !record.audioBlob) return null
      const url = URL.createObjectURL(record.audioBlob)
      this.activeAudioUrls.set(filename, url)
      return url
    } catch (err) {
      console.warn(`[OfflineMusic] Could not create audio URL for ${filename}:`, err)
      return null
    }
  }

  /**
   * Retrieves an active blob URL for offline album artwork.
   */
  public async getOfflineCoverUrl(filename: string): Promise<string | null> {
    if (!this.offlineFilenames.has(filename)) return null
    if (this.activeCoverUrls.has(filename)) {
      return this.activeCoverUrls.get(filename)!
    }
    try {
      const db = await this.getDB()
      const record = (await db.get(STORE_TRACKS, filename)) as OfflineTrackRecord | undefined
      if (!record || !record.coverBlob) return null
      const url = URL.createObjectURL(record.coverBlob)
      this.activeCoverUrls.set(filename, url)
      return url
    } catch (err) {
      console.warn(`[OfflineMusic] Could not create cover URL for ${filename}:`, err)
      return null
    }
  }

  /**
   * Downloads a song and its cover art into the browser's IndexedDB storage.
   * Tracks are read directly from local machine storage without internet.
   * Automatically checks if already downloaded to prevent redundant downloads.
   */
  public async downloadTrackOffline(
    track: {
      filename: string
      title?: string
      artist?: string
      size?: number
      url?: string
      coverUrl?: string
    },
    force = false
  ): Promise<{ success: boolean; alreadyDownloaded?: boolean; error?: string }> {
    const filename = track.filename
    if (!filename) return { success: false, error: 'Missing filename' }

    // Guard: Check if music is already downloaded on this machine
    if (!force && this.isTrackOffline(filename)) {
      return { success: true, alreadyDownloaded: true }
    }

    if (this.downloadingFilenames.has(filename)) {
      return { success: false, error: 'Download already in progress' }
    }

    this.downloadingFilenames.add(filename)
    this.notifyListeners()

    try {
      // 1. Fetch audio stream
      const audioUrl = track.url || `/api/music/stream/${encodeURIComponent(filename)}`
      const audioRes = await fetch(audioUrl)
      if (!audioRes.ok) {
        throw new Error(`Failed to fetch audio stream: ${audioRes.statusText}`)
      }
      const audioBlob = await audioRes.blob()

      // 2. Fetch cover art (best-effort)
      let coverBlob: Blob | undefined
      try {
        const coverUrl = track.coverUrl || `/api/music/cover/${encodeURIComponent(filename)}`
        const coverRes = await fetch(coverUrl)
        if (coverRes.ok) {
          const blob = await coverRes.blob()
          if (blob.size > 0 && blob.type.startsWith('image/')) {
            coverBlob = blob
          }
        }
      } catch {
        // Non-fatal, cover is optional
      }

      // 3. Save record to IndexedDB
      const record: OfflineTrackRecord = {
        filename,
        title: track.title || filename.replace(/\.[^/.]+$/, ''),
        artist: track.artist,
        size: audioBlob.size,
        audioBlob,
        coverBlob,
        cachedAt: Date.now()
      }

      const db = await this.getDB()
      await db.put(STORE_TRACKS, record)

      this.offlineFilenames.add(filename)
      this.downloadingFilenames.delete(filename)
      this.notifyListeners()
      return { success: true, alreadyDownloaded: false }
    } catch (err: any) {
      console.error(`[OfflineMusic] Download failed for ${filename}:`, err)
      this.downloadingFilenames.delete(filename)
      this.notifyListeners()
      return { success: false, error: err?.message || 'Download failed' }
    }
  }

  /**
   * Deletes a song from local IndexedDB storage and revokes active blob URLs.
   */
  public async deleteOfflineTrack(filename: string): Promise<void> {
    try {
      const db = await this.getDB()
      await db.delete(STORE_TRACKS, filename)

      if (this.activeAudioUrls.has(filename)) {
        URL.revokeObjectURL(this.activeAudioUrls.get(filename)!)
        this.activeAudioUrls.delete(filename)
      }
      if (this.activeCoverUrls.has(filename)) {
        URL.revokeObjectURL(this.activeCoverUrls.get(filename)!)
        this.activeCoverUrls.delete(filename)
      }

      this.offlineFilenames.delete(filename)
      this.notifyListeners()
    } catch (err) {
      console.error(`[OfflineMusic] Failed to delete offline track ${filename}:`, err)
    }
  }

  /**
   * Downloads all songs to the local machine for offline playback.
   * Automatically skips any songs that are already downloaded.
   */
  public async downloadAllOffline(
    tracks: Array<{
      filename: string
      title?: string
      artist?: string
      size?: number
      url?: string
      coverUrl?: string
    }>
  ): Promise<{ downloaded: number; skipped: number; total: number }> {
    const toDownload = tracks.filter(t => t.filename && !this.isTrackOffline(t.filename))
    const skipped = tracks.length - toDownload.length

    if (toDownload.length === 0) {
      return { downloaded: 0, skipped, total: tracks.length }
    }

    this.notifyBatch({ current: 0, total: toDownload.length, active: true })

    let downloaded = 0
    for (let i = 0; i < toDownload.length; i++) {
      const track = toDownload[i]
      this.notifyBatch({
        current: i + 1,
        total: toDownload.length,
        active: true,
        currentTitle: track.title || track.filename
      })
      const res = await this.downloadTrackOffline(track)
      if (res.success && !res.alreadyDownloaded) {
        downloaded++
      }
    }

    this.notifyBatch({ current: toDownload.length, total: toDownload.length, active: false })
    return { downloaded, skipped, total: tracks.length }
  }

  /**
   * Exports/saves the MP3 file directly to the user's computer (Downloads folder).
   * If already stored offline in IndexedDB, uses the local blob without network request!
   */
  public async exportTrackToComputer(track: {
    filename: string
    title?: string
    url?: string
  }): Promise<void> {
    try {
      let blob: Blob
      if (this.isTrackOffline(track.filename)) {
        const db = await this.getDB()
        const record = (await db.get(STORE_TRACKS, track.filename)) as OfflineTrackRecord | undefined
        if (record?.audioBlob) {
          blob = record.audioBlob
        } else {
          const res = await fetch(track.url || `/api/music/stream/${encodeURIComponent(track.filename)}`)
          blob = await res.blob()
        }
      } else {
        const res = await fetch(track.url || `/api/music/stream/${encodeURIComponent(track.filename)}`)
        blob = await res.blob()
      }

      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = track.filename.endsWith('.mp3') ? track.filename : `${track.filename}.mp3`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    } catch (err) {
      console.error(`[OfflineMusic] Failed to export track ${track.filename}:`, err)
      throw err
    }
  }

  /**
   * Retrieves all offline track records stored on this machine.
   */
  public async getAllOfflineTracks(): Promise<OfflineTrackRecord[]> {
    try {
      const db = await this.getDB()
      return (await db.getAll(STORE_TRACKS)) as OfflineTrackRecord[]
    } catch {
      return []
    }
  }

  /**
   * Computes offline storage statistics for this machine.
   */
  public async getOfflineStorageStats(): Promise<{ count: number; totalBytes: number }> {
    try {
      const db = await this.getDB()
      const records = (await db.getAll(STORE_TRACKS)) as OfflineTrackRecord[]
      const totalBytes = records.reduce((acc, r) => acc + (r.size || r.audioBlob?.size || 0), 0)
      return { count: records.length, totalBytes }
    } catch {
      return { count: this.offlineFilenames.size, totalBytes: 0 }
    }
  }

  /**
   * Saves a cached copy of the full song list in IndexedDB metadata.
   * If the remote PC is unreachable or offline, the web UI can still show the library!
   */
  public async saveSongsListCache(songs: any[]): Promise<void> {
    try {
      const db = await this.getDB()
      await db.put(STORE_METADATA, songs, 'songs_list')
    } catch (_) {}
  }

  /**
   * Loads the cached copy of the song list when offline or server is down.
   */
  public async loadSongsListCache(): Promise<any[] | null> {
    try {
      const db = await this.getDB()
      const cached = (await db.get(STORE_METADATA, 'songs_list')) as any[] | undefined
      return cached || null
    } catch {
      return null
    }
  }

  /**
   * Clears all offline audio files and metadata from this computer.
   */
  public async clearAllOffline(): Promise<void> {
    try {
      const db = await this.getDB()
      await db.clear(STORE_TRACKS)
      await db.delete(STORE_METADATA, 'songs_list')

      for (const url of this.activeAudioUrls.values()) {
        URL.revokeObjectURL(url)
      }
      for (const url of this.activeCoverUrls.values()) {
        URL.revokeObjectURL(url)
      }
      this.activeAudioUrls.clear()
      this.activeCoverUrls.clear()
      this.offlineFilenames.clear()
      this.notifyListeners()
    } catch (err) {
      console.error('[OfflineMusic] Failed to clear offline storage:', err)
    }
  }
}

export const offlineMusic = new OfflineMusicService()
