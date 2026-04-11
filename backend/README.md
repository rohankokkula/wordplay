# wordplay-backend

FastAPI service: auth, playlists, community wall, YouTube search/download, lyrics, and Whisper transcription.

## Stack

- **Auth:** Google ID-token verification (`google-auth`) + JWT (`pyjwt`). Invite-code gated.
- **DB:** PostgreSQL via SQLAlchemy 2 async + asyncpg. Tables auto-created on startup.
- **Storage:** Railway persistent volume for user uploads and community media.
- **Playlists:** On upload, **mutagen** reads duration, title, artist, BPM (common tags), and embedded cover art; stored in DB + cover file under `uploads/{user_id}/covers/`.
- **Search:** [yt-search-python](https://pypi.org/project/yt-search-python/) (`VideosSearch`) — no API key.
- **Download:** Innertube streams → yt-dlp fallback. Gated by `ALLOW_YOUTUBE_API`.
- **Lyrics:** LRCLib proxy + Whisper transcription.

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11+ | 3.12 recommended |
| pip | latest | `pip install --upgrade pip` |
| ffmpeg | recommended | For yt-dlp MP3 extraction |
| PostgreSQL | 14+ | Railway plugin or local |

## Quick Start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Health: `GET http://localhost:8000/health?quick=1`

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | — | Liveness + optional probes |
| `POST` | `/api/auth/google` | — | Google login + invite code → JWT |
| `GET` | `/api/auth/me` | Bearer | Current user info |
| `GET` | `/api/playlist` | Bearer | List user's playlist items |
| `POST` | `/api/playlist/upload` | Bearer | Upload audio to playlist |
| `GET` | `/api/playlist/{id}/file` | Bearer | Stream/download playlist file |
| `GET` | `/api/playlist/{id}/art` | Bearer | Cover image (if extracted at upload) |
| `DELETE` | `/api/playlist/{id}` | Bearer | Delete playlist item |
| `GET` | `/api/music/search?q=...` | — | YouTube search (gated) |
| `POST` | `/api/music/download` | — | YouTube audio download (gated) |
| `POST` | `/api/community/publish` | Bearer | Publish mix + cover to wall |
| `GET` | `/api/community/feed` | — | Public feed of published mixes |
| `GET` | `/api/community/{id}/audio` | — | Stream community audio |
| `GET` | `/api/community/{id}/cover` | — | Community cover image |
| `GET` | `/api/lyrics/search?q=...` | — | LRCLib search proxy |
| `GET` | `/api/lyrics/get?...` | — | LRCLib exact lookup |
| `POST` | `/api/lyrics/transcribe` | — | Whisper transcription |

## Environment

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes (prod) | PostgreSQL connection string (Railway injects this) |
| `JWT_SECRET` | Yes (prod) | Secret for signing JWTs |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth Web Client ID |
| `INVITE_CODE` | No | Defaults to `soberohan` |
| `UPLOAD_ROOT` | No | Volume mount path on Railway (default locally: `backend/upload_data/`) |
| `ALLOW_YOUTUBE_API` | No | `true` to enable YouTube routes (default `false`) |
| `MUSIC_CACHE_DIR` | No | Override music cache directory |

## Railway CLI

Install globally and link once:

```bash
npm i -g @railway/cli
railway login
railway link
```

Common operations:

```bash
railway variables                          # list all env vars
railway variables set JWT_SECRET=xxx       # set a variable
railway up                                 # deploy from local
railway logs                               # stream logs
railway volume ls                          # list volumes
```

## CORS

`allow_origins=["*"]` — tighten for production by setting `CORS_ORIGINS`.

## License

[MIT](../LICENSE)
