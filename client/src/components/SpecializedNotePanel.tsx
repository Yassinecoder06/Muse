import { useState, useMemo } from 'react'
import { CalendarDays, Dumbbell, ReceiptText, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import type { SpecializedCategory } from '../types'
import { getCustomTemplates, deleteCustomTemplate, type CustomTemplate } from '../services/templates'

export const SPECIALIZED_COLORS = [
  { id: 'blue', color: '#2563eb', name: 'Ocean' },
  { id: 'purple', color: '#7c3aed', name: 'Lavender' },
  { id: 'emerald', color: '#059669', name: 'Emerald' },
  { id: 'amber', color: '#d97706', name: 'Amber' },
  { id: 'rose', color: '#e11d48', name: 'Rose' },
  { id: 'teal', color: '#0d9488', name: 'Teal' },
  { id: 'indigo', color: '#4f46e5', name: 'Indigo' }
]

const defaultOptions: { category: SpecializedCategory; title: string; description: string; icon: typeof CalendarDays }[] = [
  { category: 'daily', title: 'Daily tasks & feedback', description: 'Plan your day, track tasks, and reflect.', icon: CalendarDays },
  { category: 'workout', title: 'Gym workout', description: 'Log date, time, workout name, and exercises.', icon: Dumbbell },
  { category: 'finance', title: 'Expense & decision', description: 'Capture spending and compare choices.', icon: ReceiptText },
  { category: 'custom', title: 'New custom template', description: 'Start a structured note with custom named fields.', icon: SlidersHorizontal }
]

export function SpecializedNotePanel({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (category: SpecializedCategory, customTemplate?: CustomTemplate, color?: string) => void
}) {
  const [search, setSearch] = useState('')
  const [color, setColor] = useState('blue')
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(() => getCustomTemplates())

  const handleDeleteTemplate = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    deleteCustomTemplate(id)
    setCustomTemplates(getCustomTemplates())
  }

  const query = search.trim().toLowerCase()

  const filteredDefaults = useMemo(() => {
    if (!query) return defaultOptions
    return defaultOptions.filter(opt =>
      opt.title.toLowerCase().includes(query) ||
      opt.description.toLowerCase().includes(query)
    )
  }, [query])

  const filteredCustom = useMemo(() => {
    if (!query) return customTemplates
    return customTemplates.filter(tpl =>
      tpl.title.toLowerCase().includes(query) ||
      (tpl.description && tpl.description.toLowerCase().includes(query)) ||
      tpl.fields.some(f => f.name.toLowerCase().includes(query))
    )
  }, [customTemplates, query])

  const hasAnyMatches = filteredDefaults.length > 0 || filteredCustom.length > 0

  return (
    <div className="command-backdrop" onMouseDown={onClose}>
      <section className="command specialized-panel" onMouseDown={e => e.stopPropagation()}>
        <header>
          <span>
            <i><SlidersHorizontal size={16} /></i>
            <strong>Specialized note</strong>
          </span>
          <button onClick={onClose}><X size={17} /></button>
        </header>
        <p>Choose a structured template or create custom named fields. You can write freely alongside all fields.</p>

        <div className="specialized-modal-color-bar">
          <span className="color-bar-label">Color accent:</span>
          <div className="specialized-color-swatches" role="radiogroup" aria-label="Color accent">
            {SPECIALIZED_COLORS.map(c => (
              <button
                key={c.id}
                type="button"
                className={`specialized-color-swatch swatch-${c.id} ${color === c.id ? 'active' : ''}`}
                style={{ backgroundColor: c.color }}
                onClick={() => setColor(c.id)}
                title={`Accent: ${c.name}`}
              />
            ))}
          </div>
        </div>

        <div className="template-search-wrap">
          <Search size={15} className="template-search-icon" />
          <input
            type="text"
            placeholder="Search templates by name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="template-search-input"
            autoFocus
          />
          {search && (
            <button className="template-search-clear" onClick={() => setSearch('')} title="Clear search">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="specialized-templates-scroll">
          {filteredDefaults.length > 0 && (
            <div className="specialized-section">
              <h4 className="specialized-section-title">Built-in Templates</h4>
              <div className="template-cards-grid">
                {filteredDefaults.map(option => {
                  const Icon = option.icon
                  return (
                    <button
                      key={option.category}
                      className="template-card-btn"
                      onClick={() => onCreate(option.category, undefined, color)}
                    >
                      <div className="template-icon-wrap">
                        <Icon size={18} />
                      </div>
                      <div className="template-info">
                        <strong>{option.title}</strong>
                        <small>{option.description}</small>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {filteredCustom.length > 0 && (
            <div className="specialized-section">
              <h4 className="specialized-section-title">Your Saved Templates</h4>
              <div className="template-cards-grid">
                {filteredCustom.map(tpl => (
                  <div key={tpl.id} className="saved-template-card">
                    <button
                      className="template-card-btn saved-template-click"
                      onClick={() => onCreate('custom', tpl, color || tpl.color)}
                    >
                      <div className="template-icon-wrap">
                        <SlidersHorizontal size={18} />
                      </div>
                      <div className="template-info">
                        <strong>{tpl.title}</strong>
                        <small>
                          {tpl.fields.length} field{tpl.fields.length === 1 ? '' : 's'}: {tpl.fields.map(f => f.name).join(', ')}
                        </small>
                      </div>
                    </button>
                    <button
                      className="delete-template-btn"
                      title="Delete saved template"
                      onClick={e => handleDeleteTemplate(e, tpl.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!hasAnyMatches && (
            <div style={{ textAlign: 'center', padding: '24px 12px', color: '#888', fontSize: '13px' }}>
              No templates found matching &ldquo;{search}&rdquo;.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
