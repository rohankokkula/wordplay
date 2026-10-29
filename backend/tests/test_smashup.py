"""Smashup router tests — models are stubbed so this runs without torch/whisper."""

from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import smashup
from smashup.keywords import fold, matches


@pytest.mark.parametrize("word", ["paisa", "Paisaa", "pesa", "पैसा", "PAISA!", "paysa"])
def test_paisa_variants_match(word):
    assert matches(word, ["paisa"]) is not None


@pytest.mark.parametrize("word", ["pass", "pa", "paani", "masala"])
def test_non_matches(word):
    assert matches(word, ["paisa"]) is None


def test_fold_devanagari_equals_latin():
    assert fold("पैसा") == fold("paisa") == fold("pesa")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MUSIC_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(smashup, "_has", lambda mod: False)  # no demucs / torchaudio

    def fake_transcribe(path, keywords, language):
        return (
            [
                {"w": "mera", "start": 1.0, "end": 1.3, "p": 0.9},
                {"w": "paisa,", "start": 1.3, "end": 1.8, "p": 0.8},
                {"w": "paisa-paisa", "start": 4.0, "end": 4.9, "p": 0.7},
                {"w": "hai", "start": 5.0, "end": 5.2, "p": 0.9},
            ],
            "hi",
        )

    monkeypatch.setattr(smashup, "transcribe_words", fake_transcribe)
    app = FastAPI()
    app.include_router(smashup.router)
    return TestClient(app)


def test_analyze_pipeline_and_cache(client):
    r = client.post(
        "/api/smashup/analyze",
        files={"file": ("song.mp3", b"\x00" * 5000, "audio/mpeg")},
        data={"keywords": "paisa,paise"},
    )
    assert r.status_code == 200, r.text
    job_id, digest = r.json()["job_id"], r.json()["hash"]
    for _ in range(50):
        j = client.get(f"/api/smashup/jobs/{job_id}").json()
        if j["status"] in ("done", "error"):
            break
        time.sleep(0.05)
    assert j["status"] == "done", j
    res = j["result"]
    assert res["stems"] is None
    assert [h["start"] for h in res["hits"]] == [1.3, 4.0]

    cached = client.get(f"/api/smashup/{digest}/words", params={"keywords": "paise,paisa"})
    assert cached.status_code == 200
    assert len(cached.json()["hits"]) == 2


def test_rejects_missing_keywords(client):
    r = client.post("/api/smashup/analyze", files={"file": ("a.mp3", b"\x00" * 5000)}, data={"keywords": " "})
    assert r.status_code == 400


def test_stem_path_validation(client):
    assert client.get("/api/smashup/../../etc/stems/vocals").status_code == 404
    assert client.get(f"/api/smashup/{'a' * 64}/stems/secret").status_code == 404
