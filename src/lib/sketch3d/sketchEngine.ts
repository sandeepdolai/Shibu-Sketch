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
  buildJournal,
  journalDims,
  applyPageTexture,
  type JournalObject,
  type PageTextureProvider,
} from './journalObject';
import { bendSheet } from './sheetGeom';
import { getShadowBlobTexture, getGutterShadowTexture, makeCoverTexture, makeFloorPoolTexture } from './art';
import { renderPageContentToCanvas } from '@/lib/sketch/render';
import type { JournalDTO, JournalDetailDTO, PageContent } from '@/lib/sketch/types';
import { parsePageContent } from '@/lib/sketch/types';
import { playFlip, playTap } from './sfx';

const HALF_PI = Math.PI / 2;
const SHELF_SPACING = 1.16;
const SHELF_BASE_Y = JOURNAL_H / 2 + 0.02;
const SELECT_LIFT = 0.13;
/** height the selected book lifts to as the fore-edge bar before blooming */
const OPEN_LIFT = 0.3;
/** choreography timings tuned against the reference recording:
 *  slide-away ≈ 0.45s → bloom pop ≈ 0.2s → flatten ≈ 0.33s → settle */
const OPEN_DUR = 1.15;
const CLOSE_DUR = 0.68;
const FLIP_DUR = 0.4;
const SELECT_DUR = 0.45;

