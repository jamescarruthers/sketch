import { beforeEach, describe, expect, it } from 'vitest';
import type { Arc, Circle, ControlSpline, Design, Dimension, EllipticalArc, FitSpline, Line, Sketch, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y, ORIGIN } from '../model/types';
import {
  addArc, addCircle, addConic, addConstraint, addControlSpline, addDimension, addEllipse, addFitSpline, addLine, addPoint,
  deleteEntities, getPointPos, newDesign, newSketch,
} from '../model/document';
import { curveLength, curvatureAt, closestPoint, evaluate, resolve, reversed, tangent } from './curves';
import {
  blend, blendPreview, breakCurve, breakPreview, chamfer, chamferPreview, changeSplineDegree, circPattern, circPatternSlots,
  curvesAtVertex, extend, extendTarget, fillet, filletPreview, filletVertex, filletVertices, insertSplinePoint, mirror, mirrorPreview, moveCopy,
  moveCopyPreview, patternPreview, preview, rectPattern, rectPatternSlots, scaleGeometry, setInstanceSuppressed, trim, trimMany,
  trimPreview, updatePattern,
} from './modify';
import { dist } from './vec';

let d: Design;
let s: Sketch;
beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

const types = (t: string) => Object.values(s.constraints).filter((k) => k.type === t);
const pos = (id: string) => ({ x: s.points[id].x, y: s.points[id].y });
const near = (a: Vec2, x: number, y: number, p = 6) => {
  expect(a.x).toBeCloseTo(x, p);
  expect(a.y).toBeCloseTo(y, p);
};
const dims = (kind?: string) => Object.values(s.dimensions).filter((m: Dimension) => !kind || m.kind === kind);
const lines = () => Object.values(s.curves).filter((c): c is Line => c.type === 'line');

describe('fillet keeps the arm away from the corner, wherever the pick is', () => {
  const lengths = (ids: string[]): number[] => ids.map((id) => {
    const l = s.curves[id] as Line;
    return dist(getPointPos(s, l.a), getPointPos(s, l.b));
  });
  // Rectangle (0,0)-(80,40): picks either side of the contact point of a radius 6 fillet.
  for (const along of [1, 3, 5, 5.9, 6, 6.1, 8, 20, 39]) {
    it(`two lines, picks ${along} from the corner`, () => {
      const bottom = addLine(d, s, { x: 0, y: 0 }, { x: 80, y: 0 });
      const right = addLine(d, s, { x: 80, y: 0 }, { x: 80, y: 40 });
      addConstraint(d, s, 'coincident', [bottom.b, right.a]);
      fillet(d, s, bottom.id, right.id, 6, { x: 80 - along, y: 0 }, { x: 80, y: along });
      expect(lengths([bottom.id, right.id])[0]).toBeCloseTo(74, 6);
      expect(lengths([bottom.id, right.id])[1]).toBeCloseTo(34, 6);
    });
    it(`the same corner with the lines the other way round, picks ${along} from it`, () => {
      const bottom = addLine(d, s, { x: 80, y: 0 }, { x: 0, y: 0 });
      const right = addLine(d, s, { x: 80, y: 40 }, { x: 80, y: 0 });
      fillet(d, s, right.id, bottom.id, 6, { x: 80, y: along }, { x: 80 - along, y: 0 });
      expect(lengths([bottom.id, right.id])[0]).toBeCloseTo(74, 6);
      expect(lengths([bottom.id, right.id])[1]).toBeCloseTo(34, 6);
    });
  }
  for (const [px, py] of [[-20, 30], [-1, 30], [1, 30], [20, 30], [-20, -30], [20, -30], [-1, -1], [1, 1]]) {
    it(`crossing lines: picks at x ${px} and y ${py} say which sides stay`, () => {
      const h = addLine(d, s, { x: -40, y: 0 }, { x: 40, y: 0 });
      const v = addLine(d, s, { x: 0, y: -40 }, { x: 0, y: 40 });
      fillet(d, s, h.id, v.id, 2, { x: px, y: 0 }, { x: 0, y: py });
      const keptH = [getPointPos(s, (s.curves[h.id] as Line).a).x, getPointPos(s, (s.curves[h.id] as Line).b).x].sort((p, q) => p - q);
      const keptV = [getPointPos(s, (s.curves[v.id] as Line).a).y, getPointPos(s, (s.curves[v.id] as Line).b).y].sort((p, q) => p - q);
      expect(keptH.map((n) => Math.round(n))).toEqual(px > 0 ? [2, 40] : [-40, -2]);
      expect(keptV.map((n) => Math.round(n))).toEqual(py > 0 ? [2, 40] : [-40, -2]);
    });
  }
  // A line into the end of a quarter arc about the origin: both the line and the arc keep their far ends.
  for (const along of [0.5, 2, 4, 10, 25]) {
    it(`a line and an arc, picks ${along} from the corner`, () => {
      const l = addLine(d, s, { x: 0, y: 60 }, { x: 0, y: 30 });
      const a = addArc(d, s, { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 30 });
      addConstraint(d, s, 'coincident', [l.b, a.b]);
      const t = Math.PI / 2 - along / 30;
      fillet(d, s, l.id, a.id, 3, { x: 0, y: 30 + along }, { x: 30 * Math.cos(t), y: 30 * Math.sin(t) });
      const arc = s.curves[a.id] as Arc;
      expect(getPointPos(s, arc.a).x).toBeCloseTo(30, 6);
      expect(getPointPos(s, arc.a).y).toBeCloseTo(0, 6);
      expect(getPointPos(s, (s.curves[l.id] as Line).a).y).toBeCloseTo(60, 6);
    });
    it(`two arcs, picks ${along} from where they meet`, () => {
      const p = addArc(d, s, { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 30 });
      const q = addArc(d, s, { x: -30, y: 30 }, { x: 0, y: 30 }, { x: -30, y: 60 });
      addConstraint(d, s, 'coincident', [p.b, q.a]);
      const [t, u] = [Math.PI / 2 - along / 30, along / 30];
      fillet(d, s, p.id, q.id, 3, { x: 30 * Math.cos(t), y: 30 * Math.sin(t) }, { x: -30 + 30 * Math.cos(u), y: 30 + 30 * Math.sin(u) });
      expect(getPointPos(s, (s.curves[p.id] as Arc).a).x).toBeCloseTo(30, 6);
      expect(getPointPos(s, (s.curves[q.id] as Arc).b).y).toBeCloseTo(60, 6);
    });
  }
});

