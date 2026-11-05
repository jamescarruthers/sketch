// Fillet [ref SKT-ADD-FILLETS]: pick vertices or pairs of curves, set one shared radius, Enter.
import type { Hit, Preview, Tool, ToolContext, ToolDef, ToolPointer } from './tool';
import type { Id, Vec2 } from '../model/types';
import { addConstraint } from '../model/document';
import { resolve, closestOnParam } from '../geom/curves';
import { fillet, filletPreview, type FilletGeometry } from '../geom/modify';
import { add, cross, dist, dot, norm, scale, sub, wrapAngle } from '../geom/vec';
import { COLORS } from '../render/style';
import { contactFits, cornerAt, cornerPoint, proportionalSize, smoothJoin, type Corner } from './corner';
import { drawHandles, handleAt, type Handle } from './manipulator';

const KINDS = ['line', 'arc', 'circle'] as const;
const MAX_HALVINGS = 8;
const MIN_RADIUS = 1e-3;

const geometry = (ctx: ToolContext, c: Corner, r: number): FilletGeometry | null =>
  filletPreview(ctx.sketch, c.a, c.b, r, c.pickA, c.pickB, c.vertex ? cornerPoint(ctx.sketch, c) ?? undefined : undefined);

/** The arc's contact on a curve is whichever of its ends sits on that curve. */
function contactOn(ctx: ToolContext, id: Id, g: FilletGeometry): Vec2 {
  const pc = resolve(ctx.sketch, ctx.sketch.curves[id]);
  return closestOnParam(pc, g.start).dist <= closestOnParam(pc, g.end).dist ? g.start : g.end;
}

function fits(ctx: ToolContext, c: Corner, g: FilletGeometry): boolean {
  const corner = cornerPoint(ctx.sketch, c);
  if (!corner) return true;
  return contactFits(ctx.sketch, c.a, contactOn(ctx, c.a, g), corner, c.pickA) && contactFits(ctx.sketch, c.b, contactOn(ctx, c.b, g), corner, c.pickB);
}

/** Which side of a curve a fillet's centre is on: left or right of a line, inside or outside a round. */
function sideOf(ctx: ToolContext, id: Id, p: Vec2): number {
  const s = resolve(ctx.sketch, ctx.sketch.curves[id]).shape;
  if (s.kind === 'line') return Math.sign(cross(sub(s.b, s.a), sub(p, s.a)));
  return s.kind === 'arc' ? Math.sign(dist(p, s.c) - s.r) : 0;
}

/**
 * The size the fillet starts at, proportional to the curves, cut until it fits. "Fits" includes the
 * side: a radius too big for the inside of a corner has a solution round the far side, away from the
 * picks, and a very small fillet shows which side the picks mean.
 */
function startingRadius(ctx: ToolContext, c: Corner): number {
  let r = proportionalSize(ctx.sketch, c);
  const small = geometry(ctx, c, r / 2 ** MAX_HALVINGS);
  for (let i = 0; i < MAX_HALVINGS; i++) {
    const g = geometry(ctx, c, r);
    const sameSide = !g || !small || (sideOf(ctx, c.a, g.center) === sideOf(ctx, c.a, small.center) && sideOf(ctx, c.b, g.center) === sideOf(ctx, c.b, small.center));
    if (g && sameSide && fits(ctx, c, g)) break;
    r /= 2;
  }
  return r;
}

const arcMiddle = (g: FilletGeometry): { mid: Vec2; out: Vec2 } => {
  const a0 = Math.atan2(g.start.y - g.center.y, g.start.x - g.center.x);
  const a1 = Math.atan2(g.end.y - g.center.y, g.end.x - g.center.x);
  const middle = a0 + wrapAngle(a1 - a0) / 2;
  const out = { x: Math.cos(middle), y: Math.sin(middle) };
  return { mid: add(g.center, scale(out, g.radius)), out };
};

function drawArc(p: Preview, g: FilletGeometry, dashed: boolean): void {
  const a0 = Math.atan2(g.start.y - g.center.y, g.start.x - g.center.x);
  const a1 = Math.atan2(g.end.y - g.center.y, g.end.x - g.center.x);
  p.arc(g.center, g.radius, a0, wrapAngle(a1 - a0), { color: COLORS.preview, width: dashed ? 1.5 : 2.2, dash: dashed ? [6, 4] : [] });
}

