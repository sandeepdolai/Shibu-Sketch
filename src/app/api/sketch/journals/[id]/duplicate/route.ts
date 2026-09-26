import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isPrismaNotFound, toJournalDTO } from '@/lib/sketch/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sketch/journals/[id]/duplicate — deep-copy a journal.
 *
 * Copies title (+" copy"), coverStyle, paperColor; appends at the end of the
 * shelf (order = max + 1) and copies every page (content + index) inside one
 * transaction. Returns 201 { journal: JournalDTO }.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const source = await db.sketchJournal.findUnique({
      where: { id },
      include: { pages: { orderBy: { index: 'asc' } } },
    });
    if (!source) {
      return NextResponse.json({ error: 'journal not found' }, { status: 404 });
    }

    const max = await db.sketchJournal.aggregate({ _max: { order: true } });
    const copy = await db.$transaction(async (tx) => {
      return tx.sketchJournal.create({
        data: {
          title: `${source.title} copy`.slice(0, 60),
          coverStyle: source.coverStyle,
          paperColor: source.paperColor,
          order: (max._max.order ?? -1) + 1,
          pages: {
            create: source.pages.map((p) => ({
              index: p.index,
              content: p.content,
            })),
          },
        },
        include: { _count: { select: { pages: true } } },
      });
    });

    return NextResponse.json({ journal: toJournalDTO(copy) }, { status: 201 });
  } catch (e) {
    if (isPrismaNotFound(e)) {
      return NextResponse.json({ error: 'journal not found' }, { status: 404 });
    }
    console.error('POST /api/sketch/journals/[id]/duplicate failed:', e);
    return NextResponse.json({ error: 'failed to duplicate journal' }, { status: 500 });
  }
}
