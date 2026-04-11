"""
Database engine + session factory.

Reads DATABASE_URL from environment (Railway injects this for Postgres plugins).
Falls back to a local SQLite file for development.
"""

import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

_raw_url = os.environ.get("DATABASE_URL", "").strip()

if _raw_url:
    if _raw_url.startswith("postgres://"):
        _raw_url = _raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif _raw_url.startswith("postgresql://"):
        _raw_url = _raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    DB_URL = _raw_url
else:
    DB_URL = "sqlite+aiosqlite:///./wordplay_dev.db"

engine = create_async_engine(DB_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def _migrate_playlist_columns():
    """Add playlist metadata columns on existing DBs (create_all does not alter)."""
    cols = [
        ("title", "VARCHAR(512)"),
        ("artist", "VARCHAR(512)"),
        ("bpm", "FLOAT"),
        ("art_stored_path", "TEXT"),
    ]
    url = str(engine.url)
    async with engine.begin() as conn:
        if "sqlite" in url:
            for name, typ in cols:
                try:
                    await conn.execute(text(f"ALTER TABLE playlist_items ADD COLUMN {name} {typ}"))
                except Exception:
                    pass
        else:
            for name, typ in cols:
                await conn.execute(
                    text(f"ALTER TABLE playlist_items ADD COLUMN IF NOT EXISTS {name} {typ}")
                )


async def init_db():
    """Create all tables (safe for MVP; swap for Alembic later)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _migrate_playlist_columns()
