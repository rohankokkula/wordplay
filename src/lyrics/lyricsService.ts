import { apiUrl } from '../apiBase';
import { splitLyricWords } from './lyricSync';
import type { TimedLine, WordMatch } from './types';

const YT_JUNK = /\s*[\(\[](official\s*(video|audio|lyric|music\s*video)|full\s*(video|song)|audio|lyric\s*video|hd|hq|4k|with\s*lyrics?|visuali[sz]er|remastered|from\s*"[^"]*")[\)\]]/gi;
const PIPE_JUNK = /\s*\|.*$/;
const FEAT_JUNK = /\s*(feat\.?|ft\.?|featuring)\s+.*/i;
const EXT_JUNK = /\.(mp3|m4a|webm|opus|wav|flac|ogg)$/i;
const MULTI_SPACE = /\s+/g;

function cleanTitle(raw: string): string {
  let s = raw.replace(EXT_JUNK, '');
  s = s.replace(YT_JUNK, '');
  s = s.replace(PIPE_JUNK, '');
  s = s.replace(FEAT_JUNK, '');

  // Strip trailing artist credits after last underscore separator
  // e.g. "Tum Se(Full Video)_ Shahid_ Kriti _ Sachin-Jigar_..." → "Tum Se"
  const underscoreParts = s.split('_').map(p => p.trim()).filter(Boolean);
  if (underscoreParts.length > 1) {
    s = underscoreParts[0];
  }

  s = s.replace(/[-]/g, ' ');
  s = s.replace(MULTI_SPACE, ' ').trim();
  return s;
}

/**
 * Try to split a raw filename into track + artist by looking for common
 * separator patterns: "Artist - Track", "Track _ Artist", commas, etc.
 */
export function extractTrackAndArtist(raw: string): { track: string; artist: string } | null {
  let s = raw.replace(EXT_JUNK, '').trim();
  s = s.replace(YT_JUNK, '').trim();
  s = s.replace(PIPE_JUNK, '').trim();
  s = s.replace(FEAT_JUNK, '').trim();

  // Pattern 1: "Artist - Track" or "Track - Artist"
  const dashParts = s.split(/\s+-\s+/);
  if (dashParts.length === 2) {
    const [a, b] = dashParts.map(p => p.trim());
    if (a && b) {
      return { track: b, artist: a };
    }
  }

  // Pattern 2: underscore-separated, first part is title, rest are artists
  // e.g. "Tum Se(Full Video)_ Shahid_ Kriti _ Sachin-Jigar_Raghav_..."
  const underscoreParts = s.split('_').map(p => p.trim()).filter(Boolean);
  if (underscoreParts.length >= 2) {
    const track = underscoreParts[0].replace(YT_JUNK, '').trim();
    const artistCandidates = underscoreParts.slice(1).filter(p => p.length > 1);
    if (track && artistCandidates.length > 0) {
      return { track, artist: artistCandidates[0] };
    }
  }

  // Pattern 3: comma-separated "Track, Artist"
  const commaParts = s.split(',').map(p => p.trim()).filter(Boolean);
  if (commaParts.length === 2) {
    return { track: commaParts[0], artist: commaParts[1] };
  }

  return null;
}

export function parseLRC(syncedLyrics: string): TimedLine[] {
  const lines: TimedLine[] = [];
  const re = /\[(\d{1,3}):(\d{2})\.(\d{2,3})\]\s*(.*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(syncedLyrics)) !== null) {
    const mins = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);
    const frac = match[3].length === 2
      ? parseInt(match[3], 10) / 100
      : parseInt(match[3], 10) / 1000;
    const time = mins * 60 + secs + frac;
    const text = match[4].trim();
    if (text.length > 0) {
      lines.push({ time, text });
    }
  }
  return lines;
}

interface LRCLibResult {
  id: number;
  trackName: string;
  artistName: string;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  duration: number;
  instrumental: boolean;
}

/**
 * Normalise a string for fuzzy comparison: lowercase, strip accents,
 * remove punctuation, collapse whitespace.
 */
function fuzzyNorm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Overlap coefficient: |intersection(tokens)| / min(|A|, |B|).
 * Returns 0..1. High values mean most words from the shorter string
 * appear in the longer one.
 */
function tokenOverlap(a: string, b: string): number {
  const tokA = new Set(fuzzyNorm(a).split(' ').filter(Boolean));
  const tokB = new Set(fuzzyNorm(b).split(' ').filter(Boolean));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let hits = 0;
  for (const w of tokA) if (tokB.has(w)) hits++;
  return hits / Math.min(tokA.size, tokB.size);
}

/**
 * Check whether a LRCLib result is a plausible match for the query.
 * Uses token overlap on track name + artist, and optional duration check.
 */
