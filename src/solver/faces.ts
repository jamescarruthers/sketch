// The bounded faces of a sketch. A loop sharing an edge with another is a face of its own, and every other
// cycle is a sum of faces, so a sketch whose faces all keep their side has not turned over. A face's area is
// the true area of its outline, arcs and all, on this side of the wasm boundary and on that one alike.
import type { Curve, Id, Sketch, Vec2 } from '../model/types';
import { ORIGIN } from '../model/types';
import { coincidentClasses, curveEnds, getPointPos } from '../model/document';
import { flattenParam, resolve } from '../geom/curves';

/** An arc edge of a face: from corner `at` to the next, about `c`, counter-clockwise or not. */
export interface Bulge { at: number; c: Id; ccw: boolean }
/** A face as the guards read it: its corners are curves' own ends, not their coincidence classes. */
export interface Face { corners: Id[]; bulges: Bulge[]; edges: { curve: Id; near: Id }[]; plain: boolean }

/** Everything a solve can change, as far as a face needs. */
type Places = Map<Id, Vec2>;

/** Loops worth guarding in one sketch. */
const MAX_FACES = 256;
/** The same as `FLAT_LOOP` in `branch.rs`. */
const FLAT_LOOP = 1e-7;
const ARC_CHORDS_PER_TURN = 48;
/** Above this many segments an outline is too long to test on every commit. */
const MAX_SEGMENTS = 4000;

/** Counter-clockwise from `a` to `b` about `c`, in 0 to a full turn. */
export function sweepOf(c: Vec2, a: Vec2, b: Vec2): number {
  const [ux, uy, vx, vy] = [a.x - c.x, a.y - c.y, b.x - c.x, b.y - c.y];
  const t = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  return t < 0 ? t + 2 * Math.PI : t;
}

/** A curve from one of its ends as a run of points, the first being that end. */
function flatFrom(sketch: Sketch, c: Curve, from: Id): Vec2[] {
  const [a, b] = curveEnds(c) as [Id, Id];
  if (c.type === 'line') return [getPointPos(sketch, from), getPointPos(sketch, from === a ? b : a)];
  let pts: Vec2[];
  if (c.type === 'arc') {
    const o = getPointPos(sketch, c.c);
    const [p, q] = [getPointPos(sketch, c.a), getPointPos(sketch, c.b)];
    const sweep = sweepOf(o, p, q);
    const n = Math.max(2, Math.ceil((sweep / (2 * Math.PI)) * ARC_CHORDS_PER_TURN));
    const [r, t0] = [Math.hypot(p.x - o.x, p.y - o.y), Math.atan2(p.y - o.y, p.x - o.x)];
    pts = Array.from({ length: n + 1 }, (_, i) => ({ x: o.x + r * Math.cos(t0 + (sweep * i) / n), y: o.y + r * Math.sin(t0 + (sweep * i) / n) }));
  } else pts = flattenParam(resolve(sketch, c)).pts;
  return from === a ? pts : [...pts].reverse();
}

/** Which way a curve leaves `from`, a little along it, so that a line and an arc tangent there still differ. */
function headingOf(sketch: Sketch, c: Curve, from: Id): number {
  const pts = flatFrom(sketch, c, from);
  const q = c.type === 'line' ? pts[1] : pts[Math.max(1, Math.floor(pts.length / 4))];
  return Math.atan2(q.y - pts[0].y, q.x - pts[0].x);
}

function shoelace(pts: Vec2[]): number {
  let sum = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  });
  return sum / 2;
}

