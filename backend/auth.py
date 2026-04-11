"""
Authentication: Google ID-token verification, JWT issue/decode, FastAPI dependency.
"""

import os
from datetime import datetime, timezone, timedelta

import jwt
from fastapi import Depends, HTTPException, Request
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import async_session
from models import User

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 72
INVITE_CODE = os.environ.get("INVITE_CODE", "soberohan")


class GoogleLoginRequest(BaseModel):
    id_token: str
    invite_code: str


class TokenResponse(BaseModel):
    access_token: str
    user: dict


def _create_jwt(user: User) -> str:
    payload = {
        "sub": user.id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "tier": user.tier,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_jwt(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


async def _get_db() -> AsyncSession:  # type: ignore[misc]
    async with async_session() as session:
        yield session


async def google_login(body: GoogleLoginRequest) -> TokenResponse:
    if body.invite_code.strip().lower() != INVITE_CODE.lower():
        raise HTTPException(403, "Invalid invite code")

    try:
        idinfo = google_id_token.verify_oauth2_token(
            body.id_token,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except Exception as e:
        raise HTTPException(401, f"Invalid Google token: {e}") from e

    google_sub = idinfo["sub"]
    email = idinfo.get("email", "")
    name = idinfo.get("name", "")
    picture = idinfo.get("picture", "")

    async with async_session() as session:
        result = await session.execute(select(User).where(User.google_sub == google_sub))
        user = result.scalar_one_or_none()
        if user is None:
            user = User(google_sub=google_sub, email=email, name=name, picture=picture, tier="premium")
            session.add(user)
        else:
            user.email = email
            user.name = name
            user.picture = picture
        await session.commit()
        await session.refresh(user)

    token = _create_jwt(user)
    return TokenResponse(
        access_token=token,
        user={"id": user.id, "email": user.email, "name": user.name, "picture": user.picture, "tier": user.tier},
    )


async def get_current_user(request: Request) -> dict:
    """FastAPI dependency — extracts and validates JWT from Authorization header."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")
    token = auth[7:]
    try:
        payload = _decode_jwt(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(401, f"Invalid token: {e}")
    return payload


async def get_optional_user(request: Request) -> dict | None:
    """Like get_current_user but returns None instead of 401 for anonymous."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        return _decode_jwt(auth[7:])
    except Exception:
        return None
