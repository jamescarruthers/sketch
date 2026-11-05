// An outline is its real curves: a face's side is its true area, and one that runs through itself has failed.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Arc, Design, Dimension, Id, Line, Sketch, Vec2 } from '../model/types';
import { addArc, addConstraint, addControlSpline, addDimension, addLine, curvePoints, getPointPos, newDesign, newSketch } from '../model/document';
import { fillet } from '../geom/modify';
import { crossesItself, facesOf, sideOf } from './faces';
import { analyzeSketch, capture, initSolver, solveSketch } from './bridge';

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
const close = (ls: Line[]): void => {
  addConstraint(d, s, 'coincident', [ls[ls.length - 1].b, ls[0].a]);
};
const size = (l: Line): number => Math.hypot(getPointPos(s, l.a).x - getPointPos(s, l.b).x, getPointPos(s, l.a).y - getPointPos(s, l.b).y);
const centre = (a: Vec2, b: Vec2, m: Vec2): Vec2 => {
  const n = 2 * (a.x * (b.y - m.y) + b.x * (m.y - a.y) + m.x * (a.y - b.y));
  const q = (p: Vec2): number => p.x * p.x + p.y * p.y;
  return { x: (q(a) * (b.y - m.y) + q(b) * (m.y - a.y) + q(m) * (a.y - b.y)) / n, y: (q(a) * (m.x - b.x) + q(b) * (a.x - m.x) + q(m) * (b.x - a.x)) / n };
};

/** The pulley block with its V open at `open`, or free if that is null. */
function pulley(open: number | null): { bore: Dimension; h: Dimension; v: Line[] } {
  fresh();
  const q = [{ x: -15, y: 30 }, { x: 0, y: 15 }, { x: 15, y: 30 }, { x: 25, y: 30 }, { x: 25, y: 0 }, { x: -25, y: 0 }, { x: -25, y: 30 }];
  const ls = chain(...q);
  const l7 = addLine(d, s, q[6], q[0]);
  addConstraint(d, s, 'coincident', [ls[5].b, l7.a]);
  addConstraint(d, s, 'coincident', [l7.b, ls[0].a]);
  const [v1, v2, rimR, wallR, base, wallL] = ls;
  for (const [t, l] of [['horizontal', rimR], ['vertical', wallR], ['horizontal', base], ['vertical', wallL], ['horizontal', l7]] as const) addConstraint(d, s, t, [l.id]);
  addConstraint(d, s, 'equal', [v1.id, v2.id]);
  addConstraint(d, s, 'perpendicular', [v1.id, v2.id]);
  addConstraint(d, s, 'equal', [wallL.id, wallR.id]);
  addConstraint(d, s, 'midpoint', ['origin', base.id]);
  addConstraint(d, s, 'collinear', [l7.id, rimR.id]);
  const bore = addDimension(d, s, 'distance', [base.a, base.b], 50);
  const h = addDimension(d, s, 'distance', [wallR.a, wallR.b], 30);
  if (open) addDimension(d, s, 'distance', [v1.a, v2.b], open);
  expect(solveSketch(s).ok).toBe(true);
  return { bore, h, v: [v1, v2] };
}

describe('what cannot be helped is said', () => {
  it('a point forced across a base turns the triangle over, and that is noted', () => {
    fresh();
    const ls = chain({ x: -20, y: 0 }, { x: 20, y: 0 }, { x: 4, y: 30 }, { x: -20, y: 0 });
    close(ls);
    s.points[ls[0].a].fixed = true;
    s.points[ls[0].b].fixed = true;
    expect(solveSketch(s).ok).toBe(true);
    const target = addLine(d, s, { x: 4, y: -38 }, { x: 40, y: -38 });
    s.points[target.a].fixed = true;
    s.points[target.b].fixed = true;
    expect(solveSketch(s).ok).toBe(true);
    addConstraint(d, s, 'coincident', [ls[1].b, target.a]);
    const r = solveSketch(s);
    if (r.ok) expect(r.notes?.join()).toContain('turned over');
    else expect(r.refusal ?? r.unsatisfied.length).toBeTruthy();
  });
});

