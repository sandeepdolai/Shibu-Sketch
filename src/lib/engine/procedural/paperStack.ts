/**
 * ACAN3D — Procedural paper stack generator.
 *
 * A casually dropped pile of A4-ish sheets. Every sheet gets its own page
 * geometry (fresh BufferGeometry each) so sheets can later be turned /
 * deformed independently. Deterministic via mulberry32 (default seed 3).
 */
import * as THREE from 'three';
import { createPageGeometry } from './pageGeom';
import { mulberry32 } from '../materials/textures';

export interface PaperStackParams {
  count: number;
  width: number;
  height: number;
  sheetThickness: number;
  jitter: number;
  rotationJitterDeg: number;
  color: string;
}

export const DEFAULT_PAPER_STACK_PARAMS: PaperStackParams = {
  count: 20,
  width: 0.21,
  height: 0.297,
  sheetThickness: 0.0012,
  jitter: 0.003,
  rotationJitterDeg: 1.5,
  color: '#f5f1e6',
};

export interface PaperStackBuildResult {
  group: THREE.Group;
  sheets: THREE.Mesh[];
}

export function buildPaperStack(
  p: PaperStackParams,
  makeMaterial: (key: 'paper') => THREE.Material,
  seed = 3,
): PaperStackBuildResult {
  const params: PaperStackParams = { ...DEFAULT_PAPER_STACK_PARAMS, ...p };
  const { count, width, height, sheetThickness, jitter, rotationJitterDeg } = params;
  const countSafe = Math.max(0, Math.floor(count));

  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  group.name = 'PaperStack';
  group.userData.generator = 'paperStack';
  group.userData.paperStackParams = { ...params };

  const material = makeMaterial('paper');
  const sheets: THREE.Mesh[] = [];

  for (let i = 0; i < countSafe; i++) {
    const geo = createPageGeometry(width, sheetThickness, height, 10);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `Sheet ${String(i + 1).padStart(3, '0')}`;
    mesh.position.set(
      (rnd() * 2 - 1) * jitter,
      sheetThickness / 2 + i * sheetThickness + (rnd() * 2 - 1) * jitter * 0.25,
      (rnd() * 2 - 1) * jitter,
    );
    mesh.rotation.z = ((rnd() * 2 - 1) * rotationJitterDeg * Math.PI) / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.sheetIndex = i;
    sheets.push(mesh);
    group.add(mesh);
  }

  return { group, sheets };
}
