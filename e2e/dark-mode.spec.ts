// Dark Mode, through the real File menu and the real canvas. The OS side is emulated with
// `page.emulateMedia`, which is the same signal `prefers-color-scheme` gives a real browser.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SketchUser, type Xy } from './helpers';
import { paletteFrom, parseHex, parseTokens, type Palette, type Theme } from '../src/render/tokens';

const tokens = parseTokens(readFileSync('src/ui/tokens.css', 'utf8'));
const palette = (theme: Theme): Palette => paletteFrom(tokens, theme);
const rgb = (hex: string): [number, number, number] => parseHex(hex) as [number, number, number];

const errors = (page: Page): string[] => (page as unknown as { errors: string[] }).errors;

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  page.on('pageerror', (e) => seen.push(e.message));
  (page as unknown as { errors: string[] }).errors = seen;
});

const themeOf = (page: Page): Promise<string | undefined> => page.evaluate(() => document.documentElement.dataset.theme);
const stored = (page: Page): Promise<string | null> => page.evaluate(() => localStorage.getItem('sketch.theme'));

/** The colour most of a small block of the canvas has: the background, with a grid line or two ignored. */
const canvasBackground = (page: Page): Promise<number[]> => page.evaluate(() => {
  const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const x = Math.round(canvas.width * 0.45);
  const y = Math.round(canvas.height * 0.8);
  const data = g.getImageData(x, y, 12, 12).data;
  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4) {
    const k = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
});

const choose = async (page: Page, choice: 'System' | 'Light' | 'Dark'): Promise<void> => {
  await page.locator('[data-menu="file"]').click();
  await page.locator('.menu-item.flyout[data-item="Theme"]').hover();
  await page.locator(`.menu-item[data-item="Theme ${choice}"]`).click();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};

const open = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  return u;
};

test.describe('the theme setting', () => {
  test('System is the default, follows the OS, and updates live when the OS changes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page);
    expect(await themeOf(page)).toBe('dark');
    expect(await stored(page)).toBeNull();
    expect(await canvasBackground(page)).toEqual(rgb(palette('dark').background));
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(230, 233, 236)');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => themeOf(page)).toBe('light');
    expect(await canvasBackground(page)).toEqual(rgb(palette('light').background));

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => themeOf(page)).toBe('dark');
    expect(await canvasBackground(page)).toEqual(rgb(palette('dark').background));
  });

  test('Light and Dark override the OS, are remembered, and System goes back to following it', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    await choose(page, 'Dark');
    expect(await themeOf(page)).toBe('dark');
    expect(await stored(page)).toBe('dark');

    await page.reload();
    await page.waitForFunction(() => !!window.__sketch);
    expect(await themeOf(page)).toBe('dark');
    expect(await canvasBackground(page)).toEqual(rgb(palette('dark').background));

    // The OS has no say while it is set.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await themeOf(page)).toBe('dark');

    await choose(page, 'Light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await themeOf(page)).toBe('light');
    expect(await stored(page)).toBe('light');

    await choose(page, 'System');
    expect(await themeOf(page)).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => themeOf(page)).toBe('light');
  });

  test('the File menu has a Theme item with the three choices, showing and ticking the current one', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page);
    await page.locator('[data-menu="file"]').click();
    const row = page.locator('.menu-item.flyout[data-item="Theme"]');
    await expect(row).toBeVisible();
    await expect(row.locator(':scope > .menu-hint')).toContainText('System');
    await row.hover();
    const items = row.locator('.menu-item');
    await expect(items).toHaveText(['System', 'Light', 'Dark']);
    await expect(items.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(items.nth(1)).toHaveAttribute('aria-checked', 'false');
    await expect(items.nth(0).locator('svg')).toHaveCount(1);
    await expect(items.nth(1).locator('svg')).toHaveCount(0);
    await items.nth(2).click();

    await page.locator('[data-menu="file"]').click();
    await expect(page.locator('.menu-item.flyout[data-item="Theme"] > .menu-hint')).toContainText('Dark');
    await page.locator('.menu-item.flyout[data-item="Theme"]').hover();
    await expect(page.locator('.menu-item[data-item="Theme Dark"]')).toHaveAttribute('aria-checked', 'true');
  });

  test('anything else in storage reads as System', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const u = await open(page);
    await page.evaluate(() => localStorage.setItem('sketch.theme', 'purple'));
    await page.reload();
    await page.waitForFunction(() => !!window.__sketch);
    expect(await themeOf(page)).toBe('dark');
    await u.settle();
    await page.locator('[data-menu="file"]').click();
    await expect(page.locator('.menu-item.flyout[data-item="Theme"] > .menu-hint')).toContainText('System');
  });

  test('the canvas repaints in the same task as the click, not on the next frame', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    await page.locator('[data-menu="file"]').click();
    await page.locator('.menu-item.flyout[data-item="Theme"]').hover();
    const after = await page.evaluate(() => {
      (document.querySelector('.menu-item[data-item="Theme Dark"]') as HTMLElement).click();
      const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement;
      const g = canvas.getContext('2d') as CanvasRenderingContext2D;
      return Array.from(g.getImageData(Math.round(canvas.width * 0.45), Math.round(canvas.height * 0.8), 1, 1).data).slice(0, 3);
    });
    expect(after).toEqual(rgb(palette('dark').background));
  });
});

