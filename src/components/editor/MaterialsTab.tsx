'use client';

/**
 * ACAN3D — material library tab + shared MaterialEditor.
 * MaterialEditor is reused by PropertiesPanel for the selected object.
 */

import * as React from 'react';
import { Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { runCommand, useEditor } from '@/lib/engine/store';
import type { MaterialDef, MaterialSlot } from '@/lib/engine/types';

import {
  MATERIAL_PRESETS,
  NumField,
  PROC_TYPES,
  SCROLL_THIN,
  SectionHeader,
} from './shared';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export function TexThumb({ url, size = 'size-8' }: { url?: string; size?: string }) {
  if (!url) {
    return <div className={cn('shrink-0 rounded border border-border/80 bg-muted', size)} />;
  }
  return (
    <img src={url} alt="" className={cn('shrink-0 rounded border border-border/80 object-cover', size)} />
  );
}

function MatSlider({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);

  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Slider
        value={[v]}
        min={0}
        max={1}
        step={0.01}
        onValueChange={(nv) => setV(nv[0] ?? 0)}
        onValueCommit={(nv) => onCommit(nv[0] ?? 0)}
        className="min-w-0 flex-1"
        aria-label={label}
      />
      <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
        {v.toFixed(2)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Texture slot row                                                    */
/* ------------------------------------------------------------------ */

const SLOTS: MaterialSlot[] = ['map', 'normalMap', 'roughnessMap'];

function SlotRow({ slot, material }: { slot: MaterialSlot; material: MaterialDef }) {
  const textures = useEditor((s) => s.textures);
  const [open, setOpen] = React.useState(false);
  const current = textures.find((t) => t.id === material.maps?.[slot]) ?? null;

  async function generate(procType: string) {
    const res = await runCommand('create_texture', { procType });
    if (res.ok) {
      const textureId = (res.result as { textureId?: string } | undefined)?.textureId;
      if (textureId) {
        await runCommand('assign_texture', { textureId, materialId: material.id, slot });
      }
    }
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{slot}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 min-w-0 flex-1 justify-start gap-1.5 text-xs font-normal"
          >
            <TexThumb url={current?.dataUrl} size="size-4" />
            <span className="truncate">{current?.name ?? 'none'}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-2">
          <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Textures
          </p>
          <div className={cn('max-h-40 overflow-y-auto', SCROLL_THIN)}>
            {textures.length === 0 && (
              <p className="px-1 py-1 text-xs text-muted-foreground">No textures yet.</p>
            )}
            {textures.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  void runCommand('assign_texture', { textureId: t.id, materialId: material.id, slot });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-accent"
              >
                <TexThumb url={t.dataUrl} size="size-5" />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {t.procType && (
                  <Badge variant="outline" className="text-[9px]">
                    {t.procType}
                  </Badge>
                )}
              </button>
            ))}
          </div>
          <Separator className="my-1.5" />
          <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Generate…
          </p>
          <div className="grid grid-cols-2 gap-1">
            {PROC_TYPES.map((pt) => (
              <Button
                key={pt}
                variant="outline"
                size="sm"
                className="h-6 justify-start px-1.5 text-[10px]"
                onClick={() => void generate(pt)}
              >
                {pt}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function RepeatRow({ material }: { material: MaterialDef }) {
  const rx = material.textureRepeat?.[0] ?? 1;
  const ry = material.textureRepeat?.[1] ?? 1;

  async function apply(x: number, y: number) {
    for (const slot of SLOTS) {
      const textureId = material.maps?.[slot];
      if (!textureId) continue;
      await runCommand('assign_texture', { textureId, materialId: material.id, slot, repeat: [x, y] });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">Repeat</span>
      <div className="flex min-w-0 flex-1 gap-1">
        <NumField
          ariaLabel="Repeat X"
          step={0.5}
          min={0.01}
          value={rx}
          onCommit={(v) => void apply(v, ry)}
          className="min-w-0 flex-1"
        />
        <NumField
          ariaLabel="Repeat Y"
          step={0.5}
          min={0.01}
          value={ry}
          onCommit={(v) => void apply(rx, v)}
          className="min-w-0 flex-1"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MaterialEditor (shared with PropertiesPanel)                        */
/* ------------------------------------------------------------------ */

export function MaterialEditor({
  materialId,
  objectId,
  className,
}: {
  materialId?: string;
  objectId?: string;
  className?: string;
}) {
  const materials = useEditor((s) => s.materials);
  const material = materials.find((m) => m.id === materialId);

  return (
    <div className={cn('space-y-2', className)}>
      {objectId && (
        <div className="flex gap-1">
          <Select
            value={materialId ?? ''}
            onValueChange={(v) => void runCommand('assign_material', { objectId, materialId: v })}
          >
            <SelectTrigger size="sm" className="h-7 min-w-0 flex-1 text-xs">
              <SelectValue placeholder="Assign material…" />
            </SelectTrigger>
            <SelectContent>
              {materials.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">No materials yet</div>
              )}
              {materials.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value=""
            onValueChange={(v) => void runCommand('set_material', { objectId, preset: v })}
          >
            <SelectTrigger size="sm" className="h-7 w-[112px] shrink-0 text-xs">
              <SelectValue placeholder="From preset…" />
            </SelectTrigger>
            <SelectContent>
              {MATERIAL_PRESETS.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!material ? null : (
        <div className="space-y-2 rounded-md border border-border/60 p-2">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={material.color}
              onChange={(e) =>
                void runCommand('update_material', {
                  materialId: material.id,
                  props: { color: e.target.value },
                })
              }
              aria-label="Base color"
              className="h-7 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{material.name}</span>
            {material.preset && (
              <Badge variant="outline" className="text-[9px]">
                {material.preset}
              </Badge>
            )}
          </div>
          <MatSlider
            label="Roughness"
            value={material.roughness}
            onCommit={(v) =>
              void runCommand('update_material', {
                materialId: material.id,
                props: { roughness: v },
              })
            }
          />
          <MatSlider
            label="Metalness"
            value={material.metalness}
            onCommit={(v) =>
              void runCommand('update_material', {
                materialId: material.id,
                props: { metalness: v },
              })
            }
          />
          <MatSlider
            label="Opacity"
            value={material.opacity}
            onCommit={(v) =>
              void runCommand('update_material', {
                materialId: material.id,
                props: { opacity: v },
              })
            }
          />
          <Separator />
          {SLOTS.map((slot) => (
            <SlotRow key={slot} slot={slot} material={material} />
          ))}
          <RepeatRow material={material} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MaterialsTab                                                        */
/* ------------------------------------------------------------------ */

export function MaterialsTab({ className }: { className?: string }) {
  const materials = useEditor((s) => s.materials);
  const textures = useEditor((s) => s.textures);
  const [selId, setSelId] = React.useState<string | null>(null);
  const selectedId =
    selId && materials.some((m) => m.id === selId) ? selId : materials[0]?.id;

  async function createFromPreset(preset: string) {
    const res = await runCommand('create_material', { preset, name: preset });
    if (res.ok) {
      const id = (res.result as { materialId?: string } | undefined)?.materialId;
      if (id) setSelId(id);
    }
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          <SectionHeader
            title="Materials"
            right={
              <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
                {materials.length}
              </Badge>
            }
          />
          <div className="space-y-1">
            {materials.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelId(m.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs',
                  m.id === selectedId
                    ? 'border-amber-500/60 bg-amber-500/10'
                    : 'border-border/60 hover:bg-accent/50',
                )}
              >
                <span
                  className="size-5 shrink-0 rounded border border-border/80"
                  style={{ backgroundColor: m.color }}
                />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                {m.preset && (
                  <Badge variant="outline" className="text-[9px]">
                    {m.preset}
                  </Badge>
                )}
              </button>
            ))}
            {materials.length === 0 && (
              <p className="py-2 text-xs text-muted-foreground">
                No materials yet — create one from a preset below.
              </p>
            )}
          </div>

          <Select value="" onValueChange={(v) => void createFromPreset(v)}>
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue placeholder="New material from preset…" />
            </SelectTrigger>
            <SelectContent>
              {MATERIAL_PRESETS.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedId && (
            <>
              <SectionHeader title="Material properties" />
              <MaterialEditor materialId={selectedId} />
            </>
          )}

          <SectionHeader
            title="Textures"
            right={
              <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
                {textures.length}
              </Badge>
            }
          />
          <div className="space-y-1">
            {textures.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
              >
                <TexThumb url={t.dataUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">{t.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {t.kind}
                    {t.procType ? ` · ${t.procType}` : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label="Delete texture"
                  title="Delete texture"
                  onClick={() => void runCommand('delete_texture', { textureId: t.id })}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
            {textures.length === 0 && (
              <p className="py-2 text-xs text-muted-foreground">
                No textures yet — generate one from a material slot.
              </p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
