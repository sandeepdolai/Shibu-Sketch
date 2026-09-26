'use client';

/**
 * ACAN3D — mobile bottom sheet: quick add grid, scene outliner,
 * object properties and timeline in a draggable drawer.
 */

import * as React from 'react';
import {
  BookOpen,
  Boxes,
  CircleDot,
  FolderTree,
  Lightbulb,
  Plus,
  SlidersHorizontal,
  Timer,
  Video,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { runCommand, useEditor } from '@/lib/engine/store';
import { cn } from '@/lib/utils';

import { CreateBookDialog, CreatePaperStackDialog } from './shared';
import { Outliner } from './Outliner';
import { PropertiesPanel } from './PropertiesPanel';
import { Timeline } from './Timeline';

type Tab = 'add' | 'scene' | 'inspect' | 'anim';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'add', label: 'Add', icon: <Plus className="size-5" /> },
  { key: 'scene', label: 'Scene', icon: <FolderTree className="size-5" /> },
  { key: 'inspect', label: 'Object', icon: <SlidersHorizontal className="size-5" /> },
  { key: 'anim', label: 'Anim', icon: <Timer className="size-5" /> },
];

const QUICK_ADD: { label: string; icon: React.ReactNode; command: string; params?: Record<string, unknown> }[] = [
  { label: 'Box', icon: <Boxes className="size-5" />, command: 'create_object', params: { type: 'box' } },
  { label: 'Sphere', icon: <CircleDot className="size-5" />, command: 'create_object', params: { type: 'sphere' } },
  { label: 'Cylinder', icon: <CircleDot className="size-5" />, command: 'create_object', params: { type: 'cylinder' } },
  { label: 'Cone', icon: <CircleDot className="size-5" />, command: 'create_object', params: { type: 'cone' } },
  { label: 'Torus', icon: <CircleDot className="size-5" />, command: 'create_object', params: { type: 'torus' } },
  { label: 'Plane', icon: <CircleDot className="size-5" />, command: 'create_object', params: { type: 'plane' } },
  { label: 'Book', icon: <BookOpen className="size-5" />, command: 'create_book' },
  { label: 'Paper', icon: <Boxes className="size-5" />, command: 'create_paper_stack' },
  { label: 'Light', icon: <Lightbulb className="size-5" />, command: 'create_light', params: { lightType: 'directional' } },
  { label: 'Camera', icon: <Video className="size-5" />, command: 'create_camera', params: { cameraType: 'perspective' } },
];

export function MobilePanel() {
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>('add');
  const [bookDlg, setBookDlg] = React.useState(false);
  const [stackDlg, setStackDlg] = React.useState(false);
  const ready = useEditor((s) => s.ready);

  const handleQuick = async (item: (typeof QUICK_ADD)[number]) => {
    if (item.command === 'create_book') {
      setBookDlg(true);
      return;
    }
    if (item.command === 'create_paper_stack') {
      setStackDlg(true);
      return;
    }
    await runCommand(item.command, item.params);
  };

  return (
    <div className="lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            size="icon"
            aria-label="Open editor panels"
            className={cn(
              'fixed bottom-14 right-3 z-40 size-12 rounded-full shadow-lg',
              'bg-amber-500 text-zinc-950 hover:bg-amber-400',
            )}
          >
            <Plus className="size-6" />
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="flex h-[58dvh] flex-col gap-0 rounded-t-xl p-0">
          <SheetTitle className="sr-only">Editor panels</SheetTitle>
          <div className="grid grid-cols-4 border-b">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex min-h-11 flex-col items-center justify-center gap-0.5 text-[10px]',
                  tab === t.key
                    ? 'border-b-2 border-amber-500 text-amber-500'
                    : 'text-muted-foreground',
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'add' && (
              <div className="grid grid-cols-4 gap-2 p-3">
                {QUICK_ADD.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={!ready}
                    onClick={() => void handleQuick(item)}
                    className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border bg-card text-xs text-muted-foreground active:bg-accent"
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            {tab === 'scene' && <Outliner />}
            {tab === 'inspect' && <PropertiesPanel />}
            {tab === 'anim' && <Timeline />}
          </div>
        </SheetContent>
      </Sheet>

      <CreateBookDialog open={bookDlg} onOpenChange={setBookDlg} />
      <CreatePaperStackDialog open={stackDlg} onOpenChange={setStackDlg} />
    </div>
  );
}
