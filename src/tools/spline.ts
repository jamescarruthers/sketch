// Fit Point and Control Point splines, and what you can do to a spline afterwards [ref SKT-CREATE-SPLINES]:
// curvature comb, degree, open and close, insert points, tangent handles.
import type { ControlSpline, FitSpline, Id, SplineDegree, Vec2 } from '../model/types';
import {
  addConstraint, addControlSpline, addFitSpline, addPoint, getPointPos, setFitHandle,
} from '../model/document';
import { closestPoint } from '../geom/curves';
import {
  changeDegree, controlSplineEval, curvatureComb, fitSplineEval, localChord, splineEval, tangentHandle, type SplineEval,
} from '../geom/spline';
import { add, dist, dot, lerp, norm, scale, sub } from '../geom/vec';
import { curveEndingAt, endTangent } from '../app/snap';
import { COLORS } from '../render/style';
import type { ContextAction, Overlay, SelectionOptions } from './registry';
import {
  placedAt, previewStroke, type CommitScope, type Hit, type PaletteRow, type Placed, type Tool, type ToolContext, type ToolDef, type ToolPointer,
} from './tool';

const CLOSE_PX = 10;
/** Shortest first leg a tangent drag gives a control spline. */
const MIN_LEG_PX = 30;
const group = 'spline';

/** The two degrees the reference gives icons to; the list has the rest [ref sketch-spline-degree.png]. */
const DEGREE_ICONS = [{ value: '3', label: '3', title: 'Degree 3' }, { value: '5', label: '5', title: 'Degree 5' }];

/** Control point degree for the next spline, kept like the palette would [ref]. */
let degree: SplineDegree = 5;
const DEGREES = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => ({ value: String(d), label: String(d) }));

/** Splines showing the curvature comb. Display state only: nothing here is stored in the design. */
const comb = new Set<Id>();
const combSettings = { density: 60, scale: 1 };

type Spline = FitSpline | ControlSpline;

const isSpline = (c: unknown): c is Spline => {
  const t = (c as { type?: string } | undefined)?.type;
  return t === 'fitSpline' || t === 'controlSpline';
};

// ---------------------------------------------------------------------------
// Creation

interface Tangent { curve: Id; point: Id; dir: Vec2 }

