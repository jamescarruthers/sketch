// New constraints arrive by many paths, so these go in at the level every one of them shares: a
// constraint added to the document, then a plain solve.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Arc, Circle, Design, Id, Line, Sketch, Vec2 } from '../model/types';
import { AXIS_X, ORIGIN } from '../model/types';
import {
  addArc, addCircle, addConstraint, addControlSpline, addDimension, addEllipse, addFitSpline, addLine, addPoint, copySelection, curvePoints, getPointPos,
  newDesign, newSketch, pasteClipboard,
} from '../model/document';
import { curvatureAt, resolve, unitTangent } from '../geom/curves';
import { fillet, mirror } from '../geom/modify';
import { applyResult, generateResults } from '../geom/autoconstrain';
import { capture, checked, initSolver, solveSketch, type SolveResult } from './bridge';
import { measureDimension } from '../model/parameters';

let d: Design;
let s: Sketch;

const length = (l: Line): number => {
  const a = getPointPos(s, l.a);
  const b = getPointPos(s, l.b);
  return Math.hypot(a.x - b.x, a.y - b.y);
};

beforeAll(async () => {
  await initSolver();
});

const fresh = (): void => {
  d = newDesign();
  s = newSketch(d);
};

describe('seating a new constraint', () => {
  it('parallel with nothing held keeps both lengths, whichever path added it', () => {
    fresh();
    const a = addLine(d, s, { x: -60, y: 30 }, { x: -20, y: 30 });
    const b = addLine(d, s, { x: 30, y: -40 }, { x: 40, y: 40 });
    addConstraint(d, s, 'parallel', [a.id, b.id]);
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(length(b)).toBeCloseTo(Math.hypot(10, 80), 5);
    expect(length(a)).toBeCloseTo(40, 5);
  });

  it('perpendicular rotates the free line when the other is locked, in either ref order', () => {
    for (const flip of [false, true]) {
      fresh();
      const a = addLine(d, s, { x: 0, y: 0 }, { x: 60, y: 0 });
      const b = addLine(d, s, { x: 0, y: 0 }, { x: 15, y: 50 });
      addConstraint(d, s, 'horizontal', [a.id]);
      addConstraint(d, s, 'coincident', [a.a, b.a]);
      solveSketch(s);
      addConstraint(d, s, 'perpendicular', flip ? [a.id, b.id] : [b.id, a.id]);
      const r = solveSketch(s, { hold: flip ? [a.a, a.b] : [b.a, b.b] });
      expect(r.ok).toBe(true);
      expect(length(a)).toBeCloseTo(60, 4);
      expect(length(b)).toBeCloseTo(Math.hypot(15, 50), 4);
    }
  });

  it('a pasted copy stays satisfied and does not move', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 10 });
    const b = addLine(d, s, { x: 0, y: 20 }, { x: 40, y: 30 });
    addConstraint(d, s, 'parallel', [a.id, b.id]);
    solveSketch(s);
    const r = pasteClipboard(d, s, copySelection(s, [a.id, b.id]), { offset: { x: 100, y: 0 } });
    expect(solveSketch(s).ok).toBe(true);
    const copy = s.curves[r.curves[0]] as Line;
    expect(getPointPos(s, copy.a).x).toBeCloseTo(100, 6);
  });

  it('AutoConstrain proposals go through the same seat and guard', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 60, y: 0.4 });
    const b = addLine(d, s, { x: 60, y: 0.4 }, { x: 60.3, y: 40 });
    const solve = (t: Sketch) => {
      const r = solveSketch(t, { analyze: true });
      return { ok: r.ok, dof: r.dof };
    };
    const [best] = generateResults(s, { solve, tolerance: 1, angleTolerance: 0.05 });
    applyResult(d, s, best);
    expect(solveSketch(s).ok).toBe(true);
    expect(length(a)).toBeGreaterThan(50);
    expect(length(b)).toBeGreaterThan(30);
  });

  it('a mirrored ellipse lands on the other side of the axis at its size', () => {
    fresh();
    const axis = addLine(d, s, { x: 0, y: -60 }, { x: 0, y: 60 });
    const e = addEllipse(d, s, { x: 30, y: 0 }, { x: 50, y: 0 }, { x: 30, y: 10 });
    const f = addEllipse(d, s, { x: -40, y: 5 }, { x: -60, y: 5 }, { x: -40, y: 15 });
    addConstraint(d, s, 'symmetric', [e.id, f.id, axis.id]);
    const r = solveSketch(s, { hold: [e.c, e.major, e.minor, axis.a, axis.b] });
    expect(r.unsatisfied).toEqual([]);
    expect(getPointPos(s, f.c).x).toBeCloseTo(-30, 4);
    expect(getPointPos(s, f.c).y).toBeCloseTo(0, 4);
  });

  it('a fit spline with no handle reaches G2 with a line', () => {
    fresh();
    const l = addLine(d, s, { x: -40, y: 0 }, { x: 0, y: 0 });
    const sp = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 20, y: 15 }, { x: 45, y: 5 }]);
    addConstraint(d, s, 'coincident', [l.b, sp.pts[0]]);
    solveSketch(s);
    addConstraint(d, s, 'curvature', [sp.id, l.id], { variant: 0 });
    const r = solveSketch(s, { hold: [l.a, l.b] });
    expect(r.unsatisfied).toEqual([]);
    const pc = resolve(s, s.curves[sp.id]);
    const t = unitTangent(pc, 0);
    const a = getPointPos(s, l.a);
    const b = getPointPos(s, l.b);
    const u = { x: (b.x - a.x) / length(l), y: (b.y - a.y) / length(l) };
    expect(Math.abs(t.x * u.y - t.y * u.x)).toBeLessThan(1e-3);
    expect(Math.abs(curvatureAt(pc, 0))).toBeLessThan(1e-3);
  });
});

