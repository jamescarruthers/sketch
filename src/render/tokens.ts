// What src/ui/tokens.css says, and the colour maths on it. Pure, so tests and the browser specs can read
// the file themselves; palette.ts is what the app imports, with the file's text already in.

export type Theme = 'light' | 'dark';

export const PALETTE_KEYS = [
  'background', 'gridMinor', 'gridMajor', 'axisX', 'axisY', 'axisZ', 'planeLine',
  'free', 'constrained', 'construction', 'projected', 'fixed', 'error', 'lost', 'cross', 'template',
  'hover', 'hoverHalo', 'selected', 'profile', 'preview', 'guide',
  'dimension', 'dimensionMuted', 'labelBg', 'tipBg', 'dotHole', 'interiorEdge', 'interiorFill',
  'windowBox', 'windowFill', 'crossingBox', 'crossingFill',
  'badgeFill', 'badgeEdge', 'badgeInk', 'badgeHoverFill', 'badgeSelectedFill', 'badgeCrossFill', 'badgeBadFill',
  'snapHalo', 'snapRing', 'handleFill', 'originInk', 'originFill', 'manip', 'manipActive', 'glyphFill',
  'fade', 'autoHot', 'comb', 'curvature', 'cubeFace', 'cubeEdge', 'cubeInk', 'cubeHover',
] as const;

export type PaletteKey = typeof PALETTE_KEYS[number];
export type Palette = Record<PaletteKey, string>;

/** `--name: value;` pairs of one rule's body, comments dropped. */
function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** Light is the `:root` rule and Dark is `:root[data-theme='dark']`: every custom property of each. */
export function parseTokens(css: string): Record<Theme, Record<string, string>> {
  const rule = (selector: RegExp): Record<string, string> => {
    const m = selector.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''));
    return m ? declarations(m[1]) : {};
  };
  return {
    light: rule(/(?:^|\})\s*:root\s*\{([^}]*)\}/),
    dark: rule(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/),
  };
}

export type Tokens = Record<Theme, Record<string, string>>;

export const camel = (kebab: string): string => kebab.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
/** `gridMinor` is `--c-grid-minor`. */
export const tokenName = (key: PaletteKey): string => `--c-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export function paletteFrom(tokens: Tokens, theme: Theme): Palette {
  const out = {} as Record<string, string>;
  for (const key of PALETTE_KEYS) out[key] = tokens[theme][tokenName(key)] ?? '';
  return out as Palette;
}

// ---------------------------------------------------------------------------
// Contrast, and layer colours on a dark canvas

/** sRGB channels 0-255 of #rrggbb or #rgb. Null for anything else, rgba() included. */
export function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance, WCAG 2. */
export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Straight alpha over an opaque backdrop. */
export function over(fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] {
  return fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha))) as [number, number, number];
}

const hex = ([r, g, b]: [number, number, number]): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === x ? (y - z) / d + (y < z ? 6 : 0) : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255)) as [number, number, number];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t0: number): number => {
    const t = (t0 + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255);
  };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)];
}

/** Contrast a drawn layer colour needs against the canvas to stay readable: the WCAG minimum for graphics. */
export const LEGIBLE = 3;

/**
 * A layer colour as drawn on `background`: unchanged when it already reads, otherwise lightened, keeping
 * its hue and saturation, until it reaches `LEGIBLE`. The stored colour is never touched.
 */
export function legibleOn(color: string, background: string, min = LEGIBLE): string {
  const rgb = parseHex(color);
  const bg = parseHex(background);
  if (!rgb || !bg || contrast(rgb, bg) >= min) return color;
  const [h, s, l] = toHsl(rgb);
  let lo = l;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(fromHsl([h, s, mid]), bg) >= min) hi = mid;
    else lo = mid;
  }
  return hex(fromHsl([h, s, hi]));
}
