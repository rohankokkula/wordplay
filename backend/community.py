"""Community Wordplay platform — publish, feed, posts, engagement."""

from __future__ import annotations

import json
import math
import re
import secrets
import string
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError

from db import async_session
from models import Comment, Follow, Like, Notification, PlayEvent, Report, User, WordplayPost
from storage import get_upload_root
from wordplay_auth import get_current_user, get_optional_user

router = APIRouter(prefix="/api/community", tags=["community"])

UPLOAD_ROOT = get_upload_root()
MAX_AUDIO_SIZE = 50 * 1024 * 1024
MAX_COVER_SIZE = 2 * 1024 * 1024

# ── Simple in-memory token-bucket rate limiter (single-instance sufficient) ──

_BUCKETS: dict[str, list[float]] = {}


def _rate_limit(key: str, max_requests: int, window_sec: int) -> None:
    now = time.time()
    window_start = now - window_sec
    bucket = _BUCKETS.setdefault(key, [])
    bucket[:] = [t for t in bucket if t >= window_start]
    if len(bucket) >= max_requests:
        raise HTTPException(429, "Too many requests — slow down.")
    bucket.append(now)


# ── Profanity filter (tiny starter list; extend in moderation.py later) ──

_BADWORDS = {"fuck", "shit", "bitch", "asshole", "nigger", "faggot", "cunt", "slut"}


def _clean_text(text: str) -> str:
    def _mask(m: re.Match[str]) -> str:
        return m.group(0)[0] + "*" * (len(m.group(0)) - 1)

    pattern = re.compile(r"\b(" + "|".join(re.escape(w) for w in _BADWORDS) + r")\b", re.IGNORECASE)
    return pattern.sub(_mask, text)


def _slug(n: int = 10) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n))


def _derive_handle(email: str, name: str) -> str:
    base = (name or email.split("@", 1)[0] or "user").lower()
    base = re.sub(r"[^a-z0-9_]+", "", base)[:32] or "user"
    return base


async def _ensure_handle(user_id: str, email: str, name: str) -> str:
    """Assigns a unique handle the first time a user publishes or is queried."""
    async with async_session() as session:
        u = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if not u:
            raise HTTPException(404, "User not found")
        if u.handle:
            return u.handle
        base = _derive_handle(email, name)
        candidate = base
        for suffix in ("", *(str(n) for n in range(2, 50))):
            c = f"{base}{suffix}" if suffix else base
            exists = (
                await session.execute(select(User.id).where(User.handle == c))
            ).scalar_one_or_none()
            if not exists:
                candidate = c
                break
        else:
            candidate = f"{base}{secrets.token_hex(2)}"
        u.handle = candidate
        await session.commit()
        return candidate


def _recompute_trending(post: WordplayPost) -> float:
    created = post.created_at or datetime.now(timezone.utc)
    age_h = max((datetime.now(timezone.utc) - created).total_seconds() / 3600.0, 0.0)
    raw = (
        post.likes_count * 3
        + post.comments_count * 4
        + post.plays_count * 1
        + post.remixes_count * 5
    )
    return float(raw) * math.exp(-age_h / 48.0)


async def _serialize_post(post: WordplayPost, author: User, viewer_id: str | None) -> dict[str, Any]:
    liked_by_me = False
    if viewer_id:
        async with async_session() as session:
            liked = (
                await session.execute(
                    select(Like.id).where(
                        Like.user_id == viewer_id, Like.post_id == post.id
                    )
                )
            ).scalar_one_or_none()
            liked_by_me = liked is not None
    return {
        "id": post.id,
        "slug": post.slug,
        "title": post.title,
        "description": post.description,
        "visibility": post.visibility,
        "has_cover": bool(post.cover_stored_path),
        "duration_sec": post.duration_sec,
        "hashtags": post.hashtags_json or [],
        "waveform": post.waveform_json,
        "remix_of_id": post.remix_of_id,
        "plays_count": post.plays_count,
        "likes_count": post.likes_count,
        "comments_count": post.comments_count,
        "remixes_count": post.remixes_count,
        "trending_score": post.trending_score,
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "author": {
            "id": author.id,
            "handle": author.handle,
            "name": author.name or "Anonymous",
            "picture": author.picture or "",
        },
        "liked_by_me": liked_by_me,
    }


# ── Publish ──────────────────────────────────────────────────────────────────


