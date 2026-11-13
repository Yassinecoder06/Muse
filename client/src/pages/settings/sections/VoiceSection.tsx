import { useEffect, useState } from 'react'
import { Bot, Check, Gauge, Mic, RotateCcw, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { robotAudio, loadVoiceSettings, saveVoiceSettings } from '../../../services/robot-audio.service'
import { tts } from '../../../services/tts.service'
import { CURATED_NEURAL_VOICES } from '../../../services/voice.types'
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from '../ui'
import './voice-security.css'

export function VoiceSection() {
  const [voiceSettings, setVoiceSettings] = useState(() => loadVoiceSettings())
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [isSpeaking, setIsSpeaking] = useState(false)

  useEffect(() => {
    const english = tts.getEnglishVoices()
    setAvailableVoices(english.length > 0 ? english : tts.getVoices())

    const handleVoicesChanged = () => {
      const eng = tts.getEnglishVoices()
      setAvailableVoices(eng.length > 0 ? eng : tts.getVoices())
    }

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged)
      return () => {
        window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged)
        tts.stop()
      }
    }
    return () => {
      tts.stop()
    }
  }, [])

  const update = (updates: Partial<typeof voiceSettings>) => setVoiceSettings(saveVoiceSettings(updates))

  const handleTestVoice = () => {
    if (isSpeaking) {
      tts.stop()
      setIsSpeaking(false)
      return
    }

    robotAudio.play('chirp')
    setIsSpeaking(true)
    tts.speak("Hello! I'm Bip, your Muse AI assistant. My voice is smooth, clear, and ready to assist you!", {
      onEnd: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false)
    })
  }

  const hasNativeSTT = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)

  return (
    <SettingsSection title="Voice & sound" description="How Bip speaks, listens, and sounds.">
      {/* 1. Read Aloud */}
      <SettingsCard
        title="Read aloud"
        description="Text-to-speech synthesis for reading notes and Bip's spoken responses."
        icon={<Volume2 size={16}/>}
        actions={
          <button
            type="button"
            className={`vs-btn ${isSpeaking ? 'vs-btn-danger' : 'vs-btn-secondary'}`}
            onClick={handleTestVoice}
            aria-label={isSpeaking ? 'Stop voice sample' : 'Test voice sample'}
          >
            {isSpeaking ? <VolumeX size={14}/> : <Volume2 size={14}/>}
            {isSpeaking ? 'Stop voice' : 'Test voice'}
          </button>
        }
      >
        <SettingsRow label="Text-to-speech engine" description="Voice synthesis engine for reading notes and Bip's speech.">
          <select
            className="vs-select"
            value={voiceSettings.ttsEngine || 'neural'}
            onChange={e => update({ ttsEngine: e.target.value as 'neural' | 'native' })}
          >
            <option value="neural">Muse voice (your read-aloud choice in AI providers)</option>
            <option value="native">Browser built-in voice (offline)</option>
          </select>
        </SettingsRow>

        {(voiceSettings.ttsEngine || 'neural') === 'neural' ? (
          <SettingsRow icon={<Sparkles size={15}/>} label="Edge neural voice" description="Natural neural voice preset.">
            <select
              className="vs-select"
              value={voiceSettings.neuralVoice || 'en-US-JennyNeural'}
              onChange={e => update({ neuralVoice: e.target.value })}
            >
              {CURATED_NEURAL_VOICES.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </SettingsRow>
        ) : (
          <SettingsRow icon={<Volume2 size={15}/>} label="Browser voice" description="Voice used for browser built-in speech synthesis.">
            <select
              className="vs-select"
              value={voiceSettings.voiceURI}
              onChange={e => update({ voiceURI: e.target.value })}
            >
              <option value="">Default (best English voice)</option>
              {availableVoices.map(v => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
              ))}
            </select>
          </SettingsRow>
        )}

        <SettingsRow icon={<Gauge size={15}/>} label="Speech speed" description="Playback pace for reading notes and replies.">
          <div className="vs-slider-group">
            <input
              type="range"
              className="vs-range"
              min="0.8"
              max="1.4"
              step="0.05"
              value={voiceSettings.rate}
              onChange={e => update({ rate: parseFloat(e.target.value) })}
              aria-label="Speech speed"
            />
            <span className="vs-badge">{voiceSettings.rate.toFixed(2)}x</span>
            {voiceSettings.rate !== 1.0 && (
              <button
                type="button"
                className="vs-btn-ghost"
                onClick={() => update({ rate: 1.0 })}
                title="Reset speed to 1.0x"
              >
                <RotateCcw size={12}/>
              </button>
            )}
          </div>
        </SettingsRow>

        <SettingsRow label="Auto-read Bip's replies" description="Speak Bip's answers automatically as soon as they arrive.">
          <SettingsSwitch
            checked={!!voiceSettings.autoReadAloud}
            onChange={next => update({ autoReadAloud: next })}
            label="Auto-read Bip's replies"
          />
        </SettingsRow>
      </SettingsCard>

      {/* 2. Dictation */}
      <SettingsCard
        title="Dictation"
        description="Speech recognition for voice notes and chatting with Bip."
        icon={<Mic size={16}/>}
      >
        <SettingsRow label="Speech-to-text" description="Transcription engine for microphone voice dictation.">
          <select
            className="vs-select"
            value={voiceSettings.sttEngine || 'gemini'}
            onChange={e => update({ sttEngine: e.target.value as 'gemini' | 'native' })}
          >
            <option value="gemini">Muse server (your dictation choice in AI providers)</option>
            <option value="native">Browser speech recognition (built-in)</option>
          </select>
        </SettingsRow>

        <SettingsRow label="Recognition capability" description="Browser support for real-time speech recognition.">
          <span className={`vs-status-pill ${hasNativeSTT ? 'success' : ''}`}>
            {hasNativeSTT ? <Check size={12}/> : <Mic size={12}/>}
            {hasNativeSTT ? 'Web Speech supported' : 'Server STT recommended'}
          </span>
        </SettingsRow>
      </SettingsCard>

      {/* 3. Bip Sounds */}
      <SettingsCard
        title="Bip sounds"
        description="Interactive robot audio cues, chirps, and emotional feedback."
        icon={<Bot size={16}/>}
        actions={
          <button
            type="button"
            className="vs-btn vs-btn-secondary"
            onClick={() => robotAudio.play('excited')}
            disabled={!voiceSettings.soundEffectsEnabled}
            title="Play sample sound effect"
          >
            <Bot size={14}/> Test sound
          </button>
        }
      >
        <SettingsRow label="Robot sound effects" description="Chirps, boops, thinking pulses, completed tasks, and drag reactions.">
          <SettingsSwitch
            checked={!!voiceSettings.soundEffectsEnabled}
            onChange={next => {
              update({ soundEffectsEnabled: next })
              if (next) robotAudio.play('chirp')
            }}
            label="Robot sound effects"
          />
        </SettingsRow>

        {voiceSettings.soundEffectsEnabled ? (
          <>
            <SettingsRow label="Sound effects volume" description="Master loudness of Bip's robot sounds.">
              <div className="vs-slider-group">
                <input
                  type="range"
                  className="vs-range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={voiceSettings.soundEffectsVolume}
                  onChange={e => update({ soundEffectsVolume: parseFloat(e.target.value) })}
                  aria-label="Sound volume"
                />
                <span className="vs-badge">{Math.round(voiceSettings.soundEffectsVolume * 100)}%</span>
              </div>
            </SettingsRow>

            <SettingsRow label="Sound samples" description="Preview different robot audio cues at the current volume.">
              <div className="vs-sound-chips">
                <button type="button" className="vs-chip" onClick={() => robotAudio.play('chirp')}>Chirp</button>
                <button type="button" className="vs-chip" onClick={() => robotAudio.play('boop')}>Boop</button>
                <button type="button" className="vs-chip" onClick={() => robotAudio.play('blip')}>Blip</button>
                <button type="button" className="vs-chip" onClick={() => robotAudio.play('excited')}>Excited</button>
                <button type="button" className="vs-chip" onClick={() => robotAudio.play('success')}>Success</button>
              </div>
            </SettingsRow>
          </>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  )
}
