import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { reorderSchema, zodErrorMessage } from '@/lib/sketch/server';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/sketch/journals/reorder
 * Body: { ids: string[] } — the complete ordered list of journal ids.
 * Persists the shelf drag-to-reorder result in one transaction.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = reorderSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 });
    }
    const { ids } = parsed.data;

    const existing = await db.sketchJournal.findMany({ select: { id: true } });
    const known = new Set(existing.map((j) => j.id));
    // every existing journal must appear exactly once; unknown ids rejected
    const seen = new Set<string>();
    for (const id of ids) {
      if (!known.has(id) || seen.has(id)) {
        return NextResponse.json({ error: 'ids must match existing journals' }, { status: 400 });
      }
      seen.add(id);
    }
    if (seen.size !== known.size) {
      return NextResponse.json({ error: 'ids must include every journal' }, { status: 400 });
    }

    await db.$transaction(
      ids.map((id, i) =>
        db.sketchJournal.update({ where: { id }, data: { order: i } }),
      ),
    );
    return NextResponse.json({ ok: true, count: ids.length });
  } catch (e) {
    console.error('PATCH /api/sketch/journals/reorder failed:', e);
    return NextResponse.json({ error: 'failed to reorder journals' }, { status: 500 });
  }
}
