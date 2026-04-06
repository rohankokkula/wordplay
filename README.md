<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/wordplay-logo-source.svg" />
    <source media="(prefers-color-scheme: light)" srcset="public/wordplay-logo-source.svg" />
    <img src="public/wordplay-logo-source.svg" alt="Wordplay" width="360" />
  </picture>
</p>

<h3 align="center">
  The AI-powered DJ that mixes by meaning, not just BPM.
</h3>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#the-story">The Story</a> ·
  <a href="#demo">Demo</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#deployment">Deployment</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/vite-8-646CFF?logo=vite&logoColor=white" alt="Vite 8" />
  <img src="https://img.shields.io/badge/fastapi-0.135-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

---

## The Story

Most DJ software crossfades on tempo. Drop one track, bring in the next, hope the vibe carries.

**Wordplay** goes further. It fetches time-synced lyrics for both tracks, scans them for shared words and phrases, then triggers the crossfade at the exact moment both songs say the same thing — a *wordplay hook*. The drop hits harder because the transition has meaning.

Load two tracks. Pick a genre style. Hit **start**. Wordplay handles beat analysis, BPM detection, vocal segmentation, lyric fetching (LRCLib + Whisper fallback), common-phrase detection, and a multi-phase automix that blends on the beat grid while surfacing the shared lyric on a Butterchurn visualizer.

Two decks, crossfades, and YouTube search — entirely in your browser.

---

## Features

