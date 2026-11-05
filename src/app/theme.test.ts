import { describe, expect, it } from 'vitest';
import { parseSetting, resolveTheme, THEME_SETTINGS } from './theme';

describe('theme setting', () => {
  it('reads System, Light or Dark, and takes anything else, or nothing, as System', () => {
    expect(THEME_SETTINGS).toEqual(['system', 'light', 'dark']);
    expect(parseSetting('light')).toBe('light');
    expect(parseSetting('dark')).toBe('dark');
    expect(parseSetting('system')).toBe('system');
    for (const bad of [null, undefined, '', 'Dark', 'auto', '{}']) expect(parseSetting(bad)).toBe('system');
  });

  it('follows the OS only on System', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
