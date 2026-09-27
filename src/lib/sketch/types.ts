/**
 * Shibu-Sketch — shared content contracts.
 *
 * These types are the SOURCE OF TRUTH for journal/page/cover data.
 * Everything is JSON-serializable and stored in Prisma as strings.
 * Coordinates inside page content are NORMALIZED (0..1) relative to the
 * page rect so content renders identically in the 2D editor, on 3D page
 * textures, and in exports.
 */

export type DrawTool = 'pen' | 'marker' | 'highlighter' | 'eraser';

export interface StrokePoint {
  /** normalized 0..1 across page width */
  x: number;
  /** normalized 0..1 across page height */
  y: number;
}

export interface Stroke {
  id: string;
  tool: DrawTool;
  /** css color */
  color: string;
  /** stroke width in normalized units (fraction of page width). 0.01 ≈ medium pen */
  size: number;
  points: StrokePoint[];
}

export type TextFont = 'hand' | 'sans' | 'typewriter';

export interface TextItem {
  id: string;
  /** normalized 0..1 anchor (center of text block) */
  x: number;
  y: number;
  text: string;
  font: TextFont;
  /** font size as fraction of page width, e.g. 0.06 */
  size: number;
  color: string;
  /** radians, clockwise */
  rotation: number;
  /** text-align within block */
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
}

export type StickerKind = 'emoji' | 'shape' | 'tape' | 'clip' | 'frame';

export interface StickerItem {
  id: string;
  kind: StickerKind;
  /** emoji char for 'emoji'; shape id ('star'|'heart'|'circle'|'triangle'|'squiggle'|'arrow') for 'shape'; color hex for 'tape' */
  value: string;
  /** normalized 0..1 center */
  x: number;
  y: number;
  /** width as fraction of page width */
  size: number;
  rotation: number;
  color?: string;
}

export interface PhotoItem {
  id: string;
  /** 'url' = dataUrl provided; 'gradient' = procedural placeholder */
  kind: 'url' | 'gradient';
  /** dataUrl when kind=url */
  dataUrl?: string;
  /** two css colors when kind=gradient */
  gradient?: [string, string];
  /** normalized center */
  x: number;
  y: number;
  /** width as fraction of page width */
  w: number;
  rotation: number;
  /** aspect = h/w */
  aspect: number;
  frame?: 'plain' | 'polaroid' | 'clip' | 'scallop';
  caption?: string;
  captionFont?: TextFont;
}

export type PageTemplate = 'plain' | 'dotted' | 'grid' | 'lined';

export interface PageContent {
  /** paper tint override (css color); omit = journal paperColor */
  bg?: string;
  /** page template drawn under the content; omit = 'plain' */
  template?: PageTemplate;
  strokes: Stroke[];
  texts: TextItem[];
  stickers: StickerItem[];
  photos: PhotoItem[];
}

export function emptyPageContent(): PageContent {
  return { strokes: [], texts: [], stickers: [], photos: [] };
}

/* ------------------------------------------------------------------ */
/* Cover                                                               */
/* ------------------------------------------------------------------ */

export type CoverKind = 'solid' | 'gradient' | 'pattern' | 'collage' | 'photo';
export type CoverPattern =
  | 'dots'
  | 'stripes'
  | 'grid'
  | 'leaves'
  | 'shapes'
  | 'speckle'
  | 'solar'
  | 'fruit'
  | 'memphis';

export interface CoverStyle {
  kind: CoverKind;
  /** primary css color */
  color: string;
  /** secondary css color (gradient end / pattern accent) */
  color2?: string;
  pattern?: CoverPattern;
  /** emoji chars scattered on collage covers */
  emoji?: string[];
  /** title printed on the cover (optional) */
  title?: string;
  /** deterministic variation seed */
  seed: number;
}

export interface JournalDTO {
  id: string;
  title: string;
  coverStyle: CoverStyle;
  paperColor: string;
  order: number;
  pageCount: number;
}

export interface PageDTO {
  id: string;
  journalId: string;
  index: number;
  content: PageContent;
}

export interface JournalDetailDTO extends JournalDTO {
  pages: PageDTO[];
}

/** Parse coverStyle from a raw DB string, tolerant of legacy/invalid JSON. */
export function parseCoverStyle(raw: string | null | undefined): CoverStyle {
  const fallback: CoverStyle = { kind: 'solid', color: '#3fae5a', seed: 1 };
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as Partial<CoverStyle>;
    if (!v || typeof v !== 'object') return fallback;
    return {
      kind: v.kind ?? 'solid',
      color: typeof v.color === 'string' ? v.color : '#3fae5a',
      color2: typeof v.color2 === 'string' ? v.color2 : undefined,
      pattern: v.pattern,
      emoji: Array.isArray(v.emoji) ? v.emoji : undefined,
      title: typeof v.title === 'string' ? v.title : undefined,
      seed: typeof v.seed === 'number' ? v.seed : 1,
    };
  } catch {
    return fallback;
  }
}

/** Parse page content from a raw DB string, tolerant of invalid JSON. */
export function parsePageContent(raw: string | null | undefined): PageContent {
  const base = emptyPageContent();
  if (!raw) return base;
  try {
    const v = JSON.parse(raw) as Partial<PageContent>;
    if (!v || typeof v !== 'object') return base;
    return {
      bg: typeof v.bg === 'string' ? v.bg : undefined,
      template:
        v.template === 'dotted' || v.template === 'grid' || v.template === 'lined'
          ? v.template
          : undefined,
      strokes: Array.isArray(v.strokes) ? v.strokes : [],
      texts: Array.isArray(v.texts) ? v.texts : [],
      stickers: Array.isArray(v.stickers) ? v.stickers : [],
      photos: Array.isArray(v.photos) ? v.photos : [],
    };
  } catch {
    return base;
  }
}