function createSpline(ctx: ToolContext, kind: 'fit' | 'control'): Tool {
  const picks: Placed[] = [];
  let raw: Placed = placedAt({ x: 0, y: 0 });
  let cursor: Placed = raw;
  let tangent: Tangent | null = null;
  let press: { placed: Placed; tangent: Tangent } | null = null;
  let dragged = false;
  let drag: Vec2 | null = null;

  const minPoints = kind === 'fit' ? 2 : 3;

  const prompt = (): void => {
    if (picks.length === 0) {
      ctx.status(kind === 'fit'
        ? 'Click the first point. Press and drag on the end of a curve for a tangent'
        : 'Click the first control point');
    } else {
      ctx.status(kind === 'fit'
        ? 'Click the next point. Click the start point to close, or press Enter to finish'
        : 'Click the next control point. Press Enter or the check to finish');
    }
  };

  /** Closing needs three points and the cursor on the first [ref]. */
  const closing = (): boolean =>
    kind === 'fit' && picks.length >= 3 && ctx.view.toScreen(cursor.pos) && dist(ctx.view.toScreen(cursor.pos), ctx.view.toScreen(picks[0].pos)) < CLOSE_PX;

  const updateCheck = (): void => {
    // The check appears once finishing would make a spline [ref fit-point-spline.gif].
    if (picks.length >= minPoints) {
      const at = ctx.view.toWorld(add(ctx.view.toScreen(picks[picks.length - 1].pos), { x: 22, y: -22 }));
      ctx.hud.check(at, () => finish(false));
    } else ctx.hud.check(null);
  };

  const reset = (): void => {
    picks.length = 0;
    tangent = null;
    press = null;
    dragged = false;
    drag = null;
    ctx.hud.check(null);
    prompt();
    ctx.invalidate();
  };

  const finish = (closed: boolean): void => {
    if (picks.length < minPoints || (closed && picks.length < 3)) {
      ctx.message(kind === 'fit' ? 'A spline needs at least two points' : 'A control point spline needs at least three points', 'warn');
      return;
    }
    const positions = picks.map((p) => p.pos);
    const snapshot = [...picks];
    const start = tangent;
    const done = ctx.commit('Spline', (c) => {
      const spline = kind === 'fit'
        ? addFitSpline(c.design, c.sketch, positions, closed, c.curveOpts)
        : addControlSpline(c.design, c.sketch, positions, degree, c.curveOpts);
      spline.pts.forEach((id, i) => c.infer(id, snapshot[i]));
      if (start) {
        if (spline.type === 'fitSpline') {
          // Without an active handle a fit spline end cannot be steered, so the tangent would be one way.
          setFitHandle(c.design, c.sketch, spline, 0, tangentHandle(positions[0], start.dir, localChord(positions, 0, closed)));
        }
        addConstraint(c.design, c.sketch, 'tangent', [start.curve, spline.id]);
      }
      c.select();
    });
    if (done) reset();
  };

  const evalSpline = (pts: Vec2[], closed: boolean): SplineEval => {
    if (kind === 'control') return controlSplineEval(pts, degree);
    const handles: (Vec2 | null)[] = pts.map(() => null);
    if (tangent) handles[0] = tangentHandle(pts[0], tangent.dir, localChord(pts, 0, closed));
    return fitSplineEval(pts, closed, handles);
  };

  const place = (): void => {
    if (closing()) {
      finish(true);
      return;
    }
    if (picks.some((p) => dist(p.pos, cursor.pos) < 1e-6)) {
      ctx.message('Pick a different point', 'warn');
      return;
    }
    picks.push(cursor);
    prompt();
    updateCheck();
  };

  const tangentAt = (p: Placed): Tangent | null => {
    const inf = p.inference;
    if (inf.kind !== 'point' || !inf.point) return null;
    const curve = curveEndingAt(ctx.sketch, inf.point);
    const dir = curve ? endTangent(ctx.sketch, curve, inf.point) : null;
    return curve && dir ? { curve, point: inf.point, dir: norm(dir) } : null;
  };

  return {
    start() {
      ctx.selection.clear();
      if (kind === 'control') {
        ctx.palette.options([{
          key: 'degree', label: 'Spline Degree', kind: 'select', value: String(degree), quick: DEGREE_ICONS,
          options: DEGREES,
          onChange: (v) => { degree = Number(v) as SplineDegree; },
        }]);
      }
      prompt();
    },
    stop() {
      ctx.hud.check(null);
    },
    snap() {
      return {};
    },
    move(e: ToolPointer) {
      raw = { pos: e.snapped.pos, inference: e.snapped };
      cursor = raw;
      if (picks.length >= 3 && kind === 'fit') {
        const near = dist(e.screen, ctx.view.toScreen(picks[0].pos)) < CLOSE_PX;
        if (near) cursor = picks[0];
      }
      if (press && e.dragging) {
        dragged = true;
        drag = e.world;
      }
    },
    down(e) {
      if (e.button !== 0 || picks.length > 0) return;
      const t = tangentAt({ pos: e.snapped.pos, inference: e.snapped });
      press = t ? { placed: { pos: e.snapped.pos, inference: e.snapped }, tangent: t } : null;
      dragged = false;
    },
    up() {
      if (press && dragged) {
        picks.push(press.placed);
        tangent = press.tangent;
        // A control spline is tangent through its first leg, so the drag sets that leg on the tangent.
        if (kind === 'control' && drag) {
          const leg = Math.max(dot(sub(drag, press.placed.pos), tangent.dir), ctx.view.px(MIN_LEG_PX));
          picks.push(placedAt(add(press.placed.pos, scale(tangent.dir, leg))));
        }
        prompt();
        updateCheck();
      }
      press = null;
      dragged = false;
      drag = null;
    },
    click(e) {
      if (e.button !== 0) return;
      raw = { pos: e.snapped.pos, inference: e.snapped };
      cursor = raw;
      if (picks.length >= 3 && kind === 'fit' && dist(e.screen, ctx.view.toScreen(picks[0].pos)) < CLOSE_PX) cursor = picks[0];
      place();
    },
    enter() {
      if (picks.length === 0) return false;
      if (picks.length < minPoints) {
        reset();
        return true;
      }
      finish(false);
      return true;
    },
    escape() {
      if (picks.length === 0) return false;
      reset();
      return true;
    },
    draw(p) {
      const stroke = previewStroke(ctx.lineType);
      if (press && dragged && drag) {
        p.line(press.placed.pos, add(press.placed.pos, scale(press.tangent.dir, ctx.view.px(60))), { color: COLORS.selected, width: 1.5 });
      }
      if (picks.length === 0) return;
      const shut = closing();
      const pts = picks.map((q) => q.pos);
      if (!shut) pts.push(cursor.pos);
      if (kind === 'control' && pts.length > 1) p.poly(pts, false, { color: COLORS.guide, dash: [4, 3], width: 1 });
      if (pts.length >= 2) {
        const ev = evalSpline(pts, shut);
        const n = Math.max(ev.spans, 1) * 16;
        p.poly(Array.from({ length: n + 1 }, (_, i) => ev.at(ev.closed && i === n ? 0 : i / n)), false, stroke);
      }
      for (const q of picks) p.dot(q.pos, { color: COLORS.preview }, 3);
      if (shut) p.dot(picks[0].pos, { color: COLORS.selected, fill: COLORS.handleFill }, 6);
    },
    docChanged: reset,
  };
}

