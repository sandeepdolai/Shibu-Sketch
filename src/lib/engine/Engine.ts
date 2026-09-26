/**
 * ACAN3D — imperative three.js engine.
 * Owns the renderer, scene, cameras, controls, selection, edit overlays,
 * shading, animation playback and the object/material/texture registries.
 * React never touches three.js: the UI and the external agent both mutate
 * state through the CommandRouter (see commands/router.ts).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import {
  evaluateTracks,
  resetProceduralTracks,
  type EvalContext,
} from './animation/evaluator';
import {
  deleteFaces,
  extrudeFaces,
  flipNormals,
  insetFaces,
  mergeVertices,
  setVertexPositions,
  subdivideGeometry,
} from './geometry/editable';
import {
  applyMaterialProps,
  defaultMaterialDef,
  makeThreeMaterial,
  MATERIAL_PRESETS,
} from './materials/library';
import { generateProceduralTexture, makeCanvasTexture, PROC_TEXTURE_TYPES } from './materials/textures';
import { serializeProject, deserializeProject, clearEngineScene } from './project/serialize';
import { exportScene } from './export/exporters';
import { useEditor } from './store';
import type {
  ACANUserData,
  AnimTrack,
  CommandResult,
  EnvironmentDef,
  Easing,
  LightType,
  MaterialDef,
  MaterialSlot,
  ObjectInfo,
  PrimitiveKind,
  SceneAnim,
  ShadingMode,
  TextureDef,
  Transform,
} from './types';

export const DEFAULT_ENV: EnvironmentDef = {
  background: 'gradient',
  backgroundColor: '#e8e4dc',
  ground: true,
  groundColor: '#b7b0a4',
  envIntensity: 0.55,
};

const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let seq = 0;
const nextSeq = () => ++seq;

/* ------------------------------------------------------------------ */

export interface EngineBridge {
  uploadPreview(previewId: string, dataUrl: string): void;
  uploadExport(exportId: string, name: string, mime: string, base64: string): void;
}

export class Engine {
  container!: HTMLElement;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  perspCam!: THREE.PerspectiveCamera;
  orthoCam!: THREE.OrthographicCamera;
  activeViewport: 'persp' | 'ortho' = 'persp';
  controls!: OrbitControls;
  transformControls!: TransformControls;

  helperGroup!: THREE.Group;
  grid!: THREE.GridHelper;
  axes!: THREE.AxesHelper;
  ground!: THREE.Mesh;

  objectMap = new Map<string, THREE.Object3D>();
  objectMaterials = new Map<string, string[]>();
  materialReg = new Map<string, { def: MaterialDef; mat: THREE.MeshPhysicalMaterial }>();
  textureReg = new Map<string, { def: TextureDef; tex: THREE.Texture }>();
  roots: THREE.Object3D[] = [];
  pickables: THREE.Mesh[] = [];

  selection = new Set<string>();
  selHelpers = new Map<string, THREE.BoxHelper>();
  edit: { objectId: string | null; faces: Set<number> } = { objectId: null, faces: new Set() };
  editOverlays: THREE.Object3D[] = [];

  anim: SceneAnim = { fps: 24, start: 0, end: 240, current: 0, playing: false, loop: true, tracks: [] };
  autoKey = false;
  env: EnvironmentDef = { ...DEFAULT_ENV };

  undoStack: string[] = [];
  redoStack: string[] = [];

  bridge: EngineBridge | null = null;

  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private syncDirty = false;
  private lastSync = 0;
  private fpsEma = 60;
  private clayMat: THREE.MeshStandardMaterial;
  private wireMat: THREE.MeshBasicMaterial;
  private resizeObs: ResizeObserver | null = null;
  private evalCtx: EvalContext;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private downPos = { x: 0, y: 0 };
  private moved = false;

  constructor() {
    this.clayMat = new THREE.MeshStandardMaterial({ color: 0xb8b2a7, roughness: 0.85, metalness: 0 });
    this.wireMat = new THREE.MeshBasicMaterial({ color: 0x8a8a8a, wireframe: true });
    this.evalCtx = {
      getObject: (id) => this.objectMap.get(id),
      lastTheta: new Map(),
      lastPivotAngle: new Map(),
    };
  }

  /* ---------------- lifecycle ---------------- */

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = null; // CSS gradient shows through

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = this.env.envIntensity;
    pmrem.dispose();

