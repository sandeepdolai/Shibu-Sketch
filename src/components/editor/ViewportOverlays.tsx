'use client';

/**
 * ACAN3D — viewport HUD overlays (selection breadcrumb, camera presets,
 * stats, shading/display toggles, input hints). Pointer-events pass through
 * except on the controls themselves.
 */

import {
  Axis3d,
  Box,
  Boxes,
  Columns2,
  Focus,
  Grid3x3,
  Palette,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  Waypoints,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { runCommand, useEditor } from '@/lib/engine/store';

import { formatK } from './shared';

function HudBtn({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={title}
          onClick={onClick}
          className={cn(
            'size-8 rounded-sm text-muted-foreground hover:text-foreground',
            active && 'bg-amber-500/15 text-amber-600 hover:text-amber-600 dark:text-amber-500',
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-[10px]">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

function Breadcrumbs() {
  const selection = useEditor((s) => s.selection);
  const objects = useEditor((s) => s.objects);
  if (selection.length === 0) return null;

  const selected = selection
    .map((id) => objects.find((o) => o.id === id))
    .filter((o): o is NonNullable<typeof o> => Boolean(o));
  const shown = selected.slice(0, 3);
  const rest = selected.length - shown.length;

  return (
    <div className="pointer-events-auto flex flex-wrap gap-1">
      {shown.map((o) => (
        <button
          key={o.id}
          onClick={() => void runCommand('select_object', { objectId: o.id })}
          className="flex h-6 max-w-[14ch] items-center rounded-md border border-border/60 bg-background/80 px-1.5 text-[10px] backdrop-blur hover:border-amber-500/60"
          title={o.name}
        >
          <span className="truncate">{o.name}</span>
        </button>
      ))}
      {rest > 0 && (
        <span className="flex h-6 items-center rounded-md border border-border/60 bg-background/80 px-1.5 text-[10px] text-muted-foreground backdrop-blur">
          +{rest}
        </span>
      )}
    </div>
  );
}

function Stats() {
  const stats = useEditor((s) => s.stats);
  return (
    <div className="flex items-center gap-1 font-mono text-[10px] tabular-nums">
      <span className="rounded bg-background/70 px-1.5 py-0.5 backdrop-blur">
        {Math.round(stats.fps)} fps
      </span>
      <span className="rounded bg-background/70 px-1.5 py-0.5 backdrop-blur">
        tri {formatK(stats.triangles)}
      </span>
      <span className="rounded bg-background/70 px-1.5 py-0.5 backdrop-blur">
        obj {stats.objects}
      </span>
    </div>
  );
}

const SHADING_ICON = { solid: Box, material: Palette, wireframe: Waypoints } as const;
const SHADING_ORDER: Array<keyof typeof SHADING_ICON> = ['solid', 'material', 'wireframe'];

function DisplayControls() {
  const shading = useEditor((s) => s.shading);
  const showGrid = useEditor((s) => s.showGrid);
  const showAxes = useEditor((s) => s.showAxes);

  const ShadingIcon = SHADING_ICON[shading];
  const nextShading = SHADING_ORDER[(SHADING_ORDER.indexOf(shading) + 1) % SHADING_ORDER.length];

  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-border/60 bg-background/80 p-0.5 backdrop-blur">
      <HudBtn
        title={`Shading: ${shading} (cycle)`}
        active
        onClick={() => void runCommand('set_shading', { mode: nextShading })}
      >
        <ShadingIcon size={14} />
      </HudBtn>
      <HudBtn
        title={showGrid ? 'Hide grid' : 'Show grid'}
        active={showGrid}
        onClick={() => void runCommand('set_grid', { visible: !showGrid })}
      >
        <Grid3x3 size={14} />
      </HudBtn>
      <HudBtn
        title={showAxes ? 'Hide axes' : 'Show axes'}
        active={showAxes}
        onClick={() => void runCommand('set_axes', { visible: !showAxes })}
      >
        <Axis3d size={14} />
      </HudBtn>
    </div>
  );
}

function CameraControls() {
  const ortho = useEditor((s) => s.viewportOrtho);
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-border/60 bg-background/80 p-0.5 backdrop-blur">
      <HudBtn title="Isometric view" onClick={() => void runCommand('set_viewport_camera', { preset: 'iso' })}>
        <Box size={14} />
      </HudBtn>
      <HudBtn title="Front view" onClick={() => void runCommand('set_viewport_camera', { preset: 'front' })}>
        <RectangleHorizontal size={14} />
      </HudBtn>
      <HudBtn title="Top view" onClick={() => void runCommand('set_viewport_camera', { preset: 'top' })}>
        <RectangleVertical size={14} />
      </HudBtn>
      <HudBtn title="Right view" onClick={() => void runCommand('set_viewport_camera', { preset: 'right' })}>
        <Columns2 size={14} />
      </HudBtn>
      <HudBtn
        title={ortho ? 'Switch to perspective' : 'Switch to orthographic'}
        active={ortho}
        onClick={() => void runCommand('toggle_viewport_ortho')}
      >
        {ortho ? <Square size={14} /> : <Boxes size={14} />}
      </HudBtn>
      <HudBtn title="Frame selected" onClick={() => void runCommand('frame_object')}>
        <Focus size={14} />
      </HudBtn>
    </div>
  );
}

export function ViewportOverlays() {
  return (
    <div className="pointer-events-none absolute inset-0">
      {/* top-left: selection breadcrumb */}
      <div className="absolute left-2 top-2 max-w-[60%]">
        <Breadcrumbs />
      </div>

      {/* top-right: camera controls */}
      <div className="absolute right-2 top-2">
        <CameraControls />
      </div>

      {/* bottom-left: stats */}
      <div className="absolute bottom-2 left-2">
        <Stats />
      </div>

      {/* bottom-right: display controls */}
      <div className="absolute bottom-2 right-2">
        <DisplayControls />
      </div>

      {/* bottom-center: input hint (above controls on small screens) */}
      <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-[10px] leading-none opacity-60 sm:bottom-2.5">
        <span className="hidden sm:inline">
          LMB select · Drag orbit · RMB pan · Scroll zoom · G/R/S gizmo
        </span>
        <span className="sm:hidden">1 finger orbit · 2 pan · pinch zoom · tap select</span>
      </div>
    </div>
  );
}
