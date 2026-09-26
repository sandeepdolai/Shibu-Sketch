'use client';

/**
 * Shibu-Sketch — full-screen journal search overlay.
 *
 * Backdrop blurs the 3D canvas; a centered glass panel holds the search input
 * (auto-focused) and the filtered journal list. Enter picks the first result,
 * Esc or backdrop click closes.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { Search } from 'lucide-react';

import type { JournalDTO } from '@/lib/sketch/types';

import { CoverPreview } from './NewJournalModal';

export interface SearchOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journals: JournalDTO[];
  onPick: (j: JournalDTO) => void;
}

export function SearchOverlay({
  open,
  onOpenChange,
  journals,
  onPick,
}: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Fresh query + autofocus on every open (state updates inside a timeout
  // callback, never synchronously within the effect body).
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      setQuery('');
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Esc closes even if focus left the input.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return journals;
    return journals.filter((j) => j.title.toLowerCase().includes(q));
  }, [journals, query]);

  if (!open) return null;

  const pick = (j: JournalDTO) => {
    onOpenChange(false);
    onPick(j);
  };

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      pick(results[0]);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search journals"
      onClick={() => onOpenChange(false)}
      className="fixed inset-0 z-40 animate-in fade-in-0 bg-black/40 backdrop-blur-sm duration-200"
    >
      <div
        className="flex min-h-full items-start justify-center p-4 pt-[12vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="
            w-full max-w-md animate-in fade-in-0 zoom-in-95 overflow-hidden rounded-2xl
            border border-white/15 bg-black/70 text-white shadow-2xl shadow-black/40
            backdrop-blur-md duration-200
          "
        >
          {/* input row */}
          <div className="flex items-center gap-2.5 border-b border-white/10 px-4">
            <Search className="size-4.5 shrink-0 text-white/50" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Search journals…"
              aria-label="Search journals"
              autoComplete="off"
              spellCheck={false}
              className="h-12 w-full min-w-0 bg-transparent text-base text-white outline-none placeholder:text-white/40"
            />
          </div>

          {/* results */}
          <div
            className="
              max-h-72 overflow-y-auto p-2
              [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20
              [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5
            "
          >
            {results.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-white/50">
                No journals found
              </p>
            ) : (
              results.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => pick(j)}
                  className="
                    flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left
                    transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50
                  "
                >
                  <span className="relative block h-10 w-8 shrink-0 overflow-hidden rounded shadow">
                    <CoverPreview style={j.coverStyle} showTitle={false} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                      {j.title}
                    </span>
                    <span className="block text-xs text-white/50">
                      {j.pageCount} {j.pageCount === 1 ? 'page' : 'pages'}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
