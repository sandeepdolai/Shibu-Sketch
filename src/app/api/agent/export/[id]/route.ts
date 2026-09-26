import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BROKER_URL = process.env.AGENT_BROKER_URL ?? 'http://127.0.0.1:3030';

/** GET /api/agent/export/[id] — fetch an exported scene file (glb/gltf/obj). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${BROKER_URL}/export/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ ok: false, error: text || 'export not found' }, { status: res.status });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const headers = new Headers();
    headers.set('Content-Type', res.headers.get('Content-Type') ?? 'application/octet-stream');
    const disposition = res.headers.get('Content-Disposition');
    if (disposition) headers.set('Content-Disposition', disposition);
    headers.set('Cache-Control', 'no-store');
    return new NextResponse(new Uint8Array(buf), { status: 200, headers });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `broker unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
