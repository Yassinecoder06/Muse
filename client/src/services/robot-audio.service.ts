import type { BipSoundType, VoiceSettings } from './voice.types'

const SETTINGS_KEY = 'muse-voice-settings'

const DEFAULT_SETTINGS: VoiceSettings = {
  voiceURI: '',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  autoReadAloud: false,
  soundEffectsEnabled: true,
  soundEffectsVolume: 0.5,
  lang: 'en-US'
}

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

export function saveVoiceSettings(updates: Partial<VoiceSettings>): VoiceSettings {
  const current = loadVoiceSettings()
  const next = { ...current, ...updates }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {}
  return next
}

class RobotAudioService {
  private ctx: AudioContext | null = null
  private thinkingTimer: number | null = null

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  public play(type: BipSoundType) {
    const settings = loadVoiceSettings()
    if (!settings.soundEffectsEnabled || settings.soundEffectsVolume <= 0) {
      return
    }

    const ctx = this.getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const masterGain = ctx.createGain()
    masterGain.gain.setValueAtTime(settings.soundEffectsVolume * 0.4, now)
    masterGain.connect(ctx.destination)

    switch (type) {
      case 'boop':
        this.playBoop(ctx, masterGain, now)
        break
      case 'chirp':
        this.playChirp(ctx, masterGain, now)
        break
      case 'blip':
        this.playBlip(ctx, masterGain, now)
        break
      case 'thinking':
        this.playThinkingPulse(ctx, masterGain, now)
        break
      case 'success':
        this.playSuccess(ctx, masterGain, now)
        break
      case 'error':
        this.playError(ctx, masterGain, now)
        break
      case 'whoosh':
        this.playWhoosh(ctx, masterGain, now)
        break
      case 'excited':
        this.playExcited(ctx, masterGain, now)
        break
    }
  }

  private playBoop(ctx: AudioContext, master: GainNode, now: number) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(780, now)
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.09)

    gain.gain.setValueAtTime(0.01, now)
    gain.gain.linearRampToValueAtTime(0.7, now + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1)

    osc.connect(gain)
    gain.connect(master)

    osc.start(now)
    osc.stop(now + 0.11)
  }

  private playChirp(ctx: AudioContext, master: GainNode, now: number) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(580, now)
    osc.frequency.linearRampToValueAtTime(1100, now + 0.07)
    osc.frequency.setValueAtTime(800, now + 0.08)
    osc.frequency.linearRampToValueAtTime(1600, now + 0.16)

    gain.gain.setValueAtTime(0.01, now)
    gain.gain.linearRampToValueAtTime(0.65, now + 0.02)
    gain.gain.setValueAtTime(0.3, now + 0.07)
    gain.gain.linearRampToValueAtTime(0.7, now + 0.09)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)

    osc.connect(gain)
    gain.connect(master)

    osc.start(now)
    osc.stop(now + 0.19)
  }

  private playBlip(ctx: AudioContext, master: GainNode, now: number) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(1250, now)
    osc.frequency.exponentialRampToValueAtTime(850, now + 0.04)

    gain.gain.setValueAtTime(0.01, now)
    gain.gain.linearRampToValueAtTime(0.5, now + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045)

    osc.connect(gain)
    gain.connect(master)

    osc.start(now)
    osc.stop(now + 0.05)
  }

  private playThinkingPulse(ctx: AudioContext, master: GainNode, now: number) {
    // Subtle dual soft clicks
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(620, now)
    osc.frequency.setValueAtTime(740, now + 0.04)

    gain.gain.setValueAtTime(0.01, now)
    gain.gain.linearRampToValueAtTime(0.35, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035)
    gain.gain.setValueAtTime(0.35, now + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)

    osc.connect(gain)
    gain.connect(master)

    osc.start(now)
    osc.stop(now + 0.09)
  }

  private playSuccess(ctx: AudioContext, master: GainNode, now: number) {
    // Joyful ascending triad: C5 (523), E5 (659), G5 (784), C6 (1046)
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((freq, idx) => {
      const startTime = now + idx * 0.055
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = idx === notes.length - 1 ? 'sine' : 'triangle'
      osc.frequency.setValueAtTime(freq, startTime)

      gain.gain.setValueAtTime(0.01, startTime)
      gain.gain.linearRampToValueAtTime(0.5, startTime + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + (idx === notes.length - 1 ? 0.35 : 0.12))

      osc.connect(gain)
      gain.connect(master)

      osc.start(startTime)
      osc.stop(startTime + (idx === notes.length - 1 ? 0.36 : 0.13))
    })
  }

  private playError(ctx: AudioContext, master: GainNode, now: number) {
    // Gentle warning double buzz
    ;[0, 0.09].forEach(offset => {
      const startTime = now + offset
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(220, startTime)
      osc.frequency.linearRampToValueAtTime(170, startTime + 0.06)

      gain.gain.setValueAtTime(0.01, startTime)
      gain.gain.linearRampToValueAtTime(0.35, startTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.07)

      osc.connect(gain)
      gain.connect(master)

      osc.start(startTime)
      osc.stop(startTime + 0.075)
    })
  }

  private playWhoosh(ctx: AudioContext, master: GainNode, now: number) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(280, now)
    osc.frequency.exponentialRampToValueAtTime(750, now + 0.06)
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.14)

    gain.gain.setValueAtTime(0.01, now)
    gain.gain.linearRampToValueAtTime(0.4, now + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)

    osc.connect(gain)
    gain.connect(master)

    osc.start(now)
    osc.stop(now + 0.16)
  }

  private playExcited(ctx: AudioContext, master: GainNode, now: number) {
    const freqs = [659, 880, 1174, 1318]
    freqs.forEach((freq, idx) => {
      const startTime = now + idx * 0.04
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, startTime)

      gain.gain.setValueAtTime(0.01, startTime)
      gain.gain.linearRampToValueAtTime(0.45, startTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.14)

      osc.connect(gain)
      gain.connect(master)

      osc.start(startTime)
      osc.stop(startTime + 0.15)
    })
  }

  public startThinkingLoop() {
    this.stopThinkingLoop()
    this.play('thinking')
    this.thinkingTimer = window.setInterval(() => {
      this.play('thinking')
    }, 1200)
  }

  public stopThinkingLoop() {
    if (this.thinkingTimer) {
      window.clearInterval(this.thinkingTimer)
      this.thinkingTimer = null
    }
  }
}

export const robotAudio = new RobotAudioService()
