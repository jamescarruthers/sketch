import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  Arc, Circle, Conic, Constraint, ConstraintType, ControlSpline, Curve, Dimension, DimensionKind, FitSpline, Id, Line,
  Design, Sketch, TextEntity,
} from '../model/types';
import { AXIS_X, ORIGIN } from '../model/types';
import { planeFrame } from '../model/frames';
import { addConstraint, addLine, newDesign, newSketch } from '../model/document';
import { addLayer, planFreeze, stampCrossLayer } from '../model/layers';
import { analyzeSketch, brokenOf, initSolver, setDerivedRegenerator, solveSketch, wouldOverConstrain } from './bridge';

const base = { lineType: 'normal' as const, layer: 'layer-1' };

function sketch(): Sketch {
  return { id: 's', name: 'S', frame: planeFrame('XY'), visible: true, points: {}, curves: {}, constraints: {}, dimensions: {}, features: {} };
}
function pt(s: Sketch, id: Id, x: number, y: number, fixed = false): Id {
  s.points[id] = { id, x, y, ...(fixed ? { fixed } : {}) };
  return id;
}
function add<T extends Curve>(s: Sketch, c: T): T {
  s.curves[c.id] = c;
  return c;
}
function line(s: Sketch, id: Id, a: Id, b: Id): Line {
  return add(s, { ...base, id, type: 'line', a, b });
}
function con(s: Sketch, id: Id, type: ConstraintType, refs: Id[], extra: Partial<Constraint> = {}): void {
  s.constraints[id] = { id, type, refs, ...extra };
}
function dim(id: Id, kind: DimensionKind, refs: Id[], value: number, driving = true): Dimension {
  return { id, kind, refs, value, driving, name: id, expression: String(value), label: { x: 0, y: 0 } };
}
function addDim(s: Sketch, d: Dimension): Dimension {
  s.dimensions[d.id] = d;
  return d;
}
const near = (a: number, b: number, tol = 1e-6): void => expect(Math.abs(a - b)).toBeLessThan(tol);

beforeAll(async () => {
  await initSolver();
});

describe('the time of a solve', () => {
  afterEach(() => vi.restoreAllMocks());

  /** The clock is read twice, round the whole request, whatever the request had to try before it settled. */
  const clock = (): { reads: () => number } => {
    let t = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => (t += 2.5));
    return { reads: () => now.mock.calls.length };
  };

  it('is the wall time between the first read of the clock and the last', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    const c = clock();
    const r = solveSketch(s);
    expect(c.reads()).toBe(2);
    expect(r.ms).toBe(2.5);
  });

  it('is taken once for a commit that needs several solves', () => {
    const s = sketch();
    pt(s, 'a', 0, 0, true);
    pt(s, 'b', 40, 0);
    pt(s, 'c', 40, 30);
    pt(s, 'd', 0, 30);
    line(s, 'l1', 'a', 'b');
    line(s, 'l2', 'b', 'c');
    line(s, 'l3', 'c', 'd');
    line(s, 'l4', 'd', 'a');
    con(s, 'k1', 'horizontal', ['l1']);
    con(s, 'k2', 'vertical', ['l2']);
    con(s, 'k3', 'horizontal', ['l3']);
    solveSketch(s);
    // A value that is walked to, then checked against every row: many solves, one request.
    addDim(s, dim('d1', 'distance', ['a', 'b'], 90));
    addDim(s, dim('d2', 'distance', ['b', 'c'], 70));
    const c = clock();
    const r = solveSketch(s, { analyze: true });
    expect(r.ok).toBe(true);
    near(s.points.b.x, 90);
    expect(c.reads()).toBe(2);
    expect(r.ms).toBe(2.5);
  });

  it('is taken once for a request that is refused', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    pt(s, 'b', 40, 0);
    line(s, 'l', 'a', 'b');
    solveSketch(s);
    // A line joined to itself would collapse: thrown out, with every way tried to seat it first.
    con(s, 'k', 'coincident', ['a', 'b']);
    const c = clock();
    const r = solveSketch(s);
    expect(r.refusal).toMatch(/collapse/);
    expect(c.reads()).toBe(2);
    expect(r.ms).toBe(2.5);
  });

  it('is taken once for a drag step', () => {
    const s = sketch();
    pt(s, 'a', 0, 0, true);
    pt(s, 'b', 40, 0);
    line(s, 'l', 'a', 'b');
    const c = clock();
    const r = solveSketch(s, { drag: [{ point: 'b', x: 30, y: 10 }] });
    expect(c.reads()).toBe(2);
    expect(r.ms).toBe(2.5);
  });
});

