// 3D mode: fold the sketch plane about a line with the arrow keys, sketch on the new plane, swing back, and
// the Orbit view. Real mouse and keyboard; results read from window.__sketch.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { SketchUser, type Xy } from './helpers';
import type { Design, Frame, Id, Line, Sketch } from '../src/model/types';
import { PLANE_FRAMES } from '../src/model/frames';

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

const landed = async (u: SketchUser): Promise<void> => {
  await u.page.waitForFunction(() => !window.__sketch.swinging);
  await u.settle();
};

const exitTool = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};

/** A rectangle from (10, 10) to (50, 30) on the open sketch, and its bottom edge. */
async function rectangle(u: SketchUser): Promise<{ sketch: Sketch; bottom: Line }> {
  await u.press('r');
  await u.click({ x: 10, y: 10 });
  await u.click({ x: 50, y: 30 });
  await exitTool(u);
  const sketch = await u.sketch() as Sketch;
  const bottom = Object.values(sketch.curves).find((c): c is Line => c.type === 'line' && sketch.points[c.a].y < 10.5 && sketch.points[c.b].y < 10.5);
  if (!bottom) throw new Error('no bottom edge');
  return { sketch, bottom };
}

const frameOf = (d: Design, id: Id): Frame => d.sketches[id].frame;

/** Whether the canvas has drawn something other than the background within a few pixels of a page position. */
const inkAt = (page: Page, at: Xy): Promise<boolean> => page.evaluate(([x, y]) => {
  const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement;
  const box = canvas.getBoundingClientRect();
  const dpr = canvas.width / box.width;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const r = 3;
  const data = g.getImageData(Math.round((x - box.left) * dpr) - r, Math.round((y - box.top) * dpr) - r, r * 2 + 1, r * 2 + 1).data;
  const bg = g.getImageData(2, canvas.height - 2, 1, 1).data;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 60) return true;
  }
  return false;
}, [at.x, at.y]);

