// Circumscribed, Inscribed and Edge polygons [ref SKT-CREATE-POLYGONS]. Each polygon comes with a
// construction circle that, with equal sides, keeps it regular.
import type { Line, Vec2 } from '../model/types';
import { addCircle, addConstraint, addLine, addPoint } from '../model/document';
import { add, cross, dist, lerp, norm, perp, rotate, scale, sub, TAU } from '../geom/vec';
import { COLORS } from '../render/style';
import { angleOf, polar, relativeAngleLock, unsignedAngle, X_AXIS } from './kit';
import {
  defineClickTool, previewStroke, radialLock, type ClickState, type CommitScope, type HudField, type Preview, type Stroke, type ToolDef,
} from './tool';

const group = 'polygon';
const MIN_SIDES = 3;
const MAX_SIDES = 64;

/** Remembered between polygons, like the palette would. */
let lastSides = 6;

function sidesOf(s: ClickState): number {
  const typed = s.ctx.hud.locked('sides')?.value;
  return Math.min(MAX_SIDES, Math.max(MIN_SIDES, Math.round(typed ?? lastSides)));
}

const sidesField = (s: ClickState, at: Vec2): HudField => ({ key: 'sides', label: 'N', kind: 'number', value: sidesOf(s), at });

interface Shape { verts: Vec2[]; centre: Vec2; /** Radius of the construction circle. */ r: number }

/** Apothem `r` with an edge midpoint toward `p`. */
function circumscribed(c: Vec2, p: Vec2, n: number): Shape {
  const r = dist(c, p);
  const theta = angleOf(c, p);
  const R = r / Math.cos(Math.PI / n);
  return { verts: Array.from({ length: n }, (_, k) => polar(c, theta + Math.PI / n + (TAU * k) / n, R)), centre: c, r };
}

/** Circumradius `r` with a vertex at `p`. */
function inscribed(c: Vec2, p: Vec2, n: number): Shape {
  const r = dist(c, p);
  const theta = angleOf(c, p);
  return { verts: Array.from({ length: n }, (_, k) => polar(c, theta + (TAU * k) / n, r)), centre: c, r };
}

/** Regular polygon on the edge a-b, on whichever side `side` (a point) is. */
function onEdge(a: Vec2, b: Vec2, side: Vec2, n: number): Shape & { reversed: boolean } {
  const reversed = cross(sub(b, a), sub(side, a)) < 0;
  const [p0, p1] = reversed ? [b, a] : [a, b];
  const len = dist(p0, p1);
  const d0 = norm(sub(p1, p0));
  const verts: Vec2[] = [p0];
  for (let k = 0; k < n - 1; k++) verts.push(add(verts[k], scale(rotate(d0, (TAU * k) / n), len)));
  const centre = add(lerp(p0, p1, 0.5), scale(perp(d0), len / (2 * Math.tan(Math.PI / n))));
  return { verts, centre, r: len / (2 * Math.sin(Math.PI / n)), reversed };
}

function drawShape(p: Preview, shape: Shape, stroke: Stroke): void {
  p.poly(shape.verts, true, stroke);
  p.circle(shape.centre, shape.r, { color: COLORS.construction, dash: [7, 5], width: 1 });
}

type Build = { lines: Line[] };

/** Lines joined corner to corner, equal lengths, and the construction circle through the vertices. */
function buildLines(c: CommitScope, shape: Shape): Build & { circle: ReturnType<typeof addCircle> } {
  const lines = shape.verts.map((v, i) => addLine(c.design, c.sketch, v, shape.verts[(i + 1) % shape.verts.length], c.curveOpts));
  lines.forEach((l, i) => addConstraint(c.design, c.sketch, 'coincident', [l.b, lines[(i + 1) % lines.length].a]));
  for (let i = 1; i < lines.length; i++) addConstraint(c.design, c.sketch, 'equal', [lines[0].id, lines[i].id]);
  const circle = addCircle(c.design, c.sketch, shape.centre, shape.r, { lineType: 'construction' });
  return { lines, circle };
}

function radiusFields(s: ClickState): HudField[] {
  const c = s.at(0);
  const p = s.cursor.pos;
  return [
    { key: 'radius', label: 'R', kind: 'length', value: dist(c, p), at: lerp(c, p, 0.5), lock: radialLock(c) },
    sidesField(s, add(p, { x: s.ctx.view.px(40), y: s.ctx.view.px(-20) })),
  ];
}

