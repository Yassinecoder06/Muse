import type { JSONSchema } from './types.js'

const TYPE_NAMES: Record<string, string> = {
  OBJECT: 'object', STRING: 'string', NUMBER: 'number', INTEGER: 'integer', BOOLEAN: 'boolean', ARRAY: 'array'
}

/**
 * Converts Bip's Gemini-style declarations (`type: 'OBJECT'`) into standard
 * JSON Schema that every MCP client understands. Unknown keys are dropped.
 */
export function normalizeSchema(value: unknown): JSONSchema {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>
  const schema: JSONSchema = {}
  if (typeof source.type === 'string') schema.type = TYPE_NAMES[source.type.toUpperCase()] ?? source.type.toLowerCase()
  if (typeof source.description === 'string') schema.description = source.description
  if (Array.isArray(source.enum)) schema.enum = [...source.enum]
  if (source.properties && typeof source.properties === 'object') {
    schema.properties = Object.fromEntries(
      Object.entries(source.properties as Record<string, unknown>).map(([key, child]) => [key, normalizeSchema(child)])
    )
  }
  if (Array.isArray(source.required)) {
    const required = source.required.filter((key): key is string => typeof key === 'string')
    if (required.length) schema.required = required
  }
  if (source.items) schema.items = normalizeSchema(source.items)
  return schema
}

/** MCP requires every tool input schema to be an object schema. */
export function objectSchema(schema: JSONSchema): JSONSchema {
  return schema.type === 'object' ? { ...schema, properties: schema.properties ?? {} } : { type: 'object', properties: {} }
}
