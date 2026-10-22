export interface VoiceSettings {
  voiceURI: string
  rate: number       // 0.8 - 1.4, default 1.0
  pitch: number      // 0.8 - 1.4, default 1.0
  volume: number     // 0.0 - 1.0, default 1.0
  autoReadAloud: boolean // default false
  soundEffectsEnabled: boolean // default true
  soundEffectsVolume: number  // 0.0 - 1.0, default 0.6
  lang: string       // default 'en-US'
  sttEngine?: 'gemini' | 'native' // 'gemini' (Gemini 3.5 Flash ASR) or 'native' (Web Speech API)
  ttsEngine?: 'neural' | 'native' // 'neural' (High-fidelity Neural AI Voice) or 'native' (Browser SpeechSynthesis)
  neuralVoice?: string // 'en-US-JennyNeural', 'en-US-AriaNeural', 'en-GB-SoniaNeural', etc.
}

export const CURATED_NEURAL_VOICES = [
  { id: 'en-US-JennyNeural', name: 'Jenny (US · Smooth, Clear & Warm Female · Recommended)', isRecommended: true },
  { id: 'en-US-AriaNeural', name: 'Aria (US · Confident, Crisp & Expressive Female)' },
  { id: 'en-US-AvaNeural', name: 'Ava (US · Soft, Gentle & Natural Female)' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia (UK · Elegant & Melodic British Female)' },
  { id: 'en-AU-NatashaNeural', name: 'Natasha (AU · Bright & Clear Australian Female)' },
] as const


export type STTState = 'idle' | 'listening' | 'processing' | 'error'

export type TTSState = 'idle' | 'speaking' | 'paused'

export interface STTOptions {
  lang?: string
  continuous?: boolean
  interimResults?: boolean
  silenceTimeoutMs?: number // Delay in ms after speech before auto-stopping (default: 15000ms, 0 for infinite)
  initialText?: string // Preserve existing input text and accumulate onto it
  onInterim?: (interimText: string) => void
  onFinal?: (finalText: string) => void
  onFinalSegment?: (segment: string) => void
  onComplete?: (fullText: string) => void
  onError?: (error: string) => void
  onStateChange?: (state: STTState) => void
}

export interface TTSOptions {
  voiceURI?: string
  neuralVoice?: string
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
  | 'dizzy'
