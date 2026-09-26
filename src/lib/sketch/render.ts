/**
 * Shibu-Sketch — shared page-content renderer.
 *
 * Draws a PageContent (vector ops JSON: photos → stickers → strokes → texts over
 * a paper background) onto a 2D canvas. ALL coordinates inside PageContent are
 * NORMALIZED (0..1) relative to the page rect; the renderer scales them by the
 * supplied cssW/cssH, so output is identical in the 2D editor, on 3D page
 * textures and in PNG exports.
 *
 * DOM usage is guarded (typeof document/Image checks) so this module can be
 * imported safely in non-browser environments; the drawing functions themselves
 * need a real CanvasRenderingContext2D.
 */

import type {
  DrawTool,
  PageContent,
  PhotoItem,
  StickerItem,
  Stroke,
  TextFont,
  TextItem,
} from './types';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_PAPER = '#faf8f4';

/** Paper-like palette shown in the editor (also a sensible default anywhere). */
export const SUGGESTED_COLORS: string[] = [
  '#2b2b2b', // black
  '#8a8a8a', // grey
  '#e8862e', // orange (brand)
  '#d9534f', // red
  '#e87ea1', // pink
  '#f2c14e', // yellow
  '#6aa84f', // green
  '#45a9a2', // teal
  '#5b8def', // blue
  '#8d6e63', // brown
  '#faf8f4', // cream / paper
];

/** Sticker emoji palette (~24 relevant + a few extra moods). */
export const STICKER_EMOJIS: string[] = [
  '🌟', '⭐️', '✨', '🔥', '🌈', '🌙', '☀️',
  '🍕', '🎸', '🎬', '📷', '🎞️', '🎟️', '✈️',
  '🏝️', '🗺️', '🎂', '🎈', '🎁', '💐', '🌸',
  '📚', '✏️', '🎵', '❤️', '🧡', '💛', '💚', '💙', '💜',
];

/** Procedural vector shapes for 'shape' stickers. */
export const STICKER_SHAPES: { id: string; value: string }[] = [
  { id: 'star', value: 'star' },
  { id: 'heart', value: 'heart' },
  { id: 'circle', value: 'circle' },
  { id: 'triangle', value: 'triangle' },
  { id: 'squiggle', value: 'squiggle' },
  { id: 'arrow', value: 'arrow' },
];

/** Washi-tape colors offered by the sticker picker. */
export const TAPE_COLORS: string[] = ['#e8b4b8', '#a8d5ba', '#f2c14e', '#9db4d0'];

/** CSS font stacks — canvas must NOT rely on next/font CSS variables. */
export const FONT_STACKS: Record<TextFont, string> = {
  hand: '"Comic Sans MS", "Segoe Print", cursive',
  sans: 'system-ui, sans-serif',
  typewriter: '"Courier New", monospace',
};

const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

/** Defaults shared with the editor. */
export const DEFAULT_TEXT_SIZE = 0.055; // fraction of page width
export const DEFAULT_STICKER_SIZE = 0.16;
export const DEFAULT_PHOTO_W = 0.5;

const SHAPE_COLOR_DEFAULT = '#e8862e';

/* ------------------------------------------------------------------ */
/* Small utils                                                         */
/* ------------------------------------------------------------------ */

/** Deterministic PRNG (mulberry32). Rendering must never use Math.random. */
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

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function isHexColor(s: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());
}

/** Paper tint resolution order: opts.paperColor → content.bg → DEFAULT_PAPER. */
export function paperColorOf(content: PageContent, opts?: { paperColor?: string }): string {
  return opts?.paperColor ?? content.bg ?? DEFAULT_PAPER;
}

/* ------------------------------------------------------------------ */
/* Image cache (photo dataUrls)                                        */
/* ------------------------------------------------------------------ */

const imageCache = new Map<string, HTMLImageElement>();
const pendingLoads = new Map<string, Promise<boolean>>();

function loadImage(dataUrl: string): Promise<boolean> {
  const p = pendingLoads.get(dataUrl);
  if (p) return p;
  const promise = new Promise<boolean>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      imageCache.set(dataUrl, img);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
  pendingLoads.set(dataUrl, promise);
  void promise.finally(() => pendingLoads.delete(dataUrl));
  return promise;
}

/**
 * Returns the loaded <img> for a dataUrl, or null (kicking off a load once).
 * Callers should draw a placeholder and re-render when preloadImages resolves.
 */
