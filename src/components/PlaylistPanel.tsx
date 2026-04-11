import { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconMusic, IconPlus, IconTrash } from '@tabler/icons-react';
import { googleSignInIdProps } from '../auth/googleSignInConfig';
import { useAuth } from '../auth/AuthContext';
import { apiUrl } from '../apiBase';
import { WORDPLAYLIST_DRAG_MIME } from '../wordplaylistDrag';
import './PlaylistPanel.css';

export interface PlaylistItemRow {
  id: string;
  filename: string;
  size_bytes: number;
  duration_sec: number | null;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  has_art: boolean;
  created_at: string | null;
}

interface Props {
  token: string | null;
  onLoadFile: (file: File) => void;
  /** When true, omit section title (used inside AppSidebarLeft card). */
  embedded?: boolean;
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    const d = data?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d[0]?.msg) return d.map((x: { msg: string }) => x.msg).join('; ');
  } catch {
    /* ignore */
  }
  return `Request failed (${res.status})`;
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function PlaylistCover({ itemId, hasArt, token }: { itemId: string; hasArt: boolean; token: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasArt || !token) {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setSrc(null);
      return;
    }

    const ac = new AbortController();

    fetch(apiUrl(`/api/playlist/${itemId}/art`), {
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || ac.signal.aborted) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const u = URL.createObjectURL(blob);
        urlRef.current = u;
        setSrc(u);
      })
      .catch(() => {
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current);
          urlRef.current = null;
        }
        setSrc(null);
      });

    return () => {
      ac.abort();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [itemId, hasArt, token]);

  return (
    <Avatar src={src || undefined} alt="" radius="md" size={52} variant="light" color="violet">
      {!src && <IconMusic size={22} stroke={1.5} aria-hidden />}
    </Avatar>
  );
}

