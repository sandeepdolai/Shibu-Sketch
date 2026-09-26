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

  const payload = body as { command?: string; params?: Record<string, unknown>; sessionId?: string; timeoutMs?: number };
  if (!payload?.command || typeof payload.command !== 'string') {
    return NextResponse.json({ ok: false, error: 'missing "command" string', code: 'VALIDATION' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = Math.min(130_000, Math.max(2_000, payload.timeoutMs ?? 35_000)) + 5_000;
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(`${BROKER_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
