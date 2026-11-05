// Line: a connected chain of straight and tangent arc segments [ref SKT-CREATE-LINES].
import type { Id, Vec2 } from '../model/types';
import { addArc, addConstraint, addLine, coincidentClasses, getPointPos } from '../model/document';
import { add, dist, dot, len, norm, perp, scale, sub, wrapAngle } from '../geom/vec';
import { curveEndingAt, endTangent } from '../app/snap';
import { relativeAngleLock } from './kit';
import {
  placedAt, previewStroke, radialLock, type Placed, type SnapOptions, type Tool, type ToolContext,
  type ToolDef, type ToolPointer,
} from './tool';

const PRESS_PX = 9;
const DEGENERATE = 1e-6;

/** Tangent arc from p along t, through e. Null when e is on the tangent line. */
export function tangentArc(p: Vec2, t: Vec2, e: Vec2): { c: Vec2; r: number; ccw: boolean } | null {
  const chord = sub(e, p);
  const n = perp(t);
  const h = dot(chord, n);
  if (Math.abs(h) < 1e-9 * Math.max(len(chord), 1)) return null;
  const signed = dot(chord, chord) / (2 * h);
  return { c: add(p, scale(n, signed)), r: Math.abs(signed), ccw: signed > 0 };
}

interface Anchor {
  /** Stored point the next segment starts from, or null for the first click of a chain. */
  point: Id | null;
  pos: Vec2;
  /** First click before anything is stored. */
  placed: Placed | null;
  /** Previous segment. */
  curve: Id | null;
}

