export interface VoiceSettings {
  voiceURI: string
  rate: number       // 0.8 - 1.4, default 1.0
  pitch: number      // 0.8 - 1.4, default 1.0
  volume: number     // 0.0 - 1.0, default 1.0
  autoReadAloud: boolean // default false
  soundEffectsEnabled: boolean // default true
  soundEffectsVolume: number  // 0.0 - 1.0, default 0.6
  lang: string       // default 'en-US'
}

export type STTState = 'idle' | 'listening' | 'processing' | 'error'

export type TTSState = 'idle' | 'speaking' | 'paused'

export interface STTOptions {
  lang?: string
  continuous?: boolean
  interimResults?: boolean
  onInterim?: (interimText: string) => void
  onFinal?: (finalText: string) => void
  onError?: (error: string) => void
  onStateChange?: (state: STTState) => void
}

export interface TTSOptions {
  voiceURI?: string
  rate?: number
  pitch?: number
  volume?: number
  onStart?: () => void
  onBoundary?: (charIndex: number) => void
  onEnd?: () => void
  onError?: (err: any) => void
}

export type BipSoundType =
  | 'boop'
  | 'chirp'
  | 'blip'
  | 'thinking'
  | 'success'
  | 'error'
  | 'whoosh'
  | 'excited'
