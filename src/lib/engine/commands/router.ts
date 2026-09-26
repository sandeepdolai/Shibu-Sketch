/**
 * ACAN3D — CommandRouter.
 * Single mutation path for the whole application: both the in-app UI and
 * the external AI agent execute these validated, deterministic commands.
 */

import { z } from 'zod';
import * as THREE from 'three';
import type { Engine } from '../Engine';
import { DEFAULT_BOOK_PARAMS, buildBook } from '../procedural/book';
import { buildPaperStack } from '../procedural/paperStack';
import { createPrimitiveGeometry, PRIMITIVE_DEFAULTS } from '../procedural/shapes';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import type {
  ACANUserData,
  CommandResult,
  Easing,
  LightType,
  MaterialSlot,
  PrimitiveKind,
  ShadingMode,
  Vec3,
} from '../types';
import { useEditor } from '../store';

/* ------------------------------------------------------------------ */
/* schema helpers                                                      */
/* ------------------------------------------------------------------ */

const vec3 = z.union([
  z.object({ x: z.number(), y: z.number(), z: z.number() }),
  z.tuple([z.number(), z.number(), z.number()]),
]).transform((v): Vec3 => Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v);

const easing = z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'step']) as z.ZodType<Easing>;

const ok = <T>(result: T): CommandResult<T> => ({ ok: true, result });
const err = (error: string, code: NonNullable<Extract<CommandResult<never>, { ok: false }>['code']>): CommandResult<never> => ({ ok: false, error, code });

const PRIMS = Object.keys(PRIMITIVE_DEFAULTS) as Exclude<PrimitiveKind, 'custom'>[];

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */

type Handler = (engine: Engine, params: Record<string, unknown>) => Promise<CommandResult> | CommandResult;

interface CommandDoc { name: string; description: string; schema?: z.ZodType<Record<string, unknown>> }

const commands = new Map<string, CommandDoc & { handler: Handler }>();

function defCommand(name: string, description: string, schema: z.ZodType<Record<string, unknown>> | null, handler: Handler): void {
  commands.set(name, { name, description, schema: schema ?? undefined, handler });
}

function run(engine: Engine, command: string, params: Record<string, unknown>): Promise<CommandResult> | CommandResult {
  const entry = commands.get(command);
  if (!entry) {
    return err(
      `unknown command: ${command}. Call list_commands for the available set.`,
      'VALIDATION',
    );
  }
  let parsed: Record<string, unknown> = params ?? {};
  if (entry.schema) {
    const res = entry.schema.safeParse(params ?? {});
    if (!res.success) {
      const issues = res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      return err(`validation failed for ${command} — ${issues}`, 'VALIDATION');
    }
    parsed = res.data;
  }
  try {
    return entry.handler(engine, parsed);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 'EXEC_ERROR');
  }
}

/* ------------------------------------------------------------------ */
/* shared helpers                                                      */
/* ------------------------------------------------------------------ */

function requireObject(engine: Engine, id: string): THREE.Object3D {
  const obj = engine.objectMap.get(id);
  if (!obj) throw new Error(`object not found: ${id}`);
  return obj;
}

function requireMesh(engine: Engine, id: string): THREE.Mesh {
  const obj = requireObject(engine, id);
  if (!(obj as THREE.Mesh).isMesh) throw new Error(`object ${id} is not a mesh`);
  const ud = obj.userData.acan as ACANUserData;
  if (ud.pageMeta) throw new Error('page meshes are procedurally animated; mesh editing is disabled for them');
  return obj as THREE.Mesh;
}

function makeTransformParams(p: { position?: Vec3; rotation?: Vec3; rotationDeg?: Vec3; scale?: Vec3 }) {
  const out: { position?: Vec3; rotation?: Vec3; scale?: Vec3 } = {};
  if (p.position) out.position = p.position;
  if (p.rotation) out.rotation = p.rotation;
  if (p.rotationDeg) {
    out.rotation = {
      x: THREE.MathUtils.degToRad(p.rotationDeg.x),
      y: THREE.MathUtils.degToRad(p.rotationDeg.y),
      z: THREE.MathUtils.degToRad(p.rotationDeg.z),
    };
  }
  if (p.scale) out.scale = p.scale;
  return out;
}

/* ------------------------------------------------------------------ */
/* discovery                                                           */
/* ------------------------------------------------------------------ */

defCommand('list_commands', 'List all available commands with descriptions.', null, () => {
  return ok({
    commands: Array.from(commands.values()).map((c) => ({ name: c.name, description: c.description })),
  });
});

defCommand('help', 'Alias of list_commands.', null, () =>
  ok({ commands: Array.from(commands.values()).map((c) => ({ name: c.name, description: c.description })) }));

defCommand('get_stats', 'Engine stats: fps, triangles, objects.', null, (engine) => {
  const st = engine.objectMap.size;
  return ok({ fps: Math.round((engine as unknown as { fpsEma: number }).fpsEma ?? 0), objects: st, triangles: engine.renderer.info.render.triangles });
});

