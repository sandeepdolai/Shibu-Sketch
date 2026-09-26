/**
 * Shibu-Sketch — server-side helpers for the journal API routes.
 * Zod schemas (request validation) + DB row → DTO mappers.
 */

import { z } from 'zod';
import type { SketchJournal, SketchPage } from '@prisma/client';
import {
  parseCoverStyle,
  parsePageContent,
  type JournalDTO,
  type PageDTO,
} from './types';

/* ------------------------------------------------------------------ */
/* Zod schemas                                                         */
/* ------------------------------------------------------------------ */

export const coverStyleSchema = z
  .object({
    kind: z.enum(['solid', 'gradient', 'pattern', 'collage', 'photo']),
    color: z.string().min(1),
    color2: z.string().optional(),
    pattern: z
      .enum(['dots', 'stripes', 'grid', 'leaves', 'shapes', 'speckle', 'solar', 'fruit'])
      .optional(),
    emoji: z.array(z.string()).optional(),
    title: z.string().optional(),
    seed: z.number().optional(),
  })
  .loose();

export const paperColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'paperColor must be a hex color');

const strokePointSchema = z.object({ x: z.number(), y: z.number() });

const strokeSchema = z
  .object({
    id: z.string(),
    tool: z.enum(['pen', 'marker', 'highlighter', 'eraser']),
    color: z.string(),
    size: z.number(),
    points: z.array(strokePointSchema),
  })
  .loose();

const textItemSchema = z
  .object({
    id: z.string(),
    x: z.number(),
    y: z.number(),
    text: z.string(),
    font: z.enum(['hand', 'sans', 'typewriter']),
    size: z.number(),
    color: z.string(),
    rotation: z.number(),
    align: z.enum(['left', 'center', 'right']).optional(),
    lineHeight: z.number().optional(),
  })
  .loose();

const stickerItemSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['emoji', 'shape', 'tape', 'clip', 'frame']),
    value: z.string(),
    x: z.number(),
    y: z.number(),
    size: z.number(),
    rotation: z.number(),
    color: z.string().optional(),
  })
  .loose();

const photoItemSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['url', 'gradient']),
    dataUrl: z.string().optional(),
    gradient: z.tuple([z.string(), z.string()]).optional(),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    rotation: z.number(),
    aspect: z.number(),
    frame: z.enum(['plain', 'polaroid', 'clip', 'scallop']).optional(),
    caption: z.string().optional(),
    captionFont: z.enum(['hand', 'sans', 'typewriter']).optional(),
  })
  .loose();

export const pageContentSchema = z
  .object({
    bg: z.string().optional(),
    template: z.enum(['plain', 'dotted', 'grid', 'lined']).optional(),
    strokes: z.array(strokeSchema),
    texts: z.array(textItemSchema),
    stickers: z.array(stickerItemSchema),
    photos: z.array(photoItemSchema),
  })
  .loose(); // keep forward-compatible keys (future renderer fields)

export const createJournalSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(60, 'title too long (max 60)'),
  coverStyle: coverStyleSchema.optional(),
  paperColor: paperColorSchema.optional(),
  /** Optional initial pages (import/backup restore). Max 200 pages. */
  pages: z
    .array(z.object({ content: pageContentSchema }).loose())
    .min(2, 'a journal needs at least 2 pages')
    .max(200, 'too many pages (max 200)')
    .optional(),
});

export const updateJournalSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(60, 'title too long (max 60)').optional(),
  coverStyle: coverStyleSchema.optional(),
  paperColor: paperColorSchema.optional(),
  order: z.number().int().optional(),
});

export const addPageSchema = z.object({
  atIndex: z.number().int().min(0).optional(),
});

export const savePageSchema = z.object({
  content: pageContentSchema,
});

/** Shelf drag-to-reorder: the complete ordered list of journal ids. */
export const reorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'ids required').max(200, 'too many ids (max 200)'),
});

/** First human-readable zod issue, for error responses. */
export function zodErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'invalid request body';
}

/* ------------------------------------------------------------------ */
/* DB row → DTO mappers                                                */
/* ------------------------------------------------------------------ */

export function toJournalDTO(
  journal: SketchJournal & { _count?: { pages: number } | undefined },
): JournalDTO {
  return {
    id: journal.id,
    title: journal.title,
    coverStyle: parseCoverStyle(journal.coverStyle),
    paperColor: journal.paperColor,
    order: journal.order,
    pageCount: journal._count?.pages ?? 0,
  };
}

export function toPageDTO(page: SketchPage): PageDTO {
  return {
    id: page.id,
    journalId: page.journalId,
    index: page.index,
    content: parsePageContent(page.content),
  };
}

/** True when a thrown error is Prisma's "record not found" (P2025). */
export function isPrismaNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2025';
}
