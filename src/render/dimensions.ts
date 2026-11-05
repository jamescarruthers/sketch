// Dimension geometry. The same layout feeds drawing and hit testing, so a label is where you see it.
import type { Curve, Design, Dimension, Id, Sketch, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y } from '../model/types';
import { getPointPos, hasPoint } from '../model/document';
import { radiusOf } from '../model/parameters';
import { closestPoint, lineOf } from '../geom/curves';
import { add, cross, dist, dot, len, norm, perp, scale, sub, TAU, wrapAngle } from '../geom/vec';
import type { View } from '../app/view';
import { dimensionText } from '../app/format';
import type { Painter } from './painter';
import { COLORS, FONT } from './style';

export interface DimLayout {
  id: Id;
  text: string;
  label: Vec2;
  lines: [Vec2, Vec2][];
  /** Thin lines from the geometry to the dimension line. */
  extensions: [Vec2, Vec2][];
  arcs: { c: Vec2; r: number; start: number; sweep: number }[];
  /** Tip positions and the direction each arrow points. */
  arrows: { at: Vec2; dir: Vec2 }[];
}

function pointOf(sketch: Sketch, id: Id): Vec2 | null {
  if (hasPoint(sketch, id)) return getPointPos(sketch, id);
  const c = sketch.curves[id];
  if (c && (c.type === 'circle' || c.type === 'arc' || c.type === 'ellipse' || c.type === 'ellipticalArc')) {
    return getPointPos(sketch, c.c);
  }
  return null;
}

function linear(out: DimLayout, p: Vec2, q: Vec2, u: Vec2, label: Vec2, view: View): void {
  const n = perp(u);
  const a = add(p, scale(n, dot(sub(label, p), n)));
  const b = add(q, scale(n, dot(sub(label, q), n)));
  const over = view.px(4);
  const ext = (from: Vec2, to: Vec2): void => {
    const d = sub(to, from);
    if (len(d) > view.px(1)) out.extensions.push([from, add(to, scale(norm(d), over))]);
  };
  ext(p, a);
  ext(q, b);
  const dir = norm(sub(b, a));
  const span = dist(a, b);
  const along = dot(sub(label, a), dir);
  const outside = span * view.ppm < 34;
  const lo = Math.min(0, along);
  const hi = Math.max(span, along);
  out.lines.push([add(a, scale(dir, lo)), add(a, scale(dir, hi))]);
  if (outside) {
    out.lines.push([add(a, scale(dir, -view.px(14))), a], [b, add(b, scale(dir, view.px(14)))]);
  }
  out.arrows.push({ at: a, dir: outside ? dir : scale(dir, -1) }, { at: b, dir: outside ? scale(dir, -1) : dir });
}

function radial(out: DimLayout, c: Vec2, r: number, label: Vec2, both: boolean): void {
  const dir = len(sub(label, c)) > 0 ? norm(sub(label, c)) : { x: 1, y: 0 };
  const rim = add(c, scale(dir, r));
  const far = both ? add(c, scale(dir, -r)) : c;
  out.lines.push([far, rim]);
  if (dist(c, label) > r) out.lines.push([rim, label]);
  out.arrows.push({ at: rim, dir });
  if (both) out.arrows.push({ at: far, dir: scale(dir, -1) });
}