describe('trim', () => {
  it('leaves a degree 1 spline its corners, exactly', () => {
    const c = addControlSpline(d, s, [{ x: -40, y: 0 }, { x: -10, y: 30 }, { x: 20, y: -10 }, { x: 50, y: 20 }], 1);
    addLine(d, s, { x: -30, y: -20 }, { x: -30, y: 40 });
    trim(d, s, c.id, { x: -38, y: 2 });
    const left = (s.curves[c.id] as ControlSpline).pts.map((p) => getPointPos(s, p));
    expect(left[0].x).toBeCloseTo(-30, 6);
    expect(left[0].y).toBeCloseTo(10, 6);
    expect(left.slice(1)).toEqual([{ x: -10, y: 30 }, { x: 20, y: -10 }, { x: 50, y: 20 }].map((p) => expect.objectContaining(p)));
  });

  it('turns a circle cut by two lines into the far arc', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    const left = addLine(d, s, { x: -3, y: -10 }, { x: -3, y: 10 });
    const right = addLine(d, s, { x: 3, y: -10 }, { x: 3, y: 10 });
    expect(trimPreview(s, c.id, { x: 5, y: 0 })?.whole).toBe(false);
    const r = trim(d, s, c.id, { x: 5, y: 0 });
    expect(r.changed).toContain(c.id);
    const arc = s.curves[c.id] as Arc;
    expect(arc.type).toBe('arc');
    // Pick was at +x, between the +y and -y crossings of the right line: that bit goes.
    expect(dist(pos(arc.a), { x: 3, y: 4 }) < 1e-6 || dist(pos(arc.b), { x: 3, y: 4 }) < 1e-6).toBe(true);
    expect(closestPoint(s, arc, { x: 5, y: 0 }).dist).toBeGreaterThan(1);
    expect(closestPoint(s, arc, { x: -5, y: 0 }).dist).toBeLessThan(1e-6);
    expect(curveLength(s, arc)).toBeCloseTo(5 * (2 * Math.PI - 2 * Math.atan2(4, 3)), 6);
    const ties = types('coincident');
    expect(ties.length).toBe(2);
    expect(ties.every((k) => k.refs.includes(right.id))).toBe(true);
    expect(left.id).toBeTruthy();
  });
  it('keeps a radius dimension when a circle becomes an arc', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    const dim = addDimension(d, s, 'radius', [c.id], 5);
    addLine(d, s, { x: -10, y: 0 }, { x: 10, y: 0 });
    trim(d, s, c.id, { x: 0, y: 5 });
    expect(s.dimensions[dim.id]).toBeDefined();
    const arc = s.curves[c.id] as Arc;
    expect(evaluate(s, arc, 0.5).y).toBeCloseTo(-5);
  });
  it('deletes a curve with no intersections', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const c = addCircle(d, s, { x: 50, y: 0 }, 5);
    expect(trimPreview(s, l.id, { x: 5, y: 0 })?.whole).toBe(true);
    trim(d, s, l.id, { x: 5, y: 0 });
    expect(s.curves[l.id]).toBeUndefined();
    expect(Object.keys(s.points).length).toBe(1);
    trim(d, s, c.id, { x: 55, y: 0 });
    expect(s.curves[c.id]).toBeUndefined();
  });
  it('a circle with a single crossing is deleted, there is no span to keep', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    addLine(d, s, { x: 5, y: 0 }, { x: 15, y: 0 });
    trim(d, s, c.id, { x: -5, y: 0 });
    expect(s.curves[c.id]).toBeUndefined();
  });
  it('shortens a line from the pick side and keeps its horizontal', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    addLine(d, s, { x: 6, y: -5 }, { x: 6, y: 5 });
    const h = addConstraint(d, s, 'horizontal', [l.id]);
    const len = addDimension(d, s, 'distance', [l.a, l.b], 10);
    trim(d, s, l.id, { x: 9, y: 0 });
    const line = s.curves[l.id] as Line;
    near(pos(line.b), 6, 0);
    near(pos(line.a), 0, 0);
    expect(s.constraints[h.id]).toBeDefined();
    // Triage ruling on M-F6: the line survives, so its dimension does, at the trimmed length.
    expect(s.dimensions[len.id].value).toBeCloseTo(6, 9);
    expect(s.dimensions[len.id].refs).toEqual([line.a, line.b]);
  });
  it('splits a line trimmed in the middle, horizontal on one piece and collinear holding the other', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 12, y: 0 });
    const a = addLine(d, s, { x: 4, y: -5 }, { x: 4, y: 5 });
    const b = addLine(d, s, { x: 8, y: -5 }, { x: 8, y: 5 });
    addConstraint(d, s, 'horizontal', [l.id]);
    const r = trim(d, s, l.id, { x: 6, y: 0 });
    const piece = s.curves[r.created.find((id) => s.curves[id])!] as Line;
    near(pos((s.curves[l.id] as Line).b), 4, 0);
    near(pos(piece.a), 8, 0);
    near(pos(piece.b), 12, 0);
    expect(types('horizontal').map((k) => k.refs[0])).toEqual([l.id]);
    expect(types('collinear')[0].refs).toEqual([l.id, piece.id]);
    const cut = types('coincident');
    expect(cut.some((k) => k.refs.includes(a.id))).toBe(true);
    expect(cut.some((k) => k.refs.includes(b.id))).toBe(true);
  });
  it('the old end loses its coincident to the removed part, the far end keeps its own', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const left = addLine(d, s, { x: 0, y: 0 }, { x: 0, y: 5 });
    const right = addLine(d, s, { x: 10, y: 0 }, { x: 10, y: 5 });
    const keep = addConstraint(d, s, 'coincident', [l.a, left.a]);
    const lose = addConstraint(d, s, 'coincident', [l.b, right.a]);
    addLine(d, s, { x: 5, y: -2 }, { x: 5, y: 2 });
    trim(d, s, l.id, { x: 8, y: 0 });
    expect(s.constraints[keep.id]).toBeDefined();
    expect(s.constraints[lose.id]).toBeUndefined();
  });
  it('joins a new end to the cutter end point when they meet, not just the curve', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const t = addLine(d, s, { x: 5, y: 0 }, { x: 5, y: 8 });
    trim(d, s, l.id, { x: 9, y: 0 });
    expect(types('coincident')[0].refs).toContain(t.a);
  });
  it('drops a tangent that was on the removed part and keeps one on the surviving part', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    const top = addLine(d, s, { x: -8, y: 5 }, { x: 8, y: 5 });
    const side = addLine(d, s, { x: 5, y: 8 }, { x: 5, y: 2 });
    const keep = addConstraint(d, s, 'tangent', [c.id, top.id]);
    const lose = addConstraint(d, s, 'tangent', [c.id, side.id]);
    addLine(d, s, { x: 0, y: 0 }, { x: 8, y: 8 * Math.tan(-0.5) });
    addLine(d, s, { x: 0, y: 0 }, { x: 8, y: 8 * Math.tan(0.5) });
    trim(d, s, c.id, { x: 5, y: 0 });
    expect(s.constraints[keep.id]).toBeDefined();
    expect(s.constraints[lose.id]).toBeUndefined();
  });
  it('moves a point-on-curve to the piece holding it, and drops a midpoint', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 12, y: 0 });
    const p = addPoint(d, s, { x: 10, y: 0 }, { explicit: true });
    const on = addConstraint(d, s, 'coincident', [p.id, l.id]);
    const mid = addPoint(d, s, { x: 6, y: 0 }, { explicit: true });
    const k = addConstraint(d, s, 'midpoint', [mid.id, l.id]);
    addLine(d, s, { x: 4, y: -5 }, { x: 4, y: 5 });
    const b = addLine(d, s, { x: 8, y: -5 }, { x: 8, y: 5 });
    trim(d, s, l.id, { x: 6, y: 0 });
    expect(s.constraints[k.id]).toBeUndefined();
    const holder = s.curves[s.constraints[on.id].refs[1]] as Line;
    expect(holder.id).not.toBe(l.id);
    expect(holder.id).not.toBe(b.id);
  });
  it('splits an arc into arcs sharing a centre and radius', () => {
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: -5, y: 0 });
    addLine(d, s, { x: 2, y: 0 }, { x: 2, y: 10 });
    addLine(d, s, { x: -2, y: 0 }, { x: -2, y: 10 });
    const r = trim(d, s, a.id, { x: 0, y: 5 });
    const other = s.curves[r.created.find((id) => s.curves[id])!] as Arc;
    expect(other.type).toBe('arc');
    expect(types('equal')[0].refs).toEqual([a.id, other.id]);
    expect(types('coincident').some((k) => k.refs.includes((s.curves[a.id] as Arc).c) && k.refs.includes(other.c))).toBe(true);
    expect(curveLength(s, s.curves[a.id])).toBeCloseTo(5 * Math.acos(2 / 5), 6);
    expect(curveLength(s, other)).toBeCloseTo(5 * Math.acos(2 / 5), 6);
  });
  it('turns an ellipse into an elliptical arc', () => {
    const e = addEllipse(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 });
    addLine(d, s, { x: 0, y: -10 }, { x: 0, y: 10 });
    trim(d, s, e.id, { x: 5, y: 0 });
    const arc = s.curves[e.id] as EllipticalArc;
    expect(arc.type).toBe('ellipticalArc');
    expect(evaluate(s, arc, 0.5).x).toBeCloseTo(-5);
    expect(evaluate(s, arc, 0).y).toBeCloseTo(arc.a ? pos(arc.a).y : 0);
  });
  it('trims the elliptical arc again', () => {
    const e = addEllipse(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 });
    addLine(d, s, { x: 0, y: -10 }, { x: 0, y: 10 });
    addLine(d, s, { x: -10, y: 0 }, { x: 10, y: 0 });
    trim(d, s, e.id, { x: 5 * Math.SQRT1_2, y: 3 * Math.SQRT1_2 });
    trim(d, s, e.id, { x: -5 * Math.SQRT1_2, y: 3 * Math.SQRT1_2 });
    const arc = s.curves[e.id] as EllipticalArc;
    expect(arc.type).toBe('ellipticalArc');
    expect(evaluate(s, arc, 0.5).y).toBeCloseTo(-3, 3);
  });
  it('splits a fit spline into two refit pieces close to the original', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: -6 }, { x: 30, y: 5 }, { x: 40, y: 0 }];
    const f = addFitSpline(d, s, pts);
    const pc = resolve(s, f);
    const samples = Array.from({ length: 401 }, (_, i) => pc.at(i / 400));
    addLine(d, s, { x: 15, y: -20 }, { x: 15, y: 20 });
    addLine(d, s, { x: 25, y: -20 }, { x: 25, y: 20 });
    const r = trim(d, s, f.id, { x: 20, y: -6 });
    const other = s.curves[r.created.find((id) => s.curves[id])!] as FitSpline;
    expect(other.type).toBe('fitSpline');
    const a = s.curves[f.id] as FitSpline;
    expect(pos(a.pts[a.pts.length - 1]).x).toBeCloseTo(15);
    expect(pos(other.pts[0]).x).toBeCloseTo(25);
    expect(pos(other.pts[other.pts.length - 1]).x).toBeCloseTo(40);
    for (const curve of [a, other]) {
      const piece = resolve(s, curve);
      for (let i = 0; i <= 50; i++) {
        const q = piece.at(i / 50);
        const nearest = Math.min(...samples.map((m) => dist(m, q)));
        expect(nearest).toBeLessThan(0.45);
      }
    }
  });
  it('opens a closed fit spline at two cuts', () => {
    const f = addFitSpline(d, s, [{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }, { x: 0, y: -10 }], true);
    addLine(d, s, { x: -20, y: 0 }, { x: 20, y: 0 });
    trim(d, s, f.id, { x: 0, y: 10 });
    const a = s.curves[f.id] as FitSpline;
    expect(a.closed).toBe(false);
    expect(evaluate(s, a, 0.5).y).toBeLessThan(-5);
  });
  it('trims a control spline and a conic', () => {
    const c = addControlSpline(d, s, [{ x: 0, y: 0 }, { x: 5, y: 8 }, { x: 10, y: 8 }, { x: 15, y: 0 }, { x: 20, y: 0 }, { x: 25, y: 5 }]);
    addLine(d, s, { x: 12, y: -20 }, { x: 12, y: 20 });
    trim(d, s, c.id, { x: 22, y: 1 });
    const cc = s.curves[c.id] as ControlSpline;
    expect(pos(cc.pts[cc.pts.length - 1]).x).toBeCloseTo(12, 4);
    const con = addConic(d, s, { x: 100, y: 0 }, { x: 120, y: 0 }, { x: 110, y: 20 }, 0.5);
    addLine(d, s, { x: 90, y: 8 }, { x: 130, y: 8 });
    trim(d, s, con.id, { x: 110, y: 10 });
    const r = Object.values(s.curves).filter((x) => x.type === 'conic');
    expect(r.length).toBe(2);
    const parts = r.map((x) => curveLength(s, x)).sort();
    expect(parts[0]).toBeCloseTo(parts[1], 6);
  });
  it('previews without changing the sketch', () => {
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const l = addLine(d, s, { x: 5, y: -5 }, { x: 5, y: 5 });
    const before = JSON.stringify(s);
    const id = d.nextId;
    const p = preview(d, s, (dd, ss) => trim(dd, ss, l.id, { x: 5, y: 3 }));
    expect(p.result.changed).toContain(l.id);
    expect(JSON.stringify(s)).toBe(before);
    expect(d.nextId).toBe(id);
  });
  it('trims several curves dragged across', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 0, y: 2 }, { x: 10, y: 2 });
    addLine(d, s, { x: 5, y: -5 }, { x: 5, y: 5 });
    trimMany(d, s, [{ curve: a.id, at: { x: 8, y: 0 } }, { curve: b.id, at: { x: 8, y: 2 } }]);
    expect(pos((s.curves[a.id] as Line).b).x).toBeCloseTo(5);
    expect(pos((s.curves[b.id] as Line).b).x).toBeCloseTo(5);
  });
});

