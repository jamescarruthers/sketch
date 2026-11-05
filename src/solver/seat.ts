// Geometric pre-step for a newly applied constraint. The solver takes the numerically cheapest path,
// which for a large correction is a shorter line or a bigger circle, so before it runs one object is
// moved to where the constraint already holds.
//
// The rule is that a seat must not disturb geometry outside the curve being seated. A curve with
// nothing else attached moves rigidly and keeps its size. Of two objects the lighter gives way,
// whichever was picked first: free before joined, a small joined body before a large one, and first
// pick stays only between equals. What hangs off a moved joint goes with it: see `bodies.ts`. A whole
// body moves rigidly in preference to a change of shape. Only when no rigid move will do does a joined
// curve give way by reshaping: an arc moves its centre, so its radius changes [ref GUID-E8C8752F, "the
// center point of the arc on the right moves"].
//
// "Newly applied" needs no bookkeeping: a constraint the incoming geometry does not satisfy has just
// been added, or is in conflict. A seat is a guess that the solver then checks, so each constraint
// offers several, best first, and `solveSketch` keeps the one that does the least to everything else.
import type { Constraint, Curve, Dimension, Id, Sketch, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y, ORIGIN } from '../model/types';
import { coincidentClasses, curveEnds, curvePoints, getPointPos } from '../model/document';
import { measureDimension } from '../model/parameters';
import { closestPoint, ellipseFrame, lineOf, resolve, unitTangent } from '../geom/curves';
import { add, cross, dist, dot, len, lerp, norm, perp, reflect, rotateAbout, scale, sub } from '../geom/vec';

/** Below this displacement (mm) the solver's own small correction changes nothing visible. */
const SEAT_EPS = 1e-4;
const TINY = 1e-9;

export interface Seat {
  points: Map<Id, Vec2>;
  radii: Map<Id, number>;
  /** Curves whose size must come through the solve unchanged. */
  keep: Id[];
  /** Largest displacement, mm. */
  moved: number;
  /** A whole joined body moving rigidly: nothing changes shape, however much of the sketch travels. */
  body?: boolean;
  /** Changes the shape of a curve it did not have to: the last thing to try, and scored for it. */
  reshapes?: boolean;
}

interface World {
  sketch: Sketch;
  rep(id: Id): Id;
  members: Map<Id, Id[]>;
  /** Coincidence classes that cannot move at all. */
  pinned: Set<Id>;
  hold: Set<Id>;
  /** Points that travel with a curve without being part of it: on it, or at its middle. */
  riders: Map<Id, Id[]>;
  /** Points tied to any curve by a coincident. */
  onCurve: Set<Id>;
  /** Points held at the middle of a curve. */
  middles: Set<Id>;
  /** A point's class to each point it mirrors, and the line between them. */
  mirrored: Map<Id, { other: Id; axis: Id }[]>;
  /** Island number of each point class. Built when first asked for, since most solves never ask. */
  islands: Map<Id, number> | null;
  frozen?: Set<Id>;
}

/** Coincidence classes, with concentric centres that already agree: the solver shares their variables too. */
function pointClasses(sketch: Sketch, skip?: Id): (id: Id) => Id {
  const coincident = coincidentClasses(sketch, skip);
  const parent = new Map<Id, Id>();
  const find = (a: Id): Id => {
    let r = coincident(a);
    while (parent.has(r)) r = parent.get(r) as Id;
    return r;
  };
  for (const k of Object.values(sketch.constraints)) {
    if (k.type !== 'concentric' || k.refs.length !== 2) continue;
    const [p, q] = k.refs.map((id) => sketch.curves[id]).map((c) => (c ? centreOf(c) : null));
    if (!p || !q || dist(getPointPos(sketch, p), getPointPos(sketch, q)) > SEAT_EPS) continue;
    const a = find(p);
    const b = find(q);
    if (a !== b) parent.set(a, b);
  }
  return find;
}

/** `skip` is a constraint to leave out: a new coincident has to be seated as two points, not one. */
export function makeWorld(sketch: Sketch, hold: Id[], frozen?: Set<Id>, skip?: Id): World {
  const rep = pointClasses(sketch, skip);
  const members = new Map<Id, Id[]>();
  for (const id of Object.keys(sketch.points)) {
    const r = rep(id);
    const list = members.get(r);
    if (list) list.push(id);
    else members.set(r, [id]);
  }
  const pinned = new Set<Id>([rep(ORIGIN)]);
  for (const p of Object.values(sketch.points)) if (p.fixed || frozen?.has(p.id)) pinned.add(rep(p.id));
  for (const c of Object.values(sketch.curves)) {
    if (c.fixed || c.projected || c.derivedFrom !== undefined) for (const p of curvePoints(c)) pinned.add(rep(p));
  }
  const riders = new Map<Id, Id[]>();
  const onCurve = new Set<Id>();
  const middles = new Set<Id>();
  const mirrored = new Map<Id, { other: Id; axis: Id }[]>();
  for (const k of Object.values(sketch.constraints)) {
    if (k.type === 'symmetric' && k.refs.length === 3 && isPoint(sketch, k.refs[0]) && isPoint(sketch, k.refs[1])) {
      const [a, b, axis] = k.refs;
      mirrored.set(rep(a), [...(mirrored.get(rep(a)) ?? []), { other: b, axis }]);
      mirrored.set(rep(b), [...(mirrored.get(rep(b)) ?? []), { other: a, axis }]);
    }
    if ((k.type !== 'coincident' && k.type !== 'midpoint') || k.refs.length !== 2 || k.id === skip) continue;
    const [a, b] = k.refs;
    const [point, curve] = sketch.points[a] ? [a, b] : [b, a];
    if (k.type === 'coincident') onCurve.add(point);
    else middles.add(point);
    if (!sketch.points[point] || !sketch.curves[curve]) continue;
    const list = riders.get(curve);
    if (list) list.push(point);
    else riders.set(curve, [point]);
  }
  return { sketch, rep, members, pinned, hold: new Set(hold), riders, onCurve, middles, mirrored, islands: null, frozen };
}

const isPoint = (sketch: Sketch, id: Id): boolean => id === ORIGIN || !!sketch.points[id];

const emptySeat = (keep: Id[]): Seat => ({ points: new Map(), radii: new Map(), keep, moved: 0 });

/** Apply `f` to the points, taking coincident partners along. Null when a pinned point would have to move. */
function transform(w: World, ids: Id[], f: (p: Vec2) => Vec2, keep: Id[]): Seat | null {
  const seat = emptySeat(keep);
  const done = new Set<Id>();
  for (const id of ids) {
    const r = w.rep(id);
    if (done.has(r)) continue;
    done.add(r);
    const from = getPointPos(w.sketch, id);
    const by = sub(f(from), from);
    const moved = len(by);
    if (moved <= TINY) continue;
    if (w.pinned.has(r)) return null;
    seat.moved = Math.max(seat.moved, moved);
    for (const m of w.members.get(r) ?? [id]) seat.points.set(m, add(getPointPos(w.sketch, m), by));
  }
  return seat;
}

