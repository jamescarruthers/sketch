// Unified parametric view of every curve type. t runs 0 to 1 along the curve; closed curves wrap.
import type { Curve, Id, Sketch, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y } from '../model/types';
import { getPointPos } from '../model/document';
import { conicD1, conicD2, conicPoint, type ConicArc } from './conic';
import { splineEval } from './spline';
import {
  EPS_STEP, EPS_SWEEP, EPS_ZERO, FLATTEN_TOL, MAX_FLATTEN_SEGMENTS, MIN_ARC_STEP, MIN_ZOOM, NEWTON_ITERS,
  RENDER_FLATTEN_TOL, TANGENT_PROBE,
} from './tolerance';
import {
  add, boxAdd, cross, dist, dot, emptyBox, lerp, len, perp, scale, sub, TAU, wrapAngle, type Box,
} from './vec';

/** Analytic shape, when there is one. Circles are arcs with a full sweep. Negative sweep is clockwise. */
export type Shape =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; c: Vec2; r: number; start: number; sweep: number }
  | { kind: 'ellipse'; c: Vec2; rx: number; ry: number; rot: number; start: number; sweep: number }
  | { kind: 'polyline'; pts: Vec2[] }
  | { kind: 'spline'; spans: number; breaks?: number[] }
  | { kind: 'conic'; arc: ConicArc };

export interface ParamCurve {
  shape: Shape;
  closed: boolean;
  at(t: number): Vec2;
  d1(t: number): Vec2;
  d2(t: number): Vec2;
}

export function lineCurve(a: Vec2, b: Vec2): ParamCurve {
  const d = sub(b, a);
  const zero = { x: 0, y: 0 };
  return { shape: { kind: 'line', a, b }, closed: false, at: (t) => lerp(a, b, t), d1: () => d, d2: () => zero };
}

export function arcCurve(c: Vec2, r: number, start: number, sweep: number): ParamCurve {
  const full = Math.abs(sweep) >= TAU - EPS_SWEEP;
  return {
    shape: { kind: 'arc', c, r, start, sweep },
    closed: full,
    at(t) {
      const a = start + sweep * t;
      return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
    },
    d1(t) {
      const a = start + sweep * t;
      return { x: -r * Math.sin(a) * sweep, y: r * Math.cos(a) * sweep };
    },
    d2(t) {
      const a = start + sweep * t;
      const k = sweep * sweep * r;
      return { x: -k * Math.cos(a), y: -k * Math.sin(a) };
    },
  };
}

export function ellipseCurve(c: Vec2, rx: number, ry: number, rot: number, start: number, sweep: number): ParamCurve {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const place = (x: number, y: number): Vec2 => ({ x: x * cr - y * sr, y: x * sr + y * cr });
  const full = Math.abs(sweep) >= TAU - EPS_SWEEP;
  return {
    shape: { kind: 'ellipse', c, rx, ry, rot, start, sweep },
    closed: full,
    at(t) {
      const a = start + sweep * t;
      return add(c, place(rx * Math.cos(a), ry * Math.sin(a)));
    },
    d1(t) {
      const a = start + sweep * t;
      return scale(place(-rx * Math.sin(a), ry * Math.cos(a)), sweep);
    },
    d2(t) {
      const a = start + sweep * t;
      return scale(place(-rx * Math.cos(a), -ry * Math.sin(a)), sweep * sweep);
    },
  };
}

export function polylineCurve(pts: Vec2[], closed: boolean): ParamCurve {
  const nodes = closed ? [...pts, pts[0]] : pts;
  const segs = Math.max(nodes.length - 1, 1);
  const locate = (t: number): [number, number] => {
    const w = closed ? t - Math.floor(t) : Math.min(1, Math.max(0, t));
    const x = w * segs;
    const i = Math.min(Math.floor(x), segs - 1);
    return [i, x - i];
  };
  const zero = { x: 0, y: 0 };
  return {
    shape: { kind: 'polyline', pts: nodes },
    closed,
    at(t) {
      if (nodes.length < 2) return nodes[0] ?? zero;
      const [i, f] = locate(t);
      return lerp(nodes[i], nodes[i + 1], f);
    },
    d1(t) {
      if (nodes.length < 2) return zero;
      const [i] = locate(t);
      return scale(sub(nodes[i + 1], nodes[i]), segs);
    },
    d2: () => zero,
  };
}

