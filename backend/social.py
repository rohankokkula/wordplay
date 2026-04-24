"""Social graph — follows, profiles, notifications."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import delete, func, select, update

from db import async_session
from models import Follow, Notification, User, WordplayPost
from wordplay_auth import get_current_user, get_optional_user

router = APIRouter(prefix="/api/social", tags=["social"])


async def _profile_payload(target: User, viewer_id: str | None) -> dict[str, Any]:
    follows_back = False
    if viewer_id and viewer_id != target.id:
        async with async_session() as session:
            follows = (
                await session.execute(
                    select(Follow.id).where(
                        Follow.follower_id == viewer_id, Follow.followee_id == target.id
                    )
                )
            ).scalar_one_or_none()
            follows_back = follows is not None
    return {
        "id": target.id,
        "handle": target.handle,
        "name": target.name,
        "picture": target.picture,
        "bio": target.bio,
        "followers_count": target.followers_count,
        "following_count": target.following_count,
        "plays_total": target.plays_total,
        "following_by_me": follows_back,
        "is_me": viewer_id == target.id,
    }


@router.post("/follow/{user_id}")
async def follow(user_id: str, user: dict = Depends(get_current_user)):
    if user_id == user["sub"]:
        raise HTTPException(400, "Cannot follow yourself")
    async with async_session() as session:
        target = (
            await session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if not target:
            raise HTTPException(404, "User not found")
        existing = (
            await session.execute(
                select(Follow).where(
                    Follow.follower_id == user["sub"], Follow.followee_id == user_id
                )
            )
        ).scalar_one_or_none()
        if existing:
            return {"following": True, "followers_count": target.followers_count}
        session.add(Follow(follower_id=user["sub"], followee_id=user_id))
        target.followers_count = (target.followers_count or 0) + 1
        me = (
            await session.execute(select(User).where(User.id == user["sub"]))
        ).scalar_one_or_none()
        if me:
            me.following_count = (me.following_count or 0) + 1
        session.add(
            Notification(user_id=user_id, actor_id=user["sub"], type="follow")
        )
        await session.commit()
        return {"following": True, "followers_count": target.followers_count}


@router.delete("/follow/{user_id}")
async def unfollow(user_id: str, user: dict = Depends(get_current_user)):
    async with async_session() as session:
        target = (
            await session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if not target:
            raise HTTPException(404, "User not found")
        res = await session.execute(
            delete(Follow).where(
                Follow.follower_id == user["sub"], Follow.followee_id == user_id
            )
        )
        if res.rowcount:
            target.followers_count = max(0, (target.followers_count or 1) - 1)
            me = (
                await session.execute(select(User).where(User.id == user["sub"]))
            ).scalar_one_or_none()
            if me:
                me.following_count = max(0, (me.following_count or 1) - 1)
        await session.commit()
        return {"following": False, "followers_count": target.followers_count}


@router.get("/profile/{handle}")
async def profile(
    handle: str,
    tab: str = Query("mixes"),
    user: dict | None = Depends(get_optional_user),
):
    viewer_id = user["sub"] if user else None
    async with async_session() as session:
        target = (
            await session.execute(select(User).where(User.handle == handle))
        ).scalar_one_or_none()
        if not target:
            raise HTTPException(404, "User not found")

        base = (
            select(WordplayPost)
            .where(
                WordplayPost.user_id == target.id,
                WordplayPost.visibility == "public",
                WordplayPost.is_deleted.is_(False),
            )
            .order_by(WordplayPost.created_at.desc())
        )
        if tab == "remixes":
            base = base.where(WordplayPost.remix_of_id.isnot(None))
        posts = (await session.execute(base.limit(50))).scalars().all()

    return {
        "user": await _profile_payload(target, viewer_id),
        "posts": [
            {
                "id": p.id,
                "slug": p.slug,
                "title": p.title,
                "has_cover": bool(p.cover_stored_path),
                "likes_count": p.likes_count,
                "plays_count": p.plays_count,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in posts
        ],
    }


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    async with async_session() as session:
        target = (
            await session.execute(select(User).where(User.id == user["sub"]))
        ).scalar_one_or_none()
        if not target:
            raise HTTPException(404, "User not found")
    return await _profile_payload(target, user["sub"])


@router.patch("/me")
async def update_me(
    payload: dict = Body(...),
    user: dict = Depends(get_current_user),
):
    async with async_session() as session:
        target = (
            await session.execute(select(User).where(User.id == user["sub"]))
        ).scalar_one_or_none()
        if not target:
            raise HTTPException(404, "User not found")
        if "bio" in payload:
            target.bio = str(payload["bio"])[:280]
        if "handle" in payload:
            desired = str(payload["handle"]).lower().strip()
            if not desired.isalnum() or len(desired) < 3 or len(desired) > 32:
                raise HTTPException(400, "Handle must be 3-32 alphanumeric chars")
            collision = (
                await session.execute(
                    select(User).where(User.handle == desired, User.id != user["sub"])
                )
            ).scalar_one_or_none()
            if collision:
                raise HTTPException(409, "Handle already taken")
            target.handle = desired
        await session.commit()
        return await _profile_payload(target, user["sub"])


@router.get("/notifications")
async def notifications(
    unread: bool = False,
    cursor: str | None = None,
    limit: int = 20,
    user: dict = Depends(get_current_user),
):
    async with async_session() as session:
        q = (
            select(Notification, User)
            .join(User, Notification.actor_id == User.id)
            .where(Notification.user_id == user["sub"])
            .order_by(Notification.created_at.desc())
        )
        if unread:
            q = q.where(Notification.read_at.is_(None))
        if cursor:
            try:
                q = q.offset(int(cursor))
            except ValueError:
                pass
        rows = (await session.execute(q.limit(limit))).all()

        unread_count = (
            await session.execute(
                select(func.count(Notification.id)).where(
                    Notification.user_id == user["sub"],
                    Notification.read_at.is_(None),
                )
            )
        ).scalar_one()

    items = [
        {
            "id": n.id,
            "type": n.type,
            "post_id": n.post_id,
            "read": n.read_at is not None,
            "created_at": n.created_at.isoformat() if n.created_at else None,
            "actor": {
                "id": a.id,
                "handle": a.handle,
                "name": a.name,
                "picture": a.picture,
            },
        }
        for n, a in rows
    ]
    next_cursor = str(int(cursor or 0) + limit) if len(items) == limit else None
    return {"items": items, "unread_count": int(unread_count), "next_cursor": next_cursor}


@router.post("/notifications/read")
async def mark_read(
    payload: dict = Body(default_factory=dict),
    user: dict = Depends(get_current_user),
):
    ids = payload.get("ids")
    async with async_session() as session:
        stmt = update(Notification).where(
            Notification.user_id == user["sub"],
            Notification.read_at.is_(None),
        )
        if ids:
            stmt = stmt.where(Notification.id.in_(list(ids)[:50]))
        await session.execute(stmt.values(read_at=datetime.now(timezone.utc)))
        await session.commit()
    return {"ok": True}
