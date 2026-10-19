import { api } from './api'

export type CustomTemplateField = {
  name: string
  defaultValue?: string
}

export type CustomTemplate = {
  id: string
  title: string
  description?: string
  fields: CustomTemplateField[]
  aiInstruction?: string
  color?: string
  syncWithCalendar?: boolean
  createdAt?: string
}

const TEMPLATES_KEY = 'muse-custom-templates'

export function normalizeTemplate(row: any): CustomTemplate {
  return {
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    fields: Array.isArray(row.fields) ? row.fields : [],
    aiInstruction: row.aiInstruction || row.ai_instruction || undefined,
    color: row.color || 'blue',
    syncWithCalendar: Boolean(row.syncWithCalendar ?? row.sync_with_calendar),
    createdAt: row.createdAt || row.created_at || new Date().toISOString()
  }
}

export function getCustomTemplates(): CustomTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(normalizeTemplate) : []
  } catch {
    return []
  }
}

export function setCustomTemplatesCache(templates: CustomTemplate[]): void {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates.map(normalizeTemplate)))
  } catch {}
}

export async function fetchCustomTemplates(): Promise<CustomTemplate[]> {
  try {
    const serverTemplates = await api.listTemplates()
    if (Array.isArray(serverTemplates)) {
      const normalized = serverTemplates.map(normalizeTemplate)
      setCustomTemplatesCache(normalized)
      return normalized
    }
  } catch (err) {
    console.warn('[Templates] Could not fetch server templates, using local cache:', err)
  }
  return getCustomTemplates()
}

export async function saveCustomTemplate(
  template: Omit<CustomTemplate, 'id' | 'createdAt'> & { id?: string }
): Promise<CustomTemplate> {
  const current = getCustomTemplates()
  const payload = {
    title: template.title,
    description: template.description || null,
    fields: template.fields || [],
    ai_instruction: template.aiInstruction || null,
    color: template.color || 'blue',
    sync_with_calendar: Boolean(template.syncWithCalendar)
  }

  let savedRecord: CustomTemplate
  try {
    if (template.id && !template.id.startsWith('local-')) {
      const res = await api.updateTemplate(template.id, payload as any)
      savedRecord = normalizeTemplate(res)
    } else {
      const res = await api.createTemplate(payload as any)
      savedRecord = normalizeTemplate(res)
    }
  } catch (err) {
    console.warn('[Templates] Server save failed, saving locally:', err)
    savedRecord = {
      ...template,
      id: template.id || `local-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString()
    }
  }

  const existingIndex = current.findIndex(t => t.id === savedRecord.id)
  if (existingIndex >= 0) {
    current[existingIndex] = savedRecord
  } else {
    current.unshift(savedRecord)
  }

  setCustomTemplatesCache(current)
  return savedRecord
}

export async function deleteCustomTemplate(id: string): Promise<void> {
  try {
    if (!id.startsWith('local-')) {
      await api.deleteTemplate(id)
    }
  } catch (err) {
    console.warn('[Templates] Server delete failed:', err)
  }

  const filtered = getCustomTemplates().filter(t => t.id !== id)
  setCustomTemplatesCache(filtered)
}
