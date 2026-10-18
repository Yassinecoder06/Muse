import { api } from './api'
import type { STTOptions, STTState } from './voice.types'

// Declarations for browser SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition?: any
    webkitSpeechRecognition?: any
  }
}

class STTService {
  private recognition: any = null
  private state: STTState = 'idle'
  private currentOptions: STTOptions = {}
  private mediaRecorder: MediaRecorder | null = null
  private audioChunks: Blob[] = []
  private accumulatedFinalText = ''
  private silenceTimer: any = null

  private clearSilenceTimer() {
    if (this.silenceTimer) {
      window.clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
  }

  constructor() {
    this.initNativeRecognition()
  }

  private initNativeRecognition() {
    if (typeof window === 'undefined') return
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRec) {
      try {
        this.recognition = new SpeechRec()
      } catch (err) {
        console.warn('[STT] Failed to construct native SpeechRecognition:', err)
        this.recognition = null
      }
    }
  }

  public isSupported(): boolean {
    if (typeof window === 'undefined') return false
    const hasNative = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
    const hasMedia = Boolean(navigator?.mediaDevices?.getUserMedia)
    return hasNative || hasMedia
  }

  public hasNativeSupport(): boolean {
    return Boolean(typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition))
  }

  public getState(): STTState {
    return this.state
  }

  private setState(next: STTState) {
    this.state = next
    this.currentOptions.onStateChange?.(next)
  }

  public startListening(options: STTOptions = {}): boolean {
    if (this.state === 'listening' || this.state === 'processing') {
      this.stopListening()
      return false
    }

    this.currentOptions = options
    this.accumulatedFinalText = ''

    if (this.hasNativeSupport()) {
      return this.startNativeListening(options)
    } else {
      return this.startFallbackRecording(options)
    }
  }

  private resetSilenceTimer(timeoutMs = 4000) {
    this.clearSilenceTimer()
    if (timeoutMs > 0) {
      this.silenceTimer = window.setTimeout(() => {
        if (this.state === 'listening') {
          this.stopListening()
        }
      }, timeoutMs)
    }
  }

  private startNativeListening(options: STTOptions): boolean {
    try {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition
      this.recognition = new SpeechRec()

      // Enable continuous dictation by default so sentence pauses don't cut off speech
      this.recognition.continuous = options.continuous ?? true
      this.recognition.interimResults = options.interimResults ?? true
      this.recognition.lang = options.lang || 'en-US'
      this.recognition.maxAlternatives = 1

      const silenceTimeout = options.silenceTimeoutMs ?? 4000

      this.recognition.onstart = () => {
        this.setState('listening')
        this.resetSilenceTimer(silenceTimeout)
      }

      this.recognition.onresult = (event: any) => {
        // Reset silence timeout whenever voice activity is detected
        this.resetSilenceTimer(silenceTimeout)

        let interim = ''
        let newFinal = ''

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            newFinal += transcript
          } else {
            interim += transcript
          }
        }

        if (newFinal) {
          const trimmed = newFinal.trim()
          if (trimmed) {
            this.accumulatedFinalText += (this.accumulatedFinalText ? ' ' : '') + trimmed
            options.onFinal?.(this.accumulatedFinalText)
          }
        }

        const liveText = (this.accumulatedFinalText ? this.accumulatedFinalText + ' ' : '') + interim.trim()
        if (interim) {
          options.onInterim?.(liveText.trim())
        } else if (newFinal) {
          options.onInterim?.(this.accumulatedFinalText)
        }
      }

      this.recognition.onerror = (event: any) => {
        // Ignore benign no-speech pauses in continuous mode; let silence timeout manage cutoff
        if (event.error === 'no-speech') {
          return
        }
        console.warn('[STT] Recognition error:', event.error)
        this.clearSilenceTimer()
        if (event.error === 'not-allowed') {
          this.setState('error')
          options.onError?.('Microphone access was denied. Please allow microphone permissions.')
        } else {
          this.setState('error')
          options.onError?.(`Speech recognition error: ${event.error}`)
        }
      }

      this.recognition.onend = () => {
        this.clearSilenceTimer()
        if (this.state === 'listening') {
          this.setState('idle')
          if (this.accumulatedFinalText) {
            options.onFinal?.(this.accumulatedFinalText)
            options.onComplete?.(this.accumulatedFinalText)
          }
        }
      }

      this.recognition.start()
      return true
    } catch (err: any) {
      console.error('[STT] Failed to start native recognition:', err)
      this.clearSilenceTimer()
      this.setState('error')
      options.onError?.(err?.message || 'Failed to start speech recognition.')
      return false
    }
  }

  private startFallbackRecording(options: STTOptions): boolean {
    if (!navigator?.mediaDevices?.getUserMedia) {
      this.setState('error')
      options.onError?.('Microphone input is not supported in this browser.')
      return false
    }

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(stream => {
        this.audioChunks = []
        const mimeType = MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/wav'

        this.mediaRecorder = new MediaRecorder(stream, { mimeType })

        this.mediaRecorder.ondataavailable = e => {
          if (e.data.size > 0) {
            this.audioChunks.push(e.data)
          }
        }

        this.mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(track => track.stop())
          if (this.audioChunks.length === 0) {
            this.setState('idle')
            return
          }

          this.setState('processing')
          try {
            const audioBlob = new Blob(this.audioChunks, { type: mimeType })
            const result = await api.transcribeAudio(audioBlob)
            if (result && result.text) {
              this.accumulatedFinalText = result.text.trim()
              options.onFinal?.(this.accumulatedFinalText)
            }
          } catch (err: any) {
            console.error('[STT Fallback] Server transcription failed:', err)
            options.onError?.('Audio transcription failed. Ensure Gemini API key is configured.')
          } finally {
            this.setState('idle')
          }
        }

        this.mediaRecorder.start()
        this.setState('listening')
      })
      .catch(err => {
        console.error('[STT Fallback] Microphone access error:', err)
        this.setState('error')
        options.onError?.('Microphone access was denied. Please allow microphone access in your browser.')
      })

    return true
  }

  public stopListening() {
    this.clearSilenceTimer()

    if (this.recognition && this.state === 'listening') {
      try {
        this.recognition.stop()
      } catch {}
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop()
      } catch {}
    }

    if (this.state !== 'processing') {
      this.setState('idle')
      if (this.accumulatedFinalText) {
        this.currentOptions.onComplete?.(this.accumulatedFinalText)
      }
    }
  }

  public cancel() {
    this.clearSilenceTimer()
    this.accumulatedFinalText = ''

    if (this.recognition) {
      try {
        this.recognition.abort()
      } catch {}
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop()
      } catch {}
    }
    this.setState('idle')
  }
}

export const stt = new STTService()
