'use client';

/**
 * Shibu-Sketch — journal "…" menu (shelf + open modes).
 *
 * A dialog listing journal actions. Delete is a two-step flow:
 * tapping "Delete journal…" opens a nested AlertDialog confirm
 * ("Delete '<title>'? This cannot be undone." Cancel / Delete).
 */

import { useState, type ReactNode } from 'react';

import { Copy, FileMinus, ImageDown, Info, Pencil, Plus, Trash2 } from 'lucide-react';

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
  onAddPage?: () => void;
  onDeletePage?: () => void;
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
  onAbout,
}: JournalMenuProps) {
  const [confirming, setConfirming] = useState<'journal' | 'page' | null>(null);

  /** Reset the confirm step on every close path (Esc, backdrop, X, action). */
  const handleMenuOpenChange = (o: boolean) => {
    if (!o) setConfirming(null);
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
        <DialogHeader>
          <DialogTitle className="truncate pr-6">
            {journalTitle || 'Journal'}
          </DialogTitle>
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
              label="Add page after this spread"
              onClick={() => runAndClose(onAddPage)}
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