describe('an outline that would run through itself', () => {
  it('gives way where a free line can: the V shortens', () => {
    const { bore, v } = pulley(null);
    bore.value = 20;
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(r.notes?.[0]).toContain('gave way');
    expect(facesOf(s).some((f) => crossesItself(s, f))).toBe(false);
    expect(size(v[0])).toBeLessThan(21.3);
  });

  it('is said when nothing else meets the rows: the V is dimensioned wider than the block', () => {
    const { bore } = pulley(30);
    bore.value = 20;
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(r.notes?.[0]).toContain('crosses itself');
  });

  it('a spline outline that folds through a line is said too', () => {
    fresh();
    const base = addLine(d, s, { x: 0, y: 0 }, { x: 60, y: 0 });
    const sp = addControlSpline(d, s, [{ x: 60, y: 0 }, { x: 60, y: 30 }, { x: 0, y: 30 }, { x: 0, y: 0 }], 3);
    addConstraint(d, s, 'coincident', [base.b, sp.pts[0]]);
    addConstraint(d, s, 'coincident', [sp.pts[3], base.a]);
    expect(solveSketch(s).ok).toBe(true);
    expect(facesOf(s).length).toBe(1);
    expect(crossesItself(s, facesOf(s)[0])).toBe(false);
    addConstraint(d, s, 'horizontal', [sp.pts[1], sp.pts[2]]);
    const k = addDimension(d, s, 'distance', [sp.pts[1], base.a], 40);
    expect(solveSketch(s).ok).toBe(true);
    k.value = 40;
    const far = addDimension(d, s, 'vertical', ['origin', sp.pts[1]], 30);
    far.value = -30;
    const r = solveSketch(s);
    if (r.ok) expect(r.notes?.[0]).toContain('crosses itself');
  });
});

describe('an outline that already crosses itself', () => {
  it('reads as the sketch it is after free lines gave way', () => {
    const { bore } = pulley(null);
    bore.value = 20;
    const r = solveSketch(s, { analyze: true });
    expect(r.notes?.[0]).toContain('gave way');
    expect(r.dof).toBe(analyzeSketch(s).dof);
    expect(r.dof).toBeGreaterThan(0);
  });

  it.each([[12], [20], [33]])('takes a height of %i with a note, and is not said to turn over', (v) => {
    const { bore, h } = pulley(30);
    bore.value = 20;
    expect(solveSketch(s).notes?.[0]).toContain('crosses itself');
    h.value = v;
    const r = solveSketch(s);
    expect(r.refusal).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.notes?.[0]).toContain('still crosses itself');
  });

  it('a solve of it as it stands has nothing to say, a value edit always does', () => {
    const { bore, h } = pulley(30);
    bore.value = 20;
    solveSketch(s);
    expect(solveSketch(s, { analyze: true }).notes ?? []).toEqual([]);
    expect(solveSketch(s).notes ?? []).toEqual([]);
    h.value = 20;
    expect(solveSketch(s).notes?.[0]).toContain('still crosses itself');
  });

  it('a bow tie whose lobes balance is an outline, and a crossed one', () => {
    fresh();
    const ls = chain({ x: -30, y: -20 }, { x: 30, y: 20 }, { x: 30, y: -20 }, { x: -30, y: 20 }, { x: -30, y: -20 });
    close(ls);
    const faces = facesOf(s);
    expect(faces).toHaveLength(1);
    expect(crossesItself(s, faces[0])).toBe(true);
    const l = addDimension(d, s, 'distance', [ls[1].a, ls[1].b], 40);
    l.value = 60;
    expect(solveSketch(s).notes?.[0]).toContain('still crosses itself');
  });

  it('what is flat without crossing is no face: a chain out and back, a loop gone to a line', () => {
    fresh();
    chain({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 80, y: 30 });
    expect(facesOf(s)).toEqual([]);
    fresh();
    close(chain({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 0 }));
    expect(facesOf(s)).toEqual([]);
  });

  it('can come out: the value that made it cross undoes it, with nothing said', () => {
    const { bore, h } = pulley(30);
    bore.value = 20;
    solveSketch(s);
    h.value = 12;
    solveSketch(s);
    bore.value = 50;
    h.value = 30;
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(facesOf(s).some((f) => crossesItself(s, f))).toBe(false);
    expect(r.notes ?? []).toEqual([]);
  });
});

