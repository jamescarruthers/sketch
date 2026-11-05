// Operations on Design and Sketch. Geometry-free: this module depends only on the data model.
// Mutating functions change the sketch in place; undo is snapshot based (see history.ts).
import type {
  Arc, Circle, Conic, Constraint, ConstraintType, ControlSpline, Curve, Design, Dimension, DimensionKind,
  Ellipse, EllipticalArc, Feature, FitSpline, Frame, Id, Layer, Line, LineType, Plane, Point, Sketch, SplineDegree, TextEntity,
  UserParameter, Vec2,
} from './types';
import { AXIS_X, AXIS_Y, DESIGN_VERSION, ORIGIN } from './types';
import { planeFrame } from './frames';

export const isReservedId = (id: Id): boolean => id === ORIGIN || id === AXIS_X || id === AXIS_Y;

/** Allocate a design-unique id, e.g. "l12". */
export function allocId(design: Design, prefix: string): Id {
  return `${prefix}${design.nextId++}`;
}

export const DEFAULT_LAYER_ID = 'layer-1';
/** A slate, so a plain layer does not read as the status colours: free blue, constrained black. */
export const DEFAULT_LAYER_COLOR = '#5f7186';

export const defaultLayer = (): Layer => ({ id: DEFAULT_LAYER_ID, name: 'Layer 1', color: DEFAULT_LAYER_COLOR, visible: true, locked: false });

export function newDesign(name = 'Untitled'): Design {
  return {
    version: DESIGN_VERSION, name, sketches: {}, order: [], parameters: [], units: 'mm', nextId: 1,
    layers: [defaultLayer()], activeLayer: DEFAULT_LAYER_ID,
  };
}

/** Create a sketch on an origin plane or any frame, append it to the design and return it. */
export function newSketch(design: Design, plane: Plane | Frame = 'XY', name?: string): Sketch {
  const id = allocId(design, 's');
  const sketch: Sketch = {
    id,
    name: name ?? `Sketch${design.order.length + 1}`,
    frame: typeof plane === 'string' ? planeFrame(plane) : structuredClone(plane),
    visible: true,
    points: {},
    curves: {},
    constraints: {},
    dimensions: {},
    features: {},
  };
  design.sketches[id] = sketch;
  design.order.push(id);
  return sketch;
}

/** Remove a sketch and any user-visible order entry for it. */
export function deleteSketch(design: Design, sketchId: Id): void {
  delete design.sketches[sketchId];
  design.order = design.order.filter((s) => s !== sketchId);
}

// ---------------------------------------------------------------------------
// Points

/** Resolve a point position, including the reserved origin. Throws on an unknown id. */
export function getPointPos(sketch: Sketch, id: Id): Vec2 {
  if (id === ORIGIN) return { x: 0, y: 0 };
  const p = sketch.points[id];
  if (!p) throw new Error(`Unknown point ${id}`);
  return { x: p.x, y: p.y };
}

export function hasPoint(sketch: Sketch, id: Id): boolean {
  return id === ORIGIN || sketch.points[id] !== undefined;
}

/** Add a point. Pass `explicit: true` for the Point tool. */
export function addPoint(
  design: Design, sketch: Sketch, pos: Vec2, opts: { explicit?: boolean; fixed?: boolean; owner?: Id } = {},
): Point {
  const p: Point = { id: allocId(design, 'p'), x: pos.x, y: pos.y };
  if (opts.explicit) p.explicit = true;
  if (opts.fixed) p.fixed = true;
  if (opts.owner) p.owner = opts.owner;
  else p.layer = design.activeLayer;
  sketch.points[p.id] = p;
  return p;
}

// ---------------------------------------------------------------------------
// Curves. Each takes positions, creates its own points, and returns the curve.

export interface CurveOpts { lineType?: LineType; derivedFrom?: Id }

