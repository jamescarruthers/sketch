// The five slots [ref SKT-CREATE-SLOTS]: two lines (or concentric arcs) and two end caps, with a
// construction centreline or centre arc through the cap centres. One definition per shape below.
import type { Arc, Id, Line, Vec2 } from '../model/types';
import { addArc, addConstraint, addLine, addPoint } from '../model/document';
import { add, cross, dist, dot, lerp, norm, perp, scale, sub, TAU } from '../geom/vec';
import { arcThrough, radiusLock } from './arc';
import { angleOf, CONSTRUCTION, constructionLine, makeSweep, polar, relativeAngleLock, unsignedAngle, X_AXIS } from './kit';
import {
  defineClickTool, previewStroke, radialLock, type ClickState, type ClickStep, type CommitScope, type HudField, type Preview,
  type Stroke, type ToolDef,
} from './tool';

const group = 'slot';
const MIN = 1e-6;

/** Straight slot: cap centres c1 and c2, half-width r. */
interface Linear { c1: Vec2; c2: Vec2; r: number }
/** Arc slot: centre arc about o of radius R from a to b counter-clockwise, half-width r. */
interface Curved { o: Vec2; R: number; a: Vec2; b: Vec2; r: number }

/** 0 for circles that touch from outside, 1 for one inside the other: the solver keeps the branch [variant]. */
const tangentVariant = (c1: Vec2, r1: number, c2: Vec2, r2: number): number => {
  const d = dist(c1, c2);
  return Math.abs(d - (r1 + r2)) <= Math.abs(d - Math.abs(r1 - r2)) ? 0 : 1;
};

function previewLinear(p: Preview, g: Linear, stroke: Stroke): void {
  const u = norm(sub(g.c2, g.c1));
  const n = scale(perp(u), g.r);
  const th = Math.atan2(u.y, u.x);
  p.line(sub(g.c1, n), sub(g.c2, n), stroke);
  p.line(add(g.c1, n), add(g.c2, n), stroke);
  p.arc(g.c2, g.r, th - Math.PI / 2, Math.PI, stroke);
  p.arc(g.c1, g.r, th + Math.PI / 2, Math.PI, stroke);
  p.line(g.c1, g.c2, CONSTRUCTION);
}

const ccwFrom = (a: number, b: number): number => (((b - a) % TAU) + TAU) % TAU;

function previewCurved(p: Preview, g: Curved, stroke: Stroke): void {
  const ta = angleOf(g.o, g.a);
  const tb = angleOf(g.o, g.b);
  const sweep = ccwFrom(ta, tb);
  p.arc(g.o, g.R + g.r, ta, sweep, stroke);
  p.arc(g.o, g.R - g.r, ta, sweep, stroke);
  p.arc(g.b, g.r, tb, Math.PI, stroke);
  p.arc(g.a, g.r, ta + Math.PI, Math.PI, stroke);
  p.arc(g.o, g.R, ta, sweep, CONSTRUCTION);
}

interface Built {
  /** End cap at the start of the centreline (c1, or the first end counter-clockwise). */
  capA: Arc;
  capB: Arc;
  /** The construction centreline or centre arc. */
  centre: Id;
}

function buildLinear(c: CommitScope, g: Linear, ends?: [Vec2, Vec2]): Built {
  const { design, sketch } = c;
  const u = norm(sub(g.c2, g.c1));
  const n = scale(perp(u), g.r);
  const o = c.curveOpts;
  const bottom = addLine(design, sketch, sub(g.c1, n), sub(g.c2, n), o);
  const top = addLine(design, sketch, add(g.c2, n), add(g.c1, n), o);
  const capB = addArc(design, sketch, g.c2, sub(g.c2, n), add(g.c2, n), o);
  const capA = addArc(design, sketch, g.c1, add(g.c1, n), sub(g.c1, n), o);
  const k = (type: Parameters<typeof addConstraint>[2], refs: Id[]): void => {
    addConstraint(design, sketch, type, refs);
  };
  k('coincident', [bottom.b, capB.a]);
  k('coincident', [capB.b, top.a]);
  k('coincident', [top.b, capA.a]);
  k('coincident', [capA.b, bottom.a]);
  k('tangent', [bottom.id, capB.id]);
  k('tangent', [top.id, capB.id]);
  k('tangent', [top.id, capA.id]);
  k('tangent', [bottom.id, capA.id]);
  // Parallel sides on equal caps [ref slot-center-to-center.png]: with the tangents, this makes the caps equal too.
  k('parallel', [bottom.id, top.id]);
  if (ends) {
    // Overall Slot: the centreline runs end to end, from the middle of one cap to the other [ref slot-overall.png].
    const line = addLine(design, sketch, ends[0], ends[1], { lineType: 'construction' });
    k('midpoint', [line.a, capA.id]);
    k('midpoint', [line.b, capB.id]);
    return { capA, capB, centre: line.id };
  }
  const centre = constructionLine(c, g.c1, g.c2, capA.c, capB.c);
  return { capA, capB, centre: centre.id };
}

