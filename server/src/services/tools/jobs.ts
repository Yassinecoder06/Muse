import { randomUUID } from 'node:crypto'

// Some MCP clients (Gemini) abandon a tool call after about 8 seconds. Slow
// tools run as background jobs: the call waits briefly, and if the work is
// not done yet it returns a job id the model polls with get_job_status.

export type JobStatus = 'running' | 'done' | 'failed'

export interface Job {
  id: string
  userId: string
  tool: string
  status: JobStatus
  startedAt: number
  finishedAt?: number
  result?: Record<string, unknown>
  error?: string
}

const JOB_TTL_MS = 60 * 60_000
const MAX_JOBS_PER_USER = 20
const jobs = new Map<string, Job>()

function prune(now = Date.now()) {
  for (const [id, job] of jobs) if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) jobs.delete(id)
}

export function startJob(userId: string, tool: string, work: () => Promise<Record<string, unknown>>): Job {
  prune()
  const running = [...jobs.values()].filter(job => job.userId === userId && job.status === 'running')
  if (running.length >= MAX_JOBS_PER_USER) throw new Error('Too many background jobs are running. Wait for some to finish.')
  const job: Job = { id: randomUUID(), userId, tool, status: 'running', startedAt: Date.now() }
  jobs.set(job.id, job)
  work().then(
    result => Object.assign(job, { status: 'done', result, finishedAt: Date.now() }),
    (error: unknown) => Object.assign(job, { status: 'failed', error: error instanceof Error ? error.message : String(error), finishedAt: Date.now() })
  )
  return job
}

/** Waits up to `waitMs` for the job; returns it in whatever state it reached. */
export async function settleWithin(job: Job, waitMs: number): Promise<Job> {
  const deadline = Date.now() + waitMs
  while (job.status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
  return job
}

export function getJob(userId: string, id: string): Job | undefined {
  const job = jobs.get(id)
  return job && job.userId === userId ? job : undefined
}

export function jobView(job: Job): Record<string, unknown> {
  if (job.status === 'done') return { job_id: job.id, status: 'done', tool: job.tool, result: job.result }
  if (job.status === 'failed') return { job_id: job.id, status: 'failed', tool: job.tool, error: job.error }
  return {
    job_id: job.id, status: 'running', tool: job.tool,
    elapsed_seconds: Math.round((Date.now() - job.startedAt) / 1000),
    message: 'Still working. Call get_job_status with this job_id in a few seconds.'
  }
}

export function resetJobsForTests() { jobs.clear() }
