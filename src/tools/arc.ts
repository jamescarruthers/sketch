// 3-Point, Center Point and Tangent arcs [ref SKT-CREATE-ARCS].
import type { Id, Vec2 } from '../model/types';
import { addArc, addConstraint, addPoint, getPointPos } from '../model/document';
import { closestPoint, resolve, unitTangent } from '../geom/curves';
import { curveEndingAt, endTangent } from '../app/snap';
import { add, cross, dist, dot, lerp, norm, perp, scale, sub, TAU } from '../geom/vec';
import { COLORS } from '../render/style';
import { circumcircle } from './circle';
import { angleOf, constructionLine, makeSweep, polar, previewArc, relativeAngleLock, unsignedAngle, X_AXIS } from './kit';
import { tangentArc } from './line';
import { defineClickTool, previewStroke, radialLock, type Placed, type ToolContext, type ToolDef } from './tool';

const group = 'arc';
/** sin of how far off tangent an arc end may land and still count as tangent: 3 degrees. */
const END_TANGENT = 0.052;

/** Circle through three points, and whether a -> m -> b runs counter-clockwise. */
export function arcThrough(a: Vec2, b: Vec2, m: Vec2): { c: Vec2; r: number; ccw: boolean } | null {
  const circle = circumcircle(a, b, m);
  return circle && { ...circle, ccw: cross(sub(m, a), sub(b, a)) > 0 };
}

/** A typed radius moves the third point onto the arc of that radius nearer to the cursor's height. */
export function radiusLock(a: Vec2, b: Vec2): (p: Vec2, r: number) => Vec2 {
  return (p, radius) => {
    const half = dist(a, b) / 2;
    const n = perp(norm(sub(b, a)));
    const m = lerp(a, b, 0.5);
    const h = dot(sub(p, m), n);
    const r = Math.max(radius, half);
    const k = Math.sqrt(Math.max(r * r - half * half, 0));
    const minor = r - k;
    const major = r + k;
    const height = Math.abs(Math.abs(h) - minor) <= Math.abs(Math.abs(h) - major) ? minor : major;
    return add(m, scale(n, (h >= 0 ? 1 : -1) * height));
  };
}

export const arc3Point: ToolDef = defineClickTool({
  meta: { id: 'arc-3pt', label: '3-Point Arc', panel: 'create', group },
  label: 'Arc',
  steps: [
    { prompt: 'Click the first end point' },
    {
      prompt: 'Click the second end point, or type the distance',
      from: 0,
      fields(s) {
        const a = s.at(0);
        const b = s.cursor.pos;
        return [{ key: 'length', kind: 'length', value: dist(a, b), at: lerp(a, b, 0.5), lock: radialLock(a) }];
      },
    },
    {
      prompt: 'Click a point on the arc, or type the radius',
      snap: (s) => ({ chord: { a: s.at(0), b: s.at(1) } }),
      fields(s) {
        const a = s.at(0);
        const b = s.at(1);
        const g = arcThrough(a, b, s.cursor.pos);
        return [{ key: 'radius', label: 'R', kind: 'length', value: g?.r ?? 0, at: s.cursor.pos, lock: radiusLock(a, b) }];
      },
      valid: (s) => arcThrough(s.at(0), s.at(1), s.cursor.pos) !== null || 'The three points must not be in a line',
    },
  ],
  preview(p, s) {
    const stroke = previewStroke(s.ctx.lineType);
    if (s.picks.length < 2) {
      p.line(s.at(0), s.at(1), stroke);
      return;
    }
    const g = arcThrough(s.at(0), s.at(1), s.at(2));
    if (g) previewArc(p, g.c, s.at(0), s.at(1), g.ccw, stroke);
    else p.line(s.at(0), s.at(1), stroke);
  },
  commit(c, s) {
    const a = s.at(0);
    const b = s.at(1);
    const g = arcThrough(a, b, s.at(2));
    if (!g) return false;
    const arc = g.ccw ? addArc(c.design, c.sketch, g.c, a, b, c.curveOpts) : addArc(c.design, c.sketch, g.c, b, a, c.curveOpts);
    const [ia, ib] = g.ccw ? [arc.a, arc.b] : [arc.b, arc.a];
    c.infer(ia, s.picks[0]);
    c.infer(ib, s.picks[1]);
    c.inferRim(arc.id, s.picks[2]);
    // Exactly over the middle of the chord: that point is held at the middle of the arc [ref GUID-087596A4].
    const mid = s.picks[2].inference;
    if (mid.kind === 'midpoint' && !mid.curve) addConstraint(c.design, c.sketch, 'midpoint', [addPoint(c.design, c.sketch, s.at(2), { owner: arc.id }).id, arc.id]);
    const px = s.ctx.view.px(22);
    c.hudDimension('length', 'distance', [ia, ib], { label: add(lerp(a, b, 0.5), scale(perp(norm(sub(b, a))), -px)) });
    c.hudDimension('radius', 'radius', [arc.id], { label: add(g.c, scale(norm(sub(s.at(2), g.c)), g.r * 0.5)) });
  },
});

