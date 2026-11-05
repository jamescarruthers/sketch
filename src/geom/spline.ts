// FitSpline: chord-length C2 cubic interpolation. ControlSpline: clamped uniform B-spline.
import type { ControlSpline, FitSpline, Sketch, Vec2 } from '../model/types';
import { getPointPos } from '../model/document';
import { EPS_CHORD, EPS_RIDGE, EPS_ZERO, SOLVER_SAMPLES_PER_SPAN } from './tolerance';
import { dist, scale, sub } from './vec';

/** Uniform evaluation of a spline over t in [0, 1]. Closed splines wrap outside that range. */
export interface SplineEval {
  at(t: number): Vec2;
  d1(t: number): Vec2;
  d2(t: number): Vec2;
  /** Number of polynomial spans, a hint for sampling density. */
  spans: number;
  /** Where the polynomial pieces join, as t in [0, 1], both ends included. */
  breaks?: number[];
  closed: boolean;
}

// ---------------------------------------------------------------------------
// Linear solvers

function solveDense(mat: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = mat.map((r) => [...r]);
  const b = [...rhs];
  for (let c = 0; c < n; c++) {
    let best = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[best][c])) best = r;
    if (Math.abs(a[best][c]) < EPS_ZERO) continue;
    [a[c], a[best]] = [a[best], a[c]];
    [b[c], b[best]] = [b[best], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) a[r][k] -= f * a[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k];
    x[r] = Math.abs(a[r][r]) < EPS_ZERO ? 0 : s / a[r][r];
  }
  return x;
}

function solveTridiagonal(lower: number[], diag: number[], upper: number[], rhs: number[]): number[] {
  const n = diag.length;
  const c = new Array<number>(n).fill(0);
  const d = new Array<number>(n).fill(0);
  c[0] = upper[0] / diag[0];
  d[0] = rhs[0] / diag[0];
  for (let i = 1; i < n; i++) {
    const m = diag[i] - lower[i] * c[i - 1];
    c[i] = upper[i] / m;
    d[i] = (rhs[i] - lower[i] * d[i - 1]) / m;
  }
  for (let i = n - 2; i >= 0; i--) d[i] -= c[i] * d[i + 1];
  return d;
}

/** Sherman-Morrison on a tridiagonal system with corner terms lower[0] and upper[n-1]. */
function solveCyclic(lower: number[], diag: number[], upper: number[], rhs: number[]): number[] {
  const n = diag.length;
  if (n < 5) {
    const m = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      m[i][i] += diag[i];
      m[i][(i + 1) % n] += upper[i];
      m[i][(i + n - 1) % n] += lower[i];
    }
    return solveDense(m, rhs);
  }
  const alpha = upper[n - 1];
  const beta = lower[0];
  const gamma = -diag[0];
  const d2 = [...diag];
  d2[0] -= gamma;
  d2[n - 1] -= (alpha * beta) / gamma;
  const x = solveTridiagonal(lower, d2, upper, rhs);
  const u = new Array<number>(n).fill(0);
  u[0] = gamma;
  u[n - 1] = alpha;
  const z = solveTridiagonal(lower, d2, upper, u);
  const fact = (x[0] + (beta * x[n - 1]) / gamma) / (1 + z[0] + (beta * z[n - 1]) / gamma);
  return x.map((v, i) => v - fact * z[i]);
}

// ---------------------------------------------------------------------------
// Fit spline

interface Hermite { u: number[]; p: Vec2[]; d: Vec2[]; total: number; closed: boolean }

function chordParams(pts: Vec2[], closed: boolean): number[] {
  const n = pts.length;
  const h: number[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) h.push(Math.max(dist(pts[i], pts[(i + 1) % n]), EPS_CHORD));
  return h;
}

/** Tangent at a fit point from its handle; a handle a third of the local chord gives unit speed. */
export function handleTangent(point: Vec2, handle: Vec2, localChord: number): Vec2 {
  return scale(sub(handle, point), 3 / Math.max(localChord, EPS_CHORD));
}

/** Inverse of handleTangent: where to put a handle for a given tangent. */
export function tangentHandle(point: Vec2, tangent: Vec2, localChord: number): Vec2 {
  const s = localChord / 3;
  return { x: point.x + tangent.x * s, y: point.y + tangent.y * s };
}

/** Mean of the chords adjacent to fit point i. */
export function localChord(pts: Vec2[], i: number, closed: boolean): number {
  const n = pts.length;
  const chords = chordParams(pts, closed);
  if (closed) return (chords[(i + n - 1) % n] + chords[i]) / 2;
  if (i === 0) return chords[0];
  if (i === n - 1) return chords[n - 2];
  return (chords[i - 1] + chords[i]) / 2;
}

