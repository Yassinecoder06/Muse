export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export async function searchWeb(query: string, maxResults = 5): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = []
  const q = query.trim()
  if (!q) return results

  // 1. DuckDuckGo HTML search with text-browser User-Agent (fast, reliable, no bot challenge)
  try {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Lynx/2.8.9rel.1 libwww-FM/2.14 SSL-MM/1.4.1 OpenSSL/1.0.2l',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(6000)
    })

    if (res.ok) {
      const html = await res.text()
      const h2Matches = [...html.matchAll(/<h2 class="result__title">([\s\S]*?)<\/h2>/g)]
      const snippetMatches = [...html.matchAll(/<a class="result__snippet"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]

      for (let i = 0; i < snippetMatches.length && results.length < maxResults; i++) {
        const rawHref = snippetMatches[i][1] || ''
        let targetUrl = rawHref
        const uddgMatch = rawHref.match(/uddg=([^&]+)/)
        if (uddgMatch) {
          try {
            targetUrl = decodeURIComponent(uddgMatch[1])
          } catch {}
        }
        if (targetUrl.startsWith('//')) targetUrl = 'https:' + targetUrl

        const snippet = cleanHtml(snippetMatches[i][2] || '')
        let title = ''
        if (h2Matches[i]) {
          title = cleanHtml(h2Matches[i][1] || '')
        }
        if (!title) {
          title = snippet.slice(0, 60) + '...'
        }

        if (snippet && targetUrl) {
          results.push({ title, url: targetUrl, snippet })
        }
      }
    }
  } catch (err: any) {
    console.warn('[WebSearch] DuckDuckGo query failed:', err?.message || err)
  }

  // 2. Fallback to Wikipedia API if DuckDuckGo returned no results
  if (results.length === 0) {
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&utf8=&format=json`
      const res = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'MuseApp/1.0' },
        signal: AbortSignal.timeout(5000)
      })
      if (res.ok) {
        const data: any = await res.json()
        const items = data.query?.search || []
        for (const item of items.slice(0, maxResults)) {
          results.push({
            title: item.title,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`,
            snippet: cleanHtml(item.snippet || '')
          })
        }
      }
    } catch (err: any) {
      console.warn('[WebSearch] Wikipedia fallback failed:', err?.message || err)
    }
  }

  return results
}
