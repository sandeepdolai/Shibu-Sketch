'use client';

/**
 * Shibu-Sketch — bottom dock: four white circle buttons
 * (…, share, trash, +) centered near the bottom edge.
 *
 * Hiding animates the dock down + fades it out (used during the
 * open/close journal transitions).
 */

import { MoreHorizontal, Plus, Trash2, Upload } from 'lucide-react';

import { cn } from '@/lib/utils';

import { DockButton } from './chrome';

export type BottomDockVariant = 'shelf' | 'open';

export interface BottomDockProps {
  onMore: () => void;
  onShare: () => void;
  onTrash: () => void;
  onPlus: () => void;
  /** Adjusts aria labels: shelf = journal actions, open = page/journal actions. */
  variant?: BottomDockVariant;
  /** When true the dock slides down and becomes inert. */
  hidden?: boolean;
  className?: string;
}

export function BottomDock({
  onMore,
  onShare,
  onTrash,
  onPlus,
  variant = 'shelf',
  hidden = false,
  className,
}: BottomDockProps) {
  return (
    <nav
      aria-label={variant === 'shelf' ? 'Shelf actions' : 'Journal actions'}
      aria-hidden={hidden || undefined}
      className={cn(
        'absolute inset-x-0 bottom-4 z-30 flex justify-center gap-3 transition-all duration-300 ease-out md:bottom-6',
        hidden && 'pointer-events-none translate-y-24 opacity-0',
        className,
      )}
    >
      <DockButton
        icon={<MoreHorizontal className="size-6" />}
        label={variant === 'shelf' ? 'More options' : 'Journal menu'}
        onClick={onMore}
      />
      <DockButton icon={<Upload className="size-6" />} label="Share" onClick={onShare} />
      <DockButton
        icon={<Trash2 className="size-6" />}
        label={variant === 'shelf' ? 'Delete selected journal' : 'Delete journal'}
        onClick={onTrash}
      />
      <DockButton
        icon={<Plus className="size-6" />}
        label={variant === 'shelf' ? 'New journal' : 'New page'}
        onClick={onPlus}
      />
    </nav>
  );
}
