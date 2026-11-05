// Design mode is the Orbit view, and Create Sketch and Redefine Sketch Plane pick an origin plane's square in it.
// Real mouse and keyboard; results read from window.__sketch.
import { expect, test, type Page } from '@playwright/test';
import { SketchUser, type Xy } from './helpers';
import type { Plane, Vec3 } from '../src/model/types';
import { PLANE_FRAMES } from '../src/model/frames';
import { HOME } from '../src/app/camera';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { errors: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

const DESIGN_PROMPT = 'Create a sketch, or click one to edit it; drag to turn the view';

const fresh = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  return u;
};

const state = (page: Page) => page.evaluate(() => ({
  mode: window.__sketch.mode, orbiting: window.__sketch.orbiting, picking: window.__sketch.picking,
  scene: window.__sketch.scene, activeId: window.__sketch.activeId, status: window.__sketch.status,
}));

const createSketch = async (u: SketchUser): Promise<void> => {
  await u.page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await u.landed();
};

const finish = async (u: SketchUser): Promise<void> => {
  await u.page.getByRole('button', { name: 'Finish Sketch' }).first().click();
  await u.landed();
};

const exitTool = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};

/** The canvas colour at a page position, as red, green, blue. */
const pixel = (page: Page, at: Xy): Promise<number[]> => page.evaluate(([x, y]) => {
  const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement;
  const box = canvas.getBoundingClientRect();
  const dpr = canvas.width / box.width;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  return [...g.getImageData(Math.round((x - box.left) * dpr), Math.round((y - box.top) * dpr), 1, 1).data].slice(0, 3);
}, [at.x, at.y]);

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

const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

test.describe('design mode is the Orbit view', () => {
  test('the app starts in 3D at Home, fitted round the origin planes', async ({ page }) => {
    const u = await fresh(page);
    const s = await state(page);
    expect(s.mode).toBe('design');
    expect(s.orbiting).toBe(true);
    expect(s.picking).toBe(false);
    expect(s.status).toBe(DESIGN_PROMPT);
    expect(s.scene?.right.x).toBeCloseTo(HOME.right.x, 12);
    expect(s.scene?.up.z).toBeCloseTo(HOME.up.z, 12);
    await expect(page.locator('.orbit-view')).toHaveAttribute('aria-pressed', 'true');
    // Every corner of the three squares is on the canvas, clear of the browser.
    const size = await page.evaluate(() => window.__sketch.planeSize);
    const canvas = await page.locator('canvas.canvas').boundingBox();
    const browser = await page.locator('.browser').boundingBox();
    if (!canvas || !browser) throw new Error('no layout');
    for (const plane of ['XY', 'YZ', 'ZX'] as Plane[]) {
      for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size]]) {
        const at = await u.planeScreen(plane, x, y);
        expect(at.x).toBeGreaterThan(browser.x + browser.width);
        expect(at.x).toBeLessThan(canvas.x + canvas.width);
        expect(at.y).toBeGreaterThan(canvas.y);
        expect(at.y).toBeLessThan(canvas.y + canvas.height);
      }
    }
    // V has nothing to go back to here.
    await u.press('v');
    expect((await state(page)).orbiting).toBe(true);
    expect(await page.evaluate(() => window.__sketch.note)).toContain('Orbit view already');
  });

  test('Finish Sketch swings back out to it, and a command meanwhile lands the swing first', async ({ page }) => {
    const u = await fresh(page);
    await u.newSketch();
    const id = (await state(page)).activeId as string;
    await u.press('r');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 50, y: 30 });
    await exitTool(u);
    await page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    expect(await page.evaluate(() => window.__sketch.swinging)).toBe(true);
    await u.landed();
    const s = await state(page);
    expect(s.mode).toBe('design');
    expect(s.orbiting).toBe(true);
    expect(s.status).toBe(DESIGN_PROMPT);
    // Looking the way design mode did when the sketch was opened: Home.
    expect(s.scene?.right.y).toBeCloseTo(HOME.right.y, 9);
    expect(s.scene?.up.z).toBeCloseTo(HOME.up.z, 9);
    const edge = await page.evaluate((k) => window.__sketch.sceneToScreen(k, 30, 10), id) as Xy;
    expect(await inkAt(page, edge)).toBe(true);

    // Into the sketch again by clicking its geometry, at the view it was left in.
    await page.mouse.move(edge.x, edge.y);
    await u.settle();
    await page.mouse.down();
    await page.mouse.up();
    await u.landed();
    expect((await state(page)).activeId).toBe(id);
    expect(await page.evaluate(() => window.__sketch.view)).toMatchObject({ cx: 0, cy: 0, ppm: 4 });

    // Create Sketch straight after Finish Sketch is not lost to the swing.
    await page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await page.getByRole('button', { name: 'Create Sketch' }).first().click();
    expect(await page.evaluate(() => window.__sketch.swinging)).toBe(false);
    expect((await state(page)).picking).toBe(true);
    expect((await state(page)).mode).toBe('design');
  });

  test('Show Dimensions draws a sketch\'s dimensions in 3D', async ({ page }) => {
    const u = await fresh(page);
    await u.newSketch();
    await u.press('l');
    await u.click({ x: -20, y: 20 });
    await u.click({ x: 20, y: 20 });
    await exitTool(u);
    await u.press('d');
    await u.click({ x: 0, y: 20 });
    await u.click({ x: 0, y: 32 });
    await u.type('40');
    await u.press('Enter');
    await exitTool(u);
    const id = (await state(page)).activeId as string;
    const [d] = Object.values((await u.sketch()).dimensions);
    await finish(u);
    const label = await page.evaluate(([k, x, y]) => window.__sketch.sceneToScreen(k as string, x as number, y as number), [id, d.label.x, d.label.y] as const) as Xy;
    expect(await inkAt(page, label)).toBe(false);
    await page.locator(`.sketch-row[data-sketch="${id}"]`).click({ button: 'right' });
    await page.locator('.popup-menu .menu-item', { hasText: 'Show Dimensions' }).click();
    await u.settle();
    expect(await inkAt(page, label)).toBe(true);
    expect((await state(page)).mode).toBe('design');
  });

  test('a reload keeps an open sketch open, in plan, and otherwise starts in 3D', async ({ page }) => {
    const u = await fresh(page);
    await u.newSketch();
    await u.press('l');
    await u.click({ x: -20, y: 5 });
    await u.click({ x: 20, y: 5 });
    await exitTool(u);
    const id = (await state(page)).activeId;
    const view = await page.evaluate(() => window.__sketch.view);
    await page.evaluate(() => window.__sketch.flushAutosave());
    await u.open({ keep: true });
    let s = await state(page);
    expect(s.mode).toBe('sketch');
    expect(s.activeId).toBe(id);
    expect(s.orbiting).toBe(false);
    expect(s.scene).toBeNull();
    expect(await page.evaluate(() => window.__sketch.view)).toMatchObject({ cx: view.cx, cy: view.cy, ppm: view.ppm });

    await finish(u);
    await page.evaluate(() => window.__sketch.flushAutosave());
    await u.open({ keep: true });
    s = await state(page);
    expect(s.mode).toBe('design');
    expect(s.orbiting).toBe(true);
    expect(s.scene).not.toBeNull();
    expect((await u.design()).order).toEqual([id]);
  });
});

