// The two spline limits that were lifted: a point on a spline pulls it, and fit splines reach G2
// with what has a curvature of its own. Everything is measured with the app's own curve maths, not
// the solver's, so the two have to agree.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Arc, Circle, Conic, Constraint, ConstraintType, ControlSpline, Curve, Dimension, DimensionKind, Ellipse, FitSpline, Id, Line, Sketch, Vec2 } from '../model/types';
import { AXIS_X, ORIGIN } from '../model/types';
import { planeFrame } from '../model/frames';
import { curvatureAt, resolve, unitTangent } from '../geom/curves';
import { analyzeSketch, brokenOf, initSolver, solveSketch } from './bridge';

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
function con(s: Sketch, id: Id, type: ConstraintType, refs: Id[], extra: Partial<Constraint> = {}): void {
  s.constraints[id] = { id, type, refs, ...extra };
}
function dim(s: Sketch, id: Id, kind: DimensionKind, refs: Id[], value: number): Dimension {
  const d: Dimension = { id, kind, refs, value, driving: true, name: id, expression: String(value), label: { x: 0, y: 0 } };
  s.dimensions[d.id] = d;
  return d;
}
function fit(s: Sketch, id: Id, pts: [number, number][], handles: (Vec2 | null)[] = [], fixed = false): FitSpline {
  const ids = pts.map(([x, y], i) => pt(s, `${id}${i}`, x, y, fixed));
  const hs = pts.map((_, i) => (handles[i] ? pt(s, `${id}h${i}`, handles[i]!.x, handles[i]!.y) : null));
  return add<FitSpline>(s, { ...base, id, type: 'fitSpline', pts: ids, closed: false, handles: hs });
}
function control(s: Sketch, id: Id, pts: [number, number][], degree: 3 | 5 = 3): ControlSpline {
  const ids = pts.map(([x, y], i) => pt(s, `${id}${i}`, x, y));
  return add<ControlSpline>(s, { ...base, id, type: 'controlSpline', pts: ids, degree });
}
function line(s: Sketch, id: Id, a: Id, b: Id): Line {
  return add(s, { ...base, id, type: 'line', a, b });
}

/** Distance from `p` to the curve as the app draws it. */
function gap(s: Sketch, c: Curve, p: Vec2): number {
  const pc = resolve(s, c);
  let best = Infinity;
  let at = 0;
  const n = 4000;
  for (let i = 0; i <= n; i++) {
    const q = pc.at(i / n);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best) {
      best = d;
      at = i / n;
    }
  }
  for (let i = -400; i <= 400; i++) {
    const t = Math.min(1, Math.max(0, at + i / (n * 400)));
    const q = pc.at(t);
    best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
  }
  return best;
}

const pos = (s: Sketch, id: Id): Vec2 => ({ x: s.points[id].x, y: s.points[id].y });
const moved = (s: Sketch, id: Id, was: Vec2): number => Math.hypot(s.points[id].x - was.x, s.points[id].y - was.y);

/** Signed curvature on the way out of a curve's end. */
function leaving(s: Sketch, c: Curve, atStart: boolean): { u: Vec2; k: number } {
  const pc = resolve(s, c);
  const t = atStart ? 0 : 1;
  const u = unitTangent(pc, t);
  const k = curvatureAt(pc, t);
  return atStart ? { u, k } : { u: { x: -u.x, y: -u.y }, k: -k };
}

/** Two curves leaving a joint in opposite directions are G2 when these two numbers agree. */
function match(s: Sketch, a: Curve, aStart: boolean, b: Curve, bStart: boolean): [number, number] {
  const p = leaving(s, a, aStart);
  const q = leaving(s, b, bStart);
  expect(Math.abs(p.u.x * q.u.y - p.u.y * q.u.x)).toBeLessThan(1e-5);
  expect(p.u.x * q.u.x + p.u.y * q.u.y).toBeLessThan(0);
  return [p.k, -q.k];
}