@router.post("/publish")
async def publish(
    title: str = Form(..., max_length=100),
    description: str = Form("", max_length=280),
    audio: UploadFile = File(...),
    cover: UploadFile | None = File(None),
    visibility: str = Form("public"),
    remix_of_id: str | None = Form(None),
    graph_json: str | None = Form(None),
    waveform_json: str | None = Form(None),
    source_tracks_json: str | None = Form(None),
    hashtags: str | None = Form(None),
    duration_sec: float = Form(0.0),
    user: dict = Depends(get_current_user),
):
    _rate_limit(f"publish:{user['sub']}", max_requests=5, window_sec=3600)

    if visibility not in {"public", "unlisted", "private"}:
        raise HTTPException(400, "visibility must be public/unlisted/private")

    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_SIZE:
        raise HTTPException(413, f"Audio too large (max {MAX_AUDIO_SIZE // (1024*1024)} MB)")

    community_dir = UPLOAD_ROOT / "community" / user["sub"]
    community_dir.mkdir(parents=True, exist_ok=True)

    post_id = str(uuid.uuid4())
    audio_ext = Path(audio.filename or "mix.mp3").suffix or ".mp3"
    audio_name = f"{post_id}{audio_ext}"
    audio_path = community_dir / audio_name
    audio_path.write_bytes(audio_bytes)

    cover_rel = ""
    if cover and cover.filename:
        cover_bytes = await cover.read()
        if len(cover_bytes) > MAX_COVER_SIZE:
            raise HTTPException(413, f"Cover too large (max {MAX_COVER_SIZE // (1024*1024)} MB)")
        cover_ext = Path(cover.filename).suffix or ".jpg"
        cover_path = community_dir / f"{post_id}_cover{cover_ext}"
        cover_path.write_bytes(cover_bytes)
        cover_rel = str(cover_path.relative_to(UPLOAD_ROOT))

    clean_title = _clean_text(title.strip())[:100]
    clean_desc = _clean_text(description.strip())[:280]

    def _parse(raw: str | None, default: Any) -> Any:
        if not raw:
            return default
        try:
            return json.loads(raw)
        except Exception:
            return default

    hashtag_list: list[str] = []
    if hashtags:
        hashtag_list = [
            h.strip().lstrip("#").lower()
            for h in hashtags.split(",")
            if h.strip()
        ][:10]

    async with async_session() as session:
        # collision-resistant slug
        new_slug = _slug(10)
        post = WordplayPost(
            id=post_id,
            user_id=user["sub"],
            slug=new_slug,
            title=clean_title,
            description=clean_desc,
            audio_stored_path=str(audio_path.relative_to(UPLOAD_ROOT)),
            cover_stored_path=cover_rel,
            graph_json=_parse(graph_json, None),
            waveform_json=_parse(waveform_json, None),
            source_tracks_json=_parse(source_tracks_json, None),
            hashtags_json=hashtag_list,
            duration_sec=max(0.0, float(duration_sec)),
            visibility=visibility,
            remix_of_id=remix_of_id or None,
        )
        session.add(post)
        if remix_of_id:
            parent = (
                await session.execute(select(WordplayPost).where(WordplayPost.id == remix_of_id))
            ).scalar_one_or_none()
            if parent:
                parent.remixes_count = (parent.remixes_count or 0) + 1
                session.add(
                    Notification(
                        user_id=parent.user_id,
                        actor_id=user["sub"],
                        type="remix",
                        post_id=post_id,
                    )
                )
        await session.commit()
        await session.refresh(post)
        await _ensure_handle(user["sub"], user.get("email", ""), user.get("name", ""))

    return {"id": post.id, "slug": post.slug, "title": post.title}


# ── Feed ─────────────────────────────────────────────────────────────────────


