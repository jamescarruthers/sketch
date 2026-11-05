// AutoConstrain [adapt]: a deterministic local heuristic in place of Fusion's cloud service. Detect
// relationships within tolerance, then add dimensions from a datum until nothing is free. Every
// addition is tested through the injected solver and kept only if it removes a degree of freedom.
import type { ConstraintType, Curve, Design, DimensionKind, Id, Line, Sketch, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y, DESIGN_VERSION, ORIGIN } from '../model/types';
import { addConstraint, addDimension, coincidentClasses, curveEnds, curvePoints, getPointPos } from '../model/document';
import { closestOnParam, resolve, unitTangent, type ParamCurve } from './curves';
import { AUTO_ANGLE_TOL, AUTO_EQUAL_TOL, AUTO_POS_TOL, EPS_ZERO } from './tolerance';
import { cross, dist, dot, len, lerp, norm, reflect, sub } from './vec';

export const AUTO_ENTITY_LIMIT = 250;

/** The injected solver: analyse a sketch (it may tidy positions) and report what remains free. */
export type AutoSolve = (sketch: Sketch) => { ok: boolean; dof: number };

export interface ProposedConstraint {
  type: ConstraintType;
  refs: Id[];
  variant?: number;
  rank: number;
}

export interface ProposedDimension {
  kind: DimensionKind;
  refs: Id[];
  value: number;
  label: Vec2;
  variant?: number;
  rank: number;
  /** A reference dimension: shows the size without driving it. */
  driven?: boolean;
}

export interface AutoResult {
  /** Stable across calls for the same sketch and options. */
  id: string;
  /** Short description for the result tile. */
  label: string;
  constraints: ProposedConstraint[];
  dimensions: ProposedDimension[];
  /** Totals after applying, for the tile. */
  totalConstraints: number;
  totalDimensions: number;
  dof: number;
  fullyConstrained: boolean;
}

export interface AutoOptions {
  solve: AutoSolve;
  /** Point dimensions align to. Default: a point at the origin, else the lowest, leftmost point. */
  datum?: Id;
  /** Slider, 0 to 1: the share of proposals kept, best first. Default 1. */
  quantity?: number;
  /** Modify Geometry: allow relationships this far (mm) from true, the solver snaps them. */
  tolerance?: number;
  /** Modify Geometry angular tolerance, radians. */
  angleTolerance?: number;
  /** How many results. Generate more asks for two more. Default 3. */
  count?: number;
  /** Proposals to leave out, e.g. ones deleted from a preview before Refresh. */
  exclude?: (proposal: ProposedConstraint | ProposedDimension) => boolean;
}

/** Limit 250 entities, not on an empty sketch [ref]. */
export function autoConstrainAvailable(sketch: Sketch): { ok: boolean; reason?: string } {
  const n = Object.keys(sketch.curves).length;
  if (n === 0) return { ok: false, reason: 'The sketch is empty' };
  if (n > AUTO_ENTITY_LIMIT) return { ok: false, reason: `AutoConstrain handles up to ${AUTO_ENTITY_LIMIT} entities` };
  return { ok: true };
}

interface Tol { pos: number; angle: number }

interface Context {
  sketch: Sketch;
  tol: Tol;
  rep: (id: Id) => Id;
  has: (type: ConstraintType, refs: Id[]) => boolean;
  lines: Line[];
  round: Extract<Curve, { type: 'circle' | 'arc' }>[];
  pcs: Map<Id, ParamCurve>;
}

function context(sketch: Sketch, tol: Tol): Context {
  const seen = new Set<string>();
  const key = (type: ConstraintType, refs: Id[]): string => `${type}:${[...refs].sort().join(',')}`;
  for (const k of Object.values(sketch.constraints)) seen.add(key(k.type, k.refs));
  const curves = Object.values(sketch.curves).filter((c) => c.type !== 'text' && !(c.type === 'line' && c.frameOf) && !c.projected && !c.derivedFrom);
  const pcs = new Map<Id, ParamCurve>();
  for (const c of curves) pcs.set(c.id, resolve(sketch, c));
  return {
    sketch, tol,
    rep: coincidentClasses(sketch),
    has: (type, refs) => seen.has(key(type, refs)),
    lines: curves.filter((c): c is Line => c.type === 'line'),
    round: curves.filter((c): c is Extract<Curve, { type: 'circle' | 'arc' }> => c.type === 'circle' || c.type === 'arc'),
    pcs,
  };
}

