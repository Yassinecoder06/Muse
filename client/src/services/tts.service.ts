import { api } from './api'
import { loadVoiceSettings } from './robot-audio.service'
import type { TTSOptions, VoiceSettings } from './voice.types'

/**
 * Unicode regex matching emojis, pictographs, flags, variation selectors,
 * skin tone modifiers, zero-width joiners, and enclosed keycaps.
 */
export const EMOJI_REGEX = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu

/**
 * Strips all emojis and pictographic symbols from text so the speech
 * synthesizer does not read out emoji descriptions (e.g., "robot face", "sparkles").
 */
export function stripEmojis(text: string): string {
  if (!text) return ''
  return text
    .replace(EMOJI_REGEX, '')
    // Remove empty brackets or parentheses left behind by stripped emojis
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    // Clean up spaces before punctuation marks created by emoji removal (e.g. "Hello !" -> "Hello!")
    .replace(/\s+([.,!?;:])/g, '$1')
}

/**
 * Strips Markdown syntax, HTML tags, links, emojis, and code blocks
 * so the synthetic voice reads natural, conversational prose without reading out emoji descriptions.
 */
export function cleanMarkdownForSpeech(text: string): string {
  if (!text) return ''

  let cleaned = text
    // Remove fenced code blocks completely or substitute
    .replace(/```[\s\S]*?```/g, ' ')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove markdown image syntax ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    // Replace markdown links [text](url) with just text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove URLs
    .replace(/https?:\/\/[^\s)]+/g, '')
    // Remove headers (#, ##, ###)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove blockquotes (> )
    .replace(/^>\s+/gm, '')
    // Remove bullet points and numbered list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove bold and italic markers (**text**, *text*, __text__, _text_, ~~text~~)
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    // Remove horizontal rules
    .replace(/^-{3,}$/gm, '')
    // Remove HTML tags
    .replace(/<[^>]*>/g, ' ')
    // Remove action card markers or tool call artifacts
    .replace(/\[IMAGE \d+\]/gi, '')
    // Remove emojis, pictographs, flags, variation selectors so TTS skips reading them
    .replace(EMOJI_REGEX, '')
    // Remove empty brackets or parentheses left behind
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    // Clean up spaces before punctuation marks created by emoji or markdown removal
    .replace(/\s+([.,!?;:])/g, '$1')
    // Insert natural sentence pause on line breaks without terminal punctuation
    .replace(/([^.,!?;:])\s*\n+/g, '$1. ')
    // Collapse multiple whitespace
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned
}

class TTSService {
  private currentUtterance: SpeechSynthesisUtterance | null = null
  private currentAudio: HTMLAudioElement | null = null
  private currentAudioUrl: string | null = null
  private activeAbortController: AbortController | null = null
  private isSynthesizing = false
  private voices: SpeechSynthesisVoice[] = []
  private voicesLoaded = false

  constructor() {
    this.initVoices()
  }

  private initVoices() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return

    const update = () => {
      this.voices = window.speechSynthesis.getVoices()
      if (this.voices.length > 0) {
        this.voicesLoaded = true
      }
    }