/** The middle of the sweep, counter-clockwise from a to b about c. */
function sweepMiddle(c: Vec2, a: Vec2, b: Vec2): Vec2 {
  const from = sub(a, c);
  const to = sub(b, c);
  const half = ((Math.atan2(cross(from, to), dot(from, to)) + 2 * Math.PI) % (2 * Math.PI)) / 2;
  return add(c, { x: from.x * Math.cos(half) - from.y * Math.sin(half), y: from.x * Math.sin(half) + from.y * Math.cos(half) });
}

/** Where a point on a circle goes when the circle changes: along the line it is also on, if any, else straight out. */
function slidOnto(w: World, point: Id, round: Id, p: Vec2, c: Vec2, r: number): Vec2 {
  const host = [...w.riders].find(([id, on]) => id !== round && on.includes(point) && !!lineOf(w.sketch, id));
  const l = host ? lineOf(w.sketch, host[0]) : null;
  if (!l || len(l.d) < TINY) return add(c, scale(norm(sub(p, c)), r));
  const u = norm(l.d);
  const foot = add(l.p, scale(u, dot(sub(c, l.p), u)));
  const off = dist(foot, c);
  if (off > r) return add(c, scale(norm(sub(p, c)), r));
  const h = Math.sqrt(r * r - off * off);
  const [m, n] = [add(foot, scale(u, h)), add(foot, scale(u, -h))];
  return dist(m, p) <= dist(n, p) ? m : n;
}

/** An arc reshaped by a seat takes the points riding on it along: to its new middle, or out to its new radius. */
function withRiders(w: World, seat: Seat): Seat {
  const at = (id: Id): Vec2 => seat.points.get(id) ?? getPointPos(w.sketch, id);
  for (const c of Object.values(w.sketch.curves)) {
    if (c.type !== 'arc' || !curvePoints(c).some((p) => seat.points.has(p))) continue;
    const centre = at(c.c);
    const r = dist(centre, at(c.a));
    for (const rider of attached(w, c.id)) {
      if (seat.points.has(rider)) continue;
      const p = getPointPos(w.sketch, rider);
      const to = w.middles.has(rider) ? sweepMiddle(centre, at(c.a), at(c.b)) : slidOnto(w, rider, c.id, p, centre, r);
      if (w.pinned.has(w.rep(rider))) continue;
      for (const m of w.members.get(w.rep(rider)) ?? [rider]) seat.points.set(m, to);
    }
  }
  return seat;
}

/** The mirror image of each moved point goes with it, so the solve finds that row already met. */
function withMirrors(w: World, seat: Seat): Seat {
  for (const [id, q] of [...seat.points]) {
    for (const m of w.mirrored.get(w.rep(id)) ?? []) {
      const l = lineOf(w.sketch, m.axis);
      if (!l || len(l.d) < TINY || w.pinned.has(w.rep(m.other))) continue;
      const members = w.members.get(w.rep(m.other)) ?? [m.other];
      if (members.some((o) => seat.points.has(o))) continue;
      for (const o of members) seat.points.set(o, reflect(q, l.p, l.d));
    }
  }
  return seat;
}

const attached = (w: World, curve: Id): Id[] => w.riders.get(curve) ?? [];

const rigidPoints = (w: World, c: Curve): Id[] => [...curvePoints(c), ...attached(w, c.id)];

function translated(w: World, id: Id, by: Vec2, keep: Id[]): Seat | null {
  const c = w.sketch.curves[id];
  return c ? transform(w, rigidPoints(w, c), (p) => add(p, by), keep) : null;
}

/** A round's centre goes to `to` and its rim stays: ends, or a single point riding on it. */
function recentred(w: World, id: Id, to: Vec2, keep: Id[]): Seat | null {
  const c = w.sketch.curves[id];
  if (c?.type === 'arc') return transform(w, [c.c], () => to, keep);
  if (c?.type !== 'circle' || c.fixed || c.projected || c.derivedFrom !== undefined) return null;
  const rim = attached(w, id);
  if (rim.length !== 1) return null;
  const seat = transform(w, [c.c], () => to, keep);
  seat?.radii.set(id, dist(to, getPointPos(w.sketch, rim[0])));
  return seat;
}

/** Centre of the circle through `p` and `q` with radius `r`, on the side the arc has it now. */
function centreForRadius(c: Vec2, p: Vec2, q: Vec2, r: number): Vec2 | null {
  const half = dist(p, q) / 2;
  if (half < TINY || r < half) return null;
  const mid = lerp(p, q, 0.5);
  const n = perp(norm(sub(q, p)));
  const h = Math.sqrt(r * r - half * half);
  return add(mid, scale(n, dot(sub(c, mid), n) >= 0 ? h : -h));
}

/** On the line through `at` along `u`, the centre of the circle through `at` and `other`. */
function centreOnNormal(at: Vec2, u: Vec2, other: Vec2): Vec2 | null {
  const chord = sub(other, at);
  const along = dot(chord, u);
  if (Math.abs(along) < TINY) return null;
  return add(at, scale(u, dot(chord, chord) / (2 * along)));
}

/** Whether all of `refs` are in one joined body. */
export function oneBody(w: World, refs: Id[]): boolean {
  const islands = islandsOf(w);
  const of = (id: Id): number | undefined => {
    const c = w.sketch.curves[id];
    const p = c ? curvePoints(c)[0] : id;
    return p === undefined ? undefined : islands.get(w.rep(p));
  };
  const first = of(refs[0]);
  return first !== undefined && refs.every((id) => of(id) === first);
}

/** Everything joined to `curve`, numbered once for the sketch. */
function islandsOf(w: World): Map<Id, number> {
  if (w.islands) return w.islands;
  const parent = new Map<Id, Id>();
  const find = (a: Id): Id => {
    let r = a;
    while (parent.has(r)) r = parent.get(r) as Id;
    return r;
  };
  const link = (a: Id, b: Id): void => {
    const p = find(a);
    const q = find(b);
    if (p !== q) parent.set(p, q);
  };
  for (const c of Object.values(w.sketch.curves)) {
    const pts = [...curvePoints(c), ...attached(w, c.id)];
    for (let i = 1; i < pts.length; i++) link(w.rep(pts[0]), w.rep(pts[i]));
  }
  const ids = new Map<Id, number>();
  const label = new Map<Id, number>();
  for (const id of w.members.keys()) {
    const root = find(id);
    if (!label.has(root)) label.set(root, label.size);
    ids.set(id, label.get(root) as number);
  }
  w.islands = ids;
  return ids;
}

