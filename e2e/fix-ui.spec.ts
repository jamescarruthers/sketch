// Regressions for the audit findings on creating, the sketch shell and the tutorials. Real mouse and
// keyboard; results read from window.__sketch. Ids are the audit's: C- create, M- modify, W- workflow.
import { expect, test, type Page } from '@playwright/test';
import { constraintsOfType, pointAt, SketchUser, type Xy } from './helpers';
import type { Circle, Conic, Curve, FitSpline, Line, Sketch, TextEntity } from '../src/model/types';
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

const FLYOUT: Record<string, string> = {
  'Circumscribed Polygon': 'Polygon', 'Inscribed Polygon': 'Polygon', 'Edge Polygon': 'Polygon',
  'Overall Slot': 'Slot', 'Center To Center Slot': 'Slot', 'Three Point Arc Slot': 'Slot', 'Center Point Arc Slot': 'Slot',
  'Fit Point Spline': 'Spline', 'Control Point Spline': 'Spline', '2-Point Rectangle': 'Rectangle',
  'Center Diameter Circle': 'Circle', '2-Point Circle': 'Circle', '2-Tangent Circle': 'Circle',
  '3-Point Arc': 'Arc', 'Tangent Arc': 'Arc',
};

async function pick(u: SketchUser, label: string): Promise<void> {
  const { page } = u;
  const pinned = page.locator(`.tool-btn[aria-label="${label}"]`);
  if (await pinned.count()) await pinned.first().click();
  else {
    await page.getByRole('button', { name: /^CREATE/ }).click();
    if (FLYOUT[label]) await page.locator(`.menu-item.flyout[data-item="${FLYOUT[label]}"]`).hover();
    await page.locator(`.menu-item[data-item="${label}"]`).click();
  }
  await u.settle();
}

const tool = (page: Page): Promise<string | null> => page.evaluate(() => window.__sketch.tool);
const dist = (a: Xy, b: Xy): number => Math.hypot(a.x - b.x, a.y - b.y);
const curvesOf = <T extends Curve>(s: Sketch, type: T['type']): T[] => Object.values(s.curves).filter((c): c is T => c.type === type);
const texts = async (u: SketchUser): Promise<TextEntity[]> => curvesOf<TextEntity>(await u.sketch(), 'text');

async function line(u: SketchUser, a: Xy, b: Xy): Promise<void> {
  await u.press('l');
  await u.click(a);
  await u.click(b);
  await u.press('Enter');
}

async function circle(u: SketchUser, c: Xy, r: number): Promise<void> {
  await u.press('c');
  await u.click(c);
  await u.click({ x: c.x + r, y: c.y });
  await u.press('Escape');
  await u.press('Escape');
}

const textDialog = (page: Page) => page.locator('.dialog[data-dialog="Text"]');

/** Frame text through the dialog: type it, click the corners, OK. */
async function frameText(u: SketchUser, a: Xy, b: Xy, text: string, height = 10): Promise<void> {
  await pick(u, 'Text');
  await u.click(a);
  await u.click(b);
  const d = textDialog(u.page);
  await d.locator('textarea').fill(text);
  await d.locator('.form-row', { hasText: 'Height' }).locator('input').fill(`${height} mm`);
  await d.getByRole('button', { name: 'OK' }).click();
  await u.settle();
  await u.page.mouse.move(5, 5);
}

/** Text On Path on the curve under `at`. */
async function pathText(u: SketchUser, at: Xy, text: string, height = 10): Promise<void> {
  await pick(u, 'Text');
  const d = textDialog(u.page);
  await d.locator('.form-row', { hasText: 'Type' }).locator('select').selectOption('path');
  await u.settle();
  await u.click(at);
  await d.locator('textarea').fill(text);
  await d.locator('.form-row', { hasText: 'Height' }).locator('input').fill(`${height} mm`);
  await d.getByRole('button', { name: 'OK' }).click();
  await u.settle();
  await u.page.mouse.move(5, 5);
  await u.settle();
}

/** A screen spot painted in text colour in a sketch-space box: somewhere on an actual letter, not beside it. */
async function letterIn(u: SketchUser, min: Xy, max: Xy): Promise<Xy> {
  const a = await u.screen({ x: min.x, y: max.y });
  const b = await u.screen({ x: max.x, y: min.y });
  await u.settle();
  const found = await u.page.evaluate(([x0, y0, x1, y1]) => {
    const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const dpr = canvas.width / box.width;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        // Solid in all of a 5 px cross: inside a stroke, not on its edge.
        const solid = [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dy]) => {
          const d = g.getImageData((x - box.left + dx) * dpr, (y - box.top + dy) * dpr, 1, 1).data;
          return Math.abs(d[0] - 10) < 12 && Math.abs(d[1] - 132) < 12 && Math.abs(d[2] - 214) < 12;
        });
        if (solid) return { x, y };
      }
    }
    return null;
  }, [Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y)]);
  expect(found, 'a letter inside the box').not.toBeNull();
  return found as Xy;
}

const world = (u: SketchUser, s: Xy): Promise<Xy> => u.page.evaluate(([x, y]) => window.__sketch.toWorld(x, y), [s.x, s.y]);

test.describe('C-F3 Tab with nothing focused', () => {
  test('polygon: Tab goes to the sides, the radius stays with the cursor', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Inscribed Polygon');
    await u.click({ x: 60, y: 0 });
    await u.move({ x: 80, y: 0 });
    await u.press('Tab');
    await u.type('7');
    await u.click({ x: 80, y: 0 });
    const lines = await u.lines();
    expect(lines).toHaveLength(7);
    const s = await u.sketch();
    expect(dist(pointAt(s, lines[0].a), { x: 60, y: 0 })).toBeCloseTo(20, 3);
  });

  test('rectangle: Tab then a value sets the height, the width stays with the cursor', async ({ page }) => {
    const u = await start(page);
    await pick(u, '2-Point Rectangle');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 40, y: 30 });
    await u.press('Tab');
    await u.type('15');
    await u.click({ x: 40, y: 30 });
    const s = await u.sketch();
    const ys = Object.values(s.points).map((p) => p.y);
    const xs = Object.values(s.points).map((p) => p.x);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(15, 3);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 0);
  });

  test('line: Tab then a value sets the angle', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 10 });
    await u.move({ x: 30, y: 25 });
    await u.press('Tab');
    await u.type('45');
    await u.click({ x: 30, y: 25 });
    const s = await u.sketch();
    const [l] = await u.lines();
    const a = pointAt(s, l.a);
    const b = pointAt(s, l.b);
    expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(45, 3);
    expect(dist(a, b)).toBeGreaterThan(20);
  });

  test('a single field stays put and Shift+Tab goes to the last', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Center Diameter Circle');
    await u.click({ x: 0, y: 30 });
    await u.move({ x: 20, y: 30 });
    await u.press('Tab');
    await expect(page.locator('.hud-field input').first()).toBeFocused();
    await u.press('Escape');
    await u.press('Escape');
    await u.press('Escape');
    await pick(u, '2-Point Rectangle');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 40, y: 30 });
    await u.press('Shift+Tab');
    await expect(page.locator('.hud-field input').last()).toBeFocused();
  });
});

