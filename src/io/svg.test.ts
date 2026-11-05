import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Design, Sketch, Vec2 } from '../model/types';
import {
  addArc, addCircle, addConic, addConstraint, addControlSpline, addDimension, addEllipse, addEllipticalArc, addFitSpline, addFrameText, addLine, addPoint,
  newDesign, newSketch,
} from '../model/document';
import { addLayer } from '../model/layers';
import { resolve } from '../geom/curves';
import { cubicAt, cubicsOf, exportSvg, SVG_MARGIN, SVG_TOLERANCE, type Cubic } from './svg';
import { registerFont } from './text';

let d: Design;
let s: Sketch;
const fresh = (): void => {
  d = newDesign();
  s = newSketch(d);
};

/** Each attribute of each element named `tag`, as read back from the file. */
function elements(svg: string, tag: string): Record<string, string>[] {
  return [...svg.matchAll(new RegExp(`<${tag}\\b([^>]*?)/?>`, 'g'))].map((m) => Object.fromEntries(
    [...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
  ));
}

/** A path's commands: letter and numbers. */
function commands(d: string): { op: string; args: number[] }[] {
  return [...d.matchAll(/([MLCAZ])([^MLCAZ]*)/g)].map((m) => ({ op: m[1], args: m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number) }));
}

/** Read the cubics of a path back, undoing the Y flip. */
function parsedCubics(d: string): Cubic[] {
  const out: Cubic[] = [];
  let at: Vec2 = { x: 0, y: 0 };
  const p = (a: number[], i: number): Vec2 => ({ x: a[i], y: -a[i + 1] });
  for (const c of commands(d)) {
    if (c.op === 'M') at = p(c.args, 0);
    if (c.op === 'C') {
      const b = p(c.args, 4);
      out.push({ a: at, c1: p(c.args, 0), c2: p(c.args, 2), b });
      at = b;
    }
  }
  return out;
}

const gap = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const toSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const l = d.x * d.x + d.y * d.y;
  const t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l)) : 0;
  return gap(p, { x: a.x + d.x * t, y: a.y + d.y * t });
};

/** Worst distance from samples of the curve to the fine polyline of the cubics. */
function miss(curve: Parameters<typeof resolve>[1], cubics: Cubic[]): number {
  const pc = resolve(s, curve);
  const on = cubics.flatMap((c) => Array.from({ length: 100 }, (_, i) => cubicAt(c, i / 99)));
  let worst = 0;
  for (let i = 0; i <= 300; i++) {
    const p = pc.at(i / 300);
    let best = Infinity;
    for (let k = 0; k + 1 < on.length; k++) best = Math.min(best, toSegment(p, on[k], on[k + 1]));
    worst = Math.max(worst, best);
  }
  return worst;
}

