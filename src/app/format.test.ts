import { describe, expect, it } from 'vitest';
import type { Design, Dimension } from '../model/types';
import { dimensionText, formatBytes, formatSolveTime } from './format';

const design = { units: 'mm' } as Design;
const dim = (d: Partial<Dimension>): Dimension => ({ id: 'd', kind: 'distance', refs: [], name: 'd1', expression: '1', value: 1, driving: true, label: { x: 0, y: 0 }, ...d });

describe('dimensionText', () => {
  it('shows angles with a degree sign [W-P3-11]', () => {
    expect(dimensionText(design, dim({ kind: 'angle', value: Math.PI / 4 }))).toBe('45.0°');
    expect(dimensionText(design, dim({ kind: 'angle', value: Math.PI / 2, driving: false }))).toBe('(90.0°)');
  });
});

describe('formatSolveTime', () => {
  it('has one decimal under 100 ms', () => {
    expect(formatSolveTime(3.2)).toBe('Solve 3.2 ms');
    expect(formatSolveTime(3.249)).toBe('Solve 3.2 ms');
    expect(formatSolveTime(0.1)).toBe('Solve 0.1 ms');
    expect(formatSolveTime(12)).toBe('Solve 12.0 ms');
    expect(formatSolveTime(99.9)).toBe('Solve 99.9 ms');
  });

  it('is whole milliseconds from 100', () => {
    expect(formatSolveTime(100)).toBe('Solve 100 ms');
    expect(formatSolveTime(142.7)).toBe('Solve 143 ms');
    expect(formatSolveTime(1234.4)).toBe('Solve 1234 ms');
    // 99.96 would round to "100.0" with a decimal: from there it is whole.
    expect(formatSolveTime(99.96)).toBe('Solve 100 ms');
  });

  it('says so when the time is too short to show as a tenth', () => {
    expect(formatSolveTime(0.049)).toBe('Solve <0.1 ms');
    expect(formatSolveTime(0)).toBe('Solve <0.1 ms');
    expect(formatSolveTime(0.05)).toBe('Solve 0.1 ms');
  });
});

describe('formatBytes', () => {
  it('reads a size for a person', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