function angular(out: DimLayout, sketch: Sketch, d: Dimension): boolean {
  const l = lineOf(sketch, d.refs[0]);
  const m = lineOf(sketch, d.refs[1]);
  if (!l || !m) return false;
  const denom = cross(l.d, m.d);
  if (Math.abs(denom) < 1e-12) return false;
  const k = cross(sub(m.p, l.p), m.d) / denom;
  const crossing = add(l.p, scale(l.d, k));
  // Against an axis the arc sits at the line's own end, on a short local reference [ref slot images].
  const local = localVertex(sketch, d, crossing);
  const v = local?.at ?? crossing;
  const r = Math.max(dist(v, d.label), 1e-6);
  const theta = Math.atan2(d.label.y - v.y, d.label.x - v.x);
  const rays = [l.d, scale(l.d, -1), m.d, scale(m.d, -1)].map((u) => Math.atan2(u.y, u.x));
  let start = 0;
  let sweep = 0;
  let best = Infinity;
  for (const a of rays) {
    for (const b of rays) {
      const s = wrapAngle(b - a);
      if (s <= 1e-9 || s >= Math.PI) continue;
      if (wrapAngle(theta - a) <= s && s < best) {
        best = s;
        start = a;
        sweep = s;
      }
    }
  }
  if (best === Infinity) return false;
  out.arcs.push({ c: v, r, start, sweep });
  if (local) out.extensions.push([v, add(v, scale(local.axis, r * 1.08))]);
  const tip = (a: number): Vec2 => add(v, { x: r * Math.cos(a), y: r * Math.sin(a) });
  const a0 = tip(start);
  const a1 = tip(start + sweep);
  out.extensions.push([v, add(a0, scale(norm(sub(a0, v)), r * 0.08))], [v, add(a1, scale(norm(sub(a1, v)), r * 0.08))]);
  out.arrows.push(
    { at: a0, dir: { x: Math.sin(start), y: -Math.cos(start) } },
    { at: a1, dir: { x: -Math.sin(start + sweep), y: Math.cos(start + sweep) } },
  );
  return true;
}

/** For an angle to an origin axis: the end of the line nearer its label, if the crossing is far off the line. */
function localVertex(sketch: Sketch, d: Dimension, crossing: Vec2): { at: Vec2; axis: Vec2 } | null {
  const axisRef = [AXIS_X, AXIS_Y].find((id) => d.refs.includes(id));
  const line = d.refs.map((id) => sketch.curves[id]).find((c) => c?.type === 'line');
  if (!axisRef || line?.type !== 'line') return null;
  const a = getPointPos(sketch, line.a);
  const b = getPointPos(sketch, line.b);
  if (Math.min(dist(a, crossing), dist(b, crossing)) < 1e-6) return null;
  const at = dist(a, d.label) <= dist(b, d.label) ? a : b;
  const far = at === a ? b : a;
  const axis = axisRef === AXIS_X ? { x: Math.sign(far.x - at.x) || 1, y: 0 } : { x: 0, y: Math.sign(far.y - at.y) || 1 };
  return { at, axis };
}

function curveRef(sketch: Sketch, id: Id): Curve | undefined {
  return sketch.curves[id];
}

