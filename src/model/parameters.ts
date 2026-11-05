// Resolves user parameters and dimensions in dependency order across a whole design.
import type { Design, Dimension, Id, Sketch, UserParameter, Vec2 } from './types';
import { AXIS_X, AXIS_Y } from './types';
import { getPointPos } from './document';
import {
  evaluateExpression, expressionDeps, replaceNames, type ExprError, type ExprKind, type LengthUnit, type NameValue,
} from './expressions';

export { nextDimensionName } from './document';

const dimKind = (d: Dimension): ExprKind => (d.kind === 'angle' ? 'angle' : 'length');

export interface ParameterError { name: string; error: ExprError }

export interface ResolveReport {
  errors: ParameterError[];
  /** Ids of driving dimensions whose value changed. */
  changed: Id[];
}

type Node =
  | { kind: 'param'; name: string; deps: string[]; index: number }
  | { kind: 'dim'; name: string; deps: string[]; dim: Dimension };

function collect(design: Design): Map<string, Node> {
  const nodes = new Map<string, Node>();
  design.parameters.forEach((p, index) => {
    nodes.set(p.name, { kind: 'param', name: p.name, deps: p.unit === 'text' ? [] : expressionDeps(p.expression), index });
  });
  for (const sid of design.order) {
    const sketch = design.sketches[sid];
    if (!sketch) continue;
    for (const d of Object.values(sketch.dimensions)) {
      nodes.set(d.name, { kind: 'dim', name: d.name, deps: d.driving ? expressionDeps(d.expression) : [], dim: d });
    }
  }
  return nodes;
}

/** Every name transitively involved in a cycle gets an error rather than a stale value. */
function topoOrder(nodes: Map<string, Node>): { order: string[]; cyclic: Set<string> } {
  const indeg = new Map<string, number>();
  const users = new Map<string, string[]>();
  for (const [name, n] of nodes) {
    let count = 0;
    for (const d of n.deps) {
      if (!nodes.has(d)) continue;
      count++;
      users.set(d, [...(users.get(d) ?? []), name]);
    }
    indeg.set(name, count);
  }
  const ready = [...nodes.keys()].filter((n) => indeg.get(n) === 0);
  const order: string[] = [];
  while (ready.length) {
    const n = ready.pop() as string;
    order.push(n);
    for (const u of users.get(n) ?? []) {
      const left = (indeg.get(u) as number) - 1;
      indeg.set(u, left);
      if (left === 0) ready.push(u);
    }
  }
  const done = new Set(order);
  return { order, cyclic: new Set([...nodes.keys()].filter((n) => !done.has(n))) };
}

/**
 * Evaluate every user parameter and driving dimension, writing `value`. Driven dimensions are inputs
 * here: call refreshDriven after a solve first. An expression that fails keeps its previous value and
 * is reported. Names on, or depending on, a cycle report code 'cycle'.
 */
export function resolveAll(design: Design): ResolveReport {
  const nodes = collect(design);
  const { order, cyclic } = topoOrder(nodes);
  const report: ResolveReport = { errors: [], changed: [] };
  const values = new Map<string, NameValue>();
  const lengthUnit = design.units as LengthUnit;

  for (const name of order) {
    const n = nodes.get(name) as Node;
    // A text parameter has no number to give: it goes into text, through substituteText.
    if (n.kind === 'param' && design.parameters[n.index].unit === 'text') continue;
    if (n.kind === 'dim' && !n.dim.driving) {
      values.set(name, { value: n.dim.value, kind: dimKind(n.dim) });
      continue;
    }
    const expression = n.kind === 'param' ? design.parameters[n.index].expression : n.dim.expression;
    const param = n.kind === 'param' ? design.parameters[n.index] : null;
    const expect: ExprKind = param ? (param.unit === 'mm' ? 'length' : param.unit === 'deg' ? 'angle' : 'number') : dimKind((n as Extract<Node, { kind: 'dim' }>).dim);
    const r = evaluateExpression(expression, { names: (x) => values.get(x), expect, lengthUnit });
    if (!r.ok) {
      report.errors.push({ name, error: r.error });
      const old = param ? param.value : (n as Extract<Node, { kind: 'dim' }>).dim.value;
      values.set(name, { value: old, kind: expect });
      continue;
    }
    values.set(name, { value: r.value, kind: r.kind });
    if (param) param.value = r.value;
    else {
      const dim = (n as Extract<Node, { kind: 'dim' }>).dim;
      if (dim.value !== r.value) report.changed.push(dim.id);
      dim.value = r.value;
    }
  }
  for (const name of cyclic) {
    report.errors.push({ name, error: { code: 'cycle', message: `'${name}' is part of a circular reference`, name } });
  }
  for (const id of design.order) {
    for (const c of Object.values(design.sketches[id]?.curves ?? {})) {
      if (c.type !== 'text' || !c.heightExpression) continue;
      const r = evaluateInDesign(design, c.heightExpression, 'length');
      if (r.ok && r.value > 0) c.height = r.value;
    }
  }
  return report;
}