    update()
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = update
    }
  }

  public getVoices(): SpeechSynthesisVoice[] {
    if (!this.voicesLoaded && typeof window !== 'undefined' && window.speechSynthesis) {
      this.voices = window.speechSynthesis.getVoices()
      if (this.voices.length > 0) this.voicesLoaded = true
    }
    return this.voices
  }

  public getEnglishVoices(): SpeechSynthesisVoice[] {
    const all = this.getVoices()
    return all.filter(v => v.lang.toLowerCase().startsWith('en'))
  }

  public selectBestVoice(preferredURI?: string): SpeechSynthesisVoice | null {
    const englishVoices = this.getEnglishVoices()
    if (englishVoices.length === 0) {
      const all = this.getVoices()
      return all.length > 0 ? all[0] : null
    }

    if (preferredURI) {
      const match = englishVoices.find(v => v.voiceURI === preferredURI)
      if (match) return match
    }

    // High-priority keywords for smooth, natural female voices
    const preferredFemaleKeywords = [
      'jenny',
      'aria',
      'ava',
      'victoria',
      'samantha',
      'karen',
      'serena',
      'stephanie',
      'zira',
      'google uk english female',
      'female',
      'natural'
    ]

    // Disfavor overtly robotic or male voices when selecting default female voice
    const isRoboticOrMale = (name: string) => {
      const lower = name.toLowerCase()
      return (
        lower.includes('espeak') ||
        lower.includes('speech-dispatcher') ||
        lower.includes('david') ||
        lower.includes('daniel') ||
        lower.includes('mark') ||
        lower.includes('george') ||
        lower.includes('alex') ||
        lower.includes('guy')
      )
    }

    for (const kw of preferredFemaleKeywords) {
      const match = englishVoices.find(v => v.name.toLowerCase().includes(kw) && !isRoboticOrMale(v.name))
      if (match) return match
    }

    // Fall back to any non-robotic English voice
    const nonRobotic = englishVoices.find(v => !isRoboticOrMale(v.name))
    if (nonRobotic) return nonRobotic

    // Default to first English US/GB voice or first English voice
    const usOrGb = englishVoices.find(v => v.lang.includes('US') || v.lang.includes('GB'))
    return usOrGb || englishVoices[0]
  }

  private cleanupAudio() {
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio.removeAttribute('src')
      this.currentAudio.load()
      this.currentAudio = null
    }
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl)
      this.currentAudioUrl = null
    }
  }

  /**
   * Synthesize and play speech using the neural AI voice backend.
   * If the neural service fails (e.g. offline or network error), it seamlessly falls back to native browser speech.
   */
  public async speakNeural(
    text: string,
    options: TTSOptions = {},
    settings: VoiceSettings = loadVoiceSettings()
  ): Promise<boolean> {
    this.stop()

    const cleanedText = cleanMarkdownForSpeech(text)
    if (!cleanedText) {
      options.onEnd?.()
      return false
    }

    const voice = options.neuralVoice || settings.neuralVoice || 'en-US-JennyNeural'
    const abortController = new AbortController()
    this.activeAbortController = abortController
    this.isSynthesizing = true

    try {
      const blob = await api.synthesizeSpeech(cleanedText, voice)

      if (abortController.signal.aborted) {
        return false
      }

      this.isSynthesizing = false
      const url = URL.createObjectURL(blob)
      this.currentAudioUrl = url
      const audio = new Audio(url)
      this.currentAudio = audio

      audio.playbackRate = options.rate ?? settings.rate ?? 1.0
      audio.volume = options.volume ?? settings.volume ?? 1.0

      audio.onplay = () => {
        options.onStart?.()
      }

      audio.onended = () => {
        this.cleanupAudio()
        options.onEnd?.()
      }

      audio.onerror = (e) => {
        this.cleanupAudio()
        console.warn('[TTS] Neural audio playback error, falling back to browser speech:', e)
        this.speakNative(text, options, settings)
      }

      await audio.play()
      return true
    } catch (err: any) {
      this.isSynthesizing = false
      if (abortController.signal.aborted) {
        return false
      }
      console.warn('[TTS] Neural synthesis failed, falling back to browser voice:', err)
      return this.speakNative(text, options, settings)
    }
  }

  /**
   * Synthesize speech using the browser native Web Speech API (offline fallback).
   */
  public speakNative(
    text: string,
    options: TTSOptions = {},
    settings: VoiceSettings = loadVoiceSettings()
  ): boolean {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return false
    }

    this.stop()

    const cleanedText = cleanMarkdownForSpeech(text)
    if (!cleanedText) {
      options.onEnd?.()
      return false
    }

    const utterance = new SpeechSynthesisUtterance(cleanedText)
    this.currentUtterance = utterance

    // Set voice
    const voice = this.selectBestVoice(options.voiceURI || settings.voiceURI)
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang || 'en-US'
    } else {
      utterance.lang = 'en-US'
    }

    // Set rate, pitch, volume
    utterance.rate = options.rate ?? settings.rate ?? 1.0
    utterance.pitch = options.pitch ?? settings.pitch ?? 1.0
    utterance.volume = options.volume ?? settings.volume ?? 1.0

    utterance.onstart = () => {
      options.onStart?.()
    }

    utterance.onboundary = (event) => {
      options.onBoundary?.(event.charIndex)
    }

    utterance.onend = () => {
      this.currentUtterance = null
      options.onEnd?.()
    }

    utterance.onerror = (event) => {
      this.currentUtterance = null
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        options.onError?.(event)
      } else {
        options.onEnd?.()
      }
    }

    window.speechSynthesis.speak(utterance)
    return true
  }

  /**
   * Primary entry point for speech synthesis.
   * By default, routes to high-fidelity Neural AI Voice (smooth female voice),
   * or to Browser Voice if configured by the user.
   */
  public speak(text: string, options: TTSOptions = {}): boolean {
    const settings = loadVoiceSettings()
    const engine = settings.ttsEngine || 'neural'

    if (engine === 'neural' || options.neuralVoice) {
      void this.speakNeural(text, options, settings)
      return true
    }

    return this.speakNative(text, options, settings)
  }

  public stop() {
    if (this.activeAbortController) {
      this.activeAbortController.abort()
      this.activeAbortController = null
    }
    this.isSynthesizing = false
    this.cleanupAudio()

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
      this.currentUtterance = null
    }
  }

  public pause() {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause()
    } else if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.pause()
    }
  }

  public resume() {
    if (this.currentAudio && this.currentAudio.paused) {
      void this.currentAudio.play().catch(() => {})
    } else if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.resume()
    }
  }

  public isSpeaking(): boolean {
    if (this.isSynthesizing) return true
    if (this.currentAudio && !this.currentAudio.paused) return true
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      return window.speechSynthesis.speaking
    }
    return false
  }
}

export const tts = new TTSService()
