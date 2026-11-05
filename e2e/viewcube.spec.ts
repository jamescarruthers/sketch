// The ViewCube: drawn in the canvas's top right, turned with the camera, and clicked or dragged to turn it.
// Real mouse and keyboard; results read from window.__sketch and the canvas's own pixels.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { SketchUser, type Xy } from './helpers';
import type { Line, Sketch, Vec3 } from '../src/model/types';
import { HOME } from '../src/app/camera';
import type { CubeView } from '../src/app/app';
import { paletteFrom, parseHex, parseTokens, type Theme } from '../src/render/tokens';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { errors: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

const tokens = parseTokens(readFileSync('src/ui/tokens.css', 'utf8'));
const rgb = (theme: Theme, key: 'cubeFace' | 'cubeHover'): number[] => parseHex(paletteFrom(tokens, theme)[key]) as number[];

const fresh = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  return u;
};

const cube = (page: Page): Promise<CubeView> => page.evaluate(() => window.__sketch.cube() as CubeView);

/** A page position on the named face, edge or corner of the cube; a face's at (s, t) of it. */
async function cubePoint(page: Page, name: string, at?: { s: number; t: number }): Promise<Xy> {
  const p = await page.evaluate(([n, a]) => window.__sketch.cubeToScreen(n as string, a as { s: number; t: number } | undefined), [name, at] as const);
  if (!p) throw new Error(`${name} does not show`);
  return p;
}

const clickCube = async (u: SketchUser, name: string): Promise<void> => {
  const at = await cubePoint(u.page, name);
  await u.page.mouse.move(at.x, at.y, { steps: 2 });
  await u.settle();
  await u.page.mouse.down();
  await u.page.mouse.up();
};

/** Which way the camera looks from, and its right and up. */
const camera = async (page: Page): Promise<{ from: Vec3; right: Vec3; up: Vec3 } | null> => {
  const s = await page.evaluate(() => window.__sketch.scene);
  if (!s) return null;
  const { right: r, up: u } = s;
  return { from: { x: r.y * u.z - r.z * u.y, y: r.z * u.x - r.x * u.z, z: r.x * u.y - r.y * u.x }, right: r, up: u };
};

const near = (a: Vec3, b: Vec3, digits = 6): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
};

/** The canvas colour at a page position, as red, green, blue. */
const pixel = (page: Page, at: Xy): Promise<number[]> => page.evaluate(([x, y]) => {
  const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement;
  const box = canvas.getBoundingClientRect();
  const dpr = canvas.width / box.width;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  return [...g.getImageData(Math.round((x - box.left) * dpr), Math.round((y - box.top) * dpr), 1, 1).data].slice(0, 3);
}, [at.x, at.y]);

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const squareOf = (c: CubeView): Box => ({ x: c.x - c.size / 2, y: c.y - c.size / 2, width: c.size, height: c.size });

/** A rectangle from (10, 10) to (50, 30) on the open sketch, and a fold Up about its bottom edge, onto y = 10 facing +Y. */
async function foldUp(u: SketchUser): Promise<void> {
  await u.press('r');
  await u.click({ x: 10, y: 10 });
  await u.click({ x: 50, y: 30 });
  await u.press('Escape');
  await u.press('Escape');
  const s = await u.sketch() as Sketch;
  const bottom = Object.values(s.curves).find((c): c is Line => c.type === 'line' && s.points[c.a].y < 10.5 && s.points[c.b].y < 10.5);
  if (!bottom) throw new Error('no bottom edge');
  await u.click({ x: 30, y: 10 });
  expect(await u.page.evaluate(() => window.__sketch.selection)).toEqual([bottom.id]);
  await u.page.keyboard.press('ArrowUp');
  await u.landed();
}