/** What each name in the design stands for just now, written so that an expression can hold it exactly. */
export function lastValues(design: Design): Map<string, string> {
  const out = new Map<string, string>();
  const write = (value: number, kind: ExprKind): string => (kind === 'angle' ? `${(value * 180) / Math.PI} deg` : kind === 'length' ? `${value} mm` : `${value}`);
  for (const p of design.parameters) {
    if (p.unit !== 'text') out.set(p.name, write(p.value, p.unit === 'mm' ? 'length' : p.unit === 'deg' ? 'angle' : 'number'));
  }
  for (const id of design.order) for (const d of Object.values(design.sketches[id]?.dimensions ?? {})) out.set(d.name, write(d.value, dimKind(d)));
  return out;
}

/**
 * What was named in `was` and is gone: each expression that used it takes the value it last had instead,
 * so nothing moves and the name cannot come to mean something else. Returns the names that were in use.
 */
export function keepLostValues(design: Design, was: ReadonlyMap<string, string>): string[] {
  const now = lastValues(design);
  const lost = new Map([...was].filter(([name]) => !now.has(name)));
  if (lost.size === 0) return [];
  const used = new Set<string>();
  const kept = (expression: string): string => {
    const hit = expressionDeps(expression).filter((n) => lost.has(n));
    hit.forEach((n) => used.add(n));
    return hit.length ? replaceNames(expression, lost) : expression;
  };
  for (const p of design.parameters) if (p.unit !== 'text') p.expression = kept(p.expression);
  for (const id of design.order) {
    const s = design.sketches[id];
    if (!s) continue;
    for (const d of Object.values(s.dimensions)) d.expression = kept(d.expression);
    for (const c of Object.values(s.curves)) {
      if (c.type !== 'text') continue;
      if (c.heightExpression) c.heightExpression = kept(c.heightExpression);
      c.text = c.text.replace(/\{([^{}]+)\}/g, (_w, inner: string) => `{${kept(inner)}}`);
    }
  }
  return [...used];
}

/** Names whose expression asks for a name that is not there, as a file may hold them. Each with its message. */
export function danglingNames(design: Design): Map<string, string> {
  const nodes = collect(design);
  const out = new Map<string, string>();
  for (const [name, n] of nodes) {
    const missing = n.deps.find((d) => !nodes.has(d));
    if (missing) out.set(name, `${name}: Unknown name '${missing}'`);
  }
  return out;
}

/** A text parameter's text. Fusion writes it in single quotes, so those come off if given. */
export function textValue(p: UserParameter): string {
  const m = /^'(.*)'$/s.exec(p.expression.trim());
  return m ? m[1] : p.expression;
}

/** Each text entity's name in Change Parameters: its own, or for older files the first Text1, Text2 free. */
export function textNames(design: Design): Map<Id, string> {
  const out = new Map<Id, string>();
  const texts = design.order.flatMap((sid) => Object.values(design.sketches[sid]?.curves ?? {})).filter((c) => c.type === 'text');
  const taken = new Set(texts.flatMap((c) => c.parameter ?? []));
  let next = 1;
  for (const c of texts) {
    if (c.parameter) {
      out.set(c.id, c.parameter);
      continue;
    }
    while (taken.has(`Text${next}`)) next++;
    taken.add(`Text${next}`);
    out.set(c.id, `Text${next}`);
  }
  return out;
}

/** Every name that stands for text: user parameters of unit Text, and each text's `Text1_text`. */
export function textParameters(design: Design): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of design.parameters) if (p.unit === 'text') out.set(p.name, textValue(p));
  const names = textNames(design);
  for (const sid of design.order) {
    for (const c of Object.values(design.sketches[sid]?.curves ?? {})) {
      if (c.type === 'text') out.set(`${names.get(c.id)}_text`, c.text);
    }
  }
  return out;
}

/** A Driven dimension an expression names, or null. Offset and tangent dimensions may not use one [ref SKT-CREATE-DIMENSIONS]. */
export function drivenReference(design: Design, expression: string): string | null {
  const names = new Set(expressionDeps(expression));
  for (const id of design.order) {
    for (const d of Object.values(design.sketches[id]?.dimensions ?? {})) if (!d.driving && names.has(d.name)) return d.name;
  }
  return null;
}