/** The ellipse frame of an ellipse or elliptical arc. Always counter-clockwise in its parameter. */
export function ellipseFrame(sketch: Sketch, curve: Extract<Curve, { type: 'ellipse' | 'ellipticalArc' }>) {
  const c = getPointPos(sketch, curve.c);
  const major = sub(getPointPos(sketch, curve.major), c);
  const minor = sub(getPointPos(sketch, curve.minor), c);
  return { c, rx: len(major), ry: len(minor), rot: Math.atan2(major.y, major.x) };
}

/** Ellipse parameter of a point, projecting it through the frame. */
export function ellipseAngle(f: { c: Vec2; rx: number; ry: number; rot: number }, p: Vec2): number {
  const r = sub(p, f.c);
  const cr = Math.cos(f.rot);
  const sr = Math.sin(f.rot);
  const x = r.x * cr + r.y * sr;
  const y = -r.x * sr + r.y * cr;
  return Math.atan2(y / (f.ry || 1), x / (f.rx || 1));
}

function polarOf(c: Vec2, p: Vec2): number {
  return Math.atan2(p.y - c.y, p.x - c.x);
}

function ccwSweep(from: number, to: number): number {
  const s = wrapAngle(to - from);
  return s < EPS_SWEEP ? TAU : s;
}

/** Resolve a stored curve against current point positions. */
export function resolve(sketch: Sketch, curve: Curve): ParamCurve {
  const pos = (id: Id): Vec2 => getPointPos(sketch, id);
  switch (curve.type) {
    case 'line': return lineCurve(pos(curve.a), pos(curve.b));
    case 'circle': return arcCurve(pos(curve.c), curve.r, 0, TAU);
    case 'arc': {
      const c = pos(curve.c);
      const a = pos(curve.a);
      const b = pos(curve.b);
      const start = polarOf(c, a);
      return arcCurve(c, dist(c, a), start, ccwSweep(start, polarOf(c, b)));
    }
    case 'ellipse': {
      const f = ellipseFrame(sketch, curve);
      return ellipseCurve(f.c, f.rx, f.ry, f.rot, 0, TAU);
    }
    case 'ellipticalArc': {
      const f = ellipseFrame(sketch, curve);
      const start = ellipseAngle(f, pos(curve.a));
      return ellipseCurve(f.c, f.rx, f.ry, f.rot, start, ccwSweep(start, ellipseAngle(f, pos(curve.b))));
    }
    case 'fitSpline': case 'controlSpline': {
      const ev = splineEval(curve, sketch);
      return { shape: { kind: 'spline', spans: ev.spans, breaks: ev.breaks }, closed: ev.closed, at: ev.at, d1: ev.d1, d2: ev.d2 };
    }
    case 'conic': {
      const arc: ConicArc = { a: pos(curve.a), v: pos(curve.v), b: pos(curve.b), rho: curve.rho };
      return {
        shape: { kind: 'conic', arc }, closed: false,
        at: (t) => conicPoint(arc, t), d1: (t) => conicD1(arc, t), d2: (t) => conicD2(arc, t),
      };
    }
    case 'text': {
      if (curve.frame) return polylineCurve(curve.frame.map(pos), true);
      const path = curve.path ? sketch.curves[curve.path] : undefined;
      return path && path.type !== 'text' ? resolve(sketch, path) : polylineCurve([], false);
    }
  }
}