/** Null when the references no longer resolve. */
export function layoutDimension(design: Design, sketch: Sketch, d: Dimension, view: View): DimLayout | null {
  const out: DimLayout = {
    id: d.id, text: dimensionText(design, d), label: d.label, lines: [], extensions: [], arcs: [], arrows: [],
  };
  const r0 = d.refs[0];
  const r1 = d.refs[1];
  switch (d.kind) {
    case 'distance': case 'horizontal': case 'vertical': {
      const only = d.refs.length === 1 ? curveRef(sketch, r0) : undefined;
      if (d.refs.length === 2 && curveRef(sketch, r0) && curveRef(sketch, r1)) {
        const a = closestPoint(sketch, curveRef(sketch, r0) as Curve, d.label).p;
        const b = closestPoint(sketch, curveRef(sketch, r1) as Curve, d.label).p;
        out.lines.push([a, b]);
        if (len(sub(b, a)) > 0) {
          const dir = norm(sub(b, a));
          out.arrows.push({ at: a, dir: scale(dir, -1) }, { at: b, dir });
        }
        out.extensions.push([b, d.label]);
        return out;
      }
      if (d.kind === 'distance' && d.refs.length === 2 && curveRef(sketch, r1)?.type === 'line') {
        return pointLine(out, sketch, r0, r1, d, view);
      }
      const p = only?.type === 'line' ? getPointPos(sketch, only.a) : pointOf(sketch, r0);
      const q = only?.type === 'line' ? getPointPos(sketch, only.b) : pointOf(sketch, r1);
      if (!p || !q) return null;
      const u = d.kind === 'horizontal' ? { x: 1, y: 0 } : d.kind === 'vertical' ? { x: 0, y: 1 } : norm(sub(q, p));
      linear(out, p, q, u, d.label, view);
      return out;
    }
    case 'pointLine': return pointLine(out, sketch, r0, r1, d, view);
    case 'lineLine': {
      const a = lineOf(sketch, r0);
      const b = lineOf(sketch, r1);
      if (!a || !b) return null;
      const u = norm(a.d);
      const p = add(a.p, scale(u, Math.max(0, Math.min(len(a.d), dot(sub(d.label, a.p), u)))));
      const ub = norm(b.d);
      const q = add(b.p, scale(ub, dot(sub(p, b.p), ub)));
      linear(out, p, q, norm(sub(q, p)), d.label, view);
      return out;
    }
    case 'tangentLine': {
      const c = curveRef(sketch, r0) as { c: Id } | undefined;
      const l = lineOf(sketch, r1);
      const rad = radiusOf(sketch, r0);
      if (!c || !l || rad === null) return null;
      const centre = getPointPos(sketch, c.c);
      const u = norm(l.d);
      const foot = add(l.p, scale(u, dot(sub(centre, l.p), u)));
      const toLine = norm(sub(foot, centre));
      const rim = add(centre, scale(toLine, ((d.variant ?? 0) & 1) === 1 ? -rad : rad));
      linear(out, rim, foot, toLine, d.label, view);
      return out;
    }
    case 'tangentRounds': {
      const a = curveRef(sketch, r0) as { c: Id } | undefined;
      const b = curveRef(sketch, r1) as { c: Id } | undefined;
      const ra = radiusOf(sketch, r0);
      const rb = radiusOf(sketch, r1);
      if (!a || !b || ra === null || rb === null) return null;
      const p = getPointPos(sketch, a.c);
      const q = getPointPos(sketch, b.c);
      const u = norm(sub(q, p));
      const v = d.variant ?? 0;
      linear(out, add(p, scale(u, (v & 1) === 1 ? -ra : ra)), add(q, scale(u, (v & 2) === 2 ? rb : -rb)), u, d.label, view);
      return out;
    }
    case 'angle': return angular(out, sketch, d) ? out : null;
    case 'radius': case 'diameter': {
      const c = curveRef(sketch, r0);
      if (d.refs.length === 2 && c?.type === 'line') {
        const l = lineOf(sketch, r0);
        const p = pointOf(sketch, r1);
        if (!l || !p) return null;
        const u = norm(l.d);
        const foot = add(l.p, scale(u, dot(sub(p, l.p), u)));
        const mirror = add(foot, sub(foot, p));
        linear(out, p, mirror, norm(sub(mirror, p)), d.label, view);
        return out;
      }
      if (c?.type !== 'circle' && c?.type !== 'arc') return null;
      const centre = getPointPos(sketch, c.c);
      const r = c.type === 'circle' ? c.r : dist(centre, getPointPos(sketch, c.a));
      radial(out, centre, r, d.label, d.kind === 'diameter');
      return out;
    }
    case 'arcLength': {
      const c = curveRef(sketch, r0);
      if (c?.type !== 'arc') return null;
      const centre = getPointPos(sketch, c.c);
      const a = getPointPos(sketch, c.a);
      const b = getPointPos(sketch, c.b);
      const start = Math.atan2(a.y - centre.y, a.x - centre.x);
      const sweep = wrapAngle(Math.atan2(b.y - centre.y, b.x - centre.x) - start) || TAU;
      const r = dist(centre, d.label);
      out.arcs.push({ c: centre, r, start, sweep });
      out.extensions.push([a, add(centre, scale(norm(sub(a, centre)), r))], [b, add(centre, scale(norm(sub(b, centre)), r))]);
      return out;
    }
    case 'ellipseAxis': {
      const c = curveRef(sketch, r0);
      if (c?.type !== 'ellipse' && c?.type !== 'ellipticalArc') return null;
      const m = getPointPos(sketch, c.c);
      const e = getPointPos(sketch, (d.variant ?? 0) & 1 ? c.minor : c.major);
      linear(out, m, e, norm(sub(e, m)), d.label, view);
      return out;
    }
  }
}

