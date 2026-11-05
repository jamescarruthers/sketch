// A body is what hangs off the rest at one point, whatever it is made of; a shape on several points goes
// by the move they share. Each case here is a sketch someone drew and the edit that went wrong.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Design, Dimension, Id, Line, Sketch, Vec2 } from '../model/types';
import { addArc, addConstraint, addDimension, addLine, addPoint, getPointPos, newDesign, newSketch } from '../model/document';
import { planBodies } from './bodies';
import { initSolver, solveSketch } from './bridge';

let d: Design;
let s: Sketch;

beforeAll(async () => {
  await initSolver();
});

const fresh = (): void => {
  d = newDesign();
  s = newSketch(d);
};

const chain = (...p: Vec2[]): Line[] => {
  const out = p.slice(1).map((q, i) => addLine(d, s, p[i], q));
  out.slice(1).forEach((l, i) => addConstraint(d, s, 'coincident', [out[i].b, l.a]));
  return out;
};

/** Bottom, right, top, left, closed, its corner at the origin unless told otherwise, and a width. */
function rectangle(x = 60, y = 40, at: Vec2 = { x: 0, y: 0 }): { edges: Line[]; width: Dimension } {
  const q = [{ ...at }, { x: at.x + x, y: at.y }, { x: at.x + x, y: at.y + y }, { x: at.x, y: at.y + y }, { ...at }];
  const edges = chain(...q);
  addConstraint(d, s, 'coincident', [edges[3].b, edges[0].a]);
  edges.forEach((l, i) => addConstraint(d, s, i % 2 ? 'vertical' : 'horizontal', [l.id]));
  if (!at.x && !at.y) addConstraint(d, s, 'coincident', ['origin', edges[0].a]);
  const width = addDimension(d, s, 'distance', [edges[2].a, edges[2].b], x);
  solveSketch(s);
  return { edges, width };
}