function buildCurved(c: CommitScope, g: Curved): Built {
  const { design, sketch } = c;
  const ta = angleOf(g.o, g.a);
  const tb = angleOf(g.o, g.b);
  const o = c.curveOpts;
  const outer = addArc(design, sketch, g.o, polar(g.o, ta, g.R + g.r), polar(g.o, tb, g.R + g.r), o);
  const inner = addArc(design, sketch, g.o, polar(g.o, ta, g.R - g.r), polar(g.o, tb, g.R - g.r), o);
  const capB = addArc(design, sketch, g.b, polar(g.b, tb, g.r), polar(g.b, tb + Math.PI, g.r), o);
  const capA = addArc(design, sketch, g.a, polar(g.a, ta + Math.PI, g.r), polar(g.a, ta, g.r), o);
  const k = (type: Parameters<typeof addConstraint>[2], refs: Id[], variant?: number): void => {
    addConstraint(design, sketch, type, refs, variant === undefined ? {} : { variant });
  };
  k('coincident', [outer.b, capB.a]);
  k('coincident', [capB.b, inner.b]);
  k('coincident', [inner.a, capA.a]);
  k('coincident', [capA.b, outer.a]);
  k('tangent', [outer.id, capB.id], tangentVariant(g.o, g.R + g.r, g.b, g.r));
  k('tangent', [inner.id, capB.id], tangentVariant(g.o, g.R - g.r, g.b, g.r));
  k('tangent', [inner.id, capA.id], tangentVariant(g.o, g.R - g.r, g.a, g.r));
  k('tangent', [outer.id, capA.id], tangentVariant(g.o, g.R + g.r, g.a, g.r));
  k('equal', [capA.id, capB.id]);
  const carc = addArc(design, sketch, g.o, g.a, g.b, { lineType: 'construction' });
  k('coincident', [capA.c, carc.a]);
  k('coincident', [capB.c, carc.b]);
  k('concentric', [outer.id, carc.id]);
  k('concentric', [inner.id, carc.id]);
  return { capA, capB, centre: carc.id };
}

/** The width step of a straight slot: half-width is the distance from the centreline. */
function linearWidthStep(centres: (s: ClickState) => [Vec2, Vec2], extra?: (s: ClickState) => string | true): ClickStep {
  return {
    prompt: 'Click the width of the slot, or type it',
    fields(s) {
      const [c1, c2] = centres(s);
      const u = norm(sub(c2, c1));
      const n = perp(u);
      const p = s.cursor.pos;
      return [{
        key: 'width', kind: 'length', value: 2 * Math.abs(dot(sub(p, c1), n)), at: p,
        lock: (q, v) => add(add(c1, scale(u, dot(sub(q, c1), u))), scale(n, (dot(sub(q, c1), n) >= 0 ? 1 : -1) * (v / 2))),
      }];
    },
    valid(s) {
      const [c1, c2] = centres(s);
      if (Math.abs(cross(norm(sub(c2, c1)), sub(s.cursor.pos, c1))) <= MIN) return 'Move off the centreline to set the width';
      return extra ? extra(s) : true;
    },
  };
}

/** The width step of an arc slot: half-width is how far the point is from the centre arc. */
function curvedWidthStep(arc: (s: ClickState) => { o: Vec2; R: number }): ClickStep {
  return {
    prompt: 'Click the width of the slot, or type it',
    fields(s) {
      const { o, R } = arc(s);
      const p = s.cursor.pos;
      return [{
        key: 'width', kind: 'length', value: 2 * Math.abs(dist(o, p) - R), at: p,
        lock: (q, v) => polar(o, angleOf(o, q), R + (dist(o, q) >= R ? 1 : -1) * (v / 2)),
      }];
    },
    valid(s) {
      const { o, R } = arc(s);
      const r = Math.abs(dist(o, s.cursor.pos) - R);
      return (r > MIN && r < R) || 'The width must be positive and less than twice the radius';
    },
  };
}