function createFillet(ctx: ToolContext): Tool {
  let first: { id: Id; pos: Vec2 } | null = null;
  const picks: Corner[] = [];
  let radius = 0;
  let hovered: Corner | null = null;
  let drag: { grab: Vec2; radius: number; toward: Vec2; rate: number } | null = null;
  let pressOnHandle = false;

  const current = (): number => ctx.hud.locked('r')?.value ?? radius;

  const handles = (): Handle[] => {
    const g = picks[0] ? geometry(ctx, picks[0], current()) : null;
    // Parallel lines fix their own radius, which then differs from the one in play.
    if (!g || Math.abs(g.radius - current()) > 1e-9) return [];
    const { mid, out } = arcMiddle(g);
    return [{ key: 'r', at: mid, shape: 'arrow', dir: out }];
  };

  const syncHud = (): void => {
    const g = picks[0] ? geometry(ctx, picks[0], current()) : null;
    if (!g) {
      ctx.hud.clear();
      return;
    }
    const { mid, out } = arcMiddle(g);
    ctx.hud.set([{ key: 'r', label: 'R', kind: 'length', value: g.radius, at: add(mid, scale(out, ctx.view.px(40))) }]);
  };

  const prompt = (): void => {
    if (first) ctx.status('Pick the second curve');
    else if (picks.length) ctx.status('Drag the handle or type a radius, pick more corners, Enter to finish');
    else ctx.status('Pick a vertex, or two curves to fillet');
  };

  const refreshHighlight = (): void => {
    ctx.setHighlight([...(first ? [first.id] : []), ...picks.flatMap((c) => (c.vertex ? [c.vertex] : [c.a, c.b]))]);
  };

  const reset = (): void => {
    first = null;
    picks.length = 0;
    hovered = null;
    radius = 0;
    ctx.hud.clear();
    refreshHighlight();
    prompt();
  };

  const addCorner = (c: Corner): void => {
    if (picks.length === 0) radius = startingRadius(ctx, c);
    picks.push(c);
    refreshHighlight();
    syncHud();
    prompt();
  };

  const accept = (h: Hit): boolean => {
    if (h.kind === 'point') return !first && !!cornerAt(ctx.sketch, h.id, KINDS);
    const c = ctx.sketch.curves[h.id];
    return h.kind === 'curve' && !!c && (KINDS as readonly string[]).includes(c.type) && !c.projected && h.id !== first?.id;
  };

  const look = (e: ToolPointer): Hit | null => ctx.hit(e.screen, { accept, kinds: ['point', 'curve'] });

  const cornerOf = (hit: Hit): Corner | null => {
    if (hit.kind === 'point') return cornerAt(ctx.sketch, hit.id, KINDS);
    return first ? { a: first.id, b: hit.id, pickA: first.pos, pickB: hit.pos } : null;
  };

  const finish = (): boolean => {
    if (!ctx.hud.valid()) {
      ctx.message('That radius is not valid', 'warn');
      return false;
    }
    const r = current();
    for (const c of picks) {
      const g = geometry(ctx, c, r);
      if (!g || !fits(ctx, c, g)) {
        ctx.message('That radius does not fit this corner', 'warn');
        return false;
      }
    }
    const lock = ctx.hud.locked('r');
    const list = [...picks];
    const mirrored = Object.values(ctx.sketch.constraints).filter((k) => k.type === 'symmetric').map((k) => k.id);
    const done = ctx.commit('Fillet', (scope) => {
      let shared: Id | null = null;
      for (const pick of list) {
        // An earlier fillet may have taken this vertex with it, if both picks shared a corner.
        if (pick.vertex && !scope.sketch.points[pick.vertex]) continue;
        const c = pick.vertex ? cornerAt(scope.sketch, pick.vertex, KINDS) : pick;
        if (!c) continue;
        const res = fillet(scope.design, scope.sketch, c.a, c.b, r, c.pickA, c.pickB, c.vertex ? cornerPoint(scope.sketch, c) ?? undefined : undefined);
        const arc = res.created.find((id) => scope.sketch.curves[id]?.type === 'arc');
        if (!arc) continue;
        const dim = Object.values(scope.sketch.dimensions).find((m) => m.kind === 'radius' && m.refs[0] === arc);
        if (shared === null) {
          shared = arc;
          if (dim && lock) dim.expression = lock.expression;
        } else {
          if (dim) delete scope.sketch.dimensions[dim.id];
          addConstraint(scope.design, scope.sketch, 'equal', [shared, arc]);
        }
      }
      return shared !== null;
    });
    if (done && mirrored.some((id) => !ctx.sketch.constraints[id])) ctx.message('The Symmetry on that corner went with it: the point it held is gone', 'warn');
    return done;
  };

  return {
    start() {
      const { sketch } = ctx;
      const chosen = ctx.selection.ids();
      const curves = chosen.filter((id) => sketch.curves[id]);
      const pointsPicked = chosen.flatMap((id) => {
        const c = sketch.points[id] ? cornerAt(sketch, id, KINDS) : null;
        return c ? [c] : [];
      });
      ctx.selection.clear();
      pointsPicked.forEach(addCorner);
      if (!picks.length && curves.length === 2) {
        const [a, b] = curves;
        const ends = [resolve(sketch, sketch.curves[a]), resolve(sketch, sketch.curves[b])];
        addCorner({ a, b, pickA: ends[0].at(0.5), pickB: ends[1].at(0.5) });
      }
      prompt();
    },
    stop() {
      ctx.hud.clear();
      ctx.setHover(null);
      ctx.setHighlight([]);
    },
    move(e) {
      if (drag) {
        const along = dot(sub(e.world, drag.grab), drag.toward);
        radius = Math.max(MIN_RADIUS, drag.radius + along * drag.rate);
        syncHud();
        return;
      }
      const hit = look(e);
      hovered = hit ? cornerOf(hit) : null;
      ctx.setHover(hit);
    },
    down(e) {
      if (e.button !== 0) return;
      const h = handleAt(ctx.view, handles(), e.screen);
      pressOnHandle = !!h;
      const g = h && picks[0] ? geometry(ctx, picks[0], current()) : null;
      if (!h || !g) return;
      const { mid, out } = arcMiddle(g);
      const corner = cornerPoint(ctx.sketch, picks[0]);
      // Sliding the arc's middle toward the centre grows r at the corner's own rate.
      const travel = corner ? dist(corner, mid) : 0;
      ctx.hud.clear();
      radius = g.radius;
      drag = { grab: e.world, radius: g.radius, toward: scale(norm(out), -1), rate: travel > 1e-9 ? g.radius / travel : 1 };
      syncHud();
    },
    up() {
      drag = null;
    },
    click(e) {
      if (pressOnHandle) {
        pressOnHandle = false;
        return;
      }
      const hit = look(e);
      if (!hit) return;
      if (hit.kind === 'curve' && !first) {
        first = { id: hit.id, pos: hit.pos };
        refreshHighlight();
        prompt();
        return;
      }
      const c = cornerOf(hit);
      if (!c) return;
      if (smoothJoin(ctx.sketch, c)) {
        ctx.message('These curves already join tangent: there is no corner to fillet', 'warn');
        first = null;
        hovered = null;
        refreshHighlight();
        prompt();
        return;
      }
      const again = picks.findIndex((k) => k.vertex && k.vertex === c.vertex);
      first = null;
      hovered = null;
      if (again >= 0) {
        picks.splice(again, 1);
        refreshHighlight();
        syncHud();
        prompt();
      } else addCorner(c);
    },
    enter() {
      if (!picks.length) return false;
      return !finish();
    },
    escape() {
      if (!first && !picks.length) return false;
      reset();
      return true;
    },
    draw(p) {
      const r = current();
      for (const c of picks) {
        const g = geometry(ctx, c, r);
        if (g) drawArc(p, g, false);
      }
      if (hovered && !smoothJoin(ctx.sketch, hovered)) {
        const g = geometry(ctx, hovered, picks.length ? r : startingRadius(ctx, hovered));
        if (g) drawArc(p, g, true);
      }
      drawHandles(p, handles(), drag ? 'r' : null);
    },
    docChanged: reset,
  };
}

export const filletTool: ToolDef = {
  meta: { id: 'fillet', label: 'Fillet', panel: 'modify' },
  create: createFillet,
};