export const splineFit: ToolDef = {
  meta: { id: 'spline-fit', label: 'Fit Point Spline', panel: 'create', group },
  create: (ctx) => createSpline(ctx, 'fit'),
};

export const splineControl: ToolDef = {
  meta: { id: 'spline-control', label: 'Control Point Spline', panel: 'create', group },
  create: (ctx) => createSpline(ctx, 'control'),
};

export const splineTools: ToolDef[] = [splineFit, splineControl];

// ---------------------------------------------------------------------------
// Editing

const selectedSplines = (ctx: ToolContext): Spline[] =>
  ctx.selection.ids().map((id) => ctx.sketch.curves[id]).filter(isSpline);

/** The spline a hit belongs to: the curve itself, or the one owning the fit point or handle. */
function splineOf(ctx: ToolContext, hit: Hit | null): Spline | null {
  if (!hit) return null;
  if (hit.kind === 'curve') {
    const c = ctx.sketch.curves[hit.id];
    return isSpline(c) ? c : null;
  }
  if (hit.kind === 'point') {
    const owner = ctx.sketch.points[hit.id]?.owner;
    const c = owner ? ctx.sketch.curves[owner] : undefined;
    return isSpline(c) ? c : null;
  }
  return null;
}

const positions = (ctx: { sketch: { points: Record<Id, { x: number; y: number }> } }, ids: Id[]): Vec2[] =>
  ids.map((id) => ({ x: ctx.sketch.points[id].x, y: ctx.sketch.points[id].y }));

/** t of each fit point along the curve: the chord-length parameter the spline is built on. */
function fitParams(pts: Vec2[], closed: boolean): number[] {
  const u = [0];
  const n = pts.length;
  for (let i = 1; i < n; i++) u.push(u[i - 1] + Math.max(dist(pts[i - 1], pts[i]), 1e-9));
  const total = u[n - 1] + (closed ? Math.max(dist(pts[n - 1], pts[0]), 1e-9) : 0);
  return u.map((x) => x / total);
}

