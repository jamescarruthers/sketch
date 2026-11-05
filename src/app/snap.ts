// Inference: resolve the cursor to the strongest nearby relationship (docs/SPEC.md section 5).
import type { Curve, Design, Id, Point, Sketch, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y, ORIGIN } from '../model/types';
import { addConstraint, addPoint, coincidentClasses, curveEnds, curvePoints, getPointPos } from '../model/document';
import { linkedCopy, projectPoint } from '../io/projection';
import { seenFrom } from '../model/seen';
import { closestPoint, evaluate, lineOf, resolve, tangent } from '../geom/curves';
import { add, dist, dot, len, lerp, norm, perp, rotate, scale, sub } from '../geom/vec';
import type { View } from './view';

export type InferenceKind =
  | 'none' | 'point' | 'midpoint' | 'quadrant' | 'onCurve' | 'tangent'
  | 'horizontal' | 'vertical' | 'perpendicular' | 'parallel' | 'extension' | 'grid';

export interface Inference {
  kind: InferenceKind;
  /** Where the cursor resolves to, in sketch mm. */
  pos: Vec2;
  /** Existing point, for `point`. */
  point?: Id;
  /** Target curve for midpoint, quadrant, onCurve and tangent; reference line for perpendicular and parallel. */
  curve?: Id;
  /** `tangent` that continues along `curve` from the segment start, so no contact is needed. */
  continuation?: boolean;
  /** Quadrant: whether the placed point lines up with the centre vertically or horizontally. */
  quadrant?: 'horizontal' | 'vertical';
  /** Dashed guides to draw. */
  guides: { a: Vec2; b: Vec2 }[];
  /**
   * The target is in another visible sketch, and `curve` or `point` here are ids there. Placing on it
   * projects it into the active sketch first [ref auto-project].
   */
  foreign?: { sketch: Id; point?: Id };
}

export interface SnapOptions {
  /** Segment start: enables direction inference (tangent, H/V, perpendicular, parallel). */
  from?: Vec2;
  /** Previous segment: a corner against it infers perpendicular. */
  previous?: Id;
  /** Continuing direction, normally the end tangent of the previous curve. */
  tangent?: { curve: Id; dir: Vec2 };
  /** Points that must not be snapped to, e.g. the ones being dragged. */
  exclude?: Id[];
  /** Skip curves, for tools that only want points and grid. */
  pointsOnly?: boolean;
  /** Curves to ignore along with their points, e.g. the one being dragged. */
  excludeCurves?: Id[];
  /** A 3-Point Arc's ends: the cursor over the middle of the chord snaps there [ref GUID-087596A4]. */
  chord?: { a: Vec2; b: Vec2 };
  /** Circle centre: a rim about it that touches a curve infers tangent [ref GUID-6A2AE9D9]. */
  rimFrom?: Vec2;
}

export interface SnapEnv {
  sketch: Sketch;
  view: View;
  gridSnap: boolean;
  polyline(curve: Curve, sketch: Sketch): Vec2[];
  /** Whether a curve is shown and so can be snapped to. */
  visible(curve: Curve): boolean;
  /** Same for a point, whose layer may be hidden. */
  pointVisible?(point: Point, sketch: Sketch): boolean;
  /** Other sketches on show: their geometry snaps too. */
  others: Sketch[];
}

const POINT_TOL_PX = 10;
const CURVE_TOL_PX = 7;
const ALIGN_TOL_PX = 5;
const DIR_TOL = (3 * Math.PI) / 180;
const MIN_DIR_PX = 12;

export const noInference = (pos: Vec2): Inference => ({ kind: 'none', pos, guides: [] });

function distToPolyline(pts: Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const d = sub(pts[i + 1], a);
    const l2 = dot(d, d);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
    best = Math.min(best, dist(p, add(a, scale(d, t))));
  }
  return best;
}

export { distToPolyline };

