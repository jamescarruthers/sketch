// Cases chosen to break things: degenerate input, repeated operations, order sensitivity.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Arc, Design, Line, Sketch } from '../model/types';
import { AXIS_X } from '../model/types';
import {
  addArc, addCircle, addConstraint, addDimension, addFitSpline, addLine, curvePoints, deleteEntities, newDesign, newSketch,
} from '../model/document';
import { History } from '../model/history';
import { deserialize, serialize } from '../io/project';
import { closestPoint, curveLength, evaluate, flatten, resolve } from './curves';
import { intersect } from './intersect';
import { breakCurve, chamfer, extend, fillet, filletVertex, mirror, moveCopy, scaleGeometry, trim } from './modify';
import { computeOffset, offsetCurves } from './offset';
import { findProfiles } from './profiles';

let d: Design;
let s: Sketch;
beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

/** No curve may reference a point that is gone, nor any constraint a ref that is gone. */
function assertIntegrity(sk: Sketch) {
  const reserved = new Set(['origin', 'axis-x', 'axis-y']);
  for (const c of Object.values(sk.curves)) for (const p of curvePoints(c)) expect(sk.points[p], `${c.id} -> ${p}`).toBeDefined();
  for (const p of Object.values(sk.points)) if (p.owner) expect(sk.curves[p.owner], `${p.id} owner`).toBeDefined();
  for (const k of Object.values(sk.constraints)) {
    for (const r of k.refs) expect(reserved.has(r) || !!sk.points[r] || !!sk.curves[r], `${k.type} ${k.id} -> ${r}`).toBe(true);
  }
  for (const m of Object.values(sk.dimensions)) {
    for (const r of m.refs) expect(reserved.has(r) || !!sk.points[r] || !!sk.curves[r], `${m.kind} ${m.id} -> ${r}`).toBe(true);
  }
}

describe('degenerate input', () => {
  it('zero-length line evaluates and flattens without NaN', () => {
    const l = addLine(d, s, { x: 1, y: 1 }, { x: 1, y: 1 });
    expect(Number.isFinite(curveLength(s, l))).toBe(true);
    expect(closestPoint(s, l, { x: 5, y: 5 }).t).toBe(0);
    for (const p of flatten(s, l)) expect(Number.isFinite(p.x)).toBe(true);
    const other = addLine(d, s, { x: 0, y: 0 }, { x: 5, y: 5 });
    expect(() => intersect(resolve(s, l), resolve(s, other))).not.toThrow();
    expect(() => findProfiles(s)).not.toThrow();
    expect(() => trim(d, s, l.id, { x: 1, y: 1 })).not.toThrow();
  });
  it('zero-radius circle does not hang or throw', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 0);
    expect(flatten(s, c).length).toBeLessThan(5000);
    expect(findProfiles(s)).toEqual([]);
  });
  it('two-point and coincident-point splines stay finite', () => {
    const f = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(evaluate(s, f, 0.5).x).toBeCloseTo(5);
    const g = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }]);
    expect(Number.isFinite(evaluate(s, g, 0.5).x)).toBe(true);
    expect(Number.isFinite(curveLength(s, g))).toBe(true);
  });
  it('bad modify input is a no-op, not a corruption', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 10, y: 0 }, { x: 10, y: 10 });
    const before = JSON.stringify(s);
    for (const r of [0, -1, Number.NaN]) {
      fillet(d, s, a.id, b.id, r, { x: 1, y: 0 }, { x: 10, y: 9 });
      chamfer(d, s, a.id, b.id, 'equal', r);
      scaleGeometry(s, [a.id], { x: 0, y: 0 }, r);
    }
    fillet(d, s, a.id, a.id, 1, { x: 1, y: 0 }, { x: 2, y: 0 });
    trim(d, s, 'ghost', { x: 0, y: 0 });
    extend(d, s, 'ghost', { x: 0, y: 0 });
    breakCurve(d, s, 'ghost', { x: 0, y: 0 });
    mirror(d, s, [a.id], 'ghost');
    expect(JSON.stringify(s)).toBe(before);
  });
  it('chamfer of parallel lines and fillet too large do nothing harmful', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 0, y: 5 }, { x: 10, y: 5 });
    const before = JSON.stringify(s);
    chamfer(d, s, a.id, b.id, 'equal', 1);
    expect(JSON.stringify(s)).toBe(before);
    const c = addCircle(d, s, { x: 100, y: 0 }, 1);
    const e = addCircle(d, s, { x: 100, y: 0 }, 2);
    expect(() => fillet(d, s, c.id, e.id, 0.2, { x: 101, y: 0 }, { x: 102, y: 0 })).not.toThrow();
    assertIntegrity(s);
  });
});

