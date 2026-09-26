import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; pageId: string }> };

const MIN_PAGES = 2;

/**
 * DELETE /api/sketch/journals/[id]/pages/[pageId] — remove a page and shift
 * later pages -1. Refuses if the journal would drop below 2 pages.
 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id, pageId } = await params;
  try {
    const journal = await db.sketchJournal.findUnique({ where: { id } });
    if (!journal) return NextResponse.json({ error: 'journal not found' }, { status: 404 });

    const page = await db.sketchPage.findFirst({ where: { id: pageId, journalId: id } });
    if (!page) return NextResponse.json({ error: 'page not found' }, { status: 404 });

    const count = await db.sketchPage.count({ where: { journalId: id } });
    if (count <= MIN_PAGES) {
      return NextResponse.json(
        { error: `a journal must keep at least ${MIN_PAGES} pages` },
        { status: 400 },
      );
    }

    await db.$transaction(async (tx) => {
      await tx.sketchPage.delete({ where: { id: page.id } });
      // Shift later pages -1, lowest index first (freed slot ahead of each move).
      const later = await tx.sketchPage.findMany({
        where: { journalId: id, index: { gt: page.index } },
        orderBy: { index: 'asc' },
      });
      for (const p of later) {
        await tx.sketchPage.update({ where: { id: p.id }, data: { index: p.index - 1 } });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(`DELETE /api/sketch/journals/${id}/pages/${pageId} failed:`, e);
    return NextResponse.json({ error: 'failed to delete page' }, { status: 500 });
  }
}
