// Minimum distance between two sketch objects, measured on the geometry as drawn: a line is its segment, an
// arc only its sweep. Pure maths, no document and no DOM beyond reading ids out of a sketch.
//
// Points, lines, arcs and circles are closed forms. Each is a short list of candidate pairs (crossing, end
// points, the normal from a centre, the line of centres), every one a real pair of points on the two
// objects. The true minimum is always among them, so the smallest is exact, not an estimate.
//
// Everything else (ellipses, splines, conics) takes the app's own sampling as a seed, then Newton on the two
// parameters, then a small direct search that settles a minimum at a kink. Every near pair of sample
// segments is a candidate, not only the nearest, so two curves that weave do not stop at a local minimum.
import type { Id, Sketch, Vec2 } from '../model/types';
import { ORIGIN } from '../model/types';
import { curvePoints, getPointPos } from '../model/document';
import { flattenParam, lineCurve, polylineCurve, resolve, type ParamCurve, type Shape } from './curves';
import { intersect } from './intersect';
import {
  EPS_STEP, EPS_SWEEP, FLATTEN_TOL, MIN_DIST_FLATTEN, MIN_DIST_REACH, MIN_DIST_SLACK, MIN_DIST_STARTS, NEWTON_ITERS,
} from './tolerance';
import {
  add, boxAdd, cross, dist, dot, emptyBox, lerp, scale, sub, TAU, wrapAngle, type Box,
} from './vec';

/** The gap between two objects, and where it is: `a` on the first and `b` on the second. */
export interface Nearest { distance: number; a: Vec2; b: Vec2 }

type ArcShape = Extract<Shape, { kind: 'arc' }>;
type LineShape = Extract<Shape, { kind: 'line' }>;

/** A lone point, as a curve with no length. */
export function pointCurve(p: Vec2): ParamCurve {
  const zero = { x: 0, y: 0 };
  return { shape: { kind: 'polyline', pts: [p] }, closed: false, at: () => p, d1: () => zero, d2: () => zero };
}

const isPoint = (pc: ParamCurve): boolean => pc.shape.kind === 'polyline' && pc.shape.pts.length < 2;

const pair = (a: Vec2, b: Vec2): Nearest => ({ distance: dist(a, b), a, b });
const meet = (p: Vec2): Nearest => ({ distance: 0, a: p, b: p });
const flip = (n: Nearest): Nearest => ({ distance: n.distance, a: n.b, b: n.a });
const nearest = (list: Nearest[]): Nearest => list.reduce((m, n) => (n.distance < m.distance ? n : m));

// ---------------------------------------------------------------------------
// Closed forms

function onSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 === 0) return a;
  return lerp(a, b, Math.min(1, Math.max(0, dot(sub(p, a), d) / l2)));
}

/** A full turn, or an arc with no radius, which is a point and has no sweep to be outside of. */
const isFull = (s: ArcShape): boolean => Math.abs(s.sweep) >= TAU - EPS_SWEEP || s.r === 0;

function inSweep(s: ArcShape, angle: number): boolean {
  if (isFull(s)) return true;
  return wrapAngle((angle - s.start) * (Math.sign(s.sweep) || 1)) <= Math.abs(s.sweep);
}

const onSweep = (s: ArcShape, p: Vec2): boolean => isFull(s) || inSweep(s, Math.atan2(p.y - s.c.y, p.x - s.c.x));
const arcPoint = (s: ArcShape, angle: number): Vec2 => ({ x: s.c.x + s.r * Math.cos(angle), y: s.c.y + s.r * Math.sin(angle) });
const arcEnds = (s: ArcShape): Vec2[] => (isFull(s) ? [] : [arcPoint(s, s.start), arcPoint(s, s.start + s.sweep)]);

/** The nearest point of the drawn arc: straight out from the centre when that is on the sweep, else an end. */
function onArc(p: Vec2, s: ArcShape): Vec2 {
  const q = sub(p, s.c);
  const rho = Math.hypot(q.x, q.y);
  if (rho === 0) return arcPoint(s, s.start);
  if (inSweep(s, Math.atan2(q.y, q.x))) return add(s.c, scale(q, s.r / rho));
  const [e0, e1] = arcEnds(s);
  return dist(p, e0) <= dist(p, e1) ? e0 : e1;
}