describe('projected geometry is locked', () => {
  it('refuses trim, break, extend, fillet and chamfer', () => {
    const p = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    p.projected = { origin: 'x' };
    const l = addLine(d, s, { x: 5, y: -5 }, { x: 5, y: 5 });
    const far = addLine(d, s, { x: 20, y: -5 }, { x: 20, y: 5 });
    const before = JSON.stringify(s);
    trim(d, s, p.id, { x: 8, y: 0 });
    breakCurve(d, s, p.id, { x: 8, y: 0 });
    extend(d, s, p.id, { x: 9, y: 0 });
    fillet(d, s, p.id, l.id, 1, { x: 1, y: 0 }, { x: 5, y: 4 });
    chamfer(d, s, p.id, far.id, 'equal', 1);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('extend', () => {
  it('does nothing without a target', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    addLine(d, s, { x: 0, y: 5 }, { x: 10, y: 5 });
    const before = JSON.stringify(s);
    expect(extendTarget(s, l.id, { x: 9, y: 0 })).toBeNull();
    const r = extend(d, s, l.id, { x: 9, y: 0 });
    expect(r).toEqual({ created: [], changed: [], removed: [] });
    expect(JSON.stringify(s)).toBe(before);
  });
  it('extends a line to the next curve from the end nearest the pick', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const near1 = addLine(d, s, { x: 15, y: -5 }, { x: 15, y: 5 });
    addLine(d, s, { x: 20, y: -5 }, { x: 20, y: 5 });
    addLine(d, s, { x: -7, y: -5 }, { x: -7, y: 5 });
    extend(d, s, l.id, { x: 9, y: 0 });
    near(pos((s.curves[l.id] as Line).b), 15, 0);
    expect(types('coincident')[0].refs).toContain(near1.id);
    extend(d, s, l.id, { x: 1, y: 0 });
    near(pos((s.curves[l.id] as Line).a), -7, 0);
  });
  it('extends to a circle and ignores what is behind', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 2, y: 0 });
    addCircle(d, s, { x: 10, y: 0 }, 3);
    extend(d, s, l.id, { x: 1.5, y: 0 });
    near(pos((s.curves[l.id] as Line).b), 7, 0);
  });
  it('extends an arc around its circle in the right direction', () => {
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 });
    addLine(d, s, { x: -10, y: 2 }, { x: -2, y: 2 });
    extend(d, s, a.id, { x: 0.2, y: 5 });
    const arc = s.curves[a.id] as Arc;
    near(pos(arc.b), -Math.sqrt(21), 2);
    addLine(d, s, { x: 3, y: -10 }, { x: 3, y: -2 });
    extend(d, s, a.id, { x: 5, y: 0.2 });
    near(pos((s.curves[a.id] as Arc).a), 3, -4);
  });
  it('extends a fit spline along its end tangent', () => {
    const f = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 10, y: 0 }]);
    addLine(d, s, { x: 15, y: -20 }, { x: 15, y: 20 });
    extend(d, s, f.id, { x: 9, y: 0 });
    const c = s.curves[f.id] as FitSpline;
    expect(c.pts.length).toBe(4);
    expect(pos(c.pts[3]).x).toBeCloseTo(15);
  });
});

