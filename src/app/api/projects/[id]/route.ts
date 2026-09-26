import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/projects/[id] — load full project data. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const project = await db.savedProject.findUnique({ where: { id } });
    if (!project) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      project: { id: project.id, name: project.name, data: JSON.parse(project.data), updatedAt: project.updatedAt },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** PUT /api/projects/[id] — overwrite project data. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as { name?: string; data?: unknown };
    if (!body?.data) return NextResponse.json({ ok: false, error: 'missing data' }, { status: 400 });
    const project = await db.savedProject.update({
      where: { id },
      data: { data: JSON.stringify(body.data), ...(body.name ? { name: body.name } : {}) },
    });
    return NextResponse.json({ ok: true, project: { id: project.id, name: project.name, updatedAt: project.updatedAt } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** DELETE /api/projects/[id] */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await db.savedProject.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
