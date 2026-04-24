import { api } from './client'
import { apiUrl } from '../apiBase'

export interface StemJob {
  job_id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'unknown'
  progress: number
  error?: string | null
  result?: {
    hash: string
    vocals_url: string
    instruments_url: string
  }
}

export async function submitSeparate(
  file: File,
  token: string | null,
): Promise<{ job_id: string; cached: boolean }> {
  const form = new FormData()
  form.append('file', file)
  return api<{ job_id: string; cached: boolean }>('/api/stems/separate', {
    method: 'POST',
    body: form,
    token,
  })
}

export function getStemJob(jobId: string): Promise<StemJob> {
  return api<StemJob>(`/api/stems/${jobId}`)
}

export function stemFileUrl(relativeUrl: string): string {
  return apiUrl(relativeUrl)
}

/**
 * Poll /api/stems/{job_id} until it completes. Calls `onProgress` on each tick.
 * Gracefully treats a 404 on the job id as a terminal failure.
 */
export async function awaitSeparation(
  jobId: string,
  onProgress?: (p: number) => void,
  pollMs = 1500,
  timeoutMs = 5 * 60 * 1000,
): Promise<StemJob> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await getStemJob(jobId)
    onProgress?.(status.progress)
    if (status.status === 'done' || status.status === 'error') return status
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error('Stem separation timed out')
}
