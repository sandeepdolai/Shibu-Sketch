/**
 * Shibu-Sketch — 3D journal object.
 *
 * A journal is built in "book space": the spine line runs along local Z at
 * x = 0, pages extend +X, thickness along Y, page height along Z. In this
 * space a closed journal lies flat with its front cover on top; rotating the
 * `stand` pivot by +PI/2 about X makes it stand upright facing the camera
 * (shelf pose). Opening the front cover = rotating its pivot around local Z.
 *
 * Layers (bottom -> top): back cover, sheet stack (all sheets, individually
 * placeable), front cover pivot, spread content planes, flipping sheet group.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createSheetSurface, createSheetSlab } from './sheetGeom';
import { getForeEdgeTexture, getPaperTexture, getShadowBlobTexture, getGutterShadowTexture } from './art';

const HALF_PI = Math.PI / 2;

export const JOURNAL_W = 1.0;
export const JOURNAL_H = 1.4;
export const COVER_T = 0.02;
export const SHEET_T = 0.0032;
export const SHEET_CORNER = 0.05;

export interface JournalDims {
  sheets: number;
  stackTop: number; // y of the top of the sheet stack
}

export function journalDims(pageCount: number): JournalDims {
  const sheets = Math.max(1, Math.ceil(pageCount / 2));
  return { sheets, stackTop: COVER_T + sheets * SHEET_T };
}

export interface PageTextureProvider {
  /** returns a texture for page index, or null for blank paper */
  getPageTexture(pageIndex: number): THREE.Texture | null;
  /** left-page variant (flipY false, matches the Y-mirrored left geometry) */
  getLeftTexture(pageIndex: number): THREE.Texture | null;
  /** back-face variant of a page texture (rotated 180 so it reads upright after a flip) */
  getFlippedTexture(pageIndex: number): THREE.Texture | null;
}

export interface JournalObject {
  root: THREE.Group;
  stand: THREE.Group;
  offset: THREE.Group;
  coverPivot: THREE.Group;
  spine: THREE.Mesh;
  sheets: THREE.Mesh[];
  leftContent: THREE.Mesh;
  rightContent: THREE.Mesh;
  flipGroup: THREE.Group;
  flipFront: THREE.Mesh;
  flipBack: THREE.Mesh;
  flipEdge: THREE.Mesh;
  coverArtMesh: THREE.Mesh;
  leftWell: THREE.Mesh;
  rightWell: THREE.Mesh;
  tapZoneL: THREE.Mesh;
  tapZoneR: THREE.Mesh;
  flipShadow: THREE.Mesh;
  gutterShadow: THREE.Mesh;
  dispose(): void;
}

export interface BuildJournalOpts {
  pageCount: number;
  coverMaterial: THREE.Material; // cover color/side material
  coverArtTexture: THREE.Texture | null;
  coverArtMaterial: THREE.MeshPhysicalMaterial; // front face w/ art
  paperColor: string;
  textures: PageTextureProvider;
}

