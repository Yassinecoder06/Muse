import { useState, useMemo, useEffect } from 'react'
import {
  CalendarDays,
  Calendar,
  Dumbbell,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Trash2,
  Pencil,
  Plus,
  ArrowLeft,
  X,
  Globe
} from 'lucide-react'
import type { SpecializedCategory } from '../types'
import { ConfirmModal } from './ConfirmModal'
import {
  getCustomTemplates,
  fetchCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  type CustomTemplate,
  type CustomTemplateField
} from '../services/templates'

export const SPECIALIZED_COLORS = [
  { id: 'blue', color: '#2563eb', name: 'Ocean' },
  { id: 'purple', color: '#7c3aed', name: 'Lavender' },
  { id: 'emerald', color: '#059669', name: 'Emerald' },
  { id: 'amber', color: '#d97706', name: 'Amber' },
  { id: 'rose', color: '#e11d48', name: 'Rose' },
  { id: 'teal', color: '#0d9488', name: 'Teal' },
  { id: 'indigo', color: '#4f46e5', name: 'Indigo' }
]

const builtInOptions: { category: SpecializedCategory; title: string; description: string; icon: typeof CalendarDays }[] = [
  { category: 'daily', title: 'Daily tasks & feedback', description: 'Plan your day, track tasks, wins, blockers, and reflect.', icon: CalendarDays },
  { category: 'workout', title: 'Gym workout', description: 'Log date, time, workout name, and exercises.', icon: Dumbbell },
  { category: 'finance', title: 'Expense & decision', description: 'Capture spending, merchant, rationale, and compare choices.', icon: ReceiptText },
  { category: 'research', title: 'Research & Report', description: 'Investigate any topic with web evidence, key findings, and deep analysis.', icon: Globe }
]

