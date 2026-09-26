'use client';

/**
 * ACAN3D — animation timeline: transport, keyframing, scrubber with
 * keyframe diamonds (transform) and bars (page turn / book open).
 * Scrubbing uses pointer capture and only sends set_frame when the
 * integer frame changes.
 */

import * as React from 'react';
import { Pause, Play, SkipBack, Square, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { runCommand, useEditor } from '@/lib/engine/store';

import { NumField } from './shared';

const CHANNEL_COLORS = {
  position: '#f59e0b', // amber-500
  rotation: '#10b981', // emerald-500
  scale: '#f43f5e', // rose-500
} as const;

function Scrubber({ className }: { className?: string }) {
  const anim = useEditor((s) => s.anim);
  const selection = useEditor((s) => s.selection);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const lastFrameRef = React.useRef<number | null>(null);

  const selId = selection[0];
  const tracks = selId ? anim.tracks.filter((t) => t.objectId === selId) : [];

  const span = Math.max(1, anim.end - anim.start);
  const pct = (frame: number) =>
    Math.min(100, Math.max(0, ((frame - anim.start) / span) * 100));

  const frameFromEvent = (e: React.PointerEvent<HTMLDivElement>): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return anim.current;
    const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return Math.round(anim.start + p * span);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const f = frameFromEvent(e);
    if (f !== lastFrameRef.current) {
      lastFrameRef.current = f;
      void runCommand('set_frame', { frame: f });
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const f = frameFromEvent(e);
    if (f !== lastFrameRef.current) {
      lastFrameRef.current = f;
      void runCommand('set_frame', { frame: f });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Timeline scrubber"
      aria-valuemin={anim.start}
      aria-valuemax={anim.end}
      aria-valuenow={anim.current}
      tabIndex={-1}
      className={cn(
        'relative cursor-pointer touch-none select-none border-t bg-muted/30',
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* ticks — minor every 5%, labeled majors */}
      {Array.from({ length: 21 }, (_, i) => i * 5).map((p) => (
        <div
          key={p}
          className={cn(
            'absolute top-0 w-px',
            p % 25 === 0 ? 'h-2.5 bg-border' : 'h-1.5 bg-border/40',
          )}
          style={{ left: `${p}%` }}
        />
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((p) => {
        const f = Math.round(anim.start + p * span);
        return (
          <span
            key={p}
            className="pointer-events-none absolute top-0.5 font-mono text-[8px] tabular-nums text-muted-foreground/70"
            style={{ left: `calc(${p * 100}% + 3px)` }}
          >
            {f}
          </span>
        );
      })}

      {/* tracks */}
      <div className="pointer-events-none absolute inset-0">
        {tracks.map((tr) => {
          if (tr.type === 'transform') {
            return (
              <React.Fragment key={tr.id}>
                {tr.keys.map((k, i) => (
                  <button
                    key={`${tr.id}-${i}`}
                    title={`${tr.channel} key @ ${k.frame}`}
                    aria-label={`${tr.channel} key at frame ${k.frame}`}
                    className="pointer-events-auto absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border border-zinc-950/30 hover:scale-125"
                    style={{ left: `${pct(k.frame)}%`, backgroundColor: CHANNEL_COLORS[tr.channel] }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void runCommand('set_frame', { frame: k.frame });
                    }}
                  />
                ))}
              </React.Fragment>
            );
          }
          const start = pct(tr.startFrame);
          const end = pct(tr.endFrame);
          const color =
            tr.type === 'pageTurn'
              ? { backgroundColor: 'rgba(245,158,11,0.25)', borderColor: 'rgba(245,158,11,0.6)' }
              : { backgroundColor: 'rgba(16,185,129,0.25)', borderColor: 'rgba(16,185,129,0.6)' };
          return (
            <div
              key={tr.id}
              title={`${tr.type} · frames ${tr.startFrame}–${tr.endFrame}`}
              className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full border"
              style={{ left: `${start}%`, width: `${Math.max(0.5, end - start)}%`, ...color }}
            />
          );
        })}
      </div>

      {/* playhead */}
      <div
        className="pointer-events-none absolute top-0 h-full w-0.5 bg-amber-500"
        style={{ left: `${pct(anim.current)}%` }}
      >
        <div className="absolute -left-[3px] top-0 size-2 rounded-b-sm bg-amber-500" />
      </div>

      {/* range labels */}
      <span className="pointer-events-none absolute bottom-0.5 left-1 font-mono text-[9px] tabular-nums text-muted-foreground">
        {anim.start}
      </span>
      <span className="pointer-events-none absolute bottom-0.5 right-1 font-mono text-[9px] tabular-nums text-muted-foreground">
        {anim.end}
      </span>
    </div>
  );
}

export function Timeline({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const anim = useEditor((s) => s.anim);
  const autoKey = useEditor((s) => s.autoKey);
  const setAutoKey = useEditor((s) => s.setAutoKey);
  const selection = useEditor((s) => s.selection);
  const objects = useEditor((s) => s.objects);

  const selId = selection[0];
  const selObj = selId ? objects.find((o) => o.id === selId) : undefined;
  const isPage = !!selObj?.pageMeta;
  const isBook =
    !!selObj &&
    selObj.type === 'group' &&
    objects.some((o) => o.parentId === selObj.id && !!o.pageMeta);

  return (
    <div className={cn('shrink-0 bg-background', className)}>
      {/* transport */}
      <div className={cn('flex items-center gap-1 border-t px-2', compact ? 'h-9' : 'h-10')}>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label="To start"
          title="To start"
          onClick={() => void runCommand('set_frame', { frame: anim.start })}
        >
          <SkipBack size={13} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'size-7',
            anim.playing
              ? 'text-amber-600 dark:text-amber-500'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label={anim.playing ? 'Pause' : 'Play'}
          title={anim.playing ? 'Pause' : 'Play'}
          onClick={() =>
            void runCommand(anim.playing ? 'pause_animation' : 'play_animation')
          }
        >
          {anim.playing ? <Pause size={13} /> : <Play size={13} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          aria-label="Stop"
          title="Stop"
          onClick={() => void runCommand('stop_animation')}
        >
          <Square size={11} />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <NumField
          ariaLabel="Current frame"
          step={1}
          value={anim.current}
          onCommit={(f) => void runCommand('set_frame', { frame: Math.round(f) })}
          className="w-11"
        />
        <span className="text-[10px] text-muted-foreground">/</span>
        <NumField
          ariaLabel="End frame"
          step={1}
          value={anim.end}
          onCommit={(f) =>
            void runCommand('set_animation_settings', { end: Math.max(1, Math.round(f)) })
          }
          className="w-11"
        />
        <NumField
          ariaLabel="Frames per second"
          step={1}
          value={anim.fps}
          onCommit={(f) =>
            void runCommand('set_animation_settings', { fps: Math.max(1, Math.round(f)) })
          }
          className="w-10"
        />

        <label className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground">
          Loop
          <Switch
            checked={anim.loop}
            onCheckedChange={(v) => void runCommand('set_animation_settings', { loop: v })}
            aria-label="Loop"
          />
        </label>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          Auto-key
          <Switch
            checked={autoKey}
            onCheckedChange={setAutoKey}
            aria-label="Auto keyframe"
            className={cn(autoKey && 'data-[state=checked]:bg-amber-500')}
          />
        </label>

        <div className="ml-auto flex items-center gap-1">
          {!compact && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Key</span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px]"
            disabled={!selObj}
            title="Key position"
            onClick={() => void runCommand('set_keyframe', { objectId: selId, channel: 'position' })}
          >
            Pos
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px]"
            disabled={!selObj}
            title="Key rotation"
            onClick={() => void runCommand('set_keyframe', { objectId: selId, channel: 'rotation' })}
          >
            Rot
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px]"
            disabled={!selObj}
            title="Key scale"
            onClick={() => void runCommand('set_keyframe', { objectId: selId, channel: 'scale' })}
          >
            Scl
          </Button>
          {isPage && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[10px]"
              title="Add page turn track"
              onClick={() => void runCommand('create_page_turn', { objectId: selId })}
            >
              Turn
            </Button>
          )}
          {isBook && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[10px]"
              title="Add book open track"
              onClick={() => void runCommand('create_book_open', { objectId: selId })}
            >
              Open
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            aria-label="Clear animation"
            title="Clear animation"
            disabled={!selObj}
            onClick={() => void runCommand('clear_animation', { objectId: selId })}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {/* scrubber */}
      <Scrubber className={compact ? 'h-8' : 'h-10'} />
    </div>
  );
}
