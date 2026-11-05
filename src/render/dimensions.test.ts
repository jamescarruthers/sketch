import { beforeEach, describe, expect, it } from 'vitest';
import { addDimension, addLine, addConstraint, newDesign, newSketch } from '../model/document';
import type { Design, Sketch } from '../model/types';
import { View } from '../app/view';
import { offsetCurves } from '../geom/offset';
import { chamfer } from '../geom/modify';
import { layoutDimension, followLabels } from './dimensions';

let d: Design;
let s: Sketch;
const view = new View();

beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

describe('layoutDimension', () => {
  it('draws an offset dimension between source and output curves', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const { features } = offsetCurves(d, s, [l.id], 2, { side: 1 });
    const f = s.features[features[0]];
    if (f.type !== 'offset' || !f.dimension) throw new Error('no dimension');
    const dim = s.dimensions[f.dimension];
    expect(dim.feature).toBe(f.id);
    const layout = layoutDimension(d, s, { ...dim, label: { x: 5, y: 1 } }, view);
    expect(layout?.lines).toHaveLength(1);
    const [a, b] = layout?.lines[0] ?? [];
    expect(Math.abs((a?.y ?? 0) - (b?.y ?? 0))).toBeCloseTo(2, 6);
  });

  it('measures chamfer dimensions from their hidden corner point', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 20, y: 0 });
    const b = addLine(d, s, { x: 20, y: 0 }, { x: 20, y: 20 });
    addConstraint(d, s, 'coincident', [a.b, b.a]);
    chamfer(d, s, a.id, b.id, 'twoDistance', 3, 4);
    const dims = Object.values(s.dimensions);
    expect(dims).toHaveLength(2);
    for (const m of dims) expect(layoutDimension(d, s, m, view)).not.toBeNull();
  });

  it('moves a label with its geometry', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const dim = addDimension(d, s, 'distance', [l.a, l.b], 10, { label: { x: 5, y: 3 } });
    const anchors = followLabels(s, new Map());
    s.points[l.b].x = 20;
    followLabels(s, anchors);
    expect(s.dimensions[dim.id].label.x).toBeCloseTo(10, 6);
    expect(s.dimensions[dim.id].label.y).toBeCloseTo(3, 6);
  });
});
