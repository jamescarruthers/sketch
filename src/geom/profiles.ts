// Closed-region detection: planarise the eligible curves, walk faces, nest islands as holes.
import type { Curve, Id, Sketch, Vec2 } from '../model/types';
import { coincidentClasses, curveEnds, getPointPos } from '../model/document';
import { boxOfParam, flattenParam, resolve, type ParamCurve } from './curves';
import { intersect, selfIntersections } from './intersect';
import { EPS_JOIN, EPS_PARAM, FLATTEN_TOL } from './tolerance';
import { boxesOverlap, dist, lerp, pointInPolygon, polygonArea, type Box } from './vec';

export interface ProfileEdge { curve: Id; t0: number; t1: number }

export interface ProfileLoop {
  /** Closed polygon, last point not repeated. Counter-clockwise for outers, clockwise for holes. */
  pts: Vec2[];
  edges: ProfileEdge[];
}

export interface Profile {
  outer: ProfileLoop;
  holes: ProfileLoop[];
  /** Net area in mm squared, holes subtracted. */
  area: number;
  /** Curves on the boundary of this region. */
  curves: Id[];
}

interface Edge { u: number; v: number; pts: Vec2[]; curve: Id; t0: number; t1: number }

const eligible = (c: Curve): boolean => c.type !== 'text' && c.lineType !== 'construction';

class Vertices {
  private readonly cells = new Map<string, number[]>();
  private readonly byRep = new Map<Id, number>();
  readonly pos: Vec2[] = [];

  /** Find or create the vertex for a position, optionally keyed by a coincident class. */
  at(p: Vec2, rep?: Id): number {
    if (rep !== undefined) {
      const hit = this.byRep.get(rep);
      if (hit !== undefined) return hit;
    }
    const kx = Math.floor(p.x / EPS_JOIN);
    const ky = Math.floor(p.y / EPS_JOIN);
    for (let x = kx - 1; x <= kx + 1; x++) {
      for (let y = ky - 1; y <= ky + 1; y++) {
        for (const i of this.cells.get(`${x},${y}`) ?? []) {
          if (dist(this.pos[i], p) <= EPS_JOIN) {
            if (rep !== undefined) this.byRep.set(rep, i);
            return i;
          }
        }
      }
    }
    const i = this.pos.length;
    this.pos.push(p);
    const key = `${kx},${ky}`;
    const list = this.cells.get(key);
    if (list) list.push(i);
    else this.cells.set(key, [i]);
    if (rep !== undefined) this.byRep.set(rep, i);
    return i;
  }
}

interface Item { curve: Curve; pc: ParamCurve; box: Box; cuts: number[] }

function collectCuts(sketch: Sketch): Item[] {
  const items: Item[] = [];
  for (const curve of Object.values(sketch.curves)) {
    if (!eligible(curve)) continue;
    const pc = resolve(sketch, curve);
    items.push({ curve, pc, box: boxOfParam(pc), cuts: [] });
  }
  items.sort((a, b) => a.box.minX - b.box.minX);
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    for (const s of selfIntersections(a.pc)) a.cuts.push(s.t1, s.t2);
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (b.box.minX > a.box.maxX + EPS_JOIN) break;
      if (!boxesOverlap(a.box, b.box, EPS_JOIN)) continue;
      for (const h of intersect(a.pc, b.pc)) {
        a.cuts.push(h.ta);
        b.cuts.push(h.tb);
      }
    }
  }
  return items;
}

