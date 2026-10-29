# Smashup

**Drop songs that share a word. Get a producer-grade mashup built on that word.**

Make a crate called “paisa”, drop in five songs, and Smashup will:

1. find every “paisa” in every song, accurate to the syllable,
2. lay them out as a **Word Wall** (every hit, word-locked) and a **Track × 4 pad grid**,
3. have the **brain** pick a master tempo and key, then compose a non-linear arrangement: tease → build → peak → breath → bigger peak → callback,
4. join the sections with real DJ moves: word-chain cuts, call & response, acapella-in, loop rolls, echo throws, bass swaps, drop swaps,
5. let you **perform** the pads (quantized to the bar), **edit** every section and transition, and **export WAV**.

It grew out of [Wordplay](../README.md) (lyric-aware transitions) and [Stemplay](https://github.com/rohankokkula/stemplay) (local Demucs stems), but it is a redesign, not an extension.

---

## The product thinking

| Wordplay 1.x | Smashup |
|---|---|
| Two decks, crossfade A → B | **Produced** on one master tempo + key; DJ moves only at the seams |
| The atom is a track | The atom is a **Moment**: a phrase-aligned slice anchored on the keyword syllable |
| Lanes = decks | Lanes = **stem roles** (Vox / Drums / Bass / Music). Song A's vocal can ride song B's beat |
| Line-level lyrics | **Word-level** timing: Whisper for discovery, MMS forced alignment for precision, onset snap for the cut |
| 2 stems | **4 stems** (htdemucs) |
| Plays in order | **Composer** with mashup grammar, a tension curve and plain-English reasons |

**Mashup grammar the composer enforces**
- **Rule of three.** The word lands 2–3 times before a handover.
- **No back-to-back drops.** A build must pay off.
- **Intro only first, outro only last.** The opener is chosen on merit, never “song 1”.
- **Bookend callback.** The closer can return to the opener's hook.
- **Variety.** Every song is used, there is no song twice in a row, each song returns at most twice, and the same move is never used twice in a row.
- **Tempo honesty.** Songs more than ±8% from the master play at their native tempo and only join through tempo-break moves (echo throw, spinback, cut). Keys shift at most ±2 semitones.

## Modes

- **Word Wall (Discover).** Every hit across the crate, waveforms centred on the syllable. Audition, accept/reject, nudge ±20 ms, “Play every hit”, and shift-click a song strip to mark a missed hit.
- **Pads (Perform).** Your table, in software: 🔴 Call · 🟠 Build · 🟡 Chant · 🟢 Drop. Template labels like “Instrumental” or “Full hook” steer which cue lands on which pad. Keys `1–4 · Q–R · A–F · Z–V · U–P`. **Go live** locks pads to the master BPM and fires them on the next bar. **Record** turns your performance into an arrangement.
- **Arrangement (Produce).** A bar-grid timeline by stem role, with a tension curve against the target and keyword markers.
  - Click a section to swap its moment or layer (full / acapella over the previous beat / acapella tease), lock it, move it or delete it.
  - Click a move chip to change the transition or its length.
  - **Re-roll** keeps locked sections. Plans A/B/C are diverse alternatives. Undo/redo works throughout.
- **Brain panel.** The master tempo/key, each song's warp and shift, and a reason for every section and transition.

## Try it without music

**Synth demo** builds five royalty-free songs in the browser: 92 / 96 / 100 / 128 BPM, plus a 49 BPM half-time track. Each comes with real 4-stem separation and sung formant-synth “pai-sa” hooks, so the whole pipeline (including stem layering and the tempo-break logic) works on the hosted preview with no backend.

**Paisa template** creates the five-track crate from the brief, with empty slots: drop your own audio in. To auto-fill it, put files in `public/preloads/paisa/` (git-ignored; see the README there). **Audio is never committed or hosted.** Projects reference audio by sha256 and keep it in the browser (IndexedDB).

## Architecture

```
smashup/src/
  model/      versioned project schema — Crate, Song{hash}, Moment, Plan, Timeline, Clip
  analysis/   music.ts (FFT → onset → tempo/grid/downbeat, chroma → Krumhansl key → Camelot,
              per-bar energy/vocal, novelty sectioning) in a Worker · keywordMatch.ts (script/
              spelling folding: paisa = पैसा = pesa) · cues.ts (hits → Moments → pads) ·
              pipeline.ts (decode → analyse → words → stems → hits → moments)
  brain/      compat.ts (master tempo/key solver, Camelot) · moves.ts (10-move library) ·
              composer.ts (beam search + grammar + reasons)
  engine/     timeline.ts (plan → clips + automation per move) · warp.ts (Signalsmith Stretch
              WASM, pitch-preserving, rendered offline) · bank.ts (lazy, range-based warp cache) ·
              graph.ts (one scheduler for live AudioContext + OfflineAudioContext export) ·
              session.ts (transport, auditions, vinyl-mode pads, export)
  demo/       in-browser synthetic crate with true stems + sidecar words
  ui/         CrateSidebar · WordWall · PadGrid · Arrangement · BrainPanel · Transport
```

**Analysis service** (`../backend/smashup`, mounted on the existing FastAPI app):

| Endpoint | |
|---|---|
| `GET /api/smashup/health` | Capabilities (demucs / whisper / align) |
| `POST /api/smashup/analyze` | `file` + `keywords` → `{job_id, hash}` |
| `GET /api/smashup/jobs/{id}` · `/events` | Poll, or Server-Sent Events |
| `GET /api/smashup/{hash}/stems/{vocals\|drums\|bass\|other}` | 4-stem htdemucs (mp3, cached by hash) |
| `GET /api/smashup/{hash}/words?keywords=` | Word timestamps + keyword hits |

The pipeline:
1. 4-stem Demucs.
2. faster-whisper on the **vocal stem**, biased with `initial_prompt` / `hotwords` = the crate keywords (model from `WHISPER_MODEL_SMASHUP`, default `small`).
3. `torchaudio` MMS forced alignment (`* word *`) to snap each hit.

Everything is cached by sha256, so re-uploads are free.

**Without the service** the app runs in on-device mode. Tempo, key and sections are always computed locally. Words come from, in order:
- a `song.words.json` sidecar dropped next to the audio,
- **in-browser Whisper** (transformers.js, `whisper-base` with word timestamps). It uses WebGPU when available, otherwise WASM. The model downloads once (about 75 MB) and transcripts are cached per song. The input is band-limited to the vocal range. Set a language hint (Hindi / Urdu / Punjabi) on the Word Wall.
- LRCLib synced lyrics. It tries the template query, then the title, then the filename, and also cross-checks Whisper: lyric lines with the word boost nearby hits and add any it missed as suggestions.
- **Mark one, find all.** Shift-click one “paisa” on a song's waveform and press *Find all*.
  - It snaps the click to the syllable, builds an MFCC + energy-contour template, and scans every song at three time-stretches.
  - Strong matches are accepted; weaker ones land in *Sounds like “paisa”* for review.
  - On the synthetic crate, one click on a full mix (no stems) finds 19 of 20 with no false accepts.

Keyword matching folds Latin, Devanagari, Gurmukhi and Urdu script, so paisa / पैसा / ਪੈਸਾ / پیسہ / پیسے all match. Each song shows *why* it has the hits it has.

Stem layering moves are disabled until stems exist.

## Develop

```bash
cd smashup
npm install
npm run dev        # http://localhost:5173 (proxies /api → :8000)
npm test           # 38 unit tests: matcher, Camelot, solver, grammar, grid, on-device analysis, find-all spotter
npm run e2e        # headless Chromium end-to-end (needs `playwright`), screenshots in e2e/out/
```

Backend (optional, for stems + word alignment):

```bash
cd backend && uvicorn main:app --reload --port 8000
python -m pytest tests/test_smashup.py   # router tests with stubbed models
```

## Deploy

- **Frontend (Vercel):** create a Vercel project from this repo with **Root Directory = `smashup`**. `vercel.json` here handles the SPA rewrites. `VITE_API_BASE` is in `.env.production`.
- **Backend (Railway):** deploy `backend/` from this branch. Set `WHISPER_MODEL_SMASHUP=small` (or `medium` for best Hindi/Urdu). The CORS default already allows `*.vercel.app`.

## Next

Web MIDI controller mapping (DDJ / Launchpad), shareable project links, Spotify playlist import (metadata only: Spotify doesn't expose audio, and its Audio Analysis API is deprecated), collaborative crates.
