/**
 * ACAN3D — project serialization.
 * Converts the live engine state to a portable ProjectData JSON and back.
 * Primitives keep their parametric form; everything else serializes as
 * raw buffer geometry (pages serialize from their REST positions so the
 * procedural deformation stays non-destructive).
 */

import * as THREE from 'three';
import type { Engine } from '../Engine';
import { createPrimitiveGeometry } from '../procedural/shapes';
import type {
  ACANUserData,
  MaterialDef,
  ProjectData,
  SerializedObject,
  TextureDef,
  Transform,
} from '../types';
import { PROJECT_FORMAT_VERSION, APP_NAME } from '../types';

export function serializeProject(engine: Engine, name: string): ProjectData {
  const objects: SerializedObject[] = [];

  const parentIds = new Map<string, string | null>();
  for (const [id, obj] of engine.objectMap) {
    let p: THREE.Object3D | null = obj.parent;
    let parentId: string | null = null;
    while (p) {
      const pid = (p.userData.acan as ACANUserData | undefined)?.id;
      if (pid && engine.objectMap.has(pid)) {
        parentId = pid;
        break;
      }
      p = p.parent;
    }
    parentIds.set(id, parentId);
  }

  for (const [id, obj] of engine.objectMap) {
    const ud = obj.userData.acan as ACANUserData;
    const transform: Transform = {
      position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
      rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
      scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
    };
    const ser: SerializedObject = {
      id,
      name: ud.name,
      type: ud.type,
      kind: ud.kind,
      parentId: parentIds.get(id) ?? null,
      transform,
      visible: obj.visible,
      locked: ud.locked,
      userData: {
        kind: ud.kind,
        generator: ud.generator,
        locked: ud.locked,
        editable: ud.editable,
        pageMeta: ud.pageMeta,
        lightType: ud.lightType,
        cameraType: ud.cameraType,
      },
      materialIds: engine.objectMaterials.get(id),
    };

    if (ud.type === 'mesh') {
      const mesh = obj as THREE.Mesh;
      const proto = ud.kind && mesh.userData.proto as { primitive: string; params: Record<string, number> } | undefined;
      if (proto) {
        ser.geometry = { kind: 'primitive', primitive: proto.primitive as never, params: proto.params };
      } else {
        const geom = mesh.geometry;
        const pos = geom.getAttribute('position') as THREE.BufferAttribute;
        const rest = geom.userData.restPositions as Float32Array | undefined;
        const src = rest && rest.length === pos.array.length ? rest : (pos.array as ArrayLike<number>);
        // non-indexed geometries (e.g. RoundedBoxGeometry) get an identity index
        const indices = geom.index
          ? Array.from(geom.index.array as ArrayLike<number>)
          : Array.from({ length: pos.count }, (_, i) => i);
        ser.geometry = {
          kind: 'buffer',
          vertices: Array.from(src),
          indices,
          uvs: geom.getAttribute('uv') ? Array.from((geom.getAttribute('uv') as THREE.BufferAttribute).array as ArrayLike<number>) : undefined,
        };
      }
    } else if (ud.type === 'light') {
      const light = obj as THREE.HemisphereLight;
      const d = obj as THREE.DirectionalLight & { distance?: number };
      const color = `#${light.color.getHexString()}`;
      ser.light = {
        lightType: ud.lightType ?? 'point',
        color,
        intensity: light.intensity,
        castShadow: (obj as THREE.DirectionalLight).castShadow ?? false,
        distance: (obj as THREE.PointLight).distance,
        angle: (obj as THREE.SpotLight).angle,
        penumbra: (obj as THREE.SpotLight).penumbra,
      };
      void d;
    } else if (ud.type === 'camera') {
      const cam = obj as THREE.PerspectiveCamera;
      ser.camera = {
        cameraType: ud.cameraType ?? 'perspective',
        fov: (cam as THREE.PerspectiveCamera).fov ?? 50,
        zoom: (cam as unknown as THREE.OrthographicCamera).zoom ?? 1,
      };
    }
    objects.push(ser);
  }

  return {
    app: APP_NAME,
    formatVersion: PROJECT_FORMAT_VERSION,
    meta: { name, savedAt: new Date().toISOString() },
    objects,
    materials: Array.from(engine.materialReg.values()).map((m) => m.def),
    textures: Array.from(engine.textureReg.values()).map((t) => t.def),
    animation: {
      fps: engine.anim.fps,
      start: engine.anim.start,
      end: engine.anim.end,
      loop: engine.anim.loop,
      tracks: JSON.parse(JSON.stringify(engine.anim.tracks)),
    },
    environment: { ...engine.env },
  };
}