describe('collapse guard', () => {
  it('refuses a solve that would shrink a line to nothing and leaves the geometry alone', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    const b = addLine(d, s, { x: 0, y: 20 }, { x: 40, y: 30 });
    addConstraint(d, s, 'parallel', [a.id, b.id]);
    solveSketch(s);
    const before = structuredClone(s.points);
    addConstraint(d, s, 'perpendicular', [a.id, b.id]);
    const r = solveSketch(s);
    expect(r.ok).toBe(false);
    expect(r.refusal).toMatch(/collapse/);
    expect(s.points).toEqual(before);
  });

  it('holds for a coincident that would put a line on its own end', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    addConstraint(d, s, 'coincident', [a.a, a.b]);
    const r = solveSketch(s);
    expect(r.refusal).toMatch(/line/);
    expect(length(a)).toBeCloseTo(40, 9);
  });

  it('holds for a circle tangent to itself', () => {
    fresh();
    const c: Circle = addCircle(d, s, { x: 5, y: 0 }, 20);
    addConstraint(d, s, 'tangent', [c.id, c.id]);
    solveSketch(s);
    expect(c.r).toBeCloseTo(20, 9);
  });

  it('holds during a drag', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    const r = solveSketch(s, { drag: [{ point: a.b, x: 0, y: 0 }] });
    expect(r.refusal).toBeDefined();
    expect(length(a)).toBeCloseTo(40, 9);
  });

  it('lets a real change of size through, however large', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    addConstraint(d, s, 'horizontal', [a.id]);
    addDimension(d, s, 'distance', [a.a, a.b], 5000);
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(length(a)).toBeCloseTo(5000, 6);
  });

  it('collapses an arc to a point no more than a line', () => {
    fresh();
    const c = addCircle(d, s, { x: -40, y: 30 }, 20);
    const arc = addArc(d, s, { x: 30, y: 30 }, { x: 50, y: 30 }, { x: 10, y: 30 });
    addConstraint(d, s, 'concentric', [c.id, arc.id]);
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(getPointPos(s, arc.a).x - getPointPos(s, arc.b).x).toBeCloseTo(40, 4);
  });
});

describe('tangent dimensions', () => {
  it('rim to line holds a gap, net one equation', () => {
    fresh();
    const l = addLine(d, s, { x: -50, y: -40 }, { x: 50, y: -40 });
    const c = addCircle(d, s, { x: 0, y: 0 }, 15);
    addConstraint(d, s, 'horizontal', [l.id]);
    const before = solveSketch(s, { analyze: true }).dof;
    const line = [{ ...getPointPos(s, l.a) }, { ...getPointPos(s, l.b) }];
    addDimension(d, s, 'tangentLine', [c.id, l.id], 10);
    const r = solveSketch(s, { analyze: true });
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(before - 1);
    expect(getPointPos(s, l.a)).toMatchObject(line[0]);
    expect(getPointPos(s, l.b)).toMatchObject(line[1]);
    expect(getPointPos(s, c.c).y - c.r - getPointPos(s, l.a).y).toBeCloseTo(10, 5);
    expect(c.r).toBeCloseTo(15, 5);
  });

  it('rim to rim holds a gap, facing or far side', () => {
    for (const variant of [0, 2]) {
      fresh();
      const a = addCircle(d, s, { x: 0, y: 0 }, 10);
      const b = addCircle(d, s, { x: 50, y: 0 }, 5);
      const before = solveSketch(s, { analyze: true }).dof;
      addDimension(d, s, 'tangentRounds', [a.id, b.id], 20, { variant });
      const r = solveSketch(s, { analyze: true });
      expect(r.ok).toBe(true);
      expect(r.dof).toBe(before - 1);
      // The second round goes to the gap: the first is where it was.
      expect(getPointPos(s, a.c).x).toBeCloseTo(0, 6);
      const gap = Math.hypot(getPointPos(s, b.c).x - getPointPos(s, a.c).x, getPointPos(s, b.c).y - getPointPos(s, a.c).y);
      expect(gap - a.r + (variant === 2 ? b.r : -b.r)).toBeCloseTo(20, 5);
      expect(a.r).toBeCloseTo(10, 5);
      expect(b.r).toBeCloseTo(5, 5);
    }
  });
});

// The tutorial's cutout: a rectangle with an arc joined to each pair of corners.
function circumcentre(a: Vec2, b: Vec2, m: Vec2): Vec2 {
  const d = 2 * (a.x * (b.y - m.y) + b.x * (m.y - a.y) + m.x * (a.y - b.y));
  const q = (p: Vec2): number => p.x * p.x + p.y * p.y;
  return {
    x: (q(a) * (b.y - m.y) + q(b) * (m.y - a.y) + q(m) * (a.y - b.y)) / d,
    y: (q(a) * (m.x - b.x) + q(b) * (a.x - m.x) + q(m) * (b.x - a.x)) / d,
  };
}

function join(p: Id, q: Id): void {
  addConstraint(d, s, 'coincident', [p, q]);
}

/** Lines round a closed loop of corners, joined end to end. */
function loop(corners: Vec2[]): Line[] {
  const lines = corners.map((c, i) => addLine(d, s, c, corners[(i + 1) % corners.length]));
  lines.forEach((l, i) => join(l.b, lines[(i + 1) % lines.length].a));
  return lines;
}