function segmentSegment(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): Nearest {
  const da = sub(a1, a0);
  const db = sub(b1, b0);
  const den = cross(da, db);
  if (den !== 0) {
    const r = sub(b0, a0);
    const t = cross(r, db) / den;
    const u = cross(r, da) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return meet(lerp(a0, a1, t));
  }
  return nearest([
    pair(a0, onSegment(a0, b0, b1)), pair(a1, onSegment(a1, b0, b1)),
    flip(pair(b0, onSegment(b0, a0, a1))), flip(pair(b1, onSegment(b1, a0, a1))),
  ]);
}

/** Candidates: a crossing, the segment's ends, the arc's ends, and the points the line's normal through the centre meets. */
function segmentArc(l: LineShape, s: ArcShape): Nearest {
  const d = sub(l.b, l.a);
  const l2 = dot(d, d);
  const out: Nearest[] = [];
  if (l2 > 0) {
    const len = Math.sqrt(l2);
    const f = sub(s.c, l.a);
    const foot = dot(f, d) / l2;
    const off = cross(d, f) / len;
    if (Math.abs(off) <= s.r) {
      const w = Math.sqrt(s.r * s.r - off * off) / len;
      for (const t of [foot - w, foot + w]) {
        if (t < 0 || t > 1) continue;
        const p = lerp(l.a, l.b, t);
        if (onSweep(s, p)) return meet(p);
      }
    }
    for (const sg of [1, -1]) {
      const n = { x: (-sg * d.y) / len, y: (sg * d.x) / len };
      if (inSweep(s, Math.atan2(n.y, n.x))) {
        const p = { x: s.c.x + s.r * n.x, y: s.c.y + s.r * n.y };
        out.push(pair(onSegment(p, l.a, l.b), p));
      }
    }
  }
  for (const e of [l.a, l.b]) out.push(pair(e, onArc(e, s)));
  for (const e of arcEnds(s)) out.push(pair(onSegment(e, l.a, l.b), e));
  return nearest(out);
}

/** Candidates: a crossing, the end points against the other arc, and the points on the line of centres. */
function arcArc(a: ArcShape, b: ArcShape): Nearest {
  const dx = b.c.x - a.c.x;
  const dy = b.c.y - a.c.y;
  const d = Math.hypot(dx, dy);
  const dirs: Vec2[] = [{ x: 1, y: 0 }];
  if (d > 0) {
    dirs.push({ x: dx / d, y: dy / d });
    const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
    const h2 = a.r * a.r - x * x;
    if (h2 >= 0) {
      const h = Math.sqrt(h2);
      for (const sg of [1, -1]) {
        const p = { x: a.c.x + (dx / d) * x - (sg * dy * h) / d, y: a.c.y + (dy / d) * x + (sg * dx * h) / d };
        if (onSweep(a, p) && onSweep(b, p)) return meet(p);
      }
    }
  }
  const out: Nearest[] = [];
  for (const e of arcEnds(a)) out.push(pair(e, onArc(e, b)));
  for (const e of arcEnds(b)) out.push(flip(pair(e, onArc(e, a))));
  // Concentric arcs have no line of centres: any angle both sweeps hold will do, and an end point names one.
  for (const s of [a, b]) {
    for (const e of arcEnds(s)) {
      const q = sub(e, s.c);
      const l = Math.hypot(q.x, q.y);
      if (l > 0) dirs.push(scale(q, 1 / l));
    }
  }
  for (const w of dirs) {
    for (const sa of [1, -1]) {
      for (const sb of [1, -1]) {
        const p = { x: a.c.x + sa * a.r * w.x, y: a.c.y + sa * a.r * w.y };
        const q = { x: b.c.x + sb * b.r * w.x, y: b.c.y + sb * b.r * w.y };
        if (onSweep(a, p) && onSweep(b, q)) out.push(pair(p, q));
      }
    }
  }
  return nearest(out);
}

// ---------------------------------------------------------------------------
// Everything else: seed, Newton, direct search

const wrapParam = (pc: ParamCurve, t: number): number => (pc.closed ? t - Math.floor(t) : Math.min(1, Math.max(0, t)));

const gap2 = (A: ParamCurve, B: ParamCurve, s: number, t: number): number => {
  const a = A.at(s);
  const b = B.at(t);
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
};

const ZERO: Vec2 = { x: 0, y: 0 };

