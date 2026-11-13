import { useEffect, useState } from 'react'
import { Bot, Cpu, Mic, Sparkles, Volume2 } from 'lucide-react'
import { robotAudio, loadVoiceSettings, saveVoiceSettings } from '../../../services/robot-audio.service'
import { tts } from '../../../services/tts.service'
import { CURATED_NEURAL_VOICES } from '../../../services/voice.types'
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from '../ui'

export function VoiceSection() {
  const [voiceSettings, setVoiceSettings] = useState(() => loadVoiceSettings())
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    const english = tts.getEnglishVoices()
    setAvailableVoices(english.length > 0 ? english : tts.getVoices())
  }, [])

  const update = (updates: Partial<typeof voiceSettings>) => setVoiceSettings(saveVoiceSettings(updates))

  return (
    <SettingsSection title="Voice & sound" description="How Bip speaks, listens, and sounds.">
      <SettingsCard title="Read aloud" icon={<Volume2 size={16}/>}>
        <SettingsRow label="Text-to-speech engine" description="Voice synthesis for reading notes and Bip's speech.">
          <select
            className="setting-select"
            value={voiceSettings.ttsEngine || 'neural'}
            onChange={e => update({ ttsEngine: e.target.value as 'neural' | 'native' })}
          >
            <option value="neural">Muse voice (your read-aloud choice in AI providers)</option>
            <option value="native">Browser built-in voice (offline)</option>
          </select>
        </SettingsRow>
        {(voiceSettings.ttsEngine || 'neural') === 'neural' ? (
          <SettingsRow icon={<Sparkles size={15}/>} label="Edge neural voice" description="Used when read-aloud is set to the Edge voices.">
            <select className="setting-select" value={voiceSettings.neuralVoice || 'en-US-JennyNeural'} onChange={e => update({ neuralVoice: e.target.value })}>
              {CURATED_NEURAL_VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </SettingsRow>
        ) : (
          <SettingsRow label="Browser voice" description="Voice used for the browser's built-in speech.">
            <select className="setting-select" value={voiceSettings.voiceURI} onChange={e => update({ voiceURI: e.target.value })}>
              <option value="">Default (best English voice)</option>
              {availableVoices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
          </SettingsRow>
        )}
        <SettingsRow icon={<Cpu size={15}/>} label={`Speech speed (${voiceSettings.rate.toFixed(1)}x)`} description="Pace of read-aloud playback.">
          <div className="setting-slider-wrap">
            <input type="range" min="0.8" max="1.4" step="0.05" value={voiceSettings.rate} onChange={e => update({ rate: parseFloat(e.target.value) })}/>
          </div>
        </SettingsRow>
        <SettingsRow label="Auto-read Bip's replies" description="Speak Bip's answers as soon as they arrive.">
          <SettingsSwitch checked={!!voiceSettings.autoReadAloud} onChange={next => update({ autoReadAloud: next })} label="Auto-read Bip's replies"/>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title="Dictation" icon={<Mic size={16}/>}>
        <SettingsRow label="Speech-to-text" description="Transcription engine for microphone dictation.">
          <select
            className="setting-select"
            value={voiceSettings.sttEngine || 'gemini'}
            onChange={e => update({ sttEngine: e.target.value as 'gemini' | 'native' })}
          >
            <option value="gemini">Muse server (your dictation choice in AI providers)</option>
            <option value="native">Browser speech recognition (built-in)</option>
          </select>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title="Bip sounds" icon={<Bot size={16}/>}>
        <SettingsRow label="Robot sound effects" description="Chirps, boops, thinking pulses, and drag reactions.">
          <SettingsSwitch
            checked={!!voiceSettings.soundEffectsEnabled}
            onChange={next => { update({ soundEffectsEnabled: next }); if (next) robotAudio.play('chirp') }}
            label="Robot sound effects"
          />
        </SettingsRow>
        {voiceSettings.soundEffectsEnabled ? (
          <SettingsRow label={`Volume (${Math.round(voiceSettings.soundEffectsVolume * 100)}%)`} description="Loudness of Bip's sounds.">
            <div className="setting-slider-wrap">
              <input type="range" min="0.1" max="1.0" step="0.05" value={voiceSettings.soundEffectsVolume} onChange={e => update({ soundEffectsVolume: parseFloat(e.target.value) })}/>
            </div>
          </SettingsRow>
        ) : null}
      </SettingsCard>

      <div className="setting-actions-row">
        <button
          type="button"
          className="setting-test-btn"
          onClick={() => { robotAudio.play('chirp'); tts.speak("Hello! I'm Bip, your Muse AI assistant. My voice is smooth, clear, and ready to assist you!") }}
        >
          <Volume2 size={14}/> Test voice
        </button>
        <button type="button" className="setting-test-btn" onClick={() => robotAudio.play('excited')}>
          <Bot size={14}/> Test robot sound
        </button>
      </div>
    </SettingsSection>
  )
}