test.describe('M-F27 clicking the HUD', () => {
  test('clicking a value box focuses it and the value drives the geometry', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 80, y: 30 });
    await page.locator('.hud-field[data-key="angle"] input').click();
    await expect(page.locator('.hud-field[data-key="angle"] input')).toBeFocused();
    await u.type('60');
    await u.press('Enter');
    const s = await u.sketch();
    const [l] = await u.lines();
    expect(l).toBeTruthy();
    const b = pointAt(s, l.b);
    expect((Math.atan2(b.y, b.x) * 180) / Math.PI).toBeCloseTo(60, 3);
  });

  test('a box that stays put takes a click after the pointer reaches it; one that appeared under the pointer leaves the press to the tool', async ({ page }) => {
    const u = await start(page);
    // The slot's width box is centred on the cursor, so it is under the pointer however long the pointer waits.
    await pick(u, 'Center To Center Slot');
    await u.click({ x: -40, y: 40 });
    await u.click({ x: 0, y: 40 });
    await u.move({ x: -20, y: 55 });
    await page.waitForTimeout(800);
    await page.mouse.down();
    await page.mouse.up();
    await u.settle();
    // Placed: the width box went with the step, and nothing took the press.
    await expect(page.locator('.hud-field[data-key="width"]')).toHaveCount(0);
    const s = await u.sketch();
    const [a] = curvesOf<import('../src/model/types').Arc>(s, 'arc');
    expect(curvesOf(s, 'arc')).toHaveLength(2);
    expect(dist(pointAt(s, a.c), pointAt(s, a.a))).toBeCloseTo(15, 4);
    await u.press('Escape');
    await u.press('Escape');

    // The line's angle box is set once and stays where it was put: the pointer comes to it and the press is the box's.
    const placed = (await u.lines()).length;
    await u.press('l');
    await u.click({ x: -60, y: -30 });
    await u.move({ x: 20, y: -10 });
    const angle = page.locator('.hud-field[data-key="angle"] input');
    const box = await angle.boundingBox();
    expect(box).not.toBeNull();
    const { x, y, height } = box as { x: number; y: number; height: number };
    await page.mouse.move(x - 12, y + height / 2);
    await page.mouse.move(x + 20, y + height / 2, { steps: 32 });
    await u.settle();
    await page.waitForTimeout(800);
    await page.mouse.down();
    await page.mouse.up();
    await expect(angle).toBeFocused();
    expect(await u.lines()).toHaveLength(placed);
  });

  test('placing a small shape on top of its own value boxes still places it', async ({ page }) => {
    const u = await start(page);
    await pick(u, '2-Point Rectangle');
    await u.click({ x: -60, y: -10 });
    await u.click({ x: -50, y: 0 });
    expect(await u.lines()).toHaveLength(4);
  });

  test('a box does not take clicks in the empty space around it, or riding along under the cursor', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 80, y: 30 });
    const box = await page.locator('.hud-field[data-key="angle"]').boundingBox();
    expect(box).not.toBeNull();
    const { x, y, height } = box as { x: number; y: number; height: number };
    // Just left of the box, then on its label strip: both canvas.
    await page.mouse.move(x - 3, y + height / 2, { steps: 3 });
    await u.settle();
    await page.mouse.down();
    await page.mouse.up();
    await u.settle();
    expect(await u.lines()).toHaveLength(1);
    await u.press('Enter');
    await u.press('Escape');

    // A field centred on the cursor must not swallow the click that places.
    await pick(u, 'Center To Center Slot');
    await u.click({ x: -40, y: 40 });
    await u.click({ x: 0, y: 40 });
    await u.click({ x: -20, y: 55 });
    expect(curvesOf(await u.sketch(), 'arc').length).toBe(2);
  });
});

test.describe('C-F1 text on a path', () => {
  test('selected, edited and exploded by its letters, and window selected', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -50, y: 0.01 }, { x: 30, y: 0.01 });
    await pathText(u, { x: 10, y: 0 }, 'PATH', 10);
    const [t] = await texts(u);
    expect(t.mode).toBe('path');
    await u.press('Escape');
    const on = await letterIn(u, { x: -50, y: 2 }, { x: -20, y: 9 });
    const at = await world(u, on);

    await u.click(at);
    expect(await page.evaluate(() => window.__sketch.selection)).toEqual([t.id]);
    await u.click({ x: -70, y: 60 });

    await u.doubleClick(at);
    await expect(textDialog(page)).toBeVisible();
    await expect(textDialog(page).locator('textarea')).toHaveValue('PATH');
    await textDialog(page).locator('.dialog-foot .btn', { hasText: 'Cancel' }).click();
    await u.settle();

    // Window round the letters only, left to right, clear of the line.
    await u.drag({ x: -60, y: 20 }, { x: -2, y: -2 });
    expect(await page.evaluate(() => window.__sketch.selection)).toEqual([t.id]);
    await u.click({ x: -70, y: 60 });

    await u.rightClick(at);
    await page.locator('[data-item="explode-text"]').click();
    await u.settle();
    expect(await texts(u)).toHaveLength(0);
    expect((await u.curves()).length).toBeGreaterThan(5);
  });

  test('moved along its circle by Move/Copy and by dragging', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: 0, y: 0 }, 40);
    await pathText(u, { x: -40, y: 0 }, 'TOP', 10);
    await u.press('Escape');
    // It reads over the top [C-F38]: left aligned, it starts at nine o'clock.
    const before = await letterIn(u, { x: -55, y: -5 }, { x: 0, y: 55 });
    await u.click(await world(u, before));
    await u.press('m');
    const d = page.locator('.dialog[data-dialog="Move/Copy"]');
    await expect(d.locator('.select-count')).toHaveText('1 selected');
    await d.locator('.form-row', { hasText: 'Z Angle' }).locator('input').fill('-90 deg');
    await d.getByRole('button', { name: 'OK' }).click();
    await u.settle();
    await page.mouse.move(5, 5);
    await u.settle();
    const [t] = await texts(u);
    expect(t.offset ?? 0).toBeCloseTo((40 * Math.PI) / 2, 0);
    // A quarter turn clockwise puts the letters at twelve o'clock; the old spot is bare.
    await letterIn(u, { x: -5, y: 38 }, { x: 40, y: 55 });

    await u.press('Escape');
    const on = await world(u, await letterIn(u, { x: -5, y: 38 }, { x: 40, y: 55 }));
    await u.drag(on, { x: on.y, y: -on.x });
    const [moved] = await texts(u);
    expect(moved.offset ?? 0).toBeGreaterThan((t.offset ?? 0) + 40);
    await u.press('Meta+z');
    expect((await texts(u))[0].offset ?? 0).toBeCloseTo(t.offset ?? 0, 3);
  });
});

test('C-F14 frame text answers to its letters, right-click and double-click', async ({ page }) => {
  const u = await start(page);
  await frameText(u, { x: -50, y: -10 }, { x: 25, y: 30 }, 'Fi8', 20);
  await u.press('Escape');
  const [t] = await texts(u);
  const at = await world(u, await letterIn(u, { x: -50, y: -10 }, { x: 25, y: 30 }));
  await u.doubleClick(at);
  await expect(textDialog(page)).toBeVisible();
  await textDialog(page).locator('.dialog-foot .btn', { hasText: 'Cancel' }).click();
  await u.settle();
  await u.rightClick(at);
  await page.locator('[data-item="explode-text"]').click();
  await u.settle();
  const s = await u.sketch();
  expect(s.curves[t.id]).toBeUndefined();
  expect(Object.values(s.curves).filter((c) => c.type === 'line' && c.frameOf)).toHaveLength(0);
  expect(Object.values(s.curves).every((c) => c.fixed)).toBe(true);
});