export function PlaylistPanel({ token, onLoadFile, embedded = false }: Props) {
  const { loginWithGoogle } = useAuth();
  const [inviteCode, setInviteCode] = useState('');
  const [signInError, setSignInError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const [items, setItems] = useState<PlaylistItemRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handlePlaylistGoogleSuccess = useCallback(
    async (response: CredentialResponse) => {
      if (!response.credential) {
        setSignInError('Google sign-in failed — no credential returned');
        return;
      }
      if (!inviteCode.trim()) {
        setSignInError('Enter your invite code first');
        return;
      }
      setSigningIn(true);
      setSignInError('');
      try {
        await loginWithGoogle(response.credential, inviteCode.trim());
      } catch (e) {
        setSignInError(e instanceof Error ? e.message : 'Login failed');
      } finally {
        setSigningIn(false);
      }
    },
    [inviteCode, loginWithGoogle],
  );

  const headers = useCallback((): HeadersInit => {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [token]);

  const fetchItems = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl('/api/playlist'), { headers: headers() });
      if (res.ok) setItems(await res.json());
    } catch {
      /* silent */
    }
  }, [token, headers]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const uploadOne = useCallback(
    async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(apiUrl('/api/playlist/upload'), {
        method: 'POST',
        headers: headers(),
        body: form,
      });
      if (!res.ok) {
        throw new Error(await readErrorDetail(res));
      }
    },
    [headers],
  );

  const handleUploadFiles = useCallback(
    async (files: File[] | null) => {
      if (!token || !files?.length) return;
      setUploading(true);
      setUploadError(null);
      try {
        for (const file of files) {
          await uploadOne(file);
        }
        await fetchItems();
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [token, uploadOne, fetchItems],
  );

  const handleLoad = useCallback(
    async (item: PlaylistItemRow) => {
      if (!token) return;
      setLoadingId(item.id);
      try {
        const res = await fetch(apiUrl(`/api/playlist/${item.id}/file`), {
          headers: headers(),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const file = new File([blob], item.filename, { type: blob.type });
        onLoadFile(file);
      } finally {
        setLoadingId(null);
      }
    },
    [token, headers, onLoadFile],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!token) return;
      await fetch(apiUrl(`/api/playlist/${id}`), {
        method: 'DELETE',
        headers: headers(),
      });
      await fetchItems();
    },
    [token, headers, fetchItems],
  );

  if (!token) {
    return (
      <Stack gap="md" className="playlist-panel playlist-panel--empty">
        {!embedded && (
          <Text fw={700} size="sm" tt="uppercase" c="dimmed" lts="0.2em">
            Wordplaylist
          </Text>
        )}
        <Text size="sm" c="dimmed" ta="center">
          Sign in with Google to save tracks and sync your Wordplaylist. You’ll stay in the mixer.
        </Text>
        <TextInput
          label="Invite code"
          placeholder="Required — same as on the start screen"
          value={inviteCode}
          onChange={(e) => {
            setInviteCode(e.target.value);
            if (signInError) setSignInError('');
          }}
          size="sm"
          disabled={signingIn}
          autoComplete="off"
        />
        <div className="playlist-panel__google-wrap">
          <GoogleLogin
            {...googleSignInIdProps}
            onSuccess={(c) => void handlePlaylistGoogleSuccess(c)}
            onError={() => setSignInError('Google sign-in was cancelled')}
            theme="filled_black"
            size="large"
            shape="pill"
            text="signin_with"
          />
        </div>
        {signingIn && (
          <Text size="xs" c="dimmed" ta="center">
            Signing in…
          </Text>
        )}
        {signInError ? (
          <Text size="xs" c="red" ta="center" role="alert">
            {signInError}
          </Text>
        ) : null}
      </Stack>
    );
  }

  return (
    <Stack gap="sm" className="playlist-panel">
      {!embedded && (
        <Text fw={700} size="sm" tt="uppercase" c="dimmed" lts="0.2em">
          Wordplaylist
        </Text>
      )}

      <FileButton
        onChange={(files) => files?.length && void handleUploadFiles(Array.from(files))}
        accept="audio/*"
        multiple
      >
        {(props) => (
          <Button
            {...props}
            variant="light"
            color="violet"
            fullWidth
            leftSection={<IconPlus size={18} stroke={1.5} />}
            loading={uploading}
          >
            {uploading ? 'Uploading…' : 'Add tracks'}
          </Button>
        )}
      </FileButton>

      {uploadError && (
        <Text size="xs" c="red" role="alert">
          {uploadError}
        </Text>
      )}

      {items.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center" py="md">
          Drop audio files here or use the button. Multi-select supported.
        </Text>
      ) : (
        <ScrollArea
          className="playlist-panel__scroll"
          style={{ flex: 1, minHeight: 0 }}
          type="auto"
          scrollbarSize={6}
          offsetScrollbars
        >
          <Stack gap="xs" pr="xs">
            {items.map((item) => {
              const title = (item.title || '').trim() || item.filename;
              const artist = (item.artist || '').trim();
              const busy = loadingId === item.id;

              return (
                <Card
                  key={item.id}
                  padding="sm"
                  radius="md"
                  withBorder
                  shadow="xs"
                  draggable
                  className="playlist-panel__card"
                  onDragStart={(e) => {
                    e.dataTransfer.setData(WORDPLAYLIST_DRAG_MIME, item.id);
                    e.dataTransfer.setData('text/plain', item.filename);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <Group gap="sm" wrap="nowrap" align="flex-start" justify="space-between">
                    <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0, flex: 1 }}>
                      <PlaylistCover itemId={item.id} hasArt={item.has_art} token={token} />
                      <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                        <Text size="sm" fw={600} lineClamp={2} title={title}>
                          {busy ? 'Loading…' : title}
                        </Text>
                        {artist ? (
                          <Text size="xs" c="dimmed" lineClamp={1} title={artist}>
                            {artist}
                          </Text>
                        ) : null}
                        <Group gap={8} wrap="wrap" align="center">
                          {item.bpm != null && Number.isFinite(item.bpm) ? (
                            <Badge size="xs" variant="light" color="grape">
                              {Math.round(item.bpm)} BPM
                            </Badge>
                          ) : (
                            <Text size="xs" c="dimmed">
                              BPM —
                            </Text>
                          )}
                          <Text size="xs" c="dimmed" ff="monospace">
                            {fmtDuration(item.duration_sec)}
                          </Text>
                        </Group>
                      </Stack>
                    </Group>
                    <Group gap={4} wrap="nowrap">
                      <Button
                        size="compact-xs"
                        variant="light"
                        color="violet"
                        disabled={busy}
                        onClick={() => void handleLoad(item)}
                      >
                        Load
                      </Button>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="lg"
                        aria-label="Remove from Wordplaylist"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(item.id);
                        }}
                      >
                        <IconTrash size={18} stroke={1.5} />
                      </ActionIcon>
                    </Group>
                  </Group>
                </Card>
              );
            })}
          </Stack>
        </ScrollArea>
      )}
    </Stack>
  );
}