function scoreResult(
  result: LRCLibResult,
  queryClean: string,
  extracted: { track: string; artist: string } | null,
  trackDurationSec?: number,
): number {
  const combined = `${result.trackName} ${result.artistName}`;

  // Token overlap between the cleaned filename and "trackName artistName"
  let overlap = tokenOverlap(queryClean, combined);

  // If we extracted a structured track/artist, also check each part
  if (extracted) {
    const trackOv = tokenOverlap(extracted.track, result.trackName);
    const artistOv = tokenOverlap(extracted.artist, result.artistName);
    // Weight: track name match matters more than artist
    const structuredScore = trackOv * 0.7 + artistOv * 0.3;
    overlap = Math.max(overlap, structuredScore);
  }

  // Duration penalty: if we know the real track length, reject wild mismatches
  if (trackDurationSec && trackDurationSec > 0 && result.duration > 0) {
    const diff = Math.abs(result.duration - trackDurationSec);
    // Allow up to 15s drift (intros, outros differ), penalise heavily beyond that
    if (diff > 60) return 0;
    if (diff > 30) overlap *= 0.3;
    else if (diff > 15) overlap *= 0.7;
  }

  return overlap;
}

const MIN_MATCH_SCORE = 0.35;

export async function fetchSyncedLyrics(
  trackTitle: string,
  trackDurationSec?: number,
): Promise<TimedLine[] | null> {
  const q = cleanTitle(trackTitle);
  console.log(`[lyrics] cleanTitle: "${trackTitle}" → "${q}"`);
  if (q.length < 3) return null;

  const extracted = extractTrackAndArtist(trackTitle);

  // Attempt 1: search endpoint with validation
  try {
    const searchUrl = apiUrl(`/api/lyrics/search?q=${encodeURIComponent(q)}`);
    console.log(`[lyrics] search: ${searchUrl}`);
    const resp = await fetch(searchUrl);
    if (resp.ok) {
      const results: LRCLibResult[] = await resp.json();
      const withSynced = results.filter(r => r.syncedLyrics && !r.instrumental);

      if (withSynced.length > 0) {
        // Score every result and pick the best match
        const scored = withSynced.map(r => ({
          result: r,
          score: scoreResult(r, q, extracted, trackDurationSec),
        }));
        scored.sort((a, b) => b.score - a.score);

        const best = scored[0];
        console.log(
          `[lyrics] search: ${scored.length} candidates, best="${best.result.trackName}" ` +
          `by ${best.result.artistName} score=${best.score.toFixed(2)} ` +
          `(dur=${best.result.duration}s vs local=${trackDurationSec?.toFixed(0) ?? '?'}s)`,
        );

        if (best.score >= MIN_MATCH_SCORE) {
          console.log(`[lyrics] ✓ accepted: "${best.result.trackName}" (score ${best.score.toFixed(2)})`);
          return parseLRC(best.result.syncedLyrics!);
        }

        console.log(
          `[lyrics] ✗ rejected all results — best score ${best.score.toFixed(2)} < ${MIN_MATCH_SCORE}. ` +
          `Query="${q}", best="${best.result.trackName} - ${best.result.artistName}"`,
        );
      } else {
        console.log(`[lyrics] search returned ${results.length} results, none with synced lyrics`);
      }
    }
  } catch (e) {
    console.warn('[lyrics] search failed:', e);
  }

  // Attempt 2: exact get via extracted track + artist (with validation)
  if (extracted) {
    try {
      const params = new URLSearchParams({
        track_name: extracted.track,
        artist_name: extracted.artist,
      });
      const getUrl = apiUrl(`/api/lyrics/get?${params}`);
      console.log(`[lyrics] get fallback: track="${extracted.track}" artist="${extracted.artist}" → ${getUrl}`);
      const resp = await fetch(getUrl);
      if (resp.ok) {
        const result: LRCLibResult | null = await resp.json();
        if (result?.syncedLyrics && !result.instrumental) {
          const score = scoreResult(result, q, extracted, trackDurationSec);
          console.log(
            `[lyrics] get hit: "${result.trackName}" by ${result.artistName} ` +
            `score=${score.toFixed(2)} dur=${result.duration}s`,
          );
          if (score >= MIN_MATCH_SCORE) {
            console.log(`[lyrics] ✓ accepted get result`);
            return parseLRC(result.syncedLyrics);
          }
          console.log(`[lyrics] ✗ rejected get result (score ${score.toFixed(2)} < ${MIN_MATCH_SCORE})`);
        } else {
          console.log('[lyrics] get returned result but no synced lyrics');
        }
      }
    } catch (e) {
      console.warn('[lyrics] get fallback failed:', e);
    }
  } else {
    console.log('[lyrics] could not extract track+artist for get fallback');
  }

  console.log('[lyrics] no matching synced lyrics found via LRCLib');
  return null;
}

