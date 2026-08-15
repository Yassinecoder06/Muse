import mammoth from 'mammoth'
// Import the parser implementation directly. The package root is a CLI-style
// debug entrypoint that tries to open its bundled example PDF on ESM import.
import pdf from 'pdf-parse/lib/pdf-parse.js'

const maxBytes = 10 * 1024 * 1024
const maxChars = 60_000
const textExtensions = new Set(['md', 'markdown', 'txt'])
const allowed = new Map([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['md', 'text/markdown'], ['markdown', 'text/markdown'], ['txt', 'text/plain'], ['csv', 'text/csv']
])

function extension(filename: string) { return filename.trim().toLowerCase().split('.').pop() || '' }
function cleanFilename(value: string) { return value.replace(/[\\/\0]/g, '_').trim().slice(0, 255) }
function cleanText(value: string) { return value.replace(/\u0000/g, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars) }

export type ExtractedResearchDocument = { filename: string; mime: string; size: number; content: string }

export async function extractResearchDocument(rawFilename: string, declaredMime: string | undefined, data: Buffer): Promise<ExtractedResearchDocument> {
  const filename = cleanFilename(rawFilename)
  const type = extension(filename)
  const mime = allowed.get(type)
  if (!filename || !mime) throw new Error('Upload a PDF, DOCX, Markdown, text, or CSV file.')
  if (!data.length || data.length > maxBytes) throw new Error('Research documents must be between 1 byte and 10 MB.')
  const normalizedMime = String(declaredMime || '').split(';')[0].toLowerCase()
  if (normalizedMime && normalizedMime !== 'application/octet-stream' && normalizedMime !== mime && !(textExtensions.has(type) && normalizedMime.startsWith('text/'))) throw new Error('The file type does not match its filename.')
  if (type === 'pdf' && !data.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('This file is not a valid PDF.')
  if (type === 'docx' && !(data[0] === 0x50 && data[1] === 0x4b)) throw new Error('This file is not a valid DOCX document.')
  let extracted = ''
  if (type === 'pdf') extracted = (await pdf(data)).text
  else if (type === 'docx') extracted = (await mammoth.extractRawText({ buffer: data })).value
  else extracted = data.toString('utf8')
  const content = cleanText(extracted)
  if (!content) throw new Error('Muse could not extract readable text from this document.')
  return { filename, mime, size: data.length, content }
}
