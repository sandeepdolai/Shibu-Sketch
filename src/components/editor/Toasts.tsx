'use client';

/**
 * ACAN3D — command toast stack.
 * Renders store.toasts (pushed by the engine) in a fixed bottom-center
 * stack; every toast auto-dismisses after 3.5s.
 */

import { useEffect } from 'react';
import { Check, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useEditor, type ToastMsg } from '@/lib/engine/store';

function ToastItem({ id, ok, text }: ToastMsg) {
  const dropToast = useEditor((s) => s.dropToast);

  useEffect(() => {
    const t = setTimeout(() => dropToast(id), 3500);
    return () => clearTimeout(t);
  }, [id, dropToast]);

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex max-w-[72ch] items-center gap-1.5 rounded-md border bg-background/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur',
        ok
          ? 'border-emerald-500/40 text-foreground'
          : 'border-destructive/50 text-destructive',
      )}
    >
      {ok ? (
        <Check size={12} className="shrink-0 text-emerald-500" />
      ) : (
        <X size={12} className="shrink-0" />
      )}
      <span className="truncate">{text}</span>
    </div>
  );
}

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);

  return (
    <div className="pointer-events-none fixed bottom-10 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} ok={t.ok} text={t.text} />
      ))}
    </div>
  );
}
