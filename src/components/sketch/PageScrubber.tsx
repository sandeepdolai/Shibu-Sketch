'use client';

/**
 * Shibu-Sketch — right-edge vertical page scrubber (the dark pill with the
 * round knob from the real app). Dragging maps clientY → value 0..1.
 *
 * Pointer Events + setPointerCapture → works for mouse, touch and pen.
 * The knob animates its position only while NOT dragging (drag follows the
 * finger 1:1, programmatic page flips glide).
 */

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { cn } from '@/lib/utils';

const KNOB_PX = 24; // knob is size-6 = 1.5rem

export interface PageScrubberProps {
  /** 0..1 — position within the journal. */
  value: number;
  onChange: (v: number) => void;
  visible: boolean;
  label?: string;
  className?: string;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function PageScrubber({
  value,
  onChange,
  visible,
  label = 'Scroll through pages',
  className,
}: PageScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const clamped = clamp01(value);

  const valueFromEvent = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.height <= KNOB_PX) return clamped;
      const y = e.clientY - rect.top - KNOB_PX / 2;
      return clamp01(y / (rect.height - KNOB_PX));
    },
    [clamped],
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!visible) return;
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(valueFromEvent(e));
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    onChange(valueFromEvent(e));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released — noop */
    }
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(clamp01(clamped + step));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(clamp01(clamped - step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(1);
    }
  };

  return (
    <div
      className={cn(
        'fixed right-2 top-1/2 z-30 -translate-y-1/2 transition-all duration-300 ease-out md:right-3',
        visible ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-16 opacity-0',
        className,
      )}
    >
      <div
        ref={trackRef}
        role="slider"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        tabIndex={visible ? 0 : -1}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative h-28 w-10 touch-none select-none rounded-full bg-black/30 backdrop-blur-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 md:h-36',
          !visible && 'pointer-events-none',
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            'absolute left-1/2 size-6 -translate-x-1/2 rounded-full bg-white/70 shadow-md',
            !dragging && 'transition-[top] duration-150 ease-out',
          )}
          style={{ top: `calc((100% - 1.5rem) * ${clamped})` }}
        />
      </div>
    </div>
  );
}
