'use client';

/**
 * Shibu-Sketch — share sheet.
 *
 * Dialog with three rows: export current page as PNG, export journal data
 * (JSON), copy link. Copy shows local "Copied!" feedback for 1.5s; the
 * actual clipboard write / export work happens in the parent callbacks.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Check, Download, ImageDown, Link2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface ShareSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Journal title shown in the header. */
  title: string;
  /** Optional — row hidden when not provided (e.g. shelf mode). */
  onExportPage?: () => void;
  onExportJournal: () => void;
  /** Copies location.href in the parent; the sheet shows "Copied!" feedback. */
  onCopyLink: () => void;
}

function ShareRow({
  icon,
  label,
  onClick,
  done = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  done?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium
        transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
      "
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
      >
        {icon}
      </span>
      <span className={cn('truncate', done && 'font-semibold')}>{done ? 'Copied!' : label}</span>
      {done && <Check className="ml-auto size-4 shrink-0 text-foreground" aria-hidden="true" />}
    </button>
  );
}

const COPY_FEEDBACK_MS = 1500;

export function ShareSheet({
  open,
  onOpenChange,
  title,
  onExportPage,
  onExportJournal,
  onCopyLink,
}: ShareSheetProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Clear pending feedback timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  /** Reset feedback on every close path (Esc, backdrop, X). */
  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setCopied(false);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    onOpenChange(o);
  };

  const handleCopy = () => {
    onCopyLink();
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">Share</DialogTitle>
          <DialogDescription className="truncate">
            &ldquo;{title}&rdquo;
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          {onExportPage && (
            <ShareRow
              icon={<ImageDown className="size-4" />}
              label="Export current page as PNG"
              onClick={onExportPage}
            />
          )}
          <ShareRow
            icon={<Download className="size-4" />}
            label="Export journal data (JSON)"
            onClick={onExportJournal}
          />
          <ShareRow
            icon={<Link2 className="size-4" />}
            label="Copy link"
            onClick={handleCopy}
            done={copied}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
