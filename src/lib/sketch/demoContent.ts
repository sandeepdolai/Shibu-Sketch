/**
 * Shibu-Sketch — hand-authored demo journals.
 *
 * DEMO_JOURNALS is the seed payload for POST /api/sketch/seed.
 * Everything is deterministic (fixed ids, no randomness) and built with the
 * content contracts from ./types.ts. All coordinates are NORMALIZED 0..1
 * relative to the page rect:
 *   - stroke points / text / sticker centers: x = fraction of page width, y = fraction of page height
 *   - stroke `size`: fraction of page width (0.01 ≈ medium pen)
 *   - photo `w`: fraction of page width, `aspect` = height / width
 * Rects drawn "via strokes" (tickets, passes) take w as width-fraction and
 * h as height-fraction so they stay axis-aligned rectangles on any page.
 */

import {
  emptyPageContent,
  type CoverStyle,
  type DrawTool,
  type PageContent,
  type PhotoItem,
  type StickerItem,
  type Stroke,
  type StrokePoint,
  type TextFont,
  type TextItem,
} from './types';

export interface DemoJournalSeed {
  title: string;
  coverStyle: CoverStyle;
  paperColor?: string;
  pages: PageContent[];
}

/* ------------------------------------------------------------------ */
/* Shared palettes                                                     */
/* ------------------------------------------------------------------ */

const MOVIE = {
  orange: '#e8862e',
  deepOrange: '#d9722a',
  brown: '#7a4a21',
  ink: '#5f544a',
  faint: '#b98356',
  blue: '#7fa8c9',
  sage: '#a3b18a',
  sand: '#f4d8a8',
  star: '#e8a13c',
  starOff: '#d8cfc2',
  tape: '#f2c078',
  tape2: '#e8d8a8',
};

const PINK = {
  hot: '#d94f70',
  rose: '#e56b8c',
  soft: '#f4a7bb',
  pale: '#f7cdd8',
  ink: '#b8656f',
  gold: '#f9d97e',
  blue: '#a8dadc',
  tape: '#f4b8c8',
};

const TRIP = {
  navy: '#274060',
  steel: '#5f7d95',
  ink: '#33475c',
  red: '#c96f2a',
  paper: '#dad7cd',
  green: '#3a5a40',
  tape: '#b8c9d9',
};

const INKDOODLE = '#2f3542';

/* ------------------------------------------------------------------ */
/* Small builders                                                      */
/* ------------------------------------------------------------------ */

/** A page built on top of emptyPageContent(), with optional paper tint. */
function page(bg?: string): PageContent {
  const c = emptyPageContent();
  if (bg) c.bg = bg;
  return c;
}

const pt = (x: number, y: number): StrokePoint => ({ x, y });

function makeStroke(
  id: string,
  tool: DrawTool,
  color: string,
  size: number,
  points: StrokePoint[],
): Stroke {
  return { id, tool, color, size, points };
}

/** Straight line between two points. */
function makeLine(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: { tool?: DrawTool; color?: string; size?: number } = {},
): Stroke {
  return makeStroke(id, opts.tool ?? 'pen', opts.color ?? INKDOODLE, opts.size ?? 0.008, [
    pt(x1, y1),
    pt(x2, y2),
  ]);
}

/** Dashed straight line built from short segments. */
function makeDashedLine(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: { color?: string; size?: number; dash?: number; gap?: number } = {},
): Stroke {
  const dash = opts.dash ?? 0.02;
  const gap = opts.gap ?? 0.014;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  const pts: StrokePoint[] = [];
  for (let d = 0; d <= len; d += dash + gap) {
    const end = Math.min(d + dash, len);
    pts.push(pt(x1 + ux * d, y1 + uy * d), pt(x1 + ux * end, y1 + uy * end));
  }
  return makeStroke(id, 'pen', opts.color ?? INKDOODLE, opts.size ?? 0.006, pts);
}

/** Horizontal wavy underline/squiggle centered at y, spanning [x, x+w]. */
function makeWave(
  id: string,
  x: number,
  y: number,
  w: number,
  opts: { color?: string; size?: number; amp?: number; cycles?: number; tool?: DrawTool } = {},
): Stroke {
  const amp = opts.amp ?? 0.008;
  const cycles = opts.cycles ?? 5;
  const n = Math.max(12, cycles * 8);
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(pt(x + w * t, y + amp * Math.sin(t * Math.PI * 2 * cycles)));
  }
  return makeStroke(id, opts.tool ?? 'pen', opts.color ?? MOVIE.orange, opts.size ?? 0.007, pts);
}

/** Closed rectangle outline. cx/cy = center; w = width fraction, h = HEIGHT fraction. */
function makeRectStroke(
  id: string,
  cx: number,
  cy: number,
  w: number,
  h: number,
  opts: { tool?: DrawTool; color?: string; size?: number } = {},
): Stroke {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return makeStroke(id, opts.tool ?? 'pen', opts.color ?? INKDOODLE, opts.size ?? 0.007, [
    pt(x0, y0),
    pt(x1, y0),
    pt(x1, y1),
    pt(x0, y1),
    pt(x0, y0),
  ]);
}

/** Dashed (ticket-style) rectangle border. */
function makeDashedRect(
  id: string,
  cx: number,
  cy: number,
  w: number,
  h: number,
  opts: { color?: string; size?: number } = {},
): Stroke {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return makeStroke(id, 'pen', opts.color ?? INKDOODLE, opts.size ?? 0.005, [
    ...makeDashedLine(`${id}-t`, x0, y0, x1, y0, opts).points,
    ...makeDashedLine(`${id}-r`, x1, y0, x1, y1, opts).points,
    ...makeDashedLine(`${id}-b`, x1, y1, x0, y1, opts).points,
    ...makeDashedLine(`${id}-l`, x0, y1, x0, y0, opts).points,
  ]);
}

/** Five-pointed star outline (10-point closed path), radius as width fraction. */
function makeStarPoints(cx: number, cy: number, r: number, rot = -Math.PI / 2): StrokePoint[] {
  const pts: StrokePoint[] = [];
  const inner = r * 0.42;
  for (let i = 0; i <= 10; i++) {
    const rad = i % 2 === 0 ? r : inner;
    const a = rot + (i * Math.PI) / 5;
    pts.push(pt(cx + rad * Math.cos(a), cy + rad * Math.sin(a)));
  }
  return pts;
}

function makeStarStroke(
  id: string,
  cx: number,
  cy: number,
  r: number,
  color: string,
  rot = -Math.PI / 2,
): Stroke {
  return makeStroke(id, 'pen', color, 0.007, makeStarPoints(cx, cy, r, rot));
}

/** Circle outline. r as width fraction; cy expressed in height fraction. */
function makeCircleStroke(
  id: string,
  cx: number,
  cy: number,
  r: number,
  color: string,
  size = 0.007,
): Stroke {
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push(pt(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return makeStroke(id, 'pen', color, size, pts);
}

/** Cursive warm-up loop row spanning [x, x+w], centered on y. */
function makeLoopRow(id: string, x: number, y: number, w: number, loops: number, color: string): Stroke {
  const pts: StrokePoint[] = [];
  const loopW = w / loops;
  const n = loops * 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const lx = t * loops;
    const phase = (lx - Math.floor(lx)) * Math.PI * 2;
    pts.push(pt(x + w * t, y - 0.035 * Math.sin(phase) - 0.01 * Math.sin(t * Math.PI * 2 * 1.3)));
  }
  return makeStroke(id, 'pen', color, 0.008, pts);
}

/** Flower drawn as a closed petal curve (one continuous line), r as width fraction. */
function makeFlowerPoints(cx: number, cy: number, r: number, petals: number, aspect = 0.6): StrokePoint[] {
  const pts: StrokePoint[] = [];
  const n = petals * 16;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const rad = 1 + 0.55 * Math.abs(Math.sin(t * (petals / 2)));
    pts.push(pt(cx + r * rad * Math.cos(t), cy + r * rad * Math.sin(t) * aspect));
  }
  return pts;
}

function makeText(
  id: string,
  x: number,
  y: number,
  text: string,
  opts: {
    font?: TextFont;
    size?: number;
    color?: string;
    rotation?: number;
    align?: 'left' | 'center' | 'right';
    lineHeight?: number;
  } = {},
): TextItem {
  return {
    id,
    x,
    y,
    text,
    font: opts.font ?? 'hand',
    size: opts.size ?? 0.03,
    color: opts.color ?? INKDOODLE,
    rotation: opts.rotation ?? 0,
    align: opts.align ?? 'center',
    lineHeight: opts.lineHeight ?? 1.5,
  };
}

function makeTape(id: string, x: number, y: number, color?: string, rotation = 0, size = 0.14): StickerItem {
  const c = color ?? MOVIE.tape;
  return { id, kind: 'tape', value: c, x, y, size, rotation, color: c };
}

function makeShape(
  id: string,
  value: 'star' | 'heart' | 'circle' | 'triangle' | 'squiggle' | 'arrow',
  x: number,
  y: number,
  size: number,
  color: string,
  rotation = 0,
): StickerItem {
  return { id, kind: 'shape', value, x, y, size, rotation, color };
}

