// Min Distance on the status bar, through real mouse and keyboard. Numbers are checked against the document
// read back from window.__sketch and worked out here from the plain geometry, not from the app's own module.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SketchUser, pointAt, type Xy } from './helpers';
import type { Arc, Circle, Id, Line, Sketch } from '../src/model/types';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { errors: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

const start = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  return u;
};

const exitTool = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};

const readout = (page: Page): Locator => page.locator('.status-measure');
const text = async (page: Page): Promise<string> => (await readout(page).textContent()) ?? '';
const mm = (d: number): string => `Min Distance: ${d.toFixed(2)} mm`;
const selection = (u: SketchUser): Promise<Id[]> => u.page.evaluate(() => window.__sketch.selection);
const runs = (u: SketchUser): Promise<number> => u.page.evaluate(() => window.__sketch.minDistanceRuns);
const frames = (u: SketchUser): Promise<number> => u.page.evaluate(() => window.__sketch.frames);

async function line(u: SketchUser, a: Xy, b: Xy): Promise<Line> {
  const before = new Set((await u.lines()).map((l) => l.id));
  await u.press('l');
  await u.click(a);
  await u.click(b);
  await exitTool(u);
  return (await u.lines()).find((l) => !before.has(l.id)) as Line;
}

async function circle(u: SketchUser, c: Xy, r: number): Promise<Circle> {
  await u.press('c');
  await u.click(c);
  await u.click({ x: c.x + r, y: c.y });
  await exitTool(u);
  return (await u.curves('circle')).at(-1) as Circle;
}

async function points(u: SketchUser, ...at: Xy[]): Promise<void> {
  await u.tool('Point');
  for (const p of at) await u.click(p);
  await exitTool(u);
}

/** A tool from the Create menu, as a user would, through its flyout. */
async function pickTool(u: SketchUser, label: string, flyout?: string): Promise<void> {
  await u.page.getByRole('button', { name: /^CREATE/ }).click();
  if (flyout) await u.page.locator(`.menu-item.flyout[data-item="${flyout}"]`).hover();
  await u.page.locator(`.menu-item[data-item="${label}"]`).click();
  await u.settle();
}

/** A command from the Modify panel. */
async function modify(u: SketchUser, label: string): Promise<void> {
  await u.page.locator('.panel[data-panel="modify"] .panel-name').click();
  await u.page.locator(`.menu-item[data-item="${label}"]`).click();
  await u.settle();
}

/** Click the first object, Shift-click the rest. */
async function pick(u: SketchUser, ...at: Xy[]): Promise<void> {
  await u.click(at[0]);
  for (const p of at.slice(1)) await u.click(p, { shift: true });
}

const gapLineCircle = (s: Sketch, l: Line, c: Circle): number => {
  // A horizontal line clear of the circle: the vertical gap from the centre, less the radius.
  const a = pointAt(s, l.a);
  const m = pointAt(s, c.c);
  return Math.abs(a.y - m.y) - c.r;
};

// ---------------------------------------------------------------------------

