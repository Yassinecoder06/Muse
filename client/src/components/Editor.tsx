import { ArrowLeft, Bold, Bookmark, Calendar, CalendarCheck, Check, Code2, ExternalLink, FileText, Heading1, Heading2, Image, Italic, List, ListChecks, Mic, MicOff, MoreHorizontal, Plus, Quote, Sparkles, Square, Star, Trash2, Volume2, WandSparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { marked } from 'marked'
import { api, resolveApiImageSrc, relativizeApiImageSrc } from '../services/api'
import type { AiJob, CalendarEvent, Note, NoteInput, SpecializedNote } from '../types'
import { saveCustomTemplate } from '../services/templates'
import { ChatPanel } from './ChatPanel'
import { ScheduleDetectorModal } from './ScheduleDetectorModal'
import { activeVaultUser } from '../services/vault'
import { robotAudio } from '../services/robot-audio.service'
import { tts } from '../services/tts.service'
import { stt } from '../services/stt.service'

const rewriteModes = ['improve', 'professional', 'friendly', 'shorter', 'longer', 'grammar']
const allowedTags = new Set(['A', 'B', 'BR', 'BLOCKQUOTE', 'CODE', 'DEL', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'LI', 'OL', 'P', 'PRE', 'SECTION', 'SPAN', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'UL'])
const reportClasses = new Set(['muse-report', 'report-meta', 'research-key-findings', 'report-dashboard', 'report-kpi-grid', 'report-kpi', 'report-chart', 'report-chart-row', 'report-data-gap', ...Array.from({ length: 10 }, (_, index) => `report-fill-${index + 1}`)])

function prepareContent(raw: string): { html: string; extractedTitle?: string } {
  if (!raw) return { html: '' }

  let extractedTitle: string | undefined
  let source = raw

  // If starts with markdown H1: # Title
  const h1Match = source.match(/^\s*#\s+([^\n]+)\n?/)
  if (h1Match) {
    extractedTitle = h1Match[1].replace(/[*_`]/g, '').trim()
    source = source.replace(/^\s*#\s+[^\n]+\n?/, '').trim()
  }

  // Check if content has Markdown syntax or is plain text lacking block HTML
  const hasMarkdown = /(?:^#{1,6}\s+|^\s*[-*+]\s+|^\s*\d+\.\s+|^\s*>\s+|```|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|^\s*---+\s*$)/m.test(source)
  const isPlainOrMarkdown = !/<(?:p|div|h[1-6]|ul|ol|table|blockquote|section)\b/i.test(source)

  let html = source
  if (hasMarkdown || isPlainOrMarkdown) {
    try {
      html = (marked.parse(source, { async: false, breaks: true, gfm: true }) as string)
        .replace(/>\s*\n\s*</g, '><')
        .trim()
    } catch {
      html = source
    }
  }

  return { html, extractedTitle }
}

function sanitizeHtml(value: string) {
  const container = document.createElement('div')
  container.innerHTML = value
  for (const element of [...container.querySelectorAll('*')]) {
      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(...Array.from(element.childNodes))
        continue
      }
      const source = element.getAttribute('src') || ''
      const href = element.getAttribute('href') || ''
      const approvedClasses = [...element.classList].filter(name => reportClasses.has(name))
      for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name)
      if (element.tagName === 'IMG') {
        if (!/^(https?:\/\/|\/api\/images\/|data:image\/(?:png|jpe?g|gif|webp|avif);base64,)/i.test(source)) element.remove()
        else element.setAttribute('src', source)
      }
      if (element.tagName === 'A') {
        if (!/^https:\/\//i.test(href)) element.replaceWith(...Array.from(element.childNodes))
        else { element.setAttribute('href', href); element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noreferrer noopener') }
      }
      if (approvedClasses.length) element.setAttribute('class', approvedClasses.join(' '))
    }
  return container.innerHTML
}

function decorateKeyFindings(value: string) {
  const container = document.createElement('div')
  container.innerHTML = value
  for (const heading of [...container.querySelectorAll('h2')]) {
    if (!/^\s*key findings\s*$/i.test(heading.textContent || '') || heading.closest('section.research-key-findings')) continue
    const card = document.createElement('section')
    card.className = 'research-key-findings'
    heading.before(card)
    card.append(heading)
    while (card.nextElementSibling && card.nextElementSibling.tagName !== 'H2') card.append(card.nextElementSibling)
  }
  return container.innerHTML
}

function researchOutline(value: string) {
  const container = document.createElement('div')
  container.innerHTML = value
  const headings = [...container.querySelectorAll('h2')].map(heading => (heading.textContent || '').trim()).filter(Boolean)
  const sourceHeading = [...container.querySelectorAll('h2')].find(heading => /^\s*sources?\s*$/i.test(heading.textContent || ''))
  const sourceCount = sourceHeading?.nextElementSibling?.tagName === 'OL' ? sourceHeading.nextElementSibling.querySelectorAll('li').length : 0
  return { headings, sourceCount }
}

function plainText(html: string) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function withImageUrls(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  for (const image of [...container.querySelectorAll('img')]) {
    const src = image.getAttribute('src')
    if (src) image.setAttribute('src', resolveApiImageSrc(src))
  }
  return container.innerHTML
}

function toStoredHtml(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  for (const image of [...container.querySelectorAll('img')]) {
    const src = image.getAttribute('src')
    if (src) image.setAttribute('src', relativizeApiImageSrc(src))
  }
  return container.innerHTML
}

function imageCount(html: string) { return (html.match(/<img\b/gi) || []).length }

function redactImagesForAi(html: string) {
  const images: string[] = []
  const content = html.replace(/<img\b[^>]*>/gi, tag => { images.push(tag); return `[IMAGE ${images.length}]` })
  return { content, images }
}

function restoreAiImages(value: string, images: string[]) {
  const used = new Set<number>()
  const restored = value.replace(/\[IMAGE\s+(\d+)\]/gi, (_token, value) => {
    const index = Number(value) - 1
    if (!Number.isInteger(index) || !images[index]) return ''
    used.add(index)
    return images[index]
  })
  return `${restored}${images.filter((_image, index) => !used.has(index)).join('')}`
}

function completionMessage(job: AiJob) {
  if (job.type === 'summary') return 'Muse added a summary.'
  if (job.type === 'tasks') {
    const count = typeof job.result?.count === 'number' ? job.result.count : 0
    return count ? `Muse found ${count} task${count === 1 ? '' : 's'}.` : 'Muse found no actionable tasks in this note.'
  }
  if (job.type === 'title') return 'Muse updated the title.'
  if (job.type === 'tags') return 'Muse updated the tags.'
  if (job.type === 'rewrite') {
    const images = typeof job.result?.images === 'number' ? job.result.images : 0
    return images ? `Muse rewrote the note. ${images} image${images === 1 ? '' : 's'} kept in place.` : 'Muse rewrote the note.'
  }
  if (job.type === 'organize') return 'Muse organized your note — title, tags and summary are ready.'
  return 'Muse finished your request.'
}

export function Editor({ note, onBack, save, refresh, trash, restore, permanentlyDelete, onToast }: { note: Note; onBack: () => void; save: (input: NoteInput) => Promise<unknown>; refresh: () => Promise<Note>; trash: () => Promise<void>; restore: () => Promise<void>; permanentlyDelete: () => Promise<void>; onToast: (message: string) => void }) {
  const isResearch = note.kind === 'research'
  const isSpecialized = note.kind === 'specialized' && !!note.specialized
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const imageInput = useRef<HTMLInputElement>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [chat, setChat] = useState(false)
  const [menu, setMenu] = useState(false)
  const [working, setWorking] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [content, setContent] = useState(note.content)
  const [title, setTitle] = useState(note.title)
  const [specializedNote, setSpecializedNote] = useState<SpecializedNote | undefined>(note.specialized)
  const [active, setActive] = useState<Record<string, boolean>>({})
  const [detectorOpen, setDetectorOpen] = useState(false)
  const navigate = useNavigate()
  const [linkedEvent, setLinkedEvent] = useState<CalendarEvent | null>(null)
  const [isSyncingCalendar, setIsSyncingCalendar] = useState(false)
  const [isDictating, setIsDictating] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)

  // Clean up any active speech when switching notes or leaving editor
  useEffect(() => {
    return () => {
      tts.stop()
      stt.stopListening()
    }
  }, [note.id])

  function toggleDictation() {
    if (isDictating) {
      stt.stopListening()
      setIsDictating(false)
      return
    }

    robotAudio.play('blip')
    setIsDictating(true)
    stt.startListening({
      continuous: true,
      interimResults: true,
      onFinal: text => {
        ref.current?.focus()
        document.execCommand('insertText', false, text + ' ')
        edit(ref.current?.innerHTML || '')
      },
      onStateChange: state => setIsDictating(state === 'listening' || state === 'processing'),
      onError: err => {
        setIsDictating(false)
        onToast(err)
      }
    })
  }

  function toggleReadAloud() {
    if (isSpeaking && tts.isSpeaking()) {
      tts.stop()
      setIsSpeaking(false)
      return
    }

    tts.stop()
    setIsSpeaking(true)
    const textToRead = [title, plainText(content)].filter(Boolean).join('. ')
    tts.speak(textToRead, {
      onStart: () => setIsSpeaking(true),
      onEnd: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false)
    })
  }

  useEffect(() => {
    if (!isSpecialized) return
    let activeSub = true
    api.listEvents().then(events => {
      if (!activeSub) return
      const found = events.find(e => e.note_id === note.id)
      if (found) setLinkedEvent(found)
    }).catch(() => {})
    return () => { activeSub = false }
  }, [note.id, isSpecialized])

  useEffect(() => {
    document.execCommand('styleWithCSS', false, 'false')
    const { html: formatted, extractedTitle } = prepareContent(note.content)
    const cleaned = isResearch ? decorateKeyFindings(sanitizeHtml(formatted)) : sanitizeHtml(formatted)
    setContent(cleaned)
    const effectiveTitle = (!note.title || note.title.trim().toLowerCase() === 'untitled note' || note.title.trim() === 'untitled') && extractedTitle
      ? extractedTitle
      : note.title
    setTitle(effectiveTitle)
    setSpecializedNote(note.specialized)
    if (ref.current) ref.current.innerHTML = withImageUrls(cleaned)
  }, [note.id])
  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    const poll = async () => {
      try {
        const job = await api.getAiJob(jobId)
        if (cancelled || (job.status !== 'complete' && job.status !== 'failed')) return
        setJobId(null); setWorking(false)
        if (job.status === 'complete') {
          const updated = await refresh()
          const { html: formatted, extractedTitle } = prepareContent(updated.content)
          const updatedContent = isResearch ? decorateKeyFindings(sanitizeHtml(formatted)) : sanitizeHtml(formatted)
          // Title and content are controlled locally to support autosave. They
          // must be explicitly synchronized after an AI job changes the note.
          const effectiveTitle = (!updated.title || updated.title.trim().toLowerCase() === 'untitled note') && extractedTitle
            ? extractedTitle
            : updated.title
          setTitle(effectiveTitle)
          setContent(updatedContent)
          if (ref.current) ref.current.innerHTML = withImageUrls(updatedContent)
          onToast(completionMessage(job))
        }
        else onToast(`${job.error || 'Muse could not complete this request.'} Retry when you are ready.`)
      } catch { if (!cancelled) { setJobId(null); setWorking(false); onToast('Unable to check Muse’s request status.') } }
    }
    void poll()
    const timerId = window.setInterval(() => { void poll() }, 2000)
    return () => { cancelled = true; window.clearInterval(timerId) }
  }, [jobId, onToast, refresh])

  function queue(input: NoteInput) {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void save(input) }, 650)
  }

  function updateSpecialized(values: Partial<SpecializedNote>) {
    if (!specializedNote) return
    const next = { ...specializedNote, ...values }
    setSpecializedNote(next)
    queue({ specialized: next })
  }

  function updateSpecializedField(name: string, value: string) {
    if (!specializedNote) return
    updateSpecialized({ fields: { ...specializedNote.fields, [name]: value } })
  }

  function renameCustomField(oldKey: string, newKey: string) {
    if (!specializedNote || !newKey.trim() || oldKey === newKey.trim()) return
    const entries = Object.entries(specializedNote.fields)
    const newFields: Record<string, unknown> = {}
    for (const [k, v] of entries) {
      if (k === oldKey) {
        newFields[newKey.trim()] = v
      } else {
        newFields[k] = v
      }
    }
    updateSpecialized({ fields: newFields })
  }

  function removeCustomField(keyToRemove: string) {
    if (!specializedNote) return
    const newFields = { ...specializedNote.fields }
    delete newFields[keyToRemove]
    updateSpecialized({ fields: newFields })
  }

  function addCustomField() {
    if (!specializedNote) return
    const count = Object.keys(specializedNote.fields).length
    if (count >= 12) return onToast('Custom templates support up to 12 fields.')
    let nextName = `Field ${count + 1}`
    let i = count + 1
    while (specializedNote.fields[nextName] !== undefined) {
      i += 1
      nextName = `Field ${i}`
    }
    updateSpecialized({ fields: { ...specializedNote.fields, [nextName]: '' } })
  }

  function handleSaveAsReusableTemplate() {
    if (!specializedNote) return
    const templateTitle = (specializedNote.templateId || title || 'My Custom Template').trim()
    const fields = Object.entries(specializedNote.fields).map(([name, value]) => ({
      name,
      defaultValue: String(value ?? '')
    }))
    saveCustomTemplate({
      title: templateTitle,
      fields,
      aiInstruction: specializedNote.aiInstruction
    })
    onToast(`Saved "${templateTitle}" as a reusable template!`)
  }

  async function handleSyncToCalendar() {
    if (!specializedNote) return
    setIsSyncingCalendar(true)
    try {
      let event: CalendarEvent
      if (specializedNote.category === 'workout') {
        event = await api.syncWorkoutToCalendar(note.id, specializedNote.fields, linkedEvent?.id)
      } else {
        event = await api.syncDailyToCalendar(note.id, specializedNote.fields, linkedEvent?.id)
      }
      setLinkedEvent(event)
      onToast('Linked to Calendar!')
    } catch {
      onToast('Could not sync event to calendar.')
    } finally {
      setIsSyncingCalendar(false)
    }
  }

  function edit(html: string) {
    const stored = toStoredHtml(html)
    const cleaned = isResearch ? decorateKeyFindings(sanitizeHtml(stored)) : sanitizeHtml(stored)
    setContent(cleaned)
    queue({ content: cleaned })
  }

  function command(name: string, value?: string) {
    document.execCommand(name, false, value)
    edit(ref.current?.innerHTML || '')
    ref.current?.focus()
    updateActive()
  }

  function keepSelection(event: React.MouseEvent<HTMLButtonElement>) { event.preventDefault() }

  function currentBlockTag() {
    const selection = window.getSelection()
    if (!selection?.rangeCount) return ''
    let node: Node | null = selection.getRangeAt(0).commonAncestorContainer
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement
    while (node instanceof HTMLElement && node !== ref.current) {
      if (['H1', 'H2', 'H3', 'P', 'PRE', 'BLOCKQUOTE', 'LI', 'UL', 'OL', 'DIV'].includes(node.tagName)) return node.tagName.toLowerCase()
      node = node.parentElement
    }
    return ''
  }

  function updateActive() {
    const block = currentBlockTag()
    setActive({
      h1: block === 'h1', h2: block === 'h2', blockquote: block === 'blockquote', pre: block === 'pre',
      bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'),
      ul: document.queryCommandState('insertUnorderedList'), ol: document.queryCommandState('insertOrderedList')
    })
  }

  function toggleBlock(tag: 'h1' | 'h2' | 'blockquote' | 'pre') {
    if (currentBlockTag() === tag) document.execCommand('formatBlock', false, 'p')
    else document.execCommand('formatBlock', false, tag)
    edit(ref.current?.innerHTML || '')
    ref.current?.focus()
    updateActive()
  }

  async function insertImage(file: File) {
    if (!file.type.startsWith('image/')) return onToast('Choose an image file.')
    if (file.size > 5 * 1024 * 1024) return onToast('Choose an image smaller than 5 MB.')
    setWorking(true)
    try {
      const { url } = await api.uploadImage(file, note.id)
      ref.current?.focus()
      command('insertImage', url)
      onToast('Image added.')
    } catch (error) { onToast(error instanceof Error ? error.message : 'Image upload failed.') }
    finally { setWorking(false) }
  }

  function pasteImage(event: React.ClipboardEvent<HTMLDivElement>) {
    const item = [...event.clipboardData.items].find(candidate => candidate.type.startsWith('image/'))
    const file = item?.getAsFile()
    if (!file) return
    event.preventDefault()
    void insertImage(file)
  }

  async function finishNote() {
    window.clearTimeout(timer.current)
    setWorking(true)
    try { await save({ title, content }); onBack() }
    catch { onToast('Unable to save this note.') }
    finally { setWorking(false) }
  }

  async function assist(action: string) {
    const text = plainText(content).trim()
    if (!text) return onToast('Add some text first.')
    const type = (rewriteModes.includes(action) ? 'rewrite' : action) as AiJob['type']
    setAiOpen(false)
    window.clearTimeout(timer.current)
    if (activeVaultUser()) {
      if (!sessionStorage.getItem('muse-secure-ai-consent')) {
        const accepted = window.confirm('Muse will send the decrypted text you selected for this action to Ollama using your saved API key. It is not saved by Muse. Continue?')
        if (!accepted) return
        sessionStorage.setItem('muse-secure-ai-consent', 'accepted')
      }
      setWorking(true)
      try {
        const { content: aiContent, images } = redactImagesForAi(content)
        const patch = await api.runSecureAi({ action: type as 'summary' | 'tasks' | 'title' | 'tags' | 'rewrite' | 'organize', mode: rewriteModes.includes(action) ? action : undefined, note: { title, content: aiContent, specialized: specializedNote } }, message => onToast(message))
        const { tasks: proposedTasks, ...values } = patch
        const input: NoteInput = {
          ...values,
          ...(patch.content ? { content: restoreAiImages(patch.content, images) } : {}),
          ...(proposedTasks ? { tasks: proposedTasks.map(task => ({ id: crypto.randomUUID(), note_id: note.id, text: task, completed: false, created_at: new Date().toISOString() })) } : {})
        }
        if (isSpecialized && !window.confirm('Muse has prepared a proposed update for this specialized note. Apply it?')) { onToast('Muse’s proposal was discarded.'); return }
        await save(input)
        const updated = await refresh()
        const updatedContent = isResearch ? decorateKeyFindings(sanitizeHtml(updated.content)) : sanitizeHtml(updated.content)
        setTitle(updated.title); setContent(updatedContent)
        if (ref.current) ref.current.innerHTML = withImageUrls(updatedContent)
        onToast('Muse updated this encrypted note.')
      } catch (error) { onToast(error instanceof Error ? error.message : 'Muse AI is unavailable right now.') }
      finally { setWorking(false) }
      return
    }
    setWorking(true)
    try {
      await save({ title, content })
      const job = type === 'organize' ? await api.organizeNote(note.id) : await api.createAiJob(note.id, type, rewriteModes.includes(action) ? action : undefined)
      setJobId(job.id)
      onToast(job.queuePosition && job.queuePosition > 1 ? `Muse is busy. Your request is number ${job.queuePosition} in the queue.` : 'Muse is working on your request.')
    } catch (error) { setWorking(false); onToast(error instanceof Error ? error.message : 'Muse AI is unavailable right now.') }
  }

  async function toggleTask(taskId: string, completed: boolean) {
    try { await api.setTask(taskId, completed); await refresh(); onToast('Task updated.') }
    catch { onToast('Unable to update task.') }
  }

  async function clearSummary() {
    setWorking(true)
    try { await api.clearSummary(note.id); await refresh(); onToast('Summary removed.') }
    catch { onToast('Unable to remove the summary.') }
    finally { setWorking(false) }
  }

  async function clearTasks() {
    setWorking(true)
    try { await api.clearTasks(note.id); await refresh(); onToast('Task list removed.') }
    catch { onToast('Unable to remove the task list.') }
    finally { setWorking(false) }
  }

  async function manage(action: () => Promise<void>, message: string) {
    setMenu(false)
    setWorking(true)
    try { await action(); onToast(message) }
    catch { onToast('Unable to update this note.') }
    finally { setWorking(false) }
  }

  const wordCount = plainText(content).trim().split(/\s+/).filter(Boolean).length
  const { headings: researchHeadings, sourceCount } = isResearch ? researchOutline(content) : { headings: [], sourceCount: 0 }
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 220))
  const scrollToResearchSection = (index: number) => ref.current?.querySelectorAll('h2')[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return <div className="editor-page">
    <header className="editor-header">
      <button className="back-button" onClick={() => void finishNote()}><ArrowLeft size={18}/> All notes</button>
      <div className="editor-status">{working ? <><i className="pulse"/> Muse is thinking</> : <><Check size={14}/> Saved</>}</div>
      <button
        className={`header-icon favorite-toggle-btn ${note.favorite ? 'is-favorite' : ''}`}
        title={note.favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={() => void save({ favorite: !note.favorite })}
      >
        <Star
          size={18}
          className={`star-icon ${note.favorite ? 'fav-star-icon is-favorite' : ''}`}
          fill={note.favorite ? 'currentColor' : 'none'}
        />
      </button>
      <div className="note-menu-wrap"><button className="header-icon" title="Note actions" onClick={() => setMenu(!menu)}><MoreHorizontal size={19}/></button>{menu && <div className="note-menu">{note.deleted_at ? <><button onClick={() => void manage(restore, 'Note restored.')}>Restore note</button><button className="danger" onClick={() => void manage(permanentlyDelete, 'Note permanently deleted.')}>Delete permanently</button></> : <><button onClick={() => void manage(async () => { await save({ archived: !note.archived }) }, note.archived ? 'Note unarchived.' : 'Note archived.')}>{note.archived ? 'Unarchive note' : 'Archive note'}</button><button className="danger" onClick={() => void manage(trash, 'Note moved to trash.')}>Move to trash</button></>}</div>}</div>
    </header>
    <div className={`editor-canvas${isResearch ? ' research-canvas' : ''}${isSpecialized ? ` specialized-canvas specialized-color-${specializedNote?.color || 'blue'}` : ''}`}>
      {isResearch && <aside className="research-toc" aria-label="Research report table of contents"><strong>In this report</strong><nav>{researchHeadings.map((heading, index) => <button key={`${heading}-${index}`} onClick={() => scrollToResearchSection(index)}>{heading}</button>)}</nav></aside>}
      <div className={isResearch ? 'research-body' : undefined}>
      {isResearch && <header className="research-masthead"><span>Research report</span><p>{new Date(note.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}<i/> {readingMinutes} min read {sourceCount ? <><i/> {sourceCount} sources</> : null}</p></header>}
      {isSpecialized && specializedNote && (
        <section className="specialized-fields">
          <header className="specialized-fields-header">
            <div className="specialized-fields-title-group">
              <span className="specialized-title-label">Specialized · {specializedNote.category === 'workout' ? 'Workout' : specializedNote.category === 'daily' ? 'Daily tasks & feedback' : specializedNote.category}</span>
              <div className="specialized-color-picker-wrap">
                <span className="color-picker-label">Color:</span>
                <div className="specialized-color-swatches" title="Choose color accent for this note">
                  {[
                    { id: 'blue', color: '#2563eb', name: 'Ocean' },
                    { id: 'purple', color: '#7c3aed', name: 'Lavender' },
                    { id: 'emerald', color: '#059669', name: 'Emerald' },
                    { id: 'amber', color: '#d97706', name: 'Amber' },
                    { id: 'rose', color: '#e11d48', name: 'Rose' },
                    { id: 'teal', color: '#0d9488', name: 'Teal' },
                    { id: 'indigo', color: '#4f46e5', name: 'Indigo' }
                  ].map(c => (
                    <button
                      key={c.id}
                      type="button"
                      className={`specialized-color-swatch swatch-${c.id} ${specializedNote.color === c.id || (!specializedNote.color && c.id === 'blue') ? 'active' : ''}`}
                      style={{ background: c.color }}
                      onClick={() => updateSpecialized({ color: c.id })}
                      title={`Color: ${c.name}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <small>Structured fields are encrypted with this note.</small>
          </header>

          {/* Calendar / Task Sync Bar for Workout or Daily Notes */}
          {(specializedNote.category === 'workout' || specializedNote.category === 'daily') && (
            <div className="specialized-sync-bar">
              <div className="specialized-sync-info">
                <Calendar size={15} />
                {linkedEvent ? (
                  <span>Linked to Calendar ({new Date(linkedEvent.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}{linkedEvent.all_day ? '' : ` at ${new Date(linkedEvent.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`})</span>
                ) : (
                  <span>Calendar sync: Not yet scheduled</span>
                )}
              </div>
              <div className="specialized-sync-actions">
                <button
                  className="sync-calendar-btn"
                  onClick={handleSyncToCalendar}
                  disabled={isSyncingCalendar}
                  title="Create or update calendar event from these fields"
                >
                  <CalendarCheck size={14} />
                  {isSyncingCalendar ? 'Syncing…' : linkedEvent ? 'Update Calendar' : 'Sync to Calendar'}
                </button>
                {linkedEvent && (
                  <button
                    className="view-calendar-btn"
                    onClick={() => navigate('/calendar')}
                    title="Open in Calendar"
                  >
                    <ExternalLink size={13} /> View
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Custom Template Header: Name and AI Instruction */}
          {specializedNote.category === 'custom' && (
            <div className="specialized-template" style={{ marginBottom: 12 }}>
              <label>
                Template name
                <input
                  value={specializedNote.templateId || ''}
                  onChange={event => updateSpecialized({ templateId: event.target.value })}
                  placeholder="e.g. Reading Log, Meal Tracker"
                />
              </label>
              <label>
                AI instruction
                <input
                  value={specializedNote.aiInstruction || ''}
                  onChange={event => updateSpecialized({ aiInstruction: event.target.value })}
                  placeholder="Tell Muse how to assist with this template"
                />
              </label>
            </div>
          )}

          {/* Fields Grid */}
          {specializedNote.category === 'custom' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
              {Object.entries(specializedNote.fields).map(([name, value]) => (
                <div key={name} className="custom-field-row">
                  <input
                    className="custom-field-name-input"
                    defaultValue={name}
                    onBlur={e => {
                      const newName = e.target.value.trim()
                      if (newName && newName !== name) renameCustomField(name, newName)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const newName = (e.target as HTMLInputElement).value.trim()
                        if (newName && newName !== name) renameCustomField(name, newName)
                        ;(e.target as HTMLInputElement).blur()
                      }
                    }}
                    title="Click to rename field"
                    placeholder="Field name"
                  />
                  <input
                    className="custom-field-val-input"
                    value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
                    onChange={event => updateSpecializedField(name, event.target.value)}
                    placeholder="Value"
                  />
                  <button
                    className="custom-field-remove-btn"
                    title="Delete this field"
                    onClick={() => removeCustomField(name)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : specializedNote.category === 'workout' ? (
            <div className="specialized-field-grid">
              <label>
                <span>Date</span>
                <input
                  type="date"
                  value={String(specializedNote.fields.date || specializedNote.fields.Date || '')}
                  onChange={e => updateSpecializedField(specializedNote.fields.date !== undefined ? 'date' : 'Date', e.target.value)}
                />
              </label>
              <label>
                <span>Time</span>
                <input
                  type="time"
                  value={String(specializedNote.fields.time || specializedNote.fields.Time || '')}
                  onChange={e => updateSpecializedField(specializedNote.fields.time !== undefined ? 'time' : 'Time', e.target.value)}
                />
              </label>
              <label>
                <span>Name</span>
                <input
                  type="text"
                  value={String(specializedNote.fields.name || specializedNote.fields.Name || '')}
                  onChange={e => updateSpecializedField(specializedNote.fields.name !== undefined ? 'name' : 'Name', e.target.value)}
                  placeholder="e.g. Chest & Triceps, Leg Day"
                />
              </label>
              <label>
                <span>N exercises</span>
                <input
                  type="number"
                  min="1"
                  value={String(specializedNote.fields.exerciseCount ?? specializedNote.fields['N exercises'] ?? specializedNote.fields['n exercises'] ?? '')}
                  onChange={e => {
                    const k = specializedNote.fields.exerciseCount !== undefined ? 'exerciseCount' : 'N exercises'
                    updateSpecializedField(k, e.target.value)
                  }}
                  placeholder="e.g. 5"
                />
              </label>
            </div>
          ) : (
            <div className="specialized-field-grid">
              {Object.entries(specializedNote.fields).map(([name, value]) => (
                <label key={name}>
                  <span>{name.replace(/([A-Z])/g, ' $1')}</span>
                  <input
                    value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
                    onChange={event => updateSpecializedField(name, event.target.value)}
                    placeholder="Add value"
                  />
                </label>
              ))}
            </div>
          )}

          {/* Actions: Add field & Save as Reusable Template for custom notes */}
          {specializedNote.category === 'custom' && (
            <div className="specialized-actions-row">
              <button className="specialized-add-field" onClick={addCustomField}>
                <Plus size={13} /> Add field ({Object.keys(specializedNote.fields).length}/12)
              </button>
              <button className="save-template-btn" onClick={handleSaveAsReusableTemplate} title="Save this structure to reuse anytime">
                <Bookmark size={13} /> Save as Reusable Template
              </button>
            </div>
          )}
        </section>
      )}
      <input className="editor-title" value={title} onChange={e => { setTitle(e.target.value); queue({ title: e.target.value }) }} placeholder="Untitled note"/>
      <div className="editor-details">{!isResearch && <span>{new Date(note.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}{note.tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}{note.aiStatus === 'processing' && <span className="processing"><i/> Organizing</span>}</div>
      <div className="toolbar">
        <button className={active.h1 ? 'active' : ''} onMouseDown={keepSelection} onClick={() => toggleBlock('h1')}><Heading1 size={17}/></button>
        <button className={active.h2 ? 'active' : ''} onMouseDown={keepSelection} onClick={() => toggleBlock('h2')}><Heading2 size={17}/></button>
        <button className={active.bold ? 'active' : ''} onMouseDown={keepSelection} onClick={() => command('bold')}><Bold size={16}/></button>
        <button className={active.italic ? 'active' : ''} onMouseDown={keepSelection} onClick={() => command('italic')}><Italic size={16}/></button>
        <b/>
        <button className={active.ul ? 'active' : ''} onMouseDown={keepSelection} onClick={() => command('insertUnorderedList')}><List size={17}/></button>
        <button onMouseDown={keepSelection} onClick={() => command('insertHTML', '☐ ')}><ListChecks size={17}/></button>
        <button className={active.blockquote ? 'active' : ''} onMouseDown={keepSelection} onClick={() => toggleBlock('blockquote')}><Quote size={17}/></button>
        <button className={active.pre ? 'active' : ''} onMouseDown={keepSelection} onClick={() => toggleBlock('pre')}><Code2 size={17}/></button>
        <button title="Add an image" onMouseDown={keepSelection} onClick={() => imageInput.current?.click()}><Image size={17}/></button>
        <b/>
        <button className={isDictating ? 'active mic-active' : ''} onMouseDown={keepSelection} onClick={toggleDictation} title={isDictating ? 'Listening… click to finish dictation' : 'Dictate note with your microphone (English)'}>{isDictating ? <MicOff size={16}/> : <Mic size={16}/>}</button>
        <button className={isSpeaking ? 'active speaker-active' : ''} onMouseDown={keepSelection} onClick={toggleReadAloud} title={isSpeaking ? 'Stop reading' : 'Read note aloud with English voice'}>{isSpeaking ? <Square size={14} fill="currentColor"/> : <Volume2 size={16}/>}</button>
      </div>
      <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void insertImage(file) }}/>
      <div ref={ref} className={`rich-editor${isResearch ? ' research-document' : ''}`} contentEditable suppressContentEditableWarning onInput={e => edit(e.currentTarget.innerHTML)} onPaste={pasteImage} onKeyUp={updateActive} onMouseUp={updateActive} onClick={updateActive}/>
      {note.summary && <section className="summary-card"><div><span><Sparkles size={16}/><strong>Muse summary</strong></span><button className="generated-remove" title="Remove summary" onClick={() => void clearSummary()}><X size={15}/></button></div><p>{note.summary}</p></section>}
      {!!note.tasks?.length && <section className="task-list"><div className="task-list-heading"><strong>Tasks</strong><button className="generated-remove" onClick={() => void clearTasks()}>Clear</button></div>{note.tasks.map(task => <label key={task.id}><input type="checkbox" checked={task.completed} onChange={e => { void toggleTask(task.id, e.target.checked) }}/><span>{task.text}</span></label>)}</section>}
      <footer className="editor-footer">
        <div className="ai-menu-wrap">
          <button className="ai-trigger" onClick={() => setAiOpen(!aiOpen)}><WandSparkles size={16}/> AI assist</button>
          {aiOpen && <div className="ai-menu">
            <button onClick={() => { setAiOpen(false); setDetectorOpen(true) }}><Calendar size={16}/> Detect Schedule</button>
            <button onClick={() => assist('organize')}><WandSparkles size={16}/> Organize</button>
            <button onClick={() => assist('summary')}><Sparkles size={16}/> Summarize</button>
            <button onClick={() => assist('tasks')}><ListChecks size={16}/> Extract tasks</button>
            <button onClick={() => assist('title')}><FileText size={16}/> Smart title</button>
            <button onClick={() => assist('tags')}><Sparkles size={16}/> Auto tags</button>
            <small>REWRITE</small>
            {rewriteModes.map(mode => <button key={mode} onClick={() => assist(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
            {imageCount(content) > 0 && <small className="ai-warning"><Image size={13}/> Images stay in place when the note is rewritten.</small>}
          </div>}
        </div>
        <button className="schedule-detect-button" onClick={() => setDetectorOpen(true)} title="Detect dates, meetings, and tasks from this note">
          <Calendar size={15}/> Detect Schedule
        </button>
        <button className="extract-tasks-btn" onClick={() => assist('tasks')} title="Extract actionable tasks from this note">
          <ListChecks size={15}/> Extract tasks
        </button>
        <button className="ask-note" onClick={() => activeVaultUser() ? onToast('Use a specific AI assist action for encrypted notes. Decrypted chat history is not stored by Muse.') : setChat(true)}><Sparkles size={15}/> Ask this note</button>
        <span>{wordCount} words</span>
      </footer>
      </div>
    </div>
    {chat && <ChatPanel note={note} mode="note" onClose={() => setChat(false)}/>}
    {detectorOpen && (
      <ScheduleDetectorModal
        noteId={note.id}
        noteTitle={title || 'Untitled note'}
        noteContent={plainText(content)}
        onClose={() => setDetectorOpen(false)}
        onApplied={msg => {
          onToast(msg)
          void refresh()
        }}
      />
    )}
  </div>
}