const easeInOut = (t: number): number => t * t * (3 - 2 * t);
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Q_IDENTITY = new THREE.Quaternion();

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
  grabX: number; // pointer x at press
  bookX: number; // book x at press
  moved: boolean;
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
  /** camera pose captured at openJournal (shelf pose) for absolute lerps */
  private openCamStart = { pos: new THREE.Vector3(0, 1.06, 5.2), look: new THREE.Vector3(0, 0.7, 0), fov: 33 };

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

  /* transient cam */
  private camPos = new THREE.Vector3(0, 1.06, 5.2);
  private camLook = new THREE.Vector3(0, 0.7, 0);
  private camFov = 33;

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

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'pan-y';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(33, 1, 0.05, 60);
    this.camera.position.copy(this.camPos);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a87a0, 1.05);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
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
    const rim = new THREE.DirectionalLight(0xfff3e0, 0.5);
    rim.position.set(2.5, 2.0, -1.5);
    this.scene.add(rim);

    // shadow-catcher floor
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.22 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), floorMat);
    floor.rotation.x = -HALF_PI;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // wide, soft pool of warm light grounding the shelf (reading-room feel)
    const poolTex = makeFloorPoolTexture();
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 4.6),
      new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    pool.rotation.x = -HALF_PI;
    pool.position.set(0, 0.002, 0.35);
    this.scene.add(pool);

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
    this.openCamStart = {
      pos: this.camPos.clone(),
      look: this.camLook.clone(),
      fov: this.camFov,
    };
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
    // pose directly in open state
    entry.obj.stand.rotation.x = 0;
    entry.obj.root.position.set(0, 0, 0);
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
    this.camFov = 33;
    this.updateCameraFit();
    this.camPos.set(0, 1.06, 5.2);
    this.camPos.y = 1.02;
    this.camPos.x = 0;
    this.camLook.set(0, 0.7, 0);
    this.layoutAll();
    for (const [, j] of this.journals) {
      j.obj.root.visible = true;
      j.blob.visible = true;
      (j.blob.material as THREE.MeshBasicMaterial).opacity = 0.38;
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
    const gapX = JOURNAL_W * 1.26;
    const gapZ = JOURNAL_H * 1.12;
    this.order.forEach((id, i) => {
      const entry = this.journals.get(id);
      if (!entry) return;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = (col - (cols - 1) / 2) * gapX;
      const z = (row - (this.gridRows() - 1) / 2) * gapZ + this.gridScroll * gapZ;
      const root = entry.obj.root;
      root.position.x = lerp(root.position.x, x, 0.14);
      root.position.y = lerp(root.position.y, id === this.selectedId ? 0.085 : 0.012, 0.14);
      root.position.z = lerp(root.position.z, z, 0.14);
      root.rotation.y = lerp(root.rotation.y, 0, 0.14);
      root.rotation.z = lerp(root.rotation.z, 0, 0.14);
      entry.obj.stand.rotation.x = lerp(entry.obj.stand.rotation.x, 0, 0.14);
      this.setSpineFlat(entry.obj, 1);
      entry.blob.visible = true;
      entry.blob.position.set(root.position.x, 0.004, root.position.z + 0.06);
      const bm = entry.blob.material as THREE.MeshBasicMaterial;
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

  /** Camera target hovering the chosen page so the page overfills the view. */
  private pageZoomTarget(side: 1 | -1): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
    const entry = this.openEntry;
    if (!entry) return { pos: this.camPos.clone(), look: this.camLook.clone(), fov: this.camFov };
    const { sheets: S } = journalDims(this.pageCount);
    const topY =
      side === 1
        ? COVER_T + S * SHEET_T - this.spread * SHEET_T + SHEET_T / 2
        : COVER_T + this.spread * SHEET_T + SHEET_T / 2;
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
    // a hair of Z offset keeps lookAt stable and the gutter vertical on screen
    const pos = center.clone().add(new THREE.Vector3(0, dist, dist * 0.045));
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
    entry.obj.root.position.y = 0;
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
      this.layoutStaticSheets(this.spread, this.spread + 1, this.spread);
    } else {
      // flying sheet (k-1) leaves the left stack
      this.layoutStaticSheets(this.spread - 1, this.spread, this.spread - 1);
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
    const stackTop = COVER_T + S * SHEET_T;
    const kMax = this.spreadCount() - 1;
    const k0 = Math.max(0, Math.min(Math.floor(f), kMax));
    const k1 = Math.min(k0 + 1, kMax);
    const u = easeInOut(clamp01(f - k0));
    for (let i = 0; i < S; i++) {
      const mesh = obj.sheets[i];
      mesh.visible = true;
      const pose = (k: number): { y: number; rz: number } => {
        if (i < k) {
          const depth = k - 1 - i;
          return {
            y: COVER_T + (i + 0.5) * SHEET_T,
            rz: depth === 0 ? Math.PI : Math.PI + this.fanAngle(depth),
          };
        }
        const depth = i - k;
        return {
          y: stackTop - (i + 0.5) * SHEET_T,
          rz: depth === 0 ? 0 : -this.fanAngle(depth),
        };
      };
      const a = pose(k0);
      const b = pose(k1);
      mesh.position.y = lerp(a.y, b.y, u);
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
    const coverMat = new THREE.MeshPhysicalMaterial({
      color: dto.coverStyle.color,
      roughness: 0.62,
      clearcoat: 0.25,
      clearcoatRoughness: 0.5,
    });
    const coverArtMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.55,
      clearcoat: 0.3,
      clearcoatRoughness: 0.45,
    });
    const artTex = makeCoverTexture(dto.coverStyle);
    coverArtMat.map = artTex;
    coverArtMat.needsUpdate = true;

    const obj = buildJournal({
      pageCount: Math.max(2, dto.pageCount),
      coverMaterial: coverMat,
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
    blob.scale.set(1.5, 1.7, 1);
    this.scene.add(blob);

    const entry: ShelfEntry = { dto, obj, coverMat, coverArtMat, blob };
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
    entry.coverArtMat.dispose();
    entry.obj.dispose();
    this.journals.delete(id);
  }

  private layoutJournal(entry: ShelfEntry, index: number): void {
    const fromCenter = index - this.scroll;
    const root = entry.obj.root;
    root.position.x = fromCenter * SHELF_SPACING;
    root.position.z = -Math.min(0.55, Math.abs(fromCenter) * 0.22);
    root.rotation.y = Math.max(-0.4, Math.min(0.4, -fromCenter * 0.16));
    const isSelected = entry.dto.id === this.selectedId;
    root.position.y = SHELF_BASE_Y + (isSelected && this.mode === 'shelf' ? SELECT_LIFT : 0);
    if (this.mode === 'shelf') root.scale.setScalar(1);
    entry.blob.visible = true;
    entry.blob.position.set(root.position.x, 0.004, root.position.z + 0.05);
    const s = root.scale.x;
    entry.blob.scale.set(1.5 * s, 1.7 * s, 1);
    (entry.blob.material as THREE.MeshBasicMaterial).opacity =
      (isSelected ? 0.55 : 0.38) * s;
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
    const canvas = renderPageContentToCanvas(content, 620, 868, this.paperColor);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    if (variant === 'left') {
      tex.flipY = false; // left geometry is Y-mirrored
    } else if (variant === 'flip') {
      tex.center.set(0.5, 0.5);
      tex.rotation = Math.PI;
    }
    this.pageTexCache.set(key, tex);
    return tex;
  }

  /** Open-pose camera direction (keeps the desktop viewing angle). */
  private openCamDir = new THREE.Vector3(0, 0.655, 0.757);

  /** Open-pose camera target — fits the whole spread at ANY aspect ratio.
   *  Distance solves both the vertical (page depth) and horizontal
   *  (both pages) constraints; portrait phones pull way back. */
  private openCamTarget(): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
    const aspect = this.camera.aspect || 1;
    const fov = aspect < 0.9 ? 44 : 36;
    const tanF = Math.tan((fov * Math.PI) / 360);
    const needV = JOURNAL_H * 1.38; // page depth + breathing room
    const needW = JOURNAL_W * 2 + 0.3; // both pages + margin
    const dist = Math.max(needV / (2 * tanF), needW / (2 * tanF * aspect));
    return {
      pos: new THREE.Vector3(
        this.openCamDir.x * dist,
        this.openCamDir.y * dist,
        this.openCamDir.z * dist,
      ),
      look: new THREE.Vector3(0, 0.03, 0),
      fov,
    };
  }

  /** Fan angle for a sheet `depth` steps below its stack's top sheet.
   *  Gentle ribbed cascade (reference shows ~6-14deg per sheet — deep dips
   *  pierce the back cover and the table). */
  private fanAngle(depth: number): number {
    return Math.min(0.4, 0.09 + Math.max(0, depth - 1) * 0.045);
  }

  /** Lay out stacks + content planes for a spread. */
  private layoutOpenSpread(k: number, _instant: boolean): void {
    const entry = this.openEntry;
    if (!entry) return;
    const obj = entry.obj;
    const { sheets: S } = journalDims(this.pageCount);

    // sheets: left pile 0..k-1 (re-piled on the opened cover), right stack k..S-1
    const stackTop = COVER_T + S * SHEET_T;
    for (let i = 0; i < S; i++) {
      const mesh = obj.sheets[i];
      mesh.visible = true;
      if (i < k) {
        const depth = k - 1 - i; // 0 = top of the left pile
        mesh.position.set(0, COVER_T + (i + 0.5) * SHEET_T, 0);
        // PI + theta dips the fore-edge BELOW the page plane (mirrors the
        // right stack). PI - theta would sweep the fan UP over the content.
        mesh.rotation.z = depth === 0 ? Math.PI : Math.PI + this.fanAngle(depth);
      } else {
        const depth = i - k; // 0 = top of the right stack
        mesh.position.set(0, stackTop - (i + 0.5) * SHEET_T, 0);
        mesh.rotation.z = depth === 0 ? 0 : -this.fanAngle(depth);
      }
    }
    // center the open spread on the spine
    obj.offset.position.x = 0;

    // content planes (only revealed in open mode; hidden while closed/opening)
    const leftIdx = 2 * k;
    const rightIdx = 2 * k + 1;
    // tops: sheet slab spans [slot, slot + t] -> top = slot + t = stackTop - k*t + t/2 (right)
    const leftTopY = COVER_T + k * SHEET_T + SHEET_T / 2; // top of the left pile (sheet k-1)
    const rightTopY = stackTop - k * SHEET_T + SHEET_T / 2; // top of the right stack (sheet k)
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
    for (const f of obj.sheetFaces) f.visible = false;

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
    obj.coverPivot.rotation.z = Math.PI;
    obj.coverPivot.position.y = COVER_T / 2 + 0.0006;
  }

  /** Lay out the static sheet stacks while a sheet is flying. */
  private layoutStaticSheets(leftCount: number, rightFrom: number, flyingIdx: number): void {
    const entry = this.openEntry;
    if (!entry) return;
    const obj = entry.obj;
    const { sheets: S } = journalDims(this.pageCount);
    const stackTop = COVER_T + S * SHEET_T;
    for (let i = 0; i < S; i++) {
      const mesh = obj.sheets[i];
      if (i === flyingIdx) {
        mesh.visible = false;
      } else if (i < leftCount) {
        mesh.visible = true;
        const depth = leftCount - 1 - i;
        mesh.position.set(0, COVER_T + (i + 0.5) * SHEET_T, 0);
        mesh.rotation.z = depth === 0 ? Math.PI : Math.PI + this.fanAngle(depth);
      } else if (i >= rightFrom) {
        mesh.visible = true;
        const depth = i - rightFrom;
        mesh.position.set(0, stackTop - (i + 0.5) * SHEET_T, 0);
        mesh.rotation.z = depth === 0 ? 0 : -this.fanAngle(depth);
      }
    }
    // during flight the static content planes hide (the flying sheet shows its faces)
    obj.leftContent.visible = false;
    obj.rightContent.visible = false;
  }

  private prepareFlipSheet(k: number, dir: 1 | -1): void {
    const entry = this.openEntry;
    if (!entry) return;
    const obj = entry.obj;
    const { sheets: S } = journalDims(this.pageCount);
    const stackTop = COVER_T + S * SHEET_T;
    obj.flipGroup.visible = true;
    obj.flipGroup.position.y =
      dir === 1 ? stackTop - (k + 0.5) * SHEET_T : COVER_T + (k - 0.5) * SHEET_T;
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
    bendSheet(obj.flipFront.geometry, dir === 1 ? 0 : Math.PI, 0.9, dir === 1 ? 1 : -1);
    bendSheet(obj.flipBack.geometry, dir === 1 ? 0 : Math.PI, 0.9, dir === 1 ? 1 : -1);
    bendSheet(obj.flipEdge.geometry, dir === 1 ? 0 : Math.PI, 0.9, dir === 1 ? 1 : -1);
  }

  private updateFlip(now: number): void {
    if (!this.flip.active || !this.openEntry) return;
    const entry = this.openEntry;
    const obj = entry.obj;
    const t = clamp01((now - this.flip.start) / FLIP_DUR);
    const e = easeOut(t);
    const { dir, from } = this.flip;
    const theta = dir === 1 ? e * Math.PI : (1 - e) * Math.PI;

    bendSheet(obj.flipFront.geometry, theta, 0.95, dir === 1 ? 1 : -1);
    bendSheet(obj.flipBack.geometry, theta, 0.95, dir === 1 ? 1 : -1);
    bendSheet(obj.flipEdge.geometry, theta, 0.95, dir === 1 ? 1 : -1);
    // the underside plane becomes visible once it rotates past vertical
    obj.flipBack.visible = theta > HALF_PI * 1.03;

    // moving shadow that follows the curling page across the spread
    const flipY = COVER_T + (this.flip.dir === 1
      ? (journalDims(this.pageCount).sheets - this.flip.from - 0.5) * SHEET_T
      : (this.flip.from - 0.5) * SHEET_T);
    const stackTopNow = COVER_T + journalDims(this.pageCount).sheets * SHEET_T;
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
   *  1. SLIDE  (0 → 0.40)  neighbors glide off horizontally at shelf height
   *     while the selected book lifts and yaws a quarter-turn into the
   *     fore-edge "bar" pose (spine vertical at back, page block to camera).
   *  2. BLOOM  (0.40 → 0.57) the cover + sheets POP open around the vertical
   *     spine into a symmetric standing fan (left pages sweep wide, right
   *     stack cracks open slightly).
   *  3. FLATTEN (0.57 → 0.86) the standing fan tips over onto the table via a
   *     single quaternion slerp while sheets cascade into their stacks.
   *  4. SETTLE (0.86 → 1.0) camera dollies into the final reading fit.
   */
  private updateOpening(now: number): void {
    const entry = this.openEntry;
    if (!entry) return;
    const t = clamp01((now - this.transitionStart) / OPEN_DUR);
    const obj = entry.obj;
    const root = obj.root;

    /* --- neighbors slide away: fast, horizontal, at shelf height --- */
    const outT = easeOut(clamp01(t / 0.36));
    const myIdx = this.order.indexOf(entry.dto.id);
    for (const [id, j] of this.journals) {
      if (id === entry.dto.id) continue;
      const idx = this.order.indexOf(id);
      const dirSign = idx < myIdx ? -1 : 1;
      const st = this.slideStart.get(id);
      const x0 = st ? st.x : j.obj.root.position.x;
      const y0 = st ? st.y : j.obj.root.position.y;
      j.obj.root.position.x = lerp(x0, dirSign * 6.8, outT);
      j.obj.root.position.y = lerp(y0, SHELF_BASE_Y, outT);
      j.obj.root.rotation.y = lerp(j.obj.root.rotation.y, 0, outT);
      const bm = j.blob.material as THREE.MeshBasicMaterial;
      bm.opacity = Math.max(0, (st ? st.blob : 0.38) * (1 - outT));
    }

    /* --- phase easings --- */
    const eSlide = easeInOut(clamp01(t / 0.4));
    const eBloom = easeOutCubic(clamp01((t - 0.4) / 0.17));
    const eFlat = easeInOut(clamp01((t - 0.57) / 0.29));
    const eSettle = easeInOut(clamp01((t - 0.86) / 0.14));

    /* --- stand: settle into the vertical bar (grid opens stand up here) --- */
    obj.stand.rotation.x =
      eFlat <= 0 ? lerp(this.openStartStand, HALF_PI, eSlide) : HALF_PI * (1 - eFlat);

    /* --- root: lift + quarter-turn yaw to the fore-edge bar --- */
    const baseY = this.openStartRootY || SHELF_BASE_Y + SELECT_LIFT;
    const liftY = SHELF_BASE_Y + OPEN_LIFT;
    root.position.y = eFlat <= 0 ? lerp(baseY, liftY, eSlide) : lerp(liftY, 0, eFlat);
    root.position.x = lerp(root.position.x, 0, eSlide);
    root.position.z = lerp(root.position.z, 0, eSlide);
    root.rotation.z = lerp(this.openStartRoll, 0, eSlide);
    root.scale.setScalar(eFlat <= 0 ? lerp(1, 1.02, eSlide) : lerp(1.02, 1, eFlat));

    if (eFlat <= 0) {
      // euler branch: bar pose (cover swings around the vertical spine)
      root.rotation.y = lerp(this.openStartYaw, -HALF_PI, eSlide);
    } else {
      // quaternion branch: single slerp from the bloomed bar to flat
      const qStand = new THREE.Quaternion().setFromAxisAngle(X_AXIS, HALF_PI * (1 - eFlat));
      const qBar = new THREE.Quaternion()
        .setFromAxisAngle(Y_AXIS, -HALF_PI)
        .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, HALF_PI));
      const qWorld = qBar.slerp(Q_IDENTITY, eFlat);
      root.quaternion.copy(qWorld).multiply(qStand.clone().invert());
    }

    // re-center: closed book centers on its cover; open spread centers on the spine
    obj.offset.position.x = eFlat <= 0 ? -JOURNAL_W / 2 : lerp(-JOURNAL_W / 2, 0, eFlat);

    /* --- cover: swings open around the spine while blooming --- */
    const closedY = obj.coverPivot.userData.closedY as number;
    const openY = COVER_T / 2 + 0.0006;
    const coverBloom = 1.85; // ~106deg — cover points left-back mid-bloom (reference pose)
    obj.coverPivot.rotation.z =
      eFlat <= 0
        ? eBloom * coverBloom
        : lerp(coverBloom, Math.PI, easeOut(clamp01(eFlat * 1.8)));
    obj.coverPivot.position.y = lerp(closedY, openY, easeInOut(clamp01((eBloom - 0.35) / 0.55)));

    /* --- sheets: closed block → bloom fan → cascade into stacks --- */
    const { sheets: S } = journalDims(this.pageCount);
    const stackTop = COVER_T + S * SHEET_T;
    for (let i = 0; i < S; i++) {
      const mesh = obj.sheets[i];
      mesh.visible = true;
      const left = i < this.spread;
      const d = left ? this.spread - 1 - i : i - this.spread;
      const bloomAngle = left ? 1.15 + d * 0.34 : -(0.32 + d * 0.09);
      const restAngle = left ? Math.PI + this.fanAngle(d) : -this.fanAngle(d);
      const closedSlot = stackTop - (i + 0.5) * SHEET_T;
      const restY = left ? COVER_T + (i + 0.5) * SHEET_T : closedSlot;
      mesh.position.y = eFlat <= 0 ? closedSlot : lerp(closedSlot, restY, eFlat);
      mesh.rotation.z =
        eFlat <= 0 ? bloomAngle * eBloom : lerp(bloomAngle, restAngle, eFlat);
      const face = obj.sheetFaces[i];
      if (face) face.visible = t > 0.42 && t < 0.99;
    }

    // spine flattens into the gutter as the book lays down
    this.setSpineFlat(obj, eFlat);

    /* --- camera: shelf pose → slight push-in (hold) → arc up → dolly in --- */
    const oc = this.openCamTarget();
    if (t < 0.57) {
      const u = easeInOut(clamp01(t / 0.4));
      this.camPos.set(
        0,
        lerp(this.openCamStart.pos.y, 1.0, u),
        lerp(this.openCamStart.pos.z, 4.8, u),
      );
      this.camLook.set(0, lerp(this.openCamStart.look.y, 0.64, u), 0);
      this.camFov = lerp(this.openCamStart.fov, 34, u);
    } else {
      const mid = easeInOut(clamp01((t - 0.57) / 0.29));
      const startPos = new THREE.Vector3(0, 1.0, 4.8);
      const startLook = new THREE.Vector3(0, 0.64, 0);
      const farPos = oc.pos.clone().multiplyScalar(0.94);
      const endPos = farPos.lerp(oc.pos, eSettle);
      this.camPos.lerpVectors(startPos, endPos, mid);
      this.camLook.lerpVectors(startLook, oc.look, mid);
      this.camFov = lerp(34, oc.fov, mid);
    }

    if (t >= 1) {
      this.mode = 'open';
      root.position.set(0, 0, 0);
      root.quaternion.identity();
      root.rotation.set(0, 0, 0);
      root.scale.setScalar(1);
      obj.stand.rotation.x = 0;
      obj.offset.position.x = 0;
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
   * CLOSE choreography (the open run in reverse, snappier — matched to the
   * reference): the flat spread rises back into the standing fan while the
   * camera pulls up, the fan folds into the closed bar, the bar spins back
   * cover-forward and settles into the shelf as the neighbors return.
   */
  private updateClosing(now: number): void {
    const entry = this.openEntry;
    if (!entry) return;
    const t = clamp01((now - this.transitionStart) / CLOSE_DUR);
    const obj = entry.obj;
    const root = obj.root;

    /* --- neighbors return (t 0.45..1) --- */
    const backT = easeInOut(clamp01((t - 0.45) / 0.5));
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
    const eTip = easeInOut(clamp01(t / 0.42)); // flat → standing fan
    const eFold = easeInOut(clamp01((t - 0.3) / 0.4)); // fan → closed bar
    const eYaw = easeInOut(clamp01((t - 0.55) / 0.45)); // bar spins cover-forward + settles

    /* --- orientation: world slerp I → bar, then the quarter-turn back --- */
    const qStand = new THREE.Quaternion().setFromAxisAngle(X_AXIS, HALF_PI * eTip);
    const qBar = new THREE.Quaternion()
      .setFromAxisAngle(Y_AXIS, -HALF_PI)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, HALF_PI));
    const qWorld = Q_IDENTITY.clone().slerp(qBar, eTip);
    if (eYaw > 0) {
      const qSpin = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, HALF_PI * eYaw);
      qWorld.premultiply(qSpin);
    }
    root.quaternion.copy(qWorld).multiply(qStand.clone().invert());
    obj.stand.rotation.x = HALF_PI * eTip;

    /* --- position: rise off the table, then settle into the shelf slot --- */
    const liftY = SHELF_BASE_Y + OPEN_LIFT;
    root.position.y = eYaw <= 0 ? lerp(0, liftY, eTip) : lerp(liftY, SHELF_BASE_Y + SELECT_LIFT, eYaw);
    root.position.x = 0;
    root.position.z = 0;
    root.scale.setScalar(1);

    /* --- re-center toward the closed book (cover-centered) --- */
    obj.offset.position.x = lerp(0, -JOURNAL_W / 2, easeInOut(clamp01((t - 0.25) / 0.45)));

    /* --- cover folds shut (reverse of the bloom sweep) --- */
    const closedY = obj.coverPivot.userData.closedY as number;
    obj.coverPivot.rotation.z = lerp(Math.PI, 1.85, eTip);
    obj.coverPivot.rotation.z = lerp(obj.coverPivot.rotation.z, 0, eFold);
    obj.coverPivot.position.y = lerp(COVER_T / 2 + 0.0006, closedY, Math.max(eTip * 0.4, eFold));

    /* --- sheets: rest stacks → bloom fan (gather) → closed block --- */
    // static spread planes hide immediately; the per-sheet faces carry the
    // content during the gather (like the reference)
    obj.leftContent.visible = false;
    obj.rightContent.visible = false;
    const { sheets: S } = journalDims(this.pageCount);
    const stackTop = COVER_T + S * SHEET_T;
    for (let i = 0; i < S; i++) {
      const mesh = obj.sheets[i];
      mesh.visible = true;
      const left = i < this.spread;
      const d = left ? this.spread - 1 - i : i - this.spread;
      const restAngle = left ? Math.PI + this.fanAngle(d) : -this.fanAngle(d);
      const bloomAngle = left ? 1.15 + d * 0.34 : -(0.32 + d * 0.09);
      const restY = left ? COVER_T + (i + 0.5) * SHEET_T : stackTop - (i + 0.5) * SHEET_T;
      const closedSlot = stackTop - (i + 0.5) * SHEET_T;
      mesh.position.y = lerp(restY, closedSlot, Math.max(eTip, eFold));
      const gathered = lerp(restAngle, bloomAngle, eTip);
      mesh.rotation.z = lerp(gathered, 0, eFold);
      const face = obj.sheetFaces[i];
      if (face) face.visible = t < 0.72;
    }

    this.setSpineFlat(obj, 1 - eTip);

    /* --- camera: reading fit → pull up/back → shelf pose --- */
    const ocStart = this.openCamTarget();
    if (t < 0.55) {
      const u = easeInOut(t / 0.55);
      this.camPos.lerpVectors(ocStart.pos, new THREE.Vector3(0, 1.0, 4.8), u);
      this.camLook.lerpVectors(ocStart.look, new THREE.Vector3(0, 0.64, 0), u);
      this.camFov = lerp(ocStart.fov, 34, u);
    } else {
      const u = easeInOut((t - 0.55) / 0.45);
      this.camPos.lerpVectors(new THREE.Vector3(0, 1.0, 4.8), this.openCamStart.pos, u);
      this.camLook.lerpVectors(new THREE.Vector3(0, 0.64, 0), this.openCamStart.look, u);
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
        let free = 0;
        this.order.forEach((id, j) => {
          if (id === reorder.id) return;
          while (free === reorder.currentIndex) free += 1;
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
          // lifted, slightly enlarged, gently wobbling — follows the pointer
          root.position.x = lerp(root.position.x, this.reorder.bookX, 0.35);
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
        root.position.x = fromCenter * SHELF_SPACING;
        root.position.z = -Math.min(0.55, Math.abs(fromCenter) * 0.22);
        const sway = Math.sin(now * 0.7 + i * 2.1) * 0.02;
        root.rotation.y = Math.max(-0.45, Math.min(0.45, -fromCenter * 0.16 - this.dragVelocity * 2.4 + sway));
        const isSelected = id === this.selectedId;
        const targetY = SHELF_BASE_Y + (isSelected ? SELECT_LIFT : 0);
        root.position.y = lerp(root.position.y, targetY, 0.14);
        root.scale.setScalar(lerp(root.scale.x, 1, 0.14));
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
        entry.blob.scale.set(1.5, 1.7, 1);
        const blobMat = entry.blob.material as THREE.MeshBasicMaterial;
        blobMat.opacity = lerp(blobMat.opacity, isSelected ? 0.55 : 0.34, 0.14);
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
            entry.obj.root.position.y = Math.sin(now * 0.8) * 0.008;
            entry.obj.root.rotation.z = Math.sin(now * 0.5) * 0.004;
          }
        }
      }
    } else if (this.mode === 'closing') {
      this.updateClosing(now);
    }

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
    const { sheets: S } = journalDims(entry.dto.pageCount);
    // cover top-right corner in book-local space
    this.anchorV.set(JOURNAL_W * 0.94, COVER_T + S * SHEET_T + COVER_T * 0.5, -JOURNAL_H * 0.4);
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
    const aspect = this.camera.aspect;
    // portrait phones: pull the camera back a touch and widen fov
    if (aspect < 1) {
      this.camFov = 33 + Math.min(14, (1 - aspect) * 26);
      this.camPos.z = 5.2 + Math.min(1.8, (1 - aspect) * 3.6);
    } else {
      this.camFov = 33;
      this.camPos.z = 5.2;
    }
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
    // shelf: long-press arms drag-to-reorder
    if (this.mode === 'shelf' && !this.reorder?.active && this.selectedId) {
      const hit = this.pickJournal(e);
      if (hit === this.selectedId) {
        const idx = this.order.indexOf(hit);
        if (idx >= 0) {
          if (this.reorderTimer != null) window.clearTimeout(this.reorderTimer);
          this.reorderTimer = window.setTimeout(() => {
            if (this.mode === 'shelf' && this.dragging && this.dragMoved <= 7) {
              this.reorder = {
                active: true,
                id: hit,
                startIndex: idx,
                currentIndex: idx,
                grabX: this.dragLastX,
                bookX: (idx - this.scroll) * SHELF_SPACING,
                moved: false,
              };
              playTap();
            }
          }, 480);
        }
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    // tilt target from pointer position
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    this.tiltTargetX = this.tiltEnabled ? nx * 0.12 : 0;
    this.tiltTargetY = this.tiltEnabled ? -ny * 0.07 : 0;

    if (!this.dragging) return;
    const dx = e.clientX - this.dragLastX;
    const dy = e.clientY - this.dragLastY;
    this.dragLastX = e.clientX;
    this.dragLastY = e.clientY;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    if (this.reorder?.active) {
      // drag the lifted book; its slot follows the pointer position
      const r = this.reorder;
      r.bookX += dx * 0.011;
      r.moved = true;
      r.currentIndex = Math.max(
        0,
        Math.min(this.order.length - 1, Math.round(r.bookX / SHELF_SPACING + this.scroll)),
      );
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
    // commit / cancel shelf drag-to-reorder
    if (this.reorder?.active) {
      const r = this.reorder;
      this.reorder = null;
      if (r.currentIndex !== r.startIndex) {
        // persist the new order: move id from startIndex to currentIndex
        const ids = this.order.filter((x) => x !== r.id);
        ids.splice(r.currentIndex, 0, r.id);
        this.order = ids;
        this.scrollTarget = Math.max(0, Math.min(this.order.length - 1, r.currentIndex));
        this.selectedId = r.id;
        this.layoutAll();
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