describe('a face has the area of its real curves', () => {
  const arcOver = (a: Vec2, b: Vec2, m: Vec2): Arc => {
    const c = centre(a, b, m);
    return (b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x) < 0 ? addArc(d, s, c, a, b) : addArc(d, s, c, b, a);
  };

  it.each([[20, 0], [10, 15], [0, 20]])('a chord and an arc through (%i, %i) is a D, not nothing', (x, y) => {
    fresh();
    const [a, b] = [{ x: -16, y: 12 }, { x: 16, y: 12 }];
    const l = addLine(d, s, a, b);
    const arc = arcOver(b, a, { x: x / 4, y: -20 + y / 4 });
    const atA = Math.abs(getPointPos(s, arc.a).x + 16) < 1e-6;
    addConstraint(d, s, 'coincident', [atA ? arc.a : arc.b, l.a]);
    addConstraint(d, s, 'coincident', [atA ? arc.b : arc.a, l.b]);
    const [f] = facesOf(s);
    expect(f.corners.length).toBe(2);
    expect(Math.abs(sideOf(capture(s).points, f))).toBeGreaterThan(100);
  });

  it('Parallel on a teardrop may lay its two legs in line: the arc keeps the face open', () => {
    fresh();
    const [t, a, b] = [{ x: 0, y: 50 }, { x: -22, y: 8 }, { x: 22, y: 8 }];
    const [l1, l2] = chain(a, t, b);
    const arc = arcOver(b, a, { x: 0, y: -22 });
    addConstraint(d, s, 'coincident', [arc.a, l2.b]);
    addConstraint(d, s, 'coincident', [arc.b, l1.a]);
    expect(solveSketch(s).ok).toBe(true);
    addConstraint(d, s, 'parallel', [l1.id, l2.id]);
    const r = solveSketch(s, { hold: curvePoints(l1) });
    expect(r.refusal).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it('the hook takes its last Horizontal, whatever the chords do', () => {
    fresh();
    const [p0, p1, p2, p3, p4, p5] = [{ x: 1, y: 61 }, { x: -11, y: 60 }, { x: -10, y: 16 }, { x: 27, y: 12 }, { x: 17, y: 12 }, { x: 1, y: 15 }];
    const [top, l1] = chain(p0, p1, p2);
    const a1 = arcOver(p2, p3, { x: 8, y: -16 });
    const a2 = arcOver(p3, p4, { x: 22, y: 17 });
    const a3 = arcOver(p4, p5, { x: 9, y: -3 });
    const l2 = addLine(d, s, p5, p0);
    const at = (arc: Arc, p: Vec2): Id => curvePoints(arc).find((id) => id !== arc.c && Math.hypot(getPointPos(s, id).x - p.x, getPointPos(s, id).y - p.y) < 1e-6) as Id;
    for (const [x, y] of [[l1.b, at(a1, p2)], [at(a1, p3), at(a2, p3)], [at(a2, p4), at(a3, p4)], [at(a3, p5), l2.a], [l2.b, top.a]]) addConstraint(d, s, 'coincident', [x, y]);
    expect(solveSketch(s).ok).toBe(true);
    for (const [t, x, y] of [['vertical', l2.id], ['tangent', a2.id, a3.id], ['tangent', l2.id, a3.id], ['tangent', a1.id, a2.id], ['concentric', a3.id, a1.id], ['vertical', l1.id]] as const) {
      addConstraint(d, s, t, y ? [x, y] : [x]);
      expect(solveSketch(s, { hold: curvePoints(s.curves[x]) }).ok).toBe(true);
    }
    addConstraint(d, s, 'horizontal', [top.id]);
    expect(solveSketch(s).refusal).toBeUndefined();
  });
});

describe('the walls of a closed profile', () => {
  it.each([32.5, 40, 22.5])('a keyway stays where it is when the radius goes to %f: its walls change length', (v) => {
    fresh();
    const [r, w, dp] = [25, 10, 20];
    const y = Math.sqrt(r * r - 25);
    const ls = chain({ x: -5, y }, { x: -5, y: dp }, { x: 5, y: dp }, { x: 5, y });
    const arc = addArc(d, s, { x: 0, y: 0 }, { x: 5, y }, { x: -5, y });
    addConstraint(d, s, 'coincident', ['origin', arc.c]);
    addConstraint(d, s, 'coincident', [ls[2].b, arc.a]);
    addConstraint(d, s, 'coincident', [arc.b, ls[0].a]);
    addConstraint(d, s, 'vertical', [ls[0].id]);
    addConstraint(d, s, 'vertical', [ls[2].id]);
    addConstraint(d, s, 'horizontal', [ls[1].id]);
    const R = addDimension(d, s, 'radius', [arc.id], r);
    addDimension(d, s, 'distance', [ls[1].a, ls[1].b], w);
    addDimension(d, s, 'vertical', [ls[1].b, 'origin'], dp);
    expect(solveSketch(s).ok).toBe(true);
    R.value = v;
    expect(solveSketch(s).ok).toBe(true);
    expect(getPointPos(s, ls[1].a).x).toBeCloseTo(-5, 5);
    expect(getPointPos(s, ls[1].b).x).toBeCloseTo(5, 5);
  });
});

describe('a plate keeps its size when its fillets change', () => {
  it.each([7, 3, 10])('three fillets from R5 to R%i', (v) => {
    fresh();
    const q = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }];
    const ls = chain(...q, q[0]);
    close(ls);
    ls.forEach((l, i) => addConstraint(d, s, i % 2 ? 'vertical' : 'horizontal', [l.id]));
    addConstraint(d, s, 'coincident', ['origin', ls[0].a]);
    addDimension(d, s, 'distance', [ls[0].a, ls[0].b], 80);
    addDimension(d, s, 'distance', [ls[1].a, ls[1].b], 40);
    expect(solveSketch(s).ok).toBe(true);
    const corners: [Line, Line, Vec2, Vec2][] = [[ls[0], ls[1], { x: 60, y: 0 }, { x: 80, y: 20 }], [ls[1], ls[2], { x: 80, y: 20 }, { x: 60, y: 40 }], [ls[2], ls[3], { x: 40, y: 40 }, { x: 0, y: 20 }]];
    const arcs: Id[] = [];
    for (const [a, b, pa, pb] of corners) {
      const res = fillet(d, s, a.id, b.id, 5, pa, pb);
      arcs.push(res.created.find((id) => s.curves[id]?.type === 'arc') as Id);
    }
    const radii = Object.values(s.dimensions).filter((k) => k.kind === 'radius');
    radii.slice(1).forEach((k) => delete s.dimensions[k.id]);
    arcs.slice(1).forEach((id) => addConstraint(d, s, 'equal', [arcs[0], id]));
    expect(solveSketch(s).ok).toBe(true);
    radii[0].value = v;
    expect(solveSketch(s).ok).toBe(true);
    const xs = Object.values(s.points).filter((p) => !arcs.some((id) => (s.curves[id] as Arc).c === p.id)).map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(80, 5);
    expect(Math.min(...xs)).toBeCloseTo(0, 5);
  });
});

