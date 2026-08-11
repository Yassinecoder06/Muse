import { useEffect, useRef, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { api } from '../services/api'
import type { AiJob } from '../types'

const depths = [
  { value: 'concise', label: 'Concise' },
  { value: 'standard', label: 'Standard' },
  { value: 'in-depth', label: 'In-depth' }
] as const

export function ResearchPanel({ onClose, onDone }: { onClose: () => void; onDone: (noteId: string) => void }) {
  const [topic, setTopic] = useState('')
  const [depth, setDepth] = useState<'concise' | 'standard' | 'in-depth'>('standard')
  const [job, setJob] = useState<AiJob | null>(null)
  const [error, setError] = useState('')
  const jobRef = useRef(job)
  jobRef.current = job

  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'processing')) return
    const poll = async () => {
      try {
        const latest = await api.getAiJob(job.id)
        if (latest.status === 'complete') {
          setJob(latest)
          onDone(String(latest.result?.noteId || ''))
        } else if (latest.status === 'failed') {
          setJob(latest)
          setError(latest.error || 'Muse could not complete the research.')
        } else setJob(latest)
      } catch { setError('Unable to check the research status.') }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 2500)
    return () => window.clearInterval(timer)
  }, [job, onDone])

  const running = !!job && (job.status === 'queued' || job.status === 'processing')

  async function start() {
    setError('')
    try {
      const created = await api.createResearch(topic.trim(), depth)
      setJob(created)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Muse could not start the research.') }
  }

  return <div className="command-backdrop research-backdrop">
    <section className="command research-panel">
      <header><strong>Research a topic</strong><button onClick={onClose}><X size={17}/></button></header>
      {running ? <div className="research-progress"><i className="loader"/><p><strong>Muse is researching…</strong><span>Searching the web, then writing a full note. This can take a few minutes.</span></p></div>
        : <><textarea className="research-input" rows={3} maxLength={500} placeholder="e.g. How did the printing press change Europe?" value={topic} onChange={e => setTopic(e.target.value)} disabled={!!job && job.status === 'complete'}/>
          <div className="research-depths">{depths.map(option => <button key={option.value} className={depth === option.value ? 'selected' : ''} onClick={() => setDepth(option.value)}>{option.label}</button>)}</div>
          <button className="research-start" disabled={!topic.trim()} onClick={() => void start()}><Sparkles size={15}/> Start research</button></>}
      {job?.status === 'complete' && <p className="research-note-done">Your research note is ready — opening it now.</p>}
      {error && <p className="research-error">{error}</p>}
    </section>
  </div>
}