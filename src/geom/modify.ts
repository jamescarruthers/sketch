// Sketch modification. Every operation mutates the given sketch and reports what it touched; run
// through `preview` to compute a result without touching the original. Design supplies ids and
// dimension names. Operations that reshape a curve keep its id but may replace its object, so re-read
// curves by id afterwards.
import type {
  Arc, Conic, Constraint, ControlSpline, Curve, Design, EllipticalArc, Feature, FitSpline, Id, Line, Sketch, SplineDegree, Vec2,
} from '../model/types';
import { ORIGIN } from '../model/types';
import {
  addArc, addConstraint, addControlSpline, addDimension, addLine, addPoint, allocId, coincidentClasses, copySelection,
  curveEnds, curvePoints, deleteEntities, getPointPos, hasPoint, literalExpression, pasteClipboard, type Clipboard,
} from '../model/document';
import { measureDimension } from '../model/parameters';
import { subConic } from './conic';
import {
  arcCurve, closestOnParam, curvatureAt, flattenParam, lineCurve, lineOf, resolve, reversed, unitTangent, type ParamCurve,
} from './curves';
import { intersect, selfIntersections } from './intersect';
import {
  changeDegree, clampedBSpline, fitControlPoints, localChord, tangentHandle, type BSpline,
} from './spline';
import {
  EPS_ANGLE, EPS_END_PARAM, EPS_JOIN, EPS_PARAM, EPS_PIECE, EPS_POINT, EPS_ZERO, FLATTEN_TOL,
} from './tolerance';
import {
  add, cross, dist, dot, len, lerp, norm, perp, reflect, rotateAbout, scale, sub, TAU, wrapAngle,
} from './vec';

export interface OpResult {
  created: Id[];
  changed: Id[];
  removed: Id[];
}

const emptyResult = (): OpResult => ({ created: [], changed: [], removed: [] });

/**
 * Run an operation on a throwaway copy. Returns the op's result plus the mutated copy, so a tool can
 * draw the outcome on hover without touching the document or consuming ids.
 */
export function preview<T>(design: Design, sketch: Sketch, op: (d: Design, s: Sketch) => T): { sketch: Sketch; result: T } {
  const copy = structuredClone(sketch);
  const d: Design = { ...design, sketches: { ...design.sketches, [sketch.id]: copy } };
  return { sketch: copy, result: op(d, copy) };
}

// ---------------------------------------------------------------------------
// Point and reference plumbing

/** Remove a point and anything constraining it. Explicit points stay, loose. */
function dropPoint(sketch: Sketch, id: Id, out: OpResult): void {
  const p = sketch.points[id];
  if (!p) return;
  if (p.explicit) {
    delete p.owner;
  } else {
    delete sketch.points[id];
    out.removed.push(id);
  }
  for (const k of Object.values(sketch.constraints)) {
    if (k.refs.includes(id)) {
      delete sketch.constraints[k.id];
      out.removed.push(k.id);
    }
  }
  for (const m of Object.values(sketch.dimensions)) {
    if (m.refs.includes(id)) {
      delete sketch.dimensions[m.id];
      out.removed.push(m.id);
    }
  }
}

function dropConstraint(sketch: Sketch, k: Constraint, out: OpResult): void {
  delete sketch.constraints[k.id];
  out.removed.push(k.id);
}

const ownerPoint = (design: Design, sketch: Sketch, owner: Id, pos: Vec2): Id => addPoint(design, sketch, pos, { owner }).id;

/**
 * A curve end moved to a new point, so dimensions on the old point follow it at the new measure. A
 * literal stays driving, holding the new geometry; a formula can no longer be honoured, so it goes
 * Driven. Trim and Extend use this: their dimension's reference survives, just somewhere else.
 */
function carryDimensions(sketch: Sketch, from: Id, to: Id): void {
  for (const d of Object.values(sketch.dimensions)) {
    if (!d.refs.includes(from)) continue;
    const literal = /^[+-]?[\d.]+\s*[a-z]*$/i.test(d.expression.trim());
    d.refs = d.refs.map((r) => (r === from ? to : r));
    const measured = measureDimension(sketch, d);
    if (measured === null) continue;
    d.value = measured;
    d.expression = literalExpression(d.kind, measured);
    if (!literal) d.driving = false;
  }
}

/** Editing a generated or source curve severs the feature rather than silently undoing the edit. */
function detachFromFeatures(sketch: Sketch, curveId: Id, out: OpResult): void {
  const dissolve = (f: Feature): void => {
    delete sketch.features[f.id];
    out.removed.push(f.id);
    if (f.type === 'offset') {
      for (const o of f.outputs) {
        const c = sketch.curves[o];
        if (c) delete c.derivedFrom;
      }
      if (f.dimension) {
        delete sketch.dimensions[f.dimension];
        out.removed.push(f.dimension);
      }
    }
    for (const k of Object.values(sketch.constraints)) if (k.feature === f.id) dropConstraint(sketch, k, out);
  };
  for (const f of Object.values(sketch.features)) {
    if (f.type === 'offset' && (f.sources.includes(curveId) || f.outputs.includes(curveId))) dissolve(f);
    else if ((f.type === 'rectPattern' || f.type === 'circPattern')) {
      if (f.sources.includes(curveId)) dissolve(f);
      else {
        for (const [key, ids] of Object.entries(f.instances)) {
          if (!ids.includes(curveId)) continue;
          f.instances[key] = ids.filter((i) => i !== curveId);
          for (const p of curvePoints(sketch.curves[curveId])) {
            for (const k of Object.values(sketch.constraints)) {
              if (k.feature === f.id && k.refs[k.refs.length - 1] === p) dropConstraint(sketch, k, out);
            }
          }
        }
      }
    } else if (f.type === 'mirror') {
      f.pairs = f.pairs.filter(([x, y]) => x !== curveId && y !== curveId);
    }
  }
}

// ---------------------------------------------------------------------------
// Finding cuts

interface Cut { t: number; other: Id | null; p: Vec2 }

const tolT = (pc: ParamCurve): number => {
  const s = pc.shape;
  const length = s.kind === 'line' ? dist(s.a, s.b) : 1;
  return Math.max(EPS_END_PARAM, EPS_POINT / Math.max(length, EPS_ZERO));
};

/** Which curves can cut or stop another. A hidden layer cannot, since it is not there to see. */
let cuts: (c: Curve) => boolean = () => true;

export function setCutterFilter(fn: (c: Curve) => boolean): void {
  cuts = fn;
}

/** Parameters on a curve where other sketch geometry crosses or touches it, ends excluded. */
function findCuts(sketch: Sketch, curve: Curve, pc: ParamCurve): Cut[] {
  const found: Cut[] = [];
  const eps = tolT(pc);
  for (const other of Object.values(sketch.curves)) {
    if (other.id === curve.id || other.type === 'text' || !cuts(other)) continue;
    for (const h of intersect(pc, resolve(sketch, other))) {
      if (pc.closed || (h.ta > eps && h.ta < 1 - eps)) found.push({ t: pc.closed ? h.ta % 1 : h.ta, other: other.id, p: h.p });
    }
  }
  for (const h of selfIntersections(pc)) {
    found.push({ t: h.t1, other: null, p: h.p }, { t: h.t2, other: null, p: h.p });
  }
  found.sort((a, b) => a.t - b.t);
  const out: Cut[] = [];
  for (const c of found) {
    const last = out[out.length - 1];
    if (!last || c.t - last.t > eps) out.push(c);
  }
  return out;
}

interface Span { lo: Cut | null; hi: Cut | null; t0: number; t1: number }

/** The stretch of curve around t between neighbouring cuts. Closed curves need two cuts to have one. */
function spanAround(pc: ParamCurve, cuts: Cut[], t: number): Span | null {
  if (cuts.length === 0) return null;
  if (pc.closed) {
    if (cuts.length < 2) return null;
    let i = cuts.length - 1;
    for (let k = 0; k < cuts.length; k++) if (cuts[k].t <= t) i = k;
    const lo = cuts[i];
    const hi = cuts[(i + 1) % cuts.length];
    const wrapped = hi.t <= lo.t;
    return { lo, hi, t0: lo.t, t1: wrapped ? hi.t + 1 : hi.t };
  }
  let lo: Cut | null = null;
  let hi: Cut | null = null;
  for (const c of cuts) {
    if (c.t <= t) lo = c;
    else if (!hi) hi = c;
  }
  return { lo, hi, t0: lo ? lo.t : 0, t1: hi ? hi.t : 1 };
}

// ---------------------------------------------------------------------------
// Splitting a curve into kept pieces

interface PieceRange { t0: number; t1: number; startCut?: Cut; endCut?: Cut }

interface Built { id: Id; start: Id; end: Id; range: PieceRange }

function fitParams(pts: Vec2[], closed: boolean): number[] {
  const n = pts.length;
  const chords: number[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) chords.push(dist(pts[i], pts[(i + 1) % n]));
  const total = chords.reduce((a, b) => a + b, 0) || 1;
  const out = [0];
  for (const c of chords) out.push(out[out.length - 1] + c / total);
  return out;
}

