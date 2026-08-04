import { ArrowLeft, Bold, Check, Code2, FileText, Heading1, Image, Italic, List, ListChecks, MoreHorizontal, Quote, Sparkles, Star, WandSparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../services/api'
import type { AiJob, Note, NoteInput } from '../types'
import { ChatPanel } from './ChatPanel'

const rewriteModes = ['improve', 'professional', 'friendly', 'shorter', 'longer', 'grammar']
const allowedTags = new Set(['B', 'BR', 'BLOCKQUOTE', 'CODE', 'EM', 'H2', 'I', 'IMG', 'LI', 'OL', 'PRE', 'STRONG', 'UL'])

function sanitizeHtml(value: string) {
  const container = document.createElement('div')
  container.innerHTML = value
  for (const element of [...container.querySelectorAll('*')]) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes))
      continue
    }
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name)
    if (element.tagName === 'IMG') {
      const source = (element as HTMLImageElement).src
      if (!/^https?:\/\//i.test(source)) element.remove()
      else element.setAttribute('src', source)
    }
  }
  return container.innerHTML
}

function plainText(html: string) {
  const container = document.createElement('div')
  container.innerHTML = sanitizeHtml(html)
  return container.textContent || ''
}

function completionMessage(job: AiJob) {
  if (job.type === 'summary') return 'Muse added a summary.'
  if (job.type === 'tasks') {
    const count = typeof job.result?.count === 'number' ? job.result.count : 0
    return count ? `Muse found ${count} task${count === 1 ? '' : 's'}.` : 'Muse found no actionable tasks in this note.'
  }
  if (job.type === 'title') return 'Muse updated the title.'
  if (job.type === 'tags') return 'Muse updated the tags.'
  if (job.type === 'rewrite') return 'Muse rewrote the note.'
  return 'Muse finished your request.'
}

