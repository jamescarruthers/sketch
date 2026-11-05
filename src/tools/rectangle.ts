// The three rectangle tools [ref SKT-CREATE-RECTANGLES].
import type { Id, Line, Vec2 } from '../model/types';
import { addConstraint, addLine, addPoint } from '../model/document';
import { add, dist, dot, len, lerp, norm, perp, scale, sub } from '../geom/vec';
import { COLORS } from '../render/style';
import {
  defineClickTool, previewStroke, type ClickState, type CommitScope, type HudField, type ToolDef,
} from './tool';

const group = 'rectangle';

/** Four corners to four closed lines, joined corner to corner. Returns l0..l3, l[i] from corner i to i+1. */
function closedQuad(c: CommitScope, corners: Vec2[]): Line[] {
  const lines = corners.map((p, i) => addLine(c.design, c.sketch, p, corners[(i + 1) % 4], c.curveOpts));
  lines.forEach((l, i) => addConstraint(c.design, c.sketch, 'coincident', [l.b, lines[(i + 1) % 4].a]));
  return lines;
}

/** Axis-aligned corners from a diagonal, in loop order starting at a. */
const axisCorners = (a: Vec2, b: Vec2): Vec2[] => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];

const offsetPx = (s: ClickState, px: number): number => s.ctx.view.px(px);

function sizeFields(s: ClickState, a: Vec2, scaleBy: number): HudField[] {
  const b = s.cursor.pos;
  return [
    {
      key: 'w', label: 'W', kind: 'length', value: Math.abs(b.x - a.x) * scaleBy,
      at: { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + offsetPx(s, 16) },
      lock: (p, v) => ({ x: a.x + (p.x >= a.x ? 1 : -1) * (v / scaleBy), y: p.y }),
    },
    {
      key: 'h', label: 'H', kind: 'length', value: Math.abs(b.y - a.y) * scaleBy,
      at: { x: Math.max(a.x, b.x) + offsetPx(s, 34), y: (a.y + b.y) / 2 },
      lock: (p, v) => ({ x: p.x, y: a.y + (p.y >= a.y ? 1 : -1) * (v / scaleBy) }),
    },
  ];
}

function axisRectDims(c: CommitScope, s: ClickState, l: Line[], top: Vec2, side: Vec2): void {
  c.hudDimension('w', 'distance', [l[0].a, l[0].b], { label: { x: top.x, y: top.y + s.ctx.view.px(18) } });
  c.hudDimension('h', 'distance', [l[1].a, l[1].b], { label: { x: side.x + s.ctx.view.px(30), y: side.y } });
}

const validSize = (s: ClickState, a: Vec2): boolean | string => {
  const b = s.cursor.pos;
  return (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) || 'A rectangle needs both a width and a height';
};

export const rectangle2Point: ToolDef = defineClickTool({
  meta: { id: 'rect-2pt', label: '2-Point Rectangle', panel: 'create', group, shortcut: 'R' },
  label: 'Rectangle',
  steps: [
    { prompt: 'Click the first corner' },
    {
      prompt: 'Click the opposite corner, or type width and height',
      fields: (s) => sizeFields(s, s.at(0), 1),
      valid: (s) => validSize(s, s.at(0)),
    },
  ],
  preview(p, s) {
    p.poly(axisCorners(s.at(0), s.at(1)), true, previewStroke(s.ctx.lineType));
  },
  commit(c, s) {
    const a = s.at(0);
    const b = s.at(1);
    const l = closedQuad(c, axisCorners(a, b));
    const { design, sketch } = c;
    addConstraint(design, sketch, 'horizontal', [l[0].id]);
    addConstraint(design, sketch, 'vertical', [l[1].id]);
    addConstraint(design, sketch, 'horizontal', [l[2].id]);
    addConstraint(design, sketch, 'vertical', [l[3].id]);
    c.infer(l[0].a, s.picks[0]);
    c.infer(l[2].a, s.picks[1]);
    const right = Math.max(a.x, b.x);
    const topY = Math.max(a.y, b.y);
    axisRectDims(c, s, l, { x: (a.x + b.x) / 2, y: topY }, { x: right, y: (a.y + b.y) / 2 });
    c.select();
  },
});

/** The third corner's offset: the component of `p - b` square to a->b. */
function thirdOffset(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const n = perp(norm(sub(b, a)));
  return scale(n, dot(sub(p, b), n));
}

