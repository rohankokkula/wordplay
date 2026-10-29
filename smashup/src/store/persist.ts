/**
 * IndexedDB persistence: audio blobs keyed by `${hash}:${stem}` and crate JSON.
 * Every call is wrapped — private windows or blocked storage degrade to memory only.
 */

import type { Crate } from '@/model/types'
import { SCHEMA_VERSION } from '@/model/types'

const DB = 'smashup'
const BLOBS = 'blobs'
const CRATES = 'crates'

let dbp: Promise<IDBDatabase | null> | null = null
const memBlobs = new Map<string, Blob>()

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS)
        if (!db.objectStoreNames.contains(CRATES)) db.createObjectStore(CRATES)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbp
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const req = fn(db.transaction(store, mode).objectStore(store))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  memBlobs.set(key, blob)
  await tx(BLOBS, 'readwrite', (s) => s.put(blob, key))
}

/** Memory-only blobs (e.g. regenerable demo audio). */
export function putMemBlob(key: string, blob: Blob): void {
  memBlobs.set(key, blob)
}

export async function getBlob(key: string): Promise<Blob | null> {
  const m = memBlobs.get(key)
  if (m) return m
  const b = await tx<Blob>(BLOBS, 'readonly', (s) => s.get(key) as IDBRequest<Blob>)
  if (b) memBlobs.set(key, b)
  return b ?? null
}

export async function deleteBlobs(prefix: string): Promise<void> {
  for (const k of [...memBlobs.keys()]) if (k.startsWith(prefix)) memBlobs.delete(k)
  const db = await open()
  if (!db) return
  try {
    const range = IDBKeyRange.bound(prefix, `${prefix}￿`)
    db.transaction(BLOBS, 'readwrite').objectStore(BLOBS).delete(range)
  } catch {
    /* ignore */
  }
}

export async function saveCrates(crates: Crate[]): Promise<void> {
  await tx(CRATES, 'readwrite', (s) => s.put({ v: SCHEMA_VERSION, crates }, 'all'))
}

export async function loadCrates(): Promise<Crate[]> {
  const r = await tx<{ v: number; crates: Crate[] }>(CRATES, 'readonly', (s) => s.get('all') as IDBRequest<{ v: number; crates: Crate[] }>)
  if (!r || r.v !== SCHEMA_VERSION) return []
  return r.crates
}

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('')
}
