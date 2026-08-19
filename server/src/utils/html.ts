import sanitizeHtml from 'sanitize-html'

const reportClasses = new Set(['research-key-findings', 'report-dashboard', 'report-kpi-grid', 'report-kpi', 'report-chart', 'report-chart-row', ...Array.from({ length: 10 }, (_, index) => `report-fill-${index + 1}`)])

export function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] as string))
}

export function safeUrl(url: unknown) {
  const value = String(url || '').trim()
  try { return /^https?:$/i.test(new URL(value).protocol) ? value : '' } catch { return '' }
}

// Whitelist matches the client editor sanitizer so exported and stored report
// HTML stay interchangeable. Everything else is stripped.
function transformTag(tagName: string, attribs: Record<string, string>) {
  const allowedClass = (attribs.class || '').split(/\s+/).filter(name => reportClasses.has(name)).join(' ')
  const attrs: Record<string, string> = {}
  if (allowedClass) attrs.class = allowedClass
  if (tagName === 'a') {
    attrs.href = safeUrl(attribs.href)
    attrs.target = '_blank'
    attrs.rel = 'noreferrer noopener'
  }
  if (tagName === 'img') attrs.src = safeUrl(attribs.src)
  return { tagName, attribs: attrs }
}

export function sanitizeReportHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: ['a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'i', 'img', 'li', 'ol', 'p', 'pre', 'section', 'span', 'strong', 'ul'],
    allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src'], '*': ['class'] },
    allowedSchemes: ['https'],
    transformTags: { '*': transformTag },
    exclusiveFilter: frame => frame.tag === 'a' && !/^https:/i.test(frame.attribs.href || '')
  })
}