function base<T extends Curve['type']>(design: Design, type: T, prefix: string, o: CurveOpts) {
  const out: { id: Id; type: T; lineType: LineType; layer: Id; derivedFrom?: Id } = {
    id: allocId(design, prefix), type, lineType: o.lineType ?? 'normal', layer: design.activeLayer,
  };
  if (o.derivedFrom) out.derivedFrom = o.derivedFrom;
  return out;
}

const own = (design: Design, sketch: Sketch, owner: Id, pos: Vec2): Id => addPoint(design, sketch, pos, { owner }).id;

export function addLine(design: Design, sketch: Sketch, a: Vec2, b: Vec2, opts: CurveOpts = {}): Line {
  const c = base(design, 'line', 'l', opts);
  const curve: Line = { ...c, a: own(design, sketch, c.id, a), b: own(design, sketch, c.id, b) };
  sketch.curves[c.id] = curve;
  return curve;
}

export function addCircle(design: Design, sketch: Sketch, center: Vec2, r: number, opts: CurveOpts = {}): Circle {
  const c = base(design, 'circle', 'c', opts);
  const curve: Circle = { ...c, c: own(design, sketch, c.id, center), r };
  sketch.curves[c.id] = curve;
  return curve;
}

/** Arc counter-clockwise from a to b about center. b is not re-projected onto the circle. */
export function addArc(design: Design, sketch: Sketch, center: Vec2, a: Vec2, b: Vec2, opts: CurveOpts = {}): Arc {
  const c = base(design, 'arc', 'a', opts);
  const curve: Arc = {
    ...c, c: own(design, sketch, c.id, center), a: own(design, sketch, c.id, a), b: own(design, sketch, c.id, b),
  };
  sketch.curves[c.id] = curve;
  return curve;
}

export function addEllipse(
  design: Design, sketch: Sketch, center: Vec2, major: Vec2, minor: Vec2, opts: CurveOpts = {},
): Ellipse {
  const c = base(design, 'ellipse', 'e', opts);
  const curve: Ellipse = {
    ...c, c: own(design, sketch, c.id, center), major: own(design, sketch, c.id, major),
    minor: own(design, sketch, c.id, minor),
  };
  sketch.curves[c.id] = curve;
  return curve;
}

export function addEllipticalArc(
  design: Design, sketch: Sketch, center: Vec2, major: Vec2, minor: Vec2, a: Vec2, b: Vec2, opts: CurveOpts = {},
): EllipticalArc {
  const c = base(design, 'ellipticalArc', 'ea', opts);
  const curve: EllipticalArc = {
    ...c, c: own(design, sketch, c.id, center), major: own(design, sketch, c.id, major),
    minor: own(design, sketch, c.id, minor), a: own(design, sketch, c.id, a), b: own(design, sketch, c.id, b),
  };
  sketch.curves[c.id] = curve;
  return curve;
}

export function addFitSpline(
  design: Design, sketch: Sketch, pts: Vec2[], closed = false, opts: CurveOpts = {},
): FitSpline {
  const c = base(design, 'fitSpline', 'fs', opts);
  const curve: FitSpline = {
    ...c, pts: pts.map((p) => own(design, sketch, c.id, p)), closed, handles: pts.map(() => null),
  };
  sketch.curves[c.id] = curve;
  return curve;
}

/** Activate, move or (with null) clear the tangent handle at fit point index. */
export function setFitHandle(design: Design, sketch: Sketch, spline: FitSpline, index: number, pos: Vec2 | null): void {
  const existing = spline.handles[index];
  if (pos === null) {
    if (existing) delete sketch.points[existing];
    spline.handles[index] = null;
  } else if (existing) {
    sketch.points[existing].x = pos.x;
    sketch.points[existing].y = pos.y;
  } else {
    spline.handles[index] = own(design, sketch, spline.id, pos);
  }
}

export function addControlSpline(
  design: Design, sketch: Sketch, pts: Vec2[], degree: SplineDegree = 5, opts: CurveOpts = {},
): ControlSpline {
  const c = base(design, 'controlSpline', 'cs', opts);
  const curve: ControlSpline = { ...c, pts: pts.map((p) => own(design, sketch, c.id, p)), degree };
  sketch.curves[c.id] = curve;
  return curve;
}

