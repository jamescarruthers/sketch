// What a commit leaves out of its solve, and what it puts back whole afterwards.
//
// A body is whatever is joined to the rest of the sketch at one point and tied to it by nothing else: a
// line, a tail with dimensions of its own, an arc, a loop, a triangle. Nothing in it is unmet, fixed,
// projected or locked, and none of it is what the commit is about. Curves do not come into it: this is
// the graph of the constraints, the dimensions, the expressions between them and the coincidences, and
// a body hangs off a cut vertex of that graph. The solve runs without it and then it goes with its joint,
// keeping its shape and its orientation. Tied anywhere else, it is not a body: it stays in the solve and
// the lighter side gives way.
//
// A shape joined at several points whose joints all moved by one vector translates whole by that vector
// (`settlePieces`). Nothing says otherwise: every row on it has moved together.
import type { Constraint, Dimension, Id, Sketch, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y, ORIGIN } from '../model/types';
import { curvePoints, getPointPos } from '../model/document';
import { expressionDeps } from '../model/expressions';
import type { Freeze } from '../model/layers';

/** Two moves within this are one move. */
const SAME_MOVE = 1e-6;
const ROOT = '';

export interface Body {
  /** A point of the joint. It stays in the solve: the rest says where it goes. */
  joint: Id;
  curves: Id[];
  /** Every point that goes with it. */
  points: Id[];
  rows: Id[];
}

/** The sketch as a graph, and what must not end up in a body. */
export interface Plan { sketch: Sketch; rep(id: Id): Id; next: Map<string, Set<string>>; held: Set<string>; bodies: Body[] }

const pointNode = (rep: Id): string => `p${rep}`;
const curveNode = (id: Id): string => `c${id}`;
const rowNode = (id: Id): string => `r${id}`;

const isRow = (sketch: Sketch, id: Id): boolean => !!sketch.constraints[id] || !!sketch.dimensions[id];

/** Coincidence classes, leaving out a coincident the geometry has not met: its two sides are not one point yet. */
function classesOf(sketch: Sketch, seeds: Set<Id>): (id: Id) => Id {
  const parent = new Map<Id, Id>();
  const find = (a: Id): Id => {
    let r = a;
    while (parent.has(r)) r = parent.get(r) as Id;
    if (r !== a) parent.set(a, r);
    return r;
  };
  for (const k of Object.values(sketch.constraints)) {
    if (k.type !== 'coincident' || k.refs.length !== 2 || seeds.has(k.id)) continue;
    const [a, b] = k.refs;
    if (a !== ORIGIN && !sketch.points[a] || b !== ORIGIN && !sketch.points[b]) continue;
    const [p, q] = [find(a), find(b)];
    if (p === q) continue;
    // The origin stays its own class's name: it is the one point every class can be asked about.
    if (q === ORIGIN) parent.set(p, q);
    else parent.set(q, p);
  }
  return find;
}

function graphOf(sketch: Sketch, seeds: Set<Id>, freeze?: Freeze | null): Omit<Plan, 'bodies'> {
  const rep = classesOf(sketch, seeds);
  const next = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (a === b) return;
    (next.get(a) ?? next.set(a, new Set()).get(a) as Set<string>).add(b);
    (next.get(b) ?? next.set(b, new Set()).get(b) as Set<string>).add(a);
  };
  const held = new Set<string>([pointNode(rep(ORIGIN))]);
  next.set(pointNode(rep(ORIGIN)), new Set());
  const nodeOf = (id: Id): string | null => {
    if (id === ORIGIN || sketch.points[id]) return pointNode(rep(id));
    if (sketch.curves[id]) return curveNode(id);
    if (id === AXIS_X || id === AXIS_Y) return pointNode(rep(ORIGIN));
    return null;
  };
  for (const p of Object.values(sketch.points)) {
    const n = pointNode(rep(p.id));
    if (!next.has(n)) next.set(n, new Set());
    if (p.fixed || freeze?.points.has(p.id)) held.add(n);
  }
  for (const c of Object.values(sketch.curves)) {
    const n = curveNode(c.id);
    if (!next.has(n)) next.set(n, new Set());
    for (const p of curvePoints(c)) link(n, pointNode(rep(p)));
    if (c.fixed || c.projected || c.derivedFrom !== undefined || freeze?.curves.has(c.id)) held.add(n);
    if (c.derivedFrom !== undefined) link(n, `f${c.derivedFrom}`);
    if (c.type === 'text' && c.path) link(n, curveNode(c.path));
  }
  const rows: (Constraint | Dimension)[] = [...Object.values(sketch.constraints), ...Object.values(sketch.dimensions).filter((d) => d.driving)];
  for (const k of rows) {
    if (freeze?.broken.has(k.id)) continue;
    const ends = [...new Set(k.refs.flatMap((id) => nodeOf(id) ?? []))];
    // A row on one point alone says nothing about what is joined to what, and stays with the rest.
    if (ends.length < 2 && ends.every((n) => n.startsWith('p')) && !seeds.has(k.id)) continue;
    const n = rowNode(k.id);
    if (!next.has(n)) next.set(n, new Set());
    for (const e of ends) link(n, e);
    // Dimensions that name one another, or the same parameter, are tied.
    if ('expression' in k) for (const name of expressionDeps(k.expression)) link(n, `n${name}`);
    if ('name' in k && typeof k.name === 'string') link(n, `n${k.name}`);
    if (k.feature) link(n, `f${k.feature}`);
  }
  for (const f of Object.values(sketch.features)) {
    const n = `f${f.id}`;
    const ids = f.type === 'mirror' ? [f.axis, ...f.pairs.flat()]
      : f.type === 'offset' ? [...f.sources, ...f.outputs, ...(f.dimension ? [f.dimension] : [])]
        : f.type === 'circPattern' ? [...f.sources, f.center] : f.sources;
    for (const id of ids) {
      const end = isRow(sketch, id) ? rowNode(id) : nodeOf(id);
      if (end) link(n, end);
    }
  }
  for (const id of seeds) {
    const n = isRow(sketch, id) ? rowNode(id) : nodeOf(id);
    if (n) held.add(n);
  }
  return { sketch, rep, next, held };
}

