'use client';

/**
 * ACAN3D — Editor UI store (zustand).
 * Holds a UI-mirror of engine state. The engine pushes updates into this
 * store; the UI never mutates three.js directly — it calls `runCommand`
 * which routes through the same CommandRouter the external agent uses.
 */

import { create } from 'zustand';
import type {
  AnimTrack,
  EngineStats,
  MaterialDef,
  ObjectInfo,
  SceneAnim,
  ShadingMode,
  TextureDef,
  CommandResult,
} from './types';

export type GizmoMode = 'translate' | 'rotate' | 'scale';
export type AgentLinkState = 'offline' | 'connecting' | 'online';

export interface ToastMsg {
  id: number;
  ok: boolean;
  text: string;
}

export interface EditModeState {
  active: boolean;
  objectId: string | null;
  /** indices of selected faces (triangles) */
  faces: number[];
  vertices: number[];
}

export interface EditorState {
  /** engine finished mounting */
  ready: boolean;
  objects: ObjectInfo[];
  selection: string[];
  activeCameraId: string | null; // null = default viewport camera
  viewportOrtho: boolean;

  gizmoMode: GizmoMode;
  space: 'world' | 'local';
  snap: boolean;
  snapTranslate: number; // meters
  snapRotateDeg: number;

  shading: ShadingMode;
  showGrid: boolean;
  showAxes: boolean;

  anim: SceneAnim;
  autoKey: boolean;

  materials: MaterialDef[];
  textures: TextureDef[];

  stats: EngineStats;
  agent: AgentLinkState;
  edit: EditModeState;

  canUndo: boolean;
  canRedo: boolean;

  toasts: ToastMsg[];

  /* ---- internal setters (engine pushes) ---- */
  setReady: (v: boolean) => void;
  setObjects: (objects: ObjectInfo[]) => void;
  setSelection: (ids: string[]) => void;
  setActiveCameraId: (id: string | null) => void;
  setViewportOrtho: (v: boolean) => void;
  setGizmoMode: (m: GizmoMode) => void;
  setSpace: (s: 'world' | 'local') => void;
  setSnap: (v: boolean) => void;
  setSnapTranslate: (v: number) => void;
  setSnapRotate: (v: number) => void;
  setShading: (s: ShadingMode) => void;
  setShowGrid: (v: boolean) => void;
  setShowAxes: (v: boolean) => void;
  setAnim: (a: SceneAnim) => void;
  setAutoKey: (v: boolean) => void;
  setMaterials: (m: MaterialDef[]) => void;
  setTextures: (t: TextureDef[]) => void;
  setStats: (s: EngineStats) => void;
  setAgent: (s: AgentLinkState) => void;
  setEdit: (e: EditModeState) => void;
  setHistory: (canUndo: boolean, canRedo: boolean) => void;
  pushToast: (ok: boolean, text: string) => void;
  dropToast: (id: number) => void;
  reset: () => void;
}

const defaultAnim: SceneAnim = {
  fps: 24,
  start: 0,
  end: 240,
  current: 0,
  playing: false,
  loop: true,
  tracks: [],
};

const initial = {
  ready: false,
  objects: [] as ObjectInfo[],
  selection: [] as string[],
  activeCameraId: null as string | null,
  viewportOrtho: false,
  gizmoMode: 'translate' as GizmoMode,
  space: 'world' as const,
  snap: false,
  snapTranslate: 0.25,
  snapRotateDeg: 15,
  shading: 'material' as ShadingMode,
  showGrid: true,
  showAxes: true,
  anim: defaultAnim,
  autoKey: false,
  materials: [] as MaterialDef[],
  textures: [] as TextureDef[],
  stats: { fps: 0, triangles: 0, objects: 0 } as EngineStats,
  agent: 'connecting' as AgentLinkState,
  edit: { active: false, objectId: null, faces: [], vertices: [] } as EditModeState,
  canUndo: false,
  canRedo: false,
  toasts: [] as ToastMsg[],
};

let toastSeq = 1;

export const useEditor = create<EditorState>((set) => ({
  ...initial,
  setReady: (v) => set({ ready: v }),
  setObjects: (objects) => set({ objects }),
  setSelection: (selection) => set({ selection }),
  setActiveCameraId: (activeCameraId) => set({ activeCameraId }),
  setViewportOrtho: (viewportOrtho) => set({ viewportOrtho }),
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  setSpace: (space) => set({ space }),
  setSnap: (snap) => set({ snap }),
  setSnapTranslate: (snapTranslate) => set({ snapTranslate }),
  setSnapRotate: (snapRotateDeg) => set({ snapRotateDeg }),
  setShading: (shading) => set({ shading }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setShowAxes: (showAxes) => set({ showAxes }),
  setAnim: (anim) => set({ anim }),
  setAutoKey: (autoKey) => set({ autoKey }),
  setMaterials: (materials) => set({ materials }),
  setTextures: (textures) => set({ textures }),
  setStats: (stats) => set({ stats }),
  setAgent: (agent) => set({ agent }),
  setEdit: (edit) => set({ edit }),
  setHistory: (canUndo, canRedo) => set({ canUndo, canRedo }),
  pushToast: (ok, text) =>
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id: toastSeq++, ok, text }] })),
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  reset: () => set({ ...initial, ready: true }),
}));

/** Convenience: run an agent command (same path the external agent uses). */
export async function runCommand(
  command: string,
  params?: Record<string, unknown>,
): Promise<CommandResult> {
  if (typeof window === 'undefined') return { ok: false, error: 'client only' };
  const mod = await import('./engineAPI');
  return mod.engineAPI.execute(command, params ?? {});
}
