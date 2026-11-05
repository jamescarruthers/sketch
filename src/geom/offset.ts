// Offset of curves, chains and profiles. Lines and arcs stay analytic and join with mitres; ellipses
// give an ellipse or an oval [ref SKT-OFFSET]; splines and conics refit through offset samples.
import type { Curve, Design, Dimension, Ellipse, Feature, Id, Sketch, Vec2 } from '../model/types';
import { DESIGN_VERSION } from '../model/types';
import {
  addArc, addCircle, addConstraint, addDimension, addEllipse, addFitSpline, addLine, allocId, coincidentClasses, curveEnds,
  curvePoints, deleteEntities, getPointPos, literalExpression,
} from '../model/document';
import { arcCurve, closestOnParam, ellipseAngle, ellipseFrame, lengthOf, lineCurve, polylineCurve, resolve, reversed, unitTangent, type ParamCurve } from './curves';
import { intersect } from './intersect';
import type { OpResult } from './modify';
import { EPS_JOIN, EPS_PARAM, EPS_POINT } from './tolerance';
import { add, cross, dist, dot, norm, perp, scale, sub, TAU } from './vec';

/** Output geometry, free of ids. Arcs are counter-clockwise from a to b. */
export type OffsetGeom =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'arc'; c: Vec2; a: Vec2; b: Vec2 }
  | { type: 'circle'; c: Vec2; r: number }
  | { type: 'ellipse'; c: Vec2; major: Vec2; minor: Vec2 }
  | { type: 'fitSpline'; pts: Vec2[]; closed: boolean };

export type OffsetFeature = Extract<Feature, { type: 'offset' }>;
export type EllipseOffset = 'ellipse' | 'oval';

interface Link { curve: Curve; pc: ParamCurve }
interface OrderedChain { links: Link[]; closed: boolean }

/** Sort curves into chains by shared end points, through coincidents or exact position. */
export function orderChains(sketch: Sketch, ids: Id[]): OrderedChain[] {
  const rep = coincidentClasses(sketch);
  const open = ids.map((id) => sketch.curves[id]).filter((c): c is Curve => !!c && c.type !== 'text');
  const chains: OrderedChain[] = [];
  const same = (a: Id, b: Id): boolean => rep(a) === rep(b) || dist(getPointPos(sketch, a), getPointPos(sketch, b)) < EPS_JOIN;

  const closedOnes = open.filter((c) => !curveEnds(c));
  for (const c of closedOnes) chains.push({ links: [{ curve: c, pc: resolve(sketch, c) }], closed: true });

  const pool = open.filter((c) => curveEnds(c));
  const degreeAt = (id: Id): number => pool.reduce((n, c) => n + (curveEnds(c) as [Id, Id]).filter((e) => same(e, id)).length, 0);
  while (pool.length) {
    // Prefer starting at a free end so open chains run whole.
    let startIndex = pool.findIndex((c) => (curveEnds(c) as [Id, Id]).some((e) => degreeAt(e) === 1));
    if (startIndex < 0) startIndex = 0;
    const first = pool.splice(startIndex, 1)[0];
    const firstEnds = curveEnds(first) as [Id, Id];
    const startsFree = degreeAt(firstEnds[0]) === 0;
    const flipFirst = !startsFree && degreeAt(firstEnds[1]) === 0;
    const links: Link[] = [{ curve: first, pc: flipFirst ? reversed(resolve(sketch, first)) : resolve(sketch, first) }];
    const head = firstEnds[flipFirst ? 1 : 0];
    let tail = firstEnds[flipFirst ? 0 : 1];
    for (;;) {
      const i = pool.findIndex((c) => (curveEnds(c) as [Id, Id]).some((e) => same(e, tail)));
      if (i < 0) break;
      const next = pool.splice(i, 1)[0];
      const [s, e] = curveEnds(next) as [Id, Id];
      const forward = same(s, tail);
      links.push({ curve: next, pc: forward ? resolve(sketch, next) : reversed(resolve(sketch, next)) });
      tail = forward ? e : s;
    }
    chains.push({ links, closed: same(head, tail) });
  }
  return chains;
}

type Seg =
  | { kind: 'line'; a: Vec2; b: Vec2; dir: Vec2 }
  | { kind: 'arc'; c: Vec2; r: number; a: Vec2; b: Vec2; ccw: boolean }
  | { kind: 'pts'; pts: Vec2[] };