describe('a key that is not exactly centred', () => {
  it.each([[0.5, 32.5], [0.5, 39], [2, 39], [-3, 39], [1.3, 35]])('offset %f, radius to %f: the key stays and its walls lengthen', (offset, v) => {
    fresh();
    const [r, half, depth] = [30, 6, 22];
    const end = (x: number): Vec2 => ({ x, y: Math.sqrt(r * r - x * x) });
    const [a, b] = [end(offset - half), end(offset + half)];
    const ls = chain(a, { x: a.x, y: depth }, { x: b.x, y: depth }, b);
    const arc = addArc(d, s, { x: 0, y: 0 }, b, a);
    addConstraint(d, s, 'coincident', ['origin', arc.c]);
    addConstraint(d, s, 'coincident', [ls[2].b, arc.a]);
    addConstraint(d, s, 'coincident', [arc.b, ls[0].a]);
    addConstraint(d, s, 'vertical', [ls[0].id]);
    addConstraint(d, s, 'vertical', [ls[2].id]);
    addConstraint(d, s, 'horizontal', [ls[1].id]);
    const R = addDimension(d, s, 'radius', [arc.id], r);
    addDimension(d, s, 'distance', [ls[1].a, ls[1].b], 2 * half);
    addDimension(d, s, 'vertical', [ls[1].b, 'origin'], depth);
    expect(solveSketch(s).ok).toBe(true);
    R.value = v;
    expect(solveSketch(s).ok).toBe(true);
    expect(getPointPos(s, ls[1].a).x).toBeCloseTo(a.x, 4);
    expect(getPointPos(s, ls[1].b).x).toBeCloseTo(b.x, 4);
  });
});

