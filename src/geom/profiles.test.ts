import { beforeEach, describe, expect, it } from 'vitest';
import type { Design, Sketch, Vec2 } from '../model/types';
import {
  addArc, addCircle, addConstraint, addEllipse, addFitSpline, addLine, newDesign, newSketch,
} from '../model/document';
import { findProfiles, profileAt } from './profiles';

let d: Design;
let s: Sketch;
beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

const rect = (x0: number, y0: number, x1: number, y1: number, lineType: 'normal' | 'construction' = 'normal') => {
  const pts: Vec2[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  return pts.map((p, i) => addLine(d, s, p, pts[(i + 1) % 4], { lineType }));
};

describe('profiles', () => {
  it('finds a rectangle of lines joined by position', () => {
    rect(0, 0, 10, 5);
    const r = findProfiles(s);
    expect(r.length).toBe(1);
    expect(r[0].area).toBeCloseTo(50);
    expect(r[0].curves.length).toBe(4);
  });
  it('joins through coincident constraints with slightly apart ends', () => {
    const lines = rect(0, 0, 10, 5);
    s.points[lines[0].b].x += 0.01;
    addConstraint(d, s, 'coincident', [lines[0].b, lines[1].a]);
    expect(findProfiles(s).length).toBe(1);
  });
  it('ignores construction but keeps centerline', () => {
    rect(0, 0, 10, 5, 'construction');
    expect(findProfiles(s)).toEqual([]);
    const c = addCircle(d, s, { x: 50, y: 0 }, 2, { lineType: 'centerline' });
    expect(findProfiles(s)[0].curves).toEqual([c.id]);
  });
  it('full circles, ellipses and closed splines are loops', () => {
    addCircle(d, s, { x: 0, y: 0 }, 5);
    addEllipse(d, s, { x: 50, y: 0 }, { x: 55, y: 0 }, { x: 50, y: 3 });
    addFitSpline(d, s, [{ x: 100, y: 0 }, { x: 110, y: 0 }, { x: 110, y: 10 }, { x: 100, y: 10 }], true);
    const r = findProfiles(s, 1e-4).sort((a, b) => a.outer.pts[0].x - b.outer.pts[0].x);
    expect(r.length).toBe(3);
    expect(r[0].area).toBeCloseTo(Math.PI * 25, 1);
    expect(r[1].area).toBeCloseTo(Math.PI * 15, 1);
  });
  it('shades the ring between concentric circles as an annulus with a hole', () => {
    addCircle(d, s, { x: 0, y: 0 }, 10);
    addCircle(d, s, { x: 0, y: 0 }, 4);
    const r = findProfiles(s, 1e-4).sort((a, b) => b.area - a.area);
    expect(r.length).toBe(2);
    expect(r[0].holes.length).toBe(1);
    expect(r[0].area).toBeCloseTo(Math.PI * (100 - 16), 1);
    expect(r[1].holes.length).toBe(0);
    expect(r[1].area).toBeCloseTo(Math.PI * 16, 1);
    const ring = profileAt(r, { x: 7, y: 0 });
    expect(ring?.holes.length).toBe(1);
    expect(profileAt(r, { x: 1, y: 0 })?.holes.length).toBe(0);
    expect(profileAt(r, { x: 20, y: 0 })).toBeNull();
  });
  it('nests three levels, holes attach only to the immediate parent', () => {
    addCircle(d, s, { x: 0, y: 0 }, 10);
    addCircle(d, s, { x: 0, y: 0 }, 6);
    addCircle(d, s, { x: 0, y: 0 }, 2);
    const r = findProfiles(s).sort((a, b) => b.area - a.area);
    expect(r.length).toBe(3);
    expect(r.map((x) => x.holes.length).sort()).toEqual([0, 1, 1]);
    expect(r.reduce((t, x) => t + x.area, 0)).toBeCloseTo(Math.PI * 100, 0);
  });
  it('splits overlapping circles into three regions', () => {
    addCircle(d, s, { x: 0, y: 0 }, 5);
    addCircle(d, s, { x: 6, y: 0 }, 5);
    const r = findProfiles(s, 1e-4).sort((a, b) => a.area - b.area);
    expect(r.length).toBe(3);
    const lens = 2 * 25 * Math.acos(3 / 5) - 3 * 8;
    expect(r[0].area).toBeCloseTo(lens, 1);
    expect(r[1].area).toBeCloseTo(Math.PI * 25 - lens, 1);
    expect(r[2].area).toBeCloseTo(Math.PI * 25 - lens, 1);
  });
  it('splits a rectangle by a line ending on its sides', () => {
    rect(0, 0, 10, 10);
    addLine(d, s, { x: 5, y: 0 }, { x: 5, y: 10 });
    const r = findProfiles(s);
    expect(r.length).toBe(2);
    expect(r[0].area).toBeCloseTo(50);
  });
  it('splits a square by two crossing lines overshooting it', () => {
    rect(0, 0, 10, 10);
    addLine(d, s, { x: -2, y: 5 }, { x: 12, y: 5 });
    addLine(d, s, { x: 5, y: -2 }, { x: 5, y: 12 });
    const r = findProfiles(s);
    expect(r.length).toBe(4);
    for (const x of r) expect(x.area).toBeCloseTo(25);
  });
  it('ignores dangling lines and open chains', () => {
    rect(0, 0, 10, 10);
    addLine(d, s, { x: 10, y: 5 }, { x: 20, y: 5 });
    addLine(d, s, { x: 30, y: 30 }, { x: 40, y: 30 });
    expect(findProfiles(s).length).toBe(1);
  });
  it('keeps a slot of lines and tangent arcs', () => {
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    addArc(d, s, { x: 10, y: 2 }, { x: 10, y: 0 }, { x: 10, y: 4 });
    addLine(d, s, { x: 10, y: 4 }, { x: 0, y: 4 });
    addArc(d, s, { x: 0, y: 2 }, { x: 0, y: 4 }, { x: 0, y: 0 });
    const r = findProfiles(s, 1e-4);
    expect(r.length).toBe(1);
    expect(r[0].area).toBeCloseTo(40 + Math.PI * 4, 1);
  });
  it('handles an island joined by a bridge', () => {
    rect(0, 0, 20, 20);
    addCircle(d, s, { x: 10, y: 10 }, 3);
    addLine(d, s, { x: 13, y: 10 }, { x: 20, y: 10 });
    const r = findProfiles(s).sort((a, b) => a.area - b.area);
    expect(r.length).toBe(2);
    expect(r[1].area).toBeCloseTo(400 - Math.PI * 9, 0);
  });
  it('a duplicate line does not create a degenerate face', () => {
    rect(0, 0, 10, 10);
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(findProfiles(s).length).toBe(1);
  });
  it('a figure-eight spline yields two lobes', () => {
    addFitSpline(d, s, [
      { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 10, y: -10 },
      { x: 0, y: 0 }, { x: -10, y: 10 }, { x: -20, y: 0 }, { x: -10, y: -10 },
    ], true);
    expect(findProfiles(s).length).toBeGreaterThanOrEqual(2);
  });
});

describe('a line closed by a spline', () => {
  it('is a profile, whichever is met first', () => {
    const d = newDesign();
    const s = newSketch(d);
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 60, y: 0 });
    const sp = addFitSpline(d, s, [{ x: 60, y: 0 }, { x: 58, y: 27 }, { x: 30, y: 37 }, { x: 2, y: 27 }, { x: 0, y: 0 }]);
    addConstraint(d, s, 'coincident', [l.b, sp.pts[0]]);
    addConstraint(d, s, 'coincident', [sp.pts[4], l.a]);
    expect(findProfiles(s).length).toBe(1);
  });
});
