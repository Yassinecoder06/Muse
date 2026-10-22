import { offlineMusic } from './offline-music.service'

export interface MusicTrack {
  filename: string
  title: string
  size?: number
  url: string
  artist?: string
  coverUrl?: string
  isOffline?: boolean
}

export interface MusicPlayerState {
  currentTrack: MusicTrack | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  error: string | null
  playlistName?: string | null
  playlistIndex?: number
  playlistTotal?: number
  queue?: MusicTrack[]
  shuffle: boolean
  repeatMode: 'off' | 'all' | 'one'
  playbackRate: number
  sleepTimerRemaining: number | null
  sleepTimerDuration: number | 'track' | null
  crossfadeSeconds: number
  isCurrentOffline?: boolean
}

type MusicListener = (state: MusicPlayerState) => void

class RobotMusicService {
  private audio: HTMLAudioElement | null = null
  private listeners = new Set<MusicListener>()
  private playlistQueue: MusicTrack[] = []
  private originalQueue: MusicTrack[] = []
  private playlistTitle: string | null = null
  private playlistIndex: number = 0
  private sleepTimerInterval: any = null
  private sleepTimerRemaining: number | null = null
  private sleepTimerDuration: number | 'track' | null = null
  private crossfadeSeconds: number = 0
  private state: MusicPlayerState = {
    currentTrack: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    error: null,
    playlistName: null,
    playlistIndex: 0,
    playlistTotal: 0,
    queue: [],
    shuffle: false,
    repeatMode: 'all',
    playbackRate: 1,
    sleepTimerRemaining: null,
    sleepTimerDuration: null,
    crossfadeSeconds: 0
  }

  constructor() {
    if (typeof window !== 'undefined') {
      this.initAudio()
    }
  }

  private initAudio() {
    if (this.audio) return
    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.volume = this.state.volume

    this.audio.addEventListener('play', () => {
      if (this.audio) {
        this.audio.playbackRate = this.state.playbackRate
        this.audio.volume = this.state.volume
      }
      this.updateState({ isPlaying: true, error: null })
    })

    this.audio.addEventListener('pause', () => {
      this.updateState({ isPlaying: false })
    })

    this.audio.addEventListener('timeupdate', () => {
      if (this.audio) {
        const cur = this.audio.currentTime || 0
        const dur = this.audio.duration || 0
        
        // Handle crossfade volume ramp-down if near the end
        if (this.crossfadeSeconds > 0 && dur > this.crossfadeSeconds && cur >= dur - this.crossfadeSeconds) {
          const remaining = Math.max(0, dur - cur)
          const factor = remaining / this.crossfadeSeconds
          this.audio.volume = Math.max(0, Math.min(1, this.state.volume * factor))
        }

        this.updateState({
          currentTime: cur,
          duration: dur
        })
      }
    })

    this.audio.addEventListener('loadedmetadata', () => {
      if (this.audio) {
        this.updateState({ duration: this.audio.duration || 0 })
      }
    })

    this.audio.addEventListener('ended', () => {
      this.updateState({ isPlaying: false, currentTime: 0 })
      this.handleTrackEnded()
    })

    this.audio.addEventListener('error', () => {
      console.error('Audio playback error', this.audio?.error)
      if (this.playlistQueue.length > 0 && this.playlistIndex < this.playlistQueue.length - 1) {
        console.warn('Skipping track in playlist due to error:', this.playlistQueue[this.playlistIndex]?.title)
        setTimeout(() => {
          void this.nextTrack()
        }, 600)
        return
      }
      this.updateState({
        isPlaying: false,
        error: 'Unable to stream music track. Please verify server connection.'
      })
    })
  }

  public getState(): MusicPlayerState {
    return { ...this.state }
  }