describe('break', () => {
  it('splits into three at surrounding intersections, all joined', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 12, y: 0 });
    const a = addLine(d, s, { x: 4, y: -5 }, { x: 4, y: 5 });
    const b = addLine(d, s, { x: 8, y: -5 }, { x: 8, y: 5 });
    expect(breakPreview(s, l.id, { x: 6, y: 0 })?.pts.map((p) => p.x)).toEqual([4, 8]);
    const r = breakCurve(d, s, l.id, { x: 6, y: 0 });
    const parts = [l.id, ...r.created.filter((id) => s.curves[id])];
    expect(parts.length).toBe(3);
    const total = parts.reduce((t, id) => t + curveLength(s, s.curves[id]), 0);
    expect(total).toBeCloseTo(12);
    expect(types('collinear').length).toBe(2);
    const k = types('coincident');
    expect(k.some((x) => x.refs.includes(a.id))).toBe(true);
    expect(k.some((x) => x.refs.includes(b.id))).toBe(true);
    expect(k.length).toBe(4);
  });
  it('is a no-op without intersections', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 12, y: 0 });
    const before = JSON.stringify(s);
    breakCurve(d, s, l.id, { x: 6, y: 0 });
    expect(JSON.stringify(s)).toBe(before);
  });
  it('breaks a circle into two arcs', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    addLine(d, s, { x: -10, y: 0 }, { x: 10, y: 0 });
    const r = breakCurve(d, s, c.id, { x: 0, y: 5 });
    const other = s.curves[r.created.find((id) => s.curves[id])!] as Arc;
    expect(s.curves[c.id].type).toBe('arc');
    expect(other.type).toBe('arc');
    expect(curveLength(s, s.curves[c.id]) + curveLength(s, other)).toBeCloseTo(Math.PI * 10);
    expect(types('equal').length).toBe(1);
  });
});

