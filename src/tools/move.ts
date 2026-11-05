// Move/Copy: an XY triad and rotate ring on the canvas, mirrored in the dialog's dx, dy and angle. Move Type picks
// how the offset is given: typed or dragged (Free Move), or from a start point to a target (Point to Point). The turn
// is about the centre of the selection, or about a point of the user's choosing (Set Pivot).
import type { Vec2 } from '../model/types';
import { moveCopy, moveCopyPreview, type MoveSpec } from '../geom/modify';
import { slidePathText } from '../io/text';
import { add, rotate, sub } from '../geom/vec';
import { clearManipulators, dragCurvatureHandle, grabCurvatureHandle, toggleManipulators, type HandleGrab } from './spline';
import { COLORS } from '../render/style';
import type { Dialog, ExpressionField, Field, SelectionField } from '../ui/dialogs/dialog';
import { defineDialogTool } from './dialog-tool';
import { boundsOf, centreOf, drawHandles, handleAt, type Handle } from './manipulator';
import type { Hit, ToolContext, ToolDef } from './tool';

const ARM_PX = 72;

/** A point taken from the canvas, snapped: a row with a Pick button and what was picked. */
interface PickField {
  row: HTMLElement;
  button: HTMLButtonElement;
  readout: HTMLElement;
  at: Vec2 | null;
  active: boolean;
  prompt: string;
}

interface State {
  dialog: Dialog;
  objects: SelectionField;
  type: Field<string>;
  start: PickField;
  target: PickField;
  setPivot: Field<boolean>;
  pivot: PickField;
  /** Where the target would be if the cursor were clicked now, while it is being chosen. */
  hover: Vec2 | null;
  /** Move Type and Set Pivot as `changed` last saw them, so a pick starts only when one is switched on. */
  was: { type: string; pivot: boolean };
  dx: ExpressionField;
  dy: ExpressionField;
  angle: ExpressionField;
  copy: Field<boolean>;
  drag: { key: string; grab: Vec2; dx: number; dy: number; angle: number } | null;
  /** A spline manipulator handle in the hand. */
  handle: HandleGrab | null;
}

const hasObjects = (ctx: ToolContext, h: Hit): boolean => {
  if (h.kind === 'curve') return !!ctx.sketch.curves[h.id];
  return h.kind === 'point' && !!ctx.sketch.points[h.id]?.explicit;
};

const byPoints = (s: State): boolean => s.type.get() === 'point';
const picks = (s: State): PickField[] => [s.start, s.target, s.pivot];
const anyPicking = (s: State): boolean => picks(s).some((f) => f.active);

/** The chosen pivot, or the centre of what is being moved. */
function pivotOf(ctx: ToolContext, s: State): Vec2 | null {
  if (s.setPivot.get() && s.pivot.at) return s.pivot.at;
  const box = boundsOf(ctx.sketch, s.objects.ids());
  return box && centreOf(box);
}

/** The move from the start point to the target, or to the cursor while the target is still being chosen. */
function vectorOf(s: State): Vec2 | null {
  const to = s.target.at ?? (s.target.active ? s.hover : null);
  return s.start.at && to ? sub(to, s.start.at) : null;
}

const specOf = (ctx: ToolContext, s: State): MoveSpec | null => {
  const angle = s.angle.value();
  const pivot = pivotOf(ctx, s);
  if (angle === null || !pivot) return null;
  if (byPoints(s)) {
    const v = vectorOf(s) ?? { x: 0, y: 0 };
    return { dx: v.x, dy: v.y, angle, pivot, copy: s.copy.get() };
  }
  const dx = s.dx.value();
  const dy = s.dy.value();
  return dx === null || dy === null ? null : { dx, dy, angle, pivot, copy: s.copy.get() };
};

const handles = (ctx: ToolContext, spec: MoveSpec, byPoint: boolean): Handle[] => {
  const centre = add(spec.pivot as Vec2, { x: spec.dx ?? 0, y: spec.dy ?? 0 });
  const arm = ctx.view.px(ARM_PX);
  const a = spec.angle ?? 0;
  const ring: Handle = { key: 'rotate', at: add(centre, rotate({ x: arm * 0.75, y: arm * 0.75 }, a)), shape: 'ring' };
  // The vector is the two points: only the ring is left to take hold of.
  if (byPoint) return [{ key: 'free', at: centre, shape: 'square' }, ring];
  return [
    { key: 'free', at: centre, shape: 'square' },
    { key: 'x', at: add(centre, rotate({ x: arm, y: 0 }, a)), shape: 'arrow', dir: rotate({ x: 1, y: 0 }, a) },
    { key: 'y', at: add(centre, rotate({ x: 0, y: arm }, a)), shape: 'arrow', dir: rotate({ x: 0, y: 1 }, a) },
    ring,
  ];
};

