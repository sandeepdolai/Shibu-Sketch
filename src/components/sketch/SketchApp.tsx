'use client';

/**
 * Shibu-Sketch — app shell & state machine.
 *
 * Views: shelf -> opening -> open -> (drawing overlay) -> closing -> shelf.
 * All data flows through the /api/sketch/* REST endpoints; all 3D through
 * the SketchEngine. Chrome components are pure presentational.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type {
  CoverStyle,
  JournalDTO,
  JournalDetailDTO,
  PageContent,
  PageDTO,
  PageTemplate,
} from '@/lib/sketch/types';
import { parsePageContent } from '@/lib/sketch/types';
import { SketchEngine } from '@/lib/sketch3d/sketchEngine';
import { contentToDataURL, spreadToDataURL } from '@/lib/sketch/render';
import { isSfxMuted, playTap, setSfxMuted } from '@/lib/sketch3d/sfx';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { useSketchToast } from './Toasts';
import { TitleBlock, PageDots } from './chrome';
import { ShelfTopBar, OpenTopBar } from './TopBars';
import { BottomDock } from './BottomDock';
import { PageScrubber } from './PageScrubber';
import { NewJournalModal } from './NewJournalModal';
import { JournalMenu } from './JournalMenu';
import { SearchOverlay } from './SearchOverlay';
import { GridView } from './GridView';
import { ShareSheet } from './ShareSheet';

const DrawingOverlay = dynamic(() => import('./DrawingOverlay'), { ssr: false });

type View = 'shelf' | 'opening' | 'open' | 'closing';

interface EditTarget {
  pageId: string;
  pageIndex: number;
  content: PageContent;
}

export default function SketchApp() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SketchEngine | null>(null);

  const [journals, setJournals] = useState<JournalDTO[]>([]);
  const [booting, setBooting] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('shelf');
  const [detail, setDetail] = useState<JournalDetailDTO | null>(null);
  const [spread, setSpread] = useState(0);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  /** the 3D camera is zoomed into a fullscreen page (chrome hidden) */
  const [pageZoomed, setPageZoomed] = useState(false);
  const [hintSeen, setHintSeen] = useState(false);
  /** shelf gesture tip (swipe to browse · hold to rearrange) */
  const [shelfHintSeen, setShelfHintSeen] = useState(false);

  const [gridOpen, setGridOpen] = useState(false);
  /** 3D table-top overview (engine 'grid' mode) — shelf only */
  const [grid3d, setGrid3d] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [copied, setCopied] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  const { toast } = useSketchToast();

  /* sound preference (persisted) */
  const [soundMuted, setSoundMuted] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('shibu:muted') === '1';
      setSoundMuted(stored);
      setSfxMuted(stored);
    } catch {
      /* ignore */
    }
  }, []);
  const toggleSound = useCallback(() => {
    setSoundMuted((m) => {
      const next = !m;
      setSfxMuted(next);
      try {
        window.localStorage.setItem('shibu:muted', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  /* per-journal reading progress (persisted) */
  const progressKey = (id: string) => `shibu:progress:${id}`;
  const loadProgress = useCallback((id: string): number => {
    try {
      const v = Number(window.localStorage.getItem(progressKey(id)) ?? '0');
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    } catch {
      return 0;
    }
  }, []);
  const saveProgress = useCallback((id: string, spread: number) => {
    try {
      window.localStorage.setItem(progressKey(id), String(Math.max(0, Math.floor(spread))));
    } catch {
      /* ignore */
    }
  }, []);

  const selected = useMemo(
    () => journals.find((j) => j.id === selectedId) ?? null,
    [journals, selectedId],
  );
  const spreadCount = detail ? Math.max(1, Math.ceil(detail.pages.length / 2)) : 1;

  /* ------------------------------------------------------------ */
  /* data                                                          */
  /* ------------------------------------------------------------ */

  const fetchJournals = useCallback(async (): Promise<JournalDTO[]> => {
    const res = await fetch('/api/sketch/journals', { cache: 'no-store' });
    const data = await res.json();
    return (data.journals ?? []) as JournalDTO[];
  }, []);

  const refreshJournals = useCallback(
    async (selectFirstIfNone = false) => {
      const list = await fetchJournals();
      setJournals(list);
      engineRef.current?.setJournals(list);
      if (selectFirstIfNone && list.length > 0) {
        setSelectedId((cur) => {
          if (cur && list.some((j) => j.id === cur)) return cur;
          engineRef.current?.selectJournal(list[0].id);
          return list[0].id;
        });
      }
      return list;
    },
    [fetchJournals],
  );

  /* boot: seed if empty, then load */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let list = await fetchJournals();
        if (list.length === 0) {
          await fetch('/api/sketch/seed', { method: 'POST' });
          list = await fetchJournals();
        }
        if (!alive) return;
        setJournals(list);
        engineRef.current?.setJournals(list);
        if (list.length > 0) {
          setSelectedId(list[0].id);
          engineRef.current?.selectJournal(list[0].id);
        }
      } catch {
        toast('Could not load journals', 'destructive');
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* re-render page textures once webfonts are ready */
  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    document.fonts.ready.then(() => {
      const engine = engineRef.current;
      if (!engine || view !== 'open' || !detail) return;
      for (const p of detail.pages) engine.updatePageContent(p.id, p.content);
    });
  }, [detail, view]);

  /* ------------------------------------------------------------ */
  /* engine                                                        */
  /* ------------------------------------------------------------ */

  const openJournalById = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/sketch/journals/${id}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('not found');
        const data = (await res.json()) as { journal: JournalDetailDTO };
        const startSpread = Math.min(loadProgress(data.journal.id), Math.max(0, Math.ceil(data.journal.pages.length / 2) - 1));
        setDetail(data.journal);
        setSpread(startSpread);
        setGrid3d(false); // leaving the 3D grid (if it was open)
        setView('opening');
        engineRef.current?.openJournal(data.journal, startSpread);
      } catch {
        toast('Could not open journal', 'destructive');
      }
    },
    [toast],
  );

  const openRef = useRef(openJournalById);
  openRef.current = openJournalById;
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;

  const detailRef = useRef<JournalDetailDTO | null>(null);
  detailRef.current = detail;

  useEffect(() => {
    if (!hostRef.current) return;
    const engine = new SketchEngine(hostRef.current, {
      onJournalTap: (id) => {
        void openRef.current(id);
      },
      onJournalSelect: (id) => setSelectedId(id),
      onOpenComplete: () => setView('open'),
      onCloseComplete: () => {
        setView('shelf');
        setDetail(null);
      },
      onSpreadChange: (k) => {
        setSpread(k);
        const cur = detailRef.current;
        if (cur) saveProgressRef.current(cur.id, k);
      },
      onEditPage: (pageIndex) => {
        // tap a page center -> zoom the 3D camera into it (fullscreen);
        // the drawing editor opens once the zoom completes (onZoomDone)
        engineRef.current?.zoomToPage(pageIndex);
      },
      onZoomChange: (active) => setPageZoomed(active),
      onZoomDone: (pageIndex) => {
        const cur = detailRef.current;
        if (!cur) return;
        const page = cur.pages[pageIndex];
        if (page) setEditTarget({ pageId: page.id, pageIndex, content: page.content });
      },
      onGridChange: (active) => setGrid3d(active),
      onReorder: (id, toIndex) => {
        reorderRef.current?.(id, toIndex);
      },
    });
    engineRef.current = engine;
    setGrid3d(false); // a fresh engine always starts on the shelf (HMR-safe)
    // journals may have loaded before the engine existed
    if (journalsRef.current.length > 0) {
      engine.setJournals(journalsRef.current);
      if (selectedRef.current) engine.selectJournal(selectedRef.current);
    }
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const journalsRef = useRef(journals);
  journalsRef.current = journals;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  /* cover settings button — anchored to the selected journal's cover corner */
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const settingsVisibleRef = useRef(false);
  settingsVisibleRef.current = view === 'shelf' && !!selectedId && !booting;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const btn = settingsBtnRef.current;
      if (!btn) return;
      const engine = engineRef.current;
      const anchor = settingsVisibleRef.current && engine ? engine.screenAnchor : null;
      if (anchor) {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.style.transform = `translate(${anchor.x - 44}px, ${anchor.y - 10}px)`;
      } else {
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ------------------------------------------------------------ */
  /* actions                                                       */
  /* ------------------------------------------------------------ */

  const closeJournal = useCallback(() => {
    if (view !== 'open') return;
    setView('closing');
    engineRef.current?.closeJournal();
    playTap();
  }, [view]);

  /** persist a shelf drag-to-reorder result */
  const reorderJournal = useCallback(
    async (id: string, toIndex: number) => {
      const current = journalsRef.current;
      const ids = current.map((j) => j.id).filter((x) => x !== id);
      ids.splice(toIndex, 0, id);
      // optimistic local update
      const byId = new Map(current.map((j) => [j.id, j]));
      const ordered = ids.map((x) => byId.get(x)).filter(Boolean) as JournalDTO[];
      setJournals(ordered);
      engineRef.current?.setJournals(ordered);
      if (selectedRef.current) engineRef.current?.selectJournal(selectedRef.current);
      try {
        const res = await fetch('/api/sketch/journals/reorder', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error();
        toast('Shelf reordered');
        setShelfHintSeen(true);
      } catch {
        toast('Could not reorder', 'destructive');
        void refreshJournals();
      }
    },
    [toast, refreshJournals],
  );
  const reorderRef = useRef<(id: string, toIndex: number) => void>(null);
  reorderRef.current = reorderJournal;

  const savePage = useCallback(
    async (content: PageContent) => {
      if (!editTarget || !detail) return;
      const { pageId, pageIndex } = editTarget;
      try {
        const res = await fetch(`/api/sketch/pages/${pageId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) throw new Error();
        setDetail((cur) =>
          cur
            ? {
                ...cur,
                pages: cur.pages.map((p, i) => (i === pageIndex ? { ...p, content } : p)),
              }
            : cur,
        );
        engineRef.current?.updatePageContent(pageId, content);
        toast('Page saved', 'success');
      } catch {
        toast('Could not save page', 'destructive');
      }
    },
    [editTarget, detail, toast],
  );

  const createJournal = useCallback(
    async (input: { title: string; coverStyle: CoverStyle }) => {
      setCreating(true);
      try {
        const res = await fetch('/api/sketch/journals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        if (!res.ok) throw new Error();
        setNewOpen(false);
        const list = await refreshJournals();
        const created = list.find((j) => j.title === input.title);
        if (created) {
          setSelectedId(created.id);
          engineRef.current?.selectJournal(created.id);
        }
        toast(`“${input.title}” created`, 'success');
      } catch {
        toast('Could not create journal', 'destructive');
      } finally {
        setCreating(false);
      }
    },
    [refreshJournals, toast],
  );

  const deleteSelected = useCallback(async () => {
    if (!selected) return;
    try {
      await fetch(`/api/sketch/journals/${selected.id}`, { method: 'DELETE' });
      const list = await refreshJournals();
      const next = list[0]?.id ?? null;
      setSelectedId(next);
      engineRef.current?.selectJournal(next);
      if (view === 'open') {
        engineRef.current?.forceShelf();
        setView('shelf');
        setDetail(null);
      }
      toast(`“${selected.title}” deleted`, 'default');
    } catch {
      toast('Could not delete journal', 'destructive');
    }
  }, [selected, refreshJournals, view, toast]);

  const addPage = useCallback(async () => {
    if (!detail) return;
    try {
      const res = await fetch(`/api/sketch/journals/${detail.id}/pages`, { method: 'POST' });
      if (!res.ok) throw new Error();
      const r2 = await fetch(`/api/sketch/journals/${detail.id}`, { cache: 'no-store' });
      const data = (await r2.json()) as { journal: JournalDetailDTO };
      setDetail(data.journal);
      engineRef.current?.reloadOpenJournal(data.journal);
      setJournals((cur) =>
        cur.map((j) =>
          j.id === data.journal.id ? { ...j, pageCount: data.journal.pages.length } : j,
        ),
      );
      engineRef.current?.setJournals(
        journals.map((j) =>
          j.id === data.journal.id ? { ...j, pageCount: data.journal.pages.length } : j,
        ),
      );
      toast('Page added', 'success');
    } catch {
      toast('Could not add page', 'destructive');
    }
  }, [detail, journals, toast]);

  /** Insert a (template) page right after the spread being viewed. */
  const addPageAfterCurrent = useCallback(async (template: PageTemplate = 'plain') => {
    if (!detail) return;
    try {
      const res = await fetch(`/api/sketch/journals/${detail.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atIndex: spread * 2 + 2 }),
      });
      if (!res.ok) throw new Error();
      const created = (await res.json()) as { page: PageDTO };
      if (template !== 'plain') {
        const put = await fetch(`/api/sketch/pages/${created.page.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: { template, strokes: [], texts: [], stickers: [], photos: [] } }),
        });
        if (!put.ok) throw new Error();
      }
      const r2 = await fetch(`/api/sketch/journals/${detail.id}`, { cache: 'no-store' });
      const data = (await r2.json()) as { journal: JournalDetailDTO };
      setDetail(data.journal);
      engineRef.current?.reloadOpenJournal(data.journal);
      setJournals((cur) =>
        cur.map((j) =>
          j.id === data.journal.id ? { ...j, pageCount: data.journal.pages.length } : j,
        ),
      );
      engineRef.current?.setJournals(
        journals.map((j) =>
          j.id === data.journal.id ? { ...j, pageCount: data.journal.pages.length } : j,
        ),
      );
      toast('Page added', 'success');
    } catch {
      toast('Could not add page', 'destructive');
    }
  }, [detail, spread, journals, toast]);

  /** Delete the page the reader is looking at (right page of the spread,
   *  falling back to the left page on the last spread). */
  const deleteCurrentPage = useCallback(async () => {
    if (!detail) return;
    if (detail.pages.length <= 2) {
      toast('A journal needs at least 2 pages', 'destructive');
      return;
    }
    const right = spread * 2 + 1;
    const left = spread * 2;
    const pageIndex = right < detail.pages.length ? right : left;
    const page = detail.pages[pageIndex];
    if (!page) return;
    try {
      const res = await fetch(`/api/sketch/journals/${detail.id}/pages/${page.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      const r2 = await fetch(`/api/sketch/journals/${detail.id}`, { cache: 'no-store' });
      const data = (await r2.json()) as { journal: JournalDetailDTO };
      setDetail(data.journal);
      engineRef.current?.reloadOpenJournal(data.journal);
      engineRef.current?.setSpread(
        Math.max(0, Math.min(spread, Math.ceil(data.journal.pages.length / 2) - 1)),
      );
      setJournals((cur) =>
        cur.map((j) =>
          j.id === data.journal.id ? { ...j, pageCount: data.journal.pages.length } : j,
        ),
      );
      engineRef.current?.setJournals(
        journals.map((j) =>
          j.id === data.journal.id ? { ...j, pageCount: data.journal.pages.length } : j,
        ),
      );
      toast('Page deleted', 'success');
    } catch {
      toast('Could not delete page', 'destructive');
    }
  }, [detail, spread, journals, toast]);

  const renameJournal = useCallback(async () => {
    if (!detail || !renameValue.trim()) return;
    try {
      await fetch(`/api/sketch/journals/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: renameValue.trim() }),
      });
      setDetail({ ...detail, title: renameValue.trim() });
      setJournals((cur) =>
        cur.map((j) => (j.id === detail.id ? { ...j, title: renameValue.trim() } : j)),
      );
      engineRef.current?.setJournals(
        journals.map((j) => (j.id === detail.id ? { ...j, title: renameValue.trim() } : j)),
      );
      toast('Renamed', 'success');
    } catch {
      toast('Could not rename', 'destructive');
    } finally {
      setRenaming(false);
    }
  }, [detail, renameValue, journals, toast]);

  /** Deep-copy the selected journal (cover + every page) to a new shelf slot. */
  const duplicateSelected = useCallback(async () => {
    if (!selected) return;
    try {
      const res = await fetch(`/api/sketch/journals/${selected.id}/duplicate`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error();
      const list = await refreshJournals();
      const data = await res.json();
      const copyId = (data.journal as JournalDTO | undefined)?.id;
      if (copyId) {
        setSelectedId(copyId);
        engineRef.current?.selectJournal(copyId);
      }
      toast(`“${selected.title}” duplicated`, 'success');
      return list;
    } catch {
      toast('Could not duplicate journal', 'destructive');
    }
  }, [selected, refreshJournals, toast]);

  /** Insert a copy of the current page right after itself. */
  const duplicateCurrentPage = useCallback(async () => {
    if (!detail) return;
    const right = spread * 2 + 1;
    const left = spread * 2;
    const pageIndex = right < detail.pages.length ? right : left;
    const page = detail.pages[pageIndex];
    if (!page) return;
    try {
      // 1) insert a blank page after the current one
      const res = await fetch(`/api/sketch/journals/${detail.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atIndex: pageIndex + 1 }),
      });
      if (!res.ok) throw new Error();
      const created = (await res.json()) as { page: { id: string } };
      // 2) fill it with a deep copy of the current page's content
      await fetch(`/api/sketch/pages/${created.page.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: page.content }),
      });
      // 3) refresh detail + engine
      const r2 = await fetch(`/api/sketch/journals/${detail.id}`, { cache: 'no-store' });
      const data = (await r2.json()) as { journal: JournalDetailDTO };
      setDetail(data.journal);
      engineRef.current?.reloadOpenJournal(data.journal);
      setJournals((cur) =>
        cur.map((j) =>
          j.id === data.journal.id ? { ...j, pageCount: data.journal.pages.length } : j,
        ),
      );
      toast('Page duplicated', 'success');
    } catch {
      toast('Could not duplicate page', 'destructive');
    }
  }, [detail, spread, toast]);

  /** Restore an exported journal backup (JSON) as a new journal on the shelf. */
  const importJournalFile = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        const raw = JSON.parse(await file.text()) as {
          title?: unknown;
          coverStyle?: unknown;
          paperColor?: unknown;
          pages?: unknown;
        };
        const title =
          typeof raw.title === 'string' && raw.title.trim()
            ? raw.title.trim().slice(0, 60)
            : 'Imported journal';
        const rawPages = Array.isArray(raw.pages) ? raw.pages : [];
        const pages = rawPages
          .map((p) =>
            p && typeof p === 'object' && 'content' in (p as Record<string, unknown>)
              ? (p as { content: unknown }).content
              : p,
          )
          .filter((c) => c && typeof c === 'object')
          .map((content) => ({ content }));
        if (pages.length < 2) {
          toast('Backup needs at least 2 pages', 'destructive');
          return;
        }
        const res = await fetch('/api/sketch/journals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            coverStyle: raw.coverStyle ?? undefined,
            paperColor: typeof raw.paperColor === 'string' ? raw.paperColor : undefined,
            pages,
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          toast(err?.error ?? 'Could not import backup', 'destructive');
          return;
        }
        const data = (await res.json()) as { journal: JournalDTO };
        await refreshJournals();
        setSelectedId(data.journal.id);
        engineRef.current?.selectJournal(data.journal.id);
        toast(`“${data.journal.title}” imported`, 'success');
      } catch {
        toast('Invalid backup file', 'destructive');
      } finally {
        setImporting(false);
        if (importFileRef.current) importFileRef.current.value = '';
      }
    },
    [refreshJournals, toast],
  );

  const exportJournalJson = useCallback(() => {
    if (!detail) return;
    const blob = new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${detail.title.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Journal exported', 'success');
  }, [detail, toast]);

  /** Export a rendered PNG: use the native share sheet when available
   *  (mobile), otherwise download the file. */
  const exportImagePng = useCallback(
    async (dataUrl: string, filename: string, successMsg: string) => {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], filename, { type: 'image/png' });
        const nav = navigator as Navigator & {
          canShare?: (d: { files?: File[] }) => boolean;
          share?: (d: { files?: File[]; title?: string }) => Promise<void>;
        };
        if (nav.canShare?.({ files: [file] }) && nav.share) {
          await nav.share({ files: [file], title: 'Shibu Sketch' });
          toast('Shared', 'success');
          return;
        }
      } catch (err) {
        // user cancelled the share sheet — do not fall through to a download
        if ((err as DOMException)?.name === 'AbortError') return;
        /* otherwise fall through to the plain download */
      }
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.click();
      toast(successMsg, 'success');
    },
    [toast],
  );

  const exportPagePng = useCallback(() => {
    if (!detail) return;
    const pageIndex = Math.min(spread * 2 + 1, detail.pages.length - 1);
    const content = detail.pages[pageIndex]?.content ?? parsePageContent('{}');
    const url = contentToDataURL(content, 620, 868, detail.paperColor);
    if (!url) {
      toast('Could not render page', 'destructive');
      return;
    }
    void exportImagePng(url, `page-${pageIndex + 1}.png`, 'Page exported as PNG');
  }, [detail, spread, exportImagePng, toast]);

  /** PNG of the open two-page spread (left + right with a gutter shadow). */
  const exportSpreadPng = useCallback(() => {
    if (!detail) return;
    const leftIdx = spread * 2;
    const rightIdx = spread * 2 + 1;
    const left = detail.pages[leftIdx]?.content ?? null;
    const right = detail.pages[rightIdx]?.content ?? null;
    if (!left && !right) return;
    const url = spreadToDataURL(left, right, 620, 868, detail.paperColor);
    if (!url) {
      toast('Could not render spread', 'destructive');
      return;
    }
    void exportImagePng(url, `spread-${spread + 1}.png`, 'Spread exported as PNG');
  }, [detail, spread, exportImagePng, toast]);

  const copyLink = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, []);

  const pickJournal = useCallback(
    (j: JournalDTO) => {
      setGridOpen(false);
      setSearchOpen(false);
      setSelectedId(j.id);
      engineRef.current?.selectJournal(j.id);
      if (view === 'open') {
        // swap books directly: close then open the picked one after the transition
        setView('closing');
        engineRef.current?.closeJournal();
        window.setTimeout(() => void openRef.current(j.id), 950);
      } else {
        void openRef.current(j.id);
      }
    },
    [view],
  );

  /* keyboard shortcuts — inactive while any dialog/overlay is on top */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (editTarget) return;
      if (
        menuOpen ||
        shareOpen ||
        gridOpen ||
        searchOpen ||
        newOpen ||
        aboutOpen ||
        renaming
      ) {
        return;
      }
      if (view === 'open') {
        if (e.key === 'ArrowRight') engineRef.current?.flipPage(1);
        if (e.key === 'ArrowLeft') engineRef.current?.flipPage(-1);
        if (e.key === 'Escape') {
          // zoomed into a page first? Esc steps back out before closing
          if (engineRef.current?.isPageZoomed()) engineRef.current?.zoomOutPage();
          else closeJournal();
        }
      } else if (grid3d) {
        if (e.key === 'Escape' || e.key === 'g') engineRef.current?.exitGrid();
      } else if (view === 'shelf' && e.key === 'Escape') {
        // Esc while dragging a book = cancel the reorder (book glides back)
        engineRef.current?.cancelReorder();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, editTarget, closeJournal, menuOpen, shareOpen, gridOpen, searchOpen, newOpen, aboutOpen, renaming, grid3d]);

  /* hint chip gently fades away after a few seconds of reading */
  useEffect(() => {
    if (view !== 'open' || hintSeen) return;
    const t = window.setTimeout(() => setHintSeen(true), 7000);
    return () => window.clearTimeout(t);
  }, [view, hintSeen]);

  /* shelf gesture tip shows once per session, then fades */
  useEffect(() => {
    if (view !== 'shelf' || grid3d || shelfHintSeen) return;
    const t = window.setTimeout(() => setShelfHintSeen(true), 6000);
    return () => window.clearTimeout(t);
  }, [view, grid3d, shelfHintSeen]);

  /* ------------------------------------------------------------ */
  /* render                                                        */
  /* ------------------------------------------------------------ */

  const dark = view === 'open' || view === 'closing';

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden select-none">
      {/* backgrounds crossfade (light shelf <-> dark reading room) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-[1200ms] ease-in-out"
        style={{
          opacity: dark ? 0 : 1,
          background: 'linear-gradient(to bottom, #908dad 0%, #8b88a6 42%, #7b7896 100%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-[1200ms] ease-in-out"
        style={{
          opacity: dark ? 1 : 0,
          background:
            'radial-gradient(120% 90% at 50% 42%, #3c4358 0%, #343b4d 45%, #262c3b 100%)',
        }}
      />
      {/* warm reading-lamp glow, top center (dark view only) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-[1200ms] ease-in-out"
        style={{
          opacity: dark ? 1 : 0,
          background:
            'radial-gradient(44% 26% at 50% -2%, rgba(255,232,196,0.13) 0%, rgba(255,232,196,0.05) 45%, rgba(255,232,196,0) 100%)',
        }}
      />
      {/* film grain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.7'/%3E%3C/svg%3E\")",
        }}
      />

      {/* 3D host */}
      <div ref={hostRef} className="absolute inset-0" role="application" aria-label="Shibu Sketch 3D journals" />

      {/* cover settings — floats over the selected journal's cover corner */}
      <button
        ref={settingsBtnRef}
        type="button"
        aria-label="Journal settings"
        onClick={() => {
          setRenameValue(selected?.title ?? '');
          setMenuOpen(true);
          playTap();
        }}
        className="absolute left-0 top-0 z-20 flex size-9 items-center justify-center rounded-full bg-white/90 text-zinc-700 shadow-lg shadow-black/25 transition hover:bg-white active:scale-95"
        style={{ opacity: 0, pointerEvents: 'none' }}
      >
        <SlidersHorizontal className="size-4" />
      </button>

      {booting && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-[#8b88a6] text-white">
          <div className="flex items-end gap-1">
            <span className="inline-block h-6 w-1.5 animate-pulse rounded-full bg-white/90" />
            <span className="inline-block h-8 w-1.5 animate-pulse rounded-full bg-white/70 [animation-delay:120ms]" />
            <span className="inline-block h-7 w-1.5 animate-pulse rounded-full bg-white/80 [animation-delay:240ms]" />
          </div>
          <p className="text-sm font-medium tracking-wide">Opening your journals…</p>
        </div>
      )}

      {/* top chrome (fades out while a page is zoomed fullscreen) */}
      {view === 'shelf' || view === 'closing' ? (
        <ShelfTopBar
          journalCount={journals.length}
          onWordmark={() => setAboutOpen(true)}
          onGrid={() => {
            if (view !== 'shelf') return;
            const engine = engineRef.current;
            if (!engine) return;
            // the engine is the source of truth for grid state
            if (engine.isGrid()) engine.exitGrid();
            else engine.enterGrid();
          }}
          onSearch={() => setSearchOpen(true)}
          onMenu={() => setAboutOpen(true)}
          soundMuted={soundMuted}
          onToggleSound={toggleSound}
        />
      ) : (
        <div
          className={`transition-opacity duration-300 ${
            pageZoomed ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
        >
          <OpenTopBar
            onBack={closeJournal}
            onGrid={() => setGridOpen(true)}
            onSearch={() => setSearchOpen(true)}
            onMenu={() => setMenuOpen(true)}
            soundMuted={soundMuted}
            onToggleSound={toggleSound}
          />
        </div>
      )}

      {/* top-center page dots / menu */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-2.5 z-30 flex justify-center transition-opacity duration-300 md:top-3 ${
          pageZoomed ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {view === 'open' && detail ? (
          <PageDots current={spread + 1} total={spreadCount} />
        ) : (
          <button
            type="button"
            aria-label="About Shibu Sketch"
            className="pointer-events-auto rounded-full px-3 py-1 text-white/70 transition hover:text-white"
            onClick={() => setAboutOpen(true)}
          >
            ···
          </button>
        )}
      </div>

      {/* title block */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-16 z-20 flex flex-col items-center gap-1 transition-opacity duration-300 md:top-20 ${
          pageZoomed ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {view === 'open' && detail ? (
          <TitleBlock title={detail.title} pageCount={detail.pages.length} mode="open" />
        ) : grid3d && view === 'shelf' ? (
          <TitleBlock
            title="All Journals"
            pageCount={journals.length}
            mode="shelf"
            subtitle={`${journals.length} ${journals.length === 1 ? 'Journal' : 'Journals'}`}
          />
        ) : (
          selected && (
            <TitleBlock
              title={selected.title}
              pageCount={selected.pageCount}
              mode="shelf"
              subtitle={undefined}
            />
          )
        )}
      </div>

      {/* scrubber (open view) */}
      {detail && (
        <PageScrubber
          value={spreadCount > 1 ? spread / (spreadCount - 1) : 0}
          onChange={(v) =>
            engineRef.current?.setSpread(Math.round(v * (spreadCount - 1)))
          }
          visible={view === 'open' && !pageZoomed}
          label="Jump to page"
        />
      )}

      {/* hint chip */}
      {view === 'open' && !hintSeen && !pageZoomed && (
        <button
          type="button"
          className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/35 px-4 py-2 text-xs font-medium text-white/90 backdrop-blur-sm transition hover:bg-black/50 md:bottom-28"
          onClick={() => setHintSeen(true)}
        >
          Tap a page center to draw · edges to flip
        </button>
      )}

      {/* shelf gesture tip (swipe to browse · hold a book to rearrange) */}
      {view === 'shelf' && !grid3d && !shelfHintSeen && (
        <button
          type="button"
          className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/30 px-4 py-2 text-xs font-medium text-white/90 backdrop-blur-sm transition hover:bg-black/45 md:bottom-28"
          onClick={() => setShelfHintSeen(true)}
        >
          Swipe to browse · hold a book to rearrange
        </button>
      )}

      {/* grid overview affordance: swipe tips + New journal */}
      {grid3d && view === 'shelf' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex flex-col items-center gap-2 md:bottom-28">
          <span className="rounded-full bg-black/30 px-4 py-1.5 text-[11px] font-medium text-white/85 backdrop-blur-sm">
            Drag up to see more · tap a journal to open
          </span>
          <button
            type="button"
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-2 text-xs font-semibold text-zinc-800 shadow-lg transition hover:bg-white"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New journal
          </button>
        </div>
      )}

      {/* bottom dock (fades out while a page is zoomed fullscreen) */}
      {(view === 'shelf' || view === 'open') && (
        <div
          className={`transition-opacity duration-300 ${
            pageZoomed ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
        >
          <BottomDock
            variant={view === 'open' ? 'open' : 'shelf'}
            onMore={() => {
              if (view === 'open' && detail) {
                setRenameValue(detail.title);
              }
              setMenuOpen(true);
              playTap();
            }}
            onShare={() => {
              setShareOpen(true);
              playTap();
            }}
            onTrash={() => {
              if (!selected) return;
              setMenuOpen(true);
              playTap();
            }}
            onPlus={() => {
              if (view === 'open' && detail) {
                void addPage();
              } else {
                setNewOpen(true);
              }
              playTap();
            }}
          />
        </div>
      )}

      {/* overlays & modals */}
      <GridView
        open={gridOpen}
        journals={journals}
        onPick={pickJournal}
        onClose={() => setGridOpen(false)}
        onNew={() => {
          setGridOpen(false);
          setNewOpen(true);
        }}
      />
      <SearchOverlay
        open={searchOpen}
        onOpenChange={setSearchOpen}
        journals={journals}
        onPick={pickJournal}
      />
      <NewJournalModal
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreate={(input) => void createJournal(input)}
        creating={creating}
      />
      <JournalMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        mode={view === 'open' ? 'open' : 'shelf'}
        journalTitle={detail?.title ?? selected?.title ?? ''}
        canDelete={!!selected || !!detail}
        onRename={() => {
          setRenameValue(detail?.title ?? selected?.title ?? '');
          setRenaming(true);
        }}
        onDuplicate={view === 'shelf' && selected ? () => void duplicateSelected() : undefined}
        onImport={view === 'shelf' ? () => importFileRef.current?.click() : undefined}
        onDelete={() => {
          setMenuOpen(false);
          void deleteSelected();
        }}
        onExportPng={view === 'open' ? exportPagePng : undefined}
        onAddPage={
          view === 'open' && detail ? (t) => void addPageAfterCurrent(t) : undefined
        }
        onDeletePage={view === 'open' && detail ? () => void deleteCurrentPage() : undefined}
        onDuplicatePage={view === 'open' && detail ? () => void duplicateCurrentPage() : undefined}
        onAbout={() => {
          setMenuOpen(false);
          setAboutOpen(true);
        }}
      />
      <ShareSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={detail?.title ?? selected?.title ?? 'Shibu Sketch'}
        onExportPage={view === 'open' ? exportPagePng : undefined}
        onExportSpread={view === 'open' ? exportSpreadPng : undefined}
        onExportJournal={detail ? exportJournalJson : exportJournalJson}
        onCopyLink={copyLink}
      />

      {/* hidden file input for JSON backup import */}
      <input
        ref={importFileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        disabled={importing}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importJournalFile(f);
        }}
      />

      {/* about */}
      {aboutOpen && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setAboutOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 flex w-fit items-end gap-1">
              <span className="inline-block h-6 w-1.5 rounded-full bg-zinc-800" />
              <span className="inline-block h-8 w-1.5 rounded-full bg-zinc-600" />
              <span className="inline-block h-7 w-1.5 rounded-full bg-zinc-800" />
            </div>
            <h2 className="text-lg font-bold text-zinc-900">Shibu Sketch</h2>
            <p className="mt-1 text-sm text-zinc-500">
              A pocket journal studio — sketch, sticker, and collect your ideas in beautiful 3D
              notebooks. Inspired by the feel of paper.
            </p>
            <button
              type="button"
              className="mt-4 w-full rounded-full bg-zinc-900 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700"
              onClick={() => setAboutOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* rename dialog */}
      {renaming && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setRenaming(false)}
        >
          <div
            className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-zinc-900">Rename journal</h3>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void renameJournal();
                if (e.key === 'Escape') setRenaming(false);
              }}
              maxLength={60}
              className="mt-3 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-zinc-400"
              placeholder="Journal title"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-full border border-zinc-200 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-50"
                onClick={() => setRenaming(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-full bg-zinc-900 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700"
                onClick={() => void renameJournal()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* copied pill */}
      {copied && (
        <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-white/95 px-4 py-1.5 text-xs font-semibold text-zinc-800 shadow-lg">
          Link copied
        </div>
      )}

      {/* drawing overlay (opens on top of the fullscreen zoomed page) */}
      {editTarget && detail && (
        <DrawingOverlay
          pageTitle={`${detail.title} · page ${editTarget.pageIndex + 1}`}
          paperColor={detail.paperColor || '#faf8f4'}
          initialContent={editTarget.content}
          fullscreen={pageZoomed}
          onClose={() => {
            setEditTarget(null);
            engineRef.current?.zoomOutPage();
          }}
          onSave={(content) => {
            void savePage(content);
            setEditTarget(null);
            engineRef.current?.zoomOutPage();
          }}
        />
      )}
    </div>
  );
}
