// Intersections between parametric curves. Analytic for lines, arcs and line-ellipse; everything else
// is a flattened search with Newton refinement, which also recovers tangent touches.
import type { Curve, Sketch, Vec2 } from '../model/types';
import {
  boxOfParam, closestOnParam, flattenParam, lengthOf, resolve, type Flattened, type ParamCurve,
} from './curves';
import {
  EPS_ANGLE, EPS_HIT, EPS_JOIN, EPS_PARAM, EPS_POINT, EPS_SELF, EPS_SELF_SPLIT, EPS_STEP, EPS_ZERO, NEWTON_ITERS,
  NEWTON_TOL, SEARCH_FLATTEN_TOL,
} from './tolerance';
import { boxAdd, boxesOverlap, cross, dist, dot, emptyBox, lerp, sub, TAU, wrapAngle, type Box } from './vec';

export interface Hit {
  /** Parameter on A. With extendA, outside [0, 1] means beyond the curve. */
  ta: number;
  tb: number;
  p: Vec2;
  tangent?: boolean;
}

export interface IntersectOptions {
  /** Treat A as its infinite line, or its whole circle or ellipse. */
  extendA?: boolean;
  extendB?: boolean;
}

interface Circ { c: Vec2; r: number; start: number; sweep: number }

function acceptT(t: number, length: number, extend: boolean | undefined): number | null {
  if (extend) return t;
  const eps = EPS_POINT / Math.max(length, EPS_ZERO);
  if (t < -eps || t > 1 + eps) return null;
  return Math.min(1, Math.max(0, t));
}

/** Parameter of an angle on an arc. In range it is [0, 1]; beyond, it runs on to one full turn. */
function arcParam(s: Circ, angle: number, extend: boolean | undefined, full: boolean): number | null {
  const dir = Math.sign(s.sweep) || 1;
  const span = Math.abs(s.sweep);
  const off = wrapAngle((angle - s.start) * dir);
  const t = off / span;
  if (full) return t >= 1 ? 0 : t;
  if (extend) return t;
  const eps = EPS_POINT / Math.max(s.r * span, EPS_ZERO);
  if (t <= 1 + eps) return Math.min(1, t);
  if (t >= TAU / span - eps) return 0;
  return null;
}

function lineLine(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2, oa: IntersectOptions): Hit[] {
  const da = sub(a1, a0);
  const db = sub(b1, b0);
  const c = cross(da, db);
  const la = Math.hypot(da.x, da.y);
  const lb = Math.hypot(db.x, db.y);
  if (Math.abs(c) <= EPS_ANGLE * la * lb) return [];
  const r = sub(b0, a0);
  const ta = acceptT(cross(r, db) / c, la, oa.extendA);
  const tb = acceptT(cross(r, da) / c, lb, oa.extendB);
  if (ta === null || tb === null) return [];
  return [{ ta, tb, p: lerp(a0, a1, ta) }];
}

function lineCircle(a0: Vec2, a1: Vec2, s: Circ, full: boolean, extendLine?: boolean, extendArc?: boolean): { tl: number; tc: number; p: Vec2; tangent: boolean }[] {
  const d = sub(a1, a0);
  const f = sub(a0, s.c);
  const A = dot(d, d);
  if (A < EPS_ZERO) return [];
  const B = 2 * dot(f, d);
  const C = dot(f, f) - s.r * s.r;
  const footDist = Math.abs(cross(f, d)) / Math.sqrt(A);
  const out: { tl: number; tc: number; p: Vec2; tangent: boolean }[] = [];
  const la = Math.sqrt(A);
  const push = (t: number, tangent: boolean): void => {
    const tl = acceptT(t, la, extendLine);
    if (tl === null) return;
    const p = lerp(a0, a1, tl);
    const tc = arcParam(s, Math.atan2(p.y - s.c.y, p.x - s.c.x), extendArc, full);
    if (tc !== null) out.push({ tl, tc, p, tangent });
  };
  if (Math.abs(footDist - s.r) < EPS_POINT) {
    push(-B / (2 * A), true);
    return out;
  }
  const disc = B * B - 4 * A * C;
  if (disc < 0) return out;
  const q = Math.sqrt(disc);
  push((-B - q) / (2 * A), false);
  push((-B + q) / (2 * A), false);
  return out;
}