const here = (v: Vec2 | null): string => (v ? `${Number(v.x.toFixed(3))}, ${Number(v.y.toFixed(3))}` : '');

function pickField(d: Dialog, label: string, prompt: string): PickField {
  const button = document.createElement('button');
  button.className = 'select-toggle pick-toggle';
  button.textContent = 'Pick';
  const readout = document.createElement('span');
  readout.className = 'pick-value';
  const box = document.createElement('div');
  box.className = 'select-box';
  box.append(button, readout);
  const row = d.row(label, box);
  row.classList.add('pick-row');
  row.dataset.field = label;
  return { row, button, readout, at: null, active: false, prompt };
}

const showPick = (f: PickField): void => {
  f.button.classList.toggle('active', f.active);
  f.readout.textContent = here(f.at);
};

/** Make `f` the one taking canvas clicks, or none. A pick and the Objects field never take clicks together. */
function takePicks(ctx: ToolContext, s: State, f: PickField | null): void {
  for (const g of picks(s)) g.active = g === f;
  if (f) s.dialog.deactivateFields();
  ctx.status(f ? f.prompt : 'Move/Copy: set the values, then OK');
  picks(s).forEach(showPick);
  ctx.invalidate();
}

const mm = (v: number): string => `${Number(v.toFixed(4))} mm`;
const deg = (v: number): string => `${Number(((v * 180) / Math.PI).toFixed(3))} deg`;