const lengthAngle = (s: ClickState, a: Vec2): HudField[] => {
  const p = s.cursor.pos;
  return [
    { key: 'length', kind: 'length', value: dist(a, p), at: lerp(a, p, 0.5), lock: radialLock(a) },
    {
      key: 'angle', kind: 'angle', value: unsignedAngle(X_AXIS, sub(p, a)),
      at: add(a, { x: s.ctx.view.px(48), y: s.ctx.view.px(-16) }), lock: relativeAngleLock(a, X_AXIS),
    },
  ];
};

const px = (s: ClickState, n: number): number => s.ctx.view.px(n);

function widthDimension(c: CommitScope, s: ClickState, cap: Arc, near: Vec2): void {
  c.hudDimension('width', 'diameter', [cap.id], { label: add(near, { x: px(s, 26), y: px(s, 12) }) });
}

function linearSlot(
  id: string, label: string, steps: ClickStep[],
  geometry: (s: ClickState) => Linear,
  finish: (c: CommitScope, s: ClickState, g: Linear, built: Built) => void,
  ends?: (s: ClickState) => [Vec2, Vec2],
): ToolDef {
  return defineClickTool({
    meta: { id, label, panel: 'create', group },
    label: 'Slot',
    steps,
    preview(p, s) {
      const stroke = previewStroke(s.ctx.lineType);
      if (s.picks.length < 2) {
        p.line(s.at(0), s.at(1), stroke);
        return;
      }
      const g = geometry(s);
      if (g.r > MIN && dist(g.c1, g.c2) > MIN) previewLinear(p, g, stroke);
    },
    commit(c, s) {
      const g = geometry(s);
      if (g.r < MIN || dist(g.c1, g.c2) < MIN) return false;
      const built = buildLinear(c, g, ends?.(s));
      finish(c, s, g, built);
      widthDimension(c, s, built.capA, g.c1);
    },
  });
}

/** Half-width of a straight slot whose axis runs a -> b, from a point beside it. */
const halfWidth = (a: Vec2, b: Vec2, p: Vec2): number => Math.abs(cross(norm(sub(b, a)), sub(p, a)));

/** Well along the slot from its start, past the cap's diameter label, inside the angle it measures. */
const axisLabel = (s: ClickState, from: Vec2): Vec2 => {
  const to = sub(s.at(1), from);
  const half = Math.atan2(to.y, to.x) / 2;
  return add(from, scale({ x: Math.cos(half), y: Math.sin(half) }, px(s, 96)));
};

export const slotCenterToCenter: ToolDef = linearSlot(
  'slot-c2c', 'Center To Center Slot',
  [
    { prompt: 'Click the centre of one end' },
    { prompt: 'Click the centre of the other end, or type the distance and angle', from: 0, fields: (s) => lengthAngle(s, s.at(0)) },
    linearWidthStep((s) => [s.at(0), s.at(1)]),
  ],
  (s) => ({ c1: s.at(0), c2: s.at(1), r: halfWidth(s.at(0), s.at(1), s.at(2)) }),
  (c, s, g, b) => {
    c.infer(b.capA.c, s.picks[0]);
    c.infer(b.capB.c, s.picks[1]);
    c.hudDimension('length', 'distance', [b.capA.c, b.capB.c], { label: add(lerp(g.c1, g.c2, 0.5), scale(perp(norm(sub(g.c2, g.c1))), -(g.r + px(s, 22)))) });
    c.hudDimension('angle', 'angle', ['axis-x', b.centre], { label: axisLabel(s, g.c1) });
  },
);

export const slotOverall: ToolDef = linearSlot(
  'slot-overall', 'Overall Slot',
  [
    { prompt: 'Click one end of the slot' },
    { prompt: 'Click the other end, or type the overall length and angle', from: 0, fields: (s) => lengthAngle(s, s.at(0)) },
    linearWidthStep(
      (s) => [s.at(0), s.at(1)],
      (s) => dist(s.at(0), s.at(1)) > 2 * halfWidth(s.at(0), s.at(1), s.cursor.pos) + MIN || 'The slot is shorter than it is wide',
    ),
  ],
  (s) => {
    const [e1, e2] = [s.at(0), s.at(1)];
    const r = halfWidth(e1, e2, s.at(2));
    const u = norm(sub(e2, e1));
    return { c1: add(e1, scale(u, r)), c2: sub(e2, scale(u, r)), r };
  },
  (c, s, g, b) => {
    const line = c.sketch.curves[b.centre] as Line;
    c.infer(line.a, s.picks[0]);
    c.infer(line.b, s.picks[1]);
    c.hudDimension('length', 'distance', [line.a, line.b], { label: add(lerp(s.at(0), s.at(1), 0.5), scale(perp(norm(sub(g.c2, g.c1))), -(g.r + px(s, 22)))) });
    c.hudDimension('angle', 'angle', ['axis-x', b.centre], { label: axisLabel(s, g.c1) });
  },
  (s) => [s.at(0), s.at(1)],
);