  public subscribe(listener: MusicListener): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private updateState(partial: Partial<MusicPlayerState>) {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) {
      try {
        listener(this.getState())
      } catch (err) {
        console.error('Error notifying music listener:', err)
      }
    }
  }

  public async fetchAvailableSongs(): Promise<MusicTrack[]> {
    try {
      const res = await fetch('/api/music/songs')
      if (!res.ok) throw new Error(`HTTP error ${res.status}`)
      const data = await res.json()
      const songs = Array.isArray(data.songs) ? data.songs : []
      if (songs.length > 0) {
        void offlineMusic.saveSongsListCache(songs)
      }
      return songs
    } catch (err) {
      console.warn('[RobotMusic] Failed to fetch songs over network, attempting offline storage:', err)
      // Fallback 1: cached songs list
      const cached = await offlineMusic.loadSongsListCache()
      if (cached && cached.length > 0) {
        return cached
      }
      // Fallback 2: tracks downloaded into IndexedDB
      const offlineTracks = await offlineMusic.getAllOfflineTracks()
      return offlineTracks.map(t => ({
        filename: t.filename,
        title: t.title,
        artist: t.artist,
        size: t.size,
        url: `/api/music/stream/${encodeURIComponent(t.filename)}`,
        isOffline: true
      }))
    }
  }

  public async playSong(
    track: { filename?: string; title?: string; url?: string; artist?: string; coverUrl?: string },
    contextQueue?: MusicTrack[]
  ): Promise<void> {
    this.initAudio()
    if (!this.audio) return

    let finalUrl = track.url
    let finalTitle = track.title || 'Music Track'
    let finalFilename = track.filename || 'song.mp3'

    // If no URL given or empty path, fetch from API or offline cache
    if (!finalUrl || finalUrl === '/api/music/stream/' || finalUrl.endsWith('/.mp3')) {
      const songs = await this.fetchAvailableSongs()
      if (songs.length === 0) {
        this.updateState({ error: 'No songs found in music/ folder' })
        return
      }
      const match = track.title || track.filename
        ? songs.find(s =>
            (track.title && s.title.toLowerCase().includes(track.title.toLowerCase())) ||
            (track.filename && s.filename.toLowerCase().includes(track.filename.toLowerCase()))
          )
        : null
      const chosen = match || songs[0]
      finalUrl = chosen.url
      finalTitle = chosen.title
      finalFilename = chosen.filename
    }

    if (finalUrl && !finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      const prefix = '/api/music/stream/'
      if (finalUrl.startsWith(prefix)) {
        const rawParam = finalUrl.slice(prefix.length)
        finalUrl = `${prefix}${encodeURIComponent(decodeURIComponent(rawParam))}`
      }
    }

    let coverUrl =
      track.coverUrl ||
      (finalFilename ? `/api/music/cover/${encodeURIComponent(finalFilename)}` : undefined)

    // Check if the track is stored offline in the browser / PC memory
    let isOffline = false
    try {
      const offlineAudioUrl = await offlineMusic.getOfflineAudioUrl(finalFilename)
      if (offlineAudioUrl) {
        finalUrl = offlineAudioUrl
        isOffline = true
        const offlineCover = await offlineMusic.getOfflineCoverUrl(finalFilename)
        if (offlineCover) {
          coverUrl = offlineCover
        }
      }
    } catch (_) {}

    const currentTrackObj: MusicTrack = {
      filename: finalFilename,
      title: finalTitle,
      size: 0,
      url: finalUrl,
      artist: track.artist,
      coverUrl,
      isOffline
    }

    if (contextQueue && contextQueue.length > 0) {
      this.playlistQueue = [...contextQueue]
      const idx = contextQueue.findIndex(t => t.filename === finalFilename)
      this.playlistIndex = idx !== -1 ? idx : 0
    } else if (this.playlistQueue.length === 0) {
      this.playlistQueue = [currentTrackObj]
      this.playlistIndex = 0
    } else {
      const idx = this.playlistQueue.findIndex(t => t.filename === finalFilename)
      if (idx !== -1) {
        this.playlistIndex = idx
      } else {
        this.playlistQueue.splice(this.playlistIndex + 1, 0, currentTrackObj)
        this.playlistIndex += 1
      }
    }

    this.updateState({
      currentTrack: currentTrackObj,
      isCurrentOffline: isOffline,
      error: null,
      queue: [...this.playlistQueue],
      playlistIndex: this.playlistIndex,
      playlistTotal: this.playlistQueue.length
    })

    this.updateMediaSession(currentTrackObj)

    try {
      // If same song is currently paused, just resume
      if (this.audio.src.endsWith(finalUrl) && this.audio.paused && this.audio.currentTime > 0) {
        this.audio.playbackRate = this.state.playbackRate
        this.audio.volume = this.state.volume
        await this.audio.play()
        return
      }

      this.audio.src = finalUrl
      this.audio.playbackRate = this.state.playbackRate
      this.audio.volume = this.state.volume
      this.audio.currentTime = 0
      await this.audio.play()
    } catch (err: any) {
      console.warn('Playback play failed:', err)
      const isAutoplay = err?.name === 'NotAllowedError' || (err?.message && /user didn't interact|not allowed/i.test(err.message))
      this.updateState({
        isPlaying: false,
        error: isAutoplay
          ? 'Browser blocked autoplay. Click Play Mix to start.'
          : (err?.message || 'Failed to start playback')
      })
    }
  }

  public pause(): void {
    if (this.audio && !this.audio.paused) {
      this.audio.pause()
    }
  }

  public resume(): void {
    if (this.audio && this.audio.paused) {
      void this.audio.play().catch(console.warn)
    }
  }

  public togglePlayPause(): void {
    if (!this.audio) return
    if (this.audio.paused) {
      this.resume()
    } else {
      this.pause()
    }
  }

  public togglePlay(): void {
    this.togglePlayPause()
  }

  public playTrack(
    track: { filename?: string; title?: string; url?: string; artist?: string; coverUrl?: string },
    contextQueue?: MusicTrack[]
  ): Promise<void> {
    return this.playSong(track, contextQueue)
  }

  public seek(time: number): void {
    if (this.audio && !isNaN(time)) {
      this.audio.currentTime = time
      this.updateState({ currentTime: time })
    }
  }

  public stop(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
    }
    this.playlistQueue = []
    this.playlistTitle = null
    this.playlistIndex = 0
    this.updateState({
      isPlaying: false,
      currentTime: 0,
      currentTrack: null,
      error: null,
      playlistName: null,
      playlistIndex: 0,
      playlistTotal: 0,
      queue: []
    })
  }

  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume))
    if (this.audio) {
      this.audio.volume = clamped
    }
    this.updateState({ volume: clamped })
  }

  public getQueue(): MusicTrack[] {
    return [...this.playlistQueue]
  }

  public setQueue(tracks: MusicTrack[], currentIndex?: number): void {
    this.playlistQueue = [...tracks]
    if (typeof currentIndex === 'number') {
      this.playlistIndex = Math.max(0, Math.min(tracks.length - 1, currentIndex))
    }
    this.updateState({
      queue: this.getQueue(),
      playlistIndex: this.playlistIndex,
      playlistTotal: this.playlistQueue.length
    })
  }

  public addToQueue(track: MusicTrack, priority: 'next' | 'end' = 'end'): void {
    const currentQ = [...this.playlistQueue]
    if (currentQ.length === 0) {
      void this.playPlaylist('Custom Queue', [track], 0)
      return
    }

    if (priority === 'next') {
      currentQ.splice(this.playlistIndex + 1, 0, track)
    } else {
      currentQ.push(track)
    }

    this.playlistQueue = currentQ
    this.updateState({
      queue: this.getQueue(),
      playlistTotal: this.playlistQueue.length
    })
  }

  public reorderQueue(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      fromIndex >= this.playlistQueue.length ||
      toIndex < 0 ||
      toIndex >= this.playlistQueue.length ||
      fromIndex === toIndex
    ) {
      return
    }

    const currentPlaying = this.playlistQueue[this.playlistIndex]
    const updated = [...this.playlistQueue]
    const [moved] = updated.splice(fromIndex, 1)
    updated.splice(toIndex, 0, moved)

    const newCurrentIndex = updated.findIndex(t => t.filename === currentPlaying?.filename)
    this.playlistIndex = newCurrentIndex !== -1 ? newCurrentIndex : this.playlistIndex
    this.playlistQueue = updated

    this.updateState({
      queue: this.getQueue(),
      playlistIndex: this.playlistIndex,
      playlistTotal: this.playlistQueue.length
    })
  }

  public removeFromQueue(index: number): void {
    if (index < 0 || index >= this.playlistQueue.length) return

    const isRemovingCurrent = index === this.playlistIndex
    const updated = [...this.playlistQueue]
    updated.splice(index, 1)
    this.playlistQueue = updated

    if (updated.length === 0) {
      this.stop()
      return
    }

    if (index < this.playlistIndex) {
      this.playlistIndex -= 1
    } else if (this.playlistIndex >= updated.length) {
      this.playlistIndex = updated.length - 1
    }

    this.updateState({
      queue: this.getQueue(),
      playlistIndex: this.playlistIndex,
      playlistTotal: this.playlistQueue.length
    })

    if (isRemovingCurrent && this.playlistQueue[this.playlistIndex]) {
      void this.playSong(this.playlistQueue[this.playlistIndex])
    }
  }

  public async playFromQueue(index: number): Promise<void> {
    if (index < 0 || index >= this.playlistQueue.length) return
    this.playlistIndex = index
    this.updateState({
      playlistIndex: this.playlistIndex
    })
    await this.playSong(this.playlistQueue[index])
  }

  public async playPlaylist(name: string, tracks: MusicTrack[], startIndex = 0): Promise<void> {
    if (!tracks || tracks.length === 0) return
    this.originalQueue = [...tracks]
    this.playlistTitle = name

    if (this.state.shuffle) {
      const chosen = tracks[startIndex] || tracks[0]
      const others = tracks.filter(t => t.filename !== chosen.filename)
      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[others[i], others[j]] = [others[j], others[i]]
      }
      this.playlistQueue = [chosen, ...others]
      this.playlistIndex = 0
    } else {
      this.playlistQueue = [...tracks]
      this.playlistIndex = Math.max(0, Math.min(tracks.length - 1, startIndex))
    }

    this.updateState({
      playlistName: name,
      playlistIndex: this.playlistIndex,
      playlistTotal: this.playlistQueue.length,
      queue: this.getQueue()
    })

    const track = this.playlistQueue[this.playlistIndex]
    await this.playSong(track)
  }

  public toggleShuffle(): void {
    const nextShuffle = !this.state.shuffle
    if (nextShuffle) {
      if (this.playlistQueue.length > 1) {
        this.originalQueue = [...this.playlistQueue]
        const current = this.playlistQueue[this.playlistIndex]
        const others = this.playlistQueue.filter((_, i) => i !== this.playlistIndex)
        for (let i = others.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[others[i], others[j]] = [others[j], others[i]]
        }
        this.playlistQueue = [current, ...others]
        this.playlistIndex = 0
      }
    } else {
      if (this.originalQueue.length > 0) {
        const current = this.playlistQueue[this.playlistIndex]
        this.playlistQueue = [...this.originalQueue]
        const newIdx = this.playlistQueue.findIndex(t => t.filename === current?.filename)
        this.playlistIndex = newIdx !== -1 ? newIdx : 0
      }
    }

    this.updateState({
      shuffle: nextShuffle,
      queue: this.getQueue(),
      playlistIndex: this.playlistIndex,
      playlistTotal: this.playlistQueue.length
    })
  }

  public toggleRepeatMode(): void {
    const modes: ('off' | 'all' | 'one')[] = ['off', 'all', 'one']
    const nextIdx = (modes.indexOf(this.state.repeatMode) + 1) % modes.length
    const nextMode = modes[nextIdx]
    this.updateState({ repeatMode: nextMode })
  }

  public setPlaybackRate(rate: number): void {
    const clamped = Math.max(0.5, Math.min(2.5, rate))
    if (this.audio) {
      this.audio.playbackRate = clamped
    }
    this.updateState({ playbackRate: clamped })
  }

  public setSleepTimer(duration: number | 'track' | null): void {
    if (this.sleepTimerInterval) {
      clearInterval(this.sleepTimerInterval)
      this.sleepTimerInterval = null
    }

    if (duration === null) {
      this.sleepTimerDuration = null
      this.sleepTimerRemaining = null
      this.updateState({ sleepTimerDuration: null, sleepTimerRemaining: null })
      return
    }

    if (duration === 'track') {
      this.sleepTimerDuration = 'track'
      this.sleepTimerRemaining = null
      this.updateState({ sleepTimerDuration: 'track', sleepTimerRemaining: null })
      return
    }

    this.sleepTimerDuration = duration
    this.sleepTimerRemaining = Math.round(duration * 60)
    this.updateState({
      sleepTimerDuration: this.sleepTimerDuration,
      sleepTimerRemaining: this.sleepTimerRemaining
    })

    this.sleepTimerInterval = setInterval(() => {
      if (this.sleepTimerRemaining !== null && this.sleepTimerRemaining > 0) {
        this.sleepTimerRemaining -= 1
        this.updateState({ sleepTimerRemaining: this.sleepTimerRemaining })
        if (this.sleepTimerRemaining <= 0) {
          if (this.sleepTimerInterval) {
            clearInterval(this.sleepTimerInterval)
            this.sleepTimerInterval = null
          }
          this.pause()
          this.sleepTimerDuration = null
          this.sleepTimerRemaining = null
          this.updateState({ sleepTimerDuration: null, sleepTimerRemaining: null })
        }
      }
    }, 1000)
  }

  public setCrossfade(seconds: number): void {
    const clamped = Math.max(0, Math.min(12, seconds))
    this.crossfadeSeconds = clamped
    this.updateState({ crossfadeSeconds: clamped })
  }

  public async nextTrack(): Promise<void> {
    if (this.playlistQueue.length === 0) {
      const songs = await this.fetchAvailableSongs()
      if (songs.length > 0) {
        this.playlistQueue = songs
        this.playlistIndex = 0
        await this.playSong(songs[0])
      }
      return
    }
    if (this.playlistIndex < this.playlistQueue.length - 1) {
      this.playlistIndex += 1
      this.updateState({ playlistIndex: this.playlistIndex })
      await this.playSong(this.playlistQueue[this.playlistIndex])
    } else {
      if (this.state.repeatMode === 'off') {
        this.pause()
        this.seek(0)
      } else {
        // Loop back to the beginning of the queue
        this.playlistIndex = 0
        this.updateState({ playlistIndex: this.playlistIndex })
        await this.playSong(this.playlistQueue[0])
      }
    }
  }

  public async prevTrack(): Promise<void> {
    if (this.playlistQueue.length === 0) {
      const songs = await this.fetchAvailableSongs()
      if (songs.length > 0) {
        this.playlistQueue = songs
        this.playlistIndex = songs.length - 1
        await this.playSong(songs[this.playlistIndex])
      }
      return
    }
    // If track has been playing for more than 3s, rewind to start (industry standard)
    if (this.audio && this.audio.currentTime > 3) {
      this.audio.currentTime = 0
      this.updateState({ currentTime: 0 })
      return
    }
    if (this.playlistIndex > 0) {
      this.playlistIndex -= 1
    } else {
      // Loop back to the end of the queue
      this.playlistIndex = this.playlistQueue.length - 1
    }
    this.updateState({ playlistIndex: this.playlistIndex })
    await this.playSong(this.playlistQueue[this.playlistIndex])
  }

  private updateMediaSession(track: MusicTrack): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try {
      const artwork = track.coverUrl
        ? [
            { src: track.coverUrl, sizes: '96x96', type: 'image/jpeg' },
            { src: track.coverUrl, sizes: '256x256', type: 'image/jpeg' },
            { src: track.coverUrl, sizes: '512x512', type: 'image/jpeg' }
          ]
        : []

      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist || this.playlistTitle || 'Bip Singing Companion',
        album: this.playlistTitle || 'Muse Music',
        artwork
      })
      navigator.mediaSession.setActionHandler('play', () => this.resume())
      navigator.mediaSession.setActionHandler('pause', () => this.pause())
      navigator.mediaSession.setActionHandler('previoustrack', () => void this.prevTrack())
      navigator.mediaSession.setActionHandler('nexttrack', () => void this.nextTrack())
      navigator.mediaSession.setActionHandler('seekto', details => {
        if (typeof details.seekTime === 'number') this.seek(details.seekTime)
      })
    } catch {}
  }

  private handleTrackEnded(): void {
    if (this.sleepTimerDuration === 'track') {
      this.pause()
      this.seek(0)
      this.setSleepTimer(null)
      return
    }

    if (this.state.repeatMode === 'one') {
      if (this.audio) {
        this.audio.currentTime = 0
        void this.audio.play()
      }
      return
    }

    if (this.playlistQueue.length > 0) {
      void this.nextTrack()
    }
  }
}

export const robotMusic = new RobotMusicService()
