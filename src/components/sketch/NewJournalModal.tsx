'use client';

/**
 * Shibu-Sketch — "New journal" modal with the cover designer.
 *
 * Also exports:
 * - `CoverPreview` — pure CSS/SVG renderer for a CoverStyle, reused by
 *   SearchOverlay / GridView chips and cards (fully container-relative,
 *   scales to any wrapper size).
 * - `mulberry32` + `scatterCollageEmoji` — deterministic seeded helpers so
 *   collage covers scatter identically in the preview and on the shelf.
 */

import { useEffect, useId, useMemo, useState } from 'react';

import { Loader2, Plus } from 'lucide-react';

import type { CoverKind, CoverPattern, CoverStyle } from '@/lib/sketch/types';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/* ------------------------------------------------------------------ */
/* Deterministic helpers                                               */
/* ------------------------------------------------------------------ */

/** Tiny fast seeded PRNG (mulberry32). Same seed → same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CollageEmojiPlacement {
  emoji: string;
  /** x in a 90-unit-wide space (3:4 cover). */
  x: number;
  /** y in a 120-unit-tall space. */
  y: number;
  size: number;
  rotation: number;
}

/**
 * Deterministically scatter emojis across a 90×120 cover space.
 * Same (emoji, seed) → identical layout in the preview and the final cover.
 */