test.describe('the ViewCube', () => {
  test('sits in the top right in design mode, and just left of the Sketch Palette in sketch mode, clear of it', async ({ page }) => {
    const u = await fresh(page);
    const canvas = await page.locator('canvas.canvas').boundingBox() as Box;
    let c = await cube(page);
    expect(c.size).toBeGreaterThanOrEqual(90);
    expect(c.size).toBeLessThanOrEqual(100);
    expect(c.x + c.size / 2).toBeCloseTo(canvas.x + canvas.width - 8, 0);
    expect(c.y - c.size / 2).toBeCloseTo(canvas.y + 8, 0);
    // Home shows the FRONT, RIGHT and TOP corner, the face colour where no label is.
    expect(c.faces.map((f) => f.label).sort()).toEqual(['FRONT', 'RIGHT', 'TOP']);
    expect(await pixel(page, await cubePoint(page, 'front', { s: 0, t: 0.5 }))).toEqual(rgb('light', 'cubeFace'));
    const home = await page.locator('.cube-home').boundingBox() as Box;
    // Its Home icon just outside the cube's top left.
    expect(home.x + home.width).toBeCloseTo(c.x - c.size / 2, 0);
    expect(home.y).toBeCloseTo(c.y - c.size / 2, 0);

    await u.newSketch('XY');
    c = await cube(page);
    const palette = await page.locator('.palette').boundingBox() as Box;
    // Looking straight down on XY: TOP, upright, +Y up the screen.
    expect(c.faces.map((f) => f.label)).toEqual(['TOP']);
    expect(c.faces[0].up.y).toBeCloseTo(-1, 9);
    expect(c.x + c.size / 2).toBeLessThanOrEqual(palette.x - 4);
    expect(c.x + c.size / 2).toBeGreaterThan(palette.x - 20);
    expect(c.y - c.size / 2).toBeCloseTo(palette.y, 0);
    expect(overlaps(squareOf(c), palette)).toBe(false);
    const homeIcon = await page.locator('.cube-home').boundingBox() as Box;
    expect(overlaps(homeIcon, palette)).toBe(false);
    expect(await pixel(page, await cubePoint(page, 'top', { s: 0, t: 0.5 }))).toEqual(rgb('light', 'cubeFace'));
  });

  test('a click on TOP looks down -Z, on FRONT along +Y, on a corner isometrically, swinging there', async ({ page }) => {
    const u = await fresh(page);
    await clickCube(u, 'top');
    expect(await page.evaluate(() => window.__sketch.swinging)).toBe(true);
    await u.landed();
    let cam = await camera(page);
    // Looking down -Z: the camera is above. Home's spin is not square to an axis, so +Y is up the screen.
    near(cam?.from as Vec3, { x: 0, y: 0, z: 1 });
    near(cam?.up as Vec3, { x: 0, y: 1, z: 0 });
    expect((await cube(page)).faces.map((f) => f.label)).toEqual(['TOP']);

    // From straight above FRONT is the band at the bottom of TOP: its edge, at 45 degrees.
    await clickCube(u, 'top-front');
    await u.landed();
    cam = await camera(page);
    near(cam?.from as Vec3, { x: 0, y: -Math.SQRT1_2, z: Math.SQRT1_2 });
    expect(cam?.right.z).toBeCloseTo(0, 9);

    await clickCube(u, 'front');
    await u.landed();
    cam = await camera(page);
    // Looking along +Y, from -Y, Z up.
    near(cam?.from as Vec3, { x: 0, y: -1, z: 0 });
    near(cam?.up as Vec3, { x: 0, y: 0, z: 1 });
    near(cam?.right as Vec3, { x: 1, y: 0, z: 0 });

    await clickCube(u, 'top-front-right');
    await u.landed();
    cam = await camera(page);
    near(cam?.right as Vec3, HOME.right);
    near(cam?.up as Vec3, HOME.up);
    expect(await page.evaluate(() => window.__sketch.mode)).toBe('design');
  });

  test('hover lights the face, edge or corner under the cursor', async ({ page }) => {
    const u = await fresh(page);
    const face = await cubePoint(page, 'front', { s: 0, t: 0.5 });
    await page.mouse.move(face.x, face.y, { steps: 2 });
    await u.settle();
    expect((await cube(page)).hover).toBe('front');
    expect(await pixel(page, face)).toEqual(rgb('light', 'cubeHover'));
    expect(await page.locator('canvas.canvas').evaluate((c) => (c as HTMLCanvasElement).style.cursor)).toBe('pointer');

    const edge = await cubePoint(page, 'front-right');
    await page.mouse.move(edge.x, edge.y, { steps: 2 });
    await u.settle();
    expect((await cube(page)).hover).toBe('front-right');
    expect(await pixel(page, face)).toEqual(rgb('light', 'cubeFace'));
    expect(await pixel(page, edge)).toEqual(rgb('light', 'cubeHover'));

    const corner = await cubePoint(page, 'top-front-right');
    await page.mouse.move(corner.x, corner.y, { steps: 2 });
    await u.settle();
    expect((await cube(page)).hover).toBe('top-front-right');

    const c = await cube(page);
    await page.mouse.move(c.x - c.size, c.y + c.size, { steps: 2 });
    await u.settle();
    expect((await cube(page)).hover).toBeNull();
    expect(await pixel(page, face)).toEqual(rgb('light', 'cubeFace'));
  });

  test('a drag on the cube orbits, as one on the view does, and its Home icon goes Home', async ({ page }) => {
    const u = await fresh(page);
    const at = await cubePoint(page, 'top');
    await page.mouse.move(at.x, at.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.move(at.x - 80, at.y + 30, { steps: 8 });
    await page.mouse.up();
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.swinging)).toBe(false);
    let cam = await camera(page);
    // Turned about Z and tilted, as a drag on the view turns it: not a click on TOP.
    expect(Math.abs((cam?.right.x as number) - HOME.right.x)).toBeGreaterThan(0.1);
    expect(cam?.up.z).toBeGreaterThan(0.5);
    expect(cam?.from.z).toBeLessThan(0.99);

    await page.locator('.cube-home').click();
    await u.landed();
    cam = await camera(page);
    near(cam?.right as Vec3, HOME.right);
    near(cam?.up as Vec3, HOME.up);

    // From a sketch a drag opens the Orbit view, there and then, and Esc goes back.
    await u.newSketch('XY');
    const top = await cubePoint(page, 'top');
    await page.mouse.move(top.x, top.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.move(top.x + 10, top.y + 60, { steps: 8 });
    await page.mouse.up();
    await u.settle();
    expect(await page.evaluate(() => [window.__sketch.mode, window.__sketch.orbiting, window.__sketch.swinging])).toEqual(['sketch', true, false]);
    expect(((await camera(page))?.from.z as number)).toBeLessThan(0.99);
    await u.press('Escape');
    await u.landed();
    expect(await page.evaluate(() => [window.__sketch.orbiting, window.__sketch.scene])).toEqual([false, null]);

    // And its Home icon, from a sketch, is the Orbit view at Home, as V gives it.
    await page.locator('.cube-home').click();
    await u.landed();
    expect(await page.evaluate(() => [window.__sketch.mode, window.__sketch.orbiting])).toEqual(['sketch', true]);
    cam = await camera(page);
    near(cam?.right as Vec3, HOME.right);
    await u.press('v');
    await u.landed();
    expect(await page.evaluate(() => window.__sketch.orbiting)).toBe(false);
  });

  test('on a sketch folded onto y = 10 it shows BACK, upside down, and a click opens the Orbit view that Esc leaves', async ({ page }) => {
    const u = await fresh(page);
    await u.newSketch('XY');
    await foldUp(u);
    const frame = await page.evaluate(() => window.__sketch.frame);
    expect(frame).toEqual({ o: { x: 0, y: 10, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 } });
    const id = await page.evaluate(() => window.__sketch.activeId);
    let c = await cube(page);
    // Looking from +Y with -Z up the screen: BACK, its label upside down, the top of the cube at the bottom.
    expect(c.faces.map((f) => f.label)).toEqual(['BACK']);
    expect(c.faces[0].up.y).toBeCloseTo(1, 9);
    expect(c.faces[0].right.x).toBeCloseTo(-1, 9);
    expect((await cubePoint(page, 'top-back')).y).toBeGreaterThan(c.y + c.half / 2);
    const mid = await cubePoint(page, 'back', { s: 0, t: 0.5 });
    await page.mouse.move(mid.x, mid.y, { steps: 2 });
    await u.settle();
    expect((await cube(page)).hover).toBe('back');

    await page.mouse.down();
    await page.mouse.up();
    await u.landed();
    expect(await page.evaluate(() => [window.__sketch.mode, window.__sketch.orbiting, window.__sketch.activeId])).toEqual(['sketch', true, id]);
    const cam = await camera(page);
    near(cam?.from as Vec3, { x: 0, y: 1, z: 0 });
    near(cam?.up as Vec3, { x: 0, y: 0, z: 1 });
    c = await cube(page);
    expect(c.faces.map((f) => f.label)).toEqual(['BACK']);
    expect(c.faces[0].up.y).toBeCloseTo(-1, 6);

    await u.press('Escape');
    await u.landed();
    expect(await page.evaluate(() => [window.__sketch.mode, window.__sketch.orbiting, window.__sketch.scene, window.__sketch.activeId])).toEqual(['sketch', false, null, id]);
    expect(await page.evaluate(() => window.__sketch.frame)).toEqual(frame);
    expect((await cube(page)).faces[0].up.y).toBeCloseTo(1, 9);
  });

  test('works while a plane is picked, and Esc still cancels the pick', async ({ page }) => {
    const u = await fresh(page);
    await page.getByRole('button', { name: 'Create Sketch' }).first().click();
    await u.landed();
    const size = await page.evaluate(() => window.__sketch.planeSize);
    const square = await u.planeScreen('XY', size * 0.8, size * 0.8);
    await page.mouse.move(square.x, square.y, { steps: 2 });
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.pickHover)).toBe('XY');
    // On the cube nothing under it is lit, and a click turns the view without picking a plane.
    await clickCube(u, 'top');
    expect(await page.evaluate(() => window.__sketch.pickHover)).toBeNull();
    await u.landed();
    expect(await page.evaluate(() => [window.__sketch.picking, window.__sketch.mode, window.__sketch.design().order.length])).toEqual([true, 'design', 0]);
    near((await camera(page))?.from as Vec3, { x: 0, y: 0, z: 1 });
    await u.press('Escape');
    expect(await page.evaluate(() => window.__sketch.picking)).toBe(false);

    // Turned to look from the left and above, the YZ square is in front where it is picked.
    await page.getByRole('button', { name: 'Create Sketch' }).first().click();
    await u.landed();
    await clickCube(u, 'top-left');
    await u.landed();
    expect(await page.evaluate(() => window.__sketch.picking)).toBe(true);
    await u.pickPlane('YZ');
    expect(await page.evaluate(() => window.__sketch.mode)).toBe('sketch');
    expect((await cube(page)).faces.map((f) => f.label)).toEqual(['RIGHT']);
  });

  test('takes its colours from the theme: dark faces and a dark hover in Dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const u = await fresh(page);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    const face = await cubePoint(page, 'right', { s: 0, t: -0.5 });
    expect(await pixel(page, face)).toEqual(rgb('dark', 'cubeFace'));
    await page.mouse.move(face.x, face.y, { steps: 2 });
    await u.settle();
    expect((await cube(page)).hover).toBe('right');
    expect(await pixel(page, face)).toEqual(rgb('dark', 'cubeHover'));
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/cube-dark.png`, clip: { x: (await cube(page)).x - 70, y: 0, width: 140, height: 130 } });
  });
});
