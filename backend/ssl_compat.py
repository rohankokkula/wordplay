"""
TLS / HTTPS helpers for environments with custom CAs (corporate proxies, MITM appliances).

Preferred fix (secure):
  export SSL_CERT_FILE=/path/to/your/corporate-root-bundle.pem
  # or: REQUESTS_CA_BUNDLE=...

macOS python.org builds: run "Install Certificates.command" in the Python folder.

Last resort (insecure — dev only):
  export SOBEROHAN_INSECURE_SSL=1
"""

from __future__ import annotations

import os
import ssl
import warnings

_ENV_FLAG = "SOBEROHAN_INSECURE_SSL"

_https_patched = False


def insecure_ssl_enabled() -> bool:
    return os.environ.get(_ENV_FLAG, "").strip().lower() in ("1", "true", "yes", "on")


def apply_insecure_ssl_if_configured() -> None:
    """
    Patches the default urllib HTTPS context so stdlib HTTPS (e.g. Whisper model download)
    skips verification when SOBEROHAN_INSECURE_SSL is set.
    """
    global _https_patched
    if not insecure_ssl_enabled() or _https_patched:
        return
    _https_patched = True
    warnings.warn(
        f"{_ENV_FLAG}=1: HTTPS certificate verification is disabled. "
        "Do not use in production or on untrusted networks.",
        UserWarning,
        stacklevel=2,
    )
    ssl._create_default_https_context = ssl._create_unverified_context  # noqa: S323


def yt_dlp_tls_opts() -> dict:
    """Merge into yt_dlp.YoutubeDL constructor params."""
    if insecure_ssl_enabled():
        return {"nocheckcertificate": True}
    return {}
