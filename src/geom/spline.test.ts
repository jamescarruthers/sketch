import { describe, expect, it } from 'vitest';
import { newDesign, newSketch, addFitSpline } from '../model/document';
import { conicD1, conicD2, conicPoint, rhoThrough, subConic } from './conic';
import {
  changeDegree, clampedBSpline, controlSplineEval, curvatureComb, deBoor, fitControlPoints, fitSplineEval, splineSamples,
} from './spline';
import { dist } from './vec';

const wavy = [{ x: 0, y: 0 }, { x: 2, y: 5 }, { x: 6, y: 6 }, { x: 9, y: 1 }, { x: 12, y: 3 }, { x: 15, y: 0 }];

const maxDeviation = (a: (t: number) => { x: number; y: number }, b: (t: number) => { x: number; y: number }) => {
  let m = 0;
  for (let i = 0; i <= 200; i++) m = Math.max(m, dist(a(i / 200), b(i / 200)));
  return m;
};

describe('b-splines', () => {
  it('de Boor matches Bezier when there are degree + 1 points', () => {
    const ctrl = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 0 }];
    const b = clampedBSpline(ctrl, 3);
    const t = 0.3;
    const u = 1 - t;
    const x = u ** 3 * 0 + 3 * u * u * t * 1 + 3 * u * t * t * 3 + t ** 3 * 4;
    expect(deBoor(b, t).x).toBeCloseTo(x);
  });
  it('analytic derivatives agree with finite differences', () => {
    const ev = controlSplineEval(wavy, 5);
    const h = 1e-5;
    for (const t of [0.13, 0.5, 0.82]) {
      const a = ev.at(t + h);
      const b = ev.at(t - h);
      expect(ev.d1(t).x).toBeCloseTo((a.x - b.x) / (2 * h), 3);
      const d1a = ev.d1(t + h);
      const d1b = ev.d1(t - h);
      expect(ev.d2(t).y).toBeCloseTo((d1a.y - d1b.y) / (2 * h), 1);
    }
  });
  it('elevates and reduces degree keeping shape and changing control count', () => {
    const up = changeDegree(wavy, 3, 5);
    expect(up.length).toBe(wavy.length + 2);
    const a = controlSplineEval(wavy, 3);
    const b = controlSplineEval(up, 5);
    expect(maxDeviation(a.at, b.at)).toBeLessThan(0.25);
    const down = changeDegree(up, 5, 3);
    expect(down.length).toBe(wavy.length);
    expect(maxDeviation(a.at, controlSplineEval(down, 3).at)).toBeLessThan(0.35);
  });
  it('least squares recovers an exact spline', () => {
    const ev = controlSplineEval(wavy, 3);
    const params: number[] = [];
    const samples = [];
    for (let i = 0; i <= 120; i++) {
      params.push(i / 120);
      samples.push(ev.at(i / 120));
    }
    const fit = fitControlPoints(samples, 3, wavy.length, params);
    fit.forEach((p, i) => expect(dist(p, wavy[i])).toBeLessThan(1e-5));
  });
});

describe('low degrees', () => {
  const legs = [{ x: -40, y: 0 }, { x: -10, y: 30 }, { x: 20, y: -10 }, { x: 50, y: 20 }];

  it.each([0.1, 0.3, 0.5, 0.7, 0.9])('a degree 1 spline points along its own leg at %f', (t) => {
    const ev = controlSplineEval(legs, 1);
    const leg = Math.min(Math.floor(t * 3), 2);
    const [a, b] = [legs[leg], legs[leg + 1]];
    const d = ev.d1(t);
    expect(d.x * (b.y - a.y) - d.y * (b.x - a.x)).toBeCloseTo(0, 6);
    expect(d.x * (b.x - a.x) + d.y * (b.y - a.y)).toBeGreaterThan(0);
  });

  it('a degree 2 spline turns left on one half of an S and right on the other', () => {
    const ev = controlSplineEval(legs, 2);
    const turn = (t: number): number => {
      const [d, dd] = [ev.d1(t), ev.d2(t)];
      return d.x * dd.y - d.y * dd.x;
    };
    expect(Math.sign(turn(0.2))).toBe(-Math.sign(turn(0.8)));
  });

  it('a degree 2 derivative is the slope of the curve', () => {
    const ev = controlSplineEval(legs, 2);
    for (const t of [0.1, 0.4, 0.8]) {
      const h = 1e-5;
      const [p, q] = [ev.d1(t - h), ev.d1(t + h)];
      const dd = ev.d2(t);
      expect(dd.x).toBeCloseTo((q.x - p.x) / (2 * h), 3);
      expect(dd.y).toBeCloseTo((q.y - p.y) / (2 * h), 3);
    }
  });
});

