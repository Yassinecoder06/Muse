import fs from 'node:fs'
import path from 'node:path'
import type { Request, Response } from 'express'
import { supabase } from '../supabase/client.js'

export interface MusicTrack {
  filename: string
  title: string
  artist?: string
  size: number
  mtime: number
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

function getDownloaderUrl(): string {
  return process.env.MUSIC_DOWNLOADER_URL || 'http://music-downloader:8001'
}

export function parseTrackInfo(filename: string): { title: string; artist?: string } {
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  // Clean up typical download suffixes like -SnapYT.App, -YouTube, etc.
  const cleaned = base
    .replace(/[-_]?(SnapYT\.App|YouTube|Official|Audio|Video|Lyrics)/gi, '')
    .trim()

  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ')
    const artist = parts[0].trim()
    const title = parts.slice(1).join(' - ').trim()
    return { title: title || base, artist: artist || undefined }
  }

  if (/\s+by\s+/i.test(cleaned)) {
    const parts = cleaned.split(/\s+by\s+/i)
    return { title: parts[0].trim(), artist: parts[1].trim() }
  }

  // Check common band/artist patterns e.g. "Imagine Dragons", "Sabrina Carpenter"
  const commonArtists = [
    'Imagine Dragons',
    'Sabrina Carpenter',
    'Franz Ferdinand',
    'Creepy Nuts',
    'Dua Lipa',
    'The Weeknd',
    'Taylor Swift',
    'Ado',
    'Cartoon',
    'Ed Sheeran',
    'Coldplay',
    'Billie Eilish',
    'Queen',
    'Eminem',
    'Drake',
    'Post Malone',
    'Bruno Mars',
    'Ariana Grande',
    'Justin Bieber',
    'Maroon 5',
    'Adele'
  ]

  for (const ca of commonArtists) {
    const caLower = ca.toLowerCase()
    const cLower = cleaned.toLowerCase()
    if (cLower.endsWith(` ${caLower}`)) {
      const title = cleaned.slice(0, -(ca.length + 1)).trim()
      return { title: title || cleaned, artist: ca }
    }
    if (cLower.startsWith(`${caLower} `)) {
      const title = cleaned.slice(ca.length + 1).trim()
      return { title: title || cleaned, artist: ca }
    }
  }

  return { title: cleaned || base }
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
        const parsed = parseTrackInfo(entry.name)
        tracks.push({
          filename: entry.name,
          title: parsed.title,
          artist: parsed.artist,
          size: stat.size,
          mtime: stat.mtimeMs,
          url: `/api/music/stream/${encodeURIComponent(entry.name)}`
        })
      } catch {}
    }

    // Sort newest first
    tracks.sort((a, b) => b.mtime - a.mtime)
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

