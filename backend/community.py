"""
Community Wordplay wall — publish, feed, stream audio/cover.
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from wordplay_auth import get_current_user, get_optional_user
from db import async_session
from models import WordplayPost, User
from storage import get_upload_root

router = APIRouter(prefix="/api/community", tags=["community"])

UPLOAD_ROOT = get_upload_root()
MAX_AUDIO_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_COVER_SIZE = 2 * 1024 * 1024   # 2 MB


@router.post("/publish")
async def publish(
    title: str = Form(..., max_length=512),
    description: str = Form("", max_length=2000),
    audio: UploadFile = File(...),
    cover: UploadFile = File(None),
    user: dict = Depends(get_current_user),
):
    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_SIZE:
        raise HTTPException(413, f"Audio too large (max {MAX_AUDIO_SIZE // (1024*1024)} MB)")

    community_dir = UPLOAD_ROOT / "community" / user["sub"]
    community_dir.mkdir(parents=True, exist_ok=True)

    post_id = str(uuid.uuid4())
    audio_ext = Path(audio.filename or "mix.webm").suffix or ".webm"
    audio_name = f"{post_id}{audio_ext}"
    audio_path = community_dir / audio_name
    audio_path.write_bytes(audio_bytes)

    cover_rel = ""
    if cover and cover.filename:
        cover_bytes = await cover.read()
        if len(cover_bytes) > MAX_COVER_SIZE:
            raise HTTPException(413, f"Cover image too large (max {MAX_COVER_SIZE // (1024*1024)} MB)")
        cover_ext = Path(cover.filename).suffix or ".jpg"
        cover_name = f"{post_id}_cover{cover_ext}"
        cover_path = community_dir / cover_name
        cover_path.write_bytes(cover_bytes)
        cover_rel = str(cover_path.relative_to(UPLOAD_ROOT))

    post = WordplayPost(
        id=post_id,
        user_id=user["sub"],
        title=title,
        description=description,
        audio_stored_path=str(audio_path.relative_to(UPLOAD_ROOT)),
        cover_stored_path=cover_rel,
    )

    async with async_session() as session:
        session.add(post)
        await session.commit()
        await session.refresh(post)

    return {"id": post.id, "title": post.title}


@router.get("/feed")
async def feed(
    limit: int = 20,
    offset: int = 0,
    user: dict | None = Depends(get_optional_user),
):
    async with async_session() as session:
        result = await session.execute(
            select(WordplayPost, User.name, User.picture)
            .join(User, WordplayPost.user_id == User.id)
            .order_by(WordplayPost.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        rows = result.all()

    return [
        {
            "id": post.id,
            "title": post.title,
            "description": post.description,
            "has_cover": bool(post.cover_stored_path),
            "author_name": author_name or "Anonymous",
            "author_picture": author_picture or "",
            "created_at": post.created_at.isoformat() if post.created_at else None,
        }
        for post, author_name, author_picture in rows
    ]


@router.get("/{post_id}/audio")
async def stream_audio(post_id: str):
    async with async_session() as session:
        result = await session.execute(
            select(WordplayPost).where(WordplayPost.id == post_id)
        )
        post = result.scalar_one_or_none()

    if not post:
        raise HTTPException(404, "Post not found")

    full_path = UPLOAD_ROOT / post.audio_stored_path
    if not full_path.is_file():
        raise HTTPException(404, "Audio file missing")

    suffix = full_path.suffix.lower()
    media_types = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
                   ".ogg": "audio/ogg", ".webm": "audio/webm", ".opus": "audio/opus"}
    media = media_types.get(suffix, "audio/webm")
    return FileResponse(full_path, media_type=media)


@router.get("/{post_id}/cover")
async def get_cover(post_id: str):
    async with async_session() as session:
        result = await session.execute(
            select(WordplayPost).where(WordplayPost.id == post_id)
        )
        post = result.scalar_one_or_none()

    if not post or not post.cover_stored_path:
        raise HTTPException(404, "Cover not found")

    full_path = UPLOAD_ROOT / post.cover_stored_path
    if not full_path.is_file():
        raise HTTPException(404, "Cover file missing")

    suffix = full_path.suffix.lower()
    media_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                   ".webp": "image/webp", ".gif": "image/gif"}
    media = media_types.get(suffix, "image/jpeg")
    return FileResponse(full_path, media_type=media)
