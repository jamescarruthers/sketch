// Move/Copy by Point to Point and about a chosen pivot, and the Measure tool for objects on any layer.
// docs/AUDIT.md, round 8.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SketchUser, type Xy } from './helpers';
import { addCircle, addLine, addPoint, newDesign, newSketch } from '../src/model/document';
import { addLayer } from '../src/model/layers';
import { serialize } from '../src/io/project';
import type { Id, Line, Sketch } from '../src/model/types';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { errors: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

const openProject = async (u: SketchUser, content: string): Promise<void> => {
  const [chooser] = await Promise.all([u.page.waitForEvent('filechooser'), (async () => {
    await u.page.locator('[data-menu="file"]').click();
    await u.page.locator('.menu-item[data-item="Open..."]').first().click();
  })()]);
  await chooser.setFiles({ name: 'm.sketch.json', mimeType: 'application/json', buffer: Buffer.from(content, 'utf8') });
  await u.page.waitForTimeout(250);
  await u.page.locator('.sketch-row').first().dblclick();
  await expect(u.page.locator('.tab.active')).toHaveText('SKETCH');
  await u.settle();
};

/**
 * Layer 1 (active): a line from (0,0) to (20,0). "Template" (locked): a line from (60,-30) to (90,-30), a point at
 * (60,-30) and a circle at (10,-60) radius 10. "Hidden": a line at y = -80. All of it inside the canvas, clear of the panels.
 */
const scene = (opts: { lockActive?: boolean } = {}): { text: string; mover: Line } => {
  const d = newDesign('Scene');
  const s = newSketch(d);
  const mover = addLine(d, s, { x: 0, y: 0 }, { x: 20, y: 0 });
  const template = addLayer(d);
  template.name = 'Template';
  addLine(d, s, { x: 60, y: -30 }, { x: 90, y: -30 });
  addCircle(d, s, { x: 10, y: -60 }, 10);
  addPoint(d, s, { x: 60, y: -30 }, { explicit: true });
  const hidden = addLayer(d);
  hidden.name = 'Hidden';
  addLine(d, s, { x: -20, y: -80 }, { x: 60, y: -80 });
  hidden.visible = false;
  template.locked = true;
  d.activeLayer = d.layers[d.layers.length - 1].id;
  if (opts.lockActive) d.layers[d.layers.length - 1].locked = true;
  return { text: serialize(d), mover };
};

const dialog = (u: SketchUser, title: string): Locator => u.page.locator(`.dialog[data-dialog="${title}"]`);
const fieldRow = (d: Locator, label: string): Locator => d.locator('.form-row').filter({ has: d.page().locator(`.form-label:text-is("${label}")`) });
const selection = (u: SketchUser): Promise<Id[]> => u.page.evaluate(() => window.__sketch.selection);
const linesOf = (s: Sketch): { a: Xy; b: Xy }[] => Object.values(s.curves).filter((c): c is Line => c.type === 'line')
  .map((l) => ({ a: { x: s.points[l.a].x, y: s.points[l.a].y }, b: { x: s.points[l.b].x, y: s.points[l.b].y } }));
const near = (p: Xy, q: Xy): boolean => Math.hypot(p.x - q.x, p.y - q.y) < 1e-3;
const hasLine = (s: Sketch, a: Xy, b: Xy): boolean => linesOf(s).some((l) => (near(l.a, a) && near(l.b, b)) || (near(l.a, b) && near(l.b, a)));

test.describe('Move/Copy', () => {
  const start = async (page: Page): Promise<SketchUser> => {
    const u = new SketchUser(page);
    await u.open();
    await openProject(u, scene().text);
    // Only the line on the active layer can be taken into the move.
    await u.click({ x: 10, y: 0 });
    expect(await selection(u)).toHaveLength(1);
    await u.press('m');
    return u;
  };

  const pickPoint = async (u: SketchUser, d: Locator, field: string, at: Xy): Promise<void> => {
    await d.locator(`[data-field="${field}"] .pick-toggle`).click();
    await u.click(at);
  };

  test('Point to Point: a start point and a target on another layer move the selection by that vector, in one Undo step', async ({ page }) => {
    const u = await start(page);
    const d = dialog(u, 'Move/Copy');
    await fieldRow(d, 'Move Type').locator('select').selectOption('point');
    await expect(fieldRow(d, 'X Distance')).toBeHidden();
    await expect(d.locator('.btn.primary')).toBeDisabled();
    await pickPoint(u, d, 'Start Point', { x: 20, y: 0 });
    await pickPoint(u, d, 'Target Point', { x: 60, y: -30 });
    await expect(d.locator('.btn.primary')).toBeEnabled();
    const before = await u.sketch();
    await d.locator('.btn.primary').click();
    await u.settle();
    const s = await u.sketch();
    expect(hasLine(s, { x: 40, y: -30 }, { x: 60, y: -30 })).toBe(true);
    expect(linesOf(s)).toHaveLength(linesOf(before).length);
    // The template layer was only a place to point at: it did not move and nothing was added to it.
    expect(hasLine(s, { x: 60, y: -30 }, { x: 90, y: -30 })).toBe(true);
    expect(Object.keys(s.points).length).toBe(Object.keys(before.points).length);
    await page.keyboard.press('ControlOrMeta+z');
    await u.settle();
    const undone = await u.sketch();
    expect(hasLine(undone, { x: 0, y: 0 }, { x: 20, y: 0 })).toBe(true);
    expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(false);
  });

  test('Create Copy in Point to Point leaves the original and puts a copy at the target', async ({ page }) => {
    const u = await start(page);
    const d = dialog(u, 'Move/Copy');
    await fieldRow(d, 'Move Type').locator('select').selectOption('point');
    await pickPoint(u, d, 'Start Point', { x: 0, y: 0 });
    await pickPoint(u, d, 'Target Point', { x: 60, y: -30 });
    await fieldRow(d, 'Create Copy').locator('input').check();
    await d.locator('.btn.primary').click();
    await u.settle();
    const s = await u.sketch();
    expect(hasLine(s, { x: 0, y: 0 }, { x: 20, y: 0 })).toBe(true);
    expect(hasLine(s, { x: 60, y: -30 }, { x: 80, y: -30 })).toBe(true);
  });

  test('a chosen pivot is what Z Angle turns about; without one it is the centre of the selection', async ({ page }) => {
    const u = await start(page);
    const d = dialog(u, 'Move/Copy');
    await fieldRow(d, 'Z Angle').locator('input').fill('90');
    await d.locator('.btn.primary').click();
    await u.settle();
    expect(hasLine((await u.sketch()), { x: 10, y: -10 }, { x: 10, y: 10 })).toBe(true);
    await page.keyboard.press('ControlOrMeta+z');
    await u.settle();
    await u.click({ x: 10, y: 0 });
    await u.press('m');
    const e = dialog(u, 'Move/Copy');
    await fieldRow(e, 'Set Pivot').locator('input').check();
    await e.locator('[data-field="Pivot"] .pick-toggle').click();
    await u.click({ x: 0, y: 0 });
    await fieldRow(e, 'Z Angle').locator('input').fill('90');
    await e.locator('.btn.primary').click();
    await u.settle();
    expect(hasLine(await u.sketch(), { x: 0, y: 0 }, { x: 0, y: 20 })).toBe(true);
  });

  test('the rotate handle turns about the chosen pivot', async ({ page }) => {
    const u = await start(page);
    const d = dialog(u, 'Move/Copy');
    await fieldRow(d, 'Set Pivot').locator('input').check();
    await pickPoint(u, d, 'Pivot', { x: 0, y: 0 });
    const arm = 72 / 4;
    // The ring sits down and to the right of the pivot; dragging it a quarter turn about the pivot reads as 90 degrees.
    await u.drag({ x: arm * 0.75, y: arm * 0.75 }, { x: -arm * 0.75, y: arm * 0.75 });
    await expect(fieldRow(d, 'Z Angle').locator('input')).toHaveValue('90 deg');
  });

  test('Free Move still takes X Distance, Y Distance, Z Angle and Create Copy as before', async ({ page }) => {
    const u = await start(page);
    const d = dialog(u, 'Move/Copy');
    await expect(fieldRow(d, 'Move Type').locator('select')).toHaveValue('free');
    await fieldRow(d, 'X Distance').locator('input').fill('5');
    await fieldRow(d, 'Y Distance').locator('input').fill('7');
    await d.locator('.btn.primary').click();
    await u.settle();
    expect(hasLine(await u.sketch(), { x: 5, y: 7 }, { x: 25, y: 7 })).toBe(true);
  });
});

test.describe('Measure', () => {
  const start = async (page: Page, opts: { lockActive?: boolean } = {}): Promise<SketchUser> => {
    const u = new SketchUser(page);
    await u.open();
    await openProject(u, scene(opts).text);
    return u;
  };
  const readout = (page: Page): Promise<string> => page.locator('.status-measure').innerText();
  const lit = (page: Page): Promise<Id[]> => page.evaluate(() => window.__sketch.highlight);

  test('is in the Inspect panel with the shortcut I, and leaves the Sketch Palette as it was', async ({ page }) => {
    const u = await start(page);
    await expect(page.locator('.panel[data-panel="inspect"] .panel-name')).toContainText('INSPECT');
    await expect(page.locator('.panel[data-panel="inspect"] .tool-btn[data-tool="measure"]')).toBeVisible();
    const palette = await page.locator('.palette-body').innerText();
    await u.press('i');
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('measure');
    expect(await page.locator('.palette-body').innerText()).toBe(palette);
    await u.press('Escape');
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('select');
  });

  test('reads the distance between objects on any layer, locked ones included, highlighting but not selecting them', async ({ page }) => {
    const u = await start(page);
    const before = await u.design();
    await u.press('i');
    await u.click({ x: 10, y: 0 });
    expect(await lit(page)).toHaveLength(1);
    await u.click({ x: 10, y: -50 });
    expect(await lit(page)).toHaveLength(2);
    // The line on layer 1 to the circle on the locked Template layer: 60 down to its centre, less the radius.
    expect(await readout(page)).toMatch(/^Min Distance: 50(\.0+)? mm$/);
    expect(await selection(u)).toEqual([]);
    expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(false);
    expect(await u.design()).toEqual(before);
    // A third pick starts over with that one.
    await u.click({ x: 75, y: -30 });
    expect(await lit(page)).toHaveLength(1);
    expect(await readout(page)).toBe('');
    await u.click({ x: 10, y: 0 });
    expect(await readout(page)).toMatch(/^Min Distance: 50(\.0+)? mm$/);
    await u.press('Escape');
    expect(await readout(page)).toBe('');
    expect(await lit(page)).toEqual([]);
    expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(false);
  });

  test('measures a point against a curve on another layer, and never takes a hidden layer', async ({ page }) => {
    const u = await start(page);
    await u.press('i');
    await u.click({ x: 60, y: -30 });
    await u.click({ x: 10, y: -50 });
    expect(await lit(page)).toHaveLength(2);
    // The point at (60,-30) to the circle at (10,-60) r 10: hypot(50, 30) - 10.
    const want = Math.hypot(50, 30) - 10;
    const m = /Min Distance: ([\d.]+) mm/.exec(await readout(page));
    expect(Number(m?.[1])).toBeCloseTo(want, 1);
    await u.click({ x: 20, y: -80 });
    // Nothing is there that can be seen, so the pick did nothing: the two stay lit.
    expect(await lit(page)).toHaveLength(2);
    expect(await readout(page)).toMatch(/Min Distance/);
  });

  test('normal selection still cannot take another layer, and Measure works with the active layer locked', async ({ page }) => {
    const u = await start(page, { lockActive: true });
    await u.click({ x: 10, y: -50 });
    expect(await selection(u)).toEqual([]);
    await u.press('i');
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('measure');
    await u.click({ x: 10, y: -50 });
    await u.click({ x: 10, y: 0 });
    expect(await readout(page)).toMatch(/^Min Distance: 50(\.0+)? mm$/);
  });
});