/** Bottom, right, top, left, with the rectangle tool's horizontals and verticals. */
function rectangle(x0: number, y0: number, x1: number, y1: number): Line[] {
  const lines = loop([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
  lines.forEach((l, i) => addConstraint(d, s, i % 2 ? 'vertical' : 'horizontal', [l.id]));
  return lines;
}

/** Counter-clockwise a to b, through m, its ends on the given points. */
function arcThrough(a: Vec2, b: Vec2, m: Vec2, atA: Id, atB: Id): Arc {
  const arc = addArc(d, s, circumcentre(a, b, m), a, b);
  join(atA, arc.a);
  join(atB, arc.b);
  return arc;
}

const pos = (ids: Id[]): Vec2[] => ids.map((id) => ({ ...getPointPos(s, id) }));
const stayed = (before: Vec2[], ids: Id[]): void => {
  const now = pos(ids);
  before.forEach((p, i) => {
    expect(now[i].x).toBeCloseTo(p.x, 6);
    expect(now[i].y).toBeCloseTo(p.y, 6);
  });
};
const radius = (a: Arc): number => {
  const c = getPointPos(s, a.c);
  const e = getPointPos(s, a.a);
  return Math.hypot(c.x - e.x, c.y - e.y);
};
const held = (...curves: { id: Id }[]): Id[] => curves.flatMap((c) => curvePoints(s.curves[c.id]));

describe('a seat leaves other geometry alone', () => {
  // The bulge depths in OPEN-1: each used to do something different.
  const BULGES: [number, number][] = [[-31, 31], [-40, 40], [-26, 26], [-24, 24], [-31, 26], [-60, 31]];

  const outlet = (leftX: number, rightX: number): { edges: Line[]; left: Arc; right: Arc } => {
    const edges = rectangle(-22, 16, 22, 42);
    const left = arcThrough({ x: -22, y: 42 }, { x: -22, y: 16 }, { x: leftX, y: 25 }, edges[3].a, edges[3].b);
    const right = arcThrough({ x: 22, y: 16 }, { x: 22, y: 42 }, { x: rightX, y: 33 }, edges[1].a, edges[1].b);
    return { edges, left, right };
  };

  for (const [leftX, rightX] of BULGES) {
    for (const leftFirst of [true, false]) {
      it(`concentric on arcs joined to a rectangle moves one centre: bulges ${leftX}, ${rightX}, ${leftFirst ? 'left' : 'right'} first`, () => {
        fresh();
        const { edges, left, right } = outlet(leftX, rightX);
        expect(solveSketch(s).ok).toBe(true);
        const [ref, mover] = leftFirst ? [left, right] : [right, left];
        const corners = held(...edges);
        const fixedPoints = pos(corners);
        const refPoints = pos(held(ref));
        const refRadius = radius(ref);
        addConstraint(d, s, 'concentric', [ref.id, mover.id]);
        const r = solveSketch(s, { hold: held(ref), analyze: true });
        expect(r.ok).toBe(true);
        stayed(fixedPoints, corners);
        stayed(refPoints, held(ref));
        expect(radius(ref)).toBeCloseTo(refRadius, 6);
        expect(getPointPos(s, mover.c).x).toBeCloseTo(getPointPos(s, ref.c).x, 6);
        expect(getPointPos(s, mover.c).y).toBeCloseTo(29, 6);
      });
    }
  }

  it('a point held at the middle of a joined arc goes with the arc, and the corners stay', () => {
    fresh();
    const edges = rectangle(0, 10, 40, 40);
    const arc = arcThrough({ x: 40, y: 10 }, { x: 40, y: 40 }, { x: 52, y: 25 }, edges[1].a, edges[1].b);
    const middle = addPoint(d, s, { x: 52, y: 25 }, { owner: arc.id });
    addConstraint(d, s, 'midpoint', [middle.id, arc.id]);
    const c = addCircle(d, s, { x: 20, y: 25 }, 6);
    solveSketch(s);
    const corners = held(...edges);
    const before = pos(corners);
    addConstraint(d, s, 'concentric', [c.id, arc.id]);
    expect(solveSketch(s, { hold: held(c) }).ok).toBe(true);
    stayed(before, corners);
    expect(getPointPos(s, arc.c).x).toBeCloseTo(20, 6);
    expect(Math.hypot(getPointPos(s, middle.id).x - 20, getPointPos(s, middle.id).y - 25)).toBeCloseTo(radius(arc), 5);
  });

  it('a point on a joined arc and on another line slides along that line, and the line stays', () => {
    fresh();
    const edges = rectangle(-22, 16, 22, 42);
    const arc = arcThrough({ x: 22, y: 16 }, { x: 22, y: 42 }, { x: 31, y: 33 }, edges[1].a, edges[1].b);
    const diagonal = addLine(d, s, { x: 0, y: 0 }, { x: 62, y: 66 }, { lineType: 'construction' });
    const on = addPoint(d, s, { x: 31, y: 33 }, { owner: arc.id });
    addConstraint(d, s, 'coincident', [on.id, arc.id]);
    addConstraint(d, s, 'coincident', [on.id, diagonal.id]);
    const c = addCircle(d, s, { x: -18, y: 29 }, 6);
    solveSketch(s);
    const others = held(...edges, diagonal);
    const before = pos(others);
    addConstraint(d, s, 'concentric', [c.id, arc.id]);
    expect(solveSketch(s, { hold: held(c) }).ok).toBe(true);
    stayed(before, others);
    expect(getPointPos(s, arc.c).x).toBeCloseTo(-18, 6);
  });

  it('with a mirror in place the mirrored arcs follow and the rectangle still stays', () => {
    fresh();
    const { edges, left, right } = outlet(-31, 31);
    const axis = addLine(d, s, { x: -40, y: 0 }, { x: 40, y: 0 });
    addConstraint(d, s, 'horizontal', [axis.id]);
    solveSketch(s);
    mirror(d, s, [...edges.map((e) => e.id), left.id, right.id], axis.id);
    solveSketch(s);
    const corners = held(...edges, axis);
    const before = pos(corners);
    addConstraint(d, s, 'concentric', [left.id, right.id]);
    expect(solveSketch(s, { hold: held(left) }).ok).toBe(true);
    stayed(before, corners);
    addConstraint(d, s, 'vertical', [ORIGIN, left.c]);
    expect(solveSketch(s).ok).toBe(true);
    stayed(before, corners);
    expect(getPointPos(s, left.c).x).toBeCloseTo(0, 6);
    expect(getPointPos(s, right.c).x).toBeCloseTo(0, 6);
    for (const copy of Object.values(s.curves).filter((c): c is Arc => c.type === 'arc' && getPointPos(s, c.a).y < 0)) {
      expect(getPointPos(s, copy.c).x).toBeCloseTo(0, 5);
      expect(getPointPos(s, copy.c).y).toBeCloseTo(-29, 5);
    }
  });

  it('a free arc still travels whole, keeping its radius', () => {
    fresh();
    const c = addCircle(d, s, { x: -40, y: 30 }, 20);
    const arc = addArc(d, s, { x: 30, y: 30 }, { x: 50, y: 30 }, { x: 10, y: 30 });
    addConstraint(d, s, 'concentric', [c.id, arc.id]);
    expect(solveSketch(s, { hold: held(c) }).ok).toBe(true);
    expect(radius(arc)).toBeCloseTo(20, 6);
    expect(getPointPos(s, arc.c).x).toBeCloseTo(-40, 6);
  });

  it('a joined arc keeps its ends when it goes concentric with a free circle picked first', () => {
    fresh();
    const edges = rectangle(0, 0, 40, 30);
    const arc = arcThrough({ x: 40, y: 0 }, { x: 40, y: 30 }, { x: 52, y: 15 }, edges[1].a, edges[1].b);
    const c = addCircle(d, s, { x: 20, y: 15 }, 6);
    solveSketch(s);
    const corners = held(...edges);
    const before = pos(corners);
    addConstraint(d, s, 'concentric', [c.id, arc.id]);
    expect(solveSketch(s, { hold: held(c) }).ok).toBe(true);
    stayed(before, corners);
    expect(getPointPos(s, arc.c).x).toBeCloseTo(20, 6);
    expect(getPointPos(s, c.c).x).toBeCloseTo(20, 6);
  });

  it('the tutorial carries through vertical and equal to dof 0 at radius 17', () => {
    for (const [leftX, rightX] of BULGES) {
      for (const leftFirst of [true, false]) {
        fresh();
        const { edges, left, right } = outlet(leftX, rightX);
        solveSketch(s);
        const [ref, mover] = leftFirst ? [left, right] : [right, left];
        addConstraint(d, s, 'concentric', [ref.id, mover.id]);
        expect(solveSketch(s, { hold: held(ref) }).ok).toBe(true);
        addConstraint(d, s, 'vertical', [ORIGIN, ref.c]);
        expect(solveSketch(s, {}).ok).toBe(true);
        expect(getPointPos(s, ref.c).x).toBeCloseTo(0, 6);
        stayed([{ x: -22, y: 16 }, { x: 22, y: 42 }], [edges[0].a, edges[2].a]);
        addConstraint(d, s, 'equal', [ref.id, mover.id]);
        expect(solveSketch(s, { hold: held(ref) }).ok).toBe(true);
        addDimension(d, s, 'pointLine', [edges[0].a, AXIS_X], 11, { variant: 0 });
        addDimension(d, s, 'distance', [edges[1].a, edges[1].b], 28);
        addDimension(d, s, 'radius', [left.id], 17);
        const r = solveSketch(s, { analyze: true });
        expect(r.ok).toBe(true);
        expect(r.dof).toBe(0);
        expect(radius(left)).toBeCloseTo(17, 5);
        expect(radius(right)).toBeCloseTo(17, 5);
        const half = Math.sqrt(17 ** 2 - 14 ** 2);
        expect(getPointPos(s, left.a).x).toBeCloseTo(-half, 4);
        expect(getPointPos(s, right.a).x).toBeCloseTo(half, 4);
        expect(getPointPos(s, ref.c).y).toBeCloseTo(25, 4);
      }
    }
  });

  it('parallel on a chain turns the second line about the joint, and only it and the next end move', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    const b = addLine(d, s, { x: 40, y: 0 }, { x: 60, y: 30 });
    const c = addLine(d, s, { x: 60, y: 30 }, { x: 100, y: 30 });
    join(a.b, b.a);
    join(b.b, c.a);
    addConstraint(d, s, 'horizontal', [c.id]);
    solveSketch(s);
    const lengthA = length(a);
    const lengthB = length(b);
    const before = pos(held(a));
    addConstraint(d, s, 'perpendicular', [a.id, b.id]);
    expect(solveSketch(s, { hold: held(a) }).ok).toBe(true);
    stayed(before, held(a));
    expect(length(a)).toBeCloseTo(lengthA, 6);
    expect(length(b)).toBeCloseTo(lengthB, 6);
    expect(getPointPos(s, b.b).x).toBeCloseTo(40, 6);
  });

  it('perpendicular in the middle of a joined chain carries the free rest of the chain whole', () => {
    fresh();
    const p = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 50, y: 25 }, { x: 80, y: 25 }];
    const a = addLine(d, s, p[0], p[1]);
    const b = addLine(d, s, p[1], p[2]);
    const c = addLine(d, s, p[2], p[3]);
    join(a.b, b.a);
    join(b.b, c.a);
    solveSketch(s);
    const [joint, far] = pos([c.a, c.b]);
    addConstraint(d, s, 'perpendicular', [a.id, b.id]);
    expect(solveSketch(s, { hold: held(a) }).ok).toBe(true);
    expect(length(a)).toBeCloseTo(30, 6);
    expect(length(b)).toBeCloseTo(Math.hypot(20, 25), 6);
    expect(length(c)).toBeCloseTo(30, 6);
    // The last line went with the joint, and did not turn.
    const [movedJoint, movedFar] = pos([c.a, c.b]);
    expect(movedFar.x - far.x).toBeCloseTo(movedJoint.x - joint.x, 6);
    expect(movedFar.y - far.y).toBeCloseTo(movedJoint.y - joint.y, 6);
  });

  it('parallel with a rotated rectangle edge turns the rectangle as a body', () => {
    fresh();
    const c = Math.cos(0.5);
    const n = Math.sin(0.5);
    const edges = loop([{ x: 0, y: 0 }, { x: 40 * c, y: 40 * n }, { x: 40 * c - 20 * n, y: 40 * n + 20 * c }, { x: -20 * n, y: 20 * c }]);
    addConstraint(d, s, 'perpendicular', [edges[0].id, edges[1].id]);
    addConstraint(d, s, 'parallel', [edges[0].id, edges[2].id]);
    addConstraint(d, s, 'parallel', [edges[1].id, edges[3].id]);
    const free = addLine(d, s, { x: -80, y: -60 }, { x: 0, y: -60 });
    solveSketch(s);
    const before = pos(held(free));
    addConstraint(d, s, 'parallel', [free.id, edges[0].id]);
    expect(solveSketch(s, { hold: held(free) }).ok).toBe(true);
    stayed(before, held(free));
    expect(length(edges[0])).toBeCloseTo(40, 5);
    expect(length(edges[1])).toBeCloseTo(20, 5);
    expect(getPointPos(s, edges[0].a).y - getPointPos(s, edges[0].b).y).toBeCloseTo(0, 6);
  });

  it('tangent where a hand-made corner arc meets its line recentres the arc and leaves both lines', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    const b = addLine(d, s, { x: 50, y: 10 }, { x: 50, y: 40 });
    const arc = arcThrough({ x: 40, y: 0 }, { x: 50, y: 10 }, { x: 49, y: 3 }, a.b, b.a);
    addConstraint(d, s, 'horizontal', [a.id]);
    addConstraint(d, s, 'vertical', [b.id]);
    addDimension(d, s, 'distance', [a.a, a.b], 40);
    addDimension(d, s, 'distance', [b.a, b.b], 30);
    addConstraint(d, s, 'coincident', [a.a, ORIGIN]);
    addConstraint(d, s, 'vertical', [b.a, b.b]);
    addDimension(d, s, 'horizontal', [a.a, b.a], 50);
    addDimension(d, s, 'vertical', [a.a, b.a], 10);
    solveSketch(s);
    const lines = held(a, b);
    const before = pos(lines);
    addConstraint(d, s, 'tangent', [a.id, arc.id]);
    expect(solveSketch(s, { hold: held(a) }).ok).toBe(true);
    stayed(before, lines);
    expect(getPointPos(s, arc.c).x).toBeCloseTo(40, 5);
  });

  it('with lines free to move a corner arc still recentres, and neither line does', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    const b = addLine(d, s, { x: 50, y: 10 }, { x: 50, y: 40 });
    const arc = arcThrough({ x: 40, y: 0 }, { x: 50, y: 10 }, { x: 49, y: 3 }, a.b, b.a);
    solveSketch(s);
    const lines = held(a, b);
    const before = pos(lines);
    addConstraint(d, s, 'tangent', [a.id, arc.id]);
    expect(solveSketch(s, { hold: held(a) }).ok).toBe(true);
    stayed(before, lines);
    expect(getPointPos(s, arc.c).x).toBeCloseTo(40, 5);
  });

  /** A rectangle anchored at the origin by its size, with one real fillet. */
  const filleted = (anchored: boolean): { edges: Line[]; arc: Arc } => {
    const edges = rectangle(0, 0, 40, 30);
    if (anchored) {
      addConstraint(d, s, 'coincident', [ORIGIN, edges[0].a]);
      addDimension(d, s, 'distance', [edges[0].a, edges[0].b], 40);
      addDimension(d, s, 'distance', [edges[1].a, edges[1].b], 30);
    }
    solveSketch(s);
    const r = fillet(d, s, edges[1].id, edges[2].id, 5, { x: 40, y: 20 }, { x: 30, y: 30 });
    solveSketch(s);
    return { edges, arc: s.curves[r.created.find((id) => s.curves[id]?.type === 'arc') as Id] as Arc };
  };

  it('tangent from a free circle to a filleted corner of a fixed rectangle moves the circle, either order', () => {
    for (const circleFirst of [true, false]) {
      fresh();
      const { edges, arc } = filleted(true);
      const c = addCircle(d, s, { x: 70, y: 60 }, 5);
      solveSketch(s);
      const rest = held(...edges, arc);
      const before = pos(rest);
      addConstraint(d, s, 'tangent', circleFirst ? [c.id, arc.id] : [arc.id, c.id], { variant: 0 });
      expect(solveSketch(s, { hold: held(circleFirst ? c : arc) }).ok).toBe(true);
      stayed(before, rest);
      expect(c.r).toBeCloseTo(5, 6);
      const gap = Math.hypot(getPointPos(s, c.c).x - getPointPos(s, arc.c).x, getPointPos(s, c.c).y - getPointPos(s, arc.c).y);
      expect(gap).toBeCloseTo(10, 5);
    }
  });

  it('tangent to a free filleted body keeps the body\'s shape', () => {
    fresh();
    const { edges } = filleted(false);
    const c = addCircle(d, s, { x: 60, y: 60 }, 5);
    solveSketch(s);
    const width = length(edges[0]);
    const height = length(edges[3]);
    const before = pos(held(c));
    addConstraint(d, s, 'tangent', [c.id, edges[0].id]);
    expect(solveSketch(s, { hold: held(c) }).ok).toBe(true);
    stayed(before, held(c));
    expect(length(edges[0])).toBeCloseTo(width, 5);
    expect(length(edges[3])).toBeCloseTo(height, 5);
  });

  it('parallel between edges of two rotated rectangles turns the second as a body, either order', () => {
    for (const flip of [false, true]) {
      fresh();
      const quad = (x: number, y: number, t: number): Line[] => {
        const u = { x: Math.cos(t), y: Math.sin(t) };
        const v = { x: -u.y, y: u.x };
        const p = (i: number, j: number): Vec2 => ({ x: x + i * u.x + j * v.x, y: y + i * u.y + j * v.y });
        const e = loop([p(0, 0), p(40, 0), p(40, 20), p(0, 20)]);
        addConstraint(d, s, 'perpendicular', [e[0].id, e[1].id]);
        addConstraint(d, s, 'parallel', [e[0].id, e[2].id]);
        addConstraint(d, s, 'parallel', [e[1].id, e[3].id]);
        return e;
      };
      const a = quad(0, 0, 0.3);
      const b = quad(100, 0, 1.1);
      solveSketch(s);
      const [ref, mover] = flip ? [b, a] : [a, b];
      const before = pos(held(...ref));
      addConstraint(d, s, 'parallel', [ref[0].id, mover[0].id]);
      expect(solveSketch(s, { hold: held(ref[0]) }).ok).toBe(true);
      stayed(before, held(...ref));
      expect(length(mover[0])).toBeCloseTo(40, 4);
      expect(length(mover[1])).toBeCloseTo(20, 4);
    }
  });

  it('parallel between a rectangle\'s top and side is a contradiction and moves nothing', () => {
    fresh();
    const edges = rectangle(0, 0, 40, 30);
    solveSketch(s);
    const before = pos(held(...edges));
    addConstraint(d, s, 'parallel', [edges[2].id, edges[1].id]);
    expect(solveSketch(s, { hold: held(edges[2]) }).ok).toBe(false);
    stayed(before, held(...edges));
  });

  it('vertical on two points moves the second alone, leaving an arc it centres joined at its ends', () => {
    fresh();
    const edges = rectangle(-22, 16, 22, 42);
    const left = arcThrough({ x: -22, y: 42 }, { x: -22, y: 16 }, { x: -31, y: 25 }, edges[3].a, edges[3].b);
    solveSketch(s);
    const corners = held(...edges);
    const before = pos(corners);
    addConstraint(d, s, 'vertical', [ORIGIN, left.c]);
    expect(solveSketch(s).ok).toBe(true);
    stayed(before, corners);
    expect(getPointPos(s, left.c).x).toBeCloseTo(0, 6);
    expect(radius(left)).toBeCloseTo(Math.hypot(22, 13), 6);
  });

  it('horizontal on a line in a chain turns it and takes the neighbour with it, whole', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 30, y: 12 });
    const b = addLine(d, s, { x: 30, y: 12 }, { x: 60, y: 40 });
    join(a.b, b.a);
    addConstraint(d, s, 'coincident', [a.a, ORIGIN]);
    solveSketch(s);
    const [joint, far] = pos([b.a, b.b]);
    addConstraint(d, s, 'horizontal', [a.id]);
    expect(solveSketch(s).ok).toBe(true);
    expect(length(a)).toBeCloseTo(Math.hypot(30, 12), 6);
    expect(length(b)).toBeCloseTo(Math.hypot(30, 28), 6);
    const [movedJoint, movedFar] = pos([b.a, b.b]);
    expect(movedFar.x - far.x).toBeCloseTo(movedJoint.x - joint.x, 6);
    expect(movedFar.y - far.y).toBeCloseTo(movedJoint.y - joint.y, 6);
  });

  it('collinear with a free rectangle\'s edge second carries the rectangle whole', () => {
    fresh();
    const edges = rectangle(0, 0, 40, 30);
    const free = addLine(d, s, { x: 60, y: 45 }, { x: 90, y: 45 });
    addConstraint(d, s, 'horizontal', [free.id]);
    solveSketch(s);
    const before = pos(held(free));
    addConstraint(d, s, 'collinear', [free.id, edges[2].id]);
    expect(solveSketch(s, { hold: held(free) }).ok).toBe(true);
    stayed(before, held(free));
    expect(getPointPos(s, edges[2].a).y).toBeCloseTo(45, 6);
    expect(length(edges[1])).toBeCloseTo(30, 6);
  });

  it('collinear with an anchored rectangle\'s edge stretches it no more than it must', () => {
    fresh();
    const edges = rectangle(0, 0, 40, 30);
    addConstraint(d, s, 'coincident', [ORIGIN, edges[0].a]);
    const free = addLine(d, s, { x: 60, y: 45 }, { x: 90, y: 45 });
    addConstraint(d, s, 'horizontal', [free.id]);
    solveSketch(s);
    const bottom = pos(held(edges[0]));
    const before = pos(held(free));
    addConstraint(d, s, 'collinear', [free.id, edges[2].id]);
    expect(solveSketch(s, { hold: held(free) }).ok).toBe(true);
    stayed(before, held(free));
    stayed(bottom, held(edges[0]));
    expect(getPointPos(s, edges[2].a).y).toBeCloseTo(45, 6);
  });

  it('midpoint brings a free point to a joined line and leaves the line', () => {
    fresh();
    const edges = rectangle(0, 0, 40, 30);
    const free = addLine(d, s, { x: 70, y: 60 }, { x: 80, y: 80 });
    solveSketch(s);
    const corners = held(...edges);
    const before = pos(corners);
    addConstraint(d, s, 'midpoint', [free.a, edges[2].id]);
    expect(solveSketch(s, { hold: held(edges[2]) }).ok).toBe(true);
    stayed(before, corners);
    expect(getPointPos(s, free.a).x).toBeCloseTo(20, 6);
    expect(getPointPos(s, free.a).y).toBeCloseTo(30, 6);
  });

  it('midpoint on a free end with nothing held still leaves the rectangle', () => {
    fresh();
    const edges = rectangle(0, 0, 40, 30);
    const free = addLine(d, s, { x: 70, y: 60 }, { x: 80, y: 80 });
    solveSketch(s);
    const corners = held(...edges);
    const before = pos(corners);
    addConstraint(d, s, 'midpoint', [free.a, edges[2].id]);
    expect(solveSketch(s).ok).toBe(true);
    stayed(before, corners);
    expect(getPointPos(s, free.a).x).toBeCloseTo(20, 6);
    expect(getPointPos(s, free.a).y).toBeCloseTo(30, 6);
  });

  it('midpoint with a lone point picked first brings the line to the point', () => {
    fresh();
    const l = addLine(d, s, { x: -30, y: 10 }, { x: 30, y: 20 });
    const p = addPoint(d, s, { x: 8, y: 45 });
    solveSketch(s);
    addConstraint(d, s, 'midpoint', [p.id, l.id]);
    expect(solveSketch(s, { hold: [p.id] }).ok).toBe(true);
    expect(getPointPos(s, p.id)).toMatchObject({ x: 8, y: 45 });
    expect(length(l)).toBeCloseTo(Math.hypot(60, 10), 5);
  });
  it('midpoint with the point picked first translates a free line onto it whole', () => {
    fresh();
    const l = addLine(d, s, { x: 10, y: 10 }, { x: 50, y: 10 });
    const a = addLine(d, s, { x: 70, y: 60 }, { x: 80, y: 80 });
    solveSketch(s);
    addConstraint(d, s, 'midpoint', [a.a, l.id]);
    expect(solveSketch(s, { hold: held(a) }).ok).toBe(true);
    expect(length(l)).toBeCloseTo(40, 5);
    expect(getPointPos(s, l.a).x).toBeCloseTo(50, 5);
    expect(getPointPos(s, l.a).y).toBeCloseTo(60, 5);
  });

  it('equal on an arc joined to a line moves its centre, not the ends', () => {
    fresh();
    const edges = rectangle(0, 0, 40, 30);
    const arc = arcThrough({ x: 40, y: 0 }, { x: 40, y: 30 }, { x: 50, y: 15 }, edges[1].a, edges[1].b);
    const c = addCircle(d, s, { x: 100, y: 15 }, 30);
    solveSketch(s);
    const corners = held(...edges);
    const before = pos(corners);
    addConstraint(d, s, 'equal', [c.id, arc.id]);
    expect(solveSketch(s, { hold: held(c) }).ok).toBe(true);
    stayed(before, corners);
    expect(radius(arc)).toBeCloseTo(30, 6);
  });
});

