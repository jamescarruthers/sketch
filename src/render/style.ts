// Colours from docs/SPEC.md section 7. Canvas drawing and the DOM share src/ui/tokens.css; see palette.ts.
import type { LineType } from '../model/types';
import { legibleOn, type Palette, type Theme } from './tokens';

/**
 * The colours the canvas draws with right now. `setTheme` swaps every value in place, so code reading
 * `COLORS.free` at draw time gets the current theme; keep no copy of one across frames. Empty until
 * palette.ts, which reads tokens.css, has installed the palettes: this file stays free of that import so
 * that the Playwright specs, which load glyphs.ts and dimensions.ts in Node, can still import it.
 */
export const COLORS = {} as Palette;

let current: Theme = 'light';
let source: ((theme: Theme) => Palette) | null = null;

/** palette.ts calls this once, at load. */
export function installPalettes(palettes: (theme: Theme) => Palette): void {
  source = palettes;
  setTheme(current);
}

const lightened = new Map<string, string>();

export function setTheme(theme: Theme): void {
  current = theme;
  lightened.clear();
  if (source) Object.assign(COLORS, source(theme));
}

export const currentTheme = (): Theme => current;

/**
 * A layer colour as it is drawn on the canvas. Light draws it as stored. Dark lightens one too dark to
 * read against the canvas, keeping its hue, and leaves a legible one alone. The data is never changed.
 */
export function onCanvas(color: string): string {
  if (current === 'light') return color;
  let out = lightened.get(color);
  if (out === undefined) {
    out = legibleOn(color, COLORS.background);
    lightened.set(color, out);
  }
  return out;
}

export const FONT = '500 12px Inter, system-ui, sans-serif';

export const CONSTRUCTION_DASH = [7, 5];
export const CENTERLINE_DASH = [14, 4, 3, 4];

export function dashOf(lineType: LineType): number[] {
  if (lineType === 'construction') return CONSTRUCTION_DASH;
  if (lineType === 'centerline') return CENTERLINE_DASH;
  return [];
}