export function lookupImage(dataUrl: string): HTMLImageElement | null {
  const img = imageCache.get(dataUrl);
  if (img) return img.complete && img.naturalWidth > 0 ? img : null;
  void loadImage(dataUrl);
  return null;
}

/** Preloads every url-kind photo in the content. Resolves when all settle. */
export function preloadImages(content: PageContent): Promise<void> {
  const urls = content.photos
    .filter((p) => p.kind === 'url' && typeof p.dataUrl === 'string' && p.dataUrl.length > 0)
    .map((p) => p.dataUrl as string);
  if (urls.length === 0) return Promise.resolve();
  return Promise.all(urls.map((u) => loadImage(u))).then(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Geometry / hit-testing helpers (exported for reuse)                 */
/* ------------------------------------------------------------------ */

export interface NormRect {
  /** normalized top-left */
  x: number;
  y: number;
  /** normalized extent */
  w: number;
  h: number;
}

/** Line-width multiplier per tool relative to stroke.size. */
export const TOOL_WIDTH_MULT: Record<DrawTool, number> = {
  pen: 1,
  marker: 1.15,
  highlighter: 2.6,
  eraser: 1.6,
};

/** Approx width of one text line (normalized) without a measuring context. */
function estimateLineWidth(text: string, fontSizeNorm: number): number {
  if (!text) return 0;
  // Rough average glyph width ≈ 0.55em for these stacks.
  return text.length * fontSizeNorm * 0.55;
}

/**
 * Normalized bbox of a text block (centered on the item anchor), incl. padding.
 * `measure(line, fontSizePx, fontCss)` may be provided for exact widths (px).
 */
export function textRect(
  t: TextItem,
  cssW: number,
  cssH: number,
  measure?: (line: string, fontSizePx: number, fontCss: string) => number,
): NormRect {
  const fs = t.size;
  const lh = t.lineHeight ?? 1.35;
  const lines = (t.text || '').split('\n');
  const fontCss = `${Math.max(4, fs * cssW)}px ${FONT_STACKS[t.font] ?? FONT_STACKS.sans}`;
  let w = 1;
  for (const line of lines) {
    const wPx = measure ? measure(line, Math.max(4, fs * cssW), fontCss) : estimateLineWidth(line, fs) * cssW;
    w = Math.max(w, wPx / Math.max(1, cssW));
  }
  const h = lines.length * fs * lh; // normalized already (fs normalized, lh unitless)
  const padX = 0.015;
  const padY = 0.012;
  return {
    x: t.x - (w / 2 + padX),
    y: t.y - (h / 2 + padY),
    w: w + padX * 2,
    h: h + padY * 2,
  };
}

/** Normalized bbox (centered) of a sticker. */
export function stickerRect(s: StickerItem): NormRect {
  const size = s.size;
  let w = size;
  let h = size;
  if (s.kind === 'tape') {
    w = size;
    h = size * 0.34;
  } else if (s.kind === 'frame') {
    w = size;
    h = size * 0.8;
  }
  const pad = 0.02;
  return { x: s.x - w / 2 - pad, y: s.y - h / 2 - pad, w: w + pad * 2, h: h + pad * 2 };
}

/** Normalized bbox (centered) of a photo incl. frame extras. */
export function photoRect(p: PhotoItem): NormRect {
  const w = p.w;
  const h = p.w * (p.aspect && p.aspect > 0 ? p.aspect : 1);
  let tw = w;
  let th = h;
  if ((p.frame ?? 'plain') === 'polaroid') {
    tw = w * 1.11;
    th = h + w * 0.24 + (p.caption ? w * 0.1 : 0);
  }
  const pad = 0.02;
  return { x: p.x - tw / 2 - pad, y: p.y - th / 2 - pad, w: tw + pad * 2, h: th + pad * 2 };
}

/**
 * Point-in-rotated-rect test. rect is centered on (cx,cy); all values normalized.
 * Rotation must be tested in aspect-corrected space (multiply x-deltas by cssW,
 * y-deltas by cssH) so angles match on-screen rendering.
 */
export function pointInRect(
  px: number,
  py: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  rotation = 0,
  aspect = 1, // cssW / cssH
): boolean {
  let dx = (px - cx) * aspect;
  let dy = py - cy;
  if (rotation) {
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    dx = rx;
    dy = ry;
  }
  return Math.abs(dx) <= (w * aspect) / 2 + 1e-9 && Math.abs(dy) <= h / 2 + 1e-9;
}

export type HitTarget = { type: 'text' | 'sticker' | 'photo'; id: string };

/**
 * Topmost-first hit test (texts → stickers → photos; strokes are not
 * selectable). Coordinates normalized. Pass cssW/cssH for aspect-correct
 * rotation; omit them for an unrotated-approximation test.
 */
export function hitTestContent(
  content: PageContent,
  nx: number,
  ny: number,
  opts?: {
    cssW?: number;
    cssH?: number;
    measure?: (line: string, fontSizePx: number, fontCss: string) => number;
  },
): HitTarget | null {
  const aspect = opts?.cssW && opts?.cssH ? opts.cssW / opts.cssH : 1;
  const inR = (
    px: number,
    py: number,
    r: NormRect,
    cx: number,
    cy: number,
    rot = 0,
  ): boolean => pointInRect(px, py, cx, cy, r.w, r.h, rot, aspect);

  for (let i = content.texts.length - 1; i >= 0; i--) {
    const t = content.texts[i];
    if (inR(nx, ny, textRect(t, opts?.cssW ?? 1, opts?.cssH ?? 1, opts?.measure), t.x, t.y, t.rotation))
      return { type: 'text', id: t.id };
  }
  for (let i = content.stickers.length - 1; i >= 0; i--) {
    const s = content.stickers[i];
    if (inR(nx, ny, stickerRect(s), s.x, s.y, s.rotation)) return { type: 'sticker', id: s.id };
  }
  for (let i = content.photos.length - 1; i >= 0; i--) {
    const p = content.photos[i];
    if (inR(nx, ny, photoRect(p), p.x, p.y, p.rotation)) return { type: 'photo', id: p.id };
  }
  return null;
}

/** Centered display rect (normalized) + rotation for any selectable item. */
export function selectionRect(
  item: TextItem | StickerItem | PhotoItem,
  cssW: number,
  cssH: number,
  measure?: (line: string, fontSizePx: number, fontCss: string) => number,
): { cx: number; cy: number; w: number; h: number; rotation: number } {
  if ('font' in item) {
    // TextItem — bbox is centered on the anchor
    const r = textRect(item as TextItem, cssW, cssH, measure);
    return { cx: item.x, cy: item.y, w: r.w, h: r.h, rotation: item.rotation };
  }
  if ('aspect' in item) {
    // PhotoItem (aspect is photo-only; PhotoItem also has `kind` so check order matters)
    const r = photoRect(item as PhotoItem);
    return { cx: item.x, cy: item.y, w: r.w, h: r.h, rotation: item.rotation };
  }
  const r = stickerRect(item as StickerItem);
  return { cx: item.x, cy: item.y, w: r.w, h: r.h, rotation: item.rotation };
}

/* ------------------------------------------------------------------ */
/* Strokes                                                             */
/* ------------------------------------------------------------------ */

/** Smooth path through midpoints (quadratic); single point → dot. */
function traceSmoothStroke(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

/** Renders one stroke (normalized points) with its tool style. */
export function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, cssW: number, cssH: number): void {
  if (!stroke.points || stroke.points.length === 0) return;
  const width = Math.max(0.6, stroke.size * cssW * (TOOL_WIDTH_MULT[stroke.tool] ?? 1));
  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : stroke.tool === 'highlighter' ? 'multiply' : 'source-over';
  ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : stroke.tool === 'marker' ? 0.85 : 1;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pts = stroke.points.map((p) => ({ x: p.x * cssW, y: p.y * cssH }));
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    traceSmoothStroke(ctx, pts);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Renders all strokes. If any eraser stroke exists, strokes go on an offscreen
 * layer first so destination-out erases INK ONLY (never the paper/photos).
 */
export function renderStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], cssW: number, cssH: number): void {
  if (strokes.length === 0) return;
  const hasEraser = strokes.some((s) => s.tool === 'eraser' && s.points.length > 0);
  if (!hasEraser || typeof document === 'undefined') {
    for (const s of strokes) renderStroke(ctx, s, cssW, cssH);
    return;
  }
  const scale = 2;
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.round(cssW * scale));
  layer.height = Math.max(1, Math.round(cssH * scale));
  const lctx = layer.getContext('2d');
  if (!lctx) {
    for (const s of strokes) renderStroke(ctx, s, cssW, cssH);
    return;
  }
  lctx.scale(scale, scale);
  for (const s of strokes) renderStroke(lctx, s, cssW, cssH);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(layer, 0, 0, cssW, cssH);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Paper background                                                    */
/* ------------------------------------------------------------------ */

let noiseCanvas: HTMLCanvasElement | null = null;

/** Tiny deterministic paper-fiber pattern (mulberry32, fixed seed). */
function getNoiseCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (noiseCanvas) return noiseCanvas;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const nctx = c.getContext('2d');
  if (!nctx) return null;
  const rnd = mulberry32(7);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 1 + rnd() * 3.5;
    const a = rnd() * Math.PI;
    nctx.strokeStyle = rnd() > 0.45 ? 'rgba(120,100,70,0.06)' : 'rgba(255,255,255,0.07)';
    nctx.lineWidth = 0.6;
    nctx.beginPath();
    nctx.moveTo(x, y);
    nctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    nctx.stroke();
  }
  for (let i = 0; i < 60; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    nctx.fillStyle = rnd() > 0.5 ? 'rgba(120,100,70,0.05)' : 'rgba(160,140,110,0.05)';
    nctx.fillRect(x, y, 1, 1);
  }
  noiseCanvas = c;
  return c;
}