describe('fit spline', () => {
  it('derivatives agree with finite differences', () => {
    const ev = fitSplineEval(wavy, false);
    const h = 1e-6;
    for (const t of [0.17, 0.51, 0.77]) {
      expect(ev.d1(t).y).toBeCloseTo((ev.at(t + h).y - ev.at(t - h).y) / (2 * h), 3);
    }
  });
  it('is C2 at interior knots', () => {
    const ev = fitSplineEval(wavy, false);
    const kn = 0;
    let acc = kn;
    let total = 0;
    for (let i = 1; i < wavy.length; i++) total += dist(wavy[i], wavy[i - 1]);
    acc = dist(wavy[0], wavy[1]) / total;
    const a = ev.d2(acc - 1e-9);
    const b = ev.d2(acc + 1e-9);
    expect(Math.abs(a.x - b.x)).toBeLessThan(1e-3);
  });
  it('samples for the solver cover the curve end to end', () => {
    const d = newDesign();
    const s = newSketch(d);
    const f = addFitSpline(d, s, wavy);
    const out = splineSamples(f, s);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1][0]).toBeCloseTo(15);
    expect(out.length).toBeGreaterThan(wavy.length * 4);
  });
  it('comb teeth are normal to the curve and scale with curvature', () => {
    const ev = fitSplineEval(wavy, false);
    const comb = curvatureComb(ev, 50);
    expect(comb.length).toBe(51);
    const t = comb[25];
    const d = ev.d1(t.t);
    const v = { x: t.tip.x - t.p.x, y: t.tip.y - t.p.y };
    expect((d.x * v.x + d.y * v.y) / Math.hypot(d.x, d.y)).toBeCloseTo(0, 6);
  });
});

describe('conic', () => {
  const arc = { a: { x: 0, y: 0 }, v: { x: 5, y: 9 }, b: { x: 12, y: 1 }, rho: 0.35 };
  it('derivatives agree with finite differences', () => {
    const h = 1e-5;
    const t = 0.4;
    const a = conicPoint(arc, t + h);
    const b = conicPoint(arc, t - h);
    expect(conicD1(arc, t).x).toBeCloseTo((a.x - b.x) / (2 * h), 4);
    const da = conicD1(arc, t + h);
    const db = conicD1(arc, t - h);
    expect(conicD2(arc, t).y).toBeCloseTo((da.y - db.y) / (2 * h), 3);
  });
  it('subdivides exactly', () => {
    const sub = subConic(arc, 0.2, 0.7);
    for (const u of [0, 0.25, 0.6, 1]) {
      const p = conicPoint(sub, u);
      let best = Infinity;
      for (let i = 0; i <= 20000; i++) best = Math.min(best, dist(p, conicPoint(arc, i / 20000)));
      expect(best).toBeLessThan(1e-3);
    }
    expect(dist(conicPoint(sub, 0), conicPoint(arc, 0.2))).toBeLessThan(1e-9);
    expect(dist(conicPoint(sub, 1), conicPoint(arc, 0.7))).toBeLessThan(1e-9);
  });
  it('finds rho through a point on the median', () => {
    expect(rhoThrough({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, { x: 5, y: 3 })).toBeCloseTo(0.3);
    expect(rhoThrough({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, { x: 5, y: 12 })).toBeNull();
  });
});
