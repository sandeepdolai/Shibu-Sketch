'use client';

/**
 * Shibu-Sketch — "All pages" contact sheet (open mode).
 *
 * A full-screen overlay listing every page of the open journal as a rendered
 * paper thumbnail (same renderer the 3D engine + PNG exports use, so the
 * previews match exactly). Tap a page to glide the book to its spread.
 *
 * Thumbnails render in the background (2 per beat) with pulse skeletons, so a
 * 200-page journal still opens instantly. Esc / backdrop / X close.
 */

import { useEffect, useState } from 'react';

import { X } from 'lucide-react';

import { contentToDataURL, preloadImages } from '@/lib/sketch/render';
import type { PageDTO } from '@/lib/sketch/types';
import { cn } from '@/lib/utils';

import { GhostIconButton } from './chrome';

export interface PageGridOverlayProps {
  open: boolean;
  journalTitle: string;
  pages: PageDTO[];
  paperColor: string;
  /** 0-based spread the reader is currently on (its two pages get a badge). */
  currentSpread: number;
  onPick: (pageIndex: number) => void;
  onClose: () => void;
}

const EXIT_MS = 200;
const THUMB_W = 220;
const THUMB_H = 308; // 5:7 — matches the page aspect (620×868)

/** Does the page carry anything at all (used for the "Blank" watermark)? */
function isBlank(p: PageDTO): boolean {
  const c = p.content;
  return (
    (!c.strokes || c.strokes.length === 0) &&
    (!c.texts || c.texts.length === 0) &&
    (!c.stickers || c.stickers.length === 0) &&
    (!c.photos || c.photos.length === 0)
  );
}

export function PageGridOverlay({
  open,
  journalTitle,
  pages,
  paperColor,
  currentSpread,
  onPick,
  onClose,
}: PageGridOverlayProps) {
  // Keep mounted briefly after close so the exit animation can play.
  const [mounted, setMounted] = useState(open);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

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

  /* Render thumbnails in the background, 2 per beat; photos must be primed
     before canvas drawing (same constraint as the engine's page textures). */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // clear previous thumbs (async, so the effect body stays side-effect free)
    const clearRaf = requestAnimationFrame(() => setThumbs({}));
    (async () => {
      await Promise.resolve();
      for (let i = 0; i < pages.length; i++) {
        if (cancelled) return;
        const p = pages[i];
        try {
          await preloadImages(p.content);
        } catch {
          /* a broken photo shouldn't block the rest of the sheet */
        }
        if (cancelled) return;
        let url = '';
        try {
          url = contentToDataURL(p.content, THUMB_W, THUMB_H, paperColor);
        } catch {
          url = '';
        }
        if (cancelled) return;
        setThumbs((cur) => ({ ...cur, [p.id]: url }));
        if (i % 2 === 1) {
          await new Promise((r) => window.setTimeout(r, 30));
        }
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(clearRaf);
    };
  }, [open, pages, paperColor]);

  if (!mounted) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`All pages in ${journalTitle}`}
      className={cn(
        'fixed inset-0 z-40 bg-gradient-to-b from-black/50 to-black/70 backdrop-blur-md',
        open
          ? 'animate-in fade-in-0 duration-200'
          : 'pointer-events-none animate-out fade-out-0 duration-200',
      )}
    >
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3 md:p-4">
        <div className="pointer-events-none">
          <h2 className="font-bold text-xl text-white drop-shadow-sm md:text-2xl">
            {journalTitle}
          </h2>
          <p className="text-xs text-white/60 md:text-sm">
            {pages.length} {pages.length === 1 ? 'page' : 'pages'} · tap a page to jump
          </p>
        </div>
        <GhostIconButton icon={<X className="size-5" />} label="Close page overview" onClick={onClose} />
      </header>

      <div
        className="
          h-full overflow-y-auto overscroll-contain px-4 pb-8 pt-20 md:px-8 md:pb-12 md:pt-24
          [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20
          [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2
        "
      >
        <div
          className={cn(
            'mx-auto grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 md:gap-5',
            open
              ? 'animate-in fade-in-0 slide-in-from-bottom-4 duration-200'
              : 'animate-out fade-out-0 slide-in-from-bottom-4 duration-200',
          )}
        >
          {pages.map((p, i) => {
            const inSpread = i === currentSpread * 2 || i === currentSpread * 2 + 1;
            const url = thumbs[p.id];
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(i)}
                aria-label={`Go to page ${i + 1}`}
                aria-current={inSpread ? 'true' : undefined}
                className="
                  group flex min-h-11 flex-col items-start gap-2 rounded-lg text-left
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60
                "
              >
                <span
                  className={cn(
                    'relative block w-full [perspective:600px]',
                    inSpread && 'drop-shadow-[0_0_10px_rgba(255,255,255,0.35)]',
                  )}
                >
                  <span
                    className={cn(
                      'relative block aspect-[5/7] w-full overflow-hidden rounded-lg transition-transform duration-300 [transform:rotateX(6deg)] group-hover:[transform:rotateX(0deg)]',
                      inSpread
                        ? 'ring-2 ring-white'
                        : 'ring-1 ring-white/15 group-hover:ring-white/40',
                    )}
                    style={{ backgroundColor: paperColor || '#faf8f4' }}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt={`Page ${i + 1} preview`}
                        className="block h-full w-full object-cover"
                        draggable={false}
                      />
                    ) : (
                      <span className="absolute inset-0 animate-pulse rounded-lg bg-black/10" />
                    )}
                    {url && isBlank(p) && (
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400/70">
                        Blank
                      </span>
                    )}
                    {/* page number chip */}
                    <span
                      className={cn(
                        'absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums shadow-sm',
                        inSpread ? 'bg-white text-zinc-900' : 'bg-black/45 text-white',
                      )}
                    >
                      {i + 1}
                    </span>
                    {inSpread && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-900 shadow-sm">
                        Reading
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
