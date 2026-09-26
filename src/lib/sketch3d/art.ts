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
export const COVER_TEX_H = 716; // 1 x 1.4 aspect

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

  // title
  const title = style.title?.trim();
  if (title) {
    const dark = contrastText(style.color);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fs = title.length > 12 ? w * 0.09 : w * 0.13;
    ctx.font = `700 ${fs}px ui-rounded, system-ui, "Segoe UI", sans-serif`;
    ctx.fillStyle = style.kind === 'pattern' || style.kind === 'collage' ? dark : contrastText(style.color);
    // wrap up to 3 lines
    const words = title.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > w * 0.78 && line) {
        lines.push(line);
        line = word;
      } else line = t;
    }
    if (line) lines.push(line);
    const startY = h * (style.kind === 'collage' ? 0.82 : 0.5) - ((lines.length - 1) * fs * 0.6);
    lines.slice(0, 3).forEach((l, i) => {
      ctx.fillText(l, w / 2, startY + i * fs * 1.15);
    });
    ctx.restore();
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
  ctx.fillStyle = '#f7f4ec';
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(7);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(120,110,90,0.06)';
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
  ctx.fillStyle = '#efe9dc';
  ctx.fillRect(0, 0, 64, 256);
  const rnd = mulberry32(21);
  for (let y = 0; y < 256; y += 2) {
    const v = 226 + Math.floor(rnd() * 24);
    ctx.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
    ctx.fillRect(0, y, 64, 1.4);
  }
  stripeTex = new THREE.CanvasTexture(canvas);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
  return stripeTex;
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