@router.get("/feed")
async def feed(
    tab: str = Query("foryou"),
    cursor: str | None = Query(None),
    limit: int = Query(20, ge=1, le=50),
    user: dict | None = Depends(get_optional_user),
):
    viewer_id = user["sub"] if user else None
    async with async_session() as session:
        q = select(WordplayPost, User).join(User, WordplayPost.user_id == User.id)
        q = q.where(WordplayPost.visibility == "public", WordplayPost.is_deleted.is_(False))

        if tab == "following" and viewer_id:
            q = q.join(Follow, Follow.followee_id == WordplayPost.user_id).where(
                Follow.follower_id == viewer_id
            )
        if tab == "trending":
            q = q.order_by(WordplayPost.trending_score.desc(), WordplayPost.created_at.desc())
        else:
            q = q.order_by(WordplayPost.created_at.desc())

        if cursor:
            try:
                q = q.offset(int(cursor))
            except ValueError:
                pass
        q = q.limit(limit)
        rows = (await session.execute(q)).all()

    posts = [await _serialize_post(p, a, viewer_id) for p, a in rows]
    next_cursor = str(int(cursor or 0) + limit) if len(posts) == limit else None
    return {"posts": posts, "next_cursor": next_cursor}


@router.get("/post/{slug}")
async def post_detail(slug: str, user: dict | None = Depends(get_optional_user)):
    viewer_id = user["sub"] if user else None
    async with async_session() as session:
        row = (
            await session.execute(
                select(WordplayPost, User)
                .join(User, WordplayPost.user_id == User.id)
                .where(WordplayPost.slug == slug)
            )
        ).first()
    if not row:
        raise HTTPException(404, "Post not found")
    post, author = row
    if post.visibility == "private" and viewer_id != post.user_id:
        raise HTTPException(404, "Post not found")
    data = await _serialize_post(post, author, viewer_id)
    data["graph_json"] = post.graph_json
    data["source_tracks"] = post.source_tracks_json or []
    return data


# ── Play events + counters ──────────────────────────────────────────────────


@router.post("/post/{post_id}/play")
async def record_play(
    post_id: str,
    payload: dict = Body(default_factory=dict),
    user: dict | None = Depends(get_optional_user),
):
    ms = int(payload.get("ms_listened", 0))
    if ms < 5000:
        return {"ok": True, "counted": False}
    session_id = str(payload.get("session_id") or "")[:64]
    if not session_id:
        raise HTTPException(400, "session_id required")
    async with async_session() as session:
        post = (
            await session.execute(select(WordplayPost).where(WordplayPost.id == post_id))
        ).scalar_one_or_none()
        if not post or post.is_deleted:
            raise HTTPException(404, "Post not found")
        event = PlayEvent(
            post_id=post_id,
            user_id=user["sub"] if user else None,
            session_id=session_id,
            ms_listened=ms,
        )
        session.add(event)
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            return {"ok": True, "counted": False}
        post.plays_count = (post.plays_count or 0) + 1
        post.trending_score = _recompute_trending(post)
        await session.commit()
    return {"ok": True, "counted": True}


# ── Likes ────────────────────────────────────────────────────────────────────


@router.post("/post/{post_id}/like")
async def like_post(post_id: str, user: dict = Depends(get_current_user)):
    _rate_limit(f"like:{user['sub']}", max_requests=60, window_sec=60)
    async with async_session() as session:
        post = (
            await session.execute(select(WordplayPost).where(WordplayPost.id == post_id))
        ).scalar_one_or_none()
        if not post or post.is_deleted:
            raise HTTPException(404, "Post not found")
        existing = (
            await session.execute(
                select(Like).where(Like.user_id == user["sub"], Like.post_id == post_id)
            )
        ).scalar_one_or_none()
        if existing:
            return {"liked": True, "likes_count": post.likes_count}
        session.add(Like(user_id=user["sub"], post_id=post_id))
        post.likes_count = (post.likes_count or 0) + 1
        post.trending_score = _recompute_trending(post)
        if post.user_id != user["sub"]:
            session.add(
                Notification(
                    user_id=post.user_id,
                    actor_id=user["sub"],
                    type="like",
                    post_id=post_id,
                )
            )
        await session.commit()
        return {"liked": True, "likes_count": post.likes_count}


@router.delete("/post/{post_id}/like")
async def unlike_post(post_id: str, user: dict = Depends(get_current_user)):
    async with async_session() as session:
        post = (
            await session.execute(select(WordplayPost).where(WordplayPost.id == post_id))
        ).scalar_one_or_none()
        if not post:
            raise HTTPException(404, "Post not found")
        res = await session.execute(
            delete(Like).where(Like.user_id == user["sub"], Like.post_id == post_id)
        )
        if res.rowcount:
            post.likes_count = max(0, (post.likes_count or 1) - 1)
            post.trending_score = _recompute_trending(post)
        await session.commit()
        return {"liked": False, "likes_count": post.likes_count}


