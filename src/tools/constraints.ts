// The constraint tools [ref SKT-CONSTRAIN-*].
import type { Constraint, Curve, Id, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y, ORIGIN } from '../model/types';
import { addConstraint, addPoint, coincidentClasses, curveEnds, curvePoints, getPointPos } from '../model/document';
import { radiusOf } from '../model/parameters';
import { closestPoint, lineOf } from '../geom/curves';
import { add, dist, norm, reflect, scale, sub } from '../geom/vec';
import type { Overlay } from './registry';
import { drawBadge } from '../render/glyphs';
import { defineConstraintTool, heavier, pointsOf } from './constraint-tool';
import { ensureFitHandle } from './spline';
import type { CommitScope, Hit, ToolContext, ToolDef } from './tool';

const isPoint = (h: Hit): boolean => h.kind === 'point';
const isCurveHit = (h: Hit): boolean => h.kind === 'curve';
const curveOf = (ctx: ToolContext, h: Hit): Curve | undefined => (h.kind === 'curve' ? ctx.sketch.curves[h.id] : undefined);
const isAxis = (id: Id): boolean => id === AXIS_X || id === AXIS_Y;
const alreadyHas = (c: CommitScope, type: Constraint['type'], refs: Id[]): boolean => Object.values(c.sketch.constraints)
  .some((k) => k.type === type && k.refs.length === refs.length && k.refs.every((r, i) => r === refs[i]));
const isLine = (ctx: ToolContext, h: Hit): boolean => curveOf(ctx, h)?.type === 'line';
const isRound = (ctx: ToolContext, h: Hit): boolean => {
  const t = curveOf(ctx, h)?.type;
  return t === 'circle' || t === 'arc';
};

export const coincidentTool: ToolDef = defineConstraintTool({
  meta: { id: 'coincident', label: 'Coincident' },
  count: 2,
  prompts: ['Select a point or curve', 'Select the point or curve to join it to'],
  accept(ctx, hit, picked) {
    if (hit.kind !== 'point' && hit.kind !== 'curve') return false;
    const curve = curveOf(ctx, hit);
    if (curve?.type === 'text') return false;
    const first = picked[0];
    if (!first) return true;
    if (first.id === hit.id) return false;
    if (isCurveHit(first) && isCurveHit(hit)) return false;
    if (isPoint(first) && isPoint(hit)) {
      const rep = coincidentClasses(ctx.sketch);
      return rep(first.id) !== rep(hit.id);
    }
    const [point, on] = isPoint(hit) ? [hit.id, first.id] : [first.id, hit.id];
    if (isAxis(on) && point === ORIGIN) return false;
    const c = ctx.sketch.curves[on];
    return !c || !ctx.sketch.points[point] || ctx.sketch.points[point].owner !== on;
  },
  apply(c, picks) {
    addConstraint(c.design, c.sketch, 'coincident', [picks[0].id, picks[1].id]);
  },
});

/** Whichever axis the geometry is already closer to [ref]. */
function nearerAxis(dx: number, dy: number): 'horizontal' | 'vertical' {
  return Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
}

/** What the H/V tool last added and may still swap, when the nearer axis is refused. */
let tried: { axis: 'horizontal' | 'vertical' | null; swapped: boolean } = { axis: null, swapped: false };

export const horizontalVerticalTool: ToolDef = defineConstraintTool({
  meta: { id: 'hv', label: 'Horizontal/Vertical', icon: 'hv' },
  count: (first) => (first.kind === 'point' ? 2 : 1),
  prompts: ['Select a line, or two points', 'Select the second point'],
  hold: (_ctx, picks) => (picks.length === 2 ? [picks[0].id].filter((id) => id !== ORIGIN) : []),
  accept(ctx, hit, picked) {
    const first = picked[0];
    if (first) {
      if (hit.kind !== 'point' || hit.id === first.id) return false;
      const a = getPointPos(ctx.sketch, first.id);
      return dist(a, getPointPos(ctx.sketch, hit.id)) > 1e-9;
    }
    return hit.kind === 'point' ? true : isLine(ctx, hit) && !isAxis(hit.id);
  },
  apply(c, picks, ctx) {
    const { design, sketch } = c;
    const line = picks.length === 1 ? sketch.curves[picks[0].id] : undefined;
    if (picks.length === 1 && line?.type !== 'line') return false;
    const refs = picks.map((p) => p.id);
    const a = getPointPos(sketch, line?.type === 'line' ? line.a : refs[0]);
    const b = getPointPos(sketch, line?.type === 'line' ? line.b : refs[1]);
    const near = nearerAxis(b.x - a.x, b.y - a.y);
    const type = tried.swapped ? (near === 'horizontal' ? 'vertical' : 'horizontal') : near;
    tried = { axis: null, swapped: tried.swapped };
    if (alreadyHas(c, type, refs)) {
      tried.swapped = false;
      ctx.message(`That is already ${type}`);
      return false;
    }
    addConstraint(design, sketch, type, refs);
    tried.axis = type;
    return true;
  },
  // The nearer axis was refused: the other is a line's only other way of being horizontal or vertical.
  retry() {
    const again = tried.axis !== null && !tried.swapped;
    tried = { axis: null, swapped: again };
    return again;
  },
});

