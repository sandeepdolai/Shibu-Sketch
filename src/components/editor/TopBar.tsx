'use client';

/**
 * ACAN3D — top bar: project menu, add menu, transform tools, snap,
 * shading, theme, agent link status. Every action routes through
 * runCommand() using the exact command set from docs/AGENT_API.md.
 */

import * as React from 'react';
import { useTheme } from 'next-themes';
import {
  BookOpen,
  Box,
  ChevronDown,
  Circle,
  Cone,
  Cylinder,
  Download,
  EllipsisVertical,
  FilePlus2,
  Files,
  Flashlight,
  FolderOpen,
  Globe,
  Group,
  Lightbulb,
  Magnet,
  Moon,
  Move,
  Pill,
  Plus,
  RectangleHorizontal,
  Redo2,
  RotateCw,
  Save,
  Scaling,
  Square,
  Sun,
  Torus,
  Undo2,
  Upload,
  Video,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import {
  runCommand,
  useEditor,
  type GizmoMode,
} from '@/lib/engine/store';
import type { ShadingMode } from '@/lib/engine/types';

import {
  CreateBookDialog,
  CreatePaperStackDialog,
  NumField,
} from './shared';

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const MESHES: Array<{ type: string; label: string; icon: React.ElementType }> = [
  { type: 'box', label: 'Box', icon: Box },
  { type: 'roundedBox', label: 'Rounded box', icon: Square },
  { type: 'sphere', label: 'Sphere', icon: Circle },
  { type: 'cylinder', label: 'Cylinder', icon: Cylinder },
  { type: 'cone', label: 'Cone', icon: Cone },
  { type: 'torus', label: 'Torus', icon: Torus },
  { type: 'plane', label: 'Plane', icon: RectangleHorizontal },
  { type: 'capsule', label: 'Capsule', icon: Pill },
];

const LIGHTS: Array<{ type: string; label: string; icon: React.ElementType }> = [
  { type: 'ambient', label: 'Ambient', icon: Sun },
  { type: 'hemisphere', label: 'Hemisphere', icon: Globe },
  { type: 'directional', label: 'Directional', icon: Zap },
  { type: 'point', label: 'Point', icon: Lightbulb },
  { type: 'spot', label: 'Spot', icon: Flashlight },
];

interface ProjectRow {
  id: string;
  name: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-9 text-muted-foreground hover:text-foreground"
      aria-label="Toggle theme"
      title="Toggle theme"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {mounted && dark ? <Moon size={14} /> : <Sun size={14} />}
    </Button>
  );
}

function AgentDot() {
  const agent = useEditor((s) => s.agent);
  return (
    <span
      title="Agent link"
      className="flex size-9 items-center justify-center"
      aria-label={`Agent link: ${agent}`}
    >
      <span
        className={cn(
          'size-2 rounded-full',
          agent === 'online' && 'animate-pulse bg-emerald-500',
          agent === 'connecting' && 'animate-pulse bg-amber-500',
          agent === 'offline' && 'bg-zinc-400',
        )}
      />
    </span>
  );
}