export function addConic(
  design: Design, sketch: Sketch, a: Vec2, b: Vec2, vertex: Vec2, rho: number, opts: CurveOpts = {},
): Conic {
  const c = base(design, 'conic', 'cn', opts);
  const curve: Conic = {
    ...c, a: own(design, sketch, c.id, a), b: own(design, sketch, c.id, b), v: own(design, sketch, c.id, vertex), rho,
  };
  sketch.curves[c.id] = curve;
  return curve;
}

export type TextFormat = Partial<Pick<TextEntity,
  'font' | 'bold' | 'italic' | 'spacing' | 'flipH' | 'flipV' | 'halign' | 'valign' | 'above' | 'fitToPath'>>;

const TEXT_DEFAULTS = {
  font: 'Inter', bold: false, italic: false, spacing: 0, flipH: false, flipV: false,
  halign: 'left', valign: 'bottom',
} as const;

/** Frame text. corners are ccw from bottom-left. */
export function addFrameText(
  design: Design, sketch: Sketch, text: string, height: number, corners: [Vec2, Vec2, Vec2, Vec2],
  format: TextFormat = {}, opts: CurveOpts = {},
): TextEntity {
  const c = base(design, 'text', 't', opts);
  const frame = corners.map((p) => own(design, sketch, c.id, p)) as [Id, Id, Id, Id];
  const curve: TextEntity = { ...TEXT_DEFAULTS, ...format, ...c, mode: 'frame', text, height, frame };
  sketch.curves[c.id] = curve;
  return curve;
}

export function addPathText(
  design: Design, sketch: Sketch, text: string, height: number, path: Id,
  format: TextFormat = {}, opts: CurveOpts = {},
): TextEntity {
  const c = base(design, 'text', 't', opts);
  const curve: TextEntity = {
    ...TEXT_DEFAULTS, above: true, fitToPath: false, ...format, ...c, mode: 'path', text, height, path,
  };
  sketch.curves[c.id] = curve;
  return curve;
}

/** Every point a curve references, whatever the role. */
export function curvePoints(curve: Curve): Id[] {
  switch (curve.type) {
    case 'line': return [curve.a, curve.b];
    case 'circle': return [curve.c];
    case 'arc': return [curve.c, curve.a, curve.b];
    case 'ellipse': return [curve.c, curve.major, curve.minor];
    case 'ellipticalArc': return [curve.c, curve.major, curve.minor, curve.a, curve.b];
    case 'fitSpline': return [...curve.pts, ...curve.handles.filter((h): h is Id => h !== null)];
    case 'controlSpline': return [...curve.pts];
    case 'conic': return [curve.a, curve.b, curve.v];
    case 'text': return curve.frame ? [...curve.frame] : [];
  }
}

/** Start and end point ids of an open curve; null for closed or endless curves. */
export function curveEnds(curve: Curve): [Id, Id] | null {
  switch (curve.type) {
    case 'line': case 'arc': case 'ellipticalArc': case 'conic': return [curve.a, curve.b];
    case 'fitSpline': return curve.closed ? null : [curve.pts[0], curve.pts[curve.pts.length - 1]];
    case 'controlSpline': return [curve.pts[0], curve.pts[curve.pts.length - 1]];
    default: return null;
  }
}

/** Set a line type on curves. */
export function setLineType(sketch: Sketch, ids: Id[], lineType: LineType): void {
  for (const id of ids) {
    const c = sketch.curves[id];
    if (c && !c.projected) c.lineType = lineType;
  }
}

/** Normal becomes construction; anything else becomes normal. */
export function toggleConstruction(sketch: Sketch, ids: Id[]): void {
  for (const id of ids) {
    const c = sketch.curves[id];
    if (c && !c.projected) c.lineType = c.lineType === 'normal' ? 'construction' : 'normal';
  }
}

// ---------------------------------------------------------------------------
// Constraints and dimensions

