import { useMemo, useState } from 'react'
import { marked } from 'marked'
import { Check, Copy, BookmarkPlus } from 'lucide-react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

marked.setOptions({
  gfm: true,
  breaks: true
})

function processLatexAndMarkdown(content: string): string {
  const placeholders: string[] = []
  const tokenPrefix = '@@MUSE_KATEX_'

  // 1. Block math: $$ ... $$
  let text = content.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    // Sanitize unescaped % so closing braces are not commented out
    const sanitized = math.replace(/(^|[^\\])%/g, '$1\\%').trim()
    let rendered = ''
    try {
      rendered = katex.renderToString(sanitized, { displayMode: true, throwOnError: false })
    } catch {
      rendered = `<div class="katex-display">$$${sanitized}$$</div>`
    }
    const idx = placeholders.length
    placeholders.push(rendered)
    return `\n\n${tokenPrefix}${idx}@@\n\n`
  })

  // 2. Inline math: $ ... $ (excluding single currency like $5 or $20.99)
  text = text.replace(/(?<!\\)\$([^\$\n]+?)(?<!\\)\$/g, (fullMatch, math) => {
    if (/^\s*\d+(\.\d+)?\s*$/.test(math)) {
      return fullMatch
    }
    const sanitized = math.replace(/(^|[^\\])%/g, '$1\\%').trim()
    let rendered = ''
    try {
      rendered = katex.renderToString(sanitized, { displayMode: false, throwOnError: false })
    } catch {
      rendered = fullMatch
    }
    const idx = placeholders.length
    placeholders.push(rendered)
    return `${tokenPrefix}${idx}@@`
  })

  // 3. Parse with marked
  let html = marked.parse(text, { async: false }) as string

  // 4. Restore KaTeX placeholders (marked may wrap standalone block placeholders in <p> tags)
  html = html.replace(new RegExp(`(?:<p>)?${tokenPrefix}(\\d+)@@(?:<\\/p>)?`, 'g'), (_, idx) => {
    return placeholders[Number(idx)] || ''
  })

  return html
}

interface FormattedMessageProps {
  text: string
  role?: 'user' | 'assistant'
  onCreateNote?: (input: { title: string; content: string }) => void
}

export function FormattedMessage({ text, role = 'assistant', onCreateNote }: FormattedMessageProps) {
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  const { html, title } = useMemo(() => {
    if (role === 'user') {
      return { html: '', title: '' }
    }

    // Clean up headings that have redundant asterisks: `### **Heading**` -> `### Heading`
    let clean = text.replace(/^(#{1,6})\s*\*\*([^*]+)\*\*\s*$/gm, '$1 $2')

    // Extract title if present in heading
    const titleMatch = clean.match(/^#{1,4}\s+(.+)$/m)
    const detectedTitle = titleMatch ? titleMatch[1].replace(/[*_#]/g, '').trim() : 'AI Research'

    let disclaimerHtml = ''

    // Detect if message starts with a notes disclaimer followed by a separator or double newline
    const hrParts = clean.split(/\n\s*---+\s*\n/)
    if (hrParts.length > 1 && /(?:retrieved notes|notes? do not contain|from general knowledge|not found in your notes)/i.test(hrParts[0])) {
      const disclaimer = hrParts[0].trim()
      clean = hrParts.slice(1).join('\n\n---\n\n').trim()
      disclaimerHtml = `<div class="ai-callout-notice"><span class="ai-callout-icon">✦</span><div class="ai-callout-text">${processLatexAndMarkdown(disclaimer)}</div></div>`
    } else {
      const paraParts = clean.split(/\n\n+/)
      if (paraParts.length > 1 && /^(?:The retrieved notes|My notes|None of your notes|Your notes do not)[^\n]*?(?:do not contain|no information|not mention|could not find)/i.test(paraParts[0])) {
        const disclaimer = paraParts[0].trim()
        clean = paraParts.slice(1).join('\n\n').trim()
        disclaimerHtml = `<div class="ai-callout-notice"><span class="ai-callout-icon">✦</span><div class="ai-callout-text">${processLatexAndMarkdown(disclaimer)}</div></div>`
      }
    }

    const mainHtml = processLatexAndMarkdown(clean)
    return {
      html: `${disclaimerHtml}${mainHtml}`,
      title: detectedTitle
    }
  }, [text, role])

  if (role === 'user') {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
  }

  function handleCopy() {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleSaveNote() {
    if (!onCreateNote) return
    onCreateNote({
      title: title || 'AI Research Note',
      content: html
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="formatted-ai-response-container">
      <div
        className="formatted-ai-response"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="formatted-msg-actions">
        <button onClick={handleCopy} title="Copy response to clipboard">
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
        {onCreateNote && (
          <button onClick={handleSaveNote} title="Save this response as a new note in Muse">
            {saved ? <><Check size={12} /> Note Created!</> : <><BookmarkPlus size={12} /> Save to Note</>}
          </button>
        )}
      </div>
    </div>
  )
}