const RANK = {
  coincident: 0, onCurve: 1, tangent: 2, axis: 3, concentric: 4, perpendicular: 5, parallel: 6, midpoint: 7, equal: 8,
  symmetric: 9,
} as const;

function endPoints(ctx: Context): { id: Id; pos: Vec2; curve: Id }[] {
  const out: { id: Id; pos: Vec2; curve: Id }[] = [];
  for (const id of ctx.pcs.keys()) {
    const ends = curveEnds(ctx.sketch.curves[id]);
    if (ends) for (const e of ends) out.push({ id: e, pos: getPointPos(ctx.sketch, e), curve: id });
  }
  return out;
}

function centres(ctx: Context): { id: Id; pos: Vec2; curve: Id }[] {
  const out: { id: Id; pos: Vec2; curve: Id }[] = [];
  for (const id of ctx.pcs.keys()) {
    const c = ctx.sketch.curves[id];
    if (c.type === 'circle' || c.type === 'arc' || c.type === 'ellipse' || c.type === 'ellipticalArc') {
      out.push({ id: c.c, pos: getPointPos(ctx.sketch, c.c), curve: id });
    }
  }
  return out;
}

function detectCoincident(ctx: Context): ProposedConstraint[] {
  const out: ProposedConstraint[] = [];
  const ends = endPoints(ctx);
  const middles = centres(ctx);
  const origin = { x: 0, y: 0 };
  const groups = new Set<string>();
  for (const e of [...ends, ...middles]) {
    if (dist(e.pos, origin) <= ctx.tol.pos && !groups.has(ctx.rep(e.id)) && ctx.rep(e.id) !== ORIGIN) {
      groups.add(ctx.rep(e.id));
      out.push({ type: 'coincident', refs: [ORIGIN, e.id], rank: RANK.coincident });
    }
  }
  // Link each group once; pairs within a group would be redundant.
  const joined = new Map<Id, Id>();
  const find = (id: Id): Id => {
    let r = ctx.rep(id);
    while (joined.has(r)) r = joined.get(r) as Id;
    return r;
  };
  // Centre to centre is left out: that relationship reads better as concentric.
  const candidates = [...ends, ...middles];
  for (let i = 0; i < candidates.length; i++) {
    const firstIsEnd = i < ends.length;
    for (let j = i + 1; j < candidates.length; j++) {
      if (!firstIsEnd && j >= ends.length) continue;
      if (candidates[i].curve === candidates[j].curve) continue;
      if (dist(candidates[i].pos, candidates[j].pos) > ctx.tol.pos) continue;
      const a = find(candidates[i].id);
      const b = find(candidates[j].id);
      if (a === b) continue;
      joined.set(a, b);
      out.push({ type: 'coincident', refs: [candidates[i].id, candidates[j].id], rank: RANK.coincident });
    }
  }
  return out;
}

function detectOnCurve(ctx: Context): ProposedConstraint[] {
  const out: ProposedConstraint[] = [];
  for (const e of endPoints(ctx)) {
    for (const [id, pc] of ctx.pcs) {
      if (id === e.curve) continue;
      const ends = curveEnds(ctx.sketch.curves[id]);
      if (ends?.some((x) => dist(getPointPos(ctx.sketch, x), e.pos) <= ctx.tol.pos)) continue;
      if (ctx.has('coincident', [e.id, id])) continue;
      if (closestOnParam(pc, e.pos).dist <= ctx.tol.pos) out.push({ type: 'coincident', refs: [e.id, id], rank: RANK.onCurve });
    }
  }
  return out;
}

function detectAxis(ctx: Context): ProposedConstraint[] {
  const out: ProposedConstraint[] = [];
  for (const l of ctx.lines) {
    const u = norm(sub(getPointPos(ctx.sketch, l.b), getPointPos(ctx.sketch, l.a)));
    if (ctx.has('horizontal', [l.id]) || ctx.has('vertical', [l.id])) continue;
    if (Math.abs(u.y) <= ctx.tol.angle) out.push({ type: 'horizontal', refs: [l.id], rank: RANK.axis });
    else if (Math.abs(u.x) <= ctx.tol.angle) out.push({ type: 'vertical', refs: [l.id], rank: RANK.axis });
  }
  return out;
}