function createLine(ctx: ToolContext): Tool {
  let anchor: Anchor | null = null;
  let start: Id | null = null;
  let raw: Placed = placedAt({ x: 0, y: 0 });
  let cursor: Placed = raw;
  let press: { screen: Vec2; anchor: Anchor } | null = null;
  let arc: Anchor | null = null;
  /** Where each placed segment started, so undo steps back one point at a time. */
  const trail: { anchor: Anchor | null; start: Id | null }[] = [];

  const leaving = (a: Anchor): Vec2 | null => {
    if (!a.point || !a.curve) return null;
    const t = endTangent(ctx.sketch, a.curve, a.point);
    return t ? norm(t) : null;
  };

  const updateCheck = (): void => {
    if (anchor?.point) {
      const at = ctx.view.toWorld(add(ctx.view.toScreen(anchor.pos), { x: 22, y: -22 }));
      ctx.hud.check(at, finishChain);
    } else ctx.hud.check(null);
  };

  const prompt = (): void => {
    if (arc) ctx.status('Drag to shape the tangent arc, release to place it');
    else if (anchor) ctx.status('Click the next point. Press and drag on the end point for an arc. Enter finishes');
    else ctx.status('Click the start point of the line');
  };

  const finishChain = (): void => {
    trail.length = 0;
    anchor = null;
    start = null;
    arc = null;
    press = null;
    ctx.hud.clear();
    ctx.hud.check(null);
    prompt();
    ctx.invalidate();
  };

  /** +X for the first segment; later ones measure from the way back along the previous segment [ref]. */
  const referenceDir = (): Vec2 => {
    const t = anchor ? leaving(anchor) : null;
    return t ? scale(t, -1) : { x: 1, y: 0 };
  };

  const refreshHud = (): void => {
    if (arc) {
      const a = arc;
      const t = leaving(a);
      const shape = t ? tangentArc(a.pos, t, raw.pos) : null;
      ctx.hud.set(shape ? [{
        key: 'radius', kind: 'length', label: 'R', value: shape.r, at: raw.pos,
        lock: (p, v) => {
          const side = shape.ccw ? 1 : -1;
          return radialLock(add(a.pos, scale(perp(t as Vec2), side * v)))(p, v);
        },
      }] : []);
    } else if (anchor) {
      const a = anchor.pos;
      const ref = referenceDir();
      const fields = () => {
        const p = cursor.pos;
        const d = sub(p, a);
        const angle = len(d) > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, dot(ref, d) / len(d)))) : 0;
        return [
          { key: 'length', kind: 'length' as const, value: dist(a, p), at: labelFor(a, p), lock: radialLock(a) },
          { key: 'angle', kind: 'angle' as const, value: angle, at: add(a, { x: ctx.view.px(48), y: ctx.view.px(-16) }), lock: relativeAngleLock(a, ref) },
        ];
      };
      cursor = raw;
      ctx.hud.set(fields());
      const pos = ctx.hud.apply(raw.pos);
      cursor = dist(pos, raw.pos) > 1e-9 ? placedAt(pos) : raw;
      ctx.hud.set(fields());
      return;
    }
    const pos = ctx.hud.apply(raw.pos);
    cursor = dist(pos, raw.pos) > 1e-9 ? placedAt(pos) : raw;
  };

  /** The chain's start can be reached through any point coincident with it. */
  const closes = (p: Placed): boolean => {
    const target = p.inference.point;
    if (!start || p.inference.kind !== 'point' || !target) return false;
    const rep = coincidentClasses(ctx.sketch);
    return rep(target) === rep(start);
  };

  const placeLine = (): void => {
    const a = anchor as Anchor;
    const end = cursor;
    if (!ctx.hud.valid()) {
      ctx.message('That value is not valid', 'warn');
      return;
    }
    if (dist(a.pos, end.pos) < DEGENERATE) {
      ctx.message('A line needs two different points', 'warn');
      return;
    }
    let created: Id | null = null;
    let endPoint: Id | null = null;
    let firstPoint: Id | null = null;
    const before = { anchor, start };
    const done = ctx.commit('Line', (c) => {
      const line = addLine(c.design, c.sketch, a.pos, end.pos, c.curveOpts);
      created = line.id;
      endPoint = line.b;
      firstPoint = line.a;
      if (a.point) addConstraint(c.design, c.sketch, 'coincident', [a.point, line.a]);
      else if (a.placed) c.infer(line.a, a.placed);
      c.infer(line.b, end, { segment: line.id });
      c.hudDimension('length', 'distance', [line.a, line.b], { label: labelFor(a.pos, end.pos) });
      const label = add(a.pos, { x: ctx.view.px(60), y: ctx.view.px(14) });
      if (!a.curve) c.hudDimension('angle', 'angle', ['axis-x', line.id], { label });
      else if (c.sketch.curves[a.curve]?.type === 'line') c.hudDimension('angle', 'angle', [a.curve, line.id], { label, variant: 1 });
    });
    if (!done) return;
    trail.push(before);
    afterSegment(created as Id | null, endPoint, firstPoint, closes(end), end.pos);
  };

  const labelFor = (a: Vec2, b: Vec2): Vec2 => {
    const n = perp(norm(sub(b, a)));
    return add(scale(add(a, b), 0.5), scale(n, ctx.view.px(20)));
  };

  const afterSegment = (curve: Id | null, end: Id | null, first: Id | null, closed: boolean, pos: Vec2): void => {
    ctx.hud.clear();
    start ??= anchor?.point ?? first;
    if (closed) {
      finishChain();
      return;
    }
    anchor = { point: end, pos, placed: null, curve };
    prompt();
  };

  const placeArc = (): void => {
    const a = arc as Anchor;
    const t = leaving(a);
    arc = null;
    const end = cursor;
    if (!t) return;
    const shape = tangentArc(a.pos, t, end.pos);
    if (!shape || dist(a.pos, end.pos) < DEGENERATE) {
      ctx.message('Drag off the tangent line to make an arc', 'warn');
      return;
    }
    let curve: Id | null = null;
    let endPoint: Id | null = null;
    const before = { anchor: a, start };
    const done = ctx.commit('Arc', (c) => {
      const from = shape.ccw ? a.pos : end.pos;
      const to = shape.ccw ? end.pos : a.pos;
      const made = addArc(c.design, c.sketch, shape.c, from, to, c.curveOpts);
      curve = made.id;
      const startPoint = shape.ccw ? made.a : made.b;
      endPoint = shape.ccw ? made.b : made.a;
      addConstraint(c.design, c.sketch, 'coincident', [a.point as Id, startPoint]);
      addConstraint(c.design, c.sketch, 'tangent', [a.curve as Id, made.id]);
      c.infer(endPoint, end);
      c.hudDimension('radius', 'radius', [made.id], { label: add(shape.c, scale(norm(sub(end.pos, shape.c)), shape.r * 0.6)) });
    });
    if (!done) return;
    trail.push(before);
    afterSegment(curve, endPoint, null, closes(end), end.pos);
  };

  const pressable = (e: ToolPointer): Anchor | null => {
    if (anchor?.point && dist(ctx.view.toScreen(anchor.pos), e.screen) < PRESS_PX) return anchor;
    // A chain just started on an existing end can curve away from that end straight off.
    const inference = anchor?.placed ? anchor.placed.inference : e.snapped;
    if (anchor && dist(ctx.view.toScreen(anchor.pos), e.screen) >= PRESS_PX) return null;
    const point = inference.point;
    if (inference.kind !== 'point' || !point) return null;
    const curve = curveEndingAt(ctx.sketch, point);
    return curve ? { point, pos: getPointPos(ctx.sketch, point), placed: null, curve } : null;
  };

  return {
    start() {
      ctx.selection.clear();
      prompt();
    },
    stop() {
      ctx.hud.clear();
      ctx.hud.check(null);
    },
    snap(): SnapOptions | null {
      const a = arc ?? anchor;
      if (!a) return {};
      if (arc) return { };
      const t = leaving(a);
      return { from: a.pos, previous: a.curve ?? undefined, tangent: t && a.curve ? { curve: a.curve, dir: t } : undefined };
    },
    move(e) {
      raw = { pos: e.snapped.pos, inference: e.snapped };
      if (press && e.dragging && !arc) {
        const a = press.anchor;
        if (leaving(a)) {
          arc = a;
          if (!start) start = a.point;
          ctx.hud.clear();
          prompt();
        }
      }
      refreshHud();
      updateCheck();
    },
    down(e) {
      if (e.button !== 0) return;
      const a = pressable(e);
      press = a ? { screen: e.screen, anchor: a } : null;
    },
    up() {
      press = null;
      if (arc) {
        refreshHud();
        placeArc();
        updateCheck();
      }
    },
    click(e) {
      if (e.button !== 0) return;
      raw = { pos: e.snapped.pos, inference: e.snapped };
      refreshHud();
      if (!anchor) {
        anchor = { point: null, pos: cursor.pos, placed: cursor, curve: null };
        ctx.hud.clear();
        prompt();
        refreshHud();
        return;
      }
      placeLine();
      updateCheck();
    },
    enter() {
      if (anchor && ctx.hud.hasLocks()) {
        refreshHud();
        placeLine();
        updateCheck();
        return true;
      }
      return false;
    },
    escape() {
      if (arc) {
        arc = null;
        press = null;
        ctx.hud.clear();
        prompt();
        return true;
      }
      if (anchor) {
        // A lone first click is pending and Esc cancels it. Past that the chain is placed: Esc leaves
        // the tool in one press [ref GUID-6A2AE9D9 "To exit the tool, press keyboard Esc"].
        const placed = !!anchor.point;
        finishChain();
        updateCheck();
        return !placed;
      }
      return false;
    },
    draw(p) {
      const stroke = previewStroke(ctx.lineType);
      if (arc) {
        const t = leaving(arc);
        const shape = t ? tangentArc(arc.pos, t, cursor.pos) : null;
        if (shape) {
          const a0 = Math.atan2(arc.pos.y - shape.c.y, arc.pos.x - shape.c.x);
          const a1 = Math.atan2(cursor.pos.y - shape.c.y, cursor.pos.x - shape.c.x);
          const sweep = shape.ccw ? wrapAngle(a1 - a0) : -wrapAngle(a0 - a1);
          p.arc(shape.c, shape.r, a0, sweep, stroke);
        } else p.line(arc.pos, cursor.pos, stroke);
        return;
      }
      if (anchor) p.line(anchor.pos, cursor.pos, stroke);
    },
    docChanged() {
      // Undo removes the last segment and its end point: step back to where it started.
      while (anchor?.point && !ctx.sketch.points[anchor.point]) {
        const back = trail.pop();
        if (!back) {
          finishChain();
          break;
        }
        anchor = back.anchor;
        start = back.start;
        arc = null;
        press = null;
        ctx.hud.clear();
        prompt();
      }
      if (anchor?.point) anchor.pos = getPointPos(ctx.sketch, anchor.point);
      updateCheck();
    },
  };
}

// Midpoint Line is the sibling in this group: see midpoint-line.ts.
export const lineTool: ToolDef = {
  meta: { id: 'line', label: 'Line', panel: 'create', group: 'line', shortcut: 'L' },
  create: createLine,
};