interface Placed { seg: Seg; vertex: Vec2 }

function segCurve(seg: Seg): ParamCurve {
  if (seg.kind === 'line') return lineCurve(seg.a, seg.b);
  if (seg.kind === 'pts') return polylineCurve(seg.pts, false);
  const a0 = Math.atan2(seg.a.y - seg.c.y, seg.a.x - seg.c.x);
  const a1 = Math.atan2(seg.b.y - seg.c.y, seg.b.x - seg.c.x);
  let sweep = a1 - a0;
  if (seg.ccw && sweep <= 0) sweep += TAU;
  if (!seg.ccw && sweep >= 0) sweep -= TAU;
  return arcCurve(seg.c, seg.r, a0, sweep);
}

const segStart = (s: Seg): Vec2 => (s.kind === 'pts' ? s.pts[0] : s.a);
const segEnd = (s: Seg): Vec2 => (s.kind === 'pts' ? s.pts[s.pts.length - 1] : s.b);

function setSegEnd(s: Seg, p: Vec2): void {
  if (s.kind !== 'pts') {
    s.b = p;
    return;
  }
  const t = closestOnParam(polylineCurve(s.pts, false), p).t;
  const keep = Math.max(1, Math.floor(t * (s.pts.length - 1) + EPS_PARAM) + 1);
  s.pts = [...s.pts.slice(0, keep), p];
}

function setSegStart(s: Seg, p: Vec2): void {
  if (s.kind !== 'pts') {
    s.a = p;
    return;
  }
  const t = closestOnParam(polylineCurve(s.pts, false), p).t;
  const from = Math.min(s.pts.length - 1, Math.ceil(t * (s.pts.length - 1) - EPS_PARAM));
  s.pts = [p, ...s.pts.slice(from)];
}

function sampleOffset(pc: ParamCurve, signedDistance: number, count: number): Vec2[] {
  const out: Vec2[] = [];
  const n = pc.closed ? count : count - 1;
  for (let i = 0; i <= n; i++) {
    if (pc.closed && i === n) break;
    const t = i / n;
    out.push(add(pc.at(t), scale(perp(unitTangent(pc, t)), signedDistance)));
  }
  return out;
}

const sampleCount = (pc: ParamCurve): number => {
  const s = pc.shape;
  const spans = s.kind === 'spline' ? s.spans : 4;
  return Math.min(49, Math.max(9, spans * 6 + 1));
};

/** The offset of one link, or null if an arc collapses through its centre. */
function offsetLink(pc: ParamCurve, signed: number): Seg | null {
  const s = pc.shape;
  if (s.kind === 'line') {
    const dir = norm(sub(s.b, s.a));
    const n = scale(perp(dir), signed);
    return { kind: 'line', a: add(s.a, n), b: add(s.b, n), dir };
  }
  if (s.kind === 'arc') {
    const ccw = s.sweep > 0;
    const r = s.r + (ccw ? -signed : signed);
    if (r <= EPS_POINT) return null;
    const ratio = r / s.r;
    const out = (p: Vec2): Vec2 => add(s.c, scale(sub(p, s.c), ratio));
    return { kind: 'arc', c: s.c, r, a: out(pc.at(0)), b: out(pc.at(1)), ccw };
  }
  return { kind: 'pts', pts: sampleOffset(pc, signed, sampleCount(pc)) };
}

function join(cur: Placed, next: Placed, distance: number): Placed | null {
  const p = segEnd(cur.seg);
  const q = segStart(next.seg);
  if (dist(p, q) < EPS_POINT) {
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    setSegEnd(cur.seg, m);
    setSegStart(next.seg, m);
    return null;
  }
  const A = segCurve(cur.seg);
  const B = segCurve(next.seg);
  const canExtend = (s: Seg): boolean => s.kind !== 'pts';
  const hits = intersect(A, B, { extendA: canExtend(cur.seg), extendB: canExtend(next.seg) });
  const vertex = cur.vertex;
  hits.sort((x, y) => dist(x.p, vertex) - dist(y.p, vertex));
  if (hits.length) {
    setSegEnd(cur.seg, hits[0].p);
    setSegStart(next.seg, hits[0].p);
    return null;
  }
  // Nothing to meet at, as with an arc shrinking away from a line: bridge around the corner.
  const ccw = cross(sub(p, vertex), sub(q, vertex)) > 0;
  return { seg: { kind: 'arc', c: vertex, r: Math.abs(distance), a: p, b: q, ccw }, vertex };
}

