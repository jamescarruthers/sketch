// Conic curve: two end points, a vertex, then the rho shape handle [ref SKT-CREATE-CONIC-CURVE].
import type { Vec2 } from '../model/types';
import { addConic, addConstraint } from '../model/document';
import { curveEndingAt, endTangent } from '../app/snap';
import { add, cross, dist, dot, lerp, norm, sub } from '../geom/vec';
import { conicPoint } from '../geom/conic';
import { COLORS } from '../render/style';
import { placedAt, previewStroke, radialLock, type Placed, type Tool, type ToolContext, type ToolDef, type ToolPointer } from './tool';

const RHO_MIN = 0.02;
const RHO_MAX = 0.98;
const DEFAULT_RHO = 0.5;
const clampRho = (r: number): number => Math.min(RHO_MAX, Math.max(RHO_MIN, r));

/** rho puts the curve's shoulder this far along from the chord's midpoint toward the vertex. */
const shoulder = (a: Vec2, b: Vec2, v: Vec2, rho: number): Vec2 => lerp(lerp(a, b, 0.5), v, rho);

function rhoAt(a: Vec2, b: Vec2, v: Vec2, p: Vec2): number {
  const d = sub(v, lerp(a, b, 0.5));
  const l2 = dot(d, d);
  return l2 < 1e-12 ? DEFAULT_RHO : clampRho(dot(sub(p, lerp(a, b, 0.5)), d) / l2);
}

const GRAB_PX = 10;
/** sin of how far a guide may be off a curve's end direction: about 1 degree. */
const GUIDE_TOL = 0.02;
/** The rho box sits beside the handle, not on it, so the handle can be grabbed. */
const FIELD_OFFSET_PX = 64;