describe('repeated operations', () => {
  it('trims a tic-tac-toe grid to pieces without losing integrity', () => {
    const ls: Line[] = [];
    for (const k of [3, 6]) {
      ls.push(addLine(d, s, { x: 0, y: k }, { x: 9, y: k }));
      ls.push(addLine(d, s, { x: k, y: 0 }, { x: k, y: 9 }));
    }
    for (const c of ls) addConstraint(d, s, 'parallel', [c.id, ls[0].id === c.id ? ls[1].id : ls[0].id]);
    trim(d, s, ls[0].id, { x: 4.5, y: 3 });
    trim(d, s, ls[1].id, { x: 3, y: 4.5 });
    trim(d, s, ls[2].id, { x: 1, y: 6 });
    trim(d, s, ls[3].id, { x: 6, y: 8 });
    assertIntegrity(s);
    let total = 0;
    for (const c of Object.values(s.curves)) total += curveLength(s, c);
    expect(total).toBeCloseTo(36 - 3 - 3 - 3 - 3, 6);
  });
  it('trims a circle down to nothing one bite at a time', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    addLine(d, s, { x: -10, y: 0 }, { x: 10, y: 0 });
    addLine(d, s, { x: 0, y: -10 }, { x: 0, y: 10 });
    trim(d, s, c.id, { x: 5 * Math.SQRT1_2, y: 5 * Math.SQRT1_2 });
    expect(curveLength(s, s.curves[c.id])).toBeCloseTo(1.5 * Math.PI * 5);
    trim(d, s, c.id, { x: -5 * Math.SQRT1_2, y: 5 * Math.SQRT1_2 });
    expect(curveLength(s, s.curves[c.id])).toBeCloseTo(Math.PI * 5);
    trim(d, s, c.id, { x: -5 * Math.SQRT1_2, y: -5 * Math.SQRT1_2 });
    expect(curveLength(s, s.curves[c.id])).toBeCloseTo(0.5 * Math.PI * 5);
    trim(d, s, c.id, { x: 5 * Math.SQRT1_2, y: -5 * Math.SQRT1_2 });
    expect(s.curves[c.id]).toBeUndefined();
    assertIntegrity(s);
  });
  it('fillets all four corners of a closed rectangle and keeps one profile', () => {
    const pts = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
    const ls = pts.map((p, i) => addLine(d, s, p, pts[(i + 1) % 4]));
    ls.forEach((l, i) => addConstraint(d, s, 'coincident', [l.b, ls[(i + 1) % 4].a]));
    for (let i = 0; i < 4; i++) filletVertex(d, s, ls[i].b, 2);
    assertIntegrity(s);
    const r = findProfiles(s, 1e-4);
    expect(r.length).toBe(1);
    expect(r[0].area).toBeCloseTo(200 - 16 + Math.PI * 4, 1);
    expect(Object.values(s.curves).filter((c) => c.type === 'arc').length).toBe(4);
  });
  it('trim, fillet and offset survive save, load, undo and redo', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 20, y: 0 });
    const b = addLine(d, s, { x: 10, y: -5 }, { x: 10, y: 20 });
    addConstraint(d, s, 'horizontal', [a.id]);
    addDimension(d, s, 'distance', [a.a, a.b], 20);
    const h = new History(d);
    trim(d, s, a.id, { x: 15, y: 0 });
    h.commit(d, { label: 'trim' });
    trim(d, s, b.id, { x: 10, y: -3 });
    h.commit(d, { label: 'trim' });
    fillet(d, s, a.id, b.id, 2, { x: 1, y: 0 }, { x: 10, y: 19 });
    h.commit(d, { label: 'fillet' });
    offsetCurves(d, s, [a.id], 1, { side: 1 });
    h.commit(d, { label: 'offset' });
    const after = JSON.stringify(d);
    expect(JSON.stringify(h.undo())).not.toBe(after);
    h.undo();
    h.undo();
    h.undo();
    expect(h.undo()).toBeNull();
    let last: Design | null = null;
    for (let i = 0; i < 4; i++) last = h.redo();
    expect(JSON.stringify(last)).toBe(after);
    const loaded = deserialize(serialize(last as Design));
    expect(loaded).toMatchObject({ ok: true, warnings: [] });
    if (loaded.ok) assertIntegrity(Object.values(loaded.design.sketches)[0]);
  });
});