/** Every point joined, however far, to `curve`. Empty when another `apart` curve is in the same body. */
function islandPoints(w: World, curve: Id, apart?: Id): Id[] {
  const c = w.sketch.curves[curve];
  if (!c) return [];
  const islands = islandsOf(w);
  const first = curvePoints(c)[0];
  const n = first === undefined ? undefined : islands.get(w.rep(first));
  if (n === undefined) return [];
  const other = apart ? w.sketch.curves[apart] : undefined;
  if (other && curvePoints(other).some((p) => islands.get(w.rep(p)) === n)) return [];
  return [...islands].filter(([, i]) => i === n).map(([rep]) => rep);
}

function wholeBody(w: World, curve: Id, f: (p: Vec2) => Vec2, keep: Id[], apart?: Id): Seat | null {
  const pts = islandPoints(w, curve, apart);
  const seat = pts.length ? transform(w, pts, f, keep) : null;
  if (seat) seat.body = true;
  return seat;
}

/** The whole body a point belongs to, moved by `by`. Null when `apart` is part of the same body. */
function pointBody(w: World, point: Id, by: Vec2, keep: Id[], apart?: Id): Seat | null {
  const islands = islandsOf(w);
  const n = islands.get(w.rep(point));
  if (n === undefined || (apart !== undefined && islands.get(w.rep(apart)) === n)) return null;
  const seat = transform(w, [...islands].filter(([, i]) => i === n).map(([rep]) => rep), (p) => add(p, by), keep);
  if (seat) seat.body = true;
  return seat;
}

/**
 * How much has to travel if `ids` move: Infinity for what cannot, else the curves joined to them. A
 * pick is held by this, heavier first, so a free object gives way whichever was picked first.
 */
export function weightOf(sketch: Sketch, ids: Id[]): number {
  const w = makeWorld(sketch, []);
  if (ids.length === 0) return Infinity;
  const islands = islandsOf(w);
  const bodies = new Set(ids.map((id) => islands.get(w.rep(id))));
  if (bodies.has(undefined)) return Infinity;
  if ([...islands].some(([rep, i]) => bodies.has(i) && w.pinned.has(rep))) return Infinity;
  const joined = Object.values(sketch.curves).filter((c) => curvePoints(c).some((p) => bodies.has(islands.get(w.rep(p)))));
  // A point by itself is as free as a line by itself: neither outweighs the other.
  return Math.max(1, joined.length);
}

/** Strongest reason a point stays where it is: pinned, then held, then joined to anything. */
function anchorRank(w: World, id: Id): number {
  const r = w.rep(id);
  if (w.pinned.has(r)) return 3;
  if ((w.members.get(r) ?? []).some((m) => w.hold.has(m))) return 2;
  return (w.members.get(r) ?? []).length > 1 || w.onCurve.has(id) ? 1 : 0;
}

/** Where to turn a line about: its anchored end when it has one, else its middle. */
function pivots(w: World, c: Extract<Curve, { type: 'line' }>): Vec2[] {
  const a = getPointPos(w.sketch, c.a);
  const b = getPointPos(w.sketch, c.b);
  const list = [
    { at: a, rank: anchorRank(w, c.a) },
    { at: b, rank: anchorRank(w, c.b) },
    ...attached(w, c.id).map((p) => ({ at: getPointPos(w.sketch, p), rank: anchorRank(w, p) })),
  ].filter((p) => p.rank > 0).sort((p, q) => q.rank - p.rank);
  return [...list.map((p) => p.at), lerp(a, b, 0.5)];
}

/** The rotation in (-pi/2, pi/2] taking direction `from` onto the undirected direction `to`. */
function turnOnto(from: Vec2, to: Vec2): number {
  let t = Math.atan2(cross(from, to), dot(from, to));
  if (t > Math.PI / 2) t -= Math.PI;
  else if (t <= -Math.PI / 2) t += Math.PI;
  return t;
}

function aimed(w: World, line: Id, target: Vec2, keep: Id[]): Seat[] {
  const c = w.sketch.curves[line];
  if (c?.type !== 'line') return [];
  const from = sub(getPointPos(w.sketch, c.b), getPointPos(w.sketch, c.a));
  if (len(from) < TINY) return [];
  const t = turnOnto(from, target);
  const pts = rigidPoints(w, c);
  return pivots(w, c).flatMap((at) => transform(w, pts, (p) => rotateAbout(p, at, t), keep) ?? []);
}

/** Turn a line's whole body onto `target`, about the line's middle. */
function aimedBody(w: World, line: Id, target: Vec2, keep: Id[], apart?: Id): Seat | null {
  const c = w.sketch.curves[line];
  if (c?.type !== 'line') return null;
  const a = getPointPos(w.sketch, c.a);
  const b = getPointPos(w.sketch, c.b);
  if (dist(a, b) < TINY) return null;
  const at = lerp(a, b, 0.5);
  const t = turnOnto(sub(b, a), target);
  return wholeBody(w, line, (p) => rotateAbout(p, at, t), keep, apart);
}

function directional(w: World, k: Constraint, turn: (d: Vec2) => Vec2): Seat[] {
  const [a, b] = k.refs;
  const la = lineOf(w.sketch, a);
  const lb = lineOf(w.sketch, b);
  if (!la || !lb || len(la.d) < TINY || len(lb.d) < TINY) return [];
  const keep = [a, b];
  return [...aimed(w, b, turn(la.d), keep), ...aimed(w, a, turn(lb.d), keep)];
}

function directionalBodies(w: World, k: Constraint, turn: (d: Vec2) => Vec2): Seat[] {
  const [a, b] = k.refs;
  const la = lineOf(w.sketch, a);
  const lb = lineOf(w.sketch, b);
  if (!la || !lb) return [];
  const keep = [a, b];
  return [aimedBody(w, b, turn(la.d), keep, a), aimedBody(w, a, turn(lb.d), keep, b)].flatMap((s) => s ?? []);
}

function collinear(w: World, k: Constraint): Seat[] {
  const out: Seat[] = [];
  for (const [ref, mover] of [[k.refs[0], k.refs[1]], [k.refs[1], k.refs[0]]]) {
    const l = lineOf(w.sketch, ref);
    const c = w.sketch.curves[mover];
    if (!l || c?.type !== 'line' || len(l.d) < TINY) continue;
    const u = norm(l.d);
    const from = sub(getPointPos(w.sketch, c.b), getPointPos(w.sketch, c.a));
    if (len(from) < TINY) continue;
    const t = turnOnto(from, l.d);
    const pts = rigidPoints(w, c);
    for (const at of pivots(w, c)) {
      const off = sub(at, l.p);
      const toLine = scale(perp(u), -dot(off, perp(u)));
      const seat = transform(w, pts, (p) => add(rotateAbout(p, at, t), toLine), [mover, ref]);
      if (seat) out.push(seat);
    }
  }
  return out;
}

