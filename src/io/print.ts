// Print 1:1 [user]: lays a sheet of geometry out on real paper and writes each page as SVG in mm.
// A browser cannot force the printer's scale, which is why every page carries a 100 mm scale bar.
import type { Box } from '../geom/vec';
import { groupMarkup, type Sheet } from './svg';

export type PaperName = 'A4' | 'A3' | 'A2' | 'Letter' | 'Tabloid';
export const PAPERS: Record<PaperName, { w: number; h: number; label: string }> = {
  A4: { w: 210, h: 297, label: 'A4 (210 x 297 mm)' },
  A3: { w: 297, h: 420, label: 'A3 (297 x 420 mm)' },
  A2: { w: 420, h: 594, label: 'A2 (420 x 594 mm)' },
  Letter: { w: 215.9, h: 279.4, label: 'Letter (8.5 x 11 in)' },
  Tabloid: { w: 279.4, h: 431.8, label: 'Tabloid (11 x 17 in)' },
};

export type Orientation = 'portrait' | 'landscape';

export interface PrintOptions { paper: PaperName; orientation: Orientation; margin: number }

/** Pieces of a tiled print share this much, so they can be lined up and taped. */
export const PRINT_OVERLAP = 10;
/** Height kept under the drawing on every page for the scale bar and the label. */
export const PRINT_FOOTER = 13;
export const SCALE_BAR = 100;
const MARK = 4;

export interface Tile {
  col: number; row: number;
  /** The part of the sheet on this page: sketch mm, Y up, from its top-left corner. */
  x: number; y: number;
}

export interface PrintLayout {
  /** Paper size as oriented. */
  w: number; h: number;
  margin: number;
  /** Drawing area on each page. */
  pw: number; ph: number;
  cols: number; rows: number;
  tiles: Tile[];
  /** World positions of the alignment marks, Y up. Empty on a single page. */
  marks: { x: number; y: number }[];
  /** Centres of the overlap strips, where two tiles meet. */
  seamsX: number[]; seamsY: number[];
  /** Why this cannot print, or null. */
  problem: string | null;
}

export function layoutPrint(box: Box, o: PrintOptions): PrintLayout {
  const paper = PAPERS[o.paper];
  const w = o.orientation === 'portrait' ? paper.w : paper.h;
  const h = o.orientation === 'portrait' ? paper.h : paper.w;
  const pw = w - 2 * o.margin;
  const ph = h - 2 * o.margin - PRINT_FOOTER;
  const out: PrintLayout = { w, h, margin: o.margin, pw, ph, cols: 1, rows: 1, tiles: [], marks: [], seamsX: [], seamsY: [], problem: null };
  if (!(o.margin >= 0)) out.problem = 'Margins cannot be negative';
  else if (pw < SCALE_BAR) out.problem = `Those margins leave less than the ${SCALE_BAR} mm the scale bar needs`;
  else if (ph <= PRINT_OVERLAP || pw <= PRINT_OVERLAP) out.problem = 'Those margins leave no room to draw';
  const has = Number.isFinite(box.minX);
  if (out.problem || !has) {
    if (!out.problem) out.problem = 'Nothing to print';
    return out;
  }
  const gw = box.maxX - box.minX;
  const gh = box.maxY - box.minY;
  const stepX = pw - PRINT_OVERLAP;
  const stepY = ph - PRINT_OVERLAP;
  out.cols = gw <= pw ? 1 : Math.ceil((gw - PRINT_OVERLAP) / stepX);
  out.rows = gh <= ph ? 1 : Math.ceil((gh - PRINT_OVERLAP) / stepY);
  // Centred: on a single page that is the whole placement, and on several it evens out the slack.
  const spanX = out.cols * stepX + PRINT_OVERLAP;
  const spanY = out.rows * stepY + PRINT_OVERLAP;
  const left = box.minX + gw / 2 - spanX / 2;
  const top = box.minY + gh / 2 + spanY / 2;
  for (let row = 0; row < out.rows; row++) {
    for (let col = 0; col < out.cols; col++) out.tiles.push({ col, row, x: left + col * stepX, y: top - row * stepY });
  }
  for (let i = 1; i < out.cols; i++) out.seamsX.push(left + i * stepX + PRINT_OVERLAP / 2);
  for (let i = 1; i < out.rows; i++) out.seamsY.push(top - i * stepY - PRINT_OVERLAP / 2);
  if (out.tiles.length > 1) {
    const along = (from: number, length: number): number[] => [0.1, 0.5, 0.9].map((f) => from + length * f);
    const xs = out.seamsX.length ? out.seamsX : along(left, pw);
    const ys = out.seamsY.length ? out.seamsY : along(top - ph, ph);
    for (const x of xs) for (const y of ys) out.marks.push({ x, y });
  }
  return out;
}

const n = (v: number): string => v.toFixed(3).replace(/\.?0+$/, '');

