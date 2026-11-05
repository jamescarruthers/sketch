// The canvas palette. Its values are the `--c-*` custom properties of src/ui/tokens.css, read from the
// file's own text, so the canvas and the DOM share one set of colours and no value is written twice.
import tokensCss from '../ui/tokens.css?raw';
import { installPalettes } from './style';
import { camel, paletteFrom, parseTokens, PALETTE_KEYS, type Palette, type Theme } from './tokens';

export * from './tokens';

export const TOKENS = parseTokens(tokensCss);

export const paletteOf = (theme: Theme): Palette => paletteFrom(TOKENS, theme);

/** Palette names that appear in a theme's tokens but not in PALETTE_KEYS, and the other way round. For tests. */
export function paletteGaps(theme: Theme): { missing: string[]; extra: string[] } {
  const have = Object.keys(TOKENS[theme]).filter((n) => n.startsWith('--c-')).map((n) => camel(n.slice(4)));
  const want = new Set<string>(PALETTE_KEYS);
  return { missing: PALETTE_KEYS.filter((k) => !have.includes(k)), extra: have.filter((k) => !want.has(k)) };
}

// Whoever imports this file gets the canvas colours.
installPalettes(paletteOf);