test('C-F4 Midpoint Line has an angle field', async ({ page }) => {
  const u = await start(page);
  await pick(u, 'Midpoint Line');
  await u.click({ x: 0, y: 20 });
  await u.move({ x: 30, y: 30 });
  await u.type('40');
  await u.press('Tab');
  await u.type('30');
  await u.click({ x: 30, y: 30 });
  const s = await u.sketch();
  const [l] = await u.lines();
  const a = pointAt(s, l.a);
  const b = pointAt(s, l.b);
  expect(dist(a, b)).toBeCloseTo(40, 4);
  expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(30, 3);
  const dims = Object.values(s.dimensions);
  expect(dims.map((d) => d.kind).sort()).toEqual(['angle', 'distance']);
});

test('C-F5 Overall Slot dimensions the overall length, between real end points', async ({ page }) => {
  const u = await start(page);
  await pick(u, 'Overall Slot');
  await u.click({ x: -20, y: 10 });
  await u.move({ x: 20, y: 11 });
  await u.type('50');
  await u.press('Tab');
  await u.type('15');
  await u.press('Enter');
  await u.move({ x: 0, y: 30 });
  await u.type('20');
  await u.press('Enter');
  const s = await u.sketch();
  const lengths = Object.values(s.dimensions).filter((d) => d.kind === 'distance');
  expect(lengths).toHaveLength(1);
  expect(lengths[0].value).toBeCloseTo(50, 5);
  const centre = (await u.lines()).find((l) => l.lineType === 'construction') as Line;
  expect(dist(pointAt(s, centre.a), pointAt(s, centre.b))).toBeCloseTo(50, 4);
  expect(constraintsOfType(s, 'midpoint')).toBe(2);
  expect((await u.analysis()).unsatisfied).toEqual([]);
  // The end point is a real, snappable point of the slot.
  expect(pointAt(s, centre.a).x).toBeCloseTo(-20, 3);
});

test.describe('C-F6 curvature handles', () => {
  const spline = async (u: SketchUser): Promise<void> => {
    await pick(u, 'Fit Point Spline');
    for (const p of [{ x: -40, y: 0 }, { x: -10, y: 25 }, { x: 20, y: 5 }, { x: 45, y: 30 }]) await u.click(p);
    await u.press('Enter');
    await u.press('Escape');
    await u.press('Escape');
  };
  const green = (page: Page): Promise<number> => page.evaluate(() => {
    const c = document.querySelector('canvas.canvas') as HTMLCanvasElement;
    const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 26) < 10 && Math.abs(d[i + 1] - 158) < 10 && Math.abs(d[i + 2] - 75) < 10) n++;
    return n;
  });

  test('selecting the spline shows two-ended handles, and a drag bends it', async ({ page }) => {
    const u = await start(page);
    await spline(u);
    expect(await green(page)).toBe(0);
    const [sp0] = curvesOf<FitSpline>(await u.sketch(), 'fitSpline');
    await u.click({ x: -10, y: 25 });
    await u.settle();
    expect(await green(page), 'selecting a fit point shows them').toBeGreaterThan(40);
    await u.click({ x: -70, y: 60 });
    expect(await green(page)).toBe(0);
    await u.click({ x: 1.8, y: 18.3 });
    expect(await page.evaluate(() => window.__sketch.selection)).toEqual([sp0.id]);
    await u.settle();
    expect(await green(page), 'selecting the curve shows them').toBeGreaterThan(40);

    // A far end of the handle at the second fit point: the green pixel furthest from it nearby.
    const s = await u.sketch();
    const m = pointAt(s, sp0.pts[1]);
    const ring = await u.screen(m);
    const tip = await page.evaluate(([cx, cy]) => {
      const c = document.querySelector('canvas.canvas') as HTMLCanvasElement;
      const box = c.getBoundingClientRect();
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      const d = g.getImageData(cx - box.left - 90, cy - box.top - 90, 180, 180).data;
      let best = { x: 0, y: 0, r: 0 };
      for (let y = 0; y < 180; y++) {
        for (let x = 0; x < 180; x++) {
          const i = (y * 180 + x) * 4;
          if (Math.abs(d[i] - 26) < 10 && Math.abs(d[i + 1] - 158) < 10 && Math.abs(d[i + 2] - 75) < 10) {
            const r = Math.hypot(x - 90, y - 90);
            if (r > best.r && r < 90) best = { x: cx - 90 + x, y: cy - 90 + y, r };
          }
        }
      }
      return best;
    }, [ring.x, ring.y]);
    expect(tip.r).toBeGreaterThan(20);
    const dir = { x: (tip.x - ring.x) / tip.r, y: (tip.y - ring.y) / tip.r };
    // Grab just inside the ring's edge and swing it a quarter turn.
    const grab = { x: tip.x - dir.x * 3, y: tip.y - dir.y * 3 };
    await page.mouse.move(grab.x, grab.y, { steps: 2 });
    await u.settle();
    await page.mouse.down();
    await page.mouse.move(ring.x - dir.y * 40, ring.y + dir.x * 40, { steps: 6 });
    await u.settle();
    await page.mouse.up();
    await u.settle();
    const after = curvesOf<FitSpline>(await u.sketch(), 'fitSpline')[0];
    expect(after.handles[1]).toBeTruthy();
    expect(await page.evaluate(() => window.__sketch.selection)).toEqual([sp0.id]);
    const a2 = await u.sketch();
    const h = pointAt(a2, after.handles[1] as string);
    const mm = pointAt(a2, after.pts[1]);
    expect(mm.x).toBeCloseTo(m.x, 4);
    expect(mm.y).toBeCloseTo(m.y, 4);
    // One undo takes the whole handle gesture back.
    const was = await page.evaluate(() => window.__sketch.canUndo);
    expect(was).toBe(true);
    expect(dist(h, mm)).toBeGreaterThan(5);
    await u.press('Meta+z');
    expect(curvesOf<FitSpline>(await u.sketch(), 'fitSpline')[0].handles[1]).toBeNull();
  });
});

test.describe('C-F8 Conic Rho', () => {
  const vertex = async (u: SketchUser): Promise<void> => {
    await pick(u, 'Conic Curve');
    await u.click({ x: -30, y: 0.5 });
    await u.click({ x: 30, y: 0.5 });
    await u.click({ x: 0, y: 40 });
  };

  test('Enter straight after the vertex uses the default 0.5', async ({ page }) => {
    const u = await start(page);
    await vertex(u);
    await u.press('Enter');
    const [k] = curvesOf<Conic>(await u.sketch(), 'conic');
    expect(k.rho).toBeCloseTo(0.5, 6);
    expect(await tool(page)).toBe('select');
  });

  test('the handle holds what it was dragged to, wherever the cursor goes after', async ({ page }) => {
    const u = await start(page);
    await vertex(u);
    await u.move({ x: 60, y: 60 });
    await u.drag({ x: 0, y: 20.25 }, { x: 0, y: 32 });
    await u.move({ x: 50, y: 0.5 });
    await u.press('Enter');
    const [k] = curvesOf<Conic>(await u.sketch(), 'conic');
    expect(k.rho).toBeCloseTo((32 - 0.5) / 39.5, 2);
  });

  test('moving without dragging changes nothing', async ({ page }) => {
    const u = await start(page);
    await vertex(u);
    await u.move({ x: 0, y: 35 });
    await expect(page.locator('.hud-field[data-key="rho"] input')).toHaveValue('0.5');
    await u.press('Enter');
    expect(curvesOf<Conic>(await u.sketch(), 'conic')[0].rho).toBeCloseTo(0.5, 6);
  });
});