| Category | What it does |
|---|---|
| **Dual Deck Engine** | Two independent Web Audio decks with real-time playback, seeking, and per-deck volume trims. |
| **Beat Analysis** | Client-side onset detection, BPM estimation, beat-grid alignment, drop detection, and vocal segmentation — all in a Web Worker so the UI never blocks. |
| **Lyric-Aware Transitions** | Fetches synced lyrics from [LRCLib](https://lrclib.net). Falls back to on-device [Whisper](https://github.com/SYSTRAN/faster-whisper) transcription when no lyrics exist. Finds common phrases between tracks and schedules the crossfade at the wordplay hook. |
| **Genre Styles** | Presets (neutral, hip-hop, EDM, lo-fi, drum & bass, reggaeton, house, techno, ...) shape beat layers, transition curves, and FX character. |
| **Visualizer** | Butterchurn (Milkdrop) reactive visualizer with live lyric overlay and wordplay phrase callout. |
| **YouTube Search & Download** | Search YouTube from the deck, download audio server-side via yt-dlp, and load it straight into the player. |
| **Configurable Crossfade** | 8, 16, 32, 64, or 128-beat blend lengths with real-time duration preview based on both tracks' BPM. |
| **DJ SFX** | Air horn, siren, vinyl brake, snare roll, turntable wind-down — triggered automatically during transitions or manually. |
| **Responsive Layout** | Three-column desktop layout collapses to a single column on mobile with status log below the player. |

---

## Demo

> **Live demo coming soon.** In the meantime, clone and run locally (takes about 60 seconds).

---

## Quick Start

### Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node.js** | 18+ | Frontend dev server and build |
| **Python** | 3.11+ | Backend API server |
| **ffmpeg** | any | Audio transcoding (yt-dlp post-processing) |

```bash
# macOS (Homebrew)
brew install node python ffmpeg

# Ubuntu / Debian
sudo apt install nodejs npm python3 python3-venv ffmpeg
```

### 1. Clone

```bash
git clone https://github.com/rohankokkula/wordplay-render.git
cd wordplay-render
```

### 2. Frontend

```bash
npm install
npm run dev          # → http://localhost:5173
```

### 3. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # edit if you need YouTube cookies
uvicorn main:app --reload --port 8000
```

The Vite dev server proxies `/api` requests to `localhost:8000` automatically.

Open **http://localhost:5173**, load two tracks, and hit **start**.

---

## Architecture

```
wordplay-render/
├── src/                        # React + TypeScript frontend
│   ├── main.tsx                # Entry point (BrowserRouter)
│   ├── App.tsx                 # Main DJ deck UI and automix wiring
│   ├── analysis/               # Client-side beat/BPM analysis (Web Worker)
│   ├── audio/                  # Web Audio mixer, deck player, effects, DJ SFX
│   ├── automix/                # Automix state machine and transition planner
│   ├── components/             # React components (visualizer, timeline, search, ...)
│   ├── genre/                  # Genre preset definitions
│   ├── hooks/                  # Custom React hooks
│   └── lyrics/                 # LRCLib client, Whisper integration, phrase matching
├── backend/                    # FastAPI + yt-dlp + faster-whisper
│   ├── main.py                 # API routes (search, download, lyrics, transcribe)
│   ├── music_fetch.py          # YouTube search/download, cookie handling
│   └── ssl_compat.py           # TLS helpers for corporate proxies
├── public/                     # Static assets (favicon, logo SVGs)
├── vite.config.ts              # Vite config with API proxy
└── package.json
```

### How the mix works

```
 ┌──────────┐     ┌──────────────┐     ┌────────────────┐
 │ Load MP3 │ ──► │ Beat Analysis│ ──► │ Fetch Lyrics   │
 │ (Deck A) │     │ (Web Worker) │     │ (LRCLib/Whisper)│
 └──────────┘     └──────────────┘     └────────┬───────┘
                                                 │
 ┌──────────┐     ┌──────────────┐               │
 │ Load MP3 │ ──► │ Beat Analysis│ ──►───────────┤
 │ (Deck B) │     │ (Web Worker) │               │
 └──────────┘     └──────────────┘               ▼
                                        ┌────────────────┐
                                        │ Find Common    │
                                        │ Phrases        │
                                        └────────┬───────┘
                                                 │
                                                 ▼
                                        ┌────────────────┐
                                        │ Automix Engine │
                                        │ (schedule blend│
                                        │  at wordplay   │
                                        │  hook point)   │
                                        └────────┬───────┘
                                                 │
                                                 ▼
                                        ┌────────────────┐
                                        │ Web Audio API  │
                                        │ Crossfade +    │
                                        │ Effects + SFX  │
                                        └────────────────┘
```

---

## Configuration

### Frontend

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE` | *(empty — uses Vite proxy)* | Backend origin for production, e.g. `https://wordplay-backend.up.railway.app` |

### Backend

See [`backend/.env.example`](backend/.env.example) for all options. Key variables:

| Variable | Description |
|---|---|
| `YT_DLP_COOKIES_FILE` | Path to Netscape `cookies.txt` for YouTube authentication |
| `YT_DLP_COOKIES_B64` | Base64 of `cookies.txt` (one line, no quotes — cloud-friendly) |
| `YT_DLP_COOKIES_FROM_BROWSER` | Browser name (`chrome`, `firefox`, etc.) for local dev |
| `FFMPEG_LOCATION` | Directory containing `ffmpeg` + `ffprobe` (auto-detected if on PATH) |
| `SOBEROHAN_INSECURE_SSL` | `1` to skip TLS verification (dev only, never in production) |

---

## Deployment

### Backend — Railway (recommended)

1. Create a new project on [Railway](https://railway.app)
2. Connect the GitHub repo and set the **Root Directory** to `backend`
3. Set the **Start Command**:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

4. Add environment variables (see [backend/.env.example](backend/.env.example)) — especially `YT_DLP_COOKIES_B64` for YouTube auth on cloud IPs
5. Railway auto-detects Python and installs `requirements.txt`

### Frontend — Vercel / Netlify / any static host

```bash
npm run build   # outputs to dist/
```

Set `VITE_API_BASE` to your deployed backend URL at build time, e.g. `https://wordplay-backend.up.railway.app`.

### YouTube cookies on cloud

Cloud IPs are frequently challenged by YouTube. Export Netscape cookies from a logged-in browser session and set `YT_DLP_COOKIES_B64` as a Railway environment variable. Check `GET /health` — it reports `youtube_cookies: true/false` so you can confirm.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite 8 |
| **Audio** | Web Audio API, AnalyserNode, AudioWorklet |
| **Visualizer** | Butterchurn (Milkdrop WebGL) |
| **Backend** | FastAPI, Python 3.12 |
| **YouTube** | yt-dlp |
| **Transcription** | faster-whisper (CTranslate2) |
| **Lyrics** | LRCLib API |
| **Deployment** | Railway (backend), any static host (frontend) |

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

[MIT](LICENSE) — Rohan Kokkula

---

## Disclaimer

Wordplay is a personal/educational project. Audio downloaded via YouTube is subject to YouTube's Terms of Service. You are responsible for ensuring you have the right to use any content you access through this tool.

---

<p align="center">
  Built with beats and bytes by <a href="https://github.com/rohankokkula">@rohankokkula</a>
</p>
