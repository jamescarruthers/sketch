// Document <-> wasm solver. See solver/src/lib.rs for how each constraint is modelled.
import type { Constraint, Curve, Dimension, Id, Sketch } from '../model/types';
import { ORIGIN } from '../model/types';
import { coincidentClasses, curvePoints, getPointPos } from '../model/document';
import { measureDimension } from '../model/parameters';
import { conicPoint } from '../geom/conic';
import { derivedDamage, slideOffset } from '../geom/offset';
import { splineEval } from '../geom/spline';
import type { Freeze } from '../model/layers';
import { crossesItself, facesOf, offItsSide, sideOf, sweepOf, type Bulge, type Face } from './faces';
import { carry, framesOf, leftOut, planBodies, settlePieces, type Body, type Frame } from './bodies';
import { applySeat, makeWorld, oneBody, ownCurves, seatsFor, seatsForDimension, type Seat } from './seat';
import init, { initSync, set_dogleg, solve as wasmSolve } from './pkg/sketch_solver.js';

export interface SolveOptions {
  drag?: { point: Id; x: number; y: number }[]; hold?: Id[]; analyze?: boolean;
  /** Layers that must not move this solve. A hard fix, where `hold` is a low-priority wish. */
  freeze?: Freeze | null;
  /** What this solve must not turn over. Set for a commit; a drag has a cursor to follow instead. */
  branches?: Branches;
  /** Dimension values to solve at in place of their own: the steps of a walk. */
  values?: Map<Id, number>;
  /** What this solve leaves out, curves, points and rows: the bodies, which go with their joints afterwards. */
  without?: Set<Id>;
  /** Nothing but the rows, from where things are: no size or length held. The least motion, whatever it costs in shape. */
  plain?: boolean;
  /** The outlines that are simple as the commit begins: one that comes to run through itself has failed. */
  outlines?: Face[];
  /** The lines of closed profiles, by their ends: staying where they are outranks keeping a free length. */
  walls?: [Id, Id][];
  /** Lengths this solve holds that no row asks for, to keep a line from running back through itself. */
  lengths?: { a: Id; b: Id; length: number }[];
}
/** `dof` is -1, and the free sets empty, unless the solve ran with `analyze`. */
export interface SolveResult {
  ok: boolean; unsatisfied: Id[]; freePoints: Set<Id>; freeCurves: Set<Id>; dof: number; error?: string;
  /** The solve destroyed geometry, so nothing was applied: the sketch is as it came in. Says why. */
  refusal?: string;
  /** Something the regeneration of derived geometry had to change, for the user to hear about. */
  notes?: string[];
}
/** What `solveSketch` hands back: `ms` is the main-thread wall time of the whole call, every seat, walk and fallback of the one request. */
export type Solved = SolveResult & { ms: number };

type Turned = 'arc' | 'loop' | 'flat';

interface SolverCurveBase { id: Id; fixed: boolean }
type SolverCurve = SolverCurveBase & (
  | { type: 'line'; a: Id; b: Id }
  | { type: 'circle'; c: Id; r: number }
  | { type: 'arc'; c: Id; a: Id; b: Id }
  | { type: 'ellipse'; c: Id; major: Id; minor: Id }
  | { type: 'ellipticalArc'; c: Id; major: Id; minor: Id; a: Id; b: Id }
  | {
    type: 'spline'; pts: Id[]; degree: number; fit: boolean; closed: boolean;
    handles: (Id | null)[]; samples: [number, number][]; rational: boolean; rho?: number;
  }
  | { type: 'frame'; pts: Id[] }
);

interface SolverConstraint {
  id: Id; type: string; refs: Id[]; variant?: number; dx?: number; dy?: number; angle?: number;
}
interface SolverDimension { id: Id; kind: string; refs: Id[]; value: number; variant?: number }

/** What must not jump in a solve: arcs by centre and ends, closed loops by their corners. */
export interface Branches { arcs: [Id, Id, Id][]; loops: Id[][]; bulges: Bulge[][] }

interface SolverInput {
  points: { id: Id; x: number; y: number; fixed: boolean }[];
  curves: SolverCurve[];
  constraints: SolverConstraint[];
  dimensions: SolverDimension[];
  drag: { point: Id; x: number; y: number }[];
  hold: Id[];
  analyze: boolean;
  branches?: Branches;
  slack?: number;
  plain?: boolean;
  walls?: [Id, Id][];
}

interface SolverOutput {
  ok: boolean;
  points: Record<Id, [number, number]>;
  radii: Record<Id, number>;
  unsatisfied: Id[];
  freePoints?: Id[];
  freeCurves?: Id[];
  dof?: number;
  iterations: number;
  error: string | null;
  /** What a solution was turned down for jumping. */
  crossed?: Turned | null;
  /** Every free size and length stayed. */
  kept?: boolean;
  /** Curves whose radius nothing tied down and the solve still could not keep. */
  resized?: Id[];
}

/** Chords this short keep a point on a spline within about 0.003 mm on a 50 mm radius. */
const SAMPLES_PER_SPAN = 48;
const CONIC_SAMPLES = 96;
/** Rounds of re-sampling a spline whose own points moved, since samples are constant in a solve. */
const SAMPLE_ROUNDS = 3;
const SAMPLE_MOVE_TOL = 1e-6;
const ANGLE_DELTA = 0.01;
const LENGTH_DELTA = 0.01;
/** A line or radius below this (mm) has collapsed. */
const COLLAPSE_LENGTH = 1e-3;
/** A point further than this many sketch extents from where it was has been thrown, not moved. */
const JUMP_FACTOR = 4;
const JUMP_FLOOR = 1;
/** Summed relative size change a seat may leave on the curves it means to keep. */
const SIZE_SLACK = 0.005;
/** How far (mm) the solve may drift a held point before the seat counts as having failed to hold it. */
const HOLD_SLACK = 1e-5;
const UNHELD_PENALTY = 1;
/** Below this the rest of the sketch has, to any eye, not moved. */
const UNDISTURBED = 1e-6;
/** What moving the rest of the sketch by its own extent counts for, unchanged in shape. */
const TRAVEL_WEIGHT = 0.2;
/** Above any seat that leaves the rest alone. */
const MIN_SCORE = 1e-3;
/** What letting go of the first pick counts for in a small move, against a constraint's upheaval, and in a big one. */
const WISH_WEIGHT = 0.05;
const FIRM_WISH = 8;
/** Going this far, of what keeping the first pick would take, is worth letting it go. */
const MUCH_LESS = 0.4;
/** A sweep changed by more than this in one constraint has jumped, whatever the constraint gained. */
const SWEEP_JUMP = Math.PI / 3;
/** Shares of its length a line that ran back through itself is tried at, in place of that. */
const RETREATS = [1, 0.5, 0.25];
/** A free line left with less than this share of itself has collapsed, whatever a constraint gained. */
const COLLAPSED_SHARE = 0.5;
/** A size the seat means to keep counts for this much more than the same change elsewhere. */
const KEEP_WEIGHT = 4;
/** A slot's arc is a half turn to within noise, and stays one. */
const HALF_TURN_SLACK = 0.02;
/** Steps a walk starts from, per doubling of a value and per this angle. */
const STEPS_PER_DOUBLING = 2;
const STEP_ANGLE = Math.PI / 12;
const MAX_STEPS = 32;
/** A walk that has halved its step to this fraction of the way has met a wall. */
const SMALLEST_STEP = 1 / 512;
/** Below this a dimension has not changed. */
const VALUE_EPS = 1e-6;
/** A row this near met is met, to the eye and to what spline samples can tell. */
const SHOWN_MET = 1e-3;
/** A value within this share of one already visited starts from there: it covers a value typed back off the screen. */
const NEAR_SHARE = 0.01;
/** The same state, to within what a second solve of a solved sketch leaves. */
const STATE_EPS = 1e-7;
/** How much better a walk has to be, in summed relative size change, to replace a direct solve. */
const WALK_GAIN = 1e-4;
/** States remembered along a run of value edits. */
const MAX_VISITS = 64;