/** Newton on half the squared gap over (s, t), damped, kept inside the curves; a curve with no length stays put. */
function newton(A: ParamCurve, B: ParamCurve, s0: number, t0: number, moveA: boolean, moveB: boolean): [number, number] {
  let s = s0;
  let t = t0;
  let f = gap2(A, B, s, t);
  let lam = 0;
  for (let iter = 0; iter < NEWTON_ITERS * 2 && f > 0; iter++) {
    const r = sub(A.at(s), B.at(t));
    const da = moveA ? A.d1(s) : ZERO;
    const db = moveB ? B.d1(t) : ZERO;
    const gs = dot(r, da);
    const gt = -dot(r, db);
    const hss = dot(da, da) + (moveA ? dot(r, A.d2(s)) : 0);
    const htt = dot(db, db) - (moveB ? dot(r, B.d2(t)) : 0);
    const hst = -dot(da, db);
    const fixS = !moveA || (!A.closed && ((s <= 0 && gs > 0) || (s >= 1 && gs < 0)));
    const fixT = !moveB || (!B.closed && ((t <= 0 && gt > 0) || (t >= 1 && gt < 0)));
    if (fixS && fixT) break;
    const floor = 1e-9 * (Math.abs(hss) + Math.abs(htt) + Math.abs(hst)) + 1e-300;
    let moved = false;
    let step = 0;
    for (let k = 0; k < 14 && !moved; k++) {
      let ds = 0;
      let dt = 0;
      let sound = true;
      if (fixT) {
        sound = hss + lam > 0;
        ds = -gs / (hss + lam);
      } else if (fixS) {
        sound = htt + lam > 0;
        dt = -gt / (htt + lam);
      } else {
        const a11 = hss + lam;
        const a22 = htt + lam;
        const det = a11 * a22 - hst * hst;
        sound = a11 > 0 && det > 0;
        ds = -(a22 * gs - hst * gt) / det;
        dt = -(a11 * gt - hst * gs) / det;
      }
      const s2 = wrapParam(A, s + ds);
      const t2 = wrapParam(B, t + dt);
      const f2 = sound ? gap2(A, B, s2, t2) : Infinity;
      if (f2 <= f) {
        s = s2;
        t = t2;
        f = f2;
        step = Math.abs(ds) + Math.abs(dt);
        moved = true;
        lam = lam > floor * 100 ? lam / 100 : 0;
      } else lam = lam === 0 ? floor : lam * 10;
    }
    if (!moved || step < EPS_STEP) break;
  }
  return [s, t];
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Compass search: shrinks until the step is nothing. Slow to travel, and a last check on what Newton settled on. */
function compass(A: ParamCurve, B: ParamCurve, s0: number, t0: number, moveA: boolean, moveB: boolean): [number, number] {
  let s = s0;
  let t = t0;
  let f = gap2(A, B, s, t);
  let h = MIN_DIST_REACH;
  const dirs = DIRS.filter(([x, y]) => (moveA || x === 0) && (moveB || y === 0));
  for (let n = 0; n < 600 && h > EPS_STEP && f > 0; n++) {
    let better = false;
    for (const [x, y] of dirs) {
      const s2 = wrapParam(A, s + x * h);
      const t2 = wrapParam(B, t + y * h);
      const f2 = gap2(A, B, s2, t2);
      if (f2 < f) {
        s = s2;
        t = t2;
        f = f2;
        better = true;
        break;
      }
    }
    h = better ? Math.min(h * 2, MIN_DIST_REACH) : h / 2;
  }
  return [s, t];
}

interface Sample { pts: Vec2[]; ts: number[]; tol: number }

/** The app's flattening, with a chord error that follows the size of the curve so a 1 micron ellipse is sampled as well as a metre one. */
function sample(pc: ParamCurve): Sample {
  if (isPoint(pc)) return { pts: [pc.at(0), pc.at(0)], ts: [0, 1], tol: 0 };
  const box = emptyBox();
  for (let i = 0; i <= 16; i++) boxAdd(box, pc.at(i / 16));
  const size = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  const tol = Math.min(FLATTEN_TOL, size * MIN_DIST_FLATTEN);
  const f = flattenParam(pc, tol);
  return { pts: f.pts, ts: f.ts, tol };
}

const BLOCK = 16;

function blocks(pts: Vec2[]): Box[] {
  const out: Box[] = [];
  for (let i = 0; i + 1 < pts.length; i += BLOCK) {
    const b = emptyBox();
    for (let k = i; k <= Math.min(i + BLOCK, pts.length - 1); k++) boxAdd(b, pts[k]);
    out.push(b);
  }
  return out;
}

const boxGap = (a: Box, b: Box): number => Math.hypot(
  Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY),
);