function drawPaperNoise(ctx: CanvasRenderingContext2D, cssW: number, cssH: number): void {
  const c = getNoiseCanvas();
  if (!c) return;
  let pat: CanvasPattern | string | null = null;
  try {
    pat = ctx.createPattern(c, 'repeat');
  } catch {
    pat = null;
  }
  if (!pat) return;
  ctx.save();
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Shapes (path builders, all sized to a square of `size` px)          */
/* ------------------------------------------------------------------ */

function shapePath(ctx: CanvasRenderingContext2D, id: string, size: number): void {
  const s = size;
  ctx.beginPath();
  switch (id) {
    case 'star': {
      const R = s / 2;
      const r = R * 0.45;
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? R : r;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = Math.cos(a) * rad;
        const y = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case 'heart': {
      ctx.moveTo(0, s * 0.4);
      ctx.bezierCurveTo(-s * 0.52, s * 0.08, -s * 0.46, -s * 0.42, 0, -s * 0.14);
      ctx.bezierCurveTo(s * 0.46, -s * 0.42, s * 0.52, s * 0.08, 0, s * 0.4);
      ctx.closePath();
      break;
    }
    case 'triangle': {
      ctx.moveTo(0, -s * 0.48);
      ctx.lineTo(s * 0.46, s * 0.38);
      ctx.lineTo(-s * 0.46, s * 0.38);
      ctx.closePath();
      break;
    }
    case 'arrow': {
      // filled arrow pointing right
      const pts: [number, number][] = [
        [-s * 0.48, -s * 0.09],
        [s * 0.1, -s * 0.09],
        [s * 0.1, -s * 0.24],
        [s * 0.48, 0],
        [s * 0.1, s * 0.24],
        [s * 0.1, s * 0.09],
        [-s * 0.48, s * 0.09],
      ];
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      break;
    }
    case 'circle':
    default:
      ctx.arc(0, 0, s * 0.46, 0, Math.PI * 2);
      break;
  }
}

function drawShape(ctx: CanvasRenderingContext2D, id: string, size: number, color: string): void {
  if (id === 'squiggle') {
    // wavy stroked line
    const w = size;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, size * 0.13);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-w * 0.48, 0);
    const bumps = 3;
    const seg = w / (bumps * 2);
    for (let i = 0; i < bumps * 2; i++) {
      const x1 = -w * 0.48 + seg * (i + 0.5);
      const x2 = -w * 0.48 + seg * (i + 1);
      const dir = i % 2 === 0 ? -1 : 1;
      ctx.quadraticCurveTo(x1, dir * size * 0.16, x2, 0);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }
  shapePath(ctx, id, size);
  ctx.fillStyle = color;
  ctx.fill();
}

/* ------------------------------------------------------------------ */
/* Stickers                                                            */
/* ------------------------------------------------------------------ */

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  ctx.lineTo(x + rr, y + h);
  ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + rr);
  ctx.arc(x + rr, y + rr, rr, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
}