/** A segment turned inside out by the corners either side of it has vanished. */
function isInverted(p: Placed): boolean {
  const s = p.seg;
  if (s.kind === 'line') return dot(sub(s.b, s.a), s.dir) <= EPS_POINT;
  return false;
}

function emit(seg: Seg): OffsetGeom | null {
  if (seg.kind === 'line') return dist(seg.a, seg.b) < EPS_POINT ? null : { type: 'line', a: seg.a, b: seg.b };
  if (seg.kind === 'arc') {
    if (dist(seg.a, seg.b) < EPS_POINT) return null;
    return seg.ccw ? { type: 'arc', c: seg.c, a: seg.a, b: seg.b } : { type: 'arc', c: seg.c, a: seg.b, b: seg.a };
  }
  return { type: 'fitSpline', pts: seg.pts, closed: false };
}

/** Let a line run past its joined ends again, so neighbours of a dropped segment can meet it. */
function reopenJoints(placed: Placed[], closed: boolean, reach: number): void {
  placed.forEach((p, i) => {
    if (p.seg.kind !== 'line') return;
    if (closed || i > 0) p.seg.a = add(p.seg.a, scale(p.seg.dir, -reach));
    if (closed || i < placed.length - 1) p.seg.b = add(p.seg.b, scale(p.seg.dir, reach));
  });
}

/** A degree 1 spline is a run of straight legs, and its offset is theirs, corner to corner. */
function legsOf(l: Link): ParamCurve[] {
  if (l.curve.type !== 'controlSpline' || l.curve.degree !== 1) return [l.pc];
  const n = l.curve.pts.length - 1;
  return Array.from({ length: n }, (_, i) => lineCurve(l.pc.at(i / n), l.pc.at((i + 1) / n)));
}

function offsetChain(chain: OrderedChain, signed: number): OffsetGeom[] {
  let placed: Placed[] = [];
  for (const pc of chain.links.flatMap(legsOf)) {
    const seg = offsetLink(pc, signed);
    if (seg) placed.push({ seg, vertex: pc.at(1) });
  }
  const distance = Math.abs(signed);
  const reach = chain.links.reduce((t, l) => t + lengthOf(l.pc), distance) * 2;
  for (let round = 0; round <= chain.links.length; round++) {
    const next: Placed[] = [];
    const count = placed.length;
    const pairs = chain.closed ? count : count - 1;
    const bridges = new Map<number, Placed>();
    for (let i = 0; i < pairs && count > 1; i++) {
      const b = join(placed[i], placed[(i + 1) % count], distance);
      if (b) bridges.set(i, b);
    }
    let dropped = false;
    placed.forEach((p, i) => {
      if (isInverted(p)) dropped = true;
      else next.push(p);
      const b = bridges.get(i);
      if (b) next.push(b);
    });
    placed = next;
    if (!dropped) break;
    // The loop has collapsed: an inward offset larger than the shape leaves nothing.
    if (chain.closed && placed.filter((p) => p.seg.kind === 'line').length < 3 && placed.every((p) => p.seg.kind === 'line')) return [];
    reopenJoints(placed, chain.closed, reach);
  }
  const out = placed.map((p) => emit(p.seg)).filter((g): g is OffsetGeom => g !== null);
  // Flat on itself, as a rectangle offset by exactly half its height: nothing is left of the loop.
  return chain.closed && out.length < 3 && out.every((g) => g.type === 'line') ? [] : out;
}

function offsetEllipse(sketch: Sketch, curve: Ellipse, signed: number, mode: EllipseOffset): OffsetGeom | null {
  const pc = resolve(sketch, curve);
  if (mode === 'oval') return { type: 'fitSpline', pts: sampleOffset(pc, signed, 32), closed: true };
  const f = ellipseFrame(sketch, curve);
  const rx = f.rx - signed;
  const ry = f.ry - signed;
  if (rx <= EPS_POINT || ry <= EPS_POINT) return null;
  const u = { x: Math.cos(f.rot), y: Math.sin(f.rot) };
  return { type: 'ellipse', c: f.c, major: add(f.c, scale(u, rx)), minor: add(f.c, scale(perp(u), ry)) };
}

export interface ComputeOptions {
  ellipse?: EllipseOffset;
}

