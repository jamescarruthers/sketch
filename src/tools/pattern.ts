// Rectangular and Circular Pattern [ref SKT-CREATE-RECTANGULAR-PATTERN, SKT-CREATE-CIRCULAR-PATTERN].
// One dialog per kind; canvas handles drive the same fields, and double-clicking the glyph re-opens it.
import type { Id, Vec2 } from '../model/types';
import { getPointPos } from '../model/document';
import { lineOf } from '../geom/curves';
import {
  circPattern, circPatternSlots, patternPreview, rectPattern, rectPatternSlots, updatePattern,
  type CircPatternFeature, type CircPatternParams, type RectPatternFeature, type RectPatternParams,
} from '../geom/modify';
import {
  add, dist, dot, norm, perp, rotateAbout, scale, sub, TAU, wrapAngle,
} from '../geom/vec';
import { COLORS } from '../render/style';
import type { Dialog, ExpressionField, Field, SelectionField } from '../ui/dialogs/dialog';
import { defineDialogTool } from './dialog-tool';
import { boundsOf, centreOf, drawHandles, handleAt, type Handle } from './manipulator';
import type { DoubleClickHandler } from './registry';
import type { Hit, Preview, ToolContext, ToolDef, ToolPointer } from './tool';

const QUANTITY_STEP_PX = 26;
const BOX_PX = 13;
const BOX_OFFSET_PX = 16;
const DEFAULT_QUANTITY = 3;

interface Common {
  objects: SelectionField;
  quantity: Field<number>;
  suppress: Field<boolean>;
  /** Instance keys the user unticked. */
  off: string[];
  /** The feature being edited, when opened from its glyph. */
  editing: Id | null;
  /** Instances of that feature, which are not valid Objects for it. */
  instances: Set<Id>;
}

interface RectState extends Common {
  dir1: SelectionField;
  dir2: SelectionField;
  type: Field<string>;
  quantity2: Field<number>;
  distance: ExpressionField;
  distance2: ExpressionField;
  way: Field<string>;
  way2: Field<string>;
  /** Direction when no line is picked, or as stored on the feature. */
  base: [Vec2, Vec2];
  /** A drag past the source flips the direction. */
  sign: [1 | -1, 1 | -1];
  /** The distance fields have not been typed in, so they follow the selection's size. */
  autoDistance: boolean;
  drag: { key: string; grab: Vec2; quantity: number } | null;
}

interface CircState extends Common {
  center: SelectionField;
  spacing: Field<string>;
  angle: ExpressionField;
  drag: { key: string; grab: Vec2; quantity: number } | null;
}

const validObject = (ctx: ToolContext, s: { instances: Set<Id> }, h: Hit): boolean => {
  if (h.kind === 'point') return !!ctx.sketch.points[h.id]?.explicit;
  const c = ctx.sketch.curves[h.id];
  return h.kind === 'curve' && !!c && c.type !== 'text' && !(c.type === 'line' && c.frameOf) && !c.derivedFrom && !s.instances.has(h.id);
};

const isLine = (ctx: ToolContext, h: Hit): boolean => h.kind === 'curve' && lineOf(ctx.sketch, h.id) !== null;

/** Centre of the objects, where handles and instance boxes hang from. */
function anchorOf(ctx: ToolContext, ids: Id[]): Vec2 | null {
  const box = boundsOf(ctx.sketch, ids);
  return box && centreOf(box);
}

function sizeOf(ctx: ToolContext, ids: Id[]): number {
  const box = boundsOf(ctx.sketch, ids);
  return box ? Math.max(box.maxX - box.minX, box.maxY - box.minY) : 0;
}

const count = (f: Field<number>): number => Math.max(1, Math.round(f.get()) || 1);
const mm = (v: number): string => `${Number(v.toFixed(4))} mm`;

function boxesFor(ctx: ToolContext, slots: { key: string; at: Vec2 }[]): { key: string; at: Vec2 }[] {
  const off = ctx.view.px(BOX_OFFSET_PX);
  return slots.map((s) => ({ key: s.key, at: add(s.at, { x: off, y: off }) }));
}