test.describe('Create Sketch picks a plane in the Orbit view', () => {
  test('a click on each plane makes a sketch on it, named and undone as before, facing it', async ({ page }) => {
    const u = await fresh(page);
    const planes: Plane[] = ['XY', 'YZ', 'ZX'];
    for (const [i, plane] of planes.entries()) {
      await createSketch(u);
      const s = await state(page);
      expect(s.picking).toBe(true);
      expect(s.status).toBe('Select a plane for the sketch, or press Esc');
      await u.pickPlane(plane);
      const after = await state(page);
      expect(after.mode).toBe('sketch');
      expect(after.orbiting).toBe(false);
      expect(after.picking).toBe(false);
      expect(after.scene).toBeNull();
      const d = await u.design();
      expect(d.order).toHaveLength(i + 1);
      expect(d.sketches[after.activeId as string].name).toBe(`Sketch${i + 1}`);
      expect(d.sketches[after.activeId as string].frame).toEqual(PLANE_FRAMES[plane]);
      expect(await page.evaluate(() => window.__sketch.frame)).toEqual(PLANE_FRAMES[plane]);
      // Each opens at the view the last sketch was left at: the first view there is, at first.
      expect(await page.evaluate(() => window.__sketch.view)).toMatchObject({ cx: 0, cy: 0, ppm: 4 });
      await finish(u);
    }
    // One undo step each: the last goes, and nothing else.
    await u.press('Meta+z');
    const d = await u.design();
    expect(d.order).toHaveLength(2);
    expect(Object.values(d.sketches).map((k) => k.frame)).toEqual([PLANE_FRAMES.XY, PLANE_FRAMES.YZ]);
  });

  test('where squares overlap the one nearest the camera takes it, by depth, not by drawing order', async ({ page }) => {
    const u = await fresh(page);
    await createSketch(u);
    const size = await page.evaluate(() => window.__sketch.planeSize);
    // From Home, XY near the origin is behind XZ, which is drawn last.
    const behind = await u.planeScreen('XY', size * 0.2, size * 0.2);
    await page.mouse.move(behind.x, behind.y, { steps: 2 });
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.pickHover)).toBe('ZX');

    // Turned to look from below and the +Y side: now XY, drawn first, is in front of XZ.
    const canvas = await page.locator('canvas.canvas').boundingBox();
    if (!canvas) throw new Error('no canvas');
    const mid = { x: canvas.x + canvas.width * 0.6, y: canvas.y + canvas.height / 2 };
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x - 180, mid.y, { steps: 12 });
    await page.mouse.up();
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y - 120, { steps: 12 });
    await page.mouse.up();
    await u.settle();
    expect((await state(page)).picking).toBe(true);
    const cam = (await state(page)).scene;
    if (!cam) throw new Error('no camera');
    const c = cross(cam.right, cam.up);
    expect(c.z).toBeLessThan(0);
    // A point of XZ, and where the ray through it toward the camera meets XY: inside the XY square, nearer.
    const p = { x: size * 0.3, y: 0, z: size * 0.4 };
    const t = -p.z / c.z;
    const q = { x: p.x + c.x * t, y: p.y + c.y * t };
    expect(t).toBeGreaterThan(0);
    expect(q.x).toBeGreaterThan(0);
    expect(q.x).toBeLessThan(size);
    expect(q.y).toBeGreaterThan(0);
    expect(q.y).toBeLessThan(size);
    // ZX's coordinates are (z, x).
    const at = await u.planeScreen('ZX', p.z, p.x);
    await page.mouse.move(at.x, at.y, { steps: 2 });
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.pickHover)).toBe('XY');
    await page.mouse.down();
    await page.mouse.up();
    await u.landed();
    const d = await u.design();
    expect(d.sketches[d.order[0]].frame).toEqual(PLANE_FRAMES.XY);
  });

  test('the square under the cursor lights in the hover colour and is named', async ({ page }) => {
    const u = await fresh(page);
    await createSketch(u);
    const size = await page.evaluate(() => window.__sketch.planeSize);
    const spot = await u.planeScreen('YZ', size * 0.7, size * 0.6);
    const before = await pixel(page, spot);
    await page.mouse.move(spot.x, spot.y, { steps: 2 });
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.pickHover)).toBe('YZ');
    await expect(page.locator('.cursor-tip')).toBeVisible();
    await expect(page.locator('.cursor-tip')).toHaveText('YZ plane');
    expect(await page.evaluate(() => (document.querySelector('canvas.canvas') as HTMLElement).style.cursor)).toBe('pointer');
    const lit = await pixel(page, spot);
    expect(Math.abs(lit[0] - before[0]) + Math.abs(lit[1] - before[1]) + Math.abs(lit[2] - before[2])).toBeGreaterThan(30);
    await u.shot('plane-pick-hover');

    // ZX is called XZ, as the reference calls it.
    const zx = await u.planeScreen('ZX', size * 0.5, size * 0.5);
    await page.mouse.move(zx.x, zx.y, { steps: 2 });
    await u.settle();
    await expect(page.locator('.cursor-tip')).toHaveText('XZ plane');
    expect(await pixel(page, spot)).toEqual(before);

    // Off the squares: nothing lit, no tip, and a click does nothing.
    const off = await u.planeScreen('XY', -size * 0.5, -size * 0.5);
    await page.mouse.move(off.x, off.y, { steps: 2 });
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.pickHover)).toBeNull();
    await expect(page.locator('.cursor-tip')).toBeHidden();
    await page.mouse.down();
    await page.mouse.up();
    await u.settle();
    expect((await state(page)).picking).toBe(true);
    expect((await u.design()).order).toHaveLength(0);
  });

  test('Esc cancels and goes back: to design mode, or to the sketch it was started from', async ({ page }) => {
    const u = await fresh(page);
    await createSketch(u);
    await u.press('Escape');
    let s = await state(page);
    expect(s.picking).toBe(false);
    expect(s.mode).toBe('design');
    expect(s.orbiting).toBe(true);
    expect(s.status).toBe(DESIGN_PROMPT);
    expect((await u.design()).order).toHaveLength(0);

    // From a sketch: the Orbit view opens for the pick, and Esc swings back to the sketch as it was.
    await u.newSketch();
    await u.press('l');
    await u.click({ x: -20, y: 5 });
    await u.click({ x: 20, y: 5 });
    await exitTool(u);
    const id = (await state(page)).activeId;
    const view = await page.evaluate(() => window.__sketch.view);
    // Create Sketch is on the SOLID tab while sketching.
    await page.locator('.tab', { hasText: 'SOLID' }).click();
    await createSketch(u);
    s = await state(page);
    expect(s.picking).toBe(true);
    expect(s.orbiting).toBe(true);
    expect(s.mode).toBe('sketch');
    expect(s.activeId).toBe(id);
    await u.press('Escape');
    await u.landed();
    s = await state(page);
    expect(s.picking).toBe(false);
    expect(s.orbiting).toBe(false);
    expect(s.mode).toBe('sketch');
    expect(s.activeId).toBe(id);
    expect(await page.evaluate(() => window.__sketch.view)).toMatchObject({ cx: view.cx, cy: view.cy, ppm: view.ppm });
    expect((await u.design()).order).toHaveLength(1);
  });

  test('sketch geometry is not picked while a plane is: only the squares are', async ({ page }) => {
    const u = await fresh(page);
    await u.newSketch();
    await u.press('l');
    await u.click({ x: -60, y: -60 });
    await u.click({ x: -20, y: -60 });
    await exitTool(u);
    const id = (await state(page)).activeId as string;
    await finish(u);
    await createSketch(u);
    const on = await page.evaluate((k) => window.__sketch.sceneToScreen(k, -40, -60), id) as Xy;
    expect(await inkAt(page, on)).toBe(true);
    await page.mouse.move(on.x, on.y, { steps: 2 });
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.pickHover)).toBeNull();
    expect(await page.evaluate(() => (document.querySelector('canvas.canvas') as HTMLElement).style.cursor)).toBe('grab');
    await page.mouse.down();
    await page.mouse.up();
    await u.settle();
    let s = await state(page);
    expect(s.picking).toBe(true);
    expect(s.mode).toBe('design');
    expect(s.activeId).toBeNull();
    // Picking over, the same click edits that sketch.
    await u.press('Escape');
    await page.mouse.move(on.x + 1, on.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.up();
    await u.landed();
    s = await state(page);
    expect(s.mode).toBe('sketch');
    expect(s.activeId).toBe(id);
  });
});

