// Rational quadratic Bezier with shape parameter rho: w = rho / (1 - rho). rho 0.5 is a parabola,
// below is elliptical, above hyperbolic.
import type { Vec2 } from '../model/types';
import { add, dist, scale, sub } from './vec';

export interface ConicArc { a: Vec2; v: Vec2; b: Vec2; rho: number }

const weight = (rho: number): number => rho / (1 - rho);

export function conicPoint(c: ConicArc, t: number): Vec2 {
  const w = weight(c.rho);
  const b0 = (1 - t) * (1 - t);
  const b1 = 2 * t * (1 - t) * w;
  const b2 = t * t;
  const d = b0 + b1 + b2;
  return { x: (b0 * c.a.x + b1 * c.v.x + b2 * c.b.x) / d, y: (b0 * c.a.y + b1 * c.v.y + b2 * c.b.y) / d };
}

/** First derivative with respect to t. */
export function conicD1(c: ConicArc, t: number): Vec2 {
  const w = weight(c.rho);
  const b0 = (1 - t) * (1 - t);
  const b1 = 2 * t * (1 - t) * w;
  const b2 = t * t;
  const db0 = -2 * (1 - t);
  const db1 = 2 * w * (1 - 2 * t);
  const db2 = 2 * t;
  const d = b0 + b1 + b2;
  const dd = db0 + db1 + db2;
  const p = conicPoint(c, t);
  return {
    x: (db0 * c.a.x + db1 * c.v.x + db2 * c.b.x - dd * p.x) / d,
    y: (db0 * c.a.y + db1 * c.v.y + db2 * c.b.y - dd * p.y) / d,
  };
}

/** Second derivative with respect to t. */
export function conicD2(c: ConicArc, t: number): Vec2 {
  const w = weight(c.rho);
  const d = (1 - t) * (1 - t) + 2 * t * (1 - t) * w + t * t;
  const dd = -2 * (1 - t) + 2 * w * (1 - 2 * t) + 2 * t;
  const ddd = 2 - 4 * w + 2;
  const nn = {
    x: 2 * c.a.x - 4 * w * c.v.x + 2 * c.b.x,
    y: 2 * c.a.y - 4 * w * c.v.y + 2 * c.b.y,
  };
  const p = conicPoint(c, t);
  const p1 = conicD1(c, t);
  return {
    x: (nn.x - 2 * p1.x * dd - p.x * ddd) / d,
    y: (nn.y - 2 * p1.y * dd - p.y * ddd) / d,
  };
}

interface Hom { x: number; y: number; w: number }

const homLerp = (p: Hom, q: Hom, t: number): Hom => ({
  x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, w: p.w + (q.w - p.w) * t,
});

function split(p0: Hom, p1: Hom, p2: Hom, t: number): { left: [Hom, Hom, Hom]; right: [Hom, Hom, Hom] } {
  const a = homLerp(p0, p1, t);
  const b = homLerp(p1, p2, t);
  const m = homLerp(a, b, t);
  return { left: [p0, a, m], right: [m, b, p2] };
}

/** The sub-arc over [t0, t1], exactly: conics are closed under subdivision. */
export function subConic(c: ConicArc, t0: number, t1: number): ConicArc {
  const w = weight(c.rho);
  let p: [Hom, Hom, Hom] = [
    { x: c.a.x, y: c.a.y, w: 1 },
    { x: c.v.x * w, y: c.v.y * w, w },
    { x: c.b.x, y: c.b.y, w: 1 },
  ];
  if (t1 < 1) p = split(p[0], p[1], p[2], t1).left;
  if (t0 > 0) p = split(p[0], p[1], p[2], t0 / t1).right;
  const [q0, q1, q2] = p;
  const nw = q1.w / Math.sqrt(q0.w * q2.w);
  return {
    a: { x: q0.x / q0.w, y: q0.y / q0.w },
    b: { x: q2.x / q2.w, y: q2.y / q2.w },
    v: { x: q1.x / q1.w, y: q1.y / q1.w },
    rho: nw / (1 + nw),
  };
}

/** rho that makes the conic pass through p, or null when p is not inside the a-v-b triangle's reach. */
export function rhoThrough(a: Vec2, v: Vec2, b: Vec2, p: Vec2): number | null {
  const mid = scale(add(a, b), 0.5);
  const toV = dist(mid, v);
  if (toV === 0) return null;
  const d = sub(v, mid);
  const along = ((p.x - mid.x) * d.x + (p.y - mid.y) * d.y) / (toV * toV);
  return along > 0 && along < 1 ? along : null;
}
