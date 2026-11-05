import { beforeEach, describe, expect, it } from 'vitest';
import type { Design, Sketch } from '../model/types';
import {
  addArc, addCircle, addConic, addControlSpline, addEllipse, addEllipticalArc, addFitSpline, addFrameText, addLine,
  newDesign, newSketch, setFitHandle,
} from '../model/document';
import {
  arcCurve, boundingBox, closestPoint, curvature, curveLength, evaluate, flatten, lengthOf, resolve, reversed, tangent,
} from './curves';
import { dist } from './vec';

let d: Design;
let s: Sketch;
beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

describe('curves', () => {
  it('evaluates a line', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(evaluate(s, l, 0.5)).toEqual({ x: 5, y: 0 });
    expect(tangent(s, l, 0.1)).toEqual({ x: 1, y: 0 });
    expect(curveLength(s, l)).toBe(10);
    expect(curvature(s, l, 0.3)).toBe(0);
  });
  it('treats arcs as counter-clockwise a to b', () => {
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 });
    const m = evaluate(s, a, 0.5);
    expect(m.x).toBeCloseTo(5 * Math.SQRT1_2);
    expect(m.y).toBeCloseTo(5 * Math.SQRT1_2);
    expect(curveLength(s, a)).toBeCloseTo((Math.PI / 2) * 5);
    expect(curvature(s, a, 0.2)).toBeCloseTo(0.2);
    const wide = addArc(d, s, { x: 0, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 0 });
    expect(curveLength(s, wide)).toBeCloseTo((3 * Math.PI / 2) * 5);
    expect(evaluate(s, wide, 0.5).x).toBeCloseTo(-5 * Math.SQRT1_2);
  });
  it('has the right circle box and an arc box through a quadrant', () => {
    const c = addCircle(d, s, { x: 1, y: 2 }, 3);
    expect(boundingBox(s, c)).toEqual({ minX: -2, minY: -1, maxX: 4, maxY: 5 });
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 1, y: -1 }, { x: 1, y: 1 });
    const b = boundingBox(s, a);
    expect(b.maxX).toBeCloseTo(Math.SQRT2);
    expect(b.minX).toBeCloseTo(1);
  });
  it('computes ellipse length close to Ramanujan and stays CCW with a swapped minor', () => {
    const e = addEllipse(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 });
    const h = ((5 - 3) / (5 + 3)) ** 2;
    const ramanujan = Math.PI * (5 + 3) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    expect(curveLength(s, e)).toBeCloseTo(ramanujan, 3);
    const flipped = addEllipse(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: -3 });
    expect(evaluate(s, flipped, 0.25).y).toBeCloseTo(3);
  });
  it('resolves an elliptical arc from its end points', () => {
    const e = addEllipticalArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 }, { x: 5, y: 0 }, { x: 0, y: 3 });
    const m = evaluate(s, e, 0.5);
    expect(m.x).toBeCloseTo(5 * Math.SQRT1_2);
    expect(m.y).toBeCloseTo(3 * Math.SQRT1_2);
  });
  it('flattens within tolerance', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 50);
    const pts = flatten(s, c, 0.01);
    for (let i = 0; i + 1 < pts.length; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      expect(50 - Math.hypot(mx, my)).toBeLessThan(0.0101);
    }
  });
  it('flattened spline length approximates true length', () => {
    const f = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: -3 }, { x: 30, y: 2 }]);
    const pts = flatten(s, f, 0.001);
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) total += dist(pts[i], pts[i + 1]);
    expect(total).toBeCloseTo(curveLength(s, f), 2);
  });
  it('finds closest points on each type', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(closestPoint(s, l, { x: 3, y: 4 })).toMatchObject({ t: 0.3, dist: 4 });
    expect(closestPoint(s, l, { x: -3, y: 4 }).t).toBe(0);
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 });
    expect(closestPoint(s, a, { x: -5, y: -1 }).p.x).toBeCloseTo(0);
    const e = addEllipse(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 });
    const hit = closestPoint(s, e, { x: 0, y: 10 });
    expect(hit.p.y).toBeCloseTo(3);
    expect(hit.dist).toBeCloseTo(7);
  });
  it('reverses without changing the point set', () => {
    for (const curve of [
      addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 2 }),
      addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }),
      addConic(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }, 0.4),
      addControlSpline(d, s, [{ x: 0, y: 0 }, { x: 2, y: 5 }, { x: 5, y: 6 }, { x: 9, y: 1 }, { x: 11, y: 3 }, { x: 13, y: 0 }]),
    ]) {
      const pc = resolve(s, curve);
      const r = reversed(pc);
      for (const t of [0, 0.3, 1]) expect(dist(pc.at(t), r.at(1 - t))).toBeLessThan(1e-9);
      expect(r.d1(0.25).x).toBeCloseTo(-pc.d1(0.75).x, 6);
    }
  });
  it('gives a text frame its outline', () => {
    const t = addFrameText(d, s, 'A', 5, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }]);
    expect(curveLength(s, t)).toBeCloseTo(30);
    expect(evaluate(s, t, 0.125)).toEqual({ x: 5, y: 0 });
    expect(boundingBox(s, t)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 });
  });
  it('analytic arc length matches integration', () => {
    const pc = arcCurve({ x: 0, y: 0 }, 5, 0.2, 1.3);
    expect(lengthOf(pc)).toBeCloseTo(6.5);
  });
});