export const slotCenter: ToolDef = linearSlot(
  'slot-center', 'Center Point Slot',
  [
    { prompt: 'Click the centre of the slot' },
    { prompt: 'Click the centre of one end, or type the distance and angle', from: 0, fields: (s) => lengthAngle(s, s.at(0)) },
    linearWidthStep((s) => [sub(scale(s.at(0), 2), s.at(1)), s.at(1)]),
  ],
  (s) => {
    const other = sub(scale(s.at(0), 2), s.at(1));
    return { c1: other, c2: s.at(1), r: halfWidth(other, s.at(1), s.at(2)) };
  },
  (c, s, g, b) => {
    const mid = addPoint(c.design, c.sketch, s.at(0), { owner: b.centre });
    addConstraint(c.design, c.sketch, 'midpoint', [mid.id, b.centre]);
    c.infer(mid.id, s.picks[0]);
    c.infer(b.capB.c, s.picks[1]);
    c.hudDimension('length', 'distance', [mid.id, b.capB.c], { label: add(lerp(s.at(0), g.c2, 0.5), scale(perp(norm(sub(g.c2, g.c1))), -px(s, 22))) });
    c.hudDimension('angle', 'angle', ['axis-x', b.centre], { label: axisLabel(s, s.at(0)) });
  },
);

function curvedSlot(
  id: string, label: string, steps: ClickStep[],
  geometry: (s: ClickState) => Curved,
  finish: (c: CommitScope, s: ClickState, g: Curved, built: Built) => void,
): ToolDef {
  return defineClickTool({
    meta: { id, label, panel: 'create', group },
    label: 'Slot',
    steps,
    preview(p, s) {
      const stroke = previewStroke(s.ctx.lineType);
      if (s.picks.length < 3) {
        // The centre arc shows while its last point is chosen, before there is a width [ref].
        if (s.picks.length === 2) {
          const g = geometry(s);
          if (g.R > MIN) p.arc(g.o, g.R, angleOf(g.o, g.a), ccwFrom(angleOf(g.o, g.a), angleOf(g.o, g.b)), stroke);
        }
        return;
      }
      const g = geometry(s);
      if (g.R > g.r && g.r > MIN) previewCurved(p, g, stroke);
    },
    commit(c, s) {
      const g = geometry(s);
      if (g.r < MIN || g.r >= g.R) return false;
      const built = buildCurved(c, g);
      finish(c, s, g, built);
      widthDimension(c, s, built.capA, g.a);
    },
  });
}

export const slotThreePointArc: ToolDef = curvedSlot(
  'slot-3pt-arc', 'Three Point Arc Slot',
  [
    { prompt: 'Click the centre of one end' },
    {
      prompt: 'Click the centre of the other end, or type the distance',
      from: 0,
      fields: (s) => [{ key: 'length', kind: 'length', value: dist(s.at(0), s.cursor.pos), at: lerp(s.at(0), s.cursor.pos, 0.5), lock: radialLock(s.at(0)) }],
    },
    {
      prompt: 'Click a point on the arc between the centres, or type its radius',
      fields(s) {
        const g = arcThrough(s.at(0), s.at(1), s.cursor.pos);
        return [{ key: 'radius', label: 'R', kind: 'length', value: g?.r ?? 0, at: s.cursor.pos, lock: radiusLock(s.at(0), s.at(1)) }];
      },
      valid: (s) => arcThrough(s.at(0), s.at(1), s.cursor.pos) !== null || 'The three points must not be in a line',
    },
    curvedWidthStep((s) => {
      const g = arcThrough(s.at(0), s.at(1), s.at(2));
      return { o: g?.c ?? s.at(0), R: g?.r ?? 1 };
    }),
  ],
  (s) => {
    const g = arcThrough(s.at(0), s.at(1), s.at(2));
    if (!g) return { o: s.at(0), R: 1, a: s.at(0), b: s.at(1), r: 0 };
    const [a, b] = g.ccw ? [s.at(0), s.at(1)] : [s.at(1), s.at(0)];
    return { o: g.c, R: g.r, a, b, r: Math.abs(dist(g.c, s.at(3)) - g.r) };
  },
  (c, s, g, b) => {
    const [first, second] = dist(g.a, s.at(0)) < MIN ? [b.capA, b.capB] : [b.capB, b.capA];
    c.infer(first.c, s.picks[0]);
    c.infer(second.c, s.picks[1]);
    c.hudDimension('length', 'distance', [b.capA.c, b.capB.c], { label: lerp(s.at(0), s.at(1), 0.5) });
    c.hudDimension('radius', 'radius', [b.centre], { label: add(g.o, scale(norm(sub(s.at(2), g.o)), g.R * 0.5)) });
  },
);

