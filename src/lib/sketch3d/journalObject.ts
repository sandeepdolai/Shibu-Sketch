/**
 * Shibu-Sketch — 3D journal object.
 *
 * A journal is built in "book space": the spine line runs along local Z at
 * x = 0, pages extend +X, thickness along Y, page height along Z. In this
 * space a closed journal lies flat with its front cover on top; rotating the
 * `stand` pivot by +PI/2 about X makes it stand upright facing the camera
 * (shelf pose). Opening the front cover = rotating its pivot around local Z.
 *
 * REMODEL (Acan3d book-generator model): the book block is rebuilt with the
 * same parameter philosophy as Acan3d's `buildBook` (pageThickness, pageGap,
 * coverOverhang) —
 *  - every sheet is a THICK rounded card (visible thickness everywhere),
 *  - sheets are separated by REAL air gaps (pageGap) so the closed fore-edge
 *    reads as dozens of stacked sheet edges (geometry, not texture),
 *  - the page block is INSET within the covers (coverOverhang) so cover
 *    margin shows around the block like the reference close-ups,
 *  - slots tile exactly: each slab occupies [origin, origin + t] with air
 *    gaps between — zero coplanar surfaces, zero interpenetration.
 *
 * Layers (bottom -> top): back cover, sheet stack (all sheets, individually
 * placeable), front cover pivot, spread content planes, flipping sheet group.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createSheetSurface, createSheetSlab, cacheRestPose } from './sheetGeom';
import { getSheetEdgeTexture, getPaperTexture, getShadowBlobTexture, getGutterShadowTexture } from './art';

const HALF_PI = Math.PI / 2;

/* Paper-app journal proportions: tall narrow pocket notebook (w/h ≈ 0.55),
 * with the Acan3d book-generator's chunky page block. */
export const JOURNAL_W = 0.78;
export const JOURNAL_H = 1.42;
export const COVER_T = 0.028;
/** Acan3d pageThickness equivalent — a chunky card page (was 0.0072). */
export const SHEET_T = 0.013;
/** Acan3d pageGap equivalent — real air gap between sheet edges; this is
 *  what draws the dark hairline seams of the striated fore-edge. */
export const SHEET_GAP = 0.0034;
export const SHEET_PITCH = SHEET_T + SHEET_GAP;
export const SHEET_CORNER = 0.05;
/** Acan3d coverOverhang equivalents — the page block sits INSET within the
 *  covers: fore-edge, top and bottom all keep a cover margin. */
export const PAGE_INSET_F = 0.02;
export const PAGE_INSET_TB = 0.018;
/** spine-side inset (hidden inside the spine wrap). */
export const PAGE_INSET_S = 0.004;
export const SHEET_W = JOURNAL_W - PAGE_INSET_F - PAGE_INSET_S;
export const SHEET_H = JOURNAL_H - PAGE_INSET_TB * 2;
/** the left pile rides a hair above the opened front cover (glitch-free). */
export const PILE_LIFT = 0.0012;

export interface JournalDims {
  sheets: number;
  stackTop: number; // y of the top face of the top sheet (closed block)
}

export function journalDims(pageCount: number): JournalDims {
  const sheets = Math.max(1, Math.ceil(pageCount / 2));
  return { sheets, stackTop: COVER_T + sheets * SHEET_T + (sheets - 1) * SHEET_GAP };
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
  /** per-sheet top-face content planes (visible only during open/close bloom) */
  sheetFaces: THREE.Mesh[];
  /** per-sheet bottom-face content planes (page backs — visible while reading,
   *  they give the standing fan its content slivers like the reference) */
  sheetBacks: THREE.Mesh[];
  tapZoneL: THREE.Mesh;
  tapZoneR: THREE.Mesh;
  /** soft static shading along the gutter (visible while reading) */
  gutterShade: THREE.Mesh;
  flipShadow: THREE.Mesh;
  gutterShadow: THREE.Mesh;
  dispose(): void;
}

export interface BuildJournalOpts {
  pageCount: number;
  coverMaterial: THREE.Material; // cover color/side material
  /** the spine wrap on the left edge — its own color (white/navy/…)
   *  like the reference where each journal's spine reads as a distinct band */
  spineMaterial: THREE.Material;
  coverArtTexture: THREE.Texture | null;
  coverArtMaterial: THREE.MeshPhysicalMaterial; // front face w/ art
  paperColor: string;
  textures: PageTextureProvider;
}