export const moveTool: ToolDef = defineDialogTool<State>({
  meta: { id: 'move-copy', label: 'Move/Copy', panel: 'modify', shortcut: 'M' },
  title: 'Move/Copy',
  build(ctx, d) {
    const objects = d.selection({
      label: 'Objects',
      accept: (h: Hit) => hasObjects(ctx, h),
      initial: ctx.selection.ids().filter((id) => ctx.sketch.curves[id] || ctx.sketch.points[id]?.explicit),
    });
    const type = d.select('Move Type', [{ value: 'free', label: 'Free Move' }, { value: 'point', label: 'Point to Point' }], 'free');
    const start = pickField(d, 'Start Point', 'Click the point to move from. It snaps, other layers included');
    const target = pickField(d, 'Target Point', 'Click the point to move to. It snaps, other layers included');
    const dx = d.expression('X Distance', '0 mm');
    const dy = d.expression('Y Distance', '0 mm');
    const angle = d.expression('Z Angle', '0 deg', 'angle');
    const setPivot = d.checkbox('Set Pivot', false);
    const pivot = pickField(d, 'Pivot', 'Click the point to turn about. It snaps, other layers included');
    const copy = d.checkbox('Create Copy', false);
    for (const f of [start, target, pivot]) f.row.style.display = 'none';
    ctx.selection.clear();
    clearManipulators();
    const s: State = { dialog: d, objects, type, start, target, setPivot, pivot, hover: null, was: { type: 'free', pivot: false }, dx, dy, angle, copy, drag: null, handle: null };
    start.button.onclick = () => takePicks(ctx, s, start);
    target.button.onclick = () => takePicks(ctx, s, target);
    pivot.button.onclick = () => takePicks(ctx, s, pivot);
    return s;
  },
  snap: (_ctx, s) => (anyPicking(s) ? {} : null),
  move(_ctx, s, e) {
    if (s.target.active) s.hover = e.snapped.pos;
  },
  click(ctx, s, e) {
    const f = picks(s).find((g) => g.active);
    if (f) {
      f.at = e.snapped.pos;
      s.hover = null;
      // The start leads to the target; the others are done.
      takePicks(ctx, s, f === s.start && !s.target.at ? s.target : null);
      s.dialog.changed();
      return true;
    }
    // A spline point shows or hides that spline's manipulator handles [ref SKT-CREATE-SPLINES].
    const hit = ctx.hit(e.screen, { kinds: ['point'] });
    return !!hit && toggleManipulators(ctx, hit.id);
  },
  changed(ctx, s, d) {
    // Taking objects takes the clicks back from a pick.
    if (s.objects.active && anyPicking(s)) takePicks(ctx, s, null);
    const free = !byPoints(s);
    s.dx.row.style.display = free ? '' : 'none';
    s.dy.row.style.display = free ? '' : 'none';
    s.start.row.style.display = free ? 'none' : '';
    s.target.row.style.display = free ? 'none' : '';
    const turning = s.setPivot.get();
    s.pivot.row.style.display = turning ? '' : 'none';
    const was = s.was;
    s.was = { type: s.type.get(), pivot: turning };
    if (!free && was.type === 'free' && !s.start.at) takePicks(ctx, s, s.start);
    else if (turning && !was.pivot && !s.pivot.at) takePicks(ctx, s, s.pivot);
    else if (!turning && s.pivot.active) takePicks(ctx, s, null);
    if (!free && !anyPicking(s)) picks(s).forEach(showPick);
    const bad = s.angle.value() === null || (free ? s.dx.value() === null || s.dy.value() === null : !s.start.at || !s.target.at);
    if (bad) d.setOkEnabled(false);
  },
  preview(p, ctx, s) {
    const spec = specOf(ctx, s);
    if (!spec) return;
    for (const poly of moveCopyPreview(ctx.sketch, s.objects.ids(), spec)) p.poly(poly, false, { color: COLORS.preview, width: 1.5, dash: [6, 4] });
    if (byPoints(s)) {
      const to = s.target.at ?? (s.target.active ? s.hover : null);
      if (s.start.at && to) p.line(s.start.at, to, { color: COLORS.axisX, width: 1.5 });
      for (const f of [s.start.at, to]) if (f) p.dot(f, { color: COLORS.manip, fill: COLORS.manip }, 4);
    }
    if (s.setPivot.get() && s.pivot.at) p.dot(s.pivot.at, { color: COLORS.manip, fill: COLORS.dotHole }, 6);
    const list = handles(ctx, spec, byPoints(s));
    if (!byPoints(s)) {
      p.line(list[0].at, list[1].at, { color: COLORS.axisX, width: 1.5 });
      p.line(list[0].at, list[2].at, { color: COLORS.axisY, width: 1.5 });
    }
    drawHandles(p, list, s.drag?.key ?? null);
  },
  press(ctx, s, e) {
    // A click on the canvas while a point is being picked is the pick.
    if (anyPicking(s)) return false;
    s.handle = grabCurvatureHandle(ctx, e.screen);
    if (s.handle) return true;
    const spec = specOf(ctx, s);
    const h = spec ? handleAt(ctx.view, handles(ctx, spec, byPoints(s)), e.screen) : null;
    if (!spec || !h || (byPoints(s) && h.key !== 'rotate')) return false;
    s.drag = { key: h.key, grab: e.world, dx: spec.dx ?? 0, dy: spec.dy ?? 0, angle: spec.angle ?? 0 };
    return true;
  },
  drag(ctx, s, e) {
    if (s.handle) {
      dragCurvatureHandle(ctx, s.handle, e.world);
      return;
    }
    const g = s.drag;
    const pivot = pivotOf(ctx, s);
    if (!g || !pivot) return;
    const delta = sub(e.world, g.grab);
    if (g.key === 'rotate') {
      const centre = add(pivot, { x: g.dx, y: g.dy });
      const from = Math.atan2(g.grab.y - centre.y, g.grab.x - centre.x);
      const to = Math.atan2(e.world.y - centre.y, e.world.x - centre.x);
      s.angle.set(deg(g.angle + to - from));
      return;
    }
    if (g.key !== 'y') s.dx.set(mm(g.dx + delta.x));
    if (g.key !== 'x') s.dy.set(mm(g.dy + delta.y));
  },
  release(ctx, s) {
    if (s.handle) ctx.commit('Drag Curvature Handle', () => undefined, { coalesce: 'curvature-handle' });
    s.handle = null;
    s.drag = null;
  },
  cancel() {
    clearManipulators();
  },
  ok(ctx, s) {
    clearManipulators();
    const spec = specOf(ctx, s);
    if (!spec) return false;
    const still = !spec.dx && !spec.dy && !spec.angle;
    if (still && !spec.copy) return;
    const ids = s.objects.ids();
    let gone: string[] = [];
    const done = ctx.commit(spec.copy ? 'Copy' : 'Move', (c) => {
      const names = new Map(Object.values(c.sketch.dimensions).map((d) => [d.id, d.name]));
      const { removed } = moveCopy(c.design, c.sketch, ids, { ...spec, stretch: true });
      gone = removed.flatMap((id) => names.get(id) ?? []);
      if (!spec.copy) slidePathText(c.sketch, ids, spec);
    });
    // A dimension from what moved to what stayed cannot hold: the move took it, and that is not to go unsaid.
    if (done && gone.length) ctx.message(`Move removed ${gone.length === 1 ? 'dimension' : 'dimensions'} ${gone.join(', ')}, which tied what moved to what stayed.`, 'warn');
  },
});