function pointLine(out: DimLayout, sketch: Sketch, pid: Id, lid: Id, d: Dimension, view: View): DimLayout | null {
  const [pointId, lineId] = hasPoint(sketch, pid) ? [pid, lid] : [lid, pid];
  const p = pointOf(sketch, pointId);
  const l = lineOf(sketch, lineId);
  if (!p || !l) return null;
  const u = norm(l.d);
  const foot = add(l.p, scale(u, dot(sub(p, l.p), u)));
  if (dist(p, foot) < 1e-9) return null;
  linear(out, p, foot, norm(sub(foot, p)), d.label, view);
  return out;
}

/** The point a dimension's label travels with. */
function anchorOf(sketch: Sketch, d: Dimension): Vec2 | null {
  const refs = d.refs.flatMap((r): Vec2[] => {
    const c = sketch.curves[r];
    if (c?.type === 'line') return [getPointPos(sketch, c.a), getPointPos(sketch, c.b)];
    const p = pointOf(sketch, r);
    return p ? [p] : [];
  });
  if (!refs.length) return null;
  return scale(refs.reduce(add, { x: 0, y: 0 }), 1 / refs.length);
}

/** Move labels with their geometry, given the anchors from last time. Returns the new anchors. */
export function followLabels(sketch: Sketch, previous: Map<Id, Vec2>): Map<Id, Vec2> {
  const next = new Map<Id, Vec2>();
  for (const d of Object.values(sketch.dimensions)) {
    const now = anchorOf(sketch, d);
    if (!now) continue;
    const was = previous.get(d.id);
    if (was) d.label = add(d.label, sub(now, was));
    next.set(d.id, now);
  }
  return next;
}

const LABEL_H = 18;

/** Label rectangle half sizes in pixels, from the same font the renderer uses. */
export function labelSize(g: CanvasRenderingContext2D, text: string): { w: number; h: number } {
  g.font = FONT;
  return { w: g.measureText(text).width + 8, h: LABEL_H };
}

function arrow(p: Painter, at: Vec2, dir: Vec2, color: string): void {
  const { g, view } = p;
  const s = view.toScreen(at);
  const ang = Math.atan2(-dir.y, dir.x);
  g.save();
  g.translate(s.x, s.y);
  g.rotate(ang);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(-8, -2.6);
  g.lineTo(-8, 2.6);
  g.closePath();
  g.fill();
  g.restore();
}

export function drawDimension(p: Painter, layout: DimLayout, state: { color: string; halo?: string; bold?: boolean }): void {
  const { g, view } = p;
  const style = { color: state.color, width: state.bold ? 1.6 : 1 };
  for (const [a, b] of layout.extensions) p.line(a, b, { color: state.color, width: 0.8 });
  for (const [a, b] of layout.lines) p.line(a, b, style);
  for (const a of layout.arcs) p.arc(a.c, a.r, a.start, a.sweep, style);
  for (const a of layout.arrows) arrow(p, a.at, a.dir, state.color);
  const s = view.toScreen(layout.label);
  const { w, h } = labelSize(g, layout.text);
  g.fillStyle = state.halo ?? COLORS.labelBg;
  g.fillRect(s.x - w / 2, s.y - h / 2, w, h);
  g.fillStyle = state.color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(layout.text, s.x, s.y + 0.5);
}

export const dimensionColor = (d: Dimension, offset = !!d.feature): string =>
  offset ? COLORS.dimensionMuted : d.driving ? COLORS.dimension : COLORS.dimensionMuted;