const MIN_SWEEP = 1e-6;

const sweepOf = makeSweep();

export const arcCenter: ToolDef = defineClickTool({
  meta: { id: 'arc-center', label: 'Center Point Arc', panel: 'create', group },
  label: 'Arc',
  steps: [
    { prompt: 'Click the centre' },
    {
      prompt: 'Click the start point, or type the radius and angle',
      from: 0,
      fields(s) {
        const c = s.at(0);
        const p = s.cursor.pos;
        sweepOf(c, p, p, true);
        return [
          { key: 'radius', label: 'R', kind: 'length', value: dist(c, p), at: lerp(c, p, 0.5), lock: radialLock(c) },
          {
            key: 'angle', kind: 'angle', value: unsignedAngle(X_AXIS, sub(p, c)),
            at: add(c, { x: s.ctx.view.px(48), y: s.ctx.view.px(-16) }), lock: relativeAngleLock(c, X_AXIS),
          },
        ];
      },
    },
    {
      prompt: 'Click the end point, or type the angle',
      fields(s) {
        const c = s.at(0);
        const a = s.at(1);
        const sw = sweepOf(c, a, s.cursor.pos);
        const r = dist(c, a);
        const lock = (p: Vec2, v: number): Vec2 => {
          const sign = sweepOf(c, a, p) < 0 ? -1 : 1;
          return polar(c, angleOf(c, a) + sign * Math.min(v, TAU - 1e-3), r);
        };
        return [{
          key: 'sweep', kind: 'angle', value: Math.abs(sw), at: add(c, scale(norm(sub(s.cursor.pos, c)), r + s.ctx.view.px(24))), lock,
        }];
      },
      valid: (s) => Math.abs(sweepOf(s.at(0), s.at(1), s.cursor.pos)) > MIN_SWEEP || 'The arc needs a sweep',
    },
  ],
  preview(p, s) {
    const stroke = previewStroke(s.ctx.lineType);
    const c = s.at(0);
    const a = s.at(1);
    if (s.picks.length < 2) {
      p.line(c, a, stroke);
      return;
    }
    const sw = sweepOf(c, a, s.cursor.pos);
    const a0 = angleOf(c, a);
    p.line(c, a, { color: COLORS.construction, dash: [7, 5], width: 1 });
    p.line(c, polar(c, a0 + sw, dist(c, a)), { color: COLORS.construction, dash: [7, 5], width: 1 });
    p.arc(c, dist(c, a), a0, sw, stroke);
  },
  commit(c, s) {
    const centre = s.at(0);
    const start = s.at(1);
    const r = dist(centre, start);
    const sw = sweepOf(centre, start, s.at(2));
    if (Math.abs(sw) < MIN_SWEEP) return false;
    const end = polar(centre, angleOf(centre, start) + sw, r);
    const ccw = sw > 0;
    const arc = ccw ? addArc(c.design, c.sketch, centre, start, end, c.curveOpts) : addArc(c.design, c.sketch, centre, end, start, c.curveOpts);
    const [is, ie] = ccw ? [arc.a, arc.b] : [arc.b, arc.a];
    c.infer(arc.c, s.picks[0]);
    c.infer(is, s.picks[1]);
    if (dist(s.at(2), end) < 1e-6 * Math.max(1, r)) c.infer(ie, s.picks[2]);
    const px = s.ctx.view.px(24);
    c.hudDimension('radius', 'radius', [arc.id], { label: add(centre, scale(norm(sub(start, centre)), r * 0.6)) });
    const hud = s.ctx.hud;
    if (hud.locked('angle') || (hud.locked('sweep') && Math.abs(sw) <= Math.PI)) {
      // Angles are between lines, so a typed angle brings construction radii to measure.
      const first = constructionLine(c, centre, start, arc.c, is);
      c.hudDimension('angle', 'angle', ['axis-x', first.id], { label: add(centre, { x: px * 2, y: px / 2 }) });
      if (hud.locked('sweep') && Math.abs(sw) <= Math.PI) {
        const second = constructionLine(c, centre, end, arc.c, ie);
        c.hudDimension('sweep', 'angle', [first.id, second.id], { label: polar(centre, angleOf(centre, start) + sw / 2, r + px) });
      }
    }
  },
});

