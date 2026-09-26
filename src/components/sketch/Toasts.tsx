'use client';

/**
 * Shibu-Sketch — toast helper.
 *
 * The repo mounts the global shadcn/radix `<Toaster />` in
 * `src/app/layout.tsx` (radix-based, NOT sonner), so this file is just a
 * thin typed wrapper around `useToast()` from `@/hooks/use-toast`.
 * Do NOT render another <Toaster /> — just call useSketchToast().
 */

import { useCallback } from 'react';

import { useToast } from '@/hooks/use-toast';

export type SketchToastKind = 'default' | 'success' | 'destructive';

export type SketchToastFn = (msg: string, kind?: SketchToastKind) => void;

export function useSketchToast(): { toast: SketchToastFn } {
  const { toast } = useToast();

  const sketchToast = useCallback<SketchToastFn>(
    (msg, kind = 'default') => {
      toast({
        description: msg,
        variant: kind === 'destructive' ? 'destructive' : 'default',
        duration: kind === 'destructive' ? 5000 : 2500,
      });
    },
    [toast],
  );

  return { toast: sketchToast };
}