/** The same curve traversed end to start. */
export function reversed(pc: ParamCurve): ParamCurve {
  const s = pc.shape;
  if (s.kind === 'line') return lineCurve(s.b, s.a);
  if (s.kind === 'arc') return arcCurve(s.c, s.r, s.start + s.sweep, -s.sweep);
  if (s.kind === 'ellipse') return ellipseCurve(s.c, s.rx, s.ry, s.rot, s.start + s.sweep, -s.sweep);
  return {
    shape: s, closed: pc.closed,
    at: (t) => pc.at(1 - t),
    d1: (t) => scale(pc.d1(1 - t), -1),
    d2: (t) => pc.d2(1 - t),
  };
}

export function unitTangent(pc: ParamCurve, t: number): Vec2 {
  let d = pc.d1(t);
  if (len(d) < EPS_ZERO) {
    // Zero-speed knots: look just inside the curve.
    const step = t > 0.5 ? -TANGENT_PROBE : TANGENT_PROBE;
    d = scale(sub(pc.at(t + step), pc.at(t)), Math.sign(step) || 1);
  }
  const l = len(d);
  return l < EPS_ZERO ? { x: 1, y: 0 } : scale(d, 1 / l);
}

/** Signed curvature: positive when turning left. */
export function curvatureAt(pc: ParamCurve, t: number): number {
  const d = pc.d1(t);
  const dd = pc.d2(t);
  const sp = len(d);
  return sp < EPS_ZERO ? 0 : cross(d, dd) / (sp * sp * sp);
}

const GL_X = [-0.906179845938664, -0.538469310105683, 0, 0.538469310105683, 0.906179845938664];
const GL_W = [0.236926885056189, 0.478628670499366, 0.568888888888889, 0.478628670499366, 0.236926885056189];

/** Arc length over [t0, t1]. */
export function lengthBetween(pc: ParamCurve, t0: number, t1: number): number {
  const s = pc.shape;
  if (s.kind === 'line') return dist(s.a, s.b) * Math.abs(t1 - t0);
  if (s.kind === 'arc') return s.r * Math.abs(s.sweep * (t1 - t0));
  if (s.kind === 'polyline') {
    const f = flattenParam(pc, 0, Math.min(t0, t1), Math.max(t0, t1));
    let total = 0;
    for (let i = 0; i + 1 < f.pts.length; i++) total += dist(f.pts[i], f.pts[i + 1]);
    return total;
  }
  const n = s.kind === 'spline' ? s.spans * 8 : 64;
  const h = (t1 - t0) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const m = t0 + (i + 0.5) * h;
    for (let k = 0; k < 5; k++) sum += GL_W[k] * len(pc.d1(m + (GL_X[k] * h) / 2));
  }
  return Math.abs((sum * h) / 2);
}

export const lengthOf = (pc: ParamCurve): number => lengthBetween(pc, 0, 1);

export interface Flattened { pts: Vec2[]; ts: number[] }

function adaptive(pc: ParamCurve, t0: number, t1: number, tol: number, seed: number, out: Flattened): void {
  let budget = MAX_FLATTEN_SEGMENTS;
  const emit = (a: number, pa: Vec2, b: number, pb: Vec2, depth: number): void => {
    const m = (a + b) / 2;
    const pm = pc.at(m);
    const q1 = pc.at((a + m) / 2);
    const q3 = pc.at((m + b) / 2);
    const dev = Math.max(
      dist(pm, lerp(pa, pb, 0.5)),
      dist(q1, lerp(pa, pb, 0.25)),
      dist(q3, lerp(pa, pb, 0.75)),
    );
    if (depth < 16 && budget > 0 && dev > tol) {
      budget--;
      emit(a, pa, m, pm, depth + 1);
      emit(m, pm, b, pb, depth + 1);
      return;
    }
    out.pts.push(pb);
    out.ts.push(b);
  };
  let prevT = t0;
  let prev = pc.at(t0);
  for (let i = 1; i <= seed; i++) {
    const t = t0 + ((t1 - t0) * i) / seed;
    const p = pc.at(t);
    emit(prevT, prev, t, p, 0);
    prevT = t;
    prev = p;
  }
}