describe('curvature on a control spline', () => {
  it('moves the end legs, not the far end of the spline', () => {
    fresh();
    const l = addLine(d, s, { x: -40, y: 0 }, { x: 0, y: 0 });
    const sp = addControlSpline(d, s, [{ x: 0, y: 0 }, { x: 20, y: 18 }, { x: 45, y: 25 }, { x: 70, y: 20 }], 3);
    join(l.b, sp.pts[0]);
    addConstraint(d, s, 'horizontal', [l.id]);
    solveSketch(s);
    const far = pos([sp.pts[3]]);
    addConstraint(d, s, 'curvature', [sp.id, l.id], { variant: 0 });
    const r = solveSketch(s, { hold: held(l) });
    expect(r.ok).toBe(true);
    stayed(far, [sp.pts[3]]);
    expect(getPointPos(s, sp.pts[1]).y).toBeCloseTo(0, 5);
    expect(getPointPos(s, sp.pts[2]).y).toBeCloseTo(0, 5);
  });

  it('moves the end legs of a longer spline on a slanted line, whichever way round the pick', () => {
    // The geometry of OPEN-5 as drawn, where turning the whole spline is the cheaper seat.
    for (const lineFirst of [true, false]) {
      fresh();
      const l = addLine(d, s, { x: -40, y: 20 }, { x: -5, y: 22 });
      const sp = addControlSpline(d, s, [{ x: -5, y: 22 }, { x: 10, y: 30 }, { x: 25, y: 35 }, { x: 40, y: 30 }, { x: 55, y: 20 }, { x: 70, y: 25 }], 3);
      join(l.b, sp.pts[0]);
      solveSketch(s);
      const rest = pos(sp.pts.slice(3));
      const line = pos(held(l));
      addConstraint(d, s, 'curvature', lineFirst ? [l.id, sp.id] : [sp.id, l.id], { variant: 0 });
      expect(solveSketch(s, { hold: held(l) }).ok).toBe(true);
      stayed(rest, sp.pts.slice(3));
      stayed(line, held(l));
    }
  });

  it('tangent moves the first leg only', () => {
    fresh();
    const l = addLine(d, s, { x: -40, y: 0 }, { x: 0, y: 0 });
    const sp = addControlSpline(d, s, [{ x: 0, y: 0 }, { x: 20, y: 18 }, { x: 45, y: 25 }, { x: 70, y: 20 }], 3);
    join(l.b, sp.pts[0]);
    addConstraint(d, s, 'horizontal', [l.id]);
    solveSketch(s);
    const rest = pos([sp.pts[2], sp.pts[3]]);
    addConstraint(d, s, 'tangent', [sp.id, l.id], { variant: 0 });
    expect(solveSketch(s, { hold: held(l) }).ok).toBe(true);
    stayed(rest, [sp.pts[2], sp.pts[3]]);
  });
});

