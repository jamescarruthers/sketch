import { describe, expect, it } from 'vitest';
import type { Id, Sketch, Vec2 } from '../model/types';
import { AXIS_X, ORIGIN } from '../model/types';
import {
  addArc, addCircle, addControlSpline, addConic, addEllipse, addEllipticalArc, addFitSpline, addFrameText, addLine,
  addPoint, newDesign, newSketch,
} from '../model/document';
import { arcCurve, closestOnParam, ellipseCurve, lineCurve, polylineCurve, resolve, type ParamCurve } from './curves';
import type { ConicArc } from './conic';
import { conicD1, conicD2, conicPoint } from './conic';
import { controlSplineEval, fitSplineEval, type SplineEval } from './spline';
import { minDistance, minDistanceBetween, pointCurve, shapeKey } from './min-distance';
import { dist, TAU, v } from './vec';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Builders. Each takes a scale so the same hand-worked case runs at 1e-4, 1 and 1e6.

const fromEval = (ev: SplineEval): ParamCurve => ({
  shape: { kind: 'spline', spans: ev.spans, breaks: ev.breaks }, closed: ev.closed, at: ev.at, d1: ev.d1, d2: ev.d2,
});

const fromConic = (arc: ConicArc): ParamCurve => ({
  shape: { kind: 'conic', arc }, closed: false,
  at: (t) => conicPoint(arc, t), d1: (t) => conicD1(arc, t), d2: (t) => conicD2(arc, t),
});

type Pt = [number, number];

function kit(k: number) {
  const p = ([x, y]: Pt): Vec2 => v(x * k, y * k);
  return {
    P: (x: number, y: number) => pointCurve(p([x, y])),
    L: (ax: number, ay: number, bx: number, by: number) => lineCurve(p([ax, ay]), p([bx, by])),
    C: (x: number, y: number, r: number) => arcCurve(p([x, y]), r * k, 0, TAU),
    /** Counter-clockwise from `from` to `to`, degrees. */
    ARC: (x: number, y: number, r: number, from: number, to: number) => arcCurve(p([x, y]), r * k, from * DEG, (to - from) * DEG),
    ELL: (x: number, y: number, rx: number, ry: number, rot = 0) => ellipseCurve(p([x, y]), rx * k, ry * k, rot * DEG, 0, TAU),
    /** Signed sweep in degrees: negative is clockwise. */
    ARCW: (x: number, y: number, r: number, from: number, sweep: number) => arcCurve(p([x, y]), r * k, from * DEG, sweep * DEG),
    EARC: (x: number, y: number, rx: number, ry: number, rot: number, from: number, to: number) =>
      ellipseCurve(p([x, y]), rx * k, ry * k, rot * DEG, from * DEG, (to - from) * DEG),
    FIT: (pts: Pt[], closed = false) => fromEval(fitSplineEval(pts.map(p), closed)),
    // As the sketch level does: degree 1 is a polyline, which has the tangent splineEval cannot give it.
    CTRL: (pts: Pt[], degree: number) => (degree <= 1 ? polylineCurve(pts.map(p), false) : fromEval(controlSplineEval(pts.map(p), degree))),
    CONIC: (a: Pt, vertex: Pt, b: Pt, rho: number) => fromConic({ a: p(a), v: p(vertex), b: p(b), rho }),
  };
}
type Kit = ReturnType<typeof kit>;

interface Case { name: string; make: (t: Kit) => [ParamCurve, ParamCurve]; want: number }
const c = (name: string, want: number, make: (t: Kit) => [ParamCurve, ParamCurve]): Case => ({ name, make, want });

const SCALES = [1e-4, 1, 1e6];