let ready: Promise<void> | null = null;
let regenerate: ((s: Sketch) => unknown) | null = null;

export function initSolver(): Promise<void> {
  ready ??= load().then(() => set_dogleg(wantsDogleg())).catch((e: unknown) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** A trial of the DogLeg step: `?solver=dogleg` in the URL, or `VITE_SOLVER=dogleg` when Vite runs. */
function wantsDogleg(): boolean {
  if (import.meta.env.VITE_SOLVER === 'dogleg') return true;
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('solver') === 'dogleg';
}

async function load(): Promise<void> {
  const url = new URL('./pkg/sketch_solver_bg.wasm', import.meta.url);
  if (typeof process !== 'undefined' && process.versions?.node) {
    const fs = 'node:fs/promises';
    const { readFile } = (await import(/* @vite-ignore */ fs)) as typeof import('node:fs/promises');
    initSync({ module: await readFile(url) });
    return;
  }
  await init({ module_or_path: url });
}

/** Hook the offset feature's regeneration; called after each successful solve. */
export function setDerivedRegenerator(fn: ((s: Sketch) => unknown) | null): void {
  regenerate = fn;
}

function splineRefs(sketch: Sketch): Set<Id> {
  const used = new Set<Id>();
  for (const k of Object.values(sketch.constraints)) {
    for (const r of k.refs) {
      const t = sketch.curves[r]?.type;
      if (t === 'fitSpline' || t === 'controlSpline' || t === 'conic') used.add(r);
    }
  }
  return used;
}

/** Samples are only read by rows that reference the spline, so unreferenced ones stay cheap. */
function samplesOf(sketch: Sketch, curve: Curve): [number, number][] {
  if (curve.type === 'conic') {
    const arc = {
      a: getPointPos(sketch, curve.a), v: getPointPos(sketch, curve.v), b: getPointPos(sketch, curve.b), rho: curve.rho,
    };
    return Array.from({ length: CONIC_SAMPLES + 1 }, (_, i) => {
      const p = conicPoint(arc, i / CONIC_SAMPLES);
      return [p.x, p.y];
    });
  }
  if (curve.type !== 'fitSpline' && curve.type !== 'controlSpline') return [];
  const ev = splineEval(curve, sketch);
  const n = Math.max(ev.spans, 1) * SAMPLES_PER_SPAN;
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = ev.at(ev.closed && i === n ? 0 : i / n);
    return [p.x, p.y];
  });
}

function toSolverCurve(sketch: Sketch, curve: Curve, wantSamples: Set<Id>, freeze?: Freeze | null): SolverCurve | null {
  const fixed = !!curve.fixed || !!curve.projected || curve.derivedFrom !== undefined || !!freeze?.curves.has(curve.id);
  const base = { id: curve.id, fixed };
  const samples = (): [number, number][] => (wantSamples.has(curve.id) ? samplesOf(sketch, curve) : []);
  switch (curve.type) {
    case 'line': return { ...base, type: 'line', a: curve.a, b: curve.b };
    case 'circle': return { ...base, type: 'circle', c: curve.c, r: curve.r };
    case 'arc': return { ...base, type: 'arc', c: curve.c, a: curve.a, b: curve.b };
    case 'ellipse': return { ...base, type: 'ellipse', c: curve.c, major: curve.major, minor: curve.minor };
    case 'ellipticalArc':
      return { ...base, type: 'ellipticalArc', c: curve.c, major: curve.major, minor: curve.minor, a: curve.a, b: curve.b };
    case 'fitSpline':
      return {
        ...base, type: 'spline', pts: curve.pts, degree: 3, fit: true, closed: curve.closed,
        handles: curve.handles, samples: samples(), rational: false,
      };
    case 'controlSpline':
      return {
        ...base, type: 'spline', pts: curve.pts, degree: curve.degree, fit: false, closed: false,
        handles: [], samples: samples(), rational: false,
      };
    case 'conic':
      // Its end tangents are the legs to the vertex, which is what the spline mapping expects.
      return {
        ...base, type: 'spline', pts: [curve.a, curve.v, curve.b], degree: 2, fit: false, closed: false,
        handles: [], samples: samples(), rational: true, rho: curve.rho,
      };
    case 'text':
      return curve.mode === 'frame' && curve.frame ? { ...base, type: 'frame', pts: [...curve.frame] } : null;
  }
}

function toSolverConstraint(k: Constraint): SolverConstraint {
  const out: SolverConstraint = { id: k.id, type: k.type, refs: k.refs };
  if (k.variant !== undefined) out.variant = k.variant;
  if (k.dx !== undefined) out.dx = k.dx;
  if (k.dy !== undefined) out.dy = k.dy;
  if (k.angle !== undefined) out.angle = k.angle;
  return out;
}

function toSolverDimension(d: Dimension, value: number = d.value): SolverDimension {
  const out: SolverDimension = { id: d.id, kind: d.kind, refs: d.refs, value };
  if (d.variant !== undefined) out.variant = d.variant;
  return out;
}

function toSolverInput(sketch: Sketch, opts: SolveOptions, omit?: Set<Id>): SolverInput {
  const wantSamples = splineRefs(sketch);
  const curves: SolverCurve[] = [];
  const { freeze, without } = opts;
  const here = (id: Id): boolean => !without?.has(id);
  for (const c of Object.values(sketch.curves)) {
    const mapped = here(c.id) ? toSolverCurve(sketch, c, wantSamples, freeze) : null;
    if (mapped) curves.push(mapped);
  }
  const kept = ({ id, refs }: { id: Id; refs: Id[] }): boolean => here(id) && refs.every(here) && !omit?.has(id) && !freeze?.broken.has(id);
  return {
    points: Object.values(sketch.points).filter((p) => here(p.id)).map((p) => ({ id: p.id, x: p.x, y: p.y, fixed: !!p.fixed || !!freeze?.points.has(p.id) })),
    curves,
    constraints: Object.values(sketch.constraints).filter(kept).map(toSolverConstraint),
    dimensions: [
      ...Object.values(sketch.dimensions).filter((d) => d.driving && !d.feature && kept(d)).map((d) => toSolverDimension(d, opts.values?.get(d.id))),
      ...(opts.lengths ?? []).map(({ a, b, length }, i) => ({ id: `length-${i}`, kind: 'distance', refs: [a, b], value: length })),
    ],
    drag: opts.drag ?? [],
    hold: (opts.hold ?? []).filter(here),
    analyze: !!opts.analyze,
    branches: opts.branches,
    plain: opts.plain,
    walls: opts.walls?.filter(([a, b]) => here(a) && here(b)),
  };
}

function runSolver(input: SolverInput): SolverOutput {
  try {
    return JSON.parse(wasmSolve(JSON.stringify(input))) as SolverOutput;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, points: {}, radii: {}, unsatisfied: [], iterations: 0, error };
  }
}

function branchesOf(sketch: Sketch, faces: Face[]): Branches {
  const arcs: [Id, Id, Id][] = [];
  for (const c of Object.values(sketch.curves)) if (c.type === 'arc') arcs.push([c.c, c.a, c.b]);
  const plain = faces.filter((f) => f.plain);
  return { arcs, loops: plain.map((f) => f.corners), bulges: plain.map((f) => f.bulges) };
}

/**
 * Whether a move that is one jump, a seat or a constraint's solve, has flipped an arc: any arc sent the
 * long way round by a real change of sweep, or one the constraint is not about gone over a half turn
 * either way or far from where it was. A value has steps to judge by and does not come here.
 */