export function SpecializedNotePanel({
  onClose,
  onCreate,
  onStartAiResearch
}: {
  onClose: () => void
  onCreate: (category: SpecializedCategory, customTemplate?: CustomTemplate, color?: string) => void
  onStartAiResearch?: () => void
}) {
  const [viewMode, setViewMode] = useState<'select' | 'builder'>('select')
  const [search, setSearch] = useState('')
  const [color, setColor] = useState('blue')
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(() => getCustomTemplates())

  // Builder form state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateDesc, setTemplateDesc] = useState('')
  const [templateColor, setTemplateColor] = useState('purple')
  const [templateAiInstruction, setTemplateAiInstruction] = useState('')
  const [syncWithCalendar, setSyncWithCalendar] = useState(false)
  const [fields, setFields] = useState<CustomTemplateField[]>([
    { name: 'Field 1', defaultValue: '' }
  ])
  const [builderError, setBuilderError] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Load server-synced templates on mount
  useEffect(() => {
    void fetchCustomTemplates().then(setCustomTemplates)
  }, [])

  const handleStartNewTemplate = () => {
    setEditingId(null)
    setTemplateTitle('')
    setTemplateDesc('')
    setTemplateColor(color || 'purple')
    setTemplateAiInstruction('')
    setSyncWithCalendar(false)
    setFields([
      { name: 'Field 1', defaultValue: '' },
      { name: 'Field 2', defaultValue: '' }
    ])
    setBuilderError('')
    setViewMode('builder')
  }

  const handleEditTemplate = (e: React.MouseEvent, tpl: CustomTemplate) => {
    e.stopPropagation()
    setEditingId(tpl.id)
    setTemplateTitle(tpl.title)
    setTemplateDesc(tpl.description || '')
    setTemplateColor(tpl.color || 'purple')
    setTemplateAiInstruction(tpl.aiInstruction || '')
    setSyncWithCalendar(Boolean(tpl.syncWithCalendar))
    setFields(tpl.fields.length > 0 ? tpl.fields : [{ name: 'Field 1', defaultValue: '' }])
    setBuilderError('')
    setViewMode('builder')
  }

  const handleDeleteTemplate = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setDeleteConfirmId(id)
  }

  const handleAddField = () => {
    setFields(prev => [...prev, { name: `Field ${prev.length + 1}`, defaultValue: '' }])
  }

  const handleRemoveField = (index: number) => {
    if (fields.length <= 1) return
    setFields(prev => prev.filter((_, i) => i !== index))
  }

  const handleFieldChange = (index: number, key: 'name' | 'defaultValue', val: string) => {
    setFields(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [key]: val }
      return next
    })
  }

  const handleSaveTemplate = async (andWriteNote = false) => {
    const trimmedTitle = templateTitle.trim()
    if (!trimmedTitle) {
      setBuilderError('Template title is required.')
      return
    }

    const cleanedFields = fields
      .map(f => ({ name: f.name.trim(), defaultValue: f.defaultValue?.trim() || '' }))
      .filter(f => f.name.length > 0)

    if (cleanedFields.length === 0) {
      setBuilderError('At least one field name is required.')
      return
    }

    setBuilderError('')
    const saved = await saveCustomTemplate({
      id: editingId || undefined,
      title: trimmedTitle,
      description: templateDesc.trim() || undefined,
      fields: cleanedFields,
      aiInstruction: templateAiInstruction.trim() || undefined,
      color: templateColor,
      syncWithCalendar
    })

    setCustomTemplates(getCustomTemplates())

    if (andWriteNote) {
      // User requested to immediately write note with the newly saved template!
      onCreate('custom', saved, templateColor)
    } else {
      // Return to select mode
      setViewMode('select')
    }
  }

  const query = search.trim().toLowerCase()

  const filteredDefaults = useMemo(() => {
    if (!query) return builtInOptions
    return builtInOptions.filter(opt =>
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
        {viewMode === 'select' ? (
          <>
            <header>
              <span>
                <i><SlidersHorizontal size={16} /></i>
                <strong>Specialized note</strong>
              </span>
              <button onClick={onClose} title="Close"><X size={17} /></button>
            </header>
            <p>Choose a structured template or design custom named fields. You can write freely alongside all fields.</p>

            {/* Prominent Create New Template Button */}
            <button
              className="create-template-trigger-btn"
              onClick={handleStartNewTemplate}
              title="Design and save a new template"
            >
              <Plus size={16} />
              <span>Create New Template</span>
            </button>

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
                      const isResearch = option.category === 'research'
                      return (
                        <button
                          key={option.category}
                          className="template-card-btn"
                          onClick={() => onCreate(option.category, undefined, isResearch && color === 'blue' ? 'emerald' : color)}
                        >
                          <div
                            className="template-icon-wrap"
                            style={isResearch ? { background: 'rgba(5, 150, 105, 0.15)', color: '#059669' } : undefined}
                          >
                            <Icon size={18} />
                          </div>
                          <div className="template-info">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <strong>{option.title}</strong>
                              {isResearch && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(5, 150, 105, 0.15)', color: '#059669' }}>
                                  Green
                                </span>
                              )}
                            </div>
                            <small>{option.description}</small>
                            {isResearch && onStartAiResearch && (
                              <div style={{ marginTop: 6 }}>
                                <span
                                  className="template-card-subaction-pill"
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: '#059669',
                                    background: 'rgba(5, 150, 105, 0.1)',
                                    border: '1px solid rgba(5, 150, 105, 0.25)',
                                    borderRadius: 6,
                                    padding: '2px 8px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4
                                  }}
                                  onClick={e => {
                                    e.stopPropagation()
                                    onStartAiResearch()
                                  }}
                                  title="Run automated deep AI research with web scraping and report synthesis"
                                >
                                  ⚡ Run AI Deep Research
                                </span>
                              </div>
                            )}
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
                          title="Click to create note using this template"
                        >
                          <div className="template-icon-wrap">
                            <SlidersHorizontal size={18} />
                          </div>
                          <div className="template-info">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <strong>{tpl.title}</strong>
                              {tpl.syncWithCalendar && (
                                <span style={{ fontSize: '10px', background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent, #6366f1)', padding: '1px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                  <Calendar size={10} /> Calendar
                                </span>
                              )}
                            </div>
                            <small>
                              {tpl.fields.length} field{tpl.fields.length === 1 ? '' : 's'}: {tpl.fields.map(f => f.name).join(', ')}
                            </small>
                          </div>
                        </button>
                        <button
                          className="edit-template-btn"
                          title="Edit template fields & settings"
                          onClick={e => handleEditTemplate(e, tpl)}
                        >
                          <Pencil size={14} />
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
          </>
        ) : (
          /* Template Builder View */
          <div className="template-builder-view">
            <header>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setViewMode('select')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                  title="Back to templates"
                >
                  <ArrowLeft size={17} />
                </button>
                <strong>{editingId ? 'Edit Note Template' : 'Create Note Template'}</strong>
              </span>
              <button onClick={onClose} title="Close"><X size={17} /></button>
            </header>
            <p>Define custom fields and AI instructions for your template. After saving, you can use it to write notes anytime.</p>

            {builderError && (
              <div style={{ padding: '8px 12px', marginBottom: '10px', background: '#fee2e2', color: '#b91c1c', borderRadius: '8px', fontSize: '12px' }}>
                {builderError}
              </div>
            )}

            <div className="template-builder-form">
              <div className="template-builder-group">
                <label>Template Name *</label>
                <input
                  type="text"
                  className="template-builder-input"
                  placeholder="e.g. Book Review, Client Meeting, Recipe Tracker"
                  value={templateTitle}
                  onChange={e => setTemplateTitle(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="template-builder-group">
                <label>Description (Optional)</label>
                <input
                  type="text"
                  className="template-builder-input"
                  placeholder="e.g. Track key takeaways, quotes, and reading notes"
                  value={templateDesc}
                  onChange={e => setTemplateDesc(e.target.value)}
                />
              </div>

              <div className="template-builder-group">
                <label>Color Accent</label>
                <div className="specialized-color-swatches" style={{ marginTop: '2px' }}>
                  {SPECIALIZED_COLORS.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      className={`specialized-color-swatch swatch-${c.id} ${templateColor === c.id ? 'active' : ''}`}
                      style={{ backgroundColor: c.color }}
                      onClick={() => setTemplateColor(c.id)}
                      title={`Accent: ${c.name}`}
                    />
                  ))}
                </div>
              </div>

              <div className="template-builder-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>Template Fields ({fields.length})</label>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                  {fields.map((f, idx) => (
                    <div key={idx} className="template-builder-field-row">
                      <input
                        type="text"
                        className="template-builder-input"
                        placeholder="Field name (e.g. Author, Rating)"
                        value={f.name}
                        onChange={e => handleFieldChange(idx, 'name', e.target.value)}
                      />
                      <input
                        type="text"
                        className="template-builder-input"
                        placeholder="Default value (optional)"
                        value={f.defaultValue || ''}
                        onChange={e => handleFieldChange(idx, 'defaultValue', e.target.value)}
                      />
                      {fields.length > 1 && (
                        <button
                          type="button"
                          className="template-field-remove-btn"
                          onClick={() => handleRemoveField(idx)}
                          title="Remove field"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="template-add-field-btn"
                  onClick={handleAddField}
                >
                  <Plus size={14} />
                  <span>Add Another Field</span>
                </button>
              </div>

              <div className="template-builder-group">
                <label>AI Guidance (Optional)</label>
                <textarea
                  className="template-builder-textarea"
                  placeholder="e.g. Help extract key lessons, critique arguments, and suggest related topics."
                  value={templateAiInstruction}
                  onChange={e => setTemplateAiInstruction(e.target.value)}
                />
              </div>

              <div className="template-builder-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={syncWithCalendar}
                    onChange={e => setSyncWithCalendar(e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--accent, #6366f1)' }}
                  />
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Calendar size={15} style={{ opacity: 0.8 }} />
                    Sync with Calendar
                  </span>
                </label>
                <small style={{ color: 'var(--text-muted, #888)', fontSize: '11px', marginTop: '4px', display: 'block', lineHeight: 1.4 }}>
                  Allow notes created with this template to schedule and sync events directly to your Muse Calendar.
                </small>
              </div>
            </div>

            <div className="template-builder-actions">
              <button
                type="button"
                className="template-cancel-btn"
                onClick={() => setViewMode('select')}
              >
                Cancel
              </button>
              <button
                type="button"
                className="template-save-btn"
                onClick={() => handleSaveTemplate(false)}
              >
                Save Template
              </button>
              <button
                type="button"
                className="template-primary-btn"
                onClick={() => handleSaveTemplate(true)}
              >
                Save & Write Note
              </button>
            </div>
          </div>
        )}
      </section>

      {deleteConfirmId && (
        <ConfirmModal
          isOpen={true}
          title="Delete Template"
          message="Are you sure you want to delete this specialized note template? Existing notes will keep their fields."
          confirmText="Delete template"
          danger={true}
          onConfirm={async () => {
            const id = deleteConfirmId
            setDeleteConfirmId(null)
            await deleteCustomTemplate(id)
            setCustomTemplates(getCustomTemplates())
          }}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  )
}