function ShadingSelect() {
  const shading = useEditor((s) => s.shading);
  const setShading = useEditor((s) => s.setShading);
  return (
    <div className="hidden sm:block">
      <Select
        value={shading}
        onValueChange={(v) => {
          const mode = v as ShadingMode;
          setShading(mode);
          void runCommand('set_shading', { mode });
        }}
      >
        <SelectTrigger size="sm" className="h-8 w-[108px] text-xs" aria-label="Shading mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="solid" className="text-xs">
            Solid
          </SelectItem>
          <SelectItem value="material" className="text-xs">
            Material
          </SelectItem>
          <SelectItem value="wireframe" className="text-xs">
            Wireframe
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function TransformTools() {
  const gizmoMode = useEditor((s) => s.gizmoMode);
  const setGizmoMode = useEditor((s) => s.setGizmoMode);
  const snap = useEditor((s) => s.snap);
  const setSnap = useEditor((s) => s.setSnap);
  const snapTranslate = useEditor((s) => s.snapTranslate);
  const snapRotateDeg = useEditor((s) => s.snapRotateDeg);
  const setSnapTranslate = useEditor((s) => s.setSnapTranslate);
  const setSnapRotate = useEditor((s) => s.setSnapRotate);

  const setGizmo = (m: GizmoMode) => {
    setGizmoMode(m);
    void runCommand('set_gizmo', { mode: m });
  };

  return (
    <div className="mx-1 hidden items-center gap-1 md:flex">
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={gizmoMode}
        onValueChange={(v) => {
          if (!v) return;
          setGizmo(v as GizmoMode);
        }}
      >
        <ToggleGroupItem value="translate" aria-label="Move tool" className="h-8 px-2.5">
          <Move size={14} />
        </ToggleGroupItem>
        <ToggleGroupItem value="rotate" aria-label="Rotate tool" className="h-8 px-2.5">
          <RotateCw size={14} />
        </ToggleGroupItem>
        <ToggleGroupItem value="scale" aria-label="Scale tool" className="h-8 px-2.5">
          <Scaling size={14} />
        </ToggleGroupItem>
      </ToggleGroup>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            title="Snapping"
            aria-label="Snapping"
            className={cn(
              'size-9 text-muted-foreground hover:text-foreground',
              snap && 'bg-amber-500/15 text-amber-600 hover:text-amber-600 dark:text-amber-500',
            )}
          >
            <Magnet size={14} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-60 space-y-3 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Snap</span>
            <Switch
              checked={snap}
              onCheckedChange={(v) => {
                setSnap(v);
                void runCommand('set_snap', { enabled: v });
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Translate (m)</Label>
              <NumField
                step={0.05}
                min={0.001}
                value={snapTranslate}
                onCommit={(v) => {
                  setSnapTranslate(v);
                  void runCommand('set_snap', { translate: v });
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Rotate (deg)</Label>
              <NumField
                step={1}
                min={0.1}
                value={snapRotateDeg}
                onCommit={(v) => {
                  setSnapRotate(v);
                  void runCommand('set_snap', { rotateDeg: v });
                }}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FileMenu({ onOpenSave }: { onOpenSave: () => void }) {
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const [projects, setProjects] = React.useState<ProjectRow[] | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  async function fetchProjects() {
    const res = await runCommand('list_projects');
    if (res.ok) {
      const list = (res.result as { projects?: ProjectRow[] } | undefined)?.projects;
      setProjects(Array.isArray(list) ? list : []);
    } else {
      setProjects([]);
    }
  }

  async function doExport(format: 'gltf' | 'glb' | 'obj') {
    const res = await runCommand('export_scene', { format });
    if (res.ok) {
      const url = (res.result as { downloadUrl?: string } | undefined)?.downloadUrl;
      if (url && typeof window !== 'undefined') {
        const a = document.createElement('a');
        a.href = url;
        a.download = `scene.${format}`;
        a.click();
      }
    }
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? '');
      if (!dataUrl) return;
      await runCommand('import_gltf', { dataUrl, name: file.name });
    };
    reader.readAsDataURL(file);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-1 px-2 text-xs">
          <FolderOpen size={14} />
          File
          <ChevronDown size={12} className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={() => void runCommand('new_project')}>
          <FilePlus2 size={14} />
          New project
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onOpenSave();
          }}
        >
          <Save size={14} />
          Save project…
        </DropdownMenuItem>
        <DropdownMenuSub
          onOpenChange={(open) => {
            if (open && projects === null) void fetchProjects();
          }}
        >
          <DropdownMenuSubTrigger>
            <FolderOpen size={14} className="mr-2" />
            Load project
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-64 w-56 overflow-y-auto">
            {projects === null ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">Loading…</div>
            ) : projects.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">No saved projects</div>
            ) : (
              projects.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onSelect={() => void runCommand('load_project', { projectId: p.id })}
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void doExport('gltf')}>
          <Download size={14} />
          Export GLTF
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void doExport('glb')}>
          <Download size={14} />
          Export GLB
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void doExport('obj')}>
          <Download size={14} />
          Export OBJ
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
          <Upload size={14} />
          Import GLTF…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canUndo} onSelect={() => void runCommand('undo')}>
          <Undo2 size={14} />
          Undo
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canRedo} onSelect={() => void runCommand('redo')}>
          <Redo2 size={14} />
          Redo
        </DropdownMenuItem>
      </DropdownMenuContent>
      <input
        ref={fileInputRef}
        type="file"
        accept=".gltf,.glb,model/gltf-binary,model/gltf+json"
        className="hidden"
        onChange={onImportFile}
      />
    </DropdownMenu>
  );
}