/** Tangent feet on a circle from an outside point. */
function tangentFeet(c: Vec2, r: number, from: Vec2): Vec2[] {
  const d = dist(c, from);
  if (d <= r + 1e-9) return [];
  const toFrom = norm(sub(from, c));
  const a = Math.acos(r / d);
  return [add(c, scale(rotate(toFrom, a), r)), add(c, scale(rotate(toFrom, -a), r))];
}

function angleOff(dir: Vec2, ref: Vec2): number {
  const c = Math.abs(dot(norm(dir), norm(ref)));
  return Math.acos(Math.min(1, c));
}

export class Snapper {
  private recent: Id[] = [];
  private hoveredLine: Id | null = null;

  reset(): void {
    this.recent = [];
    this.hoveredLine = null;
  }

  /** Remember a point for alignment guides, e.g. one the tool just placed. */
  note(id: Id): void {
    this.recent = [id, ...this.recent.filter((r) => r !== id)].slice(0, 6);
  }

  resolve(env: SnapEnv, raw: Vec2, opts: SnapOptions = {}): Inference {
    const { sketch, view } = env;
    const pointTol = view.px(POINT_TOL_PX);
    const curveTol = view.px(CURVE_TOL_PX);
    const excluded = new Set(opts.exclude);

    let bestPoint: Id | null = null;
    let bestDist = pointTol;
    const consider = (id: Id, p: Vec2): void => {
      const d = dist(p, raw);
      if (d < bestDist && !excluded.has(id)) {
        bestDist = d;
        bestPoint = id;
      }
    };
    consider(ORIGIN, { x: 0, y: 0 });
    const skipped = new Set(opts.excludeCurves);
    const curves = Object.values(sketch.curves).filter((c) => env.visible(c) && !skipped.has(c.id));
    const seen = new Set<Id>();
    for (const c of curves) {
      for (const id of curvePoints(c)) {
        if (seen.has(id)) continue;
        seen.add(id);
        consider(id, getPointPos(sketch, id));
      }
    }
    const shown = (p: Point, s: Sketch): boolean => !env.pointVisible || env.pointVisible(p, s);
    for (const p of Object.values(sketch.points)) if (p.explicit && !seen.has(p.id) && shown(p, sketch)) consider(p.id, p);

    // Geometry of other sketches snaps too. Strictly nearer than local: a local point at the same spot wins.
    let foreign: { sketch: Id; point: Id; pos: Vec2 } | null = null;
    const elsewhere = opts.pointsOnly && !opts.rimFrom ? env.others : env.others;
    for (const other of elsewhere) {
      const visit = (id: Id): void => {
        const q = other.points[id];
        const d = q ? dist(q, raw) : Infinity;
        if (d < bestDist) {
          bestDist = d;
          bestPoint = null;
          foreign = { sketch: other.id, point: id, pos: { x: q.x, y: q.y } };
        }
      };
      for (const c of Object.values(other.curves)) if (env.visible(c)) curvePoints(c).forEach(visit);
      for (const p of Object.values(other.points)) if (p.explicit && shown(p, other)) visit(p.id);
    }

    const rim = opts.rimFrom ? this.rimTangent(env, curves, raw, opts.rimFrom) : null;
    const found = foreign as { sketch: Id; point: Id; pos: Vec2 } | null;
    const at = bestPoint ? getPointPos(sketch, bestPoint) : found?.pos ?? null;
    // A point right at the contact gives the same circle, and tangent says more.
    if (rim && (!at || dist(at, rim.contact) < pointTol)) return rim.inference;
    if (bestPoint) {
      this.note(bestPoint);
      return { kind: 'point', pos: getPointPos(sketch, bestPoint), point: bestPoint, guides: [] };
    }
    if (found) return { kind: 'point', pos: found.pos, foreign: { sketch: found.sketch, point: found.point }, guides: [] };

    if (!opts.pointsOnly) {
      const curveHit = this.curveInference(env, sketch, curves, raw, pointTol, curveTol, opts)
        ?? this.foreignCurveInference(env, raw, pointTol, curveTol, opts)
        ?? this.chordInference(raw, view.px(ALIGN_TOL_PX), pointTol, opts)
        ?? this.axisInference(raw, curveTol);
      if (curveHit) return curveHit;
    }

    const directional = opts.from ? this.direction(env, raw, opts) : null;
    return this.alignAndGrid(env, directional ?? noInference(raw), !!directional, excluded);
  }