describe('a tail goes with its joint', () => {
  it('a far end no row mentions keeps the next line its length and direction', () => {
    for (const v of [30, 90, 400]) {
      fresh();
      const a = addLine(d, s, { x: -50, y: -10 }, { x: -10, y: 20 });
      const b = addLine(d, s, { x: -10, y: 20 }, { x: 30, y: 0 });
      addConstraint(d, s, 'coincident', [a.b, b.a]);
      addConstraint(d, s, 'coincident', [a.a, ORIGIN]);
      solveSketch(s);
      const [p, q] = pos([b.a, b.b]);
      addDimension(d, s, 'distance', [a.a, a.b], v);
      expect(solveSketch(s).ok).toBe(true);
      expect(length(a)).toBeCloseTo(v, 6);
      const [m, n] = pos([b.a, b.b]);
      expect(n.x - m.x).toBeCloseTo(q.x - p.x, 6);
      expect(n.y - m.y).toBeCloseTo(q.y - p.y, 6);
    }
  });

  it('horizontal and vertical rows do not part a tail from its line', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    const b = addLine(d, s, { x: 40, y: 0 }, { x: 70, y: 25 });
    addConstraint(d, s, 'coincident', [a.b, b.a]);
    addConstraint(d, s, 'horizontal', [a.id]);
    addConstraint(d, s, 'coincident', [a.a, ORIGIN]);
    solveSketch(s);
    addDimension(d, s, 'distance', [a.a, a.b], 90);
    expect(solveSketch(s).ok).toBe(true);
    expect(getPointPos(s, b.b).x).toBeCloseTo(120, 6);
    expect(getPointPos(s, b.b).y).toBeCloseTo(25, 6);
  });

  it('one whose far end is fixed gives way', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    const b = addLine(d, s, { x: 40, y: 0 }, { x: 70, y: 25 });
    addConstraint(d, s, 'coincident', [a.b, b.a]);
    addConstraint(d, s, 'coincident', [a.a, ORIGIN]);
    s.points[b.b].fixed = true;
    solveSketch(s);
    addDimension(d, s, 'distance', [a.a, a.b], 60);
    expect(solveSketch(s).ok).toBe(true);
    expect(length(a)).toBeCloseTo(60, 6);
    expect(getPointPos(s, b.b).x).toBeCloseTo(70, 9);
  });

  it('one with a dimension to something else gives way', () => {
    fresh();
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    const b = addLine(d, s, { x: 40, y: 0 }, { x: 70, y: 25 });
    addConstraint(d, s, 'coincident', [a.b, b.a]);
    addConstraint(d, s, 'coincident', [a.a, ORIGIN]);
    addDimension(d, s, 'horizontal', [ORIGIN, b.b], 70);
    solveSketch(s);
    addDimension(d, s, 'distance', [a.a, a.b], 60);
    expect(solveSketch(s).ok).toBe(true);
    expect(length(a)).toBeCloseTo(60, 6);
    expect(getPointPos(s, b.b).x).toBeCloseTo(70, 6);
  });

  for (const closed of [false, true]) {
    for (const lineFirst of [true, false]) {
      it(`a free line brought to a ${closed ? 'closed profile' : 'chain'} moves whole, ${lineFirst ? 'line' : 'corner'} first`, () => {
        fresh();
        const p = [{ x: -40, y: 0 }, { x: -10, y: 20 }, { x: 20, y: 5 }];
        const a = addLine(d, s, p[0], p[1]);
        const b = addLine(d, s, p[1], p[2]);
        addConstraint(d, s, 'coincident', [a.b, b.a]);
        const ring = closed ? [addLine(d, s, p[2], p[0])] : [];
        for (const r of ring) {
          addConstraint(d, s, 'coincident', [b.b, r.a]);
          addConstraint(d, s, 'coincident', [r.b, a.a]);
        }
        const f = addLine(d, s, { x: 40, y: 50 }, { x: 70, y: 75 });
        solveSketch(s);
        const shape = pos([a.a, a.b, b.b]);
        addConstraint(d, s, 'coincident', lineFirst ? [f.a, b.b] : [b.b, f.a]);
        expect(solveSketch(s, { hold: [b.b] }).ok).toBe(true);
        stayed(shape, [a.a, a.b, b.b]);
        expect(length(f)).toBeCloseTo(Math.hypot(30, 25), 6);
      });
    }
  }

  it('a point riding on a curve does not carry the curve', () => {
    fresh();
    const c = addCircle(d, s, { x: 0, y: 0 }, 10);
    const l = addLine(d, s, { x: -40, y: 30 }, { x: 40, y: 30 });
    const on = addPoint(d, s, { x: 0, y: 30 }, {});
    addConstraint(d, s, 'coincident', [on.id, l.id]);
    const link = addLine(d, s, { x: 0, y: 0 }, { x: 0, y: 30 });
    addConstraint(d, s, 'coincident', [link.b, on.id]);
    addConstraint(d, s, 'coincident', [link.a, c.c]);
    addConstraint(d, s, 'coincident', [ORIGIN, c.c]);
    solveSketch(s);
    const before = pos([l.a, l.b]);
    addDimension(d, s, 'distance', [link.a, link.b], 45);
    solveSketch(s);
    const after = pos([l.a, l.b]);
    expect(after[0].x - before[0].x).toBeCloseTo(after[1].x - before[1].x, 6);
  });
});

