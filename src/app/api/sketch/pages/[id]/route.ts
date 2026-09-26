import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isPrismaNotFound, savePageSchema, toPageDTO, zodErrorMessage } from '@/lib/sketch/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/sketch/pages/[id] — save a page's full vector-ops content. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('content' in body)) {
      return NextResponse.json({ error: 'missing page content' }, { status: 400 });
    }
    const parsed = savePageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 });
    }
    const page = await db.sketchPage.update({
      where: { id },
      data: { content: JSON.stringify(parsed.data.content) },
    });
    return NextResponse.json({ page: toPageDTO(page) });
  } catch (e) {
    if (isPrismaNotFound(e)) {
      return NextResponse.json({ error: 'page not found' }, { status: 404 });
    }
    console.error(`PUT /api/sketch/pages/${id} failed:`, e);
    return NextResponse.json({ error: 'failed to save page' }, { status: 500 });
  }
}
