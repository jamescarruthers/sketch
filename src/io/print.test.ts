import { describe, expect, it } from 'vitest';
import { layoutPrint, pageCss, pageLabel, PRINT_FOOTER, PRINT_OVERLAP, printPages } from './print';
import { svgSheet } from './svg';
import { addLine, newDesign, newSketch } from '../model/document';

const box = (w: number, h: number) => ({ minX: 0, minY: 0, maxX: w, maxY: h });
const A4 = { paper: 'A4', orientation: 'portrait', margin: 10 } as const;

describe('layoutPrint', () => {
  it('centres what fits on one page', () => {
    const l = layoutPrint(box(100, 50), A4);
    expect(l).toMatchObject({ cols: 1, rows: 1, w: 210, h: 297, problem: null });
    expect(l.pw).toBe(190);
    expect(l.ph).toBe(297 - 20 - PRINT_FOOTER);
    expect(l.tiles[0].x + l.pw / 2).toBeCloseTo(50, 9);
    expect(l.tiles[0].y - l.ph / 2).toBeCloseTo(25, 9);
    expect(l.marks).toEqual([]);
  });

  it('turns the paper for landscape', () => {
    expect(layoutPrint(box(10, 10), { ...A4, orientation: 'landscape' })).toMatchObject({ w: 297, h: 210, pw: 277 });
  });

  it('tiles what does not fit, every part of it on a page, each pair overlapping', () => {
    const l = layoutPrint(box(500, 300), A4);
    expect(l.cols).toBe(3);
    expect(l.rows).toBe(2);
    expect(l.tiles).toHaveLength(6);
    expect(l.tiles[1].x - l.tiles[0].x).toBeCloseTo(l.pw - PRINT_OVERLAP, 9);
    expect(l.tiles[0].x).toBeLessThanOrEqual(0);
    expect(l.tiles[2].x + l.pw).toBeGreaterThanOrEqual(500);
    expect(l.tiles[0].y).toBeGreaterThanOrEqual(300);
    expect(l.tiles[5].y - l.ph).toBeLessThanOrEqual(0);
    expect(l.marks.length).toBe(l.seamsX.length * l.seamsY.length);
    for (const x of l.seamsX) expect(l.tiles.filter((t) => t.x <= x && x <= t.x + l.pw).length).toBeGreaterThan(l.rows);
    expect(pageLabel(l, 3)).toContain('Page 4 of 6');
    expect(pageLabel(l, 3)).toContain('column 1 of 3, row 2 of 2');
    expect(pageLabel(l, 3)).toContain(`overlap ${PRINT_OVERLAP} mm`);
  });

  it('marks a strip of pages along the seam', () => {
    const l = layoutPrint(box(300, 50), A4);
    expect([l.cols, l.rows]).toEqual([2, 1]);
    expect(l.marks.length).toBe(3);
  });

  it.each([
    ['no room for the scale bar', { ...A4, margin: 60 }],
    ['a negative margin', { ...A4, margin: -1 }],
  ])('refuses %s', (_n, o) => {
    expect(layoutPrint(box(10, 10), o).problem).toBeTruthy();
  });

  it('refuses an empty sheet', () => {
    expect(layoutPrint({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, A4).problem).toBeTruthy();
  });
});

describe('pages', () => {
  it('are sized in real mm, with @page to match, and carry a 100 mm bar', () => {
    const d = newDesign();
    const s = newSketch(d);
    addLine(d, s, { x: 0, y: 0 }, { x: 100, y: 0 });
    const sheet = svgSheet(d, [s]);
    const l = layoutPrint(sheet.box, A4);
    expect(pageCss(l)).toContain('@page { size: 210mm 297mm; margin: 0; }');
    const html = printPages(sheet, l);
    expect(html).toContain('width="210mm" height="297mm" viewBox="0 0 210 297"');
    const bar = /class="scale-bar-line" x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"/.exec(html);
    expect(Number(bar?.[2]) - Number(bar?.[1])).toBeCloseTo(100, 6);
  });
});
