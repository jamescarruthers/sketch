// Ellipse: centre, first axis, then a point on the ellipse [ref SKT-CREATE-ELLIPSE].
import type { Vec2 } from '../model/types';
import { addEllipse } from '../model/document';
import { add, cross, dist, dot, lerp, norm, perp, scale, sub, TAU } from '../geom/vec';
import { angleOf, CONSTRUCTION, constructionLine, polar, relativeAngleLock, unsignedAngle, X_AXIS } from './kit';
import { defineClickTool, previewStroke, radialLock, type ToolDef } from './tool';

/** Semi-minor axis of the ellipse with semi-major `a` along `u` through the point `p`. Null when `p` is beyond the axis ends. */
export function minorThrough(c: Vec2, a: number, u: Vec2, p: Vec2): number | null {
  const d = sub(p, c);
  const x = dot(d, u) / a;
  const y = dot(d, perp(u));
  if (Math.abs(x) >= 1 - 1e-9) return null;
  const b = Math.abs(y) / Math.sqrt(1 - x * x);
  return b > 1e-9 ? b : null;
}

function outline(c: Vec2, a: number, b: number, rot: number): Vec2[] {
  const u = { x: Math.cos(rot), y: Math.sin(rot) };
  const n = perp(u);
  return Array.from({ length: 97 }, (_, i) => {
    const t = (TAU * i) / 96;
    return add(c, add(scale(u, a * Math.cos(t)), scale(n, b * Math.sin(t))));
  });
}

export const ellipseTool: ToolDef = defineClickTool({
  meta: { id: 'ellipse', label: 'Ellipse', panel: 'create' },
  steps: [
    { prompt: 'Click the centre' },
    {
      prompt: 'Click the first axis point, or type its length and angle',
      from: 0,
      fields(s) {
        const c = s.at(0);
        const p = s.cursor.pos;
        return [
          { key: 'major', kind: 'length', value: dist(c, p), at: lerp(c, p, 0.5), lock: radialLock(c) },
          {
            key: 'angle', kind: 'angle', value: unsignedAngle(X_AXIS, sub(p, c)),
            at: add(c, { x: s.ctx.view.px(48), y: s.ctx.view.px(-16) }), lock: relativeAngleLock(c, X_AXIS),
          },
        ];
      },
    },
    {
      prompt: 'Click a point on the ellipse, or type the minor axis length',
      fields(s) {
        const c = s.at(0);
        const m = s.at(1);
        const a = dist(c, m);
        const u = norm(sub(m, c));
        const n = perp(u);
        const b = minorThrough(c, a, u, s.cursor.pos);
        return [{
          key: 'minor', kind: 'length', value: b ?? 0, at: s.cursor.pos,
          lock: (p, v) => add(c, scale(n, (dot(sub(p, c), n) >= 0 ? 1 : -1) * v)),
        }];
      },
      valid: (s) => minorThrough(s.at(0), dist(s.at(0), s.at(1)), norm(sub(s.at(1), s.at(0))), s.cursor.pos) !== null
        || 'The point must lie between the ends of the first axis',
    },
  ],
  preview(p, s) {
    const c = s.at(0);
    const m = s.at(1);
    if (s.picks.length < 2) {
      p.line(c, m, previewStroke(s.ctx.lineType));
      return;
    }
    const a = dist(c, m);
    const u = norm(sub(m, c));
    const b = minorThrough(c, a, u, s.at(2));
    p.line(c, m, CONSTRUCTION);
    if (b === null) return;
    p.line(c, add(c, scale(perp(u), b)), CONSTRUCTION);
    p.poly(outline(c, a, b, angleOf(c, m)), true, previewStroke(s.ctx.lineType));
  },
  commit(c, s) {
    const centre = s.at(0);
    const m = s.at(1);
    const a = dist(centre, m);
    const u = norm(sub(m, centre));
    const b = minorThrough(centre, a, u, s.at(2));
    if (b === null) return false;
    const side = cross(u, sub(s.at(2), centre)) >= 0 ? 1 : -1;
    const n = scale(perp(u), side * b);
    const e = addEllipse(c.design, c.sketch, centre, m, add(centre, n), c.curveOpts);
    c.infer(e.c, s.picks[0]);
    c.infer(e.major, s.picks[1]);
    c.inferRim(e.id, s.picks[2]);
    const majorLine = constructionLine(c, centre, m, e.c, e.major);
    constructionLine(c, centre, add(centre, n), e.c, e.minor);
    const px = s.ctx.view.px(20);
    c.hudDimension('major', 'ellipseAxis', [e.id], { variant: 0, label: add(lerp(centre, m, 0.5), scale(perp(u), px)) });
    c.hudDimension('minor', 'ellipseAxis', [e.id], { variant: 1, label: add(lerp(centre, add(centre, n), 0.5), scale(u, px)) });
    c.hudDimension('angle', 'angle', ['axis-x', majorLine.id], { label: polar(centre, 0, a * 0.4) });
  },
});

export const ellipseTools: ToolDef[] = [ellipseTool];
