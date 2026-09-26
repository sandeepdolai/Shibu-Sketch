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
import type { CoverStyle, JournalDTO, JournalDetailDTO, PageContent } from '@/lib/sketch/types';
import { parsePageContent } from '@/lib/sketch/types';
import { SketchEngine } from '@/lib/sketch3d/sketchEngine';
import { contentToDataURL } from '@/lib/sketch/render';
import { playTap } from '@/lib/sketch3d/sfx';
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
  const [hintSeen, setHintSeen] = useState(false);

  const [gridOpen, setGridOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [copied, setCopied] = useState(false);

  const { toast } = useSketchToast();

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
        setDetail(data.journal);
        setSpread(0);
        setView('opening');
        engineRef.current?.openJournal(data.journal, 0);
      } catch {
        toast('Could not open journal', 'destructive');
      }
    },
    [toast],
  );

  const openRef = useRef(openJournalById);
  openRef.current = openJournalById;

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
      onSpreadChange: (k) => setSpread(k),
      onEditPage: (pageIndex) => {
        const cur = detailRef.current;
        if (!cur) return;
        const page = cur.pages[pageIndex];
        if (page) setEditTarget({ pageId: page.id, pageIndex, content: page.content });
      },
    });
    engineRef.current = engine;
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

  /* ------------------------------------------------------------ */
  /* actions                                                       */
  /* ------------------------------------------------------------ */

  const closeJournal = useCallback(() => {
    if (view !== 'open') return;
    setView('closing');
    engineRef.current?.closeJournal();
    playTap();
  }, [view]);

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

  const exportPagePng = useCallback(() => {
    if (!detail) return;
    const pageIndex = Math.min(spread * 2 + 1, detail.pages.length - 1);
    const content = detail.pages[pageIndex]?.content ?? parsePageContent('{}');
    const url = contentToDataURL(content, 620, 868, detail.paperColor);
    const a = document.createElement('a');
    a.href = url;
    a.download = `page-${pageIndex + 1}.png`;
    a.click();
    toast('Page exported as PNG', 'success');
  }, [detail, spread, toast]);

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

  /* keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (editTarget) return;
      if (view === 'open') {
        if (e.key === 'ArrowRight') engineRef.current?.flipPage(1);
        if (e.key === 'ArrowLeft') engineRef.current?.flipPage(-1);
        if (e.key === 'Escape') closeJournal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, editTarget, closeJournal]);

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

      {/* top chrome */}
      {view === 'shelf' || view === 'closing' ? (
        <ShelfTopBar
          journalCount={journals.length}
          onWordmark={() => setAboutOpen(true)}
          onGrid={() => setGridOpen(true)}
          onSearch={() => setSearchOpen(true)}
          onMenu={() => setAboutOpen(true)}
        />
      ) : (
        <OpenTopBar
          onBack={closeJournal}
          onGrid={() => setGridOpen(true)}
          onSearch={() => setSearchOpen(true)}
          onMenu={() => setMenuOpen(true)}
        />
      )}

      {/* top-center page dots / menu */}
      <div className="pointer-events-none absolute inset-x-0 top-2.5 z-30 flex justify-center md:top-3">
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
      <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex flex-col items-center gap-1 md:top-20">
        {view === 'open' && detail ? (
          <TitleBlock title={detail.title} pageCount={detail.pages.length} mode="open" />
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
          visible={view === 'open'}
          label="Jump to page"
        />
      )}

      {/* hint chip */}
      {view === 'open' && !hintSeen && (
        <button
          type="button"
          className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/35 px-4 py-2 text-xs font-medium text-white/90 backdrop-blur-sm transition hover:bg-black/50 md:bottom-28"
          onClick={() => setHintSeen(true)}
        >
          Tap a page center to draw · edges to flip
        </button>
      )}

      {/* bottom dock */}
      {(view === 'shelf' || view === 'open') && (
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
        onDelete={() => {
          setMenuOpen(false);
          void deleteSelected();
        }}
        onExportPng={view === 'open' ? exportPagePng : undefined}
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
        onExportJournal={detail ? exportJournalJson : exportJournalJson}
        onCopyLink={copyLink}
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

      {/* drawing overlay */}
      {editTarget && detail && (
        <DrawingOverlay
          pageTitle={`${detail.title} · page ${editTarget.pageIndex + 1}`}
          paperColor={detail.paperColor || '#faf8f4'}
          initialContent={editTarget.content}
          onClose={() => setEditTarget(null)}
          onSave={(content) => {
            void savePage(content);
            setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}