test.describe('C-F9 frame text', () => {
  test('Enter in the Text box is a new line and leaves the dialog open', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Text');
    await u.click({ x: -50, y: -10 });
    await u.click({ x: 25, y: 30 });
    const area = textDialog(page).locator('textarea');
    await area.click();
    await page.keyboard.type('L1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('L2');
    await expect(textDialog(page)).toBeVisible();
    await expect(area).toHaveValue('L1\nL2');
    expect(await texts(u)).toHaveLength(0);
    await page.keyboard.press('Control+Enter');
    await u.settle();
    expect((await texts(u))[0].text).toBe('L1\nL2');
  });

  const ink = (u: SketchUser, top: number, bottom: number, x0: number, x1: number): Promise<number> => u.page.evaluate(async ([t, b, l, r]) => {
    const c = document.querySelector('canvas.canvas') as HTMLCanvasElement;
    const box = c.getBoundingClientRect();
    const a = window.__sketch.toScreen(l, t);
    const z = window.__sketch.toScreen(r, b);
    const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(a.x - box.left, a.y - box.top, z.x - a.x, z.y - a.y).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 10) < 14 && Math.abs(d[i + 1] - 132) < 14 && Math.abs(d[i + 2] - 214) < 14) n++;
    return n;
  }, [top, bottom, x0, x1]);

  test('long text wraps inside the frame, and reflows when the frame is dimensioned wider', async ({ page }) => {
    const u = await start(page);
    await frameText(u, { x: -60, y: -40 }, { x: 0, y: 40 }, 'alpha beta gamma delta epsilon zeta', 8);
    await u.click({ x: -85, y: 60 });
    await page.mouse.move(5, 5);
    await u.settle();
    // Nothing right of the frame, and text on more than one row near the top.
    expect(await ink(u, 40, -40, 1.5, 90)).toBe(0);
    expect(await ink(u, -22, -40, -60, 0)).toBeGreaterThan(30);

    await u.press('d');
    await u.click({ x: -30, y: 40 });
    await u.click({ x: -30, y: 55 });
    await u.type('150');
    await u.press('Enter');
    await u.press('Escape');
    await u.press('Escape');
    await u.settle();
    await page.mouse.move(5, 5);
    await u.settle();
    const s = await u.sketch();
    const [t] = await texts(u);
    const f = (t.frame as string[]).map((id) => pointAt(s, id));
    expect(dist(f[0], f[1])).toBeCloseTo(150, 3);
    expect(await ink(u, -22, -40, -150, 150), 'the last row, at the bottom').toBeGreaterThan(30);
    expect(await ink(u, 30, -15, -150, 150), 'fewer rows: nothing up where the third was').toBe(0);
  });
});

test.describe('C-F10 text frame', () => {
  test('nine snap points: clicking one changes the pivot and leaves the frame where it is', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Text');
    await u.click({ x: -70, y: -10 });
    await u.click({ x: 10, y: 30 });
    const d = textDialog(page);
    await d.locator('textarea').fill('Pivot');
    await d.locator('.form-row', { hasText: 'Angle' }).locator('input').fill('30 deg');
    await u.settle();
    const rot = (p: Xy): Xy => {
      const c = Math.cos(Math.PI / 6);
      const s = Math.sin(Math.PI / 6);
      const x = p.x + 70;
      const y = p.y + 10;
      return { x: -70 + x * c - y * s, y: -10 + x * s + y * c };
    };
    // Click the centre of the frame. The status must not go back to asking for a corner.
    await u.click(rot({ x: -30, y: 10 }));
    expect(await page.evaluate(() => window.__sketch.status)).not.toContain('corner of the text frame');
    await expect(d.locator('.form-row', { hasText: 'Angle' }).locator('input')).toHaveValue('30 deg');
    await d.locator('.form-row', { hasText: 'Angle' }).locator('input').fill('60 deg');
    await d.getByRole('button', { name: 'OK' }).click();
    await u.settle();
    const s = await u.sketch();
    const [t] = await texts(u);
    const f = (t.frame as string[]).map((id) => pointAt(s, id));
    // It turned about the centre: the centre has stayed, size intact, now at 60 degrees.
    const mid = { x: (f[0].x + f[2].x) / 2, y: (f[0].y + f[2].y) / 2 };
    const want = rot({ x: -30, y: 10 });
    expect(mid.x).toBeCloseTo(want.x, 4);
    expect(mid.y).toBeCloseTo(want.y, 4);
    expect(dist(f[0], f[1])).toBeCloseTo(80, 4);
    expect((Math.atan2(f[1].y - f[0].y, f[1].x - f[0].x) * 180) / Math.PI).toBeCloseTo(60, 3);
  });

  test('frame edges are lines: Dimension, H/V and Tangent take them', async ({ page }) => {
    const u = await start(page);
    await frameText(u, { x: -70, y: 0 }, { x: 10, y: 30 }, 'Edge');
    await u.press('Escape');
    await circle(u, { x: -30, y: -40 }, 20);
    // Dimension the top edge.
    await u.press('d');
    await u.click({ x: -32, y: 30 });
    await u.click({ x: -30, y: 50 });
    await u.type('100');
    await u.press('Enter');
    await u.press('Escape');
    await u.press('Escape');
    let s = await u.sketch();
    let [t] = await texts(u);
    let f = (t.frame as string[]).map((id) => pointAt(s, id));
    expect(dist(f[2], f[3])).toBeCloseTo(100, 3);
    // Tangent: the bottom edge and the circle.
    await pick(u, 'Tangent');
    await u.click({ x: -20, y: 0 });
    await u.click({ x: -10, y: -40 });
    await u.press('Escape');
    await u.press('Escape');
    s = await u.sketch();
    [t] = await texts(u);
    f = (t.frame as string[]).map((id) => pointAt(s, id));
    const c = curvesOf<Circle>(s, 'circle')[0];
    const m = pointAt(s, c.c);
    expect(Math.abs(f[0].y - m.y)).toBeCloseTo(c.r, 2);
    expect(constraintsOfType(s, 'tangent')).toBe(1);
    expect((await u.analysis()).unsatisfied).toEqual([]);
    // Edges are always drawn, and deleting one takes the text with it.
    await u.click({ x: (f[2].x + f[3].x) / 2 + 3, y: f[2].y });
    await u.press('Delete');
    expect(await texts(u)).toHaveLength(0);
    expect((await u.lines()).filter((l) => l.frameOf)).toHaveLength(0);
  });
});

test('C-F13 the circular pattern glyph sits at the centre and opens the pattern', async ({ page }) => {
  const u = await start(page);
  await circle(u, { x: 30, y: 0.01 }, 5);
  await pick(u, 'Circular Pattern');
  const d = page.locator('.dialog[data-dialog="Circular Pattern"]');
  await u.click({ x: 35, y: 0.01 });
  await d.locator('[data-field="Center Point"] .select-toggle').click();
  const o = await u.screen({ x: 0, y: 0 });
  await page.mouse.move(o.x, o.y);
  await page.mouse.click(o.x, o.y);
  await u.settle();
  await d.getByRole('button', { name: 'OK' }).click();
  await u.settle();
  await page.mouse.move(5, 5);
  // The source's own middle no longer opens anything.
  await u.doubleClick({ x: 30, y: 0.01 });
  await expect(d).toHaveCount(0);
  await u.press('Escape');
  // Up and right of the centre.
  const p = { x: o.x + 11, y: o.y - 11 };
  await page.mouse.move(p.x, p.y);
  await page.mouse.dblclick(p.x, p.y);
  await u.settle();
  await expect(d).toBeVisible();
});