test.describe('before the app starts', () => {
  for (const [os, setting, want] of [['dark', null, 'dark'], ['light', null, 'light'], ['light', 'dark', 'dark'], ['dark', 'light', 'light'], ['light', 'purple', 'light']] as const) {
    test(`the page is already ${want} with the OS on ${os} and the setting ${setting ?? 'unset'}, before any script of the app runs`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: os });
      if (setting) await page.addInitScript((s) => localStorage.setItem('sketch.theme', s), setting);
      // Nothing of the app loads: this is the page as it paints first.
      await page.route(/\.(ts|js)(\?.*)?$/, (route) => route.abort());
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      expect(await page.locator('#app > *').count()).toBe(0);
      expect(await themeOf(page)).toBe(want);
      const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
      expect(bg).toBe(`rgb(${rgb(palette(want).background).join(', ')})`);
    });
  }

  test('storage that throws on every read and write leaves the app working, and the setting lasts the session', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => {
      const blocked = (): never => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
      Storage.prototype.getItem = blocked;
      Storage.prototype.setItem = blocked;
      Storage.prototype.removeItem = blocked;
    });
    await page.goto('/');
    await page.waitForFunction(() => !!window.__sketch);
    expect(await themeOf(page)).toBe('light');
    await choose(page, 'Dark');
    expect(await themeOf(page)).toBe('dark');
    expect(await canvasBackground(page)).toEqual(rgb(palette('dark').background));
    await choose(page, 'System');
    expect(await themeOf(page)).toBe('light');
    expect(errors(page)).toEqual([]);
  });
});