/** Polyline over [t0, t1] with chord error below tol. */
export function flattenParam(pc: ParamCurve, tol = FLATTEN_TOL, t0 = 0, t1 = 1): Flattened {
  const s = pc.shape;
  const out: Flattened = { pts: [pc.at(t0)], ts: [t0] };
  if (s.kind === 'line') {
    out.pts.push(pc.at(t1));
    out.ts.push(t1);
    return out;
  }
  if (s.kind === 'polyline') {
    const segs = s.pts.length - 1;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      if (t <= t0 || t >= t1) continue;
      out.pts.push(s.pts[i]);
      out.ts.push(t);
    }
    out.pts.push(pc.at(t1));
    out.ts.push(t1);
    return out;
  }
  if (s.kind === 'arc' || s.kind === 'ellipse') {
    const r = s.kind === 'arc' ? s.r : Math.max(s.rx, s.ry);
    const step = 2 * Math.acos(Math.max(0, 1 - Math.min(tol, r) / Math.max(r, EPS_ZERO)));
    const swept = Math.abs(s.sweep * (t1 - t0));
    let n = Math.max(2, Math.ceil(swept / Math.max(step, MIN_ARC_STEP)));
    if (s.kind === 'ellipse') n = Math.min(n * 2, MAX_FLATTEN_SEGMENTS);
    n = Math.min(n, MAX_FLATTEN_SEGMENTS);
    for (let i = 1; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      out.pts.push(pc.at(t));
      out.ts.push(t);
    }
    return out;
  }
  const seed = s.kind === 'spline' ? Math.max(4, Math.ceil(s.spans * 4 * Math.abs(t1 - t0))) : 8;
  adaptive(pc, t0, t1, tol, seed, out);
  return out;
}

export interface ClosestHit { t: number; p: Vec2; dist: number }

function refineClosest(pc: ParamCurve, p: Vec2, seed: number): ClosestHit {
  let t = seed;
  for (let i = 0; i < NEWTON_ITERS; i++) {
    const c = pc.at(t);
    const d = pc.d1(t);
    const dd = pc.d2(t);
    const r = sub(c, p);
    const f = dot(r, d);
    const g = dot(d, d) + dot(r, dd);
    if (Math.abs(g) < EPS_ZERO) break;
    let next = t - f / (g > 0 ? g : dot(d, d) || 1);
    if (pc.closed) next = next - Math.floor(next);
    else next = Math.min(1, Math.max(0, next));
    if (Math.abs(next - t) < EPS_STEP) {
      t = next;
      break;
    }
    t = next;
  }
  const q = pc.at(t);
  return { t, p: q, dist: dist(q, p) };
}

/** Nearest point on the curve. */
export function closestOnParam(pc: ParamCurve, p: Vec2): ClosestHit {
  const s = pc.shape;
  if (s.kind === 'line') {
    const d = sub(s.b, s.a);
    const l2 = dot(d, d);
    const t = l2 < EPS_ZERO ? 0 : Math.min(1, Math.max(0, dot(sub(p, s.a), d) / l2));
    const q = lerp(s.a, s.b, t);
    return { t, p: q, dist: dist(q, p) };
  }
  if (s.kind === 'arc') {
    const a = Math.atan2(p.y - s.c.y, p.x - s.c.x);
    const dir = Math.sign(s.sweep) || 1;
    const off = wrapAngle((a - s.start) * dir);
    const span = Math.abs(s.sweep);
    let t: number;
    if (off <= span || pc.closed) t = off / span;
    else t = TAU - off < off - span ? 0 : 1;
    if (pc.closed) t = t % 1;
    const q = pc.at(t);
    return { t, p: q, dist: dist(q, p) };
  }
  const flat = flattenParam(pc, FLATTEN_TOL * 5);
  const scored: { i: number; d: number }[] = [];
  for (let i = 0; i + 1 < flat.pts.length; i++) {
    const a = flat.pts[i];
    const b = flat.pts[i + 1];
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    const f = l2 < EPS_ZERO ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
    scored.push({ i, d: dist(lerp(a, b, f), p) });
  }
  scored.sort((x, y) => x.d - y.d);
  let best: ClosestHit = { t: 0, p: flat.pts[0], dist: dist(flat.pts[0], p) };
  const last = flat.pts[flat.pts.length - 1];
  if (dist(last, p) < best.dist) best = { t: 1, p: last, dist: dist(last, p) };
  let tried = 0;
  let lastIndex = -10;
  for (const c of scored) {
    if (Math.abs(c.i - lastIndex) < 2) continue;
    lastIndex = c.i;
    const hit = refineClosest(pc, p, (flat.ts[c.i] + flat.ts[c.i + 1]) / 2);
    if (hit.dist < best.dist) best = hit;
    if (++tried >= 4) break;
  }
  return best;
}

