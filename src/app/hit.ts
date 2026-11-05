// What is under the cursor. Points beat glyphs and labels, which beat curves, which beat the axes.
import type { Curve, Id, Point, Sketch, TextEntity, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y, ORIGIN } from '../model/types';
import { curvePoints, getPointPos } from '../model/document';
import { closestPoint } from '../geom/curves';
import { dist } from '../geom/vec';
import { BADGE, type Badge } from '../render/glyphs';
import type { DimLayout } from '../render/dimensions';
import { distToPolyline } from './snap';
import type { View } from './view';

export type Hit =
  | { kind: 'point'; id: Id; pos: Vec2 }
  | { kind: 'curve'; id: Id; pos: Vec2 }
  | { kind: 'dimension'; id: Id; pos: Vec2 }
  | { kind: 'constraint'; id: Id; pos: Vec2 }
  /** A pattern or offset glyph; the id is the feature's. */
  | { kind: 'feature'; id: Id; pos: Vec2 };

export interface HitOptions {
  /** Keep only acceptable hits, so a tool's invalid targets do not hide valid ones beneath. */
  accept?: (hit: Hit) => boolean;
  /** Restrict by kind. Default all. */
  kinds?: Hit['kind'][];
  /** Include the origin and the axes. Default false. */
  reserved?: boolean;
  /** Pick from another sketch instead of the active one, e.g. for Project. */
  sketch?: Sketch;
  /** Leave out other layers even in a tool that takes them as references, e.g. for a context menu. */
  editableOnly?: boolean;
  /** Take what is shown on every layer, locked ones included, for a tool that only reads: Measure. Hidden layers stay out. */
  anyLayer?: boolean;
}

export interface Rect { minX: number; minY: number; maxX: number; maxY: number }

/** Glyph outlines with their bounds, so a miss costs one or two box tests. */
export interface TextShape { box: Rect; loops: { pts: Vec2[]; box: Rect }[] }

const boundsOf = (pts: Vec2[]): Rect => {
  const r: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    if (p.x < r.minX) r.minX = p.x;
    if (p.x > r.maxX) r.maxX = p.x;
    if (p.y < r.minY) r.minY = p.y;
    if (p.y > r.maxY) r.maxY = p.y;
  }
  return r;
};

export function textShape(outlines: Vec2[][]): TextShape {
  return { box: boundsOf(outlines.flat()), loops: outlines.map((pts) => ({ pts, box: boundsOf(pts) })) };
}

const near = (r: Rect, p: Vec2, tol: number): boolean =>
  p.x >= r.minX - tol && p.x <= r.maxX + tol && p.y >= r.minY - tol && p.y <= r.maxY + tol;

/** Winding of a closed loop round p. */
function winding(pts: Vec2[], p: Vec2): number {
  let w = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y) {
      if (b.y > p.y && side > 0) w++;
    } else if (b.y <= p.y && side < 0) w--;
  }
  return w;
}

/** Distance to the letters: 0 inside a stroke, Infinity beyond `tol`. Filled non-zero, like the drawing. */
function textDistance(shape: TextShape, p: Vec2, tol: number): number {
  if (!near(shape.box, p, tol)) return Infinity;
  let w = 0;
  let best = Infinity;
  for (const loop of shape.loops) {
    if (!near(loop.box, p, tol)) continue;
    w += winding(loop.pts, p);
    best = Math.min(best, distToPolyline([...loop.pts, loop.pts[0]], p));
  }
  return w !== 0 ? 0 : best;
}

export interface HitEnv {
  sketch: Sketch;
  view: View;
  polyline(curve: Curve): Vec2[];
  /** The letters of a text, cached per solve. Null until its font loads. */
  textShape(text: TextEntity): TextShape | null;
  visible(curve: Curve): boolean;
  /** A point with no curve is on a layer of its own, which may be hidden. */
  pointVisible?(point: Point): boolean;
  /** What may be picked: a layer other than the active one is template geometry. Default everything. */
  pickable?(id: Id): boolean;
  showPoints: boolean;
  badges: Badge[];
  labels: (DimLayout & { w: number; h: number })[];
}

const POINT_TOL = 8;
const CURVE_TOL = 6;

/** Points a user can see and pick. A helper point owned by a curve but not defining it is hidden. */
export function visiblePoints(sketch: Sketch, visible: (c: Curve) => boolean, pointVisible?: (p: Point) => boolean): Point[] {
  const seen = new Set<Id>();
  const out: Point[] = [];
  for (const c of Object.values(sketch.curves)) {
    if (!visible(c)) continue;
    for (const id of curvePoints(c)) {
      const p = sketch.points[id];
      if (p && !seen.has(id)) {
        seen.add(id);
        out.push(p);
      }
    }
  }
  for (const p of Object.values(sketch.points)) {
    if ((p.explicit || p.shown) && !seen.has(p.id) && (!pointVisible || pointVisible(p))) out.push(p);
  }
  return out;
}

