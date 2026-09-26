'use client';

/**
 * ACAN3D — 3D viewport host.
 * Mounts the imperative three.js engine into a full-size div and never
 * touches three.js from React. All interaction with the engine goes through
 * the command router (runCommand). StrictMode double-mount safe.
 */

import { useEffect, useRef } from 'react';

import type { CommandResult } from '@/lib/engine/types';

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
      className="relative h-full w-full touch-none select-none"
      style={{ touchAction: 'none' }}
    >
      <ViewportOverlays />
    </div>
  );
}