/** Each stretch of the depth-first tree from what is held that only a point joins to the rest. */
function cutPieces(next: Map<string, Set<string>>, held: Set<string>, ownEnd: (joint: string, nodes: string[]) => boolean): { joint: string; nodes: string[] }[] {
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string>();
  const size = new Map<string, number>();
  const order: string[] = [];
  const stack: { at: string; them: Iterator<string> }[] = [];
  const roots = (at: string): Iterable<string> => (at === ROOT ? held : [...(next.get(at) ?? []), ...(held.has(at) ? [ROOT] : [])]);
  const enter = (at: string): void => {
    disc.set(at, order.length);
    low.set(at, order.length);
    size.set(at, 1);
    order.push(at);
    stack.push({ at, them: roots(at)[Symbol.iterator]() });
  };
  enter(ROOT);
  while (stack.length) {
    const top = stack[stack.length - 1];
    const step = top.them.next();
    if (step.done) {
      stack.pop();
      const up = parent.get(top.at);
      if (up !== undefined) {
        low.set(up, Math.min(low.get(up) as number, low.get(top.at) as number));
        size.set(up, (size.get(up) as number) + (size.get(top.at) as number));
      }
      continue;
    }
    const to = step.value;
    if (to === parent.get(top.at)) continue;
    if (disc.has(to)) low.set(top.at, Math.min(low.get(top.at) as number, disc.get(to) as number));
    else {
      parent.set(to, top.at);
      enter(to);
    }
  }
  const out: { joint: string; nodes: string[] }[] = [];
  for (let i = 1; i < order.length;) {
    const v = order[i];
    const joint = parent.get(v) as string;
    const n = size.get(v) as number;
    const nodes = joint !== ROOT && joint.startsWith('p') && (low.get(v) as number) >= (disc.get(joint) as number) ? order.slice(i, i + n) : null;
    if (nodes && ownEnd(joint, nodes)) {
      out.push({ joint, nodes });
      i += n;
    } else i++;
  }
  return out;
}

/**
 * The bodies of a sketch, given what a commit is about. `seeds` are its unmet rows and whatever they are
 * about: a piece holding any of them is not carried by a joint, it is what is moving.
 */
export function planBodies(sketch: Sketch, seeds: Set<Id>, freeze?: Freeze | null): Plan {
  const g = graphOf(sketch, seeds, freeze);
  const members = new Map<Id, Id[]>();
  const add = (id: Id): void => {
    const r = g.rep(id);
    members.set(r, [...(members.get(r) ?? []), id]);
  };
  add(ORIGIN);
  Object.keys(sketch.points).forEach(add);
  const bodies: Body[] = [];
  // Joined by a point of its own: a point riding along a curve does not carry the curve.
  const ownEnd = (joint: string, nodes: string[]): boolean => nodes.some((n) => {
    const c = n.startsWith('c') ? sketch.curves[n.slice(1)] : undefined;
    return !!c && curvePoints(c).some((p) => pointNode(g.rep(p)) === joint);
  });
  for (const { joint, nodes } of cutPieces(g.next, g.held, ownEnd)) {
    const curves = nodes.filter((n) => n.startsWith('c')).map((n) => n.slice(1));
    const points = nodes.filter((n) => n.startsWith('p')).flatMap((n) => members.get(n.slice(1)) ?? []);
    if (!curves.length || !points.length) continue;
    const rows = nodes.filter((n) => n.startsWith('r')).map((n) => n.slice(1));
    bodies.push({ joint: members.get(joint.slice(1))?.[0] ?? ORIGIN, curves, points, rows });
  }
  return { ...g, bodies };
}