function flipped(sketch: Sketch, from: State, to: State, own: Set<Id>): boolean {
  const at = (s: State, id: Id): { x: number; y: number } => (id === ORIGIN ? { x: 0, y: 0 } : s.points.get(id) ?? { x: 0, y: 0 });
  const half = Math.PI;
  return Object.values(sketch.curves).some((c) => {
    if (c.type !== 'arc') return false;
    const was = sweepOf(at(from, c.c), at(from, c.a), at(from, c.b));
    const now = sweepOf(at(to, c.c), at(to, c.a), at(to, c.b));
    // A small change that happens to pass a half turn is a small change.
    const far = Math.abs(now - was) > half / 4;
    if (far && was < half - HALF_TURN_SLACK && now > half + HALF_TURN_SLACK) return true;
    if (own.has(c.id)) return false;
    return (far && was > half + HALF_TURN_SLACK && now < half - HALF_TURN_SLACK) || Math.abs(now - was) > half / 2;
  });
}

/** Whether any closed loop has lost its side. The solver sees only its own solve, and a seat comes before that. */
function turnedOver(branches: Branches | undefined, from: State, to: State): boolean {
  return !!branches?.loops.some((corners, i) => {
    const face = { corners, bulges: branches.bulges[i] };
    return offItsSide(to.points, face, sideOf(from.points, face));
  });
}

/** The lines on a face, by their ends. */
function wallsOf(sketch: Sketch, faces: Face[]): [Id, Id][] {
  const ids = new Set(faces.flatMap((f) => f.edges.map((e) => e.curve)));
  return [...ids].flatMap((id) => {
    const c = sketch.curves[id];
    return c?.type === 'line' ? [[c.a, c.b] as [Id, Id]] : [];
  });
}

/** Whether an outline that was simple now runs through itself. */
const newlyCrossed = (sketch: Sketch, outlines: Face[] | undefined): boolean => !!outlines?.some((f) => crossesItself(sketch, f));

/** Why a solve that would turn something over must not stand. */
const CROSSED: Record<Turned, string> = {
  arc: 'no way was found to reach that without an arc flipping or closing on itself',
  loop: 'no way was found to keep that closed shape the right way out: it would turn over',
  flat: 'no way was found to keep that closed shape open: it would go flat',
};

/** A value the solver can reach only by wrecking something, and cannot walk to. */
const NO_WAY = 'no way was found to reach that value from the sketch as it stands';

function applyOutput(sketch: Sketch, out: SolverOutput): void {
  for (const [id, [x, y]] of Object.entries(out.points)) {
    const p = sketch.points[id];
    if (p) {
      p.x = x;
      p.y = y;
    }
  }
  for (const [id, r] of Object.entries(out.radii)) {
    const c = sketch.curves[id];
    if (c?.type === 'circle') c.r = r;
  }
}

/** Largest move of any point of a sampled spline, so the caller can tell if samples went stale. */
function sampledMove(sketch: Sketch, sampled: Set<Id>, before: Map<Id, { x: number; y: number }>): number {
  let most = 0;
  for (const id of sampled) {
    const c = sketch.curves[id];
    const pts = c?.type === 'conic' ? [c.a, c.v, c.b] : c?.type === 'fitSpline' ? [...c.pts, ...c.handles] : c?.type === 'controlSpline' ? c.pts : [];
    for (const p of pts) {
      if (p === null) continue;
      const now = sketch.points[p];
      const was = before.get(p);
      if (now && was) most = Math.max(most, Math.abs(now.x - was.x), Math.abs(now.y - was.y));
    }
  }
  return most;
}

function snapshot(sketch: Sketch): Map<Id, { x: number; y: number }> {
  const m = new Map<Id, { x: number; y: number }>();
  for (const p of Object.values(sketch.points)) m.set(p.id, { x: p.x, y: p.y });
  return m;
}

/** A drag on the output of an offset with no dimension changes its distance, not the output's points. */
function releaseFreeOffsets(sketch: Sketch, opts: SolveOptions): SolveOptions {
  if (!opts.drag?.length) return opts;
  const owned = new Map<Id, Extract<Sketch['features'][Id], { type: 'offset' }>>();
  for (const f of Object.values(sketch.features)) {
    if (f.type !== 'offset' || f.dimension) continue;
    for (const o of f.outputs) {
      const c = sketch.curves[o];
      if (c) for (const p of curvePoints(c)) owned.set(p, f);
    }
  }
  if (owned.size === 0) return opts;
  const slid = new Set<Id>();
  for (const t of opts.drag) {
    const f = owned.get(t.point);
    if (!f || slid.has(f.id)) continue;
    slid.add(f.id);
    slideOffset(sketch, f, sketch.points[t.point], t);
  }
  return { ...opts, drag: opts.drag.filter((t) => !owned.has(t.point)) };
}

/** Everything a solve can change. */
export interface State { points: Map<Id, { x: number; y: number }>; radii: Map<Id, number> }

export function capture(sketch: Sketch): State {
  const radii = new Map<Id, number>();
  for (const c of Object.values(sketch.curves)) if (c.type === 'circle') radii.set(c.id, c.r);
  return { points: snapshot(sketch), radii };
}

function restore(sketch: Sketch, state: State): void {
  for (const [id, q] of state.points) {
    const p = sketch.points[id];
    if (p) {
      p.x = q.x;
      p.y = q.y;
    }
  }
  for (const [id, r] of state.radii) {
    const c = sketch.curves[id];
    if (c?.type === 'circle') c.r = r;
  }
}

/** Solve and write the result back, re-sampling splines whose own points moved. */
function solveCore(sketch: Sketch, opts: SolveOptions, omit?: Set<Id>): SolverOutput {
  const sampled = splineRefs(sketch);
  let out = runSolver(toSolverInput(sketch, opts, omit));
  if (out.error !== null) return out;
  for (let round = 0; round < SAMPLE_ROUNDS && sampled.size > 0; round++) {
    const before = snapshot(sketch);
    applyOutput(sketch, out);
    if (sampledMove(sketch, sampled, before) < SAMPLE_MOVE_TOL) break;
    out = runSolver(toSolverInput(sketch, opts, omit));
  }
  applyOutput(sketch, out);
  return out;
}

/** A size that must not reach zero: line lengths, radii, an arc's span, an ellipse's semi-axes. */
function sizesOf(sketch: Sketch, state: State, c: Curve): { what: string; size: number }[] {
  const at = (id: Id): { x: number; y: number } => (id === ORIGIN ? { x: 0, y: 0 } : state.points.get(id) ?? sketch.points[id]);
  const gap = (a: Id, b: Id): number => {
    const p = at(a);
    const q = at(b);
    return Math.hypot(p.x - q.x, p.y - q.y);
  };
  switch (c.type) {
    case 'line': return [{ what: 'a line to zero length', size: gap(c.a, c.b) }];
    case 'circle': return [{ what: 'a circle to zero radius', size: state.radii.get(c.id) ?? c.r }];
    case 'arc': return [
      { what: 'an arc to zero radius', size: gap(c.c, c.a) },
      { what: 'an arc to a point', size: gap(c.a, c.b) },
    ];
    case 'ellipse': case 'ellipticalArc': return [
      { what: 'an ellipse axis to zero', size: gap(c.c, c.major) },
      { what: 'an ellipse axis to zero', size: gap(c.c, c.minor) },
    ];
    default: return [];
  }
}

