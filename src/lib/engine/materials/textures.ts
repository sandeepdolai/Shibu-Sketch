/**
 * ACAN3D — Procedural canvas textures.
 *
 * Browser-only (Canvas2D). Every generator is deterministic: it is driven by a
 * mulberry32 PRNG (default seed 7), so the same type + params + seed always
 * produce the same pixels. These textures are used on book covers, pages and
 * general materials — the external agent screenshots them, so visual quality
 * matters.
 */
import * as THREE from 'three';

export const PROC_TEXTURE_TYPES = [
  'paper',
  'ruled_paper',
  'cardboard',
  'leather',
  'wood',
  'plastic',
  'brushed_metal',
  'checker',
  'grid',
  'noise',
  'marble',
] as const;

export type ProcTextureType = (typeof PROC_TEXTURE_TYPES)[number];

export interface ProcTextureParams {
  /** square texture size in px (default 512, clamped 8..2048) */
  size?: number;
  baseColor?: string;
  accentColor?: string;
  /** line spacing in px (ruled_paper) */
  lines?: number;
  /** pattern scale in px (wood rings, marble veins, noise cells) */
  scale?: number;
  /** deterministic seed (default 7) */
  seed?: number;
}

export interface ProcTextureResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/* Deterministic PRNG                                                  */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Color helpers                                                       */
/* ------------------------------------------------------------------ */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return { r: 200, g: 200, b: 200 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

function css(c: Rgb, alpha = 1): string {
  return `rgba(${Math.round(clamp255(c.r))},${Math.round(clamp255(c.g))},${Math.round(clamp255(c.b))},${alpha})`;
}

const WHITE: Rgb = { r: 255, g: 255, b: 250 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/* ------------------------------------------------------------------ */
/* Per-type defaults                                                   */
/* ------------------------------------------------------------------ */

const DEFAULT_BASE: Record<ProcTextureType, string> = {
  paper: '#f6f2e7',
  ruled_paper: '#f6f2e7',
  cardboard: '#c09b6e',
  leather: '#7a3b2e',
  wood: '#8a5a33',
  plastic: '#e8e8e8',
  brushed_metal: '#c0c0c8',
  checker: '#e8e4da',
  grid: '#f2f2ee',
  noise: '#808080',
  marble: '#f2f0ea',
};

const DEFAULT_ACCENT: Record<ProcTextureType, string> = {
  paper: '#d9d2bf',
  ruled_paper: '#b9b3a6',
  cardboard: '#8f7350',
  leather: '#3f1d15',
  wood: '#54341c',
  plastic: '#dcdcdc',
  brushed_metal: '#8f8f98',
  checker: '#9b937f',
  grid: '#8fa0aa',
  noise: '#ffffff',
  marble: '#6e7b86',
};

/* ------------------------------------------------------------------ */
/* Generators                                                          */
/* ------------------------------------------------------------------ */

type Gen = (
  ctx: CanvasRenderingContext2D,
  S: number,
  rnd: () => number,
  base: Rgb,
  accent: Rgb,
  params: ProcTextureParams,
) => void;

function fillBase(ctx: CanvasRenderingContext2D, S: number, base: Rgb): void {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, S, S);
}

/** Warm paper: thousands of faint fiber strokes, sparse speckles, vignette. */
function genPaper(ctx: CanvasRenderingContext2D, S: number, rnd: () => number, base: Rgb, accent: Rgb): void {
  fillBase(ctx, S, base);
  const light = mixRgb(base, WHITE, 0.55);
  const dark = mixRgb(base, accent, 0.5);

  // fibers
  const fibers = Math.round(S * S * 0.0105);
  ctx.lineCap = 'round';
  for (let i = 0; i < fibers; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const ang = rnd() * Math.PI;
    const len = 2.5 + rnd() * 9;
    const c = rnd() < 0.55 ? dark : light;
    ctx.strokeStyle = css(c, 0.04 + rnd() * 0.045);
    ctx.lineWidth = rnd() < 0.85 ? 0.8 : 1.5;
    const mx = x + Math.cos(ang) * len * 0.5 + (rnd() - 0.5) * 3;
    const my = y + Math.sin(ang) * len * 0.5 + (rnd() - 0.5) * 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(mx, my, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  // speckles
  const specks = Math.round(S * 0.45);
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = css(dark, 0.05 + rnd() * 0.09);
    ctx.beginPath();
    ctx.arc(rnd() * S, rnd() * S, 0.35 + rnd() * 1.0, 0, Math.PI * 2);
    ctx.fill();
  }

  // vignette
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.32, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, css(mixRgb(base, { r: 110, g: 88, b: 55 }, 0.8), 0.1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
}

/** Paper base + horizontal rule lines + red margin line. */
function genRuledPaper(
  ctx: CanvasRenderingContext2D,
  S: number,
  rnd: () => number,
  base: Rgb,
  accent: Rgb,
  params: ProcTextureParams,
): void {
  genPaper(ctx, S, rnd, base, accent);
  const gap = Math.max(6, params.lines ?? 36);
  const px = S / 512;

  ctx.strokeStyle = css(hexToRgb('#b9b3a6'), 0.55);
  ctx.lineWidth = Math.max(1, px);
  ctx.beginPath();
  for (let y = gap; y < S; y += gap) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(S, y + 0.5);
  }
  ctx.stroke();

  // red-ish margin line at 12% width
  const mx = Math.round(S * 0.12) + 0.5;
  ctx.strokeStyle = css(hexToRgb('#c96f5f'), 0.5);
  ctx.lineWidth = Math.max(1.5, px * 1.5);
  ctx.beginPath();
  ctx.moveTo(mx, 0);
  ctx.lineTo(mx, S);
  ctx.stroke();
}

/** Tan cardboard: fiber banding + darker/lighter flecks. */
function genCardboard(ctx: CanvasRenderingContext2D, S: number, rnd: () => number, base: Rgb, accent: Rgb): void {
  fillBase(ctx, S, base);
  const light = mixRgb(base, WHITE, 0.35);
  const dark = mixRgb(base, accent, 0.55);

  // faint horizontal fiber banding
  let y = 0;
  while (y < S) {
    const h = 2 + rnd() * 4;
    ctx.fillStyle = css(rnd() < 0.5 ? dark : light, 0.03 + rnd() * 0.035);
    ctx.fillRect(0, y, S, h);
    y += h + rnd() * 5;
  }

  // flecks
  const flecks = Math.round(S * S * 0.0035);
  for (let i = 0; i < flecks; i++) {
    ctx.fillStyle = css(rnd() < 0.55 ? dark : light, 0.06 + rnd() * 0.13);
    ctx.beginPath();
    ctx.arc(rnd() * S, rnd() * S, 0.4 + rnd() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // short stray fibers
  const fibers = Math.round(S * 0.8);
  ctx.lineCap = 'round';
  for (let i = 0; i < fibers; i++) {
    const x0 = rnd() * S;
    const y0 = rnd() * S;
    const ang = rnd() * Math.PI;
    const len = 4 + rnd() * 14;
    ctx.strokeStyle = css(rnd() < 0.6 ? dark : light, 0.04 + rnd() * 0.05);
    ctx.lineWidth = 0.6 + rnd() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
    ctx.stroke();
  }
}

/** Leather: voronoi-approx pebble grain from overlapping dark arcs + highlights. */
function genLeather(ctx: CanvasRenderingContext2D, S: number, rnd: () => number, base: Rgb, accent: Rgb): void {
  fillBase(ctx, S, base);

  // soft top-light sheen
  const g = ctx.createRadialGradient(S * 0.42, S * 0.38, S * 0.1, S * 0.5, S * 0.5, S * 0.85);
  g.addColorStop(0, css(mixRgb(base, { r: 255, g: 235, b: 220 }, 0.22), 0.5));
  g.addColorStop(1, css(mixRgb(base, BLACK, 0.25), 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  const dark = mixRgb(base, accent, 0.75);
  const light = mixRgb(base, { r: 255, g: 225, b: 205 }, 0.4);
  const cells = 420;
  const cellR = S / 64;

  for (let i = 0; i < cells; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r0 = 3 + rnd() * cellR;

    // dark crack arcs (2 passes)
    for (let k = 0; k < 2; k++) {
      ctx.strokeStyle = css(dark, 0.1 + rnd() * 0.09);
      ctx.lineWidth = 0.7 + rnd() * 0.9;
      const a0 = rnd() * Math.PI * 2;
      const a1 = a0 + 1.1 + rnd() * 2.6;
      ctx.beginPath();
      ctx.arc(x + (rnd() - 0.5) * r0, y + (rnd() - 0.5) * r0, r0 * (0.55 + rnd() * 0.6), a0, a1);
      ctx.stroke();
    }

    // light highlight arc (upper-left bias)
    ctx.strokeStyle = css(light, 0.05 + rnd() * 0.06);
    ctx.lineWidth = 0.8 + rnd();
    ctx.beginPath();
    ctx.arc(x + (rnd() - 0.5) * 3, y - 1 - rnd() * 2.5, r0 * (0.5 + rnd() * 0.5), Math.PI * 1.05, Math.PI * 1.85);
    ctx.stroke();
  }

  // fine speckle
  const specks = Math.round(S * 0.25);
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = css(dark, 0.04 + rnd() * 0.06);
    ctx.beginPath();
    ctx.arc(rnd() * S, rnd() * S, 0.3 + rnd() * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Wood: per-pixel rings with wobble + darker grain strokes. */
function genWood(
  ctx: CanvasRenderingContext2D,
  S: number,
  rnd: () => number,
  base: Rgb,
  accent: Rgb,
  params: ProcTextureParams,
): void {
  const ringScale = Math.max(4, params.scale ?? 26);
  const phase = rnd() * Math.PI * 2;

  // damped random walk -> smooth wobble per row
  const wob = new Float32Array(S + 1);
  let w = 0;
  for (let y = 0; y <= S; y++) {
    w = w * 0.9 + (rnd() - 0.5) * 0.6;
    wob[y] = w;
  }

  const img = ctx.createImageData(S, S);
  const d = img.data;
  let idx = 0;
  for (let y = 0; y < S; y++) {
    const rowWob = wob[y] * ringScale * 1.15 + Math.sin(y * 0.012 + phase) * ringScale * 0.55;
    for (let x = 0; x < S; x++) {
      const dx = x + rowWob;
      let t = 0.5 + 0.5 * Math.sin((dx / ringScale) * Math.PI * 2);
      t = Math.pow(t, 2.4);
      const grain = 0.5 + 0.5 * Math.sin(dx * 0.85 + y * 0.28 + phase * 1.7);
      const m = Math.min(1, Math.max(0, t * 0.72 + grain * 0.1 - 0.02));
      const c = mixRgb(base, accent, m);
      d[idx++] = c.r;
      d[idx++] = c.g;
      d[idx++] = c.b;
      d[idx++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // 2-3 darker wandering grain lines
  const dark = mixRgb(base, accent, 0.9);
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = css(dark, 0.16 + rnd() * 0.1);
    ctx.lineWidth = 0.8 + rnd() * 1.6;
    ctx.beginPath();
    let y0 = rnd() * S;
    ctx.moveTo(0, y0);
    for (let x = 14; x <= S; x += 14) {
      y0 += (rnd() - 0.5) * 4;
      ctx.lineTo(x, y0);
    }
    ctx.stroke();
  }
}

/** Plastic: near-uniform base with very subtle vertical brushed noise. */
function genPlastic(ctx: CanvasRenderingContext2D, S: number, rnd: () => number, base: Rgb): void {
  fillBase(ctx, S, base);
  const dark = mixRgb(base, BLACK, 0.12);
  const light = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.35);
  const n = Math.round(S * 1.8);
  for (let i = 0; i < n; i++) {
    const x = rnd() * S;
    const y0 = rnd() * S * 0.3;
    const len = S * (0.5 + rnd() * 0.5);
    ctx.strokeStyle = css(rnd() < 0.5 ? dark : light, 0.02 + rnd() * 0.02);
    ctx.lineWidth = 0.6 + rnd() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x + (rnd() - 0.5) * 1.5, y0 + len);
    ctx.stroke();
  }
}

/** Brushed metal: horizontal streak bands + fine per-pixel noise. */
function genBrushedMetal(ctx: CanvasRenderingContext2D, S: number, rnd: () => number, base: Rgb, accent: Rgb): void {
  fillBase(ctx, S, base);
  const light = mixRgb(base, { r: 255, g: 255, b: 255 }, 0.5);
  const dark = mixRgb(base, accent, 0.5);

  const bands = Math.round(S * 0.55);
  for (let i = 0; i < bands; i++) {
    const y = rnd() * S;
    const h = 0.8 + rnd() * 2.4;
    ctx.fillStyle = css(rnd() < 0.5 ? light : dark, 0.03 + rnd() * 0.045);
    ctx.fillRect(0, y, S, h);
  }

  // per-pixel noise
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 9;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

/** 8x8 checker of base / darker accent. */
function genChecker(ctx: CanvasRenderingContext2D, S: number, _rnd: () => number, base: Rgb, accent: Rgb): void {
  const n = 8;
  const cs = S / n;
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      ctx.fillStyle = css((gx + gy) % 2 === 0 ? base : mixRgb(accent, BLACK, 0.15));
      ctx.fillRect(Math.round(gx * cs), Math.round(gy * cs), Math.ceil(cs), Math.ceil(cs));
    }
  }
}

/** Grid: minor lines every size/16, stronger lines every size/4. */
function genGrid(ctx: CanvasRenderingContext2D, S: number, _rnd: () => number, base: Rgb, accent: Rgb): void {
  fillBase(ctx, S, base);
  const minor = S / 16;
  const major = S / 4;
  const px = S / 512;

  ctx.strokeStyle = css(accent, 0.3);
  ctx.lineWidth = Math.max(1, px);
  ctx.beginPath();
  for (let i = 1; i < 16; i++) {
    const p = Math.round(i * minor) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
  }
  ctx.stroke();

  ctx.strokeStyle = css(accent, 0.55);
  ctx.lineWidth = Math.max(1.4, px * 1.4);
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const p = Math.round(i * major) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
  }
  ctx.stroke();
}

/** Multi-octave smoothed grayscale value noise. */
function genNoise(
  ctx: CanvasRenderingContext2D,
  S: number,
  rnd: () => number,
  base: Rgb,
  accent: Rgb,
  params: ProcTextureParams,
): void {
  fillBase(ctx, S, base);
  const baseCells = Math.max(2, Math.round(params.scale ?? 8));
  const octaves = [baseCells, baseCells * 2, baseCells * 4, baseCells * 8];
  const alphas = [0.45, 0.28, 0.18, 0.12];
  ctx.imageSmoothingEnabled = true;

  for (let o = 0; o < octaves.length; o++) {
    const cells = octaves[o];
    const off = document.createElement('canvas');
    off.width = cells;
    off.height = cells;
    const octx = off.getContext('2d');
    if (!octx) continue;
    const img = octx.createImageData(cells, cells);
    for (let i = 0; i < img.data.length; i += 4) {
      const c = mixRgb(base, accent, rnd());
      img.data[i] = c.r;
      img.data[i + 1] = c.g;
      img.data[i + 2] = c.b;
      img.data[i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    ctx.globalAlpha = alphas[o];
    ctx.drawImage(off, 0, 0, cells, cells, 0, 0, S, S);
  }
  ctx.globalAlpha = 1;
}

/** Fake marble: 2 sine layers with random phase -> veins. */
function genMarble(
  ctx: CanvasRenderingContext2D,
  S: number,
  rnd: () => number,
  base: Rgb,
  accent: Rgb,
  params: ProcTextureParams,
): void {
  const scale = Math.max(8, params.scale ?? 60);
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;

  const img = ctx.createImageData(S, S);
  const d = img.data;
  let idx = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const s1 = Math.sin(((x * 0.75 + 42 * Math.sin(y * 0.011 + p1) + 18 * Math.sin(x * 0.006 + p2)) / scale) * Math.PI * 2);
      const s2 = Math.sin(((y * 0.5 + 30 * Math.sin(x * 0.013 - p1)) / (scale * 1.4)) * Math.PI * 2 + p2);
      const w = Math.pow(Math.abs(s1 * 0.72 + s2 * 0.28), 0.65);
      const c = mixRgb(accent, base, Math.min(1, w * 1.15));
      d[idx++] = c.r;
      d[idx++] = c.g;
      d[idx++] = c.b;
      d[idx++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const GENERATORS: Record<ProcTextureType, Gen> = {
  paper: genPaper,
  ruled_paper: genRuledPaper,
  cardboard: genCardboard,
  leather: genLeather,
  wood: genWood,
  plastic: genPlastic,
  brushed_metal: genBrushedMetal,
  checker: genChecker,
  grid: genGrid,
  noise: genNoise,
  marble: genMarble,
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Generate a deterministic procedural texture as a canvas + PNG data URL.
 * Runs entirely in the browser (Canvas2D).
 */
export function generateProceduralTexture(procType: string, params: ProcTextureParams = {}): ProcTextureResult {
  const size = Math.max(8, Math.min(2048, Math.round(params.size ?? 512)));
  const seed = params.seed ?? 7;
  const rnd = mulberry32(seed);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ACAN3D textures: Canvas2D context unavailable');

  const type = (PROC_TEXTURE_TYPES as readonly string[]).includes(procType)
    ? (procType as ProcTextureType)
    : null;
  if (!type) throw new Error(`ACAN3D textures: unknown procedural texture type "${procType}"`);

  const base = hexToRgb(params.baseColor ?? DEFAULT_BASE[type]);
  const accent = hexToRgb(params.accentColor ?? DEFAULT_ACCENT[type]);

  ctx.save();
  GENERATORS[type](ctx, size, rnd, base, accent, params);
  ctx.restore();

  const dataUrl = canvas.toDataURL('image/png');
  return { canvas, dataUrl, name: procType };
}

/**
 * Create a THREE.Texture from a PNG data URL (async image load).
 * SRGB color space + repeat wrapping; needsUpdate fires when the image lands.
 */
export function makeCanvasTexture(dataUrl: string): THREE.Texture {
  const img = new Image();
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  img.onload = () => {
    tex.needsUpdate = true;
  };
  img.src = dataUrl;
  return tex;
}
