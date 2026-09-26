import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/projects — list saved projects (metadata only). */
export async function GET() {
  try {
    const projects = await db.savedProject.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
      take: 100,
    });
    return NextResponse.json({ ok: true, projects });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/projects — save (or upsert by name) a project. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string; data?: unknown };
    if (!body?.data || typeof body.data !== 'object') {
      return NextResponse.json({ ok: false, error: 'missing project data' }, { status: 400 });
    }
    const name = (body.name ?? 'Untitled').slice(0, 120);
    const serialized = JSON.stringify(body.data);
    const existing = await db.savedProject.findFirst({ where: { name }, orderBy: { updatedAt: 'desc' } });
    const project = existing
      ? await db.savedProject.update({ where: { id: existing.id }, data: { data: serialized, name } })
      : await db.savedProject.create({ data: { name, data: serialized } });
    return NextResponse.json({
      ok: true,
      project: { id: project.id, name: project.name, updatedAt: project.updatedAt },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
