# wordplay-backend

FastAPI service powering Wordplay's YouTube search, audio download, lyrics proxy, and Whisper transcription.

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11+ | 3.12 recommended |
| ffmpeg | any | Strongly recommended for MP3 transcoding |
| pip | latest | `pip install --upgrade pip` |

## Quick Start

From the `backend/` directory (this folder in the repo):

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # edit to add YouTube cookies if needed
uvicorn main:app --reload --port 8000
```

Health check: `GET http://localhost:8000/health`

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness + YouTube cookie/yt-dlp diagnostics |
| `GET` | `/api/music/search?q=...&limit=8` | YouTube search (returns `{ results: [...] }`) |
| `POST` | `/api/music/download` | Download audio from YouTube URL (`{ url }`) |
| `POST` | `/api/genre/instrumental` | Download and cache a genre instrumental track |
| `GET` | `/api/genre/instrumental/:id` | Check if a genre instrumental is cached |
| `GET` | `/api/genre/instrumental/:id/audio` | Serve a cached genre instrumental |
| `GET` | `/api/lyrics/search?q=...` | Proxy to LRCLib synced-lyrics search |
| `GET` | `/api/lyrics/get?track_name=...&artist_name=...` | Proxy to LRCLib exact lookup |
| `POST` | `/api/lyrics/transcribe` | Whisper transcription of uploaded audio |

## Environment Variables

See [`.env.example`](.env.example) for the full list. All are optional.

| Variable | Description |
|---|---|
| `YT_DLP_COOKIES_FILE` | Absolute path to Netscape `cookies.txt` |
| `YT_DLP_COOKIES_B64` | Base64 of cookies file (cloud-friendly, one line) |
| `YT_DLP_COOKIES_FROM_BROWSER` | Browser name for local dev (`chrome`, `firefox`, etc.) |
| `YT_DLP_YOUTUBE_PLAYER_CLIENTS` | Comma-separated yt-dlp player clients override |
| `FFMPEG_LOCATION` | Directory containing `ffmpeg` + `ffprobe` |
| `SSL_CERT_FILE` | Path to CA bundle for corporate proxy environments |
| `SOBEROHAN_INSECURE_SSL` | `1` to disable TLS verification (dev only) |

## YouTube Cookie Authentication

Cloud servers frequently get blocked by YouTube bot checks. To fix this:

1. Install a Netscape cookie exporter in your browser
2. Export cookies from `youtube.com` while logged in
3. Choose one method:

```bash
# Option A: file path
YT_DLP_COOKIES_FILE=/path/to/cookies.txt

# Option B: base64 (cloud-friendly)
cd backend && base64 -i cookies.txt | tr -d '\n'
# paste the output into .env as YT_DLP_COOKIES_B64=...

# Option C: local browser (dev only)
YT_DLP_COOKIES_FROM_BROWSER=chrome
```

`GET /health` returns `youtube_cookies: true/false` so you can verify.

## CORS

All origins are allowed (`*`) in development. Tighten `allow_origins` in `main.py` before exposing to the public internet.

## Cache

Downloaded audio is stored in `music_cache/` (auto-created, gitignored). Safe to delete when the server is stopped.

## Production Deployment (Railway)

1. Set **Root Directory** to `backend` in Railway
2. Railway auto-detects Python and installs `requirements.txt`
3. Set the **Start Command**:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

4. Add environment variables (see `.env.example`)

Do **not** use `--reload` in production. Ensure `ffmpeg` is available in the runtime environment (Railway's Python buildpack includes it by default).

## License

[MIT](../LICENSE)