defCommand('inspect_scene', 'Full structured scene dump: objects, transforms, materials, lights, cameras, animation, environment.', z.object({
  includeGeometry: z.boolean().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const includeGeometry = (p as { includeGeometry?: boolean }).includeGeometry;
  engine.syncStore(false);
  const objects = engine.objectMap.size;
  const list: Array<Record<string, unknown>> = [];
  for (const [id, obj] of engine.objectMap) {
    const ud = obj.userData.acan as ACANUserData;
    const mesh = obj as THREE.Mesh;
    const entry: Record<string, unknown> = {
      id,
      name: ud.name,
      type: ud.type,
      kind: ud.kind ?? null,
      parentId: null,
      visible: obj.visible,
      locked: !!ud.locked,
      transform: {
        position: obj.position.toArray().map((n) => Number(n.toFixed(6))),
        rotationDeg: [obj.rotation.x, obj.rotation.y, obj.rotation.z].map((r) => Number(THREE.MathUtils.radToDeg(r).toFixed(3))),
        scale: obj.scale.toArray(),
      },
      materialIds: engine.objectMaterials.get(id) ?? [],
    };
    let pp: THREE.Object3D | null = obj.parent;
    while (pp) {
      const pid = (pp.userData.acan as ACANUserData | undefined)?.id;
      if (pid && engine.objectMap.has(pid)) { entry.parentId = pid; break; }
      pp = pp.parent;
    }
    if (mesh.isMesh && mesh.geometry) {
      entry.mesh = {
        vertices: mesh.geometry.getAttribute('position')?.count ?? 0,
        faces: mesh.geometry.index ? mesh.geometry.index.count / 3 : 0,
        editable: !!ud.editable && !ud.pageMeta,
      };
      if (ud.pageMeta) entry.page = ud.pageMeta;
    }
    if (ud.type === 'light') {
      const l = obj as THREE.DirectionalLight & { distance: number; angle: number; penumbra: number };
      entry.light = {
        lightType: ud.lightType,
        color: `#${l.color.getHexString()}`,
        intensity: l.intensity,
        castShadow: l.castShadow,
      };
    }
    if (ud.type === 'camera') {
      const c = obj as THREE.PerspectiveCamera & { zoom: number };
      entry.camera = { cameraType: ud.cameraType, fov: c.fov, zoom: c.zoom };
    }
    list.push(entry);
  }
  const result: Record<string, unknown> = {
    objectCount: objects,
    objects: list,
    animation: {
      fps: engine.anim.fps,
      start: engine.anim.start,
      end: engine.anim.end,
      current: Number(engine.anim.current.toFixed(3)),
      playing: engine.anim.playing,
      loop: engine.anim.loop,
      trackCount: engine.anim.tracks.length,
      tracks: engine.anim.tracks,
    },
    environment: { ...engine.env },
    materials: Array.from(engine.materialReg.values()).map((m) => m.def),
    textures: Array.from(engine.textureReg.values()).map((t) => ({ ...t.def, dataUrl: includeGeometry ? t.def.dataUrl : undefined })),
  };
  return ok(result);
});

defCommand('inspect_object', 'Detailed record for one object.', z.object({
  objectId: z.string(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId } = p as { objectId: string };
  const obj = requireObject(engine, objectId);
  const ud = obj.userData.acan as ACANUserData;
  const mesh = obj as THREE.Mesh;
  const result: Record<string, unknown> = {
    id: objectId,
    name: ud.name,
    type: ud.type,
    kind: ud.kind ?? null,
    visible: obj.visible,
    locked: !!ud.locked,
    editable: !!ud.editable && !ud.pageMeta,
    generator: ud.generator ?? null,
    pageMeta: ud.pageMeta ?? null,
    transform: {
      position: obj.position.toArray(),
      rotationDeg: [obj.rotation.x, obj.rotation.y, obj.rotation.z].map((r) => THREE.MathUtils.radToDeg(r)),
      scale: obj.scale.toArray(),
    },
    materialIds: engine.objectMaterials.get(objectId) ?? [],
    keyframes: engine.anim.tracks.filter((t) => t.objectId === objectId),
    children: obj.children
      .map((c) => (c.userData.acan as ACANUserData | undefined)?.id)
      .filter(Boolean),
  };
  if (mesh.isMesh && mesh.geometry) {
    result.mesh = {
      vertices: mesh.geometry.getAttribute('position')?.count ?? 0,
      faces: mesh.geometry.index ? mesh.geometry.index.count / 3 : 0,
      hasNormals: !!mesh.geometry.getAttribute('normal'),
      hasUvs: !!mesh.geometry.getAttribute('uv'),
    };
    if (typeof (mesh.userData.proto as { primitive?: string } | undefined)?.primitive === 'string') {
      result.primitive = mesh.userData.proto;
    }
  }
  return ok(result);
});

/* ------------------------------------------------------------------ */
/* objects                                                             */
/* ------------------------------------------------------------------ */

defCommand('create_object', 'Create a primitive mesh (box, sphere, cylinder, cone, torus, plane, capsule, roundedBox, tetrahedron, octahedron).', z.object({
  type: z.string(),
  name: z.string().optional(),
  params: z.record(z.string(), z.number()).optional(),
  position: vec3.optional(),
  rotation: vec3.optional(),
  rotationDeg: vec3.optional(),
  scale: vec3.optional(),
  materialPreset: z.string().optional(),
  parentId: z.string().nullable().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { type: string; name?: string; params?: Record<string, number>; position?: Vec3; rotation?: Vec3; rotationDeg?: Vec3; scale?: Vec3; materialPreset?: string; parentId?: string | null };
  const type = q.type as Exclude<PrimitiveKind, 'custom'>;
  if (!(type in PRIMITIVE_DEFAULTS)) {
    return err(`unknown primitive type "${type}". valid: ${PRIMS.join(', ')}`, 'VALIDATION');
  }
  const params = { ...PRIMITIVE_DEFAULTS[type], ...(q.params ?? {}) };
  const geom = createPrimitiveGeometry(type, params);
  const name = engine.nextName(q.name ?? type.charAt(0).toUpperCase() + type.slice(1));
  const mesh = new THREE.Mesh(geom);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.proto = { primitive: type, params };
  const id = engine.register(mesh, { type: 'mesh', name, kind: type, editable: true }, undefined, q.parentId ?? undefined);
  const matId = engine.createMaterial({ preset: q.materialPreset, name: `${name} Material` });
  engine.objectMaterials.set(id, [matId]);
  const reg = engine.materialReg.get(matId)!;
  mesh.material = reg.mat;
  const t = makeTransformParams(q);
  if (Object.keys(t).length) engine.setTransform(id, t);
  else engine.syncStore(true);
  return ok({ objectId: id, materialId: matId, name });
});

defCommand('create_group', 'Create an empty group (optionally parenting objectIds).', z.object({
  name: z.string().optional(),
  objectIds: z.array(z.string()).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { name?: string; objectIds?: string[] };
  const group = new THREE.Group();
  const name = engine.nextName(q.name ?? 'Group');
  const id = engine.register(group, { type: 'group', name, kind: 'group' });
  for (const oid of q.objectIds ?? []) {
    const child = engine.objectMap.get(oid);
    if (!child) return err(`object not found: ${oid}`, 'NOT_FOUND');
    child.removeFromParent();
    engine.roots = engine.roots.filter((r) => r !== child);
    group.add(child);
  }
  engine.syncStore(true);
  return ok({ objectId: id });
});

defCommand('group_objects', 'Group existing objects under a new group.', z.object({
  objectIds: z.array(z.string()).min(1),
  name: z.string().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectIds: string[]; name?: string };
  return run(engine, 'create_group', { name: q.name, objectIds: q.objectIds }) as CommandResult;
});

defCommand('delete_object', 'Delete one or many objects (cascades to children).', z.object({
  objectId: z.string().optional(),
  objectIds: z.array(z.string()).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId?: string; objectIds?: string[] };
  const ids = q.objectIds ?? (q.objectId ? [q.objectId] : []);
  if (ids.length === 0) return err('provide objectId or objectIds', 'VALIDATION');
  engine.pushUndo();
  let n = 0;
  for (const id of ids) {
    if (engine.objectMap.has(id)) {
      engine.unregister(id, true);
      n++;
    }
  }
  engine.syncStore(true);
  return ok({ deleted: n });
});

defCommand('duplicate_object', 'Duplicate an object (and children) with an optional offset, count times.', z.object({
  objectId: z.string(),
  count: z.number().int().min(1).max(100).default(1),
  offset: vec3.optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId: string; count?: number; offset?: Vec3 };
  const src = requireObject(engine, q.objectId);
  const count = q.count ?? 1;
  engine.pushUndo();
  const created: string[] = [];

  // source descendants that carry acan registration, in deterministic DFS order
  const srcNodes: THREE.Object3D[] = [];
  src.traverse((n) => {
    if (n !== src && (n.userData.acan as ACANUserData | undefined)?.id) srcNodes.push(n);
  });

  for (let i = 0; i < count; i++) {
    const clone = src.clone(true);

    // deep-clone geometries so duplicated meshes are independently editable,
    // and normalize userData (BufferGeometry.clone() JSON-stringifies it,
    // turning Float32Array rest positions into plain objects)
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        mesh.geometry = mesh.geometry.clone();
        const rest = mesh.geometry.userData.restPositions;
        if (rest) {
          try {
            mesh.geometry.userData.restPositions = rest instanceof Float32Array
              ? new Float32Array(rest)
              : Float32Array.from(Object.values(rest as Record<string, number>));
          } catch {
            delete mesh.geometry.userData.restPositions;
          }
        }
        if (mesh.geometry.index && mesh.geometry.index.count === 0) {
          const count2 = mesh.geometry.getAttribute('position')?.count ?? 0;
          const identity = new Uint32Array(count2);
          for (let k = 0; k < count2; k++) identity[k] = k;
          mesh.geometry.setIndex(new THREE.BufferAttribute(identity, 1));
        }
      }
    });

    const srcUd = src.userData.acan as ACANUserData;
    const name = engine.nextName(srcUd.name);
    clone.position.x += (q.offset?.x ?? 0.1) * (i + 1);
    clone.position.y += (q.offset?.y ?? 0) * (i + 1);
    clone.position.z += (q.offset?.z ?? 0) * (i + 1);
    const { id: _omit, ...srcUdNoId } = srcUd;
    const id = engine.register(clone, { ...srcUdNoId, name }, undefined, null);

    // re-register every descendant that was registered on the source (same DFS order)
    const cloneNodes: THREE.Object3D[] = [];
    clone.traverse((n) => {
      if (n !== clone && (n.userData.acan as ACANUserData | undefined)) cloneNodes.push(n);
    });
    const oldToNew = new Map<string, string>([[q.objectId, id]]);
    if (cloneNodes.length === srcNodes.length) {
      for (let k = 0; k < srcNodes.length; k++) {
        const oldUd = srcNodes[k].userData.acan as ACANUserData;
        const oldId = oldUd.id;
        const cloneNode = cloneNodes[k];
        // parent = mapped new parent id (or the clone root)
        let parentId = id;
        let pp: THREE.Object3D | null = srcNodes[k].parent;
        while (pp) {
          const pid = (pp.userData.acan as ACANUserData | undefined)?.id;
          const mapped = pid ? oldToNew.get(pid) : undefined;
          if (mapped) {
            parentId = mapped;
            break;
          }
          pp = pp.parent;
        }
        const { id: _drop, ...restUd } = oldUd;
        const newId = engine.register(cloneNode, { ...restUd, name: oldUd.name }, undefined, parentId);
        oldToNew.set(oldId, newId);
        // carry material bindings
        const mats = engine.objectMaterials.get(oldId);
        if (mats) engine.objectMaterials.set(newId, [...mats]);
        void cloneNode;
      }
    }

    const mats = engine.objectMaterials.get(q.objectId);
    if (mats) engine.objectMaterials.set(id, [...mats]);
    created.push(id);
  }
  engine.syncStore(true);
  return ok({ objectIds: created });
});

defCommand('select_object', 'Set the selection (viewport highlight + gizmo target).', z.object({
  objectId: z.string().optional(),
  objectIds: z.array(z.string()).optional(),
  additive: z.boolean().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId?: string; objectIds?: string[]; additive?: boolean };
  const ids = q.objectIds ?? (q.objectId ? [q.objectId] : []);
  const valid = ids.filter((id) => engine.objectMap.has(id));
  if (valid.length !== ids.length) return err(`unknown ids: ${ids.filter((i) => !engine.objectMap.has(i)).join(', ')}`, 'NOT_FOUND');
  engine.select(valid, q.additive);
  return ok({ selection: Array.from(engine.selection) });
});

defCommand('set_transform', 'Set position/rotation(rad)/rotationDeg/scale of an object.', z.object({
  objectId: z.string(),
  position: vec3.optional(),
  rotation: vec3.optional(),
  rotationDeg: vec3.optional(),
  scale: vec3.optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId: string } & Parameters<typeof makeTransformParams>[0];
  engine.pushUndo();
  const obj = requireObject(engine, q.objectId);
  const t = makeTransformParams(q);
  engine.setTransform(q.objectId, t);
  return ok({
    transform: {
      position: obj.position.toArray(),
      rotationDeg: [obj.rotation.x, obj.rotation.y, obj.rotation.z].map((r) => THREE.MathUtils.radToDeg(r)),
      scale: obj.scale.toArray(),
    },
  });
});

defCommand('rename_object', 'Rename an object.', z.object({
  objectId: z.string(),
  name: z.string().min(1),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId, name } = p as { objectId: string; name: string };
  const obj = requireObject(engine, objectId);
  const ud = obj.userData.acan as ACANUserData;
  ud.name = name;
  engine.syncStore(true);
  return ok({});
});

defCommand('set_visibility', 'Show/hide an object.', z.object({
  objectId: z.string(),
  visible: z.boolean(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId, visible } = p as { objectId: string; visible: boolean };
  const obj = requireObject(engine, objectId);
  obj.visible = visible;
  engine.syncStore(true);
  return ok({});
});

defCommand('parent', 'Re-parent an object (null = scene root).', z.object({
  objectId: z.string(),
  parentId: z.string().nullable(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId, parentId } = p as { objectId: string; parentId: string | null };
  const obj = requireObject(engine, objectId);
  if (parentId === null) {
    obj.removeFromParent();
    engine.scene.add(obj);
    engine.roots.push(obj);
  } else {
    const parent = requireObject(engine, parentId);
    if (parent === obj || engine.isDescendantForTest(parent, obj)) return err('cannot parent to a descendant', 'VALIDATION');
    obj.removeFromParent();
    engine.roots = engine.roots.filter((r) => r !== obj);
    parent.add(obj);
  }
  engine.syncStore(true);
  return ok({});
});

defCommand('set_edit_mode', 'Enter/exit mesh edit mode (face picking + ops).', z.object({
  objectId: z.string().nullable(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId } = p as { objectId: string | null };
  if (objectId) {
    const mesh = requireMesh(engine, objectId);
    const ud = mesh.userData.acan as ACANUserData;
    if (!ud.editable) return err(`mesh ${objectId} is not editable`, 'VALIDATION');
    engine.setEditMode(objectId);
  } else {
    engine.setEditMode(null);
  }
  return ok({ active: !!engine.edit.objectId, objectId: engine.edit.objectId });
});

defCommand('select_faces', 'Set the selected triangle faces of the edit-mode mesh.', z.object({
  objectId: z.string(),
  faceIndices: z.array(z.number().int().min(0)),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId, faceIndices } = p as { objectId: string; faceIndices: number[] };
  const mesh = requireMesh(engine, objectId);
  if (engine.edit.objectId !== objectId) engine.setEditMode(objectId);
  const count = mesh.geometry.index ? mesh.geometry.index.count / 3 : 0;
  const valid = faceIndices.filter((f) => f < count);
  engine.setEditFaces(valid);
  return ok({ faces: valid });
});

/* ------------------------------------------------------------------ */
/* mesh editing                                                        */
/* ------------------------------------------------------------------ */

defCommand('create_mesh', 'Create a custom editable mesh from vertices + triangle faces.', z.object({
  vertices: z.array(z.tuple([z.number(), z.number(), z.number()])).min(3),
  faces: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int()])).min(1),
  name: z.string().optional(),
  position: vec3.optional(),
  materialPreset: z.string().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { vertices: [number, number, number][]; faces: [number, number, number][]; name?: string; position?: Vec3; materialPreset?: string };
  const nv = q.vertices.length;
  for (const f of q.faces) {
    if (f[0] >= nv || f[1] >= nv || f[2] >= nv) return err(`face index out of range: ${f}`, 'VALIDATION');
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(q.vertices.flat()), 3));
  const uvs = q.vertices.map(() => [0, 0] as [number, number]);
  geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs.flat()), 2));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(q.faces.flat()), 1));
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  const name = engine.nextName(q.name ?? 'Mesh');
  const mesh = new THREE.Mesh(geom);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const id = engine.register(mesh, { type: 'mesh', name, kind: 'custom', editable: true });
  const matId = engine.createMaterial({ preset: q.materialPreset, name: `${name} Material` });
  engine.objectMaterials.set(id, [matId]);
  mesh.material = engine.materialReg.get(matId)!.mat;
  if (q.position) engine.setTransform(id, { position: q.position });
  engine.syncStore(true);
  return ok({ objectId: id, materialId: matId });
});