function drawBoxes(p: Preview, boxes: { key: string; at: Vec2 }[], off: string[]): void {
  p.raw((g) => {
    g.setLineDash([]);
    for (const b of boxes) {
      const s = p.view.toScreen(b.at);
      g.fillStyle = COLORS.dotHole;
      g.strokeStyle = COLORS.badgeInk;
      g.lineWidth = 1;
      g.beginPath();
      g.rect(Math.round(s.x - BOX_PX / 2) + 0.5, Math.round(s.y - BOX_PX / 2) + 0.5, BOX_PX, BOX_PX);
      g.fill();
      g.stroke();
      if (off.includes(b.key)) continue;
      g.strokeStyle = COLORS.free;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(s.x - 3.5, s.y);
      g.lineTo(s.x - 1, s.y + 3);
      g.lineTo(s.x + 4, s.y - 3.5);
      g.stroke();
    }
  });
}

/** Toggle the instance box under a click. True when there was one. */
function clickBox(ctx: ToolContext, s: Common, boxes: { key: string; at: Vec2 }[], e: ToolPointer): boolean {
  if (!s.suppress.get()) return false;
  const hit = boxes.find((b) => {
    const q = ctx.view.toScreen(b.at);
    return Math.abs(q.x - e.screen.x) <= BOX_PX / 2 + 2 && Math.abs(q.y - e.screen.y) <= BOX_PX / 2 + 2;
  });
  if (!hit) return false;
  s.off = s.off.includes(hit.key) ? s.off.filter((k) => k !== hit.key) : [...s.off, hit.key];
  ctx.invalidate();
  return true;
}

const drawPolys = (p: Preview, polys: Vec2[][]): void => {
  for (const poly of polys) p.poly(poly, false, { color: COLORS.preview, width: 1.5, dash: [6, 4] });
};

// ---------------------------------------------------------------------------
// Rectangular

const directionOf = (ctx: ToolContext, s: RectState, i: 0 | 1): Vec2 => {
  const field = i === 0 ? s.dir1 : s.dir2;
  const [id] = field.ids();
  const line = id ? lineOf(ctx.sketch, id) : null;
  return scale(norm(line ? line.d : s.base[i]), s.sign[i]);
};

function rectParams(ctx: ToolContext, s: RectState): RectPatternParams | null {
  const d1 = s.distance.value();
  const d2 = s.distance2.value();
  if (d1 === null || d2 === null || d1 <= 0 || d2 <= 0) return null;
  return {
    sources: s.objects.ids(),
    dirs: [directionOf(ctx, s, 0), directionOf(ctx, s, 1)],
    distanceType: s.type.get() as 'extent' | 'spacing',
    quantity: [count(s.quantity), count(s.quantity2)],
    distance: [d1, d2],
    direction: [s.way.get() as 'one' | 'symmetric', s.way2.get() as 'one' | 'symmetric'],
    suppressed: s.suppress.get() ? s.off : [],
  };
}

/** How far the last instance sits from the source along a direction. */
const reachOf = (p: RectPatternParams, i: 0 | 1): number =>
  (p.distanceType === 'spacing' ? p.distance[i] * Math.max(p.quantity[i] - 1, 1) : p.distance[i]);

function rectHandles(ctx: ToolContext, p: RectPatternParams): Handle[] {
  const anchor = anchorOf(ctx, p.sources);
  if (!anchor) return [];
  const out: Handle[] = [];
  const gap = ctx.view.px(20);
  ([0, 1] as const).forEach((i) => {
    const u = p.dirs[i] as Vec2;
    const key = i === 0 ? '1' : '2';
    const reach = reachOf(p, i);
    const single = p.quantity[i] === 1;
    if (!single) out.push({ key: `d${key}`, at: add(anchor, scale(u, reach)), shape: 'arrow', dir: u });
    const along = single ? ctx.view.px(46) : reach / 2;
    out.push({ key: `q${key}`, at: add(add(anchor, scale(u, along)), scale(perp(u), -gap)), shape: 'grip', tip: `${p.quantity[i]}` });
  });
  return out;
}

const rectBoxes = (ctx: ToolContext, p: RectPatternParams): { key: string; at: Vec2 }[] => {
  const anchor = anchorOf(ctx, p.sources);
  if (!anchor) return [];
  return boxesFor(ctx, rectPatternSlots({ ...p, suppressed: [] }).map((slot) => ({ key: slot.key, at: add(anchor, { x: slot.dx, y: slot.dy }) })));
};