/** Run a case at every scale and in both orders; the distance is relative to the scale. */
function check(cases: Case[], tol: number): void {
  for (const k of SCALES) {
    for (const t of cases) {
      it(`${t.name} (x${k})`, () => {
        const [a, b] = t.make(kit(k));
        for (const [x, y] of [[a, b], [b, a]]) {
          const r = minDistance(x, y);
          expect(Math.abs(r.distance - t.want * k)).toBeLessThanOrEqual(tol * k);
          // The witnesses are real: they are exactly that far apart, and on the curves where that can be checked.
          expect(Math.abs(dist(r.a, r.b) - r.distance)).toBeLessThanOrEqual(tol * k);
          for (const [pt, pc] of [[r.a, x], [r.b, y]] as [Vec2, ParamCurve][]) {
            const s = pc.shape.kind;
            if (s === 'line' || s === 'arc') expect(closestOnParam(pc, pt).dist).toBeLessThanOrEqual((tol + 1e-9) * k);
          }
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Closed forms, worked by hand.

// The first-quadrant arc of radius 10 about the origin is used for the sweep traps.
const closed: Case[] = [
  c('point to point', 5, (t) => [t.P(0, 0), t.P(3, 4)]),
  c('the same point twice', 0, (t) => [t.P(2, 3), t.P(2, 3)]),

  c('point beside a line', 3, (t) => [t.P(0, 3), t.L(-5, 0, 5, 0)]),
  c('point past the end of a line, not the extended line', 5, (t) => [t.P(8, 4), t.L(-5, 0, 5, 0)]),
  c('point on a line', 0, (t) => [t.P(2, 0), t.L(-5, 0, 5, 0)]),
  c('point and a zero-length line', 5, (t) => [t.P(3, 4), t.L(0, 0, 0, 0)]),

  c('point outside a circle', 6, (t) => [t.P(10, 0), t.C(0, 0, 4)]),
  c('point inside a circle', 4, (t) => [t.P(1, 0), t.C(0, 0, 5)]),
  c('point at the centre of a circle', 5, (t) => [t.P(0, 0), t.C(0, 0, 5)]),
  c('point on a circle', 0, (t) => [t.P(3, 4), t.C(0, 0, 5)]),
  c('point and a circle of no radius', 5, (t) => [t.P(3, 4), t.C(0, 0, 0)]),

  c('point over the sweep of an arc', Math.abs(Math.hypot(6, 6) - 10), (t) => [t.P(6, 6), t.ARC(0, 0, 10, 0, 90)]),
  c('point where the full circle is on the far half: the end point wins', Math.hypot(10, 10), (t) => [t.P(-10, 0), t.ARC(0, 0, 10, 0, 90)]),
  c('point below an arc nearer one end', Math.hypot(10, 20), (t) => [t.P(0, -20), t.ARC(0, 0, 10, 0, 90)]),
  c('point at the centre of an arc', 10, (t) => [t.P(0, 0), t.ARC(0, 0, 10, 0, 90)]),
  c('point and an arc over the 0 degree line', 10, (t) => [t.P(20, 0), t.ARC(0, 0, 10, -45, 45)]),
  c('point behind an arc over the 0 degree line', Math.hypot(10 + 10 * Math.cos(45 * DEG), 10 * Math.sin(45 * DEG)),
    (t) => [t.P(-10, 0), t.ARC(0, 0, 10, -45, 45)]),

  c('crossing lines', 0, (t) => [t.L(-1, -1, 1, 1), t.L(-1, 1, 1, -1)]),
  c('a line ending on another', 0, (t) => [t.L(0, 0, 10, 0), t.L(5, 0, 5, 5)]),
  c('parallel lines', 3, (t) => [t.L(0, 0, 10, 0), t.L(0, 3, 10, 3)]),
  c('collinear with a gap', 3, (t) => [t.L(0, 0, 1, 0), t.L(4, 0, 6, 0)]),
  c('collinear overlapping', 0, (t) => [t.L(0, 0, 5, 0), t.L(4, 0, 6, 0)]),
  c('a line that stops short of the other, whose extension it would cross', 4, (t) => [t.L(0, 0, 1, 0), t.L(5, -3, 5, 3)]),
  c('a near miss at 10,10', 0.5, (t) => [t.L(0, 0, 10, 10), t.L(10.5, 0, 10.5, 20)]),
  c('skew, end to end', Math.hypot(2, 2), (t) => [t.L(0, 0, 4, 0), t.L(6, 2, 6, 10)]),
  c('two zero-length lines', 5, (t) => [t.L(0, 0, 0, 0), t.L(3, 4, 3, 4)]),
  c('a zero-length line and a line', 3, (t) => [t.L(0, 0, 0, 0), t.L(-5, 3, 5, 3)]),

  c('line inside a circle: the gap to the rim', 4, (t) => [t.L(-1, 0, 1, 0), t.C(0, 0, 5)]),
  c('off-centre line inside a circle: the far end sets it', 5 - Math.sqrt(5), (t) => [t.L(1, -2, 1, 2), t.C(0, 0, 5)]),
  c('line crossing a circle', 0, (t) => [t.L(-10, 1, 10, 1), t.C(0, 0, 5)]),
  c('line tangent to a circle', 0, (t) => [t.L(-5, 5, 5, 5), t.C(0, 0, 5)]),
  c('line clear of a circle', 3, (t) => [t.L(-5, 8, 5, 8), t.C(0, 0, 5)]),
  c('line that stops short of a circle, along the same axis', 7, (t) => [t.L(10, 0, 20, 0), t.C(0, 0, 3)]),
  c('line ending short of a circle, whose extension would enter it', 2, (t) => [t.L(5, 0, 8, 0), t.C(0, 0, 3)]),
  c('line ending on a circle', 0, (t) => [t.L(5, 0, 9, 0), t.C(0, 0, 5)]),
  c('zero-length line and a circle', 3, (t) => [t.L(8, 0, 8, 0), t.C(0, 0, 5)]),

  c('line crossing the full circle where the arc is not: end points', Math.sqrt(164), (t) => [t.L(-12, 0, -8, 0), t.ARC(0, 0, 10, 0, 90)]),
  c('line above an arc: the normal from the centre is on the sweep', 5, (t) => [t.L(-20, 15, 20, 15), t.ARC(0, 0, 10, 30, 150)]),
  c('line above an arc: the normal is off the sweep, the end point wins', 15 - 10 * Math.sin(45 * DEG), (t) => [t.L(-20, 15, 20, 15), t.ARC(0, 0, 10, 0, 45)]),
  c('line crossing the sweep', 0, (t) => [t.L(0, 5, 20, 5), t.ARC(0, 0, 10, 0, 90)]),
  c('line inside the circle, on the side with no arc', Math.sqrt(104), (t) => [t.L(-6, 0, -2, 0), t.ARC(0, 0, 10, 0, 90)]),
  c('line tangent to an arc inside its sweep', 0, (t) => [t.L(-20, 10, 20, 10), t.ARC(0, 0, 10, 30, 150)]),
  c('short line over the arc end', 2, (t) => [t.L(0, 12, 3, 12), t.ARC(0, 0, 10, 0, 90)]),
  c('line against an arc over the 0 degree line', 3, (t) => [t.L(13, -5, 13, 5), t.ARC(0, 0, 10, -45, 45)]),
  c('line against a clockwise arc', 2, (t) => [t.L(0, 12, 3, 12), t.ARCW(0, 0, 10, 90, -90)]),

  c('concentric circles: the difference of radii', 2, (t) => [t.C(0, 0, 3), t.C(0, 0, 5)]),
  c('circles apart', 5, (t) => [t.C(0, 0, 2), t.C(10, 0, 3)]),
  c('one circle inside another', 5, (t) => [t.C(0, 0, 10), t.C(3, 0, 2)]),
  c('crossing circles', 0, (t) => [t.C(0, 0, 5), t.C(6, 0, 5)]),
  c('circles touching outside', 0, (t) => [t.C(0, 0, 3), t.C(7, 0, 4)]),
  c('circles touching inside', 0, (t) => [t.C(0, 0, 5), t.C(2, 0, 3)]),
  c('the same circle', 0, (t) => [t.C(1, 2, 5), t.C(1, 2, 5)]),

  c('concentric arcs that share an angle', 2, (t) => [t.ARC(0, 0, 3, 0, 90), t.ARC(0, 0, 5, 45, 135)]),
  c('concentric arcs that do not', Math.sqrt(19), (t) => [t.ARC(0, 0, 3, 0, 30), t.ARC(0, 0, 5, 90, 120)]),
  c('arcs whose circles cross on both sweeps', 0, (t) => [t.ARC(0, 0, 5, 0, 90), t.ARC(8, 0, 5, 90, 270)]),
  c('arcs whose circles cross off the sweeps: end to end', 2, (t) => [t.ARC(0, 0, 5, 0, 90), t.ARC(8, 0, 5, 180, 270)]),
  c('arcs facing along the line of centres', 3, (t) => [t.ARC(0, 0, 5, -45, 45), t.ARC(12, 0, 4, 135, 225)]),
  c('arcs whose line of centres misses the sweeps: end points', Math.sqrt(57), (t) => [t.ARC(0, 0, 5, 60, 120), t.ARC(12, 0, 4, 60, 120)]),
  c('circle and arc inside: the arc reaches the rim side', 5, (t) => [t.C(0, 0, 10), t.ARC(3, 0, 2, 0, 90)]),
  c('circle and arc inside: the arc on the near side', 10 - Math.sqrt(13), (t) => [t.C(0, 0, 10), t.ARC(3, 0, 2, 180, 270)]),
  c('the same arc', 0, (t) => [t.ARC(0, 0, 5, 20, 100), t.ARC(0, 0, 5, 20, 100)]),
  c('arcs of one circle that do not overlap', 2 * 5 * Math.sin(10 * DEG), (t) => [t.ARC(0, 0, 5, 0, 40), t.ARC(0, 0, 5, 60, 90)]),
];

describe('min distance, closed forms', () => {
  check(closed, 1e-9);
});

// ---------------------------------------------------------------------------
// Ellipses, splines and conics, with answers from geometry.

const h = Math.sqrt(9 * (1 - 1 / 16));
const numeric: Case[] = [
  c('point at the centre of an ellipse', 3, (t) => [t.P(0, 0), t.ELL(0, 0, 5, 3)]),
  c('point beyond a major vertex', 5, (t) => [t.P(10, 0), t.ELL(0, 0, 5, 3)]),
  c('point above the minor vertex', 2, (t) => [t.P(0, 5), t.ELL(0, 0, 5, 3)]),
  c('point just inside the minor vertex', 2, (t) => [t.P(0, 1), t.ELL(0, 0, 5, 3)]),
  c('point near the major vertex, inside', 1, (t) => [t.P(4, 0), t.ELL(0, 0, 5, 3)]),
  c('point on the major axis inside the evolute: two nearest points', h, (t) => [t.P(1, 0), t.ELL(0, 0, 5, 3)]),
  c('point on an ellipse', 0, (t) => [t.P(0, 3), t.ELL(0, 0, 5, 3)]),
  c('the same point, ellipse turned and moved', h, (t) => {
    const a = 30 * DEG;
    const at = (x: number, y: number): Pt => [7 + x * Math.cos(a) - y * Math.sin(a), -3 + x * Math.sin(a) + y * Math.cos(a)];
    return [t.P(...at(1, 0)), t.ELL(7, -3, 5, 3, 30)];
  }),
  c('point and the quarter of an ellipse it is not near', Math.hypot(5.5, 3), (t) => [t.P(5.5, 0), t.EARC(0, 0, 5, 3, 0, 90, 180)]),

  c('line clear of an ellipse', 2, (t) => [t.L(-10, 5, 10, 5), t.ELL(0, 0, 5, 3)]),
  c('line tangent to an ellipse', 0, (t) => [t.L(-10, 3, 10, 3), t.ELL(0, 0, 5, 3)]),
  c('line through an ellipse', 0, (t) => [t.L(-10, 0, 10, 0), t.ELL(0, 0, 5, 3)]),
  c('line that stops short of an ellipse', 3, (t) => [t.L(8, 0, 12, 0), t.ELL(0, 0, 5, 3)]),
  c('slanted line clear of an ellipse: the support function', 6 - Math.sqrt(17), (t) => {
    const f = 6 / Math.SQRT2;
    const d = 20 / Math.SQRT2;
    return [t.L(f + d, f - d, f - d, f + d), t.ELL(0, 0, 5, 3)];
  }),
  c('line inside an ellipse: nearest at its ends', h, (t) => [t.L(-1, 0, 1, 0), t.ELL(0, 0, 5, 3)]),
  c('line crossing the full ellipse but not the arc drawn', 2, (t) => [t.L(-2, -5, -2, 5), t.EARC(0, 0, 5, 3, 0, 0, 90)]),

  c('circle inside an ellipse, concentric', 2, (t) => [t.C(0, 0, 1), t.ELL(0, 0, 5, 3)]),
  c('circle round an ellipse, concentric', 3, (t) => [t.C(0, 0, 8), t.ELL(0, 0, 5, 3)]),
  c('circle clear of an ellipse', 3, (t) => [t.C(10, 0, 2), t.ELL(0, 0, 5, 3)]),
  c('circle crossing an ellipse', 0, (t) => [t.C(0, 0, 4), t.ELL(0, 0, 5, 3)]),
  c('ellipses side by side', 2, (t) => [t.ELL(0, 0, 5, 3), t.ELL(12, 0, 5, 3)]),
  c('ellipses, one turned a quarter', 2, (t) => [t.ELL(0, 0, 5, 3), t.ELL(0, 10, 5, 3, 90)]),
  c('the same ellipse', 0, (t) => [t.ELL(0, 0, 5, 3, 20), t.ELL(0, 0, 5, 3, 20)]),

  c('control spline (a parabola) and a point above it', 3, (t) => [t.P(5, 8), t.CTRL([[0, 0], [5, 10], [10, 0]], 2)]),
  c('control spline and a line over it', 2, (t) => [t.L(-5, 7, 15, 7), t.CTRL([[0, 0], [5, 10], [10, 0]], 2)]),
  c('control spline whose end lies on a line', 0, (t) => [t.L(-5, 0, 15, 0), t.CTRL([[0, 0], [5, 10], [10, 0]], 2)]),
  c('conic as the same parabola', 3, (t) => [t.P(5, 8), t.CONIC([0, 0], [5, 10], [10, 0], 0.5)]),
  c('conic that is a quarter circle, from its centre', 10, (t) => [t.P(0, 0), t.CONIC([10, 0], [10, 10], [0, 10], Math.SQRT2 - 1)]),
  c('conic that is a quarter circle, from outside', Math.hypot(20, 20) - 10, (t) => [t.P(20, 20), t.CONIC([10, 0], [10, 10], [0, 10], Math.SQRT2 - 1)]),
  c('conic and a line it stops short of', 2, (t) => [t.L(12, -5, 12, 15), t.CONIC([10, 0], [10, 10], [0, 10], Math.SQRT2 - 1)]),
  c('conic quarter circle and a circle about the same centre', 4, (t) => [t.C(0, 0, 6), t.CONIC([10, 0], [10, 10], [0, 10], Math.SQRT2 - 1)]),
  c('straight fit spline and a point', 3, (t) => [t.P(5, 3), t.FIT([[0, 0], [5, 0], [10, 0]])]),
  c('straight fit splines, parallel', 3, (t) => [t.FIT([[0, 0], [5, 0], [10, 0]]), t.FIT([[0, 3], [5, 3], [10, 3]])]),
  c('straight fit splines, crossing', 0, (t) => [t.FIT([[0, 0], [5, 5], [10, 10]]), t.FIT([[0, 10], [5, 5], [10, 0]])]),
  c('fit spline and a circle round it', 6 - 5, (t) => [t.C(5, 0, 6), t.FIT([[0, 0], [5, 0], [10, 0]])]),
  c('control spline of degree 1 against a point at a corner', Math.hypot(3, 4), (t) => [t.P(-3, -4), t.CTRL([[0, 0], [10, 0], [10, 10]], 1)]),
  c('a spline with no extent', 5, (t) => [t.P(3, 4), t.CTRL([[0, 0], [0, 0]], 3)]),
];

describe('min distance, ellipses, splines and conics', () => {
  check(numeric, 1e-8);
});

// ---------------------------------------------------------------------------
// Against brute force. For each of 400 samples of the first curve, the least distance to 1500 samples of the
// second, polished by golden section; then the same again over the first curve's parameter around its best
// few. It shares no method with the code under test: no derivatives, no Newton, no start from a sample pair.

function golden(f: (x: number) => number, lo: number, hi: number): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 80; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return Math.min(fc, fd);
}

/** Local minima of a sampled function, least first, wrapping at the ends when the curve is closed. */
function lows(values: number[], closed: boolean, keep: number): number[] {
  const n = values.length;
  const at = (i: number): number => (closed ? values[(i + n) % n] : i < 0 || i >= n ? Infinity : values[i]);
  const found: number[] = [];
  for (let i = 0; i < n; i++) if (values[i] <= at(i - 1) && values[i] <= at(i + 1)) found.push(i);
  return found.sort((p, q) => values[p] - values[q]).slice(0, keep);
}

function oracle(A: ParamCurve, B: ParamCurve, n = 300, m = 800, keep = 12): number {
  const isPt = (pc: ParamCurve): boolean => pc.shape.kind === 'polyline' && pc.shape.pts.length < 2;
  const bt = isPt(B) ? [0] : Array.from({ length: B.closed ? m : m + 1 }, (_, i) => i / m);
  const bp = bt.map((t) => B.at(t));
  const clampB = (t: number): number => (B.closed ? t : Math.min(1, Math.max(0, t)));
  const inner = (s: number): number => {
    const p = A.at(s);
    const row = bp.map((q) => dist(p, q));
    if (bt.length === 1) return row[0];
    let best = Infinity;
    for (const i of lows(row, B.closed, 3)) best = Math.min(best, golden((t) => dist(p, B.at(clampB(t))), bt[i] - 1 / m, bt[i] + 1 / m));
    return best;
  };
  if (isPt(A)) return inner(0);
  const at = Array.from({ length: A.closed ? n : n + 1 }, (_, i) => i / n);
  const g = at.map(inner);
  let best = Infinity;
  for (const i of lows(g, A.closed, keep)) best = Math.min(best, golden((s) => inner(A.closed ? s : Math.min(1, Math.max(0, s))), at[i] - 1 / n, at[i] + 1 / n));
  return best;
}

/** Small seeded generator, so a failure names a trial that can be rerun. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOL = 1e-6;

function against(name: string, trials: number, seed: number, make: (r: () => number, t: Kit) => [ParamCurve, ParamCurve]): void {
  it(`${name}: ${trials} random pairs agree with brute force to 1e-6`, () => {
    const r = rng(seed);
    const t = kit(1);
    let worst = 0;
    for (let i = 0; i < trials; i++) {
      const [a, b] = make(r, t);
      const hit = minDistance(a, b);
      const got = hit.distance;
      const want = oracle(a, b);
      // The oracle is a set of real points, so it can only be above the truth: the answer must not be above it.
      expect(got, `trial ${i} (seed ${seed})`).toBeLessThanOrEqual(want + 1e-9);
      // Below it is allowed only for a pair of points really on the two curves, which is what a crossing the
      // oracle stepped over looks like; it is not allowed for a gap measured to a circle's missing half.
      if (want - got > TOL) {
        expect(closestOnParam(a, hit.a).dist, `trial ${i} (seed ${seed}): a is on the curve`).toBeLessThanOrEqual(1e-7);
        expect(closestOnParam(b, hit.b).dist, `trial ${i} (seed ${seed}): b is on the curve`).toBeLessThanOrEqual(1e-7);
      }
      worst = Math.max(worst, got - want);
    }
    expect(worst).toBeLessThanOrEqual(TOL);
  }, 120_000);
}

const rr = (r: () => number, lo: number, hi: number): number => lo + (hi - lo) * r();
const randPts = (r: () => number, n: number, size = 20): Pt[] => Array.from({ length: n }, () => [rr(r, -size, size), rr(r, -size, size)] as Pt);

describe('min distance against brute force', () => {
  against('ellipse and line', 40, 11, (r, t) => [
    t.ELL(rr(r, -5, 5), rr(r, -5, 5), rr(r, 1, 9), rr(r, 0.4, 5), rr(r, 0, 180)),
    t.L(rr(r, -15, 15), rr(r, -15, 15), rr(r, -15, 15), rr(r, -15, 15)),
  ]);
  against('elliptical arc and line', 30, 12, (r, t) => {
    const from = rr(r, 0, 300);
    return [
      t.EARC(rr(r, -5, 5), rr(r, -5, 5), rr(r, 1, 9), rr(r, 0.4, 5), rr(r, 0, 180), from, from + rr(r, 20, 160)),
      t.L(rr(r, -15, 15), rr(r, -15, 15), rr(r, -15, 15), rr(r, -15, 15)),
    ];
  });
  against('ellipse and ellipse', 25, 13, (r, t) => [
    t.ELL(rr(r, -6, 6), rr(r, -6, 6), rr(r, 1, 9), rr(r, 0.4, 5), rr(r, 0, 180)),
    t.ELL(rr(r, -6, 6), rr(r, -6, 6), rr(r, 1, 9), rr(r, 0.4, 5), rr(r, 0, 180)),
  ]);
  against('ellipse and circle', 20, 14, (r, t) => [
    t.ELL(rr(r, -6, 6), rr(r, -6, 6), rr(r, 1, 9), rr(r, 0.4, 5), rr(r, 0, 180)),
    t.C(rr(r, -12, 12), rr(r, -12, 12), rr(r, 0.5, 6)),
  ]);
  against('point and ellipse', 30, 15, (r, t) => [
    t.P(rr(r, -12, 12), rr(r, -12, 12)),
    t.ELL(rr(r, -5, 5), rr(r, -5, 5), rr(r, 1, 9), rr(r, 0.2, 5), rr(r, 0, 180)),
  ]);
  against('fit spline and fit spline', 40, 16, (r, t) => [t.FIT(randPts(r, 3 + Math.floor(r() * 5))), t.FIT(randPts(r, 3 + Math.floor(r() * 5)))]);
  against('closed fit spline and line', 20, 17, (r, t) => [
    t.FIT(randPts(r, 4 + Math.floor(r() * 4), 10), true),
    t.L(rr(r, -25, 25), rr(r, -25, 25), rr(r, -25, 25), rr(r, -25, 25)),
  ]);
  against('closed fit spline and circle', 20, 18, (r, t) => [
    t.FIT(randPts(r, 4 + Math.floor(r() * 4), 10), true),
    t.C(rr(r, -15, 15), rr(r, -15, 15), rr(r, 1, 8)),
  ]);
  against('control spline and ellipse', 30, 19, (r, t) => [
    t.CTRL(randPts(r, 4 + Math.floor(r() * 4)), 1 + Math.floor(r() * 5)),
    t.ELL(rr(r, -6, 6), rr(r, -6, 6), rr(r, 1, 9), rr(r, 0.4, 5), rr(r, 0, 180)),
  ]);
  against('control spline and control spline', 30, 20, (r, t) => [
    t.CTRL(randPts(r, 4 + Math.floor(r() * 4)), 1 + Math.floor(r() * 5)),
    t.CTRL(randPts(r, 4 + Math.floor(r() * 4)), 1 + Math.floor(r() * 5)),
  ]);
  against('conic and spline', 25, 21, (r, t) => [
    t.CONIC([rr(r, -8, 8), rr(r, -8, 8)], [rr(r, -8, 8), rr(r, -8, 8)], [rr(r, -8, 8), rr(r, -8, 8)], rr(r, 0.1, 0.9)),
    t.FIT(randPts(r, 3 + Math.floor(r() * 4))),
  ]);
  against('conic and arc', 25, 22, (r, t) => {
    const from = rr(r, 0, 300);
    return [
      t.CONIC([rr(r, -8, 8), rr(r, -8, 8)], [rr(r, -8, 8), rr(r, -8, 8)], [rr(r, -8, 8), rr(r, -8, 8)], rr(r, 0.1, 0.9)),
      t.ARC(rr(r, -8, 8), rr(r, -8, 8), rr(r, 1, 9), from, from + rr(r, 30, 250)),
    ];
  });
  against('point and spline', 30, 23, (r, t) => [t.P(rr(r, -25, 25), rr(r, -25, 25)), t.FIT(randPts(r, 3 + Math.floor(r() * 5)))]);

  // The closed forms get the same treatment: any pair of lines, circles and arcs.
  against('line and arc', 60, 31, (r, t) => {
    const from = rr(r, 0, 330);
    return [t.L(rr(r, -15, 15), rr(r, -15, 15), rr(r, -15, 15), rr(r, -15, 15)), t.ARC(rr(r, -5, 5), rr(r, -5, 5), rr(r, 0.5, 9), from, from + rr(r, 10, 300))];
  });
  against('arc and arc', 80, 32, (r, t) => {
    const f1 = rr(r, 0, 330);
    const f2 = rr(r, 0, 330);
    return [
      t.ARC(rr(r, -6, 6), rr(r, -6, 6), rr(r, 0.5, 9), f1, f1 + rr(r, 10, 300)),
      t.ARC(rr(r, -6, 6), rr(r, -6, 6), rr(r, 0.5, 9), f2, f2 + rr(r, 10, 300)),
    ];
  });
  against('line and line', 40, 33, (r, t) => [
    t.L(rr(r, -15, 15), rr(r, -15, 15), rr(r, -15, 15), rr(r, -15, 15)),
    t.L(rr(r, -15, 15), rr(r, -15, 15), rr(r, -15, 15), rr(r, -15, 15)),
  ]);
  against('point and arc', 40, 34, (r, t) => {
    const from = rr(r, 0, 330);
    return [t.P(rr(r, -15, 15), rr(r, -15, 15)), t.ARC(rr(r, -5, 5), rr(r, -5, 5), rr(r, 0.5, 9), from, from + rr(r, 10, 300))];
  });
});

describe('min distance, curves that run in step', () => {
  // A wave and a nearly parallel line (or a wave of the opposite phase): a near approach at every crest, the
  // deepest of them told from the rest by less than the error of the seed polyline. Seeding from the nearest
  // sample pair alone, or polishing one place only, picks a crest by the polyline's error and is wrong.
  const wave = (k: Kit, phase: number, rise: number, amp = 0.5): ParamCurve =>
    k.FIT(Array.from({ length: 41 }, (_, i) => [i * 0.5, amp * Math.sin(i * 0.5 + phase) + rise * i * 0.5] as Pt));
  for (const tilt of [0, 1e-5, 1e-4, 3e-4, -3e-4, 1e-3]) {
    it(`a wave against a line, tilt ${tilt}`, () => {
      const t = kit(1);
      const a = wave(t, 0, 0);
      const b = t.L(-1, 0.5 + 0.004, 21, 0.5 + 0.004 + tilt * 22);
      expect(minDistance(a, b).distance).toBeLessThanOrEqual(oracle(a, b, 600, 1000, 60) + 1e-9);
      expect(oracle(a, b, 600, 1000, 60) - minDistance(a, b).distance).toBeLessThanOrEqual(1e-8);
    });
    it(`a wave against a wave of the opposite phase, tilt ${tilt}`, () => {
      const t = kit(1);
      const a = wave(t, 0, 0);
      const b = wave(t, Math.PI, tilt, 0.5);
      const bUp = t.FIT(Array.from({ length: 41 }, (_, i) => [i * 0.5, -0.5 * Math.sin(i * 0.5) + 1.004 + tilt * i * 0.5] as Pt));
      for (const other of [b, bUp]) {
        const got = minDistance(a, other).distance;
        const want = oracle(a, other, 600, 1000, 60);
        expect(got).toBeLessThanOrEqual(want + 1e-9);
        expect(want - got).toBeLessThanOrEqual(1e-8);
      }
    });
  }
});

describe('min distance, curves that weave', () => {
  // A zigzag and a straight line through it: three crossings. And one just clear of the whole run, with
  // a near-pinch in several places, so a local minimum would be wrong by several tenths of a millimetre.
  const zig: Pt[] = [[0, 0], [3, 2], [6, -2], [9, 2], [12, -2], [15, 0]];
  it('spline crossing a line several times is 0', () => {
    const t = kit(1);
    expect(minDistance(t.FIT(zig), t.L(-2, 0, 17, 0)).distance).toBeLessThanOrEqual(1e-9);
  });
  it('picks the deepest of several near approaches', () => {
    const t = kit(1);
    const a = t.FIT(zig);
    for (const lift of [0.31, 0.77, 1.4]) {
      const b = t.FIT(zig.map(([x, y], i) => [x, y + 2.6 + lift * (i % 2 ? 1 : -0.4)] as Pt));
      const got = minDistance(a, b).distance;
      const want = oracle(a, b, 1500);
      expect(got).toBeLessThanOrEqual(want + 1e-9);
      expect(want - got).toBeLessThanOrEqual(1e-7);
    }
  });
  it('two splines that run side by side and touch only at one place', () => {
    const t = kit(1);
    const a = t.FIT([[0, 0], [4, 1], [8, 0], [12, -1], [16, 0]]);
    const b = t.FIT([[0, 2], [4, 3], [8, 0], [12, 1.5], [16, 3]]);
    expect(minDistance(a, b).distance).toBeLessThanOrEqual(1e-9);
  });
  it('a long thin ellipse and a spline that wraps past it', () => {
    const t = kit(1);
    const a = t.ELL(0, 0, 20, 0.5, 20);
    const b = t.FIT([[-18, 6], [-6, -4], [4, 5], [14, -5], [24, 4]]);
    expect(minDistance(a, b).distance).toBeLessThanOrEqual(oracle(a, b, 1500) + 1e-9);
    expect(oracle(a, b, 1500) - minDistance(a, b).distance).toBeLessThanOrEqual(1e-7);
  });
});

// ---------------------------------------------------------------------------
// The sketch level: ids in, a number out.

describe('min distance between sketch objects', () => {
  const make = (): { d: ReturnType<typeof newDesign>; s: Sketch } => {
    const d = newDesign();
    return { d, s: newSketch(d) };
  };
  const dm = (s: Sketch, a: Id, b: Id): number | null => minDistanceBetween(s, a, b)?.distance ?? null;

  it('measures a line to a circle', () => {
    const { d, s } = make();
    const l = addLine(d, s, v(-30, 40), v(30, 40));
    const ci = addCircle(d, s, v(0, 0), 25);
    expect(dm(s, l.id, ci.id)).toBeCloseTo(15, 9);
    expect(dm(s, ci.id, l.id)).toBeCloseTo(15, 9);
  });
  it('measures two sketch points, and the origin', () => {
    const { d, s } = make();
    const a = addPoint(d, s, v(3, 0), { explicit: true });
    const b = addPoint(d, s, v(0, 4), { explicit: true });
    expect(dm(s, a.id, b.id)).toBeCloseTo(5, 12);
    expect(dm(s, a.id, ORIGIN)).toBeCloseTo(3, 12);
  });
  it('measures points owned by curves: an end point, a centre, a spline point', () => {
    const { d, s } = make();
    const l = addLine(d, s, v(0, 0), v(10, 0));
    const ci = addCircle(d, s, v(10, 10), 2);
    const sp = addFitSpline(d, s, [v(20, 0), v(25, 5), v(30, 0)]);
    expect(dm(s, l.b, ci.c)).toBeCloseTo(10, 12);
    expect(dm(s, sp.pts[1], l.a)).toBeCloseTo(Math.hypot(25, 5), 12);
    expect(dm(s, ci.c, sp.id)).toBeGreaterThan(0);
  });
  it('reads an arc as its sweep, counter-clockwise from a to b', () => {
    const { d, s } = make();
    const arc = addArc(d, s, v(0, 0), v(10, 0), v(0, 10));
    const p = addPoint(d, s, v(-10, 0), { explicit: true });
    expect(dm(s, p.id, arc.id)).toBeCloseTo(Math.hypot(10, 10), 12);
    const wide = addArc(d, s, v(0, 0), v(0, 10), v(10, 0));
    expect(dm(s, p.id, wide.id)).toBeCloseTo(0, 12);
  });
  it('measures every curve type against a point', () => {
    const { d, s } = make();
    const ids: Id[] = [
      addLine(d, s, v(0, 0), v(10, 0)).id,
      addCircle(d, s, v(0, 0), 5).id,
      addArc(d, s, v(0, 0), v(5, 0), v(0, 5)).id,
      addEllipse(d, s, v(0, 0), v(6, 0), v(0, 3)).id,
      addEllipticalArc(d, s, v(0, 0), v(6, 0), v(0, 3), v(6, 0), v(0, 3)).id,
      addFitSpline(d, s, [v(0, 0), v(5, 2), v(10, 0)]).id,
      addControlSpline(d, s, [v(0, 0), v(5, 4), v(10, 0)], 2).id,
      addConic(d, s, v(0, 0), v(10, 0), v(5, 5), 0.5).id,
    ];
    const p = addPoint(d, s, v(5, 20), { explicit: true });
    for (const id of ids) expect(dm(s, p.id, id)).toBeGreaterThan(0);
    for (const a of ids) for (const b of ids) expect(dm(s, a, b), `${a} ${b}`).not.toBeNull();
  });
  it('reads a degree 1 control spline as the polyline it is', () => {
    const { d, s } = make();
    const sp = addControlSpline(d, s, [v(0, 0), v(10, 0), v(10, 10), v(0, 10)], 1);
    const p = addPoint(d, s, v(5, 3), { explicit: true });
    const q = addPoint(d, s, v(15, 5), { explicit: true });
    const ci = addCircle(d, s, v(5, 5), 1);
    expect(dm(s, p.id, sp.id)).toBeCloseTo(3, 12);
    expect(dm(s, q.id, sp.id)).toBeCloseTo(5, 12);
    expect(dm(s, ci.id, sp.id)).toBeCloseTo(4, 12);
  });
  it('measures degree 1 control splines against others as brute force does, 60 random pairs', () => {
    const r = rng(77);
    const t = kit(1);
    for (let i = 0; i < 60; i++) {
      const { d, s } = make();
      const pa = randPts(r, 4 + Math.floor(r() * 4));
      const pb = randPts(r, 4 + Math.floor(r() * 4));
      const db = 1 + Math.floor(r() * 5);
      const a = addControlSpline(d, s, pa.map(([x, y]) => v(x, y)), 1);
      const b = addControlSpline(d, s, pb.map(([x, y]) => v(x, y)), db as 1 | 2 | 3 | 4 | 5);
      const got = dm(s, a.id, b.id) as number;
      const want = oracle(t.CTRL(pa, 1), t.CTRL(pb, db));
      expect(got, `pair ${i}`).toBeLessThanOrEqual(want + 1e-9);
    }
  }, 60_000);
  it('gives nothing for text, axes, unknown ids and anything that is not geometry', () => {
    const { d, s } = make();
    const l = addLine(d, s, v(0, 0), v(10, 0));
    const t = addFrameText(d, s, 'Hello', 3, [v(0, 5), v(10, 5), v(10, 8), v(0, 8)]);
    expect(dm(s, l.id, t.id)).toBeNull();
    expect(dm(s, l.id, AXIS_X)).toBeNull();
    expect(dm(s, l.id, 'nope')).toBeNull();
  });
  it('costs the same on a sketch of 1000 curves as on two', () => {
    const { d, s } = make();
    const lines = Array.from({ length: 1000 }, (_, i) => addLine(d, s, v(i, 0), v(i, 10)));
    const e = addEllipse(d, s, v(500, 50), v(520, 50), v(500, 60));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) dm(s, lines[i].id, e.id);
    const per = (performance.now() - t0) / 20;
    expect(per).toBeLessThan(5);
    expect(dm(s, lines[500].id, e.id)).toBeCloseTo(30, 6);
  });
});

describe('the key a caller can keep the last answer against', () => {
  it('is the same for the same shape and differs when anything the measure reads moves', () => {
    const d = newDesign();
    const s = newSketch(d);
    const ci = addCircle(d, s, v(0, 0), 5);
    const ln = addLine(d, s, v(10, 0), v(20, 0));
    const sp = addFitSpline(d, s, [v(0, 10), v(5, 12), v(10, 10)]);
    const was = [ci.id, ln.id, sp.id, ln.b].map((id) => shapeKey(s, id));
    expect(new Set(was).size).toBe(4);
    expect([ci.id, ln.id, sp.id, ln.b].map((id) => shapeKey(s, id))).toEqual(was);
    ci.r = 6;
    expect(shapeKey(s, ci.id)).not.toBe(was[0]);
    s.points[ln.b].x = 21;
    expect(shapeKey(s, ln.id)).not.toBe(was[1]);
    expect(shapeKey(s, ln.b)).not.toBe(was[3]);
    expect(shapeKey(s, sp.id)).toBe(was[2]);
    expect(shapeKey(s, 'nope')).toBe('');
    expect(shapeKey(s, ORIGIN)).not.toBe('');
  });
});

describe('resolve and the maths agree', () => {
  it('a sketch circle is the full circle, an arc the swept part', () => {
    const d = newDesign();
    const s = newSketch(d);
    const arc = addArc(d, s, v(0, 0), v(5, 0), v(0, 5));
    const circle = addCircle(d, s, v(20, 0), 5);
    expect(minDistance(resolve(s, arc), resolve(s, circle)).distance).toBeCloseTo(10, 12);
  });
});