function drawRing(ctx: CanvasRenderingContext2D, size: number): void {
  // metallic binder ring
  const r = size / 2;
  let grad: CanvasGradient | string = '#b9bec4';
  try {
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, '#8f959c');
    g.addColorStop(0.45, '#e7eaee');
    g.addColorStop(1, '#7e858d');
    grad = g;
  } catch {
    grad = '#b9bec4';
  }
  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineWidth = Math.max(1.5, size * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.86, -Math.PI * 0.15, Math.PI * 1.25);
  ctx.stroke();
  ctx.restore();
}

function renderSticker(ctx: CanvasRenderingContext2D, s: StickerItem, cssW: number, cssH: number): void {
  const size = Math.max(4, s.size * cssW);
  ctx.save();
  ctx.translate(s.x * cssW, s.y * cssH);
  ctx.rotate(s.rotation || 0);
  switch (s.kind) {
    case 'emoji': {
      ctx.font = `${size}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2b2b2b';
      ctx.fillText(s.value, 0, size * 0.04);
      break;
    }
    case 'shape': {
      drawShape(ctx, s.value, size, s.color && isHexColor(s.color) ? s.color : SHAPE_COLOR_DEFAULT);
      break;
    }
    case 'tape': {
      const color = isHexColor(s.value) ? s.value : s.color || '#e8b4b8';
      const tw = size;
      const th = size * 0.34;
      ctx.save();
      ctx.globalAlpha = 0.55;
      roundRectPath(ctx, -tw / 2, -th / 2, tw, th, Math.min(4, th * 0.22));
      ctx.fillStyle = color;
      ctx.fill();
      // edge serration
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(1, th * 0.06);
      ctx.setLineDash([th * 0.22, th * 0.22]);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      break;
    }
    case 'clip': {
      drawRing(ctx, size);
      break;
    }
    case 'frame': {
      const fw = size;
      const fh = size * 0.8;
      ctx.save();
      ctx.strokeStyle = s.color && isHexColor(s.color) ? s.color : '#8d6e63';
      ctx.lineWidth = Math.max(1.5, size * 0.06);
      roundRectPath(ctx, -fw / 2, -fh / 2, fw, fh, size * 0.06);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = Math.max(1, size * 0.02);
      roundRectPath(ctx, -fw / 2 + size * 0.05, -fh / 2 + size * 0.05, fw - size * 0.1, fh - size * 0.1, size * 0.04);
      ctx.stroke();
      ctx.restore();
      break;
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

function drawPhotoMedia(ctx: CanvasRenderingContext2D, p: PhotoItem, x: number, y: number, w: number, h: number): void {
  if (p.kind === 'url' && p.dataUrl) {
    const img = lookupImage(p.dataUrl);
    if (img) {
      ctx.drawImage(img, x, y, w, h);
      return;
    }
    // placeholder while loading
    ctx.fillStyle = 'rgba(60,50,40,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(60,50,40,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    return;
  }
  // gradient placeholder + soft vignette
  const [c1, c2] = p.gradient && p.gradient.length === 2 ? p.gradient : ['#d7c9b8', '#a89a8c'];
  let g: CanvasGradient | string;
  try {
    const lg = ctx.createLinearGradient(x, y, x + w, y + h);
    lg.addColorStop(0, c1);
    lg.addColorStop(1, c2);
    g = lg;
  } catch {
    g = c1;
  }
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  try {
    const vg = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.25, x + w / 2, y + h / 2, Math.max(w, h) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = vg;
    ctx.fillRect(x, y, w, h);
  } catch {
    /* vignette optional */
  }
}

function drawPaperclip(ctx: CanvasRenderingContext2D, photoW: number): void {
  const H = Math.max(14, photoW * 0.24);
  const r1 = H * 0.19;
  const r2 = r1 * 0.62;
  const r3 = r1 * 0.3;
  const yTop = -H * 0.5;
  const yBot = H * 0.5;
  let grad: CanvasGradient | string = '#aab0b6';
  try {
    const g = ctx.createLinearGradient(-r1, 0, r1, 0);
    g.addColorStop(0, '#878d94');
    g.addColorStop(0.45, '#e9ecef');
    g.addColorStop(1, '#767c83');
    grad = g;
  } catch {
    grad = '#aab0b6';
  }
  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineWidth = Math.max(1.1, H * 0.055);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(r1, yTop + r1);
  ctx.lineTo(r1, yBot);
  ctx.arc(0, yBot, r1, 0, Math.PI, false); // bottom outer → left
  ctx.lineTo(-r1, yTop + r1);
  ctx.arc(0, yTop + r1, r1, Math.PI, 0, false); // top outer → right
  ctx.lineTo(r2, yTop + r1 + (r1 - r2));
  ctx.lineTo(r2, yBot);
  ctx.arc(0, yBot, r2, 0, Math.PI, false); // bottom middle → left
  ctx.lineTo(-r2, yTop + r3 + (r2 - r3));
  ctx.arc(0, yTop + r3 + (r2 - r3), r2, Math.PI, 0, false); // top middle → right
  ctx.lineTo(r3, yTop + r3 + (r2 - r3)); // step in
  ctx.arc(0, yTop + r3 + (r2 - r3), r3, 0, Math.PI, false); // inner top arc
  ctx.lineTo(-r3, yTop + r3 + (r2 - r3) + r3); // tiny tail
  ctx.stroke();
  ctx.restore();
}

function renderPhoto(ctx: CanvasRenderingContext2D, p: PhotoItem, cssW: number, cssH: number): void {
  const w = Math.max(8, p.w * cssW);
  const h = Math.max(8, w * (p.aspect && p.aspect > 0 ? p.aspect : 1));
  const frame = p.frame ?? 'plain';
  ctx.save();
  ctx.translate(p.x * cssW, p.y * cssH);
  ctx.rotate(p.rotation || 0);

  if (frame === 'polaroid') {
    const side = w * 0.055;
    const bottom = w * 0.18;
    const tw = w + side * 2;
    const th = h + side + bottom;
    ctx.save();
    ctx.shadowColor = 'rgba(40,30,20,0.28)';
    ctx.shadowBlur = w * 0.06;
    ctx.shadowOffsetY = w * 0.02;
    roundRectPath(ctx, -tw / 2, -th / 2, tw, th, Math.min(4, w * 0.02));
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, -w / 2, -th / 2 + side, w, h, Math.min(2, w * 0.012));
    ctx.clip();
    drawPhotoMedia(ctx, p, -w / 2, -th / 2 + side, w, h);
    ctx.restore();
    if (p.caption) {
      ctx.fillStyle = '#4a4a4a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.max(6, w * 0.085)}px ${FONT_STACKS[p.captionFont ?? 'hand']}`;
      ctx.fillText(p.caption, 0, -th / 2 + side + h + bottom * 0.48, tw * 0.94);
    }
  } else if (frame === 'clip') {
    ctx.save();
    ctx.shadowColor = 'rgba(40,30,20,0.2)';
    ctx.shadowBlur = w * 0.05;
    ctx.shadowOffsetY = w * 0.015;
    roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.04);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.04);
    ctx.clip();
    drawPhotoMedia(ctx, p, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.save();
    ctx.translate(w * 0.06, -h / 2 + w * 0.02);
    ctx.rotate(-0.12);
    drawPaperclip(ctx, w);
    ctx.restore();
  } else if (frame === 'scallop') {
    ctx.save();
    ctx.shadowColor = 'rgba(40,30,20,0.18)';
    ctx.shadowBlur = w * 0.05;
    ctx.shadowOffsetY = w * 0.015;
    roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.04);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.04);
    ctx.clip();
    drawPhotoMedia(ctx, p, -w / 2, -h / 2, w, h);
    ctx.restore();
    // wavy-edge border: dashed rounded stroke → scallop bumps
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = Math.max(2, w * 0.05);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([w * 0.015, w * 0.05]);
    roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.04);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  } else {
    // plain: rounded 4% corners + slight shadow
    ctx.save();
    ctx.shadowColor = 'rgba(40,30,20,0.22)';
    ctx.shadowBlur = w * 0.055;
    ctx.shadowOffsetY = w * 0.018;
    roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.04);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.04);
    ctx.clip();
    drawPhotoMedia(ctx, p, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Texts                                                               */
/* ------------------------------------------------------------------ */

export function renderTextItem(ctx: CanvasRenderingContext2D, t: TextItem, cssW: number, cssH: number): void {
  const fs = Math.max(4, t.size * cssW);
  const lh = t.lineHeight ?? 1.35;
  const lines = (t.text || '').split('\n');
  if (lines.length === 0) return;
  ctx.save();
  ctx.translate(t.x * cssW, t.y * cssH);
  ctx.rotate(t.rotation || 0);
  ctx.font = `${fs}px ${FONT_STACKS[t.font] ?? FONT_STACKS.sans}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = t.align ?? 'center';
  ctx.fillStyle = t.color;
  const blockH = lines.length * fs * lh;
  let blockW = 1;
  for (const line of lines) blockW = Math.max(blockW, ctx.measureText(line).width);
  const align = t.align ?? 'center';
  lines.forEach((line, i) => {
    const cy = -blockH / 2 + fs * lh * (i + 0.5);
    let x = 0;
    if (align === 'left') x = -blockW / 2;
    else if (align === 'right') x = blockW / 2;
    ctx.fillText(line, x, cy);
  });
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Main entry points                                                   */
/* ------------------------------------------------------------------ */

export interface RenderOptions {
  paperColor?: string;
}

/**
 * Renders a full page: paper (opts.paperColor ?? content.bg ?? '#faf8f4') +
 * deterministic fiber noise, then photos, stickers, strokes, texts.
 * All coordinates normalized × cssW/cssH.
 */
export function renderPageContent(
  ctx: CanvasRenderingContext2D,
  content: PageContent,
  cssW: number,
  cssH: number,
  opts?: RenderOptions,
): void {
  const paper = paperColorOf(content, opts);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, cssW, cssH);
  drawPaperNoise(ctx, cssW, cssH);
  for (const p of content.photos ?? []) renderPhoto(ctx, p, cssW, cssH);
  for (const s of content.stickers ?? []) renderSticker(ctx, s, cssW, cssH);
  renderStrokes(ctx, content.strokes ?? [], cssW, cssH);
  for (const t of content.texts ?? []) renderTextItem(ctx, t, cssW, cssH);
  ctx.restore();
}

/** Offscreen render at 2× scale for crispness (needs a DOM). */
export function renderPageContentToCanvas(
  content: PageContent,
  cssW: number,
  cssH: number,
  paperColor?: string,
): HTMLCanvasElement {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cssW * scale));
  canvas.height = Math.max(1, Math.round(cssH * scale));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(scale, scale);
    renderPageContent(ctx, content, cssW, cssH, paperColor ? { paperColor } : undefined);
  }
  return canvas;
}

/** PNG data URL of the page (2× scale). Needs a DOM; images must be primed. */
export function contentToDataURL(
  content: PageContent,
  cssW: number,
  cssH: number,
  paperColor?: string,
): string {
  return renderPageContentToCanvas(content, cssW, cssH, paperColor).toDataURL('image/png');
}

/**
 * PNG data URL of an open two-page spread (2× scale).
 *
 * Renders left + right pages side by side with a small gutter shadow, like
 * photographing the open book. If one side is missing (short journals) it is
 * drawn as blank paper. Needs a DOM; images must be primed.
 */
export function spreadToDataURL(
  left: PageContent | null,
  right: PageContent | null,
  cssW: number,
  cssH: number,
  paperColor?: string,
): string {
  const scale = 2;
  const gutter = Math.round(cssW * 0.06);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((cssW * 2 + gutter) * scale);
  canvas.height = Math.round(cssH * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(scale, scale);

  const blank: PageContent = { strokes: [], texts: [], stickers: [], photos: [] };
  const paper = paperColorOf(left ?? right ?? blank, { paperColor });

  // shared backdrop behind the gutter
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, canvas.width / scale, canvas.height / scale);

  const drawSide = (content: PageContent | null, x: number) => {
    ctx.save();
    ctx.translate(x, 0);
    ctx.beginPath();
    ctx.rect(0, 0, cssW, cssH);
    ctx.clip();
    if (content) {
      renderPageContent(ctx, content, cssW, cssH, { paperColor });
    } else {
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, cssW, cssH);
      drawPaperNoise(ctx, cssW, cssH);
    }
    ctx.restore();
  };
  drawSide(left, 0);
  drawSide(right, cssW + gutter);

  // gutter contact shadow (dark strip fading outward, reading-room feel)
  const gx = cssW + gutter / 2;
  const shadowW = gutter * 1.6;
  const grad = ctx.createLinearGradient(gx - shadowW / 2, 0, gx + shadowW / 2, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.5, 'rgba(60,44,20,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(gx - shadowW / 2, 0, shadowW, cssH);

  return canvas.toDataURL('image/png');
}
