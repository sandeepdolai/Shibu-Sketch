import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DEMO_JOURNALS } from '@/lib/sketch/demoContent';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sketch/seed — idempotent demo seed.
 * If ANY SketchJournal already exists, does nothing and reports counts;
 * otherwise inserts the 4 hand-authored demo journals with their pages.
 */
export async function POST() {
  try {
    const existing = await db.sketchJournal.count();
    if (existing > 0) {
      return NextResponse.json({ seeded: false, journals: existing });
    }
    await db.$transaction(async (tx) => {
      for (let i = 0; i < DEMO_JOURNALS.length; i++) {
        const demo = DEMO_JOURNALS[i];
        await tx.sketchJournal.create({
          data: {
            title: demo.title,
            coverStyle: JSON.stringify(demo.coverStyle),
            paperColor: demo.paperColor ?? '#faf8f4',
            order: i,
            pages: {
              create: demo.pages.map((content, index) => ({
                index,
                content: JSON.stringify(content),
              })),
            },
          },
        });
      }
    });
    return NextResponse.json({ seeded: true, journals: DEMO_JOURNALS.length });
  } catch (e) {
    console.error('POST /api/sketch/seed failed:', e);
    return NextResponse.json({ error: 'failed to seed demo journals' }, { status: 500 });
  }
}