function AddMenu({
  onOpenBook,
  onOpenPaper,
}: {
  onOpenBook: () => void;
  onOpenPaper: () => void;
}) {
  const selection = useEditor((s) => s.selection);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-1 px-2 text-xs">
          <Plus size={14} />
          Add
          <ChevronDown size={12} className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-52 overflow-y-auto">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Mesh
        </DropdownMenuLabel>
        {MESHES.map((m) => (
          <DropdownMenuItem
            key={m.type}
            onSelect={() => void runCommand('create_object', { type: m.type })}
          >
            <m.icon size={14} />
            {m.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onOpenBook();
          }}
        >
          <BookOpen size={14} />
          Book…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onOpenPaper();
          }}
        >
          <Files size={14} />
          Paper stack…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Lightbulb size={14} className="mr-2" />
            Light
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            {LIGHTS.map((l) => (
              <DropdownMenuItem
                key={l.type}
                onSelect={() => void runCommand('create_light', { lightType: l.type })}
              >
                <l.icon size={14} />
                {l.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onSelect={() => void runCommand('create_camera', { cameraType: 'perspective' })}
        >
          <Video size={14} />
          Camera
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={selection.length === 0}
          onSelect={() => void runCommand('create_group', { objectIds: selection })}
        >
          <Group size={14} />
          Group selection
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MoreMenu() {
  const gizmoMode = useEditor((s) => s.gizmoMode);
  const setGizmoMode = useEditor((s) => s.setGizmoMode);
  const shading = useEditor((s) => s.shading);
  const setShading = useEditor((s) => s.setShading);

  const setGizmo = (m: GizmoMode) => {
    setGizmoMode(m);
    void runCommand('set_gizmo', { mode: m });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 md:hidden"
          aria-label="More tools"
          title="More tools"
        >
          <EllipsisVertical size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Transform tool
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setGizmo('translate')}>
          <Move size={14} />
          Move
          {gizmoMode === 'translate' && <span className="ml-auto size-1.5 rounded-full bg-amber-500" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setGizmo('rotate')}>
          <RotateCw size={14} />
          Rotate
          {gizmoMode === 'rotate' && <span className="ml-auto size-1.5 rounded-full bg-amber-500" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setGizmo('scale')}>
          <Scaling size={14} />
          Scale
          {gizmoMode === 'scale' && <span className="ml-auto size-1.5 rounded-full bg-amber-500" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Shading
        </DropdownMenuLabel>
        {(['solid', 'material', 'wireframe'] as const).map((m) => (
          <DropdownMenuItem
            key={m}
            onSelect={() => {
              setShading(m);
              void runCommand('set_shading', { mode: m });
            }}
          >
            <span className="capitalize">{m}</span>
            {shading === m && <span className="ml-auto size-1.5 rounded-full bg-amber-500" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ */
/* TopBar                                                              */
/* ------------------------------------------------------------------ */

export function TopBar() {
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [bookOpen, setBookOpen] = React.useState(false);
  const [paperOpen, setPaperOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState('');

  async function save() {
    await runCommand('save_project', { name: saveName.trim() || undefined });
    setSaveOpen(false);
  }

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-0.5 border-b bg-background/95 px-2 backdrop-blur">
      {/* Logo */}
      <div className="mr-1 flex items-center gap-1.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500 text-zinc-950">
          <Box size={16} strokeWidth={2.25} />
        </div>
        <span className="hidden text-sm font-bold tracking-tight min-[420px]:inline">ACAN3D</span>
      </div>

      <Separator orientation="vertical" className="mr-1 hidden h-6 min-[420px]:block" />

      <FileMenu onOpenSave={() => setSaveOpen(true)} />
      <AddMenu onOpenBook={() => setBookOpen(true)} onOpenPaper={() => setPaperOpen(true)} />

      {/* Center tools */}
      <div className="mx-auto" />
      <TransformTools />
      <div className="mx-auto md:hidden" />

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-0.5 md:ml-0">
        <ShadingSelect />
        <ThemeToggle />
        <AgentDot />
        <MoreMenu />
      </div>

      {/* Save project dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm gap-3">
          <DialogHeader>
            <DialogTitle className="text-sm">Save project</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="acan-project-name" className="text-[10px] text-muted-foreground">
              Name
            </Label>
            <Input
              id="acan-project-name"
              value={saveName}
              placeholder="Untitled"
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
              className="h-8 text-xs"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button size="sm" className="min-h-9" onClick={() => void save()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateBookDialog open={bookOpen} onOpenChange={setBookOpen} />
      <CreatePaperStackDialog open={paperOpen} onOpenChange={setPaperOpen} />
    </header>
  );
}