test.describe('the readout', () => {
  test('a line and a circle: the gap to the rim', async ({ page }) => {
    const u = await start(page);
    const l = await line(u, { x: -40, y: 50 }, { x: 40, y: 50 });
    const c = await circle(u, { x: 0, y: 0 }, 30);
    await expect(readout(page)).toHaveText('');
    await pick(u, { x: 20, y: 50 }, { x: 0, y: -30 });
    expect((await selection(u)).sort()).toEqual([l.id, c.id].sort());
    const s = await u.sketch();
    expect(gapLineCircle(s, s.curves[l.id] as Line, s.curves[c.id] as Circle)).toBeCloseTo(20, 1);
    await expect(readout(page)).toHaveText(mm(gapLineCircle(s, s.curves[l.id] as Line, s.curves[c.id] as Circle)));
    // It sits with the rest of the bar: the prompt and the state are still there.
    await expect(page.locator('.status-prompt')).not.toHaveText('');
    await expect(page.locator('.status-state')).toContainText('Constrained');
  });

  test('it is the same whichever was picked first', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 50 }, { x: 40, y: 50 });
    await circle(u, { x: 0, y: 0 }, 30);
    await pick(u, { x: 20, y: 50 }, { x: 0, y: -30 });
    const first = await text(page);
    await u.press('Escape');
    await expect(readout(page)).toHaveText('');
    await pick(u, { x: 0, y: -30 }, { x: 20, y: 50 });
    expect(await text(page)).toBe(first);
  });

  test('two points', async ({ page }) => {
    const u = await start(page);
    await points(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await pick(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await expect(readout(page)).toHaveText(mm(50));
  });

  test('a line that stops short of a circle measures from its end', async ({ page }) => {
    const u = await start(page);
    // The line's extension would pass through the circle; the line itself ends 25 short of the rim.
    await line(u, { x: 55, y: 0 }, { x: 90, y: 0 });
    await circle(u, { x: 0, y: 0 }, 30);
    await pick(u, { x: 70, y: 0 }, { x: 0, y: 30 });
    await expect(readout(page)).toHaveText(mm(25));
  });

  test('an arc is its sweep: the full circle would be nearer', async ({ page }) => {
    const u = await start(page);
    await points(u, { x: -50, y: 0 });
    // A 3 Point Arc through (40, 0), from (0, 40) to (0, -40): the right half of a circle of radius 40.
    await pickTool(u, '3-Point Arc', 'Arc');
    await u.click({ x: 0, y: 40 });
    await u.click({ x: 0, y: -40 });
    await u.click({ x: 40, y: 0 });
    await exitTool(u);
    const s = await u.sketch();
    const arc = Object.values(s.curves).find((c): c is Arc => c.type === 'arc') as Arc;
    expect(arc).toBeTruthy();
    const c = pointAt(s, arc.c);
    const r = Math.hypot(pointAt(s, arc.a).x - c.x, pointAt(s, arc.a).y - c.y);
    // The point is on the far side: the circle is a few mm away, the arc's nearer end is 64 mm away.
    const fullCircle = Math.abs(Math.hypot(-50 - c.x, -c.y) - r);
    const ends = Math.min(...[arc.a, arc.b].map((p) => Math.hypot(pointAt(s, p).x + 50, pointAt(s, p).y)));
    expect(fullCircle).toBeLessThan(11);
    expect(ends).toBeGreaterThan(60);
    await pick(u, { x: -50, y: 0 }, { x: 40, y: 0 });
    await expect(readout(page)).toHaveText(mm(ends));
  });

  test('crossing, touching and a point on a curve are 0', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: -40 }, { x: 40, y: 40 });
    await line(u, { x: -40, y: 40 }, { x: 40, y: -40 });
    await pick(u, { x: -20, y: -20 }, { x: -20, y: 20 });
    await expect(readout(page)).toHaveText(mm(0));
    await circle(u, { x: 0, y: 30 }, 20);
    // A line inside the circle: the gap to the rim, not 0. Picked off the centre, which is a point of its own.
    await line(u, { x: -12, y: 30 }, { x: 12, y: 30 });
    await pick(u, { x: 7, y: 30 }, { x: 0, y: 50 });
    const now = await u.sketch();
    const [inner] = Object.values(now.curves).filter((x): x is Line => x.type === 'line').slice(-1);
    const rim = Object.values(now.curves).find((x): x is Circle => x.type === 'circle') as Circle;
    const centre = pointAt(now, rim.c);
    const far = Math.max(...[inner.a, inner.b].map((p) => Math.hypot(pointAt(now, p).x - centre.x, pointAt(now, p).y - centre.y)));
    expect(rim.r - far).toBeGreaterThan(7);
    await expect(readout(page)).toHaveText(mm(rim.r - far));
  });

  test('concentric circles give the difference of the radii', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: 0, y: 0 }, 30);
    await circle(u, { x: 0, y: 0 }, 50);
    await pick(u, { x: 30, y: 0 }, { x: 50, y: 0 });
    await expect(readout(page)).toHaveText(mm(20));
  });
});