function buildHermite(pts: Vec2[], closed: boolean, handles: (Vec2 | null)[]): Hermite {
  const n = pts.length;
  if (n === 1) return { u: [0, 1], p: [pts[0], pts[0]], d: [{ x: 0, y: 0 }, { x: 0, y: 0 }], total: 1, closed: false };
  const useClosed = closed && n >= 3;
  const h = chordParams(pts, useClosed);
  const lower = new Array<number>(n).fill(0);
  const diag = new Array<number>(n).fill(1);
  const upper = new Array<number>(n).fill(0);
  const rx = new Array<number>(n).fill(0);
  const ry = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    const handle = handles[i];
    if (handle) {
      const t = handleTangent(pts[i], handle, localChord(pts, i, useClosed));
      rx[i] = t.x;
      ry[i] = t.y;
      continue;
    }
    if (!useClosed && i === 0) {
      diag[i] = 2 / h[0];
      upper[i] = 1 / h[0];
      rx[i] = (3 * (pts[1].x - pts[0].x)) / (h[0] * h[0]);
      ry[i] = (3 * (pts[1].y - pts[0].y)) / (h[0] * h[0]);
    } else if (!useClosed && i === n - 1) {
      const hl = h[n - 2];
      lower[i] = 1 / hl;
      diag[i] = 2 / hl;
      rx[i] = (3 * (pts[n - 1].x - pts[n - 2].x)) / (hl * hl);
      ry[i] = (3 * (pts[n - 1].y - pts[n - 2].y)) / (hl * hl);
    } else {
      const hp = h[(i + n - 1) % n];
      const hn = h[i];
      const prev = pts[(i + n - 1) % n];
      const next = pts[(i + 1) % n];
      lower[i] = 1 / hp;
      diag[i] = 2 * (1 / hp + 1 / hn);
      upper[i] = 1 / hn;
      rx[i] = 3 * ((pts[i].x - prev.x) / (hp * hp) + (next.x - pts[i].x) / (hn * hn));
      ry[i] = 3 * ((pts[i].y - prev.y) / (hp * hp) + (next.y - pts[i].y) / (hn * hn));
    }
  }
  const solve = useClosed ? solveCyclic : solveTridiagonal;
  const dx = solve(lower, diag, upper, rx);
  const dy = solve(lower, diag, upper, ry);
  const d = dx.map((x, i) => ({ x, y: dy[i] }));

  const u = [0];
  for (const c of h) u.push(u[u.length - 1] + c);
  const p = useClosed ? [...pts, pts[0]] : pts;
  const dd = useClosed ? [...d, d[0]] : d;
  return { u, p, d: dd, total: u[u.length - 1], closed: useClosed };
}

function spanOf(u: number[], x: number): number {
  let lo = 0;
  let hi = u.length - 2;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (u[m] <= x) lo = m;
    else hi = m - 1;
  }
  return lo;
}

function hermiteEval(s: Hermite): SplineEval {
  const wrap = (t: number): number => {
    if (!s.closed) return t;
    const r = t - Math.floor(t);
    return r;
  };
  const coef = (t: number) => {
    const x = wrap(t) * s.total;
    const i = spanOf(s.u, x);
    const h = s.u[i + 1] - s.u[i];
    return { i, h, r: (x - s.u[i]) / h };
  };
  return {
    spans: s.u.length - 1,
    breaks: s.u.map((u) => u / s.total),
    closed: s.closed,
    at(t) {
      const { i, h, r } = coef(t);
      const r2 = r * r;
      const r3 = r2 * r;
      const h00 = 2 * r3 - 3 * r2 + 1;
      const h10 = r3 - 2 * r2 + r;
      const h01 = -2 * r3 + 3 * r2;
      const h11 = r3 - r2;
      const p0 = s.p[i];
      const p1 = s.p[i + 1];
      const d0 = s.d[i];
      const d1 = s.d[i + 1];
      return {
        x: h00 * p0.x + h * h10 * d0.x + h01 * p1.x + h * h11 * d1.x,
        y: h00 * p0.y + h * h10 * d0.y + h01 * p1.y + h * h11 * d1.y,
      };
    },
    d1(t) {
      const { i, h, r } = coef(t);
      const r2 = r * r;
      const a = (6 * r2 - 6 * r) / h;
      const b = 3 * r2 - 4 * r + 1;
      const c = -a;
      const e = 3 * r2 - 2 * r;
      const p0 = s.p[i];
      const p1 = s.p[i + 1];
      const d0 = s.d[i];
      const d1 = s.d[i + 1];
      return {
        x: (a * p0.x + b * d0.x + c * p1.x + e * d1.x) * s.total,
        y: (a * p0.y + b * d0.y + c * p1.y + e * d1.y) * s.total,
      };
    },
    d2(t) {
      const { i, h, r } = coef(t);
      const a = (12 * r - 6) / (h * h);
      const b = (6 * r - 4) / h;
      const c = -a;
      const e = (6 * r - 2) / h;
      const p0 = s.p[i];
      const p1 = s.p[i + 1];
      const d0 = s.d[i];
      const d1 = s.d[i + 1];
      const k = s.total * s.total;
      return {
        x: (a * p0.x + b * d0.x + c * p1.x + e * d1.x) * k,
        y: (a * p0.y + b * d0.y + c * p1.y + e * d1.y) * k,
      };
    },
  };
}

