import { beforeEach, describe, expect, it } from 'vitest';
import type { Arc, Circle, Curve, Design, Ellipse, Feature, FitSpline, Id as PointId, Line, Sketch, Vec2 } from '../model/types';
import {
  addArc, addCircle, addConstraint, addControlSpline, addEllipse, addFitSpline, addLine, deleteEntities, getPointPos, newDesign, newSketch,
} from '../model/document';
import { closestPoint, curveLength, flatten, resolve } from './curves';
import {
  addOffsetDimension, computeOffset, derivedDamage, ellipseOffsetMode, offsetCurves, offsetSideFromPick, orderChains, regenerateDerived,
} from './offset';
import { findProfiles } from './profiles';
import { dist } from './vec';

let d: Design;
let s: Sketch;
beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

const rect = (x0: number, y0: number, x1: number, y1: number): Id[] => {
  const pts: Vec2[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const ls = pts.map((p, i) => addLine(d, s, p, pts[(i + 1) % 4]));
  ls.forEach((l, i) => addConstraint(d, s, 'coincident', [l.b, ls[(i + 1) % 4].a]));
  return ls.map((l) => l.id);
};
type Id = string;

describe('chains', () => {
  it('orders shuffled curves and detects closure', () => {
    const ids = rect(0, 0, 10, 5);
    const chains = orderChains(s, [ids[2], ids[0], ids[3], ids[1]]);
    expect(chains.length).toBe(1);
    expect(chains[0].closed).toBe(true);
    expect(chains[0].links.length).toBe(4);
  });
  it('runs an open chain from its free end, flipping reversed links', () => {
    const a = addLine(d, s, { x: 10, y: 0 }, { x: 0, y: 0 });
    const b = addLine(d, s, { x: 10, y: 0 }, { x: 10, y: 10 });
    const chains = orderChains(s, [b.id, a.id]);
    expect(chains[0].closed).toBe(false);
    const l = chains[0].links;
    expect(dist(l[0].pc.at(1), l[1].pc.at(0))).toBeLessThan(1e-9);
  });
});

describe('computeOffset', () => {
  it('offsets a degree 1 spline leg by leg, each leg the distance from its own', () => {
    const c = addControlSpline(d, s, [{ x: -40, y: 0 }, { x: -10, y: 30 }, { x: 20, y: -10 }, { x: 50, y: 20 }], 1);
    const out = computeOffset(s, [c.id], 5, 1);
    expect(out.map((g) => g.type)).toEqual(['line', 'line', 'line']);
    const legs: [Vec2, Vec2][] = [[{ x: -40, y: 0 }, { x: -10, y: 30 }], [{ x: -10, y: 30 }, { x: 20, y: -10 }], [{ x: 20, y: -10 }, { x: 50, y: 20 }]];
    out.forEach((g, i) => {
      if (g.type !== 'line') throw new Error('a line');
      const [p, q] = legs[i];
      const u = { x: (q.x - p.x) / dist(p, q), y: (q.y - p.y) / dist(p, q) };
      expect(Math.abs((g.a.x - p.x) * u.y - (g.a.y - p.y) * u.x)).toBeCloseTo(5, 6);
      expect(Math.abs((g.b.x - p.x) * u.y - (g.b.y - p.y) * u.x)).toBeCloseTo(5, 6);
    });
  });

  it('offsets a single line to the left of its direction', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(computeOffset(s, [l.id], 2, 1)).toEqual([{ type: 'line', a: { x: 0, y: 2 }, b: { x: 10, y: 2 } }]);
    expect(computeOffset(s, [l.id], 2, -1)[0]).toMatchObject({ type: 'line', a: { x: 0, y: -2 } });
  });
  it('mitres a rectangle inward and outward', () => {
    const ids = rect(0, 0, 10, 6);
    const inward = computeOffset(s, ids, 1, 1);
    expect(inward.length).toBe(4);
    const first = inward[0] as { a: Vec2; b: Vec2 };
    expect(first.a.x).toBeCloseTo(1);
    expect(first.b.x).toBeCloseTo(9);
    const outward = computeOffset(s, ids, 1, -1);
    const o = outward[0] as { a: Vec2; b: Vec2 };
    expect(o.a.x).toBeCloseTo(-1);
    expect(o.a.y).toBeCloseTo(-1);
    expect(o.b.x).toBeCloseTo(11);
  });
  it('collapses to nothing when the inward offset passes the middle', () => {
    expect(computeOffset(s, rect(0, 0, 10, 4), 3, 1)).toEqual([]);
  });
  it('keeps an open chain free ends square', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 10, y: 0 }, { x: 10, y: 10 });
    const out = computeOffset(s, [a.id, b.id], 1, 1) as { type: 'line'; a: Vec2; b: Vec2 }[];
    expect(out[0].a).toMatchObject({ x: 0, y: 1 });
    expect(out[0].b.x).toBeCloseTo(9);
    expect(out[1].a.y).toBeCloseTo(1);
    expect(out[1].b).toMatchObject({ x: 9, y: 10 });
  });
  it('drops a short middle segment and rejoins its neighbours', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 10, y: 0 }, { x: 11, y: 1 });
    const c = addLine(d, s, { x: 11, y: 1 }, { x: 11, y: 11 });
    const out = computeOffset(s, [a.id, b.id, c.id], 2, 1) as { a: Vec2; b: Vec2 }[];
    expect(out.length).toBe(2);
    expect(out[0].a).toMatchObject({ x: 0, y: 2 });
    expect(out[0].b.x).toBeCloseTo(9);
    expect(out[0].b.y).toBeCloseTo(2);
    expect(out[1].b).toMatchObject({ x: 9, y: 11 });
  });
  it('offsets circles and arcs concentrically, and a circle can collapse', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    expect(computeOffset(s, [c.id], 2, 1)[0]).toMatchObject({ type: 'circle', r: 3 });
    expect(computeOffset(s, [c.id], 2, -1)[0]).toMatchObject({ type: 'circle', r: 7 });
    expect(computeOffset(s, [c.id], 6, 1)).toEqual([]);
    const a = addArc(d, s, { x: 20, y: 0 }, { x: 25, y: 0 }, { x: 20, y: 5 });
    const out = computeOffset(s, [a.id], 1, 1)[0];
    expect(out.type).toBe('arc');
    if (out.type === 'arc') {
      expect(dist(out.c, { x: 20, y: 0 })).toBe(0);
      expect(out.a.x).toBeCloseTo(24);
      expect(out.b.y).toBeCloseTo(4);
    }
  });
  it('keeps tangent line-arc-line chains as a slot', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const c = addArc(d, s, { x: 10, y: 2 }, { x: 10, y: 0 }, { x: 10, y: 4 });
    const b = addLine(d, s, { x: 10, y: 4 }, { x: 0, y: 4 });
    const e = addArc(d, s, { x: 0, y: 2 }, { x: 0, y: 4 }, { x: 0, y: 0 });
    const out = computeOffset(s, [a.id, c.id, b.id, e.id], 1, -1);
    expect(out.map((g) => g.type)).toEqual(['line', 'arc', 'line', 'arc']);
    const arc = out[1] as { c: Vec2; a: Vec2; b: Vec2 };
    expect(dist(arc.c, arc.a)).toBeCloseTo(3);
  });
  it('mitres a line into an arc at a sharp join', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const a = addArc(d, s, { x: 15, y: 0 }, { x: 15, y: 5 }, { x: 10, y: 0 });
    const out = computeOffset(s, [l.id, a.id], 1, -1);
    const first = out[0] as { a: Vec2; b: Vec2 };
    expect(first.b.y).toBeCloseTo(-1);
    const second = out[1] as { c: Vec2; a: Vec2; b: Vec2 };
    expect(dist(second.c, first.b)).toBeCloseTo(dist(second.c, second.a));
  });
  it('offsets an ellipse as an ellipse near an axis, exact only at the axes', () => {
    const e = addEllipse(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 });
    expect(ellipseOffsetMode(s, e.id, { x: 10, y: 0.2 })).toBe('ellipse');
    expect(ellipseOffsetMode(s, e.id, { x: 7, y: 3.5 })).toBe('oval');
    const g = computeOffset(s, [e.id], 2, -1, { ellipse: 'ellipse' })[0];
    expect(g.type).toBe('ellipse');
    if (g.type === 'ellipse') {
      expect(g.major.x).toBeCloseTo(12);
      expect(g.minor.y).toBeCloseTo(7);
    }
  });
  it('offsets an ellipse as an oval spline at constant distance', () => {
    const e = addEllipse(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 });
    const { result } = offsetCurves(d, s, [e.id], 2, { side: -1, ellipse: 'oval' });
    const out = s.curves[result.created[0]] as FitSpline;
    expect(out.type).toBe('fitSpline');
    expect(out.closed).toBe(true);
    for (const p of flatten(s, out, 0.05)) expect(Math.abs(closestPoint(s, e, p).dist - 2)).toBeLessThan(0.08);
  });
  it('refits splines, conics and control splines near the true offset', () => {
    const f = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: -3 }, { x: 30, y: 2 }]);
    const c = addControlSpline(d, s, [{ x: 0, y: 30 }, { x: 5, y: 40 }, { x: 15, y: 40 }, { x: 25, y: 30 }, { x: 30, y: 35 }, { x: 35, y: 30 }], 5);
    for (const curve of [f, c]) {
      const { result } = offsetCurves(d, s, [curve.id], 1, { side: 1 });
      const out = s.curves[result.created[0]] as FitSpline;
      expect(out.type).toBe('fitSpline');
      for (const p of flatten(s, out, 0.05).slice(5, -5)) expect(Math.abs(closestPoint(s, curve, p).dist - 1)).toBeLessThan(0.1);
    }
  });
  it('chooses the side from a pick', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(offsetSideFromPick(s, [l.id], { x: 5, y: 3 })).toBe(1);
    expect(offsetSideFromPick(s, [l.id], { x: 5, y: -3 })).toBe(-1);
  });
});