test.describe('when it shows and when it clears', () => {
  test('a third object clears it, taking one away brings none, and Escape clears it', async ({ page }) => {
    const u = await start(page);
    await points(u, { x: 10, y: 10 }, { x: 40, y: 50 }, { x: 80, y: 10 });
    await pick(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await expect(readout(page)).toHaveText(mm(50));
    await u.click({ x: 80, y: 10 }, { shift: true });
    expect((await selection(u)).length).toBe(3);
    await expect(readout(page)).toHaveText('');
    // Shift-click it again: two are selected, and the readout is back.
    await u.click({ x: 80, y: 10 }, { shift: true });
    await expect(readout(page)).toHaveText(mm(50));
    await u.click({ x: 40, y: 50 }, { shift: true });
    expect((await selection(u)).length).toBe(1);
    await expect(readout(page)).toHaveText('');
    await u.click({ x: 40, y: 50 }, { shift: true });
    await expect(readout(page)).toHaveText(mm(50));
    await u.press('Escape');
    expect((await selection(u)).length).toBe(0);
    await expect(readout(page)).toHaveText('');
  });

  test('a window around two objects shows it, and so does clicking away to clear it', async ({ page }) => {
    const u = await start(page);
    await points(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await u.drag({ x: -10, y: -10 }, { x: 60, y: 70 });
    expect((await selection(u)).length).toBe(2);
    await expect(readout(page)).toHaveText(mm(50));
    await u.click({ x: -60, y: -60 });
    await expect(readout(page)).toHaveText('');
  });

  test('leaving the sketch clears it, and it hides in design mode', async ({ page }) => {
    const u = await start(page);
    await points(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await pick(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await expect(readout(page)).toHaveText(mm(50));
    await page.locator('[data-action="palette-finish"]').click();
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.mode)).toBe('design');
    await expect(readout(page)).toHaveText('');
    await expect(readout(page)).toBeHidden();
  });

  test('text and a dimension in the selection give none', async ({ page }) => {
    const u = await start(page);
    await points(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await u.press('d');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 40, y: 50 });
    await u.click({ x: 40, y: 20 });
    await page.keyboard.press('Enter');
    await u.settle();
    await exitTool(u);
    const s = await u.sketch();
    const dim = Object.values(s.dimensions)[0];
    expect(dim).toBeTruthy();
    await pick(u, { x: 10, y: 10 }, dim.label);
    expect((await selection(u)).length).toBe(2);
    await expect(readout(page)).toHaveText('');
  });
});

test.describe('live', () => {
  test('it follows a drag, and Undo and Redo', async ({ page }) => {
    const u = await start(page);
    const l = await line(u, { x: -40, y: 50 }, { x: 40, y: 50 });
    await circle(u, { x: 0, y: 0 }, 30);
    await pick(u, { x: 20, y: 50 }, { x: 0, y: -30 });
    await expect(readout(page)).toHaveText(mm(20));
    // Drag the line's end point, which is not selected, down towards the circle.
    const end = pointAt(await u.sketch(), l.b);
    const from = await u.screen(end);
    const to = await u.screen({ x: end.x, y: 45 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await u.settle();
    // Mid-drag, the mouse still down: the line has tilted, and the readout has followed the geometry.
    const mid = await u.sketch();
    const b = pointAt(mid, l.b);
    const a = pointAt(mid, l.a);
    const gap = nearestOnSegmentToCircle(a, b, { x: 0, y: 0 }, 30);
    expect(gap).toBeLessThan(20 - 1);
    await expect(readout(page)).toHaveText(mm(gap));
    await page.mouse.up();
    await u.settle();
    await expect(readout(page)).toHaveText(mm(gap));
    // Undo puts the line back and the readout with it; Redo brings both forward again.
    await u.press('Control+z');
    await expect(readout(page)).toHaveText(mm(20));
    await u.press('Control+Shift+z');
    await expect(readout(page)).toHaveText(mm(gap));
  });

  test('it is worked out once per change, not per mouse move or per frame', async ({ page }) => {
    const u = await start(page);
    const l = await line(u, { x: -40, y: 50 }, { x: 40, y: 50 });
    await circle(u, { x: 0, y: 0 }, 30);
    await points(u, { x: 60, y: -20 });
    await u.click({ x: -20, y: 50 });
    const base = await runs(u);
    await u.click({ x: 0, y: -30 }, { shift: true });
    expect(await runs(u)).toBe(base + 1);
    // The mouse wandering over the canvas, with frames drawn, costs nothing.
    const f0 = await frames(u);
    for (let i = 0; i < 15; i++) await u.move({ x: -60 + i * 8, y: -20 + i * 3 });
    await u.settle();
    expect(await frames(u)).toBeGreaterThan(f0);
    expect(await runs(u)).toBe(base + 1);
    // One, three or none selected: not worked out. The same two picked again with nothing moved: nothing new.
    await u.click({ x: 60, y: -20 }, { shift: true });
    expect((await selection(u)).length).toBe(3);
    await u.click({ x: 60, y: -20 }, { shift: true });
    await u.click({ x: 0, y: -30 }, { shift: true });
    expect((await selection(u)).length).toBe(1);
    await u.press('Escape');
    await u.click({ x: 0, y: -30 });
    await u.click({ x: -20, y: 50 }, { shift: true });
    await expect(readout(page)).toHaveText(mm(20));
    expect(await runs(u)).toBe(base + 1);
    // A drag of 20 mouse events draws a frame at a time: never more runs than frames.
    const end = pointAt(await u.sketch(), l.b);
    const from = await u.screen(end);
    const f1 = await frames(u);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(from.x + i, from.y + i * 2);
    await u.settle();
    await page.mouse.up();
    await u.settle();
    const used = (await runs(u)) - (base + 1);
    expect(used).toBeGreaterThanOrEqual(1);
    expect(used).toBeLessThanOrEqual((await frames(u)) - f1 + 1);
  });

  test('a value changed through a dimension moves it', async ({ page }) => {
    const u = await start(page);
    await points(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await u.press('d');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 40, y: 50 });
    await u.click({ x: 30, y: 20 });
    await page.keyboard.press('Enter');
    await u.settle();
    await exitTool(u);
    await pick(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await expect(readout(page)).toHaveText(mm(50));
    // Change Parameters with both still selected: the readout is behind the dialog, and follows the new value.
    await modify(u, 'Change Parameters');
    const d = u.page.locator('.dialog[data-dialog="Parameters"]');
    const expression = d.locator('.param-row[data-param="d1"] input').nth(1);
    await expression.fill('72.5');
    await expression.blur();
    await d.locator('.btn.primary').click();
    await u.settle();
    expect(Object.values((await u.sketch()).dimensions)[0].value).toBeCloseTo(72.5, 6);
    expect((await selection(u)).length).toBe(2);
    await expect(readout(page)).toHaveText(mm(72.5));
    await u.press('Control+z');
    await expect(readout(page)).toHaveText(mm(50));
  });

  test('a value typed into the dimension itself shows once the two are picked again', async ({ page }) => {
    const u = await start(page);
    await points(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await u.press('d');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 40, y: 50 });
    await u.click({ x: 30, y: 20 });
    await page.keyboard.press('Enter');
    await u.settle();
    await exitTool(u);
    const dim = Object.values((await u.sketch()).dimensions)[0];
    // Double-clicking the label selects the dimension, so the two points are no longer the selection.
    await u.doubleClick(dim.label);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('30');
    await page.keyboard.press('Enter');
    await u.settle();
    await expect(readout(page)).toHaveText('');
    const s = await u.sketch();
    const [p, q] = Object.values(s.points).filter((x) => x.explicit);
    await pick(u, p, q);
    await expect(readout(page)).toHaveText(mm(30));
  });

  test('a tangent dimension between a circle and a line is the gap it holds', async ({ page }) => {
    const u = await start(page);
    const l = await line(u, { x: -50, y: -40 }, { x: 50, y: -40 });
    const c = await circle(u, { x: 0, y: 0 }, 15);
    await u.press('d');
    await u.click({ x: 20, y: -40 });
    await u.click({ x: 0, y: -15 });
    await u.rightClick({ x: 40, y: 20 });
    await page.locator('.marking-list [data-item="dim-tangent"]').click();
    await u.settle();
    await u.click({ x: 40, y: 20 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('10');
    await u.press('Enter');
    await exitTool(u);
    const dim = Object.values((await u.sketch()).dimensions).find((x) => x.refs.includes(l.id) && x.refs.includes(c.id));
    expect(dim?.kind).toBe('tangentLine');
    // Wherever the solver left them: the line is picked on itself, the circle on its rim.
    const now = await u.sketch();
    const circ = now.curves[c.id] as Circle;
    const mid = pointAt(now, circ.c);
    await pick(u, { x: 20, y: pointAt(now, l.a).y }, { x: mid.x, y: mid.y - circ.r });
    await expect(readout(page)).toHaveText(mm(10));
    await modify(u, 'Change Parameters');
    const d = u.page.locator('.dialog[data-dialog="Parameters"]');
    const expression = d.locator('.param-row[data-param="d1"] input').nth(1);
    await expression.fill('4');
    await expression.blur();
    await d.locator('.btn.primary').click();
    await u.settle();
    await expect(readout(page)).toHaveText(mm(4));
  });
});

test.describe('layers', () => {
  const addLayer = async (u: SketchUser, name: string): Promise<void> => {
    await u.page.locator('[data-action="add-layer"]').click();
    await u.settle();
    const added = u.page.locator('.layer-row.active');
    await added.locator('.layer-name').dblclick();
    await added.locator('.layer-rename').fill(name);
    await u.page.keyboard.press('Enter');
    await u.settle();
  };
  const activate = async (u: SketchUser, name: string): Promise<void> => {
    await u.page.locator('.layer-row', { hasText: name }).locator('.layer-name').click();
    await u.settle();
  };

  test('an object on another layer cannot be picked, so it cannot be measured', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: 0, y: 0 }, 30);
    await addLayer(u, 'Work');
    const l = await line(u, { x: -40, y: 50 }, { x: 40, y: 50 });
    await u.click({ x: 20, y: 50 });
    // The click on the circle goes through to nothing, and with Shift it changes nothing.
    await u.click({ x: 0, y: -30 }, { shift: true });
    expect(await selection(u)).toEqual([l.id]);
    await expect(readout(page)).toHaveText('');
    // Select All takes the active layer only: one object.
    await u.press('Escape');
    await page.keyboard.press('ControlOrMeta+a');
    await u.settle();
    expect(await selection(u)).toEqual([l.id]);
    await expect(readout(page)).toHaveText('');
    // Two on the active layer, and it shows; moving to the other layer drops it.
    await points(u, { x: 70, y: 70 });
    await pick(u, { x: 20, y: 50 }, { x: 70, y: 70 });
    await expect(readout(page)).toHaveText(mm(Math.hypot(0, 0) + nearPointSegment({ x: 70, y: 70 }, { x: -40, y: 50 }, { x: 40, y: 50 })));
    await activate(u, 'Layer 1');
    await expect(readout(page)).toHaveText('');
  });

  test('a locked layer cannot be selected either', async ({ page }) => {
    const u = await start(page);
    await points(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await pick(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await expect(readout(page)).toHaveText(mm(50));
    await page.locator('.layer-row', { hasText: 'Layer 1' }).locator('.layer-lock').click();
    await u.settle();
    expect(await selection(u)).toEqual([]);
    await expect(readout(page)).toHaveText('');
    await pick(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    expect(await selection(u)).toEqual([]);
    await expect(readout(page)).toHaveText('');
    await page.locator('.layer-row', { hasText: 'Layer 1' }).locator('.layer-lock').click();
    await u.settle();
    await pick(u, { x: 10, y: 10 }, { x: 40, y: 50 });
    await expect(readout(page)).toHaveText(mm(50));
  });
});

test.describe('units and themes', () => {
  async function choose(page: Page, choice: 'System' | 'Light' | 'Dark'): Promise<void> {
    await page.locator('[data-menu="file"]').click();
    await page.locator('.menu-item.flyout[data-item="Theme"]').hover();
    await page.locator(`.menu-item[data-item="Theme ${choice}"]`).click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  /** Relative luminance of a CSS colour string, 0 to 1. */
  const luminance = (css: string): number => {
    const [r, g, b] = (css.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((x) => {
      const c = Number(x) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  for (const theme of ['Light', 'Dark'] as const) {
    test(`${theme}: legible against the bar, and the same value`, async ({ page }) => {
      const u = await start(page);
      await choose(page, theme);
      await points(u, { x: 10, y: 10 }, { x: 40, y: 50 });
      await pick(u, { x: 10, y: 10 }, { x: 40, y: 50 });
      await expect(readout(page)).toHaveText(mm(50));
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme.toLowerCase());
      const colours = await page.evaluate(() => {
        const m = getComputedStyle(document.querySelector('.status-measure') as Element);
        const bar = getComputedStyle(document.querySelector('.statusbar') as Element);
        return { ink: m.color, bar: bar.backgroundColor, size: m.fontSize };
      });
      expect(contrast(colours.ink, colours.bar)).toBeGreaterThan(7);
      await u.shot(`min-distance-${theme.toLowerCase()}`);
    });
  }

  test('it reads in the design units', async ({ page }) => {
    const u = new SketchUser(page);
    await u.open();
    // A design in inches, two points 25.4 mm apart along x and 12.7 mm along y.
    const design = {
      version: 1, name: 'Inches', order: ['s1'], parameters: [], units: 'in', nextId: 20,
      sketches: {
        s1: {
          id: 's1', name: 'Sketch1', plane: 'XY', visible: true,
          points: { p1: { id: 'p1', x: 10, y: 0, explicit: true }, p2: { id: 'p2', x: 35.4, y: 12.7, explicit: true } },
          curves: {}, constraints: {}, dimensions: {}, features: {},
        },
      },
    };
    await page.evaluate((t) => localStorage.setItem('sketch.autosave', t), JSON.stringify(design));
    await page.reload();
    await page.waitForFunction(() => !!window.__sketch);
    await page.locator('.sketch-row').dblclick();
    await u.settle();
    await pick(u, { x: 10, y: 0 }, { x: 35.4, y: 12.7 });
    await expect(readout(page)).toHaveText(`Min Distance: ${(Math.hypot(25.4, 12.7) / 25.4).toFixed(3)} in`);
  });
});

test.describe('the bar does not shift', () => {
  for (const size of [{ width: 1440, height: 900 }, { width: 1100, height: 700 }, { width: 900, height: 600 }]) {
    test(`at ${size.width} x ${size.height}: the other items keep their place and nothing overflows`, async ({ page }) => {
      await page.setViewportSize(size);
      const u = await start(page);
      // Below the middle: at 900 x 600 the ViewCube is over (40, 50).
      await points(u, { x: 10, y: 10 }, { x: 40, y: -30 });
      await u.press('Escape');
      const box = async (sel: string) => page.locator(sel).evaluate((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const before = { state: await box('.status-state'), coords: await box('.status-coords'), measure: await box('.status-measure'), bar: await box('.statusbar') };
      await pick(u, { x: 10, y: 10 }, { x: 40, y: -30 });
      await expect(readout(page)).toHaveText(mm(50));
      const after = { state: await box('.status-state'), coords: await box('.status-coords'), measure: await box('.status-measure'), bar: await box('.statusbar') };
      expect(after.state).toEqual(before.state);
      expect(after.coords).toEqual(before.coords);
      expect(after.bar).toEqual(before.bar);
      // Empty it has no height of its own, so its top moves; where it sits across and how wide it is does not.
      expect([after.measure.x, after.measure.w]).toEqual([before.measure.x, before.measure.w]);
      const fits = await page.evaluate(() => {
        const bar = document.querySelector('.statusbar') as HTMLElement;
        const m = document.querySelector('.status-measure') as HTMLElement;
        return { barOverflow: bar.scrollWidth - bar.clientWidth, textOverflow: m.scrollWidth - m.clientWidth };
      });
      expect(fits.barOverflow).toBeLessThanOrEqual(0);
      expect(fits.textOverflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('a big sketch', () => {
  /** n short lines in a grid on the left and two long ones clear of it on the right, written into the autosave slot. */
  function bigDesign(n: number): string {
    const points: Record<string, unknown> = {};
    const curves: Record<string, unknown> = {};
    let id = 10;
    const add = (name: string, ax: number, ay: number, bx: number, by: number): void => {
      const a = `p${id++}`;
      const b = `p${id++}`;
      points[a] = { id: a, x: ax, y: ay, owner: name };
      points[b] = { id: b, x: bx, y: by, owner: name };
      curves[name] = { id: name, type: 'line', lineType: 'normal', a, b };
    };
    add('longA', 20, -50, 80, -45);
    add('longB', 20, 45, 80, 30);
    for (let i = 0; i < n - 2; i++) {
      const x = -100 + (i % 50) * 1.8;
      const y = -60 + Math.floor(i / 50) * 6;
      add(`l${id}`, x, y, x + 1, y + 2);
    }
    return JSON.stringify({
      version: 1, name: 'Big', order: ['s1'], parameters: [], units: 'mm', nextId: id + 1,
      sketches: { s1: { id: 's1', name: 'Sketch1', plane: 'XY', visible: true, points, curves, constraints: {}, dimensions: {}, features: {} } },
    });
  }

  test('1000 curves: two selected give the right gap, and a drag elsewhere keeps up', async ({ page }) => {
    const u = new SketchUser(page);
    await u.open();
    await page.evaluate((t) => localStorage.setItem('sketch.autosave', t), bigDesign(1000));
    await page.reload();
    await page.waitForFunction(() => !!window.__sketch);
    await page.locator('.sketch-row').dblclick();
    await u.settle();
    const lines = await u.lines();
    expect(lines.length).toBe(1000);
    const s = await u.sketch();
    const [a, b] = ['longA', 'longB'].map((id) => s.curves[id] as Line);
    const at = (l: Line, t: number): Xy => ({
      x: pointAt(s, l.a).x + (pointAt(s, l.b).x - pointAt(s, l.a).x) * t, y: pointAt(s, l.a).y + (pointAt(s, l.b).y - pointAt(s, l.a).y) * t,
    });
    const before = await runs(u);
    await pick(u, at(a, 0.5), at(b, 0.5));
    const want = segmentGap(pointAt(s, a.a), pointAt(s, a.b), pointAt(s, b.a), pointAt(s, b.b));
    expect(want).toBeGreaterThan(70);
    await expect(readout(page)).toHaveText(mm(want));
    expect((await runs(u)) - before).toBe(1);
    // A third line dragged about, 30 events: the readout is not the cost, and it does not move.
    const c = lines[500];
    const from = await u.screen(pointAt(s, c.a));
    const f0 = await frames(u);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const t0 = Date.now();
    for (let i = 1; i <= 30; i++) await page.mouse.move(from.x + i * 2, from.y + i);
    await u.settle();
    const ms = Date.now() - t0;
    await page.mouse.up();
    await u.settle();
    expect(ms / 30).toBeLessThan(66);
    expect((await frames(u)) - f0).toBeGreaterThan(0);
    // Neither of the two moved, so the answer held and nothing was measured again.
    expect((await runs(u)) - before).toBe(1);
    await expect(readout(page)).toHaveText(mm(want));
  });
});

// ---------------------------------------------------------------------------
// Plain geometry for the expected values, kept apart from the module under test.

function nearPointSegment(p: Xy, a: Xy, b: Xy): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

function segmentGap(a0: Xy, a1: Xy, b0: Xy, b1: Xy): number {
  const o = (p: Xy, q: Xy, r: Xy): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (o(a0, a1, b0) * o(a0, a1, b1) < 0 && o(b0, b1, a0) * o(b0, b1, a1) < 0) return 0;
  return Math.min(nearPointSegment(a0, b0, b1), nearPointSegment(a1, b0, b1), nearPointSegment(b0, a0, a1), nearPointSegment(b1, a0, a1));
}

/** Gap from a segment to a circle that it does not reach into, by a fine walk along the segment. */
function nearestOnSegmentToCircle(a: Xy, b: Xy, c: Xy, r: number): number {
  let best = Infinity;
  for (let i = 0; i <= 200000; i++) {
    const t = i / 200000;
    best = Math.min(best, Math.abs(Math.hypot(a.x + (b.x - a.x) * t - c.x, a.y + (b.y - a.y) * t - c.y) - r));
  }
  return best;
}