function buildEdges(sketch: Sketch, items: Item[], tol: number): { edges: Edge[]; vertices: Vertices } {
  const rep = coincidentClasses(sketch);
  const vertices = new Vertices();
  const edges: Edge[] = [];
  for (const it of items) {
    const ends = curveEnds(it.curve);
    const closed = it.pc.closed;
    const ts = [...new Set(it.cuts.map((t) => (closed ? t % 1 : t)).filter((t) => closed || (t > EPS_PARAM && t < 1 - EPS_PARAM)))].sort((a, b) => a - b);
    const spans: [number, number][] = [];
    if (closed) {
      if (ts.length === 0) spans.push([0, 1]);
      else for (let i = 0; i < ts.length; i++) spans.push([ts[i], i + 1 < ts.length ? ts[i + 1] : ts[0] + 1]);
    } else {
      const all = [0, ...ts, 1];
      for (let i = 0; i + 1 < all.length; i++) spans.push([all[i], all[i + 1]]);
    }
    spans.forEach(([t0, t1], k) => {
      if (t1 - t0 < EPS_PARAM) return;
      const pts = flattenParam(it.pc, tol, t0, t1).pts;
      const startRep = !closed && k === 0 && ends ? rep(ends[0]) : undefined;
      const endRep = !closed && k === spans.length - 1 && ends ? rep(ends[1]) : undefined;
      const u = vertices.at(pts[0], startRep);
      const v = vertices.at(pts[pts.length - 1], endRep);
      edges.push({ u, v, pts, curve: it.curve.id, t0, t1 });
    });
  }
  return { edges, vertices };
}

/** Coincident stretches (a line over another) would otherwise make zero-area faces. */
function dropDuplicateEdges(edges: Edge[]): Edge[] {
  const seen = new Map<string, Edge[]>();
  const out: Edge[] = [];
  for (const e of edges) {
    const key = e.u < e.v ? `${e.u}:${e.v}` : `${e.v}:${e.u}`;
    const others = seen.get(key) ?? [];
    // Halfway along it, not a stored point: the middle point of a two-point line is its end, which is on anything it joins.
    const n = Math.floor(e.pts.length / 2);
    const mid = e.pts.length % 2 ? e.pts[n] : lerp(e.pts[n - 1], e.pts[n], 0.5);
    const dup = e.u !== e.v && others.some((o) => o.pts.some((p, i) => {
      const q = o.pts[Math.min(i + 1, o.pts.length - 1)];
      const f = dist(p, q);
      return dist(p, mid) + dist(q, mid) <= f + EPS_JOIN * 2;
    }));
    if (dup) continue;
    others.push(e);
    seen.set(key, others);
    out.push(e);
  }
  return out;
}

function pruneDangling(edges: Edge[], vertexCount: number): Edge[] {
  const degree = new Array<number>(vertexCount).fill(0);
  for (const e of edges) {
    degree[e.u]++;
    degree[e.v]++;
  }
  let live = edges;
  for (;;) {
    const next = live.filter((e) => degree[e.u] > 1 && degree[e.v] > 1);
    if (next.length === live.length) return live;
    for (const e of live) {
      if (degree[e.u] <= 1 || degree[e.v] <= 1) {
        degree[e.u]--;
        degree[e.v]--;
      }
    }
    live = next;
  }
}

interface Half { edge: number; forward: boolean; from: number; to: number; angle: number }

