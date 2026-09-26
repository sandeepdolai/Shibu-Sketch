'use client';

/**
 * ACAN3D — application shell. Owns the overall editor layout:
 * top bar, viewport, desktop side panel (tabs), timeline, status bar,
 * mobile bottom sheet and toasts. Also binds desktop keyboard shortcuts.
 */

import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { runCommand, useEditor } from '@/lib/engine/store';

import { MaterialsTab } from './MaterialsTab';
import { MobilePanel } from './MobilePanel';
import { Outliner } from './Outliner';
import { PropertiesPanel } from './PropertiesPanel';
import { StatusBar } from './StatusBar';
import { Timeline } from './Timeline';
import { Toasts } from './Toasts';
import { TopBar } from './TopBar';
import { ViewportCanvas } from './ViewportCanvas';

const GIZMO_KEYS: Record<string, 'translate' | 'rotate' | 'scale'> = {
  g: 'translate',
  r: 'rotate',
  s: 'scale',
};

function useKeyboardShortcuts() {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // undo / redo
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        void runCommand('undo');
        return;
      }
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        void runCommand('redo');
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        const sel = useEditor.getState().selection;
        if (sel[0]) void runCommand('duplicate_object', { objectId: sel[0] });
        return;
      }
      if (mod) return;

      // gizmo modes
      if (GIZMO_KEYS[key]) {
        void runCommand('set_gizmo', { mode: GIZMO_KEYS[key] });
        return;
      }
      switch (key) {
        case 'f': {
          const sel = useEditor.getState().selection;
          void runCommand('frame_object', sel[0] ? { objectId: sel[0] } : {});
          break;
        }
        case 'x':
        case 'delete': {
          const sel = useEditor.getState().selection;
          if (sel.length > 0) void runCommand('delete_object', { objectIds: sel });
          break;
        }
        case 'escape': {
          const edit = useEditor.getState().edit;
          if (edit.active) void runCommand('set_edit_mode', { objectId: null });
          else void runCommand('select_object', {});
          break;
        }
        case ' ': {
          e.preventDefault();
          const anim = useEditor.getState().anim;
          void runCommand(anim.playing ? 'pause_animation' : 'play_animation');
          break;
        }
        case 'arrowright': {
          const anim = useEditor.getState().anim;
          void runCommand('set_frame', { frame: Math.min(anim.end, Math.round(anim.current) + 1) });
          break;
        }
        case 'arrowleft': {
          const anim = useEditor.getState().anim;
          void runCommand('set_frame', { frame: Math.max(anim.start, Math.round(anim.current) - 1) });
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function EditorShell() {
  useKeyboardShortcuts();

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">
      <TopBar />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Viewport — always visible, ≥45vh on mobile via flex layout */}
        <div className="relative min-h-[45vh] flex-1 lg:min-h-0">
          <ViewportCanvas />
        </div>

        {/* Desktop side panel */}
        <aside className="hidden w-[340px] shrink-0 flex-col border-l bg-background lg:flex">
          <Tabs defaultValue="scene" className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="border-b px-2 pt-2">
              <TabsList className="grid h-8 w-full grid-cols-3">
                <TabsTrigger value="scene" className="text-xs">Scene</TabsTrigger>
                <TabsTrigger value="props" className="text-xs">Object</TabsTrigger>
                <TabsTrigger value="materials" className="text-xs">Shading</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="scene" className="mt-0 min-h-0 flex-1 overflow-hidden">
              <Outliner />
            </TabsContent>
            <TabsContent value="props" className="mt-0 min-h-0 flex-1 overflow-y-auto">
              <PropertiesPanel />
            </TabsContent>
            <TabsContent value="materials" className="mt-0 min-h-0 flex-1 overflow-y-auto">
              <MaterialsTab />
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      {/* Desktop inline timeline */}
      <div className="hidden lg:block">
        <Timeline />
      </div>

      <StatusBar />
      <MobilePanel />
      <Toasts />
    </div>
  );
}
