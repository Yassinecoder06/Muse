import React, { useEffect, useRef, useState } from 'react'
import { ArrowUp, Calendar, CheckSquare, FileText, Lightbulb, RotateCcw, Sparkles, X } from 'lucide-react'
import { BipFigure, type BipMood } from './BipFigure'
import { FormattedMessage } from '../FormattedMessage'
import { api } from '../../services/api'
import './bip.css'

interface RobotCompanionProps {
  onCreateNote?: (input?: { title?: string; content?: string }) => void
  onNavigate?: (path: string) => void
  currentPath?: string
}

interface Message {
  role: 'assistant' | 'user'
  text: string
  sources?: { id: string; title: string }[]
}

const DEFAULT_GREETING: Message = {
  role: 'assistant',
  text: "Beep boop! 🤖 I'm Bip! What can I help you find or create today?"
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
  const [isOpen, setIsOpen] = useState(false)
  const [mood, setMood] = useState<BipMood>('idle')
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([DEFAULT_GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

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
    setIsOpen(prev => !prev)
    setMood(isOpen ? 'idle' : 'happy')
    setHint(null)
  }

  async function handleSend(textToSend?: string) {
    const query = (textToSend || input).trim()
    if (!query || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: query }])
    setLoading(true)
    setMood('thinking')

    try {
      const history = messages.slice(-5).map(({ role, text }) => ({ role, text }))
      let job = await api.askNotes(query, history)

      while (job.status === 'queued' || job.status === 'processing') {
        await new Promise(r => setTimeout(r, 1200))
        job = await api.getAiJob(job.id)
      }

      if (job.status === 'failed') {
        throw new Error(job.error || 'Bip had trouble thinking of an answer.')
      }

      const result = job.result as { answer?: string; sources?: { id: string; title: string }[] } | null
      const answerText = result?.answer || "Beep! I couldn't find an answer for that."

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: answerText,
          sources: result?.sources
        }
      ])
      setMood('happy')
      window.setTimeout(() => setMood('idle'), 3000)
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: err instanceof Error ? `*Beep* ${err.message}` : "I couldn't reach the AI brain right now."
        }
      ])
      setMood('curious')
    } finally {
      setLoading(false)
    }
  }

  function handleQuickAction(action: 'new-note' | 'tasks' | 'calendar' | 'idea') {
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
      handleSend('Give me a creative prompt or thought spark to write about today!')
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
                title="Reset conversation"
                onClick={() => setMessages([DEFAULT_GREETING])}
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
                key={i}
                className={`bip-message ${msg.role === 'user' ? 'bip-msg-user' : 'bip-msg-assistant'}`}
              >
                <div className="bip-message-text">
                  <FormattedMessage
                    text={msg.text}
                    role={msg.role}
                    onCreateNote={onCreateNote ? note => onCreateNote(note) : undefined}
                  />
                </div>
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
            <input
              className="bip-input"
              type="text"
              placeholder="Ask me anything..."
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={loading}
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
        onClick={handleFigureClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        size={76}
      />

      {/* Floating Ground Shadow */}
      <div className="bip-shadow" />
    </div>
  )
}