const size = (l: Line): number => {
  const [a, b] = [getPointPos(s, l.a), getPointPos(s, l.b)];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
const heading = (l: Line): number => {
  const [a, b] = [getPointPos(s, l.a), getPointPos(s, l.b)];
  return Math.atan2(b.y - a.y, b.x - a.x);
};
const set = (k: Dimension, v: number): ReturnType<typeof solveSketch> => {
  k.value = v;
  return solveSketch(s);
};
const area = (ls: Line[]): number => ls.reduce((t, l) => {
  const [a, b] = [getPointPos(s, l.a), getPointPos(s, l.b)];
  return t + a.x * b.y - b.x * a.y;
}, 0) / 2;

describe('what hangs off a single point goes with it, whole', () => {
  it.each([80, 120, 45])('a tail with a dimension of its own, width %i: the height stays and the tail keeps its heading', (v) => {
    fresh();
    const { edges, width } = rectangle();
    const [tail] = chain({ x: 60, y: 40 }, { x: 85, y: 60 });
    addConstraint(d, s, 'coincident', [edges[1].b, tail.a]);
    addDimension(d, s, 'distance', [tail.a, tail.b], 32.02);
    solveSketch(s);
    const turned = heading(tail);
    expect(set(width, v).ok).toBe(true);
    expect(size(edges[1])).toBeCloseTo(40, 6);
    expect(size(tail)).toBeCloseTo(32.02, 6);
    expect(heading(tail)).toBeCloseTo(turned, 6);
  });

  it('an arc with a radius of its own', () => {
    fresh();
    const { edges, width } = rectangle();
    const a = addArc(d, s, { x: 80, y: 40 }, { x: 60, y: 40 }, { x: 100, y: 40 });
    addConstraint(d, s, 'coincident', [edges[1].b, a.a]);
    addDimension(d, s, 'radius', [a.id], 20);
    solveSketch(s);
    expect(set(width, 120).ok).toBe(true);
    expect(size(edges[1])).toBeCloseTo(40, 6);
    expect(getPointPos(s, a.c).x).toBeCloseTo(140, 6);
    expect(getPointPos(s, a.b).x).toBeCloseTo(160, 6);
  });

  it.each([80, 90, 100, 110, 120])('a triangle on a corner does not stand in the way, width %i', (v) => {
    fresh();
    const { edges, width } = rectangle();
    const tri = chain({ x: 60, y: 40 }, { x: 85, y: 60 }, { x: 100, y: 30 }, { x: 60, y: 40 });
    addConstraint(d, s, 'coincident', [edges[1].b, tri[0].a]);
    addConstraint(d, s, 'coincident', [tri[2].b, tri[0].a]);
    solveSketch(s);
    const sides = tri.map(size);
    expect(set(width, v).refusal).toBeUndefined();
    tri.forEach((l, i) => expect(size(l)).toBeCloseTo(sides[i], 6));
  });

  it.each([80, 120])('a triangle on the end of a line, length %i', (v) => {
    fresh();
    const [l] = chain({ x: 0, y: 0 }, { x: 60, y: 0 });
    addConstraint(d, s, 'coincident', ['origin', l.a]);
    const tri = chain({ x: 60, y: 0 }, { x: 90, y: 20 }, { x: 80, y: -20 }, { x: 60, y: 0 });
    addConstraint(d, s, 'coincident', [l.b, tri[0].a]);
    addConstraint(d, s, 'coincident', [tri[2].b, tri[0].a]);
    const k = addDimension(d, s, 'distance', [l.a, l.b], 60);
    solveSketch(s);
    const sides = tri.map(size);
    expect(set(k, v).refusal).toBeUndefined();
    tri.forEach((t, i) => expect(size(t)).toBeCloseTo(sides[i], 6));
    expect(getPointPos(s, l.a).x).toBeCloseTo(0, 6);
  });

  it('a chain goes as one, from the joint of the line that changed', () => {
    fresh();
    const [a, b, c] = chain({ x: 0, y: 0 }, { x: 30, y: 10 }, { x: 50, y: -5 }, { x: 80, y: 20 });
    addConstraint(d, s, 'coincident', ['origin', a.a]);
    const k = addDimension(d, s, 'distance', [a.a, a.b], Math.hypot(30, 10));
    solveSketch(s);
    const [hb, hc] = [heading(b), heading(c)];
    expect(set(k, 60).ok).toBe(true);
    expect(heading(b)).toBeCloseTo(hb, 6);
    expect(heading(c)).toBeCloseTo(hc, 6);
  });
});

describe('what is a body', () => {
  const joined = (): { tail: Line; edges: Line[]; width: Dimension } => {
    fresh();
    const { edges, width } = rectangle();
    const [tail] = chain({ x: 60, y: 40 }, { x: 85, y: 60 });
    addConstraint(d, s, 'coincident', [edges[1].b, tail.a]);
    solveSketch(s);
    return { tail, edges, width };
  };
  const seeds = (k: Dimension): Set<Id> => new Set<Id>([k.id, ...k.refs]);
  const body = (k: Dimension): Id[] => planBodies(s, seeds(k)).bodies.flatMap((b) => b.curves);

  it('joined at one point and tied to nothing else, it is one', () => {
    const { tail, width } = joined();
    expect(body(width)).toEqual([tail.id]);
  });

  it('a constraint to the rest ties it', () => {
    const { tail, edges, width } = joined();
    addConstraint(d, s, 'parallel', [tail.id, edges[0].id]);
    expect(body(width)).toEqual([]);
  });

  it('a dimension to the rest ties it', () => {
    const { tail, edges, width } = joined();
    addDimension(d, s, 'distance', [tail.b, edges[0].a], 90);
    expect(body(width)).toEqual([]);
  });

  it('an expression ties it, though no row does', () => {
    const { tail, width } = joined();
    addDimension(d, s, 'distance', [tail.a, tail.b], 30, { expression: `${width.name} / 2` });
    expect(body(width)).toEqual([]);
  });

  it('something fixed in it stops it being carried', () => {
    const { tail, width } = joined();
    s.points[tail.b].fixed = true;
    expect(body(width)).toEqual([]);
  });

  it('a point riding on a curve does not carry the curve', () => {
    const { tail } = joined();
    const on = addPoint(d, s, { x: 85, y: 60 }, { owner: tail.id });
    const far = addLine(d, s, { x: 65, y: 60 }, { x: 105, y: 60 });
    addConstraint(d, s, 'coincident', [on.id, far.id]);
    addConstraint(d, s, 'coincident', [on.id, tail.b]);
    const own = addDimension(d, s, 'distance', [tail.a, tail.b], 32.02);
    expect(body(own).includes(far.id)).toBe(false);
  });

  it('a body with a row of its own unmet goes through the solve', () => {
    const { tail, edges, width } = joined();
    const own = addDimension(d, s, 'distance', [tail.a, tail.b], 32.02);
    solveSketch(s);
    own.value = 50;
    width.value = 80;
    expect(solveSketch(s).ok).toBe(true);
    expect(size(tail)).toBeCloseTo(50, 6);
    expect(size(edges[2])).toBeCloseTo(80, 6);
    expect(size(edges[1])).toBeCloseTo(40, 6);
  });

  it('what the commit is about is never the body, so the rectangle stays when its tail is edited', () => {
    const { tail, edges } = joined();
    const own = addDimension(d, s, 'distance', [tail.a, tail.b], 32.02);
    solveSketch(s);
    expect(set(own, 50).ok).toBe(true);
    expect(getPointPos(s, edges[1].b).x).toBeCloseTo(60, 6);
    expect(getPointPos(s, edges[1].b).y).toBeCloseTo(40, 6);
  });

  it('still counts as free in the sketch, carried or not', () => {
    const { width } = joined();
    width.value = 80;
    const r = solveSketch(s, { analyze: true });
    expect(r.dof).toBe(3);
  });
});

describe('a shape joined at several points', () => {
  it.each([80, 90, 120, 200])('an ear on the side that moved goes with it, width %i', (v) => {
    fresh();
    const { edges, width } = rectangle();
    const ear = chain({ x: 60, y: 40 }, { x: 90, y: 20 }, { x: 60, y: 0 });
    addConstraint(d, s, 'coincident', [edges[1].b, ear[0].a]);
    addConstraint(d, s, 'coincident', [edges[0].b, ear[1].b]);
    solveSketch(s);
    const was = area(ear);
    expect(set(width, v).ok).toBe(true);
    expect(area(ear) * was).toBeGreaterThan(0);
    expect(size(ear[0])).toBeCloseTo(Math.hypot(30, 20), 6);
    expect(size(ear[1])).toBeCloseTo(Math.hypot(30, 20), 6);
    expect(getPointPos(s, ear[0].b).x).toBeCloseTo(v + 30, 6);
  });

  it.each([60, 20, 4])('a roof holds its lengths where its feet do not move alike, height %i', (v) => {
    fresh();
    const { edges } = rectangle();
    const roof = chain({ x: 0, y: 40 }, { x: 30, y: 65 }, { x: 60, y: 40 });
    addConstraint(d, s, 'coincident', [edges[3].a, roof[0].a]);
    addConstraint(d, s, 'coincident', [edges[2].a, roof[1].b]);
    const h = addDimension(d, s, 'distance', [edges[1].a, edges[1].b], 40);
    solveSketch(s);
    const was = size(roof[0]);
    expect(set(h, v).ok).toBe(true);
    expect(size(roof[0])).toBeCloseTo(was, 6);
    expect(size(roof[1])).toBeCloseTo(was, 6);
  });

  it('an ear on an edge whose ends move apart keeps its lengths and stays out of the rectangle', () => {
    fresh();
    const { edges, width } = rectangle();
    const ear = chain({ x: 0, y: 40 }, { x: 30, y: 60 }, { x: 60, y: 40 });
    addConstraint(d, s, 'coincident', [edges[3].a, ear[0].a]);
    addConstraint(d, s, 'coincident', [edges[2].a, ear[1].b]);
    solveSketch(s);
    const was = size(ear[0]);
    expect(set(width, 70).ok).toBe(true);
    expect(size(ear[0])).toBeCloseTo(was, 6);
    expect(getPointPos(s, ear[0].b).y).toBeGreaterThan(40);
  });
});

describe('every face keeps its side', () => {
  it('two loops sharing an edge: flattening the ear is refused, not gone through', () => {
    fresh();
    const { edges } = rectangle();
    const ear = chain({ x: 60, y: 40 }, { x: 90, y: 20 }, { x: 60, y: 0 });
    addConstraint(d, s, 'coincident', [edges[1].b, ear[0].a]);
    addConstraint(d, s, 'coincident', [edges[0].b, ear[1].b]);
    const across = addDimension(d, s, 'horizontal', [ear[0].a, ear[0].b], 30);
    solveSketch(s);
    const r = set(across, -30);
    expect(r.refusal).toContain('go flat');
    expect(getPointPos(s, ear[0].b).x).toBeCloseTo(90, 6);
  });
});