/** An arc of radius 30 about (0, -30) from (0, 0) back to the left, leaving the joint heading +x. */
function arcAtOrigin(s: Sketch, r = 30): Arc {
  pt(s, 'c', 0, -r);
  pt(s, 'j', 0, 0);
  pt(s, 'o', -r, -r);
  return add<Arc>(s, { ...base, id: 'r', type: 'arc', c: 'c', a: 'j', b: 'o' });
}

beforeAll(async () => {
  await initSolver();
});

describe('a point on a spline pulls it', () => {
  it('a dragged point takes a free fit spline with it', () => {
    const s = sketch();
    const sp = fit(s, 'f', [[0, 0], [20, 10], [40, 0], [60, 10]]);
    pt(s, 'p', 30, 5);
    con(s, 'k', 'coincident', ['p', 'f']);
    expect(solveSketch(s).ok).toBe(true);
    const was = pos(s, 'p');
    const f1 = pos(s, 'f1');
    const to = { x: was.x + 1, y: was.y + 8 };
    const r = solveSketch(s, { drag: [{ point: 'p', ...to }] });
    expect(r.ok).toBe(true);
    expect(moved(s, 'p', to)).toBeLessThan(1e-4);
    expect(gap(s, sp, pos(s, 'p'))).toBeLessThan(1e-3);
    expect(moved(s, 'f1', f1)).toBeGreaterThan(0.5);
  });

  it('a dragged point takes a free control spline with it, along a whole drag', () => {
    const s = sketch();
    const sp = control(s, 'g', [[0, 0], [15, 20], [35, 20], [50, 0], [70, 5]]);
    pt(s, 'p', 25, 12);
    con(s, 'k', 'coincident', ['p', 'g']);
    expect(solveSketch(s).ok).toBe(true);
    const start = pos(s, 'p');
    for (let i = 1; i <= 30; i++) {
      const to = { x: start.x, y: start.y + i * 0.5 };
      const r = solveSketch(s, { drag: [{ point: 'p', ...to }] });
      expect(r.ok).toBe(true);
      expect(moved(s, 'p', to)).toBeLessThan(1e-4);
      expect(gap(s, sp, pos(s, 'p'))).toBeLessThan(1e-3);
    }
  });

  it('a fixed spline still only lets the point slide', () => {
    const s = sketch();
    const sp = fit(s, 'f', [[0, 0], [20, 10], [40, 0]], [], true);
    pt(s, 'p', 10, 8);
    con(s, 'k', 'coincident', ['p', 'f']);
    expect(solveSketch(s).ok).toBe(true);
    const f1 = pos(s, 'f1');
    solveSketch(s, { drag: [{ point: 'p', x: 30, y: 30 }] });
    expect(moved(s, 'f1', f1)).toBe(0);
    expect(gap(s, sp, pos(s, 'p'))).toBeLessThan(1e-2);
  });

  it('a fixed point off the spline bends the spline onto it', () => {
    const s = sketch();
    const sp = fit(s, 'f', [[0, 0], [20, 10], [40, 0], [60, 10]]);
    pt(s, 'p', 30, 9, true);
    con(s, 'k', 'coincident', ['p', 'f']);
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(gap(s, sp, { x: 30, y: 9 })).toBeLessThan(1e-3);
    expect(moved(s, 'p', { x: 30, y: 9 })).toBe(0);
  });

  it('a point held by a line pulls the spline when the line is what moves', () => {
    const s = sketch();
    const sp = fit(s, 'f', [[0, 0], [20, 10], [40, 0], [60, 10]]);
    pt(s, 'a', 30, -30, true);
    pt(s, 'p', 30, 5);
    line(s, 'l', 'a', 'p');
    con(s, 'k', 'coincident', ['p', 'f']);
    dim(s, 'h', 'horizontal', ['a', 'p'], 0);
    const d = dim(s, 'v', 'vertical', ['a', 'p'], 35);
    expect(solveSketch(s).ok).toBe(true);
    d.value = 42;
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    near2(pos(s, 'p'), { x: 30, y: 12 });
    expect(gap(s, sp, pos(s, 'p'))).toBeLessThan(1e-3);
  });

  it('a value that pulls moves the spline ends and leaves its interior points', () => {
    const s = sketch();
    const sp = fit(s, 'f', [[0, 0], [20, 10], [40, 0], [60, 10]]);
    pt(s, 'q', 8, 0, true);
    pt(s, 'p', 8, 6);
    con(s, 'k', 'coincident', ['p', 'f']);
    dim(s, 'h', 'horizontal', ['q', 'p'], 0);
    const d = dim(s, 'v', 'vertical', ['q', 'p'], 6);
    expect(solveSketch(s).ok).toBe(true);
    const [f1, f2] = [pos(s, 'f1'), pos(s, 'f2')];
    const f0 = pos(s, 'f0');
    d.value = 8;
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(moved(s, 'f1', f1)).toBeLessThan(1e-9);
    expect(moved(s, 'f2', f2)).toBeLessThan(1e-9);
    expect(moved(s, 'f0', f0)).toBeGreaterThan(0.1);
    near2(pos(s, 'p'), { x: 8, y: 8 });
    expect(gap(s, sp, pos(s, 'p'))).toBeLessThan(1e-3);
  });

  it('a dimension between the spline ends still leaves the interior and carries the point', () => {
    const s = sketch();
    const sp = fit(s, 'f', [[0, 0], [20, 10], [40, 0], [60, 10]]);
    pt(s, 'p', 30, 5);
    con(s, 'k', 'coincident', ['p', 'f']);
    const d = dim(s, 'd', 'distance', ['f0', 'f3'], Math.hypot(60, 10));
    expect(solveSketch(s).ok).toBe(true);
    const [f1, f2] = [pos(s, 'f1'), pos(s, 'f2')];
    d.value = 70;
    expect(solveSketch(s).ok).toBe(true);
    near(Math.hypot(s.points.f3.x - s.points.f0.x, s.points.f3.y - s.points.f0.y), 70, 1e-6);
    expect(moved(s, 'f1', f1)).toBe(0);
    expect(moved(s, 'f2', f2)).toBe(0);
    expect(gap(s, sp, pos(s, 'p'))).toBeLessThan(5e-3);
  });

  it('a pinned point on a tight curve reads as met, though it is off the chords of the samples', () => {
    const s = sketch();
    const sp = fit(s, 'f', [[0, 0], [30, 80], [60, 0], [90, 80]]);
    pt(s, 'p', 16, 62, true);
    con(s, 'k', 'coincident', ['p', 'f']);
    const r = solveSketch(s);
    expect(r.ok).toBe(true);
    expect(gap(s, sp, { x: 16, y: 62 })).toBeLessThan(1e-3);
    expect(brokenOf(s, new Set(['k']), undefined, 1e-3)).toEqual([]);
  });

  it('pulls a spline with a curvature end, and G2 holds', () => {
    const s = sketch();
    const r = arcAtOrigin(s);
    const sp = fit(s, 'f', [[0, 0], [30, -15], [55, -40], [80, -40]], [{ x: 10, y: 0 }]);
    con(s, 'j1', 'coincident', ['j', 'f0']);
    con(s, 'k', 'curvature', ['f', 'r'], { variant: 0 });
    pt(s, 'p', 60, -38);
    con(s, 'on', 'coincident', ['p', 'f']);
    expect(solveSketch(s).ok).toBe(true);
    const was = pos(s, 'p');
    const to = { x: was.x, y: was.y + 4 };
    expect(solveSketch(s, { drag: [{ point: 'p', ...to }] }).ok).toBe(true);
    expect(moved(s, 'p', to)).toBeLessThan(1e-4);
    expect(gap(s, sp, to)).toBeLessThan(1e-3);
    const [a, b] = match(s, sp, true, r, true);
    near(a, b, 1e-5);
  });

  it('counts the row against the spline when the point cannot give', () => {
    const s = sketch();
    fit(s, 'f', [[0, 0], [20, 10], [40, 0], [60, 10]]);
    pt(s, 'p', 30, 5, true);
    con(s, 'k', 'coincident', ['p', 'f']);
    expect(solveSketch(s).ok).toBe(true);
    // Eight numbers, one taken by the point on it. The point is fixed, so only the spline can pay.
    expect(analyzeSketch(s).dof).toBe(8 - 1);
  });
});