function buildFitPiece(
  design: Design, sketch: Sketch, curve: FitSpline, pc: ParamCurve, r: PieceRange, id: Id, oldEnds: Set<Id>,
): { start: Id; end: Id; pts: Id[]; handles: (Id | null)[] } {
  const positions = curve.pts.map((p) => getPointPos(sketch, p));
  const us = fitParams(positions, curve.closed);
  const n = curve.pts.length;
  const eps = EPS_END_PARAM;
  const inner: { id: Id; handle: Id | null }[] = [];
  const shift = curve.closed ? [0, 1] : [0];
  for (const off of shift) {
    for (let i = 0; i < n; i++) {
      const u = us[i] + off;
      if (u > r.t0 + eps && u < r.t1 - eps) inner.push({ id: curve.pts[i], handle: curve.handles[i] });
    }
  }
  const keepsStart = !curve.closed && r.t0 <= eps;
  const keepsEnd = !curve.closed && r.t1 >= 1 - eps;
  const start = keepsStart ? curve.pts[0] : ownerPoint(design, sketch, id, pc.at(r.t0));
  const end = keepsEnd ? curve.pts[n - 1] : ownerPoint(design, sketch, id, pc.at(r.t1));
  for (const pid of [start, end]) oldEnds.delete(pid);

  const nodes: { id: Id; handle: Id | null }[] = [
    { id: start, handle: keepsStart ? curve.handles[0] : null },
    ...inner,
    { id: end, handle: keepsEnd ? curve.handles[n - 1] : null },
  ];
  // A span holding no fit points would refit to a straight line, so seed it from the original shape.
  while (nodes.length < 4) {
    let widest = 0;
    let gap = -1;
    for (let i = 0; i + 1 < nodes.length; i++) {
      const g = dist(getPointPos(sketch, nodes[i].id), getPointPos(sketch, nodes[i + 1].id));
      if (g > gap) {
        gap = g;
        widest = i;
      }
    }
    const a = closestOnParam(pc, getPointPos(sketch, nodes[widest].id)).t;
    let b = closestOnParam(pc, getPointPos(sketch, nodes[widest + 1].id)).t;
    const lo = widest === 0 ? r.t0 : a;
    const hi = widest + 1 === nodes.length - 1 ? r.t1 : (b < lo ? (b += 1) : b);
    nodes.splice(widest + 1, 0, { id: ownerPoint(design, sketch, id, pc.at((lo + hi) / 2)), handle: null });
  }

  const pts = nodes.map((x) => x.id);
  const positionsOut = pts.map((p) => getPointPos(sketch, p));
  const handles = nodes.map((x) => x.handle);
  const setHandle = (index: number, t: number): void => {
    const tan = unitTangent(pc, t);
    const h = tangentHandle(positionsOut[index], tan, localChord(positionsOut, index, false));
    handles[index] = ownerPoint(design, sketch, id, h);
  };
  if (!keepsStart) setHandle(0, r.t0);
  if (!keepsEnd) setHandle(pts.length - 1, r.t1);
  for (const h of handles) if (h) sketch.points[h].owner = id;
  return { start, end, pts, handles };
}

function buildControlPiece(
  design: Design, sketch: Sketch, curve: ControlSpline, pc: ParamCurve, r: PieceRange, id: Id, oldEnds: Set<Id>,
): { start: Id; end: Id; pts: Id[] } {
  const f = flattenParam(pc, FLATTEN_TOL, r.t0, r.t1);
  const span = r.t1 - r.t0;
  const count = Math.max(curve.degree + 1, Math.ceil(curve.pts.length * span) + 1);
  // A polyline is its own exact piece: the cut ends and the corners between them. A fit would round it.
  const corners = curve.pts.map((_, i) => i / (curve.pts.length - 1)).filter((t) => t > r.t0 + EPS_PARAM && t < r.t1 - EPS_PARAM);
  const ctrl = curve.degree === 1 ? [r.t0, ...corners, r.t1].map((t) => pc.at(t)) : fitControlPoints(f.pts, curve.degree, count);
  const keepsStart = r.t0 <= EPS_PARAM;
  const keepsEnd = r.t1 >= 1 - EPS_PARAM;
  const start = keepsStart ? curve.pts[0] : ownerPoint(design, sketch, id, ctrl[0]);
  const end = keepsEnd ? curve.pts[curve.pts.length - 1] : ownerPoint(design, sketch, id, ctrl[ctrl.length - 1]);
  oldEnds.delete(start);
  oldEnds.delete(end);
  const mid = ctrl.slice(1, -1).map((p) => ownerPoint(design, sketch, id, p));
  return { start, end, pts: [start, ...mid, end] };
}

/** Replace a curve by pieces over parameter ranges. The first piece keeps the curve's id. */
function buildPieces(
  design: Design, sketch: Sketch, curve: Curve, pc: ParamCurve, ranges: PieceRange[], out: OpResult,
): Built[] {
  const oldPoints = new Set<Id>(curvePoints(curve));
  const built: Built[] = [];
  const keep = (id: Id): Id => {
    oldPoints.delete(id);
    return id;
  };
  ranges.forEach((r, index) => {
    const first = index === 0;
    const id = first ? curve.id : allocId(design, curve.id.replace(/\d+$/, ''));
    const base = { id, lineType: curve.lineType, layer: curve.layer, ...(curve.fixed ? { fixed: true } : {}), ...(curve.projected ? { projected: curve.projected } : {}) };
    const claim = (pid: Id): Id => {
      keep(pid);
      if (sketch.points[pid]) sketch.points[pid].owner = id;
      return pid;
    };
    const endPoint = (t: number, original: Id | null): Id => (original ? claim(original) : ownerPoint(design, sketch, id, pc.at(t)));
    const startsOriginal = (): boolean => !pc.closed && r.t0 <= EPS_PARAM;
    const endsOriginal = (): boolean => !pc.closed && r.t1 >= 1 - EPS_PARAM;

    switch (curve.type) {
      case 'line': {
        const a = endPoint(r.t0, startsOriginal() ? curve.a : null);
        const b = endPoint(r.t1, endsOriginal() ? curve.b : null);
        sketch.curves[id] = { ...base, type: 'line', a, b } as Line;
        built.push({ id, start: a, end: b, range: r });
        break;
      }
      case 'circle': case 'arc': {
        const c = first ? claim(curve.c) : ownerPoint(design, sketch, id, getPointPos(sketch, curve.c));
        const a = endPoint(r.t0, curve.type === 'arc' && startsOriginal() ? curve.a : null);
        const b = endPoint(r.t1, curve.type === 'arc' && endsOriginal() ? curve.b : null);
        sketch.curves[id] = { ...base, type: 'arc', c, a, b } as Arc;
        built.push({ id, start: a, end: b, range: r });
        break;
      }
      case 'ellipse': case 'ellipticalArc': {
        const copyPoint = (pid: Id): Id => (first ? claim(pid) : ownerPoint(design, sketch, id, getPointPos(sketch, pid)));
        const c = copyPoint(curve.c);
        const major = copyPoint(curve.major);
        const minor = copyPoint(curve.minor);
        const a = endPoint(r.t0, curve.type === 'ellipticalArc' && startsOriginal() ? curve.a : null);
        const b = endPoint(r.t1, curve.type === 'ellipticalArc' && endsOriginal() ? curve.b : null);
        sketch.curves[id] = { ...base, type: 'ellipticalArc', c, major, minor, a, b } as EllipticalArc;
        built.push({ id, start: a, end: b, range: r });
        break;
      }
      case 'fitSpline': {
        const piece = buildFitPiece(design, sketch, curve, pc, r, id, oldPoints);
        for (const pid of [...piece.pts, ...piece.handles]) if (pid) claim(pid);
        sketch.curves[id] = { ...base, type: 'fitSpline', pts: piece.pts, closed: false, handles: piece.handles } as FitSpline;
        built.push({ id, start: piece.start, end: piece.end, range: r });
        break;
      }
      case 'controlSpline': {
        const piece = buildControlPiece(design, sketch, curve, pc, r, id, oldPoints);
        for (const pid of piece.pts) claim(pid);
        sketch.curves[id] = { ...base, type: 'controlSpline', pts: piece.pts, degree: curve.degree } as ControlSpline;
        built.push({ id, start: piece.start, end: piece.end, range: r });
        break;
      }
      case 'conic': {
        const sc = pc.shape;
        if (sc.kind !== 'conic') throw new Error('conic shape expected');
        const part = subConic(sc.arc, r.t0, r.t1);
        const a = endPoint(r.t0, startsOriginal() ? curve.a : null);
        const b = endPoint(r.t1, endsOriginal() ? curve.b : null);
        const vp = first ? claim(curve.v) : ownerPoint(design, sketch, id, part.v);
        if (first) {
          sketch.points[vp].x = part.v.x;
          sketch.points[vp].y = part.v.y;
        }
        sketch.curves[id] = { ...base, type: 'conic', a, b, v: vp, rho: part.rho } as Conic;
        built.push({ id, start: a, end: b, range: r });
        break;
      }
      case 'text': throw new Error('text cannot be split');
    }
    if (first) out.changed.push(id);
    else out.created.push(id);
  });
  const ends = curveEnds(curve);
  for (const pid of oldPoints) {
    const heir = !ends ? null : pid === ends[0] ? built[0].start : pid === ends[1] ? built[built.length - 1].end : null;
    if (heir) carryDimensions(sketch, pid, heir);
    dropPoint(sketch, pid, out);
  }
  return built;
}

/** Tie a new end to whatever cut it: another curve's defining point if it is there, else the curve. */
function attachToCutter(design: Design, sketch: Sketch, point: Id, cut: Cut | undefined, out: OpResult): void {
  if (!cut?.other) return;
  const other = sketch.curves[cut.other];
  if (!other) return;
  const here = getPointPos(sketch, point);
  const twin = curvePoints(other).find((id) => {
    const isAxisPoint = other.type === 'ellipse' || other.type === 'ellipticalArc';
    const role = isAxisPoint && (id === other.major || id === other.minor);
    return !role && dist(getPointPos(sketch, id), here) < EPS_JOIN;
  });
  const k = addConstraint(design, sketch, 'coincident', twin ? [point, twin] : [point, cut.other]);
  out.created.push(k.id);
}

function pieceContaining(pc: ParamCurve, pieces: Built[], p: Vec2): Built | null {
  const c = closestOnParam(pc, p);
  if (c.dist > EPS_JOIN) return null;
  for (const b of pieces) {
    for (const off of pc.closed ? [0, 1] : [0]) {
      const t = c.t + off;
      if (t >= b.range.t0 - EPS_PIECE && t <= b.range.t1 + EPS_PIECE) return b;
    }
  }
  return null;
}

/** Contact between a curve and what it is tangent to, for deciding which piece keeps the constraint. */
function contactPoint(sketch: Sketch, pc: ParamCurve, otherId: Id): Vec2 | null {
  const other = sketch.curves[otherId];
  if (!other || other.type === 'text') return null;
  const op = resolve(sketch, other);
  const s = pc.shape;
  const so = op.shape;
  if (s.kind === 'arc' && so.kind === 'line') return touchPoint(op, s.c);
  if (s.kind === 'line' && so.kind === 'arc') return touchPoint(pc, so.c);
  if (s.kind === 'arc' && so.kind === 'arc') {
    const toward = sub(so.c, s.c);
    if (len(toward) < EPS_ZERO) return null;
    const external = Math.abs(len(toward) - (s.r + so.r)) <= Math.abs(len(toward) - Math.abs(s.r - so.r));
    const sign = external || s.r >= so.r ? 1 : -1;
    return add(s.c, scale(norm(toward), sign * s.r));
  }
  const hits = intersect(pc, op);
  return hits.length ? hits[0].p : null;
}

/**
 * Re-home constraints and dimensions on a curve that has been split. Curve-level constraints that say
 * something true of every piece stay on the first; those tied to a location move to the piece at that
 * location, or go if nothing is left there. Anything sized by the old length goes.
 */
