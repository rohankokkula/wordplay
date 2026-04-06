<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/wordplay-logo-animated.svg" />
    <source media="(prefers-color-scheme: light)" srcset="public/wordplay-logo-animated.svg" />
    <img src="public/wordplay-logo-animated.svg" alt="Wordplay" width="420" />
  </picture>
</p>

<h3 align="center">
  The AI-powered DJ that mixes by meaning, not just BPM.
</h3>

<p align="center">
  <a href="#the-story">Story</a> ·
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#deployment">Deployment</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/vite-8-646CFF?logo=vite&logoColor=white" alt="Vite 8" />
  <img src="https://img.shields.io/badge/Web_Audio_API-black?logo=googlechrome&logoColor=white" alt="Web Audio API" />
  <img src="https://img.shields.io/badge/fastapi-0.135-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/yt--dlp-2026-red?logo=youtube&logoColor=white" alt="yt-dlp" />
  <img src="https://img.shields.io/badge/whisper-base-blueviolet" alt="Whisper" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

---

## The Story

Most DJ software crossfades on tempo. Drop one track, bring in the next, hope the vibe carries.

**Wordplay** goes further. It fetches time-synced lyrics for both tracks, scans them for shared words and phrases, then triggers the crossfade at the exact moment both songs say the same thing — a *wordplay hook*. The drop hits harder because the transition has **meaning**.

Load two tracks. Pick a genre style. Hit **start**. Wordplay handles beat analysis, BPM detection, vocal segmentation, lyric fetching (LRCLib + Whisper fallback), common-phrase detection, and a multi-phase automix that blends on the beat grid while surfacing the shared lyric on a Butterchurn visualizer.

Two decks, crossfades, and YouTube search — entirely in your browser.

---

## Features

| Category | What it does |
|---|---|
| **Dual Deck Engine** | Two independent Web Audio decks with real-time playback, seeking, and per-deck volume trims |
| **Beat Analysis** | Client-side onset detection, BPM estimation, beat-grid alignment, drop detection, and vocal segmentation — all in a Web Worker |
| **Lyric-Aware Transitions** | Fetches synced lyrics from LRCLib; falls back to on-device Whisper transcription; finds common phrases and schedules the crossfade at the wordplay hook |
| **Genre Styles** | 10+ presets (neutral, hip-hop, EDM, lo-fi, D&B, reggaeton, house, techno, trance, afrobeat, bollytech) shape beat layers, transition curves, and FX character |
| **Visualizer** | Butterchurn (Milkdrop WebGL) reactive visualizer with 14 curated presets auto-cycling every 25 seconds |
| **YouTube Search & Download** | Search YouTube from the deck, download audio via yt-dlp, and load it straight into the player |
| **Configurable Crossfade** | 8, 16, 32, 64, or 128-beat blend lengths with real-time duration preview |
| **DJ SFX** | Air horn, siren, vinyl brake, snare roll, turntable wind-down — triggered automatically during transitions |
| **Responsive Layout** | Three-column desktop grid collapses to a single column on mobile |

---

## How It Works

This section documents the technical internals at research-paper depth. Wordplay's pipeline has five stages: **analysis**, **lyrics**, **matching**, **planning**, and **mixing**.

### Stage 1: Audio Analysis

When a track is loaded, its raw PCM (channel 0) is sent to a dedicated **Web Worker** via `postMessage` with a `Transferable` `ArrayBuffer` for zero-copy handoff. The worker runs the full analysis pipeline and posts the result back, keeping the UI thread unblocked. If `Worker` construction fails (e.g. restricted environments), the same analysis runs synchronously on the main thread as a fallback.

#### 1.1 Peak Waveform

The raw signal is divided into non-overlapping blocks of **512 samples**. Each output pixel is the **max |x|** in that block — a peak envelope used for waveform rendering.

#### 1.2 Onset Detection and BPM Estimation

Onset strength is computed via a simplified **spectral flux** approach:

