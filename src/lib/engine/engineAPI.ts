'use client';

/**
 * ACAN3D — engine facade.
 * Single engine instance per page; React mounts it into the viewport div.
 */

import { Engine } from './Engine';
import { AgentBridge } from './bridge/AgentBridge';
import type { CommandResult } from './types';

let instance: Engine | null = null;

async function mount(container: HTMLElement): Promise<void> {
  if (instance) return;
  const engine = new Engine();
  instance = engine;
  try {
    const bridge = new AgentBridge(engine);
    bridge.connect();
    engine.bridge = bridge;
  } catch {
    engine.bridge = null;
  }
  await engine.mount(container);
}

function dispose(): void {
  try {
    (instance?.bridge as AgentBridge | undefined)?.disconnect();
    instance?.dispose();
  } catch {
    /* ignore */
  }
  instance = null;
}

function isMounted(): boolean {
  return instance !== null;
}

async function execute(command: string, params?: Record<string, unknown>): Promise<CommandResult> {
  if (!instance) return { ok: false, error: 'engine not mounted', code: 'EXEC_ERROR' };
  const { executeCommand } = await import('./commands/router');
  try {
    return await executeCommand(instance, command, params ?? {});
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), code: 'EXEC_ERROR' };
  }
}

export const engineAPI = {
  mount,
  dispose,
  isMounted,
  execute,
  get engine(): Engine | null {
    return instance;
  },
};

export type { CommandResult };