describe('offset feature', () => {
  const lineOutputs = () => Object.values(s.curves).filter((c): c is Line => c.type === 'line' && !!c.derivedFrom);
  const outputsOf = (id: string) => (s.features[id] as Extract<typeof s.features[string], { type: 'offset' }>);
  it('creates a feature, derived outputs, hidden ties and a dimension', () => {
    const ids = rect(0, 0, 10, 6);
    const { features, result } = offsetCurves(d, s, ids, 1, { side: 1 });
    expect(features.length).toBe(1);
    const f = outputsOf(features[0]);
    expect(f.outputs.length).toBe(4);
    expect(result.created).toContain(f.id);
    expect(lineOutputs().every((c) => c.derivedFrom === f.id)).toBe(true);
    const dim = s.dimensions[f.dimension!];
    expect(dim.feature).toBe(f.id);
    expect(dim.value).toBe(1);
    expect(Object.values(s.constraints).filter((k) => k.feature === f.id).length).toBe(4);
    const profiles = findProfiles(s);
    expect(profiles.length).toBe(2);
  });
  it('two sides and symmetric make two features; symmetric references the first dimension', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    const two = offsetCurves(d, s, [c.id], 1, { mode: 'two', distance2: 2 });
    expect(two.features.length).toBe(2);
    const rs = Object.values(s.curves).filter((x): x is Circle => x.type === 'circle').map((x) => x.r).sort();
    expect(rs).toEqual([4, 5, 7]);
    const e = addCircle(d, s, { x: 50, y: 0 }, 5);
    const sym = offsetCurves(d, s, [e.id], 1, { mode: 'symmetric' });
    const a = s.dimensions[outputsOf(sym.features[0]).dimension!];
    const b = s.dimensions[outputsOf(sym.features[1]).dimension!];
    expect(b.expression).toBe(a.name);
  });
  it('regenerates outputs after sources move, keeping ids', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const { features } = offsetCurves(d, s, [l.id], 2, { side: 1 });
    const out = s.curves[outputsOf(features[0]).outputs[0]] as Line;
    const before = out.id;
    s.points[l.b].y = 10;
    regenerateDerived(s);
    expect(out.id).toBe(before);
    expect(closestPoint(s, l, s.points[out.a]).dist).toBeCloseTo(2);
    expect(closestPoint(s, l, s.points[out.b]).dist).toBeCloseTo(2);
  });
  it('regenerates a circle radius and follows the dimension value', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    const { features } = offsetCurves(d, s, [c.id], 1, { side: -1 });
    const f = outputsOf(features[0]);
    c.r = 8;
    s.dimensions[f.dimension!].value = 3;
    regenerateDerived(s);
    expect((s.curves[f.outputs[0]] as Circle).r).toBe(11);
    expect(f.distance).toBe(3);
  });
  it('rebuilds when the output topology changes, without losing the feature', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 10, y: 0 }, { x: 11, y: 1 });
    const c = addLine(d, s, { x: 11, y: 1 }, { x: 11, y: 11 });
    addConstraint(d, s, 'coincident', [a.b, b.a]);
    addConstraint(d, s, 'coincident', [b.b, c.a]);
    const { features } = offsetCurves(d, s, [a.id, b.id, c.id], 0.5, { side: 1 });
    const f = outputsOf(features[0]);
    expect(f.outputs.length).toBe(3);
    const dimId = f.dimension!;
    s.dimensions[dimId].value = 3;
    regenerateDerived(s);
    expect(f.outputs.length).toBe(2);
    expect(s.features[f.id]).toBe(f);
    expect(s.dimensions[dimId]).toBeDefined();
    expect(s.dimensions[dimId].refs[1]).toBe(f.outputs[0]);
    const taken = new Set(Object.keys(s.points));
    expect(taken.size).toBe(Object.keys(s.points).length);
    s.dimensions[dimId].value = 0.5;
    regenerateDerived(s);
    expect(f.outputs.length).toBe(3);
  });
  it('deleting the glyph drops the association and keeps the curves', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const { features } = offsetCurves(d, s, [l.id], 2, { side: 1 });
    const f = outputsOf(features[0]);
    const out = f.outputs[0];
    deleteEntities(s, [f.id]);
    expect(s.features[f.id]).toBeUndefined();
    expect(s.curves[out].derivedFrom).toBeUndefined();
    expect(s.dimensions[f.dimension!]).toBeUndefined();
    s.points[l.b].y = 10;
    regenerateDerived(s);
    expect((s.points[(s.curves[out] as Line).b]).y).toBe(2);
  });
  it('deleting the dimension keeps the association, unlocked, and it can come back', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const { features } = offsetCurves(d, s, [l.id], 2, { side: 1 });
    const f = outputsOf(features[0]);
    deleteEntities(s, [f.dimension!]);
    expect(f.dimension).toBeNull();
    expect(s.features[f.id]).toBeDefined();
    s.points[l.b].y = 10;
    regenerateDerived(s);
    expect(closestPoint(s, l, s.points[(s.curves[f.outputs[0]] as Line).b]).dist).toBeCloseTo(2);
    const again = addOffsetDimension(d, s, f.id);
    expect(s.dimensions[again!].value).toBe(2);
  });
  it('deleting a source dissolves the feature and leaves outputs', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const { features } = offsetCurves(d, s, [l.id], 2, { side: 1 });
    const out = outputsOf(features[0]).outputs[0];
    deleteEntities(s, [l.id]);
    expect(s.features[features[0]]).toBeUndefined();
    expect(s.curves[out]).toBeDefined();
    expect(s.curves[out].derivedFrom).toBeUndefined();
  });
  it('an arc source stays counter-clockwise when offset outward', () => {
    const a: Arc = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 });
    const { result } = offsetCurves(d, s, [a.id], 1, { side: -1 });
    const out: Curve = s.curves[result.created[0]];
    expect(curveLength(s, out)).toBeCloseTo((Math.PI / 2) * 6);
    expect(resolve(s, out).at(0.5).x).toBeCloseTo(6 * Math.SQRT1_2);
  });
  it('ellipse feature regenerates as ellipse', () => {
    const e = addEllipse(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 });
    const { features } = offsetCurves(d, s, [e.id], 1, { side: -1, ellipse: 'ellipse' });
    s.points[e.major].x = 20;
    regenerateDerived(s);
    const out = s.curves[outputsOf(features[0]).outputs[0]] as Ellipse;
    expect(out.type).toBe('ellipse');
    expect(s.points[out.major].x).toBeCloseTo(21);
  });
});

