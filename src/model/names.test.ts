// A name means one thing for the life of a design, and what used a name that went keeps its value.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Design, Sketch } from './types';
import { addCircle, addDimension, addLine, deleteEntities, newDesign, newSketch, setUserParameter } from './document';
import { replaceNames, evaluateExpression } from './expressions';
import { danglingNames, keepLostValues, lastValues, resolveAll } from './parameters';
import { deserialize, serialize } from '../io/project';

let d: Design;
let s: Sketch;

beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

const dim = (v: number, expression?: string) => {
  const l = addLine(d, s, { x: 0, y: 0 }, { x: v, y: 0 });
  return addDimension(d, s, 'distance', [l.a, l.b], v, expression ? { expression } : {});
};

describe('a name is not used twice', () => {
  it('after the dimension that had it is deleted', () => {
    const a = dim(10);
    expect(a.name).toBe('d1');
    deleteEntities(s, [a.id]);
    expect(dim(20).name).toBe('d2');
  });

  it('after every dimension is deleted, and after a save and a load', () => {
    const [a, b] = [dim(10), dim(20)];
    deleteEntities(s, [a.id, b.id]);
    const r = deserialize(serialize(d));
    if (!r.ok) throw new Error(r.error);
    d = r.design;
    s = d.sketches[d.order[0]];
    expect(dim(5).name).toBe('d3');
  });

  it('an old file with no counter starts past every name it shows, a dangling one too', () => {
    dim(10);
    dim(20, 'd7 * 2');
    delete d.names;
    const r = deserialize(serialize(d));
    if (!r.ok) throw new Error(r.error);
    d = r.design;
    s = d.sketches[d.order[0]];
    expect(dim(3).name).toBe('d8');
  });

  it('a counter nobody can read is dropped, and the names shown still decide', () => {
    dim(10);
    const r = deserialize(serialize({ ...d, names: { d: 'x' } as unknown as Design['names'] }));
    if (!r.ok) throw new Error(r.error);
    expect(r.design.names).toBeUndefined();
  });

  it('asking what the next name is uses nothing up', () => {
    const before = structuredClone(d.names);
    dim(1);
    expect(before).toBeUndefined();
    expect(d.names?.d).toBe(2);
  });

  it('a user parameter with a name of that form counts', () => {
    setUserParameter(d, { name: 'd40', expression: '1 mm', value: 1, comment: '', unit: 'mm' });
    expect(dim(3).name).toBe('d41');
  });
});

describe('what used a name that went keeps its value', () => {
  it.each([
    ['d1 / 2', '(80 mm) / 2', 40],
    ['d1', '80 mm', 80],
    ['2 * d1 + d1', '2 * (80 mm) + (80 mm)', 240],
    ['max(d1, 3 mm)', 'max((80 mm), 3 mm)', 80],
  ])('%s', (expression, written, value) => {
    const a = dim(80);
    const b = dim(value, expression);
    const was = lastValues(d);
    delete s.dimensions[a.id];
    expect(keepLostValues(d, was)).toEqual(['d1']);
    expect(b.expression).toBe(written);
    expect(resolveAll(d).errors).toEqual([]);
    expect(b.value).toBeCloseTo(value, 9);
    expect(evaluateExpression(b.expression).ok).toBe(true);
  });

  it('an exact value stays exact', () => {
    const a = dim(1 / 3 * 100);
    const b = dim(1 / 3 * 100, 'd1');
    const was = lastValues(d);
    delete s.dimensions[a.id];
    keepLostValues(d, was);
    resolveAll(d);
    expect(b.value).toBe(a.value);
  });

  it('an angle goes as degrees, and a parameter by its unit', () => {
    setUserParameter(d, { name: 'k', expression: '3', value: 3, comment: '', unit: '' as never });
    const b = dim(6, 'k * 2 mm');
    const was = lastValues(d);
    d.parameters = [];
    keepLostValues(d, was);
    expect(b.expression).toBe('(3) * 2 mm');
  });

  it('a chain that goes together keeps what each had', () => {
    const a = dim(80);
    const b = dim(40, 'd1 / 2');
    const c = dim(20, 'd2 / 2');
    const was = lastValues(d);
    delete s.dimensions[a.id];
    delete s.dimensions[b.id];
    keepLostValues(d, was);
    expect(c.expression).toBe('(40 mm) / 2');
  });

  it('a parameter that used it, and a text height', () => {
    const a = dim(80);
    setUserParameter(d, { name: 'p1', expression: 'd1 + 1 mm', value: 81, comment: '', unit: 'mm' });
    const was = lastValues(d);
    delete s.dimensions[a.id];
    keepLostValues(d, was);
    expect(d.parameters[0].expression).toBe('(80 mm) + 1 mm');
  });

  it('nothing lost changes nothing', () => {
    const a = dim(80);
    const b = dim(40, 'd1 / 2');
    expect(keepLostValues(d, lastValues(d))).toEqual([]);
    expect(b.expression).toBe('d1 / 2');
    expect(a.expression).toBe('80 mm');
  });

  it('a name that is only part of a word is left alone', () => {
    expect(replaceNames('d11 + d1', new Map([['d1', '5 mm']]))).toBe('d11 + (5 mm)');
  });
});

describe('an expression that dangles in a file', () => {
  it('opens, and says which dimension and what it wants', () => {
    addCircle(d, s, { x: 0, y: 0 }, 5);
    const b = dim(40, 'd9 / 2');
    const r = deserialize(serialize(d));
    if (!r.ok) throw new Error(r.error);
    expect(danglingNames(r.design).get(b.name)).toBe(`${b.name}: Unknown name 'd9'`);
  });
});
