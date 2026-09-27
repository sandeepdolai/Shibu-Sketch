/**
 * Shibu-Sketch — three.js scene engine.
 *
 * Owns the renderer, cameras, lights, the shelf of journals, and every 3D
 * animation: shelf browsing (drag/swipe + sway), the journal-select lift,
 * the blossom→lay-flat OPEN transition, page flips with real paper curl,
 * the closing transition, tap/click picking, tilt parallax and scrubbing.
 *
 * React (SketchApp) drives it through a small imperative API and receives
 * intents via callbacks. The engine never touches React state directly.
 */
import * as THREE from 'three';
import {
  JOURNAL_H,
  JOURNAL_W,
  COVER_T,
  SHEET_T,
  SHEET_GAP,
  SHEET_PITCH,
  SHEET_W,
  PAGE_INSET_S,
  PILE_LIFT,
  buildJournal,
  journalDims,
  applyPageTexture,
  type JournalObject,
  type PageTextureProvider,
} from './journalObject';
import { bendSheet } from './sheetGeom';
import { getShadowBlobTexture, getGutterShadowTexture, makeCoverTexture } from './art';
import { renderPageContentToCanvas } from '@/lib/sketch/render';
import type { JournalDTO, JournalDetailDTO, PageContent } from '@/lib/sketch/types';
import { parsePageContent } from '@/lib/sketch/types';
import { playFlip, playTap } from './sfx';

const HALF_PI = Math.PI / 2;
const SHELF_SPACING = 0.98;
const SHELF_BASE_Y = JOURNAL_H / 2 + 0.02;
/* The reference shelf is a FLAT presentation: a long lens looking straight on
 * so the row of journals reads like the app — books fill ~84% of the frame
 * height, edge books crop off-screen, no studio floor. */
const SHELF_FOV = 24;
/** look-at height: above the book row centre so books sit LOW in frame with
 *  the app's rhythm — ~24% top margin, ~2% bottom margin */
const SHELF_LOOK_Y = JOURNAL_H / 2 + 0.02 + 0.22;
const SELECT_LIFT = 0.17;
/** the selected journal swells above the row like the reference's lifted book */
const SELECT_SCALE = 1.12;
/** height the dragged book hovers at during shelf/grid drag-to-reorder —
 *  pointer raycasts use this plane so the book tracks the cursor exactly */
const REORDER_LIFT_Y = 0.32;
/** The open journal floats UPRIGHT at eye level — the reference never lays
 *  the book onto a table; the spread faces the camera against the navy wall
 *  with a gentle pivot-fan of pages trailing behind both sides. */
const OPEN_CENTER_Y = 1.05;
/** choreography timings matched to the reference recording:
 *  rise+edge-on beat ≈ 0.3s → accordion bloom ≈ 0.2s → riffle gather +
 *  face-in ≈ 0.35s → settle */
const OPEN_DUR = 1.02;
const CLOSE_DUR = 0.82;
/** QA hook: `?slowmo=4` stretches open/close/flip choreography 4× for
 *  frame-by-frame verification against the reference videos. */
