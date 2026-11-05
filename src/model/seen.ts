// What a sketch shows of another: the template geometry of 3D mode. A sketch on the same plane shows
// whole, in this sketch's coordinates; one on another plane shows only its points on this plane and the
// lines lying in it, which is where the two planes meet.
import type { Curve, Frame, Id, Point, Sketch, Vec2 } from './types';
import { ORIGIN } from './types';
import { curvePoints, isReservedId, remapCurve } from './document';
import { coplanar, dot3, normalOf, ON_PLANE, sameFrame, toPlane, toWorld } from './frames';

/** The other sketch's origin, when a curve of it starts there: a point of its own in the view. */
const originOf = (sketch: Sketch): Id => `${ORIGIN}:${sketch.id}`;

/**
 * `other` as a sketch on `frame` sees it, in that sketch's coordinates, ids unchanged. The same object when
 * the two share a frame. Otherwise a copy, with no constraints, dimensions or features: from a sketch on
 * the same plane every curve, mirrored when it faces the other way (text then goes: its letters would read
 * backwards); from one on another plane only the lines with both ends on this plane, and the points on it.
 */
export function seenFrom(frame: Frame, other: Sketch): Sketch {
  if (sameFrame(frame, other.frame)) return other;
  const flat = coplanar(frame, other.frame);
  const mirrored = flat && dot3(normalOf(frame), normalOf(other.frame)) < 0;
  const map = (p: Vec2): Vec2 & { z: number } => toPlane(frame, toWorld(other.frame, p));
  const points: Record<Id, Point> = {};
  const defining = new Set(Object.values(other.curves).flatMap((c) => curvePoints(c)));
  for (const p of Object.values(other.points)) {
    const q = map(p);
    if (!flat && Math.abs(q.z) >= ON_PLANE) continue;
    const copy: Point = { ...p, x: q.x, y: q.y };
    points[p.id] = copy;
  }
  const origin = map({ x: 0, y: 0 });
  const curves: Record<Id, Curve> = {};
  for (const c of Object.values(other.curves)) {
    if (!flat && c.type !== 'line') continue;
    if (mirrored && c.type === 'text') continue;
    const refs = curvePoints(c);
    if (refs.some((id) => id !== ORIGIN && (isReservedId(id) || !points[id]))) continue;
    if (refs.includes(ORIGIN)) {
      if (!flat && Math.abs(origin.z) >= ON_PLANE) continue;
      points[originOf(other)] ??= { id: originOf(other), x: origin.x, y: origin.y, fixed: true };
    }
    let copy = refs.includes(ORIGIN) ? remapCurve(c, new Map([[ORIGIN, originOf(other)]])) : c;
    // Counter-clockwise from a to b is clockwise once mirrored: the same arc runs from b to a.
    if (mirrored && (copy.type === 'arc' || copy.type === 'ellipticalArc')) copy = { ...copy, a: copy.b, b: copy.a };
    curves[c.id] = copy;
  }
  for (const c of Object.values(curves)) {
    if (c.type === 'text' && c.path && !curves[c.path]) delete curves[c.id];
  }
  // A point that lies on this plane shows, even when its curve does not.
  if (!flat) {
    const kept = new Set(Object.values(curves).flatMap((c) => curvePoints(c)));
    for (const p of Object.values(points)) {
      if (!kept.has(p.id) && (defining.has(p.id) || p.explicit) && !p.shown) points[p.id] = { ...p, shown: true };
    }
  }
  return { ...other, frame, points, curves, constraints: {}, dimensions: {}, features: {} };
}

/** Whether `other`'s curve shows from a sketch on `frame`, as seenFrom has it, without copying anything. */
export function seesCurve(frame: Frame, other: Sketch, curveId: Id): boolean {
  const c = other.curves[curveId];
  if (!c) return false;
  if (sameFrame(frame, other.frame)) return true;
  const refs = curvePoints(c);
  if (refs.some((id) => isReservedId(id) && id !== ORIGIN)) return false;
  if (coplanar(frame, other.frame)) {
    if (c.type !== 'text') return true;
    return dot3(normalOf(frame), normalOf(other.frame)) > 0 && (!c.path || seesCurve(frame, other, c.path));
  }
  if (c.type !== 'line') return false;
  return refs.every((id) => {
    const p = id === ORIGIN ? { x: 0, y: 0 } : other.points[id];
    return !!p && Math.abs(toPlane(frame, toWorld(other.frame, p)).z) < ON_PLANE;
  });
}

/** Whether a view has anything in it to draw or pick. */
export const isEmpty = (s: Sketch): boolean => Object.keys(s.curves).length === 0 && !Object.values(s.points).some((p) => p.explicit || p.shown);