function pointSegmentGap(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(a.x + t * dx - px, a.y + t * dy - py);
}

/** segmentSegment's distance alone, with nothing allocated: this runs over every pair of sample segments. */
function segmentGap(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): number {
  const ax = a1.x - a0.x;
  const ay = a1.y - a0.y;
  const bx = b1.x - b0.x;
  const by = b1.y - b0.y;
  const den = ax * by - ay * bx;
  if (den !== 0) {
    const rx = b0.x - a0.x;
    const ry = b0.y - a0.y;
    const t = (rx * by - ry * bx) / den;
    const u = (rx * ay - ry * ax) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(
    pointSegmentGap(a0.x, a0.y, b0, b1), pointSegmentGap(a1.x, a1.y, b0, b1),
    pointSegmentGap(b0.x, b0.y, a0, a1), pointSegmentGap(b1.x, b1.y, a0, a1),
  );
}

interface Near { d: number; i: number; j: number; fa: number; fb: number }

/** Every pair of sample segments whose gap is within `slack` of the least. */
function nearSegments(sa: Sample, sb: Sample, slack: number): Near[] {
  const ba = blocks(sa.pts);
  const bb = blocks(sb.pts);
  let upper = Infinity;
  for (let x = 0; x < ba.length; x++) {
    for (let y = 0; y < bb.length; y++) upper = Math.min(upper, dist(sa.pts[x * BLOCK], sb.pts[y * BLOCK]));
  }
  let found: Near[] = [];
  for (let x = 0; x < ba.length; x++) {
    for (let y = 0; y < bb.length; y++) {
      if (boxGap(ba[x], bb[y]) > upper + slack) continue;
      const iEnd = Math.min((x + 1) * BLOCK, sa.pts.length - 1);
      const jEnd = Math.min((y + 1) * BLOCK, sb.pts.length - 1);
      for (let i = x * BLOCK; i < iEnd; i++) {
        for (let j = y * BLOCK; j < jEnd; j++) {
          const a0 = sa.pts[i];
          const a1 = sa.pts[i + 1];
          const b0 = sb.pts[j];
          const b1 = sb.pts[j + 1];
          const d = segmentGap(a0, a1, b0, b1);
          if (d > upper + slack) continue;
          upper = Math.min(upper, d);
          const n = segmentSegment(a0, a1, b0, b1);
          found.push({ d, i, j, fa: fraction(a0, a1, n.a), fb: fraction(b0, b1, n.b) });
        }
      }
      if (found.length > 4096) found = trim(found);
    }
  }
  return found.sort((p, q) => p.d - q.d);
}

/** Keeps the nearest few, the rest of a long near run adding nothing a polish from one of them would not. */
function trim(found: Near[]): Near[] {
  return found.sort((p, q) => p.d - q.d).slice(0, 1024);
}

function fraction(a: Vec2, b: Vec2, p: Vec2): number {
  const d = sub(b, a);
  const l2 = dot(d, d);
  return l2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), d) / l2));
}

function curved(A: ParamCurve, B: ParamCurve): Nearest {
  const sa = sample(A);
  const sb = sample(B);
  const moveA = !isPoint(A);
  const moveB = !isPoint(B);
  const slack = MIN_DIST_SLACK * (sa.tol + sb.tol);
  const near = nearSegments(sa, sb, slack);
  const starts: [number, number][] = [];
  const tried: Near[] = [];
  const least = near.length ? near[0].d : Infinity;
  for (const n of near) {
    if (n.d > least + slack || tried.length >= MIN_DIST_STARTS) break;
    if (tried.some((u) => Math.abs(u.i - n.i) <= 1 && Math.abs(u.j - n.j) <= 1)) continue;
    tried.push(n);
    starts.push([sa.ts[n.i] + (sa.ts[n.i + 1] - sa.ts[n.i]) * n.fa, sb.ts[n.j] + (sb.ts[n.j + 1] - sb.ts[n.j]) * n.fb]);
  }
  // The existing intersection code names crossings and touches; each is one more place to polish from.
  if (moveA && moveB && least <= slack) for (const h of intersect(A, B).slice(0, 8)) starts.push([h.ta, h.tb]);
  let best: Nearest | null = null;
  let at: [number, number] = [0, 0];
  for (const [s0, t0] of starts) {
    const [s, t] = newton(A, B, s0, t0, moveA, moveB);
    const n = pair(A.at(s), B.at(t));
    if (!best || n.distance < best.distance) {
      best = n;
      at = [s, t];
    }
    if (n.distance === 0) break;
  }
  if (!best) return pair(A.at(0), B.at(0));
  // Newton stops where the slope does; one search round the winner is a last check on what it left.
  const [s, t] = compass(A, B, at[0], at[1], moveA, moveB);
  const last = pair(A.at(s), B.at(t));
  return last.distance < best.distance ? last : best;
}