const BISECTIONS = 40;
const MIN_SLID_DISTANCE = 1e-2;
/** Shortest piece Match Topology will leave. Clear of the collapse guard, and big enough to see at any zoom. */
const MIN_PIECE = 1e-2;
/** A piece below this (mm) has collapsed, as the solver's guard counts it. */
const COLLAPSED = 1e-3;
/** The limit is rounded down to this, so the dimension reads what the geometry is. */
const LIMIT_STEP = 1e-3;

/** Curves in the source chains: what an offset has to keep to match their topology. */
const topologyOf = (sketch: Sketch, ids: Id[]): number => orderChains(sketch, ids).reduce((n, c) => n + c.links.length, 0);

/** The smallest size in a piece of output: a length, a radius, a semi-axis. */
function pieceSize(g: OffsetGeom): number {
  switch (g.type) {
    case 'line': return dist(g.a, g.b);
    case 'arc': return Math.min(dist(g.a, g.b), dist(g.c, g.a));
    case 'circle': return g.r;
    case 'ellipse': return Math.min(dist(g.c, g.major), dist(g.c, g.minor));
    case 'fitSpline': return Infinity;
  }
}

/**
 * Match Topology [ref SKT-SKETCH-MODIFY-TOOLS]: the largest distance up to `distance` where the offset
 * still has one piece per source curve, none of them collapsed. Past that a segment vanishes or
 * bridges appear, and at the limit itself the shortest piece has no length left, so the answer stops
 * just short of it.
 */
export function matchedDistance(sketch: Sketch, ids: Id[], distance: number, side: 1 | -1, opts: ComputeOptions = {}): number {
  const want = topologyOf(sketch, ids);
  const keeps = (d: number): boolean => {
    const geoms = computeOffset(sketch, ids, d, side, opts);
    return geoms.length === want && geoms.every((g) => pieceSize(g) >= MIN_PIECE);
  };
  if (keeps(distance)) return distance;
  let lo = 0;
  let hi = distance;
  for (let i = 0; i < BISECTIONS; i++) {
    const mid = (lo + hi) / 2;
    if (keeps(mid)) lo = mid;
    else hi = mid;
  }
  const rounded = Math.floor(lo / LIMIT_STEP) * LIMIT_STEP;
  return rounded > 0 && keeps(rounded) ? Number(rounded.toFixed(3)) : lo;
}

/**
 * Offset geometry for curves, by chain, without changing anything. side 1 is left of the direction of
 * travel: a chain runs from its free end; closed curves run counter-clockwise, so side 1 is inward.
 */
export function computeOffset(sketch: Sketch, ids: Id[], distance: number, side: 1 | -1, opts: ComputeOptions = {}): OffsetGeom[] {
  const signed = distance * side;
  const out: OffsetGeom[] = [];
  for (const chain of orderChains(sketch, ids)) {
    const only = chain.links[0].curve;
    if (chain.links.length === 1 && chain.closed && !curveEnds(only)) {
      if (only.type === 'circle') {
        const c = getPointPos(sketch, only.c);
        const r = only.r - signed;
        if (r > EPS_POINT) out.push({ type: 'circle', c, r });
      } else if (only.type === 'ellipse') {
        const g = offsetEllipse(sketch, only, signed, opts.ellipse ?? 'ellipse');
        if (g) out.push(g);
      } else {
        const pc = chain.links[0].pc;
        out.push({ type: 'fitSpline', pts: sampleOffset(pc, signed, sampleCount(pc)), closed: true });
      }
      continue;
    }
    out.push(...offsetChain(chain, signed));
  }
  return out;
}

/** Which side of a chain a point lies on, for turning a mouse position into `side`. */
export function offsetSideFromPick(sketch: Sketch, ids: Id[], pick: Vec2): 1 | -1 {
  let best = Infinity;
  let side: 1 | -1 = 1;
  for (const chain of orderChains(sketch, ids)) {
    for (const l of chain.links) {
      const hit = closestOnParam(l.pc, pick);
      if (hit.dist < best) {
        best = hit.dist;
        side = cross(unitTangent(l.pc, hit.t), sub(pick, hit.p)) >= 0 ? 1 : -1;
      }
    }
  }
  return side;
}