export function clearEngineScene(engine: Engine): void {
  engine.setEditMode(null);
  engine.clearSelection();
  for (const id of Array.from(engine.objectMap.keys())) engine.unregister(id, true);
  for (const [, reg] of engine.materialReg) reg.mat.dispose();
  engine.materialReg.clear();
  for (const [, reg] of engine.textureReg) reg.tex.dispose();
  engine.textureReg.clear();
  engine.objectMaterials.clear();
}

export function deserializeProject(engine: Engine, data: ProjectData): void {
  clearEngineScene(engine);

  // materials & textures first
  const texIdMap = new Map<string, string>();
  for (const t of data.textures ?? []) {
    if (!t.dataUrl) continue;
    const tex = makeTextureFromDataUrl(t.dataUrl);
    const id = t.id;
    engine.textureReg.set(id, { def: { ...t, repeat: t.repeat ?? [1, 1] }, tex });
    texIdMap.set(t.id, id);
  }
  const matIdMap = new Map<string, string>();
  for (const m of data.materials ?? []) {
    const mat = buildMaterialFromDef(m, engine.textureReg);
    engine.materialReg.set(m.id, { def: m, mat });
    matIdMap.set(m.id, m.id);
  }

  // objects (parents may come later — create all, then attach)
  const created = new Map<string, THREE.Object3D>();
  for (const o of data.objects ?? []) {
    let obj: THREE.Object3D;
    if (o.type === 'light' && o.light) {
      obj = buildLight(o);
    } else if (o.type === 'camera' && o.camera) {
      const cam =
        o.camera.cameraType === 'orthographic'
          ? new THREE.OrthographicCamera(-0.4, 0.4, 0.3, -0.3, 0.01, 100)
          : new THREE.PerspectiveCamera(o.camera.fov ?? 50, 1.5, 0.01, 100);
      if (o.camera.cameraType === 'orthographic') cam.zoom = o.camera.zoom ?? 1;
      obj = cam;
    } else if (o.type === 'group') {
      obj = new THREE.Group();
    } else {
      const mesh = new THREE.Mesh();
      if (o.geometry?.kind === 'primitive') {
        mesh.geometry = createPrimitiveGeometry(o.geometry.primitive, o.geometry.params as Record<string, number>);
        mesh.userData.proto = { primitive: o.geometry.primitive, params: o.geometry.params };
      } else if (o.geometry?.kind === 'buffer') {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(o.geometry.vertices), 3));
        if (o.geometry.uvs) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(o.geometry.uvs), 2));
        const idx = o.geometry.indices;
        if (idx && idx.length > 0) {
          g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
        } else {
          const count = g.getAttribute('position').count;
          const identity = new Uint32Array(count);
          for (let i = 0; i < count; i++) identity[i] = i;
          g.setIndex(new THREE.BufferAttribute(identity, 1));
        }
        g.computeVertexNormals();
        g.computeBoundingBox();
        g.computeBoundingSphere();
        mesh.geometry = g;
      }
      obj = mesh;
    }
    obj.position.set(o.transform.position.x, o.transform.position.y, o.transform.position.z);
    obj.rotation.set(o.transform.rotation.x, o.transform.rotation.y, o.transform.rotation.z);
    obj.scale.set(o.transform.scale.x || 1e-6, o.transform.scale.y || 1e-6, o.transform.scale.z || 1e-6);
    obj.visible = o.visible;
    created.set(o.id, obj);
    // register without adding to scene yet (parentId wiring below)
    obj.userData.acan = {
      id: o.id,
      type: o.type,
      name: o.name,
      kind: o.userData.kind,
      generator: o.userData.generator,
      locked: o.userData.locked,
      editable: o.userData.editable,
      pageMeta: o.userData.pageMeta,
      lightType: o.userData.lightType,
      cameraType: o.userData.cameraType,
    };
    engine.objectMap.set(o.id, obj);
    if (o.materialIds?.length) engine.objectMaterials.set(o.id, o.materialIds.map((m) => matIdMap.get(m) ?? m).filter(Boolean));
  }
  // attach hierarchy + assign materials
  for (const o of data.objects ?? []) {
    const obj = created.get(o.id);
    if (!obj) continue;
    if (o.parentId && created.has(o.parentId)) created.get(o.parentId)!.add(obj);
    else {
      engine.scene.add(obj);
      engine.roots.push(obj);
    }
    if (o.type === 'mesh') {
      const mesh = obj as THREE.Mesh;
      const mid = engine.objectMaterials.get(o.id)?.[0];
      const reg = mid ? engine.materialReg.get(mid) : undefined;
      if (reg) mesh.material = reg.mat;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    } else if (o.type === 'group') {
      obj.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          const cid = (m.userData.acan as ACANUserData | undefined)?.id;
          const mid = cid ? engine.objectMaterials.get(cid)?.[0] : undefined;
          const reg = mid ? engine.materialReg.get(mid) : undefined;
          if (reg) m.material = reg.mat;
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
    }
  }
  engine.rebuildPickables();

  // animation + environment
  engine.anim = {
    ...engine.anim,
    fps: data.animation?.fps ?? 24,
    start: data.animation?.start ?? 0,
    end: data.animation?.end ?? 240,
    loop: data.animation?.loop ?? true,
    current: data.animation?.start ?? 0,
    playing: false,
    tracks: data.animation?.tracks ?? [],
  };
  engine.setEnvironment(data.environment ?? {});
  engine.evaluateAt(engine.anim.current, true);
}