function centreTool(id: string, label: string, make: (c: Vec2, p: Vec2, n: number) => Shape, vertices: boolean): ToolDef {
  return defineClickTool({
    meta: { id, label, panel: 'create', group },
    label: 'Polygon',
    steps: [
      { prompt: 'Click the centre' },
      {
        prompt: 'Type the radius, Tab to the number of sides, move to orient, then click',
        from: 0,
        fields: radiusFields,
        valid: (s) => dist(s.at(0), s.cursor.pos) > 1e-6 || 'The radius must be greater than zero',
      },
    ],
    preview(p, s) {
      const n = sidesOf(s);
      if (dist(s.at(0), s.at(1)) < 1e-9) return;
      drawShape(p, make(s.at(0), s.at(1), n), previewStroke(s.ctx.lineType));
    },
    commit(c, s) {
      const n = sidesOf(s);
      lastSides = n;
      const shape = make(s.at(0), s.at(1), n);
      const { lines, circle } = buildLines(c, shape);
      if (vertices) {
        for (const l of lines) addConstraint(c.design, c.sketch, 'coincident', [l.a, circle.id]);
      } else {
        // Tangent edges that are equal leave an even polygon free to alternate, so the first edge
        // also touches the circle at its own midpoint. That point is on both curves, which makes
        // the solver model this tangency as a contact [see solver/src/lib.rs, Branches].
        for (const l of lines) addConstraint(c.design, c.sketch, 'tangent', [l.id, circle.id]);
        const m = addPoint(c.design, c.sketch, lerp(shape.verts[0], shape.verts[1], 0.5), { owner: lines[0].id });
        addConstraint(c.design, c.sketch, 'midpoint', [m.id, lines[0].id]);
        addConstraint(c.design, c.sketch, 'coincident', [m.id, lines[0].id]);
        addConstraint(c.design, c.sketch, 'coincident', [m.id, circle.id]);
      }
      c.infer(circle.c, s.picks[0]);
      c.hudDimension('radius', 'radius', [circle.id], { label: add(shape.centre, scale(norm(sub(s.at(1), shape.centre)), shape.r * 0.5)) });
      c.select();
    },
  });
}

export const polygonCircumscribed = centreTool('polygon-circumscribed', 'Circumscribed Polygon', circumscribed, false);
export const polygonInscribed = centreTool('polygon-inscribed', 'Inscribed Polygon', inscribed, true);

export const polygonEdge: ToolDef = defineClickTool({
  meta: { id: 'polygon-edge', label: 'Edge Polygon', panel: 'create', group },
  label: 'Polygon',
  steps: [
    { prompt: 'Click the first point of the edge' },
    {
      prompt: 'Click the second point, or type the length and angle',
      from: 0,
      fields(s) {
        const a = s.at(0);
        const b = s.cursor.pos;
        return [
          { key: 'length', kind: 'length', value: dist(a, b), at: lerp(a, b, 0.5), lock: radialLock(a) },
          {
            key: 'angle', kind: 'angle', value: unsignedAngle(X_AXIS, sub(b, a)),
            at: add(a, { x: s.ctx.view.px(48), y: s.ctx.view.px(-16) }), lock: relativeAngleLock(a, X_AXIS),
          },
        ];
      },
    },
    {
      prompt: 'Type the number of sides, move to the side the polygon goes on, then click',
      fields: (s) => [sidesField(s, add(s.cursor.pos, { x: s.ctx.view.px(40), y: s.ctx.view.px(-20) }))],
      valid: (s) => Math.abs(cross(sub(s.at(1), s.at(0)), sub(s.cursor.pos, s.at(0)))) > 1e-6 || 'Move to one side of the edge',
    },
  ],
  preview(p, s) {
    const stroke = previewStroke(s.ctx.lineType);
    if (s.picks.length < 2) {
      p.line(s.at(0), s.at(1), stroke);
      return;
    }
    if (Math.abs(cross(sub(s.at(1), s.at(0)), sub(s.at(2), s.at(0)))) < 1e-9) return;
    drawShape(p, onEdge(s.at(0), s.at(1), s.at(2), sidesOf(s)), stroke);
  },
  commit(c, s) {
    const n = sidesOf(s);
    lastSides = n;
    const shape = onEdge(s.at(0), s.at(1), s.at(2), n);
    const { lines, circle } = buildLines(c, shape);
    for (const l of lines) addConstraint(c.design, c.sketch, 'coincident', [l.a, circle.id]);
    const [first, second] = shape.reversed ? [s.picks[1], s.picks[0]] : [s.picks[0], s.picks[1]];
    c.infer(lines[0].a, first);
    c.infer(lines[0].b, second, { segment: lines[0].id });
    const mid = lerp(s.at(0), s.at(1), 0.5);
    const off = scale(norm(sub(mid, shape.centre)), s.ctx.view.px(20));
    c.hudDimension('length', 'distance', [lines[0].a, lines[0].b], { label: add(mid, off) });
    c.hudDimension('angle', 'angle', ['axis-x', lines[0].id], {
      label: add(s.at(0), { x: s.ctx.view.px(60), y: s.ctx.view.px(14) }), variant: shape.reversed ? 1 : 0,
    });
    c.select();
  },
});

export const polygonTools: ToolDef[] = [polygonCircumscribed, polygonInscribed, polygonEdge];