/** Curves centred on `id`, which a point-level constraint on that centre moves whole if nothing holds them. */
function centredOn(w: World, id: Id): Curve[] {
  const r = w.rep(id);
  return Object.values(w.sketch.curves).filter((c) => {
    const m = centreOf(c);
    return m !== null && w.rep(m) === r;
  });
}

/** Two points: the second goes level with the first, or the first with the second [ref GUID-E8C8752F]. */
function pointsAligned(w: World, k: Constraint): Seat[] {
  const [p, q] = k.refs;
  const a = getPointPos(w.sketch, p);
  const b = getPointPos(w.sketch, q);
  const seats: (Seat | null)[] = [];
  for (const [from, to] of [[q, a], [p, b]] as [Id, Vec2][]) {
    const at = getPointPos(w.sketch, from);
    const target = k.type === 'horizontal' ? { x: at.x, y: to.y } : { x: to.x, y: at.y };
    const by = sub(target, at);
    const rounds = centredOn(w, from);
    if (rounds.length === 1) seats.push(translated(w, rounds[0].id, by, [rounds[0].id]));
    seats.push(transform(w, [from], () => target, []));
  }
  return seats.flatMap((s) => s ?? []);
}

function axisAligned(w: World, k: Constraint): Seat[] {
  if (k.refs.length === 2) return pointsAligned(w, k);
  if (k.refs.length !== 1) return [];
  return aimed(w, k.refs[0], axisOf(k), [k.refs[0]]);
}

const axisOf = (k: Constraint): Vec2 => (k.type === 'horizontal' ? { x: 1, y: 0 } : { x: 0, y: 1 });

function centreOf(c: Curve): Id | null {
  return c.type === 'circle' || c.type === 'arc' || c.type === 'ellipse' || c.type === 'ellipticalArc' ? c.c : null;
}

function concentric(w: World, k: Constraint): Seat[] {
  const [a, b] = k.refs.map((id) => w.sketch.curves[id]);
  if (!a || !b) return [];
  const ca = centreOf(a);
  const cb = centreOf(b);
  if (!ca || !cb) return [];
  const pa = getPointPos(w.sketch, ca);
  const pb = getPointPos(w.sketch, cb);
  const keep = [a.id, b.id];
  // A free curve moves whole, either one. Its centre alone only when nothing can do that: see `seatsFor`.
  return [
    translated(w, b.id, sub(pa, pb), keep), recentred(w, b.id, pa, [a.id]),
    translated(w, a.id, sub(pb, pa), keep), recentred(w, a.id, pb, [b.id]),
  ].flatMap((s, i) => (s ? [{ ...s, reshapes: i % 2 === 1 }] : []));
}

function concentricBodies(w: World, k: Constraint): Seat[] {
  const [a, b] = k.refs.map((id) => w.sketch.curves[id]);
  const ca = a && centreOf(a);
  const cb = b && centreOf(b);
  if (!ca || !cb) return [];
  const by = sub(getPointPos(w.sketch, ca), getPointPos(w.sketch, cb));
  return [
    wholeBody(w, b.id, (p) => add(p, by), [a.id, b.id], a.id),
    wholeBody(w, a.id, (p) => sub(p, by), [a.id, b.id], b.id),
  ].flatMap((s) => s ?? []);
}

/** A new coincident between two points. It is not a class yet, so this runs in a world without it. */
function pointsJoined(w: World, k: Constraint): Seat[] {
  const [p, q] = k.refs;
  const at = getPointPos(w.sketch, p);
  const to = getPointPos(w.sketch, q);
  if (dist(at, to) < SEAT_EPS) return [];
  const apart = makeWorld(w.sketch, [...w.hold], w.frozen, k.id);
  if (apart.rep(p) === apart.rep(q)) return [];
  const by = sub(at, to);
  const rounds = (id: Id, shift: Vec2): Seat | null => {
    const centred = centredOn(apart, id);
    return centred.length === 1 ? translated(apart, centred[0].id, shift, [centred[0].id]) : null;
  };
  return [
    rounds(q, by), transform(apart, [q], () => at, []), rounds(p, scale(by, -1)), transform(apart, [p], () => to, []),
  ].flatMap((s) => (s ? [{ ...s, reshapes: true }] : []));
}

function pointsJoinedBodies(w: World, k: Constraint): Seat[] {
  const [p, q] = k.refs;
  const by = sub(getPointPos(w.sketch, p), getPointPos(w.sketch, q));
  const apart = makeWorld(w.sketch, [...w.hold], w.frozen, k.id);
  return [pointBody(apart, q, by, [], p), pointBody(apart, p, scale(by, -1), [], q)].flatMap((s) => s ?? []);
}

interface Round { id: Id; c: Vec2; r: number; curve: Extract<Curve, { type: 'circle' | 'arc' }> }

function roundOf(sketch: Sketch, id: Id): Round | null {
  const c = sketch.curves[id];
  if (c?.type === 'circle') return { id, c: getPointPos(sketch, c.c), r: c.r, curve: c };
  if (c?.type === 'arc') {
    const m = getPointPos(sketch, c.c);
    return { id, c: m, r: dist(m, getPointPos(sketch, c.a)), curve: c };
  }
  return null;
}

/** The two curves' shared contact point, by a shared end or a point constrained on both. */
function contact(w: World, a: Curve, b: Curve): Id | null {
  const on = (c: Curve): Id[] => {
    if (c.type === 'line' || c.type === 'arc' || c.type === 'ellipticalArc') return [c.a, c.b];
    return [];
  };
  const onCurve = (c: Curve): Id[] => [...on(c), ...attached(w, c.id)];
  const repsB = new Set(onCurve(b).map((p) => w.rep(p)));
  return onCurve(a).find((p) => repsB.has(w.rep(p))) ?? null;
}

function rotatedAbout(w: World, c: Curve, at: Vec2, t: number, keep: Id[]): Seat | null {
  return transform(w, rigidPoints(w, c), (p) => rotateAbout(p, at, t), keep);
}