export function addConstraint(
  design: Design, sketch: Sketch, type: ConstraintType, refs: Id[],
  extra: Partial<Pick<Constraint, 'dx' | 'dy' | 'angle' | 'variant' | 'feature'>> = {},
): Constraint {
  const c: Constraint = { id: allocId(design, 'k'), type, refs: [...refs], ...extra };
  sketch.constraints[c.id] = c;
  return c;
}

/** First unused dN name across the whole document, including user parameters. */
function nextName(design: Design, prefix: 'd' | 'p'): string {
  let n = design.names?.[prefix] ?? 1;
  const names = [...design.parameters.map((p) => p.name), ...Object.values(design.sketches).flatMap((k) => Object.values(k.dimensions).map((d) => d.name))];
  for (const name of names) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(name);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  return `${prefix}${n}`;
}

/** The name the next dimension will get. Asking does not use it up. */
export const nextDimensionName = (design: Design): string => nextName(design, 'd');
/** The same for a user parameter. */
export const nextParameterName = (design: Design): string => nextName(design, 'p');

/** `name` is taken from now on, by whatever comes to have it and even after that has gone. */
export function claimName(design: Design, name: string): void {
  const m = /^([dp])(\d+)$/.exec(name);
  if (!m) return;
  const names = (design.names ??= { d: 1, p: 1 });
  const prefix = m[1] as 'd' | 'p';
  names[prefix] = Math.max(names[prefix], Number(m[2]) + 1);
}

export interface DimensionInit {
  /** Defaults to the literal value in mm or degrees. */
  expression?: string;
  driving?: boolean;
  label?: Vec2;
  variant?: number;
  feature?: Id;
  name?: string;
}

/** Literal expression for a value, formatted for reading back. */
export function literalExpression(kind: DimensionKind, value: number): string {
  const v = kind === 'angle' ? (value * 180) / Math.PI : value;
  const text = Number(v.toFixed(6)).toString();
  return kind === 'angle' ? `${text} deg` : `${text} mm`;
}

/** Add a dimension with an auto-allocated name. value is in mm or radians. */
export function addDimension(
  design: Design, sketch: Sketch, kind: DimensionKind, refs: Id[], value: number, init: DimensionInit = {},
): Dimension {
  const d: Dimension = {
    id: allocId(design, 'dim'),
    kind,
    refs: [...refs],
    name: init.name ?? nextDimensionName(design),
    expression: init.expression ?? literalExpression(kind, value),
    value,
    driving: init.driving ?? true,
    label: init.label ?? { x: 0, y: 0 },
  };
  if (init.variant !== undefined) d.variant = init.variant;
  if (init.feature) d.feature = init.feature;
  sketch.dimensions[d.id] = d;
  claimName(design, d.name);
  return d;
}

// ---------------------------------------------------------------------------
// Deletion

export interface Removed {
  points: Id[]; curves: Id[]; constraints: Id[]; dimensions: Id[]; features: Id[];
}

/** A point outliving its curve takes the curve's layer with it. */
const disown = (p: Point, layer: Id): void => {
  delete p.owner;
  p.layer = layer;
};

const pointsUsedByOthers = (sketch: Sketch, except: Set<Id>): Set<Id> => {
  const used = new Set<Id>();
  for (const c of Object.values(sketch.curves)) {
    if (!except.has(c.id)) for (const p of curvePoints(c)) used.add(p);
  }
  return used;
};

function featureRefs(f: Feature): Id[] {
  switch (f.type) {
    case 'rectPattern': case 'circPattern': return f.sources;
    case 'offset': return [...f.sources, ...f.outputs];
    case 'mirror': return f.pairs.flat();
  }
}

