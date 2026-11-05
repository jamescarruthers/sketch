// 2-Tangent and 3-Tangent circles: pick lines, then a circle touching them [ref SKT-CREATE-CIRCLES].
import type { Id, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y } from '../model/types';
import { addCircle, addConstraint, getPointPos } from '../model/document';
import { lineOf } from '../geom/curves';
import { add, cross, dist, dot, lerp, norm, perp, scale, sub } from '../geom/vec';
import { createBoxSelect } from './select';
import { previewStroke, type Hit, type Tool, type ToolContext, type ToolDef, type ToolPointer } from './tool';

type Line = { p: Vec2; d: Vec2 };
interface Fit { c: Vec2; r: number }

const PARALLEL = 1e-9;

/** Circle tangent to two infinite lines, centred on the bisector nearest `at`. */
export function twoTangent(a: Line, b: Line, at: Vec2): Fit | null {
  const u1 = norm(a.d);
  const u2 = norm(b.d);
  const k = cross(u1, u2);
  if (Math.abs(k) < PARALLEL) {
    const toB = sub(b.p, a.p);
    const half = Math.abs(cross(u1, toB)) / 2;
    const mid = add(a.p, scale(perp(u1), dot(perp(u1), toB) / 2));
    if (half < 1e-9) return null;
    return { c: add(mid, scale(u1, dot(sub(at, mid), u1))), r: half };
  }
  const apex = add(a.p, scale(a.d, cross(sub(b.p, a.p), b.d) / cross(a.d, b.d)));
  const v = sub(at, apex);
  const bis = [norm(add(u1, u2)), norm(sub(u1, u2))];
  const axis = Math.abs(cross(bis[0], v)) <= Math.abs(cross(bis[1], v)) ? bis[0] : bis[1];
  const c = add(apex, scale(axis, dot(v, axis)));
  const r = Math.abs(cross(u1, sub(c, apex)));
  return r < 1e-9 ? null : { c, r };
}

/** Where the centre goes for a typed radius, on the same bisector side as `at`. */
function twoTangentAt(a: Line, b: Line, at: Vec2, radius: number): Vec2 {
  const u1 = norm(a.d);
  const u2 = norm(b.d);
  if (Math.abs(cross(u1, u2)) < PARALLEL) return at;
  const apex = add(a.p, scale(a.d, cross(sub(b.p, a.p), b.d) / cross(a.d, b.d)));
  const v = sub(at, apex);
  const bis = [norm(add(u1, u2)), norm(sub(u1, u2))];
  const axis = Math.abs(cross(bis[0], v)) <= Math.abs(cross(bis[1], v)) ? bis[0] : bis[1];
  const sign = dot(v, axis) >= 0 ? 1 : -1;
  return add(apex, scale(axis, (sign * radius) / Math.abs(cross(u1, axis))));
}

/** The circle tangent to three lines that sits nearest the middle of them: the incircle of a triangle. */
export function threeTangent(lines: Line[], near: Vec2): Fit | null {
  let best: Fit | null = null;
  for (const [s2, s3] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const sig = [1, s2, s3];
    const rows = lines.map((l, i) => {
      const n = perp(norm(l.d));
      return [n.x, n.y, -sig[i], dot(n, l.p)];
    });
    const det3 = (m: number[][]): number =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
      - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
      + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d = det3(rows.map((r) => r.slice(0, 3)));
    if (Math.abs(d) < 1e-9) continue;
    const sol = [0, 1, 2].map((col) => det3(rows.map((r) => r.slice(0, 3).map((v, k) => (k === col ? r[3] : v)))) / d);
    const fit = { c: { x: sol[0], y: sol[1] }, r: Math.abs(sol[2]) };
    if (fit.r < 1e-9) continue;
    if (!best || dist(fit.c, near) < dist(best.c, near)) best = fit;
  }
  return best;
}

const isLineHit = (ctx: ToolContext, h: Hit): boolean =>
  h.kind === 'curve' && (h.id === AXIS_X || h.id === AXIS_Y || ctx.sketch.curves[h.id]?.type === 'line');