/** Evaluator for an interpolating spline through pts. handles[i] activates a tangent at fit point i. */
export function fitSplineEval(pts: Vec2[], closed: boolean, handles: (Vec2 | null)[] = []): SplineEval {
  return hermiteEval(buildHermite(pts, closed, handles));
}

// ---------------------------------------------------------------------------
// B-spline

export interface BSpline { degree: number; knots: number[]; ctrl: Vec2[] }

/** Clamped uniform knots in [0, 1]. Degree drops when there are too few points, so drafts still draw. */
export function clampedBSpline(ctrl: Vec2[], degree: number): BSpline {
  const p = Math.min(degree, ctrl.length - 1);
  const spans = ctrl.length - p;
  const knots: number[] = [];
  for (let i = 0; i <= p; i++) knots.push(0);
  for (let i = 1; i < spans; i++) knots.push(i / spans);
  for (let i = 0; i <= p; i++) knots.push(1);
  return { degree: p, knots, ctrl };
}

function findSpan(b: BSpline, u: number): number {
  const n = b.ctrl.length - 1;
  if (u >= b.knots[n + 1]) return n;
  if (u <= b.knots[b.degree]) return b.degree;
  let lo = b.degree;
  let hi = n + 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (u < b.knots[m]) hi = m;
    else lo = m;
  }
  return lo;
}

/** de Boor evaluation at u in [0, 1]. */
export function deBoor(b: BSpline, u: number): Vec2 {
  const p = b.degree;
  const k = findSpan(b, u);
  if (p <= 0) return b.ctrl[k];
  const d: Vec2[] = [];
  for (let j = 0; j <= p; j++) d.push(b.ctrl[j + k - p]);
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const den = b.knots[i + p - r + 1] - b.knots[i];
      const a = den === 0 ? 0 : (u - b.knots[i]) / den;
      d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y };
    }
  }
  return d[p];
}

function derivative(b: BSpline): BSpline {
  const p = b.degree;
  if (p === 0) return { degree: 0, knots: [0, 1], ctrl: [{ x: 0, y: 0 }] };
  const ctrl: Vec2[] = [];
  for (let i = 0; i < b.ctrl.length - 1; i++) {
    const den = b.knots[i + p + 1] - b.knots[i + 1];
    const f = den === 0 ? 0 : p / den;
    ctrl.push({ x: (b.ctrl[i + 1].x - b.ctrl[i].x) * f, y: (b.ctrl[i + 1].y - b.ctrl[i].y) * f });
  }
  return { degree: p - 1, knots: b.knots.slice(1, -1), ctrl };
}

/** Evaluator for a clamped uniform B-spline. */
export function controlSplineEval(ctrl: Vec2[], degree: number): SplineEval {
  if (ctrl.length === 1) {
    return { spans: 1, closed: false, at: () => ctrl[0], d1: () => ({ x: 0, y: 0 }), d2: () => ({ x: 0, y: 0 }) };
  }
  const b = clampedBSpline(ctrl, degree);
  const b1 = derivative(b);
  const b2 = derivative(b1);
  const clamp = (t: number): number => Math.min(1, Math.max(0, t));
  return {
    spans: ctrl.length - b.degree,
    breaks: [...new Set(b.knots)],
    closed: false,
    at: (t) => deBoor(b, clamp(t)),
    d1: (t) => deBoor(b1, clamp(t)),
    d2: (t) => deBoor(b2, clamp(t)),
  };
}

function basisRow(b: BSpline, u: number): number[] {
  const n = b.ctrl.length;
  const p = b.degree;
  const k = findSpan(b, u);
  const N = new Array<number>(p + 1).fill(0);
  const left = new Array<number>(p + 1).fill(0);
  const right = new Array<number>(p + 1).fill(0);
  N[0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = u - b.knots[k + 1 - j];
    right[j] = b.knots[k + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const den = right[r + 1] + left[j - r];
      const t = den === 0 ? 0 : N[r] / den;
      N[r] = saved + right[r + 1] * t;
      saved = left[j - r] * t;
    }
    N[j] = saved;
  }
  const row = new Array<number>(n).fill(0);
  for (let j = 0; j <= p; j++) row[k - p + j] = N[j];
  return row;
}

/**
 * Least-squares clamped uniform B-spline through samples, ends interpolated. Params default to
 * normalised chord length. Used for degree change, insertion and trimming control splines.
 */