test.describe('W-P2-1 other sketches snap and pick', () => {
  const secondSketch = async (u: SketchUser): Promise<void> => {
    await circle(u, { x: 30, y: 20 }, 15);
    await u.page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await u.settle();
    await u.newSketch();
  };

  test('a centre point in another sketch snaps; placing on it projects it, linked', async ({ page }) => {
    const u = await start(page);
    await secondSketch(u);
    const first = (await u.design()).order[0];
    const src = Object.values((await u.design()).sketches[first].curves)[0] as Circle;
    await pick(u, '3-Point Arc');
    await u.move({ x: 30.5, y: 20.5 });
    await u.settle();
    const inf = await page.evaluate(() => window.__sketch.inference());
    expect(inf?.kind).toBe('point');
    expect(inf?.pos.x).toBeCloseTo(30, 6);
    await u.click({ x: 30.5, y: 20.5 });
    await u.click({ x: -20, y: 30 });
    await u.click({ x: 0, y: 40 });
    const s = await u.sketch();
    const projected = Object.values(s.points).filter((p) => p.projected);
    expect(projected).toHaveLength(1);
    expect(projected[0].projected?.pointId).toBe(src.c);
    expect(constraintsOfType(s, 'coincident')).toBeGreaterThanOrEqual(1);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('a Tangent click on another sketch\'s circle projects it and applies', async ({ page }) => {
    const u = await start(page);
    await secondSketch(u);
    await line(u, { x: -40, y: -40 }, { x: 60, y: -30 });
    await pick(u, 'Tangent');
    await u.click({ x: -10, y: -37 });
    await u.click({ x: 45, y: 20 });
    await u.press('Escape');
    await u.press('Escape');
    const s = await u.sketch();
    const c = curvesOf<Circle>(s, 'circle');
    expect(c).toHaveLength(1);
    expect(c[0].projected).toBeTruthy();
    expect(c[0].r).toBeCloseTo(15, 3);
    expect(constraintsOfType(s, 'tangent')).toBe(1);
  });

  test('a line end on another sketch\'s curve goes on the projected copy; a miss adds nothing', async ({ page }) => {
    const u = await start(page);
    await secondSketch(u);
    await line(u, { x: -40, y: -40 }, { x: -20, y: -20 });
    expect((await u.sketch()).curves && curvesOf<Circle>(await u.sketch(), 'circle')).toHaveLength(0);
    await line(u, { x: -40, y: 40 }, { x: 45, y: 20.5 });
    const s = await u.sketch();
    const [c] = curvesOf<Circle>(s, 'circle');
    expect(c.projected).toBeTruthy();
    const k = Object.values(s.constraints).filter((x) => x.refs.includes(c.id));
    expect(k.length).toBeGreaterThan(0);
  });
});

test.describe('W-P2-2 tangent inference on a circle rim', () => {
  test('rim near a line: tangent shows, commits, and the radius is the distance to the line', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -60, y: 30 }, { x: 60, y: 30 });
    await pick(u, 'Center Diameter Circle');
    await u.click({ x: 0, y: -20 });
    await u.move({ x: 35.5, y: 15.4 });
    await u.settle();
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).toBe('tangent');
    await u.click({ x: 35.5, y: 15.4 });
    const s = await u.sketch();
    const [c] = curvesOf<Circle>(s, 'circle');
    expect(c.r).toBeCloseTo(50, 3);
    expect(constraintsOfType(s, 'tangent')).toBe(1);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('a rim at a line end foot still infers tangent, and a far rim does not', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 0, y: 0 }, { x: 80, y: 0.0 });
    await pick(u, 'Center Diameter Circle');
    await u.click({ x: 0, y: 50 });
    await u.move({ x: 0.4, y: 0.4 });
    await u.settle();
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).toBe('tangent');
    await u.move({ x: 30, y: 60 });
    await u.settle();
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).not.toBe('tangent');
  });

  test('rim touching another circle', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: 40, y: 0.5 }, 10);
    await pick(u, 'Center Diameter Circle');
    await u.click({ x: -20, y: 0.5 });
    await u.move({ x: 1.5, y: 46.2 });
    await u.settle();
    const inf = await page.evaluate(() => window.__sketch.inference());
    expect(inf?.kind).toBe('tangent');
    await u.click({ x: 1.5, y: 46.2 });
    const s = await u.sketch();
    const c = curvesOf<Circle>(s, 'circle');
    expect(c).toHaveLength(2);
    expect(constraintsOfType(s, 'tangent')).toBe(1);
    const big = c.reduce((a, b) => (a.r > b.r ? a : b));
    expect(big.r).toBeCloseTo(50, 2);
  });
});

test('W-P2-3 fully constrained construction draws black and dashed', async ({ page }) => {
  const u = await start(page);
  await u.press('x');
  await page.locator('.type-btn[aria-label="Construction"]').click();
  await u.press('l');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 60, y: 0 });
  await u.press('Enter');
  await u.press('d');
  await u.click({ x: 30, y: 0 });
  await u.click({ x: 30, y: 15 });
  await u.press('Enter');
  await u.press('Escape');
  await u.press('Escape');
  await u.click({ x: -80, y: 70 });
  await page.mouse.move(5, 5);
  await u.settle();
  expect((await u.analysis()).dof).toBe(0);
  const a = await u.screen({ x: 10, y: 0 });
  const b = await u.screen({ x: 50, y: 0 });
  const run = await page.evaluate(([x0, x1, y]) => {
    const c = document.querySelector('canvas.canvas') as HTMLCanvasElement;
    const box = c.getBoundingClientRect();
    const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(x0 - box.left, y - box.top - 1, x1 - x0, 3).data;
    let dark = 0;
    let orange = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) dark++;
      if (d[i] > 200 && d[i + 1] > 90 && d[i + 1] < 140 && d[i + 2] < 40) orange++;
    }
    return { dark, orange, total: d.length / 4 };
  }, [a.x, b.x, a.y]);
  expect(run.orange).toBe(0);
  expect(run.dark).toBeGreaterThan(30);
  expect(run.dark, 'still dashed').toBeLessThan(run.total * 0.5);
});

test.describe('W-P2-4 Esc in the Line tool', () => {
  test('one Esc after an open chain leaves the tool', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 40, y: 10 });
    await u.press('Escape');
    expect(await tool(page)).toBe('select');
    expect(await u.lines()).toHaveLength(1);
  });

  test('a pending first click is cancelled first, a typed value too', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 0 });
    await u.press('Escape');
    expect(await tool(page)).toBe('line');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 40, y: 10 });
    await u.move({ x: 60, y: 40 });
    await u.type('15');
    await u.press('Escape');
    expect(await tool(page)).toBe('line');
    await u.press('Escape');
    expect(await tool(page)).toBe('select');
  });
});

test.describe('W-P2-6 Create Sketch on what is already there', () => {
  const oneSketch = async (u: SketchUser): Promise<string> => {
    await circle(u, { x: 0, y: 0 }, 30);
    const id = (await u.design()).order[0];
    await u.page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await u.settle();
    await u.page.locator('.tool-btn[aria-label="Create Sketch"]').click();
    await u.settle();
    return id;
  };

  test('a browser node edits that sketch', async ({ page }) => {
    const u = await start(page);
    const id = await oneSketch(u);
    await page.locator(`.sketch-row[data-sketch="${id}"] .tree-label`).click();
    await u.settle();
    await expect(page.locator('.plane-picker')).toHaveCount(0);
    expect(await page.evaluate(() => window.__sketch.activeId)).toBe(id);
    expect((await u.design()).order).toHaveLength(1);
  });

  test('sketch geometry edits that sketch, an empty spot on a plane still makes one', async ({ page }) => {
    const u = await start(page);
    const id = await oneSketch(u);
    // On the rim, under the picker.
    const p = await u.screen({ x: 30, y: 0 });
    await page.mouse.click(p.x, p.y);
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.activeId)).toBe(id);
    expect((await u.design()).order).toHaveLength(1);
    await page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await u.settle();
    await page.locator('.tool-btn[aria-label="Create Sketch"]').click();
    await page.locator('.plane[data-plane="YZ"] polygon').click();
    await u.settle();
    expect((await u.design()).order).toHaveLength(2);
  });
});