function transferReferences(sketch: Sketch, oldId: Id, oldPc: ParamCurve, wasLine: boolean, pieces: Built[], out: OpResult): void {
  const retarget = (k: { refs: Id[] }, id: Id): void => {
    k.refs = k.refs.map((r) => (r === oldId ? id : r));
  };
  for (const k of Object.values(sketch.constraints)) {
    if (!k.refs.includes(oldId) || k.feature) continue;
    switch (k.type) {
      case 'coincident': {
        const other = k.refs.find((r) => r !== oldId) as Id;
        const piece = hasPoint(sketch, other) ? pieceContaining(oldPc, pieces, getPointPos(sketch, other)) : null;
        if (piece) retarget(k, piece.id);
        else dropConstraint(sketch, k, out);
        break;
      }
      case 'midpoint': {
        // A piece has a different middle, but the point still sits on it.
        const at = k.refs[0];
        const piece = hasPoint(sketch, at) ? pieceContaining(oldPc, pieces, getPointPos(sketch, at)) : null;
        const pos = piece ? getPointPos(sketch, at) : null;
        const atEnd = !!piece && !!pos && [piece.start, piece.end].some((e) => dist(getPointPos(sketch, e), pos) < EPS_JOIN);
        if (piece && !atEnd) {
          k.type = 'coincident';
          retarget(k, piece.id);
        } else dropConstraint(sketch, k, out);
        break;
      }
      case 'tangent': case 'curvature': {
        const other = k.refs.find((r) => r !== oldId) as Id;
        const at = contactPoint(sketch, oldPc, other);
        const piece = at ? pieceContaining(oldPc, pieces, at) : null;
        if (piece) retarget(k, piece.id);
        else dropConstraint(sketch, k, out);
        break;
      }
      case 'equal':
        if (wasLine) dropConstraint(sketch, k, out);
        break;
      case 'symmetric':
        if (k.refs[2] !== oldId) dropConstraint(sketch, k, out);
        break;
      default: break;
    }
  }
  for (const m of Object.values(sketch.dimensions)) {
    if (!m.refs.includes(oldId)) continue;
    if (m.kind === 'arcLength' || (m.kind === 'distance' && m.refs.length === 1)) {
      delete sketch.dimensions[m.id];
      out.removed.push(m.id);
    }
  }
}

/** Keep sibling pieces on the same underlying curve. */
function linkPieces(design: Design, sketch: Sketch, pieces: Built[], out: OpResult, concentric: boolean): void {
  const first = sketch.curves[pieces[0].id];
  const link = (type: Constraint['type'], refs: Id[]): void => {
    out.created.push(addConstraint(design, sketch, type, refs).id);
  };
  for (let i = 1; i < pieces.length; i++) {
    const c = sketch.curves[pieces[i].id];
    if (first.type === 'line' && c.type === 'line') link('collinear', [first.id, c.id]);
    else if (first.type === 'arc' && c.type === 'arc') {
      if (concentric) link('concentric', [first.id, c.id]);
      else link('coincident', [first.c, c.c]);
      link('equal', [first.id, c.id]);
    } else if (first.type === 'ellipticalArc' && c.type === 'ellipticalArc') {
      link('coincident', [first.c, c.c]);
      link('coincident', [first.major, c.major]);
      link('coincident', [first.minor, c.minor]);
    }
  }
}

function applyPieces(
  design: Design, sketch: Sketch, curve: Curve, pc: ParamCurve, ranges: PieceRange[], out: OpResult, concentric = false,
): Built[] {
  const wasLine = curve.type === 'line';
  detachFromFeatures(sketch, curve.id, out);
  const pieces = buildPieces(design, sketch, curve, pc, ranges, out);
  transferReferences(sketch, curve.id, pc, wasLine, pieces, out);
  linkPieces(design, sketch, pieces, out, concentric);
  return pieces;
}

// ---------------------------------------------------------------------------
// Trim, break

export interface SegmentPreview {
  /** Polyline of the affected segment. */
  pts: Vec2[];
  /** True when the whole curve is affected: trim deletes it. */
  whole: boolean;
}

/** The segment trim would remove for a pick, or null if the curve cannot be trimmed. */
export function trimPreview(sketch: Sketch, curveId: Id, pick: Vec2): SegmentPreview | null {
  const curve = sketch.curves[curveId];
  if (!curve || curve.type === 'text') return null;
  const pc = resolve(sketch, curve);
  const span = spanAround(pc, findCuts(sketch, curve, pc), closestOnParam(pc, pick).t);
  if (!span) return { pts: flattenParam(pc).pts, whole: true };
  return { pts: flattenParam(pc, FLATTEN_TOL, span.t0, span.t1).pts, whole: false };
}

/**
 * Remove the segment between the intersections either side of the pick; with none, delete the curve
 * [ref SKT-TRIM-EXTEND]. A full circle or ellipse needs two cuts to leave an arc. Surviving ends take a
 * coincident to the curve that cut them.
 */
export function trim(design: Design, sketch: Sketch, curveId: Id, pick: Vec2): OpResult {
  const out = emptyResult();
  const curve = sketch.curves[curveId];
  if (!curve || curve.type === 'text' || curve.projected || (curve.type === 'line' && curve.frameOf)) return out;
  const pc = resolve(sketch, curve);
  const span = spanAround(pc, findCuts(sketch, curve, pc), closestOnParam(pc, pick).t);
  if (!span || (!span.lo && !span.hi)) {
    const gone = deleteEntities(sketch, [curveId]);
    out.removed.push(...gone.curves, ...gone.points, ...gone.constraints, ...gone.dimensions, ...gone.features);
    return out;
  }
  const ranges: PieceRange[] = [];
  if (pc.closed) {
    ranges.push({ t0: span.t1 % 1, t1: (span.t1 % 1) + 1 - (span.t1 - span.t0), startCut: span.hi ?? undefined, endCut: span.lo ?? undefined });
  } else {
    if (span.lo) ranges.push({ t0: 0, t1: span.lo.t, endCut: span.lo });
    if (span.hi) ranges.push({ t0: span.hi.t, t1: 1, startCut: span.hi });
  }
  const pieces = applyPieces(design, sketch, curve, pc, ranges, out);
  for (const b of pieces) {
    attachToCutter(design, sketch, b.start, b.range.startCut, out);
    attachToCutter(design, sketch, b.end, b.range.endCut, out);
  }
  return out;
}

/** Trim every curve in a drag path, in order. */
export function trimMany(design: Design, sketch: Sketch, picks: { curve: Id; at: Vec2 }[]): OpResult {
  const out = emptyResult();
  for (const p of picks) {
    if (!sketch.curves[p.curve]) continue;
    const r = trim(design, sketch, p.curve, p.at);
    out.created.push(...r.created);
    out.changed.push(...r.changed);
    out.removed.push(...r.removed);
  }
  return out;
}

/** Where break would split for a pick: the segment between the surrounding intersections. */
export function breakPreview(sketch: Sketch, curveId: Id, pick: Vec2): SegmentPreview | null {
  const curve = sketch.curves[curveId];
  if (!curve || curve.type === 'text') return null;
  const pc = resolve(sketch, curve);
  const span = spanAround(pc, findCuts(sketch, curve, pc), closestOnParam(pc, pick).t);
  return span ? { pts: flattenParam(pc, FLATTEN_TOL, span.t0, span.t1).pts, whole: false } : null;
}

