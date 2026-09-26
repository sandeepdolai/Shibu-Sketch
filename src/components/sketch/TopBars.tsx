'use client';

/**
 * Shibu-Sketch — top bars for the shelf and open-journal views.
 *
 * Both bars are absolutely positioned over the 3D canvas. The container is
 * `pointer-events-none`; every interactive child re-enables pointer events
 * (GhostIconButton / PaperWordmark / count pill all carry pointer-events-auto).
 */

import type { ReactNode } from 'react';

import { BookOpen, LayoutGrid, Menu, Search } from 'lucide-react';

import { GhostIconButton, PaperWordmark } from './chrome';

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
  onWordmark: () => void;
  /** Count pill click → grid view. */
  onGrid: () => void;
  onSearch: () => void;
  onMenu: () => void;
}

/** Top bar on the shelf view: wordmark left · count pill, search, menu right. */
export function ShelfTopBar({
  journalCount,
  onWordmark,
  onGrid,
  onSearch,
  onMenu,
}: ShelfTopBarProps) {
  return (
    <TopBarShell
      left={<PaperWordmark onClick={onWordmark} />}
      right={
        <>
          <button
            type="button"
            onClick={onGrid}
            aria-label={`${journalCount} ${journalCount === 1 ? 'journal' : 'journals'} — open grid view`}
            className={`
              pointer-events-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-full
              border border-white/25 bg-black/10 px-4 text-sm font-semibold text-white backdrop-blur-sm
              transition-all duration-150 hover:bg-white/20 active:scale-95
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70
            `}
          >
            {journalCount}
          </button>
          <GhostIconButton icon={<Search className={ICON} />} label="Search journals" onClick={onSearch} />
          <GhostIconButton icon={<Menu className={ICON} />} label="Menu" onClick={onMenu} />
        </>
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
  onGrid: () => void;
  onSearch: () => void;
  onMenu: () => void;
}

/** Top bar while a journal is open: back + grid left · search + menu right. */
export function OpenTopBar({ onBack, onGrid, onSearch, onMenu }: OpenTopBarProps) {
  return (
    <TopBarShell
      left={
        <>
          <GhostIconButton icon={<BookOpen className={ICON} />} label="Back to shelf" onClick={onBack} />
          <GhostIconButton icon={<LayoutGrid className={ICON} />} label="All journals" onClick={onGrid} />
        </>
      }
      right={
        <>
          <GhostIconButton icon={<Search className={ICON} />} label="Search" onClick={onSearch} />
          <GhostIconButton icon={<Menu className={ICON} />} label="Journal menu" onClick={onMenu} />
        </>
      }
    />
  );
}