test.describe('the setting is not part of the design', () => {
  test('it is not in the saved file, not an undo step, and not a history entry', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const u = new SketchUser(page);
    await u.open();
    await u.newSketch();
    await u.press('l');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 40, y: 10 });
    await u.press('Escape');
    await u.press('Escape');
    const before = await page.evaluate(() => JSON.stringify(window.__sketch.design()));
    expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(true);
    expect(await page.evaluate(() => window.__sketch.canRedo)).toBe(false);
    const undoTitle = await page.locator('.icon-btn[aria-label="Undo"]').getAttribute('title');

    await choose(page, 'Dark');
    expect(await page.evaluate(() => JSON.stringify(window.__sketch.design()))).toBe(before);
    expect(await page.evaluate(() => window.__sketch.canRedo)).toBe(false);
    expect(await page.locator('.icon-btn[aria-label="Undo"]').getAttribute('title')).toBe(undoTitle);

    // Save: nothing about a theme in the file.
    await page.locator('[data-menu="file"]').click();
    const waiting = page.waitForEvent('download');
    await page.locator('.menu-item[data-item="Save"]').click();
    const file = readFileSync(await (await waiting).path(), 'utf8');
    expect(file).not.toMatch(/theme|dark/i);
    expect(JSON.parse(file)).toMatchObject({ name: expect.any(String) });

    // Undo takes the line away and leaves the theme where it was; redo brings the line back.
    await u.press('Control+z');
    expect((await u.lines()).length).toBe(0);
    expect(await themeOf(page)).toBe('dark');
    await u.press('Control+Shift+z');
    expect((await u.lines()).length).toBe(1);
    expect(await themeOf(page)).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// The canvas

interface Pt { id: string; x: number; y: number; owner?: string }

/** A sketch with every status a line can show, written into the autosave slot as a reload finds it. */
function statusDesign(): string {
  const points: Record<string, Pt> = {};
  const curves: Record<string, Record<string, unknown>> = {};
  const constraints: Record<string, Record<string, unknown>> = {};
  const dimensions: Record<string, Record<string, unknown>> = {};
  const src = { points: {} as Record<string, Pt>, curves: {} as Record<string, Record<string, unknown>> };
  let n = 10;
  const line = (target: { points: Record<string, Pt>; curves: Record<string, Record<string, unknown>> }, name: string, a: Xy, b: Xy, extra: Record<string, unknown> = {}, layer = 'layer-1'): string => {
    const pa = `p${n++}`;
    const pb = `p${n++}`;
    target.points[pa] = { id: pa, x: a.x, y: a.y, owner: name };
    target.points[pb] = { id: pb, x: b.x, y: b.y, owner: name };
    target.curves[name] = { id: name, type: 'line', lineType: 'normal', layer, a: pa, b: pb, ...extra };
    return name;
  };
  const here = { points, curves };
  const k = (type: string, refs: string[], extra: Record<string, unknown> = {}): void => {
    const id = `k${n++}`;
    constraints[id] = { id, type, refs, ...extra };
  };
  const d = (name: string, refs: string[], value: number, label: Xy): void => {
    const id = `dim${n++}`;
    dimensions[id] = { id, kind: 'distance', refs, name, expression: `${value} mm`, value, driving: true, label };
  };
  const pt = (name: string, end: 'a' | 'b'): string => (curves[name] as Record<'a' | 'b', string>)[end];

  // Fully constrained: on the origin, horizontal, one length.
  line(here, 'constrained', { x: 0, y: 0 }, { x: 40, y: 0 });
  k('coincident', [pt('constrained', 'a'), 'origin']);
  k('horizontal', ['constrained']);
  d('d1', [pt('constrained', 'a'), pt('constrained', 'b')], 40, { x: 20, y: -6 });
  // Fully constrained construction: black in Light, near-white in Dark, still dashed.
  line(here, 'constructed', { x: 0, y: 0 }, { x: 0, y: 30 }, { lineType: 'construction' });
  k('coincident', [pt('constructed', 'a'), 'origin']);
  k('vertical', ['constructed']);
  d('d2', [pt('constructed', 'a'), pt('constructed', 'b')], 30, { x: -6, y: 15 });
  // Under-constrained, and a free construction line.
  line(here, 'free', { x: -60, y: 10 }, { x: -30, y: 25 });
  line(here, 'freeConstruction', { x: -60, y: 40 }, { x: -20, y: 50 }, { lineType: 'construction' });
  // Over-constrained: two different lengths on one line.
  line(here, 'over', { x: 20, y: -30 }, { x: 60, y: -30 });
  k('horizontal', ['over']);
  d('d3', [pt('over', 'a'), pt('over', 'b')], 40, { x: 40, y: -36 });
  d('d4', [pt('over', 'a'), pt('over', 'b')], 46, { x: 40, y: -24 });
  // Fixed.
  line(here, 'fixed', { x: 50, y: 20 }, { x: 80, y: 40 }, { fixed: true });
  // Projected from the other sketch.
  line(src, 'source', { x: -80, y: -45 }, { x: -30, y: -45 });
  line(here, 'projected', { x: -80, y: -45 }, { x: -30, y: -45 }, { projected: { sketchId: 's1', curveId: 'source' } });
  // A second layer, with a line joined to the first across layers.
  line(here, 'template', { x: 60, y: 60 }, { x: 90, y: 75 }, {}, 'layer-2');
  line(here, 'joined', { x: 60, y: 60 }, { x: 45, y: 70 });
  k('coincident', [pt('joined', 'a'), pt('template', 'a')], { dependentLayer: 'layer-1' });

  const sketch = (id: string, name: string, p: Record<string, Pt>, c: Record<string, unknown>, ks = {}, ds = {}): unknown => ({
    id, name, plane: 'XY', visible: true, points: p, curves: c, constraints: ks, dimensions: ds, features: {},
  });
  return JSON.stringify({
    version: 2, name: 'States', order: ['s1', 's2'], parameters: [], units: 'mm', nextId: n + 1,
    layers: [
      { id: 'layer-1', name: 'Layer 1', color: '#5f7186', visible: true, locked: false },
      { id: 'layer-2', name: 'Template', color: '#1b2a5a', visible: true, locked: false },
    ],
    activeLayer: 'layer-1',
    sketches: { s1: sketch('s1', 'Source', src.points, src.curves), s2: sketch('s2', 'Sketch2', points, curves, constraints, dimensions) },
  });
}

const openStates = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  await page.evaluate((text) => localStorage.setItem('sketch.autosave', text), statusDesign());
  await page.reload();
  await page.waitForFunction(() => !!window.__sketch);
  await page.locator('.sketch-row').nth(1).dblclick();
  await u.press('F6');
  return u;
};

