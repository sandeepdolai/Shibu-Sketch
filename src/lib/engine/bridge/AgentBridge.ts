'use client';

/**
 * ACAN3D — browser agent bridge.
 * Connects the live editor session to the agent broker (mini-service on
 * port 3030 via the gateway). Executes incoming agent commands through the
 * same CommandRouter the UI uses, and uploads previews/exports for the
 * agent to fetch over HTTP.
 */

import { io, type Socket } from 'socket.io-client';
import { Engine, type EngineBridge } from '../Engine';
import { useEditor } from '../store';
import { APP_VERSION } from '../types';

const SESSION_KEY = 'acan3d.sessionId';

function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 's_anon';
  }
}

const READ_ONLY_COMMANDS = new Set([
  'list_commands', 'help', 'get_stats', 'inspect_scene', 'inspect_object',
  'inspect_animation', 'list_material_presets', 'list_projects', 'get_mesh',
]);

export class AgentBridge implements EngineBridge {
  private socket: Socket | null = null;
  private engine: Engine;
  sessionId = getSessionId();

  constructor(engine: Engine) {
    this.engine = engine;
  }

  connect(): void {
    if (this.socket) return;
    useEditor.getState().setAgent('connecting');
    // Gateway pattern: relative URL + XTransformPort query (see examples/websocket)
    const socket = io('/?XTransformPort=3030', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1500,
      timeout: 8000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      useEditor.getState().setAgent('online');
      socket.emit('studio:register', {
        sessionId: this.sessionId,
        info: {
          app: 'ACAN3D',
          version: APP_VERSION,
          viewport: {
            w: this.engine.container?.clientWidth ?? 0,
            h: this.engine.container?.clientHeight ?? 0,
          },
          ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        },
      });
    });

    socket.on('disconnect', () => {
      useEditor.getState().setAgent('offline');
    });

    socket.on('connect_error', () => {
      useEditor.getState().setAgent('offline');
    });

    socket.on('agent:command', (msg: { commandId: string; command: string; params?: Record<string, unknown> }) => {
      void this.handleCommand(msg);
    });

    // keep lastSeen fresh on the broker so "most recent session" routing is accurate
    socket.on('agent:heartbeat', () => {
      socket.emit('studio:heartbeat', { sessionId: this.sessionId });
    });
  }

  private async handleCommand(msg: { commandId: string; command: string; params?: Record<string, unknown> }): Promise<void> {
    let response: { ok: boolean; result?: unknown; error?: string; code?: string };
    const started = performance.now();

    // surface agent activity in the UI (skip read-only chatter)
    if (!READ_ONLY_COMMANDS.has(msg.command)) {
      const st = useEditor.getState();
      const text = `Agent: ${msg.command}`;
      if (st.toasts[st.toasts.length - 1]?.text !== text) {
        st.pushToast(true, text);
      }
    }

    try {
      // lazy import to avoid a router<->engine circular import at module load
      const { executeCommand } = await import('../commands/router');
      const res = await executeCommand(this.engine, msg.command, msg.params ?? {});
      response = res;
    } catch (e) {
      response = { ok: false, error: e instanceof Error ? e.message : String(e), code: 'EXEC_ERROR' };
    }
    if (!response.ok) {
      useEditor.getState().pushToast(false, `Agent ${msg.command} failed: ${response.error ?? 'unknown'}`);
    }
    const payload = {
      commandId: msg.commandId,
      ok: response.ok,
      result: response.ok ? response.result : undefined,
      error: response.ok ? undefined : response.error,
      code: response.ok ? undefined : response.code,
      durationMs: Math.round(performance.now() - started),
    };
    try {
      this.socket?.emit('studio:result', payload);
    } catch {
      /* connection lost mid-command */
    }
  }

  uploadPreview(previewId: string, dataUrl: string): void {
    try {
      this.socket?.emit('studio:preview', { previewId, dataUrl });
    } catch {
      /* ignore */
    }
  }

  uploadExport(exportId: string, name: string, mime: string, base64: string): void {
    try {
      this.socket?.emit('studio:export', { exportId, name, mime, base64 });
    } catch {
      /* ignore */
    }
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    useEditor.getState().setAgent('offline');
  }
}