function detectParallel(ctx: Context): ProposedConstraint[] {
  const out: ProposedConstraint[] = [];
  const dirs = ctx.lines.map((l) => norm(sub(getPointPos(ctx.sketch, l.b), getPointPos(ctx.sketch, l.a))));
  const axisAligned = (u: Vec2): boolean => Math.abs(u.x) <= ctx.tol.angle || Math.abs(u.y) <= ctx.tol.angle;
  for (let i = 0; i < ctx.lines.length; i++) {
    if (axisAligned(dirs[i])) continue;
    for (let j = i + 1; j < ctx.lines.length; j++) {
      if (axisAligned(dirs[j])) continue;
      const refs = [ctx.lines[i].id, ctx.lines[j].id];
      const c = cross(dirs[i], dirs[j]);
      const d = dot(dirs[i], dirs[j]);
      if (Math.abs(c) <= ctx.tol.angle && !ctx.has('parallel', refs)) out.push({ type: 'parallel', refs, rank: RANK.parallel });
      else if (Math.abs(d) <= ctx.tol.angle && !ctx.has('perpendicular', refs)) out.push({ type: 'perpendicular', refs, rank: RANK.perpendicular });
    }
  }
  return out;
}

function detectTangent(ctx: Context): ProposedConstraint[] {
  const out: ProposedConstraint[] = [];
  const ids = [...ctx.pcs.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ctx.sketch.curves[ids[i]];
      const b = ctx.sketch.curves[ids[j]];
      if (a.type === 'line' && b.type === 'line') continue;
      const ea = curveEnds(a);
      const eb = curveEnds(b);
      if (!ea || !eb) continue;
      for (let x = 0; x < 2; x++) {
        for (let y = 0; y < 2; y++) {
          if (dist(getPointPos(ctx.sketch, ea[x]), getPointPos(ctx.sketch, eb[y])) > ctx.tol.pos) continue;
          const ta = unitTangent(ctx.pcs.get(a.id) as ParamCurve, x);
          const tb = unitTangent(ctx.pcs.get(b.id) as ParamCurve, y);
          if (Math.abs(cross(ta, tb)) <= ctx.tol.angle && !ctx.has('tangent', [a.id, b.id])) {
            out.push({ type: 'tangent', refs: [a.id, b.id], rank: RANK.tangent });
          }
        }
      }
    }
  }
  return out;
}

function detectConcentric(ctx: Context): ProposedConstraint[] {
  const out: ProposedConstraint[] = [];
  for (let i = 0; i < ctx.round.length; i++) {
    for (let j = i + 1; j < ctx.round.length; j++) {
      const a = ctx.round[i];
      const b = ctx.round[j];
      if (ctx.rep(a.c) === ctx.rep(b.c)) continue;
      if (dist(getPointPos(ctx.sketch, a.c), getPointPos(ctx.sketch, b.c)) <= ctx.tol.pos && !ctx.has('concentric', [a.id, b.id])) {
        out.push({ type: 'concentric', refs: [a.id, b.id], rank: RANK.concentric });
      }
    }
  }
  return out;
}

function detectMidpoint(ctx: Context): ProposedConstraint[] {
  const out: ProposedConstraint[] = [];
  for (const l of ctx.lines) {
    const m = lerp(getPointPos(ctx.sketch, l.a), getPointPos(ctx.sketch, l.b), 0.5);
    for (const e of endPoints(ctx)) {
      if (e.curve !== l.id && dist(e.pos, m) <= ctx.tol.pos && !ctx.has('midpoint', [e.id, l.id])) {
        out.push({ type: 'midpoint', refs: [e.id, l.id], rank: RANK.midpoint });
      }
    }
  }
  return out;
}

