'use client';

/**
 * Shibu-Sketch — shared UI chrome primitives.
 *
 * Design language (Paper-style):
 * - Ghost icon buttons: circular, `border-white/25` + `backdrop-blur-sm`, white icons.
 * - Dock buttons: solid white circles with dark #2f3542 icons and a soft shadow.
 * - Titles: bold white 4xl/5xl with a soft drop shadow; subtitle white/60.
 * - Everything sits on top of a 3D canvas → containers are pointer-events-none,
 *   interactive elements re-enable pointer-events themselves.
 * - All interactive touch targets are ≥ 44px.
 * - Neutral/white glass accents only (no indigo/blue-purple utility colors).
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Link2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* GhostIconButton                                                     */
/* ------------------------------------------------------------------ */

export interface GhostIconButtonProps
  extends Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  /** Icon node (usually a lucide-react icon with a size class). */
  icon: ReactNode;
  /** Accessible label (rendered as aria-label). */
  label: string;
  onClick?: () => void;
  /** Highlighted state (e.g. currently toggled overlay). */
  active?: boolean;
  className?: string;
}

/** Circular ghost button used across the top bars (glass circle, white icon). */
export function GhostIconButton({
  icon,
  label,
  onClick,
  active = false,
  disabled,
  className,
}: GhostIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'pointer-events-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full',
        'border border-white/25 bg-black/10 text-white backdrop-blur-sm',
        'transition-all duration-150 hover:bg-white/20 active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
        'disabled:pointer-events-none disabled:opacity-50 md:size-12',
        active && 'border-white/60 bg-white/25',
        className,
      )}
    >
      {icon}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* DockButton                                                          */
/* ------------------------------------------------------------------ */

export interface DockButtonProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

/** Solid white circle with a dark icon — the bottom dock buttons. */
export function DockButton({
  icon,
  label,
  onClick,
  disabled,
  className,
}: DockButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex size-12 items-center justify-center rounded-full bg-white text-[#2f3542]',
        'shadow-lg shadow-black/20 transition-all duration-150',
        'hover:scale-105 hover:bg-white active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/30',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      {icon}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* TitleBlock                                                          */
/* ------------------------------------------------------------------ */

export type TitleBlockMode = 'shelf' | 'open';

export interface TitleBlockProps {
  title: string;
  pageCount: number;
  /** 'shelf' = big centered journal title; 'open' = title above the open spread. */
  mode: TitleBlockMode;
  /** Overrides the default "N Pages" subtitle. */
  subtitle?: string;
  className?: string;
}

/** Centered journal title + "Link2 · N Pages" subtitle. */
export function TitleBlock({
  title,
  pageCount,
  mode,
  subtitle,
  className,
}: TitleBlockProps) {
  const fallbackSubtitle = `${pageCount} ${pageCount === 1 ? 'Page' : 'Pages'}`;
  return (
    <div
      aria-live="polite"
      className={cn(
        'pointer-events-none flex max-w-[min(88vw,32rem)] flex-col items-center gap-2 text-center',
        mode === 'open' && 'gap-1.5',
        className,
      )}
    >
      <h1 className="line-clamp-2 font-bold text-4xl text-white drop-shadow-sm md:text-5xl">
        {title}
      </h1>
      <p className="flex items-center gap-1.5 text-sm text-white/60">
        <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{subtitle ?? fallbackSubtitle}</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PageDots                                                            */
/* ------------------------------------------------------------------ */

export interface PageDotsProps {
  /** Current spread number (1-based). */
  current: number;
  /** Total number of spreads. */
  total: number;
  /** When provided the pill becomes a button that opens the page overview. */
  onClick?: () => void;
  className?: string;
}

/**
 * Top-center pill showing spread progress, e.g. "3 / 6"
 * (current spread in white, total in white/50).
 * Tapping it opens the all-pages contact sheet.
 */
export function PageDots({ current, total, onClick, className }: PageDotsProps) {
  // the reference reading view shows a single small "N Pages" pill — no dots
  const inner = (
    <span>
      {total} {total === 1 ? 'Page' : 'Pages'}
    </span>
  );
  const classes = cn(
    'inline-flex items-center rounded-full bg-black/25 px-3.5 py-1.5 text-sm font-medium tabular-nums text-white backdrop-blur-sm',
    onClick && 'pointer-events-auto transition hover:bg-black/40 active:scale-95',
    className,
  );
  if (!onClick) {
    return (
      <div role="status" aria-label={`Spread ${current} of ${total}`} className={classes}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={`${total} pages — open page overview`}
      className={classes}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* PaperWordmark                                                       */
/* ------------------------------------------------------------------ */

export interface PaperWordmarkProps {
  onClick?: () => void;
  className?: string;
}

/**
 * "Shibu Sketch" wordmark — 3 rounded vertical bars (book spines) + label.
 * Label is hidden on very narrow screens (icon only).
 */
export function PaperWordmark({ onClick, className }: PaperWordmarkProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Shibu Sketch — home"
      className={cn(
        'pointer-events-auto -ml-1.5 inline-flex min-h-11 items-center gap-2.5 rounded-full p-1.5 pr-3',
        'text-white transition-colors hover:bg-white/10 active:scale-[0.98]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-7 shrink-0 drop-shadow-sm"
        fill="currentColor"
        aria-hidden="true"
      >
        {/* three book spines of slightly different heights */}
        <rect x="3.5" y="5" width="4.2" height="16" rx="2.1" />
        <rect x="9.9" y="2.5" width="4.2" height="18.5" rx="2.1" />
        <rect x="16.3" y="6.5" width="4.2" height="14.5" rx="2.1" />
      </svg>
      <span className="hidden text-base font-semibold tracking-wide min-[420px]:inline">
        Shibu Sketch
      </span>
    </button>
  );
}