/** An offset with no dimension has a free distance: dragging its output slides it [ref SKT-OFFSET]. */
export function slideOffset(sketch: Sketch, f: OffsetFeature, from: Vec2, to: Vec2): void {
  const gap = (p: Vec2): number => {
    let best = Infinity;
    for (const chain of orderChains(sketch, f.sources)) {
      for (const l of chain.links) best = Math.min(best, closestOnParam(l.pc, p).dist);
    }
    return best;
  };
  f.distance = Math.max(MIN_SLID_DISTANCE, f.distance + gap(to) - gap(from));
}

/** True when a pick on an ellipse is close enough to an axis to keep the result an ellipse [ref]. */
export function ellipseOffsetMode(sketch: Sketch, curveId: Id, pick: Vec2): EllipseOffset {
  const c = sketch.curves[curveId];
  if (c?.type !== 'ellipse') return 'oval';
  const f = ellipseFrame(sketch, c);
  const a = ellipseAngle(f, pick);
  const quadrant = Math.PI / 2;
  const off = Math.abs(a - Math.round(a / quadrant) * quadrant);
  return off < (15 * Math.PI) / 180 ? 'ellipse' : 'oval';
}

function createOutput(design: Design, sketch: Sketch, g: OffsetGeom, featureId: Id, lineType: Curve['lineType']): Curve {
  const opts = { derivedFrom: featureId, lineType };
  switch (g.type) {
    case 'line': return addLine(design, sketch, g.a, g.b, opts);
    case 'arc': return addArc(design, sketch, g.c, g.a, g.b, opts);
    case 'circle': return addCircle(design, sketch, g.c, g.r, opts);
    case 'ellipse': return addEllipse(design, sketch, g.c, g.major, g.minor, opts);
    case 'fitSpline': return addFitSpline(design, sketch, g.pts, g.closed, opts);
  }
}

function tieOutputs(design: Design, sketch: Sketch, f: OffsetFeature): void {
  const curves = f.outputs.map((o) => sketch.curves[o]);
  for (let i = 0; i < curves.length; i++) {
    for (let j = 0; j < curves.length; j++) {
      if (i === j) continue;
      const ei = curveEnds(curves[i]);
      const ej = curveEnds(curves[j]);
      if (!ei || !ej) continue;
      if (dist(getPointPos(sketch, ei[1]), getPointPos(sketch, ej[0])) < EPS_JOIN) {
        addConstraint(design, sketch, 'coincident', [ei[1], ej[0]], { feature: f.id });
      } else if (i < j && dist(getPointPos(sketch, ei[1]), getPointPos(sketch, ej[1])) < EPS_JOIN) {
        addConstraint(design, sketch, 'coincident', [ei[1], ej[1]], { feature: f.id });
      } else if (i < j && dist(getPointPos(sketch, ei[0]), getPointPos(sketch, ej[0])) < EPS_JOIN) {
        addConstraint(design, sketch, 'coincident', [ei[0], ej[0]], { feature: f.id });
      }
    }
  }
}

export type OffsetMode = 'one' | 'two' | 'symmetric';

export interface OffsetOptions {
  mode?: OffsetMode;
  side?: 1 | -1;
  /** Second distance for mode 'two'. */
  distance2?: number;
  ellipse?: EllipseOffset;
  matchTopology?: boolean;
}

function makeFeature(
  design: Design, sketch: Sketch, ids: Id[], asked: number, side: 1 | -1, ellipse: EllipseOffset | undefined,
  expression: string | undefined, out: OpResult, matchTopology = false,
): OffsetFeature {
  const distance = matchTopology ? matchedDistance(sketch, ids, asked, side, { ellipse }) : asked;
  const geoms = computeOffset(sketch, ids, distance, side, { ellipse });
  const f: OffsetFeature = { id: allocId(design, 'f'), type: 'offset', sources: [...ids], distance, side, dimension: null, outputs: [] };
  if (matchTopology) f.matchTopology = true;
  sketch.features[f.id] = f;
  const lineType = sketch.curves[ids[0]]?.lineType ?? 'normal';
  for (const g of geoms) {
    const c = createOutput(design, sketch, g, f.id, lineType);
    f.outputs.push(c.id);
    out.created.push(c.id);
  }
  tieOutputs(design, sketch, f);
  if (f.outputs.length) {
    const dim = addDimension(design, sketch, 'distance', [ids[0], f.outputs[0]], distance, {
      feature: f.id, expression: distance === asked ? expression : undefined, label: getPointPos(sketch, curvePoints(sketch.curves[f.outputs[0]])[0]),
    });
    f.dimension = dim.id;
    out.created.push(dim.id);
  }
  out.created.push(f.id);
  return f;
}