function followSize(ctx: ToolContext, s: RectState): void {
  if (!s.autoDistance) return;
  const size = sizeOf(ctx, s.objects.ids());
  if (size <= 0) return;
  const value = mm(size * 2);
  s.distance.set(value);
  s.distance2.set(value);
}

export const rectPatternTool: ToolDef = defineDialogTool<RectState>({
  meta: { id: 'pattern-rect', label: 'Rectangular Pattern', panel: 'create' },
  title: 'Rectangular Pattern',
  width: 340,
  build(ctx, d, arg) {
    const f = typeof arg === 'string' ? (ctx.sketch.features[arg] as RectPatternFeature | undefined) : undefined;
    const state = { instances: new Set(f ? Object.values(f.instances).flat() : []) };
    const objects = d.selection({
      label: 'Objects', prompt: 'Select sketch curves to pattern', accept: (h: Hit) => validObject(ctx, state, h),
      initial: f?.sources ?? ctx.selection.ids().filter((id) => ctx.sketch.curves[id]),
    });
    const dir1 = d.selection({ label: 'Direction 1', prompt: 'Select a line for the direction', accept: (h: Hit) => isLine(ctx, h), multiple: false, min: 0 });
    const dir2 = d.selection({ label: 'Direction 2', prompt: 'Select a line for the second direction', accept: (h: Hit) => isLine(ctx, h), multiple: false, min: 0 });
    const type = d.select('Distance Type', [{ value: 'extent', label: 'Extent' }, { value: 'spacing', label: 'Spacing' }], f?.distanceType ?? 'extent');
    d.section('Direction 1');
    const quantity = d.number('Quantity', f?.quantity[0] ?? DEFAULT_QUANTITY, { min: 1, step: 1 });
    const distance = d.expression('Distance', mm(f?.distance[0] ?? 40));
    const way = d.select('Direction Type', [{ value: 'one', label: 'One Direction' }, { value: 'symmetric', label: 'Symmetric' }], f?.direction[0] ?? 'one');
    d.section('Direction 2');
    const quantity2 = d.number('Quantity', f?.quantity[1] ?? 1, { min: 1, step: 1 });
    const distance2 = d.expression('Distance', mm(f?.distance[1] ?? 40));
    const way2 = d.select('Direction Type', [{ value: 'one', label: 'One Direction' }, { value: 'symmetric', label: 'Symmetric' }], f?.direction[1] ?? 'one');
    const suppress = d.checkbox('Suppress', true);
    ctx.selection.clear();
    const s: RectState = {
      ...state, editing: f?.id ?? null, objects, dir1, dir2, type, quantity, quantity2, distance, distance2, way, way2, suppress,
      off: f ? [...f.suppressed] : [], base: [f?.dirs[0] ?? { x: 1, y: 0 }, f?.dirs[1] ?? { x: 0, y: 1 }], sign: [1, 1],
      autoDistance: !f, drag: null,
    };
    followSize(ctx, s);
    const typed = (): void => { s.autoDistance = false; };
    // Capture, to run before the field's own handler reaches `changed`.
    for (const field of [distance, distance2]) (field.row.querySelector('input') as HTMLInputElement).addEventListener('input', typed, { capture: true });
    return s;
  },
  changed(ctx, s, d) {
    followSize(ctx, s);
    const p = rectParams(ctx, s);
    d.setError(!p && s.distance.value() !== null ? 'The distance must be greater than zero' : null);
    if (!p) d.setOkEnabled(false);
  },
  click(ctx, s, e) {
    const p = rectParams(ctx, s);
    return !!p && clickBox(ctx, s, rectBoxes(ctx, p), e);
  },
  press(ctx, s, e) {
    const p = rectParams(ctx, s);
    const h = p ? handleAt(ctx.view, rectHandles(ctx, p), e.screen) : null;
    if (!p || !h) return false;
    s.autoDistance = false;
    s.drag = { key: h.key, grab: e.world, quantity: p.quantity[h.key.endsWith('2') ? 1 : 0] };
    return true;
  },
  drag(ctx, s, e) {
    const p = rectParams(ctx, s);
    const g = s.drag;
    const anchor = p ? anchorOf(ctx, p.sources) : null;
    if (!p || !g || !anchor) return;
    const i = g.key.endsWith('2') ? 1 : 0;
    const u = p.dirs[i] as Vec2;
    const field = i === 0 ? s.quantity : s.quantity2;
    if (g.key.startsWith('q')) {
      const steps = Math.round((dot(sub(e.world, g.grab), u) * ctx.view.ppm) / QUANTITY_STEP_PX);
      field.set(Math.max(1, g.quantity + steps));
      return;
    }
    const along = dot(sub(e.world, anchor), u);
    if (along < 0) s.sign[i] = s.sign[i] === 1 ? -1 : 1;
    const reach = Math.max(Math.abs(along), ctx.view.px(4));
    const value = p.distanceType === 'spacing' ? reach / Math.max(p.quantity[i] - 1, 1) : reach;
    (i === 0 ? s.distance : s.distance2).set(mm(value));
  },
  release(_ctx, s) {
    s.drag = null;
  },
  preview(pv, ctx, s) {
    const p = rectParams(ctx, s);
    if (!p || !p.sources.length) return;
    drawPolys(pv, patternPreview(ctx.sketch, p));
    drawHandles(pv, rectHandles(ctx, p), s.drag?.key ?? null);
    if (s.suppress.get()) drawBoxes(pv, rectBoxes(ctx, p), s.off);
  },
  ok(ctx, s) {
    const p = rectParams(ctx, s);
    if (!p) return false;
    const { editing } = s;
    return ctx.commit(editing ? 'Edit Pattern' : 'Rectangular Pattern', (c) => {
      if (editing) updatePattern(c.design, c.sketch, editing, p);
      else rectPattern(c.design, c.sketch, p);
    });
  },
});

