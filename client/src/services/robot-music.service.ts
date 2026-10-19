export interface MusicTrack {
  filename: string
  title: string
  size: number
  url: string
}

export interface MusicPlayerState {
  currentTrack: MusicTrack | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  error: string | null
}

type MusicListener = (state: MusicPlayerState) => void

class RobotMusicService {
  private audio: HTMLAudioElement | null = null
  private listeners = new Set<MusicListener>()
  private state: MusicPlayerState = {
    currentTrack: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    error: null
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
      this.updateState({ isPlaying: true, error: null })
    })

    this.audio.addEventListener('pause', () => {
      this.updateState({ isPlaying: false })
    })

    this.audio.addEventListener('timeupdate', () => {
      if (this.audio) {
        this.updateState({
          currentTime: this.audio.currentTime || 0,
          duration: this.audio.duration || 0
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
    })

    this.audio.addEventListener('error', () => {
      console.error('Audio playback error', this.audio?.error)
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
      return Array.isArray(data.songs) ? data.songs : []
    } catch (err) {
      console.error('Failed to fetch songs:', err)
      return []
    }
  }

  public async playSong(track: { filename?: string; title?: string; url?: string }): Promise<void> {
    this.initAudio()
    if (!this.audio) return

    let finalUrl = track.url
    let finalTitle = track.title || 'Music Track'
    let finalFilename = track.filename || 'song.mp3'

    // If no URL given, fetch from API
    if (!finalUrl) {
      const songs = await this.fetchAvailableSongs()
      if (songs.length === 0) {
        this.updateState({ error: 'No songs found in music/ folder' })
        return
      }
      const match = track.title
        ? songs.find(s => s.title.toLowerCase().includes(track.title!.toLowerCase()))
        : null
      const chosen = match || songs[0]
      finalUrl = chosen.url
      finalTitle = chosen.title
      finalFilename = chosen.filename
    }

    const currentTrackObj: MusicTrack = {
      filename: finalFilename,
      title: finalTitle,
      size: 0,
      url: finalUrl
    }

    this.updateState({
      currentTrack: currentTrackObj,
      error: null
    })

    try {
      // If same song is currently paused, just resume
      if (this.audio.src.endsWith(finalUrl) && this.audio.paused && this.audio.currentTime > 0) {
        await this.audio.play()
        return
      }

      this.audio.src = finalUrl
      this.audio.currentTime = 0
      await this.audio.play()
    } catch (err: any) {
      console.warn('Playback play failed:', err)
      this.updateState({
        isPlaying: false,
        error: err?.message || 'Failed to start playback'
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

  public stop(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
    }
    this.updateState({
      isPlaying: false,
      currentTime: 0,
      currentTrack: null,
      error: null
    })
  }

  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume))
    if (this.audio) {
      this.audio.volume = clamped
    }
    this.updateState({ volume: clamped })
  }
}

export const robotMusic = new RobotMusicService()
