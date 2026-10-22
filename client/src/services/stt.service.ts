import { api } from './api'
import { robotAudio, loadVoiceSettings } from './robot-audio.service'
import type { STTOptions, STTState } from './voice.types'

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
  private audioStream: MediaStream | null = null
  private audioChunks: Blob[] = []
  private accumulatedFinalText = ''
  private isListeningActive = false
  private restartTimeoutId: any = null
  private silenceTimer: any = null
  private audioCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private animFrameId: number | null = null

  constructor() {
    this.initNativeRecognition()
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) {
      window.clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
  }

  private stopAudioContext() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        void this.audioCtx.close()
      } catch {}
      this.audioCtx = null
    }
    this.analyser = null
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
    this.isListeningActive = true
    if (this.restartTimeoutId) {
      clearTimeout(this.restartTimeoutId)
      this.restartTimeoutId = null
    }

    // Running accumulator: preserve initial text if provided, rather than discarding
    this.accumulatedFinalText = options.initialText ? options.initialText.trim() : ''

    const settings = loadVoiceSettings()
    const engine = settings.sttEngine || 'gemini'

    if (engine === 'gemini') {
      return this.startGeminiRecording(options)
    }

    if (this.hasNativeSupport()) {
      return this.startNativeListening(options)
    }

    return this.startGeminiRecording(options)
  }

  public getAccumulatedText(): string {
    return this.accumulatedFinalText
  }

  public setAccumulatedText(text: string) {
    this.accumulatedFinalText = text.trim()
  }

  private resetSilenceTimer(timeoutMs = 15000) {
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

      this.recognition.continuous = options.continuous ?? true
      this.recognition.interimResults = options.interimResults ?? true
      this.recognition.lang = options.lang || 'en-US'
      this.recognition.maxAlternatives = 1

      // 15 seconds default pause tolerance to support hands-free thinking pauses
      const silenceTimeout = options.silenceTimeoutMs ?? 15000

      this.recognition.onstart = () => {
        // DO NOT reset accumulatedFinalText on onstart! Preserves running accumulator across pause/onend cycles
        this.setState('listening')
        this.resetSilenceTimer(silenceTimeout)
      }

      this.recognition.onresult = (event: any) => {
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
            // Append new final text onto the running accumulator, never overwriting previous chunks
            this.accumulatedFinalText += (this.accumulatedFinalText ? ' ' : '') + trimmed
            options.onFinalSegment?.(trimmed)
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
        if (event.error === 'no-speech' || event.error === 'aborted') {
          // Normal pause in dictation; do not abort running session
          return
        }
        console.warn('[STT] Native recognition error:', event.error)
        this.clearSilenceTimer()
        this.isListeningActive = false
        if (event.error === 'not-allowed') {
          this.setState('error')
          options.onError?.('Microphone access was denied. Please allow microphone permissions in your browser.')
        } else {
          this.setState('error')
          options.onError?.(`Speech recognition error: ${event.error}`)
        }
      }

      this.recognition.onend = () => {
        // Platform ended the recognition stream (browsers do this on silence/pauses)
        if (this.isListeningActive && (options.continuous ?? true)) {
          // User has not clicked Stop; auto-restart recognition to preserve hands-free dictation across pauses
          if (this.restartTimeoutId) clearTimeout(this.restartTimeoutId)
          this.restartTimeoutId = setTimeout(() => {
            if (this.isListeningActive && this.recognition) {
              try {
                this.recognition.start()
              } catch (restartErr) {
                console.debug('[STT] Recognition auto-restart retry:', restartErr)
              }
            }
          }, 150)
          return
        }

        this.clearSilenceTimer()
        this.isListeningActive = false
        if (this.state === 'listening') {
          this.setState('idle')
          if (this.accumulatedFinalText) {
            options.onFinal?.(this.accumulatedFinalText)
            options.onComplete?.(this.accumulatedFinalText)
          }
        }
      }

      this.isListeningActive = true
      this.recognition.start()
      return true
    } catch (err: any) {
      console.error('[STT] Failed to start native recognition:', err)
      this.isListeningActive = false
      this.clearSilenceTimer()
      this.setState('error')
      options.onError?.(err?.message || 'Failed to start speech recognition.')
      return false
    }
  }

  private startGeminiRecording(options: STTOptions): boolean {
    if (!navigator?.mediaDevices?.getUserMedia) {
      if (this.hasNativeSupport()) {
        return this.startNativeListening(options)
      }
      this.setState('error')
      options.onError?.('Microphone audio recording is not supported in this browser.')
      return false
    }

    navigator.mediaDevices
      .getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      })
      .then(stream => {
        this.audioStream = stream
        this.audioChunks = []

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/wav'

        try {
          this.mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
        } catch {
          this.mediaRecorder = new MediaRecorder(stream)
        }

        this.mediaRecorder.ondataavailable = e => {
          if (e.data && e.data.size > 0) {
            this.audioChunks.push(e.data)
          }
        }

        // Setup voice activity and silence detection via AnalyserNode
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
          if (AudioContextClass) {
            this.audioCtx = new AudioContextClass()
            const source = this.audioCtx.createMediaStreamSource(stream)
            this.analyser = this.audioCtx.createAnalyser()
            this.analyser.fftSize = 512
            source.connect(this.analyser)

            const dataArray = new Uint8Array(this.analyser.frequencyBinCount)
            let hasSpoken = false
            const silenceTimeout = options.silenceTimeoutMs ?? 4500

            const checkAudioLevel = () => {
              if (this.state !== 'listening' || !this.analyser) return
              this.analyser.getByteFrequencyData(dataArray)
              let sum = 0
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i]
              }
              const average = sum / dataArray.length

              // Threshold for speech detection
              if (average > 14) {
                if (!hasSpoken) hasSpoken = true
                this.resetSilenceTimer(silenceTimeout)
              }

              this.animFrameId = requestAnimationFrame(checkAudioLevel)
            }
            this.animFrameId = requestAnimationFrame(checkAudioLevel)
          }
        } catch (audioCtxErr) {
          console.warn('[STT] Could not initialize audio level analyzer:', audioCtxErr)
        }

        this.mediaRecorder.onstop = async () => {
          this.stopAudioContext()
          if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop())
            this.audioStream = null
          }

          if (this.audioChunks.length === 0) {
            this.setState('idle')
            return
          }

          this.setState('processing')

          try {
            const actualMime = this.mediaRecorder?.mimeType || mimeType
            const audioBlob = new Blob(this.audioChunks, { type: actualMime })

            if (audioBlob.size < 600) {
              this.setState('idle')
              return
            }

            const result = await api.transcribeAudio(audioBlob)
            const text = result?.text?.trim() || ''

            if (text) {
              this.accumulatedFinalText += (this.accumulatedFinalText ? ' ' : '') + text
              options.onFinalSegment?.(text)
              options.onFinal?.(this.accumulatedFinalText)
              options.onComplete?.(this.accumulatedFinalText)
              robotAudio.play('success')
            }
          } catch (err: any) {
            console.error('[STT Gemini] Server transcription error:', err)
            if (err?.useBrowser && this.hasNativeSupport()) {
              console.log('[STT] Switching to native browser speech recognition...')
              this.startNativeListening(options)
              return
            }
            const errMsg = err?.message || 'Gemini speech transcription failed.'
            if (errMsg.toLowerCase().includes('gemini api key is required') || errMsg.toLowerCase().includes('no speech-to-text')) {
              if (this.hasNativeSupport()) {
                console.log('[STT] Falling back to native browser speech recognition...')
                this.startNativeListening(options)
                return
              }
              options.onError?.('Gemini API key required for AI speech recognition. Configure your key in Settings.')
            } else {
              options.onError?.(errMsg)
            }
          } finally {
            if (this.state === 'processing') {
              this.setState('idle')
            }
          }
        }

        this.mediaRecorder.start(250)
        this.setState('listening')
        this.resetSilenceTimer(options.silenceTimeoutMs ?? 6000)
      })
      .catch(err => {
        console.error('[STT Gemini] getUserMedia error:', err)
        this.setState('error')
        options.onError?.('Microphone access was denied. Please allow microphone permissions in your browser.')
      })

    return true
  }

  public stopListening() {
    this.isListeningActive = false
    if (this.restartTimeoutId) {
      clearTimeout(this.restartTimeoutId)
      this.restartTimeoutId = null
    }
    this.clearSilenceTimer()
    this.stopAudioContext()

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
    this.isListeningActive = false
    if (this.restartTimeoutId) {
      clearTimeout(this.restartTimeoutId)
      this.restartTimeoutId = null
    }
    this.clearSilenceTimer()
    this.stopAudioContext()
    this.accumulatedFinalText = ''

    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop())
      this.audioStream = null
    }

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
