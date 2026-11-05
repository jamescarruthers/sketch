// Small helpers shared by the create tools: HUD angle locks and arc and construction helpers.
import type { Id, Vec2 } from '../model/types';
import { addConstraint, addLine } from '../model/document';
import { add, cross, dist, dot, len, rotate, scale, sub, TAU, wrapAngle } from '../geom/vec';
import { COLORS } from '../render/style';
import type { CommitScope, Preview, Stroke } from './tool';

/** Angle between `ref` (a unit direction) and `d`, 0 to 180 degrees. */
export function unsignedAngle(ref: Vec2, d: Vec2): number {
  const l = len(d);
  return l > 1e-12 ? Math.acos(Math.max(-1, Math.min(1, dot(ref, d) / l))) : 0;
}

/**
 * HUD angle lock: the cursor turns `v` away from `ref` about `origin` at its current distance.
 * The side of `ref` the cursor is on decides the direction, so 0 to 180 degrees covers every line.
 */
export function relativeAngleLock(origin: Vec2, ref: Vec2): (p: Vec2, v: number) => Vec2 {
  return (p, v) => {
    const d = dist(origin, p) || 1;
    const side = cross(ref, sub(p, origin)) >= 0 ? 1 : -1;
    return add(origin, scale(rotate(ref, side * v), d));
  };
}

export const X_AXIS: Vec2 = { x: 1, y: 0 };

/** Polar position about `c`. */
export const polar = (c: Vec2, angle: number, r: number): Vec2 => ({ x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) });

export const angleOf = (c: Vec2, p: Vec2): number => Math.atan2(p.y - c.y, p.x - c.x);

/** Counter-clockwise sweep from angle a to b, in [0, 2pi). */
export const ccwSweep = (a: number, b: number): number => wrapAngle(b - a);

/** Draw the arc through `from` to `to` about `c`, going the way `ccw` says. */
export function previewArc(p: Preview, c: Vec2, from: Vec2, to: Vec2, ccw: boolean, stroke: Stroke): void {
  const a0 = angleOf(c, from);
  const a1 = angleOf(c, to);
  const r = dist(c, from);
  p.arc(c, r, a0, ccw ? ccwSweep(a0, a1) : -ccwSweep(a1, a0), stroke);
}

/** Sweep in (-2pi, 2pi) from the start about the centre to the cursor, continuous across 180 degrees. */
export function makeSweep(): (c: Vec2, start: Vec2, p: Vec2, reset?: boolean) => number {
  let memo: number | null = null;
  return (c, start, p, reset) => {
    if (reset) memo = null;
    const a0 = angleOf(c, start);
    const rel = (((angleOf(c, p) - a0) % TAU) + TAU) % TAU;
    const options = [rel, rel - TAU];
    const next = memo === null ? (rel <= Math.PI ? rel : rel - TAU) : options.reduce((x, y) => (Math.abs(y - (memo as number)) < Math.abs(x - (memo as number)) ? y : x));
    memo = next;
    return next;
  };
}

/** A getter, so the colour follows the theme at the moment it is drawn. */
export const CONSTRUCTION: Stroke = { get color() { return COLORS.construction; }, dash: [7, 5], width: 1 };

/** A construction line from `a` to `b` whose ends are joined to the stored points `ia` and `ib`. */
export function constructionLine(c: CommitScope, a: Vec2, b: Vec2, ia: Id | null, ib: Id | null) {
  const line = addLine(c.design, c.sketch, a, b, { lineType: 'construction' });
  if (ia) addConstraint(c.design, c.sketch, 'coincident', [ia, line.a]);
  if (ib) addConstraint(c.design, c.sketch, 'coincident', [ib, line.b]);
  return line;
}
