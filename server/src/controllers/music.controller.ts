import fs from 'node:fs'
import path from 'node:path'
import type { Request, Response } from 'express'

export interface MusicTrack {
  filename: string
  title: string
  size: number
  url: string
}

const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'])

export function getMusicDir(): string {
  const envDir = process.env.MUSIC_DIR
  if (envDir && fs.existsSync(envDir)) return envDir

  // 1. Docker mounted volume inside container
  const dockerDir = path.resolve('/app/music')
  if (fs.existsSync(dockerDir)) return dockerDir

  // 2. Project root /music relative to process.cwd()
  const cwdDir = path.resolve(process.cwd(), 'music')
  if (fs.existsSync(cwdDir)) return cwdDir

  // 3. Parent directory /music if cwd is /server
  const parentDir = path.resolve(process.cwd(), '../music')
  if (fs.existsSync(parentDir)) return parentDir

  return cwdDir
}

function cleanTitle(filename: string): string {
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  // Clean up typical download suffixes like -SnapYT.App, -YouTube, etc.
  const cleaned = base
    .replace(/[-_]?(SnapYT\.App|YouTube|Official|Audio|Video|Lyrics)/gi, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return cleaned || base
}

export function getAvailableSongs(): MusicTrack[] {
  const dir = getMusicDir()
  if (!fs.existsSync(dir)) return []

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const tracks: MusicTrack[] = []

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue

      try {
        const fullPath = path.join(dir, entry.name)
        const stat = fs.statSync(fullPath)
        tracks.push({
          filename: entry.name,
          title: cleanTitle(entry.name),
          size: stat.size,
          url: `/api/music/stream/${encodeURIComponent(entry.name)}`
        })
      } catch {}
    }

    return tracks
  } catch (err) {
    console.error('Error scanning music directory:', err)
    return []
  }
}

export async function listSongs(_req: Request, res: Response) {
  try {
    const songs = getAvailableSongs()
    res.json({ songs })
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to list music tracks' })
  }
}

export async function streamSong(req: Request, res: Response) {
  try {
    const filename = req.params.filename
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Filename parameter is required' })
    }

    // Security: sanitize against path traversal
    const safeBase = path.basename(filename)
    if (safeBase !== filename) {
      return res.status(400).json({ error: 'Invalid filename' })
    }

    const musicDir = getMusicDir()
    const filePath = path.join(musicDir, safeBase)

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audio file not found in music folder' })
    }

    const stat = fs.statSync(filePath)
    const fileSize = stat.size
    const range = req.headers.range

    const ext = path.extname(safeBase).toLowerCase()
    let contentType = 'audio/mpeg'
    if (ext === '.wav') contentType = 'audio/wav'
    else if (ext === '.ogg') contentType = 'audio/ogg'
    else if (ext === '.m4a') contentType = 'audio/mp4'
    else if (ext === '.flac') contentType = 'audio/flac'

    // Stream with Range support (HTTP 206) for seeking & smooth audio playback
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1

      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).set('Content-Range', `bytes */${fileSize}`).end()
        return
      }

      const chunkSize = end - start + 1
      const stream = fs.createReadStream(filePath, { start, end })

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      })

      stream.pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      })

      fs.createReadStream(filePath).pipe(res)
    }
  } catch (err: any) {
    console.error('Error streaming audio file:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || 'Error streaming music' })
    }
  }
}