/** Split a curve at the intersections surrounding the pick [ref SKT-BREAK]. No intersection: no-op. */
export function breakCurve(design: Design, sketch: Sketch, curveId: Id, pick: Vec2): OpResult {
  const out = emptyResult();
  const curve = sketch.curves[curveId];
  if (!curve || curve.type === 'text' || curve.projected || (curve.type === 'line' && curve.frameOf)) return out;
  const pc = resolve(sketch, curve);
  const span = spanAround(pc, findCuts(sketch, curve, pc), closestOnParam(pc, pick).t);
  if (!span) return out;
  const ranges: PieceRange[] = [];
  if (pc.closed) {
    const lo = span.lo as Cut;
    const hi = span.hi as Cut;
    ranges.push({ t0: span.t0, t1: span.t1, startCut: lo, endCut: hi });
    ranges.push({ t0: span.t1, t1: span.t0 + 1, startCut: hi, endCut: lo });
  } else {
    if (span.lo) ranges.push({ t0: 0, t1: span.lo.t, endCut: span.lo });
    ranges.push({ t0: span.t0, t1: span.t1, startCut: span.lo ?? undefined, endCut: span.hi ?? undefined });
    if (span.hi) ranges.push({ t0: span.hi.t, t1: 1, startCut: span.hi });
  }
  const pieces = applyPieces(design, sketch, curve, pc, ranges, out, true);
  const count = pieces.length;
  const pairs = pc.closed ? count : count - 1;
  for (let i = 0; i < pairs; i++) {
    const a = pieces[i];
    const b = pieces[(i + 1) % count];
    out.created.push(addConstraint(design, sketch, 'coincident', [a.end, b.start]).id);
    attachToCutter(design, sketch, a.end, a.range.endCut, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extend

export interface ExtendTarget { end: 0 | 1; p: Vec2; other: Id }

function endRay(pc: ParamCurve, end: 0 | 1): ParamCurve {
  const t = unitTangent(pc, end);
  const dir = end === 1 ? t : scale(t, -1);
  const from = pc.at(end);
  return lineCurve(from, add(from, dir));
}

/** Where extending the end nearest the pick would land. */
export function extendTarget(sketch: Sketch, curveId: Id, pick: Vec2): ExtendTarget | null {
  const curve = sketch.curves[curveId];
  if (!curve || curve.type === 'text' || curve.type === 'conic' || curve.projected || (curve.type === 'line' && curve.frameOf)) return null;
  const pc = resolve(sketch, curve);
  if (pc.closed) return null;
  const end: 0 | 1 = closestOnParam(pc, pick).t < 0.5 ? 0 : 1;
  const s = pc.shape;
  let best: { amount: number; p: Vec2; other: Id } | null = null;
  const consider = (amount: number, p: Vec2, other: Id): void => {
    if (amount > EPS_POINT && (!best || amount < best.amount)) best = { amount, p, other };
  };

  for (const other of Object.values(sketch.curves)) {
    if (other.id === curveId || other.type === 'text' || !cuts(other)) continue;
    const op = resolve(sketch, other);
    if (s.kind === 'line') {
      const length = dist(s.a, s.b);
      for (const h of intersect(pc, op, { extendA: true })) {
        const amount = end === 1 ? (h.ta - 1) * length : -h.ta * length;
        if (amount > 0) consider(amount, h.p, other.id);
      }
    } else if (s.kind === 'arc' || s.kind === 'ellipse') {
      const span = Math.abs(s.sweep);
      for (const h of intersect(pc, op, { extendA: true })) {
        if (h.ta <= 1 + EPS_END_PARAM) continue;
        const past = (h.ta - 1) * span;
        const before = (TAU / span - h.ta) * span;
        consider(end === 1 ? past : before, h.p, other.id);
      }
    } else {
      const ray = endRay(pc, end);
      for (const h of intersect(ray, op, { extendA: true })) if (h.ta > 0) consider(h.ta, h.p, other.id);
    }
  }
  if (!best) return null;
  const b = best as { amount: number; p: Vec2; other: Id };
  return { end, p: b.p, other: b.other };
}

/** Replace a curve end with a fresh point at pos, shedding whatever tied the old end down. */
function replaceEnd(
  design: Design, sketch: Sketch, curve: Line | Arc | EllipticalArc | Conic, end: 0 | 1, pos: Vec2, out: OpResult, keepDimensions = false,
): Id {
  const old = end === 0 ? curve.a : curve.b;
  const fresh = ownerPoint(design, sketch, curve.id, pos);
  if (end === 0) curve.a = fresh;
  else curve.b = fresh;
  if (keepDimensions) carryDimensions(sketch, old, fresh);
  dropPoint(sketch, old, out);
  out.changed.push(curve.id);
  return fresh;
}

/** Extend the end nearest the pick to the next intersection [ref]. No intersection: no-op. */
export function extend(design: Design, sketch: Sketch, curveId: Id, pick: Vec2): OpResult {
  const out = emptyResult();
  const target = extendTarget(sketch, curveId, pick);
  if (!target) return out;
  const curve = sketch.curves[curveId];
  detachFromFeatures(sketch, curveId, out);
  let endPoint: Id;
  if (curve.type === 'line' || curve.type === 'arc' || curve.type === 'ellipticalArc') {
    endPoint = replaceEnd(design, sketch, curve, target.end, target.p, out, true);
  } else if (curve.type === 'fitSpline') {
    const old = target.end === 0 ? curve.pts[0] : curve.pts[curve.pts.length - 1];
    for (const k of Object.values(sketch.constraints)) if (k.refs.includes(old)) dropConstraint(sketch, k, out);
    endPoint = ownerPoint(design, sketch, curve.id, target.p);
    if (target.end === 0) {
      curve.pts.unshift(endPoint);
      curve.handles.unshift(null);
    } else {
      curve.pts.push(endPoint);
      curve.handles.push(null);
    }
    out.changed.push(curve.id);
  } else if (curve.type === 'controlSpline') {
    const pc = resolve(sketch, curve);
    const samples = flattenParam(pc).pts;
    if (target.end === 0) samples.unshift(target.p);
    else samples.push(target.p);
    // A polyline's last corner goes to the new end. The corners before it are not to be refitted.
    const ctrl = curve.degree === 1
      ? curve.pts.map((id, i) => (i === (target.end === 0 ? 0 : curve.pts.length - 1) ? target.p : getPointPos(sketch, id)))
      : fitControlPoints(samples, curve.degree, curve.pts.length);
    const moved = target.end === 0 ? curve.pts[0] : curve.pts[curve.pts.length - 1];
    for (const k of Object.values(sketch.constraints)) if (k.refs.includes(moved)) dropConstraint(sketch, k, out);
    curve.pts.forEach((id, i) => {
      sketch.points[id].x = ctrl[i].x;
      sketch.points[id].y = ctrl[i].y;
    });
    endPoint = moved;
    out.changed.push(curve.id);
  } else {
    return out;
  }
  attachToCutter(design, sketch, endPoint, { t: 0, other: target.other, p: target.p }, out);
  return out;
}

// ---------------------------------------------------------------------------
// Fillet

export interface FilletGeometry {
  center: Vec2;
  radius: number;
  /** Arc is counter-clockwise from start to end. */
  start: Vec2;
  end: Vec2;
}

interface FilletSolution {
  center: Vec2;
  pa: Vec2;
  pb: Vec2;
  /** Where the two meet, or would: what the picks are read against. */
  corner?: Vec2 | null;
}

function offsetOf(pc: ParamCurve, side: number, r: number): ParamCurve | null {
  const s = pc.shape;
  if (s.kind === 'line') {
    const n = scale(perp(norm(sub(s.b, s.a))), side * r);
    return lineCurve(add(s.a, n), add(s.b, n));
  }
  if (s.kind === 'arc') {
    const radius = s.r + side * r;
    return radius > EPS_POINT ? arcCurve(s.c, radius, 0, TAU) : null;
  }
  return null;
}

function touchPoint(pc: ParamCurve, c: Vec2): Vec2 {
  const s = pc.shape;
  if (s.kind === 'line') {
    const d = sub(s.b, s.a);
    return add(s.a, scale(d, dot(sub(c, s.a), d) / dot(d, d)));
  }
  if (s.kind === 'arc') return add(s.c, scale(norm(sub(c, s.c)), s.r));
  return c;
}

/**
 * Whether a contact lies on the part of a curve a corner keeps: the arm from the corner, real or
 * extended, toward the pick, no further than the end on that side. Closed curves stay whole.
 */
export function armHolds(pc: ParamCurve, corner: Vec2, pick: Vec2, contact: Vec2): boolean {
  if (pc.closed) return true;
  // A contact at the corner itself rounds nothing: that is two curves joined tangent.
  if (dist(contact, corner) <= EPS_POINT) return false;
  const s = pc.shape;
  if (s.kind === 'line') {
    const toward = sub(pick, corner);
    const end = dot(sub(s.a, corner), toward) >= dot(sub(s.b, corner), toward) ? s.a : s.b;
    return dot(sub(contact, corner), sub(end, corner)) > 0 && dist(contact, corner) <= dist(end, corner) + EPS_POINT;
  }
  if (s.kind !== 'arc') return true;
  const span = Math.abs(s.sweep);
  const signed = Math.sign(s.sweep) || 1;
  const param = (p: Vec2): number => wrapAngle(signed * (Math.atan2(p.y - s.c.y, p.x - s.c.x) - s.start)) / span;
  const slack = EPS_POINT / Math.max(s.r * span, EPS_POINT);
  const tc = param(corner);
  const tk = param(contact);
  const whole = TAU / span;
  // The contact sweeps from the corner to the arc's far end, without leaving the arc on the way.
  if (tc <= 1) return param(pick) >= tc ? tk >= tc - slack && tk <= 1 + slack : tk <= tc + slack;
  const afterEnd = tc - 1 < whole - tc;
  return afterEnd ? tk <= tc : tk >= tc || tk <= 1 + slack;
}

/** Whether a contact is on the pick's side of the corner. An arc goes by its sweep: its chords can point anywhere. */
function onPickSide(pc: ParamCurve, corner: Vec2, pick: Vec2, contact: Vec2): boolean {
  if (pc.shape.kind === 'arc' && !pc.closed) return armHolds(pc, corner, pick, contact);
  return dot(sub(contact, corner), sub(pick, corner)) > -EPS_ZERO;
}

/**
 * `at` is the corner when it is known, a picked vertex. Without one it is the crossing nearest the
 * picks, which on a line and a circle may not be where the two curves join.
 */
function solveFillet(A: ParamCurve, B: ParamCurve, r: number, pickA: Vec2, pickB: Vec2, at?: Vec2): FilletSolution | null {
  const middle = lerp(pickA, pickB, 0.5);
  const crossings = intersect(A, B, { extendA: true, extendB: true }).map((h) => h.p);
  crossings.sort((x, y) => dist(x, middle) - dist(y, middle));
  const corner = at ?? crossings[0] ?? null;
  const reach = corner && !A.closed && !B.closed
    ? (pa: Vec2, pb: Vec2) => dist(pa, corner) + dist(pb, corner)
    : (pa: Vec2, pb: Vec2) => dist(pa, pickA) + dist(pb, pickB);
  const candidates: { sol: FilletSolution; good: boolean; fits: boolean; score: number }[] = [];
  for (const sa of [1, -1]) {
    for (const sb of [1, -1]) {
      const oa = offsetOf(A, sa, r);
      const ob = offsetOf(B, sb, r);
      if (!oa || !ob) continue;
      for (const h of intersect(oa, ob, { extendA: true, extendB: true })) {
        const center = h.p;
        const pa = touchPoint(A, center);
        const pb = touchPoint(B, center);
        const good = corner !== null && onPickSide(A, corner, pickA, pa) && onPickSide(B, corner, pickB, pb);
        const fits = good && armHolds(A, corner, pickA, pa) && armHolds(B, corner, pickB, pb);
        candidates.push({ sol: { center, pa, pb }, good, fits, score: reach(pa, pb) });
      }
    }
  }
  const narrowed = [candidates.filter((c) => c.fits), candidates.filter((c) => c.good)].find((l) => l.length);
  const pool = narrowed ?? candidates;
  pool.sort((x, y) => x.score - y.score);
  return pool[0] ? { ...pool[0].sol, corner } : null;
}

function isParallelPair(A: ParamCurve, B: ParamCurve): boolean {
  const a = A.shape;
  const b = B.shape;
  if (a.kind !== 'line' || b.kind !== 'line') return false;
  const u = norm(sub(a.b, a.a));
  const w = norm(sub(b.b, b.a));
  return Math.abs(cross(u, w)) < EPS_ANGLE * 100;
}

/** The semicircle joining the picked ends of two parallel lines, at the end further out. */
function parallelFillet(A: ParamCurve, B: ParamCurve, pickA: Vec2, pickB: Vec2) {
  const a = A.shape as Extract<ParamCurve['shape'], { kind: 'line' }>;
  const b = B.shape as Extract<ParamCurve['shape'], { kind: 'line' }>;
  const endA: 0 | 1 = dist(a.a, pickA) < dist(a.b, pickA) ? 0 : 1;
  const endB: 0 | 1 = dist(b.a, pickB) < dist(b.b, pickB) ? 0 : 1;
  const pa0 = A.at(endA);
  const pb0 = B.at(endB);
  const dir = norm(sub(pa0, A.at(1 - endA)));
  const n = perp(dir);
  const gap = dot(sub(pb0, pa0), n);
  if (Math.abs(gap) < EPS_POINT) return null;
  const along = Math.max(0, dot(sub(pb0, pa0), dir));
  const pa = add(pa0, scale(dir, along));
  const pb = add(pa, scale(n, gap));
  const center = lerp(pa, pb, 0.5);
  return { center, pa, pb, endA, endB, radius: Math.abs(gap) / 2 };
}

function arcBetween(center: Vec2, pa: Vec2, pb: Vec2): { a: Vec2; b: Vec2; startsAtA: boolean } {
  return cross(sub(pa, center), sub(pb, center)) >= 0
    ? { a: pa, b: pb, startsAtA: true }
    : { a: pb, b: pa, startsAtA: false };
}

/** Fillet arc for two curves without changing anything. Null when impossible. */
export function filletPreview(sketch: Sketch, a: Id, b: Id, r: number, pickA: Vec2, pickB: Vec2, at?: Vec2): FilletGeometry | null {
  const ca = sketch.curves[a];
  const cb = sketch.curves[b];
  if (!ca || !cb) return null;
  const A = resolve(sketch, ca);
  const B = resolve(sketch, cb);
  if (isParallelPair(A, B)) {
    const p = parallelFillet(A, B, pickA, pickB);
    if (!p) return null;
    const dir = norm(sub(p.pa, A.at(1 - p.endA)));
    const ccw = cross(sub(p.pa, p.center), dir) > 0;
    return { center: p.center, radius: p.radius, start: ccw ? p.pa : p.pb, end: ccw ? p.pb : p.pa };
  }
  const sol = r > 0 ? solveFillet(A, B, r, pickA, pickB, at) : null;
  if (!sol) return null;
  const arc = arcBetween(sol.center, sol.pa, sol.pb);
  return { center: sol.center, radius: r, start: arc.a, end: arc.b };
}

/**
 * Shorten (or lengthen) a curve to a contact, keeping the arm from the corner toward the pick: the pick
 * says which side of the corner stays, however near the corner it is, and matters only where the curves
 * cross. Circles stay whole.
 */
function trimToContact(design: Design, sketch: Sketch, curve: Curve, pc: ParamCurve, contact: Vec2, pick: Vec2, corner: Vec2 | null, out: OpResult): Id | null {
  if (curve.type === 'circle') return null;
  if (curve.type !== 'line' && curve.type !== 'arc') throw new Error('fillet needs lines or arcs');
  const s = pc.shape;
  if (s.kind === 'line') {
    const d = sub(s.b, s.a);
    const tp = dot(sub(corner ?? contact, s.a), d) / dot(d, d);
    const tk = dot(sub(pick, s.a), d) / dot(d, d);
    return replaceEnd(design, sketch, curve, tk <= tp ? 1 : 0, contact, out);
  }
  if (s.kind !== 'arc') throw new Error('fillet needs lines or arcs');
  // A point held at the arc's middle has no place on the part that is left.
  for (const k of Object.values(sketch.constraints)) {
    if (k.type !== 'midpoint' || k.refs[1] !== curve.id) continue;
    delete sketch.constraints[k.id];
    if (sketch.points[k.refs[0]]?.owner === curve.id) delete sketch.points[k.refs[0]];
  }
  const span = Math.abs(s.sweep);
  const param = (p: Vec2): number => wrapAngle(Math.atan2(p.y - s.c.y, p.x - s.c.x) - s.start) / span;
  const tc = param(corner ?? contact);
  const tk = param(pick);
  let end: 0 | 1;
  if (tc > 1) end = tc - 1 < TAU / span - tc ? 1 : 0;
  else end = tk <= tc ? 1 : 0;
  return replaceEnd(design, sketch, curve, end, contact, out);
}

function joinFillet(
  design: Design, sketch: Sketch, arc: Arc, curve: Curve, arcEnd: Id, curveEnd: Id | null, out: OpResult,
): void {
  const pin = curveEnd ? [arcEnd, curveEnd] : [arcEnd, curve.id];
  out.created.push(addConstraint(design, sketch, 'coincident', pin).id);
  out.created.push(addConstraint(design, sketch, 'tangent', [arc.id, curve.id]).id);
}

/**
 * Round a corner between two lines or arcs [ref SKT-SKETCH-MODIFY-TOOLS]; the picks choose which side
 * of each curve survives. Adds the arc, tangents, end coincidents and a radius dimension; the old
 * corner coincident goes with the replaced ends. Parallel lines get a semicircle and r is ignored.
 * Returns an empty result if no such fillet exists.
 */
export function fillet(design: Design, sketch: Sketch, a: Id, b: Id, r: number, pickA: Vec2, pickB: Vec2, at?: Vec2): OpResult {
  const out = emptyResult();
  const ca = sketch.curves[a];
  const cb = sketch.curves[b];
  if (!ca || !cb || a === b || !(r > 0)) return out;
  const okTypes = new Set(['line', 'arc', 'circle']);
  if (!okTypes.has(ca.type) || !okTypes.has(cb.type) || ca.projected || cb.projected) return out;
  const A = resolve(sketch, ca);
  const B = resolve(sketch, cb);
  let center: Vec2;
  let pa: Vec2;
  let pb: Vec2;
  let radius = r;
  let replaceA: () => Id | null;
  let replaceB: () => Id | null;
  let driven = false;
  if (isParallelPair(A, B)) {
    const p = parallelFillet(A, B, pickA, pickB);
    if (!p) return out;
    ({ center, pa, pb, radius } = p);
    driven = Object.values(sketch.dimensions).some((m) => m.kind === 'lineLine' && m.refs.includes(a) && m.refs.includes(b));
    replaceA = () => replaceEnd(design, sketch, ca as Line, p.endA, pa, out);
    replaceB = () => replaceEnd(design, sketch, cb as Line, p.endB, pb, out);
  } else {
    const sol = solveFillet(A, B, r, pickA, pickB, at);
    if (!sol) return out;
    ({ center, pa, pb } = sol);
    replaceA = () => trimToContact(design, sketch, ca, A, pa, pickA, sol.corner ?? null, out);
    replaceB = () => trimToContact(design, sketch, cb, B, pb, pickB, sol.corner ?? null, out);
  }
  detachFromFeatures(sketch, a, out);
  detachFromFeatures(sketch, b, out);

  let oriented: { a: Vec2; b: Vec2; startsAtA: boolean };
  if (isParallelPair(A, B)) {
    const lineA = A.shape as Extract<ParamCurve['shape'], { kind: 'line' }>;
    const outward = norm(sub(pa, dist(lineA.a, pa) > dist(lineA.b, pa) ? lineA.a : lineA.b));
    const ccw = cross(sub(pa, center), outward) > 0;
    oriented = ccw ? { a: pa, b: pb, startsAtA: true } : { a: pb, b: pa, startsAtA: false };
  } else {
    oriented = arcBetween(center, pa, pb);
  }
  const endA = replaceA();
  const endB = replaceB();
  const arc = addArc(design, sketch, center, oriented.a, oriented.b, { lineType: ca.lineType });
  out.created.push(arc.id);
  joinFillet(design, sketch, arc, ca, oriented.startsAtA ? arc.a : arc.b, endA, out);
  joinFillet(design, sketch, arc, cb, oriented.startsAtA ? arc.b : arc.a, endB, out);
  const mid = add(center, scale(norm(sub(lerp(oriented.a, oriented.b, 0.5), center)), radius * 1.5));
  out.created.push(addDimension(design, sketch, 'radius', [arc.id], radius, { label: mid, driving: !driven }).id);
  return out;
}

/** Two curves meeting at a point, and a pick on each away from it. */
export function curvesAtVertex(sketch: Sketch, pointId: Id): { a: Id; b: Id; pickA: Vec2; pickB: Vec2 } | null {
  const rep = coincidentClasses(sketch);
  const r = rep(pointId);
  const at = getPointPos(sketch, pointId);
  const hits: { id: Id; end: 0 | 1 }[] = [];
  for (const c of Object.values(sketch.curves)) {
    const e = curveEnds(c);
    if (!e || c.type === 'text') continue;
    e.forEach((pid, i) => {
      if (rep(pid) === r || dist(getPointPos(sketch, pid), at) < EPS_POINT) hits.push({ id: c.id, end: i as 0 | 1 });
    });
  }
  if (hits.length !== 2 || hits[0].id === hits[1].id) return null;
  const pick = (h: { id: Id; end: 0 | 1 }): Vec2 => resolve(sketch, sketch.curves[h.id]).at(h.end === 0 ? 0.75 : 0.25);
  return { a: hits[0].id, b: hits[1].id, pickA: pick(hits[0]), pickB: pick(hits[1]) };
}

/** Fillet at a shared vertex. */
export function filletVertex(design: Design, sketch: Sketch, pointId: Id, r: number): OpResult {
  const v = curvesAtVertex(sketch, pointId);
  return v ? fillet(design, sketch, v.a, v.b, r, v.pickA, v.pickB, getPointPos(sketch, pointId)) : emptyResult();
}

/** Fillet several vertices with one shared radius: the arcs are equal, one dimension drives them. */
export function filletVertices(design: Design, sketch: Sketch, pointIds: Id[], r: number): OpResult {
  const out = emptyResult();
  let firstArc: Id | null = null;
  for (const p of pointIds) {
    if (!sketch.points[p]) continue;
    const res = filletVertex(design, sketch, p, r);
    const arc = res.created.find((id) => sketch.curves[id]?.type === 'arc');
    out.created.push(...res.created);
    out.changed.push(...res.changed);
    out.removed.push(...res.removed);
    if (!arc) continue;
    if (firstArc === null) {
      firstArc = arc;
      continue;
    }
    const dim = Object.values(sketch.dimensions).find((m) => m.kind === 'radius' && m.refs[0] === arc);
    if (dim) {
      delete sketch.dimensions[dim.id];
      out.created.splice(out.created.indexOf(dim.id), 1);
    }
    out.created.push(addConstraint(design, sketch, 'equal', [firstArc, arc]).id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chamfer

export type ChamferMode = 'equal' | 'twoDistance' | 'distanceAngle';

const MIN_LABEL_CLEARANCE = 4;

export interface ChamferGeometry { corner: Vec2; pa: Vec2; pb: Vec2 }

function solveChamfer(
  sketch: Sketch, a: Line, b: Line, mode: ChamferMode, d1: number, d2OrAngle: number | undefined,
  picks?: { a: Vec2; b: Vec2 },
): ChamferGeometry | null {
  const A = resolve(sketch, a);
  const B = resolve(sketch, b);
  const hit = intersect(A, B, { extendA: true, extendB: true })[0];
  if (!hit) return null;
  const corner = hit.p;
  const heading = (pc: ParamCurve, pick: Vec2 | undefined): Vec2 => {
    const s = pc.shape as Extract<ParamCurve['shape'], { kind: 'line' }>;
    const far = pick ?? (dist(s.a, corner) > dist(s.b, corner) ? s.a : s.b);
    const direction = norm(sub(s.b, s.a));
    return dot(sub(far, corner), direction) >= 0 ? direction : scale(direction, -1);
  };
  const ua = heading(A, picks?.a);
  const ub = heading(B, picks?.b);
  let second: number;
  if (mode === 'equal') second = d1;
  else if (mode === 'twoDistance') second = d2OrAngle ?? d1;
  else {
    const theta = d2OrAngle ?? Math.PI / 4;
    const phi = Math.acos(Math.min(1, Math.max(-1, dot(ua, ub))));
    const sinC = Math.sin(Math.PI - theta - phi);
    if (sinC <= EPS_ZERO) return null;
    second = (d1 * Math.sin(theta)) / sinC;
  }
  return { corner, pa: add(corner, scale(ua, d1)), pb: add(corner, scale(ub, second)) };
}

/** Chamfer end points for two lines without changing anything. */
export function chamferPreview(
  sketch: Sketch, a: Id, b: Id, mode: ChamferMode, d1: number, d2OrAngle?: number, picks?: { a: Vec2; b: Vec2 },
): ChamferGeometry | null {
  const ca = sketch.curves[a];
  const cb = sketch.curves[b];
  if (ca?.type !== 'line' || cb?.type !== 'line' || !(d1 > 0)) return null;
  return solveChamfer(sketch, ca, cb, mode, d1, d2OrAngle, picks);
}

/**
 * Bevel the vertex, intersection or extended intersection of two lines [ref]. A hidden corner point
 * stays on both lines so distances remain measurable. Equal mode's second dimension expression is the
 * first dimension's name; distanceAngle takes d2OrAngle as radians at the first line. picks choose
 * which side survives when lines actually cross; by default each line keeps its far end.
 */
export function chamfer(
  design: Design, sketch: Sketch, a: Id, b: Id, mode: ChamferMode, d1: number, d2OrAngle?: number,
  picks?: { a: Vec2; b: Vec2 },
): OpResult {
  const out = emptyResult();
  const ca = sketch.curves[a];
  const cb = sketch.curves[b];
  if (ca?.type !== 'line' || cb?.type !== 'line' || a === b || ca.projected || cb.projected || !(d1 > 0)) return out;
  const g = solveChamfer(sketch, ca, cb, mode, d1, d2OrAngle, picks);
  if (!g) return out;

  const shorten = (line: Line, target: Vec2): Id => {
    const pa = getPointPos(sketch, line.a);
    const pb = getPointPos(sketch, line.b);
    const away = sub(target, g.corner);
    const keepB = dot(sub(pb, target), away) >= dot(sub(pa, target), away);
    return replaceEnd(design, sketch, line, keepB ? 0 : 1, target, out);
  };
  detachFromFeatures(sketch, a, out);
  detachFromFeatures(sketch, b, out);
  const endA = shorten(ca, g.pa);
  const endB = shorten(cb, g.pb);
  const edge = addLine(design, sketch, g.pa, g.pb, { lineType: ca.lineType });
  out.created.push(edge.id);
  out.created.push(addConstraint(design, sketch, 'coincident', [edge.a, endA]).id);
  out.created.push(addConstraint(design, sketch, 'coincident', [edge.b, endB]).id);

  const corner = addPoint(design, sketch, g.corner, { owner: edge.id });
  corner.shown = true;
  out.created.push(corner.id);
  out.created.push(addConstraint(design, sketch, 'coincident', [corner.id, a]).id);
  out.created.push(addConstraint(design, sketch, 'coincident', [corner.id, b]).id);

  // Labels stand clear of the lines, on the outer side of each arm [ref SKT-ADD-CHAMFERS].
  const clear = (from: Vec2, end: Vec2, other: Vec2): Vec2 => {
    const n = perp(norm(sub(end, from)));
    const away = dot(n, sub(other, from)) > 0 ? scale(n, -1) : n;
    return add(lerp(from, end, 0.5), scale(away, Math.max(dist(from, end) * 0.6, MIN_LABEL_CLEARANCE)));
  };
  const first = addDimension(design, sketch, 'distance', [corner.id, edge.a], d1, { label: clear(g.corner, g.pa, g.pb) });
  out.created.push(first.id);
  if (mode === 'distanceAngle') {
    const u = sub(getPointPos(sketch, ca.b), getPointPos(sketch, ca.a));
    const w = sub(g.pb, g.pa);
    const theta = d2OrAngle ?? Math.PI / 4;
    const raw = Math.abs(Math.atan2(cross(u, w), dot(u, w)));
    const variant = Math.abs(raw - theta) <= Math.abs(Math.PI - raw - theta) ? 0 : 1;
    // Inside the angle it measures, so the arc has a radius to draw.
    const inside = norm(add(norm(sub(g.corner, g.pa)), norm(sub(g.pb, g.pa))));
    const label = add(g.pa, scale(inside, Math.max(dist(g.corner, g.pa) * 1.6, MIN_LABEL_CLEARANCE)));
    out.created.push(addDimension(design, sketch, 'angle', [a, edge.id], theta, { label, variant }).id);
  } else {
    const value = dist(g.corner, g.pb);
    const expression = mode === 'equal' ? first.name : undefined;
    out.created.push(addDimension(design, sketch, 'distance', [corner.id, edge.b], value, { expression, label: clear(g.corner, g.pb, g.pa) }).id);
  }
  return out;
}

/** Chamfer at a shared vertex. */
export function chamferVertex(design: Design, sketch: Sketch, pointId: Id, mode: ChamferMode, d1: number, d2OrAngle?: number): OpResult {
  const v = curvesAtVertex(sketch, pointId);
  return v ? chamfer(design, sketch, v.a, v.b, mode, d1, d2OrAngle) : emptyResult();
}

// ---------------------------------------------------------------------------
// Scale, move, copy

function selectedGeometry(sketch: Sketch, ids: Id[]): { curves: Set<Id>; points: Set<Id> } {
  const curves = new Set<Id>();
  const points = new Set<Id>();
  for (const id of ids) {
    if (sketch.curves[id]) curves.add(id);
    else if (sketch.points[id]) points.add(id);
  }
  for (const c of curves) for (const p of curvePoints(sketch.curves[c])) if (sketch.points[p]) points.add(p);
  return { curves, points };
}

/** Scale selected geometry about base [ref SKT-SCALE]. Dimensions wholly inside the selection follow. */
export function scaleGeometry(sketch: Sketch, ids: Id[], base: Vec2, factor: number): OpResult {
  const out = emptyResult();
  if (!(factor > 0)) return out;
  const { curves, points } = selectedGeometry(sketch, ids);
  for (const p of points) {
    const q = sketch.points[p];
    q.x = base.x + (q.x - base.x) * factor;
    q.y = base.y + (q.y - base.y) * factor;
  }
  for (const c of curves) {
    const curve = sketch.curves[c];
    if (curve.type === 'circle') curve.r *= factor;
    if (curve.type === 'text') curve.height *= factor;
    out.changed.push(c);
  }
  const inside = (r: Id): boolean => curves.has(r) || points.has(r);
  for (const m of Object.values(sketch.dimensions)) {
    if (m.kind === 'angle' || !m.refs.every(inside)) continue;
    m.value *= factor;
    m.label = { x: base.x + (m.label.x - base.x) * factor, y: base.y + (m.label.y - base.y) * factor };
    m.expression = /^[0-9.]+\s*mm$/.test(m.expression.trim())
      ? `${Number(m.value.toFixed(6))} mm`
      : `(${m.expression}) * ${Number(factor.toFixed(9))}`;
    out.changed.push(m.id);
  }
  return out;
}

export interface MoveSpec {
  /** Bring coincident partners along instead of cutting them loose. */
  stretch?: boolean;
  dx?: number;
  dy?: number;
  /** Radians about pivot. */
  angle?: number;
  /** Defaults to the origin. */
  pivot?: Vec2;
  copy?: boolean;
}

const moveFunction = (spec: MoveSpec): ((p: Vec2) => Vec2) => {
  const off = { x: spec.dx ?? 0, y: spec.dy ?? 0 };
  const pivot = spec.pivot ?? { x: 0, y: 0 };
  const angle = spec.angle ?? 0;
  return (p) => add(angle ? rotateAbout(p, pivot, angle) : p, off);
};

/** Where moveCopy would put each given position, for a live preview. */
export function moveCopyPreview(sketch: Sketch, ids: Id[], spec: MoveSpec, tol = FLATTEN_TOL): Vec2[][] {
  const f = moveFunction(spec);
  const { curves } = selectedGeometry(sketch, ids);
  return [...curves].map((c) => flattenParam(resolve(sketch, sketch.curves[c]), tol).pts.map(f));
}

/**
 * Move selected geometry, or with `copy` leave it and paste a transformed copy. A move sheds ties to
 * anything left behind; a rotation also sheds direction constraints it invalidates.
 */
export function moveCopy(design: Design, sketch: Sketch, ids: Id[], spec: MoveSpec): OpResult {
  const out = emptyResult();
  const f = moveFunction(spec);
  const rotated = Math.abs(spec.angle ?? 0) > EPS_ANGLE;
  if (spec.copy) {
    const clip = copySelection(sketch, ids);
    if (rotated) clip.constraints = clip.constraints.filter((k) => k.type !== 'horizontal' && k.type !== 'vertical');
    const r = pasteClipboard(design, sketch, clip, { place: f });
    out.created.push(...r.curves, ...r.points, ...r.constraints, ...r.dimensions);
    return out;
  }
  const { curves, points } = selectedGeometry(sketch, ids);
  for (const c of curves) detachFromFeatures(sketch, c, out);
  if (spec.stretch) {
    // Partners joined by a coincident come along, so what is left behind stretches rather than tears.
    const rep = coincidentClasses(sketch);
    const reps = new Set([...points].map((p) => rep(p)));
    const pinned = new Set(Object.values(sketch.points).filter((p) => p.fixed).map((p) => rep(p.id)));
    pinned.add(rep(ORIGIN));
    for (const q of Object.values(sketch.points)) {
      const r = rep(q.id);
      if (reps.has(r) && !pinned.has(r)) points.add(q.id);
    }
  }
  for (const p of points) {
    const q = sketch.points[p];
    const moved = f(q);
    q.x = moved.x;
    q.y = moved.y;
  }
  const inside = (r: Id): boolean => curves.has(r) || points.has(r);
  for (const k of Object.values(sketch.constraints)) {
    const n = k.refs.filter(inside).length;
    if (n === 0) continue;
    if (n < k.refs.length && k.type !== 'equal') dropConstraint(sketch, k, out);
    else if (rotated && (k.type === 'horizontal' || k.type === 'vertical')) dropConstraint(sketch, k, out);
  }
  for (const m of Object.values(sketch.dimensions)) {
    const n = m.refs.filter(inside).length;
    if (n > 0 && n < m.refs.length) {
      delete sketch.dimensions[m.id];
      out.removed.push(m.id);
    } else if (n > 0) {
      m.label = f(m.label);
    }
  }
  for (const c of curves) {
    const curve = sketch.curves[c];
    if (curve.fixed) delete curve.fixed;
    out.changed.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mirror

function mirrorAxis(sketch: Sketch, axis: Id): { p: Vec2; d: Vec2 } | null {
  const l = lineOf(sketch, axis);
  return l && len(l.d) > EPS_ZERO ? l : null;
}

/** Curves as the mirror would place them, as polylines. Null when the axis is not straight. */
export function mirrorPreview(sketch: Sketch, ids: Id[], axis: Id, tol = FLATTEN_TOL): Vec2[][] | null {
  const l = mirrorAxis(sketch, axis);
  if (!l) return null;
  const { curves } = selectedGeometry(sketch, ids);
  return [...curves].map((c) => flattenParam(resolve(sketch, sketch.curves[c]), tol).pts.map((p) => reflect(p, l.p, l.d)));
}

/** Reflection reverses direction, so arcs and frames re-order their ends to stay counter-clockwise. */
function restoreOrientation(curve: Curve): void {
  if (curve.type === 'arc' || curve.type === 'ellipticalArc') {
    const a = curve.a;
    curve.a = curve.b;
    curve.b = a;
  } else if (curve.type === 'text') {
    if (curve.frame) {
      const [p0, p1, p2, p3] = curve.frame;
      curve.frame = [p1, p0, p3, p2];
    }
    curve.flipH = !curve.flipH;
  }
}

/**
 * Mirror across a straight line or axis [ref]. Each copied point gets a symmetric constraint with its
 * original, one per coincident group; a point on the axis is joined to its copy instead. Circles add
 * equal. The geometry is then fully driven by the originals, so other internal constraints are not
 * duplicated.
 */
export function mirror(design: Design, sketch: Sketch, ids: Id[], axis: Id): OpResult {
  const out = emptyResult();
  const l = mirrorAxis(sketch, axis);
  if (!l) return out;
  const clip = copySelection(sketch, ids);
  const coincidents = clip.constraints.filter((k) => k.type === 'coincident' && k.refs.every((r) => clip.points.some((p) => p.id === r)));
  const onlyTies: Clipboard = { ...clip, constraints: coincidents, dimensions: [] };
  const pasted = pasteClipboard(design, sketch, onlyTies, { place: (p) => reflect(p, l.p, l.d) });
  out.created.push(...pasted.curves, ...pasted.points, ...pasted.constraints);
  for (const id of pasted.curves) restoreOrientation(sketch.curves[id]);

  const rep = coincidentClasses(sketch);
  const seen = new Set<Id>();
  for (const p of clip.points) {
    const copy = pasted.map.get(p.id) as Id;
    const r = rep(p.id);
    const pos = getPointPos(sketch, p.id);
    const onAxis = dist(reflect(pos, l.p, l.d), pos) < EPS_POINT * 2;
    if (onAxis) {
      out.created.push(addConstraint(design, sketch, 'coincident', [p.id, copy]).id);
      const already = Object.values(sketch.constraints).some(
        (k) => k.type === 'coincident' && k.refs.includes(p.id) && k.refs.includes(axis),
      );
      if (!already && !seen.has(r)) out.created.push(addConstraint(design, sketch, 'coincident', [p.id, axis]).id);
      seen.add(r);
    } else if (!seen.has(r)) {
      seen.add(r);
      out.created.push(addConstraint(design, sketch, 'symmetric', [p.id, copy, axis]).id);
    }
  }
  const pairs: [Id, Id][] = [];
  for (const c of clip.curves) {
    const copy = pasted.map.get(c.id) as Id;
    pairs.push([c.id, copy]);
    if (c.type === 'circle') out.created.push(addConstraint(design, sketch, 'equal', [c.id, copy]).id);
  }
  const feature: Feature = { id: allocId(design, 'f'), type: 'mirror', axis, pairs };
  sketch.features[feature.id] = feature;
  out.created.push(feature.id);
  return out;
}

// ---------------------------------------------------------------------------
// Patterns

export type RectPatternFeature = Extract<Feature, { type: 'rectPattern' }>;
export type CircPatternFeature = Extract<Feature, { type: 'circPattern' }>;
export type RectPatternParams = Omit<RectPatternFeature, 'id' | 'type' | 'instances' | 'suppressed'> & { suppressed?: string[] };
export type CircPatternParams = Omit<CircPatternFeature, 'id' | 'type' | 'instances' | 'suppressed'> & { suppressed?: string[] };

interface RectSlot { key: string; dx: number; dy: number }
interface CircSlot { key: string; angle: number }

function axisSteps(type: 'extent' | 'spacing', q: number, distance: number, direction: 'one' | 'symmetric'): { index: number; off: number }[] {
  const count = Math.max(1, Math.round(q));
  const step = type === 'spacing' ? distance : count > 1 ? distance / (count - 1) : 0;
  const out: { index: number; off: number }[] = [];
  const from = direction === 'symmetric' ? -(count - 1) : 0;
  for (let i = from; i < count; i++) out.push({ index: i, off: i * step });
  return out;
}

/** Instance slots excluding the source, unfiltered by suppression. Key "i,j". */
export function rectPatternSlots(p: RectPatternParams): RectSlot[] {
  const [d1, d2] = p.dirs;
  const u = norm(d1);
  const w = d2 ? norm(d2) : null;
  const first = axisSteps(p.distanceType, p.quantity[0], p.distance[0], p.direction[0]);
  const second = w ? axisSteps(p.distanceType, p.quantity[1], p.distance[1], p.direction[1]) : [{ index: 0, off: 0 }];
  const out: RectSlot[] = [];
  for (const a of first) {
    for (const b of second) {
      if (a.index === 0 && b.index === 0) continue;
      out.push({
        key: `${a.index},${b.index}`,
        dx: u.x * a.off + (w ? w.x * b.off : 0),
        dy: u.y * a.off + (w ? w.y * b.off : 0),
      });
    }
  }
  return out;
}

/** Instance slots excluding the source, unfiltered by suppression. Key is a signed step index. */
export function circPatternSlots(p: CircPatternParams): CircSlot[] {
  const n = Math.max(1, Math.round(p.quantity));
  const out: CircSlot[] = [];
  if (p.spacing === 'full') {
    for (let i = 1; i < n; i++) out.push({ key: `${i}`, angle: (TAU * i) / n });
  } else if (p.spacing === 'angle') {
    for (let i = 1; i < n; i++) out.push({ key: `${i}`, angle: n > 1 ? (p.angle * i) / (n - 1) : 0 });
  } else {
    const step = n > 1 ? p.angle / (n - 1) : 0;
    const half = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const offset = i - half;
      if (Math.abs(offset) < EPS_PARAM) continue;
      out.push({ key: `${offset}`, angle: offset * step });
    }
  }
  return out;
}

/** Polylines of every live instance, without changing anything. */
export function patternPreview(sketch: Sketch, p: RectPatternParams | CircPatternParams, tol = FLATTEN_TOL): Vec2[][] {
  const suppressed = new Set(p.suppressed ?? []);
  const base = [...selectedGeometry(sketch, p.sources).curves].map((c) => flattenParam(resolve(sketch, sketch.curves[c]), tol).pts);
  const out: Vec2[][] = [];
  if ('dirs' in p) {
    for (const s of rectPatternSlots(p)) {
      if (suppressed.has(s.key)) continue;
      for (const poly of base) out.push(poly.map((q) => ({ x: q.x + s.dx, y: q.y + s.dy })));
    }
  } else {
    const c = getPointPos(sketch, p.center);
    for (const s of circPatternSlots(p)) {
      if (suppressed.has(s.key)) continue;
      for (const poly of base) out.push(poly.map((q) => rotateAbout(q, c, s.angle)));
    }
  }
  return out;
}

function makeInstance(
  design: Design, sketch: Sketch, featureId: Id, sources: Id[], place: (p: Vec2) => Vec2,
  tie: (from: Id, to: Id) => void, out: OpResult,
): Id[] {
  const clip = copySelection(sketch, sources);
  const pasted = pasteClipboard(design, sketch, { ...clip, constraints: [], dimensions: [] }, { place });
  const ids = [...pasted.curves];
  for (const p of clip.points) {
    const copy = pasted.map.get(p.id) as Id;
    tie(p.id, copy);
    if (!p.owner) ids.push(copy);
  }
  for (const c of clip.curves) {
    if (c.type === 'circle') {
      addConstraint(design, sketch, 'equal', [c.id, pasted.map.get(c.id) as Id], { feature: featureId });
    }
  }
  out.created.push(...pasted.curves, ...pasted.points);
  return ids;
}

function instanceOwners(sketch: Sketch, f: RectPatternFeature | CircPatternFeature): Map<Id, string> {
  const map = new Map<Id, string>();
  for (const [key, ids] of Object.entries(f.instances)) {
    for (const id of ids) {
      const c = sketch.curves[id];
      if (c) for (const p of curvePoints(c)) map.set(p, key);
      else map.set(id, key);
    }
  }
  return map;
}

function removeInstance(sketch: Sketch, f: RectPatternFeature | CircPatternFeature, key: string, out: OpResult): void {
  const ids = f.instances[key] ?? [];
  delete f.instances[key];
  const gone = deleteEntities(sketch, ids);
  out.removed.push(...gone.curves, ...gone.points, ...gone.constraints);
}

/**
 * Bring a pattern's instances in line with its parameters. Surviving instances keep their ids and any
 * user constraints on them. Call after changing a feature's fields. Sources changing rebuilds all.
 */
export function regeneratePattern(design: Design, sketch: Sketch, featureId: Id): OpResult {
  const out = emptyResult();
  const f = sketch.features[featureId];
  if (!f || (f.type !== 'rectPattern' && f.type !== 'circPattern')) return out;
  const suppressed = new Set(f.suppressed);
  const owners = instanceOwners(sketch, f);

  if (f.type === 'rectPattern') {
    const slots = rectPatternSlots(f).filter((s) => !suppressed.has(s.key));
    const wanted = new Map(slots.map((s) => [s.key, s]));
    for (const key of Object.keys(f.instances)) if (!wanted.has(key)) removeInstance(sketch, f, key, out);
    for (const k of Object.values(sketch.constraints)) {
      if (k.feature !== f.id || k.type !== 'offsetCopy') continue;
      const key = owners.get(k.refs[1]);
      const slot = key ? wanted.get(key) : undefined;
      if (!slot || !sketch.constraints[k.id]) continue;
      k.dx = slot.dx;
      k.dy = slot.dy;
      const src = getPointPos(sketch, k.refs[0]);
      const q = sketch.points[k.refs[1]];
      if (q) {
        q.x = src.x + slot.dx;
        q.y = src.y + slot.dy;
      }
    }
    for (const s of slots) {
      if (f.instances[s.key]) continue;
      f.instances[s.key] = makeInstance(
        design, sketch, f.id, f.sources,
        (p) => ({ x: p.x + s.dx, y: p.y + s.dy }),
        (from, to) => {
          out.created.push(addConstraint(design, sketch, 'offsetCopy', [from, to], { dx: s.dx, dy: s.dy, feature: f.id }).id);
        },
        out,
      );
    }
  } else {
    const c = getPointPos(sketch, f.center);
    const slots = circPatternSlots(f).filter((s) => !suppressed.has(s.key));
    const wanted = new Map(slots.map((s) => [s.key, s]));
    for (const key of Object.keys(f.instances)) if (!wanted.has(key)) removeInstance(sketch, f, key, out);
    for (const k of Object.values(sketch.constraints)) {
      if (k.feature !== f.id || k.type !== 'rotatedCopy') continue;
      const key = owners.get(k.refs[2]);
      const slot = key ? wanted.get(key) : undefined;
      if (!slot || !sketch.constraints[k.id]) continue;
      k.angle = slot.angle;
      const q = sketch.points[k.refs[2]];
      const p = rotateAbout(getPointPos(sketch, k.refs[1]), c, slot.angle);
      if (q) {
        q.x = p.x;
        q.y = p.y;
      }
    }
    for (const s of slots) {
      if (f.instances[s.key]) continue;
      f.instances[s.key] = makeInstance(
        design, sketch, f.id, f.sources,
        (p) => rotateAbout(p, c, s.angle),
        (from, to) => {
          out.created.push(addConstraint(design, sketch, 'rotatedCopy', [f.center, from, to], { angle: s.angle, feature: f.id }).id);
        },
        out,
      );
    }
  }
  out.changed.push(f.id);
  return out;
}

/** Create a rectangular pattern. dirs default to whatever the caller passes; quantities include the original. */
export function rectPattern(design: Design, sketch: Sketch, params: RectPatternParams): { feature: Id; result: OpResult } {
  const f: RectPatternFeature = { ...params, id: allocId(design, 'f'), type: 'rectPattern', suppressed: params.suppressed ?? [], instances: {} };
  sketch.features[f.id] = f;
  return { feature: f.id, result: regeneratePattern(design, sketch, f.id) };
}

/** Create a circular pattern. quantity includes the original. */
export function circPattern(design: Design, sketch: Sketch, params: CircPatternParams): { feature: Id; result: OpResult } {
  const f: CircPatternFeature = { ...params, id: allocId(design, 'f'), type: 'circPattern', suppressed: params.suppressed ?? [], instances: {} };
  sketch.features[f.id] = f;
  return { feature: f.id, result: regeneratePattern(design, sketch, f.id) };
}

/** Dialog edit: apply changed parameters and regenerate. */
export function updatePattern(
  design: Design, sketch: Sketch, featureId: Id, patch: Partial<RectPatternParams> | Partial<CircPatternParams>,
): OpResult {
  const f = sketch.features[featureId];
  if (!f || (f.type !== 'rectPattern' && f.type !== 'circPattern')) return emptyResult();
  const out = emptyResult();
  if (patch.sources && patch.sources.join() !== f.sources.join()) {
    for (const key of Object.keys(f.instances)) removeInstance(sketch, f, key, out);
  }
  Object.assign(f, patch);
  const r = regeneratePattern(design, sketch, featureId);
  r.removed.push(...out.removed);
  return r;
}

/** Check or uncheck an instance in the canvas [ref]. */
export function setInstanceSuppressed(design: Design, sketch: Sketch, featureId: Id, key: string, suppressed: boolean): OpResult {
  const f = sketch.features[featureId];
  if (!f || (f.type !== 'rectPattern' && f.type !== 'circPattern')) return emptyResult();
  const has = f.suppressed.includes(key);
  if (suppressed && !has) f.suppressed.push(key);
  if (!suppressed && has) f.suppressed = f.suppressed.filter((k) => k !== key);
  return regeneratePattern(design, sketch, featureId);
}

// ---------------------------------------------------------------------------
// Blend

export type CurveEnd = 0 | 1;
export type BlendMode = 'G1' | 'G2';

function blendControls(pa: ParamCurve, pb: ParamCurve, mode: BlendMode): Vec2[] {
  const p = pa.at(1);
  const q = pb.at(1);
  const s = dist(p, q);
  const ta = unitTangent(pa, 1);
  const tb = unitTangent(pb, 1);
  if (mode === 'G1') return [p, add(p, scale(ta, s / 3)), add(q, scale(tb, s / 3)), q];
  const p1 = add(p, scale(ta, s / 5));
  const q1 = add(q, scale(tb, s / 5));
  const lift = (start: Vec2, one: Vec2, t: Vec2, k: number): Vec2 =>
    add(sub(scale(one, 2), start), scale(perp(t), (s * s * k) / 20));
  return [p, p1, lift(p, p1, ta, curvatureAt(pa, 1)), lift(q, q1, tb, curvatureAt(pb, 1)), q1, q];
}

function outgoing(sketch: Sketch, curve: Curve, end: CurveEnd): ParamCurve {
  const pc = resolve(sketch, curve);
  return end === 1 ? pc : reversed(pc);
}

/** Control points of the blend between two curve ends, without changing anything. */
export function blendPreview(sketch: Sketch, a: Id, aEnd: CurveEnd, b: Id, bEnd: CurveEnd, mode: BlendMode): BSpline | null {
  const ca = sketch.curves[a];
  const cb = sketch.curves[b];
  if (!ca || !cb) return null;
  return clampedBSpline(blendControls(outgoing(sketch, ca, aEnd), outgoing(sketch, cb, bEnd), mode), mode === 'G1' ? 3 : 5);
}

/**
 * Blend two curve ends [ref SKT-BLEND-CURVE] with a degree 3 (G1) or 5 (G2) single-span control spline.
 * Adds end coincidents and tangent or curvature constraints.
 */
export function blend(design: Design, sketch: Sketch, a: Id, aEnd: CurveEnd, b: Id, bEnd: CurveEnd, mode: BlendMode): OpResult {
  const out = emptyResult();
  const ca = sketch.curves[a];
  const cb = sketch.curves[b];
  if (!ca || !cb) return out;
  const endsA = curveEnds(ca);
  const endsB = curveEnds(cb);
  if (!endsA || !endsB) return out;
  const ctrl = blendControls(outgoing(sketch, ca, aEnd), outgoing(sketch, cb, bEnd), mode);
  const spline = addControlSpline(design, sketch, ctrl, mode === 'G1' ? 3 : 5);
  spline.blend = true;
  out.created.push(spline.id);
  const link = (end: Id, pid: Id, other: Id): void => {
    out.created.push(addConstraint(design, sketch, 'coincident', [pid, end]).id);
    out.created.push(addConstraint(design, sketch, mode === 'G1' ? 'tangent' : 'curvature', [spline.id, other]).id);
  };
  link(endsA[aEnd], spline.pts[0], a);
  link(endsB[bEnd], spline.pts[spline.pts.length - 1], b);
  return out;
}

// ---------------------------------------------------------------------------
// Spline edits

/** Change Spline Degree [ref]: refit with the same span count, so the control count follows. */
export function changeSplineDegree(design: Design, sketch: Sketch, curveId: Id, degree: SplineDegree): OpResult {
  const out = emptyResult();
  const curve = sketch.curves[curveId];
  if (curve?.type !== 'controlSpline' || curve.degree === degree) return out;
  const ctrl = changeDegree(curve.pts.map((p) => getPointPos(sketch, p)), curve.degree, degree);
  const n = ctrl.length;
  const kept = [curve.pts[0], curve.pts[curve.pts.length - 1]];
  const interiorOld = curve.pts.slice(1, -1);
  const interiorNew = ctrl.slice(1, -1);
  const reused = interiorOld.slice(0, interiorNew.length);
  for (const id of interiorOld.slice(interiorNew.length)) dropPoint(sketch, id, out);
  const ids = interiorNew.map((p, i) => {
    if (reused[i]) {
      sketch.points[reused[i]].x = p.x;
      sketch.points[reused[i]].y = p.y;
      return reused[i];
    }
    return ownerPoint(design, sketch, curveId, p);
  });
  curve.pts = [kept[0], ...ids, kept[1]];
  curve.degree = degree;
  sketch.points[kept[0]].x = ctrl[0].x;
  sketch.points[kept[0]].y = ctrl[0].y;
  sketch.points[kept[1]].x = ctrl[n - 1].x;
  sketch.points[kept[1]].y = ctrl[n - 1].y;
  out.changed.push(curveId);
  return out;
}

/** Insert a fit or control point at parameter t. Control splines refit with one more point. */
export function insertSplinePoint(design: Design, sketch: Sketch, curveId: Id, t: number): Id | null {
  const curve = sketch.curves[curveId];
  if (curve?.type === 'fitSpline') {
    const pc = resolve(sketch, curve);
    const us = fitParams(curve.pts.map((p) => getPointPos(sketch, p)), curve.closed);
    let at = 1;
    while (at < us.length - 1 && us[at] < t) at++;
    const id = ownerPoint(design, sketch, curveId, pc.at(t));
    curve.pts.splice(at, 0, id);
    curve.handles.splice(at, 0, null);
    return id;
  }
  if (curve?.type === 'controlSpline') {
    const pc = resolve(sketch, curve);
    const samples = flattenParam(pc).pts;
    const ctrl = fitControlPoints(samples, curve.degree, curve.pts.length + 1);
    const nearest = ctrl.reduce((best, p, i) => (dist(p, pc.at(t)) < dist(ctrl[best], pc.at(t)) ? i : best), 1);
    const at = Math.min(Math.max(nearest, 1), curve.pts.length - 1);
    const id = ownerPoint(design, sketch, curveId, ctrl[at]);
    curve.pts.splice(at, 0, id);
    curve.pts.forEach((pid, i) => {
      sketch.points[pid].x = ctrl[i].x;
      sketch.points[pid].y = ctrl[i].y;
    });
    return id;
  }
  return null;
}