    // viewport cameras
    this.perspCam = new THREE.PerspectiveCamera(50, 1, 0.01, 500);
    this.perspCam.position.set(0.55, 0.5, 0.75);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 500);
    this.orthoCam.position.copy(this.perspCam.position);
    this.orthoCam.zoom = 1.4;

    // controls
    this.controls = new OrbitControls(this.perspCam, this.renderer.domElement);
    this.controls.target.set(0, 0.08, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.02;
    this.controls.maxDistance = 120;

    // helpers
    this.helperGroup = new THREE.Group();
    this.helperGroup.name = '__helpers';
    // desk-scale grid: 6m span, 25cm cells (objects like books are ~0.15m)
    this.grid = new THREE.GridHelper(6, 24, 0x8f887e, 0xc4beb3);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.5;
    this.grid.position.y = -0.0005;
    this.axes = new THREE.AxesHelper(0.5);
    this.axes.position.y = 0.001;
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.ShadowMaterial({ opacity: 0.25, color: 0x35302a }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.name = '__ground';
    this.helperGroup.add(this.grid, this.axes, this.ground);
    this.scene.add(this.helperGroup);

    // transform gizmo
    this.transformControls = new TransformControls(this.perspCam, this.renderer.domElement);
    this.transformControls.setSize(0.85);
    this.transformControls.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !(e as unknown as { value: boolean }).value;
      if (!(e as unknown as { value: boolean }).value && this.autoKey) {
        const obj = this.transformControls.object;
        const id = obj ? (obj.userData.acan as ACANUserData | undefined)?.id : undefined;
        if (id) this.autoKeyframe(id);
      }
    });
    this.transformControls.addEventListener('objectChange', () => {
      this.syncSoon();
    });
    const gizmo = this.transformControls.getHelper();
    gizmo.renderOrder = 999;
    this.scene.add(gizmo);

    // default lights (registered, editable)
    this.createDefaultLights();

    // pointer selection
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    // restore autosave
    try {
      const raw = localStorage.getItem('acan3d.autosave');
      if (raw) {
        const data = JSON.parse(raw) as Parameters<Engine['loadProjectData']>[0];
        if (data && Array.isArray(data.objects) && data.objects.length > 0) {
          this.loadProjectData(data);
          useEditor.getState().pushToast(true, 'Restored autosaved project');
        }
      }
    } catch {
      /* ignore */
    }

    this.syncStore(true);
    useEditor.getState().setReady(true);

    this.autosaveTimer = setInterval(() => {
      try {
        if (this.roots.length > 0) {
          localStorage.setItem('acan3d.autosave', JSON.stringify(this.getProjectData()));
        }
      } catch {
        /* quota */
      }
    }, 45_000);

    this.loop();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.autosaveTimer) clearInterval(this.autosaveTimer);
    try {
      if (this.roots.length > 0) localStorage.setItem('acan3d.autosave', JSON.stringify(this.getProjectData()));
    } catch {
      /* ignore */
    }
    const el = this.renderer?.domElement;
    if (el) {
      el.removeEventListener('pointerdown', this.onPointerDown);
      el.removeEventListener('pointermove', this.onPointerMove);
      el.removeEventListener('pointerup', this.onPointerUp);
    }
    this.resizeObs?.disconnect();
    this.transformControls?.dispose();
    this.controls?.dispose();
    clearEngineScene(this);
    this.renderer?.dispose();
    if (el && el.parentElement) el.parentElement.removeChild(el);
  }

  /* ---------------- registration ---------------- */

  register(obj: THREE.Object3D, meta: Omit<ACANUserData, 'id'>, id?: string, parentId?: string | null): string {
    const objectId = id ?? uid('obj');
    obj.userData.acan = { ...meta, id: objectId };
    this.objectMap.set(objectId, obj);
    if (parentId) {
      const parent = this.objectMap.get(parentId);
      if (parent) parent.add(obj);
      else {
        this.scene.add(obj);
        this.roots.push(obj);
      }
    } else {
      this.scene.add(obj);
      this.roots.push(obj);
    }
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) this.pickables.push(child as THREE.Mesh);
    });
    if ((obj as THREE.Mesh).isMesh && !this.pickables.includes(obj as THREE.Mesh)) {
      this.pickables.push(obj as THREE.Mesh);
    }
    this.rebuildPickables();
    return objectId;
  }

  rebuildPickables(): void {
    this.pickables = [];
    for (const [, obj] of this.objectMap) {
      if ((obj as THREE.Mesh).isMesh) {
        this.pickables.push(obj as THREE.Mesh);
      } else {
        obj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) this.pickables.push(child as THREE.Mesh);
        });
      }
    }
  }

  unregister(id: string, disposeGeom = true): void {
    const obj = this.objectMap.get(id);
    if (!obj) return;
    // recurse children registered
    for (const [childId, child] of Array.from(this.objectMap)) {
      if (childId !== id && this.isDescendant(child, obj)) this.unregister(childId, disposeGeom);
    }
    this.deselect([id], true);
    if (this.edit.objectId === id) this.setEditMode(null);
    const mats = this.objectMaterials.get(id);
    if (mats) this.objectMaterials.delete(id);
    obj.removeFromParent();
    this.roots = this.roots.filter((r) => r !== obj);
    if (disposeGeom) {
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
      });
    }
    this.objectMap.delete(id);
    this.selHelpers.get(id)?.parent?.remove(this.selHelpers.get(id)!);
    this.selHelpers.delete(id);
    this.anim.tracks = this.anim.tracks.filter((t) => t.objectId !== id);
    this.rebuildPickables();
  }

  private isDescendant(candidate: THREE.Object3D, ancestor: THREE.Object3D): boolean {
    let p: THREE.Object3D | null = candidate.parent;
    while (p) {
      if (p === ancestor) return true;
      p = p.parent;
    }
    return false;
  }

  /** true when `candidate` sits somewhere below `ancestor` in the hierarchy. */
  isDescendantForTest(candidate: THREE.Object3D, ancestor: THREE.Object3D): boolean {
    return this.isDescendant(candidate, ancestor);
  }

  /* ---------------- selection ---------------- */

  select(ids: string[], additive = false): void {
    if (!additive) this.deselect(Array.from(this.selection), true);
    for (const id of ids) {
      const obj = this.objectMap.get(id);
      if (!obj || this.selection.has(id)) continue;
      this.selection.add(id);
      const helper = new THREE.BoxHelper(obj, new THREE.Color(0xf59e0b));
      (helper.material as THREE.LineBasicMaterial).transparent = true;
      (helper.material as THREE.LineBasicMaterial).opacity = 0.9;
      helper.name = '__selHelper';
      this.scene.add(helper);
      this.selHelpers.set(id, helper);
    }
    if (ids.length > 0) {
      const first = this.objectMap.get(ids[ids.length - 1]);
      if (first) this.transformControls.attach(first);
    } else {
      this.transformControls.detach();
    }
    this.applyGizmoMode();
    this.syncStore(true);
  }

  deselect(ids: string[], quiet = false): void {
    for (const id of ids) {
      this.selection.delete(id);
      const h = this.selHelpers.get(id);
      if (h) {
        this.scene.remove(h);
        h.dispose();
        this.selHelpers.delete(id);
      }
    }
    if (this.selection.size === 0) this.transformControls.detach();
    if (!quiet) this.syncStore(true);
  }

  clearSelection(): void {
    this.deselect(Array.from(this.selection));
  }

  private onPointerDown = (e: PointerEvent) => {
    this.downPos = { x: e.clientX, y: e.clientY };
    this.moved = false;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.buttons > 0) {
      const dx = e.clientX - this.downPos.x;
      const dy = e.clientY - this.downPos.y;
      if (Math.hypot(dx, dy) > 6) this.moved = true;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.moved || this.transformControls.dragging) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const hit = this.pick(e.clientX, e.clientY);
    if (this.edit.objectId) {
      const obj = this.objectMap.get(this.edit.objectId);
      if (hit && hit.object === obj && hit.faceIndex !== undefined && hit.faceIndex !== null) {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        if (!additive) this.edit.faces.clear();
        const fi = hit.faceIndex;
        if (this.edit.faces.has(fi) && additive) this.edit.faces.delete(fi);
        else this.edit.faces.add(fi);
        this.rebuildEditOverlays();
        useEditor.getState().setEdit({ active: true, objectId: this.edit.objectId, faces: Array.from(this.edit.faces), vertices: [] });
      } else if (!e.shiftKey) {
        this.edit.faces.clear();
        this.rebuildEditOverlays();
        useEditor.getState().setEdit({ active: true, objectId: this.edit.objectId, faces: [], vertices: [] });
      }
      return;
    }
    if (hit) {
      let target: THREE.Object3D | null = hit.object;
      while (target && !this.objectMap.has((target.userData.acan as ACANUserData | undefined)?.id ?? '')) {
        target = target.parent === this.scene ? null : target.parent;
      }
      const id = target ? (target.userData.acan as ACANUserData | undefined)?.id : undefined;
      if (id) {
        if (this.selection.has(id) && (e.shiftKey || e.metaKey || e.ctrlKey)) {
          this.deselect([id]);
        } else {
          this.select([id], e.shiftKey || e.metaKey || e.ctrlKey);
        }
        return;
      }
    }
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) this.clearSelection();
  };

  pick(clientX: number, clientY: number): THREE.Intersection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.activeViewport === 'persp' ? this.perspCam : this.orthoCam);
    const locked = new Set<string>();
    for (const [id, obj] of this.objectMap) {
      if ((obj.userData.acan as ACANUserData | undefined)?.locked) locked.add(id);
    }
    const targets = this.pickables.filter((m) => {
      let p: THREE.Object3D | null = m;
      while (p) {
        const ud = p.userData?.acan as ACANUserData | undefined;
        if (ud?.id && locked.has(ud.id)) return false;
        if (p.visible === false) return false;
        p = p.parent;
      }
      return true;
    });
    const hits = ray.intersectObjects(targets, false);
    return hits[0] ?? null;
  }

  /* ---------------- edit mode ---------------- */

  setEditMode(objectId: string | null): void {
    this.clearEditOverlays();
    if (objectId && this.objectMap.has(objectId)) {
      this.edit = { objectId, faces: new Set() };
      this.buildEditOverlays();
      this.select([objectId]);
    } else {
      this.edit = { objectId: null, faces: new Set() };
    }
    useEditor.getState().setEdit({ active: !!this.edit.objectId, objectId: this.edit.objectId, faces: [], vertices: [] });
    this.syncStore(true);
  }

  setEditFaces(faces: number[]): void {
    if (!this.edit.objectId) return;
    this.edit.faces = new Set(faces);
    this.rebuildEditOverlays();
    useEditor.getState().setEdit({ active: true, objectId: this.edit.objectId, faces, vertices: [] });
  }

  private buildEditOverlays(): void {
    const obj = this.edit.objectId ? (this.objectMap.get(this.edit.objectId) as THREE.Mesh) : null;
    if (!obj || !obj.geometry) return;
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(obj.geometry),
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35, depthTest: true }),
    );
    wire.renderOrder = 5;
    wire.name = '__editWire';
    const pts = new THREE.Points(
      obj.geometry,
      new THREE.PointsMaterial({ color: 0xf59e0b, size: 0.004, sizeAttenuation: true, depthTest: false }),
    );
    pts.renderOrder = 6;
    pts.name = '__editPts';
    obj.add(wire, pts);
    this.editOverlays.push(wire, pts);
    this.rebuildEditOverlays();
  }

  private rebuildEditOverlays(): void {
    const obj = this.edit.objectId ? (this.objectMap.get(this.edit.objectId) as THREE.Mesh) : null;
    if (!obj || !obj.geometry || !obj.geometry.index) return;
    // remove old highlight
    const old = obj.getObjectByName('__editFaces');
    if (old) {
      obj.remove(old);
      (old as THREE.Mesh).geometry.dispose();
    }
    if (this.edit.faces.size === 0) return;
    const pos = obj.geometry.getAttribute('position') as THREE.BufferAttribute;
    const idx = obj.geometry.index;
    const arr = new Float32Array(this.edit.faces.size * 9);
    let i = 0;
    for (const f of this.edit.faces) {
      for (let k = 0; k < 3; k++) {
        const v = idx.getX(f * 3 + k);
        arr[i++] = pos.getX(v);
        arr[i++] = pos.getY(v);
        arr[i++] = pos.getZ(v);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const hi = new THREE.Mesh(
      geom,
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    hi.renderOrder = 7;
    hi.name = '__editFaces';
    obj.add(hi);
    this.editOverlays.push(hi);
  }

  private clearEditOverlays(): void {
    for (const o of this.editOverlays) {
      o.parent?.remove(o);
      const m = o as THREE.Mesh;
      if (m.geometry && m.name !== '__editPts') m.geometry.dispose?.();
      ((o as THREE.LineSegments).material as THREE.Material | undefined)?.dispose?.();
    }
    this.editOverlays = [];
  }

  /* ---------------- mesh ops (used by router) ---------------- */

  meshOpExtrude(id: string, faces: number[], distance: number, direction?: [number, number, number]): void {
    const mesh = this.objectMap.get(id) as THREE.Mesh;
    extrudeFaces(mesh.geometry, faces, distance, direction);
    this.syncStore(true);
  }

  meshOpInset(id: string, faces: number[], amount: number): void {
    const mesh = this.objectMap.get(id) as THREE.Mesh;
    insetFaces(mesh.geometry, faces, amount);
    this.syncStore(true);
  }

  meshOpSetVertices(id: string, positions: Record<number, [number, number, number]> | number[][]): number {
    const mesh = this.objectMap.get(id) as THREE.Mesh;
    const n = setVertexPositions(mesh.geometry, positions as Record<number, [number, number, number]>);
    this.syncStore(true);
    return n;
  }

  meshOpSubdivide(id: string, iterations: number): { vertices: number; faces: number } {
    const mesh = this.objectMap.get(id) as THREE.Mesh;
    const r = subdivideGeometry(mesh.geometry, iterations);
    this.syncStore(true);
    return r;
  }

  meshOpMerge(id: string, tolerance: number): number {
    const mesh = this.objectMap.get(id) as THREE.Mesh;
    const n = mergeVertices(mesh.geometry, tolerance);
    this.syncStore(true);
    return n;
  }

  meshOpDeleteFaces(id: string, faces: number[]): number {
    const mesh = this.objectMap.get(id) as THREE.Mesh;
    const n = deleteFaces(mesh.geometry, faces);
    if (this.edit.objectId === id) {
      this.edit.faces.clear();
      this.rebuildEditOverlays();
    }
    this.syncStore(true);
    return n;
  }

  meshOpFlip(id: string): void {
    const mesh = this.objectMap.get(id) as THREE.Mesh;
    flipNormals(mesh.geometry);
    this.syncStore(true);
  }

  /* ---------------- materials & textures ---------------- */

  createMaterial(def: Partial<MaterialDef> & { preset?: string; name?: string }): string {
    const id = uid('mat');
    const full = defaultMaterialDef(id, def.name ?? def.preset ?? 'Material', def.preset);
    const merged: MaterialDef = {
      ...full,
      ...('color' in def && def.color ? { color: def.color } : {}),
      ...('roughness' in def && def.roughness !== undefined ? { roughness: def.roughness } : {}),
      ...('metalness' in def && def.metalness !== undefined ? { metalness: def.metalness } : {}),
      ...('opacity' in def && def.opacity !== undefined ? { opacity: def.opacity } : {}),
      ...('emissive' in def && def.emissive ? { emissive: def.emissive } : {}),
      ...('transparent' in def && def.transparent !== undefined ? { transparent: def.transparent } : {}),
      ...('side' in def && def.side ? { side: def.side } : {}),
      preset: def.preset ?? full.preset,
      name: def.name ?? full.name,
    };
    const texMap = new Map<string, THREE.Texture>();
    for (const [tid, t] of this.textureReg) texMap.set(tid, t.tex);
    const mat = makeThreeMaterial(merged, texMap);
    this.materialReg.set(id, { def: merged, mat });
    return id;
  }

  updateMaterial(id: string, props: Partial<MaterialDef>): void {
    const reg = this.materialReg.get(id);
    if (!reg) throw new Error(`material not found: ${id}`);
    reg.def = { ...reg.def, ...props, id };
    const texMap = new Map<string, THREE.Texture>();
    for (const [tid, t] of this.textureReg) texMap.set(tid, t.tex);
    applyMaterialProps(reg.mat, reg.def, texMap);
    this.syncStore(true);
  }

  assignMaterial(objectId: string, materialId: string): void {
    const obj = this.objectMap.get(objectId);
    const reg = this.materialReg.get(materialId);
    if (!obj || !reg) throw new Error('object or material not found');
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && !(mesh.userData.pageMeta)) mesh.material = reg.mat;
    });
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && !obj.children.some((c) => (c as THREE.Mesh).isMesh)) mesh.material = reg.mat;
    const list = this.objectMaterials.get(objectId) ?? [];
    this.objectMaterials.set(objectId, list.includes(materialId) ? list : [...list, materialId]);
    this.syncStore(true);
  }

  setMaterialForSubtree(objectId: string, materialId: string): void {
    const obj = this.objectMap.get(objectId);
    const reg = this.materialReg.get(materialId);
    if (!obj || !reg) throw new Error('object or material not found');
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = reg.mat;
        const cid = (mesh.userData.acan as ACANUserData | undefined)?.id;
        if (cid) {
          const list = this.objectMaterials.get(cid) ?? [];
          this.objectMaterials.set(cid, list.includes(materialId) ? list : [...list, materialId]);
        }
      }
    });
    this.syncStore(true);
  }

  createProceduralTexture(procType: string, params?: Record<string, unknown>, name?: string): string {
    if (!PROC_TEXTURE_TYPES.includes(procType as (typeof PROC_TEXTURE_TYPES)[number])) {
      throw new Error(`unknown procedural texture type: ${procType}`);
    }
    const gen = generateProceduralTexture(procType, (params ?? {}) as never);
    const tex = makeCanvasTexture(gen.dataUrl);
    const id = uid('tex');
    const def: TextureDef = {
      id,
      name: name ?? gen.name,
      kind: 'procedural',
      procType,
      params: params ?? {},
      dataUrl: gen.dataUrl,
      repeat: [1, 1],
    };
    this.textureReg.set(id, { def, tex });
    return id;
  }

  createImageTexture(source: string, name?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const tex = new THREE.TextureLoader().load(
        source,
        () => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          const id = uid('tex');
          this.textureReg.set(id, {
            def: { id, name: name ?? 'Image texture', kind: 'image', dataUrl: source.startsWith('data:') ? source : undefined, repeat: [1, 1] },
            tex,
          });
          resolve(id);
        },
        undefined,
        () => reject(new Error('failed to load image')),
      );
    });
  }

  assignTexture(materialId: string, slot: MaterialSlot, textureId: string, repeat?: [number, number]): void {
    const reg = this.materialReg.get(materialId);
    const treg = this.textureReg.get(textureId);
    if (!reg || !treg) throw new Error('material or texture not found');
    const maps = { ...(reg.def.maps ?? {}), [slot]: textureId };
    this.updateMaterial(materialId, { maps, textureRepeat: repeat ?? reg.def.textureRepeat });
  }

  deleteTexture(textureId: string): void {
    const treg = this.textureReg.get(textureId);
    if (!treg) return;
    for (const [, m] of this.materialReg) {
      if (m.def.maps) {
        const maps = { ...m.def.maps };
        for (const slot of Object.keys(maps) as MaterialSlot[]) {
          if (maps[slot] === textureId) delete maps[slot];
        }
        m.def.maps = maps;
        const texMap = new Map<string, THREE.Texture>();
        for (const [tid, t] of this.textureReg) if (tid !== textureId) texMap.set(tid, t.tex);
        applyMaterialProps(m.mat, m.def, texMap);
      }
    }
    treg.tex.dispose();
    this.textureReg.delete(textureId);
    this.syncStore(true);
  }

  /* ---------------- lights / cameras ---------------- */

  createDefaultLights(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8d8577, 0.5);
    this.register(hemi, { type: 'light', name: 'Hemisphere Light', lightType: 'ambient' });
    const dir = new THREE.DirectionalLight(0xfff2e2, 2.4);
    dir.position.set(3.5, 6, 2.5);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 40;
    dir.shadow.camera.left = dir.shadow.camera.bottom = -8;
    dir.shadow.camera.right = dir.shadow.camera.top = 8;
    dir.shadow.bias = -0.0004;
    dir.shadow.normalBias = 0.015;
    this.register(dir, { type: 'light', name: 'Key Light', lightType: 'directional' });
  }

  refreshLightHelpers(): void {
    // light visibility + helpers are derived; ensure scene reflects changes
    for (const [id, obj] of this.objectMap) {
      const ud = obj.userData.acan as ACANUserData | undefined;
      if (ud?.type !== 'light') continue;
      obj.visible = obj.visible;
      void id;
    }
  }

  /* ---------------- shading / env ---------------- */

  setShading(mode: ShadingMode): void {
    for (const [id, obj] of this.objectMap) {
      void id;
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || mesh.name.startsWith('__')) return;
        if (mode === 'material') {
          const oid = (mesh.userData.acan as ACANUserData | undefined)?.id;
          const mid = oid ? this.objectMaterials.get(oid)?.[0] : undefined;
          const reg = mid ? this.materialReg.get(mid) : undefined;
          mesh.material = reg?.mat ?? this.clayMat;
        } else if (mode === 'solid') {
          mesh.material = this.clayMat;
        } else {
          mesh.material = this.wireMat;
        }
      });
    }
    useEditor.getState().setShading(mode);
  }

  setEnvironment(env: Partial<EnvironmentDef>): void {
    this.env = { ...this.env, ...env };
    this.scene.environmentIntensity = this.env.envIntensity;
    this.ground.visible = this.env.ground;
    if (this.env.background === 'color') {
      this.scene.background = new THREE.Color(this.env.backgroundColor);
      this.renderer.setClearColor(new THREE.Color(this.env.backgroundColor), 1);
    } else {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    }
    this.syncStore(true);
  }

  /* ---------------- cameras ---------------- */

  viewportCamera(): THREE.Camera {
    return this.activeViewport === 'persp' ? this.perspCam : this.orthoCam;
  }

  setViewportPreset(preset: string, fitObjectId?: string): void {
    const dist = 0.9;
    let target = new THREE.Vector3(0, 0.08, 0);
    if (fitObjectId) {
      const obj = this.objectMap.get(fitObjectId);
      if (obj) {
        const box = new THREE.Box3().setFromObject(obj);
        box.getCenter(target);
      }
    }
    const dirs: Record<string, [number, number, number]> = {
      iso: [0.55, 0.5, 0.75],
      front: [0, 0.12, 1],
      back: [0, 0.12, -1],
      left: [-1, 0.12, 0],
      right: [1, 0.12, 0],
      top: [0, 1, 0.0001],
      bottom: [0, -1, 0.0001],
    };
    const d = dirs[preset] ?? dirs.iso;
    const v = new THREE.Vector3(...d).normalize().multiplyScalar(dist).add(target);
    this.perspCam.position.copy(v);
    this.orthoCam.position.copy(v);
    this.controls.target.copy(target);
    this.controls.update();
  }

  toggleViewportOrtho(): void {
    this.activeViewport = this.activeViewport === 'persp' ? 'ortho' : 'persp';
    const target = this.controls.target;
    const active = this.viewportCamera() as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    active.position.copy(this.perspCam.position);
    active.lookAt(target);
    this.controls.object = active;
    this.transformControls.camera = active;
    // size ortho frustum to match current view distance
    if (this.activeViewport === 'ortho') {
      const dist = this.perspCam.position.distanceTo(target);
      const half = Math.max(0.02, dist * Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov / 2)));
      this.updateOrthoFrustum(half);
      this.orthoCam.zoom = 1;
    }
    this.orthoCam.updateProjectionMatrix();
    this.perspCam.updateProjectionMatrix();
    useEditor.getState().setViewportOrtho(this.activeViewport === 'ortho');
  }

  updateOrthoFrustum(halfHeight: number): void {
    const aspect = (this.container?.clientWidth || 1) / (this.container?.clientHeight || 1);
    this.orthoCam.left = -halfHeight * aspect;
    this.orthoCam.right = halfHeight * aspect;
    this.orthoCam.top = halfHeight;
    this.orthoCam.bottom = -halfHeight;
  }

  frameObject(objectId?: string): void {
    const ids = objectId ? [objectId] : Array.from(this.selection);
    const box = new THREE.Box3();
    if (ids.length === 0) {
      for (const r of this.roots) box.expandByObject(r);
    } else {
      for (const id of ids) {
        const obj = this.objectMap.get(id);
        if (obj) box.expandByObject(obj);
      }
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 0.3;
    const dir = this.perspCam.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.perspCam.position.copy(center.clone().add(dir.multiplyScalar(Math.max(size * 1.9, 0.15))));
    this.orthoCam.position.copy(this.perspCam.position);
    this.controls.update();
  }

  /* ---------------- gizmo ---------------- */

  applyGizmoMode(): void {
    const st = useEditor.getState();
    this.transformControls.setMode(st.gizmoMode);
    this.transformControls.setSpace(st.space);
    this.transformControls.setTranslationSnap(st.snap ? st.snapTranslate : null);
    this.transformControls.setRotationSnap(st.snap ? THREE.MathUtils.degToRad(st.snapRotateDeg) : null);
    this.transformControls.setScaleSnap(st.snap ? 0.1 : null);
  }

  setGizmoMode(mode: 'translate' | 'rotate' | 'scale', space?: 'world' | 'local'): void {
    useEditor.getState().setGizmoMode(mode);
    if (space) useEditor.getState().setSpace(space);
    this.applyGizmoMode();
  }

  private autoKeyframe(objectId: string): void {
    const obj = this.objectMap.get(objectId);
    if (!obj) return;
    const channel = useEditor.getState().gizmoMode === 'translate' ? 'position' : useEditor.getState().gizmoMode === 'rotate' ? 'rotation' : 'scale';
    const v: [number, number, number] =
      channel === 'position'
        ? [obj.position.x, obj.position.y, obj.position.z]
        : channel === 'rotation'
          ? [obj.rotation.x, obj.rotation.y, obj.rotation.z]
          : [obj.scale.x, obj.scale.y, obj.scale.z];
    this.setKeyframe(objectId, channel as 'position' | 'rotation' | 'scale', Math.round(this.anim.current), v);
    useEditor.getState().pushToast(true, `Auto-key: ${channel} @ frame ${Math.round(this.anim.current)}`);
  }

  /* ---------------- animation ---------------- */

  setKeyframe(objectId: string, channel: 'position' | 'rotation' | 'scale', frame: number, value: [number, number, number], easing?: Easing): string {
    let track = this.anim.tracks.find((t): t is Extract<AnimTrack, { type: 'transform' }> =>
      t.type === 'transform' && t.objectId === objectId && t.channel === channel);
    if (!track) {
      track = { id: uid('trk'), type: 'transform', objectId, channel, keys: [] };
      this.anim.tracks.push(track);
    }
    const existing = track.keys.find((k) => k.frame === frame);
    if (existing) {
      existing.value = value;
      if (easing) existing.easing = easing;
    } else {
      track.keys.push({ frame, value, easing });
      track.keys.sort((a, b) => a.frame - b.frame);
    }
    this.evaluateAt(this.anim.current, true);
    this.syncStore(true);
    return track.id;
  }

  evaluateAt(frame: number, force = false): void {
    this.anim.current = frame;
    evaluateTracks(this.anim, this.evalCtx, frame, force);
    for (const [, h] of this.selHelpers) h.update();
  }

  play(from?: number, to?: number): void {
    if (from !== undefined) this.anim.current = from;
    if (to !== undefined) this.anim.end = Math.max(this.anim.start + 1, to);
    this.anim.playing = true;
    this.syncStore(true);
  }

  pause(): void {
    this.anim.playing = false;
    this.syncStore(true);
  }

  stop(): void {
    this.anim.playing = false;
    this.evaluateAt(this.anim.start, true);
    this.syncStore(true);
  }

  clearAnimation(objectId?: string): void {
    this.anim.tracks = objectId ? this.anim.tracks.filter((t) => t.objectId !== objectId) : [];
    resetProceduralTracks(this.anim, this.evalCtx);
    this.evaluateAt(this.anim.current, true);
    this.syncStore(true);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.controls.update();
    if (this.anim.playing) {
      const next = this.anim.current + dt * this.anim.fps;
      if (next > this.anim.end) {
        if (this.anim.loop) this.evaluateAt(this.anim.start, true);
        else {
          this.evaluateAt(this.anim.end, true);
          this.anim.playing = false;
          this.syncStore(true);
        }
      } else {
        this.evaluateAt(next);
      }
      this.syncSoon();
    }
    this.renderer.render(this.scene, this.viewportCamera());
    this.fpsEma = this.fpsEma * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    if (this.syncDirty) {
      const now = performance.now();
      if (now - this.lastSync > 90) this.syncStore(true);
    }
  };

  /* ---------------- resize ---------------- */

  resize(): void {
    if (!this.container) return;
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.perspCam.aspect = w / h;
    this.perspCam.updateProjectionMatrix();
    const half = (this.orthoCam.top - this.orthoCam.bottom) / 2 || 0.45;
    this.updateOrthoFrustum(half);
    this.orthoCam.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /* ---------------- store sync ---------------- */

  syncSoon(): void {
    this.syncDirty = true;
  }

  syncStore(force = false): void {
    this.syncDirty = false;
    this.lastSync = performance.now();
    const st = useEditor.getState();

    const objects: ObjectInfo[] = [];
    const parentOf = new Map<string, string | null>();
    for (const [id, obj] of this.objectMap) {
      let p: THREE.Object3D | null = obj.parent;
      let parentId: string | null = null;
      while (p) {
        const pid = (p.userData.acan as ACANUserData | undefined)?.id;
        if (pid && this.objectMap.has(pid)) {
          parentId = pid;
          break;
        }
        p = p.parent;
      }
      parentOf.set(id, parentId);
    }
    for (const [id, obj] of this.objectMap) {
      const ud = obj.userData.acan as ACANUserData;
      const children: string[] = [];
      for (const [cid, cobj] of this.objectMap) {
        if (parentOf.get(cid) === id) children.push(cid);
      }
      const mesh = obj as THREE.Mesh;
      const isMesh = mesh.isMesh;
      let meshInfo: ObjectInfo['mesh'] | undefined;
      if (isMesh && mesh.geometry) {
        meshInfo = {
          vertices: mesh.geometry.getAttribute('position')?.count ?? 0,
          faces: mesh.geometry.index ? mesh.geometry.index.count / 3 : 0,
        };
      }
      const light = obj as THREE.DirectionalLight;
      objects.push({
        id,
        name: ud.name,
        type: ud.type,
        kind: ud.kind,
        parentId: parentOf.get(id) ?? null,
        childIds: children,
        visible: obj.visible,
        locked: ud.locked,
        editable: ud.editable && !ud.pageMeta,
        pageMeta: ud.pageMeta,
        lightType: ud.lightType ?? (ud.type === 'light' ? (light.intensity !== undefined ? undefined : undefined) : undefined),
        cameraType: ud.cameraType,
        materialIds: this.objectMaterials.get(id) ?? [],
        transform: {
          position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
          rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
          scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
        },
        mesh: meshInfo,
      });
    }

    const triangles = this.renderer.info.render.triangles;
    st.setObjects(objects);
    st.setSelection(Array.from(this.selection));
    st.setMaterials(Array.from(this.materialReg.values()).map((m) => m.def));
    st.setTextures(Array.from(this.textureReg.values()).map((t) => t.def));
    st.setAnim({ ...this.anim, tracks: [...this.anim.tracks] });
    st.setStats({
      fps: this.fpsEma,
      triangles,
      objects: this.objectMap.size,
    });
    st.setHistory(this.undoStack.length > 0, this.redoStack.length > 0);
    if (!st.ready) st.setReady(true);
    void nextSeq;
  }

  /* ---------------- undo / redo ---------------- */

  pushUndo(): void {
    try {
      this.undoStack.push(JSON.stringify(this.getProjectData()));
      if (this.undoStack.length > 25) this.undoStack.shift();
      this.redoStack = [];
    } catch {
      /* ignore */
    }
  }

  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    try {
      this.redoStack.push(JSON.stringify(this.getProjectData()));
      this.loadProjectData(JSON.parse(snap));
      useEditor.getState().pushToast(true, 'Undo');
      return true;
    } catch {
      return false;
    }
  }

  redo(): boolean {
    const snap = this.redoStack.pop();
    if (!snap) return false;
    try {
      this.undoStack.push(JSON.stringify(this.getProjectData()));
      this.loadProjectData(JSON.parse(snap));
      useEditor.getState().pushToast(true, 'Redo');
      return true;
    } catch {
      return false;
    }
  }

  /* ---------------- project ---------------- */

  getProjectData(name = 'Untitled') {
    return serializeProject(this, name);
  }

  loadProjectData(data: Parameters<typeof deserializeProject>[1]): void {
    deserializeProject(this, data);
    this.applyShadingFromStore();
    this.syncStore(true);
  }

  private applyShadingFromStore(): void {
    this.setShading(useEditor.getState().shading);
  }

  newProject(): void {
    clearEngineScene(this);
    this.anim = { fps: 24, start: 0, end: 240, current: 0, playing: false, loop: true, tracks: [] };
    this.evalCtx.lastTheta.clear();
    this.evalCtx.lastPivotAngle.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.setEnvironment({ ...DEFAULT_ENV });
    try {
      localStorage.removeItem('acan3d.autosave');
    } catch {
      /* ignore */
    }
    this.syncStore(true);
  }

  /* ---------------- preview ---------------- */

  renderPreview(opts: {
    width?: number;
    height?: number;
    cameraId?: string | null;
    transparent?: boolean;
    shading?: ShadingMode;
    frame?: number;
    includeHelpers?: boolean;
  } = {}): { dataUrl: string; width: number; height: number } {
    const width = Math.max(64, Math.min(2048, Math.round(opts.width ?? 1024)));
    const height = Math.max(64, Math.min(2048, Math.round(opts.height ?? 1024)));
    if (opts.frame !== undefined) this.evaluateAt(opts.frame, true);

    const prevShading = useEditor.getState().shading;
    const tempShading = opts.shading;
    if (tempShading && tempShading !== prevShading) this.setShading(tempShading);

    const helpersVisible = this.helperGroup.visible;
    const gizmoHelper = this.transformControls.getHelper();
    const gizmoVisible = gizmoHelper.visible;
    const selHelpersVisible = Array.from(this.selHelpers.values()).map((h) => h.visible);
    if (!opts.includeHelpers) {
      this.helperGroup.visible = false;
      gizmoHelper.visible = false;
      for (const [, h] of this.selHelpers) h.visible = false;
      for (const o of this.editOverlays) o.visible = false;
    }

    let camera: THREE.Camera = this.viewportCamera();
    if (opts.cameraId) {
      const camObj = this.objectMap.get(opts.cameraId) as THREE.PerspectiveCamera | undefined;
      if (camObj && (camObj as THREE.Camera).isCamera) {
        camera = camObj as THREE.Camera;
        if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
          (camera as THREE.PerspectiveCamera).aspect = width / height;
          (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
        }
        camObj.updateMatrixWorld(true);
      }
    }

    const prevPr = this.renderer.getPixelRatio();
    const prevSize = new THREE.Vector2();
    this.renderer.getSize(prevSize);
    const prevAlpha = this.renderer.domElement.style.backgroundColor;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    if (opts.transparent) this.renderer.setClearColor(0x000000, 0);

    this.renderer.render(this.scene, camera);
    const dataUrl = this.renderer.domElement.toDataURL('image/png');

    this.renderer.setPixelRatio(prevPr);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    if (opts.transparent) this.renderer.setClearColor(0x000000, prevAlpha ? 1 : 0);
    this.helperGroup.visible = helpersVisible;
    gizmoHelper.visible = gizmoVisible;
    let i = 0;
    for (const [, h] of this.selHelpers) h.visible = selHelpersVisible[i++] ?? true;
    for (const o of this.editOverlays) o.visible = true;
    if (tempShading && tempShading !== prevShading) this.setShading(prevShading);

    return { dataUrl, width, height };
  }

  /* ---------------- misc helpers used by router ---------------- */

  setTransform(id: string, t: Partial<Transform>): void {
    const obj = this.objectMap.get(id);
    if (!obj) throw new Error(`object not found: ${id}`);
    if (t.position) obj.position.set(t.position.x, t.position.y, t.position.z);
    if (t.rotation) obj.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
    if (t.scale) obj.scale.set(t.scale.x || 1e-6, t.scale.y || 1e-6, t.scale.z || 1e-6);
    obj.updateMatrixWorld(true);
    for (const [, h] of this.selHelpers) h.update();
    this.syncStore(true);
  }

  nextName(base: string): string {
    const names = new Set<string>();
    for (const [, o] of this.objectMap) names.add((o.userData.acan as ACANUserData).name);
    if (!names.has(base)) return base;
    let i = 1;
    while (names.has(`${base} ${String(i).padStart(3, '0')}`)) i++;
    return `${base} ${String(i).padStart(3, '0')}`;
  }

  objectInfo(id: string): ObjectInfo | null {
    this.syncStore(false);
    return useEditor.getState().objects.find((o) => o.id === id) ?? null;
  }

  exportSceneAsync(format: 'gltf' | 'glb' | 'obj'): Promise<{ base64: string; mime: string; name: string }> {
    return exportScene(this, format);
  }

  materialPresetKeys(): string[] {
    return Object.keys(MATERIAL_PRESETS);
  }
}

/* singleton management lives in engineAPI.ts */