defCommand('get_mesh', 'Get mesh geometry data (vertices, triangle faces, uvs).', z.object({
  objectId: z.string(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId } = p as { objectId: string };
  const mesh = requireMesh(engine, objectId);
  const geom = mesh.geometry;
  const pos = geom.getAttribute('position');
  const uv = geom.getAttribute('uv');
  return ok({
    vertices: Array.from({ length: pos.count }, (_, i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]),
    faces: geom.index
      ? Array.from({ length: geom.index.count / 3 }, (_, i) => [geom.index!.getX(i * 3), geom.index!.getX(i * 3 + 1), geom.index!.getX(i * 3 + 2)])
      : [],
    uvs: uv ? Array.from({ length: uv.count }, (_, i) => [uv.getX(i), uv.getY(i)]) : null,
  });
});

defCommand('set_vertices', 'Move vertices (full array or sparse map {index: [x,y,z]}).', z.object({
  objectId: z.string(),
  positions: z.union([z.array(z.tuple([z.number(), z.number(), z.number()])), z.record(z.string(), z.tuple([z.number(), z.number(), z.number()]))]),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId, positions } = p as { objectId: string; positions: [number, number, number][] | Record<string, [number, number, number]> };
  const mesh = requireMesh(engine, objectId);
  engine.pushUndo();
  const n = engine.meshOpSetVertices(objectId, positions);
  return ok({ updated: n });
});

defCommand('extrude_faces', 'Extrude selected triangle faces along their average normal.', z.object({
  objectId: z.string(),
  faceIndices: z.array(z.number().int().min(0)),
  distance: z.number(),
  direction: z.tuple([z.number(), z.number(), z.number()]).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId, faceIndices, distance, direction } = p as { objectId: string; faceIndices: number[]; distance: number; direction?: [number, number, number] };
  const mesh = requireMesh(engine, objectId);
  if (!mesh.geometry.index) return err('geometry is not indexed', 'EXEC_ERROR');
  engine.pushUndo();
  engine.meshOpExtrude(objectId, faceIndices, distance, direction);
  const geom = mesh.geometry;
  return ok({ vertices: geom.getAttribute('position').count, faces: (geom.index?.count ?? 0) / 3 });
});

defCommand('inset_faces', 'Inset selected faces (per-triangle, individual).', z.object({
  objectId: z.string(),
  faceIndices: z.array(z.number().int().min(0)),
  amount: z.number().min(0.001).max(0.99),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId, faceIndices, amount } = p as { objectId: string; faceIndices: number[]; amount: number };
  const mesh = requireMesh(engine, objectId);
  engine.pushUndo();
  engine.meshOpInset(objectId, faceIndices, amount);
  return ok({ vertices: mesh.geometry.getAttribute('position').count, faces: mesh.geometry.index!.count / 3 });
});

defCommand('subdivide', 'Midpoint subdivide every face 1->4 per iteration (max 4).', z.object({
  objectId: z.string(),
  iterations: z.number().int().min(1).max(4).default(1),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId, iterations } = p as { objectId: string; iterations?: number };
  requireMesh(engine, objectId);
  engine.pushUndo();
  const r = engine.meshOpSubdivide(objectId, iterations ?? 1);
  return ok(r);
});

defCommand('merge_vertices', 'Weld vertices closer than tolerance.', z.object({
  objectId: z.string(),
  tolerance: z.number().min(1e-6).default(1e-4),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId, tolerance } = p as { objectId: string; tolerance?: number };
  requireMesh(engine, objectId);
  engine.pushUndo();
  const merged = engine.meshOpMerge(objectId, tolerance ?? 1e-4);
  return ok({ merged });
});

defCommand('delete_faces', 'Delete selected triangle faces.', z.object({
  objectId: z.string(),
  faceIndices: z.array(z.number().int().min(0)),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId, faceIndices } = p as { objectId: string; faceIndices: number[] };
  requireMesh(engine, objectId);
  engine.pushUndo();
  const n = engine.meshOpDeleteFaces(objectId, faceIndices);
  return ok({ deleted: n });
});

defCommand('flip_normals', 'Flip winding of all faces.', z.object({ objectId: z.string() }) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId } = p as { objectId: string };
  requireMesh(engine, objectId);
  engine.pushUndo();
  engine.meshOpFlip(objectId);
  return ok({});
});

defCommand('compute_normals', 'Recompute smooth vertex normals.', z.object({ objectId: z.string() }) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId } = p as { objectId: string };
  const mesh = requireMesh(engine, objectId);
  mesh.geometry.computeVertexNormals();
  return ok({});
});

