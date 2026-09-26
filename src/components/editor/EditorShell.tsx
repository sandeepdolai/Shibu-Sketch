'use client';

/**
 * ACAN3D — application shell. Owns the overall editor layout:
 * top bar, viewport, desktop side panel (tabs), timeline, status bar,
 * mobile bottom sheet and toasts.
 */

import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { MaterialsTab } from './MaterialsTab';
import { MobilePanel } from './MobilePanel';
import { Outliner } from './Outliner';
import { PropertiesPanel } from './PropertiesPanel';
import { StatusBar } from './StatusBar';
import { Timeline } from './Timeline';
import { Toasts } from './Toasts';
import { TopBar } from './TopBar';
import { ViewportCanvas } from './ViewportCanvas';

export function EditorShell() {
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
