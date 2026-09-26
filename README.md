# Shibu Sketch

**A pocket journal studio in your browser** — sketch, sticker, and flip through
beautiful 3D notebooks. A web recreation of the classic Paper journaling
experience, built from scratch with Next.js 16, TypeScript and three.js.

> Personal project. All covers, page art and sounds are generated
> procedurally in the browser — no third-party assets.

## The experience

- **Shelf** — your journals stand upright on a shelf. Drag to browse; the
  selected journal lifts off the shelf with a soft shadow.
- **The blossom open** — tap a journal: it lifts, swings open around its
  vertical spine while standing, then lays flat into a reading spread while
  the room fades to dusk. ~1.3s, fully choreographed.
- **Real page turns** — tap the page edges (or use ←/→, or drag the scrubber).
  Pages flip right-to-left with true paper curl, moving shadows, a subtle
  whole-book lean, and a generated paper *swoosh*. Stacks fan on both sides
  and grow/shrink sheet by sheet.
- **Draw on the pages** — tap a page center: a full 2D editor opens with pen,
  marker, highlighter and eraser, a Paper-style palette, text, emoji/shape
  stickers, tape, washi, photo upload (polaroid frames!), undo/redo. Saving
  bakes your art straight back onto the 3D page.
- **Everything is live data** — journals and pages live in SQLite via Prisma;
  every stroke is vector JSON, so pages re-render crisply at any size.

## Stack

| Layer | Tech |
| --- | --- |
| App | Next.js 16 (App Router) + TypeScript |
| 3D | three.js — custom journal/sheet geometry, paper-curl deformation, choreographed camera rig |
| Art | 100% procedural Canvas2D (covers, paper grain, fore-edge stripes, shadow blobs, SFX) |
| Data | Prisma + SQLite — `SketchJournal` / `SketchPage` (content JSON) |
| UI | Tailwind 4 + shadcn/ui + lucide-react |

## Run

```bash
bun install
bun run db:push      # create SQLite schema
bun run dev          # http://localhost:3000
```

The app seeds four demo journals on first launch (Movies, Sketchbook,
Trips, birthday bby). REST endpoints live under `/api/sketch/*`
(journals · pages · seed).

## Project layout

```
src/lib/sketch3d/     3D engine: sheet geometry + curl, journal builder,
                      shelf/open/flip scene controller, procedural art, sfx
src/lib/sketch/       content contracts, page-content renderer, demo data
src/components/sketch/ app shell + chrome (shelf/open bars, dock, scrubber,
                      grid view, search, modals) + the drawing editor
src/app/api/sketch/   REST endpoints
```

## The ACAN3D heritage

This codebase evolved from ACAN3D, an AI-controllable 3D editor built in the
same workspace. Its engine primitives (rounded sheet geometry, page-turn
deformation, procedural textures) are reused here; the full editor code still
lives under `src/lib/engine` and `src/components/editor`. See
`docs/ARCHITECTURE.md` and `docs/AGENT_API.md` for that side of the house.