describe('fillet', () => {
  const corner = () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 10, y: 0 }, { x: 10, y: 10 });
    const k = addConstraint(d, s, 'coincident', [a.b, b.a]);
    return { a, b, k };
  };
  it('rounds a right-angle corner', () => {
    const { a, b, k } = corner();
    expect(filletPreview(s, a.id, b.id, 2, { x: 2, y: 0 }, { x: 10, y: 8 })?.center).toEqual({ x: 8, y: 2 });
    const r = fillet(d, s, a.id, b.id, 2, { x: 2, y: 0 }, { x: 10, y: 8 });
    const arc = s.curves[r.created.find((id) => s.curves[id])!] as Arc;
    expect(s.constraints[k.id]).toBeUndefined();
    near(pos(arc.c), 8, 2);
    near(pos(arc.a), 8, 0);
    near(pos(arc.b), 10, 2);
    near(pos((s.curves[a.id] as Line).b), 8, 0);
    near(pos((s.curves[b.id] as Line).a), 10, 2);
    expect(types('tangent').length).toBe(2);
    expect(types('coincident').length).toBe(2);
    expect(dims('radius')[0].value).toBe(2);
    expect(curveLength(s, arc)).toBeCloseTo(Math.PI);
  });
  it('rounds the vertex variant', () => {
    const { a } = corner();
    filletVertex(d, s, a.b, 3);
    expect(dims('radius').length).toBe(1);
    near(pos((s.curves[a.id] as Line).b), 7, 0);
  });
  it('shares one radius across vertices', () => {
    const bot = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const right = addLine(d, s, { x: 10, y: 0 }, { x: 10, y: 10 });
    const top = addLine(d, s, { x: 10, y: 10 }, { x: 0, y: 10 });
    addConstraint(d, s, 'coincident', [bot.b, right.a]);
    addConstraint(d, s, 'coincident', [right.b, top.a]);
    filletVertices(d, s, [bot.b, right.b], 2);
    expect(dims('radius').length).toBe(1);
    expect(types('equal').length).toBe(1);
    expect(Object.values(s.curves).filter((c) => c.type === 'arc').length).toBe(2);
  });
  it('picks choose the quadrant of crossing lines', () => {
    const a = addLine(d, s, { x: -10, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 0, y: -10 }, { x: 0, y: 10 });
    fillet(d, s, a.id, b.id, 2, { x: 8, y: 0 }, { x: 0, y: -8 });
    near(pos((s.curves[a.id] as Line).a), 2, 0);
    near(pos((s.curves[b.id] as Line).b), 0, -2);
    expect(pos((s.curves[a.id] as Line).b).x).toBe(10);
    const arc = lastArc();
    near(pos(arc.c), 2, -2);
  });
  const lastArc = () => Object.values(s.curves).find((c): c is Arc => c.type === 'arc')!;
  it('reaches an extended intersection', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 8, y: 0 });
    const b = addLine(d, s, { x: 10, y: 2 }, { x: 10, y: 10 });
    fillet(d, s, a.id, b.id, 1, { x: 1, y: 0 }, { x: 10, y: 9 });
    near(pos((s.curves[a.id] as Line).b), 9, 0);
    near(pos((s.curves[b.id] as Line).a), 10, 1);
  });
  it('joins parallel lines with a tangent semicircle at the picked ends', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 0, y: 4 }, { x: 10, y: 4 });
    const p = filletPreview(s, a.id, b.id, 99, { x: 9, y: 0 }, { x: 9, y: 4 });
    expect(p?.radius).toBe(2);
    const r = fillet(d, s, a.id, b.id, 99, { x: 9, y: 0 }, { x: 9, y: 4 });
    const arc = s.curves[r.created.find((id) => s.curves[id])!] as Arc;
    near(pos(arc.c), 10, 2);
    expect(dims('radius')[0].value).toBe(2);
    expect(evaluate(s, arc, 0.5).x).toBeCloseTo(12);
    expect(curveLength(s, arc)).toBeCloseTo(2 * Math.PI);
    expect(types('tangent').length).toBe(2);
  });
  it('bulges the right way at the left end of parallel lines, with unequal lengths', () => {
    const a = addLine(d, s, { x: 2, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 0, y: 4 }, { x: 10, y: 4 });
    const r = fillet(d, s, a.id, b.id, 1, { x: 3, y: 0 }, { x: 1, y: 4 });
    const arc = s.curves[r.created.find((id) => s.curves[id])!] as Arc;
    near(pos(arc.c), 0, 2);
    expect(evaluate(s, arc, 0.5).x).toBeCloseTo(-2);
    near(pos((s.curves[a.id] as Line).a), 0, 0);
  });
  it('finds the corner at a vertex for any line and arc that meet, whichever way round', () => {
    const rad = Math.PI / 180;
    const R = 20;
    for (let th = 0; th < 360; th += 30) {
      for (let ph = 0; ph < 360; ph += 30) {
        for (const sweep of [40, 90, 180, 270]) {
          for (const way of [1, -1]) {
            const leaving = { x: -Math.sin(ph * rad) * way, y: Math.cos(ph * rad) * way };
            const u = { x: Math.cos(th * rad), y: Math.sin(th * rad) };
            const between = Math.acos(Math.min(1, Math.max(-1, u.x * leaving.x + u.y * leaving.y))) / rad;
            if (between < 10 || between > 170) continue; // A tangent join has no corner to round.
            const sk = newSketch(d);
            const c = { x: -R * Math.cos(ph * rad), y: -R * Math.sin(ph * rad) };
            const end = { x: c.x + R * Math.cos((ph + way * sweep) * rad), y: c.y + R * Math.sin((ph + way * sweep) * rad) };
            const l = addLine(d, sk, { x: 0, y: 0 }, { x: u.x * 40, y: u.y * 40 });
            const a = way > 0 ? addArc(d, sk, c, { x: 0, y: 0 }, end) : addArc(d, sk, c, end, { x: 0, y: 0 });
            addConstraint(d, sk, 'coincident', [l.a, way > 0 ? a.a : a.b]);
            const v = curvesAtVertex(sk, l.a)!;
            const g = filletPreview(sk, v.a, v.b, 0.4, v.pickA, v.pickB, { x: 0, y: 0 });
            expect(g, `th ${th} ph ${ph} sweep ${sweep} way ${way}`).not.toBeNull();
            expect(dist(g!.center, { x: 0, y: 0 }), `th ${th} ph ${ph} sweep ${sweep} way ${way}`).toBeLessThan(15);
          }
        }
      }
    }
  });
  it('line to arc stays tangent to both', () => {
    const l = addLine(d, s, { x: -10, y: 0 }, { x: 10, y: 0 });
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 });
    fillet(d, s, l.id, a.id, 1, { x: 9, y: 0 }, { x: 0, y: 5 });
    const f = Object.values(s.curves).filter((c): c is Arc => c.type === 'arc').find((c) => c.id !== a.id)!;
    const c = pos(f.c);
    expect(c.y).toBeCloseTo(1);
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(6);
    expect(dist(pos((s.curves[l.id] as Line).a), { x: c.x, y: 0 })).toBeLessThan(1e-6);
    const arc = s.curves[a.id] as Arc;
    const contact = pos(arc.a);
    expect(Math.hypot(contact.x, contact.y)).toBeCloseTo(5);
    expect(dist(contact, c)).toBeCloseTo(1);
  });
  it('arc to arc', () => {
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 });
    const b = addArc(d, s, { x: 8, y: 0 }, { x: 8, y: 5 }, { x: 3, y: 0 });
    fillet(d, s, a.id, b.id, 1, { x: 0, y: 5 }, { x: 8, y: 5 });
    const f = Object.values(s.curves).filter((c): c is Arc => c.type === 'arc').find((c) => c.id !== a.id && c.id !== b.id)!;
    const c = pos(f.c);
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(6);
    expect(Math.hypot(c.x - 8, c.y)).toBeCloseTo(6);
    expect(c.y).toBeGreaterThan(0);
    expect(types('tangent').length).toBe(2);
  });
  it('keeps a full circle whole and ties the arc to it', () => {
    const l = addLine(d, s, { x: -10, y: 0 }, { x: 10, y: 0 });
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    fillet(d, s, l.id, c.id, 1, { x: -9, y: 0 }, { x: 0, y: 5 });
    expect(s.curves[c.id].type).toBe('circle');
    expect(types('coincident').some((k) => k.refs.includes(c.id))).toBe(true);
  });
});

