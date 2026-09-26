/**
 * ACAN3D — Agent Broker (mini-service, port 3030).
 *
 * Bridges the external AI agent (HTTP) and the live ACAN3D browser session
 * (socket.io). The agent POSTs structured commands; the broker forwards
 * them to the registered studio session and awaits the result.
 *
 * Endpoints:
 *   GET  /health                  -> { ok: true }
 *   GET  /status                  -> sessions + buffers summary
 *   POST /command                 -> { sessionId?, command, params?, timeoutMs? }
 *   GET  /preview/:previewId      -> PNG (latest previews are kept in memory)
 *   GET  /export/:exportId        -> exported file (glb/gltf/obj)
 *
 * Socket events:
 *   studio:register {sessionId, info}   (browser -> broker)
 *   agent:command    {commandId, command, params}   (broker -> browser)
 *   studio:result    {commandId, ok, result|error, code, durationMs}
 *   studio:preview   {previewId, dataUrl}
 *   studio:export    {exportId, name, mime, base64}
 */

import { createServer } from 'node:http';
import { Server } from 'socket.io';

const PORT = 3030;
const MAX_BUFFER = 64 * 1024 * 1024; // 64MB (exports/previews)
const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;

interface StudioSession {
  socketId: string;
  sessionId: string;
  info: Record<string, unknown>;
  connectedAt: number;
  lastSeen: number;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
}

interface StoredBlob {
  name: string;
  mime: string;
  body: Buffer;
  createdAt: number;
}

const sessions = new Map<string, StudioSession>(); // socketId -> session
const pending = new Map<string, PendingCommand>();
const previews = new Map<string, StoredBlob>();
const exportsMap = new Map<string, StoredBlob>();

