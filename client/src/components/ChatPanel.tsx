import { ArrowUp, Bot, MessageCircle, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../services/api'
import type { Note } from '../types'

type Msg = { role: 'user' | 'assistant'; text: string; sources?: { id: string; title: string }[] }

export function ChatPanel({ note, mode, onClose }: { note?: Note; mode: 'note' | 'search'; onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  async function send() {
    if (!question.trim() || loading) return
    const questionValue = question
    setQuestion('')
    setMessages(items => [...items, { role: 'user', text: questionValue }])
    setLoading(true)
    try {
      let job = mode === 'note' && note ? await api.askNote(note.id, questionValue) : await api.askNotes(questionValue)
      while (job.status === 'queued' || job.status === 'processing') {
        await new Promise(resolve => window.setTimeout(resolve, 1500))
        job = await api.getAiJob(job.id)
      }
      if (job.status === 'failed') throw new Error(job.error || 'Muse could not answer this request.')
      const result = job.result as { answer?: string; sources?: { id: string; title: string }[] } | null
      setMessages(items => [...items, { role: 'assistant', text: result?.answer || 'Muse returned no answer.', sources: result?.sources }])
    } catch (error) { setMessages(items => [...items, { role: 'assistant', text: error instanceof Error ? error.message : 'I could not reach Muse AI. Check that the API and AI configuration are running.' }]) }
    finally { setLoading(false) }
  }
  return <aside className="chat-panel"><header><span>{mode === 'note' ? <MessageCircle size={18}/> : <Sparkles size={18}/>} {mode === 'note' ? 'Ask this note' : 'Ask my notes'}</span><button onClick={onClose}><X size={18}/></button></header><div className="chat-intro"><div className="ai-orb"><Bot size={20}/></div><h3>{mode === 'note' ? 'Let’s explore this note' : 'Your notes, in conversation'}</h3><p>{mode === 'note' ? 'I’ll only use the note you have open.' : 'I search only the most relevant notes before answering.'}</p></div><div className="messages">{messages.map((message, index) => <div key={index} className={`message ${message.role}`}><p>{message.text}</p>{message.sources && <div className="sources">Used: {message.sources.map(source => <span key={source.id}>{source.title}</span>)}</div>}</div>)}{loading && <div className="typing"><i/><i/><i/></div>}</div><form className="chat-input" onSubmit={event => { event.preventDefault(); void send() }}><textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder={mode === 'note' ? 'Ask about this note...' : 'Ask anything in your notes...'} rows={2}/><button disabled={!question.trim() || loading}><ArrowUp size={17}/></button></form></aside>
}