export const equalTool: ToolDef = defineConstraintTool({
  meta: { id: 'equal', label: 'Equal' },
  count: 2,
  prompts: ['Select the line, circle or arc to match', 'Select the one to change'],
  // What to change is the question here, not what moves: the pick order is the answer.
  hold: (ctx, picks) => pointsOf(ctx, picks[0]),
  accept(ctx, hit, picked) {
    if (!isLine(ctx, hit) && !isRound(ctx, hit)) return false;
    const first = picked[0];
    if (!first) return true;
    return first.id !== hit.id && isLine(ctx, first) === isLine(ctx, hit);
  },
  apply(c, picks) {
    addConstraint(c.design, c.sketch, 'equal', [picks[0].id, picks[1].id]);
  },
});



// ---------------------------------------------------------------------------
// Shapes the other tools pick between

type Type = Curve['type'] | 'axis' | 'point';

/** What a hit is, with the reserved axes counted as lines. */
function typeOf(ctx: ToolContext, h: Hit): Type | undefined {
  if (h.kind === 'point') return 'point';
  if (h.kind !== 'curve') return undefined;
  if (isAxis(h.id)) return 'axis';
  return ctx.sketch.curves[h.id]?.type;
}

const isLineLike = (t: Type | undefined): boolean => t === 'line' || t === 'axis';
const isSplineType = (t: Type | undefined): boolean => t === 'fitSpline' || t === 'controlSpline' || t === 'conic';

/** Curves with ends a tangent or curvature joins at. */
const TOUCH = 1e-4;

/** Which end (0 start, 1 end) of `spline` lies on `other`, or null when neither does. */
function touchingEnd(ctx: ToolContext, spline: Hit, other: Hit): 0 | 1 | null {
  const sp = ctx.sketch.curves[spline.id];
  const ends = sp ? curveEnds(sp) : null;
  if (!ends) return null;
  const target = isAxis(other.id) ? null : ctx.sketch.curves[other.id];
  for (const i of [0, 1] as const) {
    const p = getPointPos(ctx.sketch, ends[i]);
    if (!target) {
      const onAxis = other.id === AXIS_X ? Math.abs(p.y) : Math.abs(p.x);
      if (onAxis < TOUCH) return i;
    } else if (closestPoint(ctx.sketch, target, p).dist < TOUCH) return i;
  }
  return null;
}

/** Bits of a tangent or curvature variant: which end of the first and second ref meets the other [solver, variant table]. */
function endsVariant(ctx: ToolContext, first: Hit, second: Hit): number | undefined {
  let v = 0;
  let any = false;
  if (isSplineType(typeOf(ctx, first))) {
    const e = touchingEnd(ctx, first, second);
    if (e === null) return undefined;
    v |= e;
    any = true;
  }
  if (isSplineType(typeOf(ctx, second))) {
    const e = touchingEnd(ctx, second, first);
    if (e === null) return undefined;
    v |= e << 1;
    any = true;
  }
  return any ? v : undefined;
}

/** External (0) or internal (1) contact between two circles or arcs, from where they are now. */
function circleVariant(c: CommitScope, a: Id, b: Id): number | undefined {
  const circ = (id: Id): { c: Vec2; r: number } | null => {
    const curve = c.sketch.curves[id];
    if (curve?.type !== 'circle' && curve?.type !== 'arc') return null;
    return { c: getPointPos(c.sketch, curve.c), r: radiusOf(c.sketch, id) as number };
  };
  const p = circ(a);
  const q = circ(b);
  if (!p || !q) return undefined;
  const d = dist(p.c, q.c);
  return Math.abs(d - (p.r + q.r)) <= Math.abs(d - Math.abs(p.r - q.r)) ? 0 : 1;
}