/** Sketch extent a solve can plausibly reach: the geometry, drag targets and every dimension. */
function reach(sketch: Sketch, state: State, opts: SolveOptions): number {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  const see = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const p of state.points.values()) see(p.x, p.y);
  for (const t of opts.drag ?? []) see(t.x, t.y);
  let extent = Math.hypot(maxX - minX, maxY - minY);
  for (const r of state.radii.values()) extent += r;
  for (const d of Object.values(sketch.dimensions)) if (d.driving && d.kind !== 'angle') extent += Math.abs(d.value);
  return extent;
}

/** Why this solve must not stand, or null. `before` is the geometry the solve was given. */
function damage(sketch: Sketch, before: State, opts: SolveOptions): string | null {
  const now = capture(sketch);
  for (const c of Object.values(sketch.curves)) {
    const was = sizesOf(sketch, before, c);
    const is = sizesOf(sketch, now, c);
    for (let i = 0; i < was.length; i++) {
      if (!Number.isFinite(is[i].size)) return 'the solve did not produce usable geometry';
      if (was[i].size >= COLLAPSE_LENGTH && is[i].size < COLLAPSE_LENGTH) return `it would collapse ${was[i].what}`;
    }
  }
  const limit = JUMP_FACTOR * reach(sketch, before, opts) + JUMP_FLOOR;
  let far = 0;
  for (const [id, q] of now.points) {
    const was = before.points.get(id);
    if (was) far = Math.max(far, Math.hypot(q.x - was.x, q.y - was.y));
  }
  for (const r of now.radii.values()) far = Math.max(far, r);
  return far > limit ? 'it would throw the geometry out of the sketch' : null;
}

/** Summed relative size change between two states, over `only` or every curve. */
function sizeChange(sketch: Sketch, from: State, to: State, only?: Id[]): number {
  let total = 0;
  for (const c of only ? only.flatMap((id) => sketch.curves[id] ?? []) : Object.values(sketch.curves)) {
    const was = sizesOf(sketch, from, c);
    const is = sizesOf(sketch, to, c);
    for (let i = 0; i < was.length; i++) {
      if (was[i].size > COLLAPSE_LENGTH) total += Math.abs(Math.log(Math.max(is[i].size, COLLAPSE_LENGTH) / was[i].size));
    }
  }
  return total;
}

/** Largest distance between any two points of a state, near enough. */
function spanOf(state: State): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of state.points.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(Math.hypot(maxX - minX, maxY - minY), JUMP_FLOOR);
}

/** What a solve did to everything but the curves in `own`: how far they changed size, and how far they went. */
function disturbance(sketch: Sketch, from: State, to: State, own: Set<Id>): number {
  const others = Object.values(sketch.curves).filter((c) => !own.has(c.id));
  const mine = new Set<Id>();
  for (const id of own) {
    const c = sketch.curves[id];
    if (c) curvePoints(c).forEach((p) => mine.add(p));
  }
  let far = 0;
  for (const [id, was] of from.points) {
    if (mine.has(id)) continue;
    const owner = sketch.points[id]?.owner;
    if (owner !== undefined && own.has(owner)) continue;
    const is = to.points.get(id);
    if (is) far = Math.max(far, Math.hypot(is.x - was.x, is.y - was.y));
  }
  return sizeChange(sketch, from, to, others.map((c) => c.id)) + TRAVEL_WEIGHT * (far / spanOf(from));
}

/**
 * What a constraint's solve did to the whole sketch, its own curves too: how far anything changed size,
 * and how far anything went. A body going with its joint counts for neither.
 */
function upheaval(sketch: Sketch, from: State, to: State, carried: Id[]): number {
  const bodies = new Set(carried);
  const curves = Object.values(sketch.curves).filter((c) => !bodies.has(c.id)).map((c) => c.id);
  return sizeChange(sketch, from, to, curves) + moved(sketch, from, to, carried) / spanOf(from);
}

/** How far the furthest point went, bodies aside. */
function moved(sketch: Sketch, from: State, to: State, carried: Id[]): number {
  const away = new Set(carried.flatMap((id) => curvePoints(sketch.curves[id])));
  let far = 0;
  for (const [id, was] of from.points) {
    const is = to.points.get(id);
    if (is && !away.has(id)) far = Math.max(far, Math.hypot(is.x - was.x, is.y - was.y));
  }
  return far;
}

/** Whether what a constraint did is a wreck, however well it met: a sweep gone far, a free line half gone. */
function wrecked(sketch: Sketch, from: State, to: State, own: Set<Id>): boolean {
  const at = (s: State, id: Id): { x: number; y: number } => (id === ORIGIN ? { x: 0, y: 0 } : s.points.get(id) ?? { x: 0, y: 0 });
  const measured = new Set(Object.values(sketch.dimensions).filter((d) => d.driving).flatMap((d) => d.refs));
  return Object.values(sketch.curves).some((c) => {
    if (c.type === 'arc') return Math.abs(sweepOf(at(to, c.c), at(to, c.a), at(to, c.b)) - sweepOf(at(from, c.c), at(from, c.a), at(from, c.b))) > SWEEP_JUMP;
    if (c.type !== 'line' || own.has(c.id) || c.lineType !== 'normal' || measured.has(c.id) || (measured.has(c.a) && measured.has(c.b))) return false;
    const gap = (s: State): number => Math.hypot(at(s, c.a).x - at(s, c.b).x, at(s, c.a).y - at(s, c.b).y);
    return gap(to) < gap(from) * COLLAPSED_SHARE;
  });
}

/** A way of meeting a row, tried and clean. */
interface Attempt { seat: Seat | null; wish: boolean; plain: boolean }
interface Tried extends Attempt { held: boolean; far: number; travel: number; quiet: boolean; cost: number; wreck: boolean }

/**
 * The way to take. A seat that leaves the rest alone comes first, the one that sends least along. Then
 * the least cost, where going against the first pick counts for little in a much smaller move within one
 * body and for a lot otherwise, unless nothing can keep it. One that wrecks a shape is the last resort,
 * unless the pick order is `ordered`: then it is what was asked for.
 */
function cheapest(found: Tried[], constraint: boolean, within: boolean, ordered: boolean): Tried | null {
  const keeping = found.filter((t) => t.held).map((t) => t.far);
  const least = keeping.length ? Math.min(...keeping) : 0;
  const wish = (t: Tried): number => {
    if (t.held || (constraint && !keeping.length)) return 0;
    if (!constraint) return UNHELD_PENALTY;
    return within && t.far < least * MUCH_LESS ? WISH_WEIGHT : FIRM_WISH;
  };
  const score = (t: Tried): number => (t.quiet ? 0 : MIN_SCORE + t.cost + wish(t));
  const failed = (t: Tried): boolean => t.wreck && !ordered;
  let best: Tried | null = null;
  for (const t of found) {
    const [a, b] = best ? [score(t), score(best)] : [0, 0];
    if (!best || (failed(best) !== failed(t) ? failed(best) : a < b - UNDISTURBED || (a < b + UNDISTURBED && t.travel < best.travel))) best = t;
  }
  return best;
}

/** What seating came to. */
interface Seated { seated: Id[] | null; own: Set<Id>; large: boolean; settle: SolveOptions }

/**
 * Move each constraint the geometry does not yet satisfy to where it holds, trying its seats with
 * the real solver, since only that knows what the rest of the sketch allows. A seat that solves
 * cleanly, keeps the sizes it means to keep and leaves everything else alone wins at once. Failing
 * that, the one with the least upheaval across the whole sketch, and the unseated solve competes for
 * that place. One that wrecks a shape is taken only if nothing else will do, and that gets a note.
 * Geometry is left seated, unsolved.
 */