// ---------------------------------------------------------------------------
// Circular

function circParams(s: CircState): CircPatternParams | null {
  const [center] = s.center.ids();
  const spacing = s.spacing.get() as CircPatternParams['spacing'];
  const angle = spacing === 'full' ? TAU : s.angle.value();
  if (!center || angle === null || angle <= 0) return null;
  return { sources: s.objects.ids(), center, spacing, angle, quantity: count(s.quantity), suppressed: s.suppress.get() ? s.off : [] };
}

function circHandles(ctx: ToolContext, p: CircPatternParams): Handle[] {
  const anchor = anchorOf(ctx, p.sources);
  if (!anchor) return [];
  const c = getPointPos(ctx.sketch, p.center);
  const out: Handle[] = [];
  if (p.spacing !== 'full') {
    out.push({ key: 'angle', at: rotateAbout(anchor, c, p.spacing === 'symmetric' ? p.angle / 2 : p.angle), shape: 'ring' });
  }
  const radial = dist(anchor, c) > 1e-9 ? norm(sub(anchor, c)) : { x: 1, y: 0 };
  out.push({ key: 'q', at: add(anchor, scale(radial, ctx.view.px(34))), shape: 'grip', tip: `${p.quantity}` });
  return out;
}

const circBoxes = (ctx: ToolContext, p: CircPatternParams): { key: string; at: Vec2 }[] => {
  const anchor = anchorOf(ctx, p.sources);
  if (!anchor) return [];
  const c = getPointPos(ctx.sketch, p.center);
  return boxesFor(ctx, circPatternSlots({ ...p, suppressed: [] }).map((slot) => ({ key: slot.key, at: rotateAbout(anchor, c, slot.angle) })));
};