/**
 * Transcribe audio via the backend Whisper endpoint.
 * Uploads the raw audio file and returns timed lines.
 */
export async function transcribeWithWhisper(file: File): Promise<TimedLine[] | null> {
  console.log(`[lyrics] Whisper: uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);
  try {
    const form = new FormData();
    form.append('file', file);
    const url = apiUrl('/api/lyrics/transcribe');
    const resp = await fetch(url, { method: 'POST', body: form });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[lyrics] Whisper failed: ${resp.status} ${text}`);
      return null;
    }
    const lines: Array<{ time: number; text: string }> = await resp.json();
    if (!Array.isArray(lines) || lines.length === 0) {
      console.log('[lyrics] Whisper returned no lines');
      return null;
    }
    console.log(`[lyrics] Whisper: ${lines.length} lines transcribed`);
    return lines.map(l => ({ time: l.time, text: l.text }));
  } catch (e) {
    console.warn('[lyrics] Whisper transcription request failed:', e);
    return null;
  }
}

/**
 * Strip Latin accents only (Mónica → Monica). Do NOT NFKD the whole string — that can
 * decompose Indic/mixed lyric lines so the next filter strips characters and matching breaks.
 */
function stripLatinDiacritics(text: string): string {
  return text.replace(/[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]+/g, (chunk) =>
    chunk.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  );
}

function normalize(text: string): string {
  return stripLatinDiacritics(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s\u0900-\u097F\u0980-\u09FF]/g, '')
    .replace(MULTI_SPACE, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(/\s+/).filter(w => w.length > 0);
}

/** Map phrase start into the line's time window (LRC has line-level stamps only). */
function phraseOnsetInLine(
  line: TimedLine,
  nextLine: TimedLine | undefined,
  phraseWords: string[],
): number {
  const t0 = line.time;
  const t1 = nextLine ? nextLine.time : t0 + 6;
  const dur = Math.max(0.25, t1 - t0);
  const words = splitLyricWords(line.text);
  if (words.length === 0 || phraseWords.length === 0) return t0;
  const head = normalize(phraseWords[0]);
  let wi = words.findIndex((w) => {
    const nw = normalize(w);
    return nw === head || nw.startsWith(head) || head.startsWith(nw);
  });
  if (wi < 0) wi = 0;
  return t0 + (wi / Math.max(1, words.length)) * dur * 0.95;
}

/**
 * Find common phrases (2+ words) between two lyric sets.
 * Stores phraseOnsetA/B so transitions jump to the phrase, not only line start.
 */
export function findCommonPhrases(
  lyricsA: TimedLine[],
  lyricsB: TimedLine[],
): WordMatch[] {
  const matches: WordMatch[] = [];
  const seen = new Set<string>();

  const pushMatch = (
    ia: number,
    ib: number,
    phrase: string,
    phraseTokens: string[],
    score: number,
  ) => {
    const lineA = lyricsA[ia];
    const lineB = lyricsB[ib];
    const nextA = lyricsA[ia + 1];
    const nextB = lyricsB[ib + 1];
    const phraseOnsetA = phraseOnsetInLine(lineA, nextA, phraseTokens);
    const phraseOnsetB = phraseOnsetInLine(lineB, nextB, phraseTokens);

    const key = `${phrase}|${phraseOnsetA.toFixed(2)}|${phraseOnsetB.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);

    matches.push({
      phrase,
      timeA: lineA.time,
      lineA: lineA.text,
      timeB: lineB.time,
      lineB: lineB.text,
      score,
      phraseOnsetA,
      phraseOnsetB,
    });
  };

  for (let ia = 0; ia < lyricsA.length; ia++) {
    const lineA = lyricsA[ia];
    const tokensA = tokenize(lineA.text);
    if (tokensA.length < 2) continue;

    for (let ib = 0; ib < lyricsB.length; ib++) {
      const lineB = lyricsB[ib];
      const normB = normalize(lineB.text);
      if (!normB.length) continue;

      for (let lenA = tokensA.length; lenA >= 2; lenA--) {
        for (let startA = 0; startA <= tokensA.length - lenA; startA++) {
          const ngram = tokensA.slice(startA, startA + lenA).join(' ');
          if (!normB.includes(ngram)) continue;

          const wordCount = lenA;
          let score = wordCount * 10;
          if (startA === 0) score += 5;
          if (normB.startsWith(ngram)) score += 5;
          if (wordCount >= 3) score += 8;

          pushMatch(ia, ib, ngram, ngram.split(' '), score);
        }
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 20);
}