describe('solveSketch', () => {
  it('initSolver is idempotent in Node', async () => {
    await initSolver();
    await initSolver();
  });

  it('moves points, reports dof and free sets', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    pt(s, 'b', 8, 3);
    line(s, 'l', 'a', 'b');
    con(s, 'k1', 'coincident', ['a', ORIGIN]);
    con(s, 'k2', 'horizontal', ['l']);
    const r = solveSketch(s, { analyze: true });
    expect(r.ok).toBe(true);
    near(s.points.b.y, 0);
    expect(r.dof).toBe(1);
    expect([...r.freePoints]).toEqual(['b']);
    expect([...r.freeCurves]).toEqual(['l']);

    addDim(s, dim('d1', 'distance', ['a', 'b'], 25.4));
    const r2 = solveSketch(s, { analyze: true });
    near(s.points.b.x, 25.4);
    expect(r2.dof).toBe(0);
    expect(r2.freeCurves.size).toBe(0);
  });

  it('without analyze dof is -1 and the sets are empty', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    const r = solveSketch(s);
    expect(r.dof).toBe(-1);
    expect(r.freePoints.size).toBe(0);
  });

  it('writes circle radii back', () => {
    const s = sketch();
    pt(s, 'c', 0, 0);
    add<Circle>(s, { ...base, id: 'k', type: 'circle', c: 'c', r: 3 });
    addDim(s, dim('d', 'diameter', ['k'], 12));
    solveSketch(s);
    const k = s.curves.k as Circle;
    near(k.r, 6);
  });

  it('ignores driven dimensions', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    pt(s, 'b', 10, 0);
    addDim(s, dim('d', 'distance', ['a', 'b'], 99, false));
    solveSketch(s);
    near(s.points.b.x, 10);
  });

  it('drag moves a free point and hold keeps the reference', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    pt(s, 'b', 7, 9);
    con(s, 'k', 'vertical', ['a', 'b']);
    solveSketch(s, { hold: ['a'] });
    near(s.points.a.x, 0, 1e-7);
    near(s.points.b.x, 0, 1e-6);
    solveSketch(s, { drag: [{ point: 'b', x: 5, y: 20 }] });
    near(s.points.b.x, 5);
    near(s.points.b.y, 20);
    near(s.points.a.x, 5);
  });

  it('reports conflicts and leaves that geometry alone', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    pt(s, 'b', 15, 0);
    addDim(s, dim('x', 'distance', ['a', 'b'], 10));
    addDim(s, dim('y', 'distance', ['a', 'b'], 20));
    const r = solveSketch(s);
    expect(r.ok).toBe(false);
    expect(r.unsatisfied.sort()).toEqual(['x', 'y']);
    near(s.points.b.x, 15);
  });

  it('locks projected and derived curves', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    pt(s, 'b', 10, 5);
    add<Line>(s, { ...base, id: 'l', type: 'line', a: 'a', b: 'b', derivedFrom: 'f1' });
    pt(s, 'c', 1, 1);
    pt(s, 'd', 3, 3);
    add<Line>(s, { ...base, id: 'm', type: 'line', a: 'c', b: 'd', projected: { origin: 'x' } });
    const r = solveSketch(s, { analyze: true, drag: [{ point: 'b', x: 50, y: 50 }] });
    near(s.points.b.x, 10);
    expect(r.freeCurves.size).toBe(0);
  });

  it('calls the derived regenerator after a successful solve only', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    let calls = 0;
    setDerivedRegenerator(() => calls++);
    solveSketch(s);
    expect(calls).toBe(1);
    addDim(s, dim('x', 'distance', ['a', ORIGIN], 5));
    pt(s, 'q', 0, 0, true);
    s.points.a.fixed = true;
    solveSketch(s);
    expect(calls).toBe(1);
    setDerivedRegenerator(null);
  });

  it('maps arcs, ellipses and elliptical arcs', () => {
    const s = sketch();
    pt(s, 'c', 0, 0);
    pt(s, 'a', 10, 0);
    pt(s, 'b', 0, 11);
    add<Arc>(s, { ...base, id: 'r', type: 'arc', c: 'c', a: 'a', b: 'b' });
    pt(s, 'e', 40, 0);
    pt(s, 'm', 60, 1);
    pt(s, 'n', 40, 10);
    add<Curve>(s, { ...base, id: 'el', type: 'ellipse', c: 'e', major: 'm', minor: 'n' });
    pt(s, 'e2', 90, 0);
    pt(s, 'm2', 110, 0);
    pt(s, 'n2', 90, 10);
    pt(s, 'p', 109, 1);
    pt(s, 'q', 91, 9);
    add<Curve>(s, { ...base, id: 'ea', type: 'ellipticalArc', c: 'e2', major: 'm2', minor: 'n2', a: 'p', b: 'q' });
    const r = solveSketch(s, { analyze: true });
    expect(r.ok).toBe(true);
    near(Math.hypot(s.points.b.x - s.points.c.x, s.points.b.y - s.points.c.y),
      Math.hypot(s.points.a.x - s.points.c.x, s.points.a.y - s.points.c.y));
    expect(r.dof).toBe(5 + 5 + 7);
  });

  it('solves point on a control spline through real samples', () => {
    const s = sketch();
    pt(s, 'a', 0, 0, true);
    pt(s, 'b', 10, 10, true);
    pt(s, 'c', 20, 10, true);
    pt(s, 'e', 30, 0, true);
    add<ControlSpline>(s, { ...base, id: 'sp', type: 'controlSpline', pts: ['a', 'b', 'c', 'e'], degree: 3 });
    pt(s, 'p', 15, 3);
    con(s, 'k', 'coincident', ['p', 'sp']);
    const r = solveSketch(s, { analyze: true });
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(1);
    // Bezier midpoint of this control polygon is (15, 7.5).
    near(s.points.p.y, 7.5, 0.05);
  });

  it('keeps a point on a spline whose control point is dragged', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    pt(s, 'b', 10, 10);
    pt(s, 'c', 20, 10);
    pt(s, 'e', 30, 0);
    add<ControlSpline>(s, { ...base, id: 'sp', type: 'controlSpline', pts: ['a', 'b', 'c', 'e'], degree: 3 });
    pt(s, 'p', 15, 7.5);
    con(s, 'k', 'coincident', ['p', 'sp']);
    solveSketch(s);
    solveSketch(s, { drag: [{ point: 'b', x: 10, y: 20 }] });
    near(s.points.b.y, 20);
    // The curve moved up under the point: it must have followed.
    expect(s.points.p.y).toBeGreaterThan(9);
  });

  it('maps a fit spline handle and a conic leg to tangency', () => {
    const s = sketch();
    pt(s, 'a', -10, 1);
    pt(s, 'j', 0, 0);
    line(s, 'l', 'a', 'j');
    pt(s, 'f', 5, 3);
    pt(s, 'h', 2, 4);
    add<FitSpline>(s, { ...base, id: 'fs', type: 'fitSpline', pts: ['j', 'f'], closed: false, handles: ['h', null] });
    con(s, 'k', 'tangent', ['l', 'fs']);
    pt(s, 'v', -20, 10);
    pt(s, 'o', -22, 20);
    add<Conic>(s, { ...base, id: 'cn', type: 'conic', a: 'a', b: 'o', v: 'v', rho: 0.5 });
    con(s, 'k2', 'tangent', ['l', 'cn']);
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    const { a, j, h, v } = s.points;
    near((j.x - a.x) * (h.y - j.y) - (j.y - a.y) * (h.x - j.x), 0, 1e-3);
    near((j.x - a.x) * (v.y - a.y) - (j.y - a.y) * (v.x - a.x), 0, 1e-3);
  });

  it('keeps a text frame rectangular and path text follows its curve', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    pt(s, 'b', 10, 0);
    pt(s, 'c', 10, 5);
    pt(s, 'd', 0, 5);
    const text = {
      ...base, type: 'text' as const, text: 'x', font: 'Inter', bold: false, italic: false, height: 5, spacing: 100,
      flipH: false, flipV: false, halign: 'left' as const, valign: 'top' as const,
    };
    add<TextEntity>(s, { ...text, id: 't', mode: 'frame', frame: ['a', 'b', 'c', 'd'] });
    pt(s, 'p', 0, 20);
    pt(s, 'q', 10, 20);
    line(s, 'l', 'p', 'q');
    add<TextEntity>(s, { ...text, id: 'u', mode: 'path', path: 'l' });
    const r = solveSketch(s, { analyze: true, drag: [{ point: 'b', x: 12, y: 3 }] });
    expect(r.ok).toBe(true);
    const { a, b, d } = s.points;
    near((b.x - a.x) * (d.x - a.x) + (b.y - a.y) * (d.y - a.y), 0, 1e-5);
    expect(r.freeCurves.has('t')).toBe(true);
    expect(r.freeCurves.has('u')).toBe(true);
  });

  it('accepts reserved ids in constraints and dimensions', () => {
    const s = sketch();
    pt(s, 'p', 3, 4);
    con(s, 'k', 'coincident', ['p', AXIS_X]);
    addDim(s, dim('d', 'distance', [ORIGIN, 'p'], 10));
    const r = solveSketch(s, { analyze: true });
    expect(r.ok).toBe(true);
    near(Math.abs(s.points.p.x), 10);
    near(s.points.p.y, 0);
    expect(r.dof).toBe(0);
  });
});