test.describe('folding the sketch plane', () => {
  test('Up about a rectangle edge, sketch on the new plane, Down back, orbit, save and reopen', async ({ page }) => {
    const u = await start(page);
    const first = (await u.design()).order[0];
    const { sketch: s1, bottom } = await rectangle(u);
    const before = await page.evaluate(() => window.__sketch.view);

    await u.click({ x: 30, y: 10 });
    expect(await page.evaluate(() => window.__sketch.selection)).toEqual([bottom.id]);
    await page.keyboard.press('ArrowUp');
    // It swings, and takes no input until it lands.
    expect(await page.evaluate(() => window.__sketch.swinging)).toBe(true);
    expect(await page.evaluate(() => window.__sketch.scene)).not.toBeNull();
    await landed(u);

    // A new sketch on the plane y = 10, facing +Y: its x is X and its y is -Z.
    const d = await u.design();
    expect(d.order).toHaveLength(2);
    const second = d.order[1];
    expect(await page.evaluate(() => window.__sketch.activeId)).toBe(second);
    expect(d.sketches[second].name).toBe('Sketch2');
    expect(frameOf(d, second)).toEqual({ o: { x: 0, y: 10, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 } });
    expect(await page.evaluate(() => window.__sketch.frame)).toEqual(frameOf(d, second));
    // The camera landed looking straight at it, the hinge where it was on screen: 10 mm lower in the new y.
    expect(await page.evaluate(() => window.__sketch.scene)).toBeNull();
    const after = await page.evaluate(() => window.__sketch.view);
    expect(after.cx).toBeCloseTo(before.cx, 9);
    expect(after.cy).toBeCloseTo(before.cy - 10, 9);
    expect(after.ppm).toBe(before.ppm);

    // The hinge came in linked, ends at (10, 0) and (50, 0), and is selected.
    const s2 = await u.sketch() as Sketch;
    const hinge = Object.values(s2.curves).find((c): c is Line => c.type === 'line' && !!c.projected);
    if (!hinge) throw new Error('no hinge');
    expect(hinge.projected).toEqual({ sketchId: first, curveId: bottom.id });
    expect([s2.points[hinge.a], s2.points[hinge.b]].map((p) => [p.x, p.y]).sort((a, b) => a[0] - b[0])).toEqual([[10, 0], [50, 0]]);
    expect(await page.evaluate(() => window.__sketch.selection)).toEqual([hinge.id]);

    // Of the first sketch only the hinge and points on it show.
    const seen = await page.evaluate(() => window.__sketch.seen());
    expect(seen.map((v) => v.id)).toEqual([first]);
    expect(seen[0].curves).toEqual([bottom.id]);
    for (const id of seen[0].points) expect(s1.points[id].y).toBeCloseTo(10, 9);
    expect(seen[0].points.length).toBeGreaterThanOrEqual(2);

    // A line from a hinge end joins it, Coincident.
    const end = s2.points[hinge.a].x > s2.points[hinge.b].x ? hinge.a : hinge.b;
    await u.press('l');
    await u.click({ x: 50, y: 0 });
    await u.click({ x: 50, y: 30 });
    await exitTool(u);
    const drawn = await u.sketch() as Sketch;
    const line = Object.values(drawn.curves).find((c): c is Line => c.type === 'line' && !c.projected);
    if (!line) throw new Error('no line');
    const joined = Object.values(drawn.constraints).some((k) => k.type === 'coincident' && k.refs.includes(end) && (k.refs.includes(line.a) || k.refs.includes(line.b)));
    expect(joined).toBe(true);
    expect((await u.analysis()).unsatisfied).toEqual([]);

    // Down about the hinge: back in the first sketch, as it was, and no new sketch.
    await u.click({ x: 30, y: 0 });
    expect(await page.evaluate(() => window.__sketch.selection)).toEqual([hinge.id]);
    await page.keyboard.press('ArrowDown');
    await landed(u);
    expect(await page.evaluate(() => window.__sketch.activeId)).toBe(first);
    expect(await page.evaluate(() => window.__sketch.frame)).toEqual(PLANE_FRAMES.XY);
    expect((await u.design()).order).toHaveLength(2);
    expect(await page.evaluate(() => window.__sketch.selection)).toEqual([bottom.id]);
    const back = await page.evaluate(() => window.__sketch.view);
    expect(back.cy).toBeCloseTo(before.cy, 9);
    // From XY the second sketch shows only what lies in XY: the hinge, which it meets it along.
    expect((await page.evaluate(() => window.__sketch.seen())).map((v) => v.curves)).toEqual([[hinge.id]]);

    // The Orbit view shows both.
    await u.press('v');
    await landed(u);
    expect(await page.evaluate(() => window.__sketch.orbiting)).toBe(true);
    const top = await page.evaluate((id) => window.__sketch.sceneToScreen(id, 30, 30), first) as Xy;
    const upright = await page.evaluate((id) => window.__sketch.sceneToScreen(id, 50, 20), second) as Xy;
    expect(await inkAt(page, top)).toBe(true);
    expect(await inkAt(page, upright)).toBe(true);
    // Keys for tools wait while it is open.
    await u.press('l');
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('select');
    // A drag turns it.
    const turned = await page.evaluate(() => window.__sketch.scene);
    await page.mouse.move(700, 450);
    await page.mouse.down();
    await page.mouse.move(760, 430, { steps: 4 });
    await page.mouse.up();
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.scene?.right)).not.toEqual(turned?.right);
    expect(await page.evaluate(() => window.__sketch.orbiting)).toBe(true);
    // Clicking the second sketch's line edits it, facing it.
    const pick = await page.evaluate((id) => window.__sketch.sceneToScreen(id, 50, 20), second) as Xy;
    await page.mouse.move(pick.x, pick.y);
    await u.settle();
    expect(await page.evaluate(() => (document.querySelector('canvas.canvas') as HTMLElement).style.cursor)).toBe('pointer');
    await page.mouse.down();
    await page.mouse.up();
    await landed(u);
    expect(await page.evaluate(() => window.__sketch.orbiting)).toBe(false);
    expect(await page.evaluate(() => window.__sketch.activeId)).toBe(second);
    expect(await page.evaluate(() => window.__sketch.frame)).toEqual(frameOf(d, second));
    expect(await page.evaluate(() => window.__sketch.scene)).toBeNull();

    // Into the Orbit view and out with Esc: back on the same sketch, facing it, as it was.
    const facing = await page.evaluate(() => window.__sketch.view);
    await page.locator('.orbit-view').click();
    await landed(u);
    expect(await page.locator('.orbit-view').getAttribute('aria-pressed')).toBe('true');
    await u.press('Escape');
    await landed(u);
    expect(await page.evaluate(() => window.__sketch.orbiting)).toBe(false);
    expect(await page.evaluate(() => window.__sketch.activeId)).toBe(second);
    const again = await page.evaluate(() => window.__sketch.view);
    expect([again.cx, again.cy, again.ppm]).toEqual([facing.cx, facing.cy, facing.ppm]);

    // Save, start again and open it: the frames are as they were.
    const saved = await u.design();
    await page.locator('[data-menu="file"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.menu-item[data-item="Save"]').first().click()]);
    const text = readFileSync(await download.path(), 'utf8');
    expect(JSON.parse(text).version).toBe(3);
    await page.locator('[data-menu="file"]').click();
    await page.locator('.menu-item[data-item="New"]').first().click();
    await u.settle();
    expect((await u.design()).order).toHaveLength(0);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), (async () => {
      await page.locator('[data-menu="file"]').click();
      await page.locator('.menu-item[data-item="Open..."]').first().click();
    })()]);
    await chooser.setFiles({ name: 'folded.sketch.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
    await page.waitForFunction((n) => window.__sketch.design().order.length === n, 2);
    const opened = await u.design();
    for (const id of saved.order) expect(frameOf(opened, id)).toEqual(frameOf(saved, id));
  });

  test('the line where the other plane meets this one: drawn, named on hover, clicked to go there, and hidden by Other Planes', async ({ page }) => {
    const u = await start(page);
    const first = (await u.design()).order[0];
    await rectangle(u);
    await u.click({ x: 30, y: 10 });
    await page.keyboard.press('ArrowUp');
    await landed(u);
    const second = (await u.design()).order[1];
    // In the folded sketch the first one's plane meets it along its x axis, right across the view.
    const lines = await page.evaluate(() => window.__sketch.planeLines());
    expect(lines.map((l) => l.sketches)).toEqual([[first]]);
    expect(Math.abs(lines[0].p.y)).toBeLessThan(1e-9);
    expect(Math.abs(lines[0].d.x)).toBeCloseTo(1, 12);
    const far = await u.screen({ x: -80, y: 0 });
    expect(await inkAt(page, far)).toBe(true);

    // Geometry on the line wins: the hinge selects, and nothing swings.
    await u.click({ x: 30, y: 0 });
    expect(await page.evaluate(() => window.__sketch.swinging)).toBe(false);
    expect(await page.evaluate(() => window.__sketch.activeId)).toBe(second);
    expect((await page.evaluate(() => window.__sketch.selection))).toHaveLength(1);

    // Hovering the line names the sketch; clicking it swings about it into that sketch.
    await u.move({ x: -80, y: 0 });
    await u.settle();
    await expect(page.locator('.cursor-tip')).toBeVisible();
    await expect(page.locator('.cursor-tip')).toContainText('Sketch1');
    await u.click({ x: -80, y: 0 });
    await landed(u);
    expect(await page.evaluate(() => window.__sketch.activeId)).toBe(first);
    expect(await page.evaluate(() => window.__sketch.frame)).toEqual(PLANE_FRAMES.XY);
    expect((await u.design()).order).toHaveLength(2);
    // And from the first, the folded plane's line is at y = 10.
    const back = await page.evaluate(() => window.__sketch.planeLines());
    expect(back.map((l) => l.sketches)).toEqual([[second]]);
    expect(back[0].p.y).toBeCloseTo(10, 9);

    // Other Planes off: no line, and a click there does nothing.
    await page.locator('.palette-row', { hasText: 'Other Planes' }).locator('input').click();
    expect(await page.evaluate(() => window.__sketch.settings.showPlanes)).toBe(false);
    expect(await page.evaluate(() => window.__sketch.planeLines())).toEqual([]);
    await u.click({ x: -80, y: 10 });
    expect(await page.evaluate(() => window.__sketch.swinging)).toBe(false);
    expect(await page.evaluate(() => window.__sketch.activeId)).toBe(first);
  });

  test('lands at once with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const u = await start(page);
    await u.press('l');
    await u.click({ x: -20, y: 5 });
    await u.click({ x: 20, y: 5 });
    await exitTool(u);
    await u.click({ x: 0, y: 5 });
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => window.__sketch.swinging)).toBe(false);
    expect(await page.evaluate(() => window.__sketch.scene)).toBeNull();
    const d = await u.design();
    expect(d.order).toHaveLength(2);
    expect(await page.evaluate(() => window.__sketch.frame)).toEqual({ o: { x: 0, y: 5, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 } });
    // The Orbit view opens at once too.
    await u.press('v');
    expect(await page.evaluate(() => window.__sketch.swinging)).toBe(false);
    expect(await page.evaluate(() => window.__sketch.orbiting)).toBe(true);
  });

  test('the arrows do nothing with an arc, two lines, the other pair, or the focus in a text field', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: -30, y: 20 });
    await u.click({ x: 30, y: 20 });
    await exitTool(u);
    await u.press('l');
    await u.click({ x: -30, y: -20 });
    await u.click({ x: 30, y: -20 });
    await exitTool(u);
    await page.getByRole('button', { name: /^CREATE/ }).click();
    await page.locator('.menu-item.flyout[data-item="Arc"]').hover();
    await page.locator('.menu-item[data-item="3-Point Arc"]').click();
    await u.click({ x: -20, y: -60 });
    await u.click({ x: 20, y: -60 });
    await u.click({ x: 0, y: -45 });
    await exitTool(u);
    const sketch = await u.sketch() as Sketch;
    const arc = Object.values(sketch.curves).find((c) => c.type === 'arc');
    expect(arc).toBeTruthy();
    const unchanged = async (): Promise<void> => {
      await u.settle();
      expect(await page.evaluate(() => window.__sketch.swinging)).toBe(false);
      expect((await u.design()).order).toHaveLength(1);
      expect(await page.evaluate(() => window.__sketch.frame)).toEqual(PLANE_FRAMES.XY);
    };

    // The arc: not a hinge.
    const a = sketch.points[(arc as { a: Id }).a];
    await u.click(a);
    await u.click({ x: 0, y: -45 });
    expect(await page.evaluate(() => window.__sketch.selection)).toEqual([arc?.id]);
    await page.keyboard.press('ArrowUp');
    await unchanged();
    expect(await page.evaluate(() => window.__sketch.note)).toContain('Select one straight line');

    // Two lines.
    await u.click({ x: 0, y: 20 });
    await u.click({ x: 0, y: -20 }, { shift: true });
    expect(await page.evaluate(() => window.__sketch.selection)).toHaveLength(2);
    await page.keyboard.press('ArrowDown');
    await unchanged();

    // One line across the screen: Left and Right are not its pair.
    await u.click({ x: 0, y: 20 });
    await page.keyboard.press('ArrowLeft');
    await unchanged();
    expect(await page.evaluate(() => window.__sketch.note)).toContain('use Up or Down');

    // The focus in a text field: the arrows move its caret.
    const id = (await u.design()).order[0];
    await page.locator(`.sketch-row[data-sketch="${id}"]`).click({ button: 'right' });
    await page.locator('.popup-menu .menu-item[data-item="Rename"]').click();
    const input = page.locator('.sketch-row input.rename');
    await expect(input).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await unchanged();
    await page.keyboard.press('Escape');
  });
});
