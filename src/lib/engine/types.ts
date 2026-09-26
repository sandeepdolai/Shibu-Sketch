/**
 * ACAN3D — Core type contracts.
 * This file is the single source of truth shared by the engine, the UI,
 * the CommandRouter and the external agent API.
 */

export const APP_NAME = 'ACAN3D';
export const APP_VERSION = '0.1.0';
export const PROJECT_FORMAT_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Objects                                                             */
/* ------------------------------------------------------------------ */

export type ObjType = 'mesh' | 'group' | 'light' | 'camera';

export type LightType = 'ambient' | 'hemisphere' | 'directional' | 'point' | 'spot';

export type PrimitiveKind =
  | 'box'
  | 'roundedBox'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'plane'
  | 'capsule'
  | 'tetrahedron'
  | 'octahedron'
  | 'custom';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vec3;
  /** Euler angles in radians */
  rotation: Vec3;
  scale: Vec3;
}

/** Page metadata for book/paper systems (pages are meshes with segments for bending). */
export interface PageMeta {
  role: 'page';
  bookId?: string;
  index: number;
  width: number;
  height: number;
  thickness: number;
  /** spine is at local x = 0, page extends to +X */
  spineAt: 'x0';
}

export interface ACANUserData {
  id: string;
  type: ObjType;
  name: string;
  kind?: PrimitiveKind | string;
  generator?: string;
  locked?: boolean;
  /** mesh with editable geometry (vertex/face ops allowed) */
  editable?: boolean;
  pageMeta?: PageMeta;
  lightType?: LightType;
  cameraType?: 'perspective' | 'orthographic';
}

/** Lightweight info mirrored into the UI store for one object. */
export interface ObjectInfo {
  id: string;
  name: string;
  type: ObjType;
  kind?: string;
  parentId: string | null;
  childIds: string[];
  visible: boolean;
  locked?: boolean;
  editable?: boolean;
  pageMeta?: PageMeta;
  lightType?: LightType;
  cameraType?: string;
  materialIds: string[];
  transform: Transform;
  mesh?: { vertices: number; faces: number };
}

/* ------------------------------------------------------------------ */
/* Materials & textures                                                */
/* ------------------------------------------------------------------ */

export type MaterialSlot = 'map' | 'normalMap' | 'roughnessMap';

export interface MaterialDef {
  id: string;
  name: string;
  preset?: string;
  color: string; // '#rrggbb'
  roughness: number; // 0..1
  metalness: number; // 0..1
  opacity: number; // 0..1
  emissive: string; // '#rrggbb'
  emissiveIntensity: number;
  transparent: boolean;
  side: 'front' | 'back' | 'double';
  maps?: Partial<Record<MaterialSlot, string>>; // texture ids
  textureRepeat?: [number, number];
}

export interface TextureDef {
  id: string;
  name: string;
  kind: 'procedural' | 'image';
  procType?: string;
  params?: Record<string, unknown>;
  /** PNG data URL of the texture (generated or loaded). */
  dataUrl?: string;
  repeat: [number, number];
}

/* ------------------------------------------------------------------ */
/* Animation                                                           */
/* ------------------------------------------------------------------ */

export type Channel = 'position' | 'rotation' | 'scale';

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step';

export interface Keyframe {
  frame: number;
  value: [number, number, number];
  easing?: Easing;
}

export interface TransformTrack {
  id: string;
  type: 'transform';
  objectId: string;
  channel: Channel;
  keys: Keyframe[];
}

/**
 * Procedural page-turn track. Drives geometry deformation of a page mesh
 * (built by the book/page generators with enough spine-axis segments).
 */
export interface PageTurnTrack {
  id: string;
  type: 'pageTurn';
  objectId: string;
  startFrame: number;
  endFrame: number;
  /** 1 = right-to-left (0 -> PI), -1 = left-to-right (PI -> 0) */
  direction: 1 | -1;
  /** 0..1.5 — how much the paper curls mid-turn */
  curvature: number;
  easing: Easing;
}

/** Rotates the two cover pivots of a generated book around the spine. */
export interface BookOpenTrack {
  id: string;
  type: 'bookOpen';
  objectId: string; // book group id
  startFrame: number;
  endFrame: number;
  /** radians, 0 (closed) .. PI (fully open) */
  openAngle: number;
  easing: Easing;
}

export type AnimTrack = TransformTrack | PageTurnTrack | BookOpenTrack;

export interface SceneAnim {
  fps: number;
  start: number;
  end: number;
  current: number;
  playing: boolean;
  loop: boolean;
  tracks: AnimTrack[];
}

/* ------------------------------------------------------------------ */
/* Scene / project                                                     */
/* ------------------------------------------------------------------ */

export type ShadingMode = 'solid' | 'material' | 'wireframe';

export interface EnvironmentDef {
  background: 'gradient' | 'color' | 'studio';
  backgroundColor: string;
  ground: boolean;
  groundColor: string;
  envIntensity: number;
}

export interface ProjectData {
  app: typeof APP_NAME;
  formatVersion: number;
  meta: { name: string; savedAt?: string };
  objects: SerializedObject[];
  materials: MaterialDef[];
  textures: TextureDef[];
  animation: { fps: number; start: number; end: number; loop: boolean; tracks: AnimTrack[] };
  environment: EnvironmentDef;
}

export interface SerializedObject {
  id: string;
  name: string;
  type: ObjType;
  kind?: string;
  parentId: string | null;
  transform: Transform;
  visible: boolean;
  locked?: boolean;
  userData: Partial<ACANUserData>;
  /** mesh payload */
  geometry?: {
    kind: 'primitive';
    primitive: PrimitiveKind;
    params: Record<string, number | boolean>;
  } | {
    kind: 'buffer';
    vertices: number[]; // flat xyz
    indices: number[]; // flat triangle indices
    uvs?: number[]; // flat uv
  };
  materialIds?: string[];
  /** light payload */
  light?: {
    lightType: LightType;
    color: string;
    intensity: number;
    castShadow: boolean;
    distance?: number;
    angle?: number;
    penumbra?: number;
  };
  /** camera payload */
  camera?: {
    cameraType: 'perspective' | 'orthographic';
    fov: number;
    zoom: number;
  };
}

/* ------------------------------------------------------------------ */
/* Agent command layer                                                 */
/* ------------------------------------------------------------------ */

export type CommandResult<R = unknown> =
  | { ok: true; result: R }
  | { ok: false; error: string; code?: 'VALIDATION' | 'NOT_FOUND' | 'NOT_IMPLEMENTED' | 'EXEC_ERROR' | 'NO_CLIENT' | 'TIMEOUT' };

export interface AgentCommand {
  command: string;
  params?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Editor stats                                                        */
/* ------------------------------------------------------------------ */

export interface EngineStats {
  fps: number;
  triangles: number;
  objects: number;
}