export function scatterCollageEmoji(
  emoji: string[],
  seed: number,
): CollageEmojiPlacement[] {
  if (emoji.length === 0) return [];
  const rand = mulberry32(seed || 1);
  const count = Math.min(14, Math.max(8, emoji.length * 3));
  const out: CollageEmojiPlacement[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      emoji: emoji[i % emoji.length],
      x: 12 + rand() * 66,
      y: 14 + rand() * 90,
      size: 12 + rand() * 9,
      rotation: Math.round(-32 + rand() * 64),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

export const COVER_COLORS: readonly string[] = [
  '#3fae5a', // green
  '#2c6e49', // forest
  '#3aa7a3', // teal
  '#4a90d9', // blue
  '#2f3542', // navy-charcoal
  '#e8574d', // red
  '#f4795b', // coral
  '#f2a33c', // orange
  '#f7d154', // yellow
  '#e56b8c', // rose
  '#a2704b', // brown
  '#faf8f4', // cream
];

export const COVER_PATTERNS: readonly CoverPattern[] = [
  'dots',
  'stripes',
  'grid',
  'leaves',
  'shapes',
  'speckle',
  'solar',
  'fruit',
];

export const COVER_EMOJIS: readonly string[] = [
  '✨', '🌸', '📚', '🎬', '✈️', '🎂', '🐱', '🌿', '⭐', '🍓', '☀️', '🎵',
];

const MAX_EMOJIS = 5;

type DesignerKind = Exclude<CoverKind, 'photo'>;

const KIND_TABS: readonly { value: DesignerKind; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'collage', label: 'Collage' },
];

/* ------------------------------------------------------------------ */
/* PatternLayer — hand-drawn SVG patterns                              */
/* ------------------------------------------------------------------ */

interface PatternLayerProps {
  pattern: CoverPattern;
  accent: string;
  seed: number;
}

/** Absolutely-positioned SVG pattern overlay (fills its nearest positioned parent). */
export function PatternLayer({ pattern, accent, seed }: PatternLayerProps) {
  const rawId = useId();
  const pid = `skp-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const speckleDots = useMemo(() => {
    if (pattern !== 'speckle') return [];
    const rand = mulberry32(seed || 1);
    return Array.from({ length: 9 }, () => ({
      cx: 1 + rand() * 12,
      cy: 1 + rand() * 12,
      r: 0.35 + rand() * 0.55,
    }));
  }, [pattern, seed]);

  return (
    <svg
      viewBox="0 0 90 120"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        {pattern === 'dots' && (
          <pattern id={pid} width="9" height="9" patternUnits="userSpaceOnUse">
            <circle cx="4.5" cy="4.5" r="1.25" fill={accent} opacity="0.55" />
          </pattern>
        )}
        {pattern === 'stripes' && (
          <pattern
            id={pid}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="3" height="8" fill={accent} opacity="0.4" />
          </pattern>
        )}
        {pattern === 'grid' && (
          <pattern id={pid} width="12" height="12" patternUnits="userSpaceOnUse">
            <path
              d="M12 0H0V12"
              fill="none"
              stroke={accent}
              strokeWidth="0.8"
              opacity="0.45"
            />
          </pattern>
        )}
        {pattern === 'leaves' && (
          <pattern id={pid} width="20" height="20" patternUnits="userSpaceOnUse">
            <ellipse
              cx="5.5"
              cy="5.5"
              rx="4.2"
              ry="1.9"
              transform="rotate(32 5.5 5.5)"
              fill={accent}
              opacity="0.45"
            />
            <ellipse
              cx="15"
              cy="15"
              rx="4.2"
              ry="1.9"
              transform="rotate(-28 15 15)"
              fill={accent}
              opacity="0.35"
            />
          </pattern>
        )}
        {pattern === 'shapes' && (
          <pattern id={pid} width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="5" cy="5" r="2.2" fill={accent} opacity="0.45" />
            <rect
              x="13"
              y="3"
              width="5.5"
              height="5.5"
              rx="1"
              transform="rotate(14 15.75 5.75)"
              fill={accent}
              opacity="0.35"
            />
            <path d="M5 14.5 8.5 20H1.5Z" fill={accent} opacity="0.4" />
            <circle cx="16.5" cy="17" r="1.5" fill={accent} opacity="0.5" />
          </pattern>
        )}
        {pattern === 'speckle' && (
          <pattern id={pid} width="14" height="14" patternUnits="userSpaceOnUse">
            {speckleDots.map((d, i) => (
              <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill={accent} opacity="0.5" />
            ))}
          </pattern>
        )}
        {pattern === 'solar' && (
          <pattern id={pid} width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="11" cy="11" r="3.6" fill={accent} opacity="0.5" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
              <line
                key={deg}
                x1="11"
                y1="4.6"
                x2="11"
                y2="2.4"
                stroke={accent}
                strokeWidth="1"
                strokeLinecap="round"
                opacity="0.5"
                transform={`rotate(${deg} 11 11)`}
              />
            ))}
          </pattern>
        )}
        {pattern === 'fruit' && (
          <pattern id={pid} width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="6" cy="10" r="3.4" fill={accent} opacity="0.5" />
            <path
              d="M6 6.4q1.4-2.2 3.4-2.4"
              fill="none"
              stroke={accent}
              strokeWidth="0.9"
              strokeLinecap="round"
              opacity="0.65"
            />
            <ellipse cx="13.5" cy="5" rx="2.6" ry="1.2" transform="rotate(38 13.5 5)" fill={accent} opacity="0.4" />
            <circle cx="14.5" cy="14" r="2.2" fill={accent} opacity="0.35" />
          </pattern>
        )}
      </defs>
      <rect width="90" height="120" fill={`url(#${pid})`} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* CoverPreview                                                        */
/* ------------------------------------------------------------------ */

export interface CoverPreviewProps {
  style: CoverStyle;
  /** Render the printed title overlay (disable for tiny chips). */
  showTitle?: boolean;
  className?: string;
}

/**
 * Pure CSS/SVG journal cover renderer. Fills its wrapper (`h-full w-full`),
 * so size/rounding/overflow live on the parent. Everything is proportional —
 * one implementation serves the 112px modal preview, search chips and grid cards.
 */
export function CoverPreview({ style, showTitle = true, className }: CoverPreviewProps) {
  const isCollage = style.kind === 'collage';
  const scatter = useMemo(
    () => (isCollage ? scatterCollageEmoji(style.emoji ?? [], style.seed) : []),
    [isCollage, style.emoji, style.seed],
  );
  const gradient =
    style.kind === 'gradient'
      ? `linear-gradient(160deg, ${style.color} 0%, ${style.color2 ?? style.color} 100%)`
      : undefined;

  return (
    <div
      role="img"
      aria-label={style.title ? `Journal cover: ${style.title}` : 'Journal cover'}
      className={cn('@container relative h-full w-full overflow-hidden', className)}
      style={
        gradient
          ? { backgroundImage: gradient }
          : { backgroundColor: style.color }
      }
    >
      {/* spine shading + fore-edge light, like a physical book */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[7%] bg-gradient-to-r from-black/25 via-black/5 to-transparent"
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 w-[4%] bg-gradient-to-l from-white/15 to-transparent"
      />

      {style.kind === 'pattern' && (
        <PatternLayer
          pattern={style.pattern ?? 'dots'}
          accent={style.color2 ?? '#ffffff'}
          seed={style.seed}
        />
      )}

      {isCollage && (
        <svg
          viewBox="0 0 90 120"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {scatter.map((it, i) => (
            <text
              key={i}
              x={it.x}
              y={it.y}
              fontSize={it.size}
              textAnchor="middle"
              dominantBaseline="central"
              transform={`rotate(${it.rotation} ${it.x} ${it.y})`}
            >
              {it.emoji}
            </text>
          ))}
        </svg>
      )}

      {showTitle && style.title ? (
        <div className="absolute inset-x-[8%] bottom-[9%] text-center">
          <span className="line-clamp-2 font-bold leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)] text-[13cqw]">
            {style.title}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export interface NewJournalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the trimmed title + fully-built CoverStyle. */
  onCreate: (input: { title: string; coverStyle: CoverStyle }) => void;
  /** Disables Create and shows a spinner while the journal is being created. */
  creating?: boolean;
}

export function NewJournalModal({
  open,
  onOpenChange,
  onCreate,
  creating = false,
}: NewJournalModalProps) {
  const [kind, setKind] = useState<DesignerKind>('solid');
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<string>(COVER_COLORS[0]);
  const [color2, setColor2] = useState<string>(COVER_COLORS[5]);
  const [pattern, setPattern] = useState<CoverPattern>('dots');
  const [emojis, setEmojis] = useState<string[]>(['✨', '📚']);
  /**
   * Seed captured when the modal opens (Date.now() % 100000) so the preview
   * scatter is identical to the created cover (WYSIWYG) and deterministic.
   */
  const [seed, setSeed] = useState(77);

  useEffect(() => {
    if (!open) return;
    // Async callback (not synchronous) → fresh seed per open, WYSIWYG preview.
    const t = window.setTimeout(() => setSeed(Date.now() % 100000), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const liveStyle: CoverStyle = useMemo(
    () => ({
      kind,
      color,
      color2: kind === 'gradient' ? color2 : undefined,
      pattern: kind === 'pattern' ? pattern : undefined,
      emoji: kind === 'collage' ? emojis : undefined,
      title: title.trim() || undefined,
      seed,
    }),
    [kind, color, color2, pattern, emojis, title, seed],
  );

  const canCreate = title.trim().length > 0 && !creating;

  const handleCreate = () => {
    if (!canCreate) return;
    onCreate({ title: title.trim(), coverStyle: liveStyle });
  };

  const toggleEmoji = (e: string) => {
    setEmojis((prev) => {
      if (prev.includes(e)) return prev.filter((x) => x !== e);
      if (prev.length >= MAX_EMOJIS) return prev;
      return [...prev, e];
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] gap-5 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New journal</DialogTitle>
          <DialogDescription>
            Design a cover — it stands on your shelf.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-4">
          <div className="relative aspect-[3/4] w-28 shrink-0 overflow-hidden rounded-xl shadow-xl">
            <CoverPreview style={liveStyle} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Input
              value={title}
              maxLength={60}
              placeholder="Journal title"
              aria-label="Journal title"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
            />
            <Tabs
              value={kind}
              onValueChange={(v) => setKind(v as DesignerKind)}
            >
              <TabsList className="grid w-full grid-cols-4">
                {KIND_TABS.map((k) => (
                  <TabsTrigger key={k.value} value={k.value}>
                    {k.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>

        <div className="space-y-4">
          <section>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              {kind === 'gradient' ? 'Start color' : 'Cover color'}
            </p>
            <SwatchRow
              colors={COVER_COLORS}
              value={color}
              onChange={setColor}
              ariaPrefix={kind === 'gradient' ? 'Gradient start color' : 'Cover color'}
            />
          </section>

          {kind === 'gradient' && (
            <section>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                End color
              </p>
              <SwatchRow
                colors={COVER_COLORS}
                value={color2}
                onChange={setColor2}
                ariaPrefix="Gradient end color"
              />
            </section>
          )}

          {kind === 'pattern' && (
            <section>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Pattern
              </p>
              <div className="flex flex-wrap gap-2">
                {COVER_PATTERNS.map((p) => (
                  <PatternButton
                    key={p}
                    pattern={p}
                    baseColor={color}
                    active={pattern === p}
                    onClick={() => setPattern(p)}
                  />
                ))}
              </div>
            </section>
          )}

          {kind === 'collage' && (
            <section>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Stickers ({emojis.length}/{MAX_EMOJIS})
              </p>
              <div className="flex flex-wrap gap-2">
                {COVER_EMOJIS.map((e) => {
                  const selected = emojis.includes(e);
                  return (
                    <button
                      key={e}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`Sticker ${e}`}
                      onClick={() => toggleEmoji(e)}
                      className={cn(
                        'inline-flex size-11 items-center justify-center rounded-lg bg-muted text-xl transition-all hover:scale-105',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected && 'bg-foreground/10 ring-1 ring-foreground',
                      )}
                    >
                      {e}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={!canCreate}>
            {creating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            {creating ? 'Creating…' : 'Create journal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Small local controls                                                */
/* ------------------------------------------------------------------ */

function SwatchRow({
  colors,
  value,
  onChange,
  ariaPrefix,
}: {
  colors: readonly string[];
  value: string;
  onChange: (c: string) => void;
  ariaPrefix: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaPrefix} className="flex flex-wrap gap-2">
      {colors.map((c) => {
        const selected = c === value;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${ariaPrefix} ${c}`}
            onClick={() => onChange(c)}
            style={{ backgroundColor: c }}
            className={cn(
              'size-11 rounded-full border border-black/10 shadow-sm transition-transform hover:scale-110',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              selected && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
            )}
          />
        );
      })}
    </div>
  );
}

function PatternButton({
  pattern,
  baseColor,
  active,
  onClick,
}: {
  pattern: CoverPattern;
  baseColor: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Pattern: ${pattern}`}
      onClick={onClick}
      className={cn(
        'relative size-11 overflow-hidden rounded-lg border border-black/10 transition-transform hover:scale-105',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundColor: baseColor }}
      >
        <PatternLayer pattern={pattern} accent="#ffffff" seed={5} />
      </span>
    </button>
  );
}