describe('wouldOverConstrain', () => {
  function freeLine(): Sketch {
    const s = sketch();
    pt(s, 'a', 0, 0);
    pt(s, 'b', 10, 0);
    line(s, 'l', 'a', 'b');
    return s;
  }

  it('a first dimension on a free line is fine', () => {
    expect(wouldOverConstrain(freeLine(), dim('d', 'distance', ['a', 'b'], 10))).toBe(false);
  });

  it('a duplicate dimension over-constrains', () => {
    const s = freeLine();
    addDim(s, dim('d1', 'distance', ['a', 'b'], 10));
    solveSketch(s);
    expect(wouldOverConstrain(s, dim('d2', 'distance', ['a', 'b'], 10))).toBe(true);
  });

  it('a dimension implied by other constraints over-constrains', () => {
    const s = sketch();
    pt(s, 'a', 0, 0);
    pt(s, 'b', 10, 0);
    pt(s, 'c', 10, 5);
    pt(s, 'd', 0, 5);
    line(s, 'bottom', 'a', 'b');
    line(s, 'right', 'b', 'c');
    line(s, 'top', 'c', 'd');
    line(s, 'left', 'd', 'a');
    con(s, 'k1', 'horizontal', ['bottom']);
    con(s, 'k2', 'horizontal', ['top']);
    con(s, 'k3', 'vertical', ['left']);
    con(s, 'k4', 'vertical', ['right']);
    addDim(s, dim('w', 'distance', ['c', 'd'], 10));
    solveSketch(s);
    expect(wouldOverConstrain(s, dim('w2', 'distance', ['a', 'b'], 10))).toBe(true);
    expect(wouldOverConstrain(s, dim('h', 'distance', ['b', 'c'], 5))).toBe(false);
  });

  it('a conflicting value over-constrains', () => {
    const s = freeLine();
    addDim(s, dim('d1', 'distance', ['a', 'b'], 10));
    solveSketch(s);
    expect(wouldOverConstrain(s, dim('d2', 'distance', ['a', 'b'], 30))).toBe(true);
  });

  it('an angle on a fully fixed pair over-constrains', () => {
    const s = sketch();
    pt(s, 'a', 0, 0, true);
    pt(s, 'b', 10, 0, true);
    pt(s, 'c', 0, 0, true);
    pt(s, 'd', 10, 10, true);
    line(s, 'l', 'a', 'b');
    line(s, 'm', 'c', 'd');
    expect(wouldOverConstrain(s, dim('t', 'angle', ['l', 'm'], Math.PI / 4))).toBe(true);
  });

  it('a value at a geometric limit is not treated as redundant', () => {
    const s = sketch();
    pt(s, 'a', 0, 0, true);
    pt(s, 'b', 0, 10);
    pt(s, 'c', 20, 0, true);
    addDim(s, dim('d1', 'distance', ['a', 'b'], 10));
    // At 29.99 b can reach c. A little further is impossible, a little nearer is not.
    expect(wouldOverConstrain(s, dim('d2', 'distance', ['b', 'c'], 29.995))).toBe(false);
  });

  it('does not touch the sketch', () => {
    const s = freeLine();
    wouldOverConstrain(s, dim('d', 'distance', ['a', 'b'], 42));
    expect(s.points.b.x).toBe(10);
    expect(Object.keys(s.dimensions)).toHaveLength(0);
  });
});

