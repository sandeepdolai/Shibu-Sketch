/**
 * ACAN3D — editable mesh operations.
 * Real geometry editing on indexed BufferGeometry: extrude, inset,
 * subdivide, merge, delete faces, flip/compute normals.
 * Face indices refer to triangles in index order.
 */

import * as THREE from 'three';

export interface MeshSnapshot {
  positions: Float32Array;
  uvs: Float32Array | null;
  indices: Uint32Array | Uint16Array | number[];
}

export function snapshotGeometry(geom: THREE.BufferGeometry): MeshSnapshot {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute | undefined;
  return {
    positions: new Float32Array(pos.array as ArrayLike<number>),
    uvs: uv ? new Float32Array(uv.array as ArrayLike<number>) : null,
    indices: geom.index ? Array.from(geom.index.array as ArrayLike<number>) : [],
  };
}

export function commitGeometry(geom: THREE.BufferGeometry): void {
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  (geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  if (geom.index) (geom.index as THREE.BufferAttribute).needsUpdate = true;
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (uv) uv.needsUpdate = true;
}

function triangleCount(geom: THREE.BufferGeometry): number {
  return geom.index ? geom.index.count / 3 : (geom.getAttribute('position')?.count ?? 0) / 3;
}

/* ------------------------------------------------------------------ */
/* set vertices                                                        */
/* ------------------------------------------------------------------ */

/** positions: full array or sparse map {index: [x,y,z]} (vertex indices). */
export function setVertexPositions(geom: THREE.BufferGeometry, positions: Record<number, [number, number, number]> | number[]): number {
  const attr = geom.getAttribute('position') as THREE.BufferAttribute;
  let updated = 0;
  if (Array.isArray(positions)) {
    const n = Math.min(positions.length, attr.count);
    for (let i = 0; i < n; i++) {
      const p = positions[i];
      if (!p) continue;
      attr.setXYZ(i, p[0], p[1], p[2]);
      updated++;
    }
  } else {
    for (const key of Object.keys(positions)) {
      const i = Number(key);
      const p = positions[i];
      if (!Number.isFinite(i) || i < 0 || i >= attr.count || !p) continue;
      attr.setXYZ(i, p[0], p[1], p[2]);
      updated++;
    }
  }
  commitGeometry(geom);
  return updated;
}

/* ------------------------------------------------------------------ */
/* extrude faces                                                       */
/* ------------------------------------------------------------------ */

export function extrudeFaces(geom: THREE.BufferGeometry, faceIndices: number[], distance: number, direction?: [number, number, number]): void {
  if (!geom.index) throw new Error('extrude requires an indexed geometry');
  const triCount = triangleCount(geom);
  const sel = new Set(faceIndices.filter((f) => Number.isInteger(f) && f >= 0 && f < triCount));
  if (sel.size === 0) throw new Error('no valid faces selected');

  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const index = geom.index;
  const vCount = pos.count;

  // unique verts of selected triangles + average normal
  const selVerts = new Set<number>();
  const normal = new THREE.Vector3();
  const triNormal = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (const f of sel) {
    const a = index.getX(f * 3);
    const b = index.getX(f * 3 + 1);
    const c = index.getX(f * 3 + 2);
    selVerts.add(a);
    selVerts.add(b);
    selVerts.add(c);
    ab.set(pos.getX(b) - pos.getX(a), pos.getY(b) - pos.getY(a), pos.getZ(b) - pos.getZ(a));
    ac.set(pos.getX(c) - pos.getX(a), pos.getY(c) - pos.getY(a), pos.getZ(c) - pos.getZ(a));
    triNormal.copy(ab).cross(ac).normalize();
    normal.add(triNormal);
  }
  if (direction) {
    normal.set(direction[0], direction[1], direction[2]);
  }
  if (normal.lengthSq() < 1e-12) normal.set(0, 1, 0);
  normal.normalize();

  // clone selected vertices (appended), build oldToNew map
  const oldToNew = new Map<number, number>();
  for (const v of selVerts) {
    const ni = vCount + oldToNew.size;
    pos.setXYZ(
      ni,
      pos.getX(v) + normal.x * distance,
      pos.getY(v) + normal.y * distance,
      pos.getZ(v) + normal.z * distance,
    );
    oldToNew.set(v, ni);
  }

  const uv = geom.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (uv) {
    for (const [v, n] of oldToNew) uv.setXY(n, uv.getX(v), uv.getY(v));
  }

  // rewrite index: selected tris point at clones
  for (const f of sel) {
    for (let k = 0; k < 3; k++) {
      const v = index.getX(f * 3 + k);
      const n = oldToNew.get(v);
      if (n !== undefined) index.setX(f * 3 + k, n);
    }
  }

  // boundary edges: edges used exactly once among selected tris (original winding order)
  const edgeUse = new Map<string, { a: number; b: number; count: number }>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  // recover original verts via oldToNew inverse
  const newToOld = new Map<number, number>();
  for (const [o, n] of oldToNew) newToOld.set(n, o);
  for (const f of sel) {
    const t0 = newToOld.get(index.getX(f * 3)) ?? index.getX(f * 3);
    const t1 = newToOld.get(index.getX(f * 3 + 1)) ?? index.getX(f * 3 + 1);
    const t2 = newToOld.get(index.getX(f * 3 + 2)) ?? index.getX(f * 3 + 2);
    for (const [a, b] of [[t0, t1], [t1, t2], [t2, t0]] as const) {
      const k = key(a, b);
      const rec = edgeUse.get(k);
      if (rec) rec.count++;
      else edgeUse.set(k, { a, b, count: 1 });
    }
  }

  // append side quads for boundary edges
  const extra: number[] = [];
  for (const { a, b, count } of edgeUse.values()) {
    if (count !== 1) continue;
    const na = oldToNew.get(a);
    const nb = oldToNew.get(b);
    if (na === undefined || nb === undefined) continue;
    // quad winding so its normal points the same way as the average normal
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    const nx = pos.getX(na), ny = pos.getY(na), nz = pos.getZ(na);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = nx - ax, wy = ny - ay, wz = nz - az;
    const cxn = uy * wz - uz * wy;
    const cyn = uz * wx - ux * wz;
    const czn = ux * wy - uy * wx;
    const dot = cxn * normal.x + cyn * normal.y + czn * normal.z;
    if (dot >= 0) {
      extra.push(a, b, nb, a, nb, na);
    } else {
      extra.push(b, a, na, b, na, nb);
    }
  }

  if (extra.length) {
    const newIndex = new Uint32Array(index.count + extra.length);
    newIndex.set(index.array as ArrayLike<number>, 0);
    newIndex.set(extra, index.count);
    geom.setIndex(new THREE.BufferAttribute(newIndex, 1));
  }

  commitGeometry(geom);
}

/* ------------------------------------------------------------------ */
/* inset faces (per-triangle, individual)                              */
/* ------------------------------------------------------------------ */

export function insetFaces(geom: THREE.BufferGeometry, faceIndices: number[], amount: number): void {
  if (!geom.index) throw new Error('inset requires an indexed geometry');
  const triCount = triangleCount(geom);
  const sel = new Set(faceIndices.filter((f) => Number.isInteger(f) && f >= 0 && f < triCount));
  if (sel.size === 0) throw new Error('no valid faces selected');
  const amt = Math.min(0.99, Math.max(0.001, amount));

  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const index = geom.index;
  const vCount = pos.count;

  let extra: number[] = [];
  const appended: number[] = []; // vertex positions to append
  const appendedUv: number[] = [];
  let next = vCount;

  const appendVert = (x: number, y: number, z: number, u?: number, vv?: number): number => {
    appended.push(x, y, z);
    if (uv) appendedUv.push(u ?? 0, vv ?? 0);
    return next++;
  };

  for (const f of sel) {
    const vs = [index.getX(f * 3), index.getX(f * 3 + 1), index.getX(f * 3 + 2)];
    const cx = (pos.getX(vs[0]) + pos.getX(vs[1]) + pos.getX(vs[2])) / 3;
    const cy = (pos.getY(vs[0]) + pos.getY(vs[1]) + pos.getY(vs[2])) / 3;
    const cz = (pos.getZ(vs[0]) + pos.getZ(vs[1]) + pos.getZ(vs[2])) / 3;
    const inner = vs.map((v) => {
      const x = pos.getX(v) + (cx - pos.getX(v)) * amt;
      const y = pos.getY(v) + (cy - pos.getY(v)) * amt;
      const z = pos.getZ(v) + (cz - pos.getZ(v)) * amt;
      return appendVert(x, y, z, uv ? uv.getX(v) : undefined, uv ? uv.getY(v) : undefined);
    });
    // replace triangle with inner triangle
    index.setX(f * 3, inner[0]);
    index.setX(f * 3 + 1, inner[1]);
    index.setX(f * 3 + 2, inner[2]);
    // side walls (preserve winding a->b)
    for (const [a, b, ia, ib] of [[vs[0], vs[1], inner[0], inner[1]], [vs[1], vs[2], inner[1], inner[2]], [vs[2], vs[0], inner[2], inner[0]]] as const) {
      extra.push(a, b, ib, a, ib, ia);
    }
  }

  // grow position/uv buffers
  const newPos = new Float32Array(pos.count * 3 + appended.length);
  newPos.set(pos.array as ArrayLike<number>, 0);
  newPos.set(appended, pos.count * 3);
  geom.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
  if (uv) {
    const newUv = new Float32Array(uv.count * 2 + appendedUv.length);
    newUv.set(uv.array as ArrayLike<number>, 0);
    newUv.set(appendedUv, uv.count * 2);
    geom.setAttribute('uv', new THREE.BufferAttribute(newUv, 2));
  }

  const newIndex = new Uint32Array(index.count + extra.length);
  newIndex.set(index.array as ArrayLike<number>, 0);
  newIndex.set(extra, index.count);
  geom.setIndex(new THREE.BufferAttribute(newIndex, 1));

  commitGeometry(geom);
}

/* ------------------------------------------------------------------ */
/* subdivide (midpoint 1->4)                                           */
/* ------------------------------------------------------------------ */

export function subdivideGeometry(geom: THREE.BufferGeometry, iterations = 1): { vertices: number; faces: number } {
  if (!geom.index) throw new Error('subdivide requires an indexed geometry');
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute | undefined;

  let positions = new Float32Array(pos.array as ArrayLike<number>);
  let uvs = uv ? new Float32Array(uv.array as ArrayLike<number>) : null;
  let indices = new Uint32Array(geom.index.array as ArrayLike<number>);

  for (let it = 0; it < Math.max(1, Math.min(4, iterations)); it++) {
    const vCount = positions.length / 3;
    const midCache = new Map<string, number>();
    const newTris: number[] = [];

    const midpoint = (a: number, b: number): number => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      const cached = midCache.get(k);
      if (cached !== undefined) return cached;
      const i = positions.length / 3;
      const np = new Float32Array(positions.length + 3);
      np.set(positions);
      np[i * 3] = (positions[a * 3] + positions[b * 3]) / 2;
      np[i * 3 + 1] = (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2;
      np[i * 3 + 2] = (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2;
      positions = np;
      if (uvs) {
        const nu = new Float32Array(uvs.length + 2);
        nu.set(uvs);
        nu[i * 2] = (uvs[a * 2] + uvs[b * 2]) / 2;
        nu[i * 2 + 1] = (uvs[a * 2 + 1] + uvs[b * 2 + 1]) / 2;
        uvs = nu;
      }
      midCache.set(k, i);
      return i;
    };

    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      newTris.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    indices = new Uint32Array(newTris);
    void vCount;
  }

  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (uvs) geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  commitGeometry(geom);
  return { vertices: positions.length / 3, faces: indices.length / 3 };
}

/* ------------------------------------------------------------------ */
/* merge vertices                                                      */
/* ------------------------------------------------------------------ */

export function mergeVertices(geom: THREE.BufferGeometry, tolerance = 1e-4): number {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const inv = 1 / Math.max(1e-9, tolerance);
  const map = new Map<string, number>();
  const oldToNew = new Map<number, number>();
  const newPositions: number[] = [];
  const newUvs: number[] = [];

  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * inv)},${Math.round(pos.getY(i) * inv)},${Math.round(pos.getZ(i) * inv)}`;
    const existing = map.get(k);
    if (existing !== undefined) {
      oldToNew.set(i, existing);
    } else {
      const ni = newPositions.length / 3;
      newPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (uv) newUvs.push(uv.getX(i), uv.getY(i));
      map.set(k, ni);
      oldToNew.set(i, ni);
    }
  }

  const merged = pos.count - newPositions.length / 3;
  if (merged <= 0 || !geom.index) return 0;

  const newIndices: number[] = [];
  for (let t = 0; t < geom.index.count; t += 3) {
    const a = oldToNew.get(geom.index.getX(t))!;
    const b = oldToNew.get(geom.index.getX(t + 1))!;
    const c = oldToNew.get(geom.index.getX(t + 2))!;
    if (a === b || b === c || a === c) continue; // drop degenerate
    newIndices.push(a, b, c);
  }

  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPositions), 3));
  if (uv && newUvs.length) geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(newUvs), 2));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
  commitGeometry(geom);
  return merged;
}

/* ------------------------------------------------------------------ */
/* delete faces / flip / recompute                                     */
/* ------------------------------------------------------------------ */

export function deleteFaces(geom: THREE.BufferGeometry, faceIndices: number[]): number {
  if (!geom.index) throw new Error('delete_faces requires an indexed geometry');
  const triCount = geom.index.count / 3;
  const sel = new Set(faceIndices.filter((f) => Number.isInteger(f) && f >= 0 && f < triCount));
  if (sel.size === 0) return 0;
  const kept: number[] = [];
  for (let t = 0; t < geom.index.count; t += 3) {
    if (!sel.has(t / 3)) kept.push(geom.index.getX(t), geom.index.getX(t + 1), geom.index.getX(t + 2));
  }
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(kept), 1));
  commitGeometry(geom);
  return sel.size;
}

export function flipNormals(geom: THREE.BufferGeometry): void {
  if (!geom.index) throw new Error('flip_normals requires an indexed geometry');
  const idx = geom.index;
  const arr = new Uint32Array(idx.count);
  for (let t = 0; t < idx.count; t += 3) {
    arr[t] = idx.getX(t);
    arr[t + 1] = idx.getX(t + 2);
    arr[t + 2] = idx.getX(t + 1);
  }
  geom.setIndex(new THREE.BufferAttribute(arr, 1));
  commitGeometry(geom);
}
