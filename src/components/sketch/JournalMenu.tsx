'use client';

/**
 * Shibu-Sketch — journal "…" menu (shelf + open modes).
 *
 * A dialog listing journal actions. Delete is a two-step flow:
 * tapping "Delete journal…" opens a nested AlertDialog confirm
 * ("Delete '<title>'? This cannot be undone." Cancel / Delete).
 */

import { useState, type ReactNode } from 'react';

import { Copy, CopyPlus, FileMinus, FileUp, ImageDown, Info, Pencil, Plus, Trash2 } from 'lucide-react';

import type { PageTemplate } from '@/lib/sketch/types';

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type JournalMenuMode = 'shelf' | 'open';

export interface JournalMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: JournalMenuMode;
  journalTitle: string;
  /** When false the Delete row is hidden (e.g. last journal). */
  canDelete: boolean;
  onRename: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
  /** Only rendered when provided (page export makes sense in open mode). */
  onExportPng?: () => void;
  /** Open-mode page management (hidden when absent). */
  onAddPage?: (template: PageTemplate) => void;
  onDeletePage?: () => void;
  /** Open-mode page copy (hidden when absent). */
  onDuplicatePage?: () => void;
  /** Shelf-mode JSON import (hidden when absent). */
  onImport?: () => void;
  onAbout: () => void;
}

function MenuAction({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        destructive ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-muted',
      )}
    >
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

const PAGE_TEMPLATES: { id: PageTemplate; label: string; hint: string }[] = [
  { id: 'plain', label: 'Plain', hint: 'Blank paper' },
  { id: 'dotted', label: 'Dotted', hint: 'Bullet-journal dots' },
  { id: 'grid', label: 'Grid', hint: 'Graph squares' },
  { id: 'lined', label: 'Lined', hint: 'Ruled notebook' },
];

/** Tiny proportional preview of a page template (pure CSS, no canvas). */
function TemplateChip({ id, active }: { id: PageTemplate; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block h-12 w-9 shrink-0 overflow-hidden rounded-md border bg-[#faf8f4]',
        active ? 'border-zinc-900 ring-2 ring-zinc-900/15' : 'border-zinc-300',
      )}
    >
      {id === 'dotted' && (
        <span
          className="absolute inset-1.5"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(120,110,90,0.5) 1px, transparent 1.2px)',
            backgroundSize: '6px 6px',
          }}
        />
      )}
      {id === 'grid' && (
        <span
          className="absolute inset-1.5"
          style={{
            backgroundImage:
              'linear-gradient(rgba(120,110,90,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(120,110,90,0.4) 1px, transparent 1px)',
            backgroundSize: '7px 7px',
          }}
        />
      )}
      {id === 'lined' && (
        <span
          className="absolute inset-x-1.5 top-2 bottom-2"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to bottom, transparent 0 4px, rgba(120,110,90,0.45) 4px 5px)',
          }}
        />
      )}
      {id === 'lined' && (
        <span className="absolute inset-y-0 left-1 w-px bg-[#dc787899]" />
      )}
    </span>
  );
}

export function JournalMenu({
  open,
  onOpenChange,
  mode,
  journalTitle,
  canDelete,
  onRename,
  onDuplicate,
  onDelete,
  onExportPng,
  onAddPage,
  onDeletePage,
  onDuplicatePage,
  onImport,
  onAbout,
}: JournalMenuProps) {
  const [confirming, setConfirming] = useState<'journal' | 'page' | null>(null);
  const [pickingTemplate, setPickingTemplate] = useState(false);

  /** Reset the confirm/template steps on every close path (Esc, backdrop, X, action). */
  const handleMenuOpenChange = (o: boolean) => {
    if (!o) {
      setConfirming(null);
      setPickingTemplate(false);
    }
    onOpenChange(o);
  };

  const runAndClose = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  const handleDelete = () => {
    const kind = confirming;
    setConfirming(null);
    onOpenChange(false);
    if (kind === 'page' && onDeletePage) onDeletePage();
    else if (kind === 'journal') onDelete();
  };

  return (
    <Dialog open={open} onOpenChange={handleMenuOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {pickingTemplate ? (
          <>
            <DialogHeader>
              <DialogTitle>Add a page</DialogTitle>
              <DialogDescription>
                Pick a paper template for the new page (added after this spread).
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {PAGE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setPickingTemplate(false);
                    onOpenChange(false);
                    onAddPage?.(t.id);
                  }}
                  className={cn(
                    'flex min-h-14 items-center gap-3 rounded-xl border border-zinc-200 p-2.5 text-left transition',
                    'hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <TemplateChip id={t.id} active={false} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-zinc-900">{t.label}</span>
                    <span className="block truncate text-xs text-zinc-500">{t.hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPickingTemplate(false)}
              className="mt-1 min-h-9 w-full rounded-full border border-zinc-200 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
            >
              Back
            </button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-6">{journalTitle || 'Journal'}</DialogTitle>
              <DialogDescription>
                {mode === 'shelf'
                  ? 'Actions for the selected journal.'
                  : 'Actions for this journal.'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1">
              <MenuAction
                icon={<Pencil className="size-4" />}
                label="Rename"
                onClick={() => runAndClose(onRename)}
              />
              {onDuplicate && (
                <MenuAction
                  icon={<Copy className="size-4" />}
                  label="Duplicate"
                  onClick={() => runAndClose(onDuplicate)}
                />
              )}
              {onImport && (
                <MenuAction
                  icon={<FileUp className="size-4" />}
                  label="Import journal backup…"
                  onClick={() => runAndClose(onImport)}
                />
              )}
              {onExportPng && (
                <MenuAction
                  icon={<ImageDown className="size-4" />}
                  label="Export page as PNG"
                  onClick={() => runAndClose(onExportPng)}
                />
              )}
              {onAddPage && (
                <MenuAction
                  icon={<Plus className="size-4" />}
                  label="Add page after this spread…"
                  onClick={() => setPickingTemplate(true)}
                />
              )}
              {onDuplicatePage && (
                <MenuAction
                  icon={<CopyPlus className="size-4" />}
                  label="Duplicate current page"
                  onClick={() => runAndClose(onDuplicatePage)}
                />
              )}
              {onDeletePage && (
                <MenuAction
                  icon={<FileMinus className="size-4" />}
                  label="Delete current page…"
                  destructive
                  onClick={() => setConfirming('page')}
                />
              )}
              {canDelete && (
                <MenuAction
                  icon={<Trash2 className="size-4" />}
                  label="Delete journal…"
                  destructive
                  onClick={() => setConfirming('journal')}
                />
              )}
              <MenuAction
                icon={<Info className="size-4" />}
                label="About Shibu Sketch"
                onClick={() => runAndClose(onAbout)}
              />
            </div>
          </>
        )}
      </DialogContent>

      {/* Two-step delete confirmation, nested above the menu dialog. */}
      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          {confirming === 'page' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this page?</AlertDialogTitle>
                <AlertDialogDescription>
                  The current page will be removed and later pages shift up. This
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive"
                  onClick={handleDelete}
                >
                  Delete page
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &ldquo;{journalTitle}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. The journal and all of its pages will be
                  permanently removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive"
                  onClick={handleDelete}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
