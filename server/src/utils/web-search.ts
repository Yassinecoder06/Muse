export type SearchResult = { title: string; url: string; snippet: string }

const resultAnchor = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis
const snippetAnchor = /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gis

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#x27;/gi, "'").replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ').replace(/<[^>]+>/g, '')
    .trim()
}

export async function webSearch(query: string, limit = 5): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Web search failed: ${response.status}`)
  const html = await response.text()
  const anchors = [...html.matchAll(resultAnchor)]
  const snippets = [...html.matchAll(snippetAnchor)]
  const results: SearchResult[] = []
  for (let index = 0; index < anchors.length && results.length < limit; index++) {
    let url = anchors[index][1]
    if (url.startsWith('//')) url = `https:${url}`
    const redirect = url.match(/[?&]uddg=([^&]+)/)
    if (redirect) url = decodeURIComponent(redirect[1])
    if (url.startsWith('/l/?uddg=')) url = decodeURIComponent(url.replace('/l/?uddg=', ''))
    if (!/^https?:\/\//i.test(url)) continue
    const match = url.match(/^https?:\/\/([^/]+)/)
    results.push({
      title: decodeEntities(anchors[index][2]),
      url,
      snippet: decodeEntities(snippets[index]?.[1] || match?.[1] || '')
    })
  }
  return results
}