function dropPoint(c: { sketch: { points: Record<Id, unknown>; constraints: Record<Id, { refs: Id[] }>; dimensions: Record<Id, { refs: Id[] }> } }, id: Id): void {
  delete c.sketch.points[id];
  for (const [k, v] of Object.entries(c.sketch.constraints)) if (v.refs.includes(id)) delete c.sketch.constraints[k];
  for (const [k, v] of Object.entries(c.sketch.dimensions)) if (v.refs.includes(id)) delete c.sketch.dimensions[k];
}

function setClosed(ctx: ToolContext, spline: FitSpline, closed: boolean): void {
  ctx.commit(closed ? 'Close Spline' : 'Open Spline', (c) => {
    (c.sketch.curves[spline.id] as FitSpline).closed = closed;
  });
}

function insertFitPoint(ctx: ToolContext, spline: FitSpline, at: Vec2): void {
  ctx.commit('Insert Fit Point', (c) => {
    const sp = c.sketch.curves[spline.id] as FitSpline;
    const pts = positions(c, sp.pts);
    const t = closestPoint(c.sketch, sp, at).t;
    const params = fitParams(pts, sp.closed);
    let i = 0;
    while (i + 1 < params.length && params[i + 1] <= t) i++;
    const p = addPoint(c.design, c.sketch, at, { owner: sp.id });
    sp.pts.splice(i + 1, 0, p.id);
    sp.handles.splice(i + 1, 0, null);
  });
}

function insertControlPoint(ctx: ToolContext, spline: ControlSpline, at: Vec2): void {
  ctx.commit('Insert Control Point', (c) => {
    const sp = c.sketch.curves[spline.id] as ControlSpline;
    const pts = positions(c, sp.pts);
    let best = { i: 0, d: Infinity, p: at };
    for (let i = 0; i + 1 < pts.length; i++) {
      const ab = sub(pts[i + 1], pts[i]);
      const l2 = dot(ab, ab);
      const f = l2 < 1e-12 ? 0 : Math.min(1, Math.max(0, dot(sub(at, pts[i]), ab) / l2));
      const q = lerp(pts[i], pts[i + 1], f);
      const d = dist(q, at);
      if (d < best.d) best = { i, d, p: q };
    }
    const p = addPoint(c.design, c.sketch, best.p, { owner: sp.id });
    sp.pts.splice(best.i + 1, 0, p.id);
  });
}

/** A fit point's index when `hit` is one, or the index whose handle `hit` is. */
function fitIndex(spline: FitSpline, id: Id): { index: number; isHandle: boolean } | null {
  const i = spline.pts.indexOf(id);
  if (i >= 0) return { index: i, isHandle: false };
  const h = spline.handles.indexOf(id);
  return h >= 0 ? { index: h, isHandle: true } : null;
}

/** Give a fit point an active tangent handle that keeps the spline's present shape. */
export function ensureFitHandle(c: CommitScope, splineId: Id, index: number): void {
  const sp = c.sketch.curves[splineId] as FitSpline;
  if (sp.handles[index]) return;
  const pts = positions(c, sp.pts);
  const ev = splineEval(sp, c.sketch);
  const dir = norm(ev.d1(fitParams(pts, sp.closed)[index]));
  setFitHandle(c.design, c.sketch, sp, index, tangentHandle(pts[index], dir, localChord(pts, index, sp.closed)));
}

function activateHandle(ctx: ToolContext, spline: FitSpline, index: number): void {
  ctx.commit('Activate Curvature Handle', (c) => ensureFitHandle(c, spline.id, index));
}

function deactivateHandle(ctx: ToolContext, spline: FitSpline, index: number): void {
  ctx.commit('Deactivate Curvature Handle', (c) => {
    const sp = c.sketch.curves[spline.id] as FitSpline;
    const id = sp.handles[index];
    if (!id) return false;
    setFitHandle(c.design, c.sketch, sp, index, null);
    for (const [k, v] of Object.entries(c.sketch.constraints)) if (v.refs.includes(id)) delete c.sketch.constraints[k];
    return true;
  });
}

