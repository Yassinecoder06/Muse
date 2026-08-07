const IMAGE_TAG = /<img\b[^>]*>/gi
const MARKER = /\[IMAGE\s+\d+\]/gi

export function extractImageTags(html: string) {
  const images: string[] = []
  const text = html.replace(IMAGE_TAG, tag => { images.push(tag); return `[IMAGE ${images.length}]` })
  return { text, images }
}

export function restoreImages(text: string, images: string[]) {
  const used = new Set<number>()
  const restored = text.replace(MARKER, marker => {
    const index = Number(marker.replace(/\D+/g, ''))
    if (!Number.isInteger(index) || index < 1 || index > images.length) return ''
    used.add(index)
    return images[index - 1]
  })
  const cleaned = restored.replace(/\n{3,}/g, '\n\n').trim()
  const leftover = images.filter((_, index) => !used.has(index + 1))
  const appended = leftover.join('\n')
  return appended ? `${cleaned}\n\n${appended}` : cleaned
}

export function stripImages(html: string) {
  return html.replace(IMAGE_TAG, '')
}