/**
 * The move library: how one section hands over to the next.
 *
 * Each move declares when it is musically legal (`ok`) and how well it fits
 * (`score`). The composer picks the best legal move per seam; the user can
 * override it in the Move editor. Engine behaviour lives in `engine/timeline.ts`.
 */

import type { MomentRole, MoveId } from '@/model/types'

export interface SeamContext {
  aRole: MomentRole
  bRole: MomentRole
  aEnergy: number
  bEnergy: number
  aHits: number
  bHits: number
  /** Either side plays at native tempo (can't be beatmatched). */
  tempoBreak: boolean
  /** Both sides land in compatible keys after shifting. */
  keyCompat: boolean
  /** Both sides have 4-stem separation. */
  stems: boolean
  /** Vocal density at the start of B (0..1). */
  bVocal: number
}

export interface MoveDef {
  id: MoveId
  name: string
  glyph: string
  blurb: string
  /** Default seam-region length in master bars (0 = butt-joined). */
  bars: number
  ok: (c: SeamContext) => boolean
  score: (c: SeamContext) => number
  reason: (c: SeamContext) => string
}

const up = (c: SeamContext) => c.bEnergy - c.aEnergy

export const MOVES: Record<MoveId, MoveDef> = {
  wordCut: {
    id: 'wordCut',
    name: 'Word-chain cut',
    glyph: '✂',
    blurb: 'A lands its keyword, hard cut on the downbeat into B saying it back.',
    bars: 0,
    ok: () => true,
    score: (c) => 0.7 + (c.aHits && c.bHits ? 0.7 : 0) + (c.tempoBreak ? 0.2 : 0),
    reason: (c) =>
      c.aHits && c.bHits ? 'the word itself carries the handover — cut on the downbeat' : 'clean phrase-boundary cut',
  },
  callResponse: {
    id: 'callResponse',
    name: 'Call & response',
    glyph: '⇄',
    blurb: 'The keyword ping-pongs A / B / A / B one bar each, then B takes over.',
    bars: 4,
    ok: (c) => c.aHits > 0 && c.bHits > 0 && !c.tempoBreak,
    score: (c) => 0.8 + (c.aRole === 'chant' || c.bRole === 'chant' ? 0.4 : 0),
    reason: () => 'both sides hit the word — trade it bar by bar so the crowd hears the wordplay',
  },
  acapellaIn: {
    id: 'acapellaIn',
    name: 'Acapella in',
    glyph: '🎙',
    blurb: "B's vocal enters over A's beat, then B's beat drops in with a bass swap.",
    bars: 4,
    ok: (c) => c.stems && c.keyCompat && !c.tempoBreak && c.bHits > 0,
    score: (c) => 1.0 + c.bVocal * 0.4,
    reason: () => "keys line up after the shift, so B's vocal can ride A's groove before the beat swaps",
  },
  loopRoll: {
    id: 'loopRoll',
    name: 'Loop roll',
    glyph: '↻',
    blurb: "A's last keyword stutters ½ → ¼ → ⅛ beat with a rising filter, then B drops.",
    bars: 1,
    ok: (c) => c.aHits > 0,
    score: (c) => 0.55 + Math.max(0, up(c)) * 1.6 + (c.bRole === 'drop' || c.bRole === 'chant' ? 0.3 : 0),
    reason: (c) => (up(c) > 0.1 ? 'energy is climbing — roll the word into the next peak' : 'stutter the word as a tag'),
  },
  echoThrow: {
    id: 'echoThrow',
    name: 'Echo throw',
    glyph: '≋',
    blurb: "Throw a tempo-synced delay on A's last word and let it ring; B comes in dry.",
    bars: 1,
    ok: () => true,
    score: (c) => 0.45 + (c.tempoBreak ? 1.1 : 0) + (up(c) < -0.1 ? 0.3 : 0),
    reason: (c) =>
      c.tempoBreak ? "tempos are too far apart to beatmatch — the echo hides the jump" : 'let the word echo out for a breather',
  },
  bassSwap: {
    id: 'bassSwap',
    name: 'Bass-swap blend',
    glyph: '⇅',
    blurb: '16-beat blend; the low end swaps from A to B on the middle bar.',
    bars: 4,
    ok: (c) => !c.tempoBreak && c.keyCompat,
    score: (c) => 0.55 + (Math.abs(up(c)) < 0.2 ? 0.35 : 0) - (c.stems ? 0 : c.bVocal * 0.6),
    reason: () => 'tempos and keys sit together — a long, smooth blend works',
  },
  filterHandover: {
    id: 'filterHandover',
    name: 'Filter handover',
    glyph: '◐',
    blurb: 'Low-pass A out while high-passed B opens up.',
    bars: 4,
    ok: (c) => !c.tempoBreak,
    score: (c) => 0.45 + (up(c) < 0 ? 0.3 : 0) + (c.keyCompat ? 0 : 0.15) - (c.stems ? 0 : c.bVocal * 0.5),
    reason: (c) => (c.keyCompat ? 'gentle handover into a softer section' : 'filters mask the key change during the overlap'),
  },
  dropSwap: {
    id: 'dropSwap',
    name: 'Drop swap',
    glyph: '⚡',
    blurb: "A builds with a riser and climbing high-pass — B's drop lands instead of A's.",
    bars: 2,
    ok: (c) => (c.bRole === 'drop' || c.bEnergy > 0.7) && up(c) > -0.05,
    score: (c) => 0.6 + up(c) * 1.8 + (c.aRole === 'build' ? 0.5 : 0),
    reason: () => "build the tension on A and pay it off with B's drop",
  },
  spinback: {
    id: 'spinback',
    name: 'Spinback',
    glyph: '⟲',
    blurb: 'Vinyl brake on A, then B starts cold.',
    bars: 0,
    ok: () => true,
    score: (c) => 0.25 + (c.tempoBreak ? 0.7 : 0) + (Math.abs(up(c)) > 0.35 ? 0.4 : 0),
    reason: (c) => (c.tempoBreak ? 'a hard reset hides the tempo jump' : 'big energy contrast — reset the room'),
  },
  dropOut: {
    id: 'dropOut',
    name: 'Drop-out',
    glyph: '▁',
    blurb: "Half a bar of silence, then B's keyword hits on the downbeat.",
    bars: 0.5,
    ok: (c) => c.bHits > 0,
    score: (c) => 0.45 + (up(c) > 0 ? 0.3 : 0),
    reason: () => 'silence before the word makes it land harder',
  },
}

export const MOVE_LIST = Object.values(MOVES)

export function legalMoves(c: SeamContext): MoveDef[] {
  return MOVE_LIST.filter((m) => m.ok(c))
}
