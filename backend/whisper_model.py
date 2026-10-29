"""Shared lazy faster-whisper loader (used by `/api/lyrics/transcribe` and Smashup).

The model size comes from `WHISPER_MODEL` (default `base`). Smashup asks for a
larger model via `WHISPER_MODEL_SMASHUP` (default `small`) because word-level
accuracy on Hindi/Urdu/Punjabi hooks drops sharply with `base`.
"""

from __future__ import annotations

import logging
import os
import threading

from fastapi import HTTPException

logger = logging.getLogger("wordplay")

_models: dict[str, object] = {}
_lock = threading.Lock()


def default_model_size() -> str:
    return os.environ.get("WHISPER_MODEL", "base")


def get_whisper_model(size: str | None = None):
    size = size or default_model_size()
    with _lock:
        if size in _models:
            return _models[size]
        try:
            from faster_whisper import WhisperModel
        except ImportError as e:
            raise HTTPException(501, "faster-whisper not installed — run: pip install faster-whisper") from e
        try:
            logger.info("Loading faster-whisper model '%s' …", size)
            model = WhisperModel(size, device="cpu", compute_type="int8")
        except Exception as e:  # pragma: no cover - depends on network / disk
            raise HTTPException(502, f"Failed to load Whisper model: {e}") from e
        _models[size] = model
        logger.info("Whisper model '%s' loaded.", size)
        return model