export function boxOfParam(pc: ParamCurve): Box {
  const s = pc.shape;
  const b = emptyBox();
  if (s.kind === 'line') {
    boxAdd(b, s.a);
    boxAdd(b, s.b);
    return b;
  }
  if (s.kind === 'arc') {
    boxAdd(b, pc.at(0));
    boxAdd(b, pc.at(1));
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2;
      const off = wrapAngle((a - s.start) * Math.sign(s.sweep || 1));
      if (off <= Math.abs(s.sweep)) boxAdd(b, { x: s.c.x + s.r * Math.cos(a), y: s.c.y + s.r * Math.sin(a) });
    }
    return b;
  }
  for (const p of flattenParam(pc, FLATTEN_TOL * 5).pts) boxAdd(b, p);
  return b;
}

// ---------------------------------------------------------------------------
// Sketch-level convenience. All are thin wrappers over the ParamCurve functions.

/** Position at t in [0, 1]. */
export const evaluate = (sketch: Sketch, curve: Curve, t: number): Vec2 => resolve(sketch, curve).at(t);
/** Unit tangent at t. */
export const tangent = (sketch: Sketch, curve: Curve, t: number): Vec2 => unitTangent(resolve(sketch, curve), t);
/** Left-hand unit normal at t. */
export const normal = (sketch: Sketch, curve: Curve, t: number): Vec2 => perp(tangent(sketch, curve, t));
/** Signed curvature at t. */
export const curvature = (sketch: Sketch, curve: Curve, t: number): number => curvatureAt(resolve(sketch, curve), t);
/** Total arc length. */
export const curveLength = (sketch: Sketch, curve: Curve): number => lengthOf(resolve(sketch, curve));
/** Nearest point on the curve to p. */
export const closestPoint = (sketch: Sketch, curve: Curve, p: Vec2): ClosestHit => closestOnParam(resolve(sketch, curve), p);
/** Tight bounding box. */
export const boundingBox = (sketch: Sketch, curve: Curve): Box => boxOfParam(resolve(sketch, curve));
/** Polyline with chord error below tol, in mm. */
export const flatten = (sketch: Sketch, curve: Curve, tol = FLATTEN_TOL): Vec2[] => flattenParam(resolve(sketch, curve), tol).pts;
/** Polyline for drawing at a zoom of pixelsPerMm. */
export const sampleForRender = (sketch: Sketch, curve: Curve, pixelsPerMm = 1): Vec2[] =>
  flatten(sketch, curve, RENDER_FLATTEN_TOL / Math.max(pixelsPerMm, MIN_ZOOM));

/** An infinite line through a stored line or a reserved axis. */
export function lineOf(sketch: Sketch, id: Id): { p: Vec2; d: Vec2 } | null {
  if (id === AXIS_X) return { p: { x: 0, y: 0 }, d: { x: 1, y: 0 } };
  if (id === AXIS_Y) return { p: { x: 0, y: 0 }, d: { x: 0, y: 1 } };
  const c = sketch.curves[id];
  if (c?.type !== 'line') return null;
  const p = getPointPos(sketch, c.a);
  return { p, d: sub(getPointPos(sketch, c.b), p) };
}