test.describe('create polish', () => {
  test('C-F19 Project shows Selection Filter and Geometry; C-F21 the mesh entry is on the Create menu', async ({ page }) => {
    const u = await start(page);
    await u.press('p');
    const d = page.locator('.dialog[data-dialog="Project"]');
    await expect(d.locator('.form-row', { hasText: 'Selection Filter' }).locator('select')).toHaveValue('entities');
    await expect(d.locator('option[value="bodies"]')).toHaveJSProperty('disabled', true);
    await expect(d.locator('.form-row', { hasText: 'Geometry' })).toBeVisible();
    await u.press('Escape');
    await page.getByRole('button', { name: /^CREATE/ }).click();
    await expect(page.locator('body > .popup-menu > .menu-item[data-item="Fit Curves To Mesh Section"]')).toBeVisible();
  });

  test('C-F22 Tangent Arc starts mid-line and on a circle rim', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 20.5 }, { x: 40, y: 20.5 });
    await pick(u, 'Tangent Arc');
    await u.click({ x: 7, y: 20.5 });
    await u.click({ x: 27, y: 40 });
    await u.press('Escape');
    await u.press('Escape');
    let s = await u.sketch();
    expect(curvesOf(s, 'arc')).toHaveLength(1);
    expect(constraintsOfType(s, 'tangent')).toBe(1);
    await circle(u, { x: -40, y: -40 }, 15);
    await pick(u, 'Tangent Arc');
    await u.click({ x: -25, y: -35.5 });
    await u.click({ x: -5, y: -10 });
    s = await u.sketch();
    expect(curvesOf(s, 'arc')).toHaveLength(2);
    expect(constraintsOfType(s, 'tangent')).toBe(2);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('C-F23 a Tangent Arc landing along the next line is tangent there too', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -60, y: 0.5 }, { x: -20, y: 0.5 });
    await line(u, { x: -20, y: 40.5 }, { x: -60, y: 40.5 });
    await pick(u, 'Tangent Arc');
    await u.click({ x: -20, y: 0.5 });
    await u.click({ x: -20, y: 40.5 });
    const s = await u.sketch();
    expect(constraintsOfType(s, 'tangent')).toBe(2);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('C-F24 the check waits for a usable spline; a conic on a corner is tangent to both lines', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Fit Point Spline');
    await u.click({ x: -40, y: 30 });
    await expect(page.locator('.hud-check')).toHaveCount(0);
    await u.click({ x: -20, y: 40 });
    await u.move({ x: 0, y: 30 });
    await expect(page.locator('.hud-check')).toHaveCount(1);
    await u.press('Escape');
    await u.press('Escape');
    await line(u, { x: -40, y: -30 }, { x: 0, y: -30 });
    await u.press('l');
    await u.click({ x: 0, y: -30 });
    await u.click({ x: 0, y: 10 });
    await u.press('Enter');
    await pick(u, 'Conic Curve');
    await u.click({ x: -40, y: -30 });
    await u.click({ x: 0, y: 10 });
    await u.click({ x: 0, y: -30 });
    await u.press('Enter');
    const s = await u.sketch();
    expect(constraintsOfType(s, 'tangent')).toBe(2);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('C-F26 slot sides are parallel', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Center To Center Slot');
    await u.click({ x: -30, y: 10 });
    await u.click({ x: 20, y: 25 });
    await u.click({ x: 0, y: 40 });
    const s = await u.sketch();
    expect(constraintsOfType(s, 'parallel')).toBe(1);
    const arcs = curvesOf<import('../src/model/types').Arc>(s, 'arc');
    const r = arcs.map((a) => dist(pointAt(s, a.c), pointAt(s, a.a)));
    expect(r[0]).toBeCloseTo(r[1], 4);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('C-F27 a grid snap shows a symbol at the snapped spot', async ({ page }) => {
    const u = await start(page);
    await page.locator('.palette-row', { hasText: /^Snap/ }).locator('input').check();
    await u.press('l');
    await u.move({ x: 33, y: 22 });
    await u.settle();
    const inf = await page.evaluate(() => window.__sketch.inference());
    expect(inf?.kind).toBe('grid');
    const at = await u.screen(inf?.pos as Xy);
    const lit = await page.evaluate(([x, y]) => {
      const c = document.querySelector('canvas.canvas') as HTMLCanvasElement;
      const box = c.getBoundingClientRect();
      const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(x - box.left - 6, y - box.top - 6, 13, 13).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 2] > 200) n++;
      return n;
    }, [at.x, at.y]);
    expect(lit).toBeGreaterThan(8);
  });

  test('C-F28 an arc slot previews its arc before the width', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Three Point Arc Slot');
    await u.click({ x: -40, y: 10 });
    await u.click({ x: 40, y: 10 });
    await u.move({ x: 0, y: 40 });
    await u.settle();
    // On the arc, a quarter of the way along: off the chord and clear of the HUD.
    const r = (40 * 40 + 30 * 30) / (2 * 30);
    const c = { x: 0, y: 40 - r };
    const p = await u.screen({ x: c.x + r * Math.sin(-0.5), y: c.y + r * Math.cos(-0.5) });
    const lit = await page.evaluate(([x, y]) => {
      const cv = document.querySelector('canvas.canvas') as HTMLCanvasElement;
      const box = cv.getBoundingClientRect();
      const d = (cv.getContext('2d') as CanvasRenderingContext2D).getImageData(x - box.left - 3, y - box.top - 3, 7, 7).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 2] > 180) n++;
      return n;
    }, [p.x, p.y]);
    expect(lit).toBeGreaterThan(0);
  });

  test('C-F30 Edge Polygon says to type the sides', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Edge Polygon');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 20, y: 0 });
    expect(await page.evaluate(() => window.__sketch.status)).toContain('Type the number of sides');
  });

  test('C-F31 a typed radius between parallels leaves the lines alone', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 20.5 }, { x: 40, y: 20.5 });
    await line(u, { x: -40, y: -19.5 }, { x: 40, y: -19.5 });
    await pick(u, '2-Tangent Circle');
    await u.click({ x: 7, y: 20.5 });
    await u.click({ x: 7, y: -19.5 });
    await u.move({ x: 7, y: 2 });
    await u.type('5');
    await u.press('Enter');
    const s = await u.sketch();
    const [c] = curvesOf<Circle>(s, 'circle');
    expect(c.r).toBeCloseTo(20, 3);
    const ys = (await u.lines()).map((l) => pointAt(s, l.a).y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-19.5, 4);
    expect(ys[1]).toBeCloseTo(20.5, 4);
    expect(await page.evaluate(() => window.__sketch.note)).toContain('parallel');
  });

  test('C-F33 a sketch point can be mirrored and patterned', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Point');
    await u.click({ x: 30, y: 20 });
    await u.press('Escape');
    await u.press('Escape');
    await pick(u, 'Mirror');
    const d = page.locator('.dialog[data-dialog="Mirror"]');
    await u.click({ x: 30, y: 20 });
    await expect(d.locator('[data-field="Objects"] .select-count')).toHaveText('1 selected');
    await d.locator('[data-field="Mirror Line"] .select-toggle').click();
    await u.click({ x: 0, y: 40 });
    await d.getByRole('button', { name: 'OK' }).click();
    await u.settle();
    let pts = Object.values((await u.sketch()).points).filter((p) => p.explicit);
    expect(pts).toHaveLength(2);
    expect(pts.some((p) => Math.abs(p.x + 30) < 1e-4 && Math.abs(p.y - 20) < 1e-4)).toBe(true);

    await pick(u, 'Circular Pattern');
    const c = page.locator('.dialog[data-dialog="Circular Pattern"]');
    await u.click({ x: 30, y: 20 });
    await expect(c.locator('[data-field="Objects"] .select-count')).toHaveText('1 selected');
    await c.locator('[data-field="Center Point"] .select-toggle').click();
    const o = await u.screen({ x: 0, y: 0 });
    await page.mouse.click(o.x, o.y);
    await u.settle();
    await c.getByRole('button', { name: 'OK' }).click();
    await u.settle();
    pts = Object.values((await u.sketch()).points).filter((p) => p.explicit);
    expect(pts).toHaveLength(4);
  });

  test('C-F34 OK needs both corners, and the frame shows dashed orange when not selected', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Text');
    const d = textDialog(page);
    await d.locator('textarea').fill('Frame');
    await u.click({ x: -60, y: 0 });
    await u.move({ x: -10, y: 30 });
    await expect(d.getByRole('button', { name: 'OK' })).toBeDisabled();
    await u.click({ x: -10, y: 30 });
    await expect(d.getByRole('button', { name: 'OK' })).toBeEnabled();
    await d.getByRole('button', { name: 'OK' }).click();
    await u.settle();
    await u.click({ x: -80, y: 60 });
    await page.mouse.move(5, 5);
    await u.settle();
    const a = await u.screen({ x: -60, y: 30 });
    const b = await u.screen({ x: -10, y: 30 });
    const orange = await page.evaluate(([x0, x1, y]) => {
      const c = document.querySelector('canvas.canvas') as HTMLCanvasElement;
      const box = c.getBoundingClientRect();
      const px = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(x0 - box.left, y - box.top - 1, x1 - x0, 3).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] > 90 && px[i + 1] < 170 && px[i + 2] < 90) n++;
      return n;
    }, [a.x, b.x, a.y]);
    expect(orange).toBeGreaterThan(20);
  });

  test('C-F35 braces suggest names, C-F37 format buttons are icons', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -60, y: 40 }, { x: -20, y: 40 });
    await u.press('d');
    await u.click({ x: -40, y: 40 });
    await u.click({ x: -40, y: 50 });
    await u.type('40');
    await u.press('Enter');
    await u.press('Escape');
    await u.press('Escape');
    const name = Object.values((await u.sketch()).dimensions)[0].name;
    await pick(u, 'Text');
    const d = textDialog(page);
    const area = d.locator('textarea');
    await area.click();
    await page.keyboard.type(`W={${name.slice(0, 1)}`);
    await d.locator('.name-item', { hasText: name }).click();
    await expect(area).toHaveValue(`W={${name}}`);
    await expect(d.locator('.icon-toggle')).toHaveCount(4);
    await expect(d.locator('.icon-choice')).toHaveCount(6);
    await d.locator('.icon-choice[title="Align Center"]').click();
    await expect(d.locator('.form-row', { hasText: 'Horizontal' }).locator('select')).toHaveValue('center');
    await expect(d.locator('.icon-choice.active[title="Align Center"]')).toHaveCount(1);
  });

  test('C-F40 Linetype buttons show the selected curve', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 20 }, { x: 0, y: 40 });
    await u.click({ x: -20, y: 30 });
    await page.locator('.type-btn[aria-label="Construction"]').click();
    await u.settle();
    await u.click({ x: -60, y: 60 });
    await expect(page.locator('.type-btn[aria-label="Construction"]')).not.toHaveClass(/active/);
    await u.click({ x: -20, y: 30 });
    await expect(page.locator('.type-btn[aria-label="Construction"]')).toHaveClass(/active/);
  });
});