function circleCircle(a: Circ, b: Circ, fullA: boolean, fullB: boolean, oa: IntersectOptions): Hit[] {
  const d = dist(a.c, b.c);
  if (d < EPS_ZERO) return [];
  if (d > a.r + b.r + EPS_POINT || d < Math.abs(a.r - b.r) - EPS_POINT) return [];
  const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const h2 = a.r * a.r - x * x;
  const ux = (b.c.x - a.c.x) / d;
  const uy = (b.c.y - a.c.y) / d;
  const m = { x: a.c.x + ux * x, y: a.c.y + uy * x };
  const tangent = Math.abs(d - (a.r + b.r)) < EPS_POINT || Math.abs(d - Math.abs(a.r - b.r)) < EPS_POINT;
  const pts: Vec2[] = [];
  if (tangent || h2 <= 0) pts.push(m);
  else {
    const h = Math.sqrt(h2);
    pts.push({ x: m.x - uy * h, y: m.y + ux * h }, { x: m.x + uy * h, y: m.y - ux * h });
  }
  const out: Hit[] = [];
  for (const p of pts) {
    const ta = arcParam(a, Math.atan2(p.y - a.c.y, p.x - a.c.x), oa.extendA, fullA);
    const tb = arcParam(b, Math.atan2(p.y - b.c.y, p.x - b.c.x), oa.extendB, fullB);
    if (ta !== null && tb !== null) out.push({ ta, tb, p, ...(tangent ? { tangent: true } : {}) });
  }
  return out;
}

function lineEllipse(a0: Vec2, a1: Vec2, s: Extract<ParamCurve['shape'], { kind: 'ellipse' }>, full: boolean, extendLine?: boolean, extendEll?: boolean): { tl: number; tc: number; p: Vec2; tangent: boolean }[] {
  const cr = Math.cos(-s.rot);
  const sr = Math.sin(-s.rot);
  const toUnit = (p: Vec2): Vec2 => {
    const r = sub(p, s.c);
    return { x: (r.x * cr - r.y * sr) / s.rx, y: (r.x * sr + r.y * cr) / s.ry };
  };
  const u0 = toUnit(a0);
  const u1 = toUnit(a1);
  const unit: Circ = { c: { x: 0, y: 0 }, r: 1, start: s.start, sweep: s.sweep };
  const hits = lineCircle(u0, u1, unit, full, true, extendEll);
  const out: { tl: number; tc: number; p: Vec2; tangent: boolean }[] = [];
  const la = dist(a0, a1);
  for (const h of hits) {
    const tl = acceptT(h.tl, la, extendLine);
    if (tl === null) continue;
    out.push({ tl, tc: h.tc, p: lerp(a0, a1, tl), tangent: h.tangent });
  }
  return out;
}

interface Chunk { from: number; to: number; box: Box }

function chunks(f: Flattened, size = 16): Chunk[] {
  const out: Chunk[] = [];
  for (let i = 0; i + 1 < f.pts.length; i += size) {
    const to = Math.min(i + size, f.pts.length - 1);
    const box = emptyBox();
    for (let k = i; k <= to; k++) boxAdd(box, f.pts[k]);
    out.push({ from: i, to, box });
  }
  return out;
}

function segSeg(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): [number, number] | null {
  const da = sub(a1, a0);
  const db = sub(b1, b0);
  const c = cross(da, db);
  if (Math.abs(c) < EPS_ZERO) return null;
  const r = sub(b0, a0);
  const s = cross(r, db) / c;
  const t = cross(r, da) / c;
  const e = EPS_PARAM;
  return s >= -e && s <= 1 + e && t >= -e && t <= 1 + e ? [s, t] : null;
}

/** Solve A(s) = B(t). */
function newtonRoot(A: ParamCurve, B: ParamCurve, s0: number, t0: number): { s: number; t: number; res: number } {
  let s = s0;
  let t = t0;
  let res = Infinity;
  for (let i = 0; i < NEWTON_ITERS; i++) {
    const r = sub(A.at(s), B.at(t));
    res = Math.hypot(r.x, r.y);
    if (res < NEWTON_TOL) break;
    const da = A.d1(s);
    const db = B.d1(t);
    const det = -da.x * db.y + db.x * da.y;
    if (Math.abs(det) < EPS_ZERO) break;
    const ds = (r.x * db.y - r.y * db.x) / det;
    const dt = (da.x * r.y - da.y * r.x) / -det;
    s = clampParam(A, s + ds);
    t = clampParam(B, t + dt);
  }
  return { s, t, res };
}

