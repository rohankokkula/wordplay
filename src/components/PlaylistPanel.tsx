import { useState, useEffect, useCallback, useRef } from 'react'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import { Music, Plus, Trash2, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { googleLoginUiProps, googleSignInIdProps } from '../auth/googleSignInConfig'
import { useAuth } from '../auth/AuthContext'
import { apiUrl } from '../apiBase'
import { WORDPLAYLIST_DRAG_MIME } from '../wordplaylistDrag'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

export interface PlaylistItemRow {
  id: string
  filename: string
  size_bytes: number
  duration_sec: number | null
  title: string | null
  artist: string | null
  bpm: number | null
  has_art: boolean
  created_at: string | null
}

interface Props {
  token: string | null
  onLoadFile: (file: File) => void
  /** When true, omit section title (used inside AppSidebarLeft card). */
  embedded?: boolean
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json()
    const d = data?.detail
    if (typeof d === 'string') return d
    if (Array.isArray(d) && d[0]?.msg) {
      return d.map((x: { msg: string }) => x.msg).join('; ')
    }
  } catch {
    /* ignore */
  }
  return `Request failed (${res.status})`
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function PlaylistCover({
  itemId,
  hasArt,
  token,
}: {
  itemId: string
  hasArt: boolean
  token: string | null
}) {
  const [src, setSrc] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!hasArt || !token) {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
      setSrc(null)
      return
    }
    const ac = new AbortController()
    fetch(apiUrl(`/api/playlist/${itemId}/art`), {
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || ac.signal.aborted) return
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        const u = URL.createObjectURL(blob)
        urlRef.current = u
        setSrc(u)
      })
      .catch(() => {
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current)
          urlRef.current = null
        }
        setSrc(null)
      })
    return () => {
      ac.abort()
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [itemId, hasArt, token])

  return (
    <div className="relative h-11 w-11 rounded-lg overflow-hidden shrink-0 bg-[var(--wp-surface-3)] ring-1 ring-[var(--wp-border)] flex items-center justify-center">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <Music className="h-4 w-4 text-[var(--wp-muted)]" />
      )}
    </div>
  )
}

