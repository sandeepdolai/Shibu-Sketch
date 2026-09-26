/**
 * Shibu-Sketch — sheet geometry + paper curl.
 *
 * A journal sheet is a rounded-corner rectangle slab built from a THREE.Shape
 * (spine edge straight at x = 0, fore-edge corners rounded, spine corners
 * lightly rounded). The flat geometry lives in the XZ plane (thickness along
 * Y), the same convention as the ACAN3D page-turn system: rotating about the
 * local Z axis at x = 0 turns a page from the right stack (+X) onto the left
 * stack (-X).
 *
 * `bendSheet` deforms any sheet geometry toward angle `theta` with a
 * fore-edge lag (paper curl). It always starts from the cached rest pose, so
 * it is safe to call every frame.
 */
import * as THREE from 'three';

export interface SheetUserData {
  sheetWidth: number;
  sheetDepth: number;
  restPositions: Float32Array;
  restNormals: Float32Array;
}

/** Rounded-rect shape for one sheet; spine edge (x=0) straight. */
export function sheetShape(w: number, d: number, foreR: number, spineR: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, spineR);
  s.lineTo(0, d - spineR);
  s.quadraticCurveTo(0, d, spineR, d);
  s.lineTo(w - foreR, d);
  s.quadraticCurveTo(w, d, w, d - foreR);
  s.lineTo(w, foreR);
  s.quadraticCurveTo(w, 0, w - foreR, 0);
  s.lineTo(spineR, 0);
  s.quadraticCurveTo(0, 0, 0, spineR);
  return s;
}

/**
 * Flat sheet geometry (single surface, no thickness) in the XZ plane:
 * spine at x=0, extends +X, height along Z centered on 0.
 * UVs: u = x/w (0 at spine, 1 at fore-edge), v = 0..1 along height.
 */
export function createSheetSurface(w: number, d: number, cornerR = 0.045): THREE.BufferGeometry {
  const shape = sheetShape(w, d, cornerR, cornerR * 0.35);
  const geo = new THREE.ShapeGeometry(shape, 10);
  // normalize UVs from raw shape coords (x: 0..w, y: 0..d) BEFORE rotating
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / w, pos.getY(i) / d);
  }
  uv.needsUpdate = true;
  // rotate XY -> XZ: (x, y, 0) -> (x, 0, -y), then center on z
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, d / 2);
  cacheRestPose(geo, w, d);
  return geo;
}

/**
 * Sheet slab with real thickness (extruded rounded rect), XZ plane.
 * material index 0 = top/bottom caps, 1 = side walls (fore-edge stripes).
 */
export function createSheetSlab(
  w: number,
  d: number,
  t: number,
  cornerR = 0.045,
): THREE.BufferGeometry {
  const shape = sheetShape(w, d, cornerR, cornerR * 0.35);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, t),
    bevelEnabled: false,
    curveSegments: 8,
  });
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  if (uv) {
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i) / w, pos.getY(i) / d);
    }
    uv.needsUpdate = true;
  }
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, d / 2);
  // keep ExtrudeGeometry's built-in groups: 0 = caps, 1 = side walls
  cacheRestPose(geo, w, d);
  return geo;
}

/** Cache the undeformed pose so bendSheet can restart every frame. */
export function cacheRestPose(geo: THREE.BufferGeometry, w: number, d: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const ud = geo.userData as Partial<SheetUserData>;
  ud.sheetWidth = w;
  ud.sheetDepth = d;
  ud.restPositions = new Float32Array(pos.array as ArrayLike<number>);
  if (nor) ud.restNormals = new Float32Array(nor.array as ArrayLike<number>);
}

function ensureRest(geo: THREE.BufferGeometry): SheetUserData {
  const ud = geo.userData as Partial<SheetUserData>;
  if (!ud.restPositions) {
    const d = ud.sheetDepth ?? 1;
    const w = ud.sheetWidth ?? 1;
    cacheRestPose(geo, w, d);
  }
  return geo.userData as SheetUserData;
}

/**
 * Bend a sheet toward `theta` (0 = flat +X / right, PI = flat -X / left).
 * curvature 0..1.5 adds the mid-turn fore-edge curl; `trail` mirrors it.
 */
export function bendSheet(
  geo: THREE.BufferGeometry,
  theta: number,
  curvature = 0.85,
  trail: 1 | -1 = 1,
): void {
  const ud = ensureRest(geo);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const rest = ud.restPositions;
  const w = Math.max(1e-4, ud.sheetWidth);
  const th = Math.min(Math.PI, Math.max(0, theta));
  const curl = Math.max(0, Math.min(1.5, curvature));
  const lag = curl * Math.sin(th);
  for (let i = 0; i < pos.count; i++) {
    const ox = rest[i * 3];
    const oz = rest[i * 3 + 2];
    const u = Math.min(1, Math.max(0, ox / w));
    let phi = th - trail * lag * Math.pow(u, 1.6);
    if (phi < 0) phi = 0;
    if (phi > Math.PI) phi = Math.PI;
    const r = ox * (1 - 0.055 * curl * Math.sin(th) * u);
    pos.setXYZ(i, Math.cos(phi) * r, Math.sin(phi) * r, oz);
  }
  pos.needsUpdate = true;
  if (nor && ud.restNormals) {
    const rn = ud.restNormals;
    for (let i = 0; i < nor.count; i++) {
      const nx = rn[i * 3];
      const ny = rn[i * 3 + 1];
      const nz = rn[i * 3 + 2];
      const ox = rest[i * 3];
      const u = Math.min(1, Math.max(0, ox / w));
      let phi = th - trail * lag * Math.pow(u, 1.6);
      if (phi < 0) phi = 0;
      if (phi > Math.PI) phi = Math.PI;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      nor.setXYZ(i, nx * c - ny * s, nx * s + ny * c, nz);
    }
    nor.needsUpdate = true;
  }
  geo.computeBoundingSphere();
}