function clampParam(pc: ParamCurve, t: number): number {
  return pc.closed ? t - Math.floor(t) : Math.min(1, Math.max(0, t));
}

/** Minimise |A(s) - B(t)|, for touches that never cross. */
function newtonTouch(A: ParamCurve, B: ParamCurve, s0: number, t0: number): { s: number; t: number; res: number } {
  let s = s0;
  let t = t0;
  for (let i = 0; i < NEWTON_ITERS; i++) {
    const r = sub(A.at(s), B.at(t));
    const da = A.d1(s);
    const db = B.d1(t);
    const dda = A.d2(s);
    const ddb = B.d2(t);
    const f1 = dot(r, da);
    const f2 = -dot(r, db);
    const j11 = dot(da, da) + dot(r, dda);
    const j12 = -dot(da, db);
    const j22 = dot(db, db) - dot(r, ddb);
    const det = j11 * j22 - j12 * j12;
    if (Math.abs(det) < EPS_ZERO) break;
    const ds = (j22 * f1 - j12 * f2) / det;
    const dt = (j11 * f2 - j12 * f1) / det;
    s = clampParam(A, s - ds);
    t = clampParam(B, t - dt);
    if (Math.abs(ds) + Math.abs(dt) < EPS_STEP) break;
  }
  return { s, t, res: dist(A.at(s), B.at(t)) };
}

function numeric(A: ParamCurve, B: ParamCurve, fa: Flattened, fb: Flattened): Hit[] {
  const out: Hit[] = [];
  const near: { i: number; j: number; d: number }[] = [];
  const nearTol = SEARCH_FLATTEN_TOL * 2;
  const ca = chunks(fa);
  const cb = chunks(fb);
  for (const x of ca) {
    for (const y of cb) {
      if (!boxesOverlap(x.box, y.box, nearTol)) continue;
      for (let i = x.from; i < x.to; i++) {
        for (let j = y.from; j < y.to; j++) {
          const a0 = fa.pts[i];
          const a1 = fa.pts[i + 1];
          const b0 = fb.pts[j];
          const b1 = fb.pts[j + 1];
          const hit = segSeg(a0, a1, b0, b1);
          if (hit) {
            const s = fa.ts[i] + (fa.ts[i + 1] - fa.ts[i]) * hit[0];
            const t = fb.ts[j] + (fb.ts[j + 1] - fb.ts[j]) * hit[1];
            const r = newtonRoot(A, B, s, t);
            if (r.res < EPS_JOIN) out.push({ ta: r.s, tb: r.t, p: A.at(r.s) });
            else near.push({ i, j, d: 0 });
          } else {
            const ma = lerp(a0, a1, 0.5);
            const mb = lerp(b0, b1, 0.5);
            const d = dist(ma, mb);
            if (d < nearTol + (dist(a0, a1) + dist(b0, b1)) / 2) near.push({ i, j, d });
          }
        }
      }
    }
  }
  near.sort((p, q) => p.d - q.d);
  const tried: { i: number; j: number }[] = [];
  for (const c of near) {
    if (tried.length >= 24) break;
    if (tried.some((u) => Math.abs(u.i - c.i) < 4 && Math.abs(u.j - c.j) < 4)) continue;
    tried.push(c);
    const r = newtonTouch(
      A, B, (fa.ts[c.i] + fa.ts[c.i + 1]) / 2, (fb.ts[c.j] + fb.ts[c.j + 1]) / 2,
    );
    if (r.res < EPS_POINT * 10) out.push({ ta: r.s, tb: r.t, p: A.at(r.s), tangent: true });
  }
  return out;
}

function endpointTouches(A: ParamCurve, B: ParamCurve, flip: boolean): Hit[] {
  if (A.closed) return [];
  const out: Hit[] = [];
  for (const ta of [0, 1]) {
    const p = A.at(ta);
    const c = closestOnParam(B, p);
    if (c.dist < EPS_POINT * 10) out.push(flip ? { ta: c.t, tb: ta, p } : { ta, tb: c.t, p });
  }
  return out;
}

function near(a: number, b: number, closed: boolean, eps: number): boolean {
  const d = Math.abs(a - b);
  return d < eps || (closed && Math.abs(d - 1) < eps);
}