/** Measured numbers go to the report and the docs from here. */
const said: Record<string, [number, number]> = {};
function g2(name: string, got: [number, number], tol = 1e-5): void {
  said[name] = got;
  console.log(`G2 ${name}: ${got[0].toFixed(7)} ${got[1].toFixed(7)}`);
  near(got[0], got[1], tol);
}

const near = (a: number, b: number, tol = 1e-6): void => expect(Math.abs(a - b)).toBeLessThan(tol);
const near2 = (a: Vec2, b: Vec2, tol = 1e-5): void => expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(tol);

describe('fit splines reach G2', () => {
  it('with an arc, by the handle length alone when that can do it', () => {
    const s = sketch();
    const r = arcAtOrigin(s);
    const sp = fit(s, 'f', [[0, 0], [30, -15], [55, -40]], [{ x: 10, y: 0 }]);
    con(s, 'j1', 'coincident', ['j', 'f0']);
    con(s, 'k', 'curvature', ['f', 'r'], { variant: 0 });
    const [f1, f2] = [pos(s, 'f1'), pos(s, 'f2')];
    const res = solveSketch(s);
    expect(res.ok).toBe(true);
    const [a, b] = match(s, sp, true, r, true);
    g2('fit-arc', [a, b]);
    near(Math.abs(a), 1 / 30, 1e-5);
    expect(moved(s, 'f1', f1)).toBe(0);
    expect(moved(s, 'f2', f2)).toBe(0);
    expect(moved(s, 'j', { x: 0, y: 0 })).toBeLessThan(1e-6);
  });

  it('with an arc bending the other way, by moving the next fit point', () => {
    const s = sketch();
    const r = arcAtOrigin(s);
    // The spline wants to turn left where the arc turns right, so no handle length can do it.
    const sp = fit(s, 'f', [[0, 0], [30, 15], [55, 40]], [{ x: 10, y: 0 }]);
    con(s, 'j1', 'coincident', ['j', 'f0']);
    con(s, 'k', 'curvature', ['f', 'r'], { variant: 0 });
    const f2 = pos(s, 'f2');
    expect(solveSketch(s).ok).toBe(true);
    g2('fit-arc-opposite', match(s, sp, true, r, true));
    expect(moved(s, 'f2', f2)).toBe(0);
    // A new constraint is a small move: the arc stays where it was.
    expect(moved(s, 'j', { x: 0, y: 0 })).toBeLessThan(1e-6);
    expect(moved(s, 'c', { x: 0, y: -30 })).toBeLessThan(1e-6);
  });

  it('with a circle at the last end of the spline', () => {
    const s = sketch();
    pt(s, 'c', 0, -30);
    add<Circle>(s, { ...base, id: 'r', type: 'circle', c: 'c', r: 30 });
    const sp = fit(s, 'f', [[-55, -40], [-30, -15], [0, 0]], [null, null, { x: 10, y: 0 }]);
    con(s, 'on', 'coincident', ['f2', 'r']);
    con(s, 'k', 'curvature', ['f', 'r'], { variant: 1 });
    expect(solveSketch(s).ok).toBe(true);
    const out = leaving(s, sp, false);
    g2('fit-circle', [Math.abs(out.k), 1 / 30]);
  });

  it('follows a radius changed by a dimension, and the fit points stay', () => {
    const s = sketch();
    const r = arcAtOrigin(s);
    const sp = fit(s, 'f', [[0, 0], [30, -15], [55, -40]], [{ x: 10, y: 0 }]);
    con(s, 'j1', 'coincident', ['j', 'f0']);
    con(s, 'k', 'curvature', ['f', 'r'], { variant: 0 });
    dim(s, 'fix', 'horizontal', ['c', 'j'], 0);
    const d = dim(s, 'rad', 'radius', ['r'], 30);
    expect(solveSketch(s).ok).toBe(true);
    const f2 = pos(s, 'f2');
    d.value = 40;
    expect(solveSketch(s).ok).toBe(true);
    const [a, b] = match(s, sp, true, r, true);
    g2('fit-arc-after-radius', [a, b]);
    near(Math.abs(a), 1 / 40, 1e-5);
    expect(moved(s, 'f2', f2)).toBeLessThan(1e-6);
  });

  it('holds G2 through a drag of a fit point', () => {
    const s = sketch();
    const r = arcAtOrigin(s);
    const sp = fit(s, 'f', [[0, 0], [30, -15], [55, -40]], [{ x: 10, y: 0 }]);
    con(s, 'j1', 'coincident', ['j', 'f0']);
    con(s, 'k', 'curvature', ['f', 'r'], { variant: 0 });
    expect(solveSketch(s).ok).toBe(true);
    for (let i = 1; i <= 10; i++) {
      expect(solveSketch(s, { drag: [{ point: 'f1', x: 30 + i * 0.4, y: -15 - i * 0.3 }] }).ok).toBe(true);
      const [a, b] = match(s, sp, true, r, true);
      near(a, b, 1e-5);
    }
    g2('fit-arc-dragged', match(s, sp, true, r, true));
  });

  it('with another fit spline', () => {
    const s = sketch();
    const a = fit(s, 'f', [[0, 0], [30, -15], [55, -40]], [{ x: 10, y: 0 }]);
    const b = fit(s, 'g', [[-55, -35], [-30, -13], [0, 0]], [null, null, { x: 12, y: 0 }]);
    con(s, 'j1', 'coincident', ['f0', 'g2']);
    con(s, 'k', 'curvature', ['f', 'g'], { variant: 0 | (1 << 1) });
    expect(solveSketch(s).ok).toBe(true);
    g2('fit-fit', match(s, a, true, b, false));
    near(Math.abs(leaving(s, a, true).k) > 1e-3 ? 1 : 0, 1);
  });

  it('with a control spline, driving the fit spline', () => {
    const s = sketch();
    const a = fit(s, 'f', [[0, 0], [30, -15], [55, -40]], [{ x: 10, y: 0 }]);
    const b = control(s, 'g', [[0, 0], [-15, 0], [-30, -8], [-45, -25]]);
    con(s, 'j1', 'coincident', ['f0', 'g0']);
    con(s, 'k', 'curvature', ['f', 'g'], { variant: 0 });
    expect(solveSketch(s).ok).toBe(true);
    g2('fit-control', match(s, a, true, b, true));
  });

  it('with a fit spline, driving the control spline', () => {
    const s = sketch();
    const a = control(s, 'g', [[0, 0], [-15, 0], [-30, -8], [-45, -25]]);
    const b = fit(s, 'f', [[0, 0], [30, -15], [55, -40]], [{ x: 10, y: 0 }]);
    con(s, 'j1', 'coincident', ['g0', 'f0']);
    con(s, 'k', 'curvature', ['g', 'f'], { variant: 0 });
    expect(solveSketch(s).ok).toBe(true);
    g2('control-fit', match(s, a, true, b, true));
  });

  it('after a long turn of the tangent, as the tool leaves it with a handle on the natural tangent', () => {
    const s = sketch();
    const a = fit(s, 'f', [[50, 0], [70, 25], [90, 0]], [{ x: 55.02205822543753, y: 9.416359172695365 }]);
    const b = control(s, 'g', [[50, 0], [30, 0], [15, 15], [0, 40]]);
    con(s, 'j1', 'coincident', ['f0', 'g0']);
    con(s, 'a1', 'coincident', ['g1', AXIS_X]);
    con(s, 'k', 'curvature', ['f', 'g'], { variant: 0 });
    expect(solveSketch(s).ok).toBe(true);
    g2('fit-control-long-turn', match(s, a, true, b, true));
  });

  it('a handle dragged along its length reaches the cursor, the next fit point carries G2', () => {
    const s = sketch();
    const r = arcAtOrigin(s);
    const sp = fit(s, 'f', [[0, 0], [30, -15], [55, -40]], [{ x: 10, y: 0 }]);
    con(s, 'j1', 'coincident', ['j', 'f0']);
    con(s, 'k', 'curvature', ['f', 'r'], { variant: 0 });
    expect(solveSketch(s).ok).toBe(true);
    const to = { x: 16, y: 0 };
    expect(solveSketch(s, { drag: [{ point: 'fh0', ...to }], hold: ['f0'] }).ok).toBe(true);
    near2(pos(s, 'fh0'), to);
    near2(pos(s, 'j'), { x: 0, y: 0 });
    g2('fit-arc-handle-dragged', match(s, sp, true, r, true));
  });

  it('a handle dragged with the next fit point pinned stays, and the joint with it', () => {
    const s = sketch();
    const r = arcAtOrigin(s);
    const sp = fit(s, 'f', [[0, 0], [30, -15], [55, -40]], [{ x: 10, y: 0 }]);
    con(s, 'j1', 'coincident', ['j', 'f0']);
    con(s, 'k', 'curvature', ['f', 'r'], { variant: 0 });
    expect(solveSketch(s).ok).toBe(true);
    s.points.f1.fixed = true;
    const was = pos(s, 'fh0');
    expect(solveSketch(s, { drag: [{ point: 'fh0', x: 16, y: 0 }], hold: ['f0'] }).ok).toBe(true);
    near2(pos(s, 'j'), { x: 0, y: 0 });
    near2(pos(s, 'fh0'), was);
    const [a, b] = match(s, sp, true, r, true);
    near(a, b, 1e-5);
  });

  it('a control spline matched to an end with no curvature to read is not reported as met', () => {
    const s = sketch();
    const b = fit(s, 'f', [[0, 0], [30, -15], [55, -40]], [{ x: 0, y: 0 }]);
    // Pinned, or the solve gives the handle a length and the curvature can be read after all.
    s.points.f0.fixed = true;
    s.points.fh0.fixed = true;
    control(s, 'g', [[0, 0], [-15, 0], [-30, -8], [-45, -25]]);
    con(s, 'j1', 'coincident', ['g0', 'f0']);
    con(s, 'k', 'curvature', ['g', 'f'], { variant: 0 });
    const r = solveSketch(s);
    expect(r.ok).toBe(false);
    expect(r.unsatisfied).toContain('k');
    expect(b.pts.length).toBe(3);
  });

  it('with a line even where a handle is active', () => {
    const s = sketch();
    pt(s, 'la', -20, 0, true);
    pt(s, 'lb', 0, 0);
    line(s, 'l', 'la', 'lb');
    const sp = fit(s, 'f', [[0, 0], [30, -15], [55, -40]], [{ x: 10, y: 0 }]);
    con(s, 'j1', 'coincident', ['lb', 'f0']);
    con(s, 'k', 'curvature', ['f', 'l'], { variant: 0 });
    expect(solveSketch(s).ok).toBe(true);
    g2('fit-line-with-handle', [leaving(s, sp, true).k, 0]);
  });

  it('with an ellipse', () => {
    const s = sketch();
    pt(s, 'c', 0, -15);
    pt(s, 'm', 40, -15);
    pt(s, 'n', 0, 0);
    const e = add<Ellipse>(s, { ...base, id: 'e', type: 'ellipse', c: 'c', major: 'm', minor: 'n' });
    const sp = fit(s, 'f', [[0, 0], [30, -5], [60, -25]], [{ x: 10, y: 0 }]);
    con(s, 'on', 'coincident', ['f0', 'n']);
    con(s, 'k', 'curvature', ['f', 'e'], { variant: 0 });
    expect(solveSketch(s).ok).toBe(true);
    // At the end of the minor axis of a 40 by 15 ellipse the radius of curvature is a^2 / b.
    expect(e.type).toBe('ellipse');
    const k = leaving(s, sp, true).k;
    g2('fit-ellipse', [Math.abs(k), 15 / (40 * 40)]);
  });

  it('with a conic as the other curve', () => {
    const s = sketch();
    pt(s, 'ca', 0, 0);
    pt(s, 'cv', -30, 0);
    pt(s, 'cb', -40, -30);
    const n = add<Conic>(s, { ...base, id: 'n', type: 'conic', a: 'ca', v: 'cv', b: 'cb', rho: 0.5 });
    const sp = fit(s, 'f', [[0, 0], [30, -5], [60, -25]], [{ x: 10, y: 0 }]);
    con(s, 'j1', 'coincident', ['ca', 'f0']);
    con(s, 'k', 'curvature', ['f', 'n'], { variant: 0 });
    expect(solveSketch(s).ok).toBe(true);
    g2('fit-conic', match(s, sp, true, n, true));
  });

  it('says so when it cannot be met, and keeps the geometry it was given', () => {
    const s = sketch();
    arcAtOrigin(s);
    // Both the handle and the next fit point are pinned: nothing is left to steer with.
    const sp = fit(s, 'f', [[0, 0], [30, 15], [55, 40]], [{ x: 10, y: 0 }]);
    s.points.f1.fixed = true;
    s.points.fh0.fixed = true;
    con(s, 'j1', 'coincident', ['j', 'f0']);
    con(s, 'k', 'curvature', ['f', 'r'], { variant: 0 });
    const r = solveSketch(s);
    expect(r.ok).toBe(false);
    expect(r.unsatisfied).toContain('k');
    expect(sp.pts.length).toBe(3);
    near2(pos(s, 'f1'), { x: 30, y: 15 });
    near2(pos(s, 'j'), { x: 0, y: 0 });
  });

  it('a spline end with no handle has nothing to steer, and stays tangent', () => {
    const s = sketch();
    arcAtOrigin(s);
    const sp = fit(s, 'f', [[0, 0], [30, -15], [55, -40]]);
    con(s, 'j1', 'coincident', ['j', 'f0']);
    con(s, 'k', 'curvature', ['f', 'r'], { variant: 0 });
    solveSketch(s);
    near(leaving(s, sp, true).k, 0, 1e-9);
  });
});