describe('chamfer', () => {
  it('bevels a vertex with an equal distance referencing the first dimension', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 10, y: 0 }, { x: 10, y: 10 });
    const k = addConstraint(d, s, 'coincident', [a.b, b.a]);
    const r = chamfer(d, s, a.id, b.id, 'equal', 2);
    expect(s.constraints[k.id]).toBeUndefined();
    near(pos((s.curves[a.id] as Line).b), 8, 0);
    near(pos((s.curves[b.id] as Line).a), 10, 2);
    const ds = dims('distance');
    expect(ds.length).toBe(2);
    expect(ds[1].expression).toBe(ds[0].name);
    expect(ds[0].value).toBe(2);
    expect(ds[1].value).toBe(2);
    const edge = s.curves[r.created.find((id) => s.curves[id])!] as Line;
    expect(curveLength(s, edge)).toBeCloseTo(2 * Math.SQRT2);
  });
  it('uses the extended intersection of lines that do not reach each other', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 8, y: 0 });
    const b = addLine(d, s, { x: 10, y: 5 }, { x: 10, y: 10 });
    expect(chamferPreview(s, a.id, b.id, 'twoDistance', 3, 1)?.corner.x).toBeCloseTo(10);
    chamfer(d, s, a.id, b.id, 'twoDistance', 3, 1);
    near(pos((s.curves[a.id] as Line).b), 7, 0);
    near(pos((s.curves[b.id] as Line).a), 10, 1);
    const ds = dims('distance');
    expect(ds.map((x) => x.value)).toEqual([3, 1]);
    expect(ds[1].expression).toBe('1 mm');
    const corner = Object.values(s.points).filter((p) => dist(p, { x: 10, y: 0 }) < 1e-6);
    expect(corner.length).toBe(1);
    expect(types('coincident').filter((x) => x.refs.includes(corner[0].id)).length).toBe(2);
  });
  it('distance and angle gives the right triangle', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 10, y: 0 }, { x: 10, y: 10 });
    chamfer(d, s, a.id, b.id, 'distanceAngle', 3, Math.PI / 6);
    near(pos((s.curves[a.id] as Line).b), 7, 0);
    near(pos((s.curves[b.id] as Line).a), 10, 3 * Math.tan(Math.PI / 6));
    const angle = dims('angle')[0];
    expect(angle.value).toBeCloseTo(Math.PI / 6);
  });
  it('deleting the chamfer line removes its corner helper and dimensions', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 10, y: 0 }, { x: 10, y: 10 });
    const r = chamfer(d, s, a.id, b.id, 'equal', 2);
    const edge = r.created.find((id) => s.curves[id])!;
    deleteEntities(s, [edge]);
    expect(dims().length).toBe(0);
    expect(Object.keys(s.points).length).toBe(4);
  });
});

describe('scale', () => {
  it('scales about a base and carries dimensions', () => {
    const c = addCircle(d, s, { x: 10, y: 0 }, 2);
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const m = addDimension(d, s, 'distance', [l.a, l.b], 10);
    const r = addDimension(d, s, 'radius', [c.id], 2);
    const e = addDimension(d, s, 'distance', [l.a, l.b], 10, { expression: 'd1 + 0' });
    scaleGeometry(s, [c.id, l.id], { x: 0, y: 0 }, 2);
    expect((s.curves[c.id] as Circle).r).toBe(4);
    near(pos((s.curves[c.id] as Circle).c), 20, 0);
    expect(m.value).toBe(20);
    expect(m.expression).toBe('20 mm');
    expect(r.value).toBe(4);
    expect(e.expression).toBe('(d1 + 0) * 2');
  });
});

describe('moveCopy', () => {
  it('moves and severs ties to what stays behind', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 10, y: 0 }, { x: 10, y: 10 });
    const k = addConstraint(d, s, 'coincident', [a.b, b.a]);
    const h = addConstraint(d, s, 'horizontal', [a.id]);
    const o = addConstraint(d, s, 'coincident', [a.a, ORIGIN]);
    moveCopy(d, s, [a.id], { dx: 1, dy: 2 });
    near(pos((s.curves[a.id] as Line).a), 1, 2);
    expect(s.constraints[k.id]).toBeUndefined();
    expect(s.constraints[o.id]).toBeUndefined();
    expect(s.constraints[h.id]).toBeDefined();
  });
  it('rotates and drops a horizontal that no longer holds', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const h = addConstraint(d, s, 'horizontal', [a.id]);
    moveCopy(d, s, [a.id], { angle: Math.PI / 2 });
    near(pos((s.curves[a.id] as Line).b), 0, 10);
    expect(s.constraints[h.id]).toBeUndefined();
  });
  it('copies with internal constraints and a live preview', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    addConstraint(d, s, 'horizontal', [a.id]);
    addDimension(d, s, 'distance', [a.a, a.b], 10);
    expect(moveCopyPreview(s, [a.id], { dy: 3 })[0][0]).toEqual({ x: 0, y: 3 });
    const r = moveCopy(d, s, [a.id], { dy: 3, copy: true });
    expect(pos((s.curves[a.id] as Line).a).y).toBe(0);
    const copy = lines().find((l) => l.id !== a.id)!;
    expect(r.created).toContain(copy.id);
    near(pos(copy.a), 0, 3);
    expect(types('horizontal').length).toBe(2);
    expect(dims().map((m) => m.name)).toEqual(['d1', 'd2']);
  });
});