function seatPending(sketch: Sketch, opts: SolveOptions, valuesOnly: boolean, bodies: Body[]): Seated {
  const worldOf = (): ReturnType<typeof makeWorld> => makeWorld(sketch, opts.hold ?? [], opts.freeze?.points);
  const world = worldOf();
  const items: { id: Id; refs: Id[]; seats: (w: typeof world) => Seat[] }[] = [
    ...Object.values(valuesOnly ? {} : sketch.constraints).map((k) => ({ id: k.id, refs: k.refs, seats: (w: typeof world) => seatsFor(w, k) })),
    ...Object.values(sketch.dimensions).filter((d) => d.driving).map((d) => ({ id: d.id, refs: d.refs, seats: (w: typeof world) => seatsForDimension(w, d) })),
  ];
  const asked = new Set<Id>();
  let settle: SolveOptions = {};
  // A seat is a guess at what is unmet. The solver's own rows say what is: a tangent the geometry
  // meets from the other side must not send a body off to the side a seat would have chosen. It is
  // also the cheap question, and on a large sketch almost every row is met.
  const unmet = new Set(brokenOf(sketch, new Set(items.filter((k) => !opts.freeze?.broken.has(k.id)).map((k) => k.id))));
  const pending = items.filter((k) => unmet.has(k.id) && k.seats(world).length);
  if (pending.length === 0) return { seated: null, own: asked, large: false, settle };
  const omit = new Set(pending.map((k) => k.id));
  const carried = bodies.flatMap((b) => b.curves);
  let seated: Id[] | null = null;
  let large = false;
  for (const k of pending) {
    omit.delete(k.id);
    const here = worldOf();
    const seats = k.seats(here);
    const own = ownCurves(here, k.refs);
    own.forEach((id) => asked.add(id));
    const base = capture(sketch);
    const constraint = !!sketch.constraints[k.id];
    // The first pick is a wish. Between two bodies one can always give way whole and it costs no shape.
    // Within one, there is no such move, and the least of all may be to let the pick go.
    const within = constraint && oneBody(here, k.refs);
    const equal = sketch.constraints[k.id]?.type === 'equal';
    const tries: Attempt[] = [...seats, null].map((seat) => ({ seat, wish: true, plain: false }));
    if (within && pending.length === 1) {
      if (opts.hold?.length) tries.push({ seat: null, wish: false, plain: false });
      tries.push({ seat: null, wish: false, plain: true });
    }
    const found: Tried[] = [];
    for (const { seat, wish, plain } of tries) {
      if (seat) applySeat(sketch, seat);
      const frames = framesOf(sketch, bodies, base.points);
      const out = solveCore(sketch, wish ? holding(opts, seated, seat) : { ...opts, hold: seated ?? undefined, plain }, omit);
      if (out.ok) carry(sketch, frames);
      const end = capture(sketch);
      const clean = out.error === null && out.ok && !flipped(sketch, base, end, own) && !turnedOver(opts.branches, base, end) && !damage(sketch, base, opts)
        && (!constraint || brokenOf(sketch, new Set([k.id]), undefined, SHOWN_MET).length === 0);
      const crossing = clean && newlyCrossed(sketch, opts.outlines);
      restore(sketch, base);
      if (!clean) continue;
      // Equal holds the first pick by its size: where it sits is not what the pick order says.
      const held = equal ? sizeChange(sketch, base, end, k.refs.slice(0, 1)) < SIZE_SLACK / 100 : (opts.hold ?? []).every((id) => {
        const was = base.points.get(id);
        const is = end.points.get(id);
        return !was || !is || Math.hypot(was.x - is.x, was.y - is.y) < HOLD_SLACK;
      });
      const kept = sizeChange(sketch, base, end, seat ? seat.keep : [...own]);
      // A body going with its joint disturbs nothing, though staying is better still.
      const travel = disturbance(sketch, base, end, own);
      const others = disturbance(sketch, base, end, new Set([...own, ...carried]));
      const whole = seat?.body && sizeChange(sketch, base, end) < SIZE_SLACK;
      const quiet = !!seat && held && kept < SIZE_SLACK && (others < UNDISTURBED || !!whole);
      // Equal says what is to change, so nothing else is to, by so much as a rounding.
      const bystanders = equal ? Object.keys(sketch.curves).filter((id) => !own.has(id) && !carried.includes(id)) : [];
      const cost = (constraint ? upheaval(sketch, base, end, carried) + KEEP_WEIGHT * sizeChange(sketch, base, end, bystanders) : others) + KEEP_WEIGHT * kept;
      const far = moved(sketch, base, end, []);
      found.push({ seat, wish, plain, held, far, travel, quiet, cost, wreck: crossing || (constraint && !quiet && wrecked(sketch, base, end, own)) });
      if (quiet && travel < UNDISTURBED) break;
    }
    // Pick order is the rule for Equal, so a wreck there is said, not avoided.
    const best = cheapest(found, constraint, within, equal);
    if (best?.wreck) large = true;
    if (best && !best.wish) settle = { hold: undefined, plain: best.plain };
    if (best?.seat) {
      applySeat(sketch, best.seat);
      seated = [...(seated ?? []), ...best.seat.points.keys()];
    }
  }
  return { seated, own: asked, large, settle };
}

/**
 * Where a seat put a point is where it should stay: left free, the solve shares any remaining
 * correction out among all the points and pulls the seat back toward where it came from.
 */
function holding(opts: SolveOptions, seated: Id[] | null, seat?: Seat | null): SolveOptions {
  if (!seated?.length && !seat) return opts;
  return { ...opts, hold: [...(opts.hold ?? []), ...(seated ?? []), ...(seat?.points.keys() ?? [])] };
}

/** A state the sketch has been in, and the dimension values that gave it. */
interface Visit { values: Map<Id, number>; state: State }
/** The value edits made one after another with nothing else between them. */
interface Trail { structure: string; visits: Visit[] }
const trails = new Map<Id, Trail>();
/** Each sketch's structure as of its last good solve. */
const settled = new Map<Id, string>();

const sameState = (a: State, b: State): boolean => [...a.points].every(([id, p]) => {
  const q = b.points.get(id);
  return !!q && Math.abs(q.x - p.x) < STATE_EPS && Math.abs(q.y - p.y) < STATE_EPS;
}) && [...a.radii].every(([id, r]) => Math.abs((b.radii.get(id) ?? Infinity) - r) < STATE_EPS);

/**
 * The sketch with its values and positions taken out, so that a trail runs only through one and the
 * same sketch. Everything else counts, by leaving out rather than listing: what gets added to the
 * model later is in here without anyone remembering to put it in.
 */
const structureOf = (sketch: Sketch): string => JSON.stringify({
  ...sketch,
  points: Object.values(sketch.points).map(({ x: _x, y: _y, ...rest }) => rest),
  curves: Object.values(sketch.curves).map((c) => (c.type === 'circle' ? { ...c, r: 0 } : c)),
  dimensions: Object.values(sketch.dimensions).map(({ value: _v, expression: _e, label: _l, ...rest }) => rest),
  features: Object.values(sketch.features).map((f) => ({ ...f, distance: 0 })),
});

/**
 * Whether going back to `state` is good now. A state is a memory, so it is checked against what cannot
 * have moved and what must hold, not trusted because the sketch looks the same.
 */
function stillGood(sketch: Sketch, { state, values }: Visit, opts: SolveOptions): boolean {
  const now = capture(sketch);
  const held = new Set<Id>(opts.freeze ? opts.freeze.points : []);
  for (const p of Object.values(sketch.points)) if (p.fixed) held.add(p.id);
  for (const c of Object.values(sketch.curves)) if (c.fixed || c.projected) curvePoints(c).forEach((id) => held.add(id));
  for (const id of held) {
    const [was, is] = [state.points.get(id), now.points.get(id)];
    if (!was || !is || Math.hypot(was.x - is.x, was.y - is.y) > STATE_EPS) return false;
  }
  restore(sketch, state);
  const good = brokenOf(sketch, rowsOf(sketch, opts), values).length === 0;
  restore(sketch, now);
  return good;
}