describe('layers', () => {
  /** Two lines joined end to end, the first on `ref`, the second on `dep`, which owns the join. */
  const linked = (): { design: Design; sketch: Sketch; a: Line; b: Line; ref: string; dep: string } => {
    const design = newDesign();
    const sketch = newSketch(design);
    const ref = design.activeLayer;
    const a = addLine(design, sketch, { x: 0, y: 0 }, { x: 10, y: 0 });
    const dep = addLayer(design).id;
    const b = addLine(design, sketch, { x: 10, y: 0 }, { x: 20, y: 5 });
    addConstraint(design, sketch, 'coincident', [a.b, b.a]);
    stampCrossLayer(sketch, dep);
    return { design, sketch, a, b, ref, dep };
  };

  it('a frozen layer does not move, even for a hard constraint, where a hold would give way', () => {
    const t = linked();
    addConstraint(t.design, t.sketch, 'vertical', [t.b.id]);
    t.sketch.points[t.a.a].x = 1;
    const before = { ...t.sketch.points[t.a.b] };
    const r = solveSketch(t.sketch, { freeze: planFreeze(t.design, t.sketch) });
    expect(r.ok).toBe(true);
    expect(t.sketch.points[t.a.b]).toMatchObject({ x: before.x, y: before.y });
    expect(t.sketch.points[t.b.b].x).toBeCloseTo(10, 6);
  });

  it('a dependent follows its reference through a drag', () => {
    const t = linked();
    t.design.activeLayer = t.ref;
    solveSketch(t.sketch, { drag: [{ point: t.a.b, x: 12, y: 3 }], freeze: planFreeze(t.design, t.sketch) });
    expect(t.sketch.points[t.a.b].x).toBeCloseTo(12, 6);
    expect(t.sketch.points[t.b.a].x).toBeCloseTo(12, 6);
    expect(t.sketch.points[t.b.a].y).toBeCloseTo(3, 6);
  });

  it('a locked dependent holds, the reference moves on, and the link reads as broken', () => {
    const t = linked();
    t.design.activeLayer = t.ref;
    t.design.layers.find((l) => l.id === t.dep)!.locked = true;
    const freeze = planFreeze(t.design, t.sketch);
    solveSketch(t.sketch, { drag: [{ point: t.a.b, x: 12, y: 3 }], freeze });
    expect(t.sketch.points[t.a.b].x).toBeCloseTo(12, 6);
    expect(t.sketch.points[t.b.a]).toMatchObject({ x: 10, y: 0 });
    expect(freeze?.broken.size).toBe(1);
    expect(brokenOf(t.sketch, freeze!.broken)).toEqual([...freeze!.broken]);
  });

  it('an intact link does not read as broken', () => {
    const t = linked();
    const k = Object.keys(t.sketch.constraints);
    expect(brokenOf(t.sketch, new Set(k))).toEqual([]);
  });

  it('analysis is as if nothing were frozen, and writes nothing', () => {
    const t = linked();
    t.design.layers.forEach((l) => { l.locked = true; });
    const before = structuredClone(t.sketch.points);
    const frozen = solveSketch(t.sketch, { analyze: true, freeze: planFreeze(t.design, t.sketch) });
    expect(frozen.dof).toBe(0);
    const free = analyzeSketch(t.sketch);
    expect(free.dof).toBe(6);
    expect(free.freeCurves.has(t.a.id)).toBe(true);
    expect(t.sketch.points).toEqual(before);
  });

  it('wouldOverConstrain sees a frozen layer as fixed', () => {
    const t = linked();
    const dim = { id: '__new', kind: 'distance' as const, refs: [t.a.a, t.a.b], name: '', expression: '', value: 10, driving: true, label: { x: 0, y: 0 } };
    expect(wouldOverConstrain(t.sketch, dim)).toBe(false);
    expect(wouldOverConstrain(t.sketch, dim, planFreeze(t.design, t.sketch))).toBe(true);
  });
});

describe('a large sketch', () => {
  it('commits without looking at every row it has already met', () => {
    const d = newDesign();
    const s = newSketch(d);
    for (let i = 0; i < 275; i++) {
      const [x, y] = [(i % 28) * 50, Math.floor(i / 28) * 50];
      const c = [{ x, y }, { x: x + 30, y }, { x: x + 30, y: y + 20 }, { x, y: y + 20 }];
      const ls = c.map((p, k) => addLine(d, s, p, c[(k + 1) % 4]));
      ls.forEach((l, k) => addConstraint(d, s, 'coincident', [l.b, ls[(k + 1) % 4].a]));
      ls.forEach((l, k) => addConstraint(d, s, k % 2 ? 'vertical' : 'horizontal', [l.id]));
    }
    expect(solveSketch(s).ok).toBe(true);
    const started = performance.now();
    expect(solveSketch(s, { analyze: true }).ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(600);
  });
});