function dedupe(hits: Hit[], A: ParamCurve, B: ParamCurve): Hit[] {
  const la = Math.max(lengthOf(A), EPS_ZERO);
  const lb = Math.max(lengthOf(B), EPS_ZERO);
  const ea = EPS_HIT / la;
  const eb = EPS_HIT / lb;
  const out: Hit[] = [];
  for (const h of hits) {
    const dup = out.find((o) => near(o.ta, h.ta, A.closed, ea) && near(o.tb, h.tb, B.closed, eb));
    if (!dup) out.push(h);
    else if (h.tangent) dup.tangent = true;
  }
  return out.sort((x, y) => x.ta - y.ta);
}

const isArcLike = (s: ParamCurve['shape']): s is Extract<ParamCurve['shape'], { kind: 'arc' }> => s.kind === 'arc';

function analytic(A: ParamCurve, B: ParamCurve, o: IntersectOptions): Hit[] | null {
  const sa = A.shape;
  const sb = B.shape;
  if (sa.kind === 'line' && sb.kind === 'line') return lineLine(sa.a, sa.b, sb.a, sb.b, o);
  if (sa.kind === 'line' && isArcLike(sb)) {
    return lineCircle(sa.a, sa.b, sb, B.closed, o.extendA, o.extendB)
      .map((h) => ({ ta: h.tl, tb: h.tc, p: h.p, ...(h.tangent ? { tangent: true } : {}) }));
  }
  if (isArcLike(sa) && sb.kind === 'line') {
    return lineCircle(sb.a, sb.b, sa, A.closed, o.extendB, o.extendA)
      .map((h) => ({ ta: h.tc, tb: h.tl, p: h.p, ...(h.tangent ? { tangent: true } : {}) }));
  }
  if (isArcLike(sa) && isArcLike(sb)) return circleCircle(sa, sb, A.closed, B.closed, o);
  if (sa.kind === 'line' && sb.kind === 'ellipse') {
    return lineEllipse(sa.a, sa.b, sb, B.closed, o.extendA, o.extendB)
      .map((h) => ({ ta: h.tl, tb: h.tc, p: h.p, ...(h.tangent ? { tangent: true } : {}) }));
  }
  if (sa.kind === 'ellipse' && sb.kind === 'line') {
    return lineEllipse(sb.a, sb.b, sa, A.closed, o.extendB, o.extendA)
      .map((h) => ({ ta: h.tc, tb: h.tl, p: h.p, ...(h.tangent ? { tangent: true } : {}) }));
  }
  return null;
}

/** Bounding box enlarged for an infinite line clipped to another box. */
function extendedLine(pc: ParamCurve, target: Box): ParamCurve | null {
  const s = pc.shape;
  if (s.kind !== 'line') return null;
  const d = sub(s.b, s.a);
  const l = Math.hypot(d.x, d.y);
  if (l < EPS_ZERO) return null;
  const c = { x: (target.minX + target.maxX) / 2, y: (target.minY + target.maxY) / 2 };
  const reach = Math.hypot(target.maxX - target.minX, target.maxY - target.minY) + dist(s.a, c) + l;
  const u = { x: d.x / l, y: d.y / l };
  return {
    ...pc,
    at: (t) => ({ x: s.a.x + u.x * t * reach, y: s.a.y + u.y * t * reach }),
    d1: () => ({ x: u.x * reach, y: u.y * reach }),
  };
}

/** All intersections of A and B, sorted by ta. */
export function intersect(A: ParamCurve, B: ParamCurve, opts: IntersectOptions = {}): Hit[] {
  const direct = analytic(A, B, opts);
  const extended = opts.extendA || opts.extendB;
  if (!extended) {
    const pad = EPS_JOIN;
    if (!boxesOverlap(boxOfParam(A), boxOfParam(B), pad)) return [];
  }
  let hits: Hit[];
  if (direct) hits = direct;
  else hits = numericWithExtension(A, B, opts);
  if (!extended) hits = [...hits, ...endpointTouches(A, B, false), ...endpointTouches(B, A, true)];
  return dedupe(hits, A, B);
}

function numericWithExtension(A: ParamCurve, B: ParamCurve, opts: IntersectOptions): Hit[] {
  if (opts.extendA && A.shape.kind === 'line') return viaInfiniteLine(A, B, false);
  if (opts.extendB && B.shape.kind === 'line') return viaInfiniteLine(B, A, true);
  const X = opts.extendA ? fullCurve(A) : A;
  const Y = opts.extendB ? fullCurve(B) : B;
  const hits = numeric(X, Y, flattenParam(X, SEARCH_FLATTEN_TOL), flattenParam(Y, SEARCH_FLATTEN_TOL));
  return hits.map((h) => ({
    ...h,
    ta: X === A ? h.ta : unfull(A, h.ta),
    tb: Y === B ? h.tb : unfull(B, h.tb),
  }));
}