export function Editor({ note, onBack, save, refresh, complete, trash, restore, permanentlyDelete, onToast }: { note: Note; onBack: () => void; save: (input: NoteInput) => Promise<unknown>; refresh: () => Promise<Note>; complete: (input: NoteInput) => Promise<AiJob>; trash: () => Promise<void>; restore: () => Promise<void>; permanentlyDelete: () => Promise<void>; onToast: (message: string) => void }) {
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

  useEffect(() => {
    const cleaned = sanitizeHtml(note.content)
    setContent(cleaned)
    setTitle(note.title)
    if (ref.current) ref.current.innerHTML = cleaned
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
          const updatedContent = sanitizeHtml(updated.content)
          // Title and content are controlled locally to support autosave. They
          // must be explicitly synchronized after an AI job changes the note.
          setTitle(updated.title)
          setContent(updatedContent)
          if (ref.current) ref.current.innerHTML = updatedContent
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

  function edit(html: string) {
    const cleaned = sanitizeHtml(html)
    setContent(cleaned)
    queue({ content: cleaned })
  }

  function command(name: string, value?: string) {
    document.execCommand(name, false, value)
    edit(ref.current?.innerHTML || '')
    ref.current?.focus()
  }

  function keepSelection(event: React.MouseEvent<HTMLButtonElement>) { event.preventDefault() }

  async function insertImage(file: File) {
    if (!file.type.startsWith('image/')) return onToast('Choose an image file.')
    if (file.size > 5 * 1024 * 1024) return onToast('Choose an image smaller than 5 MB.')
    setWorking(true)
    try {
      const { url } = await api.uploadImage(file)
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
    try { const job = await complete({ title, content }); onToast(job.queuePosition && job.queuePosition > 1 ? `Muse is busy. Your note is number ${job.queuePosition} in the queue.` : 'Muse is organizing your note.'); onBack() }
    catch { onToast('Unable to save and organize this note.') }
    finally { setWorking(false) }
  }

  async function assist(action: string) {
    const text = plainText(content).trim()
    if (!text) return onToast('Add some text first.')
    setAiOpen(false)
    setWorking(true)
    try {
      const type = (rewriteModes.includes(action) ? 'rewrite' : action) as AiJob['type']
      const job = await api.createAiJob(note.id, type, rewriteModes.includes(action) ? action : undefined)
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

  return <div className="editor-page">
    <header className="editor-header">
      <button className="back-button" onClick={() => void finishNote()}><ArrowLeft size={18}/> All notes</button>
      <div className="editor-status">{working ? <><i className="pulse"/> Muse is thinking</> : <><Check size={14}/> Saved</>}</div>
      <button className="header-icon" title={note.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => void save({ favorite: !note.favorite })}><Star size={18} fill={note.favorite ? 'currentColor' : 'none'}/></button>
      <div className="note-menu-wrap"><button className="header-icon" title="Note actions" onClick={() => setMenu(!menu)}><MoreHorizontal size={19}/></button>{menu && <div className="note-menu">{note.deleted_at ? <><button onClick={() => void manage(restore, 'Note restored.')}>Restore note</button><button className="danger" onClick={() => void manage(permanentlyDelete, 'Note permanently deleted.')}>Delete permanently</button></> : <><button onClick={() => void manage(async () => { await save({ archived: !note.archived }) }, note.archived ? 'Note unarchived.' : 'Note archived.')}>{note.archived ? 'Unarchive note' : 'Archive note'}</button><button className="danger" onClick={() => void manage(trash, 'Note moved to trash.')}>Move to trash</button></>}</div>}</div>
    </header>
    <div className="editor-canvas">
      <input className="editor-title" value={title} onChange={e => { setTitle(e.target.value); queue({ title: e.target.value }) }} placeholder="Untitled note"/>
      <div className="editor-details"><span>{new Date(note.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>{note.tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}{note.aiStatus === 'processing' && <span className="processing"><i/> Organizing</span>}</div>
      <div className="toolbar">
        <button onMouseDown={keepSelection} onClick={() => command('formatBlock', 'h2')}><Heading1 size={17}/></button>
        <button onMouseDown={keepSelection} onClick={() => command('bold')}><Bold size={16}/></button>
        <button onMouseDown={keepSelection} onClick={() => command('italic')}><Italic size={16}/></button>
        <b/>
        <button onMouseDown={keepSelection} onClick={() => command('insertUnorderedList')}><List size={17}/></button>
        <button onMouseDown={keepSelection} onClick={() => command('insertHTML', '☐ ')}><ListChecks size={17}/></button>
        <button onMouseDown={keepSelection} onClick={() => command('formatBlock', 'blockquote')}><Quote size={17}/></button>
        <button onMouseDown={keepSelection} onClick={() => command('formatBlock', 'pre')}><Code2 size={17}/></button>
        <button title="Add an image" onMouseDown={keepSelection} onClick={() => imageInput.current?.click()}><Image size={17}/></button>
      </div>
      <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void insertImage(file) }}/>
      <div ref={ref} className="rich-editor" contentEditable suppressContentEditableWarning onInput={e => edit(e.currentTarget.innerHTML)} onPaste={pasteImage}/>
      {note.summary && <section className="summary-card"><div><span><Sparkles size={16}/><strong>Muse summary</strong></span><button className="generated-remove" title="Remove summary" onClick={() => void clearSummary()}><X size={15}/></button></div><p>{note.summary}</p></section>}
      {!!note.tasks?.length && <section className="task-list"><div className="task-list-heading"><strong>Tasks</strong><button className="generated-remove" onClick={() => void clearTasks()}>Clear</button></div>{note.tasks.map(task => <label key={task.id}><input type="checkbox" checked={task.completed} onChange={e => { void toggleTask(task.id, e.target.checked) }}/><span>{task.text}</span></label>)}</section>}
      <footer className="editor-footer"><div className="ai-menu-wrap"><button className="ai-trigger" onClick={() => setAiOpen(!aiOpen)}><WandSparkles size={16}/> AI assist</button>{aiOpen && <div className="ai-menu"><button onClick={() => assist('summary')}><Sparkles size={16}/> Summarize</button><button onClick={() => assist('tasks')}><ListChecks size={16}/> Extract tasks</button><button onClick={() => assist('title')}><FileText size={16}/> Smart title</button><button onClick={() => assist('tags')}><Sparkles size={16}/> Auto tags</button><small>REWRITE</small>{rewriteModes.map(mode => <button key={mode} onClick={() => assist(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</div>}</div><button className="ask-note" onClick={() => setChat(true)}><Sparkles size={15}/> Ask this note</button><span>{wordCount} words</span></footer>
    </div>
    {chat && <ChatPanel note={note} mode="note" onClose={() => setChat(false)}/>}
  </div>
}
