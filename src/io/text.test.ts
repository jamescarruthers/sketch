import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Design, Sketch, TextEntity, Vec2 } from '../model/types';
import {
  addArc, addCircle, addDimension, addFrameText, addLine, addPathText, newDesign, newSketch, setUserParameter,
} from '../model/document';
import { curveLength } from '../geom/curves';
import { findProfiles } from '../geom/profiles';
import { boxAdd, dist, emptyBox, polygonArea } from '../geom/vec';
import { exportDxf, parseDxfCounts } from './dxf';
import { explodeText, fontFamilies, fontReady, registerFont, substituteText, textContours, textOutlines } from './text';

const fontFile = (pkg: string, file: string): ArrayBuffer => {
  const b = readFileSync(fileURLToPath(new URL(`../../node_modules/@fontsource/${pkg}/files/${file}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

beforeAll(() => {
  for (const [family, pkg] of [['Inter', 'inter'], ['JetBrains Mono', 'jetbrains-mono'], ['Zilla Slab', 'zilla-slab']]) {
    registerFont(family, false, false, fontFile(pkg, `${pkg}-latin-400-normal.woff`));
    registerFont(family, true, false, fontFile(pkg, `${pkg}-latin-700-normal.woff`));
    registerFont(family, false, true, fontFile(pkg, `${pkg}-latin-400-italic.woff`));
    registerFont(family, true, true, fontFile(pkg, `${pkg}-latin-700-italic.woff`));
  }
});

let d: Design;
let s: Sketch;
beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

const box = (polys: Vec2[][]) => {
  const b = emptyBox();
  for (const p of polys) for (const q of p) boxAdd(b, q);
  return b;
};
const frame = (w = 100, h = 20, x = 0, y = 0): [Vec2, Vec2, Vec2, Vec2] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const text = (t: string, height: number, fmt = {}): TextEntity => addFrameText(d, s, t, height, frame(), fmt);

describe('fonts', () => {
  it('has the three bundled families', () => {
    expect(fontFamilies()).toEqual(['Inter', 'JetBrains Mono', 'Zilla Slab']);
  });
  it('draws nothing for an unknown font, then falls back to regular for a missing style', () => {
    const t = text('A', 5, { font: 'Comic Sans' });
    expect(fontReady(t)).toBe(false);
    expect(textOutlines(t, s)).toEqual([]);
  });
  it('outlines every printable ASCII character in every family and style', () => {
    let chars = '';
    for (let c = 33; c < 127; c++) chars += String.fromCharCode(c);
    for (const font of ['Inter', 'JetBrains Mono', 'Zilla Slab']) {
      for (const [bold, italic] of [[false, false], [true, false], [false, true], [true, true]]) {
        const outlines = textOutlines(text(chars, 5, { font, bold, italic }), s);
        expect(outlines.length).toBeGreaterThan(94);
      }
    }
  });
});

describe('frame text', () => {
  it('sets cap height to the requested height from the frame origin', () => {
    const b = box(textOutlines(text('H', 10), s));
    expect(b.minY).toBeCloseTo(0, 3);
    expect(b.maxY).toBeCloseTo(10, 3);
    expect(b.minX).toBeGreaterThan(0);
    expect(b.minX).toBeLessThan(2);
  });
  it('counters are opposite wound to outers', () => {
    const polys = textOutlines(text('O', 10), s);
    expect(polys.length).toBe(2);
    expect(Math.sign(polygonArea(polys[0]))).toBe(-Math.sign(polygonArea(polys[1])));
  });
  it('aligns horizontally and vertically', () => {
    const left = box(textOutlines(text('HH', 10), s));
    const right = box(textOutlines(text('HH', 10, { halign: 'right' }), s));
    const center = box(textOutlines(text('HH', 10, { halign: 'center' }), s));
    const width = left.maxX - left.minX;
    expect(right.maxX).toBeGreaterThan(100 - 3);
    expect(right.maxX).toBeLessThanOrEqual(100);
    expect(center.minX + width / 2).toBeCloseTo(50, 0);
    expect(box(textOutlines(text('H', 10, { valign: 'top' }), s)).maxY).toBeCloseTo(20, 3);
    expect(box(textOutlines(text('H', 10, { valign: 'middle' }), s)).minY).toBeCloseTo(5, 3);
  });
  it('flips', () => {
    const b = box(textOutlines(text('H', 10), s));
    const fh = box(textOutlines(text('H', 10, { flipH: true }), s));
    expect(fh.maxX).toBeCloseTo(100 - b.minX, 3);
    const fv = box(textOutlines(text('H', 10, { flipV: true }), s));
    expect(fv.maxY).toBeCloseTo(20, 3);
  });
  it('spacing widens text and multi-line stacks downward', () => {
    const tight = box(textOutlines(text('HHH', 10), s));
    const wide = box(textOutlines(text('HHH', 10, { spacing: 50 }), s));
    expect(wide.maxX).toBeGreaterThan(tight.maxX + 5);
    const two = box(textOutlines(text('H\nH', 5, { valign: 'top' }), s));
    expect(two.maxY).toBeCloseTo(20, 3);
    expect(two.minY).toBeLessThan(10);
  });
  it('follows a rotated frame', () => {
    const t = addFrameText(d, s, 'H', 10, [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: -20, y: 100 }, { x: -20, y: 0 }]);
    const b = box(textOutlines(t, s));
    expect(b.maxX).toBeLessThanOrEqual(1e-6);
    expect(b.minX).toBeCloseTo(-10, 3);
    expect(b.minY).toBeGreaterThan(0);
  });
  it('monospace advances evenly', () => {
    const a = box(textOutlines(text('ii', 10, { font: 'JetBrains Mono' }), s));
    const b = box(textOutlines(text('iW', 10, { font: 'JetBrains Mono' }), s));
    expect(Math.abs(a.maxX - b.maxX)).toBeLessThan(2);
  });
});

describe('parameter substitution', () => {
  it('substitutes parameters, dimensions and leaves unknowns', () => {
    setUserParameter(d, { name: 'PartNumber', expression: '42', value: 42, comment: '', unit: '' });
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    addDimension(d, s, 'distance', [l.a, l.b], 12.5);
    expect(substituteText('Part {PartNumber} is {d1} long {nope}', d)).toBe('Part 42 is 12.5 long {nope}');
    expect(substituteText('{d1 * 2}', d)).toBe('25');
  });
  it('drives outlines', () => {
    setUserParameter(d, { name: 'n', expression: '11', value: 11, comment: '', unit: '' });
    const t = text('{n}', 5);
    expect(textOutlines(t, s, { design: d }).length).toBe(2);
  });
});

describe('text on path', () => {
  const path = () => addLine(d, s, { x: 0, y: 0 }, { x: 100, y: 0 });
  it('sits on a line above it by default, reading left to right', () => {
    const t = addPathText(d, s, 'H', 10, path().id);
    const b = box(textOutlines(t, s));
    expect(b.minY).toBeCloseTo(0, 3);
    expect(b.maxY).toBeCloseTo(10, 3);
  });
  it('sits below when asked', () => {
    const t = addPathText(d, s, 'H', 10, path().id, { above: false });
    const b = box(textOutlines(t, s));
    expect(b.maxY).toBeCloseTo(0, 3);
    expect(b.minY).toBeCloseTo(-10, 3);
  });
  it('reads left to right on a line drawn right to left', () => {
    const l = addLine(d, s, { x: 100, y: 0 }, { x: 0, y: 0 });
    const b = box(textOutlines(addPathText(d, s, 'H', 10, l.id), s));
    expect(b.minX).toBeLessThan(20);
    expect(b.minY).toBeCloseTo(0, 3);
  });
  it('aligns along the path', () => {
    const l = path();
    const c = box(textOutlines(addPathText(d, s, 'H', 10, l.id, { halign: 'center' }), s));
    expect((c.minX + c.maxX) / 2).toBeCloseTo(50, 0);
    const r = box(textOutlines(addPathText(d, s, 'H', 10, l.id, { halign: 'right' }), s));
    expect(r.maxX).toBeGreaterThan(97);
  });
  it('fit to path spreads glyphs end to end', () => {
    const b = box(textOutlines(addPathText(d, s, 'HIH', 10, path().id, { fitToPath: true }), s));
    expect(b.minX).toBeLessThan(3);
    expect(b.maxX).toBeGreaterThan(97);
  });
  it('flips vertically about the path and horizontally along it', () => {
    const l = path();
    const v = box(textOutlines(addPathText(d, s, 'H', 10, l.id, { flipV: true }), s));
    expect(v.minY).toBeCloseTo(-10, 3);
    const h = box(textOutlines(addPathText(d, s, 'H', 10, l.id, { flipH: true }), s));
    expect(h.maxX).toBeGreaterThan(90);
  });
  it('wraps outside a circle, upright at the top', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 50);
    const t = addPathText(d, s, 'HELLO', 5, c.id, { halign: 'center' });
    const polys = textOutlines(t, s);
    for (const p of polys) for (const q of p) expect(Math.hypot(q.x, q.y)).toBeGreaterThan(49.9);
    expect(Math.hypot(...Object.values(polys[0][0]))).toBeLessThan(56);
  });
  it('wraps an arc and adapts when the path changes', () => {
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: -50, y: 0 });
    expect(curveLength(s, a)).toBeCloseTo(Math.PI * 50);
    const t = addPathText(d, s, 'HELLO', 5, a.id);
    const before = box(textOutlines(t, s));
    expect(before.minX).toBeLessThan(-30);
    expect(before.maxY).toBeGreaterThan(15);
    for (const poly of textOutlines(t, s)) for (const q of poly) expect(Math.hypot(q.x, q.y)).toBeGreaterThan(49.9);
    s.points[a.a].x = 100;
    s.points[a.b].x = -100;
    expect(box(textOutlines(t, s)).minX).toBeLessThan(-80);
  });
  it('draws nothing when the path is gone', () => {
    const t = addPathText(d, s, 'H', 10, 'missing');
    expect(textOutlines(t, s)).toEqual([]);
  });
});

describe('explodeText', () => {
  it('turns text into fixed curves and removes the entity', () => {
    const t = text('Ag', 10);
    const outlines = textOutlines(t, s, { tolerance: 0.005 });
    const ids = explodeText(d, s, t.id);
    expect(s.curves[t.id]).toBeUndefined();
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) {
      expect(s.curves[id].fixed).toBe(true);
      expect(['line', 'controlSpline']).toContain(s.curves[id].type);
    }
    for (const p of Object.values(s.points)) expect(p.fixed).toBe(true);
    // Inter's A and g each have an outer and a counter, and every closed region shades.
    expect(outlines.length).toBe(4);
    expect(findProfiles(s).length).toBe(4);
  });
  it('keeps the outline exactly', () => {
    const t = text('S', 10);
    const contours = textContours(t, s);
    const ids = explodeText(d, s, t.id);
    expect(ids.length).toBe(contours.flat().length);
    const c = contours[0][0];
    const head = Object.values(s.points).filter((p) => dist(p, c.a) < 1e-9);
    expect(head.length).toBeGreaterThanOrEqual(1);
  });
  it('is a no-op without the font', () => {
    const t = text('S', 10, { font: 'Comic Sans' });
    expect(explodeText(d, s, t.id)).toEqual([]);
    expect(s.curves[t.id]).toBeDefined();
  });
  it('exports to DXF as polylines, before and after exploding', () => {
    const t = text('O', 10);
    const before = parseDxfCounts(exportDxf(s));
    expect(before.POLYLINE).toBe(2);
    explodeText(d, s, t.id);
    const after = parseDxfCounts(exportDxf(s));
    expect(after.wellFormed).toBe(true);
    expect(after.POLYLINE + after.LINE).toBeGreaterThan(2);
  });
});