const valuesAt = (sketch: Sketch, moving: Moving[], t: number): Map<Id, number> => {
  const out = new Map<Id, number>();
  for (const d of Object.values(sketch.dimensions)) if (d.driving && !d.feature) out.set(d.id, d.value);
  for (const m of moving) out.set(m.id, t === 1 ? sketch.dimensions[m.id].value : m.at(t));
  return out;
};

const sameValues = (a: Map<Id, number>, b: Map<Id, number>, share = 0): boolean => [...a].every(([id, v]) => {
  return Math.abs(v - (b.get(id) ?? Infinity)) < Math.max(VALUE_EPS, share * Math.abs(v));
});

/** The trail this edit continues, a new one if the sketch is not where the last edit left it. */
function trailFor(sketch: Sketch, moving: Moving[], state: State): Trail {
  const structure = structureOf(sketch);
  const was = trails.get(sketch.id);
  if (was && was.structure === structure && sameState(state, was.visits[was.visits.length - 1].state)) return was;
  const made = { structure, visits: [{ values: valuesAt(sketch, moving, 0), state }] };
  trails.set(sketch.id, made);
  return made;
}

/** A dimension the geometry does not yet meet, and how to get there. */
interface Moving { id: Id; at(t: number): number; steps: number }

function movingValues(sketch: Sketch, opts: SolveOptions): Moving[] {
  const out: Moving[] = [];
  for (const d of Object.values(sketch.dimensions)) {
    if (!d.driving || d.feature || opts.freeze?.broken.has(d.id)) continue;
    const from = measureDimension(sketch, d);
    if (from === null || !Number.isFinite(from) || Math.abs(from - d.value) < VALUE_EPS) continue;
    const to = d.value;
    if (d.kind !== 'angle' && from > 0 && to > 0) {
      const steps = Math.ceil(Math.abs(Math.log2(to / from)) * STEPS_PER_DOUBLING);
      out.push({ id: d.id, at: (t) => from * (to / from) ** t, steps });
    } else out.push({ id: d.id, at: (t) => from + (to - from) * t, steps: Math.ceil(Math.abs(to - from) / STEP_ANGLE) });
  }
  return out;
}

/**
 * Take dimension values to where they are going in steps, each solved from the last, so that the
 * geometry follows one branch all the way. A step that fails is halved, until a wall is met.
 */
function walk(sketch: Sketch, opts: SolveOptions, moving: Moving[]): { out: SolverOutput } | { stopped: string | null } {
  const first = Math.min(MAX_STEPS, Math.max(2, ...moving.map((m) => m.steps)));
  let [t, step] = [0, 1 / first];
  let out: SolverOutput | null = null;
  let stopped: string | null = null;
  const resized = new Set<Id>();
  while (t < 1) {
    const next = Math.min(1, t + step);
    const from = capture(sketch);
    const at = solveCore(sketch, { ...opts, values: valuesAt(sketch, moving, next) });
    const off = at.ok ? null : at.crossed;
    const wrong = at.error === null ? damage(sketch, from, opts) ?? (off ? CROSSED[off] : null) : at.error;
    if (at.ok && !wrong) {
      out = at;
      at.resized?.forEach((id) => resized.add(id));
      t = next;
      step = Math.min(step * 2, 1 / first);
      continue;
    }
    restore(sketch, from);
    stopped = wrong;
    step /= 2;
    if (step < SMALLEST_STEP) return { stopped };
  }
  return out ? { out: { ...out, resized: [...resized] } } : { stopped };
}

/**
 * The one end of a dimensioned line with nothing else on it, if it has exactly one: all the edit needs
 * is for that end to go, and whatever is on the other stays exactly as it is.
 */
function freeEnd(sketch: Sketch, m: Moving): Id | null {
  const d = sketch.dimensions[m.id];
  if (d.kind !== 'distance' && d.kind !== 'horizontal' && d.kind !== 'vertical') return null;
  const only = d.refs.length === 1 ? sketch.curves[d.refs[0]] : undefined;
  const line = only ?? Object.values(sketch.curves).find((c) => c.type === 'line' && d.refs.length === 2 && d.refs.every((r) => r === c.a || r === c.b));
  if (line?.type !== 'line') return null;
  const rep = coincidentClasses(sketch);
  const uses = (id: Id): number => {
    const r = rep(id);
    const on = (ids: Id[]): boolean => ids.some((x) => sketch.points[x] && rep(x) === r);
    return Object.values(sketch.curves).filter((c) => on(curvePoints(c))).length
      + Object.values(sketch.constraints).filter((k) => k.type !== 'coincident' && on(k.refs)).length
      + Object.values(sketch.constraints).filter((k) => k.type === 'coincident' && k.refs.some((x) => sketch.curves[x]) && on(k.refs)).length
      + Object.values(sketch.dimensions).filter((o) => o.id !== d.id && o.driving && on(o.refs)).length;
  };
  const pinned = (id: Id): boolean => !!sketch.points[id]?.fixed || rep(id) === rep(ORIGIN);
  const free = [line.a, line.b].filter((id) => uses(id) === 1 && !pinned(id));
  return free.length === 1 ? free[0] : null;
}

/**
 * The first of `ends` that can meet a value going alone, with all else held. It is the least an edit
 * can do where one end is free, and the last thing to try where sharing the move between the ends
 * drags a third corner across.
 */
function oneEnd(sketch: Sketch, opts: SolveOptions, ends: Id[]): SolverOutput | null {
  const rep = coincidentClasses(sketch);
  const from = capture(sketch);
  for (const end of ends) {
    const out = solveCore(sketch, { ...opts, hold: Object.keys(sketch.points).filter((id) => rep(id) !== rep(end)) });
    if (out.error === null && out.ok && !damage(sketch, from, opts)) return out;
    restore(sketch, from);
  }
  return null;
}

/** Undimensioned lines of a face that `to` points the other way from `from`, with their lengths in `from`. */
function turnedBack(sketch: Sketch, from: State, to: State): { a: Id; b: Id; length: number }[] {
  const measured = new Set(Object.values(sketch.dimensions).filter((d) => d.driving).flatMap((d) => d.refs));
  const inFace = new Set(facesOf(sketch).flatMap((f) => f.edges.map((e) => e.curve)));
  return Object.values(sketch.curves).flatMap((c) => {
    if (c.type !== 'line' || !inFace.has(c.id) || measured.has(c.id) || (measured.has(c.a) && measured.has(c.b))) return [];
    const [p, q, u, v] = [from.points.get(c.a), from.points.get(c.b), to.points.get(c.a), to.points.get(c.b)];
    if (!p || !q || !u || !v) return [];
    const reversed = (q.x - p.x) * (v.x - u.x) + (q.y - p.y) * (v.y - u.y) < 0;
    return reversed ? [{ a: c.a, b: c.b, length: Math.hypot(q.x - p.x, q.y - p.y) }] : [];
  });
}

/** What a commit's solve came to. `exact` is a state put back as it was, for nothing to touch. */
interface Commit { out: SolverOutput; why?: string; visit?: () => void; exact?: boolean; note?: string }

/** Everything that changed size other than the curves a value is about. */
function sideEffects(sketch: Sketch, from: State, to: State, moving: Moving[]): number {
  const own = new Set(moving.flatMap((m) => sketch.dimensions[m.id].refs));
  return sizeChange(sketch, from, to, Object.keys(sketch.curves).filter((id) => !own.has(id)));
}

