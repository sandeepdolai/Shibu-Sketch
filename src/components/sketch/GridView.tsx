'use client';

/**
 * Shibu-Sketch — "All Journals" grid overlay (journals lying flat, covers up).
 *
 * Full-screen z-40 overlay with a CSS-3D vibe: each cover is tilted
 * `rotateX(6deg)` under a 600px perspective and flattens on hover.
 * The last cell is a dashed "New journal" card. 200ms opacity +
 * translate-y-4 enter/exit (keyframe animations on mount/class flip); Esc closes.
 */

import { useEffect, useState } from 'react';

import { Plus, X } from 'lucide-react';

import type { JournalDTO } from '@/lib/sketch/types';
import { cn } from '@/lib/utils';

import { GhostIconButton } from './chrome';
import { CoverPreview } from './NewJournalModal';

export interface GridViewProps {
  open: boolean;
  journals: JournalDTO[];
  onPick: (j: JournalDTO) => void;
  onClose: () => void;
  onNew: () => void;
}

const EXIT_MS = 200;

export function GridView({ open, journals, onPick, onClose, onNew }: GridViewProps) {
  // Keep mounted briefly after close so the exit animation can play.
  // State updates happen inside rAF/timeout callbacks (never synchronously).
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(raf);
    }
    const t = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="All journals"
      className={cn(
        'fixed inset-0 z-40 bg-gradient-to-b from-black/50 to-black/70 backdrop-blur-md',
        open
          ? 'animate-in fade-in-0 duration-200'
          : 'pointer-events-none animate-out fade-out-0 duration-200',
      )}
    >
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3 md:p-4">
        <h2 className="pointer-events-none font-bold text-xl text-white drop-shadow-sm md:text-2xl">
          All Journals
        </h2>
        <GhostIconButton icon={<X className="size-5" />} label="Close grid view" onClick={onClose} />
      </header>

      <div
        className="
          h-full overflow-y-auto overscroll-contain px-4 pb-8 pt-16 md:px-8 md:pb-12 md:pt-20
          [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20
          [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2
        "
      >
        <div
          className={cn(
            'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 md:gap-6 lg:grid-cols-5',
            open
              ? 'animate-in fade-in-0 slide-in-from-bottom-4 duration-200'
              : 'animate-out fade-out-0 slide-in-from-bottom-4 duration-200',
          )}
        >
          {journals.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => onPick(j)}
              aria-label={`Open ${j.title}`}
              className="
                group flex min-h-11 flex-col items-start gap-2 rounded-lg text-left
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60
              "
            >
              <span className="block w-full [perspective:600px]">
                <span
                  className="
                    relative block aspect-[3/4] w-full overflow-hidden rounded-lg
                    shadow-2xl shadow-black/40 transition-transform duration-300
                    [transform:rotateX(6deg)] group-hover:[transform:rotateX(0deg)]
                  "
                >
                  <CoverPreview style={j.coverStyle} />
                </span>
              </span>
              <span className="w-full min-w-0">
                <span className="block truncate text-sm font-semibold text-white">
                  {j.title}
                </span>
                <span className="block text-xs text-white/60">
                  {j.pageCount} {j.pageCount === 1 ? 'page' : 'pages'}
                </span>
              </span>
            </button>
          ))}

          <button
            type="button"
            onClick={onNew}
            aria-label="New journal"
            className="
              flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 rounded-lg
              border-2 border-dashed border-white/30 text-white/70 transition-colors
              hover:border-white/60 hover:bg-white/5 hover:text-white
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60
            "
          >
            <Plus className="size-8" aria-hidden="true" />
            <span className="text-sm font-semibold">New journal</span>
          </button>
        </div>
      </div>
    </div>
  );
}
