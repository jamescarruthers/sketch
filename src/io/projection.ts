// Projected geometry [ref GUID-850061C4]: copies of curves from another sketch that this sketch can see
// (seen.ts: one on the same plane, or the lines of one on another plane that lie in this one), or of the
// origin axes. A linked copy holds its source in `projected` and follows it; an unlinked copy is plain
// fixed geometry. A linked copy whose source is gone, or no longer lies in this plane, keeps its place
// and shows orange. `from` is always the source as this sketch sees it, in this sketch's coordinates.
import type { Curve, Design, Id, Point, Sketch } from '../model/types';
import { addLine, addPoint, copySelection, curvePoints, deleteEntities, pasteClipboard } from '../model/document';
import { seenFrom, seesCurve } from '../model/seen';

/** How far the axes reach when they are projected, in mm. */
export const AXIS_REACH = 100;

export const isLinked = (c: Curve): c is Curve & { projected: { sketchId: Id; curveId: Id } } =>
  !!c.projected && 'sketchId' in c.projected;

/** Source curve of a linked projection, or undefined once it has been deleted. */
export const sourceOf = (design: Design, c: Curve): Curve | undefined =>
  isLinked(c) ? design.sketches[c.projected.sketchId]?.curves[c.projected.curveId] : undefined;

/**
 * A linked projection in `into` whose source is gone [ref Manage Lost Projections], or has moved out of
 * this sketch's plane.
 */
export function isLost(design: Design, c: Curve, into: Sketch): boolean {
  if (!isLinked(c)) return false;
  const from = design.sketches[c.projected.sketchId];
  return !from || !seesCurve(into.frame, from, c.projected.curveId);
}

/** Copy one curve of `from` into `sketch`. Constraints and dimensions are not carried over. */
export function projectCurve(design: Design, sketch: Sketch, from: Sketch, curveId: Id, link: boolean): Curve | null {
  const src = from.curves[curveId];
  if (!src || src.type === 'text') return null;
  const clip = copySelection(from, [curveId]);
  clip.constraints = [];
  clip.dimensions = [];
  const made = pasteClipboard(design, sketch, clip);
  const curve = sketch.curves[made.curves[0]];
  if (link) curve.projected = { sketchId: from.id, curveId };
  else curve.fixed = true;
  return curve;
}

/** A curve's linked copy in `sketch`, projecting it if need be. Auto-project [ref] comes through here. */
export function linkedCopy(design: Design, sketch: Sketch, from: Sketch, curveId: Id): Curve | null {
  const existing = Object.values(sketch.curves).find((c) => isLinked(c) && c.projected.sketchId === from.id && c.projected.curveId === curveId);
  return existing ?? projectCurve(design, sketch, from, curveId, true);
}

/** Copy one point of `from` into `sketch`, locked. Linked points are shared, not doubled. */
export function projectPoint(design: Design, sketch: Sketch, from: Sketch, pointId: Id, link = true): Point | null {
  const src = from.points[pointId];
  if (!src) return null;
  const existing = link && Object.values(sketch.points).find((p) => p.projected?.sketchId === from.id && p.projected.pointId === pointId);
  if (existing) return existing;
  const p = addPoint(design, sketch, src, { explicit: true, fixed: true });
  if (link) p.projected = { sketchId: from.id, pointId };
  return p;
}

/** An origin axis as a long line, locked. */
export function projectAxis(design: Design, sketch: Sketch, axis: 'x' | 'y'): Curve {
  const a = axis === 'x' ? { x: -AXIS_REACH, y: 0 } : { x: 0, y: -AXIS_REACH };
  const b = axis === 'x' ? { x: AXIS_REACH, y: 0 } : { x: 0, y: AXIS_REACH };
  const line = addLine(design, sketch, a, b, { lineType: 'construction' });
  line.projected = { origin: axis };
  return line;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-12;

/**
 * Bring every linked projection in `sketch` up to date with its source. Returns whether anything moved.
 * A source that changed shape (a spline gained a point) is copied afresh.
 */
export function syncProjections(design: Design, sketch: Sketch): boolean {
  let changed = false;
  // A locked layer's geometry never moves, even to follow a source in another sketch.
  const locked = new Set(design.layers.filter((l) => l.locked).map((l) => l.id));
  const views = new Map<Id, Sketch | undefined>();
  const seen = (id: Id): Sketch | undefined => {
    if (!views.has(id)) views.set(id, design.sketches[id] ? seenFrom(sketch.frame, design.sketches[id]) : undefined);
    return views.get(id);
  };
  for (const p of Object.values(sketch.points)) {
    if (p.layer && locked.has(p.layer)) continue;
    const q = p.projected ? seen(p.projected.sketchId)?.points[p.projected.pointId] : undefined;
    if (q && !(same(p.x, q.x) && same(p.y, q.y))) {
      p.x = q.x;
      p.y = q.y;
      changed = true;
    }
  }
  for (const c of Object.values(sketch.curves)) {
    if (!isLinked(c) || locked.has(c.layer)) continue;
    const from = seen(c.projected.sketchId);
    const src = from?.curves[c.projected.curveId];
    if (!from || !src) continue;
    const mine = curvePoints(c);
    const theirs = curvePoints(src);
    if (src.type !== c.type || mine.length !== theirs.length) {
      deleteEntities(sketch, [c.id]);
      const again = projectCurve(design, sketch, from, src.id, true);
      if (again) again.layer = c.layer;
      changed = true;
      continue;
    }
    mine.forEach((id, i) => {
      const p = sketch.points[id];
      const q = from.points[theirs[i]];
      if (p && q && !(same(p.x, q.x) && same(p.y, q.y))) {
        p.x = q.x;
        p.y = q.y;
        changed = true;
      }
    });
    if (c.type === 'circle' && src.type === 'circle' && !same(c.r, src.r)) {
      c.r = src.r;
      changed = true;
    }
    if (c.type === 'conic' && src.type === 'conic' && !same(c.rho, src.rho)) {
      c.rho = src.rho;
      changed = true;
    }
    if (c.lineType !== src.lineType) {
      c.lineType = src.lineType;
      changed = true;
    }
  }
  return changed;
}
