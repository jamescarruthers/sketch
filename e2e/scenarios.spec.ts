import { expect, test } from '@playwright/test';
import { constraintsOfType, pointAt, SketchUser } from './helpers';
import type { Arc, Circle, Line } from '../src/model/types';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { errors: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

test('scenario 1: tuning fork, from the reference tutorial', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  await u.wheelOut(350);

  // Handle: centre rectangle from the origin.
  await u.tool('Center Rectangle');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 12, y: 40 });
  await u.press('Escape');
  await u.press('Escape');
  let s = await u.sketch();
  const rect = Object.values(s.curves).filter((c): c is Line => c.type === 'line' && c.lineType === 'normal');
  expect(rect.length).toBe(4);
  expect(Object.values(s.curves).filter((c) => c.lineType === 'construction').length).toBe(2);
  expect(Object.values(s.constraints).some((k) => k.type === 'coincident' && k.refs.includes('origin'))).toBe(true);
  await u.shot('fork-1-rectangle');

  // Circle on the bottom corners.
  await u.tool('2-Point Circle');
  await u.click({ x: -12, y: -40 });
  await u.click({ x: 12, y: -40 });
  await u.press('Escape');
  await u.press('Escape');
  const [circle] = (await u.curves('circle')) as Circle[];
  expect(circle.r).toBeCloseTo(12, 3);
  s = await u.sketch();
  expect(pointAt(s, circle.c).y).toBeCloseTo(-40, 3);
  await u.shot('fork-2-circle');

  // Left outside: three connected lines from the upper left corner.
  await u.press('l');
  await u.click({ x: -12, y: 40 });
  await u.click({ x: -30, y: 58 });
  await u.click({ x: -30, y: 110 });
  await u.click({ x: -14, y: 110 });
  await u.press('Escape');
  expect((await u.lines()).length).toBe(6 + 3);
  await u.press('l');

  // Inner fork: down, press-drag a tangent arc, up, across, down, back to the corner.
  await u.click({ x: -14, y: 110 });
  await u.click({ x: -14, y: 62 });
  await u.shot('fork-3-before-arc');
  await u.move({ x: -14, y: 62 });
  await u.drag({ x: -14, y: 62 }, { x: 14, y: 62 });
  const arcs = (await u.curves('arc')) as Arc[];
  expect(arcs.length).toBe(1);
  s = await u.sketch();
  const a = arcs[0];
  const centre = pointAt(s, a.c);
  expect(centre.x).toBeCloseTo(0, 2);
  expect(centre.y).toBeCloseTo(62, 2);
  expect(Math.min(pointAt(s, a.a).y, pointAt(s, a.b).y)).toBeCloseTo(62, 2);
  // Arc runs through the bottom, away from the fork arm, so it is tangent to the vertical line.
  expect(Object.values(s.constraints).some((k) => k.type === 'tangent' && k.refs.includes(a.id))).toBe(true);

  await u.click({ x: 14, y: 110 });
  await u.click({ x: 30, y: 110 });
  await u.click({ x: 30, y: 58 });
  await u.click({ x: 12, y: 40 });
  await u.press('Escape');
  await u.press('Escape');
  await u.shot('fork-4-done');

  s = await u.sketch();
  const analysis = await u.analysis();
  expect(analysis.unsatisfied).toEqual([]);
  expect((await u.curves('arc')).length).toBe(1);
  // Tangent both sides of the arc: to the line in, and the inferred one out.
  expect(constraintsOfType(s, 'tangent')).toBe(2);
  // The whole outline is one closed loop; with the handle and the circle overlap, profiles exist.
  const profiles = await page.evaluate(() => window.__sketch.profiles());
  expect(profiles).toBeGreaterThan(1);
  // Ends of the chain land on the rectangle corners.
  const closed = Object.values(s.constraints).filter((k) => k.type === 'coincident');
  expect(closed.length).toBeGreaterThan(10);
});

test('a rectangle goes black once anchored at the origin and dimensioned', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();

  await u.press('r');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 40, y: 25 });
  await u.press('Escape');
  await u.press('Escape');
  expect(await u.statusLine()).toContain('Under-Constrained');
  let a = await u.analysis();
  expect(a.dof).toBe(2);
  expect(a.freeCurves.length).toBeGreaterThan(0);
  await u.shot('rect-1-free');

  await u.press('d');
  await u.click({ x: 20, y: 25 });
  await u.click({ x: 20, y: 34 });
  await expect(page.locator('.hud-field.editor input')).toBeFocused();
  await page.keyboard.type('50');
  await u.shot('rect-2-editor');
  await u.press('Enter');
  await u.click({ x: 50, y: 12 });
  await u.click({ x: 72, y: 12 });
  await page.keyboard.type('30 mm');
  await u.press('Enter');
  await u.press('Escape');
  await u.press('Escape');

  a = await u.analysis();
  expect(a.dof).toBe(0);
  expect(a.freeCurves).toEqual([]);
  expect(await u.statusLine()).toContain('Status: Constrained');
  const s = await u.sketch();
  const xs = Object.values(s.points).map((p) => p.x);
  const ys = Object.values(s.points).map((p) => p.y);
  expect(Math.max(...xs)).toBeCloseTo(50, 3);
  expect(Math.max(...ys)).toBeCloseTo(30, 3);
  await u.shot('rect-3-black');
  await expect(page.locator('[data-lock] svg')).toHaveCount(1);
});