beforeAll(() => {
  const b = readFileSync(fileURLToPath(new URL('../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff', import.meta.url)));
  registerFont('Inter', false, false, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
});

describe('sheet', () => {
  it('is in real mm, with a viewBox of the same size, and Y flipped', () => {
    fresh();
    addLine(d, s, { x: 10, y: 20 }, { x: 110, y: 50 });
    const svg = exportSvg(d, [s]);
    const [root] = elements(svg, 'svg');
    expect(root.width).toBe(`${100 + 2 * SVG_MARGIN}mm`);
    expect(root.height).toBe(`${30 + 2 * SVG_MARGIN}mm`);
    expect(root.viewBox.split(' ').map(Number)).toEqual([10 - SVG_MARGIN, -50 - SVG_MARGIN, 100 + 2 * SVG_MARGIN, 30 + 2 * SVG_MARGIN]);
    const [line] = elements(svg, 'line');
    expect(line).toMatchObject({ x1: '10', y1: '-20', x2: '110', y2: '-50' });
  });

  it('never contains constraint glyphs, and dimensions only when asked', () => {
    fresh();
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    addConstraint(d, s, 'horizontal', [l.id]);
    addDimension(d, s, 'distance', [l.a, l.b], 40, { label: { x: 20, y: 12 } });
    const plain = exportSvg(d, [s]);
    expect(elements(plain, 'text')).toHaveLength(0);
    expect(elements(plain, 'line')).toHaveLength(1);
    const dims = exportSvg(d, [s], { dimensions: true });
    expect(dims).toContain('>40.00<');
    expect(elements(dims, 'line').length).toBeGreaterThan(3);
    expect(dims).not.toContain('horizontal');
  });

  it('follows the options for points, projected and construction geometry', () => {
    fresh();
    addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    addLine(d, s, { x: 0, y: 5 }, { x: 40, y: 5 }, { lineType: 'construction' });
    addLine(d, s, { x: 0, y: 6 }, { x: 40, y: 6 }, { lineType: 'centerline' });
    addLine(d, s, { x: 0, y: 10 }, { x: 40, y: 10 }).projected = { origin: 'x' };
    addPoint(d, s, { x: 7, y: 7 }, { explicit: true });
    // The owner's call in OPEN-9: centerlines come by default, as DXF has them, and go when unticked.
    expect(elements(exportSvg(d, [s]), 'line')).toHaveLength(2);
    expect(elements(exportSvg(d, [s], { centerlines: false }), 'line')).toHaveLength(1);
    expect(elements(exportSvg(d, [s], { projected: true }), 'line')).toHaveLength(3);
    expect(elements(exportSvg(d, [s], { construction: true }), 'line')).toHaveLength(3);
    expect(elements(exportSvg(d, [s]), 'circle')).toHaveLength(0);
    expect(elements(exportSvg(d, [s], { points: true }), 'circle')).toMatchObject([{ cx: '7', cy: '-7' }]);
  });

  it('keeps dash styles', () => {
    fresh();
    addLine(d, s, { x: 0, y: 5 }, { x: 40, y: 5 }, { lineType: 'construction' });
    addLine(d, s, { x: 0, y: 6 }, { x: 40, y: 6 }, { lineType: 'centerline' });
    addLine(d, s, { x: 0, y: 7 }, { x: 40, y: 7 });
    const dashes = elements(exportSvg(d, [s], { construction: true }), 'line').map((l) => l['stroke-dasharray']);
    expect(dashes).toEqual(['2.1 1.5', '4.2 1.2 0.9 1.2', undefined]);
  });
});

describe('curves', () => {
  it('writes a true circle', () => {
    fresh();
    addCircle(d, s, { x: 3, y: 4 }, 12.5);
    expect(elements(exportSvg(d, [s]), 'circle')).toMatchObject([{ cx: '3', cy: '-4', r: '12.5' }]);
  });

  it('writes an arc as an A command that lands on the right side, with the Y flip', () => {
    fresh();
    addArc(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
    const [path] = elements(exportSvg(d, [s]), 'path');
    const [m, a] = commands(path.d);
    expect(m.args).toEqual([10, 0]);
    // rx ry rotation large sweep x y: a quarter turn, counter-clockwise on screen.
    expect(a.args).toEqual([10, 10, 0, 0, 0, 0, -10]);
  });

  it('flags an arc past a half turn as large', () => {
    fresh();
    addArc(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 });
    const [path] = elements(exportSvg(d, [s]), 'path');
    expect(commands(path.d)[1].args.slice(3, 5)).toEqual([1, 0]);
  });

  it('writes an ellipse as one, turned the right way for the Y flip', () => {
    fresh();
    addEllipse(d, s, { x: 0, y: 0 }, { x: 8, y: 6 }, { x: -3, y: 4 });
    const [e] = elements(exportSvg(d, [s]), 'ellipse');
    expect(Number(e.rx)).toBeCloseTo(10, 3);
    expect(Number(e.ry)).toBeCloseTo(5, 3);
    expect(Number(/rotate\((-?[\d.]+)/.exec(e.transform)?.[1])).toBeCloseTo(-36.8699, 3);
  });

  it('writes an elliptical arc as an A command with both radii', () => {
    fresh();
    addEllipticalArc(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 0 }, { x: 0, y: 5 });
    const [path] = elements(exportSvg(d, [s]), 'path');
    const [m, a] = commands(path.d);
    expect(m.args).toEqual([10, 0]);
    expect(a.args).toEqual([10, 5, 0, 0, 0, 0, -5]);
  });

  it('writes a fit spline as exact cubics, one per span', () => {
    fresh();
    const c = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 20, y: 30 }, { x: 50, y: 10 }, { x: 80, y: 25 }]);
    const [path] = elements(exportSvg(d, [s]), 'path');
    const got = parsedCubics(path.d);
    expect(got).toHaveLength(3);
    expect(miss(c, got)).toBeLessThan(2e-3);
    // Against the curve's own cubics: exact, bar the 4 decimals of the file.
    const exact = cubicsOf(resolve(s, c), 1e-9) as Cubic[];
    expect(exact).toHaveLength(3);
    got.forEach((g, i) => {
      expect(gap(g.c1, exact[i].c1)).toBeLessThan(2e-4);
      expect(gap(g.c2, exact[i].c2)).toBeLessThan(2e-4);
    });
  });

  it('writes a degree 3 control spline as exact cubics', () => {
    fresh();
    const c = addControlSpline(d, s, [{ x: 0, y: 0 }, { x: 10, y: 30 }, { x: 40, y: 30 }, { x: 60, y: 0 }, { x: 90, y: 10 }], 3);
    expect(cubicsOf(resolve(s, c), 1e-9)).toHaveLength(2);
  });

  it('holds a degree 5 spline and a conic to the stated tolerance', () => {
    fresh();
    const deg5 = addControlSpline(d, s, [{ x: 0, y: 0 }, { x: 10, y: 30 }, { x: 40, y: 30 }, { x: 60, y: 0 }, { x: 90, y: 10 }, { x: 100, y: 40 }, { x: 120, y: 0 }], 5);
    const conic = addConic(d, s, { x: 0, y: -40 }, { x: 60, y: -40 }, { x: 30, y: -80 }, 0.8);
    const paths = elements(exportSvg(d, [s]), 'path').map((p) => parsedCubics(p.d));
    expect(paths).toHaveLength(2);
    expect(miss(deg5, paths[0])).toBeLessThan(SVG_TOLERANCE);
    expect(miss(conic, paths[1])).toBeLessThan(SVG_TOLERANCE);
    expect(paths[0].length).toBeLessThan(40);
  });

  it('closes a closed spline', () => {
    fresh();
    addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], true);
    const [path] = elements(exportSvg(d, [s]), 'path');
    expect(path.d.trim().endsWith('Z')).toBe(true);
  });

  it('falls back to a polyline when no few cubics reach the tolerance', () => {
    fresh();
    addConic(d, s, { x: 0, y: 0 }, { x: 60, y: 0 }, { x: 30, y: 40 }, 0.8);
    const [path] = elements(exportSvg(d, [s], { tolerance: 1e-14 }), 'path');
    const ops = commands(path.d).map((c) => c.op);
    expect(ops).toContain('L');
    expect(ops).not.toContain('C');
  });

  it('writes text as filled outline paths, not as text', () => {
    fresh();
    addFrameText(d, s, 'HI', 10, [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 15 }, { x: 0, y: 15 }]);
    const svg = exportSvg(d, [s]);
    expect(elements(svg, 'text')).toHaveLength(0);
    const [path] = elements(svg, 'path');
    expect(path.fill).toBe(d.layers[0].color);
    expect(commands(path.d).filter((c) => c.op === 'M').length).toBeGreaterThanOrEqual(2);
  });
});