function lineRound(w: World, k: Constraint, lineId: Id, round: Round): Seat[] {
  const l = lineOf(w.sketch, lineId);
  if (!l || len(l.d) < TINY) return [];
  const u = norm(l.d);
  const n = perp(u);
  const keep = [lineId, round.id];
  const lineCurve = w.sketch.curves[lineId];
  const hit = lineCurve ? contact(w, lineCurve, round.curve) : null;
  const lineFirst = k.refs[0] === lineId;
  if (hit && lineCurve) {
    // Tangency here is a direction at the contact: turn one about it, nothing changes size.
    const at = getPointPos(w.sketch, hit);
    const radial = sub(at, round.c);
    if (len(radial) < TINY) return [];
    const t = turnOnto(l.d, perp(radial));
    const turnLine = rotatedAbout(w, lineCurve, at, t, keep);
    const turnRound = rotatedAbout(w, round.curve, at, -t, keep);
    // A round joined at its far end too stays on both: the centre finds the tangent through them.
    const rim = otherEnd(w, round.curve, hit);
    const centre = rim ? centreOnNormal(at, n, getPointPos(w.sketch, rim)) : null;
    const resize = centre ? recentred(w, round.id, centre, [lineId]) : null;
    const order = lineFirst ? [turnRound, resize, turnLine] : [turnLine, turnRound, resize];
    return order.flatMap((s) => s ?? []);
  }
  const by = lineRoundShift(w, k, lineId, round) as Vec2;
  const moveRound = translated(w, round.id, by, keep);
  const moveLine = lineCurve ? translated(w, lineId, scale(by, -1), keep) : null;
  const order = lineFirst ? [moveRound, moveLine] : [moveLine, moveRound];
  return order.flatMap((s) => s ?? []);
}

/** The move that puts `round` on the line, or null where they already share a point. */
function lineRoundShift(w: World, k: Constraint, lineId: Id, round: Round): Vec2 | null {
  const l = lineOf(w.sketch, lineId);
  const lineCurve = w.sketch.curves[lineId];
  if (!l || len(l.d) < TINY || (lineCurve && contact(w, lineCurve, round.curve))) return null;
  const n = perp(norm(l.d));
  const off = dot(sub(round.c, l.p), n);
  const side = k.variant === undefined ? (off >= 0 ? 1 : -1) : k.variant & 1 ? -1 : 1;
  return scale(n, side * round.r - off);
}

/** The end of an arc that is not `hit`'s class. */
function otherEnd(w: World, c: Curve, hit: Id): Id | null {
  if (c.type !== 'arc') return null;
  return w.rep(c.a) === w.rep(hit) ? c.b : w.rep(c.b) === w.rep(hit) ? c.a : null;
}

/** The move that brings `b` into contact with `a`, on their line of centres. */
function roundRoundShift(k: Constraint, a: Round, b: Round): Vec2 {
  const between = sub(b.c, a.c);
  const d = len(between);
  const u = d > TINY ? scale(between, 1 / d) : { x: 1, y: 0 };
  const outer = a.r + b.r;
  const inner = Math.abs(a.r - b.r);
  const internal = k.variant === undefined ? Math.abs(d - inner) < Math.abs(d - outer) : (k.variant & 1) === 1;
  return scale(u, (internal ? inner : outer) - d);
}

function roundRound(w: World, k: Constraint, a: Round, b: Round): Seat[] {
  const keep = [a.id, b.id];
  const hit = contact(w, a.curve, b.curve);
  if (hit) {
    // Both radii must lie on one line through the contact: swing the second about it.
    const at = getPointPos(w.sketch, hit);
    const ra = sub(a.c, at);
    const rb = sub(b.c, at);
    if (len(ra) < TINY || len(rb) < TINY) return [];
    const t = turnOnto(rb, ra);
    const rim = otherEnd(w, b.curve, hit);
    const centre = rim ? centreOnNormal(at, norm(ra), getPointPos(w.sketch, rim)) : null;
    return [
      rotatedAbout(w, b.curve, at, t, keep), centre ? recentred(w, b.id, centre, [a.id]) : null, rotatedAbout(w, a.curve, at, -t, keep),
    ].flatMap((s) => s ?? []);
  }
  const by = roundRoundShift(k, a, b);
  return [translated(w, b.id, by, keep), translated(w, a.id, scale(by, -1), keep)].flatMap((s) => s ?? []);
}

/** Half the ellipse's width across direction n, from its two semi-axis vectors. */
function support(e: { rx: number; ry: number; rot: number }, n: Vec2): number {
  const major = { x: Math.cos(e.rot) * e.rx, y: Math.sin(e.rot) * e.rx };
  const minor = { x: -Math.sin(e.rot) * e.ry, y: Math.cos(e.rot) * e.ry };
  return Math.hypot(dot(major, n), dot(minor, n));
}

function lineEllipse(w: World, k: Constraint, lineId: Id, ellipseId: Id): Seat[] {
  const l = lineOf(w.sketch, lineId);
  const e = w.sketch.curves[ellipseId];
  if (!l || e?.type !== 'ellipse' || len(l.d) < TINY) return [];
  const frame = ellipseFrame(w.sketch, e);
  const n = perp(norm(l.d));
  const off = dot(sub(frame.c, l.p), n);
  const shift = (off >= 0 ? 1 : -1) * support(frame, n) - off;
  const keep = [lineId, ellipseId];
  const lineCurve = w.sketch.curves[lineId];
  const moveEllipse = translated(w, ellipseId, scale(n, shift), keep);
  const moveLine = lineCurve ? translated(w, lineId, scale(n, -shift), keep) : null;
  const order = k.refs[0] === lineId ? [moveEllipse, moveLine] : [moveLine, moveEllipse];
  return order.flatMap((s) => s ?? []);
}

/**
 * A control spline's end is steered by its first legs, so those are what move: the first control
 * point for tangent, the next as well for curvature, where the first three lie on the line.
 */
function steeredLegs(w: World, spline: Extract<Curve, { type: 'controlSpline' }>, atStart: boolean, joint: Vec2, line: Vec2, curvature: boolean, keep: Id[]): Seat | null {
  const pts = atStart ? spline.pts : [...spline.pts].reverse();
  if (pts.length < 3) return null;
  const u = norm(line);
  const leg = sub(getPointPos(w.sketch, pts[1]), joint);
  const dir = dot(leg, u) >= 0 ? u : scale(u, -1);
  const first = add(joint, scale(dir, len(leg)));
  if (!curvature) return transform(w, [pts[1]], () => first, keep);
  const next = getPointPos(w.sketch, pts[2]);
  const far = Math.max(dot(sub(next, joint), dir), 1.5 * len(leg));
  const second = add(joint, scale(dir, far));
  return transform(w, [pts[1], pts[2]], (p) => (dist(p, next) < TINY ? second : first), keep);
}

