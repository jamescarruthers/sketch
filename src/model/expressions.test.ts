import { describe, expect, it } from 'vitest';
import { evaluateExpression, expressionDeps, findCycle, isValidName, parseExpression } from './expressions';

const mm = (s: string, names: Record<string, number> = {}) => {
  const r = evaluateExpression(s, { names: (n) => (n in names ? { value: names[n], kind: 'length' } : undefined) });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe('expressions', () => {
  it('handles precedence, parens, unary, power', () => {
    expect(mm('1 + 2 * 3')).toBe(7);
    expect(mm('(1 + 2) * 3')).toBe(9);
    expect(mm('-2 ^ 2')).toBe(-4);
    expect(mm('2 ^ 3 ^ 2')).toBe(512);
    expect(mm('10 / 4')).toBe(2.5);
  });
  it('applies units adjacent to numbers', () => {
    expect(mm('25.4 mm')).toBeCloseTo(25.4);
    expect(mm('1 in')).toBeCloseTo(25.4);
    expect(mm('1in')).toBeCloseTo(25.4);
    expect(mm('2 cm + 1 m')).toBeCloseTo(1020);
    expect(mm('1 ft')).toBeCloseTo(304.8);
    expect(mm('(1 + 1) in')).toBeCloseTo(50.8);
    expect(mm('1 in + 1')).toBeCloseTo(26.4);
  });
  it('honours the design length unit for bare numbers', () => {
    const r = evaluateExpression('2', { lengthUnit: 'in' });
    expect(r.ok && r.value).toBeCloseTo(50.8);
  });
  it('evaluates angles in radians', () => {
    const a = (s: string) => {
      const r = evaluateExpression(s, { expect: 'angle' });
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    };
    expect(a('45')).toBeCloseTo(Math.PI / 4);
    expect(a('90 deg')).toBeCloseTo(Math.PI / 2);
    expect(a('1 rad')).toBe(1);
    expect(a('pi / 2')).toBeCloseTo(Math.PI / 2);
    expect(a('atan(1)')).toBeCloseTo(Math.PI / 4);
    expect(a('45 deg + 45')).toBeCloseTo(Math.PI / 2);
  });
  it('evaluates functions', () => {
    expect(mm('sqrt(16)')).toBe(4);
    expect(mm('sqrt(9 mm * 4 mm)')).toBe(6);
    expect(mm('sin(90 deg) * 10')).toBeCloseTo(10);
    expect(mm('cos(0) * 3')).toBeCloseTo(3);
    expect(mm('abs(-3) + floor(1.7) + ceil(1.2) + round(1.5)')).toBe(8);
    expect(mm('min(1 in, 30 mm)')).toBeCloseTo(25.4);
    expect(mm('max(1, 2, 3)')).toBe(3);
    expect(mm('2 * pi * 5 mm')).toBeCloseTo(31.4159, 3);
  });
  it('references names', () => {
    expect(mm('d1 * 2', { d1: 5 })).toBe(10);
    expect(mm('=d1', { d1: 5 })).toBe(5);
    expect(mm('d1 / d2 * 1 mm', { d1: 5, d2: 2 })).toBe(2.5);
  });
  it('reports structured errors', () => {
    const err = (s: string, ctx = {}) => {
      const r = evaluateExpression(s, ctx);
      return r.ok ? null : r.error;
    };
    expect(err('1 +')?.code).toBe('syntax');
    expect(err('(1')?.code).toBe('syntax');
    expect(err('2 $ 3')?.pos).toBe(2);
    expect(err('')?.code).toBe('empty');
    expect(err('nope')).toMatchObject({ code: 'unknownName', name: 'nope' });
    expect(err('nope(1)')?.code).toBe('unknownFunction');
    expect(err('1 / 0')?.code).toBe('divideByZero');
    expect(err('sqrt(-1)')?.code).toBe('domain');
    expect(err('asin(2)')?.code).toBe('domain');
    expect(err('sin(1, 2)')?.code).toBe('arity');
    expect(err('1 mm + 1 deg')?.code).toBe('units');
    expect(err('1 mm * 1 mm')?.code).toBe('units');
    expect(err('5 mm', { expect: 'angle' })?.code).toBe('units');
    expect(err('2 d1')?.code).toBe('syntax');
  });
  it('extracts dependencies', () => {
    expect(expressionDeps('d1 * 2 + sin(d2) + pi + 3 mm').sort()).toEqual(['d1', 'd2']);
    expect(expressionDeps('1 +')).toEqual([]);
  });
  it('detects cycles', () => {
    expect(findCycle(new Map([['a', ['b']], ['b', ['c']], ['c', []]]))).toBeNull();
    expect(findCycle(new Map([['a', ['b']], ['b', ['a']]]))?.sort()).toEqual(['a', 'b']);
    expect(findCycle(new Map([['a', ['a']]]))).toEqual(['a']);
  });
  it('validates names', () => {
    expect(isValidName('width')).toBe(true);
    expect(isValidName('mm')).toBe(false);
    expect(isValidName('sin')).toBe(false);
    expect(isValidName('1a')).toBe(false);
    expect(parseExpression('1 in').ok).toBe(true);
  });
});