// ---------------------------------------------------------------------------
// Dispatch

/** Segments of a polyline against anything; text frames are the only polylines in a sketch. */
function overPolyline(P: ParamCurve, other: ParamCurve): Nearest {
  const pts = (P.shape as Extract<Shape, { kind: 'polyline' }>).pts;
  const out: Nearest[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push(minDistance(lineCurve(pts[i], pts[i + 1]), other));
  return nearest(out);
}

const RANK = { point: 0, line: 1, arc: 2 } as const;
const kindOf = (pc: ParamCurve): keyof typeof RANK | 'polyline' | 'other' => {
  const k = pc.shape.kind;
  return isPoint(pc) ? 'point' : k === 'line' || k === 'arc' || k === 'polyline' ? k : 'other';
};

/** The least distance between two curves, with the pair of points that makes it. */
export function minDistance(A: ParamCurve, B: ParamCurve): Nearest {
  const ka = kindOf(A);
  const kb = kindOf(B);
  if (ka === 'polyline') return overPolyline(A, B);
  if (kb === 'polyline') return flip(overPolyline(B, A));
  if (ka === 'other' || kb === 'other') return curved(A, B);
  if (RANK[ka] > RANK[kb]) return flip(minDistance(B, A));
  const a = A.at(0);
  const b = B.at(0);
  const sa = A.shape;
  const sb = B.shape;
  switch (ka) {
    case 'point':
      if (kb === 'point') return pair(a, b);
      if (kb === 'line') { const l = sb as LineShape; return pair(a, onSegment(a, l.a, l.b)); }
      return pair(a, onArc(a, sb as ArcShape));
    case 'line':
      if (kb === 'line') { const l = sa as LineShape; const m = sb as LineShape; return segmentSegment(l.a, l.b, m.a, m.b); }
      return segmentArc(sa as LineShape, sb as ArcShape);
    default:
      return arcArc(sa as ArcShape, sb as ArcShape);
  }
}

// ---------------------------------------------------------------------------
// Sketch objects

/** A point (the origin included) or a curve as a measurable shape. Text, axes, dimensions and the rest are not. */
function measurable(sketch: Sketch, id: Id): ParamCurve | null {
  if (id === ORIGIN || sketch.points[id]) return pointCurve(getPointPos(sketch, id));
  const c = sketch.curves[id];
  if (!c || c.type === 'text') return null;
  // A degree 1 control spline is a polyline, and a search for a smooth minimum has no use for its corners.
  if (c.type === 'controlSpline' && Math.min(c.degree, c.pts.length - 1) <= 1) return polylineCurve(c.pts.map((p) => getPointPos(sketch, p)), false);
  return resolve(sketch, c);
}

/** Min Distance of two sketch objects, or null when either is not something with a drawn shape. */
export function minDistanceBetween(sketch: Sketch, a: Id, b: Id): Nearest | null {
  const x = measurable(sketch, a);
  const y = measurable(sketch, b);
  if (!x || !y) return null;
  const n = minDistance(x, y);
  return Number.isFinite(n.distance) ? n : null;
}

/**
 * Everything the measure of this object reads, as a string: the same string is the same shape, so a caller
 * that kept the last answer can tell without measuring whether it still holds. Empty for an id that is not one.
 */
export function shapeKey(sketch: Sketch, id: Id): string {
  if (id === ORIGIN) return 'o';
  const p = sketch.points[id];
  if (p) return `p${p.x},${p.y}`;
  const c = sketch.curves[id];
  if (!c) return '';
  const at = curvePoints(c).map((q) => {
    const r = sketch.points[q];
    return r ? `${r.x},${r.y}` : '';
  });
  const extra = [
    c.type, c.type === 'circle' ? c.r : '', c.type === 'conic' ? c.rho : '', c.type === 'controlSpline' ? c.degree : '',
    c.type === 'fitSpline' ? c.closed : '',
  ];
  return `${extra.join(',')}|${at.join(';')}`;
}
