import { beforeEach, describe, expect, it } from 'vitest';
import type { Design, Sketch } from './types';
import { addCircle, addConstraint, addLine, addPoint, deleteEntities, newDesign, newSketch, pasteClipboard, copySelection } from './document';
import { addLayer, layerBelow, moveToLayer, ownerLayer, planFreeze, pointLayer, refLayer, removeLayer, stampCrossLayer } from './layers';

let d: Design;
let s: Sketch;
beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

/** Bottom layer first, then each new one above it; the last made is active. */
const layers = (n: number): string[] => {
  const ids = [d.activeLayer];
  for (let i = 1; i < n; i++) ids.push(addLayer(d).id);
  return ids;
};

describe('membership', () => {
  it('new geometry takes the active layer, and points follow their curve', () => {
    const [a, b] = layers(2);
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(l.layer).toBe(b);
    expect(refLayer(s, l.a)).toBe(b);
    const p = addPoint(d, s, { x: 1, y: 1 }, { explicit: true });
    expect(p.layer).toBe(b);
    d.activeLayer = a;
    const q = addCircle(d, s, { x: 0, y: 0 }, 3);
    expect(q.layer).toBe(a);
    expect(pointLayer(s, s.points[q.c])).toBe(a);
  });

  it('a pasted copy lands on the active layer', () => {
    const [a, b] = layers(2);
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    d.activeLayer = a;
    const made = pasteClipboard(d, s, copySelection(s, [l.id]));
    expect(s.curves[made.curves[0]].layer).toBe(a);
    expect(s.curves[l.id].layer).toBe(b);
  });

  it('a curve-less explicit point keeps the layer of the curve it outlives', () => {
    const [, b] = layers(2);
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    s.points[l.a].explicit = true;
    deleteEntities(s, [l.id]);
    expect(s.points[l.a].layer).toBe(b);
  });
});

describe('cross-layer stamping', () => {
  it('a constraint across layers gets the layer being edited as dependent, and loses it once it no longer spans', () => {
    const [a, b] = layers(2);
    d.activeLayer = a;
    const x = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    d.activeLayer = b;
    const y = addLine(d, s, { x: 10, y: 0 }, { x: 20, y: 5 });
    const k = addConstraint(d, s, 'coincident', [x.b, y.a]);
    stampCrossLayer(s, b);
    expect(k.dependentLayer).toBe(b);
    expect(ownerLayer(s, k)).toBe(b);
    moveToLayer(s, [x.id], b);
    stampCrossLayer(s, b);
    expect(k.dependentLayer).toBeUndefined();
  });

  it('keeps an existing dependent, so a link does not reverse when the active layer changes', () => {
    const [a, b] = layers(2);
    d.activeLayer = a;
    const x = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    d.activeLayer = b;
    const y = addLine(d, s, { x: 10, y: 0 }, { x: 20, y: 5 });
    const k = addConstraint(d, s, 'coincident', [x.b, y.a]);
    stampCrossLayer(s, b);
    stampCrossLayer(s, a);
    expect(k.dependentLayer).toBe(b);
  });

  it('a constraint to the origin or an axis is not cross-layer', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const k = addConstraint(d, s, 'coincident', ['origin', l.a]);
    stampCrossLayer(s, d.activeLayer);
    expect(k.dependentLayer).toBeUndefined();
  });
});

describe('planFreeze', () => {
  it('needs nothing for a single unlocked layer', () => {
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(planFreeze(d, s)).toBeNull();
  });

  const chain = (): { a: string; b: string; c: string; la: string; lb: string; lc: string } => {
    const [a, b, c] = layers(3);
    d.activeLayer = a;
    const la = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    d.activeLayer = b;
    const lb = addLine(d, s, { x: 10, y: 0 }, { x: 20, y: 0 });
    addConstraint(d, s, 'coincident', [la.b, lb.a]);
    stampCrossLayer(s, b);
    d.activeLayer = c;
    const lc = addLine(d, s, { x: 20, y: 0 }, { x: 30, y: 0 });
    addConstraint(d, s, 'coincident', [lb.b, lc.a]);
    stampCrossLayer(s, c);
    return { a, b, c, la: la.id, lb: lb.id, lc: lc.id };
  };

  it('holds other layers, but what depends on the active one follows, transitively', () => {
    const t = chain();
    d.activeLayer = t.a;
    expect(planFreeze(d, s)).toBeNull();
    d.activeLayer = t.b;
    const f = planFreeze(d, s);
    expect(f?.curves.has(t.la)).toBe(true);
    expect(f?.curves.has(t.lb)).toBe(false);
    expect(f?.curves.has(t.lc)).toBe(false);
    d.activeLayer = t.c;
    expect([...(planFreeze(d, s)?.curves ?? [])].sort()).toEqual([t.la, t.lb].sort());
  });

  it('a locked dependent stops the closure and its link is left out of the solve', () => {
    const t = chain();
    d.activeLayer = t.a;
    (d.layers.find((l) => l.id === t.b) as { locked: boolean }).locked = true;
    const f = planFreeze(d, s);
    expect(f?.curves.has(t.lb)).toBe(true);
    expect(f?.curves.has(t.lc)).toBe(true);
    expect(f?.curves.has(t.la)).toBe(false);
    expect(f?.broken.size).toBe(1);
  });

  it('a locked active layer freezes everything', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    d.layers[0].locked = true;
    expect(planFreeze(d, s)?.curves.has(l.id)).toBe(true);
  });

  it('a layer named in `also` moves too', () => {
    const t = chain();
    d.activeLayer = t.c;
    expect(planFreeze(d, s)?.curves.has(t.la)).toBe(true);
    expect(planFreeze(d, s, [t.a])).toBeNull();
  });
});

describe('deleting and moving', () => {
  it('sends geometry to the layer below, retargets dependents, and refuses the last layer', () => {
    const [a, b] = layers(2);
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const p = addPoint(d, s, { x: 3, y: 3 }, { explicit: true });
    expect(layerBelow(d, b)?.id).toBe(a);
    expect(removeLayer(d, b)).toBe(true);
    expect(s.curves[l.id].layer).toBe(a);
    expect(s.points[p.id].layer).toBe(a);
    expect(d.activeLayer).toBe(a);
    expect(removeLayer(d, a)).toBe(false);
  });

  it('the bottom layer hands up, having nothing below', () => {
    const [a, b] = layers(2);
    d.activeLayer = a;
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    removeLayer(d, a);
    expect(s.curves[l.id].layer).toBe(b);
  });

  it('moves a loose point and a curve, by the curve when given one of its points', () => {
    const [a] = layers(2);
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const p = addPoint(d, s, { x: 3, y: 3 }, { explicit: true });
    expect(moveToLayer(s, [l.a, p.id], a).sort()).toEqual([l.id, p.id].sort());
    expect(pointLayer(s, s.points[l.b])).toBe(a);
  });
});