  /** The tangent nearest the rim the cursor is on, about centre `from`. */
  private rimTangent(env: SnapEnv, local: Curve[], raw: Vec2, from: Vec2): { inference: Inference; contact: Vec2 } | null {
    const r = dist(from, raw);
    const tol = env.view.px(CURVE_TOL_PX);
    const u = r > 1e-9 ? norm(sub(raw, from)) : { x: 1, y: 0 };
    let best: { gap: number; radius: number; contact: Vec2; curve: Id; sketch: Sketch } | null = null;
    const offer = (sketch: Sketch, curve: Id, radius: number, contact: Vec2): void => {
      const gap = Math.abs(radius - r);
      if (radius > 1e-6 && gap < tol && (!best || gap < best.gap)) best = { gap, radius, contact, curve, sketch };
    };
    const scan = (sketch: Sketch, curves: Curve[]): void => {
      for (const c of curves) {
        if (c.type === 'line') {
          const a = getPointPos(sketch, c.a);
          const b = getPointPos(sketch, c.b);
          const d = sub(b, a);
          const l = len(d);
          if (l < 1e-9) continue;
          const t = dot(sub(from, a), d) / (l * l);
          const foot = add(a, scale(d, t));
          // Only where the line is: past its ends the circle would touch nothing.
          if (t * l >= -tol && (1 - t) * l >= -tol) offer(sketch, c.id, dist(from, foot), foot);
        } else if (c.type === 'circle' || c.type === 'arc') {
          const pc = resolve(sketch, c);
          if (pc.shape.kind !== 'arc') continue;
          const { c: m, r: R } = pc.shape;
          const gap = dist(from, m);
          if (gap < 1e-9) continue;
          const toward = norm(sub(from, m));
          const contact = (q: Vec2): Vec2 | null => (closestPoint(sketch, c, q).dist < 1e-6 ? q : null);
          const near = contact(add(m, scale(toward, R)));
          const far = contact(sub(m, scale(toward, R)));
          if (near) offer(sketch, c.id, Math.abs(gap - R), near);
          if (far) offer(sketch, c.id, gap + R, far);
        }
      }
    };
    scan(env.sketch, local);
    for (const other of env.others) scan(other, Object.values(other.curves).filter((c) => env.visible(c)));
    const hit = best as { radius: number; contact: Vec2; curve: Id; sketch: Sketch } | null;
    if (!hit) return null;
    const inference: Inference = { kind: 'tangent', pos: add(from, scale(u, hit.radius)), curve: hit.curve, guides: [] };
    if (hit.sketch !== env.sketch) inference.foreign = { sketch: hit.sketch.id };
    return { inference, contact: hit.contact };
  }

  private foreignCurveInference(env: SnapEnv, raw: Vec2, pointTol: number, curveTol: number, opts: SnapOptions): Inference | null {
    for (const other of env.others) {
      const curves = Object.values(other.curves).filter((c) => env.visible(c));
      const hit = this.curveInference(env, other, curves, raw, pointTol, curveTol, opts);
      if (hit) return { ...hit, foreign: { sketch: other.id } };
    }
    return null;
  }

  private chordInference(raw: Vec2, tol: number, pointTol: number, opts: SnapOptions): Inference | null {
    if (!opts.chord) return null;
    const m = lerp(opts.chord.a, opts.chord.b, 0.5);
    const n = perp(norm(sub(opts.chord.b, opts.chord.a)));
    const pos = add(m, scale(n, dot(sub(raw, m), n)));
    return dist(pos, raw) < tol && dist(pos, m) > pointTol ? { kind: 'midpoint', pos, guides: [{ a: m, b: pos }] } : null;
  }