test('a dimension that would over-constrain becomes Driven and shows in parentheses', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  await u.press('r');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 40, y: 25 });
  await u.press('Escape');
  await u.press('Escape');
  await u.press('d');
  await u.click({ x: 20, y: 25 });
  await u.click({ x: 20, y: 34 });
  await u.press('Enter');
  // The opposite side is forced equal by the rectangle, so this one cannot drive.
  await u.click({ x: 20, y: 0 });
  await u.click({ x: 20, y: -9 });
  await expect(page.locator('.hud-field.editor')).toHaveCount(0);
  const s = await u.sketch();
  const dims = Object.values(s.dimensions);
  expect(dims.length).toBe(2);
  expect(dims.filter((d) => !d.driving).length).toBe(1);
  expect((await u.analysis()).unsatisfied).toEqual([]);
  await u.press('Escape');
  await u.press('Escape');
  await u.shot('rect-driven');
});

test('free geometry drags, fully constrained geometry does not', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  await u.press('l');
  await u.click({ x: 10, y: 10 });
  await u.click({ x: 50, y: 20 });
  await u.press('Escape');
  await u.press('Escape');

  const before = (await u.lines())[0];
  let s = await u.sketch();
  await u.drag(pointAt(s, before.b), { x: 60, y: 45 });
  s = await u.sketch();
  expect(pointAt(s, before.b).x).toBeCloseTo(60, 1);
  expect(pointAt(s, before.b).y).toBeCloseTo(45, 1);
  expect(pointAt(s, before.a).x).toBeCloseTo(10, 3);

  // Whole line: pick it at the middle.
  const mid = { x: (pointAt(s, before.a).x + pointAt(s, before.b).x) / 2, y: (pointAt(s, before.a).y + pointAt(s, before.b).y) / 2 };
  await u.drag(mid, { x: mid.x + 10, y: mid.y - 10 });
  s = await u.sketch();
  expect(pointAt(s, before.a).x).toBeCloseTo(20, 1);
  expect(pointAt(s, before.a).y).toBeCloseTo(0, 1);

  // A rectangle pinned at the origin and dimensioned does not move.
  await u.press('r');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: -30, y: -20 });
  await u.press('Escape');
  await u.press('Escape');
  await u.press('d');
  await u.click({ x: -15, y: -20 });
  await u.click({ x: -15, y: -29 });
  await u.press('Enter');
  await u.click({ x: -30, y: -10 });
  await u.click({ x: -39, y: -10 });
  await u.press('Enter');
  await u.press('Escape');
  await u.press('Escape');
  const pinned = await u.sketch();
  const rectLine = Object.values(pinned.curves).find((c) => c.id !== before.id) as Line;
  const frozen = JSON.stringify(Object.values(pinned.points).filter((p) => p.owner === rectLine.id));
  await u.drag({ x: -15, y: -20 }, { x: -5, y: -40 });
  await u.drag({ x: -30, y: -20 }, { x: -50, y: -50 });
  s = await u.sketch();
  expect(JSON.stringify(Object.values(s.points).filter((p) => p.owner === rectLine.id))).toBe(frozen);
  expect(await u.page.evaluate(() => window.__sketch.canUndo)).toBe(true);
});

test('Esc and Enter semantics', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  const tool = () => page.evaluate(() => window.__sketch.tool);

  // Esc cancels the action, then leaves the tool; nothing was stored.
  await u.press('r');
  await u.click({ x: 10, y: 10 });
  await u.press('Escape');
  expect(await tool()).toBe('rect-2pt');
  await u.press('Escape');
  expect(await tool()).toBe('select');
  expect((await u.lines()).length).toBe(0);

  // Enter with nothing pending ends the tool.
  await u.press('c');
  expect(await tool()).toBe('circle-center');
  await u.press('Enter');
  expect(await tool()).toBe('select');

  // A typed value locks, Enter places, second Enter ends [ref: press Enter twice].
  await u.press('c');
  await u.click({ x: 0, y: 0 });
  await u.move({ x: 20, y: 0 });
  await page.keyboard.type('50');
  await expect(page.locator('.hud-field.locked')).toHaveCount(1);
  await u.press('Enter');
  const [c] = (await u.curves('circle')) as Circle[];
  expect(c.r).toBeCloseTo(25, 6);
  const s = await u.sketch();
  expect(Object.values(s.dimensions)).toHaveLength(1);
  expect(Object.values(s.dimensions)[0].kind).toBe('diameter');
  expect(Object.values(s.dimensions)[0].expression).toBe('50 mm');
  expect(await tool()).toBe('circle-center');
  await u.press('Enter');
  expect(await tool()).toBe('select');

  // Line chain: a lone first click is cancelled and the tool stays. With a segment placed, one Esc
  // exits [ref GUID-6A2AE9D9 "To exit the tool, press keyboard Esc"].
  await u.press('l');
  await u.click({ x: 40, y: 40 });
  await u.press('Escape');
  expect(await tool()).toBe('line');
  await u.click({ x: 40, y: 40 });
  await u.click({ x: 60, y: 40 });
  await u.press('Escape');
  expect(await tool()).toBe('select');

  // Esc in select deselects.
  await u.click({ x: 50, y: 40 });
  expect((await page.evaluate(() => window.__sketch.selection)).length).toBe(1);
  await u.press('Escape');
  expect((await page.evaluate(() => window.__sketch.selection)).length).toBe(0);

  // Esc cancels a typed value first, then the action.
  await u.press('c');
  await u.click({ x: -40, y: -40 });
  await u.move({ x: -30, y: -40 });
  await page.keyboard.type('12');
  await u.press('Escape');
  await expect(page.locator('.hud-field.locked')).toHaveCount(0);
  await u.press('Escape');
  await u.press('Escape');
  expect(await tool()).toBe('select');
});