function createConic(ctx: ToolContext): Tool {
  const picks: Placed[] = [];
  let raw: Placed = placedAt({ x: 0, y: 0 });
  let cursor: Placed = raw;
  /** Changes only by dragging the handle or typing [ref SKT-CREATE-CONIC-CURVE]. */
  let rho = DEFAULT_RHO;
  let dragging = false;

  const prompt = (): void => {
    ctx.status([
      'Click the first end point',
      'Click the second end point, or type the distance',
      'Click the vertex point',
      'Drag the Rho handle or type a value, then press Enter',
    ][picks.length]);
  };

  const refresh = (): void => {
    const n = picks.length;
    cursor = raw;
    if (n === 1) {
      const a = picks[0].pos;
      const fields = () => [{ key: 'length', kind: 'length' as const, value: dist(a, cursor.pos), at: lerp(a, cursor.pos, 0.5), lock: radialLock(a) }];
      ctx.hud.set(fields());
      const pos = ctx.hud.apply(raw.pos);
      cursor = dist(pos, raw.pos) > 1e-9 ? placedAt(pos) : raw;
      ctx.hud.set(fields());
    } else if (n === 3) {
      const [a, b, v] = picks.map((p) => p.pos);
      const field = (value: number) => [{
        key: 'rho', label: 'ρ', kind: 'number' as const, value,
        at: add(shoulder(a, b, v, rho), { x: ctx.view.px(FIELD_OFFSET_PX), y: 0 }),
      }];
      ctx.hud.set(field(rho));
      const typed = ctx.hud.locked('rho');
      if (typed) rho = clampRho(typed.value);
      ctx.hud.set(field(rho));
    } else ctx.hud.apply(raw.pos);
  };

  const reset = (): void => {
    picks.length = 0;
    rho = DEFAULT_RHO;
    dragging = false;
    ctx.hud.clear();
    prompt();
  };

  const onHandle = (e: ToolPointer): boolean => {
    if (picks.length !== 3) return false;
    const [a, b, v] = picks.map((p) => p.pos);
    return dist(ctx.view.toScreen(shoulder(a, b, v, rho)), e.screen) < GRAB_PX;
  };

  const accept = (): boolean => {
    const [a, b, v] = picks.map((p) => p.pos);
    const done = ctx.commit('Conic', (c) => {
      // A guide lying along a curve that ends here makes the conic tangent to it [ref SKT-SKETCH-CREATE-CONIC-CURVES].
      const guided = [picks[0], picks[1]].flatMap((placed) => {
        const at = placed.inference.point;
        const curve = at ? curveEndingAt(c.sketch, at) : null;
        const dir = at && curve ? endTangent(c.sketch, curve, at) : null;
        return curve && dir && Math.abs(cross(norm(dir), norm(sub(v, placed.pos)))) < GUIDE_TOL ? [curve] : [];
      });
      const conic = addConic(c.design, c.sketch, a, b, v, rho, c.curveOpts);
      c.infer(conic.a, picks[0]);
      c.infer(conic.b, picks[1]);
      c.infer(conic.v, picks[2]);
      for (const curve of guided) addConstraint(c.design, c.sketch, 'tangent', [curve, conic.id]);
      c.hudDimension('length', 'distance', [conic.a, conic.b], { label: add(lerp(a, b, 0.5), { x: 0, y: ctx.view.px(-18) }) });
    });
    if (done) reset();
    return done;
  };

  const place = (): void => {
    if (!ctx.hud.valid()) {
      ctx.message('That value is not valid', 'warn');
      return;
    }
    const n = picks.length;
    if (n < 3 && picks.some((p) => dist(p.pos, cursor.pos) < 1e-6)) {
      ctx.message('Pick a different point', 'warn');
      return;
    }
    if (n === 2) {
      const [a, b] = picks.map((p) => p.pos);
      if (Math.abs(cross(sub(b, a), sub(cursor.pos, a))) < 1e-6) {
        ctx.message('The vertex must be off the line between the end points', 'warn');
        return;
      }
    }
    if (n === 3) {
      accept();
      return;
    }
    picks.push(cursor);
    ctx.hud.advance();
    refresh();
    prompt();
  };

  return {
    start() {
      ctx.selection.clear();
      prompt();
    },
    stop() {
      ctx.hud.clear();
    },
    snap() {
      if (picks.length === 3) return null;
      return picks.length === 0 ? {} : { from: picks[picks.length - 1].pos };
    },
    move(e) {
      raw = { pos: e.snapped.pos, inference: e.snapped };
      if (dragging) {
        const [a, b, v] = picks.map((p) => p.pos);
        rho = rhoAt(a, b, v, e.world);
      }
      refresh();
    },
    down(e) {
      if (e.button !== 0 || !onHandle(e)) return;
      dragging = true;
      // A typed value gives way to the handle.
      ctx.hud.clear();
    },
    up() {
      dragging = false;
    },
    click(e) {
      raw = { pos: e.snapped.pos, inference: e.snapped };
      refresh();
      place();
    },
    enter() {
      // The Rho step is the last one: Enter completes the tool [ref].
      if (picks.length === 3) {
        refresh();
        return ctx.hud.valid() ? !accept() : true;
      }
      if (picks.length === 0 || !ctx.hud.hasLocks()) return false;
      refresh();
      place();
      return true;
    },
    escape() {
      if (picks.length === 0 && !ctx.hud.hasLocks()) return false;
      reset();
      return true;
    },
    draw(p) {
      if (picks.length === 0) return;
      const stroke = previewStroke(ctx.lineType);
      const [a, b] = [picks[0].pos, picks.length > 1 ? picks[1].pos : cursor.pos];
      if (picks.length === 1) {
        p.line(a, b, stroke);
        return;
      }
      const v = picks.length > 2 ? picks[2].pos : cursor.pos;
      const guide = { color: COLORS.guide, dash: [4, 3], width: 1 };
      p.line(a, v, guide);
      p.line(v, b, guide);
      const arc = { a, v, b, rho: picks.length > 2 ? rho : DEFAULT_RHO };
      const pts = Array.from({ length: 65 }, (_, i) => conicPoint(arc, i / 64));
      p.poly(pts, false, stroke);
      if (picks.length > 2) p.dot(shoulder(a, b, v, rho), { color: COLORS.selected, fill: dragging ? COLORS.selected : COLORS.dotHole }, 5);
    },
    docChanged: reset,
  };
}

export const conicTool: ToolDef = {
  meta: { id: 'conic', label: 'Conic Curve', panel: 'create' },
  create: createConic,
};

export const conicTools: ToolDef[] = [conicTool];