function viaInfiniteLine(lineC: ParamCurve, other: ParamCurve, flip: boolean): Hit[] {
  const box = boxOfParam(other);
  const s = lineC.shape as Extract<ParamCurve['shape'], { kind: 'line' }>;
  const ext = extendedLine(lineC, box);
  if (!ext) return [];
  const span = dist(s.a, s.b);
  const scanned: ParamCurve = {
    ...ext,
    closed: false,
    at: (t) => ext.at(2 * t - 1),
    d1: (t) => {
      const d = ext.d1(t);
      return { x: d.x * 2, y: d.y * 2 };
    },
  };
  const reach = Math.hypot(scanned.d1(0).x, scanned.d1(0).y) / 2;
  const seg: Flattened = { pts: [scanned.at(0), scanned.at(1)], ts: [0, 1] };
  const hits = numeric(scanned, other, seg, flattenParam(other, SEARCH_FLATTEN_TOL));
  return hits.map((h) => {
    const t = ((2 * h.ta - 1) * reach) / span;
    return flip ? { ta: h.tb, tb: t, p: h.p, tangent: h.tangent } : { ta: t, tb: h.tb, p: h.p, tangent: h.tangent };
  });
}

function fullCurve(pc: ParamCurve): ParamCurve {
  const s = pc.shape;
  if (s.kind === 'arc' || s.kind === 'ellipse') {
    const sweep = TAU * (Math.sign(s.sweep) || 1);
    const f = sweep / s.sweep;
    return {
      shape: { ...s, sweep },
      closed: true,
      at: (t) => pc.at(t * f),
      d1: (t) => {
        const d = pc.d1(t * f);
        return { x: d.x * f, y: d.y * f };
      },
      d2: (t) => {
        const d = pc.d2(t * f);
        return { x: d.x * f * f, y: d.y * f * f };
      },
    };
  }
  return pc;
}

function unfull(pc: ParamCurve, t: number): number {
  const s = pc.shape;
  return s.kind === 'arc' || s.kind === 'ellipse' ? (t * TAU) / Math.abs(s.sweep) : t;
}

/** Intersections between two stored curves. Text never intersects. */
export function intersectCurves(sketch: Sketch, a: Curve, b: Curve, opts: IntersectOptions = {}): Hit[] {
  if (a.type === 'text' || b.type === 'text') return [];
  return intersect(resolve(sketch, a), resolve(sketch, b), opts);
}

export interface SelfHit { t1: number; t2: number; p: Vec2 }

/** Where a curve crosses itself; t1 < t2. Lines, arcs and ellipses cannot, so they return nothing. */
export function selfIntersections(pc: ParamCurve): SelfHit[] {
  const kind = pc.shape.kind;
  if (kind !== 'spline' && kind !== 'polyline') return [];
  const f = flattenParam(pc, SEARCH_FLATTEN_TOL);
  const n = f.pts.length - 1;
  const out: SelfHit[] = [];
  const blocks = chunks(f);
  for (let bi = 0; bi < blocks.length; bi++) {
    for (let bj = bi; bj < blocks.length; bj++) {
      if (!boxesOverlap(blocks[bi].box, blocks[bj].box)) continue;
      for (let i = blocks[bi].from; i < blocks[bi].to; i++) {
        const startJ = Math.max(blocks[bj].from, i + 2);
        for (let j = startJ; j < blocks[bj].to; j++) {
          if (pc.closed && i === 0 && j === n - 1) continue;
          const hit = segSeg(f.pts[i], f.pts[i + 1], f.pts[j], f.pts[j + 1]);
          if (!hit) continue;
          const s = f.ts[i] + (f.ts[i + 1] - f.ts[i]) * hit[0];
          const t = f.ts[j] + (f.ts[j + 1] - f.ts[j]) * hit[1];
          const r = newtonRoot(pc, pc, s, t);
          const [t1, t2] = r.res < EPS_JOIN && Math.abs(r.s - r.t) > EPS_SELF_SPLIT ? [r.s, r.t] : [s, t];
          const p = pc.at(t1);
          if (!out.some((o) => dist(o.p, p) < EPS_JOIN && Math.abs(o.t1 - t1) < EPS_SELF)) out.push({ t1, t2, p });
        }
      }
    }
  }
  return out;
}