/** Row of star stickers used as a rating (filled count colored, rest dim). */
function makeStars(
  idBase: string,
  cx: number,
  cy: number,
  filled: number,
  total = 5,
  size = 0.042,
  onColor = MOVIE.star,
  offColor = MOVIE.starOff,
): StickerItem[] {
  const out: StickerItem[] = [];
  const gap = size * 2.1;
  const x0 = cx - ((total - 1) * gap) / 2;
  for (let i = 0; i < total; i++) {
    out.push(makeShape(`${idBase}-s${i}`, 'star', x0 + gap * i, cy, size, i < filled ? onColor : offColor, i % 2 === 0 ? -0.12 : 0.1));
  }
  return out;
}

function makePolaroid(
  id: string,
  x: number,
  y: number,
  w: number,
  gradient: [string, string],
  caption?: string,
  rotation = 0,
  opts: { frame?: PhotoItem['frame']; aspect?: number; captionFont?: TextFont } = {},
): PhotoItem {
  return {
    id,
    kind: 'gradient',
    gradient,
    x,
    y,
    w,
    rotation,
    aspect: opts.aspect ?? 1.22,
    frame: opts.frame ?? 'polaroid',
    caption,
    captionFont: opts.captionFont ?? 'hand',
  };
}

/* ================================================================== */
/* 1 — MOVIES (orange scrapbook, 12 pages)                             */
/* ================================================================== */