/**
 * Where the tangent arc may start: the end of a curve, found through the snapped point, or anywhere
 * along one. Along a curve either way is tangent, so `toward` picks the way the cursor went.
 */
function startOf(ctx: ToolContext, at: Placed, toward?: Vec2): { point: Id | null; curve: Id; dir: Vec2 } | null {
  const inf = at.inference;
  const sketch = ctx.sketch;
  const along = inf.curve ? sketch.curves[inf.curve] : undefined;
  if (along && along.type !== 'text' && (inf.kind === 'onCurve' || inf.kind === 'midpoint' || inf.kind === 'quadrant')) {
    const u = unitTangent(resolve(sketch, along), closestPoint(sketch, along, at.pos).t);
    return { point: null, curve: along.id, dir: toward && dot(u, sub(toward, at.pos)) < 0 ? scale(u, -1) : u };
  }
  if (inf.kind !== 'point' || !inf.point) return null;
  const curve = curveEndingAt(sketch, inf.point);
  const dir = curve ? endTangent(sketch, curve, inf.point) : null;
  return curve && dir ? { point: inf.point, curve, dir: norm(dir) } : null;
}

export const arcTangent: ToolDef = defineClickTool({
  meta: { id: 'arc-tangent', label: 'Tangent Arc', panel: 'create', group },
  label: 'Arc',
  steps: [
    {
      prompt: 'Click a line, arc or spline to start the tangent arc',
      valid: (s) => startOf(s.ctx, s.cursor) !== null || 'A tangent arc starts on a curve',
    },
    {
      prompt: 'Click the end point, or type the radius',
      fields(s) {
        const begin = startOf(s.ctx, s.picks[0], s.cursor.pos);
        const p0 = s.at(0);
        const shape = begin ? tangentArc(p0, begin.dir, s.cursor.pos) : null;
        if (!begin || !shape) return [];
        const side = shape.ccw ? 1 : -1;
        return [{
          key: 'radius', label: 'R', kind: 'length', value: shape.r, at: s.cursor.pos,
          lock: (p, v) => radialLock(add(p0, scale(perp(begin.dir), side * v)))(p, v),
        }];
      },
      valid(s) {
        const begin = startOf(s.ctx, s.picks[0], s.cursor.pos);
        return (!!begin && tangentArc(s.at(0), begin.dir, s.cursor.pos) !== null) || 'Move off the tangent line to make an arc';
      },
    },
  ],
  preview(p, s) {
    const begin = startOf(s.ctx, s.picks[0], s.at(1));
    const shape = begin ? tangentArc(s.at(0), begin.dir, s.at(1)) : null;
    const stroke = previewStroke(s.ctx.lineType);
    if (!shape) {
      p.line(s.at(0), s.at(1), stroke);
      return;
    }
    previewArc(p, shape.c, s.at(0), s.at(1), shape.ccw, stroke);
  },
  commit(c, s) {
    const end = s.at(1);
    const begin = startOf(s.ctx, s.picks[0], end);
    if (!begin) return false;
    const p0 = begin.point ? getPointPos(c.sketch, begin.point) : s.at(0);
    const shape = tangentArc(p0, begin.dir, end);
    if (!shape || dist(p0, end) < 1e-6) return false;
    // Landing on another curve's end along its direction is tangent there too [ref SKT-SKETCH-CREATE-ARCS].
    const land = s.picks[1].inference.point;
    const other = land ? curveEndingAt(c.sketch, land) : null;
    const leaving = land && other && other !== begin.curve ? endTangent(c.sketch, other, land) : null;
    const smooth = !!leaving && Math.abs(cross(norm(leaving), perp(norm(sub(end, shape.c))))) < END_TANGENT;
    const arc = shape.ccw ? addArc(c.design, c.sketch, shape.c, p0, end, c.curveOpts) : addArc(c.design, c.sketch, shape.c, end, p0, c.curveOpts);
    const [is, ie] = shape.ccw ? [arc.a, arc.b] : [arc.b, arc.a];
    if (begin.point) addConstraint(c.design, c.sketch, 'coincident', [begin.point, is]);
    else c.infer(is, s.picks[0]);
    addConstraint(c.design, c.sketch, 'tangent', [begin.curve, arc.id]);
    c.infer(ie, s.picks[1]);
    if (smooth && other) addConstraint(c.design, c.sketch, 'tangent', [other, arc.id]);
    c.hudDimension('radius', 'radius', [arc.id], { label: add(shape.c, scale(norm(sub(end, shape.c)), shape.r * 0.6)) });
  },
});

export const arcTools: ToolDef[] = [arc3Point, arcCenter, arcTangent];