/** A fit spline touching another curve at an end needs a handle there, or the tangent only moves the other curve. */
function steerFitEnds(c: CommitScope, ctx: ToolContext, first: Hit, second: Hit): void {
  for (const [spline, other] of [[first, second], [second, first]] as const) {
    const sp = c.sketch.curves[spline.id];
    if (sp?.type !== 'fitSpline') continue;
    const end = touchingEnd(ctx, spline, other);
    if (end !== null) ensureFitHandle(c, sp.id, end === 0 ? 0 : sp.pts.length - 1);
  }
}

// ---------------------------------------------------------------------------
// Tangent, Parallel, Perpendicular

const TANGENTABLE = new Set<Type>(['line', 'axis', 'circle', 'arc', 'ellipse', 'ellipticalArc', 'fitSpline', 'controlSpline', 'conic']);

/** Says why a spline and a curve that are not joined at its end cannot take tangent or curvature. */
function notTouching(ctx: ToolContext, hit: Hit, picked: Hit[]): string | null {
  const first = picked[0];
  if (!first || first.id === hit.id) return null;
  if (!isSplineType(typeOf(ctx, first)) && !isSplineType(typeOf(ctx, hit))) return null;
  return endsVariant(ctx, first, hit) === undefined ? 'A spline takes this at its end only: bring the end onto the other curve first' : null;
}

export const tangentTool: ToolDef = defineConstraintTool({
  meta: { id: 'tangent', label: 'Tangent' },
  count: 2,
  prompts: ['Select a curve', 'Select the curve to make tangent to it'],
  refuse: notTouching,
  accept(ctx, hit, picked) {
    const t = typeOf(ctx, hit);
    if (!t || !TANGENTABLE.has(t)) return false;
    const first = picked[0];
    if (!first) return true;
    const f = typeOf(ctx, first);
    if (first.id === hit.id || (isLineLike(f) && isLineLike(t))) return false;
    // A spline is tangent at an end only, so that end must already touch the other curve.
    return !(isSplineType(f) || isSplineType(t)) || endsVariant(ctx, first, hit) !== undefined;
  },
  apply(c, picks, ctx) {
    const [a, b] = picks;
    const variant = endsVariant(ctx, a, b) ?? circleVariant(c, a.id, b.id);
    steerFitEnds(c, ctx, a, b);
    addConstraint(c.design, c.sketch, 'tangent', [a.id, b.id], variant === undefined ? {} : { variant });
  },
});

export const parallelTool: ToolDef = defineConstraintTool({
  meta: { id: 'parallel', label: 'Parallel' },
  count: 2,
  prompts: ['Select a line', 'Select the line to make parallel to it'],
  accept: (ctx, hit, picked) => isLine(ctx, hit) && (!picked[0] || picked[0].id !== hit.id),
  apply(c, picks) {
    addConstraint(c.design, c.sketch, 'parallel', [picks[0].id, picks[1].id]);
  },
});

export const perpendicularTool: ToolDef = defineConstraintTool({
  meta: { id: 'perpendicular', label: 'Perpendicular' },
  count: 2,
  prompts: ['Select a line', 'Select the line to make perpendicular to it'],
  accept(ctx, hit, picked) {
    const first = picked[0];
    if (!isLine(ctx, hit) && !isRound(ctx, hit)) return false;
    if (!first) return true;
    // A line through a circle's centre is perpendicular to its rim: line with line, or line with round.
    return first.id !== hit.id && (isLine(ctx, first) || isLine(ctx, hit));
  },
  apply(c, picks) {
    addConstraint(c.design, c.sketch, 'perpendicular', [picks[0].id, picks[1].id]);
  },
});

// ---------------------------------------------------------------------------
// Fix/UnFix

const fixable = (ctx: ToolContext, hit: Hit): boolean => {
  if (hit.kind === 'point') return hit.id !== ORIGIN && !!ctx.sketch.points[hit.id];
  if (hit.kind !== 'curve' || isAxis(hit.id)) return false;
  const c = ctx.sketch.curves[hit.id];
  return !!c && !c.projected && c.type !== 'text';
};