/** Everything the solve leaves out, by id. */
export function leftOut(bodies: Body[]): Set<Id> {
  return new Set(bodies.flatMap((b) => [...b.curves, ...b.points, ...b.rows]));
}

export interface Frame { joint: Id; offsets: Map<Id, Vec2> }

/**
 * Where each body sits on its joint. A seat that took a body along has placed it already. Otherwise it is
 * where it was in `from`, and goes wherever the seat and the solve send the joint.
 */
export function framesOf(sketch: Sketch, bodies: Body[], from: Map<Id, Vec2>): Frame[] {
  return bodies.map((b) => {
    const was = (id: Id): Vec2 => from.get(id) ?? getPointPos(sketch, id);
    const seated = b.points.some((id) => {
      const [p, q] = [was(id), getPointPos(sketch, id)];
      return Math.hypot(p.x - q.x, p.y - q.y) > SAME_MOVE;
    });
    const at = seated ? (id: Id): Vec2 => getPointPos(sketch, id) : was;
    const j = at(b.joint);
    return { joint: b.joint, offsets: new Map(b.points.map((id) => {
      const p = at(id);
      return [id, { x: p.x - j.x, y: p.y - j.y }];
    })) };
  });
}

/** Each body goes to its joint, whole. */
export function carry(sketch: Sketch, frames: Frame[]): void {
  for (const f of frames) {
    const j = getPointPos(sketch, f.joint);
    for (const [id, o] of f.offsets) {
      const p = sketch.points[id];
      if (p) {
        p.x = j.x + o.x;
        p.y = j.y + o.y;
      }
    }
  }
}

/**
 * A shape joined at several points that have all moved alike goes by that same move, whole, whatever the
 * solve did with it, and one whose joints stayed stays. No row reaches past those joints, so it is met.
 * Returns whether that moved anything.
 */
export function settlePieces(plan: Plan, from: Map<Id, Vec2>, radii: Map<Id, number>): boolean {
  const { sketch, rep, next, held } = plan;
  let shifted = false;
  const moves: { by: Vec2; at: Set<string> }[] = [];
  const seen = new Set<Id>();
  for (const p of Object.values(sketch.points)) {
    const r = rep(p.id);
    const was = from.get(p.id);
    if (seen.has(r) || !was) continue;
    seen.add(r);
    const by = { x: p.x - was.x, y: p.y - was.y };
    const same = moves.find((m) => Math.abs(m.by.x - by.x) < SAME_MOVE && Math.abs(m.by.y - by.y) < SAME_MOVE);
    if (same) same.at.add(pointNode(r));
    else moves.push({ by, at: new Set([pointNode(r)]) });
  }
  // A moving class's fixed partner has no owner of its own, and the origin never moves.
  const origin = moves.find((m) => Math.hypot(m.by.x, m.by.y) < SAME_MOVE);
  if (origin) origin.at.add(pointNode(rep(ORIGIN)));
  for (const { by, at } of moves) {
    if (at.size < 2) continue;
    const done = new Set<string>(at);
    for (const joint of at) {
      for (const first of next.get(joint) ?? []) {
        if (done.has(first)) continue;
        const piece = [first];
        done.add(first);
        for (let i = 0; i < piece.length; i++) {
          for (const n of next.get(piece[i]) ?? []) {
            if (!done.has(n)) {
              done.add(n);
              piece.push(n);
            }
          }
        }
        if (piece.some((n) => held.has(n))) continue;
        const inside = new Set(piece.filter((n) => n.startsWith('p')));
        if (inside.size === 0) continue;
        for (const p of Object.values(sketch.points)) {
          const was = from.get(p.id);
          if (was && inside.has(pointNode(rep(p.id)))) {
            shifted ||= Math.abs(p.x - was.x - by.x) > SAME_MOVE || Math.abs(p.y - was.y - by.y) > SAME_MOVE;
            p.x = was.x + by.x;
            p.y = was.y + by.y;
          }
        }
        for (const n of piece) {
          const c = n.startsWith('c') ? sketch.curves[n.slice(1)] : undefined;
          if (c?.type === 'circle') c.r = radii.get(c.id) ?? c.r;
        }
      }
    }
  }
  return shifted;
}