const looks = (page: Page, id: string): Promise<{ color: string; dash: number[] } | null> =>
  page.evaluate((c) => window.__sketch.appearance(c), id);

test.describe('the canvas', () => {
  for (const theme of ['light', 'dark'] as Theme[]) {
    test(`every line status has its ${theme} colour: constrained, free, over-constrained, construction, projected, fixed, other layer`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      const u = await openStates(page);
      expect(await themeOf(page)).toBe(theme);
      const p = palette(theme);
      expect((await looks(page, 'constrained'))?.color).toBe(p.constrained);
      expect((await looks(page, 'free'))?.color).toBe(p.free);
      expect((await looks(page, 'over'))?.color).toBe(p.error);
      expect((await looks(page, 'freeConstruction'))?.color).toBe(p.construction);
      expect((await looks(page, 'projected'))?.color).toBe(p.projected);
      expect((await looks(page, 'fixed'))?.color).toBe(p.fixed);
      // Fully constrained construction is the constrained colour and keeps its dashes.
      const built = await looks(page, 'constructed');
      expect(built?.color).toBe(p.constrained);
      expect(built?.dash.length).toBeGreaterThan(0);
      // Another layer is its own colour, lightened in Dark only where it would not be seen.
      const other = (await looks(page, 'template'))?.color as string;
      if (theme === 'light') expect(other).toBe('#1b2a5a');
      else expect(other).not.toBe('#1b2a5a');
      await u.settle();
    });
  }

  test('Light is the colours it always was', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openStates(page);
    expect([
      (await looks(page, 'constrained'))?.color, (await looks(page, 'free'))?.color, (await looks(page, 'over'))?.color,
      (await looks(page, 'freeConstruction'))?.color, (await looks(page, 'projected'))?.color, (await looks(page, 'fixed'))?.color,
    ]).toEqual(['#111111', '#0a84d6', '#d9272e', '#e8730c', '#8a3fc7', '#1a9e4b']);
    expect(await canvasBackground(page)).toEqual([0xf6, 0xf7, 0xf8]);
  });

  test('a theme change redraws every line, glyph and dimension at once', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const u = await openStates(page);
    expect((await looks(page, 'constrained'))?.color).toBe('#111111');
    await choose(page, 'Dark');
    expect((await looks(page, 'constrained'))?.color).toBe(palette('dark').constrained);
    expect(await canvasBackground(page)).toEqual(rgb(palette('dark').background));
    await choose(page, 'Light');
    expect((await looks(page, 'constrained'))?.color).toBe('#111111');
    expect(await canvasBackground(page)).toEqual(rgb(palette('light').background));
    await u.settle();
  });

  test('the cross-layer glyph is drawn with its Dark fill', async ({ page }) => {
    for (const theme of ['light', 'dark'] as Theme[]) {
      await page.emulateMedia({ colorScheme: theme });
      const u = await openStates(page);
      const badge = (await page.evaluate(() => window.__sketch.badges())).find((b) => b.cross);
      expect(badge).toBeTruthy();
      const { x, y } = badge as { x: number; y: number };
      // Inside the badge, clear of its symbol and notch.
      const at = await page.evaluate(([bx, by]) => {
        const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement;
        const g = canvas.getContext('2d') as CanvasRenderingContext2D;
        return Array.from(g.getImageData(Math.round(bx) - 5, Math.round(by) + 5, 1, 1).data).slice(0, 3);
      }, [x, y]);
      expect(at).toEqual(rgb(palette(theme).badgeCrossFill));
      await u.settle();
    }
  });

  test('a layer colour is drawn lighter in Dark when too dark to read, and the stored colour, the swatch and the file do not change', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const u = await openStates(page);
    const swatch = page.locator('.layer-row', { hasText: 'Template' }).locator('.layer-swatch');
    expect(await swatch.inputValue()).toBe('#1b2a5a');
    const drawn = (await looks(page, 'template'))?.color as string;
    expect(drawn).not.toBe('#1b2a5a');
    // It reads against the canvas now.
    const [r, g, b] = rgb(drawn);
    const lin = (v: number): number => ((v / 255) <= 0.03928 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4);
    const lum = (c: number[]): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const ratio = (lum([r, g, b]) + 0.05) / (lum(rgb(palette('dark').background)) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(3);
    // The hue is the layer's own: blue stays blue.
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    expect(await swatch.inputValue()).toBe('#1b2a5a');
    expect((await u.design()).layers.map((l) => l.color)).toEqual(['#5f7186', '#1b2a5a']);
    // A layer colour that already reads is drawn as it is.
    await page.locator('.layer-row', { hasText: 'Template' }).locator('.layer-swatch').fill('#e64980');
    await u.settle();
    expect((await looks(page, 'template'))?.color).toBe('#e64980');
  });
});