defCommand('bevel_edges', 'Edge bevel — PLANNED, not yet implemented.', null, () =>
  err('bevel_edges is planned but not implemented yet (see docs/ROADMAP). Extrude + inset are available.', 'NOT_IMPLEMENTED'));

defCommand('boolean', 'CSG boolean union/subtract/intersect between two meshes (three-bvh-csg).', z.object({
  operation: z.enum(['union', 'subtract', 'intersect']),
  objectIdA: z.string(),
  objectIdB: z.string(),
  deleteInputs: z.boolean().default(false),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { operation: 'union' | 'subtract' | 'intersect'; objectIdA: string; objectIdB: string; deleteInputs?: boolean };
  const a = requireMesh(engine, q.objectIdA);
  const b = requireMesh(engine, q.objectIdB);
  if (a === b) return err('cannot boolean an object with itself', 'VALIDATION');
  engine.pushUndo();
  a.updateMatrixWorld(true);
  b.updateMatrixWorld(true);
  const brushA = new Brush(a.geometry.clone());
  brushA.position.copy(a.position);
  brushA.rotation.copy(a.rotation);
  brushA.scale.copy(a.scale);
  brushA.updateMatrixWorld();
  const brushB = new Brush(b.geometry.clone());
  brushB.position.copy(b.position);
  brushB.rotation.copy(b.rotation);
  brushB.scale.copy(b.scale);
  brushB.updateMatrixWorld();
  const evaluator = new Evaluator();
  const op = q.operation === 'union' ? ADDITION : q.operation === 'subtract' ? SUBTRACTION : INTERSECTION;
  let result: THREE.BufferGeometry;
  try {
    const brushResult = evaluator.evaluate(brushA, brushB, op);
    result = brushResult.geometry;
  } catch (e) {
    return err(`CSG failed: ${e instanceof Error ? e.message : String(e)}`, 'EXEC_ERROR');
  }
  result.computeVertexNormals();
  const name = engine.nextName(`${q.operation} Result`);
  const mesh = new THREE.Mesh(result);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const id = engine.register(mesh, { type: 'mesh', name, kind: 'custom', editable: true });
  const matId = engine.objectMaterials.get(q.objectIdA)?.[0] ?? engine.createMaterial({});
  engine.objectMaterials.set(id, [matId]);
  mesh.material = engine.materialReg.get(matId)!.mat;
  if (q.deleteInputs) {
    engine.unregister(q.objectIdA, true);
    engine.unregister(q.objectIdB, true);
  }
  engine.syncStore(true);
  return ok({ objectId: id });
});

/* ------------------------------------------------------------------ */
/* materials & textures                                                */
/* ------------------------------------------------------------------ */

defCommand('list_material_presets', 'List material presets.', null, (engine) =>
  ok({ presets: engine.materialPresetKeys() }));

defCommand('create_material', 'Create a material (from preset and/or explicit props).', z.object({
  name: z.string().optional(),
  preset: z.string().optional(),
  props: z.object({
    color: z.string().optional(),
    roughness: z.number().min(0).max(1).optional(),
    metalness: z.number().min(0).max(1).optional(),
    opacity: z.number().min(0).max(1).optional(),
    emissive: z.string().optional(),
    emissiveIntensity: z.number().min(0).optional(),
    transparent: z.boolean().optional(),
    side: z.enum(['front', 'back', 'double']).optional(),
  }).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { name?: string; preset?: string; props?: Record<string, unknown> };
  const id = engine.createMaterial({ ...(q.props ?? {}), preset: q.preset, name: q.name } as never);
  return ok({ materialId: id, def: engine.materialReg.get(id)?.def });
});

defCommand('assign_material', 'Assign an existing material to object(s).', z.object({
  objectId: z.string().optional(),
  objectIds: z.array(z.string()).optional(),
  materialId: z.string(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId?: string; objectIds?: string[]; materialId: string };
  const ids = q.objectIds ?? (q.objectId ? [q.objectId] : []);
  if (!engine.materialReg.has(q.materialId)) return err(`material not found: ${q.materialId}`, 'NOT_FOUND');
  for (const id of ids) {
    const obj = requireObject(engine, id);
    if ((obj as THREE.Group).isGroup) engine.setMaterialForSubtree(id, q.materialId);
    else {
      engine.assignMaterial(id, q.materialId);
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && (m.userData.acan as ACANUserData | undefined)?.id) engine.assignMaterial((m.userData.acan as ACANUserData).id, q.materialId);
      });
    }
  }
  return ok({});
});

defCommand('set_material', 'Create (or reuse) a material from preset/props and assign to object(s).', z.object({
  objectId: z.string().optional(),
  objectIds: z.array(z.string()).optional(),
  preset: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId?: string; objectIds?: string[]; preset?: string; props?: Record<string, unknown> };
  const ids = q.objectIds ?? (q.objectId ? [q.objectId] : []);
  if (ids.length === 0) return err('provide objectId or objectIds', 'VALIDATION');
  const matId = engine.createMaterial({ ...(q.props ?? {}), preset: q.preset } as never);
  for (const id of ids) {
    const obj = requireObject(engine, id);
    if ((obj as THREE.Group).isGroup) engine.setMaterialForSubtree(id, matId);
    else engine.assignMaterial(id, matId);
  }
  return ok({ materialId: matId });
});

