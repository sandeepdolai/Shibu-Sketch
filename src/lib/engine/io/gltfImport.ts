/**
 * ACAN3D — GLTF/GLB import.
 * Loads a GLTF from data URL / URL and registers it as an editable group.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Engine } from '../Engine';

export async function importGltf(engine: Engine, source: string, name?: string): Promise<string> {
  let buffer: ArrayBuffer;
  if (source.startsWith('data:')) {
    const res = await fetch(source);
    buffer = await res.arrayBuffer();
  } else {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    buffer = await res.arrayBuffer();
  }

  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, '');
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
    }
  });

  const label = engine.nextName(name ?? 'Imported GLTF');
  const group = new THREE.Group();
  group.add(root);
  const id = engine.register(group, { type: 'group', name: label, kind: 'gltf', generator: 'import' });
  engine.frameObject(id);
  engine.syncStore(true);
  return id;
}
