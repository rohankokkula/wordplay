"""
Read duration, title, artist, BPM, and embedded cover art from audio files (mutagen).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from mutagen import File as MutagenFile
from mutagen.flac import FLAC
from mutagen.id3 import APIC, ID3
from mutagen.mp4 import MP4, MP4Cover


def extract_audio_metadata(path: Path) -> dict[str, Any]:
    """
    Returns keys: duration_sec, title, artist, bpm, art_bytes, art_mime.
    art_bytes may be large; caller should persist to disk and clear from memory.
    """
    out: dict[str, Any] = {
        "duration_sec": None,
        "title": None,
        "artist": None,
        "bpm": None,
        "art_bytes": None,
        "art_mime": "image/jpeg",
    }
    path = Path(path)
    if not path.is_file():
        return out

    try:
        audio = MutagenFile(path)
    except Exception:
        return out

    if audio is None:
        return out

    try:
        if audio.info is not None and getattr(audio.info, "length", None):
            out["duration_sec"] = float(audio.info.length)
    except Exception:
        pass

    tags = getattr(audio, "tags", None)

    # ── MP3 ID3 ──────────────────────────────────────────────────────
    if tags is not None:
        try:
            if "TIT2" in tags:
                out["title"] = str(tags["TIT2"].text[0]).strip() or out["title"]
            if "TPE1" in tags:
                out["artist"] = str(tags["TPE1"].text[0]).strip() or out["artist"]
            if "TBPM" in tags:
                raw = tags["TBPM"].text[0]
                out["bpm"] = _parse_bpm(raw)
        except Exception:
            pass

        # Embedded pictures (APIC)
        if out["art_bytes"] is None:
            try:
                for _k, frame in tags.items():
                    if isinstance(frame, APIC):
                        out["art_bytes"] = frame.data
                        out["art_mime"] = frame.mime or "image/jpeg"
                        break
            except Exception:
                pass

    # ── FLAC ─────────────────────────────────────────────────────────
    if isinstance(audio, FLAC):
        try:
            t = audio.get("title")
            if t:
                out["title"] = str(t[0]).strip() or out["title"]
            ar = audio.get("artist")
            if ar:
                out["artist"] = str(ar[0]).strip() or out["artist"]
            for bkey in ("bpm", "TBPM", "BPM"):
                b = audio.get(bkey)
                if b:
                    out["bpm"] = _parse_bpm(b[0]) or out["bpm"]
                    break
            if audio.pictures:
                p = audio.pictures[0]
                out["art_bytes"] = p.data
                out["art_mime"] = p.mime or "image/jpeg"
        except Exception:
            pass

    # ── MP4 / M4A ────────────────────────────────────────────────────
    if isinstance(audio, MP4) and tags is not None:
        try:
            if "\xa9nam" in tags:
                out["title"] = str(tags["\xa9nam"][0]).strip() or out["title"]
            if "\xa9ART" in tags:
                out["artist"] = str(tags["\xa9ART"][0]).strip() or out["artist"]
            # BPM: tmpo atom is an int
            if "tmpo" in tags and tags["tmpo"]:
                try:
                    out["bpm"] = float(tags["tmpo"][0])
                except (TypeError, ValueError):
                    pass
            if out["art_bytes"] is None and "covr" in tags:
                cov = tags["covr"][0]
                if isinstance(cov, MP4Cover):
                    out["art_bytes"] = bytes(cov)
                    fmt = getattr(cov, "imageformat", None)
                    if fmt == MP4Cover.FORMAT_PNG:
                        out["art_mime"] = "image/png"
                    else:
                        out["art_mime"] = "image/jpeg"
                elif isinstance(cov, (bytes, bytearray)):
                    out["art_bytes"] = bytes(cov)
                    out["art_mime"] = "image/jpeg"
        except Exception:
            pass

    # ── Ogg / Opus (Vorbis comments) ────────────────────────────────
    if tags is not None and hasattr(tags, "get") and callable(tags.get):
        try:
            # mutagen ogg uses list values
            def _get(k: str) -> str | None:
                v = tags.get(k)
                if v is None:
                    return None
                if isinstance(v, list) and v:
                    return str(v[0]).strip()
                return str(v).strip() if v else None

            if not out["title"]:
                out["title"] = _get("title") or _get("TITLE")
            if not out["artist"]:
                out["artist"] = _get("artist") or _get("ARTIST")
            if out["bpm"] is None:
                b = _get("bpm") or _get("BPM") or _get("TBPM")
                if b:
                    out["bpm"] = _parse_bpm(b)
        except Exception:
            pass

    # ── MP3: extra pass for APIC if File() missed frames ─────────────
    if out["art_bytes"] is None and path.suffix.lower() == ".mp3":
        try:
            id3 = ID3(path)
            for _k, frame in id3.items():
                if isinstance(frame, APIC):
                    out["art_bytes"] = frame.data
                    out["art_mime"] = frame.mime or "image/jpeg"
                    break
        except Exception:
            pass

    return out


def _parse_bpm(raw: Any) -> float | None:
    try:
        s = str(raw).strip().replace(",", ".")
        v = float(s)
        if 20 < v < 400:
            return round(v, 2)
    except (TypeError, ValueError):
        pass
    return None