export function hitTest(env: HitEnv, screen: Vec2, opts: HitOptions = {}): Hit | null {
  const { sketch, view } = env;
  const world = view.toWorld(screen);
  const want = (k: Hit['kind']): boolean => !opts.kinds || opts.kinds.includes(k);
  const ok = (h: Hit): boolean => (!env.pickable || env.pickable(h.id)) && (!opts.accept || opts.accept(h));
  const scored: { rank: number; d: number; hit: Hit }[] = [];

  if (want('point') && env.showPoints) {
    const tol = view.px(POINT_TOL);
    for (const p of visiblePoints(sketch, env.visible, env.pointVisible)) {
      const d = dist(p, world);
      if (d < tol) scored.push({ rank: 0, d, hit: { kind: 'point', id: p.id, pos: { x: p.x, y: p.y } } });
    }
  }
  if (want('point') && opts.reserved) {
    const d = dist(world, { x: 0, y: 0 });
    if (d < view.px(POINT_TOL + 2)) scored.push({ rank: 0, d, hit: { kind: 'point', id: ORIGIN, pos: { x: 0, y: 0 } } });
  }
  if (want('constraint') || want('feature')) {
    for (const b of env.badges) {
      const dx = Math.abs(b.x - screen.x);
      const dy = Math.abs(b.y - screen.y);
      if (dx <= BADGE / 2 + 1 && dy <= BADGE / 2 + 1) {
        const kind = b.feature ? 'feature' : 'constraint';
        if (want(kind)) scored.push({ rank: 1, d: Math.hypot(dx, dy), hit: { kind, id: b.constraint, pos: world } });
      }
    }
  }
  if (want('dimension')) {
    for (const l of env.labels) {
      const s = view.toScreen(l.label);
      const dx = Math.abs(s.x - screen.x);
      const dy = Math.abs(s.y - screen.y);
      if (dx <= l.w / 2 && dy <= l.h / 2) scored.push({ rank: 1, d: Math.hypot(dx, dy), hit: { kind: 'dimension', id: l.id, pos: world } });
    }
  }
  if (want('curve')) {
    const tol = view.px(CURVE_TOL);
    for (const c of Object.values(sketch.curves)) {
      if (!env.visible(c)) continue;
      if (c.type === 'text') {
        const shape = env.textShape(c);
        const d = shape ? textDistance(shape, world, tol) : Infinity;
        // A curve right under the cursor still beats the letter around it.
        if (d < tol) scored.push({ rank: 2, d: Math.max(d, tol / 2), hit: { kind: 'curve', id: c.id, pos: world } });
        continue;
      }
      const d = distToPolyline(env.polyline(c), world);
      if (d < tol) scored.push({ rank: 2, d, hit: { kind: 'curve', id: c.id, pos: closestPoint(sketch, c, world).p } });
    }
    if (opts.reserved) {
      if (Math.abs(world.y) < tol) scored.push({ rank: 3, d: Math.abs(world.y), hit: { kind: 'curve', id: AXIS_X, pos: { x: world.x, y: 0 } } });
      if (Math.abs(world.x) < tol) scored.push({ rank: 3, d: Math.abs(world.x), hit: { kind: 'curve', id: AXIS_Y, pos: { x: 0, y: world.y } } });
    }
  }
  scored.sort((a, b) => a.rank - b.rank || a.d - b.d);
  for (const s of scored) if (ok(s.hit)) return s.hit;
  return null;
}

const segmentsCross = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean => {
  const o = (p: Vec2, q: Vec2, r: Vec2): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

const inside = (r: Rect, p: Vec2): boolean => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

function polylineTouches(r: Rect, pts: Vec2[]): boolean {
  if (pts.some((p) => inside(r, p))) return true;
  const cs: Vec2[] = [{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY }, { x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY }];
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let j = 0; j < 4; j++) if (segmentsCross(pts[i], pts[i + 1], cs[j], cs[(j + 1) % 4])) return true;
  }
  return false;
}

/** Window: fully enclosed curves and loose points. Crossing: anything touched. */
export function boxSelect(env: HitEnv, a: Vec2, b: Vec2, crossing: boolean): Id[] {
  const r: Rect = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
  const out: Id[] = [];
  const pickable = (id: Id): boolean => !env.pickable || env.pickable(id);
  for (const c of Object.values(env.sketch.curves)) {
    if (!env.visible(c) || !pickable(c.id)) continue;
    // A frame's edges go with their text, which stands for all of them.
    if (c.type === 'line' && c.frameOf) continue;
    if (c.type === 'text') {
      const shape = env.textShape(c);
      const frame = c.frame ? env.polyline(c) : [];
      const letters = !!shape && (crossing
        ? shape.loops.some((l) => polylineTouches(r, l.pts))
        : shape.box.minX >= r.minX && shape.box.maxX <= r.maxX && shape.box.minY >= r.minY && shape.box.maxY <= r.maxY);
      const edges = frame.length > 0 && (crossing ? polylineTouches(r, frame) : frame.every((p) => inside(r, p)));
      if (letters || edges) out.push(c.id);
      continue;
    }
    const pts = env.polyline(c);
    if (pts.length && (crossing ? polylineTouches(r, pts) : pts.every((p) => inside(r, p)))) out.push(c.id);
  }
  for (const p of Object.values(env.sketch.points)) {
    if (p.explicit && !p.owner && inside(r, p) && pickable(p.id) && (!env.pointVisible || env.pointVisible(p))) out.push(p.id);
  }
  return out;
}

/** The hit a stored id corresponds to, for turning a preselection into tool picks. */
export function hitOf(sketch: Sketch, id: Id): Hit | null {
  if (id === ORIGIN) return { kind: 'point', id, pos: { x: 0, y: 0 } };
  if (id === AXIS_X || id === AXIS_Y) return { kind: 'curve', id, pos: { x: 0, y: 0 } };
  if (sketch.points[id]) return { kind: 'point', id, pos: getPointPos(sketch, id) };
  if (sketch.curves[id]) return { kind: 'curve', id, pos: { x: 0, y: 0 } };
  if (sketch.dimensions[id]) return { kind: 'dimension', id, pos: sketch.dimensions[id].label };
  if (sketch.constraints[id]) return { kind: 'constraint', id, pos: { x: 0, y: 0 } };
  if (sketch.features[id]) return { kind: 'feature', id, pos: { x: 0, y: 0 } };
  return null;
}