/** Alignment crosses and seam lines that fall on this page, in the nested sheet's own coordinates. */
function pageMarks(l: PrintLayout, t: Tile): string {
  const out: string[] = [];
  const inX = (x: number): boolean => x >= t.x && x <= t.x + l.pw;
  const inY = (y: number): boolean => y <= t.y && y >= t.y - l.ph;
  for (const x of l.seamsX) {
    if (inX(x)) out.push(`<line class="print-seam" x1="${n(x)}" y1="${n(-t.y)}" x2="${n(x)}" y2="${n(-t.y + l.ph)}"/>`);
  }
  for (const y of l.seamsY) {
    if (inY(y)) out.push(`<line class="print-seam" x1="${n(t.x)}" y1="${n(-y)}" x2="${n(t.x + l.pw)}" y2="${n(-y)}"/>`);
  }
  const seam = out.length ? `<g fill="none" stroke="#9aa0a6" stroke-width="0.15" stroke-dasharray="1.5 1.5">${out.join('')}</g>` : '';
  const crosses = l.marks.filter((m) => inX(m.x) && inY(m.y)).map((m) => `<g class="print-mark" stroke="#000" stroke-width="0.2" fill="none">
    <line x1="${n(m.x - MARK)}" y1="${n(-m.y)}" x2="${n(m.x + MARK)}" y2="${n(-m.y)}"/>
    <line x1="${n(m.x)}" y1="${n(-m.y - MARK)}" x2="${n(m.x)}" y2="${n(-m.y + MARK)}"/>
    <circle cx="${n(m.x)}" cy="${n(-m.y)}" r="${n(MARK / 2)}"/></g>`);
  return seam + crosses.join('');
}

export function pageLabel(l: PrintLayout, i: number): string {
  const t = l.tiles[i];
  const where = l.tiles.length > 1 ? `, column ${t.col + 1} of ${l.cols}, row ${t.row + 1} of ${l.rows}, overlap ${PRINT_OVERLAP} mm` : '';
  return `Page ${i + 1} of ${l.tiles.length}${where}. Scale 1:1.`;
}

function scaleBar(l: PrintLayout): string {
  const y = l.h - l.margin - 6;
  const x = l.margin;
  const ticks = Array.from({ length: SCALE_BAR / 10 + 1 }, (_, i) => {
    const at = x + i * 10;
    const tall = i % 5 === 0 ? 2.5 : 1.5;
    return `<line x1="${n(at)}" y1="${n(y)}" x2="${n(at)}" y2="${n(y - tall)}"/>`;
  }).join('');
  return `<g class="scale-bar" stroke="#000" stroke-width="0.25" fill="none">
    <line class="scale-bar-line" x1="${n(x)}" y1="${n(y)}" x2="${n(x + SCALE_BAR)}" y2="${n(y)}"/>${ticks}</g>
  <text x="${n(x)}" y="${n(y + 3.6)}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="2.8" fill="#000">0</text>
  <text x="${n(x + SCALE_BAR)}" y="${n(y + 3.6)}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="2.8" fill="#000">${SCALE_BAR} mm</text>`;
}

/** One page, drawn in its own coordinates of 1 unit to 1 mm. */
export function pageBody(sheet: Sheet, l: PrintLayout, i: number): string {
  const t = l.tiles[i];
  const y = l.h - l.margin - 2.4;
  return `<rect width="${n(l.w)}" height="${n(l.h)}" fill="#fff"/>
  <svg x="${n(l.margin)}" y="${n(l.margin)}" width="${n(l.pw)}" height="${n(l.ph)}" viewBox="${n(t.x)} ${n(-t.y)} ${n(l.pw)} ${n(l.ph)}" overflow="hidden">
    ${sheet.groups.map(groupMarkup).join('\n')}
    ${pageMarks(l, t)}
  </svg>
  ${scaleBar(l)}
  <text class="print-label" x="${n(l.w - l.margin)}" y="${n(y)}" text-anchor="end" font-family="Inter, Helvetica, Arial, sans-serif" font-size="2.8" fill="#000">${pageLabel(l, i)}</text>`;
}

/** The stylesheet that sets the paper. `@page` with a size in mm is what fixes the page box. */
export const pageCss = (l: PrintLayout): string =>
  `@page { size: ${n(l.w)}mm ${n(l.h)}mm; margin: 0; }\n.print-page { width: ${n(l.w)}mm; height: ${n(l.h)}mm; }`;

/** Every page as an element's HTML, in real mm. */
export const printPages = (sheet: Sheet, l: PrintLayout): string => l.tiles.map((_, i) => `<div class="print-page" data-page="${i + 1}">
  <svg xmlns="http://www.w3.org/2000/svg" width="${n(l.w)}mm" height="${n(l.h)}mm" viewBox="0 0 ${n(l.w)} ${n(l.h)}">${pageBody(sheet, l, i)}</svg>
</div>`).join('\n');

const GAP = 8;

/** The placement, for the dialog: each page laid out as it will be taped together. */
export function previewMarkup(sheet: Sheet, l: PrintLayout): string {
  const w = l.cols * (l.w + GAP) - GAP;
  const h = l.rows * (l.h + GAP) - GAP;
  const pages = l.tiles.map((t, i) => `<svg x="${n(t.col * (l.w + GAP))}" y="${n(t.row * (l.h + GAP))}" width="${n(l.w)}" height="${n(l.h)}" viewBox="0 0 ${n(l.w)} ${n(l.h)}">${pageBody(sheet, l, i)}</svg>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="240">${pages.join('')}</svg>`;
}