export const fixTool: ToolDef = defineConstraintTool({
  meta: { id: 'fix', label: 'Fix/UnFix' },
  count: 1,
  prompts: ['Select a point or curve to fix it, or a fixed one to unfix it'],
  accept: fixable,
  hold: () => [],
  apply(c, picks) {
    const hit = picks[0];
    if (hit.kind === 'point') {
      const p = c.sketch.points[hit.id];
      p.fixed = !p.fixed;
      return;
    }
    const curve = c.sketch.curves[hit.id];
    const now = !curve.fixed;
    if (now) curve.fixed = true;
    else delete curve.fixed;
    for (const id of curvePoints(curve)) {
      const p = c.sketch.points[id];
      if (!p) continue;
      // A point another fixed curve still uses stays fixed.
      const shared = Object.values(c.sketch.curves).some((o) => o.id !== curve.id && o.fixed && curvePoints(o).includes(id));
      if (now) p.fixed = true;
      else if (!shared) delete p.fixed;
    }
  },
});

/** The lock badge Fusion shows beside fixed geometry; fixing is a flag, so no constraint draws it. */
export const fixOverlay: Overlay = (ctx, p) => {
  const { sketch, view } = ctx;
  const shown: Vec2[] = [];
  const at = (pos: Vec2, i: number): void => {
    const s = view.toScreen(pos);
    // Locks too close to tell apart say nothing more than one lock does.
    if (shown.some((q) => Math.abs(q.x - s.x) < 20 && Math.abs(q.y - s.y) < 20)) return;
    shown.push(s);
    p.raw((g) => drawBadge(g, 'fix', s.x + 12 + i * 16, s.y - 12, 'idle'));
  };
  const seen = new Set<Id>();
  const here = ctx.design.activeLayer;
  for (const c of Object.values(sketch.curves)) {
    if (!c.fixed || c.projected || c.type === 'text' || c.layer !== here) continue;
    const pts = curvePoints(c).map((id) => sketch.points[id]).filter(Boolean);
    if (!pts.length) continue;
    pts.forEach((q) => seen.add(q.id));
    const mid = pts.reduce((acc, q) => ({ x: acc.x + q.x / pts.length, y: acc.y + q.y / pts.length }), { x: 0, y: 0 });
    at(mid, 0);
  }
  for (const q of Object.values(sketch.points)) if (q.fixed && !seen.has(q.id) && !q.owner && q.layer === here) at(q, 0);
};

// ---------------------------------------------------------------------------
// Midpoint, Concentric, Collinear

const SPANNING = new Set<Type>(['line', 'arc']);
const OBJECT = new Set<Type>(['point', 'line', 'arc', 'circle']);

export const midpointTool: ToolDef = defineConstraintTool({
  meta: { id: 'midpoint', label: 'Midpoint' },
  count: 2,
  prompts: ['Select a point, or the line or arc to take the midpoint of', 'Select the line or arc, or the point or object to bring there'],
  accept(ctx, hit, picked) {
    const t = typeOf(ctx, hit);
    if (!t || !OBJECT.has(t)) return false;
    const first = picked[0];
    if (!first) return true;
    if (first.id === hit.id) return false;
    const f = typeOf(ctx, first) as Type;
    // One of the pair has to have a midpoint. The other brings its point, centre or own middle.
    if (!SPANNING.has(t) && !SPANNING.has(f)) return false;
    const [object, curve] = SPANNING.has(f) ? [hit, first] : [first, hit];
    // An end or the centre of the curve itself cannot also be its midpoint.
    return typeOf(ctx, object) !== 'point' || !curvePoints(ctx.sketch.curves[curve.id]).includes(object.id);
  },
  apply(c, picks, ctx) {
    const first = typeOf(ctx, picks[0]) as Type;
    const [object, curve] = SPANNING.has(first) ? [picks[1], picks[0]] : picks;
    const target = c.sketch.curves[object.id];
    if (object.kind === 'point') addConstraint(c.design, c.sketch, 'midpoint', [object.id, curve.id]);
    else if (target?.type === 'circle' || target?.type === 'arc') addConstraint(c.design, c.sketch, 'midpoint', [target.c, curve.id]);
    else if (target?.type === 'line') {
      // A line has no stored middle: a hidden point on it carries both midpoints.
      const a = getPointPos(c.sketch, target.a);
      const b = getPointPos(c.sketch, target.b);
      const mid = addPoint(c.design, c.sketch, scale(add(a, b), 0.5), { owner: target.id });
      addConstraint(c.design, c.sketch, 'midpoint', [mid.id, target.id]);
      addConstraint(c.design, c.sketch, 'midpoint', [mid.id, curve.id]);
    }
  },
});

const CENTRED = new Set<Type>(['circle', 'arc', 'ellipse', 'ellipticalArc']);

