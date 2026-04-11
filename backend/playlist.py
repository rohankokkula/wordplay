"""
Playlist CRUD — upload, list, download, delete.

Files are stored under UPLOAD_ROOT/{user_id}/ on a Railway persistent volume.
Metadata (title, artist, BPM, cover) is extracted on upload via mutagen.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select, delete as sa_delete

from auth import get_current_user
from db import async_session
from models import PlaylistItem
from playlist_metadata import extract_audio_metadata
from storage import get_upload_root

router = APIRouter(prefix="/api/playlist", tags=["playlist"])

UPLOAD_ROOT = get_upload_root()
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB
MAX_ART_BYTES = 2_500_000  # cap embedded cover size


@router.get("")
async def list_items(user: dict = Depends(get_current_user)):
    async with async_session() as session:
        result = await session.execute(
            select(PlaylistItem)
            .where(PlaylistItem.user_id == user["sub"])
            .order_by(PlaylistItem.created_at.desc())
        )
        items = result.scalars().all()
    return [
        {
            "id": it.id,
            "filename": it.filename,
            "size_bytes": it.size_bytes,
            "duration_sec": it.duration_sec,
            "title": it.title,
            "artist": it.artist,
            "bpm": it.bpm,
            "has_art": bool(it.art_stored_path),
            "created_at": it.created_at.isoformat() if it.created_at else None,
        }
        for it in items
    ]


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    if not file.filename:
        raise HTTPException(400, "No file provided")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, f"File too large (max {MAX_FILE_SIZE // (1024 * 1024)} MB)")

    user_dir = UPLOAD_ROOT / "uploads" / user["sub"]
    user_dir.mkdir(parents=True, exist_ok=True)

    safe_name = file.filename.replace("/", "_").replace("\\", "_")
    stored_name = f"{uuid.uuid4().hex[:8]}_{safe_name}"
    dest = user_dir / stored_name
    dest.write_bytes(content)

    meta = extract_audio_metadata(dest)
    art_bytes = meta.get("art_bytes")
    if isinstance(art_bytes, bytes) and len(art_bytes) > MAX_ART_BYTES:
        art_bytes = None

    item = PlaylistItem(
        user_id=user["sub"],
        filename=safe_name,
        stored_path=str(dest.relative_to(UPLOAD_ROOT)),
        size_bytes=len(content),
        duration_sec=meta.get("duration_sec"),
        title=meta.get("title") or None,
        artist=meta.get("artist") or None,
        bpm=meta.get("bpm"),
    )

    async with async_session() as session:
        session.add(item)
        await session.commit()
        await session.refresh(item)

        if art_bytes:
            mime = meta.get("art_mime") or "image/jpeg"
            ext = ".png" if "png" in mime.lower() else ".jpg"
            cover_rel = f"uploads/{user['sub']}/covers/{item.id}{ext}"
            cover_full = UPLOAD_ROOT / cover_rel
            cover_full.parent.mkdir(parents=True, exist_ok=True)
            cover_full.write_bytes(art_bytes)
            item.art_stored_path = cover_rel
            await session.commit()
            await session.refresh(item)

    return {
        "id": item.id,
        "filename": item.filename,
        "size_bytes": item.size_bytes,
        "duration_sec": item.duration_sec,
        "title": item.title,
        "artist": item.artist,
        "bpm": item.bpm,
        "has_art": bool(item.art_stored_path),
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


@router.get("/{item_id}/file")
async def download_file(item_id: str, user: dict = Depends(get_current_user)):
    async with async_session() as session:
        result = await session.execute(
            select(PlaylistItem).where(
                PlaylistItem.id == item_id,
                PlaylistItem.user_id == user["sub"],
            )
        )
        item = result.scalar_one_or_none()

    if not item:
        raise HTTPException(404, "Item not found")

    full_path = UPLOAD_ROOT / item.stored_path
    if not full_path.is_file():
        raise HTTPException(404, "File missing from storage")

    suffix = full_path.suffix.lower()
    media_types = {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".webm": "audio/webm",
        ".opus": "audio/opus",
        ".flac": "audio/flac",
        ".aac": "audio/aac",
    }
    media = media_types.get(suffix, "application/octet-stream")

    return FileResponse(full_path, media_type=media, filename=item.filename)


@router.get("/{item_id}/art")
async def cover_art(item_id: str, user: dict = Depends(get_current_user)):
    """Embedded cover extracted at upload (JPEG/PNG stored as .jpg)."""
    async with async_session() as session:
        result = await session.execute(
            select(PlaylistItem).where(
                PlaylistItem.id == item_id,
                PlaylistItem.user_id == user["sub"],
            )
        )
        item = result.scalar_one_or_none()

    if not item or not item.art_stored_path:
        raise HTTPException(404, "No cover")

    full_path = UPLOAD_ROOT / item.art_stored_path
    if not full_path.is_file():
        raise HTTPException(404, "Cover missing")

    mt = "image/png" if full_path.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(full_path, media_type=mt)


@router.delete("/{item_id}")
async def delete_item(item_id: str, user: dict = Depends(get_current_user)):
    async with async_session() as session:
        result = await session.execute(
            select(PlaylistItem).where(
                PlaylistItem.id == item_id,
                PlaylistItem.user_id == user["sub"],
            )
        )
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(404, "Item not found")

        full_path = UPLOAD_ROOT / item.stored_path
        if full_path.is_file():
            full_path.unlink(missing_ok=True)

        if item.art_stored_path:
            art_path = UPLOAD_ROOT / item.art_stored_path
            if art_path.is_file():
                art_path.unlink(missing_ok=True)

        await session.execute(sa_delete(PlaylistItem).where(PlaylistItem.id == item_id))
        await session.commit()

    return {"ok": True}