export const rectangle3Point: ToolDef = defineClickTool({
  meta: { id: 'rect-3pt', label: '3-Point Rectangle', panel: 'create', group },
  label: 'Rectangle',
  steps: [
    { prompt: 'Click the first corner' },
    {
      prompt: 'Click the second corner, or type the length',
      from: 0,
      fields(s) {
        const a = s.at(0);
        const b = s.cursor.pos;
        return [{
          key: 'w', kind: 'length', value: dist(a, b), at: lerp(a, b, 0.5),
          lock: (p, v) => {
            const u = len(sub(p, a)) > 0 ? norm(sub(p, a)) : { x: 1, y: 0 };
            return add(a, scale(u, v));
          },
        }];
      },
    },
    {
      prompt: 'Click the third corner, or type the width',
      fields(s) {
        const a = s.at(0);
        const b = s.at(1);
        const n = perp(norm(sub(b, a)));
        const off = thirdOffset(a, b, s.cursor.pos);
        return [{
          key: 'h', kind: 'length', value: len(off), at: add(b, scale(off, 0.5)),
          lock: (p, v) => add(p, scale(n, (dot(sub(p, b), n) >= 0 ? v : -v) - dot(sub(p, b), n))),
        }];
      },
      valid: (s) => len(thirdOffset(s.at(0), s.at(1), s.cursor.pos)) > 1e-6 || 'The third corner must leave the first edge',
    },
  ],
  preview(p, s) {
    const a = s.at(0);
    const b = s.at(1);
    const off = s.picks.length > 1 ? thirdOffset(a, b, s.cursor.pos) : { x: 0, y: 0 };
    if (s.picks.length > 1) p.poly([a, b, add(b, off), add(a, off)], true, previewStroke(s.ctx.lineType));
    else p.line(a, b, previewStroke(s.ctx.lineType));
  },
  commit(c, s) {
    const a = s.at(0);
    const b = s.at(1);
    const off = thirdOffset(a, b, s.at(2));
    const l = closedQuad(c, [a, b, add(b, off), add(a, off)]);
    const { design, sketch } = c;
    addConstraint(design, sketch, 'perpendicular', [l[0].id, l[1].id]);
    addConstraint(design, sketch, 'parallel', [l[0].id, l[2].id]);
    addConstraint(design, sketch, 'parallel', [l[1].id, l[3].id]);
    c.infer(l[0].a, s.picks[0]);
    c.infer(l[0].b, s.picks[1], { segment: l[0].id });
    c.infer(l[2].a, s.picks[2]);
    const n = norm(off);
    c.hudDimension('w', 'distance', [l[0].a, l[0].b], { label: add(lerp(a, b, 0.5), scale(n, s.ctx.view.px(-18))) });
    c.hudDimension('h', 'distance', [l[1].a, l[1].b], { label: add(add(b, scale(off, 0.5)), scale(norm(sub(b, a)), s.ctx.view.px(24))) });
  },
});

export const rectangleCenter: ToolDef = defineClickTool({
  meta: { id: 'rect-center', label: 'Center Rectangle', panel: 'create', group },
  label: 'Rectangle',
  steps: [
    { prompt: 'Click the centre' },
    {
      prompt: 'Click a corner, or type width and height',
      fields: (s) => sizeFields(s, s.at(0), 2),
      valid: (s) => validSize(s, s.at(0)),
    },
  ],
  preview(p, s) {
    const m = s.at(0);
    const b = s.at(1);
    const a = sub(m, sub(b, m));
    const stroke = previewStroke(s.ctx.lineType);
    p.poly(axisCorners(a, b), true, stroke);
    p.line(a, b, { color: COLORS.construction, dash: [7, 5], width: 1 });
    p.line({ x: a.x, y: b.y }, { x: b.x, y: a.y }, { color: COLORS.construction, dash: [7, 5], width: 1 });
  },
  commit(c, s) {
    const m = s.at(0);
    const b = s.at(1);
    const a = sub(m, sub(b, m));
    const { design, sketch } = c;
    const l = closedQuad(c, axisCorners(a, b));
    addConstraint(design, sketch, 'horizontal', [l[0].id]);
    addConstraint(design, sketch, 'vertical', [l[1].id]);
    addConstraint(design, sketch, 'horizontal', [l[2].id]);
    addConstraint(design, sketch, 'vertical', [l[3].id]);

    const corners: Id[] = [l[0].a, l[1].a, l[2].a, l[3].a];
    const diag1 = addLine(design, sketch, a, b, { lineType: 'construction' });
    const diag2 = addLine(design, sketch, { x: b.x, y: a.y }, { x: a.x, y: b.y }, { lineType: 'construction' });
    addConstraint(design, sketch, 'coincident', [corners[0], diag1.a]);
    addConstraint(design, sketch, 'coincident', [corners[2], diag1.b]);
    addConstraint(design, sketch, 'coincident', [corners[1], diag2.a]);
    addConstraint(design, sketch, 'coincident', [corners[3], diag2.b]);
    const centre = addPoint(design, sketch, m, { owner: diag1.id });
    addConstraint(design, sketch, 'midpoint', [centre.id, diag1.id]);
    addConstraint(design, sketch, 'midpoint', [centre.id, diag2.id]);
    c.infer(centre.id, s.picks[0]);
    c.infer(l[2].a, s.picks[1]);
    axisRectDims(c, s, l, { x: m.x, y: Math.max(a.y, b.y) }, { x: Math.max(a.x, b.x), y: m.y });
  },
});

export const rectangleTools: ToolDef[] = [rectangle2Point, rectangle3Point, rectangleCenter];