const SLOWMO = (() => {
  try {
    const v = parseFloat(new URLSearchParams(window.location.search).get('slowmo') ?? '0');
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch {
    return 1;
  }
})();
const OPEN_DUR_EFF = OPEN_DUR * SLOWMO;
const CLOSE_DUR_EFF = CLOSE_DUR * SLOWMO;
const FLIP_DUR = 0.45;
const SELECT_DUR = 0.45;

/* Chained-hinge reading fan (matched to the reference screenshots/frames):
 * fan page 1 tilts ~59° back from the spread plane, each deeper page hinges
 * at the previous page's outer edge and steepens by FAN_DA, capping near
 * edge-on. Only the first FAN_VISIBLE pages read as distinct slivers; the
 * rest tuck into a dense parallel deck behind the last sliver.
 * GLITCH-FREE BY CONSTRUCTION: every hinge step reserves the rotated slab's
 * full projected extent (W·cosα + t·sinα + bevel bulge) plus an air gap, so
 * consecutive slabs occupy DISJOINT x-ranges — pages can never slice under
 * one another regardless of their y/depth. The tail deck offsets along the
 * last sliver's normal (radial separation), also intersection-free. */
const FAN_A1 = 1.19;
const FAN_DA = 0.105;
const FAN_AMAX = 1.553;
/** air gap between chained fan slabs (also covers the bevel bulge) */
const FAN_GAP = 0.0036;
/** how far fan page 1's hinge tucks under the spread's fore-edge */
const FAN_TUCK = 0.02;
const FAN_VISIBLE = 7;
/** cheat scale on the chain's depth recession so the long-lens reading
 *  camera keeps the fan slivers tall like the reference */
const FAN_RECEDE = 0.55;

/* The wall/floor gradient is drawn by CSS BEHIND the transparent canvas
 * (see SketchApp) — sampled from the reference: shelf #7c7791→#5b5e8f,
 * reading room flat navy #3d4463. */

const easeInOut = (t: number): number => t * t * (3 - 2 * t);
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Deterministic spine-wrap color for a cover: dark covers usually wear a
 *  cream spine (see the reference's lifted journal), light covers a band a
 *  few steps deeper than the cover; speckled/gradient styles keep the cover
 *  tone. Seeded so the shelf always renders identically. */
function spineColorFor(style: { kind: string; color: string; seed: number }): string {
  const c = style.color.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) || 0;
  const g = parseInt(c.slice(2, 4), 16) || 0;
  const b = parseInt(c.slice(4, 6), 16) || 0;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const pick = style.seed % 3;
  if (lum < 0.42) {
    // dark cover: cream spine 2/3 of the time, otherwise near-black
    return pick === 0 ? '#3a3a42' : '#f2eee3';
  }
  // light cover: deepen the cover color
  const f = pick === 0 ? 0.52 : pick === 1 ? 0.66 : 0.8;
  const to = (v: number): string => Math.round(Math.min(255, v * f)).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export interface SketchEngineCallbacks {
  /** tapped the already-selected journal -> app opens it */
  onJournalTap(id: string): void;
  /** tapped a non-selected journal -> app updates selection */
  onJournalSelect(id: string): void;
  onOpenComplete(): void;
  onCloseComplete(): void;
  /** spread changed (after flip/scrub); spread is 0-based */
  onSpreadChange(spread: number): void;
  /** double-click / center tap on a page in open view -> edit request */
  onEditPage(pageIndex: number): void;
  /** shelf <-> 3D grid overview mode toggled */
  onGridChange?(active: boolean): void;
  /** shelf long-press drag-to-reorder committed (persist via API) */
  onReorder?(id: string, toIndex: number): void;
  /** fullscreen page zoom started / fully exited */
  onZoomChange?(active: boolean): void;
  /** the camera finished zooming INTO the page (editor may open) */
  onZoomDone?(pageIndex: number): void;
}

interface ShelfEntry {
  dto: JournalDTO;
  obj: JournalObject;
  coverMat: THREE.MeshPhysicalMaterial;
  spineMat: THREE.MeshPhysicalMaterial;
  coverArtMat: THREE.MeshPhysicalMaterial;
  blob: THREE.Mesh;
}

type Mode = 'shelf' | 'grid' | 'opening' | 'open' | 'closing';

interface FlipState {
  active: boolean;
  dir: 1 | -1;
  from: number; // spread we flip from
  start: number; // seconds
}

interface SpreadTween {
  active: boolean;
  from: number;
  to: number;
  start: number; // seconds
}

interface PageZoomState {
  active: boolean;
  out: boolean; // zooming back out to the reading pose
  delivered: boolean; // onZoomDone fired
  pageIndex: number;
  side: 1 | -1;
  start: number; // seconds
  zStart: { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
  target: { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
}

interface ReorderState {
  active: boolean;
  id: string;
  startIndex: number;
  currentIndex: number;
  grabX: number; // pointer x at press (screen px on the shelf, world x in grid)
  bookX: number; // book x at press (world)
  moved: boolean;
  /** Escape-cancelled: the book glides back to its slot, then the state clears */
  returning: boolean;
  /** grid-mode 2D drag on the table plane */
  grid: boolean;
  grabZ: number;
  bookZ: number;
  /** grid: book slot (world x/z) when the drag armed — the pointer offset
   *  is applied to THIS, otherwise the displacement compounds every event */
  startBookX: number;
  startBookZ: number;
}

export class SketchEngine {
  private container: HTMLElement;
  private cb: SketchEngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private journals = new Map<string, ShelfEntry>();
  private order: string[] = [];

  private mode: Mode = 'shelf';
  private selectedId: string | null = null;
  private openEntry: ShelfEntry | null = null;
  private pageCount = 0;
  private spread = 0;
  private transitionStart = 0;
  /** neighbor slide-away start poses, captured at openJournal/closeJournal so
   *  the interpolation always converges no matter how far the shelf was scrolled */
  private slideStart = new Map<string, { x: number; y: number; blob: number }>();
  private flip: FlipState = { active: false, dir: 1, from: 0, start: 0 };
  /** per-sheet glide poses while a page flies (fan re-chaining animation) */
  private flipSheetFrom: Array<{ x: number; y: number; rz: number } | null> = [];
  private flipSheetTo: Array<{ x: number; y: number; rz: number } | null> = [];
  private spreadTween: SpreadTween = { active: false, from: 0, to: 0, start: 0 };
  private pageZoom: PageZoomState | null = null;
  private reorder: ReorderState | null = null;
  private reorderTimer: number | null = null;
  /** open-mode horizontal drag (swipe-to-flip) */
  private openDragX = 0;
  private openDragActive = false;
  private static readonly TWEEN_DUR = 0.34;
  /** pose captured at openJournal: stand rotation + root height we transition from */
  private openStartStand = HALF_PI;
  private openStartRootY = 0;
  private openStartYaw = 0;
  private openStartRoll = 0;
  private openStartScale = 1;
  /** camera pose captured at openJournal (shelf pose) for absolute lerps */
  private openCamStart = { pos: new THREE.Vector3(0, SHELF_LOOK_Y, 5.0), look: new THREE.Vector3(0, SHELF_LOOK_Y, 0), fov: SHELF_FOV };

  /* environment: the CSS layers behind the transparent canvas carry the
   * shelf gradient <-> navy room crossfade */

  /* shelf scroll */
  private scroll = 0; // float index
  private scrollTarget = 0;
  private dragging = false;
  private dragStartX = 0;
  private dragLastX = 0;
  private dragLastY = 0;
  private dragMoved = 0;
  private dragVelocity = 0;

  /* grid (table-top overview) scroll */
  private gridScroll = 0;
  private gridScrollTarget = 0;

  /* tilt parallax */
  private tiltX = 0;
  private tiltY = 0;
  private tiltTargetX = 0;
  private tiltTargetY = 0;
  private tiltEnabled = true;

  /* page textures */
  private pageTexCache = new Map<string, THREE.CanvasTexture>();
  private pagesData: Array<{ id: string; content: PageContent }> = [];
  private paperColor = '#faf8f4';

  /* light */
  private sun: THREE.DirectionalLight;
  private floorMat: THREE.ShadowMaterial;

  /* transient cam */
  private camPos = new THREE.Vector3(0, SHELF_LOOK_Y, 5.0);
  private camLook = new THREE.Vector3(0, SHELF_LOOK_Y, 0);
  private camFov = SHELF_FOV;

  private pointerDownInfo: { x: number; y: number; t: number; id: string } | null = null;

  /** Screen position (CSS px) of the selected journal's cover top-right corner.
   *  Updated every frame in shelf mode; null otherwise. */
  screenAnchor: { x: number; y: number } | null = null;
  private lastTapTime = 0;
  private lastTapTarget: string | null = null;

  private textures: PageTextureProvider;

  constructor(container: HTMLElement, cb: SketchEngineCallbacks) {
    this.container = container;
    this.cb = cb;
    // debug/QA hook (headless tests read live engine state through it)
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__shibuEngine = this;
    }

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'pan-y';

    this.scene = new THREE.Scene();
    // transparent clear — the CSS gradient behind the canvas is the backdrop
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(SHELF_FOV, 1, 0.05, 60);
    this.camera.position.copy(this.camPos);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x77748f, 1.0);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.05);
    this.sun.position.set(-2.4, 4.2, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -4;
    this.sun.shadow.camera.right = 4;
    this.sun.shadow.camera.top = 4;
    this.sun.shadow.camera.bottom = -2;
    this.sun.shadow.camera.far = 14;
    this.sun.shadow.radius = 5;
    this.scene.add(this.sun);
    const rim = new THREE.DirectionalLight(0xfff3e0, 0.35);
    rim.position.set(2.5, 2.0, -1.5);
    this.scene.add(rim);

    // shadow-catcher floor (only the soft contact shadows render on it —
    // the app shows no floor line, just small shadows under the books)
    this.floorMat = new THREE.ShadowMaterial({ opacity: 0.16 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), this.floorMat);
    floor.rotation.x = -HALF_PI;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.textures = {
      getPageTexture: (idx) => this.pageTexture(idx, 'right'),
      getLeftTexture: (idx) => this.pageTexture(idx, 'left'),
      getFlippedTexture: (idx) => this.pageTexture(idx, 'flip'),
    };

    this.bindEvents();
    this.resize();
    this.loop();
    if (typeof window !== 'undefined') {
      (window as unknown as { __sketchEngine?: SketchEngine }).__sketchEngine = this;
    }
  }

  /* ================================================================ */
  /* public API                                                        */
  /* ================================================================ */

  setJournals(list: JournalDTO[]): void {
    const keep = new Set(list.map((j) => j.id));
    for (const id of [...this.journals.keys()]) {
      if (!keep.has(id)) this.removeJournal(id);
    }
    this.order = list.map((j) => j.id);
    list.forEach((dto, i) => {
      const existing = this.journals.get(dto.id);
      if (existing) {
        existing.dto = dto;
        // Only re-pose on the shelf. In open/opening/closing modes the
        // journals hold transition poses (slide-away, lay-flat) that must
        // not be clobbered by shelf layout (e.g. after add/delete page).
        if (this.mode === 'shelf') this.layoutJournal(existing, i);
      } else {
        this.addJournal(dto, i);
      }
    });
    // clamp scroll
    this.scrollTarget = Math.min(this.scrollTarget, Math.max(0, list.length - 1));
    this.scroll = this.scrollTarget;
  }

  selectJournal(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.scrollTarget = id ? Math.max(0, this.order.indexOf(id)) : this.scrollTarget;
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  /** Begin the open transition for a journal (must already be selected).
   *  Works from the standing shelf AND from the 3D grid overview. */
  openJournal(detail: JournalDetailDTO, startSpread: number): void {
    if (this.mode !== 'shelf' && this.mode !== 'grid') return;
    const entry = this.journals.get(detail.id);
    if (!entry) return;
    if (this.mode === 'grid') {
      // leaving the grid overview — keep React in sync
      this.cb.onGridChange?.(false);
    }
    this.openEntry = entry;
    this.pageCount = detail.pages.length;
    this.pagesData = detail.pages.map((p) => ({ id: p.id, content: p.content }));
    this.paperColor = detail.paperColor || '#faf8f4';
    this.spread = Math.max(0, Math.min(startSpread, this.spreadCount() - 1));
    // capture the pose we transition FROM (shelf lift or flat grid slot)
    this.openStartStand = entry.obj.stand.rotation.x;
    this.openStartRootY = entry.obj.root.position.y;
    this.openStartYaw = entry.obj.root.rotation.y;
    this.openStartRoll = entry.obj.root.rotation.z;
    this.openStartScale = entry.obj.root.scale.x;
    this.openCamStart = {
      pos: this.camPos.clone(),
      look: this.camLook.clone(),
      fov: this.camFov,
    };
    // the floating book gets a soft floor pool shadow beneath its final spot
    entry.blob.visible = true;
    entry.blob.position.set(0, 0.004, 0.12);
    entry.blob.scale.set(2.6, 1.35, 1);
    (entry.blob.material as THREE.MeshBasicMaterial).opacity = 0.0;
    // riffle sheet carries the current spread's pages across the gutter
    if (this.pageCount > 2) {
      const frontTex = this.textures.getPageTexture(2 * this.spread + 1);
      const fm = entry.obj.flipFront.material as THREE.MeshStandardMaterial;
      fm.map = frontTex ?? null;
      fm.color.set(frontTex ? '#ffffff' : this.paperColor);
      fm.needsUpdate = true;
      const backTex = 2 * this.spread + 2 < this.pageCount ? this.textures.getFlippedTexture(2 * this.spread + 2) : null;
      const bm2 = entry.obj.flipBack.material as THREE.MeshStandardMaterial;
      bm2.map = backTex ?? null;
      bm2.color.set(backTex ? '#ffffff' : this.paperColor);
      bm2.needsUpdate = true;
    }
    // reading room: the CSS backdrop crossfades to navy as the book opens
    // per-sheet content faces (page 2i+1 rides sheet i's top)
    entry.obj.sheetFaces.forEach((f, i) => {
      const mat = f.material as THREE.MeshStandardMaterial;
      const tex = this.textures.getPageTexture(2 * i + 1);
      mat.map = tex ?? null;
      mat.color.set(tex ? '#ffffff' : this.paperColor);
      mat.needsUpdate = true;
    });
    // capture neighbor start poses BEFORE the slide-away so the open
    // transition converges even when the shelf is mid-scroll (search pick)
    this.slideStart.clear();
    for (const [id, j] of this.journals) {
      if (id === detail.id) continue;
      this.slideStart.set(id, {
        x: j.obj.root.position.x,
        y: j.obj.root.position.y,
        blob: (j.blob.material as THREE.MeshBasicMaterial).opacity,
      });
    }
    this.mode = 'opening';
    this.transitionStart = this.clock.getElapsedTime();
  }

  closeJournal(): void {
    if (this.mode !== 'open') return;
    this.mode = 'closing';
    this.transitionStart = this.clock.getElapsedTime();
    this.flip.active = false;
    this.spreadTween.active = false;
    if (this.openEntry) this.openEntry.obj.flipGroup.visible = false;
    if (this.pageZoom?.active) {
      this.pageZoom = null;
      this.cb.onZoomChange?.(false);
    }
    // the closing choreography lerps absolutely from the reading pose
    const oc = this.openCamTarget();
    this.camPos.copy(oc.pos);
    this.camLook.copy(oc.look);
    this.camFov = oc.fov;
    // capture neighbor start poses for the slide-back interpolation
    this.slideStart.clear();
    for (const [id, j] of this.journals) {
      if (id === this.openEntry?.dto.id) continue;
      this.slideStart.set(id, {
        x: j.obj.root.position.x,
        y: j.obj.root.position.y,
        blob: (j.blob.material as THREE.MeshBasicMaterial).opacity,
      });
    }
  }

  /** Rebuild the currently-open journal in place (e.g. after pages were added). */
  reloadOpenJournal(detail: JournalDetailDTO): void {
    if (this.mode !== 'open' || !this.openEntry) return;
    this.spreadTween.active = false;
    const keepSpread = this.spread;
    const oldId = this.openEntry.dto.id;
    this.removeJournal(oldId);
    const idx = Math.max(0, this.order.indexOf(oldId));
    this.order = this.order.map((id) => (id === oldId ? detail.id : id));
    this.addJournal({ ...detail, pageCount: detail.pages.length }, idx);
    const entry = this.journals.get(detail.id);
    if (!entry) return;
    this.openEntry = entry;
    this.pageCount = detail.pages.length;
    this.pagesData = detail.pages.map((p) => ({ id: p.id, content: p.content }));
    this.paperColor = detail.paperColor || '#faf8f4';
    this.spread = Math.max(0, Math.min(keepSpread, this.spreadCount() - 1));
    // pose directly in open state (upright, floating at eye level)
    entry.obj.stand.rotation.x = HALF_PI;
    entry.obj.root.position.set(0, OPEN_CENTER_Y, 0);
    entry.obj.root.rotation.set(0, 0, 0);
    entry.obj.root.scale.setScalar(1);
    // a freshly added journal stands in closed pose — flatten the spine column
    this.setSpineFlat(entry.obj, 1);
    entry.blob.visible = false;
    this.layoutOpenSpread(this.spread, true);
  }

  /** Immediately return to shelf mode (e.g. the open journal was deleted). */
  forceShelf(): void {
    const wasGrid = this.mode === 'grid';
    this.mode = 'shelf';
    this.openEntry = null;
    this.flip.active = false;
    this.spreadTween.active = false;
    if (this.pageZoom?.active) {
      this.pageZoom = null;
      this.cb.onZoomChange?.(false);
    } else {
      this.pageZoom = null;
    }
    this.gridScroll = this.gridScrollTarget = 0;
    this.reorder = null;
    if (this.reorderTimer != null) {
      window.clearTimeout(this.reorderTimer);
      this.reorderTimer = null;
    }
    this.updateCameraFit();
    this.layoutAll();
    for (const [, j] of this.journals) {
      j.obj.root.visible = true;
      j.blob.visible = true;
      (j.blob.material as THREE.MeshBasicMaterial).opacity = 0.26;
    }
    if (wasGrid) this.cb.onGridChange?.(false);
  }

  /** After a close/forceShelf, hide the open book's leftover pose. */
  markClosedSpread(spread: number): void {
    this.spread = Math.max(0, spread);
  }

  /* ================================================================ */
  /* 3D grid (table-top overview)                                     */
  /* ================================================================ */

  /** Enter the table-top overview: books lay flat in a grid, camera above. */
  enterGrid(): void {
    if (this.mode !== 'shelf') return;
    this.mode = 'grid';
    this.gridScroll = this.gridScrollTarget = 0;
    this.cb.onGridChange?.(true);
    playTap();
  }

  /** Leave the overview back to the standing shelf. */
  exitGrid(): void {
    if (this.mode !== 'grid') return;
    this.mode = 'shelf';
    this.cb.onGridChange?.(false);
    playTap();
  }

  isGrid(): boolean {
    return this.mode === 'grid';
  }

  /** True while a shelf/grid drag-to-reorder is mid-drag (Escape cancels). */
  isReordering(): boolean {
    return !!this.reorder?.active;
  }

  private gridCols(): number {
    return (this.camera.aspect || 1) >= 0.9 ? 4 : 2;
  }

  private gridRows(): number {
    return Math.max(1, Math.ceil(this.order.length / this.gridCols()));
  }

  /** Camera pose looking down at the flat grid (fits rows/cols, any aspect). */
  private gridCamTarget(): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
    const aspect = this.camera.aspect || 1;
    const fov = aspect < 0.9 ? 48 : 42;
    const tanF = Math.tan((fov * Math.PI) / 360);
    const cols = this.gridCols();
    const rows = this.gridRows();
    const spanW = cols * JOURNAL_W * 1.24 + 0.3;
    const spanZ = rows * JOURNAL_H * 1.12 + 0.6;
    // the tilted view foreshortens the depth axis (~cos 60°)
    const needW = spanW * 1.05;
    const needV = spanZ * 0.8;
    const dist = Math.max((needW / (2 * tanF * aspect)), needV / (2 * tanF), 3.4);
    const dir = new THREE.Vector3(0, 0.86, 0.44).normalize();
    const center = new THREE.Vector3(0, 0, 0.08);
    return {
      pos: center.clone().add(dir.multiplyScalar(dist)),
      look: center,
      fov,
    };
  }

  /** Per-frame eased pose of every journal in the grid. */
  private updateGrid(now: number): void {
    // vertical drag pan between rows
    this.gridScroll = lerp(this.gridScroll, this.gridScrollTarget, 0.14);
    const cam = this.gridCamTarget();
    this.camPos.lerp(cam.pos, 0.11);
    this.camLook.lerp(cam.look, 0.11);
    this.camFov = lerp(this.camFov, cam.fov, 0.1);

    const cols = this.gridCols();
    const rows = this.gridRows();
    const gapX = JOURNAL_W * 1.26;
    const gapZ = JOURNAL_H * 1.12;

    // while reordering, the remaining books fill the slots around the dragged
    // book's hover index so a gap opens under it (same model as the shelf)
    const reorder = this.reorder;
    const slots = this.order.map(() => -1);
    if (reorder?.active) {
      const gapIdx = reorder.returning ? reorder.startIndex : reorder.currentIndex;
      let free = 0;
      this.order.forEach((id, j) => {
        if (id === reorder.id) return;
        while (free === gapIdx) free += 1;
        slots[j] = free;
        free += 1;
      });
    }

    this.order.forEach((id, i) => {
      const entry = this.journals.get(id);
      if (!entry) return;
      const root = entry.obj.root;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const slotX = (col - (cols - 1) / 2) * gapX;
      const slotZ = (row - (rows - 1) / 2) * gapZ + this.gridScroll * gapZ;
      const dragging = reorder?.active && reorder.id === id && reorder.grid;
      const bm = entry.blob.material as THREE.MeshBasicMaterial;

      if (dragging && reorder) {
        if (reorder.returning) {
          // escape-cancelled: glide back into the original slot, then hand
          // over to the normal grid loop once converged
          reorder.bookX = lerp(reorder.bookX, slotX, 0.22);
          reorder.bookZ = lerp(reorder.bookZ, slotZ, 0.22);
          root.position.x = reorder.bookX;
          root.position.z = reorder.bookZ;
          root.position.y = lerp(root.position.y, id === this.selectedId ? 0.085 : 0.012, 0.16);
          root.rotation.y = lerp(root.rotation.y, 0, 0.18);
          root.rotation.z = lerp(root.rotation.z, 0, 0.18);
          root.scale.setScalar(lerp(root.scale.x, 1, 0.16));
          entry.blob.position.set(root.position.x, 0.004, root.position.z + 0.06);
          entry.blob.scale.set(1.5, 1.7, 1);
          bm.opacity = lerp(bm.opacity, 0.55, 0.16);
          if (Math.abs(reorder.bookX - slotX) < 0.012 && Math.abs(reorder.bookZ - slotZ) < 0.012) {
            this.reorder = null;
          }
          return;
        }
        // lifted, gently wobbling — follows the pointer over the table
        root.position.x = lerp(root.position.x, reorder.bookX, 0.35);
        root.position.z = lerp(root.position.z, reorder.bookZ, 0.35);
        root.position.y = lerp(root.position.y, REORDER_LIFT_Y, 0.2);
        root.rotation.y = lerp(root.rotation.y, Math.sin(now * 6) * 0.05, 0.2);
        root.rotation.z = lerp(root.rotation.z, Math.sin(now * 4.4) * 0.02, 0.2);
        root.scale.setScalar(lerp(root.scale.x, 1.07, 0.2));
        entry.blob.position.set(root.position.x, 0.004, root.position.z + 0.06);
        entry.blob.scale.set(1.7, 1.7, 1);
        bm.opacity = lerp(bm.opacity, 0.6, 0.2);
        return;
      }

      // neighbors ease between slots so the reflow reads as a glide
      let x = slotX;
      let z = slotZ;
      if (reorder?.active && slots[i] >= 0) {
        const sc = slots[i] % cols;
        const sr = Math.floor(slots[i] / cols);
        x = (sc - (cols - 1) / 2) * gapX;
        z = (sr - (rows - 1) / 2) * gapZ + this.gridScroll * gapZ;
      }
      const ease = reorder?.active ? 0.3 : 0.14;
      root.position.x = lerp(root.position.x, x, ease);
      root.position.z = lerp(root.position.z, z, ease);
      root.position.y = lerp(root.position.y, id === this.selectedId ? 0.085 : 0.012, 0.14);
      root.rotation.y = lerp(root.rotation.y, 0, 0.14);
      entry.obj.stand.rotation.x = lerp(entry.obj.stand.rotation.x, 0, 0.14);
      this.setSpineFlat(entry.obj, 1);
      entry.blob.visible = true;
      entry.blob.position.set(root.position.x, 0.004, root.position.z + 0.06);
      entry.blob.scale.set(1.5, 1.7, 1);
      bm.opacity = lerp(bm.opacity, id === this.selectedId ? 0.55 : 0.3, 0.14);
      // subtle idle breathing so the grid feels alive
      root.rotation.z = Math.sin(now * 0.6 + i * 1.7) * 0.004;
    });
    this.dragVelocity *= 0.9;
  }

  /** Current spread index (open mode). */
  getSpread(): number {
    return this.spread;
  }

  spreadCount(): number {
    return Math.max(1, Math.ceil(this.pageCount / 2));
  }

  /* ================================================================ */
  /* fullscreen page zoom (tap a page -> it fills the screen)          */
  /* ================================================================ */

  isPageZoomed(): boolean {
    return !!this.pageZoom?.active;
  }

  /**
   * Escape-cancel an in-progress shelf drag-to-reorder: the lifted book
   * glides back into its original slot and the shelf reflows to the old order.
   */
  cancelReorder(): void {
    if (this.reorderTimer != null) {
      window.clearTimeout(this.reorderTimer);
      this.reorderTimer = null;
    }
    const r = this.reorder;
    if (!r || r.returning) return;
    r.returning = true;
    r.currentIndex = r.startIndex;
    this.dragging = false;
  }

  /** Camera target hovering the chosen page so the page overfills the view. */
  private pageZoomTarget(side: 1 | -1): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
    const entry = this.openEntry;
    if (!entry) return { pos: this.camPos.clone(), look: this.camLook.clone(), fov: this.camFov };
    const { stackTop } = journalDims(this.pageCount);
    const topY =
      side === 1
        ? stackTop - this.spread * SHEET_PITCH
        : COVER_T + PILE_LIFT + this.spread * SHEET_T + (this.spread - 1) * SHEET_GAP;
    const center = entry.obj.offset.localToWorld(new THREE.Vector3((side * JOURNAL_W) / 2, topY + 0.002, 0));
    const aspect = this.camera.aspect || 1;
    const fov = 40;
    const tanF = Math.tan((fov * Math.PI) / 360);
    // the page must COVER the whole viewport on both axes: pick whichever
    // constraint (width-fit on landscape / height-fit on portrait) is closer —
    // the visible area becomes a center crop of the page and the paper fills
    // the screen edge-to-edge (like the reference fullscreen page)
    const over = 1.18;
    const dist = Math.min(JOURNAL_W / (2 * tanF * aspect * over), JOURNAL_H / (2 * tanF * over));
    // a hair of Y offset keeps lookAt stable and the gutter vertical on screen
    // (the upright spread faces +Z, so the zoom camera rides the page normal)
    const pos = center.clone().add(new THREE.Vector3(0, dist * 0.045, dist));
    return { pos, look: center, fov };
  }

  /** Zoom the camera into a page until it fills the screen (0.42s). */
  zoomToPage(pageIndex: number): boolean {
    if (this.mode !== 'open' || !this.openEntry) return false;
    if (this.flip.active || this.spreadTween.active) return false;
    if (pageIndex < 0 || pageIndex >= this.pageCount) return false;
    if (this.pageZoom?.active && !this.pageZoom.out) return false;
    const side: 1 | -1 = pageIndex % 2 === 0 ? -1 : 1;
    // freeze the idle float so the page lands perfectly still
    const entry = this.openEntry;
    entry.obj.root.position.y = OPEN_CENTER_Y;
    entry.obj.root.rotation.z = 0;
    this.pageZoom = {
      active: true,
      out: false,
      delivered: false,
      pageIndex,
      side,
      start: this.clock.getElapsedTime(),
      zStart: { pos: this.camPos.clone(), look: this.camLook.clone(), fov: this.camFov },
      target: this.pageZoomTarget(side),
    };
    this.cb.onZoomChange?.(true);
    playTap();
    return true;
  }

  /** Zoom back out to the reading pose (0.6s). */
  zoomOutPage(): void {
    const pz = this.pageZoom;
    if (!pz || !pz.active || pz.out) return;
    pz.out = true;
    pz.start = this.clock.getElapsedTime();
    pz.zStart = { pos: this.camPos.clone(), look: this.camLook.clone(), fov: this.camFov };
    pz.target = this.openCamTarget();
    playTap();
  }

  private updatePageZoom(now: number): void {
    const pz = this.pageZoom;
    if (!pz) return;
    const dur = pz.out ? 0.6 : 0.42;
    const e = easeInOut(clamp01((now - pz.start) / dur));
    this.camPos.lerpVectors(pz.zStart.pos, pz.target.pos, e);
    this.camLook.lerpVectors(pz.zStart.look, pz.target.look, e);
    this.camFov = lerp(pz.zStart.fov, pz.target.fov, e);
    if (e >= 1) {
      if (pz.out) {
        this.pageZoom = null;
        this.cb.onZoomChange?.(false);
      } else if (!pz.delivered) {
        pz.delivered = true;
        this.cb.onZoomDone?.(pz.pageIndex);
      }
    }
  }

  /** Flip one page. Returns false if impossible (edge / busy). */
  flipPage(dir: 1 | -1): boolean {
    if (this.mode !== 'open' || this.flip.active || this.spreadTween.active) return false;
    if (this.pageZoom?.active) return false;
    const to = this.spread + dir;
    if (to < 0 || to >= this.spreadCount()) return false;
    this.flip = { active: true, dir, from: this.spread, start: this.clock.getElapsedTime() };
    this.prepareFlipSheet(this.spread, dir);
    if (dir === 1) {
      // flying sheet k leaves the right stack; left stack grows after it lands
      this.layoutStaticSheets(this.spread, this.spread);
    } else {
      // flying sheet (k-1) leaves the left stack
      this.layoutStaticSheets(this.spread - 1, this.spread - 1);
    }
    playFlip();
    return true;
  }

  /** Jump directly to a spread (scrubber) — sheets glide through the
   *  intermediate stack poses instead of snapping. */
  setSpread(k: number): void {
    if (this.mode !== 'open' || this.flip.active || this.pageZoom?.active) return;
    const nk = Math.max(0, Math.min(k, this.spreadCount() - 1));
    const from = this.spreadTween.active ? this.tweenFloat() : this.spread;
    if (!this.spreadTween.active && nk === this.spread) return;
    this.spreadTween = { active: true, from, to: nk, start: this.clock.getElapsedTime() };
    this.cb.onSpreadChange(nk);
  }

  private tweenFloat(): number {
    const { from, to, start } = this.spreadTween;
    const t = clamp01((this.clock.getElapsedTime() - start) / SketchEngine.TWEEN_DUR);
    return lerp(from, to, easeInOut(t));
  }

  /** Sheets posed at a fractional spread (scrub tween). */
  private layoutSheetsContinuous(f: number): void {
    const entry = this.openEntry;
    if (!entry) return;
    const obj = entry.obj;
    const { sheets: S } = journalDims(this.pageCount);
    const kMax = this.spreadCount() - 1;
    const k0 = Math.max(0, Math.min(Math.floor(f), kMax));
    const k1 = Math.min(k0 + 1, kMax);
    const u = easeInOut(clamp01(f - k0));
    for (let i = 0; i < S; i++) {
      const mesh = obj.sheets[i];
      mesh.visible = true;
      const pose = (k: number): { x: number; y: number; z: number; rz: number } => {
        if (i < k) {
          const p = this.chainPose(k - 1 - i, true);
          return { x: p.x, y: this.slotLeft(i) + p.rec, z: 0, rz: p.rz };
        }
        const p = this.chainPose(i - k, false);
        return { x: p.x, y: this.slotRight(i) + p.rec, z: 0, rz: p.rz };
      };
      const a = pose(k0);
      const b = pose(k1);
      mesh.position.x = lerp(a.x, b.x, u);
      mesh.position.y = lerp(a.y, b.y, u);
      mesh.position.z = lerp(a.z, b.z, u);
      mesh.rotation.z = lerp(a.rz, b.rz, u);
    }
  }

  private updateSpreadTween(): void {
    const entry = this.openEntry;
    if (!entry) return;
    const f = this.tweenFloat();
    this.layoutSheetsContinuous(f);
    // static content planes hide while the sheets sweep across them
    entry.obj.leftContent.visible = false;
    entry.obj.rightContent.visible = false;
    if ((this.clock.getElapsedTime() - this.spreadTween.start) / SketchEngine.TWEEN_DUR >= 1) {
      this.spreadTween.active = false;
      this.spread = this.spreadTween.to;
      this.layoutOpenSpread(this.spread, false);
    }
  }

  /** Update a page's content after editing and refresh its textures. */
  updatePageContent(pageId: string, content: PageContent): void {
    const pd = this.pagesData.find((p) => p.id === pageId);
    if (pd) pd.content = content;
    for (const [key, tex] of [...this.pageTexCache.entries()]) {
      if (key.startsWith(`${pageId}:`)) {
        tex.dispose();
        this.pageTexCache.delete(key);
      }
    }
    const pIdx = this.pagesData.findIndex((p) => p.id === pageId);
    if (pIdx >= 0 && this.openEntry) {
      // refresh the sheet face that carries this page's spread
      const sheetIdx = Math.floor(pIdx / 2);
      const face = this.openEntry.obj.sheetFaces[sheetIdx];
      if (face) {
        const mat = face.material as THREE.MeshStandardMaterial;
        const tex = this.textures.getPageTexture(2 * sheetIdx + 1);
        mat.map = tex ?? null;
        mat.color.set(tex ? '#ffffff' : this.paperColor);
        mat.needsUpdate = true;
      }
    }
    if (this.mode === 'open' && this.openEntry) {
      this.layoutOpenSpread(this.spread, true);
    }
  }

  setTiltEnabled(v: boolean): void {
    this.tiltEnabled = v;
  }

  resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.updateCameraFit();
    if (this.mode === 'open' && !this.pageZoom?.active) {
      // re-fit the reading view to the new aspect (device rotation / window resize)
      const oc = this.openCamTarget();
      this.camPos.copy(oc.pos);
      this.camLook.copy(oc.look);
      this.camFov = oc.fov;
    }
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.reorderTimer != null) window.clearTimeout(this.reorderTimer);
    this.unbindEvents();
    for (const id of [...this.journals.keys()]) this.removeJournal(id);
    for (const tex of this.pageTexCache.values()) tex.dispose();
    this.pageTexCache.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /* ================================================================ */
  /* journals                                                          */
  /* ================================================================ */

  private addJournal(dto: JournalDTO, index: number): void {
    // flat matte covers like the app's printed jackets — no gloss
    const coverMat = new THREE.MeshPhysicalMaterial({
      color: dto.coverStyle.color,
      roughness: 0.85,
      clearcoat: 0.05,
      clearcoatRoughness: 0.8,
    });
    // spine band: the reference gives each journal a distinct spine wrap —
    // dark covers often wear a cream/white spine, light covers a deepened tone
    const spineMat = new THREE.MeshPhysicalMaterial({
      color: spineColorFor(dto.coverStyle),
      roughness: 0.88,
      clearcoat: 0.03,
      clearcoatRoughness: 0.85,
    });
    const coverArtMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.88,
      clearcoat: 0.05,
      clearcoatRoughness: 0.8,
    });
    const artTex = makeCoverTexture(dto.coverStyle);
    coverArtMat.map = artTex;
    coverArtMat.needsUpdate = true;

    const obj = buildJournal({
      pageCount: Math.max(2, dto.pageCount),
      coverMaterial: coverMat,
      spineMaterial: spineMat,
      coverArtTexture: artTex,
      coverArtMaterial: coverArtMat,
      paperColor: dto.paperColor || '#faf8f4',
      textures: this.textures,
    });
    obj.root.traverse((o) => {
      o.userData.journalId = dto.id;
    });

    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: getShadowBlobTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.5,
      }),
    );
    blob.rotation.x = -HALF_PI;
    blob.scale.set(1.15, 1.5, 1);
    this.scene.add(blob);

    const entry: ShelfEntry = { dto, obj, coverMat, spineMat, coverArtMat, blob };
    this.journals.set(dto.id, entry);
    this.scene.add(obj.root);
    this.layoutJournal(entry, index);
  }

  private removeJournal(id: string): void {
    const entry = this.journals.get(id);
    if (!entry) return;
    this.scene.remove(entry.obj.root);
    this.scene.remove(entry.blob);
    (entry.blob.material as THREE.Material).dispose();
    entry.blob.geometry.dispose();
    entry.coverArtMat.map?.dispose();
    entry.coverMat.dispose();
    entry.spineMat.dispose();
    entry.coverArtMat.dispose();
    entry.obj.dispose();
    this.journals.delete(id);
  }

  /** Layout one journal on the shelf row (also the reset pose after close). */

  private layoutJournal(entry: ShelfEntry, index: number): void {
    const fromCenter = index - this.scroll;
    const root = entry.obj.root;
    root.position.x = fromCenter * SHELF_SPACING;
    // FLAT row (reference): near-zero depth push, books almost face-on
    root.position.z = -Math.min(0.08, Math.abs(fromCenter) * 0.03);
    root.rotation.y = Math.max(-0.14, Math.min(0.14, -fromCenter * 0.045));
    const isSelected = entry.dto.id === this.selectedId;
    root.position.y = SHELF_BASE_Y + (isSelected && this.mode === 'shelf' ? SELECT_LIFT : 0);
    if (this.mode === 'shelf') root.scale.setScalar(isSelected ? SELECT_SCALE : 1);
    entry.blob.visible = true;
    entry.blob.position.set(root.position.x, 0.004, root.position.z + 0.05);
    const s = root.scale.x;
    entry.blob.scale.set(1.15 * s, 1.5 * s, 1);
    (entry.blob.material as THREE.MeshBasicMaterial).opacity =
      (isSelected ? 0.42 : 0.26) * s;
    entry.obj.stand.rotation.x = HALF_PI;
    entry.obj.stand.position.y = 0;
    entry.obj.coverPivot.rotation.z = 0;
    entry.obj.offset.rotation.y = 0;
    // hide everything that belongs to the open pose
    entry.obj.flipShadow.visible = false;
    entry.obj.leftContent.visible = false;
    entry.obj.rightContent.visible = false;
    entry.obj.leftWell.visible = false;
    entry.obj.rightWell.visible = true;
    entry.obj.flipGroup.visible = false;
    entry.obj.gutterShade.visible = false;
    for (const f of entry.obj.sheetFaces) f.visible = false;
    for (const b of entry.obj.sheetBacks) b.visible = false;
    // restore the spine column (it flattens while the book is open)
    entry.obj.spine.scale.y = 1;
    if (entry.obj.spine.userData.baseY != null) {
      entry.obj.spine.position.y = entry.obj.spine.userData.baseY as number;
    }
    if (entry.obj.coverPivot.userData.closedY == null) {
      entry.obj.coverPivot.userData.closedY = entry.obj.coverPivot.position.y;
    } else {
      entry.obj.coverPivot.position.y = entry.obj.coverPivot.userData.closedY as number;
    }
  }

  /* ================================================================ */
  /* open / close choreography                                         */
  /* ================================================================ */

  private pageTexture(
    pageIndex: number,
    variant: 'right' | 'left' | 'flip',
  ): THREE.CanvasTexture | null {
    if (pageIndex < 0 || pageIndex >= this.pagesData.length) return null;
    const pd = this.pagesData[pageIndex];
    const key = `${pd.id}:${variant}`;
    let tex = this.pageTexCache.get(key);
    if (tex) return tex;
    const content = pd.content ?? parsePageContent('{}');
    const canvas = renderPageContentToCanvas(content, 620, 1129, this.paperColor);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    if (variant === 'left') {
      tex.flipY = false; // left geometry is Y-mirrored
    } else if (variant === 'flip') {
      tex.center.set(0.5, 0.5);
      tex.rotation = Math.PI;
    }
    this.pageTexCache.set(key, tex);
    return tex;
  }

  /** Open-pose camera direction — straight-on at the upright spread (the
   *  reference reading view is essentially orthographic face-on). */
  private openCamDir = new THREE.Vector3(0, 0.03, 0.999);

  /** Open-pose camera target — fits the whole spread + chained fans at ANY
   *  aspect ratio. Long lens (low fov) like the reference reading room: the
   *  fan pages recede in depth yet keep nearly full height on screen.
   *  Distance solves both the vertical (page height) and horizontal
   *  (spread + both fans) constraints; portrait phones pull way back. */
  private openCamTarget(): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
    const aspect = this.camera.aspect || 1;
    const fov = aspect < 0.9 ? 30 : 22;
    const tanF = Math.tan((fov * Math.PI) / 360);
    // the reference spread fills the frame: book ~77% of frame height, the
    // outer fan slivers CROP at the screen edges (app reference, open spread)
    const needV = JOURNAL_H * 1.32; // spread height + breathing room (title clearance)
    const needW = JOURNAL_W * (aspect < 1 ? 1.95 : 2.95);
    const dist = Math.max(needV / (2 * tanF), needW / (2 * tanF * aspect));
    return {
      pos: new THREE.Vector3(
        this.openCamDir.x * dist,
        OPEN_CENTER_Y + this.openCamDir.y * dist,
        this.openCamDir.z * dist,
      ),
      // aim a hair above the book center so the spread sits slightly low in
      // frame and the title block never overlaps the pages
      look: new THREE.Vector3(0, OPEN_CENTER_Y + 0.09, 0),
      fov,
    };
  }

  /** Chained-hinge fan pose for a sheet `depth` steps below its stack's top
   *  (0 = the flat spread-supporting sheet). Matched to the reference reading
   *  view: fan page 1 hinges at the spread's fore-edge, page d+1 hinges one
   *  full slab-extent + air gap beyond page d, and each page tilts
   *  progressively steeper back into the scene (59° → 86°). Because every
   *  step reserves the slab's full projected x-extent, consecutive slabs are
   *  x-DISJOINT — pages can never intersect (fixes the "pages going under
   *  each other" glitch). Depth recession is cheat-scaled for the long-lens
   *  reading camera, and pages beyond FAN_VISIBLE tuck into a parallel deck
   *  behind the last sliver, offset along its normal (radial separation). */
  private chainPose(depth: number, left: boolean): { x: number; rec: number; rz: number } {
    if (depth <= 0) {
      return left ? { x: 0, rec: 0, rz: Math.PI } : { x: 0, rec: 0, rz: 0 };
    }
    const d = Math.min(depth, 30);
    const ang = (j: number): number => Math.min(FAN_A1 + (j - 1) * FAN_DA, FAN_AMAX);
    const hinge0 = PAGE_INSET_S + SHEET_W - FAN_TUCK;
    let x = hinge0;
    let rec = 0;
    const steps = Math.min(d, FAN_VISIBLE) - 1;
    for (let j = 1; j <= steps; j++) {
      x += SHEET_W * Math.cos(ang(j)) + SHEET_T * Math.sin(ang(j)) + FAN_GAP;
      rec -= SHEET_W * Math.sin(ang(j)) * FAN_RECEDE;
    }
    if (d > FAN_VISIBLE) {
      const aV = ang(FAN_VISIBLE);
      const j = d - FAN_VISIBLE;
      const step = SHEET_T + 0.0016;
      const tuck = j * step * Math.sin(aV);
      x += left ? tuck : -tuck;
      rec -= j * step * Math.cos(aV);
    }
    const a = ang(d);
    return left ? { x: -x, rec, rz: Math.PI + a } : { x, rec, rz: -a };
  }

  /** Closed-block slot origin for sheet i on the RIGHT stack. The slab spans
   *  [origin, origin + SHEET_T] with an air gap to the next sheet — exact
   *  tiling, zero coplanar faces. */
  private slotRight(i: number): number {
    const { stackTop } = journalDims(this.pageCount);
    return stackTop - (i + 1) * SHEET_T - i * SHEET_GAP;
  }

  /** Slot origin for sheet i on the LEFT pile (flipped sheets: the slab hangs
   *  BELOW its origin; the pile rides PILE_LIFT above the opened front cover
   *  so cover, liner and pages never touch). */
  private slotLeft(i: number): number {
    return COVER_T + PILE_LIFT + (i + 1) * SHEET_T + i * SHEET_GAP;
  }

  /** Open-pose target (position + rotation) for sheet index `i` at spread `k`. */
  private openSheetTarget(
    i: number,
    k: number,
    _stackTop: number,
  ): { x: number; y: number; rz: number } {
    if (i < k) {
      const p = this.chainPose(k - 1 - i, true);
      return { x: p.x, y: this.slotLeft(i) + p.rec, rz: p.rz };
    }
    const p = this.chainPose(i - k, false);
    return { x: p.x, y: this.slotRight(i) + p.rec, rz: p.rz };
  }

  /** Lay out stacks + content planes for a spread. */
  private layoutOpenSpread(k: number, _instant: boolean): void {
    const entry = this.openEntry;
    if (!entry) return;
    const obj = entry.obj;
    const { sheets: S, stackTop } = journalDims(this.pageCount);

    // sheets: left pile 0..k-1 (re-piled on the opened cover), right stack k..S-1
    for (let i = 0; i < S; i++) {
      const mesh = obj.sheets[i];
      mesh.visible = true;
      const t = this.openSheetTarget(i, k, stackTop);
      mesh.position.set(t.x, t.y, 0);
      mesh.rotation.z = t.rz;
    }
    // center the open spread on the spine
    obj.offset.position.x = 0;

    // content planes (only revealed in open mode; hidden while closed/opening)
    const leftIdx = 2 * k;
    const rightIdx = 2 * k + 1;
    // tops: sit directly ON the pile below (sheet tops / opened cover liner) —
    // floating them T/2 above leaves a visible dark gap at the page edges
    const leftTopY = (k > 0 ? this.slotLeft(k - 1) : COVER_T + 0.0022) + 0.0012;
    const rightTopY = this.slotRight(k) + SHEET_T + 0.0012;
    const show = this.mode === 'open';
    obj.leftContent.rotation.z = 0; // left geometry already spans -W..0
    obj.leftContent.position.y = leftTopY + 0.0012;
    applyPageTexture(obj.leftContent, leftIdx, this.textures, this.paperColor, 'left');
    // At k=0 the left page is the inside front cover: page 0 is "printed on
    // the liner" so the title page is never orphaned.
    obj.leftContent.visible = show && leftIdx < this.pageCount;
    obj.rightContent.rotation.z = 0;
    obj.rightContent.position.y = rightTopY + 0.0012;
    applyPageTexture(obj.rightContent, rightIdx, this.textures, this.paperColor);
    obj.rightContent.visible = show && rightIdx < this.pageCount;
    // show the fan pages' content faces (the chained fan reads as a cascade
    // of sketched leaves at grazing angles — like the reference). Left-pile
    // sheets show their BACKS (sheetBacks), right-fan sheets their tops.
    for (let i = 0; i < S; i++) {
      const face = obj.sheetFaces[i];
      if (!face) continue;
      const fd = i - k; // right-fan depth; left fan pages ride on sheetBacks
      face.visible = show && fd >= 1 && fd <= FAN_VISIBLE;
    }
    // page backs ride the stacks while reading — they give the standing fan
    // its content slivers (reference shows sketch fragments through the fan)
    for (const b of obj.sheetBacks) b.visible = show;

    // wells (paper liner over the covers' inner faces)
    obj.rightWell.rotation.z = 0;
    obj.rightWell.position.y = COVER_T + 0.0009;
    obj.rightWell.visible = true;
    obj.leftWell.visible = false;

    // static gutter shading sits just above the content planes
    const gutterMidY = (leftTopY + rightTopY) / 2 + SHEET_T * 0.5 + 0.0016;
    obj.gutterShade.position.set(0, gutterMidY, 0);
    obj.gutterShade.visible = show;

    // front cover open, resting flat on the left at the bottom of the block
    // (pivot sits a hair low so the cover box + liner clear the left pile)
    obj.coverPivot.rotation.z = Math.PI;
    obj.coverPivot.position.y = COVER_T / 2 + 0.0002;
  }

  /** Pose the static sheets while a sheet flies. Targets use the chained fan
   *  at spread `kEff`; the sheets GLIDE from their current transforms to the
   *  new chain links (the fan flows one step per page turn, like the
   *  reference) — updateFlip advances this every frame. */
  private layoutStaticSheets(kEff: number, flyingIdx: number): void {
    const entry = this.openEntry;
    if (!entry) return;
    const obj = entry.obj;
    const { sheets: S, stackTop } = journalDims(this.pageCount);
    this.flipSheetFrom = [];
    this.flipSheetTo = [];
    for (let i = 0; i < S; i++) {
      if (i === flyingIdx) {
        this.flipSheetFrom.push(null);
        this.flipSheetTo.push(null);
        continue;
      }
      const mesh = obj.sheets[i];
      mesh.visible = true;
      this.flipSheetFrom.push({ x: mesh.position.x, y: mesh.position.y, rz: mesh.rotation.z });
      this.flipSheetTo.push(this.openSheetTarget(i, kEff, stackTop));
    }
    // the STATIC side's page stays visible while its sheet flies (the flying
    // sheet only replaces the other side) — matches the reference flip where
    // the left page never blanks out
    obj.leftContent.visible = this.flip.dir === 1;
    obj.rightContent.visible = this.flip.dir === -1;
  }

  private prepareFlipSheet(k: number, dir: 1 | -1): void {
    const entry = this.openEntry;
    if (!entry) return;
    const obj = entry.obj;
    obj.flipGroup.visible = true;
    obj.flipGroup.position.y = dir === 1 ? this.slotRight(k) : this.slotLeft(k - 1);
    obj.flipGroup.rotation.z = 0;

    const frontIdx = 2 * k + 1;
    const backIdx = 2 * k + 2;
    if (dir === 1) {
      // forward: front face shows the current right page, back face the next left page
      const frontTex = this.textures.getPageTexture(frontIdx);
      const backTex = backIdx < this.pageCount ? this.textures.getFlippedTexture(backIdx) : null;
      const fm = obj.flipFront.material as THREE.MeshStandardMaterial;
      fm.map = frontTex ?? null;
      fm.color.set(frontTex ? '#ffffff' : this.paperColor);
      fm.needsUpdate = true;
      const bm = obj.flipBack.material as THREE.MeshStandardMaterial;
      bm.map = backTex ?? null;
      bm.color.set(backTex ? '#ffffff' : this.paperColor);
      bm.needsUpdate = true;
    } else {
      // backward: sheet (k-1) returns right. Its up-face at theta=PI is the
      // flipBack plane showing the current left page (2k); at theta=0 the
      // flipFront plane shows page 2k-1 (the new right page).
      const frontTex = 2 * k - 1 >= 0 ? this.textures.getPageTexture(2 * k - 1) : null;
      const backTex = this.textures.getFlippedTexture(2 * k);
      const fm = obj.flipFront.material as THREE.MeshStandardMaterial;
      fm.map = frontTex ?? null;
      fm.color.set(frontTex ? '#ffffff' : this.paperColor);
      fm.needsUpdate = true;
      const bm = obj.flipBack.material as THREE.MeshStandardMaterial;
      bm.map = backTex ?? null;
      bm.color.set(backTex ? '#ffffff' : this.paperColor);
      bm.needsUpdate = true;
    }
    obj.flipBack.visible = false;
    bendSheet(obj.flipFront.geometry, dir === 1 ? 0 : Math.PI, 0.36, dir === 1 ? 1 : -1);
    bendSheet(obj.flipBack.geometry, dir === 1 ? 0 : Math.PI, 0.36, dir === 1 ? 1 : -1);
    bendSheet(obj.flipEdge.geometry, dir === 1 ? 0 : Math.PI, 0.36, dir === 1 ? 1 : -1);
  }

  private updateFlip(now: number): void {
    if (!this.flip.active || !this.openEntry) return;
    const entry = this.openEntry;
    const obj = entry.obj;
    const t = clamp01((now - this.flip.start) / FLIP_DUR);
    const e = easeOut(t);
    const { dir, from } = this.flip;
    const theta = dir === 1 ? e * Math.PI : (1 - e) * Math.PI;

    bendSheet(obj.flipFront.geometry, theta, 0.38, dir === 1 ? 1 : -1);
    bendSheet(obj.flipBack.geometry, theta, 0.38, dir === 1 ? 1 : -1);
    bendSheet(obj.flipEdge.geometry, theta, 0.38, dir === 1 ? 1 : -1);
    // the underside plane becomes visible once it rotates past vertical
    obj.flipBack.visible = theta > HALF_PI * 1.03;

    // the chained fans flow one link per page turn (glide to their new poses)
    const eFan = easeInOut(t);
    for (let i = 0; i < this.flipSheetFrom.length; i++) {
      const f = this.flipSheetFrom[i];
      const g = this.flipSheetTo[i];
      if (!f || !g) continue;
      const mesh = obj.sheets[i];
      mesh.position.set(lerp(f.x, g.x, eFan), lerp(f.y, g.y, eFan), 0);
      mesh.rotation.z = lerp(f.rz, g.rz, eFan);
    }

    // moving shadow that follows the curling page across the spread
    const flipY =
      this.flip.dir === 1
        ? this.slotRight(this.flip.from) + SHEET_T * 0.5
        : this.slotLeft(this.flip.from - 1) + SHEET_T * 0.5;
    const stackTopNow = journalDims(this.pageCount).stackTop;
    const shadow = obj.flipShadow;
    shadow.visible = true;
    shadow.position.set(
      Math.cos(theta) * JOURNAL_W * 0.52 * dir,
      Math.min(flipY + SHEET_T * 2, stackTopNow + 0.004),
      0,
    );
    shadow.rotation.z = Math.sin(theta) * 0.35 * dir;
    const s = Math.sin(theta);
    const shScale = 0.7 + s * 0.5;
    shadow.scale.set(shScale, shScale * 1.02, 1);
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.34 * Math.pow(s, 1.4);
    // gutter contact shadow: darkest while the page stands over the spine
    const gutter = obj.gutterShadow;
    gutter.visible = true;
    gutter.position.y = stackTopNow + 0.004;
    (gutter.material as THREE.MeshBasicMaterial).opacity = 0.4 * s;
    obj.flipFront.renderOrder = 20;
    obj.flipBack.renderOrder = 21;
    obj.flipEdge.renderOrder = 19;

    // whole-book lean toward the flip
    obj.offset.rotation.y = Math.sin(theta) * 0.05 * dir;

    if (t >= 1) {
      this.flip.active = false;
      obj.flipGroup.visible = false;
      obj.flipShadow.visible = false;
      obj.gutterShadow.visible = false;
      obj.offset.rotation.y = 0;
      this.spread = from + dir;
      this.layoutOpenSpread(this.spread, false);
      this.cb.onSpreadChange(this.spread);
    }
  }

  /**
   * OPEN choreography (matched frame-by-frame against the reference):
   *  1. RISE   (0 → 0.30) the book lifts out of the row and yaws a quarter
   *     turn into the fore-edge "bar" pose (white page block to camera) while
   *     the camera pushes in to frame it. The book NEVER tips or descends —
   *     it rises and stays at eye level from here on.
   *  2. BLOOM  (0.30 → 0.52) every sheet sweeps around the spine into the
   *     wide accordion fan (top sheets swing far left, bottom sheets trail
   *     right, the cover flips to the left extreme) as the yaw eases back
   *     toward the camera and the neighbors slide/fade away.
   *  3. GATHER (0.52 → 0.84) the fan cascades down into its two stacks while
   *     one page riffles right→left across the gutter; the book turns
   *     face-on and the camera pulls to the reading fit.
   *  4. SETTLE (0.84 → 1.0) micro-settle into the reading pose.
   */
  private updateOpening(now: number): void {
    const entry = this.openEntry;
    if (!entry) return;
    const t = clamp01((now - this.transitionStart) / OPEN_DUR_EFF);
    const obj = entry.obj;
    const root = obj.root;

    /* --- neighbors: hold through the rise, then glide/fade during bloom --- */
    const outT = easeInOut(clamp01((t - 0.2) / 0.34));
    const myIdx = this.order.indexOf(entry.dto.id);
    for (const [id, j] of this.journals) {
      if (id === entry.dto.id) continue;
      const idx = this.order.indexOf(id);
      const dirSign = idx < myIdx ? -1 : 1;
      const st = this.slideStart.get(id);
      const x0 = st ? st.x : j.obj.root.position.x;
      const y0 = st ? st.y : j.obj.root.position.y;
      j.obj.root.position.x = lerp(x0, dirSign * 7.2, outT);
      j.obj.root.position.y = lerp(y0, SHELF_BASE_Y, outT);
      j.obj.root.rotation.y = lerp(j.obj.root.rotation.y, 0, outT);
      const bm = j.blob.material as THREE.MeshBasicMaterial;
      bm.opacity = Math.max(0, (st ? st.blob : 0.38) * (1 - outT));
    }

    /* --- phase easings --- */
    const eRise = easeInOut(clamp01(t / 0.3));
    const eBloom = easeOutCubic(clamp01((t - 0.3) / 0.22));
    const eGather = easeInOut(clamp01((t - 0.52) / 0.32));
    const eSettle = easeInOut(clamp01((t - 0.84) / 0.16));

    /* --- stand upright the whole way --- */
    obj.stand.rotation.x = lerp(this.openStartStand, HALF_PI, eRise);

    /* --- root: rise to eye level + quarter-turn yaw to the fore-edge bar,
     *        then ease back to face the camera while the fan gathers --- */
    const baseY = this.openStartRootY || SHELF_BASE_Y + SELECT_LIFT;
    root.position.y = lerp(baseY, OPEN_CENTER_Y, eRise);
    root.position.x = lerp(root.position.x, 0, eRise);
    root.position.z = lerp(root.position.z, 0, eRise);
    root.rotation.z = lerp(this.openStartRoll, 0, eRise);
    root.scale.setScalar(lerp(lerp(this.openStartScale, 1.07, eRise), 1, eGather));

    const BAR_YAW = -HALF_PI;
    const BLOOM_YAW = -0.62;
    let yaw: number;
    if (t < 0.3) yaw = lerp(this.openStartYaw, BAR_YAW, eRise);
    else if (t < 0.52) yaw = lerp(BAR_YAW, BLOOM_YAW, eBloom);
    else yaw = lerp(BLOOM_YAW, 0, eGather);
    root.rotation.y = yaw;

    // re-center: closed book centers on its cover; open spread centers on spine
    const offX =
      eGather <= 0
        ? lerp(-JOURNAL_W / 2, -JOURNAL_W * 0.28, eBloom)
        : lerp(-JOURNAL_W * 0.28, 0, eGather);
    obj.offset.position.x = offX;

    /* --- cover: flips to the left extreme during the bloom, settles flat --- */
    const closedY = obj.coverPivot.userData.closedY as number;
    const coverSwing = easeOutCubic(clamp01((t - 0.3) / 0.36));
    obj.coverPivot.rotation.z = coverSwing * Math.PI;
    obj.coverPivot.position.y = lerp(
      closedY,
      COVER_T / 2 + 0.0002,
      easeInOut(clamp01((coverSwing - 0.5) / 0.5)),
    );

    /* --- sheets: closed block → accordion fan → cascade into chained stacks --- */
    const { sheets: S, stackTop } = journalDims(this.pageCount);
    const fanBaseY = COVER_T + stackTop * 0.42;
    for (let i = 0; i < S; i++) {
      const mesh = obj.sheets[i];
      mesh.visible = true;
      const rest = this.openSheetTarget(i, this.spread, stackTop);
      const restY = rest.y;
      const closedSlot = this.slotRight(i);
      // bloom angle: top sheet swings far left, bottom trails slightly right
      const u = S <= 1 ? 0.5 : i / (S - 1);
      const bloomAngle = lerp(2.42, -0.52, u);
      const bloomY = fanBaseY + (i - S / 2) * SHEET_PITCH * 1.25;
      const bloomX = Math.cos(bloomAngle) * JOURNAL_W * 0.09;
      const bloomZ = Math.sin(bloomAngle) * JOURNAL_W * 0.035;
      if (eGather <= 0) {
        mesh.position.set(lerp(0, bloomX, eBloom), lerp(closedSlot, bloomY, eBloom), lerp(0, bloomZ, eBloom));
        mesh.rotation.z = bloomAngle * eBloom;
      } else {
        mesh.position.set(lerp(bloomX, rest.x, eGather), lerp(bloomY, restY, eGather), lerp(bloomZ, 0, eGather));
        mesh.rotation.z = lerp(bloomAngle, rest.rz, eGather);
      }
      const face = obj.sheetFaces[i];
      if (face) face.visible = t > 0.3 && t < 0.94;
      const back = obj.sheetBacks[i];
      if (back) back.visible = t > 0.3;
    }

    /* --- riffle: one page sweeps right→left across the gutter while the
     *        fan gathers (the reference's signature settle beat) --- */
    if (S > 1) {
      const fg = obj.flipGroup;
      const rT = clamp01((t - 0.54) / 0.3);
      fg.visible = t > 0.52 && t < 0.9;
      if (fg.visible) {
        const theta = easeInOut(rT) * Math.PI;
        fg.position.y = stackTop + 0.0016;
        fg.rotation.z = 0;
        bendSheet(obj.flipFront.geometry, theta, 0.34, 1);
        bendSheet(obj.flipBack.geometry, theta, 0.34, 1);
        bendSheet(obj.flipEdge.geometry, theta, 0.34, 1);
        obj.flipFront.renderOrder = 20;
        obj.flipBack.renderOrder = 21;
        obj.flipEdge.renderOrder = 19;
        obj.flipBack.visible = theta > HALF_PI * 1.04;
      }
    }

    // spine column melts into the gutter as the spread opens
    this.setSpineFlat(obj, eGather);

    // floor pool shadow fades in under the floating spread
    const bm = entry.blob.material as THREE.MeshBasicMaterial;
    bm.opacity = 0.4 * eGather;

    /* --- camera: shelf → fore-edge bar push-in → reading fit --- */
    const oc = this.openCamTarget();
    const barPos = new THREE.Vector3(0, OPEN_CENTER_Y + 0.05, 3.15);
    const barLook = new THREE.Vector3(0, OPEN_CENTER_Y, 0);
    if (t < 0.3) {
      const u = eRise;
      this.camPos.lerpVectors(this.openCamStart.pos, barPos, u);
      this.camLook.lerpVectors(this.openCamStart.look, barLook, u);
      this.camFov = lerp(this.openCamStart.fov, 34, u);
    } else if (t < 0.52) {
      this.camPos.copy(barPos);
      this.camLook.copy(barLook);
      this.camFov = 34;
    } else {
      const mid = easeInOut(clamp01((t - 0.52) / 0.36));
      const startPos = barPos.clone();
      const endPos = oc.pos.clone().multiplyScalar(0.97).lerp(oc.pos, eSettle);
      this.camPos.lerpVectors(startPos, endPos, mid);
      this.camLook.lerpVectors(barLook, oc.look, mid);
      this.camFov = lerp(34, oc.fov, mid);
    }

    if (t >= 1) {
      this.mode = 'open';
      root.position.set(0, OPEN_CENTER_Y, 0);
      root.quaternion.identity();
      root.rotation.set(0, 0, 0);
      root.scale.setScalar(1);
      obj.stand.rotation.x = HALF_PI;
      obj.offset.position.x = 0;
      obj.flipGroup.visible = false;
      const occ = this.openCamTarget();
      this.camPos.copy(occ.pos);
      this.camLook.copy(occ.look);
      this.camFov = occ.fov;
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
      this.layoutOpenSpread(this.spread, true);
      this.cb.onOpenComplete();
    }
  }

  private setSpineFlat(obj: JournalObject, flat: number): void {
    // the spine column shrinks into the gutter as the book lays flat
    const spine = obj.spine;
    if (spine.userData.baseY == null) spine.userData.baseY = spine.position.y;
    const s = lerp(1, 0.04, flat);
    spine.scale.y = s;
    spine.position.y = lerp(spine.userData.baseY as number, COVER_T * 0.6, flat);
  }

  /**
   * CLOSE choreography (the open run in reverse, snappier): the upright
   * spread gathers into the accordion fan while facing the camera, folds to
   * the edge-on bar pose, then the closed book descends back into its shelf
   * slot as the camera pulls out and the neighbors return.
   */
  private updateClosing(now: number): void {
    const entry = this.openEntry;
    if (!entry) return;
    const t = clamp01((now - this.transitionStart) / CLOSE_DUR_EFF);
    const obj = entry.obj;
    const root = obj.root;

    /* --- neighbors return (t 0.5..1) --- */
    const backT = easeInOut(clamp01((t - 0.5) / 0.5));
    for (const [id, j] of this.journals) {
      if (id === entry.dto.id) continue;
      const idx = this.order.indexOf(id);
      const tx = (idx - this.scroll) * SHELF_SPACING;
      const st = this.slideStart.get(id);
      j.obj.root.position.x = lerp(st ? st.x : tx, tx, backT);
      j.obj.root.position.y = lerp(st ? st.y : SHELF_BASE_Y, SHELF_BASE_Y, backT);
      const bm = j.blob.material as THREE.MeshBasicMaterial;
      bm.opacity = lerp(st ? st.blob : 0, 0.38, backT);
    }

    /* --- phases --- */
    const eGather = easeInOut(clamp01(t / 0.36)); // spread → accordion fan
    const eFold = easeInOut(clamp01((t - 0.32) / 0.32)); // fan → closed block
    const eDesc = easeInOut(clamp01((t - 0.62) / 0.38)); // descend + camera out

    /* --- orientation: upright the whole way; yaw face-in → bloom → bar --- */
    const BLOOM_YAW = -0.62;
    root.rotation.z = 0;
    obj.stand.rotation.x = HALF_PI;
    root.rotation.y =
      t < 0.32 ? lerp(0, BLOOM_YAW, eGather) : lerp(BLOOM_YAW, -HALF_PI, eFold);
    root.scale.setScalar(lerp(1, this.openStartScale, eDesc));

    /* --- position: float at eye level, then settle into the shelf slot --- */
    root.position.set(
      lerp(0, 0, eDesc),
      lerp(OPEN_CENTER_Y, SHELF_BASE_Y + SELECT_LIFT, eDesc),
      lerp(0, 0, eDesc),
    );

    /* --- re-center toward the closed book (cover-centered) --- */
    obj.offset.position.x = lerp(0, -JOURNAL_W / 2, eFold);

    /* --- cover folds shut (reverse of the bloom sweep) --- */
    const closedY = obj.coverPivot.userData.closedY as number;
    const coverSwing = 1 - easeInOut(clamp01((t - 0.02) / 0.34));
    obj.coverPivot.rotation.z = coverSwing * Math.PI;
    obj.coverPivot.position.y = lerp(
      closedY,
      COVER_T / 2 + 0.0002,
      easeInOut(clamp01((coverSwing - 0.5) / 0.5)),
    );

    /* --- sheets: chained stacks → accordion fan (gather) → closed block --- */
    obj.leftContent.visible = false;
    obj.rightContent.visible = false;
    const { sheets: S, stackTop } = journalDims(this.pageCount);
    const fanBaseY = COVER_T + stackTop * 0.42;
    for (let i = 0; i < S; i++) {
      const mesh = obj.sheets[i];
      mesh.visible = true;
      const rest = this.openSheetTarget(i, this.spread, stackTop);
      const restY = rest.y;
      const closedSlot = this.slotRight(i);
      const u = S <= 1 ? 0.5 : i / (S - 1);
      const bloomAngle = lerp(2.42, -0.52, u);
      const bloomY = fanBaseY + (i - S / 2) * SHEET_PITCH * 1.25;
      const bloomX = Math.cos(bloomAngle) * JOURNAL_W * 0.09;
      const bloomZ = Math.sin(bloomAngle) * JOURNAL_W * 0.035;
      const gx = lerp(rest.x, bloomX, eGather);
      const gy = lerp(restY, bloomY, eGather);
      const gz = lerp(0, bloomZ, eGather);
      const ga = lerp(rest.rz, bloomAngle, eGather);
      if (eFold <= 0) {
        mesh.position.set(gx, gy, gz);
        mesh.rotation.z = ga;
      } else {
        mesh.position.set(lerp(gx, 0, eFold), lerp(gy, closedSlot, eFold), lerp(gz, 0, eFold));
        mesh.rotation.z = lerp(ga, 0, eFold);
      }
      const face = obj.sheetFaces[i];
      if (face) face.visible = t < 0.68;
      const back = obj.sheetBacks[i];
      if (back) back.visible = t < 0.82;
    }

    this.setSpineFlat(obj, 1 - eFold);

    // floor shadow fades back out as the book descends
    const bmOpen = entry.blob.material as THREE.MeshBasicMaterial;
    bmOpen.opacity = 0.4 * (1 - eFold);

    /* --- camera: reading fit → pull out → shelf pose --- */
    const ocStart = this.openCamTarget();
    const barPos = new THREE.Vector3(0, OPEN_CENTER_Y + 0.05, 3.3);
    const barLook = new THREE.Vector3(0, OPEN_CENTER_Y, 0);
    if (t < 0.4) {
      const u = easeInOut(t / 0.4);
      this.camPos.lerpVectors(ocStart.pos, barPos, u);
      this.camLook.lerpVectors(ocStart.look, barLook, u);
      this.camFov = lerp(ocStart.fov, 34, u);
    } else if (t < 0.66) {
      this.camPos.copy(barPos);
      this.camLook.copy(barLook);
      this.camFov = 34;
    } else {
      const u = easeInOut((t - 0.66) / 0.34);
      this.camPos.lerpVectors(barPos, this.openCamStart.pos, u);
      this.camLook.lerpVectors(barLook, this.openCamStart.look, u);
      this.camFov = lerp(34, this.openCamStart.fov, u);
    }

    if (t >= 1) {
      this.mode = 'shelf';
      this.camPos.copy(this.openCamStart.pos);
      this.camLook.copy(this.openCamStart.look);
      this.camFov = this.openCamStart.fov;
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
      for (const f of obj.sheetFaces) f.visible = false;
      for (const b of obj.sheetBacks) b.visible = false;
      this.layoutAll();
      this.cb.onCloseComplete();
    }
  }

  private layoutAll(): void {
    this.order.forEach((id, i) => {
      const entry = this.journals.get(id);
      if (entry) this.layoutJournal(entry, i);
    });
  }

  /* ================================================================ */
  /* frame loop                                                        */
  /* ================================================================ */

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = this.clock.getElapsedTime();

    // shelf scroll easing + sway (reorder takes over the dragged book)
    if (this.mode === 'shelf') {
      this.scroll = lerp(this.scroll, this.scrollTarget, 0.14);
      // while reordering, remaining books fill the slots around the dragged
      // book's hover index so a gap opens under it
      const slots = this.order.map(() => -1);
      const reorder = this.reorder;
      if (reorder?.active) {
        // while returning, the gap slides back to the book's original slot
        const gapIdx = reorder.returning ? reorder.startIndex : reorder.currentIndex;
        let free = 0;
        this.order.forEach((id, j) => {
          if (id === reorder.id) return;
          while (free === gapIdx) free += 1;
          slots[j] = free;
          free += 1;
        });
      }
      this.order.forEach((id, i) => {
        const entry = this.journals.get(id);
        if (!entry) return;
        const dragging = this.reorder?.active && this.reorder.id === id;
        const fromCenter = dragging
          ? this.reorder!.bookX
          : (this.reorder?.active ? slots[i] : i) - this.scroll;
        const root = entry.obj.root;
        if (dragging && this.reorder) {
          const r = this.reorder;
          if (r.returning) {
            // escape-cancelled: glide back into the original slot, then hand
            // over to the normal shelf loop once converged
            const slotX = (r.startIndex - this.scroll) * SHELF_SPACING;
            r.bookX = lerp(r.bookX, slotX, 0.22);
            root.position.x = r.bookX;
            root.position.z = lerp(root.position.z, -Math.min(0.08, Math.abs(fromCenter) * 0.03), 0.2);
            root.position.y = lerp(root.position.y, SHELF_BASE_Y + SELECT_LIFT, 0.16);
            root.rotation.y = lerp(root.rotation.y, 0, 0.18);
            root.rotation.z = lerp(root.rotation.z, 0, 0.18);
            root.scale.setScalar(lerp(root.scale.x, 1, 0.16));
            entry.blob.position.set(root.position.x, 0.004, root.position.z + 0.05);
            entry.blob.scale.set(1.5, 1.7, 1);
            const bm = entry.blob.material as THREE.MeshBasicMaterial;
            bm.opacity = lerp(bm.opacity, 0.55, 0.16);
            if (Math.abs(r.bookX - slotX) < 0.012) this.reorder = null;
            return;
          }
          // lifted, slightly enlarged, gently wobbling — follows the pointer
          root.position.x = lerp(root.position.x, r.bookX, 0.35);
          root.position.z = lerp(root.position.z, 0.85, 0.2);
          root.position.y = lerp(root.position.y, SHELF_BASE_Y + 0.42, 0.2);
          root.rotation.y = lerp(root.rotation.y, Math.sin(now * 6) * 0.06, 0.2);
          root.rotation.z = lerp(root.rotation.z, -0.04, 0.2);
          root.scale.setScalar(lerp(root.scale.x, 1.1, 0.2));
          entry.blob.position.set(root.position.x, 0.004, root.position.z + 0.05);
          entry.blob.scale.set(1.8, 2.0, 1);
          const bm = entry.blob.material as THREE.MeshBasicMaterial;
          bm.opacity = lerp(bm.opacity, 0.6, 0.2);
          return;
        }
        if (this.reorder?.active) {
          // neighbors ease between slots so the reflow reads as a glide
          root.position.x = lerp(root.position.x, fromCenter * SHELF_SPACING, 0.3);
        } else {
          root.position.x = fromCenter * SHELF_SPACING;
        }
        root.position.z = -Math.min(0.08, Math.abs(fromCenter) * 0.03);
        const sway = Math.sin(now * 0.7 + i * 2.1) * 0.012;
        root.rotation.y = Math.max(-0.14, Math.min(0.14, -fromCenter * 0.045 - this.dragVelocity * 0.7 + sway));
        const isSelected = id === this.selectedId;
        const targetY = SHELF_BASE_Y + (isSelected ? SELECT_LIFT : 0);
        root.position.y = lerp(root.position.y, targetY, 0.14);
        root.scale.setScalar(lerp(root.scale.x, isSelected ? SELECT_SCALE : 1, 0.14));
        // recover from any lingering grid pose (flat book → stand back up)
        entry.obj.stand.rotation.x = lerp(entry.obj.stand.rotation.x, HALF_PI, 0.14);
        entry.obj.root.rotation.z = lerp(entry.obj.root.rotation.z, 0, 0.14);
        entry.obj.offset.position.x = lerp(entry.obj.offset.position.x, -JOURNAL_W / 2, 0.14);
        const sp = entry.obj.spine;
        if (sp.userData.baseY != null) {
          sp.scale.y = lerp(sp.scale.y, 1, 0.14);
          sp.position.y = lerp(sp.position.y, sp.userData.baseY as number, 0.14);
        }
        entry.blob.position.set(root.position.x, 0.004, root.position.z + 0.05);
        entry.blob.scale.set(1.15, 1.5, 1);
        const blobMat = entry.blob.material as THREE.MeshBasicMaterial;
        blobMat.opacity = lerp(blobMat.opacity, isSelected ? 0.42 : 0.26, 0.14);
      });
      this.dragVelocity *= 0.9;
    } else if (this.mode === 'grid') {
      this.updateGrid(now);
    } else if (this.mode === 'opening') {
      this.updateOpening(now);
    } else if (this.mode === 'open') {
      if (this.pageZoom?.active) {
        this.updatePageZoom(now);
      } else {
        if (this.spreadTween.active) this.updateSpreadTween();
        this.updateFlip(now);
        // gentle idle float of the open book + swipe-to-flip lean feedback
        const entry = this.openEntry;
        if (entry && !this.flip.active && !this.spreadTween.active) {
          const lean = this.openDragActive
            ? Math.max(-0.07, Math.min(0.07, -this.openDragX * 0.0007))
            : 0;
          entry.obj.offset.rotation.y = lerp(entry.obj.offset.rotation.y, lean, 0.25);
          if (!this.openDragActive) {
            entry.obj.root.position.y = OPEN_CENTER_Y + Math.sin(now * 0.8) * 0.008;
            entry.obj.root.rotation.z = Math.sin(now * 0.5) * 0.004;
          }
        }
      }
    } else if (this.mode === 'closing') {
      this.updateClosing(now);
    }

    // environment drift: wall color + floor pool follow the mode target;
    // the reading room also softens the sun's cast shadow on the floor
    // environment: the floor keeps only a whisper of shadow in reading mode
    // (the CSS backdrop behind the canvas handles the wall colors)
    const floorTarget = this.mode === 'shelf' || this.mode === 'grid' ? 0.16 : 0.05;
    this.floorMat.opacity = lerp(this.floorMat.opacity, floorTarget, 0.06);

    // tilt parallax (suppressed while the page is zoomed fullscreen)
    const zoomed = !!this.pageZoom?.active;
    if (zoomed) {
      this.tiltTargetX = 0;
      this.tiltTargetY = 0;
      this.tiltX = lerp(this.tiltX, 0, 0.2);
      this.tiltY = lerp(this.tiltY, 0, 0.2);
    } else {
      this.tiltX = lerp(this.tiltX, this.tiltTargetX, 0.06);
      this.tiltY = lerp(this.tiltY, this.tiltTargetY, 0.06);
    }
    const flipNudge = !zoomed && this.flip.active ? Math.sin((this.flip.dir === 1 ? easeOut(clamp01((now - this.flip.start) / FLIP_DUR)) : 1 - easeOut(clamp01((now - this.flip.start) / FLIP_DUR))) * Math.PI) * 0.06 * this.flip.dir : 0;
    this.camera.position.set(
      this.camPos.x + this.tiltX + flipNudge,
      this.camPos.y + this.tiltY,
      this.camPos.z,
    );
    this.camera.lookAt(this.camLook);
    if (Math.abs(this.camera.fov - this.camFov) > 0.01) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }

    this.updateScreenAnchor();
    this.sun.position.set(this.camPos.x - 2.2, 4.2, this.camPos.z + 2.6);
    this.renderer.render(this.scene, this.camera);
  };

  private anchorV = new THREE.Vector3();
  private updateScreenAnchor(): void {
    if (this.mode !== 'shelf' || !this.selectedId) {
      this.screenAnchor = null;
      return;
    }
    const entry = this.journals.get(this.selectedId);
    if (!entry) {
      this.screenAnchor = null;
      return;
    }
    const { stackTop } = journalDims(entry.dto.pageCount);
    // cover top-right corner in book-local space
    this.anchorV.set(JOURNAL_W * 0.94, stackTop + COVER_T * 0.5, -JOURNAL_H * 0.4);
    entry.obj.offset.localToWorld(this.anchorV);
    this.anchorV.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.screenAnchor = {
      x: ((this.anchorV.x + 1) / 2) * rect.width,
      y: ((1 - this.anchorV.y) / 2) * rect.height,
    };
  }

  private updateCameraFit(): void {
    if (this.mode !== 'shelf') return;
    const aspect = this.camera.aspect || 1;
    // long lens + straight-on = the app's flat presentation; books fill the
    // frame (landscape: 84% of height; portrait: ~64% of width so neighbor
    // slivers peek in from the screen edges)
    this.camFov = SHELF_FOV;
    const tanF = Math.tan((SHELF_FOV * Math.PI) / 360);
    const needH =
      aspect < 1
        ? JOURNAL_W / 0.64 / aspect
        : JOURNAL_H / 0.76;
    const dist = needH / (2 * tanF);
    this.camPos.set(0, SHELF_LOOK_Y, dist);
    this.camLook.set(0, SHELF_LOOK_Y, 0);
  }

  /* ================================================================ */
  /* events                                                            */
  /* ================================================================ */

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragLastX = e.clientX;
    this.dragLastY = e.clientY;
    this.dragMoved = 0;
    this.pointerDownInfo = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      id: this.selectedId ?? '',
    };
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // synthetic pointers / stale pointer ids can throw NotFoundError — safe to ignore
    }
    // open mode: arm swipe-to-flip
    if (this.mode === 'open' && !this.flip.active && !this.spreadTween.active && !this.pageZoom?.active) {
      this.openDragActive = true;
      this.openDragX = 0;
    }
    // shelf + grid: long-press arms drag-to-reorder
    if ((this.mode === 'shelf' || this.mode === 'grid') && !this.reorder?.active && this.selectedId) {
      const hit = this.pickJournal(e);
      if (hit === this.selectedId) {
        const idx = this.order.indexOf(hit);
        if (idx >= 0) {
          if (this.reorderTimer != null) window.clearTimeout(this.reorderTimer);
          this.reorderTimer = window.setTimeout(() => {
            if (this.dragging && this.dragMoved <= 7 && (this.mode === 'shelf' || this.mode === 'grid')) {
              if (this.mode === 'grid') {
                // flat table-top overview: drag in world X/Z on the lift plane
                const p = this.planePoint(this.dragLastX, this.dragLastY, REORDER_LIFT_Y);
                if (!p) return;
                const cols = this.gridCols();
                const gapX = JOURNAL_W * 1.26;
                const gapZ = JOURNAL_H * 1.12;
                const col = idx % cols;
                const row = Math.floor(idx / cols);
                this.reorder = {
                  active: true,
                  id: hit,
                  startIndex: idx,
                  currentIndex: idx,
                  grabX: p.x,
                  grabZ: p.z,
                  bookX: (col - (cols - 1) / 2) * gapX,
                  bookZ: (row - (this.gridRows() - 1) / 2) * gapZ + this.gridScroll * gapZ,
                  moved: false,
                  returning: false,
                  grid: true,
                  startBookX: (col - (cols - 1) / 2) * gapX,
                  startBookZ: (row - (this.gridRows() - 1) / 2) * gapZ + this.gridScroll * gapZ,
                };
              } else {
                this.reorder = {
                  active: true,
                  id: hit,
                  startIndex: idx,
                  currentIndex: idx,
                  grabX: this.dragLastX,
                  grabZ: 0,
                  bookX: (idx - this.scroll) * SHELF_SPACING,
                  bookZ: 0,
                  moved: false,
                  returning: false,
                  grid: false,
                  startBookX: (idx - this.scroll) * SHELF_SPACING,
                  startBookZ: 0,
                };
              }
              playTap();
            }
          }, 480);
        }
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    // tilt target from pointer position (frozen while reordering so the
    // world-space drag mapping stays stable and 1:1 with the pointer)
    const reordering = !!this.reorder?.active;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    if (reordering) {
      this.tiltTargetX = 0;
      this.tiltTargetY = 0;
    } else {
      this.tiltTargetX = this.tiltEnabled ? nx * 0.12 : 0;
      this.tiltTargetY = this.tiltEnabled ? -ny * 0.07 : 0;
    }

    if (!this.dragging) return;
    const dx = e.clientX - this.dragLastX;
    const dy = e.clientY - this.dragLastY;
    this.dragLastX = e.clientX;
    this.dragLastY = e.clientY;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    if (this.reorder?.active) {
      const r = this.reorder;
      if (!r.returning) {
        if (r.grid) {
          // table-top overview: the lifted book follows the pointer over the
          // lift plane; its slot (and currentIndex) follows the book.
          const p = this.planePoint(e.clientX, e.clientY, REORDER_LIFT_Y);
          if (p) {
            const cols = this.gridCols();
            const rows = this.gridRows();
            const gapX = JOURNAL_W * 1.26;
            const gapZ = JOURNAL_H * 1.12;
            const halfW = ((cols - 1) / 2) * gapX;
            const halfZ = ((rows - 1) / 2) * gapZ + this.gridScroll * gapZ;
            const over = gapX * 0.55; // rubber zone past the outer slots
            let x = r.startBookX + (p.x - r.grabX);
            let z = r.startBookZ + (p.z - r.grabZ);
            x = Math.max(-halfW - over, Math.min(halfW + over, x));
            z = Math.max(-halfZ - over, Math.min(halfZ + over, z));
            r.bookX = x;
            r.bookZ = z;
            r.moved = true;
            const col = Math.max(0, Math.min(cols - 1, Math.round(x / gapX + (cols - 1) / 2)));
            const row = Math.max(
              0,
              Math.min(rows - 1, Math.round((z - this.gridScroll * gapZ) / gapZ + (rows - 1) / 2)),
            );
            r.currentIndex = Math.max(0, Math.min(this.order.length - 1, row * cols + col));
          }
          return;
        }
        // shelf: drag the lifted book; its slot follows the pointer position.
        // rubber-band: free movement inside the slot range, damped overshoot
        // past the ends so the first/last book can't be flung offscreen.
        const minX = (0 - this.scroll) * SHELF_SPACING;
        const maxX = (this.order.length - 1 - this.scroll) * SHELF_SPACING;
        const over = SHELF_SPACING * 0.55;
        // 1:1 inside the slot range, damped in the rubber zone, hard stop at ±0.55 slot
        const outside = r.bookX < minX || r.bookX > maxX;
        let x = r.bookX + dx * 0.011 * (outside ? 0.3 : 1);
        if (x < minX - over) x = minX - over;
        else if (x > maxX + over) x = maxX + over;
        r.bookX = x;
        r.moved = true;
        r.currentIndex = Math.max(
          0,
          Math.min(this.order.length - 1, Math.round(r.bookX / SHELF_SPACING + this.scroll)),
        );
      }
      return;
    }
    if (this.mode === 'shelf') {
      this.scrollTarget = this.scrollTarget - dx * 0.011;
      this.scrollTarget = Math.max(-0.35, Math.min(this.order.length - 1 + 0.35, this.scrollTarget));
      this.dragVelocity = lerp(this.dragVelocity, -dx * 0.02, 0.4);
    } else if (this.mode === 'grid') {
      // vertical pan between rows (drag up → reveal later rows)
      this.gridScrollTarget += dy * 0.006;
      const maxScroll = Math.max(0, this.gridRows() - 1);
      this.gridScrollTarget = Math.max(0, Math.min(maxScroll, this.gridScrollTarget));
    } else if (this.mode === 'open' && this.openDragActive) {
      this.openDragX += dx;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    const wasDrag = this.dragMoved > 7;
    const info = this.pointerDownInfo;
    this.pointerDownInfo = null;
    if (this.reorderTimer != null) {
      window.clearTimeout(this.reorderTimer);
      this.reorderTimer = null;
    }
    if (this.reorder?.active) {
      const r = this.reorder;
      if (r.returning) {
        // escape-cancelled: let the glide-back finish in the shelf/grid loop
        return;
      }
      this.reorder = null;
      if (r.currentIndex !== r.startIndex) {
        // persist the new order: move id from startIndex to currentIndex
        const ids = this.order.filter((x) => x !== r.id);
        ids.splice(r.currentIndex, 0, r.id);
        this.order = ids;
        if (this.mode === 'shelf') {
          this.scrollTarget = Math.max(0, Math.min(this.order.length - 1, r.currentIndex));
          this.layoutAll();
        }
        this.selectedId = r.id;
        this.cb.onReorder?.(r.id, r.currentIndex);
        playTap();
      }
      return;
    }
    if (this.mode === 'shelf') {
      // snap to nearest
      this.scrollTarget = Math.max(0, Math.min(this.order.length - 1, Math.round(this.scrollTarget)));
      const newSel = this.order[Math.round(this.scrollTarget)] ?? null;
      if (newSel && newSel !== this.selectedId) {
        this.selectedId = newSel;
        this.cb.onJournalSelect(newSel);
        playTap();
      }
    }
    // open mode: horizontal swipe flips pages
    if (this.mode === 'open' && this.openDragActive) {
      this.openDragActive = false;
      if (wasDrag && Math.abs(this.openDragX) > 45 && !this.flip.active && !this.spreadTween.active) {
        const dir: 1 | -1 = this.openDragX < 0 ? 1 : -1;
        if (!this.flipPage(dir)) playTap();
        this.openDragX = 0;
        return;
      }
      this.openDragX = 0;
    }
    if ((this.mode === 'shelf' || this.mode === 'grid') && !wasDrag && info) {
      const hit = this.pickJournal(e);
      if (hit) {
        if (hit === this.selectedId) {
          const now = performance.now();
          if (this.lastTapTarget === hit && now - this.lastTapTime < 600) {
            // double tap selected -> open immediately
            this.cb.onJournalTap(hit);
          } else {
            this.cb.onJournalTap(hit);
          }
          this.lastTapTime = now;
          this.lastTapTarget = hit;
        } else {
          this.selectedId = hit;
          if (this.mode === 'shelf') {
            this.scrollTarget = this.order.indexOf(hit);
          }
          this.cb.onJournalSelect(hit);
          playTap();
        }
      }
      return;
    }
    if (this.mode === 'open' && !wasDrag && info) {
      this.handleOpenTap(e);
    }
  };

  private handleOpenTap(e: PointerEvent): void {
    if (this.pageZoom?.active) {
      // any tap while a page is fullscreen zooms back out to the spread
      if (!this.pageZoom.out) this.zoomOutPage();
      return;
    }
    if (this.flip.active) return;
    const hit = this.pickSpread(e);
    if (!hit) return;
    const { side, bookX } = hit;
    // page center zone -> edit page; anywhere else on a page -> flip
    const pageCenterX = side === 1 ? JOURNAL_W / 2 : -JOURNAL_W / 2;
    const inCenterX = Math.abs(bookX - pageCenterX) < JOURNAL_W * 0.21;
    const inCenterZ = Math.abs(hit.localZ) < JOURNAL_H * 0.3;
    if (inCenterX && inCenterZ) {
      const pageIndex = side === 1 ? 2 * this.spread + 1 : 2 * this.spread;
      if (pageIndex >= 0 && pageIndex < this.pageCount) {
        const now = performance.now();
        this.lastTapTime = now;
        this.lastTapTarget = `p${pageIndex}`;
        this.cb.onEditPage(pageIndex); // tap page center = edit (Paper behavior)
      }
      return;
    }
    const dir: 1 | -1 = side === 1 ? 1 : -1;
    if (!this.flipPage(dir)) playTap();
  }

  private pickJournal(e: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData && typeof o.userData.journalId === 'string' && o.userData.journalId) {
          return o.userData.journalId as string;
        }
        o = o.parent;
      }
    }
    return null;
  }

  /** World point on a horizontal plane under a client-space pointer.
   *  planeY defaults to the table (0); the reorder drag uses the lift height
   *  so the hovering book lands exactly under the cursor. */
  private planePoint(clientX: number, clientY: number, planeY = 0): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, p) ? p : null;
  }

  private pickSpread(e: PointerEvent): { side: 1 | -1; bookX: number; localZ: number } | null {
    const entry = this.openEntry;
    if (!entry) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [
      entry.obj.tapZoneR,
      entry.obj.tapZoneL,
      ...entry.obj.sheets,
      entry.obj.rightContent,
      entry.obj.leftContent,
      entry.obj.rightWell,
      entry.obj.coverPivot,
      entry.obj.flipGroup,
    ];
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return null;
    // offset local space: spine at x=0; right page spans 0..W, left page -W..0
    const p = entry.obj.offset.worldToLocal(hits[0].point.clone());
    // clamp into the page rect so edge taps map onto the nearest page point
    const clampedX = Math.max(-JOURNAL_W, Math.min(JOURNAL_W, p.x));
    const side: 1 | -1 = clampedX >= 0 ? 1 : -1;
    return { side, bookX: clampedX, localZ: Math.max(-JOURNAL_H / 2, Math.min(JOURNAL_H / 2, p.z)) };
  }

  private bindEvents(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.onWinResize);
    window.addEventListener('deviceorientation', this.onDeviceOrientation);
  }

  private unbindEvents(): void {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('resize', this.onWinResize);
    window.removeEventListener('deviceorientation', this.onDeviceOrientation);
  }

  private onWinResize = (): void => {
    this.resize();
  };

  private onDeviceOrientation = (e: DeviceOrientationEvent): void => {
    if (!this.tiltEnabled || e.gamma == null || e.beta == null) return;
    this.tiltTargetX = Math.max(-1, Math.min(1, e.gamma / 30)) * 0.14;
    this.tiltTargetY = Math.max(-1, Math.min(1, (e.beta - 45) / 40)) * 0.08;
  };
}