const moviesPages: PageContent[] = [
  // p1 — title page
  (() => {
    const p = page();
    p.stickers = [
      makeTape('m1-st1', 0.5, 0.052, MOVIE.tape, 0.05, 0.18),
      makeShape('m1-st2', 'squiggle', 0.16, 0.615, 0.15, MOVIE.blue, -0.4),
      makeShape('m1-st3', 'circle', 0.84, 0.62, 0.19, MOVIE.sand, 0.3),
      makeShape('m1-st4', 'star', 0.21, 0.30, 0.055, MOVIE.star, 0.2),
      makeShape('m1-st5', 'star', 0.8, 0.42, 0.045, MOVIE.star, -0.25),
      makeShape('m1-st6', 'circle', 0.2, 0.86, 0.1, PINK.soft, 0.1),
    ];
    p.texts = [
      makeText('m1-t1', 0.5, 0.095, 'the movie journal', { size: 0.03, color: MOVIE.faint }),
      makeText('m1-t2', 0.5, 0.26, 'STARLIGHT', { size: 0.115, color: MOVIE.orange, rotation: -0.03, lineHeight: 1 }),
      makeText('m1-t3', 0.5, 0.395, 'CAFE', { size: 0.115, color: MOVIE.deepOrange, rotation: 0.015, lineHeight: 1 }),
      makeText('m1-t4', 0.5, 0.55, 'cafe. rain. two strangers talking\nuntil the first tram of the morning.', {
        font: 'typewriter', size: 0.026, color: MOVIE.ink, lineHeight: 1.7,
      }),
      makeText('m1-t5', 0.5, 0.71, '·····', { size: 0.035, color: MOVIE.faint }),
      makeText('m1-t6', 0.5, 0.8, 'vol. 1 — fall', { font: 'typewriter', size: 0.024, color: MOVIE.faint }),
    ];
    p.strokes = [
      makeWave('m1-w1', 0.26, 0.475, 0.48, { color: MOVIE.orange, amp: 0.009, cycles: 6 }),
      makeWave('m1-w2', 0.38, 0.905, 0.24, { color: MOVIE.blue, amp: 0.007, cycles: 4 }),
      makeLine('m1-l1', 0.14, 0.14, 0.86, 0.14, { color: MOVIE.sand, size: 0.004 }),
    ];
    p.photos = [makePolaroid('m1-p1', 0.62, 0.9, 0.2, ['#1a1c2b', '#e0a13c'], 'night walk', -0.08)];
    return p;
  })(),

  // p2 — review: MIDNIGHT POST
  (() => {
    const p = page();
    p.texts = [
      makeText('m2-t1', 0.5, 0.115, 'MIDNIGHT POST', { size: 0.085, color: MOVIE.orange, rotation: -0.02, lineHeight: 1 }),
      makeText('m2-t2', 0.5, 0.42, 'a night courier rides the last train line,\ndelivering letters nobody writes anymore.\nslow, quiet, completely perfect.\nthe rain scene alone is worth the ticket.', {
        font: 'typewriter', size: 0.026, color: MOVIE.ink, lineHeight: 1.8,
      }),
      makeText('m2-t3', 0.31, 0.845, 'watched: oct 12', { size: 0.024, color: MOVIE.faint, rotation: -0.05 }),
    ];
    p.stickers = [
      ...makeStars('m2-r', 0.5, 0.665, 5),
      makeTape('m2-st1', 0.11, 0.05, MOVIE.tape2, -0.35, 0.12),
      makeShape('m2-st2', 'squiggle', 0.13, 0.79, 0.16, MOVIE.sage, 0.3),
      makeShape('m2-st3', 'circle', 0.86, 0.55, 0.13, MOVIE.sand, -0.2),
    ];
    p.strokes = [
      makeWave('m2-w1', 0.22, 0.185, 0.56, { color: MOVIE.orange, amp: 0.008, cycles: 5 }),
      makeWave('m2-w2', 0.62, 0.9, 0.26, { color: MOVIE.sage, amp: 0.006, cycles: 4 }),
    ];
    p.photos = [makePolaroid('m2-p1', 0.8, 0.83, 0.22, ['#2b1a12', '#c96f2a'], 'the rain scene', 0.1)];
    return p;
  })(),

  // p3 — stills page (3 polaroids)
  (() => {
    const p = page();
    p.texts = [
      makeText('m3-t1', 0.5, 0.095, 'stills i loved', { size: 0.055, color: MOVIE.orange, rotation: -0.02 }),
      makeText('m3-t2', 0.5, 0.94, '— frames i would print if i could —', { font: 'typewriter', size: 0.022, color: MOVIE.faint }),
    ];
    p.photos = [
      makePolaroid('m3-p1', 0.3, 0.33, 0.3, ['#1a1c2b', '#e0a13c'], 'neon diner', -0.06),
      makePolaroid('m3-p2', 0.71, 0.35, 0.3, ['#3d2b1f', '#e8862e'], 'last train', 0.05),
      makePolaroid('m3-p3', 0.5, 0.71, 0.34, ['#0f1b2d', '#d97b29'], 'the rooftop', -0.02),
    ];
    p.stickers = [
      makeTape('m3-st1', 0.3, 0.115, MOVIE.tape, -0.2, 0.1),
      makeTape('m3-st2', 0.71, 0.13, MOVIE.tape2, 0.25, 0.1),
      makeShape('m3-st3', 'star', 0.9, 0.2, 0.045, MOVIE.star, 0.15),
      makeShape('m3-st4', 'squiggle', 0.12, 0.72, 0.13, MOVIE.blue, -0.3),
    ];
    return p;
  })(),

  // p4 — review: THE LAST FERRY
  (() => {
    const p = page();
    p.texts = [
      makeText('m4-t1', 0.5, 0.12, 'THE LAST FERRY', { size: 0.085, color: MOVIE.deepOrange, lineHeight: 1 }),
      makeText('m4-t2', 0.5, 0.41, 'a deckhand counts harbors instead of years.\nnothing happens for an hour\nand then everything does,\nall of it on the water.', {
        font: 'typewriter', size: 0.026, color: MOVIE.ink, lineHeight: 1.8,
      }),
      makeText('m4-t3', 0.5, 0.615, '“ the water keeps moving.\nso do we. ”', {
        font: 'hand', size: 0.034, color: MOVIE.blue, lineHeight: 1.5,
      }),
      makeText('m4-t4', 0.3, 0.9, 'watched: oct 30', { size: 0.024, color: MOVIE.faint, rotation: -0.04 }),
    ];
    p.stickers = [
      ...makeStars('m4-r', 0.5, 0.215, 4),
      makeTape('m4-st1', 0.87, 0.07, MOVIE.tape, 0.4, 0.12),
      makeShape('m4-st2', 'circle', 0.85, 0.32, 0.15, MOVIE.sand, 0),
      makeShape('m4-st3', 'star', 0.14, 0.5, 0.05, MOVIE.star, -0.2),
    ];
    p.strokes = [makeWave('m4-w1', 0.24, 0.72, 0.52, { color: MOVIE.blue, amp: 0.01, cycles: 6 })];
    p.photos = [makePolaroid('m4-p1', 0.78, 0.85, 0.2, ['#2b1a12', '#c96f2a'], 'harbor fog', -0.09)];
    return p;
  })(),

  // p5 — ticket stubs
  (() => {
    const p = page();
    p.texts = [
      makeText('m5-t1', 0.5, 0.075, 'ticket stubs', { size: 0.055, color: MOVIE.orange, rotation: -0.02 }),
      makeText('m5-t2', 0.4, 0.265, 'ADMIT ONE — STARLIGHT CAFE', { font: 'sans', size: 0.022, color: MOVIE.brown }),
      makeText('m5-t3', 0.4, 0.305, 'ROW F · SEAT 12 · 21:40', { font: 'sans', size: 0.018, color: MOVIE.faint }),
      makeText('m5-t4', 0.4, 0.485, 'ADMIT ONE — PAPER MOON CLUB', { font: 'sans', size: 0.022, color: MOVIE.brown }),
      makeText('m5-t5', 0.4, 0.525, 'ROW C · SEAT 4 · 19:15', { font: 'sans', size: 0.018, color: MOVIE.faint }),
      makeText('m5-t6', 0.4, 0.705, 'ADMIT ONE — SUMMER STATIC', { font: 'sans', size: 0.022, color: MOVIE.brown }),
      makeText('m5-t7', 0.4, 0.745, 'ROW H · SEAT 21 · 23:00', { font: 'sans', size: 0.018, color: MOVIE.faint }),
      makeText('m5-t8', 0.84, 0.305, '№ 114', { font: 'typewriter', size: 0.02, color: MOVIE.brown, rotation: -Math.PI / 2 }),
    ];
    p.strokes = [
      makeRectStroke('m5-r1', 0.47, 0.285, 0.72, 0.13, { color: MOVIE.brown, size: 0.006 }),
      makeRectStroke('m5-r2', 0.47, 0.505, 0.72, 0.13, { color: MOVIE.brown, size: 0.006 }),
      makeRectStroke('m5-r3', 0.47, 0.725, 0.72, 0.13, { color: MOVIE.brown, size: 0.006 }),
      makeDashedLine('m5-d1', 0.79, 0.22, 0.79, 0.35, { color: MOVIE.faint, size: 0.004 }),
      makeDashedLine('m5-d2', 0.79, 0.44, 0.79, 0.57, { color: MOVIE.faint, size: 0.004 }),
      makeDashedLine('m5-d3', 0.79, 0.66, 0.79, 0.79, { color: MOVIE.faint, size: 0.004 }),
      makeLine('m5-l1', 0.12, 0.415, 0.88, 0.415, { color: MOVIE.sand, size: 0.003 }),
      makeLine('m5-l2', 0.12, 0.635, 0.88, 0.635, { color: MOVIE.sand, size: 0.003 }),
    ];
    p.stickers = [
      makeTape('m5-st1', 0.13, 0.185, MOVIE.tape, -0.5, 0.1),
      makeTape('m5-st2', 0.86, 0.62, MOVIE.tape2, 0.45, 0.1),
      makeShape('m5-st3', 'star', 0.88, 0.14, 0.04, MOVIE.star, 0.2),
      makeShape('m5-st4', 'circle', 0.12, 0.9, 0.09, PINK.soft, 0),
    ];
    return p;
  })(),

  // p6 — review: PAPER MOON CLUB
  (() => {
    const p = page();
    p.texts = [
      makeText('m6-t1', 0.56, 0.13, 'PAPER\nMOON CLUB', { size: 0.072, color: MOVIE.orange, lineHeight: 1.15 }),
      makeText('m6-t2', 0.62, 0.42, 'kids run a secret cinema\ninside a laundromat.\nthe projector is a flashlight\nand nobody minds.', {
        font: 'typewriter', size: 0.024, color: MOVIE.ink, lineHeight: 1.8,
      }),
      makeText('m6-t3', 0.66, 0.72, 'membership: heartbroken,\nin the best way', { font: 'hand', size: 0.027, color: MOVIE.sage, lineHeight: 1.5 }),
      makeText('m6-t4', 0.24, 0.9, 'watched: nov 8', { size: 0.024, color: MOVIE.faint, rotation: -0.04 }),
    ];
    p.stickers = [
      ...makeStars('m6-r', 0.68, 0.24, 4),
      makeTape('m6-st1', 0.5, 0.05, MOVIE.tape, 0.1, 0.13),
      makeShape('m6-st2', 'squiggle', 0.16, 0.6, 0.16, MOVIE.blue, -0.35),
      makeShape('m6-st3', 'heart', 0.9, 0.68, 0.05, PINK.rose, 0.2),
    ];
    p.strokes = [makeWave('m6-w1', 0.5, 0.215, 0.36, { color: MOVIE.orange, amp: 0.007, cycles: 4 })];
    p.photos = [makePolaroid('m6-p1', 0.26, 0.35, 0.3, ['#1a1c2b', '#e0a13c'], 'the basement screen', 0.07)];
    return p;
  })(),

  // p7 — top ten list
  (() => {
    const p = page();
    const titles = [
      'starlight cafe',
      'midnight post',
      'the last ferry',
      'paper moon club',
      'summer static',
      'orange days',
      'the second balcony',
      'salt & circuitry',
      'a week of tuesdays',
      'goodnight, transit',
    ];
    p.texts = [
      makeText('m7-t1', 0.5, 0.08, 'top ten — so far', { size: 0.06, color: MOVIE.orange, rotation: -0.02 }),
      ...titles.map((t, i) =>
        makeText(`m7-n${i}`, 0.31, 0.185 + i * 0.072, `${i + 1}. ${t}`, {
          font: 'typewriter', size: 0.026, color: i < 3 ? MOVIE.brown : MOVIE.ink, align: 'left',
        }),
      ),
      makeText('m7-t2', 0.82, 0.94, '(winter counts double)', { font: 'typewriter', size: 0.02, color: MOVIE.faint }),
    ];
    p.strokes = [
      makeStroke('m7-hl1', 'highlighter', '#f9d97e', 0.05, [pt(0.16, 0.185), pt(0.6, 0.185)]),
      makeWave('m7-w1', 0.15, 0.22, 0.32, { color: MOVIE.orange, amp: 0.006, cycles: 4 }),
    ];
    p.stickers = [
      makeShape('m7-st1', 'star', 0.85, 0.185, 0.045, MOVIE.star, 0.1),
      makeShape('m7-st2', 'star', 0.85, 0.257, 0.04, MOVIE.star, -0.15),
      makeShape('m7-st3', 'star', 0.85, 0.329, 0.04, MOVIE.star, 0.2),
      makeTape('m7-st4', 0.5, 0.035, MOVIE.tape2, 0.04, 0.16),
      makeShape('m7-st5', 'squiggle', 0.85, 0.75, 0.13, MOVIE.sage, 0.3),
    ];
    return p;
  })(),

  // p8 — quotes
  (() => {
    const p = page();
    p.texts = [
      makeText('m8-t1', 0.5, 0.09, 'lines i keep', { size: 0.055, color: MOVIE.orange, rotation: -0.02 }),
      makeText('m8-t2', 0.15, 0.21, '“', { size: 0.17, color: MOVIE.orange }),
      makeText('m8-t3', 0.52, 0.33, 'you can’t dial a feeling.\nyou have to walk to it.', {
        font: 'typewriter', size: 0.025, color: MOVIE.ink, align: 'left', lineHeight: 1.7,
      }),
      makeText('m8-t4', 0.52, 0.52, 'every city is a cinema\nwith the sound off.', {
        font: 'typewriter', size: 0.025, color: MOVIE.ink, align: 'left', lineHeight: 1.7,
      }),
      makeText('m8-t5', 0.52, 0.7, 'we were seventeen\nand the projection stuck.', {
        font: 'typewriter', size: 0.025, color: MOVIE.ink, align: 'left', lineHeight: 1.7,
      }),
      makeText('m8-t6', 0.5, 0.9, '— margins of the notebook, oct/nov', { font: 'typewriter', size: 0.02, color: MOVIE.faint }),
    ];
    p.stickers = [
      makeTape('m8-st1', 0.5, 0.035, MOVIE.tape, -0.06, 0.15),
      makeShape('m8-st2', 'squiggle', 0.16, 0.85, 0.15, MOVIE.sand, -0.25),
      makeShape('m8-st3', 'circle', 0.88, 0.87, 0.11, MOVIE.sage, 0.15),
      makeShape('m8-st4', 'star', 0.88, 0.2, 0.04, MOVIE.star, -0.2),
    ];
    p.strokes = [makeLine('m8-l1', 0.14, 0.155, 0.86, 0.155, { color: MOVIE.sand, size: 0.004 })];
    return p;
  })(),

  // p9 — review: SUMMER STATIC
  (() => {
    const p = page();
    p.texts = [
      makeText('m9-t1', 0.5, 0.115, 'SUMMER STATIC', { size: 0.08, color: MOVIE.orange, rotation: 0.015, lineHeight: 1 }),
      makeText('m9-t2', 0.5, 0.42, 'two radio hosts share one shift\nand slowly trade secrets on air.\nthe whole town listens.\nnobody says a word.', {
        font: 'typewriter', size: 0.026, color: MOVIE.ink, lineHeight: 1.8,
      }),
      makeText('m9-t3', 0.32, 0.86, 'watched: nov 21', { size: 0.024, color: MOVIE.faint, rotation: -0.05 }),
    ];
    p.stickers = [
      ...makeStars('m9-r', 0.5, 0.655, 3),
      makeTape('m9-st1', 0.9, 0.18, MOVIE.tape, -0.45, 0.11),
      makeShape('m9-st2', 'circle', 0.14, 0.55, 0.16, MOVIE.sand, 0),
      makeShape('m9-st3', 'squiggle', 0.87, 0.5, 0.14, MOVIE.blue, 0.4),
    ];
    p.strokes = [
      makeWave('m9-w1', 0.24, 0.19, 0.52, { color: MOVIE.orange, amp: 0.008, cycles: 5 }),
      makeWave('m9-w2', 0.6, 0.93, 0.3, { color: MOVIE.sage, amp: 0.007, cycles: 4 }),
    ];
    p.photos = [makePolaroid('m9-p1', 0.79, 0.82, 0.22, ['#4a2c1a', '#f2b063'], 'antenna hill', 0.08)];
    return p;
  })(),

  // p10 — golden hour photos
  (() => {
    const p = page();
    p.texts = [
      makeText('m10-t1', 0.5, 0.085, 'golden hour, recorded', { size: 0.05, color: MOVIE.orange, rotation: -0.02 }),
      makeText('m10-t2', 0.5, 0.93, 'shot on: nothing. remembered anyway.', { font: 'typewriter', size: 0.022, color: MOVIE.faint }),
    ];
    p.photos = [
      makePolaroid('m10-p1', 0.3, 0.36, 0.34, ['#2b1a12', '#c96f2a'], 'cinerama dusk', -0.05),
      { ...makePolaroid('m10-p2', 0.7, 0.34, 0.3, ['#1a1c2b', '#e0a13c'], 'intermission sky', 0.07), frame: 'clip' as const },
      { ...makePolaroid('m10-p3', 0.52, 0.72, 0.36, ['#4a2c1a', '#f2b063'], 'the walk home', -0.03), frame: 'plain' as const, captionFont: 'typewriter' as const },
    ];
    p.stickers = [
      makeTape('m10-st1', 0.3, 0.125, MOVIE.tape, -0.25, 0.11),
      makeTape('m10-st2', 0.7, 0.11, MOVIE.tape2, 0.3, 0.11),
      makeShape('m10-st3', 'star', 0.14, 0.6, 0.05, MOVIE.star, 0.25),
      makeShape('m10-st4', 'squiggle', 0.88, 0.68, 0.12, PINK.soft, -0.3),
    ];
    return p;
  })(),

  // p11 — review: ORANGE DAYS
  (() => {
    const p = page();
    p.texts = [
      makeText('m11-t1', 0.5, 0.12, 'ORANGE DAYS', { size: 0.085, color: MOVIE.deepOrange, lineHeight: 1 }),
      makeText('m11-t2', 0.5, 0.42, 'a citrus farm, a broken van,\none endless august.\nit smells like peel\nand sounds like a fan.', {
        font: 'typewriter', size: 0.026, color: MOVIE.ink, lineHeight: 1.8,
      }),
      makeText('m11-t3', 0.5, 0.62, 'the companion piece to every summer i didn’t save.', {
        font: 'hand', size: 0.028, color: MOVIE.faint, lineHeight: 1.5,
      }),
      makeText('m11-t4', 0.33, 0.88, 'watched: dec 2', { size: 0.024, color: MOVIE.faint, rotation: -0.04 }),
    ];
    p.stickers = [
      ...makeStars('m11-r', 0.5, 0.215, 5),
      makeTape('m11-st1', 0.1, 0.3, MOVIE.tape, -0.5, 0.1),
      makeShape('m11-st2', 'circle', 0.85, 0.35, 0.16, MOVIE.sand, 0),
      makeShape('m11-st3', 'squiggle', 0.15, 0.68, 0.15, MOVIE.orange, 0.35),
    ];
    p.strokes = [
      makeWave('m11-w1', 0.22, 0.185, 0.56, { color: MOVIE.orange, amp: 0.009, cycles: 6 }),
      makeWave('m11-w2', 0.62, 0.93, 0.26, { color: MOVIE.blue, amp: 0.006, cycles: 4 }),
    ];
    p.photos = [makePolaroid('m11-p1', 0.8, 0.84, 0.2, ['#3d2b1f', '#e8862e'], 'the orchard', -0.1)];
    return p;
  })(),

  // p12 — back page
  (() => {
    const p = page();
    p.texts = [
      makeText('m12-t1', 0.5, 0.38, 'to be continued…', { size: 0.065, color: MOVIE.orange, rotation: -0.03 }),
      makeText('m12-t2', 0.5, 0.5, 'more films, more feelings.\nwinter volume starts when the first\nmatinee gets dark at four.', {
        font: 'typewriter', size: 0.024, color: MOVIE.ink, lineHeight: 1.8,
      }),
      makeText('m12-t3', 0.5, 0.68, '· · ·', { size: 0.04, color: MOVIE.faint }),
      makeText('m12-t4', 0.5, 0.86, 'same booth, same seat, same heart', { font: 'hand', size: 0.026, color: MOVIE.faint }),
    ];
    p.stickers = [
      makeTape('m12-st1', 0.5, 0.06, MOVIE.tape, 0.08, 0.16),
      ...makeStars('m12-r', 0.5, 0.26, 3, 3, 0.04),
      makeShape('m12-st2', 'squiggle', 0.2, 0.62, 0.15, MOVIE.blue, -0.35),
      makeShape('m12-st3', 'circle', 0.8, 0.63, 0.17, MOVIE.sand, 0.25),
      makeShape('m12-st4', 'heart', 0.5, 0.76, 0.045, PINK.rose, -0.1),
    ];
    p.strokes = [
      makeWave('m12-w1', 0.3, 0.44, 0.4, { color: MOVIE.orange, amp: 0.007, cycles: 5 }),
      makeLine('m12-l1', 0.16, 0.15, 0.84, 0.15, { color: MOVIE.sand, size: 0.004 }),
    ];
    return p;
  })(),
];