/**
 * Offset as a feature [ref]: outputs carry derivedFrom, keep following their sources through
 * regenerateDerived, and an offset dimension drives the distance. 'two' and 'symmetric' make one
 * feature per side; symmetric's second dimension references the first by name.
 *
 * The offset dimension is `kind: 'distance'`, refs [source curve, output curve], with `feature` set.
 * Its value feeds regeneration, so the solver must not see it.
 */
export function offsetCurves(design: Design, sketch: Sketch, ids: Id[], distance: number, opts: OffsetOptions = {}): { features: Id[]; result: OpResult } {
  const out: OpResult = { created: [], changed: [], removed: [] };
  const mode = opts.mode ?? 'one';
  const side = opts.side ?? 1;
  const match = opts.matchTopology;
  const first = makeFeature(design, sketch, ids, distance, side, opts.ellipse, undefined, out, match);
  const features = [first.id];
  if (mode === 'two') {
    features.push(makeFeature(design, sketch, ids, opts.distance2 ?? distance, side === 1 ? -1 : 1, opts.ellipse, undefined, out, match).id);
  } else if (mode === 'symmetric') {
    const name = first.dimension ? sketch.dimensions[first.dimension].name : undefined;
    features.push(makeFeature(design, sketch, ids, distance, side === 1 ? -1 : 1, opts.ellipse, name, out, match).id);
  }
  return { features, result: out };
}

/** Restore a dimension on an offset whose dimension was deleted [ref]. */
export function addOffsetDimension(design: Design, sketch: Sketch, featureId: Id): Id | null {
  const f = sketch.features[featureId];
  if (f?.type !== 'offset' || f.dimension || !f.outputs.length) return null;
  const dim = addDimension(design, sketch, 'distance', [f.sources[0], f.outputs[0]], f.distance, { feature: f.id });
  f.dimension = dim.id;
  return dim.id;
}

function sameShape(sketch: Sketch, f: OffsetFeature, geoms: OffsetGeom[]): boolean {
  if (geoms.length !== f.outputs.length) return false;
  return geoms.every((g, i) => {
    const c = sketch.curves[f.outputs[i]];
    if (!c || c.type !== g.type) return false;
    return g.type !== 'fitSpline' || (c.type === 'fitSpline' && c.pts.length === g.pts.length && c.closed === g.closed);
  });
}

function place(sketch: Sketch, id: Id, p: Vec2): void {
  const q = sketch.points[id];
  q.x = p.x;
  q.y = p.y;
}

function assign(sketch: Sketch, curve: Curve, g: OffsetGeom): void {
  if (g.type === 'line' && curve.type === 'line') {
    place(sketch, curve.a, g.a);
    place(sketch, curve.b, g.b);
  } else if (g.type === 'arc' && curve.type === 'arc') {
    place(sketch, curve.c, g.c);
    place(sketch, curve.a, g.a);
    place(sketch, curve.b, g.b);
  } else if (g.type === 'circle' && curve.type === 'circle') {
    place(sketch, curve.c, g.c);
    curve.r = g.r;
  } else if (g.type === 'ellipse' && curve.type === 'ellipse') {
    place(sketch, curve.c, g.c);
    place(sketch, curve.major, g.major);
    place(sketch, curve.minor, g.minor);
  } else if (g.type === 'fitSpline' && curve.type === 'fitSpline') {
    curve.pts.forEach((id, i) => place(sketch, id, g.pts[i]));
  }
}

/** Regeneration runs inside a solve with only the sketch, so ids come from a range the design never reaches. */
function localDesign(sketch: Sketch, layer: Id): Design {
  let max = 1_000_000_000;
  for (const group of [sketch.points, sketch.curves, sketch.constraints]) {
    for (const id of Object.keys(group)) {
      const m = /\d+$/.exec(id);
      if (m) max = Math.max(max, Number(m[0]) + 1);
    }
  }
  return {
    version: DESIGN_VERSION, name: '', sketches: { [sketch.id]: sketch }, order: [sketch.id], parameters: [], units: 'mm', nextId: max,
    layers: [], activeLayer: layer,
  };
}

