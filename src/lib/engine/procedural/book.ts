/**
 * ACAN3D — Procedural book generator.
 *
 * Builds a real-world-scale book (meters, Y up) as an editable hierarchy:
 * group -> coverBackPivot, spine, individual page meshes, coverFrontPivot.
 * Both cover pivots sit on the spine axis (local x = 0) so `bookOpen` /
 * page-turn rotations swing around the spine.
 *
 * POSE SPEC (page-turn & book-open depend on it — do not change lightly):
 *  - book lies on the ground plane, bottom at y = 0
 *  - spine along Z at x = 0, pages extend toward +X when closed
 *  - page height along Z, centered z in [-pageHeight/2, +pageHeight/2]
 *  - closed = both pivots rotation.z = 0; opening rotates pivots about Z
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PageMeta } from '../types';
import { createPageGeometry } from './pageGeom';

export interface BookParams {
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  pageThickness: number;
  pageGap: number;
  coverThickness: number;
  coverOverhang: number;
  corner: number;
  coverColor: string;
  spineColor: string;
  paperColor: string;
  coverPreset: string;
}

export const DEFAULT_BOOK_PARAMS: BookParams = {
  pageCount: 200,
  pageWidth: 0.15,
  pageHeight: 0.21,
  pageThickness: 0.00035,
  pageGap: 0.00025,
  coverThickness: 0.0025,
  coverOverhang: 0.004,
  corner: 0.002,
  coverColor: '#7a3b2e',
  spineColor: '#5d2d23',
  paperColor: '#f5f1e6',
  coverPreset: 'leather',
};

/** The engine provides materials; the builder only calls this and assigns. */
export type BookMaterialFactory = (key: 'cover' | 'spine' | 'paper') => THREE.Material;

export interface BookBuildResult {
  group: THREE.Group;
  coverFrontPivot: THREE.Group;
  coverBackPivot: THREE.Group;
  coverFront: THREE.Mesh;
  coverBack: THREE.Mesh;
  spine: THREE.Mesh;
  pages: THREE.Mesh[];
}

function enableShadows(mesh: THREE.Mesh): void {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}

export function buildBook(
  p: BookParams,
  makeMaterial: BookMaterialFactory,
  pageArcSegments = 12,
): BookBuildResult {
  const params: BookParams = { ...DEFAULT_BOOK_PARAMS, ...p };
  const {
    pageCount,
    pageWidth,
    pageHeight,
    pageThickness,
    pageGap,
    coverThickness,
    coverOverhang,
    corner,
  } = params;

  const pageCountSafe = Math.max(0, Math.floor(pageCount));
  const stackHeight = pageCountSafe * (pageThickness + pageGap);

  const group = new THREE.Group();
  group.name = 'Book';
  group.userData.generator = 'book';
  group.userData.bookParams = { ...params };

  const coverMaterial = makeMaterial('cover');
  const spineMaterial = makeMaterial('spine');
  const paperMaterial = makeMaterial('paper');

  const coverGeo = new RoundedBoxGeometry(
    pageWidth + coverOverhang,
    coverThickness,
    pageHeight + 2 * coverOverhang,
    2,
    Math.max(1e-4, corner),
  );

  /* ---- back cover (pivot on spine axis, mesh offset toward +X) ---- */
  const coverBackPivot = new THREE.Group();
  coverBackPivot.name = 'CoverBackPivot';
  coverBackPivot.position.set(0, coverThickness / 2, 0);
  const coverBack = new THREE.Mesh(coverGeo, coverMaterial);
  coverBack.name = 'Cover Back';
  coverBack.position.set(pageWidth / 2, 0, 0);
  enableShadows(coverBack);
  coverBackPivot.add(coverBack);

  /* ---- pages: one FRESH geometry per page (they deform independently) ---- */
  const pages: THREE.Mesh[] = [];
  for (let i = 0; i < pageCountSafe; i++) {
    const geo = createPageGeometry(pageWidth, pageThickness, pageHeight, pageArcSegments);
    const mesh = new THREE.Mesh(geo, paperMaterial);
    mesh.name = `Page ${String(i + 1).padStart(3, '0')}`;
    mesh.position.set(
      0,
      coverThickness + pageThickness / 2 + i * (pageThickness + pageGap),
      0,
    );
    const pageMeta: PageMeta = {
      role: 'page',
      index: i,
      width: pageWidth,
      height: pageHeight,
      thickness: pageThickness,
      spineAt: 'x0',
    };
    mesh.userData.pageMeta = pageMeta;
    enableShadows(mesh);
    pages.push(mesh);
  }

  /* ---- spine: wraps the left edge, sits just left of x = 0 ---- */
  const spineGeo = new RoundedBoxGeometry(
    coverThickness * 1.6,
    coverThickness + stackHeight + coverThickness * 2,
    pageHeight + 2 * coverOverhang,
    2,
    Math.max(1e-4, corner),
  );
  const spine = new THREE.Mesh(spineGeo, spineMaterial);
  spine.name = 'Spine';
  spine.position.set(-coverThickness * 0.6, (coverThickness * 2 + stackHeight) / 2, 0);
  enableShadows(spine);

  /* ---- front cover: sits ON TOP of the page stack, pivot on spine axis ---- */
  const yTop = coverThickness + stackHeight;
  const coverFrontPivot = new THREE.Group();
  coverFrontPivot.name = 'CoverFrontPivot';
  coverFrontPivot.position.set(0, yTop + coverThickness / 2, 0);
  const coverFront = new THREE.Mesh(coverGeo, coverMaterial);
  coverFront.name = 'Cover Front';
  coverFront.position.set(pageWidth / 2, 0, 0);
  enableShadows(coverFront);
  coverFrontPivot.add(coverFront);

  group.add(coverBackPivot, spine, ...pages, coverFrontPivot);

  return { group, coverFrontPivot, coverBackPivot, coverFront, coverBack, spine, pages };
}