/** The solve of a commit. Falls back on a walk where solving straight there fails, or costs a free value. */
function solveCommit(sketch: Sketch, opts: SolveOptions, incoming: Moving[], seated: Id[] | null, before: State, own: Set<Id>, frames: Frame[]): Commit {
  let moving = incoming;
  const run = holding(opts, seated);
  const trail = moving.length && !seated ? trailFor(sketch, moving, capture(sketch)) : null;
  const target = trail ? valuesAt(sketch, moving, 1) : null;
  // A value already been at, with nothing else changed since: that shape.
  const near = target ? trail?.visits.find((v) => sameValues(target, v.values)) ?? trail?.visits.find((v) => sameValues(target, v.values, NEAR_SHARE)) : undefined;
  const back = near && stillGood(sketch, near, opts) ? near : undefined;
  if (trail && target && back) {
    trail.visits.splice(trail.visits.indexOf(back) + 1);
    restore(sketch, back.state);
    if (sameValues(target, back.values)) {
      // Good by construction: it has been the answer here, so no limit on a solve applies to it.
      const out = solveCore(sketch, { ...run, branches: undefined });
      restore(sketch, back.state);
      return { out: { ...out, resized: [] }, exact: true };
    }
    // Near enough to one already been at to start from it: from there it is a nudge.
    moving = movingValues(sketch, opts);
  }
  const start = capture(sketch);
  const visit = trail && target ? (): void => {
    trail.visits.push({ values: target, state: capture(sketch) });
    if (trail.visits.length > MAX_VISITS) trail.visits.splice(1, 1);
  } : undefined;
  const end = moving.length === 1 && !seated ? freeEnd(sketch, moving[0]) : null;
  const alone = end ? oneEnd(sketch, run, [end]) : null;
  if (alone) return { out: alone, visit };
  let out = solveCore(sketch, run);
  if (seated && out.error === null && !out.ok) {
    // The seats held one at a time but not together.
    restore(sketch, before);
    out = solveCore(sketch, opts);
  }
  if (out.error !== null) return { out };
  if (moving.length === 0) {
    // The arc a seat flipped is judged whole: a body has yet to come along with its joint.
    if (out.ok) carry(sketch, frames);
    const over = own.size > 0 && flipped(sketch, before, capture(sketch), own);
    // What is in conflict stays where it was, even if two merged points have already met.
    if (!out.ok) restore(sketch, before);
    return { out, why: over ? CROSSED.arc : undefined };
  }
  const clean = out.ok && !damage(sketch, start, opts);
  const crosses = clean && newlyCrossed(sketch, opts.outlines);
  if (clean && out.kept && !crosses) return { out, visit };
  const direct = capture(sketch);
  restore(sketch, start);
  const walked = walk(sketch, run, moving);
  if ('out' in walked) {
    const open = !newlyCrossed(sketch, opts.outlines);
    if (crosses ? open : !clean || (open && sideEffects(sketch, start, capture(sketch), moving) < sideEffects(sketch, start, direct, moving) - WALK_GAIN)) return { out: walked.out, visit };
    if (!crosses) {
      restore(sketch, direct);
      return { out, visit };
    }
  }
  if (crosses) {
    // Every length that could give, gives, before an outline is let run through itself: first with
    // nothing held, then with the lines that ran back through themselves kept shorter but pointing the same way.
    let reversed = turnedBack(sketch, start, direct);
    for (const share of [0, ...RETREATS]) {
      restore(sketch, start);
      const lengths = share ? reversed.map((l) => ({ ...l, length: l.length * share })) : undefined;
      const loose = walk(sketch, { ...run, plain: true, lengths }, moving);
      if ('out' in loose && !newlyCrossed(sketch, opts.outlines)) return { out: loose.out, visit, note: 'Free lines gave way to keep the outline from crossing itself' };
      if ('out' in loose) reversed = [...reversed, ...turnedBack(sketch, start, capture(sketch)).filter((l) => !reversed.some((r) => r.a === l.a))];
    }
    restore(sketch, direct);
    return { out, visit };
  }
  if (!clean && moving.length === 1) {
    restore(sketch, start);
    const refs = sketch.dimensions[moving[0].id].refs;
    const ends = refs.flatMap((r) => (sketch.points[r] ? [r] : sketch.curves[r] ? curvePoints(sketch.curves[r]) : []));
    const alone = oneEnd(sketch, run, [...ends].reverse());
    if (alone) return { out: alone, visit };
    // Tight shapes need more than that: the corner beside the moving end has to go too, so one end
    // stays put and the rest follow by steps.
    for (const anchor of ends) {
      const held = walk(sketch, { ...run, hold: [anchor] }, moving);
      if ('out' in held) return { out: held.out, visit };
      restore(sketch, start);
    }
  }
  restore(sketch, direct);
  if (clean) return { out, visit };
  return { out, why: ('stopped' in walked ? walked.stopped : null) ?? (out.ok ? NO_WAY : undefined) };
}

function freedom(sketch: Sketch, out: SolverOutput): { freeCurves: Set<Id>; dof: number } {
  const freeCurves = new Set<Id>(out.freeCurves ?? []);
  let dof = out.dof ?? -1;
  // An offset without a dimension still has its distance to give, so it is not fully defined.
  for (const f of Object.values(sketch.features)) {
    if (f.type !== 'offset' || f.dimension) continue;
    f.outputs.forEach((o) => freeCurves.add(o));
    if (dof >= 0) dof++;
  }
  // Text on a path has no variables of its own: it is as free as the curve it follows.
  for (const c of Object.values(sketch.curves)) {
    if (c.type === 'text' && c.mode === 'path' && c.path && freeCurves.has(c.path)) freeCurves.add(c.id);
  }
  return { freeCurves, dof };
}

/**
 * Mutates sketch point positions and radii on success. Every solve passes through here, so this is
 * where a new constraint gets seated and where a solve that destroys geometry is thrown out: the
 * sketch goes back to how it arrived and `refusal` says why. The one place a solve is timed.
 */
export function solveSketch(sketch: Sketch, opts: SolveOptions = {}): Solved {
  const t0 = performance.now();
  const result = solveRequest(sketch, opts);
  return Object.assign(result, { ms: performance.now() - t0 });
}

function solveRequest(sketch: Sketch, opts: SolveOptions): SolveResult {
  const before = capture(sketch);
  opts = releaseFreeOffsets(sketch, opts);
  if (opts.drag !== undefined) return finish(sketch, opts, solveCore(sketch, opts), before);
  const faces = facesOf(sketch);
  // An outline that already crosses itself has no side to keep and nothing to guard: it is free to come out.
  const crossed = faces.filter((f) => crossesItself(sketch, f));
  const simple = faces.filter((f) => !crossed.includes(f));
  opts = { ...opts, branches: branchesOf(sketch, simple), outlines: simple };
  const moving = movingValues(sketch, opts);
  // A value moves a profile about; a constraint is a small move already, and its lengths are the shape.
  if (moving.length) opts.walls = wallsOf(sketch, faces);
  // A constraint cannot be new in a sketch as it was when last settled, whatever a seat makes of it.
  const structure = structureOf(sketch);
  const seeds = seedsOf(sketch, opts, moving);
  const plan = planBodies(sketch, seeds, opts.freeze);
  const run = plan.bodies.length ? { ...opts, without: leftOut(plan.bodies) } : opts;
  const { seated, own, large, settle } = seatPending(sketch, run, moving.length > 0 && settled.get(sketch.id) === structure, plan.bodies);
  const frames = framesOf(sketch, plan.bodies, before.points);
  const { out, why, visit, exact, note } = solveCommit(sketch, { ...run, ...settle }, moving, seated, before, own, frames);
  let settledApart = false;
  if (!exact && out.ok && !why) {
    carry(sketch, frames);
    settledApart = settlePieces(plan, before.points, before.radii);
  }
  const result = checked(sketch, finish(sketch, run, out, before, why ?? (out.crossed && !out.ok ? CROSSED[out.crossed] : undefined), moving.length > 0, settledApart || !!note), opts, before);
  if (result.ok) {
    visit?.();
    settled.set(sketch.id, structure);
  }
  // Every value back where the run of edits began: nothing has changed to tell of.
  const home = trails.get(sketch.id)?.visits[0].values;
  const lost = home && moving.length && sameValues(valuesAt(sketch, moving, 1), home, NEAR_SHARE) ? 0 : out.resized?.length ?? 0;
  // The constraints leave no other way, so it stands. It is still not to pass without a word.
  if (result.ok && lost) (result.notes ??= []).unshift(`To meet that, the constraints also changed ${lost === 1 ? 'a radius' : `${lost} radii`} nothing else could absorb`);
  if (result.ok && large) (result.notes ??= []).unshift('Nothing smaller would meet that: it took a large change to the sketch');
  if (result.ok && note) (result.notes ??= []).unshift(note);
  if (result.ok && !exact && turnedOver(opts.branches, before, capture(sketch))) (result.notes ??= []).unshift('Nothing else would meet that: a closed shape has turned over');
  if (result.ok && !exact && newlyCrossed(sketch, opts.outlines)) (result.notes ??= []).unshift('Nothing else would meet that: the outline now crosses itself');
  // Only for a commit that asked for something: a solve of a sketch as it stands has nothing to tell.
  if (result.ok && seeds.size && crossed.some((f) => crossesItself(sketch, f))) (result.notes ??= []).unshift('The outline still crosses itself');
  return result;
}

