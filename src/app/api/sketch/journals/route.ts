import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  createJournalSchema,
  isPrismaNotFound,
  toJournalDTO,
  zodErrorMessage,
} from '@/lib/sketch/server';

export const dynamic = 'force-dynamic';

/** GET /api/sketch/journals — list journals (order asc, then creation). */
export async function GET() {
  try {
    const rows = await db.sketchJournal.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { pages: true } } },
    });
    return NextResponse.json({ journals: rows.map(toJournalDTO) });
  } catch (e) {
    console.error('GET /api/sketch/journals failed:', e);
    return NextResponse.json({ error: 'failed to list journals' }, { status: 500 });
  }
}

/** POST /api/sketch/journals — create a journal (2 empty pages, or supplied pages for import). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = createJournalSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 });
    }
    const { title, paperColor } = parsed.data;
    const coverStyle = parsed.data.coverStyle
      ? JSON.stringify({ ...parsed.data.coverStyle, seed: parsed.data.coverStyle.seed ?? 1 })
      : '{}';

    const max = await db.sketchJournal.aggregate({ _max: { order: true } });
    const journal = await db.sketchJournal.create({
      data: {
        title,
        coverStyle,
        paperColor: paperColor ?? '#faf8f4',
        order: (max._max.order ?? -1) + 1,
        pages: {
          create: (parsed.data.pages ?? [ {}, {} ]).map((p, i) => ({
            index: i,
            content: JSON.stringify(p.content ?? {}),
          })),
        },
      },
      include: { _count: { select: { pages: true } } },
    });
    return NextResponse.json({ journal: toJournalDTO(journal) }, { status: 201 });
  } catch (e) {
    if (isPrismaNotFound(e)) {
      return NextResponse.json({ error: 'journal not found' }, { status: 404 });
    }
    console.error('POST /api/sketch/journals failed:', e);
    return NextResponse.json({ error: 'failed to create journal' }, { status: 500 });
  }
}