  private axisInference(raw: Vec2, curveTol: number): Inference | null {
    const onAxisX = Math.abs(raw.y) < curveTol;
    const onAxisY = Math.abs(raw.x) < curveTol;
    if (onAxisX) return { kind: 'onCurve', pos: { x: raw.x, y: 0 }, curve: AXIS_X, guides: [] };
    if (onAxisY) return { kind: 'onCurve', pos: { x: 0, y: raw.y }, curve: AXIS_Y, guides: [] };
    return null;
  }

  private curveInference(
    env: SnapEnv, sketch: Sketch, curves: Curve[], raw: Vec2, pointTol: number, curveTol: number, opts: SnapOptions,
  ): Inference | null {
    const near: { c: Curve; d: number }[] = [];
    for (const c of curves) {
      if (c.type === 'text') continue;
      const d = distToPolyline(env.polyline(c, sketch), raw);
      if (c.type === 'line' && d < curveTol * 2 && sketch === env.sketch) this.hoveredLine = c.id;
      if (c.type === 'line') {
        const a = getPointPos(sketch, c.a);
        const b = getPointPos(sketch, c.b);
        const m = lerp(a, b, 0.5);
        if (dist(m, raw) < pointTol) return { kind: 'midpoint', pos: m, curve: c.id, guides: [] };
      } else if (c.type === 'arc') {
        const m = evaluate(sketch, c, 0.5);
        if (dist(m, raw) < pointTol) return { kind: 'midpoint', pos: m, curve: c.id, guides: [] };
      }
      if (d < curveTol * 2.5) near.push({ c, d });
    }
    for (const { c } of near) {
      if (c.type !== 'circle') continue;
      const m = getPointPos(sketch, c.c);
      const quads: [Vec2, 'horizontal' | 'vertical'][] = [
        [{ x: m.x + c.r, y: m.y }, 'horizontal'], [{ x: m.x - c.r, y: m.y }, 'horizontal'],
        [{ x: m.x, y: m.y + c.r }, 'vertical'], [{ x: m.x, y: m.y - c.r }, 'vertical'],
      ];
      for (const [q, axis] of quads) {
        if (dist(q, raw) < pointTol) return { kind: 'quadrant', pos: q, curve: c.id, quadrant: axis, guides: [] };
      }
    }
    if (opts.from) {
      for (const { c } of near) {
        if (c.type !== 'circle' && c.type !== 'arc') continue;
        const pc = resolve(sketch, c);
        if (pc.shape.kind !== 'arc') continue;
        for (const foot of tangentFeet(pc.shape.c, pc.shape.r, opts.from)) {
          if (dist(foot, raw) < pointTol * 1.2 && closestPoint(sketch, c, foot).dist < 1e-6) {
            return { kind: 'tangent', pos: foot, curve: c.id, guides: [] };
          }
        }
      }
    }
    let best: { c: Curve; d: number } | null = null;
    for (const n of near) if (n.d < curveTol && (!best || n.d < best.d)) best = n;
    if (best) {
      return { kind: 'onCurve', pos: closestPoint(sketch, best.c, raw).p, curve: best.c.id, guides: [] };
    }
    return null;
  }

  private direction(env: SnapEnv, raw: Vec2, opts: SnapOptions): Inference | null {
    const from = opts.from as Vec2;
    const delta = sub(raw, from);
    if (len(delta) * env.view.ppm < MIN_DIR_PX) return null;
    const along = (u: Vec2): Vec2 => add(from, scale(u, dot(delta, u)));
    const guide = (p: Vec2): { a: Vec2; b: Vec2 }[] => [{ a: from, b: p }];
    if (opts.tangent) {
      const u = norm(opts.tangent.dir);
      if (dot(delta, u) > 0 && angleOff(delta, u) < DIR_TOL) {
        const pos = along(u);
        return { kind: 'tangent', pos, curve: opts.tangent.curve, continuation: true, guides: guide(pos) };
      }
    }
    if (angleOff(delta, { x: 1, y: 0 }) < DIR_TOL) {
      const pos = { x: raw.x, y: from.y };
      return { kind: 'horizontal', pos, guides: guide(pos) };
    }
    if (angleOff(delta, { x: 0, y: 1 }) < DIR_TOL) {
      const pos = { x: from.x, y: raw.y };
      return { kind: 'vertical', pos, guides: guide(pos) };
    }
    const refs = [opts.previous, this.hoveredLine].filter((r): r is Id => !!r);
    for (const ref of new Set(refs)) {
      const l = lineOf(env.sketch, ref);
      if (!l || len(l.d) === 0) continue;
      const u = norm(l.d);
      const n = perp(u);
      if (angleOff(delta, n) < DIR_TOL) {
        const pos = along(n);
        return { kind: 'perpendicular', pos, curve: ref, guides: guide(pos) };
      }
      if (ref !== opts.previous && angleOff(delta, u) < DIR_TOL) {
        const pos = along(u);
        return { kind: 'parallel', pos, curve: ref, guides: guide(pos) };
      }
    }
    return null;
  }