// ---------------------------------------------------------------------------
// The DOM

test.describe('the interface', () => {
  test('every surface reads its colours from the tokens: ribbon, panels, menus, dialogs, fields and tooltips', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const u = await openStates(page);
    const p = tokens.dark;
    const colour = async (selector: string, prop: 'backgroundColor' | 'color' | 'borderTopColor'): Promise<string> =>
      page.locator(selector).first().evaluate((el, name) => getComputedStyle(el)[name as 'color'], prop);
    const same = (css: string, hex: string): void => expect(css).toBe(`rgb(${rgb(hex).join(', ')})`);

    same(await colour('.topbar', 'backgroundColor'), p['--panel']);
    same(await colour('.titlebar', 'backgroundColor'), p['--panel-2']);
    same(await colour('.statusbar', 'backgroundColor'), p['--panel-2']);
    same(await colour('.stage', 'backgroundColor'), p['--c-background']);
    same(await colour('.tab.active', 'color'), p['--accent']);
    same(await colour('.palette-head', 'backgroundColor'), p['--head']);
    same(await colour('.browser-head', 'backgroundColor'), p['--head']);
    same(await colour('.layers-head', 'backgroundColor'), p['--head']);
    same(await colour('.palette input[type="number"], .palette select, .layer-name', 'color'), p['--ink']);

    // A menu, a dialog and a value box.
    await page.locator('[data-menu="file"]').click();
    same(await colour('.popup-menu', 'backgroundColor'), p['--panel']);
    await page.locator('.menu-item[data-item="Print..."]').click();
    await u.settle();
    same(await colour('.dialog', 'backgroundColor'), p['--panel']);
    same(await colour('.dialog-head', 'backgroundColor'), p['--head']);
    same(await colour('.dialog select', 'backgroundColor'), p['--field']);
    same(await colour('.dialog .btn.primary', 'backgroundColor'), p['--primary']);
    await page.locator('.dialog .btn', { hasText: 'Cancel' }).click();
    await u.press('l');
    await u.click({ x: 0, y: 70 });
    await u.move({ x: 30, y: 70 });
    await expect(page.locator('.hud-field').first()).toBeVisible();
    expect(await colour('.hud-field', 'backgroundColor')).toBe('rgba(31, 35, 40, 0.94)');
    await expect(page.locator('.cursor-tip')).toBeVisible();
    expect(await colour('.cursor-tip', 'backgroundColor')).toBe('rgba(38, 43, 49, 0.94)');
    await u.press('Escape');
    await u.press('Escape');
  });

  test('icons follow the theme: no icon keeps a Light colour', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openStates(page);
    const svgs = await page.locator('.tool-btn svg').evaluateAll((all) => all.map((s) => s.outerHTML));
    expect(svgs.length).toBeGreaterThan(10);
    for (const s of svgs) expect(s).not.toMatch(/#[0-9a-f]{3,6}/i);
    // The line icon's stroke resolves to the Dark blue.
    const stroke = await page.locator('.tool-btn[data-tool="line"] path').first().evaluate((el) => getComputedStyle(el).stroke);
    expect(stroke).toBe(`rgb(${rgb(tokens.dark['--ic-blue']).join(', ')})`);
  });
});

// ---------------------------------------------------------------------------
// Output is the same in either theme

async function exportScene(page: Page): Promise<SketchUser> {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  const line = async (a: Xy, b: Xy): Promise<void> => {
    await u.press('l');
    await u.click(a);
    await u.click(b);
    await u.press('Escape');
    await u.press('Escape');
  };
  await line({ x: 10, y: 10 }, { x: 60, y: 30 });
  await page.locator('[data-action="add-layer"]').click();
  await u.settle();
  const added = page.locator('.layer-row.active');
  await added.locator('.layer-name').dblclick();
  await added.locator('.layer-rename').fill('Navy');
  await page.keyboard.press('Enter');
  await u.settle();
  await page.locator('.layer-row.active .layer-swatch').fill('#1b2a5a');
  await u.settle();
  await line({ x: 10, y: 40 }, { x: 60, y: 60 });
  await u.press('c');
  await u.click({ x: 90, y: 30 });
  await u.click({ x: 110, y: 30 });
  await u.press('Escape');
  await u.press('Escape');
  await u.press('d');
  await u.click({ x: 35, y: 50 });
  await u.click({ x: 35, y: 70 });
  await page.keyboard.press('Enter');
  await u.settle();
  await u.press('Escape');
  await u.press('Escape');
  return u;
}

