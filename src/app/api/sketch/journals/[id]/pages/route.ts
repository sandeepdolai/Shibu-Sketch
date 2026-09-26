import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { addPageSchema, toPageDTO, zodErrorMessage } from '@/lib/sketch/server';
import { emptyPageContent } from '@/lib/sketch/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/sketch/journals/[id]/pages — append an empty page (or insert at
 * `atIndex`, shifting later pages +1). Body optional: { atIndex?: number }.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const journal = await db.sketchJournal.findUnique({ where: { id } });
    if (!journal) return NextResponse.json({ error: 'journal not found' }, { status: 404 });

    const raw = await req.json().catch(() => ({}));
    const parsed = addPageSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 });
    }

    const maxRow = await db.sketchPage.aggregate({
      where: { journalId: id },
      _max: { index: true },
    });
    const max = maxRow._max.index ?? -1;
    const atIndex = parsed.data.atIndex;

    let page;
    if (atIndex === undefined) {
      page = await db.sketchPage.create({
        data: { journalId: id, index: max + 1, content: JSON.stringify(emptyPageContent()) },
      });
    } else {
      if (atIndex > max + 1) {
        return NextResponse.json(
          { error: `atIndex must be ≤ ${max + 1} (journal has ${max + 1} pages)` },
          { status: 400 },
        );
      }
      // Shift later pages +1, highest index first, to respect the unique (journalId, index).
      await db.$transaction(async (tx) => {
        for (let i = max; i >= atIndex; i--) {
          await tx.sketchPage.update({
            where: { journalId_index: { journalId: id, index: i } },
            data: { index: i + 1 },
          });
        }
        page = await tx.sketchPage.create({
          data: { journalId: id, index: atIndex, content: JSON.stringify(emptyPageContent()) },
        });
      });
    }
    return NextResponse.json({ page: toPageDTO(page) }, { status: 201 });
  } catch (e) {
    console.error(`POST /api/sketch/journals/${id}/pages failed:`, e);
    return NextResponse.json({ error: 'failed to add page' }, { status: 500 });
  }
}
