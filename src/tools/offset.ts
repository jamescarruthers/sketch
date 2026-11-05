// Offset [ref SKT-OFFSET]: pick a curve, chain or profile; the mouse picks the side; distance in the
// dialog, optionally limited so the result keeps the source's topology [ref SKT-SKETCH-MODIFY-TOOLS].
import type { Id, Sketch, Vec2 } from '../model/types';
import { drivenReference } from '../model/parameters';
import { findChain, getPointPos } from '../model/document';
import { closestPoint, resolve } from '../geom/curves';
import { EPS_JOIN } from '../geom/tolerance';
import { add, dist, norm, scale, sub } from '../geom/vec';
import { preview } from '../geom/modify';
import {
  addOffsetDimension, computeOffset, ellipseOffsetMode, matchedDistance, matchLimitNote, offsetCurves, offsetSideFromPick,
  type EllipseOffset, type OffsetFeature, type OffsetMode,
} from '../geom/offset';
import { profileAt } from '../geom/profiles';
import { COLORS } from '../render/style';
import type { ExpressionField, Field, SelectionField } from '../ui/dialogs/dialog';
import { defineDialogTool } from './dialog-tool';
import type { ContextAction } from './registry';
import type { Hit, ToolContext, ToolDef, ToolPointer } from './tool';

const DEFAULT_DISTANCE = '5 mm';
const LABEL_GAP_PX = 20;
/** Along the output, off its middle, where the glyph sits. */
const LABEL_AT = 0.3;

interface State {
  curves: SelectionField;
  mode: Field<string>;
  distance: ExpressionField;
  distance2: ExpressionField;
  match: Field<boolean>;
  /** Says what Match Topology did to the distance. */
  limit: HTMLElement;
  /** The limit it stopped at, once the field has been rewritten to it. */
  cutTo: number | null;
  side: 1 | -1;
  /** The stretch of pointer travel on the current side, and how long the one before it lasted. */
  stay: { since: number; before: number; was: 1 | -1 };
  ellipse: EllipseOffset | undefined;
}

const offsettable = (ctx: ToolContext, h: Hit): boolean => {
  const c = ctx.sketch.curves[h.id];
  return h.kind === 'curve' && !!c && c.type !== 'text';
};

const chainOf = (ctx: ToolContext, id: Id): Id[] =>
  findChain(ctx.sketch, id, (a, b) => dist(a, b) < EPS_JOIN).links.map((l) => l.curve).filter(ctx.editable);

const distances = (s: State): { one: number; two: number } | null => {
  const one = s.distance.value();
  const two = s.mode.get() === 'two' ? s.distance2.value() : one;
  return one !== null && two !== null && one > 0 && two > 0 ? { one, two } : null;
};

function makeOffset(design: Parameters<typeof offsetCurves>[0], sketch: Parameters<typeof offsetCurves>[1], s: State, ids: Id[], v: { one: number; two: number }) {
  return offsetCurves(design, sketch, ids, v.one, {
    mode: s.mode.get() as OffsetMode, side: s.side, distance2: v.two, ellipse: s.ellipse, matchTopology: s.match.get(),
  });
}

/** The two distances as Match Topology allows them, each for its own side. */
function limited(ctx: ToolContext, s: State, v: { one: number; two: number }): { one: number; two: number } {
  const ids = s.curves.ids();
  if (!s.match.get() || !ids.length) return v;
  const first = matchedDistance(ctx.sketch, ids, v.one, s.side, { ellipse: s.ellipse });
  const second = s.mode.get() === 'one' ? v.two : matchedDistance(ctx.sketch, ids, v.two, s.side === 1 ? -1 : 1, { ellipse: s.ellipse });
  return { one: first, two: second };
}

/** Show the distance the offset will really have, in the field and in a note under it. */
function showLimit(ctx: ToolContext, s: State, write: boolean): void {
  const v = distances(s);
  const allowed = v ? limited(ctx, s, v) : null;
  const cut = !!v && !!allowed && (allowed.one < v.one || allowed.two < v.two);
  s.limit.style.display = cut ? '' : 'none';
  if (!cut || !allowed || !v) return;
  s.limit.textContent = matchLimitNote(Math.min(allowed.one, allowed.two));
  if (!write) return;
  s.cutTo = Math.min(allowed.one, allowed.two);
  if (allowed.one < v.one) s.distance.set(`${allowed.one} mm`);
  if (allowed.two < v.two && s.mode.get() === 'two') s.distance2.set(`${allowed.two} mm`);
}