function angleAt(pts: Vec2[], reverse: boolean): number {
  const n = pts.length;
  const a = reverse ? pts[n - 1] : pts[0];
  const b = reverse ? pts[n - 2] : pts[1];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

interface Face { halves: number[]; pts: Vec2[]; area: number; component: number }

function walkFaces(edges: Edge[], vertexCount: number): Face[] {
  const halves: Half[] = [];
  edges.forEach((e, i) => {
    halves.push({ edge: i, forward: true, from: e.u, to: e.v, angle: angleAt(e.pts, false) });
    halves.push({ edge: i, forward: false, from: e.v, to: e.u, angle: angleAt(e.pts, true) });
  });
  const out: number[][] = Array.from({ length: vertexCount }, () => []);
  halves.forEach((h, i) => out[h.from].push(i));
  const orderAt = new Map<number, number>();
  for (const list of out) {
    list.sort((a, b) => halves[a].angle - halves[b].angle);
    list.forEach((h, i) => orderAt.set(h, i));
  }
  const twin = (h: number): number => h ^ 1;
  const next = (h: number): number => {
    const t = twin(h);
    const list = out[halves[t].from];
    const i = orderAt.get(t) as number;
    return list[(i + list.length - 1) % list.length];
  };

  // Faces of one connected component share a label so outers can be matched to holes.
  const comp = new Array<number>(vertexCount).fill(-1);
  let compCount = 0;
  for (let v = 0; v < vertexCount; v++) {
    if (comp[v] !== -1 || out[v].length === 0) continue;
    const stack = [v];
    comp[v] = compCount;
    while (stack.length) {
      const x = stack.pop() as number;
      for (const h of out[x]) {
        const to = halves[h].to;
        if (comp[to] === -1) {
          comp[to] = compCount;
          stack.push(to);
        }
      }
    }
    compCount++;
  }

  const visited = new Set<number>();
  const faces: Face[] = [];
  for (let h0 = 0; h0 < halves.length; h0++) {
    if (visited.has(h0)) continue;
    const list: number[] = [];
    let h = h0;
    do {
      visited.add(h);
      list.push(h);
      h = next(h);
    } while (h !== h0 && !visited.has(h));
    const pts: Vec2[] = [];
    for (const id of list) {
      const hh = halves[id];
      const e = edges[hh.edge].pts;
      const seq = hh.forward ? e : [...e].reverse();
      for (let i = 0; i + 1 < seq.length; i++) pts.push(seq[i]);
    }
    faces.push({ halves: list, pts, area: polygonArea(pts), component: comp[halves[h0].from] });
  }
  return faces;
}

function toLoop(face: Face, edges: Edge[]): ProfileLoop {
  const out: ProfileEdge[] = face.halves.map((h) => {
    const e = edges[h >> 1];
    return h & 1 ? { curve: e.curve, t0: e.t1, t1: e.t0 } : { curve: e.curve, t0: e.t0, t1: e.t1 };
  });
  return { pts: face.pts, edges: out };
}

/**
 * Bounded regions enclosed by normal and centerline curves. Curves that cross are split where they
 * cross, so overlapping circles give three regions. Regions never overlap: an inner circle gives both
 * the annulus (with a hole) and the disc. Fill each with its holes, even-odd.
 */
export function findProfiles(sketch: Sketch, tol = FLATTEN_TOL): Profile[] {
  const items = collectCuts(sketch);
  const { edges: raw, vertices } = buildEdges(sketch, items, tol);
  const edges = pruneDangling(dropDuplicateEdges(raw), vertices.pos.length);
  if (edges.length === 0) return [];

  const faces = walkFaces(edges, vertices.pos.length);
  const minArea = EPS_JOIN * EPS_JOIN;
  const bounded = faces.filter((f) => f.area > minArea).sort((a, b) => a.area - b.area);
  const outerCycles = faces.filter((f) => f.area < -minArea);
  const profiles: Profile[] = bounded.map((f) => ({
    outer: toLoop(f, edges), holes: [], area: f.area, curves: [],
  }));

  for (const outer of outerCycles) {
    const probe = outer.pts[0];
    const index = bounded.findIndex((f) => f.component !== outer.component && pointInPolygon(probe, f.pts));
    if (index >= 0) {
      profiles[index].holes.push(toLoop(outer, edges));
      profiles[index].area += outer.area;
    }
  }
  for (const p of profiles) {
    const ids = new Set<Id>();
    for (const e of p.outer.edges) ids.add(e.curve);
    for (const h of p.holes) for (const e of h.edges) ids.add(e.curve);
    p.curves = [...ids];
  }
  return profiles;
}

/** The smallest region containing p, if any. */
export function profileAt(profiles: Profile[], p: Vec2): Profile | null {
  let best: Profile | null = null;
  for (const r of profiles) {
    if (!pointInPolygon(p, r.outer.pts)) continue;
    if (r.holes.some((h) => pointInPolygon(p, h.pts))) continue;
    if (!best || r.area < best.area) best = r;
  }
  return best;
}

/** True when the point lies at an end of the curve, within join tolerance. */
export function isCurveEnd(sketch: Sketch, curve: Curve, p: Vec2): boolean {
  const ends = curveEnds(curve);
  return !!ends && ends.some((id) => dist(getPointPos(sketch, id), p) <= EPS_JOIN);
}