/** A line joining a spline's end: turn one about the join. A fit spline's end can't be steered, only moved whole. */
function lineSpline(w: World, k: Constraint, lineId: Id, splineId: Id): Seat[] {
  const line = w.sketch.curves[lineId];
  const spline = w.sketch.curves[splineId];
  if (line?.type !== 'line' || !spline) return [];
  const ends = curveEnds(spline);
  if (!ends) return [];
  const atStart = [line.a, line.b].some((p) => w.rep(p) === w.rep(ends[0]));
  const atEnd = [line.a, line.b].some((p) => w.rep(p) === w.rep(ends[1]));
  if (!atStart && !atEnd) return [];
  const joint = getPointPos(w.sketch, atStart ? ends[0] : ends[1]);
  const along = unitTangent(resolve(w.sketch, spline), atStart ? 0 : 1);
  const l = lineOf(w.sketch, lineId);
  if (!l || len(l.d) < TINY) return [];
  const t = turnOnto(l.d, along);
  const keep = [lineId];
  const turnLine = rotatedAbout(w, line, joint, t, keep);
  const turnSpline = rotatedAbout(w, spline, joint, -t, keep);
  const held = w.hold.has(line.a) && w.hold.has(line.b);
  const legs = spline.type === 'controlSpline' ? steeredLegs(w, spline, atStart, joint, l.d, k.type === 'curvature', keep) : null;
  return (held ? [legs, turnSpline, turnLine] : [turnLine, legs, turnSpline]).flatMap((s) => s ?? []);
}

function tangent(w: World, k: Constraint): Seat[] {
  const [a, b] = k.refs;
  if (a === b) return [];
  const isSpline = (id: Id): boolean => ['fitSpline', 'controlSpline'].includes(w.sketch.curves[id]?.type ?? '');
  if (isSpline(a) && w.sketch.curves[b]?.type === 'line') return lineSpline(w, k, b, a);
  if (isSpline(b) && w.sketch.curves[a]?.type === 'line') return lineSpline(w, k, a, b);
  const ra = roundOf(w.sketch, a);
  const rb = roundOf(w.sketch, b);
  if (ra && rb) return roundRound(w, k, ra, rb);
  if (rb && lineOf(w.sketch, a)) return lineRound(w, k, a, rb);
  if (ra && lineOf(w.sketch, b)) return lineRound(w, k, b, ra);
  if (lineOf(w.sketch, a) && w.sketch.curves[b]?.type === 'ellipse') return lineEllipse(w, k, a, b);
  if (lineOf(w.sketch, b) && w.sketch.curves[a]?.type === 'ellipse') return lineEllipse(w, k, b, a);
  return [];
}

/** A point joins a curve: the point goes to the curve. Only if it cannot does the curve translate. */
function pointOnCurve(w: World, k: Constraint): Seat[] {
  const [x, y] = k.refs;
  const point = w.sketch.points[x] || x === ORIGIN ? x : w.sketch.points[y] || y === ORIGIN ? y : null;
  if (!point) return [];
  const curveId = point === x ? y : x;
  const p = getPointPos(w.sketch, point);
  const round = roundOf(w.sketch, curveId);
  const line = lineOf(w.sketch, curveId);
  const e = w.sketch.curves[curveId];
  let foot: Vec2;
  if (round) {
    const out = sub(p, round.c);
    if (len(out) < TINY) return [];
    foot = add(round.c, scale(norm(out), round.r));
  } else if (line) {
    if (len(line.d) < TINY) return [];
    const u = norm(line.d);
    foot = add(line.p, scale(u, dot(sub(p, line.p), u)));
  } else if (e?.type === 'ellipse') {
    foot = closestPoint(w.sketch, e, p).p;
  } else return [];

  const keep = [curveId];
  // A centre is a round, not a point: it goes whole, as it does for Midpoint.
  const rounds = centredOn(w, point);
  const moveRound = rounds.length === 1 ? translated(w, rounds[0].id, sub(foot, p), [rounds[0].id, ...keep]) : null;
  const movePoint = moveRound ?? transform(w, [point], () => foot, keep);
  const moveCurve = curveId === AXIS_X || curveId === AXIS_Y ? null : translated(w, curveId, sub(p, foot), keep);
  // With a line the first pick is the one that stays. A circle never resizes for a point.
  const order = line && x === point ? [moveCurve, movePoint] : [movePoint, moveCurve];
  return order.flatMap((s) => s ?? []);
}

function resizeLine(w: World, id: Id, length: number, keep: Id[]): Seat[] {
  const c = w.sketch.curves[id];
  if (c?.type !== 'line') return [];
  const a = getPointPos(w.sketch, c.a);
  const b = getPointPos(w.sketch, c.b);
  const now = dist(a, b);
  if (now < TINY) return [];
  const f = length / now;
  return pivots(w, c).flatMap((at) => transform(w, [c.a, c.b], (p) => add(at, scale(sub(p, at), f)), keep) ?? []);
}

function resizeRound(w: World, round: Round, r: number, keep: Id[]): Seat | null {
  const c = round.curve;
  if (c.fixed || c.projected || c.derivedFrom !== undefined) return null;
  if (c.type === 'circle') return { ...emptySeat(keep), radii: new Map([[c.id, r]]), moved: Math.abs(r - c.r) };
  return transform(w, [c.a, c.b], (p) => add(round.c, scale(norm(sub(p, round.c)), r)), keep);
}

/** An arc takes radius `r` with its ends where they are, by moving its centre along the chord's bisector. */
function resizeByCentre(w: World, round: Round, r: number, keep: Id[]): Seat | null {
  const c = round.curve;
  if (c.type !== 'arc') return null;
  const to = centreForRadius(round.c, getPointPos(w.sketch, c.a), getPointPos(w.sketch, c.b), r);
  return to ? recentred(w, c.id, to, keep) : null;
}

function equal(w: World, k: Constraint): Seat[] {
  if (k.refs.length !== 2) return [];
  const [a, b] = k.refs;
  const ra = roundOf(w.sketch, a);
  const rb = roundOf(w.sketch, b);
  if (ra && rb) {
    return [
      resizeRound(w, rb, ra.r, [a]), resizeByCentre(w, rb, ra.r, [a]), resizeRound(w, ra, rb.r, [b]), resizeByCentre(w, ra, rb.r, [b]),
    ].flatMap((s) => s ?? []);
  }
  const la = lineOf(w.sketch, a);
  const lb = lineOf(w.sketch, b);
  if (!la || !lb) return [];
  return [...resizeLine(w, b, len(la.d), [a]), ...resizeLine(w, a, len(lb.d), [b])];
}

function radial(w: World, k: Constraint): Seat[] {
  const [a, b] = k.refs;
  const lineId = lineOf(w.sketch, a) ? a : b;
  const round = roundOf(w.sketch, lineId === a ? b : a);
  const l = lineOf(w.sketch, lineId);
  if (!round || !l || len(l.d) < TINY) return [];
  const n = perp(norm(l.d));
  const off = dot(sub(round.c, l.p), n);
  const keep = [lineId, round.id];
  const moveRound = translated(w, round.id, scale(n, -off), keep);
  const moveLine = translated(w, lineId, scale(n, off), keep);
  const resize = recentred(w, round.id, add(round.c, scale(n, -off)), [lineId]);
  return (k.refs[0] === lineId ? [moveRound, resize, moveLine] : [moveLine, moveRound, resize]).flatMap((s) => s ?? []);
}