describe('layers', () => {
  const groups = (svg: string): Record<string, string>[] => elements(svg, 'g').filter((g) => g['data-layer']);

  it('has one named group per layer, bottom of the list first, in its colour', () => {
    fresh();
    d.layers[0].color = '#112233';
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const top = addLayer(d);
    top.name = 'Top <& "1"';
    top.color = '#ff0000';
    addLine(d, s, { x: 0, y: 5 }, { x: 10, y: 5 });
    const g = groups(exportSvg(d, [s]));
    expect(g.map((x) => x['data-layer'])).toEqual(['Layer 1', 'Top &lt;&amp; &quot;1&quot;']);
    expect(g.map((x) => x.stroke)).toEqual(['#112233', '#ff0000']);
    expect(g[1].id).toBe('layer-Top-1-');
    expect(new Set(g.map((x) => x.id)).size).toBe(2);
    const svg = exportSvg(d, [s]);
    expect(svg.indexOf('y1="0"')).toBeLessThan(svg.indexOf('y1="-5"'));
  });

  it('leaves hidden layers out altogether, and keeps locked ones', () => {
    fresh();
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const top = addLayer(d);
    addLine(d, s, { x: 0, y: 500 }, { x: 10, y: 500 });
    d.layers[1].locked = true;
    top.visible = false;
    const svg = exportSvg(d, [s]);
    expect(groups(svg).map((g) => g['data-layer'])).toEqual(['Layer 1']);
    expect(elements(svg, 'line')).toHaveLength(1);
    expect(elements(svg, 'svg')[0].height).toBe(`${2 * SVG_MARGIN}mm`);
  });
});
