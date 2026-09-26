# Task S2-d — Shibu-Sketch UI Chrome Components

Agent: frontend-styling-expert (Shibu-Sketch UI chrome subagent)
Date: 2026-02 (work session)
Status: COMPLETE — tsc clean, lint clean, temp check file deleted

## Task
Build all 2D UI chrome for the Shibu-Sketch Paper-app clone (Next.js 16 + TS + Tailwind 4 + shadcn/ui):
top bars, bottom dock, page scrubber, new-journal cover designer, journal menu, search overlay, grid
view, toasts, share sheet — in `src/components/sketch/` only. No routes, no src/lib/src/app edits,
no SketchApp/SceneCanvas/DrawingOverlay.

## Files created (10, all `'use client'`, typed exported prop interfaces)
| File | Exports |
|---|---|
| chrome.tsx | GhostIconButton, DockButton, TitleBlock, PageDots, PaperWordmark (+ prop interfaces, TitleBlockMode) |
| TopBars.tsx | ShelfTopBar, OpenTopBar |
| BottomDock.tsx | BottomDock (variant 'shelf'\|'open', hidden animation), BottomDockVariant |
| PageScrubber.tsx | PageScrubber (pointer-capture drag, role=slider) |
| NewJournalModal.tsx | NewJournalModal, CoverPreview (reused by Search/Grid), PatternLayer, mulberry32, scatterCollageEmoji, COVER_COLORS/PATTERNS/EMOJIS, CollageEmojiPlacement |
| JournalMenu.tsx | JournalMenu (+ JournalMenuMode) — nested AlertDialog two-step delete |
| SearchOverlay.tsx | SearchOverlay — glass panel, Enter picks first, Esc/backdrop close |
| GridView.tsx | GridView — perspective rotateX(6deg) cards, dashed New card, animate-in/out, delayed unmount |
| Toasts.tsx | useSketchToast() → { toast(msg, kind) } — wraps the GLOBAL radix shadcn toaster (repo is NOT sonner; Toaster already mounted in layout.tsx — do not mount another) |
| ShareSheet.tsx | ShareSheet — 3 rows, "Copied!" feedback 1.5s |

## Key decisions
- Design tokens per spec: ghost circles `border-white/25 backdrop-blur-sm`; dock white `size-12`
  circles with `#2f3542` icons, `shadow-lg shadow-black/20`, `hover:scale-105 active:scale-95`;
  titles `text-4xl md:text-5xl font-bold text-white drop-shadow-sm`; subtitle `text-white/60 text-sm`
  + Link2 size-3.5; wordmark = 3 rounded book-spine SVG bars + "Shibu Sketch" (label hidden <420px).
  All touch targets ≥44px. White/neutral glass accents only.
- CoverPreview is fully proportional (spine shading, SVG pattern tiles, SVG emoji scatter, `@container`
  + `text-[13cqw]` title) — one component serves modal preview, search chips, grid cards.
- NewJournalModal seed: `Date.now()%100000` captured at modal open via timeout callback and reused at
  create → preview scatter == final cover (WYSIWYG, deterministic via mulberry32).
- Optional handlers (onDuplicate / onExportPng / onExportPage) → their menu rows are hidden, not disabled.
  Delete row hidden when `canDelete=false`.
- Next 16's new `react-hooks/set-state-in-effect` lint rule: all state resets done via timeout/rAF
  callbacks or wrapped onOpenChange handlers (never synchronous setState in effects).
- GridView enter animation uses `animate-in` keyframes (mount-time), exit uses `animate-out` +
  200ms delayed unmount; Esc closes.
- PageDots implemented as the "current / total" spread pill (spec allowed either form).
- Dock share icon = Upload (Paper up-tray look); `variant` only changes aria labels.

## Verification
- `bunx tsc --noEmit`: 0 errors in src/components/sketch + temp file. (Remaining project errors are
  pre-existing and owned by others: `skills/*` scripts, `src/lib/sketch/render.ts`.)
- `bun run lint`: clean (exit 0, whole project).
- `/home/z/my-project/tests/chrome-import-check.ts` compiled every named export (value + type) →
  PASSED → deleted (tests/ left as before).

## Notes for integrator (S3)
- TopBars/BottomDock/PageScrubber are absolute/fixed overlays: mount them inside each view root over
  the 3D canvas; their containers are pointer-events-none, controls re-enable pointer events.
- TitleBlock/PageDots are pointer-events-none presentational — position them in the view layout
  (TitleBlock center for shelf; PageDots top-center for open view).
- CoverPreview expects a sized wrapper (it fills `h-full w-full`; parent owns rounding/overflow/shadow).
- Toast usage: `const { toast } = useSketchToast(); toast('Saved', 'success')`.
