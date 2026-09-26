'use client';

/**
 * Shibu-Sketch — full-screen 2D drawing editor overlay.
 *
 * Consumes PageContent (normalized 0..1 vector ops — see src/lib/sketch/types.ts)
 * and renders it through the shared renderer (src/lib/sketch/render.ts).
 *
 * Architecture:
 *   - baseCanvas   : committed content (paper + photos + stickers + strokes + texts)
 *   - liveCanvas   : in-progress stroke preview (composited above base)
 *   - interaction  : pointer capture layer (draw / drag / hit-test)
 *   - selection UI : DOM dashed frame + rotate/scale/delete handles
 *   - popovers     : tool options, sticker picker, text editor (DOM)
 *
 * Eraser strokes are committed into content like any stroke; the renderer
 * applies them as destination-out on an isolated stroke layer, so erasing
 * removes ink only — never paper, photos or stickers.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import {
  Check,
  Eraser,
  Highlighter,
  ImagePlus,
  Maximize2,
  Palette,
  Pencil,
  PenLine,
  Redo2,
  RotateCcw,
  RotateCw,
  Sticker,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import {
  DEFAULT_PHOTO_W,
  DEFAULT_STICKER_SIZE,
  DEFAULT_TEXT_SIZE,
  SUGGESTED_COLORS,
  STICKER_EMOJIS,
  STICKER_SHAPES,
  TAPE_COLORS,
  clamp,
  hitTestContent,
  preloadImages,
  renderPageContent,
  renderStroke,
  selectionRect,
} from '@/lib/sketch/render';
import type { HitTarget } from '@/lib/sketch/render';
import type {
  DrawTool,
  PageContent,
  PhotoItem,
  StickerItem,
  Stroke,
  TextFont,
  TextItem,
} from '@/lib/sketch/types';

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

type Tool = DrawTool | 'text' | 'sticker' | 'photo';
type MeasureFn = (line: string, fontSizePx: number, fontCss: string) => number;

interface DrawingOverlayProps {
  /** shown top-center small */
  pageTitle: string;
  paperColor: string;
  initialContent: PageContent;
  onClose: () => void;
  /** called by Done button (also Ctrl/Cmd+S; Escape-with-dirty offers Save & close) */
  onSave: (content: PageContent) => void;
}

const DRAW_TOOLS: DrawTool[] = ['pen', 'marker', 'highlighter', 'eraser'];
const isDrawTool = (t: Tool): t is DrawTool => (DRAW_TOOLS as string[]).includes(t);

/** slider 0..100 → normalized stroke width (fraction of page width) */
const sizeFromSlider = (v: number) => 0.0035 + (v / 100) * 0.033;
const SIZE_PRESETS = [
  { label: 'Small', slider: 12, dot: 6 },
  { label: 'Medium', slider: 38, dot: 12 },
  { label: 'Large', slider: 75, dot: 20 },
];