  /** Extension lines to recent points, then the grid, on whichever axes direction left free. */
  private alignAndGrid(env: SnapEnv, base: Inference, directional: boolean, excluded: Set<Id>): Inference {
    const { sketch, view } = env;
    const tol = view.px(ALIGN_TOL_PX);
    const out: Inference = { ...base, pos: { ...base.pos }, guides: [...base.guides] };
    const lockX = base.kind === 'vertical';
    const lockY = base.kind === 'horizontal';
    let alignedX = false;
    let alignedY = false;
    if (!directional || lockX || lockY) {
      for (const id of this.recent) {
        // A point being dragged must not line up with where it was a frame ago.
        if ((id !== ORIGIN && !sketch.points[id]) || excluded.has(id)) continue;
        if (sketch.points[id] && env.pointVisible && !env.pointVisible(sketch.points[id], sketch)) continue;
        const p = getPointPos(sketch, id);
        if (!alignedX && !lockX && Math.abs(out.pos.x - p.x) < tol) {
          out.pos.x = p.x;
          alignedX = true;
          out.guides.push({ a: p, b: out.pos });
        }
        if (!alignedY && !lockY && Math.abs(out.pos.y - p.y) < tol) {
          out.pos.y = p.y;
          alignedY = true;
          out.guides.push({ a: p, b: out.pos });
        }
      }
      if ((alignedX || alignedY) && out.kind === 'none') out.kind = 'extension';
    }
    if (env.gridSnap && (!directional || lockX || lockY)) {
      const step = view.gridSteps().minor;
      const snap = (v: number): number => Math.round(v / step) * step;
      if (!alignedX && !lockX) out.pos.x = snap(out.pos.x);
      if (!alignedY && !lockY) out.pos.y = snap(out.pos.y);
      if (out.kind === 'none') out.kind = 'grid';
    }
    return out;
  }
}

/** Bring a foreign target into the active sketch, as a linked projection, and aim the inference at the copy. */
export function localize(design: Design, sketch: Sketch, inf: Inference): Inference {
  if (!inf.foreign) return inf;
  const source = design.sketches[inf.foreign.sketch];
  const { foreign: _, ...rest } = inf;
  if (!source) return noInference(inf.pos);
  const from = seenFrom(sketch.frame, source);
  if (inf.foreign.point) {
    const p = projectPoint(design, sketch, from, inf.foreign.point);
    return p ? { ...rest, point: p.id } : noInference(inf.pos);
  }
  const c = inf.curve ? linkedCopy(design, sketch, from, inf.curve) : null;
  return c ? { ...rest, curve: c.id } : noInference(inf.pos);
}

export interface ApplyOptions {
  /** The line being placed, for direction and tangent inferences. */
  segment?: Id;
  /** Stored point at the segment start, when there is no segment curve. */
  from?: Id;
}

