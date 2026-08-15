import { useEffect, useRef, useState } from 'react'
import { FileText, Paperclip, Sparkles, X } from 'lucide-react'
import { api } from '../services/api'
import type { AiJob } from '../types'

const depths = [
  { value: 'concise', label: 'Concise' },
  { value: 'standard', label: 'Standard' },
  { value: 'in-depth', label: 'In-depth' }
] as const
const stageLabels: Record<string, string> = {
  research: 'Researching the web', extraction: 'Extracting source material', analysis: 'Analyzing the evidence', critical_reasoning: 'Checking claims and gaps', recommendations: 'Forming recommendations', structure: 'Designing the report', writing: 'Writing the report', quality_control: 'Reviewing the final report'
}
const allSkills = [['research','Research'],['information_extraction','Extraction'],['data_analysis','Data analysis'],['critical_reasoning','Critical review'],['financial_analysis','Financial analysis'],['recommendation','Recommendations'],['visualization','Visualizations'],['report_structure','Structure'],['professional_writing','Writing'],['citation_management','Citations'],['quality_control','Quality control']]

export function ResearchPanel({ onClose, onDone }: { onClose: () => void; onDone: (noteId: string) => void }) {
  const [topic, setTopic] = useState('')
  const [title, setTitle] = useState('')
  const [reportType, setReportType] = useState('research')
  const [objective, setObjective] = useState('')
  const [audience, setAudience] = useState('')
  const [instructions, setInstructions] = useState('')
  const [outputFormat, setOutputFormat] = useState<'html' | 'pdf' | 'docx'>('html')
  const [customSkills, setCustomSkills] = useState(false)
  const [enabledSkills, setEnabledSkills] = useState(allSkills.map(([value]) => value))
  const [depth, setDepth] = useState<'concise' | 'standard' | 'in-depth'>('standard')
  const [files, setFiles] = useState<File[]>([])
  const [job, setJob] = useState<AiJob | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'processing')) return
    const poll = async () => {
      try {
        const latest = await api.getAiJob(job.id)
        if (latest.status === 'complete') { setJob(latest); const noteId = String(latest.result?.noteId || ''); const format = latest.result?.outputFormat; if (noteId && (format === 'pdf' || format === 'docx')) void api.downloadReport(noteId, format).catch(() => undefined); onDone(noteId) }
        else if (latest.status === 'failed') { setJob(latest); setError(latest.error || 'Muse could not complete the research.') }
        else setJob(latest)
      } catch { setError('Unable to check the research status.') }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 2000)
    return () => window.clearInterval(timer)
  }, [job, onDone])

  const running = !!job && (job.status === 'queued' || job.status === 'processing')
  const stage = String(job?.result?.stage || '')
  const stageLabel = String(job?.result?.label || stageLabels[stage] || 'Preparing your research workflow')
  const completed = Array.isArray(job?.result?.completedStages) ? job!.result!.completedStages as string[] : []

  function selectFiles(selection: FileList | null) {
    if (!selection) return
    setError('')
    const merged = [...files, ...Array.from(selection)].slice(0, 5)
    if (files.length + selection.length > 5) setError('You can include up to five documents in one research run.')
    setFiles(merged)
  }
  async function start() {
    setError(''); setUploading(true)
    try {
      const uploaded = await Promise.all(files.map(file => api.uploadResearchDocument(file)))
      setJob(await api.createResearch({ topic: topic.trim(), title: title.trim() || undefined, reportType, objective: objective.trim() || undefined, audience: audience.trim() || undefined, instructions: instructions.trim() || undefined, outputFormat, depth, documentIds: uploaded.map(file => file.id), ...(customSkills && { enabledSkills }) } as any))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Muse could not start the research.') } finally { setUploading(false) }
  }

  return <div className="command-backdrop research-backdrop">
    <section className="command research-panel">
      <header><strong>Research a topic</strong><button onClick={onClose} disabled={uploading} title={running ? 'Keep researching in the background and return to your notes' : 'Close'}><X size={17}/></button></header>
      {running ? <div className="research-progress"><i className="loader"/><p><strong>{stageLabel}…</strong><span>{completed.length ? `Muse is progressing through the report workflow using web evidence${files.length ? ' and your selected documents' : ''}.` : 'Gathering evidence and preparing the workflow.'}</span></p></div>
        : <><input className="research-input" maxLength={300} placeholder="Report title (optional)" value={title} onChange={e => setTitle(e.target.value)}/><textarea className="research-input" rows={3} maxLength={500} placeholder="What should this report investigate?" value={topic} onChange={e => setTopic(e.target.value)} disabled={!!job && job.status === 'complete'}/>
          <div className="research-options"><select value={reportType} onChange={e => setReportType(e.target.value)} aria-label="Report type">{[['business','Business report'],['technical','Technical report'],['financial','Financial analysis'],['research','Research report'],['management','Management report'],['project','Project report']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><select value={outputFormat} onChange={e => setOutputFormat(e.target.value as 'html' | 'pdf' | 'docx')} aria-label="Output format"><option value="html">HTML report</option><option value="pdf">PDF export</option><option value="docx">DOCX export</option></select></div>
          <input className="research-input" maxLength={2000} placeholder="Objective (optional)" value={objective} onChange={e => setObjective(e.target.value)}/><input className="research-input" maxLength={300} placeholder="Target audience (optional)" value={audience} onChange={e => setAudience(e.target.value)}/><textarea className="research-input" rows={2} maxLength={4000} placeholder="Additional instructions (optional)" value={instructions} onChange={e => setInstructions(e.target.value)}/>
          <details className="research-skills"><summary>Customize skills <small>optional</small></summary><p>Preset skills are selected automatically. Choose only the skills this report needs.</p><div>{allSkills.map(([value, label]) => <label key={value}><input type="checkbox" checked={enabledSkills.includes(value)} onChange={() => { setCustomSkills(true); setEnabledSkills(enabledSkills.includes(value) ? enabledSkills.filter(skill => skill !== value) : [...enabledSkills, value]) }}/>{label}</label>)}</div>{customSkills && <button type="button" onClick={() => { setCustomSkills(false); setEnabledSkills(allSkills.map(([value]) => value)) }}>Use preset skills</button>}</details>
          <div className="research-depths">{depths.map(option => <button key={option.value} className={depth === option.value ? 'selected' : ''} onClick={() => setDepth(option.value)}>{option.label}</button>)}</div>
          <div className="research-documents"><div><strong>Source documents <small>optional</small></strong><span>PDF, DOCX, Markdown, text, or CSV · up to 5 files, 10 MB each</span></div><button type="button" className="research-attach" onClick={() => fileInput.current?.click()} disabled={uploading}><Paperclip size={14}/> Add files</button><input ref={fileInput} type="file" hidden multiple accept=".pdf,.docx,.md,.markdown,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain,text/csv" onChange={event => { selectFiles(event.target.files); event.currentTarget.value = '' }}/></div>
          {files.length ? <ul className="research-file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><FileText size={14}/><span title={file.name}>{file.name}</span><em>{Math.max(1, Math.ceil(file.size / 1024))} KB</em><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, item) => item !== index))}>×</button></li>)}</ul> : null}
          <button className="research-start" disabled={!topic.trim() || uploading} onClick={() => void start()}><Sparkles size={15}/>{uploading ? 'Reading documents…' : 'Start research'}</button></>}
      {job?.status === 'complete' && <p className="research-note-done">Your research note is ready — opening it now.</p>}
      {error && <p className="research-error">{error}</p>}
    </section>
  </div>
}
