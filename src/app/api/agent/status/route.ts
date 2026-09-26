import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BROKER_URL = process.env.AGENT_BROKER_URL ?? 'http://127.0.0.1:3030';

/** GET /api/agent/status — broker + connected studio sessions. */
export async function GET() {
  try {
    const res = await fetch(`${BROKER_URL}/status`, { cache: 'no-store' });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `broker unreachable: ${(e as Error).message}`, code: 'NO_CLIENT' },
      { status: 502 },
    );
  }
}
