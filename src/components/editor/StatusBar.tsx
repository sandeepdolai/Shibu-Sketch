'use client';

/**
 * ACAN3D — status bar (sticky footer): agent link, selection summary,
 * scene stats and version. Uses mt-auto semantics via parent flex column.
 */

import * as React from 'react';
import { useEditor } from '@/lib/engine/store';
import { APP_VERSION } from '@/lib/engine/types';

function AgentDot() {
  const agent = useEditor((s) => s.agent);
  const color =
    agent === 'online'
      ? 'bg-emerald-500'
      : agent === 'connecting'
        ? 'bg-amber-500'
        : 'bg-zinc-500';
  const pulse = agent === 'online' ? 'animate-pulse' : '';
  return (
    <span className="inline-flex items-center gap-1.5" title={`Agent link: ${agent}`}>
      <span className={`inline-block size-1.5 rounded-full ${color} ${pulse}`} />
      <span className="hidden sm:inline">
        Agent API {agent === 'online' ? 'online' : agent}
      </span>
    </span>
  );
}

export function StatusBar() {
  const objects = useEditor((s) => s.objects);
  const selection = useEditor((s) => s.selection);
  const stats = useEditor((s) => s.stats);

  const selNames = selection
    .map((id) => objects.find((o) => o.id === id)?.name)
    .filter(Boolean) as string[];
  const selSummary =
    selNames.length === 0
      ? 'no selection'
      : selNames.length <= 2
        ? selNames.join(', ')
        : `${selNames.length} objects`;

  return (
    <footer className="mt-auto flex h-7 shrink-0 items-center gap-3 border-t bg-background px-2 text-[11px] text-muted-foreground">
      <AgentDot />
      <span className="hidden md:inline">Selected: {selSummary}</span>
      <span className="ml-auto hidden sm:inline">
        {stats.objects} objs · {stats.triangles.toLocaleString()} tris
      </span>
      <span className="tabular-nums">{Math.round(stats.fps)} fps</span>
      <span className="hidden lg:inline">v{APP_VERSION}</span>
      <span className="hidden xl:inline font-mono">POST /api/agent/command</span>
    </footer>
  );
}