function toggleComb(ctx: ToolContext, ids: Id[]): void {
  const on = ids.every((id) => comb.has(id));
  for (const id of ids) {
    if (on) comb.delete(id);
    else comb.add(id);
  }
  ctx.invalidate();
}

/** Setup Curvature Display [ref SKT-CREATE-SPLINES]: Density and Scale, live. Cancel puts them back. */
function setupComb(ctx: ToolContext, id: Id): void {
  const was = { ...combSettings };
  comb.add(id);
  let density: { get(): number } | null = null;
  let size: { get(): number } | null = null;
  const d = ctx.dialogs.open({
    title: 'Setup Curvature Display',
    onOk: () => undefined,
    onCancel: () => {
      Object.assign(combSettings, was);
      ctx.invalidate();
    },
    onChange: () => {
      if (density) combSettings.density = density.get();
      if (size) combSettings.scale = size.get();
      ctx.invalidate();
    },
  });
  density = d.slider('Density', combSettings.density, 10, 400, 10);
  size = d.slider('Scale', combSettings.scale, 0.05, 10, 0.05);
  ctx.invalidate();
}

function setDegree(ctx: ToolContext, to: SplineDegree): void {
  const splines = selectedSplines(ctx).filter((s): s is ControlSpline => s.type === 'controlSpline' && s.degree !== to);
  if (!splines.length) return;
  ctx.commit('Change Spline Degree', (c) => {
    for (const s of splines) {
      const sp = c.sketch.curves[s.id] as ControlSpline;
      const next = changeDegree(positions(c, sp.pts), sp.degree, to);
      const first = sp.pts[0];
      const last = sp.pts[sp.pts.length - 1];
      for (const id of sp.pts.slice(1, -1)) dropPoint(c, id);
      const middle = next.slice(1, -1).map((q) => addPoint(c.design, c.sketch, q, { owner: sp.id }).id);
      sp.pts = [first, ...middle, last];
      sp.degree = to;
    }
  });
}

const hasHandleAt = (ctx: ToolContext, hit: Hit | null): { spline: FitSpline; index: number } | null => {
  const s = splineOf(ctx, hit);
  if (!hit || s?.type !== 'fitSpline') return null;
  const found = fitIndex(s, hit.id);
  return found && s.handles[found.index] ? { spline: s, index: found.index } : null;
};