function createTangentCircle(ctx: ToolContext, count: 2 | 3): Tool {
  const picked: Id[] = [];
  let at: Vec2 = { x: 0, y: 0 };
  const lines = (): Line[] => picked.map((id) => lineOf(ctx.sketch, id)).filter((l): l is Line => !!l);
  const prompt = (): void => {
    ctx.status(picked.length < count
      ? `Select ${count === 2 ? 'two lines' : 'three lines, or window select them'} (${picked.length} of ${count})`
      : 'Click the circle, or type the radius');
  };
  const box = createBoxSelect(ctx, (a, b, crossing) => ctx.boxSelect(a, b, crossing).filter((id) => ctx.sketch.curves[id]?.type === 'line'));
  const accept = (h: Hit): boolean => isLineHit(ctx, h) && !picked.includes(h.id);

  const reset = (): void => {
    picked.length = 0;
    ctx.selection.clear();
    ctx.hud.clear();
    prompt();
  };

  /** Position of the circle for the cursor, after any typed radius. */
  const fit = (): Fit | null => {
    const ls = lines();
    if (count === 3) return ls.length === 3 ? threeTangent(ls, centroid()) : null;
    if (ls.length < 2) return null;
    const [a, b] = ls;
    const parallel = Math.abs(cross(norm(a.d), norm(b.d))) < PARALLEL;
    const lockRadius = (p: Vec2, v: number): Vec2 => twoTangentAt(a, b, p, v);
    const shape = twoTangent(a, b, at);
    ctx.hud.set([{
      key: 'r', label: 'R', kind: 'length', value: shape?.r ?? 0, at: shape ? shape.c : at, ...(parallel ? {} : { lock: lockRadius }),
    }]);
    const pos = ctx.hud.apply(at);
    const out = twoTangent(a, b, pos);
    if (out) ctx.hud.set([{ key: 'r', label: 'R', kind: 'length', value: out.r, at: out.c, ...(parallel ? {} : { lock: lockRadius }) }]);
    return out;
  };

  const commit = (): void => {
    const shape = count === 3 ? threeTangent(lines(), centroid()) : fit();
    if (!shape || !ctx.hud.valid()) {
      ctx.message(shape ? 'That value is not valid' : 'No circle fits those lines', 'warn');
      return;
    }
    const ids = [...picked];
    const ls = lines();
    const parallel = count === 2 && ls.length === 2 && Math.abs(cross(norm(ls[0].d), norm(ls[1].d))) < PARALLEL;
    const done = ctx.commit('Circle', (c) => {
      const circle = addCircle(c.design, c.sketch, shape.c, shape.r, c.curveOpts);
      for (const id of ids) addConstraint(c.design, c.sketch, 'tangent', [id, circle.id]);
      // Between parallels the lines set the radius: a typed value must not move them.
      if (!parallel) c.hudDimension('r', 'radius', [circle.id], { label: add(shape.c, { x: shape.r * 0.6, y: shape.r * 0.2 }) });
    });
    if (done && parallel && ctx.hud.locked('r')) ctx.message('Between parallel lines the radius is set by their distance');
    if (done) reset();
  };

  const centroid = (): Vec2 => {
    const pts = picked.map((id) => {
      const l = ctx.sketch.curves[id];
      return l?.type === 'line' ? lerp(getPointPos(ctx.sketch, l.a), getPointPos(ctx.sketch, l.b), 0.5) : { x: 0, y: 0 };
    });
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  };

  const add1 = (ids: Id[]): void => {
    for (const id of ids) if (picked.length < count && !picked.includes(id)) picked.push(id);
    ctx.selection.set(picked);
    prompt();
    if (count === 3 && picked.length === 3) commit();
  };

  const tool: Tool = {
    start() {
      const pre = ctx.selection.ids().filter((id) => ctx.sketch.curves[id]?.type === 'line');
      ctx.selection.clear();
      prompt();
      if (pre.length) add1(pre.slice(0, count));
    },
    stop() {
      box.cancel();
      ctx.hud.clear();
      ctx.setHover(null);
    },
    move(e: ToolPointer) {
      at = e.world;
      if (box.move(e)) return;
      if (picked.length < count) ctx.setHover(ctx.hit(e.screen, { reserved: true, accept }));
      else ctx.setHover(null);
      if (count === 2 && picked.length === 2) fit();
    },
    down(e) {
      if (e.button === 0 && picked.length < count && !ctx.hit(e.screen, { reserved: true, accept })) box.begin(e);
    },
    up(e) {
      const ids = box.end(e);
      if (ids?.length) add1(ids);
    },
    click(e) {
      at = e.world;
      if (picked.length < count) {
        const hit = ctx.hit(e.screen, { reserved: true, accept });
        if (hit) add1([hit.id]);
        return;
      }
      fit();
      commit();
    },
    enter() {
      if (count === 2 && picked.length === 2 && ctx.hud.hasLocks()) {
        fit();
        commit();
        return true;
      }
      return false;
    },
    escape() {
      if (picked.length === 0 && !ctx.hud.hasLocks()) return false;
      reset();
      return true;
    },
    draw(p) {
      box.draw(p);
      const shape = count === 2 && picked.length === 2 ? twoTangent(lines()[0], lines()[1], ctx.hud.apply(at)) : null;
      if (shape) p.circle(shape.c, shape.r, previewStroke(ctx.lineType));
      if (count === 3 && picked.length === 3) {
        const s3 = threeTangent(lines(), centroid());
        if (s3) p.circle(s3.c, s3.r, previewStroke(ctx.lineType));
      }
    },
    docChanged: reset,
  };
  return tool;
}

export const circle2Tangent: ToolDef = {
  meta: { id: 'circle-2tan', label: '2-Tangent Circle', panel: 'create', group: 'circle' },
  create: (ctx) => createTangentCircle(ctx, 2),
};

export const circle3Tangent: ToolDef = {
  meta: { id: 'circle-3tan', label: '3-Tangent Circle', panel: 'create', group: 'circle' },
  create: (ctx) => createTangentCircle(ctx, 3),
};

export const tangentCircleTools: ToolDef[] = [circle2Tangent, circle3Tangent];