/* ================================================================== */
/* 2 — SKETCHBOOK (doodles, 8 pages)                                   */
/* ================================================================== */

const sketchbookPages: PageContent[] = [
  // p1 — warm-up loops + highlighter swatches
  (() => {
    const p = page();
    p.texts = [
      makeText('s1-t1', 0.5, 0.1, 'day 1 — warm up lines', { size: 0.05, color: INKDOODLE, rotation: -0.015 }),
      makeText('s1-t2', 0.76, 0.68, 'loops until they breathe', { size: 0.022, color: '#8a8f98' }),
      makeText('s1-t3', 0.5, 0.945, 'butter · blossom · pool', { font: 'typewriter', size: 0.02, color: '#8a8f98' }),
    ];
    p.strokes = [
      makeLoopRow('s1-l1', 0.08, 0.28, 0.84, 9, INKDOODLE),
      makeLoopRow('s1-l2', 0.08, 0.44, 0.84, 9, '#6b7280'),
      makeLoopRow('s1-l3', 0.08, 0.6, 0.84, 9, '#9aa1ad'),
      makeStroke('s1-h1', 'highlighter', '#f9e07e', 0.036, [pt(0.08, 0.78), pt(0.92, 0.78)]),
      makeStroke('s1-h2', 'highlighter', '#f4a7bb', 0.036, [pt(0.08, 0.86), pt(0.92, 0.86)]),
      makeStroke('s1-h3', 'highlighter', '#a8dadc', 0.036, [pt(0.08, 0.94), pt(0.92, 0.94)]),
    ];
    p.stickers = [makeTape('s1-st1', 0.88, 0.055, '#e8d8a8', 0.35, 0.12)];
    return p;
  })(),

  // p2 — stars
  (() => {
    const p = page();
    p.texts = [
      makeText('s2-t1', 0.5, 0.1, 'shiny things', { size: 0.05, color: INKDOODLE, rotation: 0.01 }),
      makeText('s2-t2', 0.3, 0.84, 'five points, every time', { size: 0.024, color: '#8a8f98' }),
      makeText('s2-t3', 0.72, 0.46, '(this one’s for you)', { size: 0.022, color: '#8a8f98', rotation: 0.08 }),
    ];
    p.strokes = [
      makeStarStroke('s2-x1', 0.28, 0.32, 0.1, '#e8a13c'),
      makeStarStroke('s2-x2', 0.68, 0.27, 0.07, '#d9722a', -Math.PI / 2 + 0.4),
      makeStarStroke('s2-x3', 0.48, 0.55, 0.13, '#e56b8c', -Math.PI / 2 - 0.2),
      makeStarStroke('s2-x4', 0.76, 0.65, 0.08, '#7fa8c9', -Math.PI / 2 + 0.25),
      makeStarStroke('s2-x5', 0.24, 0.66, 0.055, '#a3b18a'),
      makeWave('s2-w1', 0.14, 0.9, 0.32, { color: '#e8a13c', amp: 0.007, cycles: 4 }),
    ];
    p.stickers = [
      makeShape('s2-st1', 'star', 0.9, 0.14, 0.05, '#e8a13c', 0.15),
      makeShape('s2-st2', 'star', 0.12, 0.16, 0.035, '#f4a7bb', -0.2),
      makeTape('s2-st3', 0.5, 0.04, '#e8d8a8', 0.05, 0.15),
    ];
    return p;
  })(),

  // p3 — flowers
  (() => {
    const p = page();
    p.texts = [
      makeText('s3-t1', 0.5, 0.09, 'botany practice', { size: 0.05, color: INKDOODLE, rotation: -0.01 }),
      makeText('s3-t2', 0.5, 0.9, 'petals = one line, no lifting', { font: 'typewriter', size: 0.022, color: '#8a8f98' }),
    ];
    p.strokes = [
      makeStroke('s3-f1', 'pen', '#d9722a', 0.008, makeFlowerPoints(0.3, 0.34, 0.085, 6)),
      makeLine('s3-f1s', 0.3, 0.42, 0.32, 0.62, { color: '#a3b18a', size: 0.006 }),
      makeStroke('s3-f2', 'pen', '#e56b8c', 0.008, makeFlowerPoints(0.66, 0.46, 0.07, 5, 0.65)),
      makeLine('s3-f2s', 0.66, 0.53, 0.65, 0.74, { color: '#a3b18a', size: 0.006 }),
      makeStroke('s3-f3', 'pen', '#7fa8c9', 0.008, makeFlowerPoints(0.46, 0.76, 0.055, 6, 0.55)),
      makeWave('s3-w1', 0.55, 0.66, 0.22, { color: '#a3b18a', amp: 0.012, cycles: 2 }),
      makeCircleStroke('s3-c1', 0.82, 0.24, 0.05, '#f4a7bb'),
      makeCircleStroke('s3-c2', 0.82, 0.24, 0.02, '#f4a7bb'),
    ];
    p.stickers = [
      makeShape('s3-st1', 'squiggle', 0.14, 0.56, 0.12, '#a3b18a', -0.3),
      makeTape('s3-st2', 0.2, 0.04, '#e8d8a8', -0.12, 0.13),
      makeShape('s3-st3', 'heart', 0.86, 0.82, 0.04, '#e56b8c', 0.2),
    ];
    return p;
  })(),

  // p4 — sticker sheet
  (() => {
    const p = page();
    p.texts = [
      makeText('s4-t1', 0.5, 0.09, 'sticker test page', { size: 0.05, color: INKDOODLE, rotation: 0.015 }),
      makeText('s4-t2', 0.5, 0.93, 'no lifting, no fear — peel & place', { font: 'typewriter', size: 0.022, color: '#8a8f98' }),
    ];
    p.stickers = [
      makeShape('s4-st1', 'circle', 0.24, 0.28, 0.13, '#a8dadc', 0),
      makeShape('s4-st2', 'triangle', 0.52, 0.28, 0.12, '#f9d97e', 0.1),
      makeShape('s4-st3', 'star', 0.78, 0.28, 0.12, '#e8a13c', -0.15),
      makeShape('s4-st4', 'heart', 0.24, 0.52, 0.12, '#e56b8c', 0.12),
      makeShape('s4-st5', 'squiggle', 0.52, 0.52, 0.13, '#7fa8c9', -0.3),
      makeShape('s4-st6', 'arrow', 0.78, 0.52, 0.13, '#3fae5a', 0.35),
      makeShape('s4-st7', 'circle', 0.38, 0.74, 0.09, '#f4a7bb', 0),
      makeShape('s4-st8', 'star', 0.64, 0.74, 0.09, '#d9722a', 0.2),
      makeTape('s4-st9', 0.5, 0.045, '#e8d8a8', -0.05, 0.16),
      makeTape('s4-st10', 0.14, 0.88, '#f2c078', 0.4, 0.1),
    ];
    p.strokes = [
      makeLine('s4-l1', 0.1, 0.4, 0.9, 0.4, { color: '#c9ced6', size: 0.003 }),
      makeLine('s4-l2', 0.1, 0.63, 0.9, 0.63, { color: '#c9ced6', size: 0.003 }),
    ];
    return p;
  })(),

  // p5 — boxes & arrows
  (() => {
    const p = page();
    p.texts = [
      makeText('s5-t1', 0.5, 0.09, 'day 5 — boxes & arrows', { size: 0.05, color: INKDOODLE, rotation: -0.015 }),
      makeText('s5-t2', 0.28, 0.33, 'idea', { font: 'sans', size: 0.024, color: INKDOODLE }),
      makeText('s5-t3', 0.28, 0.58, 'plan', { font: 'sans', size: 0.024, color: INKDOODLE }),
      makeText('s5-t4', 0.28, 0.83, 'ship it', { font: 'sans', size: 0.024, color: INKDOODLE }),
      makeText('s5-t5', 0.62, 0.71, 'repeat forever', { size: 0.022, color: '#8a8f98', rotation: 0.12 }),
    ];
    p.strokes = [
      makeRectStroke('s5-r1', 0.28, 0.33, 0.26, 0.09, { color: INKDOODLE, size: 0.007 }),
      makeRectStroke('s5-r2', 0.28, 0.58, 0.26, 0.09, { color: INKDOODLE, size: 0.007 }),
      makeRectStroke('s5-r3', 0.28, 0.83, 0.26, 0.09, { color: INKDOODLE, size: 0.007 }),
      makeLine('s5-a1', 0.28, 0.375, 0.28, 0.535, { color: INKDOODLE, size: 0.007 }),
      makeLine('s5-a1h', 0.258, 0.505, 0.28, 0.535, { color: INKDOODLE, size: 0.007 }),
      makeLine('s5-a1h2', 0.302, 0.505, 0.28, 0.535, { color: INKDOODLE, size: 0.007 }),
      makeLine('s5-a2', 0.28, 0.625, 0.28, 0.785, { color: INKDOODLE, size: 0.007 }),
      makeLine('s5-a2h', 0.258, 0.755, 0.28, 0.785, { color: INKDOODLE, size: 0.007 }),
      makeLine('s5-a2h2', 0.302, 0.755, 0.28, 0.785, { color: INKDOODLE, size: 0.007 }),
      makeLine('s5-c1', 0.42, 0.83, 0.72, 0.83, { color: '#9aa1ad', size: 0.006 }),
      makeLine('s5-c2', 0.72, 0.83, 0.72, 0.33, { color: '#9aa1ad', size: 0.006 }),
      makeLine('s5-c3', 0.72, 0.33, 0.42, 0.33, { color: '#9aa1ad', size: 0.006 }),
      makeStroke('s5-hl', 'highlighter', '#a8dadc', 0.045, [pt(0.2, 0.83), pt(0.36, 0.83)]),
    ];
    p.stickers = [
      makeTape('s5-st1', 0.85, 0.06, '#e8d8a8', -0.3, 0.11),
      makeShape('s5-st2', 'squiggle', 0.85, 0.55, 0.12, '#f4a7bb', 0.3),
    ];
    return p;
  })(),

  // p6 — marker palette
  (() => {
    const p = page();
    const swatches: Array<[string, string]> = [
      ['#f9e07e', 'butter'],
      ['#f4a7bb', 'blossom'],
      ['#a8dadc', 'pool'],
      ['#a3b18a', 'leaf'],
      ['#f2b063', 'peach'],
      ['#9aa1ad', 'slate'],
    ];
    p.texts = [
      makeText('s6-t1', 0.5, 0.09, 'marker palette', { size: 0.05, color: INKDOODLE, rotation: 0.01 }),
      ...swatches.map(([hex, name], i) =>
        makeText(`s6-n${i}`, 0.68, 0.24 + i * 0.115, name, { size: 0.026, color: '#6b7280', align: 'left' }),
      ),
      makeText('s6-t2', 0.5, 0.94, 'mixed wet, dried happy', { font: 'typewriter', size: 0.022, color: '#8a8f98' }),
    ];
    p.strokes = swatches.map(([hex], i) =>
      makeStroke(`s6-sw${i}`, 'highlighter', hex, 0.05, [pt(0.1, 0.24 + i * 0.115), pt(0.52, 0.24 + i * 0.115)]),
    );
    p.stickers = [
      makeTape('s6-st1', 0.86, 0.08, '#e8d8a8', 0.25, 0.11),
      makeShape('s6-st2', 'squiggle', 0.82, 0.85, 0.14, '#a3b18a', -0.2),
    ];
    return p;
  })(),

  // p7 — mood circles
  (() => {
    const p = page();
    const moods: Array<[string, string, number]> = [
      ['#f9e07e', 'sunny', 0.075],
      ['#a8dadc', 'calm', 0.06],
      ['#f4a7bb', 'soft', 0.085],
      ['#a3b18a', 'fresh', 0.055],
      ['#e8a13c', 'buzzing', 0.07],
      ['#9aa1ad', 'foggy', 0.065],
    ];
    p.texts = [
      makeText('s7-t1', 0.5, 0.09, 'mood circles', { size: 0.05, color: INKDOODLE, rotation: -0.01 }),
      ...moods.map(([, name], i) =>
        makeText(
          `s7-n${i}`,
          i % 2 === 0 ? 0.26 : 0.74,
          (i < 2 ? 0.36 : i < 4 ? 0.58 : 0.8) + 0.09,
          name,
          { size: 0.024, color: '#6b7280' },
        ),
      ),
      makeText('s7-t2', 0.5, 0.955, 'spinning slowly, all of them', { font: 'typewriter', size: 0.02, color: '#8a8f98' }),
    ];
    p.strokes = moods.map(([hex], i) =>
      makeCircleStroke(
        `s7-c${i}`,
        i % 2 === 0 ? 0.26 : 0.74,
        i < 2 ? 0.36 : i < 4 ? 0.58 : 0.8,
        moods[i][2],
        hex,
        0.009,
      ),
    );
    p.stickers = [
      makeTape('s7-st1', 0.5, 0.04, '#e8d8a8', 0.03, 0.15),
      makeShape('s7-st2', 'circle', 0.88, 0.16, 0.08, '#f9e07e', 0),
      makeShape('s7-st3', 'squiggle', 0.12, 0.9, 0.11, '#a8dadc', 0.4),
    ];
    return p;
  })(),

  // p8 — the end?
  (() => {
    const p = page();
    p.texts = [
      makeText('s8-t1', 0.5, 0.32, 'the end?', { size: 0.09, color: INKDOODLE, rotation: -0.03 }),
      makeText('s8-t2', 0.5, 0.46, '(never. sketch forever.)', { size: 0.03, color: '#8a8f98' }),
      makeText('s8-t3', 0.5, 0.86, '— the management', { font: 'typewriter', size: 0.022, color: '#8a8f98' }),
    ];
    p.strokes = [
      makeWave('s8-w1', 0.3, 0.385, 0.4, { color: '#e8a13c', amp: 0.008, cycles: 5 }),
      makeLoopRow('s8-l1', 0.12, 0.62, 0.76, 8, '#9aa1ad'),
    ];
    p.stickers = [
      makeShape('s8-st1', 'star', 0.22, 0.2, 0.06, '#e8a13c', -0.2),
      makeShape('s8-st2', 'star', 0.78, 0.24, 0.045, '#f4a7bb', 0.25),
      makeShape('s8-st3', 'circle', 0.8, 0.72, 0.15, '#a8dadc', 0),
      makeTape('s8-st4', 0.5, 0.06, '#e8d8a8', -0.06, 0.15),
      makeShape('s8-st5', 'squiggle', 0.2, 0.78, 0.12, '#a3b18a', 0.3),
    ];
    return p;
  })(),
];

