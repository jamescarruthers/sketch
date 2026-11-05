import { describe, expect, it } from 'vitest';
import { allEntries, MENU } from '../tools/menu';
import { iconNames } from './icons';

describe('icons', () => {
  it('covers every tool in the menu, and every flyout', () => {
    const names = new Set(iconNames());
    expect(allEntries().filter((e) => e.id !== 'finish-autoconstrain' && !names.has(e.id)).map((e) => e.id)).toEqual([]);
    for (const p of MENU) {
      for (const e of p.entries) if ('flyout' in e) expect(names.has(e.icon)).toBe(true);
    }
  });
});
