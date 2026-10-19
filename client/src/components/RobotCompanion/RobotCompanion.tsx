import React, { useEffect, useRef, useState } from 'react'
import { ArrowUp, Calendar, CheckSquare, FileText, Lightbulb, Loader2, Maximize2, Mic, MicOff, Pencil, RotateCcw, Sparkles, Square, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { BipFigure, type BipMood } from './BipFigure'
import { FormattedMessage } from '../FormattedMessage'
import { ActionCards } from '../ActionCards'
import { api } from '../../services/api'
import { chatModel } from '../../services/settings'
import { robotAudio, loadVoiceSettings, saveVoiceSettings } from '../../services/robot-audio.service'
import { tts } from '../../services/tts.service'
import { stt } from '../../services/stt.service'
import { useQueryClient } from '@tanstack/react-query'
import type { ActionCard } from '../../types'
import './bip.css'

interface RobotCompanionProps {
  onCreateNote?: (input?: { title?: string; content?: string }) => void
  onNavigate?: (path: string) => void
  currentPath?: string
}

interface Message {
  id?: string
  role: 'assistant' | 'user'
  text: string
  sources?: { id: string; title: string }[]
  action_cards?: ActionCard[]
}

const DEFAULT_GREETING: Message = {
  role: 'assistant',
  text: "Beep boop! 🤖 I'm Bip, your autonomous helper! I can create notes, manage tasks, schedule events, remember facts, or delete anything you don't need — just ask!"
}

const BIP_WIDTH = 76
const BIP_HEIGHT = 92
const EDGE_PADDING = 16

function clampPosition(x: number, y: number) {
  const winWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
  const winHeight = typeof window !== 'undefined' ? window.innerHeight : 800
  const maxX = Math.max(EDGE_PADDING, winWidth - BIP_WIDTH - EDGE_PADDING)
  const maxY = Math.max(EDGE_PADDING, winHeight - BIP_HEIGHT - EDGE_PADDING)
  return {
    x: Math.min(Math.max(EDGE_PADDING, Math.round(x)), maxX),
    y: Math.min(Math.max(EDGE_PADDING, Math.round(y)), maxY)
  }
}

export function RobotCompanion({ onCreateNote, onNavigate }: RobotCompanionProps) {
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const [mood, setMood] = useState<BipMood>('idle')
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([DEFAULT_GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sttState, setSttState] = useState<'idle' | 'listening' | 'processing' | 'error'>('idle')
  const isListening = sttState === 'listening'
  const isProcessingVoice = sttState === 'processing'
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [companionEditDraft, setCompanionEditDraft] = useState('')
  const [isSavingCompanionEdit, setIsSavingCompanionEdit] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(() => loadVoiceSettings().soundEffectsEnabled)
  const lastHoverSoundRef = useRef<number>(0)
  const [sessionId, setSessionId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('muse-bip-session-id')
    } catch {
      return null
    }
  })

  // Position management with automatic boundary clamping
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem('muse-bip-pos')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return clampPosition(parsed.x, parsed.y)
        }
      }
    } catch {}
    const defaultX = typeof window !== 'undefined' ? window.innerWidth - BIP_WIDTH - 24 : 100
    const defaultY = typeof window !== 'undefined' ? window.innerHeight - BIP_HEIGHT - 24 : 100
    return clampPosition(defaultX, defaultY)
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const idleTimerRef = useRef<number | null>(null)

  const dragRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
    hasMoved: boolean
    pointerId: number | null
  }>({
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    hasMoved: false,
    pointerId: null
  })

  // Keep Bip inside viewport on window resize
  useEffect(() => {
    function handleResize() {
      setPos(prev => {
        const clamped = clampPosition(prev.x, prev.y)
        if (clamped.x !== prev.x || clamped.y !== prev.y) {
          return clamped
        }
        return prev
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Gaze tracking - Eyes follow cursor
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      // Reset sleep state on movement
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = window.setTimeout(() => {
        if (!isOpen && !loading) {
          setMood('sleeping')
        }
      }, 75000) // Sleep after 75s of idle

      if (mood === 'sleeping') {
        setMood('curious')
      }

      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + 40

        const dx = e.clientX - centerX
        const dy = e.clientY - centerY
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist > 15) {
          const factor = Math.min(1, 350 / dist)
          setEyeOffset({
            x: Math.max(-4, Math.min(4, (dx / 60) * factor)),
            y: Math.max(-3, Math.min(3, (dy / 70) * factor))
          })
        }
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current)
    }
  }, [mood, isOpen, loading])

  // Scroll to bottom of chat
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  // Occasional cute hints when idle
  useEffect(() => {
    const hints = [
      'Click me to chat! ✨',
      'Need an idea? Ask away! 💡',
      'You can drag me anywhere! 🚀',
      'Always ready to help! 🤖'
    ]
    const hintInterval = window.setInterval(() => {
      if (!isOpen && mood !== 'sleeping' && Math.random() > 0.6) {
        const picked = hints[Math.floor(Math.random() * hints.length)]
        setHint(picked)
        window.setTimeout(() => setHint(null), 4500)
      }
    }, 28000)

    return () => window.clearInterval(hintInterval)
  }, [isOpen, mood])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    robotAudio.play('whoosh')
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      hasMoved: false,
      pointerId: e.pointerId
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current.pointerId !== e.pointerId) return

    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY

    if (!dragRef.current.hasMoved && Math.hypot(dx, dy) > 4) {
      dragRef.current.hasMoved = true
      setIsDragging(true)
    }

    if (dragRef.current.hasMoved) {
      const nextPos = clampPosition(
        dragRef.current.originX + dx,
        dragRef.current.originY + dy
      )
      setPos(nextPos)
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current.pointerId !== e.pointerId) return

    const moved = dragRef.current.hasMoved
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {}
    dragRef.current.pointerId = null

    if (moved) {
      robotAudio.play('boop')
      setPos(current => {
        const clamped = clampPosition(current.x, current.y)
        try {
          localStorage.setItem('muse-bip-pos', JSON.stringify(clamped))
        } catch {}
        return clamped
      })
      setTimeout(() => {
        setIsDragging(false)
        dragRef.current.hasMoved = false
      }, 60)
    } else {
      setIsDragging(false)
    }
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current.pointerId === e.pointerId) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      } catch {}
      dragRef.current.pointerId = null
      setIsDragging(false)
      dragRef.current.hasMoved = false
    }
  }

  function handleFigureClick() {
    if (dragRef.current.hasMoved || isDragging) return
    robotAudio.play(isOpen ? 'boop' : 'chirp')
    setIsOpen(prev => !prev)
    setMood(isOpen ? 'idle' : 'happy')
    setHint(null)
  }

  const handleToggleSound = () => {
    const next = !soundEnabled
    setSoundEnabled(next)
    saveVoiceSettings({ soundEffectsEnabled: next })
    if (next) {
      robotAudio.play('blip')
    }
  }

  const handleSpeakMessage = (index: number, text: string) => {
    if (speakingIndex === index && isSpeaking) {
      tts.stop()
      setIsSpeaking(false)
      setSpeakingIndex(null)
      return
    }

    tts.stop()
    setIsSpeaking(true)
    setSpeakingIndex(index)
    setMood('excited')

    tts.speak(text, {
      onStart: () => {
        setIsSpeaking(true)
        setSpeakingIndex(index)
      },
      onEnd: () => {
        setIsSpeaking(false)
        setSpeakingIndex(null)
        setMood('idle')
      },
      onError: () => {
        setIsSpeaking(false)
        setSpeakingIndex(null)
        setMood('idle')
      }
    })
  }

  const handleToggleMic = () => {
    if (isListening || isProcessingVoice) {
      stt.stopListening()
      return
    }

    robotAudio.play('blip')
    stt.startListening({
      continuous: true,
      silenceTimeoutMs: 5000,
      onInterim: interim => {
        setInput(interim)
      },
      onFinal: final => {
        setInput(final)
      },
      onComplete: final => {
        setInput(final)
      },
      onStateChange: state => {
        setSttState(state)
      },
      onError: err => {
        setSttState('idle')
        setHint(err)
        window.setTimeout(() => setHint(null), 4000)
      }
    })
  }

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId
    const stored = sessionStorage.getItem('muse-bip-session-id')
    if (stored) {
      setSessionId(stored)
      return stored
    }
    const created = await api.createChatSession({ title: 'Bip Helper' })
    sessionStorage.setItem('muse-bip-session-id', created.id)
    setSessionId(created.id)
    return created.id
  }

  async function handleSend(textToSend?: string) {
    const query = (textToSend || input).trim()
    if (!query || loading) return

    if (isListening || isProcessingVoice) {
      stt.stopListening()
      setSttState('idle')
    }

    robotAudio.play('blip')
    setInput('')
    const tempId = `temp-${Date.now()}`
    setMessages(prev => [...prev, { id: tempId, role: 'user', text: query }])
    setLoading(true)
    setMood('thinking')
    robotAudio.startThinkingLoop()

    try {
      const activeId = await ensureSession()
      const res = await api.sendChatMessage(activeId, {
        message: query,
        model: chatModel() || undefined
      })

      robotAudio.stopThinkingLoop()
      const hasActions = (res.assistantMessage.action_cards?.length || 0) > 0
      robotAudio.play(hasActions ? 'excited' : 'success')

      const newMsg: Message = {
        id: res.assistantMessage.id,
        role: 'assistant',
        text: res.assistantMessage.content,
        action_cards: res.assistantMessage.action_cards
      }

      setMessages(prev => {
        const updated = prev.map(m => m.id === tempId ? { ...m, id: res.userMessage.id } : m)
        const nextList = [...updated, newMsg]
        // Auto-read aloud if enabled in settings
        const currentVoiceSettings = loadVoiceSettings()
        if (currentVoiceSettings.autoReadAloud) {
          setTimeout(() => {
            handleSpeakMessage(nextList.length - 1, newMsg.text)
          }, 200)
        }
        return nextList
      })

      // Invalidate queries so deleted/created items reflect across views
      if (hasActions) {
        queryClient.invalidateQueries({ queryKey: ['notes'] })
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['calendar'] })
        queryClient.invalidateQueries({ queryKey: ['specialized-templates'] })
      }

      setMood(hasActions ? 'excited' : 'happy')
      window.setTimeout(() => setMood('idle'), 3500)
    } catch (err) {
      robotAudio.stopThinkingLoop()
      robotAudio.play('error')
      const rawMsg = err instanceof Error ? err.message : String(err || '')
      let cleanMsg = rawMsg
      if (rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('quota')) {
        cleanMsg = 'All AI model quotas have been exhausted for today across all fallback models. You can add an Ollama key in Settings or wait for the daily reset.'
      } else if (rawMsg.startsWith('{')) {
        try {
          const parsed = JSON.parse(rawMsg)
          cleanMsg = parsed.error?.message || cleanMsg
        } catch {}
      }
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text: `*Beep* ⚠️ ${cleanMsg}`
        }
      ])
      setMood('curious')
    } finally {
      setLoading(false)
    }
  }

  const handleStartEdit = (index: number, currentText: string) => {
    setEditingIndex(index)
    setCompanionEditDraft(currentText)
  }

  const handleCancelEdit = () => {
    setEditingIndex(null)
    setCompanionEditDraft('')
  }

  const handleSaveEdit = async (index: number, resend = false) => {
    const newText = companionEditDraft.trim()
    if (!newText) return
    const targetMsg = messages[index]
    setIsSavingCompanionEdit(true)
    try {
      if (targetMsg?.id && !targetMsg.id.startsWith('temp-') && !targetMsg.id.startsWith('err-')) {
        await api.updateChatMessage(targetMsg.id, { content: newText })
      }
      setMessages(prev => prev.map((m, i) => i === index ? { ...m, text: newText } : m))
      setEditingIndex(null)
      setCompanionEditDraft('')
      robotAudio.play('blip')
      if (resend) {
        void handleSend(newText)
      }
    } catch (err) {
      console.error('Failed to update companion message:', err)
    } finally {
      setIsSavingCompanionEdit(false)
    }
  }

  const handleDeleteMessage = async (index: number) => {
    const targetMsg = messages[index]
    try {
      if (targetMsg?.id && !targetMsg.id.startsWith('temp-') && !targetMsg.id.startsWith('err-')) {
        await api.deleteChatMessage(targetMsg.id)
      }
      setMessages(prev => prev.filter((_, i) => i !== index))
      robotAudio.play('boop')
    } catch (err) {
      console.error('Failed to delete companion message:', err)
    }
  }

  const handleReset = () => {
    robotAudio.play('boop')
    tts.stop()
    setIsSpeaking(false)
    setSpeakingIndex(null)
    sessionStorage.removeItem('muse-bip-session-id')
    setSessionId(null)
    setMessages([DEFAULT_GREETING])
    setMood('happy')
    window.setTimeout(() => setMood('idle'), 1500)
  }

  function handleQuickAction(action: 'new-note' | 'tasks' | 'calendar' | 'idea') {
    robotAudio.play('blip')
    if (action === 'new-note') {
      onCreateNote?.()
      setMood('excited')
      setMessages(prev => [...prev, { role: 'assistant', text: 'Created a fresh blank note for you! 📝✨' }])
      window.setTimeout(() => setMood('idle'), 2500)
    } else if (action === 'tasks') {
      onNavigate?.('/tasks')
      setMood('happy')
    } else if (action === 'calendar') {
      onNavigate?.('/calendar')
      setMood('happy')
    } else if (action === 'idea') {
      void handleSend('Give me a creative prompt or thought spark to write about today!')
    }
  }

  const isRightHalf = typeof window !== 'undefined' ? pos.x > window.innerWidth / 2 : true
  const isTopHalf = typeof window !== 'undefined' ? pos.y < window.innerHeight / 2 : false

  return (
    <div
      ref={containerRef}
      className={`bip-container ${isRightHalf ? 'align-right' : 'align-left'}`}
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Speech Hint Bubble */}
      {hint && !isOpen && (
        <div className="bip-hint-bubble">
          <Sparkles size={13} color="#9333ea" />
          <span>{hint}</span>
        </div>
      )}

      {/* Interactive Chat Dialog */}
      {isOpen && (
        <div
          className={`bip-dialog ${isRightHalf ? 'align-right' : 'align-left'} ${isTopHalf ? 'open-down' : 'open-up'}`}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bip-dialog-header">
            <div className="bip-dialog-title">
              <span className="bip-status-dot" />
              <span>Bip · Little Helper</span>
            </div>
            <div className="bip-dialog-actions">
              <button
                title={soundEnabled ? 'Sound effects on (click to mute)' : 'Sound effects muted (click to enable)'}
                onClick={handleToggleSound}
                className={soundEnabled ? 'sound-active' : ''}
              >
                {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
              </button>
              <button
                title="Expand to Full Assistant Workspace"
                onClick={() => {
                  setIsOpen(false)
                  onNavigate?.('/assistant')
                }}
              >
                <Maximize2 size={13} />
              </button>
              <button
                title="Reset conversation"
                onClick={handleReset}
              >
                <RotateCcw size={13} />
              </button>
              <button title="Close" onClick={() => setIsOpen(false)}>
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Quick Action Chips */}
          <div className="bip-chips">
            <button className="bip-chip" onClick={() => handleQuickAction('new-note')}>
              <FileText size={12} /> New Note
            </button>
            <button className="bip-chip" onClick={() => handleQuickAction('tasks')}>
              <CheckSquare size={12} /> Tasks
            </button>
            <button className="bip-chip" onClick={() => handleQuickAction('calendar')}>
              <Calendar size={12} /> Calendar
            </button>
            <button className="bip-chip" onClick={() => handleQuickAction('idea')}>
              <Lightbulb size={12} /> Idea
            </button>
          </div>

          {/* Messages Feed */}
          <div className="bip-messages">
            {messages.map((msg, i) => (
              <div
                key={msg.id || i}
                className={`bip-message ${msg.role === 'user' ? 'bip-msg-user' : 'bip-msg-assistant'}`}
              >
                {editingIndex === i ? (
                  <div className="bip-message-edit-box">
                    <textarea
                      className="bip-message-edit-input"
                      value={companionEditDraft}
                      onChange={e => setCompanionEditDraft(e.target.value)}
                      rows={Math.min(8, Math.max(2, companionEditDraft.split('\n').length + 1))}
                      autoFocus
                      placeholder="Edit message..."
                    />
                    <div className="bip-message-edit-actions">
                      <button
                        type="button"
                        className="bip-edit-cancel-btn"
                        onClick={handleCancelEdit}
                        disabled={isSavingCompanionEdit}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="bip-edit-save-btn"
                        onClick={() => handleSaveEdit(i, false)}
                        disabled={isSavingCompanionEdit || !companionEditDraft.trim()}
                      >
                        {isSavingCompanionEdit ? 'Saving...' : 'Save'}
                      </button>
                      {msg.role === 'user' && (
                        <button
                          type="button"
                          className="bip-edit-resend-btn"
                          onClick={() => handleSaveEdit(i, true)}
                          disabled={isSavingCompanionEdit || loading || !companionEditDraft.trim()}
                          title="Save changes and re-ask Bip"
                        >
                          <RotateCcw size={10} />
                          <span>Save & Resend</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bip-message-text">
                      <FormattedMessage
                        text={msg.text}
                        role={msg.role}
                        onCreateNote={onCreateNote ? note => onCreateNote(note) : undefined}
                      />
                    </div>
                    <div className="bip-message-footer">
                      <button
                        type="button"
                        className="bip-msg-action-btn"
                        onClick={() => handleStartEdit(i, msg.text)}
                        title="Edit message"
                      >
                        <Pencil size={10} />
                        <span>Edit</span>
                      </button>
                      {msg.id && !msg.id.startsWith('err-') && (
                        <button
                          type="button"
                          className="bip-msg-action-btn danger"
                          onClick={() => handleDeleteMessage(i)}
                          title="Delete message"
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                      {msg.role === 'assistant' && (
                        <button
                          type="button"
                          className={`bip-read-aloud-btn ${speakingIndex === i ? 'speaking' : ''}`}
                          onClick={() => handleSpeakMessage(i, msg.text)}
                          title={speakingIndex === i ? 'Stop speaking' : 'Read aloud with English voice'}
                        >
                          {speakingIndex === i ? <Square size={11} fill="currentColor" /> : <Volume2 size={11} />}
                          <span>{speakingIndex === i ? 'Stop' : 'Read'}</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
                {msg.action_cards && msg.action_cards.length > 0 && (
                  <ActionCards
                    cards={msg.action_cards}
                    onNavigate={onNavigate}
                    onOpenNote={id => onNavigate?.(`/note/${id}`)}
                  />
                )}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="bip-sources">
                    <span>Used: </span>
                    {msg.sources.map(s => (
                      <span key={s.id} className="bip-source-tag">
                        {s.title || 'Note'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="bip-typing-bubble">
                <span />
                <span />
                <span />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <form
            className="bip-input-area"
            onSubmit={e => {
              e.preventDefault()
              void handleSend()
            }}
          >
            <button
              type="button"
              className={`bip-mic-btn ${isListening ? 'listening' : ''} ${isProcessingVoice ? 'processing' : ''}`}
              onClick={handleToggleMic}
              disabled={loading}
              title={
                isProcessingVoice
                  ? 'Transcribing with Gemini AI…'
                  : (isListening ? 'Listening… click to finish dictation' : 'Dictate with your microphone (English)')
              }
            >
              {isProcessingVoice ? <Loader2 size={15} className="animate-spin" /> : (isListening ? <MicOff size={15} /> : <Mic size={15} />)}
            </button>
            <input
              className="bip-input"
              type="text"
              placeholder={
                isProcessingVoice
                  ? 'Transcribing with Gemini AI…'
                  : (isListening ? 'Listening to your voice…' : 'Ask me anything…')
              }
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={loading || isProcessingVoice}
              autoFocus
            />
            <button
              type="submit"
              className="bip-send-btn"
              disabled={!input.trim() || loading}
              title="Send"
            >
              <ArrowUp size={16} />
            </button>
          </form>
        </div>
      )}

      {/* The Animated Robot Figure */}
      <BipFigure
        mood={mood}
        eyeOffset={eyeOffset}
        isHovered={isHovered}
        isDragging={isDragging}
        isSpeaking={isSpeaking}
        onClick={handleFigureClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onMouseEnter={() => {
          setIsHovered(true)
          const now = Date.now()
          if (now - lastHoverSoundRef.current > 3000) {
            lastHoverSoundRef.current = now
            robotAudio.play('blip')
          }
        }}
        onMouseLeave={() => setIsHovered(false)}
        size={76}
      />

      {/* Floating Ground Shadow */}
      <div className="bip-shadow" />
    </div>
  )
}