let uidN = 0;
const uid = () =>
  `sk_${Date.now().toString(36)}${(uidN++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

const dprValue = () =>
  Math.max(2, Math.min(3, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));

interface DragState {
  kind: 'move' | 'rotate' | 'scale';
  sel: HitTarget;
  snapshot: PageContent;
  moved: boolean;
  pageRect: { left: number; top: number; width: number; height: number };
  startNx: number;
  startNy: number;
  orig: { x: number; y: number; rotation: number; size: number };
  halfW: number;
  halfH: number;
  centerPx: { x: number; y: number };
  grabAngle: number;
  startDistPx: number;
}

interface StrokeState {
  stroke: Stroke;
  snapshot: PageContent;
  pointerId: number;
}

interface TextEditState {
  item: TextItem;
  isNew: boolean;
  preSnapshot: PageContent;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function DrawingOverlay({
  pageTitle,
  paperColor,
  initialContent,
  onClose,
  onSave,
}: DrawingOverlayProps) {
  const [content, setContent] = useState<PageContent>(() => ({
    bg: initialContent.bg,
    strokes: initialContent.strokes ?? [],
    texts: initialContent.texts ?? [],
    stickers: initialContent.stickers ?? [],
    photos: initialContent.photos ?? [],
  }));
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>(SUGGESTED_COLORS[0]);
  const [sizeVal, setSizeVal] = useState<number>(SIZE_PRESETS[1].slider);
  const [optionsOpen, setOptionsOpen] = useState(true);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [selection, setSelection] = useState<HitTarget | null>(null);
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [cssSize, setCssSize] = useState({ w: 0, h: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [measureFn] = useState<MeasureFn | null>(null);
  const [, setHistTick] = useState(0);
  const [histLen, setHistLen] = useState({ past: 0, future: 0 });

  const pageRef = useRef<HTMLDivElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const strokeRef = useRef<StrokeState | null>(null);
  const textEditRef = useRef<TextEditState | null>(null);
  const measureRef = useRef<MeasureFn | null>(null);

  const pastRef = useRef<PageContent[]>([]);
  const futureRef = useRef<PageContent[]>([]);

  const bumpHist = useCallback(() => {
    setHistLen({ past: pastRef.current.length, future: futureRef.current.length });
    setHistTick((t) => t + 1);
  }, []);

  // keep the ref mirror of textEdit in sync outside of render
  useEffect(() => {
    textEditRef.current = textEdit;
  }, [textEdit]);



  const canUndo = histLen.past > 0;
  const canRedo = histLen.future > 0;

  /* ---------------- measuring ---------------- */

  const getMeasure = useCallback((): MeasureFn | undefined => {
    if (measureRef.current) return measureRef.current;
    const ctx = baseCanvasRef.current?.getContext('2d');
    if (!ctx) return undefined;
    const fn: MeasureFn = (line, fontSizePx, fontCss) => {
      ctx.font = fontCss;
      return ctx.measureText(line).width;
    };
    measureRef.current = fn;
    return fn;
  }, []);

  /* ---------------- canvas plumbing ---------------- */

  const prepareCtx = useCallback(
    (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
      if (!canvas || cssSize.w < 2 || cssSize.h < 2) return null;
      const dpr = dprValue();
      const bw = Math.round(cssSize.w * dpr);
      const bh = Math.round(cssSize.h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    },
    [cssSize],
  );

  const renderBase = useCallback(() => {
    const ctx = prepareCtx(baseCanvasRef.current);
    if (!ctx) return;
    renderPageContent(ctx, content, cssSize.w, cssSize.h, { paperColor });
  }, [prepareCtx, content, cssSize, paperColor]);

  useEffect(() => {
    renderBase();
    let alive = true;
    void preloadImages(content).then(() => {
      if (alive) renderBase();
    });
    return () => {
      alive = false;
    };
  }, [renderBase, content]);

  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const update = () => setCssSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clearLive = useCallback(() => {
    const ctx = prepareCtx(liveCanvasRef.current);
    if (ctx) ctx.clearRect(0, 0, cssSize.w, cssSize.h);
  }, [prepareCtx, cssSize]);

  /* ---------------- history ---------------- */

  const pushHistory = useCallback((snapshot: PageContent) => {
    pastRef.current = [...pastRef.current, snapshot].slice(-50);
    futureRef.current = [];
    setDirty(true);
    bumpHist();
  }, []);

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    pastRef.current = past.slice(0, -1);
    futureRef.current = [content, ...futureRef.current].slice(0, 50);
    setContent(prev);
    setSelection(null);
    bumpHist();
  }, [content]);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return;
    const next = future[0];
    futureRef.current = future.slice(1);
    pastRef.current = [...pastRef.current, content].slice(-50);
    setContent(next);
    setSelection(null);
    bumpHist();
  }, [content]);

  /* ---------------- item helpers ---------------- */

  const getItem = useCallback(
    (c: PageContent, sel: HitTarget): TextItem | StickerItem | PhotoItem | null => {
      if (sel.type === 'text') return c.texts.find((t) => t.id === sel.id) ?? null;
      if (sel.type === 'sticker') return c.stickers.find((s) => s.id === sel.id) ?? null;
      return c.photos.find((p) => p.id === sel.id) ?? null;
    },
    [],
  );

  const patchItem = useCallback(
    (sel: HitTarget, patch: Partial<TextItem> & Partial<StickerItem> & Partial<PhotoItem>) => {
      setContent((c) => {
        if (sel.type === 'text') {
          return { ...c, texts: c.texts.map((t) => (t.id === sel.id ? { ...t, ...patch } : t)) };
        }
        if (sel.type === 'sticker') {
          return { ...c, stickers: c.stickers.map((s) => (s.id === sel.id ? { ...s, ...patch } : s)) };
        }
        return { ...c, photos: c.photos.map((p) => (p.id === sel.id ? { ...p, ...patch } : p)) };
      });
    },
    [],
  );

  const deleteSelected = useCallback(() => {
    const sel = selection;
    if (!sel) return;
    pushHistory(content);
    setContent((c) => {
      if (sel.type === 'text') return { ...c, texts: c.texts.filter((t) => t.id !== sel.id) };
      if (sel.type === 'sticker') return { ...c, stickers: c.stickers.filter((s) => s.id !== sel.id) };
      return { ...c, photos: c.photos.filter((p) => p.id !== sel.id) };
    });
    setSelection(null);
  }, [selection, content, pushHistory]);

  /* ---------------- coordinate conversion ---------------- */

  const toNorm = useCallback((clientX: number, clientY: number) => {
    const el = pageRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1),
    };
  }, []);

  const normSize = sizeFromSlider(sizeVal);

  /* ---------------- live stroke drawing ---------------- */

  const drawLive = useCallback(() => {
    const st = strokeRef.current;
    if (!st) return;
    if (st.stroke.tool === 'eraser') {
      // erase directly on the committed canvas (destination-out) for instant feedback;
      // committed content re-render reproduces the same result via the stroke layer
      const ctx = prepareCtx(baseCanvasRef.current);
      if (ctx) renderStroke(ctx, st.stroke, cssSize.w, cssSize.h);
    } else {
      const ctx = prepareCtx(liveCanvasRef.current);
      if (!ctx) return;
      ctx.clearRect(0, 0, cssSize.w, cssSize.h);
      renderStroke(ctx, st.stroke, cssSize.w, cssSize.h);
    }
  }, [prepareCtx, cssSize]);

  /* ---------------- text editor ---------------- */

  const openNewText = useCallback(
    (p: { x: number; y: number }) => {
      const item: TextItem = {
        id: uid(),
        x: p.x,
        y: p.y,
        text: '',
        font: 'hand',
        size: DEFAULT_TEXT_SIZE,
        color,
        rotation: 0,
        align: 'center',
      };
      pushHistory(content);
      setContent((c) => ({ ...c, texts: [...c.texts, item] }));
      setTextEdit({ item, isNew: true, preSnapshot: content });
      setSelection(null);
    },
    [color, content, pushHistory],
  );

  const openEditText = useCallback(
    (sel: HitTarget) => {
      const item = getItem(content, sel);
      if (!item || sel.type !== 'text') return;
      setTextEdit({ item: item as TextItem, isNew: false, preSnapshot: content });
    },
    [content, getItem],
  );

  const updateDraft = useCallback(
    (patch: Partial<TextItem>) => {
      const te = textEditRef.current;
      if (!te) return;
      const next = { ...te.item, ...patch };
      textEditRef.current = { ...te, item: next };
      setTextEdit({ ...te, item: next });
      patchItem({ type: 'text', id: te.item.id }, patch);
    },
    [patchItem],
  );

  const confirmTextEdit = useCallback(() => {
    const te = textEditRef.current;
    if (!te) return;
    const isEmpty = te.item.text.trim().length === 0;
    if (isEmpty) {
      if (te.isNew) {
        // draft never confirmed → drop item and the history entry pushed at open
        setContent((c) => ({ ...c, texts: c.texts.filter((t) => t.id !== te.item.id) }));
        pastRef.current = pastRef.current.slice(0, -1);
        bumpHist();
      } else {
        setContent(te.preSnapshot);
      }
    } else if (!te.isNew) {
      // edits were applied live; snapshot pushed at open becomes the undo point
      pushHistory(te.preSnapshot);
    }
    textEditRef.current = null;
    setTextEdit(null);
    setSelection(null);
  }, [pushHistory]);

  const cancelTextEdit = useCallback(() => {
    const te = textEditRef.current;
    if (!te) return;
    if (te.isNew) {
      setContent((c) => ({ ...c, texts: c.texts.filter((t) => t.id !== te.item.id) }));
      pastRef.current = pastRef.current.slice(0, -1);
      bumpHist();
    } else {
      setContent(te.preSnapshot);
    }
    textEditRef.current = null;
    setTextEdit(null);
    setSelection(null);
  }, []);

  /* ---------------- stickers / photos ---------------- */

  const placeSticker = useCallback(
    (kind: StickerItem['kind'], value: string, tapeColor?: string) => {
      const size =
        kind === 'tape' ? 0.3 : kind === 'clip' ? 0.12 : kind === 'frame' ? 0.55 : kind === 'shape' ? 0.18 : DEFAULT_STICKER_SIZE;
      const item: StickerItem = {
        id: uid(),
        kind,
        value,
        x: 0.5,
        y: 0.46,
        size,
        rotation: kind === 'tape' ? -0.15 : 0,
        color: kind === 'shape' ? color : kind === 'frame' ? '#8d6e63' : tapeColor,
      };
      pushHistory(content);
      setContent((c) => ({ ...c, stickers: [...c.stickers, item] }));
      setSelection({ type: 'sticker', id: item.id });
      setStickerOpen(false);
    },
    [color, content, pushHistory],
  );

  const handlePhotoFile = useCallback(
    async (file: File) => {
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const aspect = await new Promise<number>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalHeight > 0 && img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1);
          img.onerror = () => resolve(1);
          img.src = dataUrl;
        });
        await preloadImages({ ...content, photos: [{ id: 'tmp', kind: 'url', dataUrl, x: 0, y: 0, w: 1, rotation: 0, aspect }] });
        const item: PhotoItem = {
          id: uid(),
          kind: 'url',
          dataUrl,
          x: 0.5,
          y: 0.46,
          w: DEFAULT_PHOTO_W,
          rotation: 0,
          aspect,
          frame: 'plain',
        };
        pushHistory(content);
        setContent((c) => ({ ...c, photos: [...c.photos, item] }));
        setSelection({ type: 'photo', id: item.id });
      } catch {
        /* ignore unreadable files */
      }
    },
    [content, pushHistory],
  );

  /* ---------------- pointer handling ---------------- */

  const captureSafely = (e: React.PointerEvent, el: Element) => {
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const onLayerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    captureSafely(e, e.currentTarget);
    if (textEditRef.current) confirmTextEdit();
    setStickerOpen(false);

    const p = toNorm(e.clientX, e.clientY);

    if (isDrawTool(tool)) {
      setSelection(null);
      setIsDrawing(true);
      const stroke: Stroke = {
        id: uid(),
        tool,
        color: tool === 'eraser' ? paperColor : color,
        size: normSize,
        points: [p],
      };
      strokeRef.current = { stroke, snapshot: content, pointerId: e.pointerId };
      drawLive();
      return;
    }

    const hit = hitTestContent(content, p.x, p.y, {
      cssW: cssSize.w,
      cssH: cssSize.h,
      measure: getMeasure() ?? undefined,
    });
    if (hit) {
      const item = getItem(content, hit);
      if (item) {
        const r = selectionRect(item, cssSize.w, cssSize.h, getMeasure() ?? undefined);
        const elRect = pageRef.current?.getBoundingClientRect();
        setSelection(hit);
        dragRef.current = {
          kind: 'move',
          sel: hit,
          snapshot: content,
          moved: false,
          pageRect: {
            left: elRect?.left ?? 0,
            top: elRect?.top ?? 0,
            width: cssSize.w,
            height: cssSize.h,
          },
          startNx: p.x,
          startNy: p.y,
          orig: {
            x: item.x,
            y: item.y,
            rotation: item.rotation,
            size: 'size' in item ? (item as StickerItem).size : (item as PhotoItem).w,
          },
          halfW: r.w / 2,
          halfH: r.h / 2,
          centerPx: { x: item.x * cssSize.w, y: item.y * cssSize.h },
          grabAngle: 0,
          startDistPx: 0,
        };
        return;
      }
    }
    setSelection(null);
    if (tool === 'text') openNewText(p);
  };

  const onLayerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = strokeRef.current;
    if (st) {
      const p = toNorm(e.clientX, e.clientY);
      const pts = st.stroke.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.0015) {
        st.stroke = { ...st.stroke, points: [...pts, p] };
        strokeRef.current = st;
        drawLive();
      }
      return;
    }
    const d = dragRef.current;
    if (!d || d.kind !== 'move') return;
    const p = toNorm(e.clientX, e.clientY);
    const dx = p.x - d.startNx;
    const dy = p.y - d.startNy;
    if (!d.moved && Math.hypot(dx, dy) < 0.004) return;
    d.moved = true;
    const marginX = Math.min(0.5, d.halfW);
    const marginY = Math.min(0.5, d.halfH);
    patchItem(d.sel, {
      x: clamp(d.orig.x + dx, marginX, 1 - marginX),
      y: clamp(d.orig.y + dy, marginY, 1 - marginY),
    });
  };

  const onLayerPointerUp = () => {
    const st = strokeRef.current;
    if (st) {
      strokeRef.current = null;
      setIsDrawing(false);
      const pts = st.stroke.points;
      const meaningful = pts.length > 1 || st.stroke.tool !== 'eraser';
      if (meaningful) {
        pushHistory(st.snapshot);
        setContent((c) => ({ ...c, strokes: [...c.strokes, st.stroke] }));
      }
      clearLive();
      renderBase();
      return;
    }
    const d = dragRef.current;
    if (d && d.kind === 'move') {
      dragRef.current = null;
      if (d.moved) {
        pushHistory(d.snapshot);
      } else if (tool === 'text' && d.sel.type === 'text') {
        openEditText(d.sel);
      }
      return;
    }
    dragRef.current = null;
  };

  /* ---------------- selection handles ---------------- */

  const startHandleDrag = (
    e: React.PointerEvent<HTMLButtonElement>,
    kind: 'rotate' | 'scale',
  ) => {
    if (!selection) return;
    const item = getItem(content, selection);
    if (!item) return;
    e.stopPropagation();
    e.preventDefault();
    captureSafely(e, e.currentTarget);
    const el = pageRef.current;
    const rect = el ? el.getBoundingClientRect() : new DOMRect(0, 0, cssSize.w, cssSize.h);
    const cx = item.x * cssSize.w;
    const cy = item.y * cssSize.h;
    const dxp = e.clientX - rect.left - cx;
    const dyp = e.clientY - rect.top - cy;
    dragRef.current = {
      kind,
      sel: selection,
      snapshot: content,
      moved: false,
      pageRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      startNx: 0,
      startNy: 0,
      orig: {
        x: item.x,
        y: item.y,
        rotation: item.rotation,
        size: 'size' in item ? (item as StickerItem).size : (item as PhotoItem).w,
      },
      halfW: 0,
      halfH: 0,
      centerPx: { x: cx, y: cy },
      grabAngle: Math.atan2(dyp, dxp),
      startDistPx: Math.max(6, Math.hypot(dxp, dyp)),
    };
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.kind === 'move') return;
    const dxp = e.clientX - d.pageRect.left - d.centerPx.x;
    const dyp = e.clientY - d.pageRect.top - d.centerPx.y;
    if (d.kind === 'rotate') {
      const a = Math.atan2(dyp, dxp);
      let rot = d.orig.rotation + (a - d.grabAngle);
      if (e.shiftKey) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
      if (Math.abs(a - d.grabAngle) > 0.02) d.moved = true;
      patchItem(d.sel, { rotation: rot });
    } else {
      const ratio = Math.hypot(dxp, dyp) / d.startDistPx;
      if (d.sel.type === 'photo') {
        patchItem(d.sel, { w: clamp(d.orig.size * ratio, 0.12, 0.96) });
      } else if (d.sel.type === 'sticker') {
        patchItem(d.sel, { size: clamp(d.orig.size * ratio, 0.05, 0.9) });
      } else {
        patchItem(d.sel, { size: clamp(d.orig.size * ratio, 0.02, 0.2) });
      }
      d.moved = true;
    }
  };

  const onHandlePointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.moved) pushHistory(d.snapshot);
  };

  /* ---------------- top bar actions ---------------- */

  const attemptClose = useCallback(() => {
    if (dirty) setConfirmClose(true);
    else onClose();
  }, [dirty, onClose]);

  const handleDone = useCallback(() => {
    onSave(content);
  }, [onSave, content]);

  const saveAndClose = useCallback(() => {
    onSave(content);
    onClose();
  }, [onSave, onClose, content]);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const tgt = e.target as HTMLElement | null;
      const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveAndClose();
        return;
      }
      if (e.key === 'Escape') {
        if (textEditRef.current) {
          cancelTextEdit();
          return;
        }
        if (stickerOpen) {
          setStickerOpen(false);
          return;
        }
        if (selection) {
          setSelection(null);
          return;
        }
        attemptClose();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection && !typing) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, saveAndClose, cancelTextEdit, attemptClose, deleteSelected, selection, stickerOpen]);

  /* ---------------- derived ---------------- */

  const selItem = selection ? getItem(content, selection) : null;
  const selRect =
    selItem && cssSize.w > 2
      ? selectionRect(selItem, cssSize.w, cssSize.h, measureFn ?? undefined)
      : null;

  const textPanelStyle = (() => {
    if (!textEdit || cssSize.w < 2) return {};
    const panelW = Math.min(300, cssSize.w * 0.86);
    const left = clamp(textEdit.item.x * cssSize.w, panelW / 2 + 6, Math.max(panelW / 2 + 6, cssSize.w - panelW / 2 - 6));
    const top = clamp(textEdit.item.y * cssSize.h - 190, 8, Math.max(8, cssSize.h - 200));
    return { left, top, width: panelW } as React.CSSProperties;
  })();

  /* ---------------- render ---------------- */

  return (
    <div className="fixed inset-0 z-50 flex select-none flex-col bg-[#343b4d]">
      {/* top bar */}
      <div className="relative z-40 flex items-center justify-between gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={attemptClose}
          aria-label="Close editor"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <span className="truncate text-sm font-medium tracking-wide text-white/90">{pageTitle}</span>
        </div>
        <button
          type="button"
          onClick={handleDone}
          aria-label="Done"
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-[#20242e] shadow transition hover:bg-white/90"
        >
          <Check className="h-5 w-5" />
          Done
        </button>
      </div>

      {/* page area */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 pb-[96px]">
        <div
          ref={pageRef}
          className="relative"
          style={{
            width: 'min(94vw, calc((100dvh - 200px) / 1.414))',
            aspectRatio: '1 / 1.414',
            touchAction: 'none',
          }}
        >
          {/* canvases */}
          <div
            className="absolute inset-0 overflow-hidden rounded-lg shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
            style={{ background: paperColor }}
          >
            <canvas ref={baseCanvasRef} className="absolute inset-0 h-full w-full" />
            <canvas ref={liveCanvasRef} className="absolute inset-0 h-full w-full" />
          </div>

          {/* selection frame */}
          {selItem && selRect && !isDrawing && (
            <div
              className="pointer-events-none absolute z-20"
              style={{
                left: (selRect.cx - selRect.w / 2) * cssSize.w,
                top: (selRect.cy - selRect.h / 2) * cssSize.h,
                width: selRect.w * cssSize.w,
                height: selRect.h * cssSize.h,
                transform: `rotate(${selRect.rotation}rad)`,
              }}
            >
              <div className="absolute inset-0 rounded-[4px] border-2 border-dashed border-sky-400/90" />
              <button
                type="button"
                aria-label="Rotate"
                onPointerDown={(e) => startHandleDrag(e, 'rotate')}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
                className="pointer-events-auto absolute left-1/2 top-0 flex h-7 w-7 -translate-x-1/2 -translate-y-[130%] items-center justify-center rounded-full bg-sky-500 text-white shadow-md"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Delete"
                onClick={deleteSelected}
                className="pointer-events-auto absolute -right-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white shadow-md"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              {selection?.type !== 'text' && (
                <button
                  type="button"
                  aria-label="Resize"
                  onPointerDown={(e) => startHandleDrag(e, 'scale')}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerUp}
                  className="pointer-events-auto absolute -bottom-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-sky-500 text-white shadow-md"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* text editor popover */}
          {textEdit && (
            <div
              className="absolute z-30 rounded-xl border border-black/10 bg-white p-2.5 shadow-2xl"
              style={textPanelStyle}
            >
              <Input
                autoFocus
                value={textEdit.item.text}
                onChange={(e) => updateDraft({ text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    confirmTextEdit();
                  }
                }}
                placeholder="Type something…"
                className="h-9 text-sm"
              />
              <div className="mt-2 flex items-center gap-1">
                {(['hand', 'sans', 'typewriter'] as TextFont[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => updateDraft({ font: f })}
                    className={`h-7 rounded-full border px-2 text-[11px] transition ${
                      textEdit.item.font === f
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-black/15 text-slate-600 hover:bg-black/5'
                    }`}
                  >
                    {f === 'hand' ? 'Hand' : f === 'sans' ? 'Sans' : 'Mono'}
                  </button>
                ))}
                <div className="mx-0.5 h-5 w-px bg-black/10" />
                <button
                  type="button"
                  aria-label="Smaller text"
                  onClick={() => updateDraft({ size: clamp(textEdit.item.size - 0.008, 0.02, 0.18) })}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-slate-600 hover:bg-black/5"
                >
                  <span className="text-xs font-bold">A－</span>
                </button>
                <button
                  type="button"
                  aria-label="Bigger text"
                  onClick={() => updateDraft({ size: clamp(textEdit.item.size + 0.008, 0.02, 0.18) })}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-slate-600 hover:bg-black/5"
                >
                  <span className="text-sm font-bold">A＋</span>
                </button>
                <button
                  type="button"
                  aria-label="Rotate -15°"
                  onClick={() => updateDraft({ rotation: textEdit.item.rotation - Math.PI / 12 })}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-slate-600 hover:bg-black/5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Rotate +15°"
                  onClick={() => updateDraft({ rotation: textEdit.item.rotation + Math.PI / 12 })}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-slate-600 hover:bg-black/5"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </button>
                <div className="flex-1" />
                {!textEdit.isNew && (
                  <button
                    type="button"
                    aria-label="Delete text"
                    onClick={() => {
                      pushHistory(textEdit.preSnapshot);
                      setContent((c) => ({ ...c, texts: c.texts.filter((t) => t.id !== textEdit.item.id) }));
                      setTextEdit(null);
                      setSelection(null);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Cancel"
                  onClick={cancelTextEdit}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-black/5"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Confirm text"
                  onClick={confirmTextEdit}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUGGESTED_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Text color ${c}`}
                    onClick={() => updateDraft({ color: c })}
                    className={`h-6 w-6 rounded-full border border-black/10 transition ${
                      textEdit.item.color === c ? 'ring-2 ring-slate-900 ring-offset-1' : ''
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* interaction layer */}
          <div
            className="absolute inset-0 z-10"
            style={{ touchAction: 'none' }}
            onPointerDown={onLayerPointerDown}
            onPointerMove={onLayerPointerMove}
            onPointerUp={onLayerPointerUp}
            onPointerCancel={onLayerPointerUp}
          />
        </div>
      </div>

      {/* tool options panel */}
      {isDrawTool(tool) && optionsOpen && (
        <div className="fixed bottom-[76px] left-1/2 z-40 w-[min(92vw,340px)] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#20242e]/85 p-3 text-white shadow-2xl backdrop-blur-md">
          {tool !== 'eraser' && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {SUGGESTED_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 shrink-0 rounded-full border border-white/20 transition ${
                    color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[#20242e]' : ''
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {SIZE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  aria-label={`${p.label} size`}
                  title={p.label}
                  onClick={() => setSizeVal(p.slider)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
                    sizeVal === p.slider ? 'bg-white/20' : 'hover:bg-white/10'
                  }`}
                >
                  <span
                    className="rounded-full bg-white"
                    style={{ width: p.dot, height: p.dot }}
                  />
                </button>
              ))}
            </div>
            <Slider
              value={[sizeVal]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => setSizeVal(v[0] ?? sizeVal)}
              className="flex-1"
            />
          </div>
        </div>
      )}

      {/* tools dock */}
      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center px-2">
        <div className="pointer-events-auto max-w-[94vw] overflow-x-auto rounded-full border border-white/10 bg-[#20242e]/80 shadow-2xl backdrop-blur-md [scrollbar-width:none]">
          <div className="flex min-w-max items-center gap-1 p-1.5">
            {(
              [
                { id: 'pen', icon: Pencil, label: 'Pen' },
                { id: 'marker', icon: PenLine, label: 'Marker' },
                { id: 'highlighter', icon: Highlighter, label: 'Highlighter' },
                { id: 'eraser', icon: Eraser, label: 'Eraser' },
                { id: 'text', icon: Type, label: 'Text' },
                { id: 'sticker', icon: Sticker, label: 'Stickers' },
                { id: 'photo', icon: ImagePlus, label: 'Photo' },
              ] as { id: Tool; icon: typeof Pencil; label: string }[]
            ).map(({ id, icon: Icon, label }) => {
              const active = tool === id;
              if (id === 'sticker') {
                return (
                  <Popover key={id} open={stickerOpen} onOpenChange={setStickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={label}
                        title={label}
                        aria-pressed={active}
                        onClick={() => setTool('sticker')}
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${
                          active ? 'bg-white text-[#20242e]' : 'text-white/85 hover:bg-white/10'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="center" className="w-[min(92vw,340px)] rounded-2xl p-3">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Emoji</div>
                      <div className="grid grid-cols-8 gap-1">
                        {STICKER_EMOJIS.map((emo) => (
                          <button
                            key={emo}
                            type="button"
                            aria-label={`Sticker ${emo}`}
                            onClick={() => placeSticker('emoji', emo)}
                            className="flex h-10 w-10 items-center justify-center rounded-lg text-xl transition hover:bg-black/5"
                          >
                            {emo}
                          </button>
                        ))}
                      </div>
                      <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shapes</div>
                      <div className="flex flex-wrap gap-1">
                        {STICKER_SHAPES.map((sh) => (
                          <button
                            key={sh.id}
                            type="button"
                            aria-label={`Shape ${sh.id}`}
                            onClick={() => placeSticker('shape', sh.value)}
                            className="flex h-10 w-10 items-center justify-center rounded-lg transition hover:bg-black/5"
                          >
                            <ShapeIcon id={sh.value} />
                          </button>
                        ))}
                      </div>
                      <div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tape</div>
                      <div className="flex gap-2">
                        {TAPE_COLORS.map((tc) => (
                          <button
                            key={tc}
                            type="button"
                            aria-label={`Tape ${tc}`}
                            onClick={() => placeSticker('tape', tc, tc)}
                            className="h-7 w-14 rounded-sm border border-black/10 shadow-sm transition hover:scale-105"
                            style={{ background: tc, opacity: 0.75 }}
                          />
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                );
              }
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  title={label}
                  aria-pressed={active}
                  onClick={() => {
                    setTool(id);
                    if (id === 'photo') fileInputRef.current?.click();
                  }}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${
                    active ? 'bg-white text-[#20242e]' : 'text-white/85 hover:bg-white/10'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </button>
              );
            })}
            <div className="mx-1 h-6 w-px shrink-0 bg-white/15" />
            <button
              type="button"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              onClick={undo}
              disabled={!canUndo}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/85 transition hover:bg-white/10 disabled:opacity-30"
            >
              <Undo2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
              onClick={redo}
              disabled={!canRedo}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/85 transition hover:bg-white/10 disabled:opacity-30"
            >
              <Redo2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Tool options"
              title="Colors & size"
              aria-pressed={optionsOpen}
              onClick={() => setOptionsOpen((o) => !o)}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${
                optionsOpen && isDrawTool(tool) ? 'bg-white text-[#20242e]' : 'text-white/85 hover:bg-white/10'
              }`}
            >
              <Palette className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* hidden photo input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handlePhotoFile(f);
          e.target.value = '';
        }}
      />

      {/* close confirm */}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save this page?</AlertDialogTitle>
            <AlertDialogDescription>
              You made changes to “{pageTitle}”. Save them before leaving, or discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmClose(false);
                onClose();
              }}
            >
              Discard
            </Button>
            <AlertDialogAction onClick={saveAndClose}>Save &amp; close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tiny inline SVG previews for shape stickers                         */
/* ------------------------------------------------------------------ */

function ShapeIcon({ id }: { id: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-700">
      {id === 'star' && <path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6L12 16.7 6.6 19.6l1.1-6L3.2 9.4l6.1-.8L12 3z" {...common} />}
      {id === 'heart' && <path d="M12 20s-7-4.6-7-9.5C5 7.5 7 6 9 6c1.4 0 2.5.8 3 1.7C12.5 6.8 13.6 6 15 6c2 0 4 1.5 4 4.5 0 4.9-7 9.5-7 9.5z" {...common} />}
      {id === 'circle' && <circle cx="12" cy="12" r="8" {...common} />}
      {id === 'triangle' && <path d="M12 4l8 15H4l8-15z" {...common} />}
      {id === 'squiggle' && <path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" {...common} />}
      {id === 'arrow' && <path d="M4 12h13M13 6l6 6-6 6" {...common} />}
    </svg>
  );
}

export default DrawingOverlay;