export function buildJournal(opts: BuildJournalOpts): JournalObject {
  const { pageCount, coverMaterial, coverArtTexture, coverArtMaterial, paperColor, textures } = opts;
  const { sheets: S, stackTop } = journalDims(pageCount);
  const W = JOURNAL_W;
  const H = JOURNAL_H;

  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  const root = new THREE.Group();
  const stand = new THREE.Group();
  const offset = new THREE.Group();
  offset.position.x = -W / 2;
  stand.add(offset);
  root.add(stand);

  /* -------- materials -------- */
  const paperMat = track(
    new THREE.MeshStandardMaterial({ color: paperColor, map: getPaperTexture(), roughness: 0.92 }),
  );
  const edgeMat = track(
    new THREE.MeshStandardMaterial({ map: getForeEdgeTexture(), roughness: 0.95 }),
  );
  const wellMat = paperMat;

  /* -------- back cover -------- */
  const coverGeo = track(new RoundedBoxGeometry(W, COVER_T, H, 3, 0.006));
  const backCover = new THREE.Mesh(coverGeo, coverMaterial);
  backCover.position.set(W / 2, COVER_T / 2, 0);
  backCover.castShadow = true;
  backCover.receiveShadow = true;
  offset.add(backCover);

  /* -------- spine (wraps the left edge) -------- */
  const spineGeo = track(new RoundedBoxGeometry(COVER_T * 1.25, stackTop + COVER_T, H + COVER_T * 0.5, 3, 0.008));
  const spine = new THREE.Mesh(spineGeo, coverMaterial);
  spine.position.set(-COVER_T * 0.5, (stackTop + COVER_T) / 2, 0);
  spine.userData.isSpine = true;
  spine.castShadow = true;
  offset.add(spine);

  /* -------- sheet stack --------
   * Slot heights: in the closed book sheet 0 is the TOP sheet (just under
   * the front cover): y = stackTop - (i+0.5)*t. Turned sheets re-pile on the
   * opened front cover from the bottom: y = COVER_T + (i+0.5)*t. */
  const slabGeo = track(createSheetSlab(W, H, SHEET_T, SHEET_CORNER));
  const slotY = (i: number, left: boolean): number =>
    left ? COVER_T + (i + 0.5) * SHEET_T : stackTop - (i + 0.5) * SHEET_T;
  const sheets: THREE.Mesh[] = [];
  for (let i = 0; i < S; i++) {
    const m = new THREE.Mesh(slabGeo, [paperMat, edgeMat]);
    m.position.y = slotY(i, false);
    m.castShadow = true;
    m.receiveShadow = true;
    offset.add(m);
    sheets.push(m);
  }

  /* -------- front cover on a pivot at the spine -------- */
  const coverPivot = new THREE.Group();
  coverPivot.position.set(0, stackTop + COVER_T / 2, 0);
  offset.add(coverPivot);
  const coverArtMesh = new THREE.Mesh(coverGeo, coverMaterial);
  coverArtMesh.position.set(W / 2, 0, 0);
  coverArtMesh.castShadow = true;
  coverPivot.add(coverArtMesh);
  // art decal slightly above the cover's front face (guaranteed visible)
  const artGeo = track(new THREE.PlaneGeometry(W * 0.985, H * 0.99));
  const artMesh = new THREE.Mesh(artGeo, coverArtMaterial);
  artMesh.rotation.x = -HALF_PI;
  artMesh.position.set(W / 2, COVER_T / 2 + 0.0009, 0);
  coverPivot.add(artMesh);
  // paper liner on the inside of the front cover
  const linerGeo = track(createSheetSurface(W, H, SHEET_CORNER));
  const liner = new THREE.Mesh(linerGeo, wellMat);
  liner.rotation.z = 0;
  liner.rotation.x = Math.PI; // face down (inside of cover)
  liner.position.y = -COVER_T / 2 - 0.0006;
  liner.receiveShadow = true;
  coverPivot.add(liner);

  if (coverArtTexture) {
    coverArtMaterial.map = coverArtTexture;
    coverArtMaterial.needsUpdate = true;
  }

  /* -------- spread content planes + wells -------- */
  const surfaceGeo = track(createSheetSurface(W, H, SHEET_CORNER));
  const mkSurface = (geo: THREE.BufferGeometry): THREE.Mesh => {
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: paperColor,
        map: getPaperTexture(),
        roughness: 0.94,
      }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  };
  // left-page geometry: mirrored around Y so the front face still points up,
  // then u flipped so image-left lands on the page's outer (left) edge
  const leftGeo = track(createSheetSurface(W, H, SHEET_CORNER));
  leftGeo.rotateY(Math.PI);
  {
    const uv = leftGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    uv.needsUpdate = true;
  }
  const leftContent = mkSurface(leftGeo);
  const rightContent = mkSurface(surfaceGeo);
  const leftWell = mkSurface(leftGeo);
  const rightWell = mkSurface(surfaceGeo);
  offset.add(leftContent, rightContent, leftWell, rightWell);

  /* -------- flipping sheet (dedicated geometries: these get bent) -------- */
  const flipGroup = new THREE.Group();
  flipGroup.visible = false;
  offset.add(flipGroup);
  const flipEdgeGeo = track(createSheetSlab(W, H, SHEET_T, SHEET_CORNER));
  const flipFrontGeo = track(createSheetSurface(W, H, SHEET_CORNER));
  const flipBackGeo = track(createSheetSurface(W, H, SHEET_CORNER));
  const flipEdge = new THREE.Mesh(flipEdgeGeo, [paperMat, edgeMat]);
  const flipFrontMat = track(
    new THREE.MeshStandardMaterial({ color: paperColor, map: getPaperTexture(), roughness: 0.92 }),
  );
  const flipFront = new THREE.Mesh(flipFrontGeo, flipFrontMat);
  flipFront.position.y = SHEET_T + 0.0004; // sits on the edge slab's top face
  const flipBackMat = track(
    new THREE.MeshStandardMaterial({ color: paperColor, map: getPaperTexture(), roughness: 0.92 }),
  );
  const flipBack = new THREE.Mesh(flipBackGeo, flipBackMat);
  flipBack.rotation.x = Math.PI; // face down; becomes visible when theta > 90deg
  flipBack.position.y = -0.0004;
  flipGroup.add(flipEdge, flipFront, flipBack);

  /* -------- invisible tap zones (generous flip hit area) -------- */
  const zoneGeo = track(new THREE.PlaneGeometry(W * 1.6, H * 1.55)); // generous hit area extends past the fore-edge
  const zoneMat = track(
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  const tapZoneR = new THREE.Mesh(zoneGeo, zoneMat);
  tapZoneR.rotation.x = -HALF_PI; // lie flat like a page
  tapZoneR.position.set(W / 2, 0.14, 0);
  const tapZoneL = new THREE.Mesh(zoneGeo, zoneMat);
  tapZoneL.rotation.x = -HALF_PI;
  tapZoneL.position.set(-W / 2, 0.14, 0);
  offset.add(tapZoneR, tapZoneL);

  /* -------- moving shadow under the flipping page -------- */
  const flipShadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(W * 1.15, H * 0.95)),
    track(
      new THREE.MeshBasicMaterial({
        map: getShadowBlobTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    ),
  );
  flipShadow.rotation.x = -HALF_PI;
  flipShadow.renderOrder = 30;
  flipShadow.visible = false;
  offset.add(flipShadow);

  /* -------- gutter contact shadow (darkens while a page is in the air) -------- */
  const gutterShadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(W * 0.55, H * 0.96)),
    track(
      new THREE.MeshBasicMaterial({
        map: getGutterShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    ),
  );
  gutterShadow.rotation.x = -HALF_PI;
  gutterShadow.renderOrder = 29;
  gutterShadow.visible = false;
  offset.add(gutterShadow);

  const api: JournalObject = {
    root,
    stand,
    offset,
    coverPivot,
    spine,
    sheets,
    leftContent,
    rightContent,
    flipGroup,
    flipFront,
    flipBack,
    flipEdge,
    coverArtMesh,
    leftWell,
    rightWell,
    tapZoneL,
    tapZoneR,
    flipShadow,
    gutterShadow,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };

  return api;
}

/** Point a spread-content plane at a page (or blank paper when tex is null). */
export function applyPageTexture(
  mesh: THREE.Mesh,
  pageIndex: number,
  textures: PageTextureProvider,
  paperColor: string,
  side: 'right' | 'left' = 'right',
): void {
  const tex = side === 'left' ? textures.getLeftTexture(pageIndex) : textures.getPageTexture(pageIndex);
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.map = tex ?? getPaperTexture();
  mat.color.set(tex ? '#ffffff' : paperColor);
  mat.needsUpdate = true;
}
