import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAYER_COLORS } from '../model/layers';
import { contrast, LEGIBLE, legibleOn, luminance, over, paletteGaps, paletteOf, parseHex, PALETTE_KEYS, TOKENS, tokenName, type Theme } from './palette';
import { COLORS, onCanvas, setTheme } from './style';

/** The canvas colours as they were before Dark Mode: Light must still draw exactly these. */
const LIGHT_BEFORE: Record<string, string> = {
  free: '#0a84d6', constrained: '#111111', construction: '#e8730c', projected: '#8a3fc7', fixed: '#1a9e4b',
  error: '#d9272e', selected: '#1f9bff', background: '#f6f7f8', gridMinor: '#e7e9eb', gridMajor: '#d3d6da',
  axisX: '#d9534f', axisY: '#4caf50', preview: '#0a84d6', guide: '#7f8a94', dimension: '#3a3f45',
  dimensionMuted: '#7b828a', windowBox: '#2178d6', crossingBox: '#2e9e5b',
  lost: '#f2a516', template: '#a7aeb6', cross: '#c28a00', dotHole: '#fff', interiorEdge: '#8d949b', interiorFill: '#b9bec4',
  hoverHalo: '#e3f5fb', badgeFill: '#eceef0', badgeEdge: '#b8bdc3', badgeInk: '#4c5258', badgeHoverFill: '#ddf4fb',
  badgeSelectedFill: '#cfe8ff', badgeCrossFill: '#fff0c7', badgeBadFill: '#fbdcdc', snapRing: '#fff', handleFill: '#cfe8ff',
  originInk: '#4a4f55', originFill: '#fff', manip: '#0a84d6', manipActive: '#0b5fa5', autoHot: '#c23be0', comb: '#a45de0', curvature: '#1a9e4b',
};
/** Same, as the rgba() strings were written, compared without spaces. */
const LIGHT_ALPHA_BEFORE: Record<string, string> = {
  hover: 'rgba(120,220,245,.55)', profile: 'rgba(90,170,240,.25)', labelBg: 'rgba(246,247,248,.9)', tipBg: 'rgba(246,247,248,.86)',
  windowFill: 'rgba(33,120,214,.10)', crossingFill: 'rgba(46,158,91,.10)', snapHalo: 'rgba(31,155,255,.25)',
  glyphFill: 'rgba(10,132,214,.75)', fade: 'rgba(255,255,255,.72)',
};

describe('tokens', () => {
  it('has every palette key in both themes, and nothing the palette does not read', () => {
    for (const theme of ['light', 'dark'] as Theme[]) expect(paletteGaps(theme)).toEqual({ missing: [], extra: [] });
  });

  it('defines the same custom properties in Light and Dark', () => {
    expect(Object.keys(TOKENS.dark).sort()).toEqual(Object.keys(TOKENS.light).sort());
  });

  it('writes plain values only: the palette parser cannot follow a var()', () => {
    for (const theme of ['light', 'dark'] as Theme[]) {
      for (const [name, value] of Object.entries(TOKENS[theme])) expect(value, `${theme} ${name}`).not.toContain('var(');
    }
  });

  it('keeps Light exactly as the canvas drew it before Dark Mode', () => {
    const light = paletteOf('light') as Record<string, string>;
    for (const [key, value] of Object.entries(LIGHT_BEFORE)) expect(light[key], key).toBe(value);
    for (const [key, value] of Object.entries(LIGHT_ALPHA_BEFORE)) expect(light[key].replace(/\s/g, ''), key).toBe(value);
  });

  it('gives Dark its own value for every colour a status or a layer shows', () => {
    const light = paletteOf('light');
    const dark = paletteOf('dark');
    for (const key of ['free', 'constrained', 'construction', 'projected', 'fixed', 'error', 'cross', 'lost', 'selected', 'background']) {
      expect(dark[key as keyof typeof dark], key).not.toBe(light[key as keyof typeof light]);
    }
  });

  it('draws fully constrained lines near-white in Dark', () => {
    const rgb = parseHex(paletteOf('dark').constrained) as [number, number, number];
    expect(Math.min(...rgb)).toBeGreaterThanOrEqual(0xe0);
  });

  it('is the file index.html paints before the stylesheet arrives', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain(`html { background: ${TOKENS.light['--c-background']}; }`);
    expect(html).toContain(`html[data-theme='dark'] { background: ${TOKENS.dark['--c-background']};`);
    // On screen only: paper is white.
    expect(html).toMatch(/@media screen \{\s*html \{/);
  });

  it('is read by the DOM through var(), never copied as a literal into styles.css', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? []).toEqual(['#000', '#fff']);
    for (const name of css.matchAll(/var\((--[\w-]+)\)/g)) expect(Object.keys(TOKENS.light), name[1]).toContain(name[1]);
  });

  it('names a token from its key', () => {
    expect(tokenName('gridMinor')).toBe('--c-grid-minor');
    expect(tokenName('free')).toBe('--c-free');
  });
});

