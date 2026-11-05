// The ordinary drawn shapes, each put through what a person does to one: every constraint on its own,
// the tangents in every order, and each dimension out to 0.7 and 1.6 of itself and back. What holds at
// every step is in `settled`, and a shape that had to give way a lot must say so.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Arc, Curve, Design, Dimension, Id, Line, Sketch, Vec2 } from '../model/types';
import { addArc, addCircle, addConstraint, addDimension, addLine, curvePoints, getPointPos, newDesign, newSketch } from '../model/document';
import { analyzeSketch, brokenOf, initSolver, solveSketch, type SolveResult } from './bridge';

let d: Design;
let s: Sketch;

beforeAll(async () => {
  await initSolver();
});

const line = (a: Vec2, b: Vec2): Line => addLine(d, s, a, b);
const chain = (...p: Vec2[]): Line[] => p.slice(1).map((q, i) => line(p[i], q));
const rect = (x0: number, y0: number, x1: number, y1: number): Line[] => {
  const c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
  const edges = chain(...c);
  edges.forEach((l, i) => addConstraint(d, s, i % 2 ? 'vertical' : 'horizontal', [l.id]));
  return edges;
};
const centre = (a: Vec2, b: Vec2, m: Vec2): Vec2 => {
  const n = 2 * (a.x * (b.y - m.y) + b.x * (m.y - a.y) + m.x * (a.y - b.y));
  const q = (p: Vec2): number => p.x * p.x + p.y * p.y;
  return {
    x: (q(a) * (b.y - m.y) + q(b) * (m.y - a.y) + q(m) * (a.y - b.y)) / n,
    y: (q(a) * (m.x - b.x) + q(b) * (a.x - m.x) + q(m) * (b.x - a.x)) / n,
  };
};
/** From `a` to `b` through `m`, whichever way round that makes the stored arc. */
const arc = (a: Vec2, b: Vec2, m: Vec2): Arc => {
  const c = centre(a, b, m);
  const ccw = (b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x) < 0;
  return ccw ? addArc(d, s, c, a, b) : addArc(d, s, c, b, a);
};
/** What was drawn end to end is joined, as drawing it with snap would have. */
const weld = (): void => {
  const ends = Object.values(s.curves).flatMap((c) => (c.type === 'line' || c.type === 'arc' ? [c.a, c.b] : []));
  ends.forEach((p, i) => {
    const q = ends.slice(0, i).find((o) => {
      const [u, v] = [getPointPos(s, o), getPointPos(s, p)];
      return Math.hypot(u.x - v.x, u.y - v.y) < 1e-9;
    });
    if (q) addConstraint(d, s, 'coincident', [q, p]);
  });
};

/** Nudges a drawn point, the same way each time for a seed. */
const rough = (seed: number) => (x: number, y: number, k: number): Vec2 => {
  if (!seed) return { x, y };
  const f = (i: number): number => {
    const v = Math.sin((seed * 97 + k * 13 + i * 7) * 12.9898) * 43758.5453;
    return (v - Math.floor(v) - 0.5) * 2.6;
  };
  return { x: x + f(1), y: y + f(2) };
};