function pruneBlobs(map: Map<string, StoredBlob>, max = 24): void {
  while (map.size > max) {
    const oldest = Array.from(map.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (!oldest) break;
    map.delete(oldest[0]);
  }
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const send = (code: number, body: string | Buffer, mime = 'application/json', extra: Record<string, string> = {}) => {
    res.writeHead(code, {
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extra,
    });
    res.end(body);
  };

  if (req.method === 'OPTIONS') {
    send(204, '');
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    send(200, JSON.stringify({ ok: true, service: 'acan3d-agent-broker', uptime: process.uptime() }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    send(200, JSON.stringify({
      ok: true,
      sessions: Array.from(sessions.values()).map((s) => ({
        sessionId: s.sessionId,
        info: s.info,
        connectedAt: s.connectedAt,
        lastSeen: s.lastSeen,
      })),
      pendingCommands: pending.size,
      previews: previews.size,
      exports: exportsMap.size,
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/command') {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BUFFER) {
        send(413, JSON.stringify({ ok: false, error: 'payload too large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      let body: { sessionId?: string; command?: string; params?: Record<string, unknown>; args?: unknown; timeoutMs?: number };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        send(400, JSON.stringify({ ok: false, error: 'invalid JSON body' }));
        return;
      }
      const { command, sessionId, timeoutMs } = body;
      if (!command || typeof command !== 'string') {
        send(400, JSON.stringify({ ok: false, error: 'missing "command" string' }));
        return;
      }
      // Guard against malformed bodies: `params` is canonical; legacy `args` is an alias.
      let params = body.params;
      if (params === undefined && body.args !== undefined) {
        if (body.args !== null && typeof body.args === 'object' && !Array.isArray(body.args)) {
          params = body.args as Record<string, unknown>;
        } else {
          send(400, JSON.stringify({ ok: false, error: "'args' must be an object of command parameters (or use 'params')" }));
          return;
        }
      } else if (params !== undefined && body.args !== undefined) {
        send(400, JSON.stringify({ ok: false, error: "ambiguous body: both 'params' and 'args' provided — send 'params' only" }));
        return;
      } else if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params))) {
        send(400, JSON.stringify({ ok: false, error: "'params' must be an object" }));
        return;
      }

      // pick target session
      const all = Array.from(sessions.values());
      const target = sessionId ? all.find((s) => s.sessionId === sessionId) : all.sort((a, b) => b.lastSeen - a.lastSeen)[0];
      if (!target) {
        send(503, JSON.stringify({ ok: false, error: 'no ACAN3D browser session connected (NO_CLIENT)', code: 'NO_CLIENT' }));
        return;
      }

      const commandId = `cmd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const timeout = Math.min(MAX_TIMEOUT, Math.max(1000, timeoutMs ?? DEFAULT_TIMEOUT));
      const startedAt = Date.now();

      const timer = setTimeout(() => {
        const p = pending.get(commandId);
        if (p) {
          pending.delete(commandId);
          send(504, JSON.stringify({
            ok: false,
            error: `command timed out after ${timeout}ms: ${command}`,
            code: 'TIMEOUT',
            meta: { sessionId: target.sessionId, commandId },
          }));
        }
      }, timeout);

      pending.set(commandId, {
        resolve: (value) => {
          clearTimeout(timer);
          pending.delete(commandId);
          send(200, JSON.stringify({
            ...(value as Record<string, unknown>),
            meta: { sessionId: target.sessionId, commandId, durationMs: Math.round(Date.now() - startedAt) },
          }));
        },
        timer,
        startedAt,
      });

      ioInstance.to(target.socketId).emit('agent:command', { commandId, command, params: params ?? {} });
    });
    return;
  }

  const previewMatch = url.pathname.match(/^\/preview\/([\w-]+)$/);
  if (req.method === 'GET' && previewMatch) {
    const blob = previews.get(previewMatch[1]);
    if (!blob) {
      send(404, JSON.stringify({ ok: false, error: 'preview not found (expired or never uploaded)' }));
      return;
    }
    send(200, blob.body, blob.mime, { 'Cache-Control': 'no-store' });
    return;
  }

  const exportMatch = url.pathname.match(/^\/export\/([\w-]+)$/);
  if (req.method === 'GET' && exportMatch) {
    const blob = exportsMap.get(exportMatch[1]);
    if (!blob) {
      send(404, JSON.stringify({ ok: false, error: 'export not found (expired or never uploaded)' }));
      return;
    }
    send(200, blob.body, blob.mime, {
      'Content-Disposition': `attachment; filename="${blob.name}"`,
      'Cache-Control': 'no-store',
    });
    return;
  }

  send(404, JSON.stringify({ ok: false, error: `no route: ${req.method} ${url.pathname}` }));
});

const ioInstance = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: MAX_BUFFER,
});

ioInstance.on('connection', (socket) => {
  socket.on('studio:register', (msg: { sessionId?: string; info?: Record<string, unknown> }, ack?: (r: unknown) => void) => {
    const sessionId = msg?.sessionId ?? 's_anon';
    sessions.set(socket.id, {
      socketId: socket.id,
      sessionId,
      info: msg?.info ?? {},
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    });
    // stash socket for emit
    (sessions.get(socket.id) as unknown as { socketInstance?: { emit: (e: string, p: unknown) => void } }).socketInstance = socket;
    ack?.({ ok: true, sessionId });
  });

  socket.on('studio:heartbeat', () => {
    const s = sessions.get(socket.id);
    if (s) s.lastSeen = Date.now();
  });

  socket.on('studio:result', (msg: { commandId?: string; ok?: boolean; result?: unknown; error?: string; code?: string; durationMs?: number }) => {
    const pendingCmd = msg?.commandId ? pending.get(msg.commandId) : undefined;
    if (!pendingCmd) return;
    pendingCmd.resolve({
      ok: !!msg.ok,
      ...(msg.ok ? { result: msg.result } : { error: msg.error ?? 'unknown error', code: msg.code ?? 'EXEC_ERROR' }),
    });
  });

  socket.on('studio:preview', (msg: { previewId?: string; dataUrl?: string }) => {
    if (!msg?.previewId || !msg?.dataUrl) return;
    const base64 = msg.dataUrl.split(',')[1] ?? '';
    const mime = msg.dataUrl.slice(5, msg.dataUrl.indexOf(';')) || 'image/png';
    previews.set(msg.previewId, { name: `${msg.previewId}.png`, mime, body: Buffer.from(base64, 'base64'), createdAt: Date.now() });
    pruneBlobs(previews);
  });

  socket.on('studio:export', (msg: { exportId?: string; name?: string; mime?: string; base64?: string }) => {
    if (!msg?.exportId || !msg?.base64) return;
    exportsMap.set(msg.exportId, {
      name: msg.name ?? `${msg.exportId}.bin`,
      mime: msg.mime ?? 'application/octet-stream',
      body: Buffer.from(msg.base64, 'base64'),
      createdAt: Date.now(),
    });
    pruneBlobs(exportsMap);
  });

  socket.on('disconnect', () => {
    sessions.delete(socket.id);
  });
});

// heartbeat sweep
setInterval(() => {
  for (const [socketId, s] of sessions) {
    ioInstance.to(socketId).emit('agent:heartbeat');
  }
}, 10_000);

httpServer.listen(PORT, () => {
  console.log(`[acan3d-agent-broker] listening on http://localhost:${PORT}`);
});