async function save(page: Page, kind: 'svg' | 'dxf'): Promise<string> {
  const u = new SketchUser(page);
  await page.locator('.sketch-row').click({ button: 'right' });
  await page.locator(`.popup-menu [data-item="${kind === 'svg' ? 'Save as SVG' : 'Export DXF'}"]`).click();
  await u.settle();
  const dialog = page.locator(`.dialog[data-dialog="${kind === 'svg' ? 'Save as SVG' : 'Export DXF'}"]`);
  for (const label of ['Points', 'Projected Geometry', 'Construction Geometry', 'Include Dimensions']) {
    const box = dialog.locator('.form-row', { hasText: label }).locator('input[type="checkbox"]');
    if (await box.count()) await box.first().check();
  }
  await dialog.getByRole('button', { name: 'OK' }).click();
  await u.settle();
  const waiting = page.waitForEvent('download');
  await page.locator('.dialog[data-dialog="Save SVG"], .dialog[data-dialog="Save DXF"]').getByRole('button', { name: 'Save' }).click();
  return readFileSync(await (await waiting).path(), 'utf8');
}

test.describe('SVG, DXF and Print do not depend on the theme', () => {
  test('SVG and DXF exported from Light, Dark, and System under a dark OS are the same bytes, in true colours', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await exportScene(page);
    await choose(page, 'Light');
    const lightSvg = await save(page, 'svg');
    const lightDxf = await save(page, 'dxf');
    await choose(page, 'Dark');
    expect(await themeOf(page)).toBe('dark');
    const darkSvg = await save(page, 'svg');
    const darkDxf = await save(page, 'dxf');
    await choose(page, 'System');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => themeOf(page)).toBe('dark');
    const systemSvg = await save(page, 'svg');

    expect(lightSvg.length).toBeGreaterThan(500);
    expect(lightDxf.length).toBeGreaterThan(500);
    expect(darkSvg).toBe(lightSvg);
    expect(darkDxf).toBe(lightDxf);
    expect(systemSvg).toBe(lightSvg);
    // True colours: the layer's own, and the Light status colours nowhere.
    expect(lightSvg).toContain('stroke="#1b2a5a"');
    expect(lightSvg).toContain('stroke="#5f7186"');
    for (const hex of Object.values(tokens.dark).filter((v) => /^#[0-9a-f]{6}$/i.test(v) && !Object.values(tokens.light).includes(v))) {
      expect(lightSvg.toLowerCase()).not.toContain(hex.toLowerCase());
    }
  });

  test('the print page is white paper with the same pages in either theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const u = await exportScene(page);
    const printed = async (): Promise<{ html: string; shot: Buffer; bg: string; scheme: string }> => {
      await page.evaluate(() => { window.print = () => undefined; });
      await page.locator('[data-menu="file"]').click();
      await page.locator('.menu-item[data-item="Print..."]').click();
      await u.settle();
      await page.locator('.dialog[data-dialog="Print 1:1"]').getByRole('button', { name: 'Print' }).click();
      await u.settle();
      const html = await page.locator('#print-root').evaluate((el) => el.innerHTML);
      await page.emulateMedia({ media: 'print' });
      const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 600, height: 700 } });
      const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
      const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
      await page.emulateMedia({ media: 'screen' });
      return { html, shot, bg, scheme };
    };
    await choose(page, 'Light');
    const light = await printed();
    await choose(page, 'Dark');
    expect(await themeOf(page)).toBe('dark');
    const dark = await printed();

    expect(dark.html).toBe(light.html);
    expect(dark.html).toContain('class="print-page"');
    expect(dark.bg).toBe('rgb(255, 255, 255)');
    expect(dark.scheme).toBe('light');
    expect(dark.shot.equals(light.shot)).toBe(true);
    // The pixels are paper: the corner of the page is white.
    expect(dark.html).toContain('fill="#fff"');
  });
});