test.describe('Redefine Sketch Plane picks a plane the same way', () => {
  test('from the sketch itself, then from design mode', async ({ page }) => {
    const u = await fresh(page);
    await u.newSketch();
    await u.press('l');
    await u.click({ x: 10, y: 15 });
    await u.click({ x: 30, y: 15 });
    await exitTool(u);
    const id = (await state(page)).activeId as string;
    const view = await page.evaluate(() => window.__sketch.view);
    const redefine = async (): Promise<void> => {
      await page.locator(`.sketch-row[data-sketch="${id}"]`).click({ button: 'right' });
      await page.locator('.popup-menu .menu-item[data-item="Redefine Sketch Plane"]').click();
      await u.landed();
    };

    await redefine();
    let s = await state(page);
    expect(s.picking).toBe(true);
    expect(s.orbiting).toBe(true);
    expect(s.status).toBe('Select a plane for Sketch1, or press Esc');
    await u.pickPlane('YZ');
    s = await state(page);
    expect(s.mode).toBe('sketch');
    expect(s.activeId).toBe(id);
    expect(s.orbiting).toBe(false);
    expect((await u.design()).sketches[id].frame).toEqual(PLANE_FRAMES.YZ);
    expect(await page.evaluate(() => window.__sketch.frame)).toEqual(PLANE_FRAMES.YZ);
    // Its own coordinates are as they were, so it comes back at the view it was left in.
    expect(await page.evaluate(() => window.__sketch.view)).toMatchObject({ cx: view.cx, cy: view.cy, ppm: view.ppm });
    expect((await u.design()).order).toHaveLength(1);
    await u.press('Meta+z');
    expect((await u.design()).sketches[id].frame).toEqual(PLANE_FRAMES.XY);

    await finish(u);
    await redefine();
    await u.pickPlane('ZX');
    s = await state(page);
    expect(s.mode).toBe('design');
    expect(s.orbiting).toBe(true);
    expect(s.picking).toBe(false);
    expect(s.status).toBe(DESIGN_PROMPT);
    expect((await u.design()).sketches[id].frame).toEqual(PLANE_FRAMES.ZX);
    // Drawn on its new plane, where its line now is.
    const mid = await page.evaluate((k) => window.__sketch.sceneToScreen(k, 20, 15), id) as Xy;
    expect(await inkAt(page, mid)).toBe(true);
  });
});
