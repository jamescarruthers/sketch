// Sketch Scale [ref SKT-SCALE]: pick geometry, a base point, then type or drag the factor.
import type { Design, Id, Sketch, Vec2 } from '../model/types';
import { getPointPos, literalExpression } from '../model/document';
import { measureDimension } from '../model/parameters';
import { preview, scaleGeometry } from '../geom/modify';
import { add, dist, dot, norm, scale, sub } from '../geom/vec';
import type { ExpressionField, SelectionField } from '../ui/dialogs/dialog';
import { defineDialogTool } from './dialog-tool';
import { boundsOf, drawHandles, handleAt, type Handle } from './manipulator';
import type { Hit, ToolContext, ToolDef } from './tool';
import { COLORS } from '../render/style';

const MIN_FACTOR = 0.01;

interface State {
  objects: SelectionField;
  base: SelectionField;
  factor: ExpressionField;
  drag: { reach: number; dir: Vec2 } | null;
}

/**
 * Scale, then bring every driving dimension in line with what it now measures. A dimension wholly in
 * the selection scales by the factor; one reaching outside would otherwise drag the geometry straight
 * back on the next solve, so it takes the new measure. Expressions stay live as `(expr) * ratio`.
 */
export function applyScale(sketch: Sketch, ids: Id[], base: Vec2, factor: number): void {
  scaleGeometry(sketch, ids, base, factor);
  for (const d of Object.values(sketch.dimensions)) {
    if (!d.driving || d.feature) continue;
    const measured = measureDimension(sketch, d);
    if (measured === null || !(measured > 0) || Math.abs(measured - d.value) < 1e-9) continue;
    const ratio = measured / d.value;
    d.expression = /^[0-9.]+\s*(mm|deg)$/.test(d.expression.trim())
      ? literalExpression(d.kind, measured)
      : `(${d.expression}) * ${Number(ratio.toFixed(9))}`;
    d.value = measured;
  }
}

const basePoint = (ctx: ToolContext, s: State): Vec2 | null => {
  const [id] = s.base.ids();
  return id ? getPointPos(ctx.sketch, id) : null;
};

/** The handle sits at factor 1 on the far side of the selection, so a drag reads as a stretch. */
function reach(ctx: ToolContext, s: State, base: Vec2): { reach: number; dir: Vec2 } {
  const box = boundsOf(ctx.sketch, s.objects.ids());
  const far = box ? { x: box.maxX, y: box.maxY } : base;
  const d = dist(base, far);
  return d > 1e-6 ? { reach: d, dir: norm(sub(far, base)) } : { reach: ctx.view.px(80), dir: { x: 1, y: 0 } };
}

const handleOf = (ctx: ToolContext, s: State): Handle | null => {
  const base = basePoint(ctx, s);
  const f = s.factor.value();
  if (!base || f === null || !s.objects.ids().length) return null;
  const r = reach(ctx, s, base);
  return { key: 'factor', at: add(base, scale(r.dir, r.reach * f)), shape: 'arrow', dir: r.dir, tip: `× ${Number(f.toFixed(3))}` };
};

export const scaleTool: ToolDef = defineDialogTool<State>({
  meta: { id: 'scale', label: 'Sketch Scale', panel: 'modify' },
  title: 'Sketch Scale',
  // Entities take curves only, so a point can only mean the base: no need to go to its field first.
  click(ctx, s, e) {
    if (s.base.ids().length || !s.objects.ids().length) return false;
    const hit = ctx.hit(e.screen, { kinds: ['point'], reserved: true });
    if (hit) s.base.set([hit.id]);
    return !!hit;
  },
  build(ctx, d) {
    const objects = d.selection({
      label: 'Entities',
      accept: (h: Hit) => h.kind === 'curve' && !!ctx.sketch.curves[h.id] && !ctx.sketch.curves[h.id].derivedFrom,
      initial: ctx.selection.ids().filter((id) => ctx.sketch.curves[id]),
    });
    const base = d.selection({ label: 'Point', accept: (h: Hit) => h.kind === 'point', multiple: false });
    const factor = d.expression('Scale Factor', '1', 'number');
    if (objects.ids().length) base.activate();
    ctx.selection.clear();
    return { objects, base, factor, drag: null };
  },
  changed(_ctx, s, d) {
    const f = s.factor.value();
    d.setError(f !== null && f <= 0 ? 'The factor must be greater than zero' : null);
    if (f === null || f <= 0) d.setOkEnabled(false);
  },
  preview(p, ctx, s) {
    const base = basePoint(ctx, s);
    const ids = s.objects.ids();
    const f = s.factor.value();
    if (base) p.dot(base, { color: COLORS.preview, fill: COLORS.preview }, 4);
    if (!base || !ids.length || f === null || f <= 0) return;
    const ghost = preview(ctx.design, ctx.sketch, (_d: Design, copy) => applyScale(copy, ids, base, f)).sketch;
    p.curves(ghost, ids.map((id) => ghost.curves[id]).filter((c) => c), { color: COLORS.preview, width: 1.5, dash: [6, 4] });
    const h = handleOf(ctx, s);
    if (h) drawHandles(p, [h], s.drag ? h.key : null);
  },
  press(ctx, s, e) {
    const h = handleOf(ctx, s);
    const base = basePoint(ctx, s);
    if (!h || !base || !handleAt(ctx.view, [h], e.screen)) return false;
    s.drag = reach(ctx, s, base);
    return true;
  },
  drag(ctx, s, e) {
    const base = basePoint(ctx, s);
    if (!base || !s.drag) return;
    const f = Math.max(MIN_FACTOR, dot(sub(e.world, base), s.drag.dir) / s.drag.reach);
    s.factor.set(String(Number(f.toFixed(3))));
  },
  release(_ctx, s) {
    s.drag = null;
  },
  ok(ctx, s) {
    const base = basePoint(ctx, s);
    const f = s.factor.value();
    if (!base || f === null) return false;
    const ids = s.objects.ids();
    ctx.commit('Sketch Scale', (c) => applyScale(c.sketch, ids, base, f));
  },
});