# ── Comments ─────────────────────────────────────────────────────────────────


@router.get("/post/{post_id}/comments")
async def list_comments(post_id: str, cursor: str | None = None, limit: int = 20):
    async with async_session() as session:
        q = (
            select(Comment, User)
            .join(User, Comment.user_id == User.id)
            .where(Comment.post_id == post_id, Comment.is_deleted.is_(False))
            .order_by(Comment.created_at.desc())
        )
        if cursor:
            try:
                q = q.offset(int(cursor))
            except ValueError:
                pass
        q = q.limit(limit)
        rows = (await session.execute(q)).all()
    comments = [
        {
            "id": c.id,
            "body": c.body,
            "parent_id": c.parent_id,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "author": {
                "id": u.id,
                "handle": u.handle,
                "name": u.name,
                "picture": u.picture,
            },
        }
        for c, u in rows
    ]
    next_cursor = str(int(cursor or 0) + limit) if len(comments) == limit else None
    return {"comments": comments, "next_cursor": next_cursor}


@router.post("/post/{post_id}/comments")
async def create_comment(
    post_id: str,
    payload: dict = Body(...),
    user: dict = Depends(get_current_user),
):
    _rate_limit(f"comment:{user['sub']}", max_requests=20, window_sec=300)
    body = _clean_text(str(payload.get("body", "")).strip())[:1000]
    if not body:
        raise HTTPException(400, "Comment body required")
    parent_id = payload.get("parent_id")
    async with async_session() as session:
        post = (
            await session.execute(select(WordplayPost).where(WordplayPost.id == post_id))
        ).scalar_one_or_none()
        if not post or post.is_deleted:
            raise HTTPException(404, "Post not found")
        c = Comment(
            user_id=user["sub"],
            post_id=post_id,
            parent_id=parent_id,
            body=body,
        )
        session.add(c)
        post.comments_count = (post.comments_count or 0) + 1
        post.trending_score = _recompute_trending(post)
        if post.user_id != user["sub"]:
            session.add(
                Notification(
                    user_id=post.user_id,
                    actor_id=user["sub"],
                    type="comment",
                    post_id=post_id,
                )
            )
        await session.commit()
        await session.refresh(c)
        return {"id": c.id, "created_at": c.created_at.isoformat()}


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str, user: dict = Depends(get_current_user)):
    async with async_session() as session:
        c = (
            await session.execute(select(Comment).where(Comment.id == comment_id))
        ).scalar_one_or_none()
        if not c:
            raise HTTPException(404, "Comment not found")
        post = (
            await session.execute(select(WordplayPost).where(WordplayPost.id == c.post_id))
        ).scalar_one_or_none()
        is_owner = c.user_id == user["sub"] or (post and post.user_id == user["sub"])
        if not is_owner:
            raise HTTPException(403, "Not allowed")
        c.is_deleted = True
        if post:
            post.comments_count = max(0, (post.comments_count or 1) - 1)
        await session.commit()
        return {"ok": True}


# ── Reports ──────────────────────────────────────────────────────────────────


@router.post("/post/{post_id}/report")
async def report_post(
    post_id: str,
    payload: dict = Body(default_factory=dict),
    user: dict = Depends(get_current_user),
):
    async with async_session() as session:
        session.add(
            Report(
                target_type="post",
                target_id=post_id,
                reporter_id=user["sub"],
                reason=str(payload.get("reason", "other"))[:64],
                detail=str(payload.get("detail", ""))[:500],
            )
        )
        await session.commit()
        return {"ok": True}


@router.post("/comments/{comment_id}/report")
async def report_comment(
    comment_id: str,
    payload: dict = Body(default_factory=dict),
    user: dict = Depends(get_current_user),
):
    async with async_session() as session:
        session.add(
            Report(
                target_type="comment",
                target_id=comment_id,
                reporter_id=user["sub"],
                reason=str(payload.get("reason", "other"))[:64],
                detail=str(payload.get("detail", ""))[:500],
            )
        )
        await session.commit()
        return {"ok": True}


# ── Static audio/cover streaming ─────────────────────────────────────────────