describe('a value a point can meet by sliding', () => {
  const flung = (route: number[], joined = false): { slide: number; p: Vec2; ok: boolean[] } => {
    const s = sketch();
    const sp = fit(s, 'f', [[-40, 0], [-15, 25], [15, -10], [40, 10]]);
    if (joined) {
      pt(s, 'la', -60, 0, true);
      pt(s, 'lb', -40, 0);
      line(s, 'l1', 'la', 'lb');
      con(s, 'c1', 'coincident', ['lb', 'f0']);
      pt(s, 'ma', 60, 10, true);
      pt(s, 'mb', 40, 10);
      line(s, 'l2', 'ma', 'mb');
      con(s, 'c2', 'coincident', ['mb', 'f3']);
    }
    pt(s, 'p', 0, 25);
    con(s, 'k', 'coincident', ['p', 'f']);
    expect(solveSketch(s).ok).toBe(true);
    const d = dim(s, 'd', 'distance', ['p', ORIGIN], Math.hypot(s.points.p.x, s.points.p.y));
    expect(solveSketch(s).ok).toBe(true);
    const was = sp.pts.map((id) => pos(s, id));
    const ok: boolean[] = [];
    for (const value of route) {
      d.value = value;
      ok.push(solveSketch(s).ok);
    }
    return { slide: Math.max(...sp.pts.map((id, i) => moved(s, id, was[i]))), p: pos(s, 'p'), ok };
  };

  it.each([
    [[32.96, 14.42]],
    [[32.96, 24.72, 18.54, 14.42]],
    [[14.42]],
  ])('route %j leaves the spline alone', (route) => {
    const r = flung(route);
    expect(r.ok.every(Boolean)).toBe(true);
    expect(r.slide).toBe(0);
    near(Math.hypot(r.p.x, r.p.y), 14.42, 1e-5);
  });

  it('with lines joined to both ends', () => {
    const r = flung([25.75, 32.96, 14.42], true);
    expect(r.ok.every(Boolean)).toBe(true);
    expect(r.slide).toBe(0);
  });
});
