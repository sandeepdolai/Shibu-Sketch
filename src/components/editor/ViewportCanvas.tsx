'use client';

/**
 * ACAN3D — 3D viewport host.
 * Mounts the imperative three.js engine into a full-size div and never
 * touches three.js from React. All interaction with the engine goes through
 * the command router (runCommand). StrictMode double-mount safe.
 */

import { useEffect, useRef } from 'react';
import { Package } from 'lucide-react';

import type { CommandResult } from '@/lib/engine/types';
import { useEditor } from '@/lib/engine/store';

import { ViewportOverlays } from './ViewportOverlays';

interface EngineAPI {
  mount(container: HTMLElement): Promise<void>;
  dispose(): void;
  execute(command: string, params?: Record<string, unknown>): Promise<CommandResult>;
  isMounted(): boolean;
}

export function ViewportCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let api: EngineAPI | null = null;

    void (async () => {
      try {
        const mod = await import('@/lib/engine/engineAPI');
        api = (mod as { engineAPI: EngineAPI }).engineAPI;
        const el = hostRef.current;
        if (disposed || !el || !api || api.isMounted()) return;
        await api.mount(el);
      } catch {
        // engine module not built yet — overlays still render
      }
    })();

    return () => {
      disposed = true;
      try {
        api?.dispose();
      } catch {
        // ignore teardown races
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full touch-none select-none bg-[radial-gradient(120%_100%_at_50%_0%,#f4f1ea_0%,#e9e5dc_55%,#dcd7cb_100%)] dark:bg-[radial-gradient(120%_100%_at_50%_0%,#232326_0%,#1a1a1d_55%,#131315_100%)]"
      style={{ touchAction: 'none' }}
    >
      <ViewportOverlays />
      <ViewportEmptyHint />
    </div>
  );
}

/**
 * Shown when the scene holds nothing but the default lights.
 * Purely informational (pointer-events none) — disappears on first object.
 */
function ViewportEmptyHint() {
  const objects = useEditor((s) => s.objects);
  const ready = useEditor((s) => s.ready);
  const empty = ready && objects.filter((o) => o.type !== 'light').length === 0;
  if (!empty) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-background/70 px-6 py-5 text-center shadow-sm backdrop-blur-sm">
        <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/15">
          <Package className="size-5 text-amber-600" />
        </div>
        <p className="text-sm font-medium">Empty scene</p>
        <p className="max-w-[240px] text-xs leading-relaxed text-muted-foreground">
          Use <span className="font-medium text-foreground">Add</span> to create a mesh, book or
          light — or drive ACAN3D from the agent API:
          <span className="mt-1 block font-mono text-[10px]">POST /api/agent/command</span>
        </p>
      </div>
    </div>
  );
}