export const SPLINE_CONTEXT_ACTIONS: ContextAction[] = [
  {
    id: 'spline-close', label: 'Close Spline Curve',
    applies(ctx, hit) {
      const s = splineOf(ctx, hit);
      return s?.type === 'fitSpline' && !s.closed && s.pts.length >= 3;
    },
    run: (ctx, hit) => setClosed(ctx, splineOf(ctx, hit) as FitSpline, true),
  },
  {
    id: 'spline-open', label: 'Open Spline Curve',
    applies(ctx, hit) {
      const s = splineOf(ctx, hit);
      return s?.type === 'fitSpline' && s.closed;
    },
    run: (ctx, hit) => setClosed(ctx, splineOf(ctx, hit) as FitSpline, false),
  },
  {
    id: 'spline-insert-fit', label: 'Insert Spline Fit Point',
    applies: (ctx, hit) => hit?.kind === 'curve' && splineOf(ctx, hit)?.type === 'fitSpline',
    run: (ctx, hit) => insertFitPoint(ctx, splineOf(ctx, hit) as FitSpline, (hit as Hit).pos),
  },
  {
    id: 'spline-insert-control', label: 'Insert Spline Control Point',
    applies: (ctx, hit) => hit?.kind === 'curve' && splineOf(ctx, hit)?.type === 'controlSpline',
    run: (ctx, hit) => insertControlPoint(ctx, splineOf(ctx, hit) as ControlSpline, (hit as Hit).pos),
  },
  {
    id: 'spline-comb', label: 'Toggle Curvature Display',
    applies: (ctx, hit) => splineOf(ctx, hit) !== null,
    run: (ctx, hit) => toggleComb(ctx, [(splineOf(ctx, hit) as Spline).id]),
  },
  {
    id: 'spline-comb-setup', label: 'Setup Curvature Display',
    applies: (ctx, hit) => splineOf(ctx, hit) !== null,
    run: (ctx, hit) => setupComb(ctx, (splineOf(ctx, hit) as Spline).id),
  },
  {
    id: 'spline-handle-on', label: 'Activate Curvature Handle',
    applies(ctx, hit) {
      const s = splineOf(ctx, hit);
      if (hit?.kind !== 'point' || s?.type !== 'fitSpline') return false;
      const found = fitIndex(s, hit.id);
      return !!found && !found.isHandle && !s.handles[found.index];
    },
    run(ctx, hit) {
      const s = splineOf(ctx, hit) as FitSpline;
      activateHandle(ctx, s, (fitIndex(s, (hit as Hit).id) as { index: number }).index);
    },
  },
  {
    id: 'spline-handle-off', label: 'Deactivate Curvature Handle',
    applies: (ctx, hit) => hit?.kind === 'point' && hasHandleAt(ctx, hit) !== null,
    run(ctx, hit) {
      const h = hasHandleAt(ctx, hit);
      if (h) deactivateHandle(ctx, h.spline, h.index);
    },
  },
];

export const SPLINE_SELECTION_OPTIONS: SelectionOptions = {
  rows(ctx): PaletteRow[] {
    const splines = selectedSplines(ctx);
    if (!splines.length) return [];
    const rows: PaletteRow[] = [
      {
        key: 'comb', label: 'Curvature Comb', kind: 'checkbox', value: splines.every((s) => comb.has(s.id)),
        onChange: () => toggleComb(ctx, splines.map((s) => s.id)),
      },
      {
        key: 'comb-density', label: 'Comb Density', kind: 'number', value: combSettings.density,
        onChange: (v) => { combSettings.density = Math.min(400, Math.max(10, Math.round(Number(v)))); ctx.invalidate(); },
      },
      {
        key: 'comb-scale', label: 'Comb Scale', kind: 'number', value: combSettings.scale,
        onChange: (v) => { combSettings.scale = Math.max(0.05, Number(v)); ctx.invalidate(); },
      },
    ];
    const control = splines.filter((s): s is ControlSpline => s.type === 'controlSpline');
    if (control.length) {
      const same = control.every((s) => s.degree === control[0].degree);
      rows.push({
        key: 'spline-degree', label: 'Change Spline Degree', kind: 'select', value: same ? String(control[0].degree) : '', quick: DEGREE_ICONS,
        options: DEGREES,
        onChange: (v) => setDegree(ctx, Number(v) as SplineDegree),
      });
    }
    return rows;
  },
};

// ---------------------------------------------------------------------------
// Drawing

/** Getters, so the colours follow the theme at the moment they are drawn. */
const COMB = { get color() { return COLORS.comb; }, width: 1 };

const CURVATURE = { get color() { return COLORS.curvature; }, width: 1.2 };
const GRAB_PX = 9;

/** The handle drawn at a fit point: both ends, whether it is active yet or only shows the tangent. */
interface ShownHandle { spline: Id; index: number; point: Vec2; tip: Vec2; back: Vec2; stored: Id | null }

/** Splines the Move/Copy tool has shown the handles of [ref SKT-CREATE-SPLINES]. */
const manipulated = new Set<Id>();