function detectEqual(ctx: Context): ProposedConstraint[] {
  const out: ProposedConstraint[] = [];
  const size = (c: Curve): number => {
    const s = (ctx.pcs.get(c.id) as ParamCurve).shape;
    if (s.kind === 'line') return dist(s.a, s.b);
    return s.kind === 'arc' ? s.r : 0;
  };
  const group = (items: Curve[]): void => {
    const heads: Curve[] = [];
    for (const c of items) {
      const v = size(c);
      const head = heads.find((h) => Math.abs(size(h) - v) <= AUTO_EQUAL_TOL * Math.max(v, EPS_ZERO));
      if (!head) heads.push(c);
      else if (!ctx.has('equal', [head.id, c.id])) out.push({ type: 'equal', refs: [head.id, c.id], rank: RANK.equal });
    }
  };
  group(ctx.lines);
  group(ctx.round);
  return out;
}

function detectSymmetric(ctx: Context): ProposedConstraint[] {
  const out: ProposedConstraint[] = [];
  const axes: { id: Id; p: Vec2; d: Vec2 }[] = [
    { id: AXIS_X, p: { x: 0, y: 0 }, d: { x: 1, y: 0 } },
    { id: AXIS_Y, p: { x: 0, y: 0 }, d: { x: 0, y: 1 } },
  ];
  for (const l of ctx.lines) {
    if (l.lineType === 'normal') continue;
    const p = getPointPos(ctx.sketch, l.a);
    axes.push({ id: l.id, p, d: sub(getPointPos(ctx.sketch, l.b), p) });
  }
  const pts = endPoints(ctx);
  const used = new Set<string>();
  for (const axis of axes) {
    for (let i = 0; i < pts.length; i++) {
      const image = reflect(pts[i].pos, axis.p, axis.d);
      if (dist(image, pts[i].pos) <= ctx.tol.pos) continue;
      for (let j = i + 1; j < pts.length; j++) {
        if (ctx.rep(pts[i].id) === ctx.rep(pts[j].id)) continue;
        if (dist(image, pts[j].pos) > ctx.tol.pos) continue;
        const pair = [ctx.rep(pts[i].id), ctx.rep(pts[j].id)].sort().join('|');
        if (used.has(`${axis.id}:${pair}`)) continue;
        used.add(`${axis.id}:${pair}`);
        out.push({ type: 'symmetric', refs: [pts[i].id, pts[j].id, axis.id], rank: RANK.symmetric });
      }
    }
  }
  return out;
}

function chooseDatum(sketch: Sketch, wanted: Id | undefined): Id {
  if (wanted) return wanted;
  const movable = Object.values(sketch.curves).flatMap((c) => (c.type === 'text' ? [] : curvePoints(c)));
  let best: Id = ORIGIN;
  let bestPos: Vec2 | null = null;
  for (const id of movable) {
    const p = getPointPos(sketch, id);
    if (len(p) <= AUTO_POS_TOL) return ORIGIN;
    if (!bestPos || p.y < bestPos.y - AUTO_POS_TOL || (Math.abs(p.y - bestPos.y) <= AUTO_POS_TOL && p.x < bestPos.x)) {
      best = id;
      bestPos = p;
    }
  }
  return best;
}

const labelNear = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2 + 2, y: (a.y + b.y) / 2 + 2 });

/** Dimensions for sizes: what a designer would call out first. */
function sizeDimensions(sketch: Sketch): ProposedDimension[] {
  const out: ProposedDimension[] = [];
  for (const c of Object.values(sketch.curves)) {
    if (c.projected || c.derivedFrom || c.type === 'text') continue;
    if (c.type === 'circle') {
      const m = getPointPos(sketch, c.c);
      out.push({ kind: 'diameter', refs: [c.id], value: c.r * 2, label: { x: m.x + c.r, y: m.y + c.r }, rank: 20 });
    } else if (c.type === 'arc') {
      const m = getPointPos(sketch, c.c);
      const a = getPointPos(sketch, c.a);
      out.push({ kind: 'radius', refs: [c.id], value: dist(m, a), label: a, rank: 21 });
    } else if (c.type === 'ellipse' || c.type === 'ellipticalArc') {
      const m = getPointPos(sketch, c.c);
      const major = getPointPos(sketch, c.major);
      const minor = getPointPos(sketch, c.minor);
      out.push({ kind: 'ellipseAxis', refs: [c.id], value: dist(m, major), label: major, variant: 0, rank: 22 });
      out.push({ kind: 'ellipseAxis', refs: [c.id], value: dist(m, minor), label: minor, variant: 1, rank: 22 });
    } else if (c.type === 'line') {
      const a = getPointPos(sketch, c.a);
      const b = getPointPos(sketch, c.b);
      out.push({ kind: 'distance', refs: [c.a, c.b], value: dist(a, b), label: labelNear(a, b), rank: 24 });
    }
  }
  return out;
}