describe('Match Topology at its limit', () => {
  it('stops short of the collapse: four lines, none of them zero length, and the dimension says so', () => {
    for (const h of [10, 10.5, 12]) {
      d = newDesign();
      s = newSketch(d);
      const ids = rect(0, 0, 40, h);
      const { features } = offsetCurves(d, s, ids, 8, { matchTopology: true, side: 1 });
      const f = s.features[features[0]] as Extract<Feature, { type: 'offset' }>;
      expect(f.distance).toBeLessThan(h / 2);
      expect(f.distance).toBeGreaterThan(h / 2 - 0.02);
      expect(f.outputs.length).toBe(4);
      for (const o of f.outputs) {
        const l = s.curves[o] as Line;
        const a = getPointPos(s, l.a);
        const b = getPointPos(s, l.b);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.009);
      }
      const dim = s.dimensions[f.dimension as PointId];
      expect(dim.value).toBe(f.distance);
      expect(dim.expression).toBe(`${f.distance} mm`);
    }
  });

  it('leaves a distance inside the limit alone', () => {
    const ids = rect(0, 0, 40, 10);
    const { features } = offsetCurves(d, s, ids, 3, { matchTopology: true, side: 1 });
    expect((s.features[features[0]] as Extract<Feature, { type: 'offset' }>).distance).toBe(3);
  });

  it('regenerating past the limit brings the dimension down with it and says so', () => {
    const ids = rect(0, 0, 40, 10);
    const { features } = offsetCurves(d, s, ids, 3, { matchTopology: true, side: 1 });
    const f = s.features[features[0]] as Extract<Feature, { type: 'offset' }>;
    const dim = s.dimensions[f.dimension as PointId];
    dim.value = 8;
    dim.expression = '8 mm';
    const notes = regenerateDerived(s);
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/Match Topology/);
    expect(dim.value).toBeLessThan(5);
    expect(dim.expression).toBe(`${dim.value} mm`);
    expect(f.outputs.length).toBe(4);
  });

  it('a closed loop offset by exactly half its height has nothing left', () => {
    const ids = rect(0, 0, 40, 10);
    expect(computeOffset(s, ids, 5, 1)).toEqual([]);
    // A slot is the case where only two flat lines come out: its ends go to nothing at half its width.
    const a = addLine(d, s, { x: 0, y: 20 }, { x: 10, y: 20 });
    const c = addArc(d, s, { x: 10, y: 22 }, { x: 10, y: 20 }, { x: 10, y: 24 });
    const b = addLine(d, s, { x: 10, y: 24 }, { x: 0, y: 24 });
    const e = addArc(d, s, { x: 0, y: 22 }, { x: 0, y: 24 }, { x: 0, y: 20 });
    expect(computeOffset(s, [a.id, c.id, b.id, e.id], 2, 1)).toEqual([]);
  });

  it('the guard sees an offset that a change to its source would collapse', () => {
    const ids = rect(0, 0, 40, 10);
    offsetCurves(d, s, ids, 4, { side: 1 });
    expect(derivedDamage(s)).toBeNull();
    for (const id of [(s.curves[ids[1]] as Line).b, (s.curves[ids[2]] as Line).a, (s.curves[ids[2]] as Line).b, (s.curves[ids[3]] as Line).a]) s.points[id].y = 6;
    expect(derivedDamage(s)).toMatch(/collapse/);
  });
});