type P = ReturnType<typeof rough>;
const SHAPES: Record<string, (p: P) => void> = {
  link: (p) => {
    const [a, b, c, e] = [p(-30, 20, 1), p(30, 10, 2), p(30, -10, 3), p(-30, -20, 4)];
    line(a, b);
    line(e, c);
    arc(a, e, p(-52, 0, 5));
    arc(b, c, p(42, 0, 6));
  },
  stadium: (p) => {
    const [a, b, c, e] = [p(-31, 13, 1), p(29, 11, 2), p(31, -13, 3), p(-29, -11, 4)];
    line(a, b);
    line(e, c);
    arc(a, e, p(-43, 1, 5));
    arc(b, c, p(43, -1, 6));
  },
  'D shape': (p) => {
    const [a, b] = [p(-16, 12, 1), p(16, 12, 2)];
    line(a, b);
    arc(b, a, p(0, -20, 3));
  },
  keyhole: (p) => {
    const [a, b, c, e] = [p(6, 0, 1), p(6, -40, 2), p(-6, -40, 3), p(-6, 0, 4)];
    chain(a, b, c, e);
    arc(e, a, p(0, 28, 5));
  },
  teardrop: (p) => {
    const [t, a, b] = [p(0, 50, 1), p(-22, 8, 2), p(22, 8, 3)];
    chain(a, t, b);
    arc(b, a, p(0, -22, 4));
  },
  'rectangle with an ear': (p) => {
    rect(0, 0, 60, 40);
    chain({ x: 60, y: 40 }, p(90, 20, 1), { x: 60, y: 0 });
  },
  roof: (p) => {
    rect(-30, -20, 30, 20);
    chain({ x: -30, y: 20 }, p(0, 50, 1), { x: 30, y: 20 });
  },
  'bay on a hexagon': (p) => {
    const v = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 30 * Math.cos((i * Math.PI) / 3), y: 30 * Math.sin((i * Math.PI) / 3) }));
    chain(...v, v[0]);
    chain(v[0], p(55, 15, 1), v[1]);
  },
  flag: () => {
    line({ x: -30, y: -40 }, { x: -30, y: 10 });
    rect(-30, 10, 20, 40);
  },
  'rectangle with a tail': (p) => {
    rect(0, 0, 60, 40);
    line({ x: 60, y: 40 }, p(85, 60, 1));
  },
  chain: (p) => {
    chain(p(-60, -20, 1), p(-30, 10, 2), p(-5, -5, 3), p(25, 18, 4), p(55, 0, 5));
  },
  'gear tooth': () => {
    const q = [[-40, 0], [-22, 0], [-14, 18], [14, 18], [22, 0], [40, 0], [40, -30], [-40, -30], [-40, 0]].map(([x, y]) => ({ x, y }));
    chain(...q);
  },
  bracket: () => {
    const q = [[-40, -30], [40, -30], [40, -10], [-10, -10], [-10, 40], [-40, 40], [-40, -30]].map(([x, y]) => ({ x, y }));
    chain(...q);
    addCircle(d, s, { x: -25, y: 25 }, 6);
    addCircle(d, s, { x: 25, y: -20 }, 5);
  },
  'slot chain': (p) => {
    const [a, b, e, f] = [p(-40, 9, 1), p(-10, 9, 2), p(-10, -9, 3), p(-40, -9, 4)];
    line(a, b);
    line(f, e);
    arc(a, f, p(-49, 0, 5));
    arc(b, e, p(-1, 0, 6));
    chain(e, p(30, -20, 7), p(60, 5, 8));
  },
  'pulley block': (p) => {
    const [l, m, r] = [p(-14, 31, 1), p(1, 10, 2), p(15, 30, 3)];
    chain(l, m, r);
    chain(l, p(-24, 32, 4), p(-25, -1, 5), p(24, 0, 6), p(26, 30, 7), r);
  },
  cam: (p) => {
    const [a, b, c, e] = [p(24, 17, 1), p(-23, 19, 2), p(8, 43, 3), p(-9, 41, 4)];
    arc(a, b, p(1, -31, 5));
    line(a, c);
    arc(c, e, p(0, 51, 6));
    line(e, b);
  },
  hook: (p) => {
    const [a, b, c, e, f] = [p(1, 61, 1), p(-11, 60, 2), p(-10, 16, 3), p(27, 12, 4), p(17, 12, 5)];
    const g = p(1, 15, 6);
    chain(a, b, c);
    arc(c, e, p(8, -16, 7));
    arc(e, f, p(22, 17, 8));
    arc(f, g, p(9, -3, 9));
    line(g, a);
  },
  keyway: (p) => {
    const [a, b, c, e] = [p(-5.5, 23.8, 1), p(-4.8, 19.6, 2), p(5.3, 20.4, 3), p(4.7, 24.2, 4)];
    chain(a, b, c, e);
    arc(e, a, p(0.5, -25.5, 5));
  },
  dovetail: (p) => {
    const q = [p(-40, 0, 1), p(-16, 1, 2), p(-11, 17, 3), p(12, 16, 4), p(17, -1, 5), p(41, 1, 6), p(40, -22, 7), p(-41, -21, 8)];
    chain(...q, q[0]);
  },
  gusset: (p) => {
    const q = [{ x: 0, y: 0 }, p(81, 1, 1), p(80, 13, 2), p(13, 79, 3), p(-1, 81, 4)];
    chain(...q, q[0]);
  },
  't slot': (p) => {
    chain(p(-7, 1, 1), p(-6, -9, 2), p(-13, -10, 3), p(-14, -21, 4), p(13, -20, 5), p(12, -9, 6), p(6, -10, 7), p(7, 0, 8));
  },
};

