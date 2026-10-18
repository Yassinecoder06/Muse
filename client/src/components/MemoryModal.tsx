import { useEffect, useState } from 'react'
import { Brain, Plus, Trash2, X, Sparkles, Tag } from 'lucide-react'
import { api } from '../services/api'
import type { UserMemory } from '../types'

interface MemoryModalProps {
  isOpen: boolean
  onClose: () => void
  onMemoryChanged?: () => void
}

const CATEGORIES = ['all', 'preference', 'project', 'personal', 'general']

export function MemoryModal({ isOpen, onClose, onMemoryChanged }: MemoryModalProps) {
  const [memories, setMemories] = useState<UserMemory[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [newFact, setNewFact] = useState('')
  const [newCategory, setNewCategory] = useState('preference')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      void loadMemories()
    }
  }, [isOpen])

  const loadMemories = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.listMemories()
      setMemories(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories')
    } finally {
      setLoading(false)
    }
  }

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFact.trim()) return

    setAdding(true)
    setError('')
    try {
      const created = await api.createMemory({
        fact: newFact.trim(),
        category: newCategory
      })
      setMemories(prev => [created, ...prev])
      setNewFact('')
      onMemoryChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save memory')
    } finally {
      setAdding(false)
    }
  }

  const handleDeleteMemory = async (id: string) => {
    try {
      await api.deleteMemory(id)
      setMemories(prev => prev.filter(m => m.id !== id))
      onMemoryChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete memory')
    }
  }

  if (!isOpen) return null

  const filteredMemories = selectedCategory === 'all'
    ? memories
    : memories.filter(m => m.category?.toLowerCase() === selectedCategory.toLowerCase())

  return (
    <div className="command-backdrop" onMouseDown={onClose}>
      <div
        className="command memory-modal-panel"
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="memory-modal-header">
          <div className="memory-modal-title">
            <div className="memory-icon-badge">
              <Brain size={18} />
            </div>
            <div>
              <h3>Bip's Memory Vault</h3>
              <p>Facts and preferences Bip remembers across conversations</p>
            </div>
          </div>
          <button className="memory-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </header>

        {/* Add Memory Form */}
        <form className="memory-add-form" onSubmit={handleAddMemory}>
          <div className="memory-input-wrapper">
            <Sparkles size={16} className="memory-input-icon" />
            <input
              type="text"
              placeholder="e.g. I prefer 30-minute meetings in the morning, or I'm launching Beta next week"
              value={newFact}
              onChange={e => setNewFact(e.target.value)}
              disabled={adding}
            />
          </div>
          <div className="memory-form-actions">
            <div className="memory-category-select">
              <Tag size={14} />
              <select
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                disabled={adding}
              >
                <option value="preference">Preference</option>
                <option value="project">Project</option>
                <option value="personal">Personal</option>
                <option value="general">General</option>
              </select>
            </div>
            <button
              type="submit"
              className="memory-add-btn"
              disabled={!newFact.trim() || adding}
            >
              <Plus size={15} />
              <span>{adding ? 'Remembering...' : 'Remember'}</span>
            </button>
          </div>
        </form>

        {error && <div className="memory-error">{error}</div>}

        {/* Category Filters */}
        <div className="memory-filter-pills">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`memory-filter-pill ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
              {cat === 'all' ? ` (${memories.length})` : ''}
            </button>
          ))}
        </div>

        {/* Memories List */}
        <div className="memory-list-scroll">
          {loading ? (
            <div className="memory-loading">
              <div className="loader" />
              <span>Loading memories...</span>
            </div>
          ) : filteredMemories.length === 0 ? (
            <div className="memory-empty">
              <Brain size={32} />
              <p>
                {selectedCategory === 'all'
                  ? 'No memories stored yet. Tell Bip things during chat or add a memory above!'
                  : `No memories in "${selectedCategory}".`}
              </p>
            </div>
          ) : (
            filteredMemories.map(memory => (
              <div key={memory.id} className="memory-item-card">
                <div className="memory-item-body">
                  <span className={`memory-cat-tag cat-${memory.category || 'general'}`}>
                    {memory.category || 'general'}
                  </span>
                  <p className="memory-item-fact">{memory.fact}</p>
                  <span className="memory-item-date">
                    {new Date(memory.updated_at || memory.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </span>
                </div>
                <button
                  className="memory-delete-btn"
                  title="Forget this memory"
                  onClick={() => handleDeleteMemory(memory.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
