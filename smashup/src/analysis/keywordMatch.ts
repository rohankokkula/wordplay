/**
 * Keyword folding — mirror of `backend/smashup/keywords.py`; keep rules in sync.
 *
 * Romanized South-Asian lyrics spell the same sound many ways
 * (paisa / paisaa / pesa / paysa / पैसा). Folding maps them to one form so a
 * crate keyword finds every occurrence regardless of script or spelling.
 */

import type { Hit, Word } from '@/model/types'

const DEVA: Record<string, string> = {
  अ: 'a', आ: 'aa', इ: 'i', ई: 'ii', उ: 'u', ऊ: 'uu', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
  'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  'ं': 'n', 'ँ': 'n', 'ः': 'h', '्': '', '़': '',
  क: 'ka', ख: 'kha', ग: 'ga', घ: 'gha', ङ: 'na', च: 'cha', छ: 'chha', ज: 'ja', झ: 'jha',
  ञ: 'na', ट: 'ta', ठ: 'tha', ड: 'da', ढ: 'dha', ण: 'na', त: 'ta', थ: 'tha', द: 'da',
  ध: 'dha', न: 'na', प: 'pa', फ: 'pha', ब: 'ba', भ: 'bha', म: 'ma', य: 'ya', र: 'ra',
  ल: 'la', व: 'va', श: 'sha', ष: 'sha', स: 'sa', ह: 'ha',
}
const VOWEL_SIGNS = new Set('ािीुूेैोौ्ंँ'.split(''))

export function translit(s: string): string {
  const out: string[] = []
  for (const ch of s) {
    const val = DEVA[ch]
    if (val === undefined) {
      out.push(ch)
      continue
    }
    // A vowel sign / virama replaces the inherent 'a' of the preceding consonant.
    const prev = out[out.length - 1]
    if (VOWEL_SIGNS.has(ch) && prev && prev.length > 1 && prev.endsWith('a')) {
      out[out.length - 1] = prev.slice(0, -1)
    }
    out.push(val)
  }
  return out.join('')
}

export function fold(word: string): string {
  let s = translit(word.toLowerCase())
  s = s.normalize('NFD').replace(/\p{Mn}/gu, '')
  s = s.replace(/[^a-z]/g, '')
  s = s.replaceAll('sh', 's').replaceAll('w', 'v').replaceAll('z', 'j').replaceAll('ph', 'f')
  s = s.replace(/(ai|ae|ay|ei|ey)/g, 'e')
  s = s.replace(/(ee|ii)/g, 'i')
  s = s.replace(/(oo|uu)/g, 'u')
  s = s.replace(/(.)\1+/g, '$1')
  if (s.length > 3 && s.endsWith('h')) s = s.slice(0, -1)
  return s
}

export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)))
    }
    prev = cur
  }
  return prev[b.length]
}

/** Returns match quality 0..1 (1 = exact fold), or 0 when the word is not the keyword. */
export function matchQuality(word: string, aliases: string[]): number {
  let best = 0
  for (const part of word.split(/[\s\-_,.!?'"…]+/)) {
    const f = fold(part)
    if (!f) continue
    for (const alias of aliases) {
      const a = fold(alias)
      if (!a) continue
      if (f === a) return 1
      if (a.length >= 4 && Math.abs(f.length - a.length) <= 1 && editDistance(f, a) <= 1) best = Math.max(best, 0.75)
    }
  }
  return best
}

export function matchesKeyword(word: string, aliases: string[]): boolean {
  return matchQuality(word, aliases) > 0
}

/** Alias list for a crate: keyword + user aliases, deduped by fold. */
export function crateAliases(keyword: string, aliases: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const a of [keyword, ...aliases]) {
    const f = fold(a)
    if (f && !seen.has(f)) {
      seen.add(f)
      out.push(a)
    }
  }
  return out
}

let hitSeq = 0
export function hitId(songId: string): string {
  hitSeq += 1
  return `${songId}-h${hitSeq}-${Math.random().toString(36).slice(2, 6)}`
}

/** Words → keyword hits (cluster/iconic are filled in later by `cues.ts`). */
export function findHits(
  words: Word[],
  aliases: string[],
  songId: string,
  source: Hit['source'],
): Hit[] {
  const hits: Hit[] = []
  for (const w of words) {
    const q = matchQuality(w.w, aliases)
    if (q <= 0) continue
    const prev = hits[hits.length - 1]
    // Whisper sometimes splits one sung word into two tokens — merge overlaps.
    if (prev && w.start - prev.end < 0.05 && fold(prev.text) === fold(w.w)) continue
    hits.push({
      id: hitId(songId),
      songId,
      text: w.w.replace(/[,.!?]+$/, ''),
      start: w.start,
      end: Math.max(w.end, w.start + 0.12),
      confidence: Math.max(0.05, Math.min(1, (w.p || 0.6) * q)),
      source,
      accepted: true,
      cluster: 0,
      iconic: 0,
    })
  }
  return hits
}