export const circPatternTool: ToolDef = defineDialogTool<CircState>({
  meta: { id: 'pattern-circ', label: 'Circular Pattern', panel: 'create' },
  title: 'Circular Pattern',
  build(ctx, d, arg) {
    const f = typeof arg === 'string' ? (ctx.sketch.features[arg] as CircPatternFeature | undefined) : undefined;
    const state = { instances: new Set(f ? Object.values(f.instances).flat() : []) };
    const objects = d.selection({
      label: 'Objects', prompt: 'Select sketch curves to pattern', accept: (h: Hit) => validObject(ctx, state, h),
      initial: f?.sources ?? ctx.selection.ids().filter((id) => ctx.sketch.curves[id]),
    });
    const center = d.selection({ label: 'Center Point', prompt: 'Click to select sketch point or circular arc', accept: (h: Hit) => h.kind === 'point', multiple: false, initial: f ? [f.center] : [] });
    const spacing = d.select('Angular Spacing', [
      { value: 'full', label: 'Full' }, { value: 'angle', label: 'Angle' }, { value: 'symmetric', label: 'Symmetric' },
    ], f?.spacing ?? 'full');
    const angle = d.expression('Total Angle', `${Number((((f?.angle ?? Math.PI) * 180) / Math.PI).toFixed(4))} deg`, 'angle');
    const quantity = d.number('Quantity', f?.quantity ?? DEFAULT_QUANTITY, { min: 1, step: 1 });
    const suppress = d.checkbox('Suppress', true);
    if (objects.ids().length && !center.ids().length) center.activate();
    ctx.selection.clear();
    return { ...state, editing: f?.id ?? null, objects, center, spacing, angle, quantity, suppress, off: f ? [...f.suppressed] : [], drag: null };
  },
  changed(_ctx, s, d: Dialog) {
    s.angle.row.style.display = s.spacing.get() === 'full' ? 'none' : '';
    const p = circParams(s);
    if (!p) d.setOkEnabled(false);
  },
  click(ctx, s, e) {
    const p = circParams(s);
    return !!p && clickBox(ctx, s, circBoxes(ctx, p), e);
  },
  press(ctx, s, e) {
    const p = circParams(s);
    const h = p ? handleAt(ctx.view, circHandles(ctx, p), e.screen) : null;
    if (!p || !h) return false;
    s.drag = { key: h.key, grab: e.world, quantity: p.quantity };
    return true;
  },
  drag(ctx, s, e) {
    const p = circParams(s);
    const g = s.drag;
    const anchor = p ? anchorOf(ctx, p.sources) : null;
    if (!p || !g || !anchor) return;
    const c = getPointPos(ctx.sketch, p.center);
    if (g.key === 'q') {
      const radial = norm(sub(anchor, c));
      const steps = Math.round((dot(sub(e.world, g.grab), radial) * ctx.view.ppm) / QUANTITY_STEP_PX);
      s.quantity.set(Math.max(1, g.quantity + steps));
      return;
    }
    const swept = wrapAngle(Math.atan2(e.world.y - c.y, e.world.x - c.x) - Math.atan2(anchor.y - c.y, anchor.x - c.x));
    const total = Math.max(0.01, s.spacing.get() === 'symmetric' ? Math.min(swept * 2, TAU) : swept);
    s.angle.set(`${Number(((total * 180) / Math.PI).toFixed(3))} deg`);
  },
  release(_ctx, s) {
    s.drag = null;
  },
  preview(pv, ctx, s) {
    const p = circParams(s);
    if (!p || !p.sources.length) return;
    drawPolys(pv, patternPreview(ctx.sketch, p));
    drawHandles(pv, circHandles(ctx, p), s.drag?.key ?? null);
    if (s.suppress.get()) drawBoxes(pv, circBoxes(ctx, p), s.off);
  },
  ok(ctx, s) {
    const p = circParams(s);
    if (!p) return false;
    const { editing } = s;
    return ctx.commit(editing ? 'Edit Pattern' : 'Circular Pattern', (c) => {
      if (editing) updatePattern(c.design, c.sketch, editing, p);
      else circPattern(c.design, c.sketch, p);
    });
  },
});

export const patternTools: ToolDef[] = [rectPatternTool, circPatternTool];

/** Double-click a pattern's glyph to edit it [ref]. */
export const editPatternOnGlyph: DoubleClickHandler = {
  applies(ctx, hit) {
    const t = hit.kind === 'feature' ? ctx.sketch.features[hit.id]?.type : undefined;
    return t === 'rectPattern' || t === 'circPattern';
  },
  run(ctx, hit) {
    ctx.activate(ctx.sketch.features[hit.id].type === 'rectPattern' ? 'pattern-rect' : 'pattern-circ', hit.id);
  },
};

