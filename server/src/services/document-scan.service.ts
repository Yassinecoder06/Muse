import JSZip from 'jszip'

export type ScanResult = { status: 'clean' | 'flagged'; notes: string }

export function httpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  return error
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(httpError(408, message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
const MAX_COMPRESSION_RATIO = 100
const DANGEROUS_PARTS = [/vbaProject/i, /activeX/i, /oleObject\d+\.bin$/i, /\.(exe|js|vbs|scr|dll|msi)$/i]
const PDF_THREATS = ['/JavaScript', '/JS(', '/JS<', '/JS ', '/Launch', '/OpenAction', '/AA[', '/AA<', '/EmbeddedFile', '/XFA', '/Encrypt']
const INJECTION_PATTERNS: [string, RegExp][] = [
  ['instructs the AI to ignore previous instructions', /ignore (?:all |any )?(?:previous|prior|above|earlier) (?:instructions?|prompts?|rules?)/i],
  ['instructs the AI to disregard prior context', /disregard (?:all |any )?(?:previous|prior|above|earlier) (?:instructions?|prompts?|context)/i],
  ['attempts to redefine the assistant role', /you are now(?: going to act)? as|pretend you are (?:a|an|in)\b/i],
  ['contains fake system or role markers', /<\|im_(?:start|end)\|>|\[\s*system\s*\]\s*:/i],
  ['attempts to extract the hidden prompt', /reveal (?:your|the) (?:system )?prompt|output (?:your|the) (?:system|hidden) (?:prompt|instructions)/i],
  ['repeats a long block of control characters', /(.)\1{60,}/]
]

// Prompt-injection detection scans the human-visible text (after whitespace
// normalization) so that attempts hidden via carriage returns, zero-width
// joinsers, or right-to-left marks still match.
function visibleText(raw: string) {
  return raw
    .replace(/\r(?!\n)/g, '\n')
    .replace(/[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
}

export function injectionFlags(text: string) {
  const normalized = visibleText(text)
  return INJECTION_PATTERNS.filter(([, pattern]) => pattern.test(normalized)).map(([label]) => label)
}

export async function scanResearchDocument(extension: string, data: Buffer, extractedText: string): Promise<ScanResult> {
  if (extension === 'docx') await scanDocx(data)
  if (extension === 'pdf') scanPdf(data)
  const flags = injectionFlags(extractedText)
  return flags.length ? { status: 'flagged', notes: `Possible prompt injection: ${flags.join('; ')}.` } : { status: 'clean', notes: '' }
}

async function scanDocx(data: Buffer) {
  let zip: JSZip
  try {
    zip = await withTimeout(JSZip.loadAsync(data), 15_000, 'This document took too long to inspect and was rejected.')
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) throw error
    throw httpError(400, 'This file is not a readable DOCX document.')
  }
  let uncompressed = 0
  for (const [name, entry] of Object.entries(zip.files)) {
    const traversal = name.includes('../') || name.includes('..\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split(/[/\\]/).some(part => part === '..')
    if (traversal) throw httpError(400, 'This document contains suspicious file paths and was rejected.')
    if (DANGEROUS_PARTS.some(pattern => pattern.test(name))) throw httpError(400, 'This document contains macros or embedded objects and was rejected.')
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0
    uncompressed += size
    if (uncompressed > MAX_UNCOMPRESSED_BYTES) throw httpError(400, 'This document expands to an unsafe size and was rejected.')
  }
  if (data.length && uncompressed > data.length * MAX_COMPRESSION_RATIO && uncompressed > 10 * 1024 * 1024) throw httpError(400, 'This document has an unsafe compression ratio and was rejected.')
}

function scanPdf(data: Buffer) {
  const sample = data.toString('latin1', 0, Math.min(data.length, 2 * 1024 * 1024))
  for (const threat of PDF_THREATS) {
    if (sample.includes(threat)) throw httpError(400, 'This PDF contains script or embedded-content structures and was rejected.')
  }
}