describe('the stylesheet is read in one place', () => {
  it('only palette.ts imports the CSS, so Node can still load glyphs.ts, dimensions.ts and style.ts, as the Playwright specs do', () => {
    const importing = readdirSync('src/render')
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /from '[^']*\.css/.test(readFileSync(`src/render/${f}`, 'utf8')));
    expect(importing).toEqual(['palette.ts']);
  });
});

describe('no colour is left in the code', () => {
  const files = ['src/ui', 'src/ui/dialogs', 'src/render', 'src/tools', 'src/app']
    .flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => `${dir}/${f}`));

  it('is a real list', () => {
    expect(files.length).toBeGreaterThan(60);
    expect(files).toContain('src/render/renderer.ts');
  });

  it('has no hex, rgb(), hsl() or colour name as a literal in src/ui, src/render, src/tools or src/app', () => {
    const found: string[] = [];
    for (const file of files) {
      // Comments say what colours are; only code draws them.
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const m of code.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|['"](?:white|black|red|green|blue|gr[ae]y|orange|purple|yellow|transparent)['"]/g)) {
        found.push(`${file}: ${m[0]}`);
      }
    }
    expect(found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Contrast

type Rgb = [number, number, number];

/** A token as an opaque colour: an rgba() is laid over `backdrop`. */
function opaque(theme: Theme, name: string, backdrop: Rgb): Rgb {
  const value = TOKENS[theme][name];
  const hex = parseHex(value);
  if (hex) return hex;
  const m = /^rgba\(([^)]*)\)$/.exec(value);
  if (!m) throw new Error(`${name}: ${value}`);
  const [r, g, b, a] = m[1].split(',').map(Number);
  return over([r, g, b], a, backdrop);
}

const surface = (theme: Theme, name: string): Rgb => {
  // Panels and boxes that are translucent sit on the canvas, the rest on the page.
  const floating = ['--overlay', '--hud-bg', '--tip-bg', '--c-label-bg', '--c-tip-bg'];
  const base = floating.includes(name) ? opaque(theme, '--c-background', [0, 0, 0]) : opaque(theme, '--panel', [0, 0, 0]);
  return opaque(theme, name, base);
};

/** Text and its background, as the app draws them. */
const TEXT: [string, string[]][] = [
  ['--ink', ['--panel', '--panel-2', '--head', '--field', '--accent-soft', '--notice-bg', '--overlay', '--hud-bg']],
  ['--ink-2', ['--panel', '--panel-2', '--head', '--field', '--accent-soft', '--tip-bg', '--overlay']],
  ['--ink-3', ['--panel', '--panel-2', '--head', '--hud-bg', '--overlay']],
  ['--accent', ['--accent-soft', '--panel', '--panel-2', '--overlay']],
  ['--warn', ['--panel', '--field', '--hud-bg']],
  ['--done', ['--panel', '--panel-2', '--overlay']],
  ['--over', ['--panel', '--panel-2', '--overlay']],
  ['--purple', ['--panel', '--panel-2', '--field']],
  ['--on-primary', ['--primary', '--primary-hover']],
  ['--on-pill', ['--pill-bg']],
  ['--c-dimension', ['--c-background', '--c-label-bg', '--c-tip-bg']],
  ['--c-dimension-muted', ['--c-background', '--c-label-bg']],
  ['--c-error', ['--c-background', '--c-label-bg', '--c-badge-bad-fill']],
  ['--c-selected', ['--c-background', '--c-label-bg', '--c-hover-halo']],
  ['--c-badge-ink', ['--c-badge-fill', '--c-badge-hover-fill', '--c-badge-selected-fill', '--c-badge-cross-fill', '--c-badge-bad-fill']],
  ['--c-origin-ink', ['--c-origin-fill', '--c-background']],
];

/** What is drawn on the canvas, which needs 3:1 (WCAG 1.4.11) against it. */
const GRAPHICS = [
  'free', 'constrained', 'construction', 'projected', 'fixed', 'error', 'lost', 'cross', 'selected', 'preview', 'guide', 'template',
  'axisX', 'axisY', 'windowBox', 'crossingBox', 'manip', 'comb', 'curvature', 'autoHot', 'interiorEdge',
] as const;

/** CIE 1976 colour difference, enough to tell two status colours apart. */
function lab([r, g, b]: Rgb): [number, number, number] {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [x, y, z] = [
    (0.4124 * lin(r) + 0.3576 * lin(g) + 0.1805 * lin(b)) / 0.95047,
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b),
    (0.0193 * lin(r) + 0.1192 * lin(g) + 0.9505 * lin(b)) / 1.08883,
  ];
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a: Rgb, b: Rgb): number => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

describe('contrast', () => {
  const rows: string[] = [];

  it('text is at least 4.5:1 in Dark, for every pair the app draws', () => {
    for (const [fg, bgs] of TEXT) {
      for (const bg of bgs) {
        const back = surface('dark', bg);
        const ratio = contrast(opaque('dark', fg, back), back);
        rows.push(`dark  ${fg.padEnd(22)} on ${bg.padEnd(22)} ${ratio.toFixed(2)}`);
        expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('geometry is at least 3:1 against the Dark canvas', () => {
    const bg = surface('dark', '--c-background');
    const palette = paletteOf('dark');
    for (const key of GRAPHICS) {
      const ratio = contrast(parseHex(palette[key]) as Rgb, bg);
      rows.push(`dark  ${tokenName(key).padEnd(22)} on --c-background         ${ratio.toFixed(2)}`);
      expect(ratio, key).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the status colours apart in Dark, as far apart as they are in Light, bar the two that were already close', () => {
    const keys = ['free', 'constrained', 'construction', 'projected', 'fixed', 'error', 'cross', 'lost', 'selected'] as const;
    const diff = (theme: Theme): number => {
      const p = paletteOf(theme);
      let least = Infinity;
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const d = deltaE(parseHex(p[keys[i]]) as Rgb, parseHex(p[keys[j]]) as Rgb);
          rows.push(`${theme.padEnd(5)} dE ${keys[i].padEnd(12)} ${keys[j].padEnd(12)} ${d.toFixed(1)}`);
          least = Math.min(least, d);
        }
      }
      return least;
    };
    const light = diff('light');
    const dark = diff('dark');
    expect(dark).toBeGreaterThanOrEqual(15);
    expect(dark).toBeGreaterThanOrEqual(light);
  });

  it('prints the table', () => {
    console.log(`\n${rows.join('\n')}`);
    expect(rows.length).toBeGreaterThan(40);
  });
});

describe('layer colours on a dark canvas', () => {
  const bg = parseHex(TOKENS.dark['--c-background']) as Rgb;

  it('leaves a colour that already reads exactly as it is', () => {
    for (const c of ['#e64980', '#5f7186', '#ffffff', '#f2a516', '#4aa8f5']) {
      expect(contrast(parseHex(c) as Rgb, bg)).toBeGreaterThanOrEqual(LEGIBLE);
      expect(legibleOn(c, TOKENS.dark['--c-background'])).toBe(c);
    }
  });

  it('lightens one too dark to read, keeping its hue, until it reads', () => {
    const hue = ([r, g, b]: Rgb): number => {
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const c of ['#1b2a5a', '#364fc7', '#862e9c', '#000000', '#0b3a45']) {
      const out = legibleOn(c, TOKENS.dark['--c-background']);
      const before = parseHex(c) as Rgb;
      const after = parseHex(out) as Rgb;
      expect(contrast(before, bg), c).toBeLessThan(LEGIBLE);
      expect(contrast(after, bg), `${c} -> ${out}`).toBeGreaterThanOrEqual(LEGIBLE);
      expect(luminance(after)).toBeGreaterThan(luminance(before));
      if (c !== '#000000') expect(Math.abs(hue(after) - hue(before)), `${c} -> ${out}`).toBeLessThan(3);
    }
  });

  it('draws the stored colour as stored in Light, and the lightened one in Dark, and never changes the data', () => {
    const stored = '#1b2a5a';
    setTheme('light');
    expect(onCanvas(stored)).toBe(stored);
    setTheme('dark');
    const drawn = onCanvas(stored);
    expect(drawn).not.toBe(stored);
    expect(contrast(parseHex(drawn) as Rgb, parseHex(COLORS.background) as Rgb)).toBeGreaterThanOrEqual(LEGIBLE);
    expect(stored).toBe('#1b2a5a');
    setTheme('light');
    expect(onCanvas(stored)).toBe(stored);
    expect(COLORS.background).toBe('#f6f7f8');
  });

  it('keeps the default layer colours either legible or lightened to legible', () => {
    for (const c of LAYER_COLORS) {
      expect(contrast(parseHex(legibleOn(c, TOKENS.dark['--c-background'])) as Rgb, bg), c).toBeGreaterThanOrEqual(LEGIBLE);
    }
  });

  it('covers every palette key', () => {
    expect(PALETTE_KEYS.length).toBeGreaterThan(40);
  });
});
