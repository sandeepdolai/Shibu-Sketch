import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BROKER_URL = process.env.AGENT_BROKER_URL ?? 'http://127.0.0.1:3030';

/**
 * POST /api/agent/command
 * Executes a structured command inside the live ACAN3D browser session
 * via the agent broker. Body: { command: string, params?: object, sessionId?, timeoutMs? }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body', code: 'VALIDATION' }, { status: 400 });
  }

  const payload = body as {
    command?: string;
    params?: Record<string, unknown>;
    args?: unknown;
    sessionId?: string;
    timeoutMs?: number;
  };
  if (!payload?.command || typeof payload.command !== 'string') {
    return NextResponse.json({ ok: false, error: 'missing "command" string', code: 'VALIDATION' }, { status: 400 });
  }

  // Guard against malformed bodies: `params` is the canonical key (see docs/AGENT_API.md).
  // Some callers historically used `args` — accept it as a lenient alias, but never let it
  // silently replace real params, and never accept an ambiguous body.
  let params = payload.params;
  let paramNote: string | undefined;
  if (params === undefined && payload.args !== undefined) {
    if (payload.args !== null && typeof payload.args === 'object' && !Array.isArray(payload.args)) {
      params = payload.args as Record<string, unknown>;
      paramNote = "body used legacy key 'args' for command parameters; rename to 'params'";
    } else {
      return NextResponse.json(
        { ok: false, error: "'args' must be an object of command parameters (or use 'params')", code: 'VALIDATION' },
        { status: 400 },
      );
    }
  } else if (params !== undefined && payload.args !== undefined) {
    return NextResponse.json(
      { ok: false, error: "ambiguous body: both 'params' and 'args' provided — send 'params' only", code: 'VALIDATION' },
      { status: 400 },
    );
  } else if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params))) {
    return NextResponse.json(
      { ok: false, error: "'params' must be an object", code: 'VALIDATION' },
      { status: 400 },
    );
  }
  const forward = { command: payload.command, params: params ?? {}, sessionId: payload.sessionId, timeoutMs: payload.timeoutMs };

  try {
    const controller = new AbortController();
    const timeout = Math.min(130_000, Math.max(2_000, payload.timeoutMs ?? 35_000)) + 5_000;
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(`${BROKER_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(forward),
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { ok: false, error: `broker returned non-JSON (${res.status})`, code: 'EXEC_ERROR' };
    }
    if (paramNote && json && typeof json === 'object' && Array.isArray((json as { warnings?: unknown[] }).warnings)) {
      (json as { warnings: unknown[] }).warnings.push(paramNote);
    } else if (paramNote) {
      json = { ...(json as object), warnings: [paramNote] };
    }
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json(
      {
        ok: false,
        error: aborted ? 'broker timeout' : `broker unreachable: is the ACAN3D page open and the broker running? (${(e as Error).message})`,
        code: aborted ? 'TIMEOUT' : 'NO_CLIENT',
      },
      { status: aborted ? 504 : 502 },
    );
  }
}
