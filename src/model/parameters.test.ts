import { beforeEach, describe, expect, it } from 'vitest';
import type { Design, Sketch } from './types';
import { addCircle, addDimension, addLine, newDesign, newSketch, setUserParameter } from './document';
import { drivenReference, measureDimension, nextDimensionName, refreshDriven, resolveAll, toggleDriven, wouldCycle } from './parameters';

let design: Design;
let sketch: Sketch;

beforeEach(() => {
  design = newDesign();
  sketch = newSketch(design);
});

describe('parameters', () => {
  it('names dimensions d1, d2 and skips used names', () => {
    const l = addLine(design, sketch, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(addDimension(design, sketch, 'distance', [l.a, l.b], 10).name).toBe('d1');
    expect(addDimension(design, sketch, 'distance', [l.a, l.b], 10).name).toBe('d2');
    setUserParameter(design, { name: 'd3', expression: '1 mm', value: 1, comment: '', unit: 'mm' });
    expect(nextDimensionName(design)).toBe('d4');
  });
  it('resolves in dependency order regardless of creation order', () => {
    const l = addLine(design, sketch, { x: 0, y: 0 }, { x: 10, y: 0 });
    const a = addDimension(design, sketch, 'distance', [l.a, l.b], 0, { expression: 'd2 * 2' });
    const b = addDimension(design, sketch, 'distance', [l.a, l.b], 0, { expression: 'width + 1 mm' });
    setUserParameter(design, { name: 'width', expression: '4 mm', value: 0, comment: '', unit: 'mm' });
    const r = resolveAll(design);
    expect(r.errors).toEqual([]);
    expect(b.value).toBe(5);
    expect(a.value).toBe(10);
    expect(r.changed.sort()).toEqual([a.id, b.id].sort());
  });
  it('resolves across sketches', () => {
    const other = newSketch(design);
    const l = addLine(design, sketch, { x: 0, y: 0 }, { x: 10, y: 0 });
    const m = addLine(design, other, { x: 0, y: 0 }, { x: 10, y: 0 });
    const a = addDimension(design, sketch, 'distance', [l.a, l.b], 7, { expression: '7 mm' });
    const b = addDimension(design, other, 'distance', [m.a, m.b], 0, { expression: `${a.name} * 3` });
    resolveAll(design);
    expect(b.value).toBe(21);
  });
  it('reports cycles and keeps prior values', () => {
    const l = addLine(design, sketch, { x: 0, y: 0 }, { x: 10, y: 0 });
    const a = addDimension(design, sketch, 'distance', [l.a, l.b], 3, { expression: 'd2' });
    const b = addDimension(design, sketch, 'distance', [l.a, l.b], 4, { expression: 'd1' });
    const r = resolveAll(design);
    expect(r.errors.map((e) => e.error.code)).toEqual(['cycle', 'cycle']);
    expect(a.value).toBe(3);
    expect(b.value).toBe(4);
    expect(wouldCycle(design, 'd1', 'd2 + 1')).not.toBeNull();
    expect(wouldCycle(design, 'd3', 'd2 + 1')).toBeNull();
  });
  it('reports bad expressions by name', () => {
    const l = addLine(design, sketch, { x: 0, y: 0 }, { x: 10, y: 0 });
    addDimension(design, sketch, 'distance', [l.a, l.b], 3, { expression: 'missing * 2' });
    expect(resolveAll(design).errors[0]).toMatchObject({ name: 'd1', error: { code: 'unknownName' } });
  });
  it('freezes driving-only expressions when toggled driven', () => {
    const l = addLine(design, sketch, { x: 0, y: 0 }, { x: 10, y: 0 });
    addDimension(design, sketch, 'distance', [l.a, l.b], 5, { expression: '5 mm' });
    const b = addDimension(design, sketch, 'distance', [l.a, l.b], 10, { expression: 'd1 * 2' });
    toggleDriven(design, sketch, b.id);
    expect(b.driving).toBe(false);
    expect(b.expression).toBe('10 mm');
    toggleDriven(design, sketch, b.id);
    expect(b.driving).toBe(true);
    expect(b.expression).toBe('10 mm');
  });
  it('keeps expressions that reference user parameters when toggled driven', () => {
    const l = addLine(design, sketch, { x: 0, y: 0 }, { x: 10, y: 0 });
    setUserParameter(design, { name: 'w', expression: '5 mm', value: 5, comment: '', unit: 'mm' });
    const b = addDimension(design, sketch, 'distance', [l.a, l.b], 5, { expression: 'w * 2' });
    toggleDriven(design, sketch, b.id);
    expect(b.expression).toBe('w * 2');
  });
  it('measures driven dimensions from geometry', () => {
    const c = addCircle(design, sketch, { x: 1, y: 1 }, 4);
    const d = addDimension(design, sketch, 'diameter', [c.id], 0, { driving: false });
    refreshDriven(sketch);
    expect(d.value).toBe(8);
    expect(measureDimension(sketch, d)).toBe(8);
  });
});

describe('drivenReference', () => {
  it('finds a Driven dimension named in an expression, and nothing else', () => {
    const design = newDesign();
    const sketch = newSketch(design);
    const a = addLine(design, sketch, { x: 0, y: 0 }, { x: 10, y: 0 });
    const driven = addDimension(design, sketch, 'distance', [a.a, a.b], 10, { driving: false });
    const driving = addDimension(design, sketch, 'distance', [a.a, a.b], 10);
    expect(drivenReference(design, `${driven.name} / 2`)).toBe(driven.name);
    expect(drivenReference(design, `${driving.name} / 2`)).toBe(null);
  });
});