export function fitControlPoints(samples: Vec2[], degree: number, count: number, params?: number[]): Vec2[] {
  const n = Math.max(count, degree + 1);
  const seed = new Array<Vec2>(n).fill({ x: 0, y: 0 });
  const b = clampedBSpline(seed, degree);
  let us = params;
  if (!us) {
    const acc = [0];
    for (let i = 1; i < samples.length; i++) acc.push(acc[i - 1] + dist(samples[i - 1], samples[i]));
    const total = acc[acc.length - 1] || 1;
    us = acc.map((a) => a / total);
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (n === 2) return [first, last];

  const free = n - 2;
  const ata = Array.from({ length: free }, () => new Array<number>(free).fill(0));
  const atx = new Array<number>(free).fill(0);
  const aty = new Array<number>(free).fill(0);
  for (let s = 0; s < samples.length; s++) {
    const row = basisRow(b, us[s]);
    const rx = samples[s].x - row[0] * first.x - row[n - 1] * last.x;
    const ry = samples[s].y - row[0] * first.y - row[n - 1] * last.y;
    for (let i = 0; i < free; i++) {
      const ri = row[i + 1];
      if (ri === 0) continue;
      atx[i] += ri * rx;
      aty[i] += ri * ry;
      for (let j = 0; j < free; j++) ata[i][j] += ri * row[j + 1];
    }
  }
  for (let i = 0; i < free; i++) ata[i][i] += EPS_RIDGE;
  const x = solveDense(ata, atx);
  const y = solveDense(ata, aty);
  return [first, ...x.map((vx, i) => ({ x: vx, y: y[i] })), last];
}

/** Control points approximating a spline in a new degree, keeping span count [ref spline degree]. */
export function changeDegree(ctrl: Vec2[], from: number, to: number): Vec2[] {
  if (from === to) return [...ctrl];
  const ev = controlSplineEval(ctrl, from);
  const spans = ctrl.length - Math.min(from, ctrl.length - 1);
  const count = spans + to;
  const samples: Vec2[] = [];
  const params: number[] = [];
  const m = Math.max(count * 8, 64);
  for (let i = 0; i <= m; i++) {
    params.push(i / m);
    samples.push(ev.at(i / m));
  }
  return fitControlPoints(samples, to, count, params);
}

// ---------------------------------------------------------------------------
// Sketch-level helpers

/** Evaluator for a sketch spline. */
export function splineEval(curve: FitSpline | ControlSpline, sketch: Sketch): SplineEval {
  const pts = curve.pts.map((p) => getPointPos(sketch, p));
  if (curve.type === 'controlSpline') return controlSplineEval(pts, curve.degree);
  return fitSplineEval(pts, curve.closed, curve.handles.map((h) => (h ? getPointPos(sketch, h) : null)));
}

/** Dense samples along a spline, for the solver bridge's point-on-spline iteration. */
export function splineSamples(curve: FitSpline | ControlSpline, sketch: Sketch): [number, number][] {
  const ev = splineEval(curve, sketch);
  const n = Math.max(ev.spans, 1) * SOLVER_SAMPLES_PER_SPAN;
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const p = ev.at(ev.closed && i === n ? 0 : i / n);
    out.push([p.x, p.y]);
  }
  return out;
}

export interface CombTooth { p: Vec2; tip: Vec2; curvature: number; t: number }

/**
 * Curvature comb teeth along a spline. Tooth length is curvature * scaleFactor along the left normal;
 * scaleFactor defaults so the largest tooth is a fifth of the curve's rough size.
 */
export function curvatureComb(ev: SplineEval, teeth = 100, scaleFactor?: number): CombTooth[] {
  const out: CombTooth[] = [];
  let maxK = 0;
  let span = 0;
  let prev: Vec2 | null = null;
  for (let i = 0; i <= teeth; i++) {
    const t = i / teeth;
    const p = ev.at(t);
    const d = ev.d1(t);
    const dd = ev.d2(t);
    const sp = Math.hypot(d.x, d.y);
    const k = sp < EPS_ZERO ? 0 : (d.x * dd.y - d.y * dd.x) / (sp * sp * sp);
    out.push({ p, tip: p, curvature: k, t });
    maxK = Math.max(maxK, Math.abs(k));
    if (prev) span += dist(prev, p);
    prev = p;
  }
  const f = scaleFactor ?? (maxK > 0 ? span / (5 * maxK) : 0);
  for (const tooth of out) {
    const d = ev.d1(tooth.t);
    const sp = Math.hypot(d.x, d.y) || 1;
    tooth.tip = { x: tooth.p.x - (d.y / sp) * tooth.curvature * f, y: tooth.p.y + (d.x / sp) * tooth.curvature * f };
  }
  return out;
}
