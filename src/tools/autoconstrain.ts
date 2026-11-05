// AutoConstrain [adapt: docs/SPEC.md section 6]. A session over src/geom/autoconstrain.ts, which is a
// local rules engine: tiles in a dialog, the active result in purple on the canvas through OVERLAYS.
import type { Constraint, Dimension, Id, Sketch, Vec2 } from '../model/types';
import { ORIGIN } from '../model/types';
import { getPointPos, isReservedId, literalExpression } from '../model/document';
import { pointLayer } from '../model/layers';
import {
  applyResult, AUTO_MAX_RESULTS, autoConstrainAvailable, generateResults, type AutoOptions, type AutoResult, type ProposedConstraint,
  type ProposedDimension,
} from '../geom/autoconstrain';
import { dist } from '../geom/vec';
import { drawDimension, layoutDimension } from '../render/dimensions';
import { BADGE, drawBadge, layoutBadges } from '../render/glyphs';
import type { Painter, Preview } from '../render/painter';
import { solveSketch } from '../solver/bridge';
import { renderAutoPanel, type AutoPanelEvents } from '../ui/dialogs/autoconstrain';
import type { Dialog } from '../ui/dialogs/dialog';
import { COLORS } from '../render/style';
import type { Overlay } from './registry';
import type { Hit, Tool, ToolContext, ToolDef } from './tool';

const WIDTH = 330;
const START_COUNT = 3;
const MORE_COUNT = 2;
const GRAB_PX = 11;
/** Long enough to read "Constraining your sketch..." and reach Cancel [ref]. */
const FINISH_DELAY_MS = 350;
const ANGLE_PER_MM = (2 * Math.PI) / 180;

interface Session {
  results: AutoResult[];
  count: number;
  active: string | null;
  /** Slider per tile, 0 to 100. */
  quantity: Map<string, number>;
  modify: boolean;
  tolerance: number;
  datum: Id | undefined;
  pickingDatum: boolean;
  /** Deleted from the preview; goes into `excluded` on Refresh. */
  removed: Set<string>;
  excluded: Set<string>;
  selected: string | null;
}

/** The session the overlay paints. Only one AutoConstrain dialog is ever open. */
let live: Session | null = null;

const keyOf = (p: ProposedConstraint | ProposedDimension): string =>
  ('type' in p ? `c:${p.type}:${p.refs.join(',')}` : `d:${p.kind}:${p.refs.join(',')}:${p.variant ?? 0}`);

/** AutoConstrain works on the active layer: the rest is template geometry it must not tie down. */
function scoped(ctx: ToolContext): Sketch {
  const { sketch, design } = ctx;
  if (design.layers.length < 2) return sketch;
  const curves = Object.fromEntries(Object.entries(sketch.curves).filter(([, c]) => c.layer === design.activeLayer));
  const points = Object.fromEntries(Object.entries(sketch.points).filter(([, p]) => pointLayer(sketch, p) === design.activeLayer));
  const known = (id: Id): boolean => isReservedId(id) || !!curves[id] || !!points[id];
  const keep = <T extends { refs: Id[] }>(group: Record<Id, T>): Record<Id, T> =>
    Object.fromEntries(Object.entries(group).filter(([, k]) => k.refs.every(known)));
  return { ...sketch, curves, points, constraints: keep(sketch.constraints), dimensions: keep(sketch.dimensions), features: {} };
}

const solver: AutoOptions['solve'] = (s) => {
  const r = solveSketch(s, { analyze: true });
  return { ok: r.ok && r.unsatisfied.length === 0, dof: r.dof };
};

function options(s: Session, quantity: number, count: number): AutoOptions {
  return {
    solve: solver, datum: s.datum, quantity, count,
    ...(s.modify ? { tolerance: s.tolerance, angleTolerance: s.tolerance * ANGLE_PER_MM } : {}),
    exclude: (p) => s.excluded.has(keyOf(p)),
  };
}

const activeResult = (s: Session): AutoResult | null => s.results.find((r) => r.id === s.active) ?? null;

const kept = (s: Session, r: AutoResult): AutoResult => ({
  ...r,
  constraints: r.constraints.filter((p) => !s.removed.has(keyOf(p))),
  dimensions: r.dimensions.filter((p) => !s.removed.has(keyOf(p))),
});

function fakeDimension(p: ProposedDimension): Dimension {
  const d: Dimension = {
    id: keyOf(p), kind: p.kind, refs: p.refs, name: '', expression: literalExpression(p.kind, p.value), value: p.value, driving: true, label: p.label,
  };
  if (p.variant !== undefined) d.variant = p.variant;
  return d;
}

interface Item { key: string; at: Vec2 }

/** Where each previewed constraint shows, as glyph badges on a sketch holding only the proposals. */
function badgesFor(sketch: Sketch, view: ToolContext['view'], r: AutoResult): { key: string; type: Parameters<typeof drawBadge>[1]; x: number; y: number }[] {
  const constraints: Record<Id, Constraint> = {};
  for (const p of r.constraints) {
    const key = keyOf(p);
    constraints[key] = { id: key, type: p.type, refs: p.refs };
  }
  return layoutBadges({ ...sketch, constraints, features: {} }, view).map((b) => ({ key: b.constraint, type: b.type, x: b.x, y: b.y }));
}