/** The length of a closed run of points. */
function lengthOf(pts: Vec2[]): number {
  return pts.reduce((sum, p, i) => {
    const q = pts[(i + 1) % pts.length];
    return sum + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);
}

/** The bounded faces of the sketch, each simple in the graph. Lines and arcs alone are `plain`. */
export function facesOf(sketch: Sketch): Face[] {
  const rep = coincidentClasses(sketch);
  interface Half { curve: Curve; near: Id; from: Id; to: Id; heading: number; twin?: Half; turn?: Half }
  const at = new Map<Id, Half[]>();
  for (const c of Object.values(sketch.curves)) {
    if (c.type === 'text') continue;
    const ends = curveEnds(c);
    if (!ends || rep(ends[0]) === rep(ends[1])) continue;
    const [ra, rb] = [rep(ends[0]), rep(ends[1])];
    const out: Half = { curve: c, near: ends[0], from: ra, to: rb, heading: headingOf(sketch, c, ends[0]) };
    const back: Half = { curve: c, near: ends[1], from: rb, to: ra, heading: headingOf(sketch, c, ends[1]), twin: out };
    out.twin = back;
    at.set(ra, [...(at.get(ra) ?? []), out]);
    at.set(rb, [...(at.get(rb) ?? []), back]);
  }
  // The face on the left of an edge goes on, at the far end, by the next edge clockwise from its way back.
  for (const list of at.values()) {
    list.sort((x, y) => x.heading - y.heading);
    list.forEach((h, i) => {
      (h.twin as Half).turn = list[(i + list.length - 1) % list.length];
    });
  }
  const outline = (cycle: Half[]): Vec2[] => cycle.flatMap((h) => flatFrom(sketch, h.curve, h.near).slice(0, -1));
  const faces: Face[] = [];
  const seen = new Set<string>();
  const keep = (cycle: Half[]): void => {
    if (cycle.length < 2) return;
    const pts = outline(cycle);
    const area = shoelace(pts);
    if (!(area > 0) && Math.abs(area) > FLAT_LOOP * lengthOf(pts) ** 2) return;
    const key = cycle.map((c) => c.curve.id).sort().join();
    if (seen.has(key)) return;
    const bulges: Bulge[] = [];
    cycle.forEach((h, i) => {
      if (h.curve.type === 'arc') bulges.push({ at: i, c: h.curve.c, ccw: h.near === h.curve.a });
    });
    const face: Face = {
      corners: cycle.map((c) => c.near), bulges, edges: cycle.map((c) => ({ curve: c.curve.id, near: c.near })),
      plain: cycle.every((c) => c.curve.type === 'line' || c.curve.type === 'arc'),
    };
    // A loop is walked both ways, and the walk that goes round it counter-clockwise is the face. A bow tie whose
    // lobes balance has no such walk, and is an outline all the same; anything else this flat is an edge walked
    // out and back, or a loop gone to a line, and has no inside to keep.
    if (!(area > 0) && !crossesItself(sketch, face)) return;
    seen.add(key);
    faces.push(face);
  };
  const done = new Set<Half>();
  for (const list of at.values()) {
    for (const start of list) {
      if (done.has(start)) continue;
      // A face's walk passes a cut point twice and a bridge both ways: what closes on the way is a cycle.
      const path: Half[] = [];
      for (let h = start; !done.has(h); h = h.turn as Half) {
        done.add(h);
        const again = path.findIndex((p) => p.from === h.from);
        if (again >= 0) keep(path.splice(again));
        path.push(h);
      }
      if (path.length && path[path.length - 1].to === path[0].from) keep(path);
    }
  }
  return faces.slice(0, MAX_FACES);
}

/** The side a face is on, as the solver reckons it: 0 when it is too thin to have one. */
export function sideOf(places: Places, face: Pick<Face, 'corners' | 'bulges'>): number {
  const at = (id: Id): Vec2 => (id === ORIGIN ? { x: 0, y: 0 } : places.get(id) ?? { x: 0, y: 0 });
  const pts = face.corners.map(at);
  let sum = shoelace(pts);
  let round = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    round += Math.hypot(q.x - p.x, q.y - p.y);
  });
  for (const b of face.bulges) {
    const [p, q, c] = [pts[b.at], pts[(b.at + 1) % pts.length], at(b.c)];
    const r = Math.hypot(p.x - c.x, p.y - c.y);
    const t = b.ccw ? sweepOf(c, p, q) : sweepOf(c, p, q) - 2 * Math.PI;
    sum += (r * r * (t - Math.sin(t))) / 2;
  }
  return Math.abs(sum) > FLAT_LOOP * round * round ? sum : 0;
}

/** Whether a face that was on `was` has left it. */
export function offItsSide(places: Places, face: Pick<Face, 'corners' | 'bulges'>, was: number): boolean {
  return was !== 0 && sideOf(places, face) * was <= 0;
}

const orient = (a: Vec2, b: Vec2, c: Vec2): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Whether a face's outline, its real curves flattened, passes through itself. Touching is not crossing. */
export function crossesItself(sketch: Sketch, face: Face): boolean {
  const pts = face.edges.flatMap((e) => flatFrom(sketch, sketch.curves[e.curve], e.near).slice(0, -1));
  const n = pts.length;
  if (n < 4 || n > MAX_SEGMENTS) return false;
  const box = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    return { x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y), p, q };
  });
  for (let i = 0; i < n; i++) {
    const a = box[i];
    const size = Math.hypot(a.p.x - a.q.x, a.p.y - a.q.y);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b = box[j];
      if (b.x0 > a.x1 || b.x1 < a.x0 || b.y0 > a.y1 || b.y1 < a.y0) continue;
      const eps = 1e-9 * size * Math.hypot(b.p.x - b.q.x, b.p.y - b.q.y);
      const [d1, d2, d3, d4] = [orient(a.p, a.q, b.p), orient(a.p, a.q, b.q), orient(b.p, b.q, a.p), orient(b.p, b.q, a.q)];
      if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
    }
  }
  return false;
}