export const concentricTool: ToolDef = defineConstraintTool({
  meta: { id: 'concentric', label: 'Concentric' },
  count: 2,
  prompts: ['Select a circle, arc or ellipse', 'Select the one to give the same centre'],
  accept(ctx, hit, picked) {
    const t = typeOf(ctx, hit);
    if (!t || !CENTRED.has(t)) return false;
    const first = picked[0];
    if (!first) return true;
    if (first.id === hit.id) return false;
    const rep = coincidentClasses(ctx.sketch);
    const centre = (h: Hit): Id => (ctx.sketch.curves[h.id] as { c: Id }).c;
    return rep(centre(first)) !== rep(centre(hit));
  },
  apply(c, picks) {
    addConstraint(c.design, c.sketch, 'concentric', [picks[0].id, picks[1].id]);
  },
});

export const collinearTool: ToolDef = defineConstraintTool({
  meta: { id: 'collinear', label: 'Collinear' },
  count: 2,
  prompts: ['Select a line', 'Select the line to put on the same line'],
  accept: (ctx, hit, picked) => isLine(ctx, hit) && (!picked[0] || picked[0].id !== hit.id),
  apply(c, picks) {
    addConstraint(c.design, c.sketch, 'collinear', [picks[0].id, picks[1].id]);
  },
});

// ---------------------------------------------------------------------------
// Symmetry: two objects, then the line they mirror across [ref]

const MIRRORED = new Set<Type>(['point', 'line', 'circle', 'arc', 'ellipse', 'fitSpline', 'controlSpline']);

/** Points a spline must match in number to mirror another, one to one. */
const controlCount = (c: Curve | undefined): number | null => (c?.type === 'fitSpline' || c?.type === 'controlSpline' ? c.pts.length : null);

/** Mirror error of `a` onto `b` across the line `axis`, at their stored points. */
function mirrorMiss(ctx: ToolContext, a: Hit, b: Hit, axis: Hit): number {
  const l = lineOf(ctx.sketch, axis.id);
  if (!l) return Infinity;
  const at = (h: Hit): Vec2 => {
    const pts = pointsOf(ctx, h).map((id) => getPointPos(ctx.sketch, id));
    return pts.length ? scale(pts.reduce(add, { x: 0, y: 0 }), 1 / pts.length) : { x: 0, y: 0 };
  };
  return dist(reflect(at(a), l.p, l.d), at(b));
}

/** The line of symmetry is whichever selection the other two mirror across, wherever it came in the list [F33]. */
function axisLast(ctx: ToolContext, hits: Hit[]): Hit[] {
  if (hits.length !== 3) return hits;
  const lines = hits.filter((h) => isLineLike(typeOf(ctx, h)));
  if (lines.length === 0) return hits;
  const others = (h: Hit): Hit[] => hits.filter((x) => x !== h);
  const axis = lines.length === 1 ? lines[0] : lines.reduce((best, h) => {
    const [p, q] = others(h);
    const [u, v] = others(best);
    return mirrorMiss(ctx, p, q, h) < mirrorMiss(ctx, u, v, best) ? h : best;
  });
  return [...others(axis), axis];
}