/* ================================================================== */
/* 3 — TRIPS (boarding-pass style, 8 pages)                            */
/* ================================================================== */

const tripsPages: PageContent[] = [
  // p1 — title page
  (() => {
    const p = page();
    p.texts = [
      makeText('t1-t1', 0.5, 0.18, 'TRIPS', { font: 'sans', size: 0.1, color: TRIP.navy, lineHeight: 1 }),
      makeText('t1-t2', 0.5, 0.29, 'flight notes & boarding passes', { font: 'sans', size: 0.028, color: TRIP.steel }),
      makeText('t1-t3', 0.5, 0.92, 'est. whenever the backpack was packed', { font: 'typewriter', size: 0.02, color: TRIP.steel }),
    ];
    p.strokes = [
      makeDashedLine('t1-d1', 0.2, 0.36, 0.8, 0.36, { color: TRIP.steel, size: 0.005 }),
      makeWave('t1-w1', 0.38, 0.55, 0.24, { color: TRIP.steel, amp: 0.008, cycles: 4 }),
    ];
    p.photos = [makePolaroid('t1-p1', 0.5, 0.63, 0.34, ['#274060', '#a8dadc'], 'somewhere north', -0.03)];
    p.stickers = [
      makeTape('t1-st1', 0.5, 0.05, TRIP.tape, -0.04, 0.16),
      makeShape('t1-st2', 'circle', 0.18, 0.86, 0.1, '#a8dadc', 0),
      makeShape('t1-st3', 'arrow', 0.84, 0.5, 0.09, TRIP.navy, 0.4),
    ];
    return p;
  })(),

  // p2 — boarding pass: OSLO → TROMSØ
  (() => {
    const p = page();
    p.texts = [
      makeText('t2-t1', 0.36, 0.16, 'BOARDING PASS', { font: 'sans', size: 0.028, color: TRIP.navy, align: 'left' }),
      makeText('t2-t2', 0.36, 0.215, 'FLY-SK 23 · SKETCH AIR', { font: 'sans', size: 0.019, color: TRIP.steel, align: 'left' }),
      makeText('t2-t3', 0.36, 0.3, 'OSLO → TROMSØ', { font: 'sans', size: 0.034, color: TRIP.ink, align: 'left' }),
      makeText('t2-t4', 0.86, 0.245, 'SEAT 12A', { font: 'sans', size: 0.024, color: TRIP.navy }),
      makeText('t2-t5', 0.86, 0.31, 'GATE B4', { font: 'sans', size: 0.024, color: TRIP.navy }),
      makeText('t2-t6', 0.68, 0.75, 'day 1 — cold\nand absolutely perfect', { size: 0.024, color: TRIP.ink, lineHeight: 1.6 }),
      makeText('t2-t7', 0.36, 0.475, 'dep 07:20 · arr 11:05 · paper class', { font: 'typewriter', size: 0.018, color: TRIP.steel, align: 'left' }),
    ];
    p.strokes = [
      makeRectStroke('t2-r1', 0.5, 0.3, 0.8, 0.34, { color: TRIP.navy, size: 0.008 }),
      makeDashedLine('t2-d1', 0.74, 0.14, 0.74, 0.47, { color: TRIP.steel, size: 0.005 }),
      makeWave('t2-w1', 0.2, 0.4, 0.42, { color: TRIP.steel, amp: 0.01, cycles: 3 }),
    ];
    p.photos = [{ ...makePolaroid('t2-p1', 0.3, 0.68, 0.3, ['#274060', '#a8dadc'], 'fjord light', 0.05), frame: 'plain' as const }];
    p.stickers = [
      makeShape('t2-st1', 'circle', 0.2, 0.4, 0.028, TRIP.navy, 0),
      makeShape('t2-st2', 'circle', 0.6, 0.4, 0.028, TRIP.navy, 0),
      makeTape('t2-st3', 0.62, 0.53, TRIP.tape, -0.25, 0.12),
      makeShape('t2-st4', 'star', 0.88, 0.6, 0.04, '#f9d97e', 0.2),
    ];
    return p;
  })(),

  // p3 — boarding pass: KYOTO
  (() => {
    const p = page();
    p.texts = [
      makeText('t3-t1', 0.62, 0.16, 'BOARDING PASS', { font: 'sans', size: 0.028, color: TRIP.navy, align: 'right' }),
      makeText('t3-t2', 0.62, 0.215, 'FLY-SK 31 · SKETCH AIR', { font: 'sans', size: 0.019, color: TRIP.steel, align: 'right' }),
      makeText('t3-t3', 0.62, 0.3, 'REYKJAVÍK → KYOTO', { font: 'sans', size: 0.03, color: TRIP.ink, align: 'right' }),
      makeText('t3-t4', 0.14, 0.245, 'SEAT 3F', { font: 'sans', size: 0.024, color: TRIP.navy }),
      makeText('t3-t5', 0.14, 0.31, 'GATE K2', { font: 'sans', size: 0.024, color: TRIP.navy }),
      makeText('t3-t6', 0.3, 0.78, 'temple rain. umbrellas\nare the local handwriting.', {
        size: 0.024, color: TRIP.ink, lineHeight: 1.6,
      }),
      makeText('t3-t7', 0.62, 0.475, 'dep 13:45 · arr 09:10 +1 · window seat', {
        font: 'typewriter', size: 0.018, color: TRIP.steel, align: 'right',
      }),
    ];
    p.strokes = [
      makeRectStroke('t3-r1', 0.5, 0.3, 0.8, 0.34, { color: TRIP.green, size: 0.008 }),
      makeDashedLine('t3-d1', 0.26, 0.14, 0.26, 0.47, { color: TRIP.steel, size: 0.005 }),
      makeWave('t3-w1', 0.4, 0.4, 0.38, { color: TRIP.green, amp: 0.01, cycles: 3 }),
    ];
    p.photos = [{ ...makePolaroid('t3-p1', 0.7, 0.66, 0.3, ['#3a5a40', '#dad7cd'], 'temple rain', -0.06), frame: 'plain' as const }];
    p.stickers = [
      makeShape('t3-st1', 'circle', 0.4, 0.4, 0.028, TRIP.green, 0),
      makeShape('t3-st2', 'circle', 0.78, 0.4, 0.028, TRIP.green, 0),
      makeTape('t3-st3', 0.38, 0.55, TRIP.tape, 0.3, 0.12),
      makeShape('t3-st4', 'squiggle', 0.12, 0.62, 0.11, '#a8dadc', -0.3),
    ];
    return p;
  })(),

  // p4 — route map
  (() => {
    const p = page();
    const stops: Array<[number, number, string]> = [
      [0.2, 0.34, 'OSLO'],
      [0.44, 0.56, 'KYOTO'],
      [0.66, 0.38, 'LISBON'],
      [0.84, 0.62, 'HOME'],
    ];
    p.texts = [
      makeText('t4-t1', 0.5, 0.1, 'the long way around', { size: 0.05, color: TRIP.navy, rotation: -0.015 }),
      ...stops.map(([x, y, name], i) =>
        makeText(`t4-n${i}`, x, y + 0.055, name, { font: 'sans', size: 0.022, color: TRIP.navy }),
      ),
      makeText('t4-t2', 0.5, 0.93, 'dotted = traveled. solid = someday.', { font: 'typewriter', size: 0.02, color: TRIP.steel }),
    ];
    p.strokes = [
      makeDashedLine('t4-p1', 0.2, 0.34, 0.44, 0.56, { color: TRIP.steel, size: 0.005, dash: 0.014, gap: 0.012 }),
      makeDashedLine('t4-p2', 0.44, 0.56, 0.66, 0.38, { color: TRIP.steel, size: 0.005, dash: 0.014, gap: 0.012 }),
      makeDashedLine('t4-p3', 0.66, 0.38, 0.84, 0.62, { color: TRIP.steel, size: 0.005, dash: 0.014, gap: 0.012 }),
      makeWave('t4-w1', 0.12, 0.82, 0.3, { color: '#a8dadc', amp: 0.012, cycles: 3 }),
      makeWave('t4-w2', 0.58, 0.78, 0.3, { color: '#a8dadc', amp: 0.014, cycles: 3 }),
    ];
    p.stickers = stops.map(([x, y], i) =>
      makeShape(`t4-s${i}`, 'circle', x, y, 0.032, i === 3 ? TRIP.red : TRIP.navy, 0),
    );
    p.stickers.push(
      makeTape('t4-st1', 0.5, 0.045, TRIP.tape, 0.05, 0.15),
      makeShape('t4-st2', 'star', 0.14, 0.62, 0.04, '#f9d97e', -0.2),
    );
    return p;
  })(),

  // p5 — boarding pass: LISBON
  (() => {
    const p = page();
    p.texts = [
      makeText('t5-t1', 0.36, 0.16, 'BOARDING PASS', { font: 'sans', size: 0.028, color: TRIP.navy, align: 'left' }),
      makeText('t5-t2', 0.36, 0.215, 'FLY-SK 47 · SKETCH AIR', { font: 'sans', size: 0.019, color: TRIP.steel, align: 'left' }),
      makeText('t5-t3', 0.36, 0.3, 'KYOTO → LISBON', { font: 'sans', size: 0.032, color: TRIP.ink, align: 'left' }),
      makeText('t5-t4', 0.86, 0.245, 'SEAT 8C', { font: 'sans', size: 0.024, color: TRIP.navy }),
      makeText('t5-t5', 0.86, 0.31, 'GATE T1', { font: 'sans', size: 0.024, color: TRIP.navy }),
      makeText('t5-t6', 0.68, 0.72, 'paste the trolley ticket\nright here when found', {
        font: 'typewriter', size: 0.019, color: TRIP.steel, lineHeight: 1.6,
      }),
      makeText('t5-t7', 0.36, 0.475, 'dep 10:30 · arr 16:55 · carry-on only', {
        font: 'typewriter', size: 0.018, color: TRIP.steel, align: 'left',
      }),
    ];
    p.strokes = [
      makeRectStroke('t5-r1', 0.5, 0.3, 0.8, 0.34, { color: TRIP.red, size: 0.008 }),
      makeDashedLine('t5-d1', 0.74, 0.14, 0.74, 0.47, { color: TRIP.steel, size: 0.005 }),
      makeDashedRect('t5-r2', 0.3, 0.68, 0.26, 0.18, { color: TRIP.steel, size: 0.005 }),
      makeWave('t5-w1', 0.2, 0.4, 0.42, { color: TRIP.red, amp: 0.01, cycles: 3 }),
    ];
    p.photos = [{ ...makePolaroid('t5-p1', 0.7, 0.66, 0.28, ['#274060', '#a8dadc'], 'yellow tram', 0.07), frame: 'plain' as const }];
    p.stickers = [
      makeShape('t5-st1', 'circle', 0.2, 0.4, 0.028, TRIP.red, 0),
      makeShape('t5-st2', 'circle', 0.6, 0.4, 0.028, TRIP.red, 0),
      makeTape('t5-st3', 0.12, 0.62, TRIP.tape, -0.4, 0.11),
      makeShape('t5-st4', 'arrow', 0.86, 0.84, 0.09, TRIP.navy, -0.5),
    ];
    return p;
  })(),

  // p6 — skies collected
  (() => {
    const p = page();
    p.texts = [
      makeText('t6-t1', 0.5, 0.09, 'skies collected', { size: 0.05, color: TRIP.navy, rotation: 0.015 }),
      makeText('t6-t2', 0.5, 0.94, 'the carry-on duty-free of it all', { font: 'typewriter', size: 0.02, color: TRIP.steel }),
    ];
    p.photos = [
      makePolaroid('t6-p1', 0.32, 0.36, 0.36, ['#274060', '#a8dadc'], 'window seat, outbound', -0.04),
      { ...makePolaroid('t6-p2', 0.68, 0.64, 0.36, ['#3a5a40', '#dad7cd'], 'window seat, return', 0.05), frame: 'clip' as const },
    ];
    p.stickers = [
      makeTape('t6-st1', 0.32, 0.13, TRIP.tape, -0.2, 0.11),
      makeTape('t6-st2', 0.68, 0.42, TRIP.tape, 0.3, 0.11),
      makeShape('t6-st3', 'squiggle', 0.14, 0.72, 0.12, '#a8dadc', -0.35),
      makeShape('t6-st4', 'star', 0.88, 0.18, 0.04, '#f9d97e', 0.15),
    ];
    return p;
  })(),

  // p7 — packing list
  (() => {
    const p = page();
    const items = ['camera + film', 'one warm coat', 'notebook + pens', 'snacks (many)', 'headphones', 'luck'];
    p.texts = [
      makeText('t7-t1', 0.36, 0.1, 'packing list', { size: 0.055, color: TRIP.navy, rotation: -0.02 }),
      ...items.map((it, i) =>
        makeText(`t7-n${i}`, 0.32, 0.27 + i * 0.105, it, { font: 'sans', size: 0.024, color: TRIP.ink, align: 'left' }),
      ),
      makeText('t7-t2', 0.72, 0.92, 'packed by a professional', { font: 'typewriter', size: 0.02, color: TRIP.steel }),
    ];
    p.strokes = [
      makeDashedRect('t7-r1', 0.5, 0.53, 0.74, 0.72, { color: TRIP.steel, size: 0.005 }),
      ...items.map((_, i) => {
        const x = 0.17;
        const y = 0.27 + i * 0.105;
        if (i >= 4) {
          // not packed yet — empty checkbox
          return makeRectStroke(`t7-c${i}`, x, y, 0.03, 0.032, { color: TRIP.steel, size: 0.005 });
        }
        return makeStroke(`t7-c${i}`, 'pen', TRIP.green, 0.008, [
          pt(x - 0.014, y),
          pt(x - 0.002, y + 0.014),
          pt(x + 0.02, y - 0.016),
        ]);
      }),
      makeWave('t7-w1', 0.24, 0.15, 0.24, { color: TRIP.red, amp: 0.007, cycles: 4 }),
    ];
    p.stickers = [
      makeTape('t7-st1', 0.5, 0.045, TRIP.tape, -0.05, 0.14),
      makeShape('t7-st2', 'star', 0.86, 0.24, 0.04, '#f9d97e', 0.2),
    ];
    return p;
  })(),

  // p8 — next stop
  (() => {
    const p = page();
    p.texts = [
      makeText('t8-t1', 0.5, 0.26, 'NEXT STOP:', { font: 'sans', size: 0.03, color: TRIP.steel, lineHeight: 1 }),
      makeText('t8-t2', 0.5, 0.4, 'somewhere new', { size: 0.075, color: TRIP.navy, rotation: -0.02 }),
      makeText('t8-t3', 0.5, 0.74, '( to be stamped )', { font: 'typewriter', size: 0.024, color: TRIP.steel }),
    ];
    p.strokes = [
      makeDashedLine('t8-d1', 0.12, 0.55, 0.88, 0.55, { color: TRIP.steel, size: 0.006, dash: 0.02, gap: 0.016 }),
      makeWave('t8-w1', 0.3, 0.465, 0.4, { color: '#a8dadc', amp: 0.008, cycles: 5 }),
      makeCircleStroke('t8-c1', 0.5, 0.86, 0.05, TRIP.steel, 0.006),
    ];
    p.stickers = [
      makeShape('t8-st1', 'arrow', 0.5, 0.63, 0.14, TRIP.navy, 0.25),
      makeShape('t8-st2', 'circle', 0.88, 0.86, 0.09, '#a8dadc', 0),
      makeShape('t8-st3', 'star', 0.14, 0.2, 0.045, '#f9d97e', -0.2),
      makeTape('t8-st4', 0.5, 0.09, TRIP.tape, 0.06, 0.16),
    ];
    return p;
  })(),
];

