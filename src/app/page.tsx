'use client';

/**
 * Shibu-Sketch — a pocket journal studio in the browser.
 * Sketch, sticker, and flip through beautiful 3D notebooks.
 * (Client-only: WebGL + imperative three.js engine.)
 */

import dynamic from 'next/dynamic';

const SketchApp = dynamic(() => import('@/components/sketch/SketchApp'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-[#8b88a6] text-white">
      <div className="flex items-end gap-1">
        <span className="inline-block h-6 w-1.5 animate-pulse rounded-full bg-white/90" />
        <span className="inline-block h-8 w-1.5 animate-pulse rounded-full bg-white/70 [animation-delay:120ms]" />
        <span className="inline-block h-7 w-1.5 animate-pulse rounded-full bg-white/80 [animation-delay:240ms]" />
      </div>
      <p className="text-sm font-medium tracking-wide">Opening your journals…</p>
    </div>
  ),
});

export default function Page() {
  return <SketchApp />;
}