function rebuildOutputs(sketch: Sketch, f: OffsetFeature, geoms: OffsetGeom[]): void {
  const source = sketch.curves[f.outputs[0]] ?? sketch.curves[f.sources[0]];
  const scratch = localDesign(sketch, source.layer);
  const lineType = sketch.curves[f.outputs[0]]?.lineType ?? sketch.curves[f.sources[0]]?.lineType ?? 'normal';
  for (const k of Object.values(sketch.constraints)) if (k.feature === f.id) delete sketch.constraints[k.id];
  const dim = f.dimension ? sketch.dimensions[f.dimension] : null;
  const old = f.outputs.filter((o) => sketch.curves[o]);
  f.outputs = [];
  deleteEntities(sketch, old);
  // deleteEntities sees outputs vanish and dissolves the feature; this one lives on.
  sketch.features[f.id] = f;
  if (dim) {
    sketch.dimensions[dim.id] = dim;
    f.dimension = dim.id;
  }
  for (const g of geoms) f.outputs.push(createOutput(scratch, sketch, g, f.id, lineType).id);
  tieOutputs(scratch, sketch, f);
  if (dim && f.outputs.length) dim.refs = [f.sources[0], f.outputs[0]];
}

/** The ellipse mode a feature was made with, read back from what it made. */
function ellipseModeOf(sketch: Sketch, f: OffsetFeature): EllipseOffset {
  const outputEllipse = f.outputs.map((o) => sketch.curves[o]).some((c) => c?.type === 'ellipse');
  const hasOval = f.sources.some((s) => sketch.curves[s]?.type === 'ellipse') && !outputEllipse;
  return hasOval ? 'oval' : 'ellipse';
}

/** The distance this feature would regenerate at: its dimension's, cut to the limit if it has one. */
function regenerationDistance(sketch: Sketch, f: OffsetFeature, dim: Dimension | null): number {
  const asked = dim ? dim.value : f.distance;
  return f.matchTopology ? matchedDistance(sketch, f.sources, asked, f.side, { ellipse: ellipseModeOf(sketch, f) }) : asked;
}

/**
 * Why the offsets cannot be regenerated from the sketch as it stands, or null. Reads and writes
 * nothing: the bridge asks before regenerating, so a solve that would collapse an output goes back
 * like any other collapse rather than leaving the outputs broken.
 */
export function derivedDamage(sketch: Sketch): string | null {
  for (const f of Object.values(sketch.features)) {
    if (f.type !== 'offset' || !f.outputs.length || f.sources.some((id) => !sketch.curves[id])) continue;
    const dim = f.dimension ? sketch.dimensions[f.dimension] : null;
    const geoms = computeOffset(sketch, f.sources, regenerationDistance(sketch, f, dim), f.side, { ellipse: ellipseModeOf(sketch, f) });
    if (geoms.length === 0 || geoms.some((g) => pieceSize(g) < COLLAPSED)) return 'it would collapse an offset of this geometry';
  }
  return null;
}

/**
 * Recompute every offset's outputs from its sources and distance. Run after a solve (the bridge does);
 * point ids stay stable while the output's shape does. Pure with respect to everything else. Returns
 * a note for each Match Topology distance that had to come down to its limit, which is then what the
 * dimension says.
 */
export function regenerateDerived(sketch: Sketch): string[] {
  const notes: string[] = [];
  for (const f of Object.values(sketch.features)) {
    if (f.type !== 'offset') continue;
    if (f.sources.some((id) => !sketch.curves[id])) continue;
    const dim = f.dimension ? sketch.dimensions[f.dimension] : null;
    const asked = dim ? dim.value : f.distance;
    const ellipse = ellipseModeOf(sketch, f);
    f.distance = regenerationDistance(sketch, f, dim);
    if (dim && f.distance !== asked) {
      dim.value = f.distance;
      if (/^[\d.]+\s*\w*$/.test(dim.expression.trim())) dim.expression = literalExpression(dim.kind, f.distance);
      notes.push(matchLimitNote(f.distance));
    }
    const geoms = computeOffset(sketch, f.sources, f.distance, f.side, { ellipse });
    if (sameShape(sketch, f, geoms)) {
      geoms.forEach((g, i) => assign(sketch, sketch.curves[f.outputs[i]], g));
    } else {
      rebuildOutputs(sketch, f, geoms);
    }
  }
  return notes;
}

/** What to tell someone whose distance was cut. */
export const matchLimitNote = (limit: number): string =>
  `Match Topology limits this offset to ${limit} mm: any further and a segment would collapse`;