/* ================================================================== */
/* 4 — birthday bby (pink scrapbook, 6 pages)                          */
/* ================================================================== */

const birthdayPages: PageContent[] = [
  // p1 — cover spread
  (() => {
    const p = page(PINK.pale);
    p.texts = [
      makeText('b1-t1', 0.5, 0.24, 'you’re turning 21!', { size: 0.085, color: PINK.hot, rotation: -0.03, lineHeight: 1 }),
      makeText('b1-t2', 0.5, 0.36, '( cue confetti )', { size: 0.03, color: PINK.ink }),
      makeText('b1-t3', 0.5, 0.88, 'a whole day, just for you', { font: 'typewriter', size: 0.022, color: PINK.ink }),
    ];
    p.stickers = [
      makeShape('b1-st1', 'heart', 0.16, 0.16, 0.07, PINK.rose, -0.25),
      makeShape('b1-st2', 'heart', 0.84, 0.2, 0.06, PINK.hot, 0.2),
      makeShape('b1-st3', 'heart', 0.88, 0.52, 0.05, PINK.soft, -0.15),
      makeShape('b1-st4', 'heart', 0.14, 0.6, 0.045, PINK.soft, 0.3),
      makeShape('b1-c1', 'circle', 0.3, 0.5, 0.022, PINK.gold, 0),
      makeShape('b1-c2', 'circle', 0.7, 0.44, 0.024, PINK.blue, 0),
      makeShape('b1-c3', 'circle', 0.44, 0.55, 0.02, PINK.rose, 0),
      makeShape('b1-c4', 'circle', 0.58, 0.62, 0.024, PINK.gold, 0),
      makeShape('b1-c5', 'circle', 0.24, 0.74, 0.02, PINK.blue, 0),
      makeTape('b1-st5', 0.5, 0.07, PINK.tape, -0.06, 0.15),
      makeTape('b1-st6', 0.12, 0.44, PINK.tape, -0.5, 0.1),
    ];
    p.strokes = [
      makeWave('b1-w1', 0.3, 0.285, 0.4, { color: PINK.hot, amp: 0.008, cycles: 5 }),
      makeWave('b1-w2', 0.36, 0.44, 0.28, { color: PINK.rose, amp: 0.006, cycles: 4 }),
    ];
    return p;
  })(),

  // p2 — best day ever polaroid
  (() => {
    const p = page();
    p.texts = [makeText('b2-t1', 0.78, 0.8, '10.26 — the one', { size: 0.03, color: PINK.ink, rotation: -0.06 })];
    p.photos = [makePolaroid('b2-p1', 0.42, 0.42, 0.42, [PINK.pale, PINK.rose], 'best day ever', -0.05)];
    p.stickers = [
      makeShape('b2-st1', 'heart', 0.82, 0.24, 0.07, PINK.hot, 0.25),
      makeShape('b2-st2', 'heart', 0.14, 0.68, 0.05, PINK.rose, -0.2),
      makeTape('b2-st3', 0.42, 0.13, PINK.tape, -0.12, 0.13),
      makeTape('b2-st4', 0.12, 0.2, PINK.tape, -0.5, 0.1),
      makeShape('b2-st5', 'squiggle', 0.84, 0.6, 0.12, PINK.soft, 0.4),
    ];
    p.strokes = [makeWave('b2-w1', 0.6, 0.88, 0.24, { color: PINK.hot, amp: 0.007, cycles: 4 })];
    return p;
  })(),

  // p3 — wishes
  (() => {
    const p = page();
    const wishes = [
      '1. health, obviously',
      '2. one soft year',
      '3. cake for breakfast',
      '4. dancing, badly',
      '5. us, forever',
    ];
    p.texts = [
      makeText('b3-t1', 0.5, 0.11, 'wishes', { size: 0.06, color: PINK.hot, rotation: -0.02 }),
      ...wishes.map((w, i) =>
        makeText(`b3-n${i}`, 0.5, 0.27 + i * 0.125, w, { font: 'typewriter', size: 0.026, color: PINK.ink }),
      ),
      makeText('b3-t2', 0.5, 0.93, 'candles sold separately', { font: 'typewriter', size: 0.02, color: PINK.ink }),
    ];
    p.stickers = [
      makeShape('b3-st1', 'heart', 0.78, 0.27, 0.04, PINK.rose, 0.15),
      makeShape('b3-st2', 'heart', 0.78, 0.52, 0.04, PINK.soft, -0.2),
      makeShape('b3-st3', 'heart', 0.78, 0.77, 0.04, PINK.hot, 0.3),
      makeTape('b3-st4', 0.5, 0.045, PINK.tape, 0.05, 0.14),
      makeShape('b3-st5', 'circle', 0.16, 0.9, 0.1, PINK.pale, 0),
    ];
    p.strokes = [
      makeWave('b3-w1', 0.38, 0.155, 0.24, { color: PINK.hot, amp: 0.007, cycles: 4 }),
      makeLine('b3-l1', 0.2, 0.22, 0.8, 0.22, { color: PINK.pale, size: 0.004 }),
    ];
    return p;
  })(),

  // p4 — party photos
  (() => {
    const p = page();
    p.texts = [makeText('b4-t1', 0.5, 0.955, 'party tax: paid in slices', { font: 'typewriter', size: 0.022, color: PINK.ink })];
    p.photos = [
      makePolaroid('b4-p1', 0.32, 0.34, 0.36, [PINK.soft, PINK.hot], 'cake corner', -0.06),
      makePolaroid('b4-p2', 0.68, 0.66, 0.36, [PINK.rose, PINK.pale], 'the crew', 0.05),
    ];
    p.stickers = [
      makeShape('b4-st1', 'heart', 0.88, 0.3, 0.05, PINK.hot, 0.2),
      makeShape('b4-st2', 'heart', 0.12, 0.56, 0.045, PINK.rose, -0.25),
      makeTape('b4-st3', 0.32, 0.12, PINK.tape, -0.2, 0.11),
      makeTape('b4-st4', 0.68, 0.44, PINK.tape, 0.3, 0.11),
      makeShape('b4-st5', 'star', 0.14, 0.16, 0.04, PINK.gold, 0.1),
    ];
    return p;
  })(),

  // p5 — letters for you
  (() => {
    const p = page();
    p.texts = [
      makeText('b5-t1', 0.5, 0.1, 'letters for you', { size: 0.055, color: PINK.hot, rotation: 0.015 }),
      makeText('b5-t2', 0.5, 0.46, 'dear you,\ntwenty-one looks good already.\nkeep the loud laugh.\nkeep the bad karaoke.\nwe’ll be here for all of it.', {
        font: 'typewriter', size: 0.026, color: PINK.ink, lineHeight: 1.9,
      }),
      makeText('b5-t3', 0.5, 0.86, '— sealed with a sticker', { size: 0.024, color: PINK.ink }),
    ];
    p.stickers = [
      makeShape('b5-st1', 'heart', 0.5, 0.66, 0.05, PINK.hot, -0.1),
      { id: 'b5-st2', kind: 'frame', value: PINK.soft, x: 0.85, y: 0.18, size: 0.12, rotation: 0.15, color: PINK.soft },
      makeTape('b5-st3', 0.5, 0.05, PINK.tape, -0.04, 0.15),
      makeShape('b5-st4', 'circle', 0.15, 0.75, 0.1, PINK.pale, 0),
    ];
    p.strokes = [makeWave('b5-w1', 0.28, 0.145, 0.44, { color: PINK.rose, amp: 0.007, cycles: 5 })];
    return p;
  })(),

  // p6 — make a wish
  (() => {
    const p = page();
    p.texts = [
      makeText('b6-t1', 0.5, 0.24, 'make a wish', { size: 0.08, color: PINK.hot, rotation: -0.02 }),
      makeText('b6-t2', 0.5, 0.74, 'blow them out. all twenty-one.', { font: 'typewriter', size: 0.024, color: PINK.ink }),
      makeText('b6-t3', 0.5, 0.92, 'see you at 22 ✦', { size: 0.026, color: PINK.ink }),
    ];
    p.stickers = [
      makeShape('b6-st1', 'heart', 0.5, 0.48, 0.22, PINK.hot, -0.06),
      makeShape('b6-st2', 'star', 0.24, 0.4, 0.05, PINK.gold, -0.2),
      makeShape('b6-st3', 'star', 0.76, 0.38, 0.045, PINK.gold, 0.25),
      makeShape('b6-st4', 'star', 0.3, 0.6, 0.04, PINK.gold, 0.4),
      makeShape('b6-st5', 'star', 0.7, 0.6, 0.05, PINK.gold, -0.3),
      makeTape('b6-st6', 0.5, 0.07, PINK.tape, 0.07, 0.16),
      makeShape('b6-st7', 'circle', 0.14, 0.8, 0.09, PINK.pale, 0),
    ];
    p.strokes = [
      makeWave('b6-w1', 0.32, 0.285, 0.36, { color: PINK.rose, amp: 0.008, cycles: 5 }),
      makeWave('b6-w2', 0.4, 0.82, 0.2, { color: PINK.rose, amp: 0.006, cycles: 3 }),
    ];
    return p;
  })(),
];