/** Point-to-point coincidents have no badge [ref], so they preview as a dot. */
const dotsFor = (sketch: Sketch, r: AutoResult): { key: string; at: Vec2 }[] => r.constraints
  .filter((p) => p.type === 'coincident' && p.refs.every((id) => id === ORIGIN || sketch.points[id]))
  .map((p) => ({ key: keyOf(p), at: getPointPos(sketch, p.refs[0]) }));

function itemsOf(ctx: ToolContext, s: Session): Item[] {
  const r = activeResult(s);
  if (!r) return [];
  const shown = kept(s, r);
  const out: Item[] = dotsFor(ctx.sketch, shown);
  for (const b of badgesFor(ctx.sketch, ctx.view, shown)) out.push({ key: b.key, at: ctx.view.toWorld({ x: b.x, y: b.y }) });
  for (const p of shown.dimensions) {
    const l = layoutDimension(ctx.design, ctx.sketch, fakeDimension(p), ctx.view);
    if (l) out.push({ key: keyOf(p), at: l.label });
  }
  return out;
}

export const autoConstrainOverlay: Overlay = (ctx, p: Preview) => {
  const s = live;
  const r = s ? activeResult(s) : null;
  if (!s) return;
  if (s.datum && s.datum !== ORIGIN && ctx.sketch.points[s.datum]) {
    const at = getPointPos(ctx.sketch, s.datum);
    p.dot(at, { color: COLORS.projected, fill: COLORS.projected }, 5);
    p.text({ x: at.x, y: at.y + ctx.view.px(16) }, 'Datum', COLORS.projected);
  }
  if (!r) return;
  const shown = kept(s, r);
  for (const d of shown.dimensions) {
    const l = layoutDimension(ctx.design, ctx.sketch, fakeDimension(d), ctx.view);
    if (l) drawDimension(p as Painter, l, { color: keyOf(d) === s.selected ? COLORS.autoHot : COLORS.projected });
  }
  for (const dot of dotsFor(ctx.sketch, shown)) {
    p.dot(dot.at, { color: dot.key === s.selected ? COLORS.autoHot : COLORS.projected, fill: dot.key === s.selected ? COLORS.autoHot : COLORS.projected }, 4);
  }
  p.raw((g) => {
    for (const b of badgesFor(ctx.sketch, ctx.view, shown)) {
      drawBadge(g, b.type, b.x, b.y, 'idle');
      g.strokeStyle = b.key === s.selected ? COLORS.autoHot : COLORS.projected;
      g.lineWidth = b.key === s.selected ? 2 : 1.25;
      g.setLineDash([]);
      g.beginPath();
      g.roundRect(Math.round(b.x) - BADGE / 2 + 0.5, Math.round(b.y) - BADGE / 2 + 0.5, BADGE - 1, BADGE - 1, 2.5);
      g.stroke();
    }
  });
};

function availability(ctx: ToolContext): string | null {
  if (!ctx.sketch) return 'Open a sketch first';
  return autoConstrainAvailable(scoped(ctx)).reason ?? null;
}

