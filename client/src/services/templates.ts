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
  createdAt?: string
}

const TEMPLATES_KEY = 'muse-custom-templates'

export function getCustomTemplates(): CustomTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCustomTemplate(template: Omit<CustomTemplate, 'id' | 'createdAt'> & { id?: string }): CustomTemplate {
  const templates = getCustomTemplates()
  const id = template.id || crypto.randomUUID()
  const record: CustomTemplate = {
    ...template,
    id,
    createdAt: new Date().toISOString()
  }

  const existingIndex = templates.findIndex(t => t.id === id)
  if (existingIndex >= 0) {
    templates[existingIndex] = record
  } else {
    templates.unshift(record)
  }

  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates))
  return record
}

export function deleteCustomTemplate(id: string): void {
  const templates = getCustomTemplates().filter(t => t.id !== id)
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates))
}