test('undo and redo are exactly one step per command', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  await u.press('l');
  await u.click({ x: 0, y: 30 });
  await u.click({ x: 30, y: 30 });
  await u.click({ x: 30, y: 60 });
  await u.press('Escape');
  await u.press('Escape');
  expect((await u.lines()).length).toBe(2);

  await u.press('Meta+z');
  expect((await u.lines()).length).toBe(1);
  await u.press('Meta+z');
  expect((await u.lines()).length).toBe(0);
  await u.press('Meta+Shift+z');
  expect((await u.lines()).length).toBe(1);
  await u.press('Control+y');
  expect((await u.lines()).length).toBe(2);

  // A drag of many frames is one step.
  const s = await u.sketch();
  const line = (await u.lines())[1];
  const start = pointAt(s, line.b);
  await u.drag(start, { x: 50, y: 70 }, 25);
  await u.press('Meta+z');
  const back = await u.sketch();
  expect(pointAt(back, line.b).x).toBeCloseTo(start.x, 6);
  expect(pointAt(back, line.b).y).toBeCloseTo(start.y, 6);

  // Undoing past the sketch itself returns to Design mode.
  for (let i = 0; i < 3; i++) await u.press('Meta+z');
  await expect(page.locator('.tab.active')).toHaveText('SOLID');
});

test('window select takes enclosed geometry, crossing takes touched', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  await u.press('l');
  await u.click({ x: 10, y: 10 });
  await u.click({ x: 30, y: 10 });
  await u.press('Escape');
  await u.press('l');
  await u.click({ x: 10, y: 30 });
  await u.click({ x: 90, y: 30 });
  await u.press('Escape');
  await u.press('Escape');
  const [inner, outer] = await u.lines();
  const selected = () => page.evaluate(() => window.__sketch.selection);

  await u.drag({ x: 0, y: 40 }, { x: 50, y: 0 });
  expect(await selected()).toEqual([inner.id]);
  await u.shot('select-window');

  await u.press('Escape');
  const a = await u.screen({ x: 50, y: 0 });
  const b = await u.screen({ x: 0, y: 40 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await u.shot('select-crossing-live');
  await page.mouse.up();
  await u.settle();
  expect((await selected()).sort()).toEqual([inner.id, outer.id].sort());

  // Shift adds, plain click replaces, empty clears.
  await u.click({ x: 20, y: 10 });
  expect(await selected()).toEqual([inner.id]);
  await u.click({ x: 50, y: 30 }, { shift: true });
  expect((await selected()).length).toBe(2);
  await u.click({ x: 50, y: 30 }, { shift: true });
  expect((await selected()).length).toBe(1);
  await u.click({ x: 60, y: 60 });
  expect((await selected()).length).toBe(0);
});

test('double-click selects the connected chain', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  await u.press('l');
  await u.click({ x: 10, y: 10 });
  await u.click({ x: 30, y: 10 });
  await u.click({ x: 30, y: 30 });
  await u.press('Escape');
  await u.click({ x: 50, y: 50 });
  await u.click({ x: 70, y: 50 });
  await u.press('Escape');
  await u.press('Escape');
  await u.doubleClick({ x: 20, y: 10 });
  expect((await page.evaluate(() => window.__sketch.selection)).length).toBe(2);
});

test('reload restores the autosave', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  await u.press('c');
  await u.click({ x: 10, y: 10 });
  await u.click({ x: 30, y: 10 });
  await u.press('Escape');
  await u.press('Escape');
  await u.press('l');
  await u.click({ x: 40, y: 40 });
  await u.click({ x: 70, y: 50 });
  await u.press('Escape');
  await u.press('Escape');
  const before = await u.design();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => !!window.__sketch);
  await u.settle();
  const after = await u.design();
  expect(after.order).toEqual(before.order);
  const id = before.order[0];
  expect(Object.keys(after.sketches[id].curves).sort()).toEqual(Object.keys(before.sketches[id].curves).sort());
  await expect(page.locator('.tab.active')).toHaveText('SKETCH');
});
