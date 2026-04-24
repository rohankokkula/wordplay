import { api } from './client'
import { apiUrl } from '../apiBase'

export interface FeedAuthor {
  id: string
  handle: string
  name: string
  picture: string
}

export interface FeedPost {
  id: string
  slug: string
  title: string
  description: string
  visibility: 'public' | 'unlisted' | 'private'
  has_cover: boolean
  duration_sec: number
  hashtags: string[]
  waveform: { peaks?: number[] } | null
  remix_of_id: string | null
  plays_count: number
  likes_count: number
  comments_count: number
  remixes_count: number
  trending_score: number
  created_at: string | null
  author: FeedAuthor
  liked_by_me: boolean
  graph_json?: unknown
  source_tracks?: Array<{ title: string; duration: number; bpm?: number }>
}

export interface FeedResponse {
  posts: FeedPost[]
  next_cursor: string | null
}

export type FeedTab = 'foryou' | 'following' | 'trending'

export function fetchFeed(tab: FeedTab, token: string | null, cursor: string | null = null) {
  const params = new URLSearchParams({ tab, limit: '20' })
  if (cursor) params.set('cursor', cursor)
  return api<FeedResponse>(`/api/community/feed?${params.toString()}`, { token })
}

export function fetchPost(slug: string, token: string | null) {
  return api<FeedPost>(`/api/community/post/${slug}`, { token })
}

export function likePost(id: string, token: string) {
  return api<{ liked: boolean; likes_count: number }>(`/api/community/post/${id}/like`, {
    method: 'POST',
    token,
  })
}

export function unlikePost(id: string, token: string) {
  return api<{ liked: boolean; likes_count: number }>(`/api/community/post/${id}/like`, {
    method: 'DELETE',
    token,
  })
}

export interface Comment {
  id: string
  body: string
  parent_id: string | null
  created_at: string | null
  author: FeedAuthor
}

export function fetchComments(postId: string, cursor: string | null = null) {
  const params = new URLSearchParams({ limit: '20' })
  if (cursor) params.set('cursor', cursor)
  return api<{ comments: Comment[]; next_cursor: string | null }>(
    `/api/community/post/${postId}/comments?${params.toString()}`,
  )
}

export function createComment(postId: string, body: string, token: string) {
  return api<{ id: string; created_at: string }>(`/api/community/post/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
    token,
  })
}

export function recordPlay(postId: string, sessionId: string, msListened: number, token: string | null) {
  return api<{ ok: boolean; counted: boolean }>(`/api/community/post/${postId}/play`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, ms_listened: msListened }),
    token,
  })
}

export function followUser(userId: string, token: string) {
  return api<{ following: boolean; followers_count: number }>(`/api/social/follow/${userId}`, {
    method: 'POST',
    token,
  })
}

export function unfollowUser(userId: string, token: string) {
  return api<{ following: boolean; followers_count: number }>(`/api/social/follow/${userId}`, {
    method: 'DELETE',
    token,
  })
}

export interface Profile {
  user: {
    id: string
    handle: string
    name: string
    picture: string
    bio: string
    followers_count: number
    following_count: number
    plays_total: number
    following_by_me: boolean
    is_me: boolean
  }
  posts: Array<{
    id: string
    slug: string
    title: string
    has_cover: boolean
    likes_count: number
    plays_count: number
    created_at: string | null
  }>
}

export function fetchProfile(handle: string, tab: 'mixes' | 'remixes' = 'mixes', token: string | null) {
  return api<Profile>(`/api/social/profile/${handle}?tab=${tab}`, { token })
}

export interface Notification {
  id: string
  type: 'like' | 'comment' | 'follow' | 'remix'
  post_id: string | null
  read: boolean
  created_at: string | null
  actor: FeedAuthor
}

export function fetchNotifications(token: string, unread = false) {
  const params = new URLSearchParams({ limit: '30' })
  if (unread) params.set('unread', 'true')
  return api<{ items: Notification[]; unread_count: number; next_cursor: string | null }>(
    `/api/social/notifications?${params.toString()}`,
    { token },
  )
}

export function markNotificationsRead(token: string, ids?: string[]) {
  return api<{ ok: boolean }>(`/api/social/notifications/read`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
    token,
  })
}

export function reportPost(id: string, reason: string, token: string, detail = '') {
  return api(`/api/community/post/${id}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason, detail }),
    token,
  })
}

export function coverUrl(id: string) {
  return apiUrl(`/api/community/${id}/cover`)
}

export function audioUrl(id: string) {
  return apiUrl(`/api/community/${id}/audio`)
}

export function forkGraphUrl(slug: string) {
  return apiUrl(`/api/community/post/${slug}/graph`)
}

export function fetchForkGraph(slug: string, token: string | null) {
  return api<{
    id: string
    slug: string
    title: string
    graph_json: unknown
    source_tracks: unknown
  }>(`/api/community/post/${slug}/graph`, { token })
}
