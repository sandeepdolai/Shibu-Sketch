'use client';

/**
 * ACAN3D — properties inspector for the first selected object:
 * object / transform / mesh-edit / material / light / camera / page sections.
 * All mutations go through runCommand().
 */

import * as React from 'react';
import {
  BookOpen,
  Box,
  Camera,
  Circle,
  Combine,
  Cylinder,
  FlipHorizontal,
  Grid2x2,
  Lightbulb,
  Trash2,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { runCommand, useEditor } from '@/lib/engine/store';
import type { ObjectInfo } from '@/lib/engine/types';

import { CreateBookDialog, NumField, radToDeg, SectionHeader, Vec3Field } from './shared';
import { MaterialEditor } from './MaterialsTab';

/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <SectionHeader title={title} />
      {children}
    </section>
  );
}

function QuickAdd() {
  const [bookOpen, setBookOpen] = React.useState(false);
  return (
    <div className="grid grid-cols-3 gap-1">
      {(
        [
          { label: 'Box', icon: Box, run: () => runCommand('create_object', { type: 'box' }) },
          { label: 'Sphere', icon: Circle, run: () => runCommand('create_object', { type: 'sphere' }) },
          { label: 'Cylinder', icon: Cylinder, run: () => runCommand('create_object', { type: 'cylinder' }) },
          { label: 'Light', icon: Lightbulb, run: () => runCommand('create_light', { lightType: 'directional' }) },
          { label: 'Camera', icon: Camera, run: () => runCommand('create_camera', { cameraType: 'perspective' }) },
        ] as const
      ).map((a) => (
        <Button
          key={a.label}
          variant="outline"
          size="sm"
          className="h-14 flex-col gap-1 text-[10px]"
          onClick={() => void a.run()}
        >
          <a.icon size={16} className="text-muted-foreground" />
          {a.label}
        </Button>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-14 flex-col gap-1 text-[10px]"
        onClick={() => setBookOpen(true)}
      >
        <BookOpen size={16} className="text-muted-foreground" />
        Book
      </Button>
      <CreateBookDialog open={bookOpen} onOpenChange={setBookOpen} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mesh edit-mode ops                                                  */
/* ------------------------------------------------------------------ */

function OpPopover({
  label,
  fieldLabel,
  defaultValue,
  step,
  disabled,
  onRun,
}: {
  label: string;
  fieldLabel: string;
  defaultValue: number;
  step: number;
  disabled?: boolean;
  onRun: (v: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [val, setVal] = React.useState(defaultValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 justify-start text-xs"
          disabled={disabled}
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 p-2">
        <Label className="text-[10px] text-muted-foreground">{fieldLabel}</Label>
        <div className="mt-1 flex gap-1">
          <NumField
            value={val}
            step={step}
            ariaLabel={fieldLabel}
            onCommit={setVal}
            className="min-w-0 flex-1"
          />
          <Button
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              onRun(val);
              setOpen(false);
            }}
          >
            OK
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MeshSection({ obj }: { obj: ObjectInfo }) {
  const edit = useEditor((s) => s.edit);
  const active = edit.active && edit.objectId === obj.id;
  const faces = edit.faces;
  const hasFaces = faces.length > 0;

  return (
    <Section title="Mesh">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          verts {obj.mesh?.vertices ?? 0} · faces {obj.mesh?.faces ?? 0}
        </span>
        <Button
          size="sm"
          variant={active ? 'default' : 'outline'}
          className={cn(
            'ml-auto h-7 text-xs',
            active && 'bg-amber-500 text-zinc-950 hover:bg-amber-600',
          )}
          onClick={() =>
            void runCommand('set_edit_mode', { objectId: active ? null : obj.id })
          }
        >
          {active ? 'Exit Edit' : 'Edit Mode'}
        </Button>
      </div>

      {active && (
        <div className="space-y-2 rounded-md border border-border/60 p-2">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
              {faces.length}
            </Badge>
            faces selected
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-5 px-1.5 text-[10px] text-muted-foreground"
              onClick={() => void runCommand('select_faces', { objectId: obj.id, faceIndices: [] })}
            >
              <X size={10} />
              Select none
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <OpPopover
              label="Extrude"
              fieldLabel="Distance (m)"
              defaultValue={0.05}
              step={0.01}
              disabled={!hasFaces}
              onRun={(distance) =>
                void runCommand('extrude_faces', { objectId: obj.id, faceIndices: faces, distance })
              }
            />
            <OpPopover
              label="Inset"
              fieldLabel="Amount (0..1)"
              defaultValue={0.2}
              step={0.05}
              disabled={!hasFaces}
              onRun={(amount) =>
                void runCommand('inset_faces', { objectId: obj.id, faceIndices: faces, amount })
              }
            />
            <OpPopover
              label="Subdivide"
              fieldLabel="Iterations"
              defaultValue={1}
              step={1}
              onRun={(iterations) =>
                void runCommand('subdivide', {
                  objectId: obj.id,
                  iterations: Math.max(1, Math.round(iterations)),
                })
              }
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 justify-start text-xs"
              onClick={() => void runCommand('merge_vertices', { objectId: obj.id })}
            >
              <Combine size={12} />
              Merge Verts
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 justify-start text-xs"
              onClick={() => void runCommand('flip_normals', { objectId: obj.id })}
            >
              <FlipHorizontal size={12} />
              Flip Normals
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 justify-start text-xs text-destructive hover:text-destructive"
              disabled={!hasFaces}
              onClick={() =>
                void runCommand('delete_faces', { objectId: obj.id, faceIndices: faces })
              }
            >
              <Trash2 size={12} />
              Delete Faces
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Light / camera detail fetch (light & camera props are not mirrored  */
/* into ObjectInfo, so read them via inspect_object)                   */
/* ------------------------------------------------------------------ */

interface LightDetail {
  color?: string;
  intensity?: number;
  castShadow?: boolean;
}

function useObjectDetail(objectId: string | undefined, kind: 'light' | 'camera') {
  const [detail, setDetail] = React.useState<LightDetail & { fov?: number } | null>(null);

  React.useEffect(() => {
    setDetail(null);
    if (!objectId) return;
    let cancelled = false;
    void (async () => {
      const res = await runCommand('inspect_object', { objectId });
      if (cancelled || !res.ok) return;
      const r = res.result as {
        light?: LightDetail;
        camera?: { fov?: number };
      };
      setDetail(kind === 'light' ? (r.light ?? null) : (r.camera ?? null));
    })();
    return () => {
      cancelled = true;
    };
  }, [objectId, kind]);

  return detail;
}

function LightSection({ obj }: { obj: ObjectInfo }) {
  const detail = useObjectDetail(obj.id, 'light');
  const color = detail?.color ?? '#ffffff';
  const intensity = detail?.intensity ?? 1;
  const castShadow = detail?.castShadow ?? false;

  return (
    <Section title="Light">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="text-[10px]">
          {obj.lightType ?? 'light'}
        </Badge>
        <input
          type="color"
          value={color}
          aria-label="Light color"
          onChange={(e) =>
            void runCommand('update_light', { objectId: obj.id, color: e.target.value })
          }
          className="h-7 w-10 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
        />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Intensity</span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {intensity.toFixed(1)}
          </span>
        </div>
        <Slider
          value={[intensity]}
          min={0}
          max={10}
          step={0.1}
          aria-label="Light intensity"
          onValueCommit={(v) =>
            void runCommand('update_light', { objectId: obj.id, intensity: v[0] ?? 0 })
          }
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Cast shadow</span>
        <Switch
          checked={castShadow}
          onCheckedChange={(v) =>
            void runCommand('update_light', { objectId: obj.id, castShadow: v })
          }
        />
      </div>
      <Vec3Field
        label="Position (m)"
        value={obj.transform.position}
        onCommit={(p) =>
          void runCommand('update_light', { objectId: obj.id, position: [p.x, p.y, p.z] })
        }
      />
    </Section>
  );
}

function CameraSection({ obj }: { obj: ObjectInfo }) {
  const detail = useObjectDetail(obj.id, 'camera');
  const activeCameraId = useEditor((s) => s.activeCameraId);
  const fov = detail?.fov ?? 50;
  const isActive = activeCameraId === obj.id;

  return (
    <Section title="Camera">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="text-[10px]">
          {obj.cameraType ?? 'perspective'}
        </Badge>
        <Button
          size="sm"
          variant={isActive ? 'default' : 'outline'}
          className={cn('h-7 text-xs', isActive && 'bg-amber-500 text-zinc-950 hover:bg-amber-600')}
          onClick={() => void runCommand('set_active_camera', { objectId: obj.id })}
        >
          {isActive ? 'Active camera' : 'Set active'}
        </Button>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">FOV</span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {Math.round(fov)}°
          </span>
        </div>
        <Slider
          value={[fov]}
          min={10}
          max={120}
          step={1}
          aria-label="Field of view"
          onValueCommit={(v) =>
            void runCommand('update_camera', { objectId: obj.id, fov: v[0] ?? 50 })
          }
        />
      </div>
      <Vec3Field
        label="Position (m)"
        value={obj.transform.position}
        onCommit={(p) =>
          void runCommand('update_camera', { objectId: obj.id, position: [p.x, p.y, p.z] })
        }
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* PropertiesPanel                                                     */
/* ------------------------------------------------------------------ */

export function PropertiesPanel({ className }: { className?: string }) {
  const objects = useEditor((s) => s.objects);
  const selection = useEditor((s) => s.selection);
  const obj = selection.length > 0 ? objects.find((o) => o.id === selection[0]) : undefined;

  const [nameDraft, setNameDraft] = React.useState('');
  React.useEffect(() => {
    if (obj) setNameDraft(obj.name);
  }, [obj]);
  const commitName = () => {
    if (!obj) return;
    const name = nameDraft.trim();
    if (name && name !== obj.name) {
      void runCommand('rename_object', { objectId: obj.id, name });
    }
  };

  return (
    <ScrollArea className={cn('min-h-0 flex-1', className)}>
      <div className="space-y-3 p-3">
        {!obj ? (
          <div className="space-y-3 py-6">
            <p className="text-center text-xs text-muted-foreground">Nothing selected</p>
            <QuickAdd />
          </div>
        ) : (
          <>
            {/* Object */}
            <Section title="Object">
              <div className="flex items-center gap-1.5">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  aria-label="Object name"
                  className="h-7 min-w-0 flex-1 text-xs"
                />
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {obj.kind ?? obj.type}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Visible</span>
                <Switch
                  checked={obj.visible}
                  onCheckedChange={(v) =>
                    void runCommand('set_visibility', { objectId: obj.id, visible: v })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground" title="Locking is not exposed via the command API yet">
                  Locked
                </span>
                <Switch disabled checked={!!obj.locked} />
              </div>
            </Section>

            {/* Transform */}
            <Section title="Transform">
              <Vec3Field
                label="Position (m)"
                value={obj.transform.position}
                onCommit={(p) =>
                  void runCommand('set_transform', { objectId: obj.id, position: [p.x, p.y, p.z] })
                }
              />
              <Vec3Field
                label="Rotation (deg)"
                step={1}
                value={{
                  x: radToDeg(obj.transform.rotation.x),
                  y: radToDeg(obj.transform.rotation.y),
                  z: radToDeg(obj.transform.rotation.z),
                }}
                onCommit={(r) =>
                  void runCommand('set_transform', {
                    objectId: obj.id,
                    rotationDeg: [r.x, r.y, r.z],
                  })
                }
              />
              <Vec3Field
                label="Scale"
                value={obj.transform.scale}
                onCommit={(sc) =>
                  void runCommand('set_transform', { objectId: obj.id, scale: [sc.x, sc.y, sc.z] })
                }
              />
            </Section>

            {/* Mesh */}
            {obj.type === 'mesh' && <MeshSection obj={obj} />}

            {/* Material */}
            {obj.type === 'mesh' && (
              <Section title="Material">
                <MaterialEditor materialId={obj.materialIds[0]} objectId={obj.id} />
              </Section>
            )}

            {/* Light */}
            {obj.type === 'light' && <LightSection obj={obj} />}

            {/* Camera */}
            {obj.type === 'camera' && <CameraSection obj={obj} />}

            {/* Page */}
            {obj.pageMeta && (
              <Section title="Page">
                <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  index {obj.pageMeta.index} · {obj.pageMeta.width.toFixed(2)}×
                  {obj.pageMeta.height.toFixed(2)} m
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full text-xs"
                  onClick={async () => {
                    await runCommand('create_page_turn', { objectId: obj.id });
                    void runCommand('play_animation');
                  }}
                >
                  <BookOpen size={12} />
                  Turn this page
                </Button>
              </Section>
            )}

            <Separator className="opacity-50" />
            <p className="text-center text-[10px] text-muted-foreground">
              id {obj.id}
            </p>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