export function buildJournal(opts: BuildJournalOpts): JournalObject {
  const { pageCount, coverMaterial, spineMaterial, coverArtTexture, coverArtMaterial, paperColor, textures } = opts;
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
  // three subtly different edge tones cycle across the block — each card
  // edge catches light differently (like the reference's stacked pages)
  const edgeTex = getSheetEdgeTexture();
  const edgeMats = ['#ffffff', '#f2ede0', '#e7e1d1'].map((c) =>
    track(new THREE.MeshStandardMaterial({ color: c, map: edgeTex, roughness: 0.95 })),
  );
  const wellMat = paperMat;

  /* -------- sheet geometry (shared) --------
   * The slab's spine edge is BAKED at local x = PAGE_INSET_S so every sheet
   * mesh pivots exactly on the book spine (rotations/fans swing the true
   * spine line) while the block stays inset from the cover edges. */
  const slabGeo = track(createSheetSlab(SHEET_W, SHEET_H, SHEET_T, SHEET_CORNER));
  slabGeo.translate(PAGE_INSET_S, 0, 0);
  slabGeo.computeBoundingBox();
  cacheRestPose(slabGeo, PAGE_INSET_S + SHEET_W, SHEET_H);

  /* -------- back cover -------- */
  const coverGeo = track(new RoundedBoxGeometry(W, COVER_T, H, 3, 0.012));
  const backCover = new THREE.Mesh(coverGeo, coverMaterial);
  backCover.position.set(W / 2, COVER_T / 2, 0);
  backCover.castShadow = true;
  backCover.receiveShadow = true;
  offset.add(backCover);

  /* -------- spine (wraps the left edge + block's top/bottom, own band color) */
  const spineGeo = track(new RoundedBoxGeometry(COVER_T * 1.35, stackTop + COVER_T, H + COVER_T * 0.5, 3, 0.008));
  const spine = new THREE.Mesh(spineGeo, spineMaterial);
  spine.position.set(-COVER_T * 0.5, (stackTop + COVER_T) / 2, 0);
  spine.userData.isSpine = true;
  spine.castShadow = true;
  offset.add(spine);

  /* -------- sheet stack --------
   * Exact tiling (zero coplanar faces, zero overlap):
   *  right/closed: sheet i (0 = TOP, under the front cover) occupies
   *    [stackTop - (i+1)*t - i*gap, stackTop - i*t - i*gap]
   *  left pile (flipped sheets, slab hangs BELOW its origin):
   *    sheet i occupies [PILE_LIFT + COVER_T + i*pitch, + t]  */
  const slotY = (i: number): number => stackTop - (i + 1) * SHEET_T - i * SHEET_GAP;
  const sheets: THREE.Mesh[] = [];
  const sheetFaces: THREE.Mesh[] = [];
  const sheetBacks: THREE.Mesh[] = [];
  const faceGeo = track(new THREE.PlaneGeometry(SHEET_W * 0.99, SHEET_H * 0.99));
  const faceX = PAGE_INSET_S + SHEET_W / 2;
  for (let i = 0; i < S; i++) {
    const m = new THREE.Mesh(slabGeo, [paperMat, edgeMats[i % edgeMats.length]]);
    m.position.y = slotY(i);
    m.castShadow = true;
    m.receiveShadow = true;
    offset.add(m);
    sheets.push(m);
    // content face on top of each slab (rides the sheet's rotation; only
    // shown while the book blooms open / gathers closed, like the reference)
    const faceMat = track(
      new THREE.MeshStandardMaterial({
        color: paperColor,
        map: textures.getPageTexture(2 * i + 1) ?? getPaperTexture(),
        roughness: 0.92,
        side: THREE.DoubleSide,
      }),
    );
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.rotation.x = -HALF_PI;
    face.position.set(faceX, SHEET_T + 0.0006, 0);
    face.visible = false;
    face.castShadow = false;
    face.receiveShadow = false;
    m.add(face);
    sheetFaces.push(face);
    // back face (page 2i — the page that looks at the reader once the sheet
    // has been flipped onto the left pile)
    const backMat = track(
      new THREE.MeshStandardMaterial({
        color: paperColor,
        map: textures.getFlippedTexture(2 * i) ?? getPaperTexture(),
        roughness: 0.92,
        side: THREE.DoubleSide,
      }),
    );
    const back = new THREE.Mesh(faceGeo, backMat);
    back.rotation.x = -HALF_PI;
    back.position.set(faceX, -0.0006, 0);
    back.visible = false;
    back.castShadow = false;
    back.receiveShadow = false;
    m.add(back);
    sheetBacks.push(back);
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
  // paper liner on the inside of the front cover (sits close to the box so
  // the opened cover never pokes into the left pile)
  const linerGeo = track(createSheetSurface(W * 0.99, H * 0.995, SHEET_CORNER));
  const liner = new THREE.Mesh(linerGeo, wellMat);
  liner.rotation.x = Math.PI; // face down (inside of cover)
  liner.position.set(W / 2, -COVER_T / 2 - 0.0002, 0);
  liner.receiveShadow = true;
  coverPivot.add(liner);

  if (coverArtTexture) {
    coverArtMaterial.map = coverArtTexture;
    coverArtMaterial.needsUpdate = true;
  }

  /* -------- spread content planes + wells --------
   * Content planes match the inset sheet size and are baked at the sheet's
   * spine offset, so they line up with the page block edge-for-edge. */
  const rightContentGeo = track(createSheetSurface(SHEET_W, SHEET_H, SHEET_CORNER));
  rightContentGeo.translate(PAGE_INSET_S, 0, 0);
  const leftContentGeo = track(createSheetSurface(SHEET_W, SHEET_H, SHEET_CORNER));
  leftContentGeo.rotateY(Math.PI);
  {
    const uv = leftContentGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    uv.needsUpdate = true;
  }
  leftContentGeo.translate(-PAGE_INSET_S, 0, 0);
  const wellGeo = track(createSheetSurface(W * 0.995, H * 0.998, SHEET_CORNER));
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
  const leftContent = mkSurface(leftContentGeo);
  const rightContent = mkSurface(rightContentGeo);
  const leftWell = mkSurface(wellGeo);
  const rightWell = mkSurface(wellGeo);
  offset.add(leftContent, rightContent, leftWell, rightWell);

  /* -------- flipping sheet (dedicated geometries: these get bent) -------- */
  const flipGroup = new THREE.Group();
  flipGroup.visible = false;
  offset.add(flipGroup);
  const flipEdgeGeo = track(createSheetSlab(SHEET_W, SHEET_H, SHEET_T, SHEET_CORNER));
  flipEdgeGeo.translate(PAGE_INSET_S, 0, 0);
  flipEdgeGeo.computeBoundingBox();
  cacheRestPose(flipEdgeGeo, PAGE_INSET_S + SHEET_W, SHEET_H);
  const flipFrontGeo = track(createSheetSurface(SHEET_W, SHEET_H, SHEET_CORNER));
  flipFrontGeo.translate(PAGE_INSET_S, 0, 0);
  cacheRestPose(flipFrontGeo, PAGE_INSET_S + SHEET_W, SHEET_H);
  const flipBackGeo = track(createSheetSurface(SHEET_W, SHEET_H, SHEET_CORNER));
  flipBackGeo.translate(PAGE_INSET_S, 0, 0);
  cacheRestPose(flipBackGeo, PAGE_INSET_S + SHEET_W, SHEET_H);
  const flipEdge = new THREE.Mesh(flipEdgeGeo, [paperMat, edgeMats[1]]);
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

  /* -------- static gutter shading (reading-view spine valley) -------- */
  const gutterShade = new THREE.Mesh(
    track(new THREE.PlaneGeometry(W * 0.22, H * 0.985)),
    track(
      new THREE.MeshBasicMaterial({
        map: getGutterShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.28,
      }),
    ),
  );
  gutterShade.rotation.x = -HALF_PI;
  gutterShade.renderOrder = 28;
  gutterShade.visible = false;
  offset.add(gutterShade);

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
    sheetFaces,
    sheetBacks,
    tapZoneL,
    tapZoneR,
    gutterShade,
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