describe('splines', () => {
  it('interpolates fit points with natural ends', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 5 }];
    const f = addFitSpline(d, s, pts);
    const pc = resolve(s, f);
    expect(dist(pc.at(0), pts[0])).toBeLessThan(1e-9);
    expect(dist(pc.at(1), pts[3])).toBeLessThan(1e-9);
    const c = pc.d2(0);
    expect(Math.hypot(c.x, c.y)).toBeLessThan(1e-6);
    let hits = 0;
    for (const p of pts) if (closestPoint(s, f, p).dist < 1e-6) hits++;
    expect(hits).toBe(4);
  });
  it('closed fit spline is periodic', () => {
    const f = addFitSpline(d, s, [{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }, { x: 0, y: -10 }, { x: 8, y: -8 }], true);
    const pc = resolve(s, f);
    expect(pc.closed).toBe(true);
    expect(dist(pc.at(0), pc.at(1))).toBeLessThan(1e-9);
    const a = pc.d1(1e-7);
    const b = pc.d1(1 - 1e-7);
    expect(Math.abs(a.x - b.x)).toBeLessThan(1e-3);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1e-3);
  });
  it('honours an active handle', () => {
    const f = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    setFitHandle(d, s, f, 0, { x: 0, y: 5 });
    const t = tangent(s, f, 0);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(1);
  });
  it('closest point on spline recovers a sampled point', () => {
    const f = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: -3 }, { x: 30, y: 2 }]);
    const pc = resolve(s, f);
    for (const t of [0.1, 0.37, 0.62, 0.9]) {
      const p = pc.at(t);
      const n = pc.d1(t);
      const q = { x: p.x - n.y * 1e-3, y: p.y + n.x * 1e-3 };
      const hit = closestPoint(s, f, q);
      expect(Math.abs(hit.t - t)).toBeLessThan(1e-3);
      expect(hit.dist).toBeCloseTo(dist(p, q), 3);
    }
  });
  it('control spline clamps to its ends and stays in the hull', () => {
    const ctrl = [{ x: 0, y: 0 }, { x: 2, y: 6 }, { x: 6, y: 6 }, { x: 8, y: 0 }];
    const c = addControlSpline(d, s, ctrl, 3);
    expect(dist(evaluate(s, c, 0), ctrl[0])).toBeLessThan(1e-12);
    expect(dist(evaluate(s, c, 1), ctrl[3])).toBeLessThan(1e-12);
    expect(evaluate(s, c, 0.5).y).toBeCloseTo(4.5);
    const pc = resolve(s, c);
    const t = pc.d1(0);
    expect(t.y / t.x).toBeCloseTo(3);
  });
  it('conic rho 0.5 is a parabola with its apex halfway to the vertex', () => {
    const c = addConic(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }, 0.5);
    expect(evaluate(s, c, 0.5).y).toBeCloseTo(5);
    const tight = addConic(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }, 0.8);
    expect(evaluate(s, tight, 0.5).y).toBeCloseTo(8);
  });
});