function buildLight(o: SerializedObject): THREE.Object3D {
  const l = o.light!;
  switch (l.lightType) {
    case 'ambient':
      return new THREE.AmbientLight(l.color, l.intensity);
    case 'hemisphere':
      return new THREE.HemisphereLight(l.color, 0x8d8577, l.intensity);
    case 'directional': {
      const d = new THREE.DirectionalLight(l.color, l.intensity);
      d.castShadow = l.castShadow;
      d.shadow.mapSize.set(2048, 2048);
      d.shadow.camera.left = d.shadow.camera.bottom = -8;
      d.shadow.camera.right = d.shadow.camera.top = 8;
      d.shadow.bias = -0.0004;
      return d;
    }
    case 'spot': {
      const s = new THREE.SpotLight(l.color, l.intensity, l.distance ?? 0, l.angle ?? Math.PI / 6, l.penumbra ?? 0.2);
      s.castShadow = l.castShadow;
      return s;
    }
    default: {
      const p = new THREE.PointLight(l.color, l.intensity, l.distance ?? 0);
      p.castShadow = l.castShadow;
      return p;
    }
  }
}

function makeTextureFromDataUrl(dataUrl: string): THREE.Texture {
  const tex = new THREE.TextureLoader().load(dataUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildMaterialFromDef(def: MaterialDef, textures: Map<string, { tex: THREE.Texture }>): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial();
  const apply = () => {
    const texMap = new Map<string, THREE.Texture>();
    for (const [tid, t] of textures) texMap.set(tid, t.tex);
    for (const [slot, tid] of Object.entries(def.maps ?? {})) {
      const tex = texMap.get(tid);
      if (!tex) continue;
      const clone = tex.clone();
      clone.needsUpdate = true;
      const rep = def.textureRepeat ?? [1, 1];
      clone.repeat.set(rep[0], rep[1]);
      clone.wrapS = clone.wrapT = THREE.RepeatWrapping;
      if (slot === 'map') clone.colorSpace = THREE.SRGBColorSpace;
      mat[slot as 'map'] = clone;
    }
  };
  mat.color = new THREE.Color(def.color);
  mat.roughness = def.roughness;
  mat.metalness = def.metalness;
  mat.emissive = new THREE.Color(def.emissive);
  mat.emissiveIntensity = def.emissiveIntensity;
  mat.opacity = def.opacity;
  mat.transparent = def.transparent;
  mat.side = def.side === 'double' ? THREE.DoubleSide : def.side === 'back' ? THREE.BackSide : THREE.FrontSide;
  if (def.preset === 'fabric') {
    mat.sheen = 0.5;
    mat.sheenRoughness = 0.8;
  } else if (def.preset === 'plastic') {
    mat.clearcoat = 0.8;
    mat.clearcoatRoughness = 0.25;
  } else if (def.preset === 'leather') {
    mat.clearcoat = 0.3;
    mat.clearcoatRoughness = 0.5;
  }
  apply();
  return mat;
}
