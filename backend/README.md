# wordplay-backend

FastAPI service for YouTube search and audio download used by the Wordplay web app. **Search** uses [yt-search-python](https://pypi.org/project/yt-search-python/) (`VideosSearch`). **Download** uses the same library (`Video` + `StreamURLFetcher`) to resolve direct stream URLs, then downloads bytes with **httpx**; `yt-dlp` is still installed because `StreamURLFetcher` uses it internally for YouTube signature decipher only (this app does not call `YoutubeDL` for extraction). **ffmpeg** on the host is optional (no longer required for the default download path).

## Requirements

- Python 3.12+ (3.11 usually works)
- `ffmpeg` and `ffprobe` on `PATH` (or set `FFMPEG_LOCATION` to the directory containing them — see `music_fetch.py`)

## Install

From the `backend/` directory (this folder in the repo):

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Run locally

Optional: create `.env` in this directory (gitignored) with **`YT_DLP_COOKIES_B64`** = base64 of your Netscape `cookies.txt` (one line, no quotes):

```bash
base64 -i cookies.txt | tr -d '\n'   # paste output into .env as YT_DLP_COOKIES_B64=...
```

Or set **`YT_DLP_COOKIES_FILE`** to an absolute path to `cookies.txt`. `main.py` loads `.env` via `python-dotenv`.

```bash
uvicorn main:app --reload --port 8000
```

- Health: `GET http://localhost:8000/health`
- API base: `http://localhost:8000`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness (`{"status":"ok"}`) |
| `GET` | `/api/music/search` | Query params: `q` (search string), `limit` (1–15). Returns `{ "results": [...] }`. |
| `POST` | `/api/music/download` | JSON body: `{ "url": "<YouTube watch URL>" }`. Returns the audio file. |

Search requires at least 2 characters in `q`. Only YouTube watch URLs are accepted for download (enforced for SSRF safety).

## CORS

Cross-origin requests are allowed from any origin (`*`). Tighten `allow_origins` in `main.py` for production if the API is public.

## Cache

Downloaded files are stored under `music_cache/` next to the app (created automatically). Safe to delete when the server is stopped; it is listed in `.gitignore` and should not be committed.

## TLS / corporate proxies

If HTTPS fails with certificate errors, prefer pointing Python at your CA bundle:

```bash
export SSL_CERT_FILE=/path/to/ca-bundle.pem
```

**Development only:** `SOBEROHAN_INSECURE_SSL=1` disables verification if you add that hook. Do not use in production.

## Deploy notes

- Bind **all interfaces** and the platform **`PORT`**, e.g. `uvicorn main:app --host 0.0.0.0 --port $PORT`. Do not use `--reload` in production.
- **YouTube bot checks** on cloud IPs: use a Netscape `cookies.txt` from a signed-in browser (see yt-dlp wiki). Either **`YT_DLP_COOKIES_FILE`** or **`YT_DLP_COOKIES_B64`** (base64 of the whole file).
- Long YouTube downloads may exceed serverless timeouts — use a VM or web service with a generous request limit.