/** The middle of a line, or of an arc's sweep. */
function middleOf(w: World, curve: Curve): Vec2 | null {
  if (curve.type === 'line') return lerp(getPointPos(w.sketch, curve.a), getPointPos(w.sketch, curve.b), 0.5);
  if (curve.type !== 'arc') return null;
  return sweepMiddle(getPointPos(w.sketch, curve.c), getPointPos(w.sketch, curve.a), getPointPos(w.sketch, curve.b));
}

/** The point goes to the middle of the curve, or the curve travels to the point. */
function midpoint(w: World, k: Constraint): Seat[] {
  if (k.refs.length !== 2) return [];
  const [point, curveId] = k.refs;
  const curve = w.sketch.curves[curveId];
  const mid = curve ? middleOf(w, curve) : null;
  if (!curve || !mid || !isPoint(w.sketch, point)) return [];
  const p = getPointPos(w.sketch, point);
  const keep = [curveId];
  const owner = w.sketch.points[point]?.owner;
  const hosted = owner !== undefined && owner !== curveId && attached(w, owner).includes(point) ? owner : null;
  const by = sub(mid, p);
  const seats: (Seat | null)[] = [hosted ? translated(w, hosted, by, [hosted, ...keep]) : transform(w, [point], () => mid, keep)];
  const rounds = hosted ? [] : centredOn(w, point);
  if (rounds.length === 1) seats.unshift(translated(w, rounds[0].id, by, [rounds[0].id, ...keep]));
  seats.push(translated(w, curveId, sub(p, mid), keep));
  return seats.flatMap((s) => s ?? []);
}

function midpointBodies(w: World, k: Constraint): Seat[] {
  if (k.refs.length !== 2) return [];
  const [point, curveId] = k.refs;
  const curve = w.sketch.curves[curveId];
  const mid = curve ? middleOf(w, curve) : null;
  if (!curve || !mid || !isPoint(w.sketch, point)) return [];
  const by = sub(mid, getPointPos(w.sketch, point));
  return [
    pointBody(w, point, by, [curveId], curvePoints(curve)[0]),
    wholeBody(w, curveId, (p) => sub(p, by), [curveId]),
  ].flatMap((s) => s ?? []);
}

/** A point on a curve, by moving the body of either. */
function pointOnCurveBodies(w: World, k: Constraint): Seat[] {
  const [x, y] = k.refs;
  const point = isPoint(w.sketch, x) ? x : isPoint(w.sketch, y) ? y : null;
  const curveId = point === x ? y : x;
  if (!point || !w.sketch.curves[curveId]) return [];
  const foot = closestPoint(w.sketch, w.sketch.curves[curveId], getPointPos(w.sketch, point)).p;
  const by = sub(foot, getPointPos(w.sketch, point));
  return [
    pointBody(w, point, by, [curveId], curvePoints(w.sketch.curves[curveId])[0]),
    wholeBody(w, curveId, (p) => sub(p, by), [curveId]),
  ].flatMap((s) => s ?? []);
}

/** Pairs of points a symmetry maps onto each other, as `symmetric_pairs` in the solver has them. */
function mirrorPairs(a: Curve, b: Curve, variant: number | undefined): [Id, Id][] {
  const swap = ((variant ?? 0) & 1) === 1;
  if (a.type === 'line' && b.type === 'line') return swap ? [[a.a, b.b], [a.b, b.a]] : [[a.a, b.a], [a.b, b.b]];
  if (a.type === 'arc' && b.type === 'arc') return swap ? [[a.c, b.c], [a.a, b.b], [a.b, b.a]] : [[a.c, b.c], [a.a, b.a], [a.b, b.b]];
  if (a.type === 'circle' && b.type === 'circle') return [[a.c, b.c]];
  return [];
}

/** `to` takes the mirror image of `from`, point for point. */
function reflected(w: World, pairs: [Id, Id][], l: { p: Vec2; d: Vec2 }, keep: Id[]): Seat | null {
  const seat = emptySeat(keep);
  for (const [from, to] of pairs) {
    const at = reflect(getPointPos(w.sketch, from), l.p, l.d);
    const was = getPointPos(w.sketch, to);
    const by = sub(at, was);
    if (len(by) <= TINY) continue;
    const r = w.rep(to);
    if (w.pinned.has(r)) return null;
    seat.moved = Math.max(seat.moved, len(by));
    for (const m of w.members.get(r) ?? [to]) seat.points.set(m, add(getPointPos(w.sketch, m), by));
  }
  return seat;
}

/** The matching object goes to the mirror image of the first, or the first to that of the matching one. */
function symmetric(w: World, k: Constraint): Seat[] {
  if (k.refs.length !== 3) return [];
  const [a, b, axis] = k.refs;
  const l = lineOf(w.sketch, axis);
  if (!l || len(l.d) < TINY) return [];
  if (isPoint(w.sketch, a) && isPoint(w.sketch, b)) {
    const body = (from: Id, to: Id): Seat | null => pointBody(w, to, sub(reflect(getPointPos(w.sketch, from), l.p, l.d), getPointPos(w.sketch, to)), [], from);
    const seats = [body(a, b), body(b, a)].flatMap((s) => s ?? []);
    const alone = [reflected(w, [[a, b]], l, []), reflected(w, [[b, a]], l, [])].flatMap((s) => (s ? [{ ...s, reshapes: true }] : []));
    return [...seats, ...alone];
  }
  const [ca, cb] = [w.sketch.curves[a], w.sketch.curves[b]];
  if (!ca || !cb) return [];
  const pairs = mirrorPairs(ca, cb, k.variant);
  const flip = pairs.map(([p, q]): [Id, Id] => [q, p]);
  return [reflected(w, pairs, l, [a]), reflected(w, flip, l, [b])].flatMap((s) => s ?? []);
}

function candidates(w: World, k: Constraint): Seat[] {
  const isCurve = (id: Id): boolean => !!w.sketch.curves[id] || id === AXIS_X || id === AXIS_Y;
  switch (k.type) {
    case 'parallel': return directional(w, k, (d) => d);
    case 'perpendicular': {
      const rounds = k.refs.some((id) => roundOf(w.sketch, id));
      return rounds ? radial(w, k) : directional(w, k, perp);
    }
    case 'collinear': return collinear(w, k);
    case 'horizontal': case 'vertical': return axisAligned(w, k);
    case 'concentric': return concentric(w, k);
    case 'tangent': case 'curvature': return tangent(w, k);
    case 'equal': return equal(w, k);
    case 'symmetric': return symmetric(w, k);
    case 'midpoint': return midpoint(w, k);
    case 'coincident':
      if (k.refs.length !== 2) return [];
      return k.refs.some(isCurve) ? pointOnCurve(w, k) : pointsJoined(w, k);
    default: return [];
  }
}

