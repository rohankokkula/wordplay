# Changelog

All notable changes to this project will be documented in this file. See
[Conventional Commits](https://www.conventionalcommits.org/) and
[release-please](https://github.com/googleapis/release-please) — changelogs below
`v1.0.1` are generated automatically by merges to `main`.

## [1.1.0] - 2026-04-24

Wordplay 1.1.0 — _"From mixing tool to social music platform."_

### Features

- **ReactFlow mix canvas** — two-track vocal + instrument stems, draggable
  split nodes, color-coded FX transition edges, zustand graph store.
- **Demucs stem separation** — backend `POST /api/stems/separate` with hash-based
  caching; frontend `StemLoader` with spring-smoothed progress.
- **Instruments** — 5 curated synth beds (piano, 808, synthwave, lofi,
  afrobeat-perc) that can replace the original instrumental stem on the fly.
- **Social platform (Wordplay Wall 2.0)** — publish a mix with a name,
  `For You / Following / Trending` feeds, likes, comments, follows,
  notifications, public `/m/:slug` pages with OG previews, remix/fork flow
  that preserves the original mix graph for lineage.
- **Motion system** — spring-physics micro-interactions everywhere (drag,
  hover, page transitions, shared-element morphs for the persistent bottom
  player, magnetic snap on the canvas) via [motion.dev](https://motion.dev).
- **Design rewrite** — Tailwind + shadcn/ui replaces Mantine; dark violet
  theme matching the reference screenshots; `lucide-react` icons.
- **Settings + Themes** — `/settings` with Audio / Appearance / Account /
  About tabs, 4 theme palettes, reduced-motion toggle, keyboard shortcut
  cheat sheet.
- **Mobile-first shell** — responsive Tailwind layout with shadcn `Sheet`
  for sidebar, touch-friendly targets, pinch-zoom on the canvas.
- **Release automation** — `release-please` drives semver and CHANGELOG
  on every merge to `main`; frontend reads version from `package.json`,
  backend exposes it at `GET /api/version`.

### Breaking Changes

- **Invite code removed.** `POST /api/auth/google` no longer accepts or
  requires `invite_code`. `loginWithGoogle(idToken, inviteCode)` → `loginWithGoogle(idToken)`.
- **Genre presets trimmed to `neutral` only.** The sidebar genre grid is
  gone; the new **Instruments** node replaces it.

## [1.0.1] - 2026-04-24

Baseline release — last snapshot before the v1.1.0 rework. No functional
changes; marks the cut-over point for Conventional Commits + release-please.