@router.get("/{post_id}/audio")
async def stream_audio(post_id: str):
    async with async_session() as session:
        post = (
            await session.execute(select(WordplayPost).where(WordplayPost.id == post_id))
        ).scalar_one_or_none()
    if not post or post.is_deleted:
        raise HTTPException(404, "Post not found")
    full_path = UPLOAD_ROOT / post.audio_stored_path
    if not full_path.is_file():
        raise HTTPException(404, "Audio file missing")
    suffix = full_path.suffix.lower()
    media_types = {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".webm": "audio/webm",
        ".opus": "audio/opus",
    }
    return FileResponse(full_path, media_type=media_types.get(suffix, "audio/mpeg"))


@router.get("/{post_id}/cover")
async def get_cover(post_id: str):
    async with async_session() as session:
        post = (
            await session.execute(select(WordplayPost).where(WordplayPost.id == post_id))
        ).scalar_one_or_none()
    if not post or not post.cover_stored_path:
        raise HTTPException(404, "Cover not found")
    full_path = UPLOAD_ROOT / post.cover_stored_path
    if not full_path.is_file():
        raise HTTPException(404, "Cover file missing")
    suffix = full_path.suffix.lower()
    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    return FileResponse(full_path, media_type=media_types.get(suffix, "image/jpeg"))


# ── Fork / remix helper ──────────────────────────────────────────────────────


@router.get("/post/{slug}/graph")
async def fetch_graph(slug: str, user: dict | None = Depends(get_optional_user)):
    async with async_session() as session:
        post = (
            await session.execute(select(WordplayPost).where(WordplayPost.slug == slug))
        ).scalar_one_or_none()
    if not post or post.is_deleted:
        raise HTTPException(404, "Post not found")
    if post.visibility == "private" and (not user or user["sub"] != post.user_id):
        raise HTTPException(404, "Post not found")
    return {
        "id": post.id,
        "slug": post.slug,
        "title": post.title,
        "graph_json": post.graph_json,
        "source_tracks": post.source_tracks_json or [],
    }


# ── Admin / moderation (minimal) ─────────────────────────────────────────────


@router.get("/admin/reports")
async def admin_reports(user: dict = Depends(get_current_user)):
    async with async_session() as session:
        u = (
            await session.execute(select(User).where(User.id == user["sub"]))
        ).scalar_one_or_none()
        if not u or not u.is_admin:
            raise HTTPException(403, "Admin only")
        rows = (
            await session.execute(
                select(Report).where(Report.resolved.is_(False)).order_by(Report.created_at.desc())
            )
        ).scalars().all()
    return [
        {
            "id": r.id,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "reporter_id": r.reporter_id,
            "reason": r.reason,
            "detail": r.detail,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


# ── OG preview helper (HTML stub for bots crawling /m/:slug) ─────────────────


@router.get("/og/{slug}")
async def og_stub(request: Request, slug: str):
    async with async_session() as session:
        row = (
            await session.execute(
                select(WordplayPost, User)
                .join(User, WordplayPost.user_id == User.id)
                .where(WordplayPost.slug == slug)
            )
        ).first()
    if not row:
        raise HTTPException(404, "Post not found")
    post, author = row
    base = str(request.base_url).rstrip("/")
    cover_url = f"{base}/api/community/{post.id}/cover" if post.cover_stored_path else ""
    audio_url = f"{base}/api/community/{post.id}/audio"
    front_origin = post.title  # placeholder; real origin set by env in production
    app_url = f"{base}/m/{post.slug}"
    title = _clean_text(post.title)
    desc = (_clean_text(post.description) or "A wordplay mix on Wordplay.")[:200]
    html = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>{title} — Wordplay</title>
<meta name="description" content="{desc}" />
<meta property="og:title" content="{title}" />
<meta property="og:description" content="by @{author.handle or 'wordplay'} · {desc}" />
<meta property="og:type" content="music.song" />
<meta property="og:url" content="{app_url}" />
{f'<meta property="og:image" content="{cover_url}" />' if cover_url else ''}
<meta property="og:audio" content="{audio_url}" />
<meta property="og:audio:type" content="audio/mpeg" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{title}" />
<meta name="twitter:description" content="{desc}" />
{f'<meta name="twitter:image" content="{cover_url}" />' if cover_url else ''}
<meta http-equiv="refresh" content="0; url={app_url}" />
</head><body>
<p>Redirecting to <a href="{app_url}">{front_origin}</a>…</p>
</body></html>"""
    from fastapi.responses import HTMLResponse
    return HTMLResponse(html)