/** A label clear of the output's points: beside its middle, on the side away from the source. */
function labelBeside(ctx: ToolContext, sketch: Sketch, f: OffsetFeature): Vec2 {
  const mid = resolve(sketch, sketch.curves[f.outputs[0]]).at(LABEL_AT);
  const from = closestPoint(sketch, sketch.curves[f.sources[0]], mid).p;
  return add(mid, scale(norm(sub(mid, from)), ctx.view.px(LABEL_GAP_PX)));
}

/** Take a pick as the one selection [ref]: its chain, read for side and the ellipse rule. */
function take(ctx: ToolContext, s: State, ids: Id[], pick: Vec2): void {
  s.side = offsetSideFromPick(ctx.sketch, ids, pick);
  s.ellipse = ids.length === 1 && ctx.sketch.curves[ids[0]]?.type === 'ellipse' ? ellipseOffsetMode(ctx.sketch, ids[0], pick) : undefined;
  s.curves.set(ids);
  s.stay = { since: performance.now(), before: 0, was: s.side };
}

/** Follow the pointer, remembering how long it stayed: a quick pass over the curve is not a choice. */
function followSide(s: State, side: 1 | -1): void {
  if (side === s.side) return;
  const now = performance.now();
  s.stay = { since: now, before: now - s.stay.since, was: s.side };
  s.side = side;
}

/** The pointer reached the dialog: if it only crossed the curve on the way there, undo that crossing. */
function settleSide(s: State): void {
  if (performance.now() - s.stay.since < s.stay.before) s.side = s.stay.was;
}

