const IMAGE_TAG = /<img\b[^>]*>/gi
const MARKER = /\[IMAGE\s+\d+\]/gi

export function extractImageTags(html: string) {
  const images: string[] = []
  const text = html.replace(IMAGE_TAG, tag => { images.push(tag); return `[IMAGE ${images.length}]` })
  return { text, images }
}

export function restoreImages(text: string, images: string[]) {
  const cleaned = text.replace(MARKER, '').replace(/\n{3,}/g, '\n\n').trim()
  const appended = images.join('\n')
  return appended ? `${cleaned}\n\n${appended}` : cleaned
}

export function stripImages(html: string) {
  return html.replace(IMAGE_TAG, '')
}