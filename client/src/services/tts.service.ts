import { loadVoiceSettings } from './robot-audio.service'
import type { TTSOptions } from './voice.types'

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

    // Rank preferred natural English voices
    const priorityKeywords = [
      'natural',
      'google us english',
      'google uk english female',
      'samantha',
      'daniel',
      'karen',
      'alex',
      'jenny',
      'guy'
    ]

    for (const kw of priorityKeywords) {
      const match = englishVoices.find(v => v.name.toLowerCase().includes(kw))
      if (match) return match
    }

    // Default to first English US/GB voice or first English voice
    const usOrGb = englishVoices.find(v => v.lang.includes('US') || v.lang.includes('GB'))
    return usOrGb || englishVoices[0]
  }

  public speak(text: string, options: TTSOptions = {}): boolean {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return false
    }

    this.stop()

    const cleanedText = cleanMarkdownForSpeech(text)
    if (!cleanedText) {
      options.onEnd?.()
      return false
    }

    const settings = loadVoiceSettings()
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
      // 'canceled' or 'interrupted' is normal when user switches note/message
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        options.onError?.(event)
      } else {
        options.onEnd?.()
      }
    }

    window.speechSynthesis.speak(utterance)
    return true
  }

  public stop() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
      this.currentUtterance = null
    }
  }

  public pause() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.pause()
    }
  }

  public resume() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.resume()
    }
  }

  public isSpeaking(): boolean {
    if (typeof window === 'undefined' || !window.speechSynthesis) return false
    return window.speechSynthesis.speaking
  }
}

export const tts = new TTSService()