export function PlaylistPanel({ token, onLoadFile, embedded = false }: Props) {
  const { loginWithGoogle } = useAuth()
  const [signInError, setSignInError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  const [items, setItems] = useState<PlaylistItemRow[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSignIn = useCallback(
    async (response: CredentialResponse) => {
      if (!response.credential) {
        setSignInError('Google sign-in failed — no credential returned')
        return
      }
      setSigningIn(true)
      setSignInError('')
      try {
        await loginWithGoogle(response.credential)
      } catch (e) {
        setSignInError(e instanceof Error ? e.message : 'Login failed')
      } finally {
        setSigningIn(false)
      }
    },
    [loginWithGoogle],
  )

  const headers = useCallback((): HeadersInit => {
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [token])

  const fetchItems = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(apiUrl('/api/playlist'), { headers: headers() })
      if (res.ok) setItems(await res.json())
    } catch {
      /* silent */
    }
  }, [token, headers])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const uploadOne = useCallback(
    async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(apiUrl('/api/playlist/upload'), {
        method: 'POST',
        headers: headers(),
        body: form,
      })
      if (!res.ok) throw new Error(await readErrorDetail(res))
    },
    [headers],
  )

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!token || !files.length) return
      setUploading(true)
      setUploadError(null)
      try {
        for (const file of files) await uploadOne(file)
        await fetchItems()
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : 'Upload failed')
      } finally {
        setUploading(false)
      }
    },
    [token, uploadOne, fetchItems],
  )

  const handleLoad = useCallback(
    async (item: PlaylistItemRow) => {
      if (!token) return
      setLoadingId(item.id)
      try {
        const res = await fetch(apiUrl(`/api/playlist/${item.id}/file`), {
          headers: headers(),
        })
        if (!res.ok) return
        const blob = await res.blob()
        const file = new File([blob], item.filename, { type: blob.type })
        onLoadFile(file)
      } finally {
        setLoadingId(null)
      }
    },
    [token, headers, onLoadFile],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (!token) return
      await fetch(apiUrl(`/api/playlist/${id}`), {
        method: 'DELETE',
        headers: headers(),
      })
      await fetchItems()
    },
    [token, headers, fetchItems],
  )

  // ─── Signed out ─────────────────────────────────────────
  if (!token) {
    return (
      <div className="flex flex-col gap-3">
        {!embedded && <div className="wp-label">Wordplaylist</div>}
        <p className="wp-muted text-center">
          Sign in with Google to save tracks and sync your Wordplaylist.
        </p>
        <div className="flex justify-center">
          <GoogleLogin
            {...googleSignInIdProps}
            {...googleLoginUiProps}
            onSuccess={(c) => void handleSignIn(c)}
            onError={() => setSignInError('Google sign-in was cancelled')}
          />
        </div>
        {signingIn && (
          <p className="wp-caption text-center">Signing in…</p>
        )}
        {signInError && (
          <p className="wp-caption text-center text-[var(--wp-danger)]" role="alert">
            {signInError}
          </p>
        )}
      </div>
    )
  }

  // ─── Signed in ──────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3 min-h-0">
      {!embedded && <div className="wp-label">Wordplaylist</div>}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) void handleUploadFiles(files)
          e.target.value = ''
        }}
      />

      <Button
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="w-full gap-1.5 bg-[var(--wp-accent)]/15 text-[var(--wp-accent-hi)] hover:bg-[var(--wp-accent)]/25 border border-[var(--wp-accent)]/30"
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {uploading ? 'Uploading…' : 'Add tracks'}
      </Button>

      {uploadError && (
        <p className="wp-caption text-[var(--wp-danger)]" role="alert">
          {uploadError}
        </p>
      )}

      {items.length === 0 ? (
        <p className="wp-muted text-center py-4">
          Drop audio files here or use the button above.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 overflow-y-auto wp-scroll pr-1 min-h-0">
          <AnimatePresence initial={false}>
            {items.map((item) => {
              const title = (item.title || '').trim() || item.filename
              const artist = (item.artist || '').trim()
              const busy = loadingId === item.id

              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  whileHover={{ y: -1 }}
                  draggable
                  onDragStart={(e) => {
                    // motion forwards the native event as DragEvent
                    const de = e as unknown as DragEvent
                    de.dataTransfer?.setData(WORDPLAYLIST_DRAG_MIME, item.id)
                    de.dataTransfer?.setData('text/plain', item.filename)
                    if (de.dataTransfer) de.dataTransfer.effectAllowed = 'copy'
                  }}
                  className={cn(
                    'group rounded-xl border border-[var(--wp-border)] bg-[var(--wp-surface-2)]/60 p-2.5 flex items-center gap-2.5 cursor-grab active:cursor-grabbing transition-colors',
                    'hover:border-[var(--wp-border-hi)] hover:bg-[var(--wp-surface-2)]',
                  )}
                >
                  <PlaylistCover itemId={item.id} hasArt={item.has_art} token={token} />
                  <div className="min-w-0 flex-1">
                    <div className="wp-title truncate text-[0.8125rem]" title={title}>
                      {busy ? 'Loading…' : title}
                    </div>
                    {artist && (
                      <div className="wp-caption truncate" title={artist}>
                        {artist}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {item.bpm != null && Number.isFinite(item.bpm) ? (
                        <span className="inline-flex items-center rounded-md bg-[var(--wp-accent)]/15 text-[var(--wp-accent-hi)] text-[10px] font-semibold px-1.5 py-[1px]">
                          {Math.round(item.bpm)} BPM
                        </span>
                      ) : (
                        <span className="wp-caption text-[10px]">BPM —</span>
                      )}
                      <span className="wp-mono text-[11px] text-[var(--wp-muted)]">
                        {fmtDuration(item.duration_sec)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void handleLoad(item)}
                      className="h-6 px-2 text-[11px] bg-[var(--wp-accent)]/15 text-[var(--wp-accent-hi)] hover:bg-[var(--wp-accent)]/25"
                    >
                      Load
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove from Wordplaylist"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDelete(item.id)
                      }}
                      className="h-6 w-6 text-[var(--wp-muted)] hover:text-[var(--wp-danger)] hover:bg-[var(--wp-danger)]/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
