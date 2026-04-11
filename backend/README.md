# wordplay-backend

FastAPI service for YouTube search, audio download, LRCLib lyrics proxy, and Whisper transcription.

## Stack (production-friendly default)

- **Search:** [yt-search-python](https://pypi.org/project/yt-search-python/) (`VideosSearch`) — no API key, **no cookies**.
- **Download:** `Video` + `StreamURLFetcher` + **httpx**. `yt-dlp` is installed because `StreamURLFetcher` uses it **only** for signature / `n` decipher inside the library — **not** for cookie-based extraction.

You do **not** need `YT_DLP_COOKIES_*` for normal operation. Add cookies only if a specific host IP is still blocked by YouTube (advanced).

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11+ | 3.12 recommended |
| pip | latest | `pip install --upgrade pip` |

`ffmpeg` is optional for this API path (no FFmpeg extract step in the default download pipeline).

## Quick Start

From the `backend/` directory:

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Optional: create `.env` in this folder if you use tools that read `python-dotenv` (see `main.py`).

Health: `GET http://localhost:8000/health` → `{"status":"ok"}`

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/api/music/search?q=...&limit=8` | YouTube search → `{ results: [...] }` |
| `POST` | `/api/music/download` | JSON `{ "url": "<YouTube URL>" }` → audio file |
| `GET` | `/api/lyrics/search?q=...` | LRCLib search proxy |
| `GET` | `/api/lyrics/get?...` | LRCLib exact lookup |
| `POST` | `/api/lyrics/transcribe` | Whisper transcription |

## Environment (all optional)

| Variable | When to use |
|---|---|
| `SSL_CERT_FILE` | Corporate proxy / custom CA |
| `SOBEROHAN_INSECURE_SSL` | Dev only — never in production |

Advanced (only if YouTube blocks your server IP): Netscape `cookies.txt` via external tooling — not wired in this minimal `music_fetch`; use a dedicated yt-dlp deployment if you need cookie auth.

## CORS

`allow_origins=["*"]` in `main.py` — tighten for public production APIs.

## Cache

`music_cache/` — auto-created, gitignored.

## License

[MIT](../LICENSE)
