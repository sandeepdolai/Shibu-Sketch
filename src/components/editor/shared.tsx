'use client';

/**
 * ACAN3D — shared UI atoms for the editor panels.
 * Dense DCC-style building blocks: section headers, numeric fields,
 * vector fields and the procedural generator dialogs (book / paper stack).
 */

import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { runCommand } from '@/lib/engine/store';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const MATERIAL_PRESETS = [
  'paper',
  'cardboard',
  'leather',
  'plastic',
  'wood',
  'metal',
  'glass',
  'rubber',
  'fabric',
] as const;

export const PROC_TYPES = [
  'paper',
  'ruled_paper',
  'cardboard',
  'leather',
  'wood',
  'plastic',
  'brushed_metal',
  'checker',
  'grid',
  'noise',
  'marble',
] as const;

/** Styled thin scrollbar for overflow containers. */
export const SCROLL_THIN =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border';

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

export function formatNum(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 1000) / 1000);
}

export function formatK(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function radToDeg(v: number): number {
  return (v * 180) / Math.PI;
}

/* ------------------------------------------------------------------ */
/* Section header (shared pattern for every panel)                     */
/* ------------------------------------------------------------------ */

export function SectionHeader({
  title,
  right,
  className,
}: {
  title: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      <div className="h-px flex-1 bg-border" />
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* NumField — compact numeric input that commits on blur / Enter       */
/* ------------------------------------------------------------------ */

export function NumField({
  value,
  onCommit,
  step = 0.01,
  min,
  max,
  className,
  ariaLabel,
  disabled,
}: {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);

  const commit = () => {
    if (draft !== null) {
      const v = parseFloat(draft);
      if (Number.isFinite(v)) onCommit(v);
    }
    setDraft(null);
  };

  return (
    <Input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      aria-label={ariaLabel}
      value={draft ?? formatNum(value)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        'h-7 rounded-md border-border/80 bg-background/60 px-1.5 text-right font-mono text-[11px] tabular-nums',
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Vec3Field — 3x axis inputs with X/Y/Z colored labels                */
/* ------------------------------------------------------------------ */

const AXES = [
  { key: 'x' as const, label: 'X', cls: 'text-red-500' },
  { key: 'y' as const, label: 'Y', cls: 'text-emerald-500' },
  { key: 'z' as const, label: 'Z', cls: 'text-muted-foreground' },
];

export function Vec3Field({
  label,
  value,
  onCommit,
  step = 0.01,
  disabled,
}: {
  label: string;
  value: { x: number; y: number; z: number };
  onCommit: (v: { x: number; y: number; z: number }) => void;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="grid grid-cols-3 gap-1">
        {AXES.map((a) => (
          <div
            key={a.key}
            className="flex min-w-0 items-center gap-0.5 rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5"
          >
            <span className={cn('w-2 text-[10px] font-semibold', a.cls)}>{a.label}</span>
            <NumField
              ariaLabel={`${label} ${a.label.toUpperCase()}`}
              disabled={disabled}
              step={step}
              value={value[a.key]}
              onCommit={(v) => onCommit({ ...value, [a.key]: v })}
              className="h-6 w-full min-w-0 border-0 bg-transparent px-0"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LabeledRow                                                          */
/* ------------------------------------------------------------------ */

export function LabeledRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Procedural generator dialogs                                        */
/* ------------------------------------------------------------------ */

function SmallField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs"
      />
    </div>
  );
}

function SmallSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="h-7 w-full text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="text-xs">
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CreateBookDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [pageCount, setPageCount] = React.useState('200');
  const [pageWidth, setPageWidth] = React.useState('0.15');
  const [pageHeight, setPageHeight] = React.useState('0.21');
  const [coverColor, setCoverColor] = React.useState('#7a3b2e');
  const [coverPreset, setCoverPreset] = React.useState('cardboard');
  const [paperTexture, setPaperTexture] = React.useState('none');

  async function create() {
    await runCommand('create_book', {
      pageCount: Math.max(1, Math.round(parseFloat(pageCount) || 200)),
      pageWidth: parseFloat(pageWidth) || 0.15,
      pageHeight: parseFloat(pageHeight) || 0.21,
      coverColor,
      coverMaterialPreset: coverPreset,
      paperTexture: paperTexture === 'none' ? undefined : paperTexture,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs gap-3">
        <DialogHeader>
          <DialogTitle className="text-sm">Create book</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Hard cover, spine and individual bendable page meshes.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <SmallField label="Pages" value={pageCount} onChange={setPageCount} type="number" />
          <SmallField label="Page width (m)" value={pageWidth} onChange={setPageWidth} type="number" />
          <SmallField label="Page height (m)" value={pageHeight} onChange={setPageHeight} type="number" />
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Cover color</Label>
            <input
              type="color"
              value={coverColor}
              onChange={(e) => setCoverColor(e.target.value)}
              aria-label="Cover color"
              className="h-7 w-full cursor-pointer rounded-md border border-input bg-transparent p-0.5"
            />
          </div>
          <SmallSelect
            label="Cover preset"
            value={coverPreset}
            onChange={setCoverPreset}
            options={['cardboard', 'leather', 'paper']}
          />
          <SmallSelect
            label="Paper texture"
            value={paperTexture}
            onChange={setPaperTexture}
            options={['none', 'paper', 'ruled_paper']}
          />
        </div>
        <DialogFooter>
          <Button size="sm" onClick={() => void create()} className="min-h-9">
            Create book
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreatePaperStackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [count, setCount] = React.useState('20');
  const [width, setWidth] = React.useState('0.21');
  const [height, setHeight] = React.useState('0.297');

  async function create() {
    await runCommand('create_paper_stack', {
      count: Math.max(1, Math.round(parseFloat(count) || 20)),
      width: parseFloat(width) || 0.21,
      height: parseFloat(height) || 0.297,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs gap-3">
        <DialogHeader>
          <DialogTitle className="text-sm">Create paper stack</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Loose A4-style sheets with natural jitter.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          <SmallField label="Sheets" value={count} onChange={setCount} type="number" />
          <SmallField label="Width (m)" value={width} onChange={setWidth} type="number" />
          <SmallField label="Height (m)" value={height} onChange={setHeight} type="number" />
        </div>
        <DialogFooter>
          <Button size="sm" onClick={() => void create()} className="min-h-9">
            Create stack
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