function createAutoConstrain(ctx: ToolContext, fromDatum: boolean): Tool {
  const s: Session = {
    results: [], count: START_COUNT, active: null, quantity: new Map(), modify: false, tolerance: 1, datum: undefined,
    pickingDatum: fromDatum, removed: new Set(), excluded: new Set(), selected: null,
  };
  let dialog: Dialog | null = null;
  const panel = document.createElement('div');
  panel.className = 'auto-panel';

  const datumName = (): string | null => (s.datum ? (s.datum === ORIGIN ? 'Origin' : `Point ${s.datum}`) : null);

  const draw = (): void => {
    renderAutoPanel(panel, {
      results: s.results,
      added: (r) => {
        const k = kept(s, r);
        return { constraints: k.constraints.length, dimensions: k.dimensions.length };
      },
      active: s.active,
      quantity: s.active ? s.quantity.get(s.active) ?? 100 : 100,
      modify: s.modify,
      tolerance: s.tolerance,
      canGenerateMore: s.count < AUTO_MAX_RESULTS,
      stale: s.removed.size > 0,
      pickingDatum: s.pickingDatum,
      datumName: datumName(),
    }, events);
    dialog?.setOkEnabled(s.active !== null && !s.pickingDatum);
    ctx.invalidate();
  };

  const generate = (keep = true): void => {
    const wanted = s.active;
    s.removed.clear();
    s.selected = null;
    const all = generateResults(scoped(ctx), options(s, 1, s.count));
    s.results = all.map((r) => {
      const q = s.quantity.get(r.id);
      return q === undefined || q === 100 ? r : generateResults(scoped(ctx), options(s, q / 100, s.count)).find((x) => x.id === r.id) ?? r;
    });
    s.active = (keep && s.results.find((r) => r.id === wanted)?.id) || s.results[0]?.id || null;
    draw();
  };

  const events: AutoPanelEvents = {
    choose(id) {
      s.active = id;
      s.selected = null;
      s.removed.clear();
      draw();
    },
    setQuantity(value) {
      if (s.active) s.quantity.set(s.active, value);
      generate();
    },
    setModify(on) {
      s.modify = on;
      generate();
    },
    setTolerance(mm) {
      s.tolerance = mm;
      generate();
    },
    generateMore() {
      s.count += MORE_COUNT;
      generate();
    },
    refresh() {
      for (const k of s.removed) s.excluded.add(k);
      generate();
    },
    startOver() {
      s.removed.clear();
      s.excluded.clear();
      s.quantity.clear();
      generate(false);
    },
    setDatum() {
      s.pickingDatum = true;
      ctx.status('Select a point in the canvas to place the datum');
      draw();
    },
  };

  const pickPoint = (screen: Vec2): Hit | null => ctx.hit(screen, { kinds: ['point'], reserved: true });

  const itemAt = (screen: Vec2): string | null => {
    let best: string | null = null;
    let bestD = GRAB_PX;
    for (const it of itemsOf(ctx, s)) {
      const d = dist(ctx.view.toScreen(it.at), screen);
      if (d < bestD) {
        best = it.key;
        bestD = d;
      }
    }
    return best;
  };

  /** Delete is a global command on the document's selection; a preview item is neither. */
  const onKey = (e: KeyboardEvent): void => {
    if (!s.selected || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.stopPropagation();
    e.preventDefault();
    s.removed.add(s.selected);
    s.selected = null;
    draw();
  };

  return {
    start() {
      live = s;
      window.addEventListener('keydown', onKey, true);
      const held = ctx.selection.ids();
      if (held.length === 1 && (held[0] === ORIGIN || ctx.sketch.points[held[0]])) s.datum = held[0];
      ctx.selection.clear();
      const d = ctx.dialogs.open({
        title: 'AutoConstrain',
        width: WIDTH,
        onOk: () => {
          const r = activeResult(s);
          if (!r) return false;
          const chosen = kept(s, r);
          ctx.commit('AutoConstrain', (c) => { applyResult(c.design, c.sketch, chosen); });
          return true;
        },
        onClose: () => {
          if (dialog) {
            dialog = null;
            ctx.end();
          }
        },
      });
      dialog = d;
      d.custom(panel);
      if (s.pickingDatum) {
        ctx.status('Select a point in the canvas to place the datum');
        draw();
      } else {
        ctx.status('Review the results, then OK');
        generate(false);
      }
    },
    stop() {
      live = null;
      window.removeEventListener('keydown', onKey, true);
      ctx.setHover(null);
      const d = dialog;
      dialog = null;
      d?.close();
    },
    move(e) {
      ctx.setHover(s.pickingDatum ? pickPoint(e.screen) : null);
    },
    click(e) {
      if (s.pickingDatum) {
        const hit = pickPoint(e.screen);
        if (!hit) return;
        s.datum = hit.id;
        s.pickingDatum = false;
        ctx.setHover(null);
        ctx.status('Review the results, then OK');
        generate();
        return;
      }
      s.selected = itemAt(e.screen);
      ctx.invalidate();
    },
    docChanged() {
      if (!s.pickingDatum) generate();
    },
  };
}

function createFinish(ctx: ToolContext): Tool {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dialog: Dialog | null = null;

  const run = (): void => {
    timer = null;
    let applied = false;
    try {
      const best = generateResults(scoped(ctx), {
        solve: solver,
        datum: undefined,
        count: START_COUNT,
      })[0];
      applied = !!best && ctx.commit('Finish with AutoConstrain', (c) => { applyResult(c.design, c.sketch, best); });
    } catch (e) {
      console.warn('AutoConstrain:', e);
    }
    dialog?.close();
    ctx.finishSketch();
    if (!applied) ctx.message('Constraints and dimensions were not applied', 'warn');
  };

  return {
    start() {
      const d = ctx.dialogs.open({
        title: 'Finish with AutoConstrain',
        onOk: () => false,
        onCancel: () => {
          if (timer) clearTimeout(timer);
          timer = null;
          ctx.finishSketch();
        },
      });
      dialog = d;
      d.note('Constraining your sketch...');
      (d.root.querySelector('.btn.primary') as HTMLElement).style.display = 'none';
      timer = setTimeout(run, FINISH_DELAY_MS);
    },
    stop() {
      if (timer) clearTimeout(timer);
      const d = dialog;
      dialog = null;
      d?.close();
    },
  };
}

export const autoConstrainTools: ToolDef[] = [
  {
    meta: { id: 'autoconstrain', label: 'AutoConstrain', panel: 'constraints', disabled: availability },
    create: (ctx) => createAutoConstrain(ctx, false),
  },
  {
    meta: { id: 'autoconstrain-datum', label: 'AutoConstrain From Datum', panel: 'constraints', disabled: availability },
    create: (ctx) => createAutoConstrain(ctx, true),
  },
  {
    meta: { id: 'finish-autoconstrain', label: 'Finish with AutoConstrain', panel: 'constraints', icon: 'finish-sketch', disabled: availability, repeatable: false },
    create: createFinish,
  },
];
