/**
 * ACAN3D — Page geometry.
 *
 * A single sheet of paper as an indexed BufferGeometry:
 *  - spine edge at local x = 0, page extends toward +X
 *  - thickness along Y (rounded semicircular fore-edge)
 *  - page height along Z (0 .. depth)
 *
 * This orientation is the bending convention used by the page-turn system:
 * rotation about the local Z axis at x = 0 (see animation/pageTurn.ts).
 *
 * The rest pose is cached in geometry.userData (pageWidth + restPositions)
 * so deformation can always restart from the undeformed shape.
 */
import * as THREE from 'three';

export interface PageGeometryUserData {
  pageWidth: number;
  pageThickness: number;
  pageDepth: number;
  restPositions: Float32Array;
}

/**
 * Build a page "slab".
 *
 * Cross-section (XY plane): flat back edge at x=0 (y from -t/2 to +t/2),
 * flat top/bottom faces running to the fore-edge, then a semicircular
 * fore-edge arc of radius t/2 centered at (width - t/2, 0). Extruded along
 * Z from 0 to depth.
 *
 * @param width        page width in meters (spine -> fore-edge)
 * @param thickness    sheet thickness in meters
 * @param depth        page height in meters (Z extent)
 * @param arcSegments  arc resolution of the rounded fore-edge (default 14)
 * @param zSegments    Z extrusion segments, reserved for cross-page curvature (default 1)
 */
export function createPageGeometry(
  width: number,
  thickness: number,
  depth: number,
  arcSegments = 14,
  zSegments = 1,
): THREE.BufferGeometry {
  const w = Math.max(1e-4, width);
  const t = Math.max(1e-5, thickness);
  const d = Math.max(1e-4, depth);
  const arc = Math.max(1, Math.floor(arcSegments));
  const zseg = Math.max(1, Math.floor(zSegments));
  const r = t / 2;

  /* ---- 2D profile in XY, closed loop, counter-clockwise ----
   * back-bottom (0,-r) -> arc from -90deg..+90deg around (w-r, 0)
   * (arc endpoint 0 IS the fore-bottom, endpoint `arc` IS the fore-top)
   * -> back-top (0, r); closing segment is the spine edge.
   * Point count P = arc + 3. */
  const pts: Array<[number, number]> = [];
  pts.push([0, -r]);
  for (let i = 0; i <= arc; i++) {
    const a = -Math.PI / 2 + (i / arc) * Math.PI;
    pts.push([w - r + Math.cos(a) * r, Math.sin(a) * r]);
  }
  pts.push([0, r]);
  const P = pts.length; // arc + 3

  // normalized arc-length u per profile point (closed loop; seam on spine edge)
  const uArc = new Float32Array(P);
  let perimeter = 0;
  for (let i = 0; i < P; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % P];
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  let acc = 0;
  for (let i = 1; i < P; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    uArc[i] = perimeter > 0 ? acc / perimeter : 0;
  }

  const stride = P + 1; // wall row: P loop points + 1 duplicate of point 0 (u=1, hard spine edge)
  const rings = zseg + 1;
  const wallVerts = stride * rings;
  const capVerts = P + 1; // centroid + loop
  const totalVerts = wallVerts + capVerts * 2;

  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices: number[] = [];

  /* ---- wall vertices + uvs ---- */
  let vi = 0;
  let ui = 0;
  for (let j = 0; j < rings; j++) {
    const z = (j / zseg) * d - d / 2; // centered on origin so pages align with covers
    const v = j / zseg;
    for (let i = 0; i <= P; i++) {
      const k = i % P;
      const p = pts[k];
      positions[vi++] = p[0];
      positions[vi++] = p[1];
      positions[vi++] = z;
      uvs[ui++] = i === P ? 1 : uArc[k];
      uvs[ui++] = v;
    }
  }

  /* ---- wall indices (CCW profile extruded toward +Z -> outward normals) ---- */
  for (let j = 0; j < zseg; j++) {
    for (let i = 0; i < P; i++) {
      const a = j * stride + i;
      const b = j * stride + i + 1;
      const c = (j + 1) * stride + i;
      const dd = (j + 1) * stride + i + 1;
      indices.push(a, b, dd, a, dd, c);
    }
  }

  /* ---- caps (own vertices -> hard edge, smooth wall normals preserved) ---- */
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  cx /= P;
  cy /= P;

  const startCapBase = wallVerts;
  const endCapBase = wallVerts + capVerts;

  const zStart = -d / 2;
  const zEnd = d / 2;

  // start cap (z = -d/2, normal -Z): centroid + loop
  positions[vi++] = cx;
  positions[vi++] = cy;
  positions[vi++] = zStart;
  uvs[ui++] = cx / w;
  uvs[ui++] = (cy + r) / t;
  for (let i = 0; i < P; i++) {
    const p = pts[i];
    positions[vi++] = p[0];
    positions[vi++] = p[1];
    positions[vi++] = zStart;
    uvs[ui++] = p[0] / w;
    uvs[ui++] = (p[1] + r) / t;
  }
  // end cap (z = +d/2, normal +Z): centroid + loop
  positions[vi++] = cx;
  positions[vi++] = cy;
  positions[vi++] = zEnd;
  uvs[ui++] = cx / w;
  uvs[ui++] = (cy + r) / t;
  for (let i = 0; i < P; i++) {
    const p = pts[i];
    positions[vi++] = p[0];
    positions[vi++] = p[1];
    positions[vi++] = zEnd;
    uvs[ui++] = p[0] / w;
    uvs[ui++] = (p[1] + r) / t;
  }

  // cap triangles (fanned across the convex profile)
  for (let i = 0; i < P; i++) {
    const i1 = (i + 1) % P;
    // z = 0 cap faces -Z -> reversed winding
    indices.push(startCapBase, startCapBase + 1 + i1, startCapBase + 1 + i);
    // z = d cap faces +Z
    indices.push(endCapBase, endCapBase + 1 + i, endCapBase + 1 + i1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const userData: PageGeometryUserData = {
    pageWidth: w,
    pageThickness: t,
    pageDepth: d,
    restPositions: positions.slice(),
  };
  Object.assign(geo.userData, userData);

  return geo;
}
