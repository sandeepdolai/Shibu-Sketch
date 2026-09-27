/**
 * Shibu-Sketch — procedural canvas art (covers, paper, edges, shadows).
 * All art is generated locally — no external assets.
 */
import * as THREE from 'three';
import { mulberry32 } from '@/components/sketch/NewJournalModal';
import type { CoverStyle } from '@/lib/sketch/types';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  return [c, ctx];
}

function contrastText(hex: string): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) || 0;
  const g = parseInt(c.slice(2, 4), 16) || 0;
  const b = parseInt(c.slice(4, 6), 16) || 0;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? 'rgba(28,30,38,0.92)' : 'rgba(255,255,255,0.95)';
}

/** Rounded-rect path helper (works without ctx.roundRect support). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number, seed: number) {
  const rnd = mulberry32(seed);
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.fillStyle = rnd() > 0.5 ? '#ffffff' : '#000000';
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* cover art                                                           */
/* ------------------------------------------------------------------ */

export const COVER_TEX_W = 512;
export const COVER_TEX_H = 932; // 1 x 1.82 aspect (journal 0.78 x 1.42)

function drawPattern(ctx: CanvasRenderingContext2D, style: CoverStyle, w: number, h: number) {
  const rnd = mulberry32(style.seed + 99);
  const accent = style.color2 ?? contrastText(style.color);
  switch (style.pattern) {
    case 'dots': {
      ctx.fillStyle = accent;
      for (let y = 0.07; y < 1; y += 0.09) {
        for (let x = 0.07; x < 1; x += 0.09) {
          ctx.beginPath();
          ctx.arc(x * w, y * h, w * 0.012, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'stripes': {
      ctx.strokeStyle = accent;
      ctx.lineWidth = w * 0.022;
      for (let x = -h; x < w + h; x += w * 0.12) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + h, h);
        ctx.stroke();
      }
      break;
    }
    case 'grid': {
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      for (let x = 0; x <= 1.01; x += 0.1) {
        ctx.beginPath();
        ctx.moveTo(x * w, 0);
        ctx.lineTo(x * w, h);
        ctx.stroke();
      }
      for (let y = 0; y <= 1.01; y += 0.1) {
        ctx.beginPath();
        ctx.moveTo(0, y * h);
        ctx.lineTo(w, y * h);
        ctx.stroke();
      }
      break;
    }
    case 'leaves': {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      for (let i = 0; i < 26; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        const a = rnd() * Math.PI * 2;
        const L = w * (0.07 + rnd() * 0.06);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(-L / 2, 0);
        ctx.quadraticCurveTo(0, -L * 0.3, L / 2, 0);
        ctx.quadraticCurveTo(0, L * 0.3, -L / 2, 0);
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'shapes': {
      const cols = [accent, '#f2c14e', '#e56b8c', '#6aa84f', '#ffffff'];
      for (let i = 0; i < 16; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        const s = w * (0.05 + rnd() * 0.08);
        ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rnd() * Math.PI);
        if (rnd() > 0.5) {
          ctx.beginPath();
          ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-s / 2, -s / 2, s, s);
        }
        ctx.restore();
      }
      break;
    }
    case 'speckle': {
      for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = rnd() > 0.5 ? accent : 'rgba(255,255,255,0.55)';
        ctx.globalAlpha = 0.25 + rnd() * 0.5;
        const r = rnd() * w * 0.008 + 0.6;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    /* Memphis-style grid — the iconic Paper-app composition cover: a tile
     * mosaic of quarter-circles, triangles, dots, rings and squares in a
     * hot mid-century palette on a warm ground. */
    case 'memphis': {
      const pal = ['#e94f4f', '#f2b134', '#2ec4b6', '#ef6f6f', '#123c69', '#f6f2e7', accent];
      const cols = 3;
      const rows = 6;
      const cw = w / cols;
      const ch = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cw;
          const y = r * ch;
          const rnd2 = mulberry32(style.seed * 31 + r * 17 + c * 7);
          const kind = Math.floor(rnd2() * 6);
          const col = pal[Math.floor(rnd2() * pal.length)];
          ctx.fillStyle = col;
          switch (kind) {
            case 0: // quarter circle
              ctx.beginPath();
              ctx.moveTo(x, y + ch);
              ctx.arc(x, y + ch, cw, -Math.PI / 2, 0);
              ctx.closePath();
              ctx.fill();
              break;
            case 1: // triangle
              ctx.beginPath();
              ctx.moveTo(x, y + ch);
              ctx.lineTo(x + cw, y + ch);
              ctx.lineTo(x + (rnd2() > 0.5 ? cw : 0), y);
              ctx.closePath();
              ctx.fill();
              break;
            case 2: {
              // dot grid
              ctx.fillStyle = col;
              for (let dy = 0; dy < 3; dy++) {
                for (let dx = 0; dx < 3; dx++) {
                  ctx.beginPath();
                  ctx.arc(x + cw * (0.22 + dx * 0.28), y + ch * (0.22 + dy * 0.28), cw * 0.055, 0, Math.PI * 2);
                  ctx.fill();
                }
              }
              break;
            }
            case 3: // ring
              ctx.lineWidth = cw * 0.09;
              ctx.strokeStyle = col;
              ctx.beginPath();
              ctx.arc(x + cw / 2, y + ch / 2, cw * 0.3, 0, Math.PI * 2);
              ctx.stroke();
              break;
            case 4: // half circle standing
              ctx.beginPath();
              ctx.arc(x + cw / 2, y + ch, cw / 2, Math.PI, 0);
              ctx.closePath();
              ctx.fill();
              break;
            default: // solid tile with inner square
              ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
              ctx.fillStyle = pal[Math.floor(rnd2() * pal.length)];
              ctx.fillRect(x + cw * 0.3, y + ch * 0.3, cw * 0.4, ch * 0.4);
              break;
          }
        }
      }
      break;
    }
    case 'solar': {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.5;
      const cx = w * 0.5;
      const cy = h * 0.5;
      for (let i = 1; i <= 5; i++) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * 0.09 * i, w * 0.075 * i, 0.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath();
      ctx.arc(cx, cy, w * 0.045, 0, Math.PI * 2);
      ctx.fill();
      const cols = ['#e56b8c', '#6aa84f', '#5b8def', '#ffffff'];
      for (let i = 0; i < 7; i++) {
        const a = rnd() * Math.PI * 2;
        const rr = w * (0.09 + rnd() * 0.36);
        ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85, w * 0.014, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'fruit': {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.52, w * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.52, w * 0.24, Math.PI * 1.15, Math.PI * 1.85);
      ctx.lineTo(w * 0.5, h * 0.52);
      ctx.fill();
      ctx.strokeStyle = '#6aa84f';
      ctx.lineWidth = w * 0.02;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.28);
      ctx.quadraticCurveTo(w * 0.6, h * 0.2, w * 0.64, h * 0.24);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}

export function drawCoverArt(ctx: CanvasRenderingContext2D, style: CoverStyle, w: number, h: number): void {
  const rnd = mulberry32(style.seed);
  ctx.clearRect(0, 0, w, h);
  // base
  if (style.kind === 'gradient' && style.color2) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, style.color);
    g.addColorStop(1, style.color2);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = style.color;
  }
  ctx.fillRect(0, 0, w, h);

  if (style.kind === 'pattern' && style.pattern) drawPattern(ctx, style, w, h);

  if (style.kind === 'collage') {
    const emojis = style.emoji?.length ? style.emoji : ['✨', '🌟', '📓'];
    const n = Math.max(5, Math.min(11, emojis.length + 4));
    for (let i = 0; i < n; i++) {
      const e = emojis[Math.floor(rnd() * emojis.length)];
      const size = w * (0.13 + rnd() * 0.13);
      ctx.save();
      ctx.translate(w * (0.16 + rnd() * 0.68), h * (0.12 + rnd() * 0.7));
      ctx.rotate((rnd() - 0.5) * 0.9);
      ctx.globalAlpha = 0.92;
      ctx.font = `${size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e, 0, 0);
      ctx.restore();
    }
  }

  // vignette + grain for material feel
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.05, style.seed + 5);
}

export function makeCoverTexture(style: CoverStyle): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(COVER_TEX_W, COVER_TEX_H);
  drawCoverArt(ctx, style, COVER_TEX_W, COVER_TEX_H);

  // faint print sheen — the app covers read as flat printed jackets
  const sheen = ctx.createLinearGradient(0, 0, COVER_TEX_W, COVER_TEX_H);
  sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(0.35, 'rgba(255,255,255,0.01)');
  sheen.addColorStop(0.55, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.8, 'rgba(255,255,255,0.02)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.06)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, COVER_TEX_W, COVER_TEX_H);

  // gentle edge darkening (contact shading against the cardboard below)
  const vig = ctx.createRadialGradient(
    COVER_TEX_W / 2,
    COVER_TEX_H / 2,
    COVER_TEX_H * 0.2,
    COVER_TEX_W / 2,
    COVER_TEX_H / 2,
    COVER_TEX_H * 0.75,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, COVER_TEX_W, COVER_TEX_H);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ------------------------------------------------------------------ */
/* paper / edges / shadow                                              */
/* ------------------------------------------------------------------ */

let paperTex: THREE.CanvasTexture | null = null;
export function getPaperTexture(): THREE.CanvasTexture {
  if (paperTex) return paperTex;
  const S = 256;
  const [canvas, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#fbf9f4';
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(7);
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.6)' : 'rgba(140,128,105,0.045)';
    ctx.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
  }
  // faint fibers
  ctx.strokeStyle = 'rgba(150,140,115,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    ctx.beginPath();
    const x = rnd() * S;
    const y = rnd() * S;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 30);
    ctx.stroke();
  }
  paperTex = new THREE.CanvasTexture(canvas);
  paperTex.colorSpace = THREE.SRGBColorSpace;
  paperTex.wrapS = paperTex.wrapT = THREE.RepeatWrapping;
  paperTex.repeat.set(2, 2);
  return paperTex;
}

let stripeTex: THREE.CanvasTexture | null = null;
/** Fore-edge stack stripes (vertical lines along page height). */
export function getForeEdgeTexture(): THREE.CanvasTexture {
  if (stripeTex) return stripeTex;
  const [canvas, ctx] = makeCanvas(64, 256);
  ctx.fillStyle = '#f6f2e9';
  ctx.fillRect(0, 0, 64, 256);
  const rnd = mulberry32(21);
  for (let y = 0; y < 256; y += 2) {
    const v = 234 + Math.floor(rnd() * 20);
    ctx.fillStyle = `rgb(${v},${v - 3},${v - 9})`;
    ctx.fillRect(0, y, 64, 1.4);
  }
  stripeTex = new THREE.CanvasTexture(canvas);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
  return stripeTex;
}

let sheetEdgeTex: THREE.CanvasTexture | null = null;
/**
 * Striated sheet-edge band for the slab side walls (the reference close-up
 * shows every sheet edge as its own fine line). UV contract from
 * createSheetSlab: u tiles along the page contour, v = 0..1 across ONE
 * slab's thickness — so this tile bakes that single slab's edge: soft face
 * shading at both faces, 2 hairline "sheet boundary" lines + paper grain.
 * Real air gaps between neighbouring slabs add the darker seam lines, so
 * the closed block reads as dozens of stacked sheet edges (geometry, not
 * just texture).
 */
export function getSheetEdgeTexture(): THREE.CanvasTexture {
  if (sheetEdgeTex) return sheetEdgeTex;
  const W = 128;
  const H = 64;
  const [canvas, ctx] = makeCanvas(W, H);
  // warm cream paper edge
  ctx.fillStyle = '#f3eee1';
  ctx.fillRect(0, 0, W, H);
  // face-adjacent shading: bright near both faces, contact shadow mid-slab
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.08)');
  g.addColorStop(0.5, 'rgba(118,108,86,0.14)');
  g.addColorStop(0.82, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rnd = mulberry32(47);
  // two hairline sheet boundaries + a faint third (per-slab micro layers)
  for (const [fy, a] of [
    [0.3, 0.42],
    [0.66, 0.36],
    [0.86, 0.2],
  ] as const) {
    const y = H * fy + (rnd() - 0.5) * 2;
    ctx.fillStyle = `rgba(98,90,72,${a})`;
    ctx.fillRect(0, y, W, 1.3);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(0, y + 1.5, W, 1);
  }
  // grain
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(120,110,88,0.12)';
    ctx.fillRect(rnd() * W, rnd() * H, 1, 1);
  }
  sheetEdgeTex = new THREE.CanvasTexture(canvas);
  sheetEdgeTex.colorSpace = THREE.SRGBColorSpace;
  sheetEdgeTex.wrapS = sheetEdgeTex.wrapT = THREE.RepeatWrapping;
  sheetEdgeTex.anisotropy = 8;
  return sheetEdgeTex;
}

let blobTex: THREE.CanvasTexture | null = null;
/** Soft radial shadow blob (used under journals and the open book). */
export function getShadowBlobTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  const S = 256;
  const [canvas, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(10,10,18,0.55)');
  g.addColorStop(0.55, 'rgba(10,10,18,0.22)');
  g.addColorStop(1, 'rgba(10,10,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  blobTex = new THREE.CanvasTexture(canvas);
  blobTex.colorSpace = THREE.SRGBColorSpace;
  return blobTex;
}

let poolTex: THREE.CanvasTexture | null = null;
/** Wide, soft pool of warm light under the shelf — grounds the books on the
 *  floor and adds reading-room atmosphere (elliptical radial gradient). */
export function makeFloorPoolTexture(): THREE.CanvasTexture {
  if (poolTex) return poolTex;
  const S = 256;
  const [canvas, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.04, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(255,236,200,0.5)');
  g.addColorStop(0.45, 'rgba(255,232,196,0.16)');
  g.addColorStop(1, 'rgba(255,232,196,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  poolTex = new THREE.CanvasTexture(canvas);
  poolTex.colorSpace = THREE.SRGBColorSpace;
  return poolTex;
}

let gutterTex: THREE.CanvasTexture | null = null;
/** Soft horizontal contact-shadow strip for the open book's gutter
 *  (darkens while a page is in the air during a flip). */
export function getGutterShadowTexture(): THREE.CanvasTexture {
  if (gutterTex) return gutterTex;
  const W = 128;
  const H = 32;
  const [canvas, ctx] = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(15,12,20,0)');
  g.addColorStop(0.5, 'rgba(15,12,20,0.62)');
  g.addColorStop(1, 'rgba(15,12,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  gutterTex = new THREE.CanvasTexture(canvas);
  gutterTex.colorSpace = THREE.SRGBColorSpace;
  return gutterTex;
}