describe('the last word on a commit', () => {
  const says = (): SolveResult => ({ ok: true, unsatisfied: [], freePoints: new Set(), freeCurves: new Set(), dof: 0 });

  it('a result that says OK with a row unmet gets the plain solve', () => {
    fresh();
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 50, y: 0 });
    addDimension(d, s, 'distance', [l.a, l.b], 100);
    const before = capture(s);
    const r = checked(s, says(), {}, before);
    expect(r.ok).toBe(true);
    expect(length(l)).toBeCloseTo(100, 6);
  });

  it('and if that cannot meet it, the sketch goes back and says so', () => {
    fresh();
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 50, y: 0 });
    addDimension(d, s, 'distance', [l.a, l.b], 100);
    addDimension(d, s, 'distance', [l.a, l.b], 70);
    const before = capture(s);
    const r = checked(s, says(), {}, before);
    expect(r.ok).toBe(false);
    expect(r.unsatisfied.length).toBeGreaterThan(0);
    expect(length(l)).toBeCloseTo(50, 9);
  });

  it('a result that is true is left alone', () => {
    fresh();
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 50, y: 0 });
    addDimension(d, s, 'distance', [l.a, l.b], 50);
    const r = says();
    expect(checked(s, r, {}, capture(s))).toBe(r);
  });

  it('whatever a commit says, what it says is what is there', () => {
    let seed = 7;
    const rnd = (a: number, b: number): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return a + (b - a) * (seed / 4294967296);
    };
    let edits = 0;
    for (let run = 0; run < 60; run++) {
      fresh();
      const p = [0, 1, 2, 3].map((i) => ({ x: rnd(25, 60) * Math.cos(i * 1.57 + rnd(-0.4, 0.4)), y: rnd(25, 60) * Math.sin(i * 1.57 + rnd(-0.4, 0.4)) }));
      const ls = p.slice(0, 3).map((q, i) => addLine(d, s, q, p[i + 1]));
      addConstraint(d, s, 'coincident', [ls[0].b, ls[1].a]);
      addConstraint(d, s, 'coincident', [ls[1].b, ls[2].a]);
      if (run % 2) s.points[ls[0].a].fixed = true;
      if (run % 3 === 0) addConstraint(d, s, 'parallel', [ls[0].id, ls[2].id]);
      solveSketch(s);
      const dim = addDimension(d, s, 'distance', [ls[1].a, ls[1].b], length(ls[1]));
      solveSketch(s);
      for (let k = 0; k < 6; k++) {
        const was = dim.value;
        dim.value = was * [0.5, 1.5, 3, 0.2, 1.1, 8][Math.floor(rnd(0, 6))];
        const r = solveSketch(s);
        edits++;
        if (r.ok) expect(measureDimension(s, dim)).toBeCloseTo(dim.value, 3);
        else dim.value = was;
      }
    }
    expect(edits).toBe(360);
  });
});
