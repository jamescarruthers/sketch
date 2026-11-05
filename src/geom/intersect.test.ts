import { beforeEach, describe, expect, it } from 'vitest';
import type { Curve, Design, Sketch } from '../model/types';
import {
  addArc, addCircle, addConic, addControlSpline, addEllipse, addEllipticalArc, addFitSpline, addLine, newDesign, newSketch,
} from '../model/document';
import { resolve } from './curves';
import { intersect, intersectCurves, selfIntersections } from './intersect';
import { dist } from './vec';

let d: Design;
let s: Sketch;
beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

/** Each hit must be on both curves. */
function check(a: Curve, b: Curve) {
  const hits = intersectCurves(s, a, b);
  const A = resolve(s, a);
  const B = resolve(s, b);
  for (const h of hits) {
    expect(dist(A.at(h.ta), h.p)).toBeLessThan(1e-5);
    expect(dist(B.at(h.tb), h.p)).toBeLessThan(1e-5);
  }
  return hits;
}

describe('intersect', () => {
  it('line-line, including endpoints and misses', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 10 });
    const b = addLine(d, s, { x: 0, y: 10 }, { x: 10, y: 0 });
    expect(check(a, b)[0].p).toEqual({ x: 5, y: 5 });
    const c = addLine(d, s, { x: 20, y: 0 }, { x: 20, y: 5 });
    expect(check(a, c).length).toBe(0);
    const t = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const touching = addLine(d, s, { x: 5, y: 0 }, { x: 5, y: 5 });
    expect(check(t, touching)[0]).toMatchObject({ ta: 0.5, tb: 0 });
  });
  it('extended lines report parameters beyond the segment', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 20, y: 5 }, { x: 20, y: 1 });
    expect(intersectCurves(s, a, b)).toEqual([]);
    const hits = intersectCurves(s, a, b, { extendA: true, extendB: true });
    expect(hits[0].ta).toBeCloseTo(2);
    expect(hits[0].tb).toBeCloseTo(1.25);
  });
  it('parallel lines do not intersect but overlaps report end touches', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const p = addLine(d, s, { x: 0, y: 1 }, { x: 10, y: 1 });
    expect(check(a, p)).toEqual([]);
    const over = addLine(d, s, { x: 5, y: 0 }, { x: 15, y: 0 });
    expect(check(a, over).map((h) => h.ta)).toEqual([0.5, 1]);
  });
  it('line-circle, secant and tangent', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    const l = addLine(d, s, { x: -10, y: 0 }, { x: 10, y: 0 });
    expect(check(c, l).length).toBe(2);
    const t = addLine(d, s, { x: -10, y: 5 }, { x: 10, y: 5 });
    const hits = check(c, t);
    expect(hits.length).toBe(1);
    expect(hits[0].tangent).toBe(true);
  });
  it('line-arc respects the arc span unless extended', () => {
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 });
    const l = addLine(d, s, { x: -10, y: -3 }, { x: 10, y: -3 });
    expect(check(l, a).length).toBe(0);
    const hits = intersectCurves(s, l, a, { extendB: true });
    expect(hits.length).toBe(2);
    for (const h of hits) expect(h.tb).toBeGreaterThan(1);
  });
  it('circle-circle, two points and internal tangency', () => {
    const a = addCircle(d, s, { x: 0, y: 0 }, 5);
    const b = addCircle(d, s, { x: 6, y: 0 }, 5);
    expect(check(a, b).length).toBe(2);
    const c = addCircle(d, s, { x: 3, y: 0 }, 2);
    const hits = check(a, c);
    expect(hits.length).toBe(1);
    expect(hits[0].tangent).toBe(true);
    expect(hits[0].p.x).toBeCloseTo(5);
  });
  it('arc-arc honours both spans', () => {
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: -5, y: 0 });
    const b = addArc(d, s, { x: 6, y: 0 }, { x: 11, y: 0 }, { x: 1, y: 0 });
    expect(check(a, b).length).toBe(1);
  });
  it('line-ellipse', () => {
    const e = addEllipse(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 });
    const l = addLine(d, s, { x: 0, y: -10 }, { x: 0, y: 10 });
    const hits = check(e, l);
    expect(hits.map((h) => Math.abs(h.p.y))).toEqual([3, 3]);
    const rot = addEllipse(d, s, { x: 1, y: 1 }, { x: 1 + 3, y: 1 + 3 }, { x: 1 - 1, y: 1 + 1 });
    expect(check(rot, l).length).toBe(2);
  });
  it('ellipse-circle and ellipse-ellipse', () => {
    const e = addEllipse(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 });
    const c = addCircle(d, s, { x: 0, y: 0 }, 4);
    expect(check(e, c).length).toBe(4);
    const f = addEllipse(d, s, { x: 0, y: 0 }, { x: 0, y: 5 }, { x: 3, y: 0 });
    expect(check(e, f).length).toBe(4);
  });
  it('elliptical arc is limited to its span', () => {
    const e = addEllipticalArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 }, { x: 5, y: 0 }, { x: 0, y: 3 });
    const l = addLine(d, s, { x: -10, y: 1 }, { x: 10, y: 1 });
    expect(check(e, l).length).toBe(1);
    const c = addCircle(d, s, { x: 0, y: 0 }, 4);
    expect(check(e, c).length).toBe(1);
  });
  it('spline with line, circle, spline and conic', () => {
    const f = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: -8 }, { x: 30, y: 0 }]);
    const l = addLine(d, s, { x: -5, y: 1 }, { x: 35, y: -1 });
    expect(check(f, l).length).toBe(3);
    const c = addCircle(d, s, { x: 15, y: 0 }, 6);
    expect(check(f, c).length).toBe(2);
    const g = addControlSpline(d, s, [{ x: 0, y: -5 }, { x: 8, y: 12 }, { x: 16, y: -14 }, { x: 24, y: 10 }, { x: 28, y: -4 }, { x: 31, y: 3 }]);
    expect(check(f, g).length).toBe(1);
    const con = addConic(d, s, { x: 2, y: -6 }, { x: 28, y: -6 }, { x: 15, y: 16 }, 0.5);
    expect(check(f, con).length).toBeGreaterThanOrEqual(2);
  });
  it('conic with line and arc', () => {
    const con = addConic(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }, 0.5);
    const l = addLine(d, s, { x: -1, y: 2 }, { x: 11, y: 2 });
    expect(check(con, l).length).toBe(2);
    const a = addArc(d, s, { x: 5, y: 0 }, { x: 8, y: 0 }, { x: 2, y: 0 });
    expect(check(con, a).length).toBe(0);
    const big = addArc(d, s, { x: 5, y: 0 }, { x: 9.8, y: 0 }, { x: 0.2, y: 0 });
    expect(check(con, big).length).toBe(4);
  });
  it('finds a tangent touch that never crosses', () => {
    const f = addFitSpline(d, s, [{ x: 0, y: 3 }, { x: 5, y: 0 }, { x: 10, y: 3 }]);
    const pc = resolve(s, f);
    let low = Infinity;
    for (let i = 0; i <= 1000; i++) low = Math.min(low, pc.at(i / 1000).y);
    const l = addLine(d, s, { x: -2, y: low }, { x: 12, y: low });
    const hits = check(f, l);
    expect(hits.length).toBe(1);
    expect(hits[0].tangent).toBe(true);
  });
  it('extends a line into a spline', () => {
    const f = addFitSpline(d, s, [{ x: 10, y: -5 }, { x: 12, y: 0 }, { x: 10, y: 5 }]);
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 5, y: 0 });
    expect(intersectCurves(s, l, f)).toEqual([]);
    const hits = intersectCurves(s, l, f, { extendA: true });
    expect(hits.length).toBe(1);
    expect(hits[0].ta).toBeCloseTo(2.4, 3);
  });
  it('finds self intersections', () => {
    const f = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 10, y: -5 }, { x: 0, y: 10 }]);
    const pc = resolve(s, f);
    const hits = selfIntersections(pc);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const h of hits) expect(dist(pc.at(h.t1), pc.at(h.t2))).toBeLessThan(1e-4);
    const clean = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    expect(selfIntersections(resolve(s, clean))).toEqual([]);
    expect(intersect(resolve(s, clean), resolve(s, addLine(d, s, { x: 100, y: 0 }, { x: 101, y: 0 })))).toEqual([]);
  });
});