1. **Frame:** 1024 samples, **hop:** 512 (50% overlap)
2. Per frame *i*: energy E_i = sum of x^2 over the frame
3. **Onset strength:** O_i = max(0, E_i - E_{i-1}) — the positive first derivative of frame energy
4. O is **max-normalized** to [0, 1]

**Tempo estimation** uses **lag-domain autocorrelation** over the onset function:

- For each lag L, compute the sum of O_i * O_{i+L}
- Search range: BPM 70–180, mapped to lag in frames via `framesPerSec = sampleRate / hopSize`
- A **Gaussian tempo prior** biases toward 125 BPM: `weight = 1 + 0.2 * exp(-((bpmAtLag - 125)^2) / 400)`
- The lag maximizing `correlation * weight` yields the BPM

The **beat grid** is a fixed-interval sequence starting at the first frame where onset strength exceeds 0.3, spaced by `60 / BPM` seconds.

#### 1.3 Energy Profile and Drop Detection

The signal is windowed into **0.5-second RMS windows**, max-normalized to [0, 1].

**Drop detection** finds the loudest sustained segment: a sliding window of length ~5% of the song scans from 15% onward, and the window with the highest cumulative normalized RMS marks the **drop time**.

#### 1.4 Vocal Segmentation

A lightweight vocal detector runs with **2048-sample frames** and **1024-sample hops**:

- For each frame, energy in the **300 Hz – 4 kHz** mid band is computed as a ratio of total energy (**midRatio**)
- **Spectral centroid** is estimated from magnitude-weighted bin indices
- A frame is flagged vocal if: `midRatio > 0.35 && centroidHz > 400 && centroidHz < 3500`
- Temporal smoothing: runs shorter than **0.3 seconds** are discarded; gaps under **1 second** are merged

**Vocal hooks** are identified as segments preceded by a gap > 2 beat intervals with energy >= 85% of mean segment energy — these become candidate cue points for transitions.

### Stage 2: Lyrics Pipeline

Lyrics are fetched in parallel with audio analysis.

#### 2.1 LRCLib Search