const sweep = makeSweep();

export const slotCenterArc: ToolDef = curvedSlot(
  'slot-center-arc', 'Center Point Arc Slot',
  [
    { prompt: 'Click the centre of the arc' },
    {
      prompt: 'Click the centre of one end, or type the radius and angle',
      from: 0,
      fields(s) {
        const c = s.at(0);
        const p = s.cursor.pos;
        sweep(c, p, p, true);
        return [
          { key: 'radius', label: 'R', kind: 'length', value: dist(c, p), at: lerp(c, p, 0.5), lock: radialLock(c) },
          {
            key: 'angle', kind: 'angle', value: unsignedAngle(X_AXIS, sub(p, c)),
            at: add(c, { x: px(s, 48), y: px(s, -16) }), lock: relativeAngleLock(c, X_AXIS),
          },
        ];
      },
    },
    {
      prompt: 'Click the centre of the other end, or type the angle between the ends',
      fields(s) {
        const o = s.at(0);
        const a = s.at(1);
        const R = dist(o, a);
        return [{
          key: 'sweep', kind: 'angle', value: Math.abs(sweep(o, a, s.cursor.pos)), at: polar(o, angleOf(o, s.cursor.pos), R + px(s, 24)),
          lock: (p, v) => polar(o, angleOf(o, a) + (sweep(o, a, p) < 0 ? -1 : 1) * Math.min(v, TAU - 1e-3), R),
        }];
      },
      valid: (s) => Math.abs(sweep(s.at(0), s.at(1), s.cursor.pos)) > MIN || 'The ends need an angle between them',
    },
    curvedWidthStep((s) => ({ o: s.at(0), R: dist(s.at(0), s.at(1)) })),
  ],
  (s) => {
    const o = s.at(0);
    const start = s.at(1);
    const R = dist(o, start);
    const sw = sweep(o, start, s.at(2));
    const end = polar(o, angleOf(o, start) + sw, R);
    return { o, R, a: sw > 0 ? start : end, b: sw > 0 ? end : start, r: Math.abs(dist(o, s.at(3)) - R) };
  },
  (c, s, g, b) => {
    const start = s.at(1);
    const sw = sweep(s.at(0), start, s.at(2));
    const [first, second] = sw > 0 ? [b.capA, b.capB] : [b.capB, b.capA];
    const carc = c.sketch.curves[b.centre] as Arc;
    c.infer(carc.c, s.picks[0]);
    c.infer(first.c, s.picks[1]);
    c.hudDimension('radius', 'radius', [b.centre], { label: add(g.o, scale(norm(sub(start, g.o)), g.R * 0.6)) });
    const hud = s.ctx.hud;
    const wantSweep = !!hud.locked('sweep') && Math.abs(sw) <= Math.PI;
    if (hud.locked('angle') || wantSweep) {
      // Angles are measured between lines, so typed angles bring construction radii.
      const l1 = constructionLine(c, g.o, start, carc.c, first.c);
      c.hudDimension('angle', 'angle', ['axis-x', l1.id], { label: polar(g.o, 0, g.R * 0.4) });
      if (wantSweep) {
        const l2 = constructionLine(c, g.o, sw > 0 ? g.b : g.a, carc.c, second.c);
        c.hudDimension('sweep', 'angle', [l1.id, l2.id], { label: polar(g.o, angleOf(g.o, start) + sw / 2, g.R * 0.7) });
      }
    }
  },
);

export const slotTools: ToolDef[] = [slotCenterToCenter, slotOverall, slotCenter, slotThreePointArc, slotCenterArc];
