// What Fillet and Chamfer share: a corner is two curves plus a pick on each, from a vertex or two picks.
import type { Id, Sketch, Vec2 } from '../model/types';
import { getPointPos } from '../model/document';
import { curveLength, resolve } from '../geom/curves';
import { intersect } from '../geom/intersect';
import { armHolds, curvesAtVertex } from '../geom/modify';
import { cross, dist, lerp, norm, perp, sub } from '../geom/vec';

export interface Corner {
  a: Id;
  b: Id;
  pickA: Vec2;
  pickB: Vec2;
  /** The picked vertex, re-resolved at commit since an earlier fillet can reshape its curves. */
  vertex?: Id;
}

const SIZE_SHARE = 0.2;
/** Sine of the angle under which a join counts as tangent. */
const SMOOTH_SIN = 1e-4;

const isEdit = (sketch: Sketch, id: Id, kinds: readonly string[]): boolean => {
  const c = sketch.curves[id];
  return !!c && kinds.includes(c.type) && !c.projected;
};

/** The two curves meeting at a point, if both are of `kinds`. */
export function cornerAt(sketch: Sketch, point: Id, kinds: readonly string[]): Corner | null {
  const v = curvesAtVertex(sketch, point);
  if (!v || !isEdit(sketch, v.a, kinds) || !isEdit(sketch, v.b, kinds)) return null;
  return { ...v, vertex: point };
}

/** Length of a curve, or the diameter of a closed circle. */
function sizeOf(sketch: Sketch, id: Id): number {
  const c = sketch.curves[id];
  return c.type === 'circle' ? c.r * 2 : curveLength(sketch, c);
}

/** Starting value proportional to the smaller object [ref]. */
export const proportionalSize = (sketch: Sketch, c: Corner): number =>
  SIZE_SHARE * Math.min(sizeOf(sketch, c.a), sizeOf(sketch, c.b));

/** Where two curves meet, extended if need be: a picked vertex, or the crossing nearest the picks. */
export function cornerPoint(sketch: Sketch, c: Corner): Vec2 | null {
  if (c.vertex && (sketch.points[c.vertex] || c.vertex === 'origin')) return getPointPos(sketch, c.vertex);
  const middle = lerp(c.pickA, c.pickB, 0.5);
  const hits = intersect(resolve(sketch, sketch.curves[c.a]), resolve(sketch, sketch.curves[c.b]), { extendA: true, extendB: true });
  hits.sort((x, y) => dist(x.p, middle) - dist(y.p, middle));
  return hits[0]?.p ?? null;
}

/** Two curves that leave a corner along the same tangent have nothing to round. */
export function smoothJoin(sketch: Sketch, c: Corner): boolean {
  const at = cornerPoint(sketch, c);
  if (!at) return false;
  const along = (id: Id): Vec2 | null => {
    const s = resolve(sketch, sketch.curves[id]).shape;
    if (s.kind === 'line') return norm(sub(s.b, s.a));
    return s.kind === 'arc' ? perp(norm(sub(at, s.c))) : null;
  };
  const u = along(c.a);
  const w = along(c.b);
  return !!u && !!w && Math.abs(cross(u, w)) < SMOOTH_SIN;
}

/** A contact must lie on the part of the curve being kept: from the corner toward the pick. */
export function contactFits(sketch: Sketch, id: Id, contact: Vec2, corner: Vec2, pick: Vec2): boolean {
  const c = sketch.curves[id];
  return !c || armHolds(resolve(sketch, c), corner, pick, contact);
}