/* ================================================================== */
/* Exported seed                                                       */
/* ================================================================== */

export const DEMO_JOURNALS: DemoJournalSeed[] = [
  {
    title: 'Movies',
    // deep charcoal-navy like the reference's lifted journal (cream spine)
    coverStyle: { kind: 'gradient', color: '#3d425c', color2: '#181c2c', title: 'Movies', seed: 7 },
    paperColor: '#fdf6ec',
    pages: moviesPages,
  },
  {
    title: 'Sketchbook',
    // the iconic memphis tile mosaic cover
    coverStyle: { kind: 'pattern', color: '#f3efe4', color2: '#e94f4f', pattern: 'memphis', title: 'Sketchbook', seed: 3 },
    pages: sketchbookPages,
  },
  {
    title: 'Trips',
    // solar-system orbit cover on deep teal
    coverStyle: { kind: 'pattern', color: '#12343b', color2: '#f2c14e', pattern: 'solar', title: 'Trips', seed: 11 },
    pages: tripsPages,
  },
  {
    title: 'birthday bby',
    coverStyle: {
      kind: 'collage',
      color: '#e56b8c',
      color2: '#f4a7bb',
      emoji: ['🎂', '🎈', '💝', '✨'],
      title: 'birthday bby',
      seed: 21,
    },
    paperColor: '#fdf1f4',
    pages: birthdayPages,
  },
];