describe('arc orientation stays CCW through everything', () => {
  const ccw = (id: string) => {
    const a = s.curves[id] as Arc;
    const c = s.points[a.c];
    const p = s.points[a.a];
    const m = evaluate(s, a, 0.5);
    return (p.x - c.x) * (m.y - c.y) - (p.y - c.y) * (m.x - c.x) > 0 || curveLength(s, a) > Math.PI * Math.hypot(p.x - c.x, p.y - c.y);
  };
  it('mirror of a mirror returns the original shape', () => {
    const a = addArc(d, s, { x: 5, y: 2 }, { x: 8, y: 2 }, { x: 5, y: 5 });
    const r1 = mirror(d, s, [a.id], AXIS_X);
    const first = r1.created.find((id) => s.curves[id])!;
    const r2 = mirror(d, s, [first], AXIS_X);
    const second = s.curves[r2.created.find((id) => s.curves[id])!] as Arc;
    expect(ccw(first)).toBe(true);
    expect(ccw(second.id)).toBe(true);
    const o = s.curves[a.id] as Arc;
    expect(s.points[second.a].x).toBeCloseTo(s.points[o.a].x);
    expect(s.points[second.b].y).toBeCloseTo(s.points[o.b].y);
  });
  it('move with rotation keeps sweep', () => {
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 });
    moveCopy(d, s, [a.id], { angle: 2 });
    expect(curveLength(s, a)).toBeCloseTo((Math.PI / 2) * 5);
  });
  it('an arc wider than a half turn keeps the long way round when trimmed', () => {
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 0 });
    expect(curveLength(s, a)).toBeCloseTo(1.5 * Math.PI * 5);
    addLine(d, s, { x: -10, y: 0 }, { x: 0, y: 0 });
    trim(d, s, a.id, { x: 0, y: -5 });
    expect(curveLength(s, s.curves[a.id])).toBeCloseTo(0.5 * Math.PI * 5);
  });
});

describe('robustness of joins', () => {
  it('curves meeting only near an end still count as touching', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 10, y: 5e-7 }, { x: 10, y: 10 });
    expect(intersect(resolve(s, a), resolve(s, b)).length).toBeGreaterThanOrEqual(1);
  });
  it('profile of a sketch that deleted its middle curve is clean', () => {
    const pts = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
    const ls = pts.map((p, i) => addLine(d, s, p, pts[(i + 1) % 4]));
    expect(findProfiles(s).length).toBe(1);
    deleteEntities(s, [ls[1].id]);
    expect(findProfiles(s).length).toBe(0);
  });
  it('offset of a closed chain is itself a closed profile, whichever curve it starts from', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const c = addArc(d, s, { x: 10, y: 2 }, { x: 10, y: 0 }, { x: 10, y: 4 });
    const b = addLine(d, s, { x: 10, y: 4 }, { x: 0, y: 4 });
    const e = addArc(d, s, { x: 0, y: 2 }, { x: 0, y: 4 }, { x: 0, y: 0 });
    const ids = [a.id, c.id, b.id, e.id];
    const one = computeOffset(s, ids, 1, -1);
    const two = computeOffset(s, [c.id, b.id, e.id, a.id], 1, -1);
    expect(one.length).toBe(4);
    expect(two.length).toBe(4);
    offsetCurves(d, s, ids, 1, { side: -1 });
    const r = findProfiles(s, 1e-3);
    expect(r.length).toBe(2);
    const ring = r.find((x) => x.holes.length === 1);
    expect(ring?.area).toBeCloseTo(20 + Math.PI * 5, 0);
  });
});
