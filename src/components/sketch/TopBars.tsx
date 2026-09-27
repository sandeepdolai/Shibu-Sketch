'use client';

/**
 * Shibu-Sketch — top bars for the shelf and open-journal views.
 *
 * Both bars are absolutely positioned over the 3D canvas. The container is
 * `pointer-events-none`; every interactive child re-enables pointer events
 * (GhostIconButton / PaperWordmark / count pill all carry pointer-events-auto).
 */

import type { ReactNode } from 'react';

import { BookOpen, Search, Volume2, VolumeX } from 'lucide-react';

import { GhostIconButton } from './chrome';

const ICON = 'size-5';

function TopBarShell({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-2 p-3 md:p-4">
      <div className="flex items-center gap-2 md:gap-2.5">{left}</div>
      <div className="flex items-center gap-2 md:gap-2.5">{right}</div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* ShelfTopBar                                                         */
/* ------------------------------------------------------------------ */

export interface ShelfTopBarProps {
  /** Number of journals — rendered inside the count pill. */
  journalCount: number;
  /** Count pill click → grid view. */
  onGrid: () => void;
}

/** Top bar on the shelf view — deliberately MINIMAL like the reference app:
 *  nothing but a small translucent count pill in the top-right corner. */
export function ShelfTopBar({ journalCount, onGrid }: ShelfTopBarProps) {
  return (
    <TopBarShell
      left={null}
      right={
        <button
          type="button"
          onClick={onGrid}
          aria-label={`${journalCount} ${journalCount === 1 ? 'journal' : 'journals'} — open grid view`}
          className={`
            pointer-events-auto inline-flex h-9 min-w-9 items-center justify-center rounded-full
            bg-black/10 px-2.5 text-xs font-semibold text-white/80 backdrop-blur-sm
            transition-all duration-150 hover:bg-white/20 hover:text-white active:scale-95
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70
          `}
        >
          {journalCount}
        </button>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* OpenTopBar                                                          */
/* ------------------------------------------------------------------ */

export interface OpenTopBarProps {
  /** Back to shelf. */
  onBack: () => void;
  onSearch: () => void;
  /** Muted state for generated UI sounds. */
  soundMuted?: boolean;
  onToggleSound?: () => void;
}

/** Top bar while a journal is open — minimal like the reference: a small
 *  back arrow on the left, sound + search on the right. */
export function OpenTopBar({ onBack, onSearch, soundMuted, onToggleSound }: OpenTopBarProps) {
  return (
    <TopBarShell
      left={<GhostIconButton icon={<BookOpen className={ICON} />} label="Back to shelf" onClick={onBack} />}
      right={
        <>
          {onToggleSound && (
            <GhostIconButton
              icon={soundMuted ? <VolumeX className={ICON} /> : <Volume2 className={ICON} />}
              label={soundMuted ? 'Unmute sounds' : 'Mute sounds'}
              onClick={onToggleSound}
            />
          )}
          <GhostIconButton icon={<Search className={ICON} />} label="Search" onClick={onSearch} />
        </>
      }
    />
  );
}