/** Drop a feature but keep its generated geometry as ordinary curves. */
function dissolveFeature(sketch: Sketch, id: Id, removed: Removed): void {
  const f = sketch.features[id];
  if (!f) return;
  delete sketch.features[id];
  removed.features.push(id);
  if (f.type === 'offset') {
    for (const o of f.outputs) {
      const c = sketch.curves[o];
      if (c) delete c.derivedFrom;
    }
  }
  for (const c of Object.values(sketch.constraints)) {
    if (c.feature === id) {
      delete sketch.constraints[c.id];
      removed.constraints.push(c.id);
    }
  }
  for (const d of Object.values(sketch.dimensions)) {
    if (d.feature === id) {
      delete sketch.dimensions[d.id];
      removed.dimensions.push(d.id);
    }
  }
}

/** Remove a spline fit or control point in place; false when the curve would become too short. */
function removeSplinePoint(sketch: Sketch, curve: Curve, pointId: Id): boolean {
  if (curve.type === 'fitSpline') {
    const i = curve.pts.indexOf(pointId);
    if (i >= 0) {
      if (curve.pts.length <= (curve.closed ? 3 : 2)) return false;
      const handle = curve.handles[i];
      if (handle) delete sketch.points[handle];
      curve.pts.splice(i, 1);
      curve.handles.splice(i, 1);
      return true;
    }
    const h = curve.handles.indexOf(pointId);
    if (h >= 0) {
      curve.handles[h] = null;
      return true;
    }
    return false;
  }
  if (curve.type === 'controlSpline' && curve.pts.includes(pointId)) {
    if (curve.pts.length <= curve.degree + 1) return false;
    curve.pts.splice(curve.pts.indexOf(pointId), 1);
    return true;
  }
  return false;
}

/**
 * Delete points, curves, constraints, dimensions and features, with cascades:
 * a curve takes its owned points (unless explicit or used elsewhere); anything referencing a removed
 * id goes too; deleting a curve's defining point deletes the curve, except spline points which shorten
 * it. Deleting an offset's dimension keeps the association; a feature losing a source is dissolved and
 * its generated geometry stays; a removed pattern instance is recorded as suppressed.
 */
