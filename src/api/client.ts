import { apiUrl } from '../apiBase'

export interface ApiError extends Error {
  status: number
  detail?: unknown
}

function makeError(status: number, detail: unknown): ApiError {
  const msg =
    typeof detail === 'string'
      ? detail
      : (detail as { detail?: string })?.detail ?? `Request failed (${status})`
  const err = new Error(msg) as ApiError
  err.status = status
  err.detail = detail
  return err
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers, ...rest } = init
  const h = new Headers(headers)
  if (token) h.set('Authorization', `Bearer ${token}`)
  if (!h.has('Content-Type') && !(rest.body instanceof FormData)) {
    h.set('Content-Type', 'application/json')
  }
  const res = await fetch(apiUrl(path), { ...rest, headers: h })
  if (!res.ok) {
    let body: unknown = undefined
    try {
      body = await res.json()
    } catch {
      try {
        body = await res.text()
      } catch {
        /* ignore */
      }
    }
    throw makeError(res.status, body)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return (await res.json()) as T
  return (await res.text()) as unknown as T
}
