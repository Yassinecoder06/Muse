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
  PanelLeft
} from 'lucide-react'
import { api } from '../services/api'
import { chatModel } from '../services/settings'
import { FormattedMessage } from './FormattedMessage'
import { ActionCards } from './ActionCards'
import { MemoryModal } from './MemoryModal'
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
      inputRef.current?.focus()
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm('Delete this chat conversation?')) return

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

    setInput('')
    setLoading(true)

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

      // Refresh memory count if tool saved memory
      if (res.assistantMessage.action_cards?.some(c => c.type === 'memory')) {
        void loadMemoryCount()
      }
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: err instanceof Error ? `Beep! ⚠️ ${err.message}` : 'Sorry, I ran into an issue processing that.',
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
            <button
              className="assistant-collapse-btn"
              onClick={toggleSidebar}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <PanelLeft size={16} />
            </button>
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
                      onClick={() => setActiveSessionId(session.id)}
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

                    <span className="assistant-msg-time">
                      <Clock size={10} />
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
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
              placeholder="Ask Bip anything, schedule events, create tasks, write notes, or store memories..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              autoFocus
            />
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
    </div>
  )
}