/** A tangent with no shared point, met by moving either side's whole body. */
function tangentBodies(w: World, k: Constraint): Seat[] {
  const [a, b] = k.refs;
  const ra = roundOf(w.sketch, a);
  const rb = roundOf(w.sketch, b);
  const keep = [a, b];
  let by: Vec2 | null = null;
  let aMoves = 1;
  if (ra && rb) {
    if (!contact(w, ra.curve, rb.curve)) by = roundRoundShift(k, ra, rb);
  } else if (rb && lineOf(w.sketch, a)) by = lineRoundShift(w, k, a, rb);
  else if (ra && lineOf(w.sketch, b)) {
    by = lineRoundShift(w, k, b, ra);
    aMoves = -1;
  }
  if (!by) return [];
  const step = by;
  return [
    wholeBody(w, b, (p) => add(p, scale(step, aMoves)), keep, a),
    wholeBody(w, a, (p) => add(p, scale(step, -aMoves)), keep, b),
  ].flatMap((s) => s ?? []);
}

/** A line, and all it is joined to, turned and shifted onto the other line. */
function collinearBodies(w: World, k: Constraint): Seat[] {
  const out: (Seat | null)[] = [];
  for (const [ref, mover] of [[k.refs[0], k.refs[1]], [k.refs[1], k.refs[0]]]) {
    const l = lineOf(w.sketch, ref);
    const c = w.sketch.curves[mover];
    if (!l || c?.type !== 'line' || len(l.d) < TINY) continue;
    const u = norm(l.d);
    const a = getPointPos(w.sketch, c.a);
    const b = getPointPos(w.sketch, c.b);
    const at = lerp(a, b, 0.5);
    const t = turnOnto(sub(b, a), l.d);
    const toLine = scale(perp(u), -dot(sub(at, l.p), perp(u)));
    out.push(wholeBody(w, mover, (p) => add(rotateAbout(p, at, t), toLine), [mover, ref], ref));
  }
  return out.flatMap((s) => s ?? []);
}

/** Moves of a whole joined body, last in line: nothing changes shape, but more of the sketch travels. */
function bodies(w: World, k: Constraint): Seat[] {
  switch (k.type) {
    case 'tangent': return tangentBodies(w, k);
    case 'collinear': return collinearBodies(w, k);
    case 'concentric': return concentricBodies(w, k);
    case 'midpoint': return midpointBodies(w, k);
    case 'coincident': {
      const onCurve = k.refs.some((id) => !!w.sketch.curves[id]);
      return onCurve ? pointOnCurveBodies(w, k) : k.refs.every((id) => isPoint(w.sketch, id)) ? pointsJoinedBodies(w, k) : [];
    }
    case 'parallel': return k.refs.some((id) => roundOf(w.sketch, id)) ? [] : directionalBodies(w, k, (d) => d);
    case 'perpendicular': return k.refs.some((id) => roundOf(w.sketch, id)) ? [] : directionalBodies(w, k, perp);
    case 'horizontal': case 'vertical': {
      const body = k.refs.length === 1 ? aimedBody(w, k.refs[0], axisOf(k), [k.refs[0]]) : null;
      return body ? [body] : [];
    }
    default: return [];
  }
}

/** Ways to seat `k`, best first. Empty when the constraint already holds or no move exists. */
export function seatsFor(world: World, k: Constraint): Seat[] {
  if (k.feature) return [];
  // In the world the seat is about: a new coincident or midpoint is not yet what joins its two sides,
  // or a seat would carry the point along with the curve and meet nothing.
  const w = k.type === 'coincident' || k.type === 'midpoint' ? makeWorld(world.sketch, [...world.hold], world.frozen, k.id) : world;
  const all = candidates(w, k);
  if (all.length === 0 || all.some((s) => s.moved < SEAT_EPS)) return [];
  // Rigid first, the lightest of them first; a seat that changes a shape only after every rigid one.
  // A body heavier than what is held goes after that: only a caller holds the lighter object, and a
  // caller that does means the rest of the sketch to stay too.
  const whole = bodies(w, k).sort((a, b) => a.points.size - b.points.size);
  const limit = w.hold.size ? weightOf(w.sketch, [...w.hold]) : Infinity;
  const light = whole.filter((s) => weightOf(w.sketch, [...s.points.keys()]) <= limit);
  const heavy = whole.filter((s) => !light.includes(s));
  const seats = [...all.filter((s) => !s.reshapes), ...light, ...all.filter((s) => s.reshapes), ...heavy];
  return seats.map((s) => withMirrors(w, withRiders(w, s)));
}

/** Curves a constraint is about: what they do is its business, what the rest do is disturbance. */
export function ownCurves(w: World, refs: Id[]): Set<Id> {
  const own = new Set<Id>();
  for (const id of refs) {
    if (w.sketch.curves[id]) own.add(id);
    else if (isPoint(w.sketch, id)) for (const c of centredOn(w, id)) own.add(c.id);
  }
  for (const f of Object.values(w.sketch.features)) {
    if (f.type !== 'mirror') continue;
    for (const [a, b] of f.pairs) {
      if (own.has(a)) own.add(b);
      else if (own.has(b)) own.add(a);
    }
  }
  return own;
}


/** A tangent dimension is about a gap, not a size: the round moves to it, as with a tangent constraint. */
export function seatsForDimension(w: World, d: Dimension): Seat[] {
  if (d.kind !== 'tangentLine' && d.kind !== 'tangentRounds') return [];
  const measured = measureDimension(w.sketch, d);
  if (measured === null || Math.abs(measured - d.value) < SEAT_EPS) return [];
  const by = d.value - measured;
  const [first, second] = d.refs;
  const a = roundOf(w.sketch, first);
  if (!a) return [];
  const keep = [first, second];
  if (d.kind === 'tangentLine') {
    const l = lineOf(w.sketch, second);
    if (!l || len(l.d) < TINY) return [];
    const n = perp(norm(l.d));
    const away = scale(n, dot(sub(a.c, l.p), n) >= 0 ? by : -by);
    return [translated(w, first, away, keep), translated(w, second, scale(away, -1), keep)].flatMap((s) => s ?? []);
  }
  const b = roundOf(w.sketch, second);
  if (!b) return [];
  const u = norm(sub(b.c, a.c));
  return [translated(w, second, scale(u, by), keep), translated(w, first, scale(u, -by), keep)].flatMap((s) => s ?? []);
}

export function applySeat(sketch: Sketch, seat: Seat): void {
  for (const [id, q] of seat.points) {
    const p = sketch.points[id];
    if (p) {
      p.x = q.x;
      p.y = q.y;
    }
  }
  for (const [id, r] of seat.radii) {
    const c = sketch.curves[id];
    if (c?.type === 'circle') c.r = r;
  }
}
