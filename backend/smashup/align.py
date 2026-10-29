"""Precision pass: snap keyword hits to the syllable with MMS forced alignment.

Whisper word timestamps drift 50–200 ms on sung vocals. For each keyword hit we
cut a short window of the *vocal stem*, align the transcript `* <word> *` with
torchaudio's multilingual MMS_FA aligner (the star token absorbs surrounding
audio) and keep the refined span when it is plausible.

Everything is optional: if torchaudio's pipeline or weights are unavailable we
return the hits unchanged and mark `source="asr"`.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

from .keywords import latin_letters

logger = logging.getLogger("wordplay")

_bundle: Any = None
_model: Any = None
_lock = threading.Lock()
WINDOW_PAD_SEC = 0.6


def _load():
    global _bundle, _model
    with _lock:
        if _model is not None:
            return _bundle, _model
        import torchaudio  # noqa: F401 - deferred heavy import

        bundle = torchaudio.pipelines.MMS_FA
        model = bundle.get_model(with_star=True)
        model.eval()
        _bundle, _model = bundle, model
        return bundle, model


def refine_hits(vocals_path: Path, hits: list[dict]) -> list[dict]:
    if not hits:
        return hits
    try:
        import torch
        import torchaudio

        bundle, model = _load()
        wav, sr = torchaudio.load(str(vocals_path))
        wav = wav.mean(0, keepdim=True)
        if sr != bundle.sample_rate:
            wav = torchaudio.functional.resample(wav, sr, bundle.sample_rate)
            sr = bundle.sample_rate
        tokenizer = bundle.get_tokenizer()
        aligner = bundle.get_aligner()
    except Exception as e:  # pragma: no cover - environment dependent
        logger.warning("MMS alignment unavailable (%s); keeping ASR timings", e)
        return hits

    out: list[dict] = []
    for h in hits:
        word = latin_letters(h.get("alias") or h["w"])
        if not word:
            out.append(h)
            continue
        s0 = max(0.0, h["start"] - WINDOW_PAD_SEC)
        s1 = h["end"] + WINDOW_PAD_SEC
        seg = wav[:, int(s0 * sr): int(s1 * sr)]
        if seg.shape[1] < sr * 0.2:
            out.append(h)
            continue
        try:
            with torch.inference_mode():
                emission, _ = model(seg)
            spans = aligner(emission[0], tokenizer(["*", word, "*"]))
            word_spans = spans[1]
            ratio = seg.shape[1] / emission.shape[1] / sr
            start = s0 + word_spans[0].start * ratio
            end = s0 + word_spans[-1].end * ratio
            # Reject wild jumps: the aligner must stay near Whisper's guess.
            if abs(start - h["start"]) < 0.45 and end > start:
                out.append({**h, "start": round(start, 3), "end": round(end, 3), "source": "aligned"})
                continue
        except Exception as e:  # pragma: no cover
            logger.debug("align failed for %s: %s", word, e)
        out.append(h)
    return out
