// Chamfer [ref SKT-ADD-CHAMFERS]: a vertex or two lines, then manipulators or typed values, Enter.
import type { Hit, HudField, Preview, Tool, ToolContext, ToolDef, ToolPointer } from './tool';
import type { Id, Vec2 } from '../model/types';
import { getPointPos } from '../model/document';
import { chamfer, chamferPreview, type ChamferGeometry, type ChamferMode } from '../geom/modify';
import { add, cross, dist, dot, lerp, norm, scale, sub } from '../geom/vec';
import { COLORS } from '../render/style';
import { contactFits, cornerAt, proportionalSize, type Corner } from './corner';
import { drawHandles, handleAt, type Handle } from './manipulator';

const KINDS = ['line'] as const;
const DEFAULT_ANGLE = Math.PI / 4;
const MIN_DISTANCE = 1e-3;
const MIN_ANGLE = 0.02;

interface Picks { first: { id: Id; pos: Vec2 } | null; corner: Corner | null; d1: number; d2: number; angle: number; linked: boolean }

/** Palette type buttons restart the tool; this carries the picks across the switch [ref]. */
let carried: Picks | null = null;

function createChamfer(ctx: ToolContext, mode: ChamferMode, label: string): Tool {
  let s: Picks = { first: null, corner: null, d1: 0, d2: 0, angle: DEFAULT_ANGLE, linked: true };
  let hovered: Corner | null = null;
  let drag: 'd1' | 'd2' | null = null;
  let pressOnHandle = false;

  const firstValue = (): number => ctx.hud.locked('d1')?.value ?? s.d1;
  const secondValue = (): number | undefined => {
    if (mode === 'twoDistance') return ctx.hud.locked('d2')?.value ?? s.d2;
    return mode === 'distanceAngle' ? ctx.hud.locked('angle')?.value ?? s.angle : undefined;
  };

  const shape = (c: Corner, d1: number, second: number | undefined): ChamferGeometry | null =>
    chamferPreview(ctx.sketch, c.a, c.b, mode, d1, second, { a: c.pickA, b: c.pickB });

  const live = (): ChamferGeometry | null => (s.corner ? shape(s.corner, firstValue(), secondValue()) : null);

  const handles = (): Handle[] => {
    const g = live();
    if (!g) return [];
    return [
      { key: 'd1', at: g.pa, shape: 'arrow', dir: sub(g.pa, g.corner) },
      { key: 'd2', at: g.pb, shape: mode === 'distanceAngle' ? 'grip' : 'arrow', dir: sub(g.pb, g.corner) },
    ];
  };

  const syncHud = (): void => {
    const g = live();
    if (!g) {
      ctx.hud.clear();
      return;
    }
    const clear = ctx.view.px(34);
    const beside = (p: Vec2): Vec2 => add(p, scale(norm(sub(p, lerp(g.pa, g.pb, 0.5))), clear));
    const fields: HudField[] = [{ key: 'd1', label: 'D1', kind: 'length', value: dist(g.corner, g.pa), at: beside(g.pa) }];
    if (mode === 'twoDistance') fields.push({ key: 'd2', label: 'D2', kind: 'length', value: dist(g.corner, g.pb), at: beside(g.pb) });
    if (mode === 'distanceAngle') fields.push({ key: 'angle', label: 'A', kind: 'angle', value: secondValue() as number, at: beside(g.pb) });
    ctx.hud.set(fields);
  };

  const prompt = (): void => {
    if (s.first) ctx.status('Pick the second line');
    else if (s.corner) ctx.status('Drag a handle or type a value, Enter to finish');
    else ctx.status('Pick a vertex, or two lines to chamfer');
  };

  const light = (): void => {
    ctx.setHighlight(s.first ? [s.first.id] : s.corner ? [s.corner.a, s.corner.b] : []);
  };

  const reset = (): void => {
    s = { first: null, corner: null, d1: 0, d2: 0, angle: DEFAULT_ANGLE, linked: true };
    hovered = null;
    ctx.hud.clear();
    light();
    prompt();
  };

  const begin = (c: Corner): void => {
    s.first = null;
    hovered = null;
    s.corner = c;
    s.d1 = proportionalSize(ctx.sketch, c);
    s.d2 = s.d1;
    s.angle = DEFAULT_ANGLE;
    s.linked = true;
    light();
    syncHud();
    prompt();
  };

  const accept = (h: Hit): boolean => {
    if (h.kind === 'point') return !s.first && !!cornerAt(ctx.sketch, h.id, KINDS);
    const c = ctx.sketch.curves[h.id];
    return h.kind === 'curve' && c?.type === 'line' && !c.projected && h.id !== s.first?.id;
  };

  const look = (e: ToolPointer): Hit | null => ctx.hit(e.screen, { accept, kinds: ['point', 'curve'] });

  const cornerOf = (hit: Hit): Corner | null => {
    if (hit.kind === 'point') return cornerAt(ctx.sketch, hit.id, KINDS);
    return s.first ? { a: s.first.id, b: hit.id, pickA: s.first.pos, pickB: hit.pos } : null;
  };

  const place = (): boolean => {
    const c = s.corner;
    const g = live();
    if (!c || !g) return false;
    if (!ctx.hud.valid()) {
      ctx.message('That value is not valid', 'warn');
      return false;
    }
    if (!contactFits(ctx.sketch, c.a, g.pa, g.corner, c.pickA) || !contactFits(ctx.sketch, c.b, g.pb, g.corner, c.pickB)) {
      ctx.message('That chamfer does not fit these lines', 'warn');
      return false;
    }
    const d1 = firstValue();
    const second = secondValue();
    const lockFirst = ctx.hud.locked('d1');
    const lockSecond = ctx.hud.locked(mode === 'distanceAngle' ? 'angle' : 'd2');
    return ctx.commit(label, (scope) => {
      const res = chamfer(scope.design, scope.sketch, c.a, c.b, mode, d1, second, { a: c.pickA, b: c.pickB });
      const dims = res.created.filter((id) => scope.sketch.dimensions[id]).map((id) => scope.sketch.dimensions[id]);
      if (!dims.length) return false;
      if (lockFirst) dims[0].expression = lockFirst.expression;
      if (lockSecond && dims[1]) dims[1].expression = lockSecond.expression;
      return true;
    });
  };

  const dragTo = (world: Vec2): void => {
    const g = live();
    if (!g || !drag) return;
    const ua = norm(sub(g.pa, g.corner));
    const ub = norm(sub(g.pb, g.corner));
    if (drag === 'd1') {
      s.d1 = Math.max(MIN_DISTANCE, dot(sub(world, g.corner), ua));
      if (s.linked) s.d2 = s.d1;
    } else if (mode === 'distanceAngle') {
      const end = add(g.corner, scale(ub, Math.max(MIN_DISTANCE, dot(sub(world, g.corner), ub))));
      const back = sub(g.corner, g.pa);
      const toEnd = sub(end, g.pa);
      s.angle = Math.max(MIN_ANGLE, Math.abs(Math.atan2(cross(back, toEnd), dot(back, toEnd))));
    } else {
      s.d2 = Math.max(MIN_DISTANCE, dot(sub(world, g.corner), ub));
      if (mode === 'equal' || s.linked) s.d1 = s.d2;
    }
    syncHud();
  };

  return {
    start() {
      const held = carried;
      carried = null;
      if (held) {
        s = held;
        light();
        syncHud();
      } else {
        const point = ctx.selection.ids().map((id) => (ctx.sketch.points[id] ? cornerAt(ctx.sketch, id, KINDS) : null)).find((c) => c);
        ctx.selection.clear();
        if (point) begin(point);
      }
      prompt();
    },
    stop() {
      if (s.first || s.corner) {
        carried = s;
        queueMicrotask(() => { carried = null; });
      }
      ctx.hud.clear();
      ctx.setHover(null);
      ctx.setHighlight([]);
    },
    move(e) {
      if (drag) {
        dragTo(e.world);
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
      if (!h) return;
      ctx.hud.clear();
      drag = h.key as 'd1' | 'd2';
    },
    up() {
      if (drag) s.linked = false;
      drag = null;
    },
    click(e) {
      if (pressOnHandle) {
        pressOnHandle = false;
        return;
      }
      const hit = look(e);
      if (!hit) return;
      // A corner picked at its vertex is being set, and a click on what makes it is not the click away that places it.
      const at = s.corner?.vertex ? getPointPos(ctx.sketch, s.corner.vertex) : null;
      if (s.corner && at && (hit.id === s.corner.a || hit.id === s.corner.b || (hit.kind === 'point' && dist(hit.pos, at) < 1e-6))) return;
      if (s.corner && !place()) return;
      if (hit.kind === 'curve' && !s.first) {
        // The commit above may have reshaped this line, so re-check it still stands.
        if (!ctx.sketch.curves[hit.id]) return;
        reset();
        s.first = { id: hit.id, pos: hit.pos };
        light();
        prompt();
        return;
      }
      const c = cornerOf(hit);
      if (c) begin(c);
    },
    enter() {
      if (!s.corner) return false;
      return !place();
    },
    escape() {
      if (!s.first && !s.corner) return false;
      reset();
      return true;
    },
    draw(p: Preview) {
      const g = live();
      if (g) p.line(g.pa, g.pb, { color: COLORS.preview, width: 2.2 });
      if (hovered) {
        const d = proportionalSize(ctx.sketch, hovered);
        const second = mode === 'twoDistance' ? d : mode === 'distanceAngle' ? DEFAULT_ANGLE : undefined;
        const h = shape(hovered, d, second);
        if (h) p.line(h.pa, h.pb, { color: COLORS.preview, width: 1.5, dash: [6, 4] });
      }
      drawHandles(p, handles(), drag);
    },
    docChanged: reset,
  };
}

const chamferTool = (id: string, label: string, mode: ChamferMode): ToolDef => ({
  meta: { id, label, panel: 'modify', group: 'chamfer' },
  create: (ctx) => createChamfer(ctx, mode, label),
});

export const chamferTools: ToolDef[] = [
  chamferTool('chamfer-equal', 'Equal Distance Chamfer', 'equal'),
  chamferTool('chamfer-distance-angle', 'Distance And Angle Chamfer', 'distanceAngle'),
  chamferTool('chamfer-two-distance', 'Two Distance Chamfer', 'twoDistance'),
];
