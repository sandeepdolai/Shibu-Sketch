/**
 * ACAN3D — animation evaluator.
 * Applies transform tracks (eased interpolation), procedural page-turn
 * deformation tracks and book-open tracks at a given frame.
 */

import * as THREE from 'three';
import type { AnimTrack, Easing, SceneAnim } from '../types';
import { applyPageTurnDeformation, easeValue } from './pageTurn';

function sampleKeys(
  keys: { frame: number; value: [number, number, number]; easing?: Easing }[],
  frame: number,
): [number, number, number] {
  if (keys.length === 0) return [0, 0, 0];
  if (frame <= keys[0].frame) return keys[0].value;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.value;
  for (let i = 0; i < keys.length - 1; i++) {
    const k1 = keys[i];
    const k2 = keys[i + 1];
    if (frame >= k1.frame && frame <= k2.frame) {
      const span = k2.frame - k1.frame;
      const t = span <= 0 ? 1 : (frame - k1.frame) / span;
      const e = easeValue(t, k2.easing ?? 'linear');
      return [
        k1.value[0] + (k2.value[0] - k1.value[0]) * e,
        k1.value[1] + (k2.value[1] - k1.value[1]) * e,
        k1.value[2] + (k2.value[2] - k1.value[2]) * e,
      ];
    }
  }
  return last.value;
}

export interface EvalContext {
  getObject(id: string): THREE.Object3D | undefined;
  /** cached scratch: last applied theta per pageTurn track to skip redundant deformation */
  lastTheta: Map<string, number>;
  lastPivotAngle: Map<string, number>;
}

export function evaluateTracks(anim: SceneAnim, ctx: EvalContext, frame: number, force = false): void {
  for (const track of anim.tracks as AnimTrack[]) {
    switch (track.type) {
      case 'transform': {
        const obj = ctx.getObject(track.objectId);
        if (!obj || track.keys.length === 0) break;
        const v = sampleKeys(track.keys, frame);
        if (track.channel === 'position') obj.position.set(v[0], v[1], v[2]);
        else if (track.channel === 'rotation') obj.rotation.set(v[0], v[1], v[2]);
        else obj.scale.set(v[0] || 1e-6, v[1] || 1e-6, v[2] || 1e-6);
        break;
      }
      case 'pageTurn': {
        const obj = ctx.getObject(track.objectId);
        if (!obj || !(obj as THREE.Mesh).geometry) break;
        const span = track.endFrame - track.startFrame;
        if (span <= 0) break;
        let progress: number;
        if (frame <= track.startFrame) progress = 0;
        else if (frame >= track.endFrame) progress = 1;
        else progress = (frame - track.startFrame) / span;
        const eased = easeValue(progress, track.easing);
        const theta = track.direction === 1 ? eased * Math.PI : (1 - eased) * Math.PI;
        const last = ctx.lastTheta.get(track.id);
        if (!force && last !== undefined && Math.abs(last - theta) < 1e-5) break;
        ctx.lastTheta.set(track.id, theta);
        const geom = (obj as THREE.Mesh).geometry;
        applyPageTurnDeformation(geom, theta, track.curvature, track.direction === 1 ? 1 : -1);
        break;
      }
      case 'bookOpen': {
        const obj = ctx.getObject(track.objectId);
        if (!obj) break;
        const span = track.endFrame - track.startFrame;
        if (span <= 0) break;
        let progress: number;
        if (frame <= track.startFrame) progress = 0;
        else if (frame >= track.endFrame) progress = 1;
        else progress = (frame - track.startFrame) / span;
        const eased = easeValue(progress, track.easing);
        const angle = eased * track.openAngle;
        const last = ctx.lastPivotAngle.get(track.id);
        if (!force && last !== undefined && Math.abs(last - angle) < 1e-5) break;
        ctx.lastPivotAngle.set(track.id, angle);
        obj.traverse((child) => {
          const kind = (child.userData?.acan as { kind?: string } | undefined)?.kind;
          if (kind === 'coverFrontPivot') child.rotation.z = angle;
          else if (kind === 'coverBackPivot') child.rotation.z = 0;
        });
        break;
      }
    }
  }
}

/** Reset any procedural deformation to rest (used when tracks are removed/stopped). */
export function resetProceduralTracks(anim: SceneAnim, ctx: EvalContext): void {
  for (const track of anim.tracks as AnimTrack[]) {
    if (track.type === 'pageTurn') {
      const obj = ctx.getObject(track.objectId);
      const geom = obj ? (obj as THREE.Mesh).geometry : undefined;
      if (geom) applyPageTurnDeformation(geom, 0, track.curvature, 1);
      ctx.lastTheta.delete(track.id);
    } else if (track.type === 'bookOpen') {
      const obj = ctx.getObject(track.objectId);
      if (obj) {
        obj.traverse((child) => {
          const kind = (child.userData?.acan as { kind?: string } | undefined)?.kind;
          if (kind === 'coverFrontPivot' || kind === 'coverBackPivot') child.rotation.z = 0;
        });
      }
      ctx.lastPivotAngle.delete(track.id);
    }
  }
}
