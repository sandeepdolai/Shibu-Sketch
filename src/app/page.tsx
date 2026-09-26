'use client';

/**
 * ACAN3D — AI-Controllable Web-Based 3D Software.
 * The editor is client-only (WebGL + imperative three.js engine).
 */

import dynamic from 'next/dynamic';

const EditorShell = dynamic(
  () => import('@/components/editor/EditorShell').then((m) => m.EditorShell),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-background text-foreground">
        <div className="flex size-10 animate-pulse items-center justify-center rounded-lg bg-amber-500 font-bold text-zinc-950">
          A
        </div>
        <p className="text-sm text-muted-foreground">Starting ACAN3D engine…</p>
      </div>
    ),
  },
);

export default function Home() {
  return <EditorShell />;
}