test.describe('sketch shell', () => {
  test('W-P3-2 SOLID is reachable while sketching, with the Create tools; Create Sketch there finishes this one', async ({ page }) => {
    const u = await start(page);
    await page.locator('.tab', { hasText: 'SOLID' }).click();
    await expect(page.locator('.tab.active')).toHaveText('SOLID');
    await page.locator('.ribbon .panel[data-panel="create"] .panel-name').click();
    await page.locator('.menu-item[data-item="Line"]').click();
    await u.settle();
    expect(await tool(page)).toBe('line');
    await u.press('Escape');
    await page.locator('.tool-btn[aria-label="Create Sketch"]').click();
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.mode)).toBe('design');
    await expect(page.locator('.plane-picker')).toHaveCount(1);
  });

  test('W-P3-3 the picker names the planes as the reference does', async ({ page }) => {
    const u = new SketchUser(page);
    await u.open();
    await page.getByRole('button', { name: 'Create Sketch' }).first().click();
    await expect(page.locator('.plane[data-plane="XY"] text')).toHaveText('XY (Top)');
    await expect(page.locator('.plane[data-plane="ZX"] text')).toHaveText('XZ');
    await page.keyboard.press('Escape');
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.status)).not.toContain('Select a plane');
  });

  test('W-P3-4 Home View fits the view, in Design too', async ({ page }) => {
    const u = await start(page);
    await u.wheelOut(900);
    await line(u, { x: 0, y: 0 }, { x: 20, y: 20 });
    const before = await page.evaluate(() => window.__sketch.view.ppm);
    await page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await page.locator('.home-view').click();
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.view.ppm)).toBeGreaterThan(before);
  });

  test('W-P3-5 a 2-Point Circle across an edge has its centre at the middle of that edge', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -30, y: 20 }, { x: 30, y: 22 });
    await pick(u, '2-Point Circle');
    await u.click({ x: -30, y: 20 });
    await u.click({ x: 30, y: 22 });
    const s = await u.sketch();
    const [c] = curvesOf<Circle>(s, 'circle');
    expect(Object.values(s.constraints).filter((k) => k.type === 'midpoint' && k.refs[0] === c.c)).toHaveLength(1);
  });

  test('W-P3-6 notes and prompts do not go stale', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 30 });
    await u.click({ x: 30, y: 30 });
    await u.click({ x: 30, y: 30 });
    expect(await page.evaluate(() => window.__sketch.note)).toContain('two different');
    await u.press('Escape');
    await u.click({ x: -40, y: 50 });
    expect(await page.evaluate(() => window.__sketch.note)).toBe('');

    await u.click({ x: 15, y: 30 });
    await u.press('Meta+c');
    expect(await page.evaluate(() => window.__sketch.note)).toBe('Copied 1 curve');
    await page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.note)).toBe('');
  });

  test('W-P3-6 the double-click dimension prompt goes when the edit ends', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -30, y: 20 }, { x: 30, y: 20 });
    await u.press('d');
    await u.click({ x: 0, y: 20 });
    await u.click({ x: 0, y: 35 });
    await u.type('60');
    await u.press('Enter');
    await u.press('Escape');
    await u.press('Escape');
    const before = await page.evaluate(() => window.__sketch.status);
    await u.doubleClick({ x: 0, y: 35 });
    await expect(page.locator('.hud-field.editor input')).toBeFocused();
    await u.press('Escape');
    expect(await page.evaluate(() => window.__sketch.status)).toBe(before);
  });

  test('W-P3-7 Show Constraints off hides the Fix lock too', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -30, y: 20 }, { x: 30, y: 25 });
    await u.click({ x: 0, y: 22.5 });
    await page.locator('.tool-btn[aria-label="Fix/UnFix"]').click();
    await u.settle();
    await u.press('Escape');
    await u.press('Escape');
    await u.click({ x: -70, y: 60 });
    await page.mouse.move(5, 5);
    await u.settle();
    const badge = (): Promise<number> => page.evaluate(() => {
      const c = document.querySelector('canvas.canvas') as HTMLCanvasElement;
      const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] === 0xec && d[i + 1] === 0xee && d[i + 2] === 0xf0) n++;
      return n;
    });
    expect(await badge()).toBeGreaterThan(20);
    await page.locator('.palette-row', { hasText: 'Show Constraints' }).locator('input').uncheck();
    await u.settle();
    expect(await badge()).toBe(0);
  });

  test('W-P3-8 W-P3-16 dialog fields prompt for themselves, and the tool and its prompt follow the cursor', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Circular Pattern');
    expect(await page.evaluate(() => window.__sketch.status)).toBe('Select sketch curves to pattern');
    await page.locator('[data-field="Center Point"] .select-toggle').click();
    expect(await page.evaluate(() => window.__sketch.status)).toBe('Click to select sketch point or circular arc');
    await page.locator('.dialog-foot .btn', { hasText: 'Cancel' }).click();
    await pick(u, 'Concentric');
    await u.move({ x: -30, y: 30 });
    await expect(page.locator('.cursor-tip')).toBeVisible();
    await expect(page.locator('.cursor-tip svg')).toHaveCount(1);
    await expect(page.locator('.cursor-tip')).toContainText((await page.evaluate(() => window.__sketch.status)).split('. ')[0]);
    await u.press('Escape');
    await u.press('Escape');
    await u.move({ x: -20, y: 30 });
    await expect(page.locator('.cursor-tip')).toBeHidden();
  });

  test('W-P3-9 Vertical between two points shows a glyph on each', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Point');
    await u.click({ x: -40, y: 0.5 + 10 });
    await u.click({ x: -30, y: 50 });
    await u.press('Escape');
    await u.press('Escape');
    await page.locator('.tool-btn[aria-label="Horizontal/Vertical"]').click();
    await u.settle();
    await u.click({ x: -40, y: 10.5 });
    await u.click({ x: -30, y: 50 });
    await u.press('Escape');
    await u.press('Escape');
    const s = await u.sketch();
    const k = Object.values(s.constraints).find((c) => c.type === 'vertical');
    expect(k).toBeTruthy();
    const pts = (k as { refs: string[] }).refs.map((id) => pointAt(s, id));
    for (const p of pts) {
      // Up and right of the point: the badge.
      const q = await u.screen(p);
      await page.mouse.click(q.x + 11, q.y - 11);
      await u.settle();
      expect(await page.evaluate(() => window.__sketch.selection)).toEqual([(k as { id: string }).id]);
      await u.press('Escape');
    }
  });

  test('W-P3-12 the marking menu has the reference\'s tools, Fix/UnFix and Find in Browser', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -30, y: 20 }, { x: 30, y: 25 });
    await u.rightClick({ x: -60, y: 60 });
    for (const id of ['tool-circle-center', 'tool-rect-2pt', 'tool-spline-fit', 'tool-project', 'tool-offset']) await expect(page.locator(`[data-item="${id}"]`)).toHaveCount(1);
    await page.locator('[data-item="tool-project"]').click();
    await u.settle();
    expect(await tool(page)).toBe('project');
    await page.keyboard.press('Escape');
    await u.settle();
    await u.click({ x: 0, y: 22.5 });
    await u.rightClick({ x: 0, y: 22.5 });
    for (const id of ['fix-unfix', 'find-in-browser', 'constraint-tangent', 'constraint-parallel']) await expect(page.locator(`[data-item="${id}"]`)).toHaveCount(1);
    await page.locator('[data-item="find-in-browser"]').click();
    await expect(page.locator('.sketch-row.found')).toHaveCount(1);
  });

  test('W-P3-13 a 3-Point Arc over the middle of its chord snaps and is held there', async ({ page }) => {
    const u = await start(page);
    await pick(u, '3-Point Arc');
    await u.click({ x: -30, y: 10 });
    await u.click({ x: 30, y: 10 });
    await u.move({ x: 0.7, y: 30 });
    await u.settle();
    const inf = await page.evaluate(() => window.__sketch.inference());
    expect(inf?.kind).toBe('midpoint');
    expect(inf?.pos.x).toBeCloseTo(0, 6);
    await u.click({ x: 0.7, y: 30 });
    const s = await u.sketch();
    expect(constraintsOfType(s, 'midpoint')).toBe(1);
    expect((await u.analysis()).unsatisfied).toEqual([]);
    await u.press('Escape');
    await u.press('Escape');

    // The held point does not get in the way of a fillet at the arc's end.
    await line(u, { x: -30, y: 10 }, { x: -60, y: -30 });
    await u.tool('Fillet');
    await u.click({ x: -30, y: 10 });
    await page.keyboard.type('4');
    await u.press('Enter');
    await u.settle();
    expect(curvesOf(await u.sketch(), 'arc')).toHaveLength(2);
  });

  test('W-P3-14 Redefine Sketch Plane moves a sketch', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: 0, y: 0 }, 20);
    const id = (await u.design()).order[0];
    await page.locator(`.sketch-row[data-sketch="${id}"]`).click({ button: 'right' });
    await page.locator('.popup-menu .menu-item[data-item="Redefine Sketch Plane"]').click();
    await page.locator('.plane[data-plane="YZ"] polygon').click();
    await u.settle();
    expect((await u.design()).sketches[id].frame).toEqual(PLANE_FRAMES.YZ);
    expect((await u.design()).order).toHaveLength(1);
    await u.press('Meta+z');
    expect((await u.design()).sketches[id].frame).toEqual(PLANE_FRAMES.XY);
  });

  test('W-P3-17 the axes carry numbers', async ({ page }) => {
    const u = await start(page);
    const { major } = await page.evaluate(() => {
      const ppm = window.__sketch.view.ppm;
      const target = 80 / ppm;
      const decade = 10 ** Math.floor(Math.log10(target));
      return { major: ([1, 2, 5, 10].find((m) => m * decade >= target) ?? 10) * decade };
    });
    const at = await u.screen({ x: major, y: 0 });
    const between = await u.screen({ x: major * 1.5, y: 0 });
    const dark = (x: number, y: number): Promise<number> => page.evaluate(([cx, cy]) => {
      const c = document.querySelector('canvas.canvas') as HTMLCanvasElement;
      const box = c.getBoundingClientRect();
      const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(cx - box.left - 12, cy - box.top + 3, 24, 13).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 170 && d[i + 1] < 170 && d[i + 2] < 170) n++;
      return n;
    }, [x, y]);
    expect(await dark(at.x, at.y)).toBeGreaterThan(8);
    expect(await dark(between.x, between.y)).toBe(0);
  });

  test('W-P3-19 browser icons: dashed corners, grey with a lock when constrained', async ({ page }) => {
    await start(page);
    await expect(page.locator('.sketch-row .tree-icon svg path[stroke-dasharray]')).toHaveCount(1);
    await expect(page.locator('.sketch-row .tree-icon svg rect')).toHaveCount(4);
  });
});
