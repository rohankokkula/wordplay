import { useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Loader2, Upload } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { audioBufferToWav, extractPeaks, renderMix } from '@/mix/renderMix'
import { useMixStore } from '@/mix/store'
import { apiUrl } from '@/apiBase'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  stems: Record<'A' | 'B', { vocals: AudioBuffer; instruments: AudioBuffer }> | null
  onPublished?: (slug: string) => void
}

export function PublishDialog({ open, onOpenChange, stems, onPublished }: Props) {
  const { token } = useAuth()
  const { graph } = useMixStore()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [isPublic, setIsPublic] = useState(localStorage.getItem('wp:auto-public') !== '0')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) {
      setError('Sign in to publish.')
      return
    }
    if (!stems) {
      setError('Load stems before publishing.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setStatus('Rendering mix…')
      const buffer = await renderMix(graph, stems)
      const wav = audioBufferToWav(buffer)
      const peaks = extractPeaks(buffer, 256)

      setStatus('Uploading…')
      const form = new FormData()
      form.append('title', title.trim() || 'Untitled wordplay')
      form.append('description', description.trim())
      form.append('visibility', isPublic ? 'public' : 'unlisted')
      form.append(
        'hashtags',
        hashtags
          .split(/[, ]+/)
          .map((h) => h.replace(/^#/, '').trim())
          .filter(Boolean)
          .slice(0, 6)
          .join(','),
      )
      form.append('duration_sec', String(Math.round(buffer.duration)))
      form.append('graph_json', JSON.stringify(graph))
      form.append('waveform_json', JSON.stringify({ peaks }))
      form.append('audio', new File([wav], 'mix.wav', { type: 'audio/wav' }))

      const res = await fetch(apiUrl('/api/community/publish'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string }
        throw new Error(body.detail || `Publish failed (${res.status})`)
      }
      const data = (await res.json()) as { slug: string }
      setStatus('Published!')
      onPublished?.(data.slug)
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      setStatus('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish your wordplay</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-sm text-[var(--wp-muted)]">Title</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give it a name you'd proudly share"
              maxLength={80}
              required
              className="mt-1"
            />
          </label>
          <label className="block">
            <span className="text-sm text-[var(--wp-muted)]">Description</span>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={280}
              className="mt-1"
            />
          </label>
          <label className="block">
            <span className="text-sm text-[var(--wp-muted)]">Hashtags</span>
            <Input
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="mashup, bollywood, afrobeats"
              maxLength={180}
              className="mt-1"
            />
          </label>
          <div className="flex items-center justify-between rounded-lg border border-[var(--wp-border)] px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">Public</div>
              <div className="text-xs text-[var(--wp-muted)]">
                {isPublic ? 'Anyone on Wordplay can listen and remix.' : 'Only people with the link.'}
              </div>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
          {error && <div className="text-sm text-rose-400">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {busy ? status || 'Publishing…' : 'Publish mix'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
