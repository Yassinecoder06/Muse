import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Brain,
  Calendar,
  CheckSquare,
  Edit2,
  FileText,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Check,
  X,
  Clock,
  PanelLeft,
  Mic,
  MicOff,
  Volume2,
  Square,
  Pencil,
  RotateCcw,
  Loader2
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { chatModel } from '../services/settings'
import { robotAudio, loadVoiceSettings } from '../services/robot-audio.service'
import { robotMusic } from '../services/robot-music.service'
import { tts } from '../services/tts.service'
import { stt } from '../services/stt.service'
import { FormattedMessage } from './FormattedMessage'
import { ActionCards } from './ActionCards'
import { MemoryModal } from './MemoryModal'
import { ConfirmModal } from './ConfirmModal'
import type { ChatMessage, ChatSession } from '../types'

interface AssistantWorkspaceProps {
  onBack?: () => void
  onCreateNote?: (input?: { title?: string; content?: string }) => void
  onNavigate?: (path: string) => void
  initialSessionId?: string | null
}

export function AssistantWorkspace({
  onBack,
  onCreateNote,
  onNavigate,
  initialSessionId
}: AssistantWorkspaceProps) {
  const queryClient = useQueryClient()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId || null)
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [memoryModalOpen, setMemoryModalOpen] = useState(false)
  const [memoryCount, setMemoryCount] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('muse-assistant-sidebar') === 'collapsed')
  const [sttState, setSttState] = useState<'idle' | 'listening' | 'processing' | 'error'>('idle')
  const isListening = sttState === 'listening'
  const isProcessingVoice = sttState === 'processing'
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)

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
      onError: () => {
        setSttState('idle')
      }
    })
  }

  const handleSpeakMessage = (msgId: string, content: string) => {
    if (speakingMessageId === msgId && tts.isSpeaking()) {
      tts.stop()
      setSpeakingMessageId(null)
      return
    }

    tts.stop()
    setSpeakingMessageId(msgId)
    tts.speak(content, {
      onStart: () => setSpeakingMessageId(msgId),
      onEnd: () => setSpeakingMessageId(null),
      onError: () => setSpeakingMessageId(null)
    })
  }

  const toggleSidebar = () => {
    setSidebarCollapsed(current => {
      const next = !current
      localStorage.setItem('muse-assistant-sidebar', next ? 'collapsed' : 'expanded')
      return next
    })
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load sessions list and memory count on mount
  useEffect(() => {
    void loadSessions()
    void loadMemoryCount()
  }, [])

  // When activeSessionId changes, load the session and messages
  useEffect(() => {
    if (activeSessionId) {
      void loadSession(activeSessionId)
    }
  }, [activeSessionId])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const loadMemoryCount = async () => {
    try {
      const memories = await api.listMemories()
      setMemoryCount(memories.length)
    } catch {
      // ignore
    }
  }

  const loadSessions = async () => {
    try {
      const list = await api.listChatSessions()
      setSessions(list)
      if (list.length > 0 && !activeSessionId) {
        setActiveSessionId(list[0].id)
      } else if (list.length === 0) {
        // Create initial session if none exists
        await handleNewSession()
      }
    } catch (err) {
      console.error('Failed to load chat sessions:', err)
    }
  }

  const loadSession = async (id: string) => {
    try {
      const data = await api.getChatSession(id)
      setActiveSession(data)
      setMessages(data.messages || [])
    } catch (err) {
      console.error('Failed to load session details:', err)
    }
  }

  const handleNewSession = async () => {
    try {
      const newSession = await api.createChatSession({ title: 'New Conversation' })
      setSessions(prev => [newSession, ...prev])
      setActiveSessionId(newSession.id)
      setActiveSession(newSession)
      setMessages([])
      sessionStorage.setItem('muse-bip-session-id', newSession.id)
      inputRef.current?.focus()
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  const [deleteSessionConfirmId, setDeleteSessionConfirmId] = useState<string | null>(null)

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteSessionConfirmId(id)
  }

  const handleStartRename = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingTitleId(session.id)
    setTitleDraft(session.title)
  }

  const handleSaveRename = async (id: string) => {
    if (!titleDraft.trim()) {
      setEditingTitleId(null)
      return
    }
    try {
      const updated = await api.updateChatSession(id, { title: titleDraft.trim() })
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: updated.title } : s))
      if (activeSession?.id === id) {
        setActiveSession(prev => prev ? { ...prev, title: updated.title } : prev)
      }
    } catch (err) {
      console.error('Failed to rename session:', err)
    } finally {
      setEditingTitleId(null)
    }
  }

  const handleSend = async (customPrompt?: string) => {
    const textToSend = (customPrompt || input).trim()
    if (!textToSend || loading || !activeSessionId) return

    if (isListening || isProcessingVoice) {
      stt.stopListening()
      setSttState('idle')
    }

    robotAudio.play('blip')
    setInput('')
    setLoading(true)
    robotAudio.startThinkingLoop()

    // Optimistically add user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: textToSend,
      created_at: new Date().toISOString()
    }
    setMessages(prev => [...prev, tempUserMsg])

    try {
      const res = await api.sendChatMessage(activeSessionId, {
        message: textToSend,
        model: chatModel() || undefined
      })

      robotAudio.stopThinkingLoop()
      robotAudio.play('success')

      // Update session title if updated by agent
      if (res.sessionTitle) {
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, title: res.sessionTitle! } : s))
        setActiveSession(prev => prev ? { ...prev, title: res.sessionTitle! } : prev)
      }

      // Replace with confirmed user and assistant messages
      setMessages(prev => {
        const withoutTemp = prev.filter(m => m.id !== tempUserMsg.id)
        return [...withoutTemp, res.userMessage, res.assistantMessage]
      })

      // Auto-read aloud if enabled
      const currentVoiceSettings = loadVoiceSettings()
      if (currentVoiceSettings.autoReadAloud) {
        setTimeout(() => {
          handleSpeakMessage(res.assistantMessage.id, res.assistantMessage.content)
        }, 150)
      }

      // If action_cards contains a music card, play it
      const musicCard = res.assistantMessage.action_cards?.find((c: any) => c.type === 'music' || c.data?.type === 'music')
      if (musicCard) {
        const d = (musicCard as any).data || musicCard
        void robotMusic.playSong({
          title: d.title,
          filename: d.filename,
          url: d.url
        })
      }

      // If action_cards contains a playlist card, play it
      const playlistCard = res.assistantMessage.action_cards?.find((c: any) => c.type === 'playlist' || c.data?.type === 'playlist')
      if (playlistCard) {
        const d = (playlistCard as any).data || playlistCard
        const tracks = Array.isArray(d.tracks) ? d.tracks : (playlistCard as any).tracks || []
        if (tracks.length > 0) {
          void robotMusic.playPlaylist(d.name || d.title || (playlistCard as any).title, tracks, 0)
        }
      }

      // Refresh memory count if tool saved or deleted memory
      if (res.assistantMessage.action_cards?.some(c => c.type === 'memory' || (c.type === 'item_deleted' && c.category === 'memory'))) {
        void loadMemoryCount()
      }

      // If a chat session was deleted, reload sessions
      if (res.assistantMessage.action_cards?.some(c => c.type === 'item_deleted' && c.category === 'chat_session')) {
        void loadSessions()
      }

      // Invalidate relevant queries if any action card was returned
      if (res.assistantMessage.action_cards && res.assistantMessage.action_cards.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['notes'] })
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['calendar'] })
        queryClient.invalidateQueries({ queryKey: ['specialized-templates'] })
      }
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
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Beep! ⚠️ ${cleanMsg}`,
        created_at: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMessageId(msg.id)
    setEditDraft(msg.content)
  }

  const handleCancelEdit = () => {
    setEditingMessageId(null)
    setEditDraft('')
  }

  const handleSaveEdit = async (msg: ChatMessage, resend = false) => {
    const newContent = editDraft.trim()
    if (!newContent) return
    setIsSavingEdit(true)
    try {
      const updated = await api.updateChatMessage(msg.id, { content: newContent })
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: updated.content } : m))
      setEditingMessageId(null)
      setEditDraft('')
      robotAudio.play('blip')
      if (resend) {
        void handleSend(newContent)
      }
    } catch (err) {
      console.error('Failed to update message:', err)
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleDeleteMessage = async (msgId: string) => {
    try {
      await api.deleteChatMessage(msgId)
      setMessages(prev => prev.filter(m => m.id !== msgId))
      robotAudio.play('boop')
    } catch (err) {
      console.error('Failed to delete message:', err)
    }
  }

  // Group sessions by date
  const filterSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const groupSessions = () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterday = today - 86400000
    const lastWeek = today - 7 * 86400000

    const groups: { [key: string]: ChatSession[] } = {
      Today: [],
      Yesterday: [],
      'Previous 7 Days': [],
      Older: []
    }

    filterSessions.forEach(session => {
      const sessionTime = new Date(session.updated_at || session.created_at).getTime()
      if (sessionTime >= today) {
        groups['Today'].push(session)
      } else if (sessionTime >= yesterday) {
        groups['Yesterday'].push(session)
      } else if (sessionTime >= lastWeek) {
        groups['Previous 7 Days'].push(session)
      } else {
        groups['Older'].push(session)
      }
    })

    return groups
  }

  const grouped = groupSessions()

  return (
    <div className={`assistant-workspace-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      {/* Sidebar: Session History & Memory */}
      <aside className="assistant-sidebar">
        <div className="assistant-sidebar-top">
          <div className="assistant-brand-row">
            <div className="assistant-brand-title">
              {onBack && (
                <button className="assistant-back-btn" onClick={onBack} title="Back to Dashboard">
                  <ArrowLeft size={16} />
                </button>
              )}
              <div className="assistant-bip-badge">
                <Bot size={18} />
              </div>
              <div className="assistant-brand-meta">
                <h2>Bip Assistant</h2>
                <small>Autonomous Agent</small>
              </div>
            </div>
          </div>

          <button className="assistant-new-chat-btn" onClick={handleNewSession}>
            <Plus size={16} />
            <span>New Conversation</span>
          </button>

          <div className="assistant-search-box">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Sessions list grouped by recency */}
        <div className="assistant-sessions-list">
          {Object.entries(grouped).map(([groupTitle, list]) => {
            if (list.length === 0) return null
            return (
              <div key={groupTitle} className="assistant-session-group">
                <h4 className="assistant-group-title">{groupTitle}</h4>
                {list.map(session => {
                  const isActive = session.id === activeSessionId
                  const isEditing = editingTitleId === session.id

                  return (
                    <div
                      key={session.id}
                      className={`assistant-session-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        setActiveSessionId(session.id)
                        sessionStorage.setItem('muse-bip-session-id', session.id)
                      }}
                    >
                      <MessageSquare size={14} className="session-item-icon" />
                      {isEditing ? (
                        <div className="session-edit-inline" onClick={e => e.stopPropagation()}>
                          <input
                            type="text"
                            value={titleDraft}
                            onChange={e => setTitleDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') void handleSaveRename(session.id)
                              if (e.key === 'Escape') setEditingTitleId(null)
                            }}
                            autoFocus
                          />
                          <button onClick={() => void handleSaveRename(session.id)} title="Save">
                            <Check size={12} />
                          </button>
                          <button onClick={() => setEditingTitleId(null)} title="Cancel">
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="session-item-title" title={session.title}>
                            {session.title}
                          </span>
                          <div className="session-item-actions">
                            <button
                              className="session-action-btn"
                              title="Rename conversation"
                              onClick={e => handleStartRename(session, e)}
                            >
                              <Edit2 size={12} />
                            </button>
                            <button
                              className="session-action-btn delete-btn"
                              title="Delete conversation"
                              onClick={e => handleDeleteSession(session.id, e)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Memory Vault trigger footer */}
        <div className="assistant-sidebar-footer">
          <button
            className="assistant-memory-btn"
            onClick={() => setMemoryModalOpen(true)}
            title="Open Bip's Memory Vault"
          >
            <Brain size={16} />
            <span>Memory Vault</span>
            {memoryCount > 0 && <span className="memory-count-badge">{memoryCount}</span>}
          </button>
        </div>
      </aside>

      {/* Main Conversation Stage */}
      <main className="assistant-main-stage">
        {/* Stage Header */}
        <header className="assistant-stage-header">
          <div className="header-left">
            <button
              className="assistant-stage-toggle-btn"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <PanelLeft size={17} />
            </button>
            <h3 className="active-session-title">
              {activeSession?.title || 'Conversation'}
            </h3>
            <span className="agent-status-pill">
              <Sparkles size={13} />
              <span>Full MCP Agent Enabled</span>
            </span>
          </div>
          <div className="header-right">
            <button
              className="stage-header-btn"
              onClick={() => setMemoryModalOpen(true)}
              title="View Memories"
            >
              <Brain size={15} />
              <span>Memories ({memoryCount})</span>
            </button>
            {activeSessionId && (
              <button
                className="stage-header-btn danger"
                onClick={e => handleDeleteSession(activeSessionId, e)}
                title="Delete this conversation"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </header>

        {/* Message Stream */}
        <div className="assistant-messages-container">
          {messages.length === 0 ? (
            <div className="assistant-welcome-screen">
              <div className="welcome-bip-orb">
                <Bot size={36} />
              </div>
              <h2>How can I help you today?</h2>
              <p>
                I am Bip, your proactive personal assistant. I have full skills to create notes,
                organize tasks, schedule calendar events, and remember facts about you — all with a
                single prompt.
              </p>

              <div className="starter-prompts-grid">
                <button
                  className="starter-prompt-card"
                  onClick={() =>
                    handleSend(
                      'Schedule a team sync tomorrow at 2pm and draft a meeting prep note'
                    )
                  }
                >
                  <Calendar size={16} />
                  <span>
                    <strong>Schedule & Note</strong>
                    <small>“Schedule a team sync tomorrow at 2pm and draft a meeting prep note”</small>
                  </span>
                </button>

                <button
                  className="starter-prompt-card"
                  onClick={() =>
                    handleSend(
                      'Add a high-priority task to submit the quarterly proposal by Friday at 5pm'
                    )
                  }
                >
                  <CheckSquare size={16} />
                  <span>
                    <strong>Create Task</strong>
                    <small>“Add a high-priority task to submit proposal by Friday at 5pm”</small>
                  </span>
                </button>

                <button
                  className="starter-prompt-card"
                  onClick={() =>
                    handleSend(
                      'What notes or plans do I have saved about architecture or tech stack?'
                    )
                  }
                >
                  <FileText size={16} />
                  <span>
                    <strong>Search Notes</strong>
                    <small>“What notes do I have about architecture or tech stack?”</small>
                  </span>
                </button>

                <button
                  className="starter-prompt-card"
                  onClick={() =>
                    handleSend(
                      'Remember that I prefer 30-minute meetings in the morning and no meetings on Friday afternoons'
                    )
                  }
                >
                  <Brain size={16} />
                  <span>
                    <strong>Teach Bip a Memory</strong>
                    <small>“Remember that I prefer morning meetings and no Friday afternoon syncs”</small>
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div className="assistant-messages-feed">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`assistant-chat-row ${msg.role === 'user' ? 'user-row' : 'assistant-row'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="assistant-avatar">
                      <Bot size={18} />
                    </div>
                  )}

                  <div className="assistant-bubble-content">
                    {editingMessageId === msg.id ? (
                      <div className="assistant-message-edit-box">
                        <textarea
                          className="assistant-message-edit-input"
                          value={editDraft}
                          onChange={e => setEditDraft(e.target.value)}
                          rows={Math.min(10, Math.max(3, editDraft.split('\n').length + 1))}
                          autoFocus
                          placeholder="Edit message..."
                        />
                        <div className="assistant-message-edit-actions">
                          <button
                            type="button"
                            className="assistant-edit-cancel-btn"
                            onClick={handleCancelEdit}
                            disabled={isSavingEdit}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="assistant-edit-save-btn"
                            onClick={() => handleSaveEdit(msg, false)}
                            disabled={isSavingEdit || !editDraft.trim()}
                          >
                            {isSavingEdit ? 'Saving...' : 'Save'}
                          </button>
                          {msg.role === 'user' && (
                            <button
                              type="button"
                              className="assistant-edit-resend-btn"
                              onClick={() => handleSaveEdit(msg, true)}
                              disabled={isSavingEdit || loading || !editDraft.trim()}
                              title="Save changes and ask Bip to re-answer"
                            >
                              <RotateCcw size={12} />
                              <span>Save & Resend</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="assistant-message-bubble">
                          <FormattedMessage
                            text={msg.content}
                            role={msg.role}
                            onCreateNote={onCreateNote ? note => onCreateNote(note) : undefined}
                          />
                        </div>

                        {/* Interactive Action Cards */}
                        {msg.action_cards && msg.action_cards.length > 0 && (
                          <ActionCards
                            cards={msg.action_cards}
                            onNavigate={onNavigate}
                            onOpenNote={id => (onNavigate ? onNavigate(`/note/${id}`) : undefined)}
                          />
                        )}

                        <div className="assistant-bubble-meta">
                          <span className="assistant-msg-time">
                            <Clock size={10} />
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                          <button
                            type="button"
                            className="assistant-msg-action-btn"
                            onClick={() => handleStartEdit(msg)}
                            title="Edit message"
                          >
                            <Pencil size={11} />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            className="assistant-msg-action-btn danger"
                            onClick={() => handleDeleteMessage(msg.id)}
                            title="Delete message"
                          >
                            <Trash2 size={11} />
                          </button>
                          {msg.role === 'assistant' && (
                            <button
                              type="button"
                              className={`assistant-read-aloud-btn ${speakingMessageId === msg.id ? 'speaking' : ''}`}
                              onClick={() => handleSpeakMessage(msg.id, msg.content)}
                              title={speakingMessageId === msg.id ? 'Stop speaking' : 'Read aloud with English voice'}
                            >
                              {speakingMessageId === msg.id ? <Square size={11} fill="currentColor" /> : <Volume2 size={12} />}
                              <span>{speakingMessageId === msg.id ? 'Stop' : 'Read aloud'}</span>
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="assistant-chat-row assistant-row">
                  <div className="assistant-avatar thinking">
                    <Bot size={18} />
                  </div>
                  <div className="assistant-bubble-content">
                    <div className="assistant-thinking-bubble">
                      <span className="thinking-dot" />
                      <span className="thinking-dot" />
                      <span className="thinking-dot" />
                      <span className="thinking-label">Bip is working on your request...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Composer Input */}
        <div className="assistant-composer-wrapper">
          <form
            className="assistant-composer-form"
            onSubmit={e => {
              e.preventDefault()
              void handleSend()
            }}
          >
            <textarea
              ref={inputRef}
              rows={2}
              className="assistant-composer-textarea"
              placeholder={
                isProcessingVoice
                  ? 'Transcribing with Gemini AI…'
                  : (isListening ? 'Listening to your voice… tap mic when done' : 'Ask Bip anything, schedule events, create tasks, write notes, or store memories...')
              }
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading || isProcessingVoice}
              autoFocus
            />
            <button
              type="button"
              className={`assistant-mic-btn ${isListening ? 'listening' : ''} ${isProcessingVoice ? 'processing' : ''}`}
              onClick={handleToggleMic}
              disabled={loading}
              title={
                isProcessingVoice
                  ? 'Transcribing with Gemini AI…'
                  : (isListening ? 'Listening… click to finish dictation' : 'Dictate with your microphone (English)')
              }
            >
              {isProcessingVoice ? <Loader2 size={18} className="animate-spin" /> : (isListening ? <MicOff size={18} /> : <Mic size={18} />)}
            </button>
            <button
              type="submit"
              className="assistant-send-btn"
              disabled={!input.trim() || loading}
              title="Send (Enter)"
            >
              <ArrowUp size={18} />
            </button>
          </form>
          <div className="assistant-composer-hint">
            <span>Press <strong>Enter</strong> to send, <strong>Shift+Enter</strong> for newline</span>
            <span>• Bip coordinates notes, tasks, events, and memories in a single prompt</span>
          </div>
        </div>
      </main>

      {/* Memory Modal */}
      <MemoryModal
        isOpen={memoryModalOpen}
        onClose={() => setMemoryModalOpen(false)}
        onMemoryChanged={() => void loadMemoryCount()}
      />

      {deleteSessionConfirmId && (
        <ConfirmModal
          isOpen={true}
          title="Delete Conversation"
          message="Delete this chat conversation? All messages in this thread will be permanently removed."
          confirmText="Delete conversation"
          danger={true}
          onConfirm={async () => {
            const id = deleteSessionConfirmId
            setDeleteSessionConfirmId(null)
            try {
              await api.deleteChatSession(id)
              const remaining = sessions.filter(s => s.id !== id)
              setSessions(remaining)
              if (activeSessionId === id) {
                if (remaining.length > 0) {
                  setActiveSessionId(remaining[0].id)
                } else {
                  void handleNewSession()
                }
              }
            } catch (err) {
              console.error('Failed to delete session:', err)
            }
          }}
          onCancel={() => setDeleteSessionConfirmId(null)}
        />
      )}
    </div>
  )
}