describe('mirror', () => {
  it('keeps arcs counter-clockwise by swapping ends', () => {
    const a = addArc(d, s, { x: 5, y: 0 }, { x: 8, y: 0 }, { x: 5, y: 3 });
    const before = curveLength(s, a);
    const r = mirror(d, s, [a.id], AXIS_Y);
    const copy = s.curves[r.created.find((id) => s.curves[id])!] as Arc;
    expect(copy.type).toBe('arc');
    near(pos(copy.c), -5, 0);
    near(pos(copy.a), -5, 3);
    near(pos(copy.b), -8, 0);
    expect(curveLength(s, copy)).toBeCloseTo(before);
    expect(evaluate(s, copy, 0.5).x).toBeCloseTo(-5 - 3 * Math.SQRT1_2);
    expect(evaluate(s, copy, 0.5).y).toBeCloseTo(3 * Math.SQRT1_2);
    expect(types('symmetric').length).toBe(3);
  });
  it('mirrors across a sketch line at an angle', () => {
    const axis = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 10 });
    const l = addLine(d, s, { x: 5, y: 0 }, { x: 8, y: 0 });
    expect(mirrorPreview(s, [l.id], axis.id)?.[0][0].y).toBeCloseTo(5);
    const r = mirror(d, s, [l.id], axis.id);
    const copy = s.curves[r.created.find((id) => s.curves[id])!] as Line;
    near(pos(copy.a), 0, 5);
    near(pos(copy.b), 0, 8);
    expect(types('symmetric').every((k) => k.refs[2] === axis.id)).toBe(true);
  });
  it('joins points on the axis instead of doubling them', () => {
    const l = addLine(d, s, { x: 0, y: 2 }, { x: 5, y: 2 });
    const r = mirror(d, s, [l.id], AXIS_Y);
    const copy = s.curves[r.created.find((id) => s.curves[id])!] as Line;
    expect(types('coincident').some((k) => k.refs.includes(l.a) && k.refs.includes(copy.a))).toBe(true);
    expect(types('coincident').some((k) => k.refs.includes(l.a) && k.refs.includes(AXIS_Y))).toBe(true);
    expect(types('symmetric').length).toBe(1);
  });
  it('uses one symmetric per coincident group and keeps the coincidence on the copy', () => {
    const a = addLine(d, s, { x: 2, y: 0 }, { x: 5, y: 0 });
    const b = addLine(d, s, { x: 5, y: 0 }, { x: 5, y: 5 });
    addConstraint(d, s, 'coincident', [a.b, b.a]);
    mirror(d, s, [a.id, b.id], AXIS_Y);
    expect(types('symmetric').length).toBe(3);
    expect(types('coincident').length).toBe(2);
  });
  it('mirrors circles with an equal, and refuses a curved axis', () => {
    const c = addCircle(d, s, { x: 5, y: 5 }, 2);
    const curved = addCircle(d, s, { x: 50, y: 0 }, 2);
    expect(mirror(d, s, [c.id], curved.id).created).toEqual([]);
    expect(mirrorPreview(s, [c.id], curved.id)).toBeNull();
    mirror(d, s, [c.id], AXIS_X);
    expect(types('equal').length).toBe(1);
    const feature = Object.values(s.features)[0];
    expect(feature.type).toBe('mirror');
  });
  it('stays CCW on a mirrored elliptical arc', () => {
    const e = addEllipse(d, s, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 });
    addLine(d, s, { x: 5, y: -10 }, { x: 5, y: 10 });
    trim(d, s, e.id, { x: 10, y: 0 });
    const r = mirror(d, s, [e.id], AXIS_Y);
    const copy = s.curves[r.created.find((id) => s.curves[id])!] as EllipticalArc;
    expect(copy.type).toBe('ellipticalArc');
    expect(evaluate(s, copy, 0.5).x).toBeCloseTo(0);
  });
});

