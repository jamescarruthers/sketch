// Sketch Dimension [ref SKT-CREATE-DIMENSIONS]: pick, move off, click to place, type, Enter.
import type { Dimension, DimensionKind, Id, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y } from '../model/types';
import { addDimension, coincidentClasses, getPointPos, literalExpression, nextDimensionName } from '../model/document';
import { drivenReference, measureDimension } from '../model/parameters';
import { lineOf } from '../geom/curves';
import { cross, dist, dot, norm, scale, sub, wrapAngle } from '../geom/vec';
import { pointsOf } from './constraint-tool';
import { type Hit, type MenuItem, type Tool, type ToolContext, type ToolDef, type ToolPointer } from './tool';

interface Candidate { kind: DimensionKind; refs: Id[]; variant?: number }

type LinearOverride = 'auto' | 'aligned' | 'horizontal' | 'vertical';
const isRoundCurve = (c: { type: string } | undefined): boolean => c?.type === 'circle' || c?.type === 'arc';

const PARALLEL_TOL = 1e-3;
/** A line this close to an axis (mm of run) has only its length to measure. */
const AXIS_ALIGNED = 1e-3;

function createDimension(ctx: ToolContext): Tool {
  let picks: Hit[] = [];
  let cursor: Vec2 = { x: 0, y: 0 };
  let driven = false;
  let linear: LinearOverride = 'auto';
  let roundKind: 'radius' | 'diameter' | null = null;
  /** Pick Circle/Arc Tangent: measure from the rim, not the centre [ref SKT-CREATE-DIMENSIONS]. */
  let toRim = false;
  let editing = false;
  /** Where the label went once placed; the preview stops following the cursor. */
  let label: Vec2 | null = null;

  const prompt = (): void => {
    if (editing) ctx.status('Type a value or expression, then press Enter');
    else if (picks.length === 0) ctx.status('Select a line, two points, two lines, a circle or an arc');
    else ctx.status('Click to place the dimension, or select a second object');
  };

  const reset = (): void => {
    picks = [];
    driven = false;
    linear = 'auto';
    roundKind = null;
    toRim = false;
    editing = false;
    label = null;
    ctx.selection.clear();
    ctx.invalidate();
    prompt();
  };

  /** A circle or arc in a two-object pick stands for its centre [ref: Pick Circle/Arc Center]. */
  const asPoint = (h: Hit): Id | null => {
    if (h.kind === 'point') return h.id;
    const c = ctx.sketch.curves[h.id];
    return c?.type === 'circle' || c?.type === 'arc' ? c.c : null;
  };
  const isLineRef = (h: Hit): boolean => h.id === AXIS_X || h.id === AXIS_Y || ctx.sketch.curves[h.id]?.type === 'line';

  const pointPair = (p: Id, q: Id): Candidate => {
    const a = getPointPos(ctx.sketch, p);
    const b = getPointPos(ctx.sketch, q);
    let mode = linear;
    if (mode === 'auto') {
      const insideX = cursor.x >= Math.min(a.x, b.x) && cursor.x <= Math.max(a.x, b.x);
      const insideY = cursor.y >= Math.min(a.y, b.y) && cursor.y <= Math.max(a.y, b.y);
      if (insideX && !insideY) mode = 'horizontal';
      else if (insideY && !insideX) mode = 'vertical';
      else mode = 'aligned';
    }
    return { kind: mode === 'aligned' ? 'distance' : mode, refs: [p, q] };
  };

  const candidate = (): Candidate | null => {
    const [a, b] = picks;
    if (!a) return null;
    const { sketch } = ctx;
    if (!b) {
      if (a.kind !== 'curve') return null;
      const c = sketch.curves[a.id];
      if (c?.type === 'line') {
        const d = sub(getPointPos(sketch, c.b), getPointPos(sketch, c.a));
        // A slanted line offers its horizontal and vertical extent too, by where the mouse goes [ref].
        const slanted = Math.abs(d.x) > AXIS_ALIGNED && Math.abs(d.y) > AXIS_ALIGNED;
        return slanted ? pointPair(c.a, c.b) : { kind: linear === 'auto' || linear === 'aligned' ? 'distance' : linear, refs: [c.a, c.b] };
      }
      if (c?.type === 'circle') return { kind: roundKind ?? 'diameter', refs: [c.id] };
      if (c?.type === 'arc') return { kind: roundKind ?? 'radius', refs: [c.id] };
      if (c?.type === 'ellipse' || c?.type === 'ellipticalArc') {
        const m = getPointPos(sketch, c.c);
        const major = dist(m, getPointPos(sketch, c.major));
        const minor = dist(m, getPointPos(sketch, c.minor));
        const toCursor = dist(m, cursor);
        return { kind: 'ellipseAxis', refs: [c.id], variant: Math.abs(toCursor - major) <= Math.abs(toCursor - minor) ? 0 : 1 };
      }
      return null;
    }
    if (isLineRef(a) && isLineRef(b)) {
      const l = lineOf(sketch, a.id);
      const m = lineOf(sketch, b.id);
      if (!l || !m) return null;
      if (Math.abs(cross(norm(l.d), norm(m.d))) < PARALLEL_TOL) {
        // A centerline is a revolve axis: the line opposite it gets a diameter [ref SKT-CENTERLINE-GEOMETRY].
        const [axis, other] = sketch.curves[a.id]?.lineType === 'centerline' ? [a, b] : [b, a];
        const across = sketch.curves[other.id];
        if (sketch.curves[axis.id]?.lineType === 'centerline' && across?.type === 'line' && roundKind !== 'radius') {
          return { kind: 'diameter', refs: [axis.id, across.a] };
        }
        return { kind: 'lineLine', refs: [a.id, b.id] };
      }
      return { kind: 'angle', refs: [a.id, b.id], variant: angleVariant(a.id, b.id) };
    }
    const [line, other] = isLineRef(a) ? [a, b] : isLineRef(b) ? [b, a] : [null, null];
    if (line && other) {
      const p = asPoint(other);
      if (!p) return null;
      if (toRim && isRoundCurve(sketch.curves[other.id])) {
        return { kind: 'tangentLine', refs: [other.id, line.id], variant: rimSide(other, line.id) };
      }
      const revolve = sketch.curves[line.id]?.lineType === 'centerline' && roundKind !== 'radius';
      if (roundKind === 'diameter' || revolve) return { kind: 'diameter', refs: [line.id, p] };
      return { kind: 'pointLine', refs: [p, line.id] };
    }
    if (toRim && isRoundCurve(sketch.curves[a.id]) && isRoundCurve(sketch.curves[b.id])) {
      return { kind: 'tangentRounds', refs: [a.id, b.id], variant: rimBits(a, b) };
    }
    const p = asPoint(a);
    const q = asPoint(b);
    return p && q ? pointPair(p, q) : null;
  };

  /** 0 when the picked side of the rim faces the line, 1 when it is the far side. */
  const rimSide = (round: Hit, line: Id): number => {
    const l = lineOf(ctx.sketch, line);
    const m = asPoint(round);
    if (!l || !m || !round.pos) return 0;
    const c = getPointPos(ctx.sketch, m);
    const side = cross(l.d, sub(c, l.p));
    return side * cross(l.d, sub(round.pos, c)) > 0 ? 1 : 0;
  };

  const rimBits = (a: Hit, b: Hit): number => {
    const p = getPointPos(ctx.sketch, asPoint(a) as Id);
    const q = getPointPos(ctx.sketch, asPoint(b) as Id);
    const u = sub(q, p);
    const far = (h: Hit, from: Vec2, toward: Vec2): boolean => !!h.pos && dot(sub(h.pos, from), toward) < 0;
    return (far(a, p, u) ? 1 : 0) | (far(b, q, scale(u, -1)) ? 2 : 0);
  };

  /** Which of the two supplementary angles the label sits in. */
  const angleVariant = (l: Id, m: Id): number => {
    const a = lineOf(ctx.sketch, l);
    const b = lineOf(ctx.sketch, m);
    if (!a || !b) return 0;
    const denom = cross(a.d, b.d);
    const k = cross({ x: b.p.x - a.p.x, y: b.p.y - a.p.y }, b.d) / denom;
    const v = { x: a.p.x + a.d.x * k, y: a.p.y + a.d.y * k };
    const theta = Math.atan2(cursor.y - v.y, cursor.x - v.x);
    const rays = [a.d, { x: -a.d.x, y: -a.d.y }, b.d, { x: -b.d.x, y: -b.d.y }].map((u) => Math.atan2(u.y, u.x));
    let sweep = Math.PI;
    for (const r of rays) {
      for (const s of rays) {
        const w = wrapAngle(s - r);
        if (w > 1e-9 && w < sweep && wrapAngle(theta - r) <= w) sweep = w;
      }
    }
    const ang = Math.abs(Math.atan2(cross(a.d, b.d), a.d.x * b.d.x + a.d.y * b.d.y));
    return Math.abs(ang - sweep) <= Math.abs(Math.PI - ang - sweep) ? 0 : 1;
  };

  const tempDimension = (c: Candidate, label: Vec2): Dimension | null => {
    const d: Dimension = {
      id: '__new', kind: c.kind, refs: c.refs, name: '', expression: '', value: 0, driving: !driven, label,
    };
    if (c.variant !== undefined) d.variant = c.variant;
    const value = measureDimension(ctx.sketch, d);
    if (value === null) return null;
    d.value = value;
    d.expression = literalExpression(c.kind, value);
    return d;
  };

  const validSecond = (hit: Hit): boolean => {
    const first = picks[0];
    if (hit.id === first.id) return false;
    if (hit.kind === 'point' && first.kind === 'point') {
      const rep = coincidentClasses(ctx.sketch);
      return rep(hit.id) !== rep(first.id);
    }
    if (first.kind === 'point' || hit.kind === 'point') return isLineRef(hit) || isLineRef(first) || !!asPoint(hit);
    const bothLines = isLineRef(first) && isLineRef(hit);
    const roundAndLine = (isLineRef(first) || isLineRef(hit)) && !!(asPoint(first) ?? asPoint(hit));
    const bothRound = !!asPoint(first) && !!asPoint(hit);
    return bothLines || roundAndLine || bothRound;
  };

  const accept = (hit: Hit): boolean => {
    if (hit.kind !== 'point' && hit.kind !== 'curve') return false;
    if (hit.kind === 'curve' && ctx.sketch.curves[hit.id]?.type === 'text') return false;
    if (picks.length === 0) return hit.kind === 'point' || (!!ctx.sketch.curves[hit.id]);
    // Another layer is a reference: the pair has to include something on the active layer to move.
    if (ctx.foreign(hit) && !picks.some((p) => ctx.onActive(p))) return false;
    if (ctx.foreign(picks[0]) && !ctx.onActive(hit)) return false;
    // With a dimension ready to place, a click on an axis places it. To measure to an axis, pick the axis first.
    if ((hit.id === AXIS_X || hit.id === AXIS_Y) && candidate()) return false;
    return picks.length === 1 && validSecond(hit);
  };

  const hover = (e: ToolPointer): Hit | null => ctx.hit(e.screen, { reserved: true, accept });

  const place = (): void => {
    const c = candidate();
    const dim = c ? tempDimension(c, cursor) : null;
    if (!c || !dim) {
      ctx.message('These cannot be dimensioned', 'warn');
      return;
    }
    if (dim.value < 1e-9) {
      ctx.message('The picked points coincide, so there is nothing to measure', 'warn');
      return;
    }
    if (!picks.some((h) => ctx.onActive(h)) && picks.some((h) => ctx.foreign(h))) {
      ctx.message('Another layer can only be a reference. Pick something on the active layer as well.', 'warn');
      return;
    }
    const redundant = !driven && ctx.solver.wouldOverConstrain(dim);
    const reference = picks.filter((h) => ctx.foreign(h)).flatMap((h) => pointsOf(ctx, h));
    const add = (expression: string, value: number, driving: boolean): void => {
      ctx.commit('Dimension', (scope) => {
        scope.hold(...reference);
        addDimension(scope.design, scope.sketch, c.kind, c.refs, value, { expression, driving, label: dim.label, variant: c.variant });
      });
      reset();
    };
    if (driven || redundant) {
      if (redundant) ctx.message('That dimension would over-constrain the sketch, so it is Driven');
      add(dim.expression, dim.value, false);
      return;
    }
    editing = true;
    label = dim.label;
    prompt();
    ctx.hud.edit({
      at: dim.label,
      kind: c.kind === 'angle' ? 'angle' : 'length',
      initial: dim.expression,
      name: nextDimensionName(ctx.design),
      accept(expression, value) {
        if (!(value > 0)) {
          ctx.message('A dimension must be greater than zero', 'warn');
          return false;
        }
        const driven = c.kind === 'tangentLine' || c.kind === 'tangentRounds' ? drivenReference(ctx.design, expression) : null;
        if (driven) {
          ctx.message(`A tangent dimension cannot reference the Driven dimension ${driven}`, 'warn');
          return false;
        }
        add(expression, value, true);
        return true;
      },
      cancel: reset,
    });
  };

  return {
    start() {
      const preset = ctx.selection.ids().map((id) => ctx.hitOf(id)).filter((h): h is Hit => !!h && (h.kind === 'point' || h.kind === 'curve'));
      if (preset.length >= 1 && preset.length <= 2) picks = preset;
      prompt();
    },
    stop() {
      ctx.hud.closeEditor();
      ctx.setHover(null);
    },
    move(e) {
      cursor = e.world;
      if (editing) return;
      ctx.setHover(hover(e));
    },
    click(e) {
      if (editing) return;
      cursor = e.world;
      const hit = hover(e);
      if (hit && (picks.length === 0 || candidate() === null || picks.length === 1)) {
        picks.push(hit);
        ctx.selection.add([hit.id]);
        ctx.setHover(null);
        prompt();
        return;
      }
      if (picks.length > 0) place();
    },
    enter() {
      if (editing) return true;
      if (picks.length === 0) return false;
      place();
      return true;
    },
    escape() {
      if (picks.length === 0) return false;
      reset();
      return true;
    },
    draw(p) {
      const c = candidate();
      const d = c ? tempDimension(c, label ?? cursor) : null;
      if (d) p.dimension(ctx.design, ctx.sketch, d);
    },
    menu(): MenuItem[] {
      const items: MenuItem[] = [];
      const c = candidate();
      if (!c) return items;
      if (c.kind === 'radius' || c.kind === 'diameter') {
        items.push(
          { id: 'dim-radius', label: 'Radius', checked: c.kind === 'radius', run: () => { roundKind = 'radius'; ctx.invalidate(); } },
          { id: 'dim-diameter', label: 'Diameter', checked: c.kind === 'diameter', run: () => { roundKind = 'diameter'; ctx.invalidate(); } },
        );
      }
      if (picks.length === 2 && picks.some((h) => isRoundCurve(ctx.sketch.curves[h.id]))) {
        items.push(
          { id: 'dim-center', label: 'Pick Circle/Arc Center', checked: !toRim, run: () => { toRim = false; ctx.invalidate(); } },
          { id: 'dim-tangent', label: 'Pick Circle/Arc Tangent', checked: toRim, run: () => { toRim = true; ctx.invalidate(); } },
        );
      }
      if (c.kind === 'pointLine' && ctx.sketch.curves[c.refs[1]]?.lineType === 'centerline') {
        items.push({ id: 'dim-revolve', label: 'Diameter', run: () => { roundKind = 'diameter'; ctx.invalidate(); } });
      }
      if (c.kind === 'diameter' && c.refs.length === 2) {
        items.push({ id: 'dim-linear', label: 'Linear', run: () => { roundKind = 'radius'; ctx.invalidate(); } });
      }
      if (c.kind === 'distance' || c.kind === 'horizontal' || c.kind === 'vertical') {
        items.push(
          { id: 'dim-aligned', label: 'Aligned', checked: c.kind === 'distance', run: () => { linear = 'aligned'; ctx.invalidate(); } },
          { id: 'dim-horizontal', label: 'Horizontal', checked: c.kind === 'horizontal', run: () => { linear = 'horizontal'; ctx.invalidate(); } },
          { id: 'dim-vertical', label: 'Vertical', checked: c.kind === 'vertical', run: () => { linear = 'vertical'; ctx.invalidate(); } },
        );
      }
      items.push(driven
        ? { id: 'dim-driving', label: 'Driving', run: () => { driven = false; ctx.invalidate(); } }
        : { id: 'dim-driven', label: 'Driven', run: () => { driven = true; ctx.invalidate(); } });
      return items;
    },
    docChanged: reset,
  };
}

export const dimensionTool: ToolDef = {
  meta: { id: 'dimension', label: 'Sketch Dimension', panel: 'create', shortcut: 'D' },
  create: createDimension,
};
