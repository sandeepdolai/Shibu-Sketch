/**
 * ACAN3D — Primitive geometry factory.
 *
 * Thin wrapper over three.js built-ins (+ the RoundedBoxGeometry addon) with
 * sensible real-world-scale defaults (meters — a notebook is ~0.15 m wide).
 * Unknown params are ignored gracefully; known params accept common aliases.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PrimitiveKind } from '../types';

export const PRIMITIVE_DEFAULTS: Record<Exclude<PrimitiveKind, 'custom'>, Record<string, number>> = {
  box: { width: 0.2, height: 0.2, depth: 0.2 },
  roundedBox: { width: 0.2, height: 0.2, depth: 0.2, segments: 2, radius: 0.02 },
  sphere: { radius: 0.15, widthSegments: 32, heightSegments: 16, phiStart: 0, phiLength: Math.PI * 2 },
  cylinder: { radiusTop: 0.1, radiusBottom: 0.1, height: 0.25, radialSegments: 32, heightSegments: 1 },
  cone: { radius: 0.12, height: 0.25, radialSegments: 32 },
  torus: { radius: 0.15, tube: 0.05, radialSegments: 24, tubularSegments: 48, arc: Math.PI * 2 },
  plane: { width: 0.5, height: 0.5 },
  capsule: { radius: 0.08, length: 0.2, capSegments: 8, radialSegments: 24 },
  tetrahedron: { radius: 0.15 },
  octahedron: { radius: 0.15 },
};

/** Read the first finite numeric param among `keys`, else fallback. */
function num(params: Record<string, number>, keys: string[], fallback: number): number {
  for (const k of keys) {
    const v = params[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return fallback;
}

function intAtLeast(v: number, min: number): number {
  return Math.max(min, Math.floor(v));
}

export function createPrimitiveGeometry(
  kind: PrimitiveKind,
  params: Record<string, number> = {},
): THREE.BufferGeometry {
  const p = params ?? {};
  const D = PRIMITIVE_DEFAULTS;

  switch (kind) {
    case 'box':
      return new THREE.BoxGeometry(
        num(p, ['width', 'w'], D.box.width),
        num(p, ['height', 'h'], D.box.height),
        num(p, ['depth', 'd'], D.box.depth),
      );

    case 'roundedBox':
      return new RoundedBoxGeometry(
        num(p, ['width', 'w'], D.roundedBox.width),
        num(p, ['height', 'h'], D.roundedBox.height),
        num(p, ['depth', 'd'], D.roundedBox.depth),
        intAtLeast(num(p, ['segments', 'seg'], D.roundedBox.segments), 1),
        Math.max(0, num(p, ['radius', 'r'], D.roundedBox.radius)),
      );

    case 'sphere':
      return new THREE.SphereGeometry(
        num(p, ['radius', 'r'], D.sphere.radius),
        intAtLeast(num(p, ['widthSegments', 'ws'], D.sphere.widthSegments), 3),
        intAtLeast(num(p, ['heightSegments', 'hs'], D.sphere.heightSegments), 2),
        num(p, ['phiStart'], D.sphere.phiStart),
        Math.max(0.05, num(p, ['phiLength'], D.sphere.phiLength)),
      );

    case 'cylinder':
      return new THREE.CylinderGeometry(
        num(p, ['radiusTop', 'rt'], D.cylinder.radiusTop),
        num(p, ['radiusBottom', 'rb'], D.cylinder.radiusBottom),
        num(p, ['height', 'h'], D.cylinder.height),
        intAtLeast(num(p, ['radialSegments', 'seg'], D.cylinder.radialSegments), 3),
        intAtLeast(num(p, ['heightSegments'], D.cylinder.heightSegments), 1),
      );

    case 'cone':
      return new THREE.ConeGeometry(
        num(p, ['radius', 'r'], D.cone.radius),
        num(p, ['height', 'h'], D.cone.height),
        intAtLeast(num(p, ['radialSegments', 'seg'], D.cone.radialSegments), 3),
      );

    case 'torus':
      return new THREE.TorusGeometry(
        num(p, ['radius', 'r'], D.torus.radius),
        Math.max(1e-4, num(p, ['tube', 't'], D.torus.tube)),
        intAtLeast(num(p, ['radialSegments', 'radSeg'], D.torus.radialSegments), 3),
        intAtLeast(num(p, ['tubularSegments', 'tubSeg'], D.torus.tubularSegments), 3),
        Math.max(0.05, num(p, ['arc'], D.torus.arc)),
      );

    case 'plane':
      return new THREE.PlaneGeometry(
        num(p, ['width', 'w'], D.plane.width),
        num(p, ['height', 'h'], D.plane.height),
      );

    case 'capsule':
      return new THREE.CapsuleGeometry(
        num(p, ['radius', 'r'], D.capsule.radius),
        num(p, ['length', 'len'], D.capsule.length),
        intAtLeast(num(p, ['capSegments', 'capSeg'], D.capsule.capSegments), 1),
        intAtLeast(num(p, ['radialSegments', 'radSeg'], D.capsule.radialSegments), 3),
      );

    case 'tetrahedron':
      return new THREE.TetrahedronGeometry(num(p, ['radius', 'r'], D.tetrahedron.radius));

    case 'octahedron':
      return new THREE.OctahedronGeometry(num(p, ['radius', 'r'], D.octahedron.radius));

    case 'custom':
    default:
      throw new Error(`createPrimitiveGeometry: unsupported primitive kind "${kind}"`);
  }
}
