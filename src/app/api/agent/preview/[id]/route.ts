import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BROKER_URL = process.env.AGENT_BROKER_URL ?? 'http://127.0.0.1:3030';

/** GET /api/agent/preview/[id] — fetch a PNG produced by render_preview. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${BROKER_URL}/preview/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ ok: false, error: text || 'preview not found' }, { status: res.status });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `broker unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