function angleDimensions(sketch: Sketch): ProposedDimension[] {
  const out: ProposedDimension[] = [];
  for (const c of Object.values(sketch.curves)) {
    if (c.type !== 'line' || c.projected || c.derivedFrom) continue;
    const a = getPointPos(sketch, c.a);
    const b = getPointPos(sketch, c.b);
    const u = sub(b, a);
    if (len(u) < EPS_ZERO) continue;
    const value = Math.abs(Math.atan2(u.y, u.x));
    if (value > AUTO_ANGLE_TOL && Math.abs(value - Math.PI) > AUTO_ANGLE_TOL) {
      out.push({ kind: 'angle', refs: [c.id, AXIS_X], value, label: labelNear(a, b), rank: 25 });
    }
  }
  return out;
}

type Step = { dim: ProposedDimension } | { rule: ProposedConstraint };

/**
 * Ordinates from the datum to every point, nearest first. A point already level with the datum gets
 * an alignment constraint: a zero dimension says the same thing worse, and is singular to solve.
 */
function ordinateSteps(sketch: Sketch, datum: Id, tol: number): Step[] {
  const base = getPointPos(sketch, datum);
  const ids = new Set<Id>();
  for (const c of Object.values(sketch.curves)) {
    if (c.type === 'text' || c.projected || c.derivedFrom) continue;
    for (const p of curvePoints(c)) ids.add(p);
  }
  const sorted = [...ids].sort((a, b) => dist(getPointPos(sketch, a), base) - dist(getPointPos(sketch, b), base));
  const out: Step[] = [];
  for (const id of sorted) {
    if (id === datum) continue;
    const p = getPointPos(sketch, id);
    const dx = Math.abs(p.x - base.x);
    const dy = Math.abs(p.y - base.y);
    if (dx <= tol) out.push({ rule: { type: 'vertical', refs: [datum, id], rank: 30 } });
    else out.push({ dim: { kind: 'horizontal', refs: [datum, id], value: dx, label: { x: (p.x + base.x) / 2, y: base.y - 4 }, rank: 30 } });
    if (dy <= tol) out.push({ rule: { type: 'horizontal', refs: [datum, id], rank: 31 } });
    else out.push({ dim: { kind: 'vertical', refs: [datum, id], value: dy, label: { x: base.x - 4, y: (p.y + base.y) / 2 }, rank: 31 } });
  }
  return out;
}

function anchorDatum(sketch: Sketch, datum: Id, tol: number): Step[] {
  if (datum === ORIGIN) return [];
  const p = getPointPos(sketch, datum);
  const out: Step[] = [];
  if (Math.abs(p.x) <= tol) out.push({ rule: { type: 'vertical', refs: [ORIGIN, datum], rank: 15 } });
  else out.push({ dim: { kind: 'horizontal', refs: [ORIGIN, datum], value: Math.abs(p.x), label: { x: p.x / 2, y: -4 }, rank: 15 } });
  if (Math.abs(p.y) <= tol) out.push({ rule: { type: 'horizontal', refs: [ORIGIN, datum], rank: 16 } });
  else out.push({ dim: { kind: 'vertical', refs: [ORIGIN, datum], value: Math.abs(p.y), label: { x: -4, y: p.y / 2 }, rank: 16 } });
  return out;
}

interface Strategy {
  label: string; relations: (ctx: Context) => ProposedConstraint[]; sizesFirst: boolean; reverse: boolean;
  /** Sizes only: where the shape sits stays free, so the sketch can still be moved. */
  unplaced?: boolean;
  /** Add every size the solve did not need as a Driven dimension. */
  reference?: boolean;
}