describe('patterns', () => {
  it('rectangular extent, spacing and two directions', () => {
    const base = { sources: ['x'], dirs: [{ x: 1, y: 0 }, null] as [Vec2, Vec2 | null], distanceType: 'extent' as const, quantity: [3, 1] as [number, number], distance: [20, 0] as [number, number], direction: ['one', 'one'] as ['one', 'one'] };
    expect(rectPatternSlots(base).map((p) => p.dx)).toEqual([10, 20]);
    expect(rectPatternSlots({ ...base, distanceType: 'spacing' }).map((p) => p.dx)).toEqual([20, 40]);
    expect(rectPatternSlots({ ...base, dirs: [{ x: 1, y: 0 }, { x: 0, y: 1 }], quantity: [2, 2], distance: [10, 5] }).length).toBe(3);
    expect(rectPatternSlots({ ...base, direction: ['symmetric', 'one'] }).map((p) => p.dx)).toEqual([-20, -10, 10, 20]);
  });
  it('circular spacing modes', () => {
    const base = { sources: [], center: ORIGIN, spacing: 'full' as const, angle: 0, quantity: 6 };
    expect(circPatternSlots(base).length).toBe(5);
    expect(circPatternSlots(base)[0].angle).toBeCloseTo(Math.PI / 3);
    expect(circPatternSlots({ ...base, spacing: 'angle', angle: Math.PI, quantity: 3 }).map((p) => p.angle)).toEqual([Math.PI / 2, Math.PI]);
    expect(circPatternSlots({ ...base, spacing: 'symmetric', angle: Math.PI, quantity: 3 }).map((p) => p.angle)).toEqual([-Math.PI / 2, Math.PI / 2]);
  });
  it('creates instances tied per point and regenerates by feature', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 2, y: 0 });
    const { feature } = rectPattern(d, s, {
      sources: [l.id], dirs: [{ x: 1, y: 0 }, null], distanceType: 'spacing', quantity: [3, 1], distance: [5, 0], direction: ['one', 'one'],
    });
    expect(lines().length).toBe(3);
    const ties = types('offsetCopy');
    expect(ties.length).toBe(4);
    expect(ties.every((k) => k.feature === feature)).toBe(true);
    const f = s.features[feature];
    if (f.type !== 'rectPattern') throw new Error('wrong type');
    const kept = f.instances['1,0'][0];
    updatePattern(d, s, feature, { distance: [7, 0] });
    expect(f.instances['1,0'][0]).toBe(kept);
    near(pos((s.curves[kept] as Line).a), 7, 0);
    expect(types('offsetCopy').find((k) => k.refs[1] === (s.curves[kept] as Line).a)?.dx).toBe(7);
    updatePattern(d, s, feature, { quantity: [2, 1] });
    expect(lines().length).toBe(2);
    expect(types('offsetCopy').length).toBe(2);
    updatePattern(d, s, feature, { quantity: [4, 1] });
    expect(lines().length).toBe(4);
  });
  it('suppresses and restores an instance', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 2, y: 0 });
    const { feature } = rectPattern(d, s, {
      sources: [l.id], dirs: [{ x: 1, y: 0 }, null], distanceType: 'spacing', quantity: [3, 1], distance: [5, 0], direction: ['one', 'one'],
    });
    setInstanceSuppressed(d, s, feature, '1,0', true);
    expect(lines().length).toBe(2);
    setInstanceSuppressed(d, s, feature, '1,0', false);
    expect(lines().length).toBe(3);
    expect(patternPreview(s, { ...(s.features[feature] as Extract<typeof s.features[string], { type: 'rectPattern' }>) }).length).toBe(2);
  });
  it('circular pattern of a circle: six gear teeth', () => {
    const c = addCircle(d, s, { x: 25.4, y: 0 }, 2);
    const { feature } = circPattern(d, s, { sources: [c.id], center: ORIGIN, spacing: 'full', angle: 0, quantity: 6 });
    const circles = Object.values(s.curves).filter((x): x is Circle => x.type === 'circle');
    expect(circles.length).toBe(6);
    expect(types('rotatedCopy').length).toBe(5);
    expect(types('rotatedCopy')[0].refs[0]).toBe(ORIGIN);
    expect(types('equal').every((k) => k.feature === feature)).toBe(true);
    for (const x of circles) expect(Math.hypot(pos(x.c).x, pos(x.c).y)).toBeCloseTo(25.4);
    updatePattern(d, s, feature, { spacing: 'angle', angle: Math.PI, quantity: 3 });
    const after = Object.values(s.curves).filter((x): x is Circle => x.type === 'circle');
    expect(after.length).toBe(3);
    expect(after.some((x) => Math.abs(pos(x.c).x + 25.4) < 1e-6)).toBe(true);
  });
  it('pattern arcs stay valid under rotation', () => {
    const a = addArc(d, s, { x: 10, y: 0 }, { x: 12, y: 0 }, { x: 10, y: 2 });
    const before = curveLength(s, a);
    circPattern(d, s, { sources: [a.id], center: ORIGIN, spacing: 'full', angle: 0, quantity: 4 });
    for (const c of Object.values(s.curves)) expect(curveLength(s, c)).toBeCloseTo(before);
  });
  it('deleting the feature leaves geometry and removes hidden constraints', () => {
    const c = addCircle(d, s, { x: 5, y: 0 }, 1);
    const { feature } = circPattern(d, s, { sources: [c.id], center: ORIGIN, spacing: 'full', angle: 0, quantity: 3 });
    deleteEntities(s, [feature]);
    expect(Object.keys(s.curves).length).toBe(3);
    expect(Object.keys(s.constraints).length).toBe(0);
  });
});

describe('blend', () => {
  const pair = () => ({
    a: addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }),
    b: addLine(d, s, { x: 20, y: 5 }, { x: 30, y: 5 }),
  });
  it('G1 matches tangents and joins ends', () => {
    const { a, b } = pair();
    const r = blend(d, s, a.id, 1, b.id, 0, 'G1');
    const c = s.curves[r.created[0]] as ControlSpline;
    expect(c.degree).toBe(3);
    expect(c.pts.length).toBe(4);
    const t0 = tangent(s, c, 0);
    expect(t0.x).toBeCloseTo(1);
    expect(t0.y).toBeCloseTo(0);
    const t1 = tangent(s, c, 1);
    expect(t1.x).toBeCloseTo(1);
    near(evaluate(s, c, 1), 20, 5);
    expect(types('tangent').length).toBe(2);
    expect(types('coincident').length).toBe(2);
  });
  it('G2 matches curvature at both ends', () => {
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 });
    const b = addArc(d, s, { x: -20, y: 5 }, { x: -20, y: 2 }, { x: -17, y: 5 });
    const r = blend(d, s, a.id, 1, b.id, 1, 'G2');
    const c = s.curves[r.created[0]] as ControlSpline;
    expect(c.degree).toBe(5);
    expect(c.pts.length).toBe(6);
    const pc = resolve(s, c);
    const pa = resolve(s, a);
    const pb = reversed(resolve(s, b));
    expect(curvatureAt(pc, 0)).toBeCloseTo(curvatureAt(pa, 1), 6);
    expect(curvatureAt(pc, 1)).toBeCloseTo(curvatureAt(pb, 0), 6);
    expect(types('curvature').length).toBe(2);
  });
  it('previews a b-spline', () => {
    const { a, b } = pair();
    expect(blendPreview(s, a.id, 1, b.id, 0, 'G2')?.degree).toBe(5);
    expect(Object.keys(s.curves).length).toBe(2);
  });
});

describe('spline edits', () => {
  it('changes degree and keeps ends', () => {
    const c = addControlSpline(d, s, [{ x: 0, y: 0 }, { x: 2, y: 5 }, { x: 6, y: 6 }, { x: 9, y: 1 }, { x: 12, y: 3 }, { x: 15, y: 0 }], 5);
    changeSplineDegree(d, s, c.id, 3);
    expect((s.curves[c.id] as ControlSpline).pts.length).toBe(4);
    near(evaluate(s, s.curves[c.id], 1), 15, 0);
    changeSplineDegree(d, s, c.id, 5);
    expect((s.curves[c.id] as ControlSpline).pts.length).toBe(6);
  });
  it('inserts a fit point on the curve', () => {
    const f = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: 0 }]);
    const before = evaluate(s, f, 0.3);
    const id = insertSplinePoint(d, s, f.id, 0.3)!;
    const c = s.curves[f.id] as FitSpline;
    expect(c.pts.length).toBe(4);
    expect(c.pts[1]).toBe(id);
    near(pos(id), before.x, before.y);
  });
  it('inserts a control point', () => {
    const c = addControlSpline(d, s, [{ x: 0, y: 0 }, { x: 2, y: 5 }, { x: 6, y: 6 }, { x: 9, y: 1 }], 3);
    expect(insertSplinePoint(d, s, c.id, 0.5)).not.toBeNull();
    expect((s.curves[c.id] as ControlSpline).pts.length).toBe(5);
  });
});