export function deleteEntities(sketch: Sketch, ids: Id[]): Removed {
  const removed: Removed = { points: [], curves: [], constraints: [], dimensions: [], features: [] };
  const curveQueue: Id[] = [];
  const pointQueue: Id[] = [];

  for (const id of ids) {
    if (sketch.curves[id]) curveQueue.push(id);
    else if (sketch.points[id]) pointQueue.push(id);
    else if (sketch.constraints[id]) {
      delete sketch.constraints[id];
      removed.constraints.push(id);
    } else if (sketch.dimensions[id]) {
      delete sketch.dimensions[id];
      removed.dimensions.push(id);
    } else if (sketch.features[id]) dissolveFeature(sketch, id, removed);
  }

  for (const pid of pointQueue) {
    const owner = sketch.points[pid]?.owner;
    const curve = owner ? sketch.curves[owner] : undefined;
    if (curve && removeSplinePoint(sketch, curve, pid)) {
      delete sketch.points[pid];
      removed.points.push(pid);
    } else if (curve) {
      curveQueue.push(curve.id);
    } else if (sketch.points[pid]) {
      delete sketch.points[pid];
      removed.points.push(pid);
    }
  }

  const gone = new Set<Id>();
  while (curveQueue.length) {
    const id = curveQueue.pop() as Id;
    if (gone.has(id) || !sketch.curves[id]) continue;
    gone.add(id);
    for (const c of Object.values(sketch.curves)) {
      if (c.type === 'text' && c.path === id && !gone.has(c.id)) curveQueue.push(c.id);
    }
  }

  const stillUsed = pointsUsedByOthers(sketch, gone);
  const goneLayer = new Map([...gone].map((id) => [id, sketch.curves[id].layer]));
  for (const id of gone) {
    for (const pid of curvePoints(sketch.curves[id])) {
      const p = sketch.points[pid];
      if (!p) continue;
      if (stillUsed.has(pid)) {
        if (p.owner === id) disown(p, sketch.curves[id].layer);
      } else if (p.explicit) {
        disown(p, sketch.curves[id].layer);
      } else {
        delete sketch.points[pid];
        removed.points.push(pid);
      }
    }
    delete sketch.curves[id];
    removed.curves.push(id);
  }
  // Helper points owned by a curve but not part of its definition, e.g. a chamfer's virtual corner.
  for (const p of Object.values(sketch.points)) {
    if (!p.owner || !gone.has(p.owner)) continue;
    if (p.explicit) disown(p, goneLayer.get(p.owner) as Id);
    else {
      delete sketch.points[p.id];
      removed.points.push(p.id);
    }
  }

  for (const f of Object.values(sketch.features)) {
    const refsGone = featureRefs(f).filter((r) => gone.has(r));
    if (refsGone.length === 0) continue;
    if ((f.type === 'rectPattern' || f.type === 'circPattern') && !f.sources.some((s) => gone.has(s))) continue;
    if (f.type === 'mirror' && !gone.has(f.axis)) {
      f.pairs = f.pairs.filter(([x, y]) => !gone.has(x) && !gone.has(y));
      continue;
    }
    dissolveFeature(sketch, f.id, removed);
  }
  for (const f of Object.values(sketch.features)) {
    if (f.type === 'mirror' && gone.has(f.axis)) dissolveFeature(sketch, f.id, removed);
    if (f.type === 'rectPattern' || f.type === 'circPattern') {
      if (f.type === 'circPattern' && removed.points.includes(f.center)) {
        dissolveFeature(sketch, f.id, removed);
        continue;
      }
      for (const [key, inst] of Object.entries(f.instances)) {
        const left = inst.filter((c) => !gone.has(c));
        if (left.length === inst.length) continue;
        f.instances[key] = left;
        if (left.length === 0) {
          delete f.instances[key];
          if (!f.suppressed.includes(key)) f.suppressed.push(key);
        }
      }
    }
  }

  const dead = new Set<Id>([...removed.points, ...removed.curves]);
  for (const c of Object.values(sketch.constraints)) {
    if (c.refs.some((r) => dead.has(r))) {
      delete sketch.constraints[c.id];
      removed.constraints.push(c.id);
    }
  }
  for (const d of Object.values(sketch.dimensions)) {
    if (d.refs.some((r) => dead.has(r))) {
      delete sketch.dimensions[d.id];
      removed.dimensions.push(d.id);
    }
  }
  for (const f of Object.values(sketch.features)) {
    if (f.type === 'offset' && f.dimension && !sketch.dimensions[f.dimension]) f.dimension = null;
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Connectivity

/** Union-find over point-point coincident constraints. Returns a representative lookup. */
export function coincidentClasses(sketch: Sketch, skip?: Id): (id: Id) => Id {
  const parent = new Map<Id, Id>();
  const find = (a: Id): Id => {
    let r = a;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as Id;
    let x = a;
    while (parent.has(x) && parent.get(x) !== r) {
      const n = parent.get(x) as Id;
      parent.set(x, r);
      x = n;
    }
    return r;
  };
  for (const c of Object.values(sketch.constraints)) {
    if (c.type !== 'coincident' || c.refs.length !== 2 || c.id === skip) continue;
    const [a, b] = c.refs;
    if (!hasPoint(sketch, a) || !hasPoint(sketch, b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return find;
}

export interface ChainLink { curve: Id; reversed: boolean }
export interface Chain { links: ChainLink[]; closed: boolean }

/**
 * Walk from a curve through coincident end points in both directions, stopping at branches.
 * Closed curves are a chain of one. Result is ordered head to tail; `reversed` means the curve runs
 * end to start along the chain. Positions are not compared; pass `sameSpot` to also join curve ends
 * that touch without a constraint.
 */
export function findChain(sketch: Sketch, curveId: Id, sameSpot?: (a: Vec2, b: Vec2) => boolean): Chain {
  const first = sketch.curves[curveId];
  const empty: Chain = { links: [{ curve: curveId, reversed: false }], closed: true };
  if (!first) return { links: [], closed: false };
  if (!curveEnds(first)) return empty;

  const rep = coincidentClasses(sketch);
  const atNode = new Map<Id, { curve: Id; end: 0 | 1 }[]>();
  const repOf = new Map<Id, Id>();
  const ends: { id: Id; pos: Vec2; curve: Id; end: 0 | 1 }[] = [];
  for (const c of Object.values(sketch.curves)) {
    const e = curveEnds(c);
    if (!e || c.type === 'text') continue;
    e.forEach((pid, i) => ends.push({ id: pid, pos: getPointPos(sketch, pid), curve: c.id, end: i as 0 | 1 }));
  }
  for (const e of ends) repOf.set(e.id, rep(e.id));
  if (sameSpot) {
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        if (sameSpot(ends[i].pos, ends[j].pos)) {
          const from = repOf.get(ends[j].id) as Id;
          const to = repOf.get(ends[i].id) as Id;
          for (const [k, val] of repOf) if (val === from) repOf.set(k, to);
        }
      }
    }
  }
  for (const e of ends) {
    const r = repOf.get(e.id) as Id;
    const list = atNode.get(r) ?? [];
    list.push({ curve: e.curve, end: e.end });
    atNode.set(r, list);
  }

  const endNode = (id: Id, end: 0 | 1): Id => repOf.get((curveEnds(sketch.curves[id]) as [Id, Id])[end]) as Id;
  const seen = new Set<Id>([curveId]);
  const walk = (startNode: Id): ChainLink[] => {
    const out: ChainLink[] = [];
    let node = startNode;
    for (;;) {
      const next = (atNode.get(node) ?? []).filter((e) => !seen.has(e.curve));
      const total = (atNode.get(node) ?? []).length;
      if (next.length !== 1 || total !== 2) return out;
      const { curve, end } = next[0];
      seen.add(curve);
      out.push({ curve, reversed: end === 1 });
      node = endNode(curve, end === 0 ? 1 : 0);
    }
  };

  const forward = walk(endNode(curveId, 1));
  const backward = walk(endNode(curveId, 0));
  const links: ChainLink[] = [
    ...backward.reverse().map((l) => ({ curve: l.curve, reversed: !l.reversed })),
    { curve: curveId, reversed: false },
    ...forward,
  ];
  const head = links[0];
  const tail = links[links.length - 1];
  const headNode = endNode(head.curve, head.reversed ? 1 : 0);
  const tailNode = endNode(tail.curve, tail.reversed ? 0 : 1);
  const closed = headNode === tailNode && (atNode.get(headNode) ?? []).length === 2;
  return { links, closed };
}

// ---------------------------------------------------------------------------
// Copy and paste

export interface Clipboard {
  points: Point[];
  curves: Curve[];
  constraints: Constraint[];
  dimensions: Dimension[];
}

/** Expand a selection to the curves and points it implies (text path targets are not pulled in). */
function selectionClosure(sketch: Sketch, ids: Id[]): { curves: Set<Id>; points: Set<Id> } {
  const curves = new Set<Id>();
  const points = new Set<Id>();
  for (const id of ids) {
    if (sketch.curves[id]) curves.add(id);
    else if (sketch.points[id]) {
      const owner = sketch.points[id].owner;
      if (owner && sketch.curves[owner]) curves.add(owner);
      else points.add(id);
    }
  }
  for (const c of curves) for (const p of curvePoints(sketch.curves[c])) if (sketch.points[p]) points.add(p);
  return { curves, points };
}

/**
 * Snapshot a selection. Only constraints and dimensions whose refs are all inside the selection are
 * kept; references to the origin, axes or anything else outside are dropped. Features are not copied.
 */
export function copySelection(sketch: Sketch, ids: Id[]): Clipboard {
  const { curves, points } = selectionClosure(sketch, ids);
  const inside = (r: Id): boolean => curves.has(r) || points.has(r);
  const clip: Clipboard = {
    points: [...points].map((p) => sketch.points[p]),
    curves: [...curves].map((c) => sketch.curves[c]).filter((c) => c.type !== 'text' || !c.path || curves.has(c.path)),
    constraints: Object.values(sketch.constraints).filter((c) => !c.feature && c.refs.every(inside)),
    dimensions: Object.values(sketch.dimensions).filter((d) => !d.feature && d.refs.every(inside)),
  };
  return structuredClone(clip);
}

const REF_FIELDS = ['a', 'b', 'c', 'v', 'major', 'minor'] as const;

/** Rewrite a copied curve's point and path references through an id map. */
export function remapCurve(curve: Curve, map: Map<Id, Id>): Curve {
  const out = structuredClone(curve) as Curve & Record<string, unknown>;
  const m = (id: Id): Id => map.get(id) ?? id;
  for (const f of REF_FIELDS) {
    const val = out[f];
    if (typeof val === 'string') (out as Record<string, unknown>)[f] = m(val);
  }
  if (out.type === 'fitSpline') {
    out.pts = out.pts.map(m);
    out.handles = out.handles.map((h) => (h ? m(h) : null));
  } else if (out.type === 'controlSpline') out.pts = out.pts.map(m);
  else if (out.type === 'text') {
    if (out.frame) out.frame = out.frame.map(m) as [Id, Id, Id, Id];
    if (out.path) out.path = m(out.path);
  }
  return out;
}

export interface PasteResult { map: Map<Id, Id>; curves: Id[]; points: Id[]; constraints: Id[]; dimensions: Id[] }

/**
 * Paste a clipboard into a sketch. `place` maps each point position (default: translate by `offset`).
 * Copies lose projection links and derived status. Dimension names are reallocated, and expressions
 * naming a dimension from the same clipboard follow the rename.
 */
export function pasteClipboard(
  design: Design, sketch: Sketch, clip: Clipboard,
  opts: { offset?: Vec2; place?: (p: Vec2) => Vec2 } = {},
): PasteResult {
  const off = opts.offset ?? { x: 0, y: 0 };
  const place = opts.place ?? ((p: Vec2): Vec2 => ({ x: p.x + off.x, y: p.y + off.y }));
  const map = new Map<Id, Id>();
  const result: PasteResult = { map, curves: [], points: [], constraints: [], dimensions: [] };

  for (const c of clip.curves) {
    const prefix = c.id.replace(/\d+$/, '');
    map.set(c.id, allocId(design, prefix));
  }
  for (const p of clip.points) {
    const np = addPoint(design, sketch, place(p), { explicit: p.explicit, fixed: p.fixed });
    if (p.owner && map.has(p.owner)) np.owner = map.get(p.owner);
    map.set(p.id, np.id);
    result.points.push(np.id);
  }
  for (const c of clip.curves) {
    const nc = remapCurve(c, map);
    nc.id = map.get(c.id) as Id;
    delete nc.projected;
    delete nc.derivedFrom;
    nc.layer = design.activeLayer;
    sketch.curves[nc.id] = nc;
    result.curves.push(nc.id);
  }
  const m = (id: Id): Id => map.get(id) ?? id;
  for (const k of clip.constraints) {
    const { id: _old, type, refs, dependentLayer: _layer, ...extra } = k;
    result.constraints.push(addConstraint(design, sketch, type, refs.map(m), extra).id);
  }
  const renames = new Map<string, string>();
  for (const d of clip.dimensions) {
    const nd = addDimension(design, sketch, d.kind, d.refs.map(m), d.value, {
      expression: d.expression, driving: d.driving, label: place(d.label), variant: d.variant,
    });
    renames.set(d.name, nd.name);
    result.dimensions.push(nd.id);
  }
  for (const id of result.dimensions) {
    const d = sketch.dimensions[id];
    d.expression = d.expression.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (name) => renames.get(name) ?? name);
  }
  return result;
}

/** Add or replace a user parameter by name. */
export function setUserParameter(design: Design, param: UserParameter): void {
  const i = design.parameters.findIndex((p) => p.name === param.name);
  if (i >= 0) design.parameters[i] = param;
  else design.parameters.push(param);
  claimName(design, param.name);
}