const firm = (ctx: Context): ProposedConstraint[] => [
  ...detectCoincident(ctx), ...detectOnCurve(ctx), ...detectTangent(ctx), ...detectAxis(ctx), ...detectConcentric(ctx),
];
const all = (ctx: Context): ProposedConstraint[] => [
  ...firm(ctx), ...detectParallel(ctx), ...detectMidpoint(ctx), ...detectEqual(ctx), ...detectSymmetric(ctx),
];

const STRATEGIES: Strategy[] = [
  { label: 'Balanced', relations: all, sizesFirst: true, reverse: false },
  { label: 'More dimensions', relations: firm, sizesFirst: true, reverse: false },
  { label: 'Ordinate from datum', relations: all, sizesFirst: false, reverse: false },
  { label: 'Geometric first', relations: (ctx) => [...firm(ctx), ...detectSymmetric(ctx), ...detectEqual(ctx), ...detectParallel(ctx), ...detectMidpoint(ctx)], sizesFirst: true, reverse: false },
  { label: 'Sizes, reversed order', relations: all, sizesFirst: true, reverse: true },
  { label: 'With reference dimensions', relations: all, sizesFirst: true, reverse: false, reference: true },
  { label: 'Sizes only', relations: all, sizesFirst: true, reverse: false, unplaced: true },
];

/** The most results shown: Generate more stops here. */
export const AUTO_MAX_RESULTS = 5;

function tryAdd(trial: Sketch, solve: AutoSolve, apply: (s: Sketch) => void, dof: number): { sketch: Sketch; dof: number } | null {
  const next = structuredClone(trial);
  apply(next);
  const r = solve(next);
  return r.ok && r.dof < dof ? { sketch: next, dof: r.dof } : null;
}

// Trial edits never reach the document, so ids and names need only be unique inside the copy.
function scratchDesign(sketch: Sketch): Design {
  const nextId = 2_000_000_000 + Object.keys(sketch.constraints).length + Object.keys(sketch.dimensions).length;
  return {
    version: DESIGN_VERSION, name: '', sketches: { [sketch.id]: sketch }, order: [sketch.id], parameters: [], units: 'mm', nextId,
    layers: [], activeLayer: Object.values(sketch.curves)[0]?.layer ?? '',
  };
}

function runStrategy(sketch: Sketch, opts: AutoOptions, tol: Tol, strategy: Strategy, datum: Id, index: number): AutoResult {
  const start = structuredClone(sketch);
  let dof = opts.solve(start).dof;
  let trial = start;
  const ctx = context(trial, tol);
  const taken: ProposedConstraint[] = [];
  const takenDims: ProposedDimension[] = [];

  const wanted = (p: ProposedConstraint | ProposedDimension): boolean => !opts.exclude?.(p);
  const relations = strategy.relations(ctx).filter(wanted).sort((a, b) => a.rank - b.rank);
  for (const p of relations) {
    if (dof === 0) break;
    const r = tryAdd(trial, opts.solve, (s) => { addConstraint(scratchDesign(s), s, p.type, p.refs); }, dof);
    if (r) {
      trial = r.sketch;
      dof = r.dof;
      taken.push(p);
    }
  }

  const sizes: Step[] = [...sizeDimensions(trial), ...angleDimensions(trial)].filter(wanted).map((dim) => ({ dim }));
  if (strategy.reverse) sizes.reverse();
  const ordinate = [...anchorDatum(trial, datum, tol.pos), ...ordinateSteps(trial, datum, tol.pos)];
  const allowed = ordinate.filter((step) => wanted('rule' in step ? step.rule : step.dim));
  const placed = strategy.unplaced ? [] : allowed;
  const queue = strategy.sizesFirst ? [...sizes, ...placed] : [...placed, ...sizes];
  for (const step of queue) {
    if (dof === 0) break;
    if ('rule' in step) {
      const p = step.rule;
      const r = tryAdd(trial, opts.solve, (s) => { addConstraint(scratchDesign(s), s, p.type, p.refs); }, dof);
      if (r) {
        trial = r.sketch;
        dof = r.dof;
        taken.push(p);
      }
      continue;
    }
    const p = step.dim;
    const r = tryAdd(trial, opts.solve, (s) => {
      addDimension(scratchDesign(s), s, p.kind, p.refs, p.value, { label: p.label, variant: p.variant, name: `auto${Object.keys(s.dimensions).length}` });
    }, dof);
    if (r) {
      trial = r.sketch;
      dof = r.dof;
      takenDims.push(p);
    }
  }

  if (strategy.reference) {
    const used = new Set(takenDims.map((p) => `${p.kind}:${p.refs.join()}`));
    for (const step of sizes) {
      const key = 'dim' in step ? `${step.dim.kind}:${step.dim.refs.join()}` : '';
      if ('dim' in step && !used.has(key)) takenDims.push({ ...step.dim, driven: true });
    }
  }

  const q = Math.min(1, Math.max(0, opts.quantity ?? 1));
  const keptConstraints = q === 1 ? taken : taken.slice(0, Math.ceil(taken.length * q));
  const keptDims = q === 1 ? takenDims : takenDims.slice(0, Math.ceil(takenDims.length * q));
  let finalDof = dof;
  if (q < 1) {
    const partial = structuredClone(sketch);
    const d = scratchDesign(partial);
    for (const p of keptConstraints) addConstraint(d, partial, p.type, p.refs);
    keptDims.forEach((p, i) => addDimension(d, partial, p.kind, p.refs, p.value, { name: `auto${i}`, variant: p.variant }));
    finalDof = opts.solve(partial).dof;
  }

  return {
    id: `auto-${index}`,
    label: strategy.label,
    constraints: keptConstraints,
    dimensions: keptDims,
    totalConstraints: Object.keys(sketch.constraints).length + keptConstraints.length,
    totalDimensions: Object.keys(sketch.dimensions).length + keptDims.length,
    dof: finalDof,
    fullyConstrained: finalDof === 0,
  };
}

