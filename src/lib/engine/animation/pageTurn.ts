/**
 * ACAN3D — Page-turn deformation.
 *
 * Bends a page geometry (built by procedural/pageGeom.ts) around the spine:
 * rotation about the local Z axis at x = 0, theta in [0, PI]
 * (0 = flat toward +X, PI = flat toward -X).
 *
 * The deformation ALWAYS starts from the rest pose cached in
 * geometry.userData.restPositions (created by createPageGeometry), so it is
 * safe to call every frame with any theta.
 *
 * Paper feel: the leading edge lags behind the base rotation (trail term with
 * u^1.6 falloff -> fore-edge curl mid-turn, settles flat at theta 0 / PI
 * because sin(theta) vanishes at both ends), and the sheet relaxes slightly
 * toward the spine while lifted (paper sliding over the spine).
 */
import * as THREE from 'three';
import type { Easing } from '../types';

/* ------------------------------------------------------------------ */
/* Easing                                                              */
/* ------------------------------------------------------------------ */

export function easeValue(t: number, easing: Easing): number {
  const x = Math.min(1, Math.max(0, t));
  switch (easing) {
    case 'easeIn':
      return x * x;
    case 'easeOut':
      return 1 - (1 - x) * (1 - x);
    case 'easeInOut':
      return x * x * (3 - 2 * x); // smoothstep
    case 'step':
      return x < 0.5 ? 0 : 1; // discrete jump (three.js InterpolateDiscrete semantics)
    case 'linear':
    default:
      return x;
  }
}

/* ------------------------------------------------------------------ */
/* Deformation                                                         */
/* ------------------------------------------------------------------ */

interface PageUserData {
  pageWidth?: number;
  restPositions?: Float32Array;
}

/**
 * Deform a page geometry to angle `theta` (radians in [0, PI]).
 *
 * @param geometry   geometry created by createPageGeometry (rest pose cached)
 * @param theta      spine rotation angle, 0 = flat right (+X), PI = flat left (-X)
 * @param curvature  0..1.5 — how much the paper curls mid-turn
 * @param trailSign  1 = trail lags the turn direction, -1 = leads (mirrored)
 */
export function applyPageTurnDeformation(
  geometry: THREE.BufferGeometry,
  theta: number,
  curvature: number,
  trailSign: 1 | -1,
): void {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | null;
  if (!posAttr) return;

  const ud = geometry.userData as PageUserData;

  // rest pose (created once by createPageGeometry; defensive fallback here)
  let rest = ud.restPositions;
  if (!rest || rest.length !== posAttr.array.length) {
    rest = Float32Array.from(posAttr.array as ArrayLike<number>);
    ud.restPositions = rest;
  }

  // page width for normalized u (fallback: bounding box max X)
  let width = ud.pageWidth;
  if (!width || width <= 0) {
    geometry.computeBoundingBox();
    width = geometry.boundingBox ? Math.max(1e-4, geometry.boundingBox.max.x) : 1;
    ud.pageWidth = width;
  }

  const t = Math.min(Math.PI, Math.max(0, theta));
  const s = Math.sin(t);
  const curl = trailSign * curvature * s;

  const arr = posAttr.array as Float32Array;
  const count = posAttr.count;
  for (let i = 0; i < count; i++) {
    const ox = rest[i * 3];
    const oy = rest[i * 3 + 1];
    const u = Math.min(1, Math.max(0, ox / width));
    // per-vertex angle: base rotation minus trail lag (grows toward fore-edge)
    const phi = Math.min(Math.PI, Math.max(0, t - curl * Math.pow(u, 1.6)));
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    // slight radius relaxation mid-turn (paper slides over the spine)
    const r = ox * (1 - 0.06 * curvature * s * u);
    arr[i * 3] = r * cp - oy * sp;
    arr[i * 3 + 1] = r * sp + oy * cp;
    // z unchanged
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

/* ------------------------------------------------------------------ */
/* Track helpers                                                       */
/* ------------------------------------------------------------------ */

/** progress 0..1 -> theta. direction 1: 0 -> PI (right-to-left), -1: PI -> 0. */
export function thetaForProgress(progress01: number, direction: 1 | -1): number {
  const p = Math.min(1, Math.max(0, progress01));
  return direction === -1 ? (1 - p) * Math.PI : p * Math.PI;
}

export interface PageTurnTrackLike {
  startFrame: number;
  endFrame: number;
  direction: 1 | -1;
  curvature: number;
  easing: Easing;
}

/** Theta for a given frame of a page-turn track (progress clamped, eased). */
export function computePageTurnTheta(track: PageTurnTrackLike, frame: number): number {
  const span = track.endFrame - track.startFrame;
  if (span <= 0) {
    // degenerate track: fully done as soon as we reach/past endFrame
    return thetaForProgress(frame >= track.endFrame ? 1 : 0, track.direction);
  }
  const raw = (frame - track.startFrame) / span;
  return thetaForProgress(easeValue(raw, track.easing), track.direction);
}