const drawn = (name: string, seed: number): void => {
  d = newDesign();
  s = newSketch(d);
  SHAPES[name](rough(seed));
  weld();
  expect(solveSketch(s).ok).toBe(true);
};

const lines = (): Line[] => Object.values(s.curves).filter((c): c is Line => c.type === 'line');
const arcs = (): Arc[] => Object.values(s.curves).filter((c): c is Arc => c.type === 'arc');
const span = (c: Line): number => {
  const [a, b] = [getPointPos(s, c.a), getPointPos(s, c.b)];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
const sweep = (c: Arc): number => {
  const [o, a, b] = [getPointPos(s, c.c), getPointPos(s, c.a), getPointPos(s, c.b)];
  const t = Math.atan2((a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x), (a.x - o.x) * (b.x - o.x) + (a.y - o.y) * (b.y - o.y));
  return t < 0 ? t + 2 * Math.PI : t;
};

interface Edge { curve: Line | Arc; from: Id }

/** Each simple cycle of lines and arcs, as edges, up to a bound: every one, not a basis of them. */
function cycles(): Edge[][] {
  const parent = new Map<Id, Id>();
  const find = (a: Id): Id => (parent.has(a) ? find(parent.get(a) as Id) : a);
  for (const k of Object.values(s.constraints)) if (k.type === 'coincident' && s.points[k.refs[0]] && s.points[k.refs[1]] && find(k.refs[0]) !== find(k.refs[1])) parent.set(find(k.refs[0]), find(k.refs[1]));
  const edges = [...lines(), ...arcs()].map((c) => ({ c, u: find(c.a), v: find(c.b) }));
  const found = new Map<string, Edge[]>();
  const walk = (start: Id, at: Id, path: Edge[], seen: Set<Id>): void => {
    for (const e of edges) {
      if (path.some((p) => p.curve.id === e.c.id) || (e.u !== at && e.v !== at) || found.size >= 40) continue;
      const [from, to] = e.u === at ? [e.c.a, e.v] : [e.c.b, e.u];
      const next = [...path, { curve: e.c, from }];
      if (to === start) {
        if (next.length >= 2) found.set(next.map((p) => p.curve.id).sort().join(), next);
      } else if (!seen.has(to)) walk(start, to, next, new Set([...seen, to]));
    }
  };
  for (const start of new Set(edges.flatMap((e) => [e.u, e.v]))) walk(start, start, [], new Set([start]));
  return [...found.values()];
}

/** The outline's true area, arcs and all, and its corners' perimeter. */
const area = (cycle: Edge[], at: (id: Id) => Vec2): { size: number; round: number } => {
  let [size, round] = [0, 0];
  cycle.forEach((e, i) => {
    const [p, q] = [at(e.from), at(cycle[(i + 1) % cycle.length].from)];
    size += (p.x * q.y - q.x * p.y) / 2;
    round += Math.hypot(q.x - p.x, q.y - p.y);
    if (e.curve.type === 'arc') {
      const c = at(e.curve.c);
      const ccw = e.from === e.curve.a;
      const [u, v] = ccw ? [p, q] : [q, p];
      const raw = Math.atan2((u.x - c.x) * (v.y - c.y) - (u.y - c.y) * (v.x - c.x), (u.x - c.x) * (v.x - c.x) + (u.y - c.y) * (v.y - c.y));
      const t = raw < 0 ? raw + 2 * Math.PI : raw;
      const r = Math.hypot(p.x - c.x, p.y - c.y);
      size += ((ccw ? 1 : -1) * r * r * (t - Math.sin(t))) / 2;
    }
  });
  return { size, round };
};

interface Then { at: Map<Id, Vec2>; lengths: Map<Id, number>; sweeps: Map<Id, number>; loops: Edge[][] }

const taken = (): Then => ({
  at: new Map(Object.values(s.points).map((p) => [p.id, { x: p.x, y: p.y }])),
  lengths: new Map(lines().map((l) => [l.id, span(l)])),
  sweeps: new Map(arcs().map((a) => [a.id, sweep(a)])),
  loops: cycles(),
});

const motion = (then: Then): number => Math.max(0, ...Object.values(s.points).map((p) => {
  const q = then.at.get(p.id) as Vec2;
  return Math.hypot(p.x - q.x, p.y - q.y);
}));

/** What is true after any step. A refusal changed nothing, and a row that says it is met is met. */
function settled(what: string, then: Then, r: SolveResult, own: Id[]): void {
  if (r.refusal) {
    expect(motion(then), `${what}: refused and yet moved`).toBeLessThan(1e-9);
    return;
  }
  const rows = new Set([...Object.keys(s.constraints), ...Object.values(s.dimensions).filter((k) => k.driving).map((k) => k.id)]);
  if (r.ok) expect(brokenOf(s, rows, undefined, 1e-3), `${what}: says met`).toEqual([]);
  for (const corners of then.loops) {
    const was = area(corners, (id) => then.at.get(id) as Vec2);
    const is = area(corners, (id) => getPointPos(s, id));
    if (Math.abs(was.size) > 1e-3 * was.round * was.round) expect(was.size * is.size, `${what}: a loop turned over`).toBeGreaterThan(0);
  }
  if (r.notes?.length || !r.ok) return;
  for (const l of lines()) {
    if (!own.includes(l.id) && s.curves[l.id]) expect(span(l), `${what}: ${l.id} lost half its length without a word`).toBeGreaterThan((then.lengths.get(l.id) as number) * 0.5 - 1e-6);
  }
  for (const a of arcs()) {
    if (!own.includes(a.id)) expect(Math.abs(sweep(a) - (then.sweeps.get(a.id) as number)), `${what}: ${a.id} swung round without a word`).toBeLessThan(Math.PI / 2 + 1e-6);
  }
}

/** What a commit says about freedom is what a fresh look at the sketch says. */
const honest = (what: string, r: SolveResult): void => {
  const fresh = analyzeSketch(s);
  expect(r.dof, `${what}: dof`).toBe(fresh.dof);
  expect([...r.freeCurves].sort(), `${what}: free curves`).toEqual([...fresh.freeCurves].sort());
};

function constrain(kind: Parameters<typeof addConstraint>[2], refs: Id[], hold: Id[]): SolveResult {
  const k = addConstraint(d, s, kind, refs);
  const r = solveSketch(s, { hold, analyze: true });
  if (r.ok && !r.refusal) honest(`${kind} ${refs.join()}`, r);
  if (r.refusal || !r.ok) delete s.constraints[k.id];
  return r;
}

const ownPoints = (id: Id): Id[] => curvePoints(s.curves[id] as Curve);

const joined = (a: Arc, l: Line): boolean => [a.a, a.b].some((p) => [l.a, l.b].some((q) => {
  const [u, v] = [getPointPos(s, p), getPointPos(s, q)];
  return Math.hypot(u.x - v.x, u.y - v.y) < 1e-6;
}));

function orders<T>(list: T[]): T[][] {
  if (list.length < 2) return [list];
  return list.flatMap((x, i) => orders([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest]));
}

const names = Object.keys(SHAPES);
const seeds = [0, 1, 2];

describe.each(names)('%s', (name) => {
  it.each(seeds)('each constraint alone, either pick first, seed %i', (seed) => {
    drawn(name, seed);
    const pairs: [Parameters<typeof addConstraint>[2], Id, Id][] = [];
    const ls = lines();
    ls.forEach((l, i) => {
      const m = ls[(i + 1) % ls.length];
      if (m !== l) pairs.push(['parallel', l.id, m.id], ['parallel', m.id, l.id], ['equal', l.id, m.id], ['equal', m.id, l.id]);
    });
    for (const a of arcs()) for (const l of ls) pairs.push(['tangent', a.id, l.id], ['tangent', l.id, a.id]);
    const [a0, a1] = arcs();
    if (a1) pairs.push(['equal', a0.id, a1.id], ['concentric', a0.id, a1.id]);
    for (const [kind, x, y] of pairs) {
      drawn(name, seed);
      const then = taken();
      settled(`${kind} ${x} ${y}`, then, constrain(kind, [x, y], ownPoints(x)), [x, y]);
    }
    for (const l of ls) {
      drawn(name, seed);
      const then = taken();
      settled(`horizontal ${l.id}`, then, constrain('horizontal', [l.id], []), [l.id]);
    }
  });

  if (!['D shape', 'keyhole', 'teardrop', 'cam', 'hook', 'keyway'].includes(name)) {
    it.each(seeds)('the tangents in every order, seed %i', (seed) => {
      drawn(name, seed);
      const n = orders(arcs().flatMap((a) => lines().filter((l) => joined(a, l)).map((l) => [a.id, l.id]))).length;
      for (let i = 0; i < n; i++) {
        drawn(name, seed);
        const first = taken();
        const order = orders(arcs().flatMap((a) => lines().filter((l) => joined(a, l)).map((l) => [a.id, l.id])))[i];
        for (const [a, l] of order) {
          const then = taken();
          settled(`order ${i}: tangent ${a} ${l}`, then, constrain('tangent', [a, l], ownPoints(a)), [a, l]);
        }
        // A rough outline cleaned up is the same outline.
        if (name === 'link' || name === 'stadium') {
          expect(motion(first), `order ${i}`).toBeLessThan(14);
          for (const l of lines()) expect(span(l), `order ${i}`).toBeGreaterThan((first.lengths.get(l.id) as number) * 0.85);
        }
      }
    }, 60_000);
  }

  it.each(seeds)('dimensions out to 0.7 and 1.6 and back, seed %i', (seed) => {
    drawn(name, seed);
    const dims: Dimension[] = [];
    for (const l of [...new Set([lines().at(-1) as Line, ...lines().slice(0, 3)])]) dims.push(addDimension(d, s, 'distance', [l.a, l.b], span(l)));
    expect(solveSketch(s).ok).toBe(true);
    const home = taken();
    for (const k of dims) {
      const was = k.value;
      for (const f of [0.7, 0.85, 1.25, 1.6]) {
        const then = taken();
        k.value = was * f;
        const r = solveSketch(s, { analyze: true });
        if (r.ok && !r.refusal) honest(`${k.name} x${f}`, r);
        const own = Object.values(s.curves).filter((c) => curvePoints(c).some((p) => k.refs.includes(p))).map((c) => c.id);
        settled(`${k.name} x${f}`, then, r, own);
        k.value = was;
        expect(solveSketch(s).ok, `${k.name} back from x${f}`).toBe(true);
        expect(motion(home), `${k.name} back from x${f}`).toBeLessThan(1e-6);
      }
    }
  });
});