/**
 * Candidate results, best first: fully constrained before partial, then fewest additions. Empty when
 * autoConstrainAvailable says no. Deterministic for a given sketch and options. The sketch is not
 * changed; preview a result by drawing its proposals, apply with applyResult.
 */
export function generateResults(sketch: Sketch, opts: AutoOptions): AutoResult[] {
  if (!autoConstrainAvailable(sketch).ok) return [];
  const tol: Tol = { pos: opts.tolerance ?? AUTO_POS_TOL, angle: opts.angleTolerance ?? AUTO_ANGLE_TOL };
  const datum = chooseDatum(sketch, opts.datum);
  const want = Math.min(opts.count ?? 3, AUTO_MAX_RESULTS);
  const results = STRATEGIES.map((st, i) => runStrategy(sketch, opts, tol, st, datum, i));
  results.sort((a, b) => {
    if (a.fullyConstrained !== b.fullyConstrained) return a.fullyConstrained ? -1 : 1;
    if (a.dof !== b.dof) return a.dof - b.dof;
    return a.constraints.length + a.dimensions.length - (b.constraints.length + b.dimensions.length);
  });
  // A tile that repeats another offers no choice: what differs on its face comes first, then what
  // differs in its details, and repeats only if nothing else is left.
  const faces = new Set<string>();
  const contents = new Set<string>();
  const [unlike, other, repeats]: AutoResult[][] = [[], [], []];
  for (const r of results) {
    const face = `${r.constraints.length}:${r.dimensions.length}:${r.fullyConstrained}`;
    const content = signature(r);
    (!faces.has(face) ? unlike : !contents.has(content) ? other : repeats).push(r);
    faces.add(face);
    contents.add(content);
  }
  return [...unlike, ...other, ...repeats].slice(0, want);
}

/** What a result adds, regardless of the order it was found in. */
function signature(r: AutoResult): string {
  return [...r.constraints.map((c) => `${c.type}:${c.refs.join()}`), ...r.dimensions.map((d) => `${d.kind}:${d.refs.join()}`)].sort().join('|');
}

/** Commit a result. Returns the ids created. Caller solves afterwards. */
export function applyResult(design: Design, sketch: Sketch, result: AutoResult): Id[] {
  const out: Id[] = [];
  for (const p of result.constraints) out.push(addConstraint(design, sketch, p.type, p.refs, p.variant === undefined ? {} : { variant: p.variant }).id);
  for (const p of result.dimensions) out.push(addDimension(design, sketch, p.kind, p.refs, p.value, { label: p.label, variant: p.variant, driving: !p.driven }).id);
  return out;
}