The filename is cleaned (strip extensions, YouTube metadata cruft, feat. clauses) and used to query the [LRCLib](https://lrclib.net) API via a backend proxy (avoiding browser CORS).

**Matching** uses a **token-set overlap coefficient**: `|A ∩ B| / min(|A|, |B|)` on fuzzy-normalized tokens (NFD decomposition, diacritric stripping, lowercased). A **duration penalty** rejects matches with >60s deviation (>30s: 0.3x, >15s: 0.7x). Minimum acceptance score: **0.35**.

#### 2.2 Whisper Fallback

When LRCLib returns nothing, the raw audio file is uploaded to the backend's `/api/lyrics/transcribe` endpoint, which runs **faster-whisper** (CTranslate2 INT8 quantized "base" model on CPU) with:

- `word_timestamps=True` for per-word timing
- `vad_filter=True` with `min_silence_duration_ms=300` to skip silence
- Words are grouped into **phrase-length lines** (flush every 6 words or 3.5 seconds) for karaoke-style display

### Stage 3: Common Phrase Matching (The "Wordplay" Algorithm)

Once both tracks have timed lyrics, `findCommonPhrases` runs a quadratic scan over every line pair (A_i, B_j):

**Multi-word n-grams (n >= 2):**
- For each line in A, generate all contiguous n-grams (longest first)
- Normalization: NFD diacratic stripping on Latin characters while **preserving Devanagari/Bengali** script ranges, lowercase, strip non-alphanumeric
- Match test: **normalized substring containment** — `normalizedLineB.includes(ngram)`
- Scoring: `10 * word_count + 5 * (starts A line) + 5 * (starts B line) + 8 * (>= 3 words)`

**Single-token hooks (length >= 3):**
- Score: `18 + (length >= 5 ? 6 : 0)`

**Phrase onset estimation:** When a match occurs mid-line, the onset time is interpolated linearly across the line duration by word index, scaled by 0.95.

Results are deduplicated by `phrase|onsetA|onsetB`, sorted by score descending, and capped at **top 40 matches**.

### Stage 4: Transition Planning

The automix controller uses a **priority-ranked strategy** to pick when and how to blend:

| Priority | Strategy | Description |
|---|---|---|
| 1 | **Wordplay hook** | Highest priority. Blend starts so the shared phrase aligns on both decks. Incoming deck seeks to `max(5s, phraseOnset - max(2s, 4 beats))`. Blend length: `min(blendBeats, 4)` beats. |
| 2 | **Vocal hook** | First future vocal hook on the outgoing deck. Short vocal blend: `min(blendBeats, 8)` beats. |
| 3 | **End of vocal segment** | Exit at the end of a vocal section for a clean break. |
| 4 | **Energy valley** | Scans the energy profile for the lowest-energy window, scoring by energy, falling-edge bonus, and phrase/bar alignment. |

All transition points are **snapped to 32-beat phrase boundaries** when within half a phrase window, otherwise to the nearest beat. This ensures transitions feel musically natural.

**Build-up scheduling:** `buildUpBars * 4 * beatInterval` seconds before the transition, the beat layer starts a cue loop and optional snare build. The snare build accelerates through four phases: 8ths (0–30%), 16ths (30–60%), 32nds (60–85%), 64ths (85–100%).

### Stage 5: The Mix

#### 5.1 Signal Routing

```
Deck A/B ──► Volume ──► 3-Band EQ ──► Highpass (low cut) ──► Sidechain Duck ──► Crossfader ──┐
                                                                                               │
Genre Beat Layer ──► Beat Bus ─────────────────────────────────────────────────────────────────┤
                                                                                               ├──► FX Chain ──► Master Gain ──► Destination
Genre Instrumental ──► Gain ───────────────────────────────────────────────────────────────────┤
                                                                                               │
Vocal FX (reverb throws, cue slices) ──────────────────────────────────────────────────────────┘

DJ SFX (air horn, siren, vinyl brake) ──► SFX Gain ──► Master Gain ──► Destination
                                          (bypasses FX chain)
```

#### 5.2 Crossfader

The crossfader uses a **constant-power pan law**:

```
theta = position * pi/2
gainA = cos(theta)
gainB = sin(theta)
```

Smoothed with `setTargetAtTime(value, now, 0.02)` — a 20ms first-order exponential time constant, not a linear ramp. This prevents audible clicks during rapid automation.

#### 5.3 Crossfade Curves

**Standard blend** uses a piecewise quadratic ease-in-out:

```
eased = t < 0.5 ? 2t^2 : 1 - (-2t + 2)^2 / 2
```

At t = 0.74, the lowpass and highpass filters begin opening over the remaining blend tail + 2.8 seconds of "post-blend air."

**Vocal mashup** (hook-based transitions) uses a two-phase **Hermite smoothstep**:

- **Phase 1 (0–65%):** Ease from start position toward midpoint (0.5) — both tracks audible
- **Phase 2 (65–100%):** Ease from midpoint to final position — handoff

Smoothstep: `eased = p^2 * (3 - 2p)`. This holds both tracks at equal volume longer so the shared lyric is clearly heard.

#### 5.4 Transition Styles (per genre)

| Style | Behavior |
|---|---|
| `filterFade` | Lowpass sweep on outgoing deck from 20 kHz down to `sweepFloorHz` (200–800 Hz depending on genre); highpass sweep on incoming |
| `eqSwap` | Gradual EQ shelf exchange: outgoing lows fade to -24 dB by 70% of blend; incoming lows rise from -24 dB to 0 by 80% |
| `dropSwitch` | Hard 1-bar crossfade with sidechain duck depth 0.3; crash noise and kick at the drop point |
| `echoOut` | Reverb send ramps to 0.8 over 30% of blend, then cuts at 70%; creates a wash-out effect |

#### 5.5 Three-Band EQ

Each deck has a parametric EQ chain:
- **Low shelf:** 120 Hz
- **Mid peaking:** 1000 Hz, Q 0.7
- **High shelf:** 3000 Hz

During `eqSwap` transitions, the low shelf on the outgoing deck sweeps to -24 dB while the incoming deck's sweeps from -24 dB to 0 dB — a classic DJ-style bass swap.

#### 5.6 Genre Beat Layer (Synthesized Drums)

When a genre preset has `beatLayerVolume > 0`, a fully synthesized drum machine runs:

**Timing:** A 16-step grid is built from the actual `beatTimes` array (not a fixed clock), so the drums track any tempo drift in the analysis. **Swing** delays odd-numbered 16th steps by `sixteenthDuration * preset.swing`.

**Voices (all synthesized from oscillators and noise):**
- **Kick:** Sine sweep from `startHz` (100–180) to `endHz` (30–45) + 8ms noise click + optional sub sine
- **Closed hat:** Highpass-filtered noise, 35ms decay
- **Open hat:** Same source, 100ms decay
- **Clap:** 3 staggered noise bursts + tail bandpass
- **Perc:** Triangle wave glissando 220→80 Hz + click

**Sidechain ducking:** Each kick triggers a gain reduction on the music bus: depth/attack/release are per-genre (e.g. house: depth 0.5, attack 10ms, release 120ms).

**Drop package:** 4 seconds before the detected drop, a **riser** (saw sweep 120→4500 Hz + noise layer) builds, followed by a **crash** (1.5s bandpass noise) and a heavy kick with 0.3 duck depth.

#### 5.7 FX Chain

The shared FX chain between decks and the beat bus:

```
Input ──► Lowpass (20 kHz) ──► Highpass (20 Hz) ──► Low Shelf EQ (250 Hz) ──► Sub Boost (65 Hz, Q 1.2)
                                                                                    ├──► Dry (1.0) ────────────────┐
                                                                                    └──► Reverb Send ──► Convolver ──► Return (0.7) ──┘
                                                                                                                                      ↓
                                                                                                                                   Output ──► Analyser (FFT 256)
```

Reverb uses a procedurally generated **impulse response**: stereo white noise with exponential decay (`exp(-t * 3)`) over 2 seconds.

#### 5.8 DJ Sound Effects

| Effect | Synthesis |
|---|---|
| **Air horn** | Three sawtooth oscillators (440, 554, 659 Hz — A major triad) through bandpass 800 Hz Q 2.5; gain envelope 0.35→0.4 in 50ms then exponential decay |
| **Siren** | Sine carrier with 3 Hz sine LFO modulating frequency ±300 Hz around 900 Hz base |
| **Vinyl brake** | White noise buffer with playback rate 1→0.01 exponential; lowpass 8 kHz→200 Hz |
| **Snare roll** | Repeating noise hits with accelerating density; bandpass sweeps 2500→4000 Hz |

All SFX route through `sfxGain` directly to `masterGain`, **bypassing** the FX chain (reverb, filters) so they remain crisp.

#### 5.9 Vocal FX Engine

An analysis-driven reverb engine schedules effects based on track position:

- **Reverb throws** at vocal segment endings (0.3s before end): ramp up 20%, hold 30%, fade 50% of total duration
- **Drop approach:** 2 seconds before drop, swell reverb to 0.65 wet
- **Cue slices:** Re-trigger a slice of the current audio at fractional-beat intervals with decreasing volume (0.6 - 0.1 per repeat); each slice is highpass-filtered at 250 Hz

### Stage 6: Visualization

The **Butterchurn** (Milkdrop WebGL) visualizer connects to the `AnalyserNode` at the end of the FX chain. 14 curated presets auto-rotate every **25 seconds** with a 3-second blend between presets. Click to manually cycle (2-second blend).

The visualizer runs in its own `requestAnimationFrame` loop, independent of the audio clock, and can be paused/fullscreened independently.

---

## Quick Start

### Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node.js** | 18+ | Frontend dev server and build |
| **Python** | 3.11+ | Backend API server |
| **ffmpeg** | any | Audio transcoding (yt-dlp post-processing) |

```bash
# macOS
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
├── src/                          # React + TypeScript frontend
│   ├── main.tsx                  # Entry — BrowserRouter, single route
│   ├── App.tsx                   # Main DJ deck UI, automix wiring, load pipeline
│   ├── apiBase.ts                # VITE_API_BASE → API URL helper
│   ├── analysis/
│   │   ├── analyzeCore.ts        # Onset detection, BPM, beats, energy, vocals, drop
│   │   ├── analyzeTrack.ts       # Worker orchestration with main-thread fallback
│   │   └── analyzeWorker.ts      # Web Worker entry (Transferable ArrayBuffer)
│   ├── audio/
│   │   ├── mixer.ts              # Web Audio graph: EQ, crossfader, FX chain, master
│   │   ├── deckPlayer.ts         # Per-deck BufferSource playback, seek, volume
│   │   ├── effects.ts            # FX chain: filters, reverb, genre EQ, sub boost
│   │   ├── vocalFX.ts            # Analysis-driven reverb throws and cue slices
│   │   ├── djSfx.ts              # Synthesized air horn, siren, vinyl brake, snare roll
│   │   ├── genreBeatLayer.ts     # Synthesized drum machine on beat grid
│   │   ├── genreInstrumental.ts  # Looping instrumental bed from YouTube
│   │   ├── turntableWindDown.ts  # One-shot disc SFX
│   │   └── types.ts              # TrackAnalysis, DeckState, AutomixPhase types
│   ├── automix/
│   │   ├── controller.ts         # 4-state automix FSM, transition execution
│   │   └── transitionPlan.ts     # Strategy ranking, phrase quantization, cue selection
│   ├── components/
│   │   ├── Visualizer.tsx        # Butterchurn WebGL + preset rotation
│   │   ├── TrackTimeline.tsx     # Dual-deck waveform, seek, wordplay markers
│   │   ├── MusicSearch.tsx       # YouTube search with streaming download + progress
│   │   ├── MixButton.tsx         # Start/stop with animated disc
│   │   ├── StatusLog.tsx         # Timestamped event log
│   │   └── WordplayLogo.tsx      # SVG wordmark with spinning disc
│   ├── genre/
│   │   └── genrePresets.ts       # 10+ genre definitions (patterns, tuning, FX params)
│   ├── lyrics/
│   │   ├── lyricsService.ts      # LRCLib client, Whisper upload, phrase matching
│   │   ├── lyricSync.ts          # Binary search for active lyric line
│   │   └── types.ts              # TimedLine, WordMatch
│   ├── hooks/
│   │   └── useMediaQuery.ts      # Responsive breakpoint hook
│   └── pages/
│       ├── HomePage.tsx           # Landing → App transition
│       └── home.css
├── backend/
│   ├── main.py                   # FastAPI: search, download, lyrics, Whisper, genre cache
│   ├── music_fetch.py            # yt-dlp integration, cookie handling, SSRF protection
│   └── ssl_compat.py             # TLS helpers for corporate proxies
├── public/                       # Static assets (favicon, logos)
├── vite.config.ts                # Vite + React plugin, /api proxy to :8000
└── package.json
```

### Automix State Machine

```
                    start()
         ┌──────────────────────────┐
         │                          ▼
       ┌─────┐    ┌──────────┐   ┌──────────┐
       │idle │◄───│  done    │   │ playingA  │◄──────────────────────┐
       └─────┘    └──────────┘   └─────┬─────┘                      │
         ▲                             │                             │
         │                    scheduleBlend                          │
       stop()                  triggers at                    blend complete
         │                   transition point                  (A←B direction)
         │                             │                             │
         │                             ▼                             │
         │                       ┌──────────┐                        │
         ├───────────────────────│ blending │────────────────────────┘
         │                       └─────┬────┘
         │                             │
         │                       blend complete
         │                      (A→B direction)
         │                             │
         │                             ▼
         │                       ┌──────────┐
         └───────────────────────│ playingB │
                                 └──────────┘
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
| **Audio Engine** | Web Audio API (AnalyserNode, BiquadFilter, ConvolverNode, AudioBufferSource, GainNode, OscillatorNode) |
| **Visualizer** | Butterchurn (Milkdrop WebGL) |
| **Backend** | FastAPI, Python 3.12 |
| **YouTube** | yt-dlp |
| **Transcription** | faster-whisper (CTranslate2 INT8) |
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