describe('who gives way, by pick', () => {
  const rectangle = (): Line[] => {
    const q = [{ x: -70, y: 10 }, { x: -30, y: 10 }, { x: -30, y: 40 }, { x: -70, y: 40 }];
    const ls = chain(...q, q[0]);
    close(ls);
    ls.forEach((l, i) => addConstraint(d, s, i % 2 ? 'vertical' : 'horizontal', [l.id]));
    return ls;
  };

  it.each([[0], [1]])('Midpoint between a free arc end and an edge moves the arc whole, hold %i', (order) => {
    fresh();
    const edges = rectangle();
    const [a, b, m] = [{ x: -40, y: -20 }, { x: -20, y: -30 }, { x: -27, y: -20 }];
    const arc = addArc(d, s, centre(a, b, m), b, a);
    expect(solveSketch(s).ok).toBe(true);
    const r0 = Math.hypot(getPointPos(s, arc.a).x - getPointPos(s, arc.c).x, getPointPos(s, arc.a).y - getPointPos(s, arc.c).y);
    addConstraint(d, s, 'midpoint', [arc.a, edges[2].id]);
    const r = solveSketch(s, { hold: order ? curvePoints(edges[2]) : [arc.a] });
    expect(r.refusal).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(Math.hypot(getPointPos(s, arc.a).x - getPointPos(s, arc.c).x, getPointPos(s, arc.a).y - getPointPos(s, arc.c).y)).toBeCloseTo(r0, 5);
    expect(size(edges[2])).toBeCloseTo(40, 5);
  });

  it.each([[0, 0], [1, 0], [0, 1], [1, 1]])('Coincident of a free arc\'s centre on an edge moves the arc whole, edge first %i, the long way %i', (first, long) => {
    fresh();
    const edges = rectangle();
    const [a, b, m] = [{ x: 90, y: -40 }, { x: 110, y: -30 }, { x: 105, y: -50 }];
    const arc = long ? addArc(d, s, centre(a, b, m), a, b) : addArc(d, s, centre(a, b, m), b, a);
    expect(solveSketch(s).ok).toBe(true);
    const r0 = Math.hypot(getPointPos(s, arc.a).x - getPointPos(s, arc.c).x, getPointPos(s, arc.a).y - getPointPos(s, arc.c).y);
    addConstraint(d, s, 'coincident', first ? [edges[2].id, arc.c] : [arc.c, edges[2].id]);
    expect(solveSketch(s, { hold: curvePoints(edges[2]) }).ok).toBe(true);
    expect(Math.hypot(getPointPos(s, arc.a).x - getPointPos(s, arc.c).x, getPointPos(s, arc.a).y - getPointPos(s, arc.c).y)).toBeCloseTo(r0, 5);
    expect(size(edges[2])).toBeCloseTo(40, 5);
  });

  it.each([[[40, 30, 70, 42], 32.311], [[75, 0, 60, 12], 19.209]])('Equal(free line, edge): the edge takes the line, the height stays', (c, len) => {
    fresh();
    const edges = rectangle();
    const f = addLine(d, s, { x: c[0], y: c[1] }, { x: c[2], y: c[3] });
    expect(solveSketch(s).ok).toBe(true);
    addConstraint(d, s, 'equal', [f.id, edges[2].id]);
    expect(solveSketch(s, { hold: curvePoints(f) }).ok).toBe(true);
    expect(size(f)).toBeCloseTo(len, 2);
    expect(size(edges[2])).toBeCloseTo(len, 2);
    expect(size(edges[1])).toBeCloseTo(30, 6);
  });
});