defCommand('update_material', 'Update material properties.', z.object({
  materialId: z.string(),
  props: z.object({
    name: z.string().optional(),
    color: z.string().optional(),
    roughness: z.number().min(0).max(1).optional(),
    metalness: z.number().min(0).max(1).optional(),
    opacity: z.number().min(0).max(1).optional(),
    emissive: z.string().optional(),
    emissiveIntensity: z.number().min(0).optional(),
    transparent: z.boolean().optional(),
    side: z.enum(['front', 'back', 'double']).optional(),
    maps: z.record(z.string(), z.string()).optional(),
    textureRepeat: z.tuple([z.number(), z.number()]).optional(),
  }),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { materialId, props } = p as { materialId: string; props: Record<string, unknown> };
  if (!engine.materialReg.has(materialId)) return err(`material not found: ${materialId}`, 'NOT_FOUND');
  engine.updateMaterial(materialId, props as never);
  return ok({});
});

defCommand('create_texture', 'Generate a procedural texture (canvas-based).', z.object({
  procType: z.string(),
  name: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  size: z.number().int().min(64).max(2048).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { procType: string; name?: string; params?: Record<string, unknown>; size?: number };
  const id = engine.createProceduralTexture(q.procType, { ...(q.params ?? {}), ...(q.size ? { size: q.size } : {}) }, q.name);
  const def = engine.textureReg.get(id)!.def;
  return ok({ textureId: id, name: def.name });
});

defCommand('create_texture_from_image', 'Create a texture from a data URL or http(s) image URL.', z.object({
  name: z.string().optional(),
  dataUrl: z.string().optional(),
  url: z.string().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, async (engine, p) => {
  const q = p as { name?: string; dataUrl?: string; url?: string };
  const src = q.dataUrl ?? q.url;
  if (!src) return err('provide dataUrl or url', 'VALIDATION');
  try {
    const id = await engine.createImageTexture(src, q.name);
    return ok({ textureId: id });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 'EXEC_ERROR');
  }
});

defCommand('assign_texture', 'Assign a texture to a material slot (map/normalMap/roughnessMap).', z.object({
  textureId: z.string(),
  materialId: z.string().optional(),
  objectId: z.string().optional(),
  slot: z.enum(['map', 'normalMap', 'roughnessMap']).default('map'),
  repeat: z.tuple([z.number(), z.number()]).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { textureId: string; materialId?: string; objectId?: string; slot?: MaterialSlot; repeat?: [number, number] };
  let materialId = q.materialId;
  if (!materialId && q.objectId) {
    materialId = engine.objectMaterials.get(q.objectId)?.[0];
    if (!materialId) {
      materialId = engine.createMaterial({ preset: 'paper', name: 'Material' });
      engine.assignMaterial(q.objectId, materialId);
    }
  }
  if (!materialId) return err('provide materialId or objectId', 'VALIDATION');
  engine.assignTexture(materialId, q.slot ?? 'map', q.textureId, q.repeat);
  return ok({ materialId });
});

defCommand('delete_texture', 'Delete a texture and clear its material references.', z.object({
  textureId: z.string(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { textureId } = p as { textureId: string };
  engine.deleteTexture(textureId);
  return ok({});
});

/* ------------------------------------------------------------------ */
/* lights / cameras / environment                                      */
/* ------------------------------------------------------------------ */

defCommand('create_light', 'Create a light (ambient, hemisphere, directional, point, spot).', z.object({
  lightType: z.enum(['ambient', 'hemisphere', 'directional', 'point', 'spot']),
  name: z.string().optional(),
  color: z.string().default('#ffffff'),
  intensity: z.number().min(0).default(1.5),
  position: vec3.optional(),
  castShadow: z.boolean().default(false),
  angle: z.number().min(0.01).max(Math.PI / 2).optional(),
  penumbra: z.number().min(0).max(1).optional(),
  distance: z.number().min(0).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { lightType: LightType; name?: string; color: string; intensity: number; position?: Vec3; castShadow: boolean; angle?: number; penumbra?: number; distance?: number };
  engine.pushUndo();
  let light: THREE.Light;
  switch (q.lightType) {
    case 'ambient': light = new THREE.AmbientLight(q.color, q.intensity); break;
    case 'hemisphere': light = new THREE.HemisphereLight(q.color, 0x8d8577, q.intensity); break;
    case 'directional': {
      light = new THREE.DirectionalLight(q.color, q.intensity);
      (light as THREE.DirectionalLight).castShadow = q.castShadow;
      (light as THREE.DirectionalLight).shadow.mapSize.set(2048, 2048);
      (light as THREE.DirectionalLight).shadow.camera.left = (light as THREE.DirectionalLight).shadow.camera.bottom = -8;
      (light as THREE.DirectionalLight).shadow.camera.right = (light as THREE.DirectionalLight).shadow.camera.top = 8;
      (light as THREE.DirectionalLight).shadow.bias = -0.0004;
      break;
    }
    case 'spot': {
      light = new THREE.SpotLight(q.color, q.intensity, q.distance ?? 0, q.angle ?? Math.PI / 6, q.penumbra ?? 0.25);
      (light as THREE.SpotLight).castShadow = q.castShadow;
      break;
    }
    default: {
      light = new THREE.PointLight(q.color, q.intensity, q.distance ?? 0);
      (light as THREE.PointLight).castShadow = q.castShadow;
    }
  }
  const name = engine.nextName(q.name ?? `${q.lightType.charAt(0).toUpperCase()}${q.lightType.slice(1)} Light`);
  const id = engine.register(light, { type: 'light', name, lightType: q.lightType });
  if (q.position) engine.setTransform(id, { position: q.position });
  engine.syncStore(true);
  return ok({ objectId: id });
});

defCommand('update_light', 'Update light properties.', z.object({
  objectId: z.string(),
  color: z.string().optional(),
  intensity: z.number().min(0).optional(),
  castShadow: z.boolean().optional(),
  position: vec3.optional(),
  angle: z.number().min(0.01).max(Math.PI / 2).optional(),
  penumbra: z.number().min(0).max(1).optional(),
  distance: z.number().min(0).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId: string; color?: string; intensity?: number; castShadow?: boolean; position?: Vec3; angle?: number; penumbra?: number; distance?: number };
  const obj = requireObject(engine, q.objectId);
  const light = obj as unknown as THREE.Light & { castShadow?: boolean; angle?: number; penumbra?: number; distance?: number };
  if (!(light as unknown as { isLight?: boolean }).isLight) return err(`object ${q.objectId} is not a light`, 'VALIDATION');
  if (q.color !== undefined) light.color.set(q.color);
  if (q.intensity !== undefined) light.intensity = q.intensity;
  if (q.castShadow !== undefined && 'castShadow' in light) light.castShadow = q.castShadow;
  if (q.angle !== undefined && 'angle' in light) light.angle = q.angle;
  if (q.penumbra !== undefined && 'penumbra' in light) light.penumbra = q.penumbra;
  if (q.distance !== undefined && 'distance' in light) light.distance = q.distance;
  if (q.position) engine.setTransform(q.objectId, { position: q.position });
  engine.syncStore(true);
  return ok({});
});

defCommand('create_camera', 'Create a scene camera object (perspective or orthographic).', z.object({
  cameraType: z.enum(['perspective', 'orthographic']).default('perspective'),
  name: z.string().optional(),
  position: vec3.optional(),
  lookAt: vec3.optional(),
  fov: z.number().min(5).max(140).default(45),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { cameraType: 'perspective' | 'orthographic'; name?: string; position?: Vec3; lookAt?: Vec3; fov: number };
  engine.pushUndo();
  const cam = q.cameraType === 'orthographic'
    ? new THREE.OrthographicCamera(-0.4, 0.4, 0.3, -0.3, 0.01, 100)
    : new THREE.PerspectiveCamera(q.fov, 1.5, 0.01, 100);
  cam.position.set(q.position?.x ?? 4, q.position?.y ?? 3, q.position?.z ?? 4);
  if (q.lookAt) cam.lookAt(q.lookAt.x, q.lookAt.y, q.lookAt.z);
  else cam.lookAt(0, 0.1, 0);
  const name = engine.nextName(q.name ?? (q.cameraType === 'orthographic' ? 'Ortho Camera' : 'Camera'));
  const id = engine.register(cam, { type: 'camera', name, cameraType: q.cameraType });
  engine.syncStore(true);
  return ok({ objectId: id });
});

defCommand('update_camera', 'Update a scene camera (fov/zoom/position/lookAt).', z.object({
  objectId: z.string(),
  fov: z.number().min(5).max(140).optional(),
  zoom: z.number().min(0.01).optional(),
  position: vec3.optional(),
  lookAt: vec3.optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId: string; fov?: number; zoom?: number; position?: Vec3; lookAt?: Vec3 };
  const obj = requireObject(engine, q.objectId);
  const cam = obj as THREE.PerspectiveCamera & THREE.OrthographicCamera;
  if (!(cam as unknown as { isCamera?: boolean }).isCamera) return err(`object ${q.objectId} is not a camera`, 'VALIDATION');
  if (q.fov !== undefined && 'fov' in cam) { cam.fov = q.fov; cam.updateProjectionMatrix(); }
  if (q.zoom !== undefined && 'zoom' in cam) { cam.zoom = q.zoom; cam.updateProjectionMatrix(); }
  if (q.position) cam.position.set(q.position.x, q.position.y, q.position.z);
  if (q.lookAt) cam.lookAt(q.lookAt.x, q.lookAt.y, q.lookAt.z);
  cam.updateMatrixWorld(true);
  engine.syncStore(true);
  return ok({});
});

defCommand('set_active_camera', 'Set the camera used by render_preview (null = viewport default).', z.object({
  objectId: z.string().nullable(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId } = p as { objectId: string | null };
  if (objectId) {
    const obj = requireObject(engine, objectId);
    if (!(obj as unknown as { isCamera?: boolean }).isCamera) return err('not a camera', 'VALIDATION');
  }
  useEditor.getState().setActiveCameraId(objectId);
  return ok({ activeCameraId: objectId });
});

defCommand('set_viewport_camera', 'Move the viewport camera to a preset angle (iso/front/back/left/right/top/bottom).', z.object({
  preset: z.enum(['iso', 'front', 'back', 'left', 'right', 'top', 'bottom']),
  fitObject: z.string().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { preset: 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'; fitObject?: string };
  engine.setViewportPreset(q.preset, q.fitObject);
  return ok({});
});

defCommand('toggle_viewport_ortho', 'Switch viewport between perspective and orthographic.', null, (engine) => {
  engine.toggleViewportOrtho();
  return ok({ ortho: engine.activeViewport === 'ortho' });
});

defCommand('viewport_through_camera', 'Move the viewport camera to a scene camera pose (see through it).', z.object({
  objectId: z.string(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId } = p as { objectId: string };
  const obj = requireObject(engine, objectId);
  const cam = obj as THREE.PerspectiveCamera & THREE.OrthographicCamera;
  if (!(cam as unknown as { isCamera?: boolean }).isCamera) return err('not a camera', 'VALIDATION');
  cam.updateMatrixWorld(true);
  engine.perspCam.position.copy(cam.position);
  engine.perspCam.quaternion.copy(cam.quaternion);
  engine.orthoCam.position.copy(cam.position);
  engine.orthoCam.quaternion.copy(cam.quaternion);
  const target = new THREE.Vector3(0, 0.1, 0).applyMatrix4(cam.matrixWorld);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  engine.controls.target.copy(cam.position.clone().add(forward.multiplyScalar(0.6)));
  void target;
  engine.controls.update();
  return ok({ position: cam.position.toArray() });
});

defCommand('frame_object', 'Frame an object (or the whole scene / current selection).', z.object({
  objectId: z.string().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId } = p as { objectId?: string };
  engine.frameObject(objectId);
  return ok({});
});

defCommand('set_environment', 'Configure environment: background, ground, env intensity.', z.object({
  background: z.enum(['gradient', 'color', 'studio']).optional(),
  backgroundColor: z.string().optional(),
  ground: z.boolean().optional(),
  groundColor: z.string().optional(),
  envIntensity: z.number().min(0).max(3).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  engine.setEnvironment(p as Record<string, never>);
  return ok({ environment: { ...engine.env } });
});

/* ------------------------------------------------------------------ */
/* animation                                                           */
/* ------------------------------------------------------------------ */

defCommand('set_animation_settings', 'Configure timeline: fps, start, end, loop.', z.object({
  fps: z.number().min(1).max(120).optional(),
  start: z.number().int().min(0).optional(),
  end: z.number().int().min(1).optional(),
  loop: z.boolean().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { fps?: number; start?: number; end?: number; loop?: boolean };
  if (q.fps !== undefined) engine.anim.fps = q.fps;
  if (q.start !== undefined) engine.anim.start = q.start;
  if (q.end !== undefined) engine.anim.end = Math.max((q.start ?? engine.anim.start) + 1, q.end);
  if (q.loop !== undefined) engine.anim.loop = q.loop;
  engine.syncStore(true);
  return ok({});
});

defCommand('set_keyframe', 'Key the current (or given) value of position/rotation/scale for an object.', z.object({
  objectId: z.string(),
  channel: z.enum(['position', 'rotation', 'scale']),
  frame: z.number().int().min(0).optional(),
  easing: easing.optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId: string; channel: 'position' | 'rotation' | 'scale'; frame?: number; easing?: Easing };
  const obj = requireObject(engine, q.objectId);
  const frame = q.frame ?? Math.round(engine.anim.current);
  const v: [number, number, number] =
    q.channel === 'position' ? [obj.position.x, obj.position.y, obj.position.z]
      : q.channel === 'rotation' ? [obj.rotation.x, obj.rotation.y, obj.rotation.z]
        : [obj.scale.x, obj.scale.y, obj.scale.z];
  const trackId = engine.setKeyframe(q.objectId, q.channel, frame, v, q.easing);
  return ok({ trackId, frame, value: v });
});

defCommand('add_keyframe', 'Insert a keyframe with an explicit value.', z.object({
  objectId: z.string(),
  channel: z.enum(['position', 'rotation', 'scale']),
  frame: z.number().int().min(0),
  value: z.tuple([z.number(), z.number(), z.number()]),
  easing: easing.optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId: string; channel: 'position' | 'rotation' | 'scale'; frame: number; value: [number, number, number]; easing?: Easing };
  requireObject(engine, q.objectId);
  const trackId = engine.setKeyframe(q.objectId, q.channel, q.frame, q.value, q.easing);
  return ok({ trackId });
});

defCommand('update_keyframe', 'Update a keyframe (by index) on a transform track.', z.object({
  trackId: z.string(),
  index: z.number().int().min(0),
  frame: z.number().int().min(0).optional(),
  value: z.tuple([z.number(), z.number(), z.number()]).optional(),
  easing: easing.optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { trackId: string; index: number; frame?: number; value?: [number, number, number]; easing?: Easing };
  const track = engine.anim.tracks.find((t): t is Extract<typeof t, { type: 'transform' }> => t.id === q.trackId && t.type === 'transform');
  if (!track) return err(`transform track not found: ${q.trackId}`, 'NOT_FOUND');
  const key = track.keys[q.index];
  if (!key) return err(`keyframe index out of range`, 'NOT_FOUND');
  if (q.frame !== undefined) key.frame = q.frame;
  if (q.value) key.value = q.value;
  if (q.easing) key.easing = q.easing;
  track.keys.sort((a, b) => a.frame - b.frame);
  engine.evaluateAt(engine.anim.current, true);
  engine.syncStore(true);
  return ok({});
});

defCommand('delete_keyframe', 'Delete a keyframe from a transform track (by index or frame).', z.object({
  trackId: z.string(),
  index: z.number().int().min(0).optional(),
  frame: z.number().int().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { trackId: string; index?: number; frame?: number };
  const track = engine.anim.tracks.find((t): t is Extract<typeof t, { type: 'transform' }> => t.id === q.trackId && t.type === 'transform');
  if (!track) return err(`transform track not found: ${q.trackId}`, 'NOT_FOUND');
  const before = track.keys.length;
  if (q.index !== undefined) track.keys.splice(q.index, 1);
  else if (q.frame !== undefined) track.keys = track.keys.filter((k) => k.frame !== q.frame);
  if (track.keys.length === before) return err('keyframe not found', 'NOT_FOUND');
  engine.evaluateAt(engine.anim.current, true);
  engine.syncStore(true);
  return ok({ keys: track.keys.length });
});

defCommand('remove_track', 'Remove an animation track by id.', z.object({
  trackId: z.string(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { trackId } = p as { trackId: string };
  const before = engine.anim.tracks.length;
  engine.anim.tracks = engine.anim.tracks.filter((t) => t.id !== trackId);
  if (engine.anim.tracks.length === before) return err(`track not found: ${trackId}`, 'NOT_FOUND');
  engine.evaluateAt(engine.anim.current, true);
  engine.syncStore(true);
  return ok({});
});

defCommand('clear_animation', 'Remove all tracks of an object (or all tracks).', z.object({
  objectId: z.string().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { objectId } = p as { objectId?: string };
  engine.clearAnimation(objectId);
  return ok({ tracks: engine.anim.tracks.length });
});

defCommand('create_page_turn', 'Create a procedural page-turn track for a page mesh (physically-deformed flip).', z.object({
  objectId: z.string(),
  startFrame: z.number().int().min(0).default(0),
  endFrame: z.number().int().min(1).default(30),
  direction: z.union([z.literal(1), z.literal(-1)]).default(1),
  curvature: z.number().min(0).max(1.5).default(0.55),
  easing: easing.default('easeInOut'),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId: string; startFrame: number; endFrame: number; direction: 1 | -1; curvature: number; easing: Easing };
  const obj = requireObject(engine, q.objectId);
  const ud = obj.userData.acan as ACANUserData;
  if (!ud.pageMeta) return err(`object ${q.objectId} is not a page (created by create_book / create_paper_stack)`, 'VALIDATION');
  const end = Math.max(q.startFrame + 1, q.endFrame);
  const track = { id: `trk_turn_${ud.pageMeta.index}_${q.startFrame}`, type: 'pageTurn' as const, objectId: q.objectId, startFrame: q.startFrame, endFrame: end, direction: q.direction, curvature: q.curvature, easing: q.easing };
  engine.anim.tracks = engine.anim.tracks.filter((t) => t.id !== track.id);
  engine.anim.tracks.push(track);
  engine.anim.end = Math.max(engine.anim.end, end);
  engine.evaluateAt(engine.anim.current, true);
  engine.syncStore(true);
  return ok({ trackId: track.id });
});

defCommand('create_book_flip_sequence', 'Queue page-turns for a range of pages of a book, one after another (agent-friendly batch).', z.object({
  objectId: z.string(), // book group id
  fromIndex: z.number().int().min(0).optional(),
  toIndex: z.number().int().min(0).optional(), // inclusive; default: top page
  startFrame: z.number().int().min(0).default(0),
  framesPerPage: z.number().int().min(2).max(300).default(16),
  gapFrames: z.number().int().min(0).max(120).default(4),
  direction: z.union([z.literal(1), z.literal(-1)]).default(1),
  curvature: z.number().min(0).max(1.5).default(0.6),
  easing: easing.default('easeInOut'),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId: string; fromIndex?: number; toIndex?: number; startFrame: number; framesPerPage: number; gapFrames: number; direction: 1 | -1; curvature: number; easing: Easing };
  requireObject(engine, q.objectId);

  // collect registered pages of this book, sorted by index
  const pages: Array<{ id: string; index: number }> = [];
  for (const [oid, obj] of engine.objectMap) {
    const ud = obj.userData.acan as ACANUserData;
    if (ud.pageMeta && ud.pageMeta.bookId === q.objectId) pages.push({ id: oid, index: ud.pageMeta.index });
  }
  if (pages.length === 0) return err(`book ${q.objectId} has no registered pages`, 'NOT_FOUND');
  pages.sort((a, b) => a.index - b.index);

  // default: top page only; a from>to range flips back (direction handled by caller)
  let lo = q.fromIndex ?? pages.length - 1;
  let hi = q.toIndex ?? pages.length - 1;
  lo = Math.max(0, Math.min(pages.length - 1, lo));
  hi = Math.max(0, Math.min(pages.length - 1, hi));
  const seq = lo <= hi ? pages.slice(lo, hi + 1) : pages.slice(hi, lo + 1).reverse();

  let frame = q.startFrame;
  const tracks: Array<{ trackId: string; pageId: string; startFrame: number; endFrame: number }> = [];
  for (const page of seq) {
    const end = frame + q.framesPerPage;
    const trackId = `trk_turn_${page.index}_${frame}`;
    engine.anim.tracks = engine.anim.tracks.filter((t) => t.id !== trackId);
    engine.anim.tracks.push({
      id: trackId, type: 'pageTurn', objectId: page.id,
      startFrame: frame, endFrame: end,
      direction: q.direction, curvature: q.curvature, easing: q.easing,
    });
    tracks.push({ trackId, pageId: page.id, startFrame: frame, endFrame: end });
    frame = end + q.gapFrames;
  }
  engine.anim.end = Math.max(engine.anim.end, frame - q.gapFrames);
  engine.evaluateAt(engine.anim.current, true);
  engine.syncStore(true);
  return ok({ tracks, pagesFlipped: seq.length, endFrame: frame - q.gapFrames });
});

defCommand('create_book_open', 'Create a book-open track (rotates the front cover pivot around the spine).', z.object({
  objectId: z.string(),
  startFrame: z.number().int().min(0).default(0),
  endFrame: z.number().int().min(1).default(60),
  angleDeg: z.number().min(0).max(180).default(175),
  easing: easing.default('easeInOut'),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { objectId: string; startFrame: number; endFrame: number; angleDeg: number; easing: Easing };
  const obj = requireObject(engine, q.objectId);
  const ud = obj.userData.acan as ACANUserData;
  if (ud.generator !== 'book') return err(`object ${q.objectId} is not a generated book`, 'VALIDATION');
  const end = Math.max(q.startFrame + 1, q.endFrame);
  const track = { id: `trk_open_${q.objectId}_${q.startFrame}`, type: 'bookOpen' as const, objectId: q.objectId, startFrame: q.startFrame, endFrame: end, openAngle: THREE.MathUtils.degToRad(q.angleDeg), easing: q.easing };
  engine.anim.tracks = engine.anim.tracks.filter((t) => t.id !== track.id);
  engine.anim.tracks.push(track);
  engine.anim.end = Math.max(engine.anim.end, end);
  engine.evaluateAt(engine.anim.current, true);
  engine.syncStore(true);
  return ok({ trackId: track.id });
});

defCommand('play_animation', 'Play the timeline (optional from/to).', z.object({
  from: z.number().optional(),
  to: z.number().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { from?: number; to?: number };
  engine.play(q.from, q.to);
  return ok({ playing: true });
});

defCommand('pause_animation', 'Pause the timeline.', null, (engine) => {
  engine.pause();
  return ok({ playing: false });
});

defCommand('stop_animation', 'Stop (pause + return to start frame).', null, (engine) => {
  engine.stop();
  return ok({ frame: engine.anim.current });
});

defCommand('set_frame', 'Seek the timeline.', z.object({ frame: z.number().min(0) }) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { frame } = p as { frame: number };
  engine.evaluateAt(frame, true);
  engine.syncStore(true);
  return ok({ frame: engine.anim.current });
});

defCommand('inspect_animation', 'Return all animation tracks.', null, (engine) =>
  ok({ ...engine.anim, tracks: engine.anim.tracks }));

/* ------------------------------------------------------------------ */
/* procedural                                                          */
/* ------------------------------------------------------------------ */

interface CreateBookParams {
  name?: string;
  pageCount?: number;
  pageWidth?: number;
  pageHeight?: number;
  pageThickness?: number;
  pageGap?: number;
  coverThickness?: number;
  coverOverhang?: number;
  corner?: number;
  coverColor?: string;
  spineColor?: string;
  paperColor?: string;
  coverMaterialPreset?: string;
  paperTexture?: string | null;
  position?: Vec3;
  rotationDeg?: Vec3;
  scale?: number;
}

defCommand('create_book', 'Procedurally generate a realistic hardcover book/notebook: cover pivots, spine, individual bendable pages.', z.object({
  name: z.string().optional(),
  pageCount: z.number().int().min(1).max(800).default(200),
  pageWidth: z.number().min(0.01).max(2).default(0.15),
  pageHeight: z.number().min(0.01).max(3).default(0.21),
  pageThickness: z.number().min(0.00002).max(0.02).default(0.00035),
  pageGap: z.number().min(0).max(0.02).default(0.00025),
  coverThickness: z.number().min(0.0005).max(0.05).default(0.0025),
  coverOverhang: z.number().min(0).max(0.05).default(0.004),
  corner: z.number().min(0).max(0.02).default(0.002),
  coverColor: z.string().default('#7a3b2e'),
  spineColor: z.string().default('#5d2d23'),
  paperColor: z.string().default('#f5f1e6'),
  coverMaterialPreset: z.string().default('leather'),
  paperTexture: z.string().nullable().default(null),
  position: vec3.optional(),
  rotationDeg: vec3.optional(),
  scale: z.number().min(0.01).max(50).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as CreateBookParams;
  engine.pushUndo();

  // materials
  const coverMatId = engine.createMaterial({ preset: q.coverMaterialPreset ?? 'leather', name: 'Book Cover', color: q.coverColor });
  const spineMatId = engine.createMaterial({ preset: q.coverMaterialPreset ?? 'leather', name: 'Book Spine', color: q.spineColor });
  const paperMatId = engine.createMaterial({ preset: 'paper', name: 'Book Paper', color: q.paperColor });
  const texMap: Record<string, THREE.Material> = {
    cover: engine.materialReg.get(coverMatId)!.mat,
    spine: engine.materialReg.get(spineMatId)!.mat,
    paper: engine.materialReg.get(paperMatId)!.mat,
  };

  // paper texture (optional)
  if (q.paperTexture) {
    const texId = engine.createProceduralTexture(q.paperTexture, { baseColor: q.paperColor }, 'Book Paper Texture');
    engine.assignTexture(paperMatId, 'map', texId, [1, 1]);
  }

  const params = {
    ...DEFAULT_BOOK_PARAMS,
    pageCount: q.pageCount ?? DEFAULT_BOOK_PARAMS.pageCount,
    pageWidth: q.pageWidth ?? DEFAULT_BOOK_PARAMS.pageWidth,
    pageHeight: q.pageHeight ?? DEFAULT_BOOK_PARAMS.pageHeight,
    pageThickness: q.pageThickness ?? DEFAULT_BOOK_PARAMS.pageThickness,
    pageGap: q.pageGap ?? DEFAULT_BOOK_PARAMS.pageGap,
    coverThickness: q.coverThickness ?? DEFAULT_BOOK_PARAMS.coverThickness,
    coverOverhang: q.coverOverhang ?? DEFAULT_BOOK_PARAMS.coverOverhang,
    corner: q.corner ?? DEFAULT_BOOK_PARAMS.corner,
    coverColor: q.coverColor ?? DEFAULT_BOOK_PARAMS.coverColor,
    spineColor: q.spineColor ?? DEFAULT_BOOK_PARAMS.spineColor,
    paperColor: q.paperColor ?? DEFAULT_BOOK_PARAMS.paperColor,
    coverPreset: q.coverMaterialPreset ?? 'leather',
  };

  const built = buildBook(params, (key) => texMap[key]);
  const name = engine.nextName(q.name ?? 'Book');
  built.group.name = name;
  built.group.castShadow = true;

  // tag pivots + register hierarchy
  const groupId = engine.register(built.group, { type: 'group', name, kind: 'book', generator: 'book' });
  const pivotFrontId = engine.register(built.coverFrontPivot, { type: 'group', name: 'Front Cover Pivot', kind: 'coverFrontPivot' }, undefined, groupId);
  const pivotBackId = engine.register(built.coverBackPivot, { type: 'group', name: 'Back Cover Pivot', kind: 'coverBackPivot' }, undefined, groupId);
  const coverFrontId = engine.register(built.coverFront, { type: 'mesh', name: 'Front Cover', kind: 'book-cover' }, undefined, pivotFrontId);
  const coverBackId = engine.register(built.coverBack, { type: 'mesh', name: 'Back Cover', kind: 'book-cover' }, undefined, pivotBackId);
  const spineId = engine.register(built.spine, { type: 'mesh', name: 'Spine', kind: 'book-spine' }, undefined, groupId);

  const pageIds: string[] = [];
  built.pages.forEach((page, i) => {
    const ud = page.userData.pageMeta as { index: number; width: number; height: number; thickness: number } | undefined;
    const pid = engine.register(page, {
      type: 'mesh',
      name: `Page_${String(i + 1).padStart(3, '0')}`,
      kind: 'page',
      editable: false,
      pageMeta: {
        role: 'page',
        bookId: groupId,
        index: ud?.index ?? i,
        width: ud?.width ?? params.pageWidth,
        height: ud?.height ?? params.pageHeight,
        thickness: ud?.thickness ?? params.pageThickness,
        spineAt: 'x0',
      },
    }, undefined, groupId);
    pageIds.push(pid);
  });

  for (const pid of [coverFrontId, coverBackId, spineId]) engine.objectMaterials.set(pid, [pid === spineId ? spineMatId : coverMatId]);
  for (const pid of pageIds) engine.objectMaterials.set(pid, [paperMatId]);

  if (q.position || q.rotationDeg || q.scale) {
    engine.setTransform(groupId, {
      ...(q.position ? { position: q.position } : {}),
      ...(q.rotationDeg ? { rotation: { x: THREE.MathUtils.degToRad(q.rotationDeg.x), y: THREE.MathUtils.degToRad(q.rotationDeg.y), z: THREE.MathUtils.degToRad(q.rotationDeg.z) } } : {}),
      ...(q.scale ? { scale: { x: q.scale, y: q.scale, z: q.scale } } : {}),
    });
  }
  engine.frameObject(groupId);
  engine.syncStore(true);
  return ok({ groupId, coverFrontId, coverBackId, spineId, pivotFrontId, pivotBackId, pageIds, materialIds: { cover: coverMatId, spine: spineMatId, paper: paperMatId } });
});

defCommand('create_paper_stack', 'Generate a jittered stack of paper sheets.', z.object({
  name: z.string().optional(),
  count: z.number().int().min(1).max(500).default(20),
  width: z.number().min(0.01).max(3).default(0.21),
  height: z.number().min(0.01).max(3).default(0.297),
  sheetThickness: z.number().min(0.0001).max(0.02).default(0.0012),
  jitter: z.number().min(0).max(0.05).default(0.003),
  rotationJitterDeg: z.number().min(0).max(15).default(1.5),
  color: z.string().default('#f5f1e6'),
  position: vec3.optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { name?: string; count: number; width: number; height: number; sheetThickness: number; jitter: number; rotationJitterDeg: number; color: string; position?: Vec3 };
  engine.pushUndo();
  const paperMatId = engine.createMaterial({ preset: 'paper', name: 'Paper Stack', color: q.color });
  const mat = engine.materialReg.get(paperMatId)!.mat;
  const built = buildPaperStack({ count: q.count, width: q.width, height: q.height, sheetThickness: q.sheetThickness, jitter: q.jitter, rotationJitterDeg: q.rotationJitterDeg, color: q.color }, () => mat);
  const name = engine.nextName(q.name ?? 'Paper Stack');
  const groupId = engine.register(built.group, { type: 'group', name, kind: 'paper-stack', generator: 'paperStack' });
  const pageIds: string[] = [];
  built.sheets.forEach((sheet, i) => {
    const pid = engine.register(sheet, {
      type: 'mesh',
      name: `Sheet_${String(i + 1).padStart(3, '0')}`,
      kind: 'page',
      editable: false,
      pageMeta: { role: 'page', bookId: groupId, index: i, width: q.width, height: q.height, thickness: q.sheetThickness, spineAt: 'x0' },
    }, undefined, groupId);
    engine.objectMaterials.set(pid, [paperMatId]);
    pageIds.push(pid);
  });
  if (q.position) engine.setTransform(groupId, { position: q.position });
  engine.frameObject(groupId);
  engine.syncStore(true);
  return ok({ groupId, pageIds, materialId: paperMatId });
});

/* ------------------------------------------------------------------ */
/* viewport / render / project / history                               */
/* ------------------------------------------------------------------ */

defCommand('render_preview', 'Render the current view to a PNG (returns dataUrl + previewUrl).', z.object({
  width: z.number().int().min(64).max(2048).default(1024),
  height: z.number().int().min(64).max(2048).default(1024),
  cameraId: z.string().nullable().optional(),
  transparent: z.boolean().default(false),
  shading: z.enum(['solid', 'material', 'wireframe']).optional(),
  frame: z.number().optional(),
  includeHelpers: z.boolean().default(false),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { width?: number; height?: number; cameraId?: string | null; transparent?: boolean; shading?: ShadingMode; frame?: number; includeHelpers?: boolean };
  const shot = engine.renderPreview({
    width: q.width,
    height: q.height,
    cameraId: q.cameraId ?? useEditor.getState().activeCameraId,
    transparent: q.transparent,
    shading: q.shading,
    frame: q.frame,
    includeHelpers: q.includeHelpers,
  });
  const previewId = `pv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  engine.bridge?.uploadPreview(previewId, shot.dataUrl);
  return ok({ dataUrl: shot.dataUrl, previewUrl: `/api/agent/preview/${previewId}`, previewId, width: shot.width, height: shot.height });
});

defCommand('set_shading', 'Viewport shading: solid | material | wireframe.', z.object({
  mode: z.enum(['solid', 'material', 'wireframe']),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { mode } = p as { mode: ShadingMode };
  engine.setShading(mode);
  return ok({ shading: mode });
});

defCommand('set_grid', 'Toggle the ground grid.', z.object({ visible: z.boolean() }) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { visible } = p as { visible: boolean };
  engine.grid.visible = visible;
  useEditor.getState().setShowGrid(visible);
  return ok({});
});

defCommand('set_axes', 'Toggle the axes helper.', z.object({ visible: z.boolean() }) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const { visible } = p as { visible: boolean };
  engine.axes.visible = visible;
  useEditor.getState().setShowAxes(visible);
  return ok({});
});

defCommand('set_snap', 'Configure gizmo snapping.', z.object({
  enabled: z.boolean().optional(),
  translate: z.number().min(0.001).optional(),
  rotateDeg: z.number().min(1).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { enabled?: boolean; translate?: number; rotateDeg?: number };
  const st = useEditor.getState();
  if (q.enabled !== undefined) st.setSnap(q.enabled);
  if (q.translate !== undefined) st.setSnapTranslate(q.translate);
  if (q.rotateDeg !== undefined) st.setSnapRotate(q.rotateDeg);
  engine.applyGizmoMode();
  return ok({});
});

defCommand('set_gizmo', 'Set gizmo mode + space.', z.object({
  mode: z.enum(['translate', 'rotate', 'scale']),
  space: z.enum(['world', 'local']).optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, (engine, p) => {
  const q = p as { mode: 'translate' | 'rotate' | 'scale'; space?: 'world' | 'local' };
  engine.setGizmoMode(q.mode, q.space);
  return ok({});
});

defCommand('save_project', 'Serialize the scene and store it server-side.', z.object({
  name: z.string().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, async (engine, p) => {
  const { name } = p as { name?: string };
  const data = engine.getProjectData(name ?? 'Untitled');
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: data.meta.name, data }),
    });
    if (!res.ok) throw new Error(`server ${res.status}`);
    const json = (await res.json()) as { project?: { id: string; name: string } };
    return ok({ projectId: json.project?.id, name: data.meta.name });
  } catch (e) {
    return err(`save failed: ${e instanceof Error ? e.message : String(e)}`, 'EXEC_ERROR');
  }
});

defCommand('list_projects', 'List saved projects.', null, async () => {
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error(`server ${res.status}`);
    const json = (await res.json()) as { projects: Array<{ id: string; name: string; updatedAt: string }> };
    return ok({ projects: json.projects });
  } catch (e) {
    return err(`list failed: ${e instanceof Error ? e.message : String(e)}`, 'EXEC_ERROR');
  }
});

defCommand('load_project', 'Load a saved project by id.', z.object({
  projectId: z.string(),
}) as unknown as z.ZodType<Record<string, unknown>>, async (engine, p) => {
  const { projectId } = p as { projectId: string };
  try {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) throw new Error(`server ${res.status}`);
    const json = (await res.json()) as { project?: { data: Parameters<Engine['loadProjectData']>[0] } };
    if (!json.project?.data) throw new Error('project data missing');
    engine.loadProjectData(json.project.data);
    return ok({ objects: engine.objectMap.size, name: json.project.data.meta?.name });
  } catch (e) {
    return err(`load failed: ${e instanceof Error ? e.message : String(e)}`, 'EXEC_ERROR');
  }
});

defCommand('new_project', 'Clear the scene and start fresh.', null, (engine) => {
  engine.pushUndo();
  engine.newProject();
  return ok({});
});

defCommand('export_scene', 'Export the scene (gltf | glb | obj); returns a download URL.', z.object({
  format: z.enum(['gltf', 'glb', 'obj']).default('glb'),
}) as unknown as z.ZodType<Record<string, unknown>>, async (engine, p) => {
  const { format } = p as { format: 'gltf' | 'glb' | 'obj' };
  try {
    const { base64, mime, name } = await engine.exportSceneAsync(format);
    const exportId = `ex_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    engine.bridge?.uploadExport(exportId, name, mime, base64);
    return ok({ format, downloadUrl: `/api/agent/export/${exportId}`, exportId, bytes: Math.round((base64.length * 3) / 4) });
  } catch (e) {
    return err(`export failed: ${e instanceof Error ? e.message : String(e)}`, 'EXEC_ERROR');
  }
});

defCommand('import_gltf', 'Import a GLTF/GLB from a data URL (or URL) into the scene.', z.object({
  dataUrl: z.string().optional(),
  url: z.string().optional(),
  name: z.string().optional(),
}) as unknown as z.ZodType<Record<string, unknown>>, async (engine, p) => {
  const q = p as { dataUrl?: string; url?: string; name?: string };
  const src = q.dataUrl ?? q.url;
  if (!src) return err('provide dataUrl or url', 'VALIDATION');
  try {
    const { importGltf } = await import('../io/gltfImport');
    const id = await importGltf(engine, src, q.name);
    return ok({ objectId: id });
  } catch (e) {
    return err(`import failed: ${e instanceof Error ? e.message : String(e)}`, 'EXEC_ERROR');
  }
});

defCommand('undo', 'Undo the last mutating command.', null, (engine) => {
  const done = engine.undo();
  return done ? ok({}) : err('nothing to undo', 'EXEC_ERROR');
});

defCommand('redo', 'Redo.', null, (engine) => {
  const done = engine.redo();
  return done ? ok({}) : err('nothing to redo', 'EXEC_ERROR');
});

/* ------------------------------------------------------------------ */

export function executeCommand(engine: Engine, command: string, params: Record<string, unknown> = {}): Promise<CommandResult> | CommandResult {
  return run(engine, command, params);
}

export function listCommandNames(): string[] {
  return Array.from(commands.keys());
}