export const symmetryTool: ToolDef = defineConstraintTool({
  meta: { id: 'symmetry', label: 'Symmetry' },
  count: 3,
  prompts: ['Select the first object', 'Select the matching object', 'Select the line of symmetry'],
  arrange: axisLast,
  refuse(ctx, hit, picked) {
    if (picked.length !== 1 || hit.id === picked[0].id) return null;
    const [was, is] = [typeOf(ctx, picked[0]), typeOf(ctx, hit)];
    return is && was && is !== was && MIRRORED.has(is) ? `Symmetry pairs two of a kind: pick another ${was}` : null;
  },
  // The line they mirror across stays, and the first object unless it is the lighter of the two.
  hold: (ctx, picks) => [...pointsOf(ctx, heavier(ctx, picks.slice(0, 2))), ...pointsOf(ctx, picks[2])],
  accept(ctx, hit, picked) {
    const t = typeOf(ctx, hit);
    if (picked.length < 2) {
      if (!t || !MIRRORED.has(t)) return false;
      const first = picked[0];
      return !first || (first.id !== hit.id && typeOf(ctx, first) === t);
    }
    // The line of symmetry: any line or axis other than the two objects.
    return isLineLike(t) && !picked.some((p) => p.id === hit.id);
  },
  apply(c, picks, ctx) {
    const [a, b, axis] = picks;
    let variant: number | undefined;
    const ca = c.sketch.curves[a.id];
    const cb = c.sketch.curves[b.id];
    if (controlCount(ca) !== controlCount(cb)) {
      ctx.message('Splines mirror point for point, so they need the same number of points', 'warn');
      return false;
    }
    if ((ca?.type === 'line' && cb?.type === 'line') || (ca?.type === 'arc' && cb?.type === 'arc')) {
      // Which end of the second the first's start mirrors onto, chosen once so solves do not flip.
      const l = axis.id === AXIS_X ? { p: { x: 0, y: 0 }, d: { x: 1, y: 0 } }
        : axis.id === AXIS_Y ? { p: { x: 0, y: 0 }, d: { x: 0, y: 1 } }
          : (() => {
            const ax = c.sketch.curves[axis.id] as { a: Id; b: Id };
            const p = getPointPos(c.sketch, ax.a);
            return { p, d: sub(getPointPos(c.sketch, ax.b), p) };
          })();
      const u = norm(l.d);
      const start = getPointPos(c.sketch, (ca as { a: Id }).a);
      const rel = sub(start, l.p);
      const along = rel.x * u.x + rel.y * u.y;
      const foot = add(l.p, scale(u, along));
      const mirror = sub(scale(foot, 2), start);
      const b0 = getPointPos(c.sketch, (cb as { a: Id }).a);
      const b1 = getPointPos(c.sketch, (cb as { b: Id }).b);
      // A reflection reverses an arc: its start can only map to the mirror's end, or it comes out the complement.
      variant = ca?.type === 'arc' || dist(mirror, b1) < dist(mirror, b0) ? 1 : 0;
    }
    addConstraint(c.design, c.sketch, 'symmetric', [a.id, b.id, axis.id], variant === undefined ? {} : { variant });
  },
});

// ---------------------------------------------------------------------------
// Curvature

const CURVATURE_OTHER = new Set<Type>(['line', 'axis', 'circle', 'arc', 'ellipse', 'fitSpline', 'controlSpline', 'conic']);

export const curvatureTool: ToolDef = defineConstraintTool({
  meta: { id: 'curvature', label: 'Curvature' },
  count: 2,
  prompts: ['Select the spline, or the curve chained to it', 'Select the other one'],
  refuse: notTouching,
  accept(ctx, hit, picked) {
    const t = typeOf(ctx, hit);
    if (!t || !CURVATURE_OTHER.has(t)) return false;
    const first = picked[0];
    if (!first) return true;
    const f = typeOf(ctx, first);
    if (first.id === hit.id || !(isSplineType(f) || isSplineType(t))) return false;
    return endsVariant(ctx, first, hit) !== undefined;
  },
  apply(c, picks, ctx) {
    // Refs run spline first, as the solver and the data model expect.
    const [a, b] = isSplineType(typeOf(ctx, picks[0])) ? picks : [picks[1], picks[0]];
    const variant = endsVariant(ctx, a, b);
    const tb = typeOf(ctx, b);
    // A natural fit spline end has zero curvature, which is a line's: G2 holds as long as no handle
    // is activated there, and the line takes the spline's direction.
    const spline = c.sketch.curves[a.id];
    const naturalEnd = spline?.type === 'fitSpline' && isLineLike(tb) && spline.handles[variant === 1 ? spline.pts.length - 1 : 0] === null;
    if (!naturalEnd) steerFitEnds(c, ctx, a, b);
    addConstraint(c.design, c.sketch, 'curvature', [a.id, b.id], variant === undefined ? {} : { variant });
    // G2 needs something to steer at the joint, on either curve: a control spline's next two control
    // points, or the handle steerFitEnds has just made sure of. A conic has neither.
    const steers = (id: Id): boolean => {
      const k = c.sketch.curves[id];
      return k?.type === 'controlSpline' ? k.pts.length >= 3 : k?.type === 'fitSpline' && !k.closed;
    };
    if (!naturalEnd && !steers(a.id) && !steers(b.id)) {
      ctx.message('This pairing keeps tangent (G1) continuity: neither curve has anything to steer curvature (G2) with. A conic and a two point control spline do not.', 'warn');
    }
  },
});

export const constraintTools: ToolDef[] = [
  coincidentTool, horizontalVerticalTool, equalTool, tangentTool, parallelTool, perpendicularTool, fixTool, midpointTool,
  concentricTool, collinearTool, symmetryTool, curvatureTool,
];
