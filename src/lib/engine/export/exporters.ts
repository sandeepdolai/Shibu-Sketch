/**
 * ACAN3D — scene export (GLTF / GLB / OBJ).
 * Exports registered scene objects with transforms, materials and
 * (for GLTF) texture-bearing materials.
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import type { Engine } from '../Engine';

function buildExportRoot(engine: Engine): THREE.Scene {
  const root = new THREE.Scene();
  root.name = 'ACAN3D_Scene';
  for (const r of engine.roots) {
    const clone = r.clone(true);
    clone.position.copy(r.position);
    clone.rotation.copy(r.rotation);
    clone.scale.copy(r.scale);
    root.add(clone);
  }
  return root;
}

function toBase64(buffer: ArrayBuffer | string): string {
  const bytes = typeof buffer === 'string' ? new TextEncoder().encode(buffer) : new Uint8Array(buffer);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function exportScene(
  engine: Engine,
  format: 'gltf' | 'glb' | 'obj',
): Promise<{ base64: string; mime: string; name: string }> {
  const root = buildExportRoot(engine);

  if (format === 'obj') {
    const exporter = new OBJExporter();
    const text = exporter.parse(root);
    return { base64: toBase64(text), mime: 'text/plain', name: 'acan3d-scene.obj' };
  }

  const exporter = new GLTFExporter();
  const binary = format === 'glb';
  const result = await new Promise<ArrayBuffer | Record<string, unknown>>((resolve, reject) => {
    exporter.parse(
      root,
      (res) => resolve(res as ArrayBuffer | Record<string, unknown>),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary, onlyVisible: true, maxTextureSize: 2048 },
    );
  });
  const mime = binary ? 'model/gltf-binary' : 'model/gltf+json';
  const name = binary ? 'acan3d-scene.glb' : 'acan3d-scene.gltf';
  return { base64: toBase64(result as ArrayBuffer), mime, name };
}
