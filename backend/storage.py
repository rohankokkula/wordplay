"""
Writable root for playlist + community file storage.

Railway: set UPLOAD_ROOT=/data (or your volume mount).
Local: defaults to backend/upload_data/ so /data permission is not required.
"""

import os
from pathlib import Path


def get_upload_root() -> Path:
    override = os.environ.get("UPLOAD_ROOT", "").strip()
    if override:
        return Path(override).resolve()
    return Path(__file__).resolve().parent / "upload_data"