/** Add the constraints an inference implies for a just-placed point [ref]. */
export function applyInference(design: Design, sketch: Sketch, placed: Id, inf: Inference, opts: ApplyOptions = {}): void {
  const k = (type: Parameters<typeof addConstraint>[2], refs: Id[]): void => {
    addConstraint(design, sketch, type, refs);
  };
  switch (inf.kind) {
    case 'point':
      if (inf.point && inf.point !== placed && coincidentClasses(sketch)(inf.point) !== coincidentClasses(sketch)(placed)) {
        k('coincident', [inf.point, placed]);
      }
      break;
    case 'midpoint':
      if (inf.curve) k('midpoint', [placed, inf.curve]);
      break;
    case 'quadrant': {
      const c = inf.curve ? sketch.curves[inf.curve] : undefined;
      if (c?.type === 'circle' && inf.quadrant) {
        k('coincident', [placed, c.id]);
        k(inf.quadrant, [c.c, placed]);
      }
      break;
    }
    case 'onCurve':
      if (inf.curve) k('coincident', [placed, inf.curve]);
      break;
    case 'tangent':
      if (inf.curve && !inf.continuation) k('coincident', [placed, inf.curve]);
      if (inf.curve && opts.segment) k('tangent', [inf.curve, opts.segment]);
      break;
    case 'horizontal': case 'vertical':
      if (opts.segment) k(inf.kind, [opts.segment]);
      else if (opts.from) k(inf.kind, [opts.from, placed]);
      break;
    case 'perpendicular': case 'parallel':
      if (inf.curve && opts.segment) k(inf.kind, [inf.curve, opts.segment]);
      break;
    default:
  }
}

/**
 * A point on a curve from an inference, for curves with no stored point at the click, like a circle
 * rim. A snap to a curve or a midpoint has no point to join, so a hidden helper point owned by the
 * curve carries the constraints: on the rim, and on the other curve or at its midpoint.
 */
export function applyRimInference(design: Design, sketch: Sketch, curve: Id, inf: Inference): void {
  const k = (type: Parameters<typeof addConstraint>[2], refs: Id[]): void => {
    addConstraint(design, sketch, type, refs);
  };
  const helper = (): Id => addPoint(design, sketch, inf.pos, { owner: curve }).id;
  switch (inf.kind) {
    case 'point':
      if (inf.point) k('coincident', [inf.point, curve]);
      break;
    case 'tangent':
      if (inf.curve && inf.curve !== curve) k('tangent', [inf.curve, curve]);
      break;
    case 'midpoint':
      if (inf.curve && inf.curve !== curve) {
        const p = helper();
        k('midpoint', [p, inf.curve]);
        k('coincident', [p, curve]);
      }
      break;
    case 'onCurve':
      // A rim that happens to pass an axis there is only a size: nothing to keep a point for.
      if (inf.curve && inf.curve !== curve && inf.curve !== AXIS_X && inf.curve !== AXIS_Y) {
        const p = helper();
        k('coincident', [p, inf.curve]);
        k('coincident', [p, curve]);
      }
      break;
    case 'quadrant': {
      const other = inf.curve ? sketch.curves[inf.curve] : undefined;
      if (other?.type === 'circle' && inf.quadrant && other.id !== curve) {
        const p = helper();
        k('coincident', [p, other.id]);
        k(inf.quadrant, [other.c, p]);
        k('coincident', [p, curve]);
      }
      break;
    }
    default:
  }
}

/** Direction leaving a curve at one of its end points, pointing away from the curve's body. */
export function endTangent(sketch: Sketch, curveId: Id, point: Id): Vec2 | null {
  const c = sketch.curves[curveId];
  if (!c) return null;
  const ends = curveEnds(c);
  if (!ends) return null;
  const rep = coincidentClasses(sketch);
  if (rep(ends[1]) === rep(point)) return tangent(sketch, c, 1);
  if (rep(ends[0]) === rep(point)) return scale(tangent(sketch, c, 0), -1);
  return null;
}

/** A curve that ends at a point, directly or through a coincident, if there is exactly one. */
export function curveEndingAt(sketch: Sketch, point: Id): Id | null {
  const rep = coincidentClasses(sketch);
  const r = rep(point);
  const found: Id[] = [];
  for (const c of Object.values(sketch.curves)) {
    const ends = curveEnds(c);
    if (ends && (rep(ends[0]) === r || rep(ends[1]) === r)) found.push(c.id);
  }
  return found.length >= 1 ? found[found.length - 1] : null;
}