/** Show or hide a spline's handles from Move/Copy. True when the id was a fit point or handle of one. */
export function toggleManipulators(ctx: ToolContext, point: Id): boolean {
  const c = ctx.sketch.curves[ctx.sketch.points[point]?.owner ?? ''];
  if (c?.type !== 'fitSpline') return false;
  if (!manipulated.delete(c.id)) manipulated.add(c.id);
  ctx.invalidate();
  return true;
}

export const clearManipulators = (): void => manipulated.clear();

/** Selecting a spline or one of its fit points shows the curvature handles [ref SKT-CREATE-SPLINES]. */
function shownHandles(ctx: ToolContext): ShownHandle[] {
  const lit = new Map<Id, FitSpline>();
  for (const id of [...ctx.selection.ids(), ...manipulated]) {
    const c = ctx.sketch.curves[id] ?? ctx.sketch.curves[ctx.sketch.points[id]?.owner ?? ''];
    if (c?.type === 'fitSpline') lit.set(c.id, c);
  }
  const out: ShownHandle[] = [];
  for (const s of lit.values()) {
    const pts = positions(ctx, s.pts);
    const ev = splineEval(s, ctx.sketch);
    const params = fitParams(pts, s.closed);
    pts.forEach((point, index) => {
      const stored = s.handles[index];
      const tip = stored ? getPointPos(ctx.sketch, stored) : tangentHandle(point, norm(ev.d1(params[index])), localChord(pts, index, s.closed));
      out.push({ spline: s.id, index, point, tip, back: sub(scale(point, 2), tip), stored });
    });
  }
  return out;
}

export interface HandleGrab { handle: ShownHandle; end: 1 | -1 }

/** The handle end under the cursor, for Select. */
export function grabCurvatureHandle(ctx: ToolContext, screen: Vec2): HandleGrab | null {
  for (const handle of shownHandles(ctx)) {
    if (dist(ctx.view.toScreen(handle.tip), screen) < GRAB_PX) return { handle, end: 1 };
    if (dist(ctx.view.toScreen(handle.back), screen) < GRAB_PX) return { handle, end: -1 };
  }
  return null;
}

/** One frame of dragging a handle end. An inactive handle activates on the first move. */
export function dragCurvatureHandle(ctx: ToolContext, grab: HandleGrab, world: Vec2): void {
  const { spline, index, point } = grab.handle;
  const sp = ctx.sketch.curves[spline];
  if (sp?.type !== 'fitSpline') return;
  if (!sp.handles[index]) ctx.commit('Activate Curvature Handle', (c) => ensureFitHandle(c, spline, index), { coalesce: 'curvature-handle' });
  const live = ctx.sketch.curves[spline] as FitSpline;
  const id = live.handles[index];
  if (!id) return;
  const target = grab.end > 0 ? world : sub(scale(point, 2), world);
  ctx.solver.drag([{ point: id, x: target.x, y: target.y }], [live.pts[index]]);
}

export const splineOverlay: Overlay = (ctx, p) => {
  for (const h of shownHandles(ctx)) {
    p.line(h.back, h.tip, CURVATURE);
    p.dot(h.tip, { color: CURVATURE.color, fill: COLORS.dotHole }, 3.5);
    p.dot(h.back, { color: CURVATURE.color, fill: COLORS.dotHole }, 3.5);
  }
  for (const s of Object.values(ctx.sketch.curves)) {
    if (!isSpline(s)) continue;
    const selected = ctx.selection.has(s.id);
    if (selected && s.type === 'controlSpline') p.poly(positions(ctx, s.pts), false, { color: COLORS.interiorEdge, width: 1, dash: [4, 3] });
    if (comb.has(s.id)) {
      const teeth = curvatureComb(splineEval(s, ctx.sketch), combSettings.density);
      const tips: Vec2[] = [];
      for (const t of teeth) {
        const tip = add(t.p, scale(sub(t.tip, t.p), combSettings.scale));
        tips.push(tip);
        p.line(t.p, tip, COMB);
      }
      p.poly(tips, false, COMB);
    }
  }
};
