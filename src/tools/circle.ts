// Center Diameter, 2-Point and 3-Point circles [ref SKT-CREATE-CIRCLES].
import type { Vec2 } from '../model/types';
import { addCircle, addConstraint } from '../model/document';
import { add, cross, dist, lerp, norm, scale, sub } from '../geom/vec';
import { defineClickTool, previewStroke, radialLock, type ToolDef } from './tool';

const group = 'circle';

export function circumcircle(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * cross(sub(b, a), sub(c, a));
  if (Math.abs(d) < 1e-9) return null;
  const ab = sub(b, a);
  const ac = sub(c, a);
  const l1 = ab.x * ab.x + ab.y * ab.y;
  const l2 = ac.x * ac.x + ac.y * ac.y;
  const center = { x: a.x + (ac.y * l1 - ab.y * l2) / d, y: a.y + (ab.x * l2 - ac.x * l1) / d };
  return { c: center, r: dist(center, a) };
}

/** Label beside the rim, toward the cursor direction but clear of the curve. */
const rimLabel = (c: Vec2, p: Vec2, r: number, px: number): Vec2 => {
  const d = dist(c, p);
  return add(c, scale(d > 0 ? norm(sub(p, c)) : { x: 1, y: 0 }, r + px));
};

export const circleCenter: ToolDef = defineClickTool({
  meta: { id: 'circle-center', label: 'Center Diameter Circle', panel: 'create', group, shortcut: 'C' },
  label: 'Circle',
  steps: [
    { prompt: 'Click the centre' },
    {
      prompt: 'Click the rim, or type the diameter',
      snap: (s) => ({ rimFrom: s.at(0) }),
      fields(s) {
        const c = s.at(0);
        return [{
          key: 'd', label: 'Ø', kind: 'length', value: 2 * dist(c, s.cursor.pos), at: lerp(c, s.cursor.pos, 0.5),
          lock: radialLock(c, 2),
        }];
      },
    },
  ],
  preview(p, s) {
    p.circle(s.at(0), dist(s.at(0), s.at(1)), previewStroke(s.ctx.lineType));
  },
  commit(c, s) {
    const m = s.at(0);
    const r = dist(m, s.at(1));
    const circle = addCircle(c.design, c.sketch, m, r, c.curveOpts);
    c.infer(circle.c, s.picks[0]);
    c.inferRim(circle.id, s.picks[1]);
    c.hudDimension('d', 'diameter', [circle.id], { label: rimLabel(m, s.at(1), r, s.ctx.view.px(24)) });
  },
});

export const circle2Point: ToolDef = defineClickTool({
  meta: { id: 'circle-2pt', label: '2-Point Circle', panel: 'create', group },
  label: 'Circle',
  steps: [
    { prompt: 'Click one end of the diameter' },
    {
      prompt: 'Click the other end, or type the diameter',
      fields(s) {
        const a = s.at(0);
        return [{ key: 'd', label: 'Ø', kind: 'length', value: dist(a, s.cursor.pos), at: lerp(a, s.cursor.pos, 0.5), lock: radialLock(a) }];
      },
    },
  ],
  preview(p, s) {
    p.circle(lerp(s.at(0), s.at(1), 0.5), dist(s.at(0), s.at(1)) / 2, previewStroke(s.ctx.lineType));
  },
  commit(c, s) {
    const a = s.at(0);
    const b = s.at(1);
    const m = lerp(a, b, 0.5);
    const r = dist(a, b) / 2;
    const circle = addCircle(c.design, c.sketch, m, r, c.curveOpts);
    c.inferRim(circle.id, s.picks[0]);
    c.inferRim(circle.id, s.picks[1]);
    // Between the ends of a line, the centre stays on that line's middle [ref s2-handle-w-constraints].
    const [ia, ib] = [s.picks[0].inference.point, s.picks[1].inference.point];
    const edge = ia && ib ? Object.values(c.sketch.curves).find((l) => l.type === 'line' && [l.a, l.b].includes(ia) && [l.a, l.b].includes(ib)) : undefined;
    if (edge) addConstraint(c.design, c.sketch, 'midpoint', [circle.c, edge.id]);
    c.hudDimension('d', 'diameter', [circle.id], { label: rimLabel(m, b, r, s.ctx.view.px(24)) });
  },
});

export const circle3Point: ToolDef = defineClickTool({
  meta: { id: 'circle-3pt', label: '3-Point Circle', panel: 'create', group },
  label: 'Circle',
  steps: [
    { prompt: 'Click the first point on the circle' },
    { prompt: 'Click the second point on the circle' },
    {
      prompt: 'Click the third point on the circle',
      valid: (s) => circumcircle(s.at(0), s.at(1), s.cursor.pos) !== null || 'The three points must not be in a line',
    },
  ],
  preview(p, s) {
    const stroke = previewStroke(s.ctx.lineType);
    if (s.picks.length < 2) {
      p.line(s.at(0), s.at(1), stroke);
      return;
    }
    const circle = circumcircle(s.at(0), s.at(1), s.at(2));
    if (circle) p.circle(circle.c, circle.r, stroke);
  },
  commit(c, s) {
    const circle = circumcircle(s.at(0), s.at(1), s.at(2));
    if (!circle) return false;
    const made = addCircle(c.design, c.sketch, circle.c, circle.r, c.curveOpts);
    for (const pick of s.picks) c.inferRim(made.id, pick);
    return true;
  },
});

export const circleTools: ToolDef[] = [circleCenter, circle2Point, circle3Point];