/** Evaluate an expression against the current values of all parameters and dimensions. */
export function evaluateInDesign(design: Design, expression: string, expect: ExprKind = 'length') {
  const nodes = collect(design);
  const names = (x: string): NameValue | undefined => {
    const n = nodes.get(x);
    if (!n) return undefined;
    if (n.kind === 'dim') return { value: n.dim.value, kind: dimKind(n.dim) };
    const p = design.parameters[n.index];
    if (p.unit === 'text') return undefined;
    return { value: p.value, kind: p.unit === 'mm' ? 'length' : p.unit === 'deg' ? 'angle' : 'number' };
  };
  return evaluateExpression(expression, { names, expect, lengthUnit: design.units as LengthUnit });
}

/**
 * Would setting `name` to `expression` close a cycle? Use before committing an edit; the HUD can
 * show the path. Returns the offending chain, or null.
 */
export function wouldCycle(design: Design, name: string, expression: string): string[] | null {
  const nodes = collect(design);
  const seen = new Set<string>();
  const walk = (n: string, path: string[]): string[] | null => {
    if (n === name) return [...path, n];
    if (seen.has(n)) return null;
    seen.add(n);
    for (const d of nodes.get(n)?.deps ?? []) {
      const hit = walk(d, [...path, n]);
      if (hit) return hit;
    }
    return null;
  };
  for (const d of expressionDeps(expression)) {
    const hit = walk(d, [name]);
    if (hit) return hit;
  }
  return null;
}

function lineThrough(sketch: Sketch, id: Id): { p: Vec2; d: Vec2 } | null {
  if (id === AXIS_X) return { p: { x: 0, y: 0 }, d: { x: 1, y: 0 } };
  if (id === AXIS_Y) return { p: { x: 0, y: 0 }, d: { x: 0, y: 1 } };
  const c = sketch.curves[id];
  if (c?.type !== 'line') return null;
  const p = getPointPos(sketch, c.a);
  const q = getPointPos(sketch, c.b);
  return { p, d: { x: q.x - p.x, y: q.y - p.y } };
}

function pointLineDistance(p: Vec2, l: { p: Vec2; d: Vec2 }): number {
  const n = Math.hypot(l.d.x, l.d.y) || 1;
  return Math.abs((p.x - l.p.x) * l.d.y - (p.y - l.p.y) * l.d.x) / n;
}

const hasPos = (sketch: Sketch, id: Id): boolean => id === 'origin' || sketch.points[id] !== undefined;

function refPoint(sketch: Sketch, id: Id): Vec2 | null {
  if (hasPos(sketch, id)) return getPointPos(sketch, id);
  const c = sketch.curves[id];
  if (c && (c.type === 'circle' || c.type === 'arc' || c.type === 'ellipse' || c.type === 'ellipticalArc')) return getPointPos(sketch, c.c);
  return null;
}

/** Radius of a circle or arc, whichever it is. */
export function radiusOf(sketch: Sketch, id: Id): number | null {
  const c = sketch.curves[id];
  if (c?.type === 'circle') return c.r;
  if (c?.type === 'arc') {
    const m = getPointPos(sketch, c.c);
    const a = getPointPos(sketch, c.a);
    return Math.hypot(a.x - m.x, a.y - m.y);
  }
  return null;
}

/** Unsigned angle between two lines; variant 1 measures the supplement. */
function measureAngle(sketch: Sketch, d: Dimension): number | null {
  const a = lineThrough(sketch, d.refs[0]);
  const b = lineThrough(sketch, d.refs[1]);
  if (!a || !b) return null;
  const ang = Math.abs(Math.atan2(a.d.x * b.d.y - a.d.y * b.d.x, a.d.x * b.d.x + a.d.y * b.d.y));
  return ((d.variant ?? 0) & 1) === 1 ? Math.PI - ang : ang;
}