/**
 * What a commit is about: every row the geometry does not meet, and what those rows name. A constraint is
 * about its curves. A dimension between the ends of one curve is about the curve, and one between points
 * of two is about those points alone.
 */
function seedsOf(sketch: Sketch, opts: SolveOptions, moving: Moving[]): Set<Id> {
  const rows = rowsOf(sketch, opts);
  const seeds = new Set<Id>(moving.map((m) => m.id));
  brokenOf(sketch, rows).forEach((id) => seeds.add(id));
  const world = makeWorld(sketch, opts.hold ?? [], opts.freeze?.points);
  for (const id of [...seeds]) {
    const k = sketch.constraints[id];
    const refs = k?.refs ?? sketch.dimensions[id]?.refs ?? [];
    refs.forEach((r) => seeds.add(r));
    if (k) ownCurves(world, refs).forEach((c) => seeds.add(c));
    const owners = new Set(refs.map((r) => sketch.points[r]?.owner));
    const [owner] = owners;
    if (!k && owners.size === 1 && owner !== undefined) seeds.add(owner);
  }
  return seeds;
}

/**
 * The last word on a commit, past every shortcut: a result that says OK is true of the geometry. A row
 * not met after all gets the plain solve, and failing that the sketch goes back and shows it in red.
 */
export function checked(sketch: Sketch, result: SolveResult, opts: SolveOptions, before: State): SolveResult {
  if (!result.ok) return result;
  const unmet = (): Id[] => brokenOf(sketch, rowsOf(sketch, opts), undefined, SHOWN_MET);
  if (unmet().length === 0) return result;
  restore(sketch, before);
  const plain = solveCore(sketch, { ...opts, branches: undefined, hold: undefined });
  const left = plain.ok ? unmet() : plain.unsatisfied;
  if (plain.ok && left.length === 0) return result;
  restore(sketch, before);
  return { ...result, ok: false, unsatisfied: left };
}

/** Every row that is in force: constraints, and driving dimensions. */
function rowsOf(sketch: Sketch, opts: SolveOptions): Set<Id> {
  const ids = [...Object.keys(sketch.constraints), ...Object.values(sketch.dimensions).filter((d) => d.driving && !d.feature).map((d) => d.id)];
  return new Set(ids.filter((id) => !opts.freeze?.broken.has(id)));
}

function finish(sketch: Sketch, opts: SolveOptions, out: SolverOutput, before: State, why?: string, edited = true, moved = false): SolveResult {
  // Offsets regenerate from what the solve leaves, so they answer to the same guard.
  const wrong = out.error === null ? why ?? damage(sketch, before, opts) ?? derivedDamage(sketch) : null;
  // Every seat of what was added has failed by now: what is in the way is what was already there.
  const refusal = wrong && !edited ? `it conflicts with the sketch as it stands: ${wrong}` : wrong;
  if (refusal) restore(sketch, before);
  const made = !refusal && out.error === null && out.ok ? regenerate?.(sketch) : undefined;
  const notes = Array.isArray(made) ? (made as string[]) : [];

  // What the status reads is the sketch itself. A solve that left bodies out, held something no row asks
  // for, or was moved on from afterwards has analysed something else.
  const whole = (opts.without || moved) && opts.analyze ? runSolver(toSolverInput(sketch, { analyze: true, freeze: opts.freeze })) : out;
  const { freeCurves, dof } = freedom(sketch, whole);
  const result: SolveResult = {
    ok: out.ok && !refusal,
    unsatisfied: out.unsatisfied,
    freePoints: new Set<Id>(whole.freePoints ?? []),
    freeCurves,
    dof,
  };
  if (out.error) result.error = out.error;
  if (refusal) result.refusal = refusal;
  if (notes.length) result.notes = notes;
  return result;
}

/** What a solve would report as unmet, with the conflict it belongs to. Reads the sketch, writes nothing. */
export function unmetOf(sketch: Sketch, opts: SolveOptions = {}): Id[] {
  return runSolver(toSolverInput(sketch, opts)).unsatisfied;
}

/** What is free and how much, as if no layer were frozen or locked. Reads the sketch, writes nothing. */
export function analyzeSketch(sketch: Sketch): Pick<SolveResult, 'dof' | 'freeCurves' | 'freePoints'> {
  const out = runSolver(toSolverInput(sketch, { analyze: true }));
  return { ...freedom(sketch, out), freePoints: new Set<Id>(out.freePoints ?? []) };
}

/** Of `ids`, the constraints and dimensions the geometry as it stands does not satisfy. */
export function brokenOf(sketch: Sketch, ids: Set<Id>, values?: Map<Id, number>, slack?: number): Id[] {
  if (ids.size === 0) return [];
  const input = { ...toSolverInput(sketch, { values }), slack };
  input.points = input.points.map((p) => ({ ...p, fixed: true }));
  input.curves = input.curves.map((c) => ({ ...c, fixed: true }));
  return runSolver(input).unsatisfied.filter((id) => ids.has(id));
}

/**
 * True when adding `dim` would over-constrain the sketch. A redundant dimension can be satisfied
 * at one exact value only, so the system is solved at the value and on either side of it: failing
 * on both sides means redundant or conflicting, where failing on just one is a geometric limit
 * (a triangle side at full stretch). Nothing is written back to the sketch.
 */
export function wouldOverConstrain(sketch: Sketch, dim: Dimension, freeze?: Freeze | null): boolean {
  const base = toSolverInput(sketch, { freeze });
  base.dimensions = base.dimensions.filter((d) => d.id !== dim.id);
  const already = new Set(runSolver(base).unsatisfied);
  const fails = (value: number): boolean => {
    const trial = { ...base, dimensions: [...base.dimensions, toSolverDimension({ ...dim, value })] };
    const out = runSolver(trial);
    return out.error !== null || out.unsatisfied.some((id) => !already.has(id));
  };
  if (fails(dim.value)) return true;
  const delta = dim.kind === 'angle' ? ANGLE_DELTA : Math.max(LENGTH_DELTA, Math.abs(dim.value) * 1e-3);
  return fails(dim.value + delta) && fails(dim.value - delta);
}