export const offsetTool: ToolDef = defineDialogTool<State>({
  meta: { id: 'offset', label: 'Offset', panel: 'modify', shortcut: 'O' },
  title: 'Offset',
  build(ctx, d) {
    const preselected = ctx.selection.ids().filter((id) => ctx.sketch.curves[id]);
    const curves = d.selection({
      label: 'Curves',
      accept: (h: Hit) => offsettable(ctx, h),
      initial: [...new Set(preselected.flatMap((id) => chainOf(ctx, id)))],
    });
    const mode = d.select('Direction', [
      { value: 'one', label: 'One Side' }, { value: 'two', label: 'Two Sides' }, { value: 'symmetric', label: 'Symmetric' },
    ], 'one');
    const distance = d.expression('Distance', DEFAULT_DISTANCE);
    const distance2 = d.expression('Distance 2', DEFAULT_DISTANCE);
    distance2.row.style.display = 'none';
    const match = d.checkbox('Match Topology', false);
    const limit = d.note('');
    limit.style.display = 'none';
    limit.classList.add('offset-limit');
    ctx.selection.clear();
    const s: State = {
      curves, mode, distance, distance2, match, limit, cutTo: null, side: 1, stay: { since: 0, before: 0, was: 1 }, ellipse: undefined,
    };
    d.root.addEventListener('pointerenter', () => settleSide(s));
    // Not while typing: "8" on the way to "80" is no reason to rewrite the field. Once it is finished.
    for (const f of [distance, distance2]) (f.row.querySelector('input') as HTMLInputElement).addEventListener('change', () => showLimit(ctx, s, true));
    (match.row.querySelector('input') as HTMLInputElement).addEventListener('change', () => showLimit(ctx, s, true));
    return s;
  },
  changed(ctx, s, d) {
    showLimit(ctx, s, false);
    const two = s.mode.get() === 'two';
    s.distance2.row.style.display = two ? '' : 'none';
    (s.distance.row.firstElementChild as HTMLElement).textContent = two ? 'Distance 1' : 'Distance';
    const v = distances(s);
    const driven = drivenReference(ctx.design, s.distance.get()) ?? (two ? drivenReference(ctx.design, s.distance2.get()) : null);
    d.setError(driven ? `An offset cannot reference the Driven dimension ${driven}`
      : s.distance.value() !== null && !v ? 'The distance must be greater than zero' : null);
    if (!v || driven) d.setOkEnabled(false);
  },
  click(ctx, s, e) {
    const hit = ctx.hit(e.screen, { accept: (h) => offsettable(ctx, h), kinds: ['curve'] });
    if (hit) {
      take(ctx, s, chainOf(ctx, hit.id), hit.pos);
      return true;
    }
    const inside = profileAt(ctx.profiles(), e.world);
    if (inside) take(ctx, s, [...new Set(inside.outer.edges.map((x) => x.curve))], e.world);
    return !!inside;
  },
  move(ctx, s, e: ToolPointer) {
    const ids = s.curves.ids();
    if (!ids.length) return;
    followSide(s, offsetSideFromPick(ctx.sketch, ids, e.world));
  },
  preview(p, ctx, s) {
    const ids = s.curves.ids();
    const v = distances(s);
    if (!ids.length || !v) return;
    const { sketch, result } = preview(ctx.design, ctx.sketch, (design, copy) => makeOffset(design, copy, s, ids, v));
    p.curves(sketch, result.result.created.map((id) => sketch.curves[id]).filter((c) => c), { color: COLORS.preview, width: 1.5, dash: [6, 4] });
    // Near an axis the offset stays an ellipse, and the axis it was picked by shows [ref SKT-OFFSET].
    const source = ctx.sketch.curves[ids[0]];
    if (s.ellipse === 'ellipse' && source?.type === 'ellipse') {
      const c = getPointPos(ctx.sketch, source.c);
      for (const id of [source.major, source.minor]) {
        const end = getPointPos(ctx.sketch, id);
        p.line(sub(scale(c, 2), end), end, { color: COLORS.preview, width: 1, dash: [10, 4, 2, 4] });
      }
    }
  },
  ok(ctx, s) {
    const ids = s.curves.ids();
    const v = distances(s);
    if (!v) return false;
    const first = s.distance.get();
    const second = s.distance2.get();
    const mode = s.mode.get();
    const allowed = limited(ctx, s, v);
    if (computeOffset(ctx.sketch, ids, allowed.one, s.side, { ellipse: s.ellipse }).length === 0) {
      ctx.message('That distance is too large: nothing is left of the curve on this side', 'warn');
      return false;
    }
    const done = ctx.commit('Offset', (c) => {
      const { features } = makeOffset(c.design, c.sketch, s, ids, v);
      const dims = features.map((f) => {
        const feature = c.sketch.features[f];
        if (feature?.type !== 'offset' || !feature.dimension) return null;
        const dim = c.sketch.dimensions[feature.dimension];
        dim.label = labelBeside(ctx, c.sketch, feature);
        return dim;
      });
      if (!dims.some((m) => m)) return false;
      // A distance that was cut reads as the limit, not as what was typed.
      if (dims[0] && allowed.one === v.one) dims[0].expression = first;
      if (mode === 'two' && dims[1] && allowed.two === v.two) dims[1].expression = second;
      return true;
    });
    const cut = allowed.one < v.one || allowed.two < v.two ? Math.min(allowed.one, allowed.two) : s.cutTo;
    if (done && cut !== null) ctx.message(matchLimitNote(cut), 'warn');
    return done;
  },
});

/** Restore the dimension of an offset whose dimension was deleted [ref]. */
export const addOffsetDimensionAction: ContextAction = {
  id: 'add-offset-dimension',
  label: 'Add Offset Dimension',
  applies(ctx, hit) {
    const f = hit?.kind === 'feature' ? ctx.sketch.features[hit.id] : undefined;
    return f?.type === 'offset' && !f.dimension;
  },
  run(ctx, hit) {
    const id = (hit as Hit).id;
    ctx.commit('Add Offset Dimension', (c) => {
      const made = addOffsetDimension(c.design, c.sketch, id);
      const f = c.sketch.features[id];
      if (!made || f?.type !== 'offset') return false;
      c.sketch.dimensions[made].label = labelBeside(ctx, c.sketch, f);
      return true;
    });
  },
};