/** Measure what a dimension's refs currently are. Null when the refs no longer resolve. */
export function measureDimension(sketch: Sketch, d: Dimension): number | null {
  switch (d.kind) {
    case 'distance': case 'horizontal': case 'vertical': {
      const only = d.refs.length === 1 ? sketch.curves[d.refs[0]] : undefined;
      const p = only?.type === 'line' ? getPointPos(sketch, only.a) : refPoint(sketch, d.refs[0]);
      const q = only?.type === 'line' ? getPointPos(sketch, only.b) : refPoint(sketch, d.refs[1]);
      if (d.kind === 'distance' && p && d.refs.length === 2 && sketch.curves[d.refs[1]]?.type === 'line') {
        const l = lineThrough(sketch, d.refs[1]);
        return l ? pointLineDistance(p, l) : null;
      }
      if (!p || !q) return null;
      if (d.kind === 'horizontal') return Math.abs(q.x - p.x);
      if (d.kind === 'vertical') return Math.abs(q.y - p.y);
      return Math.hypot(q.x - p.x, q.y - p.y);
    }
    case 'pointLine': {
      const p = refPoint(sketch, d.refs[0]);
      const l = lineThrough(sketch, d.refs[1]);
      return p && l ? pointLineDistance(p, l) : null;
    }
    case 'lineLine': {
      const a = lineThrough(sketch, d.refs[0]);
      const b = lineThrough(sketch, d.refs[1]);
      return a && b ? pointLineDistance(a.p, b) : null;
    }
    case 'angle': return measureAngle(sketch, d);
    case 'radius': return radiusOf(sketch, d.refs[0]);
    case 'diameter': {
      const r = radiusOf(sketch, d.refs[0]);
      if (r !== null) return r * 2;
      const l = lineThrough(sketch, d.refs[0]);
      const p = refPoint(sketch, d.refs[1]);
      return l && p ? 2 * pointLineDistance(p, l) : null;
    }
    case 'arcLength': {
      const c = sketch.curves[d.refs[0]];
      if (c?.type !== 'arc') return null;
      const m = getPointPos(sketch, c.c);
      const a = getPointPos(sketch, c.a);
      const b = getPointPos(sketch, c.b);
      let sweep = Math.atan2(b.y - m.y, b.x - m.x) - Math.atan2(a.y - m.y, a.x - m.x);
      if (sweep <= 0) sweep += Math.PI * 2;
      return sweep * Math.hypot(a.x - m.x, a.y - m.y);
    }
    case 'tangentLine': {
      const r = radiusOf(sketch, d.refs[0]);
      const c = sketch.curves[d.refs[0]] as { c: Id } | undefined;
      const l = lineThrough(sketch, d.refs[1]);
      if (r === null || !c || !l) return null;
      const gap = pointLineDistance(getPointPos(sketch, c.c), l);
      return ((d.variant ?? 0) & 1) === 1 ? gap + r : Math.abs(gap - r);
    }
    case 'tangentRounds': {
      const ra = radiusOf(sketch, d.refs[0]);
      const rb = radiusOf(sketch, d.refs[1]);
      const a = sketch.curves[d.refs[0]] as { c: Id } | undefined;
      const b = sketch.curves[d.refs[1]] as { c: Id } | undefined;
      if (ra === null || rb === null || !a || !b) return null;
      const p = getPointPos(sketch, a.c);
      const q = getPointPos(sketch, b.c);
      const v = d.variant ?? 0;
      return Math.abs(Math.hypot(q.x - p.x, q.y - p.y) + ((v & 1) === 1 ? ra : -ra) + ((v & 2) === 2 ? rb : -rb));
    }
    case 'ellipseAxis': {
      const c = sketch.curves[d.refs[0]];
      if (c?.type !== 'ellipse' && c?.type !== 'ellipticalArc') return null;
      const m = getPointPos(sketch, c.c);
      const e = getPointPos(sketch, ((d.variant ?? 0) & 1) === 1 ? c.minor : c.major);
      return Math.hypot(e.x - m.x, e.y - m.y);
    }
  }
}

/** Update driven dimensions from current geometry. Call after a solve, then resolveAll. */
export function refreshDriven(sketch: Sketch): void {
  for (const d of Object.values(sketch.dimensions)) {
    if (d.driving) continue;
    const m = measureDimension(sketch, d);
    if (m !== null) d.value = m;
  }
}

function dimensionDrivenByName(design: Design, name: string): boolean {
  for (const sid of Object.keys(design.sketches)) {
    for (const d of Object.values(design.sketches[sid].dimensions)) if (d.name === name) return !d.driving;
  }
  return false;
}

/**
 * Toggle a dimension between driving and driven [ref SKT-CREATE-DIMENSIONS]. Going to driven, an
 * expression that only references driving dimensions is frozen to a static value and cannot be
 * recovered; an expression referencing a user parameter or driven dimension is kept. Going to driving
 * the (possibly static) expression applies again.
 */
export function toggleDriven(design: Design, sketch: Sketch, dimId: Id): void {
  const d = sketch.dimensions[dimId];
  if (!d) return;
  if (!d.driving) {
    d.driving = true;
    return;
  }
  const deps = expressionDeps(d.expression);
  const dimDeps = deps.filter((n) => !design.parameters.some((p) => p.name === n));
  const onlyDriving = dimDeps.length === deps.length && deps.every((n) => !dimensionDrivenByName(design, n));
  if (onlyDriving) {
    const val = d.kind === 'angle' ? `${Number(((d.value * 180) / Math.PI).toFixed(6))} deg` : `${Number(d.value.toFixed(6))} mm`;
    d.expression = val;
  }
  d.driving = false;
}
