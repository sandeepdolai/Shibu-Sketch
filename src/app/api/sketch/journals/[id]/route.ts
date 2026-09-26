import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  isPrismaNotFound,
  toJournalDTO,
  toPageDTO,
  updateJournalSchema,
  zodErrorMessage,
} from '@/lib/sketch/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/sketch/journals/[id] — journal detail with parsed pages. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const journal = await db.sketchJournal.findUnique({
      where: { id },
      include: { pages: { orderBy: { index: 'asc' } }, _count: { select: { pages: true } } },
    });
    if (!journal) return NextResponse.json({ error: 'journal not found' }, { status: 404 });
    return NextResponse.json({
      journal: {
        ...toJournalDTO(journal),
        pages: journal.pages.map(toPageDTO),
      },
    });
  } catch (e) {
    console.error(`GET /api/sketch/journals/${id} failed:`, e);
    return NextResponse.json({ error: 'failed to load journal' }, { status: 500 });
  }
}

/** PATCH /api/sketch/journals/[id] — update title/cover/paper color/order. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => null);
    const parsed = updateJournalSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 });
    }
    const existing = await db.sketchJournal.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'journal not found' }, { status: 404 });

    const data: { title?: string; coverStyle?: string; paperColor?: string; order?: number } = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.paperColor !== undefined) data.paperColor = parsed.data.paperColor;
    if (parsed.data.order !== undefined) data.order = parsed.data.order;
    if (parsed.data.coverStyle !== undefined) {
      data.coverStyle = JSON.stringify({
        ...parsed.data.coverStyle,
        seed: parsed.data.coverStyle.seed ?? 1,
      });
    }

    const journal = await db.sketchJournal.update({
      where: { id },
      data,
      include: { _count: { select: { pages: true } } },
    });
    return NextResponse.json({ journal: toJournalDTO(journal) });
  } catch (e) {
    if (isPrismaNotFound(e)) {
      return NextResponse.json({ error: 'journal not found' }, { status: 404 });
    }
    console.error(`PATCH /api/sketch/journals/${id} failed:`, e);
    return NextResponse.json({ error: 'failed to update journal' }, { status: 500 });
  }
}

/** DELETE /api/sketch/journals/[id] — remove journal (pages cascade). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const existing = await db.sketchJournal.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'journal not found' }, { status: 404 });
    await db.sketchJournal.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isPrismaNotFound(e)) {
      return NextResponse.json({ error: 'journal not found' }, { status: 404 });
    }
    console.error(`DELETE /api/sketch/journals/${id} failed:`, e);
    return NextResponse.json({ error: 'failed to delete journal' }, { status: 500 });
  }
}