export async function downloadBatch(req: Request, res: Response) {
  try {
    const rawItems: any[] = Array.isArray(req.body?.items) ? req.body.items : []
    const available = getAvailableSongs()

    // Deduplicate: filter out items that already exist in the library
    const newItems = rawItems.filter((item: any) => {
      const cleanName = (item.filename || '').toLowerCase().trim()
      const title = (item.title || '').toLowerCase().trim()
      const artist = (item.artist || '').toLowerCase().trim()

      return !available.some(s => {
        if (cleanName && s.filename.toLowerCase() === cleanName) return true
        if (title && artist && s.title.toLowerCase() === title && (s.artist || '').toLowerCase() === artist) return true
        if (title && s.title.toLowerCase() === title && title.length > 3) return true
        return false
      })
    })

    // If all items already exist, return cached completed tasks
    if (newItems.length === 0 && rawItems.length > 0) {
      return res.json({
        tasks: rawItems.map((item: any) => ({
          task_id: item.id || `cached_${Date.now()}`,
          status: 'completed',
          progress_percent: 100,
          title: item.title,
          artist: item.artist,
          filename: item.filename,
          already_existed: true
        }))
      })
    }

    const downloaderUrl = getDownloaderUrl()
    const response = await fetch(`${downloaderUrl}/api/download/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req.body, items: newItems })
    })

    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json(data)
    }
    res.json(data)
  } catch (err: any) {
    console.error('Error forwarding to music downloader:', err)
    res.status(502).json({ error: err?.message || 'Music downloader service unavailable' })
  }
}

export async function getTasks(_req: Request, res: Response) {
  try {
    const downloaderUrl = getDownloaderUrl()
    const response = await fetch(`${downloaderUrl}/api/tasks`)
    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json(data)
    }
    res.json(data)
  } catch (err: any) {
    console.error('Error fetching download tasks:', err)
    res.status(502).json({ error: err?.message || 'Music downloader service unavailable' })
  }
}

export async function getTask(req: Request, res: Response) {
  try {
    const downloaderUrl = getDownloaderUrl()
    const response = await fetch(`${downloaderUrl}/api/tasks/${req.params.id}`)
    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json(data)
    }
    res.json(data)
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Music downloader service unavailable' })
  }
}

export async function deleteTask(req: Request, res: Response) {
  try {
    const downloaderUrl = getDownloaderUrl()
    const response = await fetch(`${downloaderUrl}/api/tasks/${req.params.id}`, {
      method: 'DELETE'
    })
    const data = await response.json()
    if (!response.ok) {
      return res.status(response.status).json(data)
    }
    res.json(data)
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Music downloader service unavailable' })
  }
}

export async function deleteSong(req: Request, res: Response) {
  try {
    const filename = req.params.filename
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Filename is required' })
    }

    const safeBase = path.basename(filename)
    if (safeBase !== filename) {
      return res.status(400).json({ error: 'Invalid filename' })
    }

    const musicDir = getMusicDir()
    const filePath = path.join(musicDir, safeBase)

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' })
    }

    fs.unlinkSync(filePath)
    res.json({ success: true, message: `Deleted ${safeBase}` })
  } catch (err: any) {
    console.error('Error deleting music file:', err)
    res.status(500).json({ error: err?.message || 'Failed to delete audio file' })
  }
}

export async function deleteSongsBatch(req: Request, res: Response) {
  try {
    const filenames: string[] = Array.isArray(req.body?.filenames) ? req.body.filenames : []
    if (!filenames.length) {
      return res.status(400).json({ error: 'filenames array is required and must not be empty' })
    }

    const musicDir = getMusicDir()
    let deletedCount = 0
    const deleted: string[] = []
    const errors: string[] = []

    for (const filename of filenames) {
      if (!filename || typeof filename !== 'string') continue
      const safeBase = path.basename(filename)
      if (safeBase !== filename) continue

      const filePath = path.join(musicDir, safeBase)
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath)
          deletedCount++
          deleted.push(safeBase)
        } catch (err: any) {
          errors.push(`Failed to delete ${safeBase}: ${err?.message}`)
        }
      }
    }

    res.json({
      success: true,
      deletedCount,
      deleted,
      errors: errors.length ? errors : undefined,
      message: `Successfully deleted ${deletedCount} songs`
    })
  } catch (err: any) {
    console.error('Error batch deleting songs:', err)
    res.status(500).json({ error: err?.message || 'Failed to batch delete songs' })
  }
}

export async function getAnalytics(_req: Request, res: Response) {
  try {
    const songs = getAvailableSongs()
    const totalBytes = songs.reduce((acc, s) => acc + s.size, 0)
    const totalMb = Math.round((totalBytes / (1024 * 1024)) * 10) / 10

    const artistCounts: Record<string, number> = {}
    for (const song of songs) {
      const artist = song.artist || 'Unknown Artist'
      artistCounts[artist] = (artistCounts[artist] || 0) + 1
    }

    const topArtists = Object.entries(artistCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    res.json({
      totalSongs: songs.length,
      totalBytes,
      totalMb,
      topArtists,
      recentSongs: songs.slice(0, 10)
    })
  } catch (err: any) {
    console.error('Error computing music analytics:', err)
    res.status(500).json({ error: err?.message || 'Failed to get music analytics' })
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
    let resolvedBase = safeBase
    let filePath = path.join(musicDir, resolvedBase)

    if (!fs.existsSync(filePath)) {
      // Smart fuzzy match against available music files
      const rawQuery = path.basename(safeBase, path.extname(safeBase)).toLowerCase().trim()
      const available = getAvailableSongs()
      const match = available.find(s => {
        const titleLower = s.title.toLowerCase()
        const fileLower = s.filename.toLowerCase()
        return (
          fileLower === safeBase.toLowerCase() ||
          titleLower === rawQuery ||
          fileLower.includes(rawQuery) ||
          titleLower.includes(rawQuery) ||
          rawQuery.includes(titleLower)
        )
      })

      if (match) {
        resolvedBase = match.filename
        filePath = path.join(musicDir, resolvedBase)
      } else {
        return res.status(404).json({ error: 'Audio file not found in music folder' })
      }
    }

    const stat = fs.statSync(filePath)
    const fileSize = stat.size
    const range = req.headers.range

    const ext = path.extname(resolvedBase).toLowerCase()
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

// ---------------------------------------------------------------------------
// Music Playlists
// ---------------------------------------------------------------------------

export function resolvePlaylistTracks(tracks: any[]): any[] {
  const available = getAvailableSongs()
  return tracks.map(t => {
    const fn = (t.filename || '').toLowerCase().trim()
    const title = (t.title || '').toLowerCase().trim()
    const match = available.find(s => {
      const sFn = s.filename.toLowerCase()
      const sTitle = s.title.toLowerCase()
      const baseFn = fn.replace(/\.mp3$/, '')
      return (
        sFn === fn ||
        sTitle === title ||
        (baseFn && sFn.includes(baseFn)) ||
        (title && (sTitle.includes(title) || sFn.includes(title)))
      )
    })
    if (match) {
      return {
        filename: match.filename,
        title: match.title,
        artist: match.artist,
        url: match.url,
        size: match.size
      }
    }
    return t
  })
}

export async function createPlaylistInternal(
  userId: string,
  name: string,
  songQueries: string[] = [],
  description = ''
): Promise<{ id: string; name: string; description: string; tracks: any[] }> {
  const available = getAvailableSongs()
  const rawTracks: any[] = []

  for (const item of songQueries) {
    let q = ''
    let explicitTitle = ''
    let explicitArtist = ''

    if (typeof item === 'string') {
      q = item.trim()
    } else if (item && typeof item === 'object') {
      explicitTitle = String((item as any).title || (item as any).name || '').trim()
      explicitArtist = String((item as any).artist || (item as any).author || '').trim()
      q = explicitArtist ? `${explicitArtist} - ${explicitTitle}` : explicitTitle
    }

    if (!q && !explicitTitle) continue
    const qLower = q.toLowerCase()

    const match = available.find(
      s => s.title.toLowerCase().includes(qLower) ||
           s.filename.toLowerCase().includes(qLower) ||
           (s.artist && s.artist.toLowerCase().includes(qLower)) ||
           (explicitTitle && s.title.toLowerCase().includes(explicitTitle.toLowerCase()))
    )
    if (match) {
      rawTracks.push({
        filename: match.filename,
        title: match.title,
        artist: match.artist,
        url: match.url,
        size: match.size
      })
    } else {
      const parsed = explicitTitle ? { title: explicitTitle, artist: explicitArtist } : parseTrackInfo(q)
      const filename = parsed.artist ? `${parsed.artist} - ${parsed.title}.mp3` : `${parsed.title}.mp3`
      rawTracks.push({
        filename,
        title: parsed.title,
        artist: parsed.artist,
        url: `/api/music/stream/${encodeURIComponent(filename)}`,
        size: 0
      })
    }
  }

  const tracks = resolvePlaylistTracks(rawTracks)

  const { data, error } = await supabase
    .from('music_playlists')
    .insert({
      user_id: userId,
      name: name.trim() || 'New Playlist',
      description: description.trim(),
      tracks
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function listPlaylists(req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('music_playlists')
      .select('*')
      .eq('user_id', req.userId!)
      .order('updated_at', { ascending: false })

    if (error) throw error
    const resolved = (data || []).map(p => ({
      ...p,
      tracks: resolvePlaylistTracks(p.tracks || [])
    }))
    res.json({ playlists: resolved })
  } catch (err: any) {
    console.error('Error listing playlists:', err)
    res.status(500).json({ error: err?.message || 'Failed to list playlists' })
  }
}

export async function createPlaylist(req: Request, res: Response) {
  try {
    const { name, description, tracks } = req.body
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Playlist name is required' })
    }

    const { data, error } = await supabase
      .from('music_playlists')
      .insert({
        user_id: req.userId!,
        name: name.trim(),
        description: typeof description === 'string' ? description.trim() : '',
        tracks: Array.isArray(tracks) ? tracks : []
      })
      .select('*')
      .single()

    if (error) throw error
    res.json(data)
  } catch (err: any) {
    console.error('Error creating playlist:', err)
    res.status(500).json({ error: err?.message || 'Failed to create playlist' })
  }
}

export async function getPlaylist(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data, error } = await supabase
      .from('music_playlists')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.userId!)
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Playlist not found' })
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to fetch playlist' })
  }
}

export async function updatePlaylist(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { name, description, tracks } = req.body

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (typeof name === 'string' && name.trim()) updates.name = name.trim()
    if (typeof description === 'string') updates.description = description.trim()
    if (Array.isArray(tracks)) updates.tracks = tracks

    const { data, error } = await supabase
      .from('music_playlists')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.userId!)
      .select('*')
      .single()

    if (error) throw error
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update playlist' })
  }
}

export async function deletePlaylist(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { error } = await supabase
      .from('music_playlists')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId!)

    if (error) throw error
    res.json({ success: true, message: 'Playlist deleted' })
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to delete playlist' })
  }
}
