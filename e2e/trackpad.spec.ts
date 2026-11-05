// Trackpad pan and pinch, and the mouse wheel as before. SIMULATED: no trackpad is attached. Each test
// dispatches `WheelEvent`s on the canvas, in the shapes and at the pace real devices produce them (see
// src/app/wheel.ts for what those are), with real gaps between them. They show the logic and the wiring,
// not how any particular device behaves.
import { expect, test, type Page } from '@playwright/test';
import { SketchUser, type Xy } from './helpers';

interface Step {
  dy: number;
  dx?: number;
  ctrl?: boolean;
  shift?: boolean;
  mode?: number;
  /** Milliseconds before this event. */
  wait?: number;
}

const view = (page: Page): Promise<{ cx: number; cy: number; ppm: number }> => page.evaluate(() => window.__sketch.view);

/** Dispatch the steps at a point of the screen, one after another; the result says which were cancelled. */
const send = (page: Page, at: Xy, steps: Step[]): Promise<boolean[]> => page.evaluate(async ([x, y, list]) => {
  const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement;
  const prevented: boolean[] = [];
  for (const s of list as Step[]) {
    if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
    const e = new WheelEvent('wheel', {
      bubbles: true, cancelable: true, clientX: x as number, clientY: y as number,
      deltaX: s.dx ?? 0, deltaY: s.dy, deltaMode: s.mode ?? 0, ctrlKey: !!s.ctrl, shiftKey: !!s.shift,
    });
    // False when something called preventDefault on it.
    prevented.push(!canvas.dispatchEvent(e));
  }
  return prevented;
}, [at.x, at.y, steps] as const);

const settle = (page: Page): Promise<unknown> => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** A trackpad drag with the fingers going down the page: whole small steps with a swell and a tail, 8 to 16 ms apart. */
const verticalDrag = (sign: 1 | -1): Step[] => [1, 2, 4, 7, 11, 16, 22, 27, 30, 31, 29, 25, 20, 15, 11, 8, 5, 3, 2, 1, 1, 1].map((d, i) => ({ dy: sign * d, wait: i === 0 ? 0 : i < 14 ? 8 : 16 }));

const sumOf = (steps: Step[], key: 'dx' | 'dy'): number => steps.reduce((a, s) => a + (s[key] ?? 0), 0);

const start = async (page: Page): Promise<{ u: SketchUser; at: Xy }> => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  // Wheel events carry whole-pixel coordinates.
  const raw = await u.screen({ x: 20, y: 10 });
  const at = { x: Math.round(raw.x), y: Math.round(raw.y) };
  await page.mouse.move(at.x, at.y);
  return { u, at };
};

test.describe('a two-finger drag pans', () => {
  test('a vertical drag moves the view by the whole of its travel, and does not zoom', async ({ page }) => {
    const { u, at } = await start(page);
    const v0 = await view(page);
    const steps = verticalDrag(1);
    expect((await send(page, at, steps)).every(Boolean)).toBe(true);
    await settle(page);
    const v1 = await view(page);
    expect(v1.ppm).toBe(v0.ppm);
    expect(v1.cx).toBeCloseTo(v0.cx, 9);
    // Content follows the fingers like a scroll: a drag that scrolls down moves the sketch up the screen.
    expect(v1.cy).toBeCloseTo(v0.cy - sumOf(steps, 'dy') / v0.ppm, 6);
    await u.settle();
  });

  test('a diagonal drag with fractional steps, as macOS reports them, pans both ways', async ({ page }) => {
    const { at } = await start(page);
    const v0 = await view(page);
    const steps: Step[] = [0.5, 1.25, 2.5, 4.75, 6.5, 8.25, 6.5, 4.25, 2.5, 1.25, 0.5].map((d, i) => ({ dx: -d * 1.5, dy: d, wait: i ? 8 : 0 }));
    await send(page, at, steps);
    await settle(page);
    const v1 = await view(page);
    expect(v1.ppm).toBe(v0.ppm);
    expect(v1.cx).toBeCloseTo(v0.cx + sumOf(steps, 'dx') / v0.ppm, 6);
    expect(v1.cy).toBeCloseTo(v0.cy - sumOf(steps, 'dy') / v0.ppm, 6);
  });

  test('a horizontal swipe pans sideways, and neither the page nor history sees it', async ({ page }) => {
    const { at } = await start(page);
    const v0 = await view(page);
    const steps: Step[] = [3, 8, 15, 26, 40, 52, 60, 55, 40, 24, 12, 5].map((d, i) => ({ dx: -d, dy: 0.5, wait: i ? 8 : 0 }));
    const prevented = await send(page, at, steps);
    await settle(page);
    expect(prevented.every(Boolean)).toBe(true);
    const v1 = await view(page);
    expect(v1.cx).toBeCloseTo(v0.cx + sumOf(steps, 'dx') / v0.ppm, 6);
    expect(v1.ppm).toBe(v0.ppm);
    // The page does not scroll, and has no overscroll for a swipe to turn into Back.
    const page_ = await page.evaluate(() => ({
      x: window.scrollX, y: window.scrollY, h: history.length,
      overscroll: [getComputedStyle(document.documentElement).overscrollBehaviorX, getComputedStyle(document.body).overscrollBehaviorX, getComputedStyle(document.documentElement).overscrollBehaviorY],
      url: location.href,
    }));
    expect(page_.x).toBe(0);
    expect(page_.y).toBe(0);
    expect(page_.overscroll).toEqual(['none', 'none', 'none']);
    expect(page_.url).not.toContain('about:');
  });

  test('a first step with a sideways part is enough', async ({ page }) => {
    const { at } = await start(page);
    const v0 = await view(page);
    await send(page, at, [{ dx: 2, dy: 1 }]);
    await settle(page);
    const v1 = await view(page);
    expect(v1.ppm).toBe(v0.ppm);
    expect(v1.cx).toBeCloseTo(v0.cx + 2 / v0.ppm, 9);
  });

  test('one gesture does not flip: a step as big as a wheel notch in the middle of a drag is still a pan', async ({ page }) => {
    const { at } = await start(page);
    const v0 = await view(page);
    const steps: Step[] = [{ dy: 2.5 }, { dy: 6.5, wait: 8 }, { dy: 120, wait: 8 }, { dy: 90, wait: 8 }, { dy: 4, wait: 8 }];
    await send(page, at, steps);
    await settle(page);
    const v1 = await view(page);
    expect(v1.ppm).toBe(v0.ppm);
    expect(v1.cy).toBeCloseTo(v0.cy - sumOf(steps, 'dy') / v0.ppm, 6);
  });

  test('and a notch is one at the start of a burst, not a pan, so the wheel after a drag zooms again', async ({ page }) => {
    const { at } = await start(page);
    await send(page, at, [{ dy: 2.5 }, { dy: 3.5, wait: 8 }]);
    const v0 = await view(page);
    await send(page, at, [{ dy: -100, wait: 400 }]);
    await settle(page);
    expect((await view(page)).ppm).toBeGreaterThan(v0.ppm);
  });
});

test.describe('a pinch zooms at the cursor', () => {
  test('ctrl with small fractional steps: in for a pinch out, with the point under the cursor staying put', async ({ page }) => {
    const { u, at } = await start(page);
    const world = await page.evaluate(([x, y]) => window.__sketch.toWorld(x, y), [at.x, at.y]);
    const v0 = await view(page);
    const steps: Step[] = [-0.5, -1.5, -3.25, -5.5, -7.75, -9.5, -8, -5.5, -3, -1.25, -0.5].map((d, i) => ({ dy: d, ctrl: true, wait: i ? 8 : 0 }));
    const prevented = await send(page, at, steps);
    await settle(page);
    expect(prevented.every(Boolean)).toBe(true);
    const v1 = await view(page);
    expect(v1.ppm / v0.ppm).toBeCloseTo(Math.exp(-sumOf(steps, 'dy') * 0.01), 6);
    expect(v1.ppm).toBeGreaterThan(v0.ppm);
    const after = await page.evaluate(([x, y]) => window.__sketch.toWorld(x, y), [at.x, at.y]);
    expect(after.x).toBeCloseTo(world.x, 6);
    expect(after.y).toBeCloseTo(world.y, 6);
    await u.settle();
  });

  test('a pinch in zooms out, and does not pan', async ({ page }) => {
    const { at } = await start(page);
    const v0 = await view(page);
    await send(page, at, [3, 5.5, 8, 6, 3].map((d, i) => ({ dy: d, ctrl: true, wait: i ? 8 : 0 })));
    await settle(page);
    const v1 = await view(page);
    expect(v1.ppm).toBeLessThan(v0.ppm);
    expect(v1.ppm / v0.ppm).toBeCloseTo(Math.exp(-25.5 * 0.01), 6);
  });
});

test.describe('a mouse wheel zooms, as it does now', () => {
  test('whole notches of 100, a second apart, zoom at the pointer by the old gain', async ({ page }) => {
    const { at } = await start(page);
    const world = await page.evaluate(([x, y]) => window.__sketch.toWorld(x, y), [at.x, at.y]);
    const v0 = await view(page);
    await send(page, at, [{ dy: -100 }, { dy: -100, wait: 300 }, { dy: 100, wait: 300 }]);
    await settle(page);
    const v1 = await view(page);
    expect(v1.ppm / v0.ppm).toBeCloseTo(Math.exp(100 * 0.0016), 6);
    const after = await page.evaluate(([x, y]) => window.__sketch.toWorld(x, y), [at.x, at.y]);
    expect(after.x).toBeCloseTo(world.x, 6);
    expect(after.y).toBeCloseTo(world.y, 6);
  });

  test('Firefox line steps, and the notches of a scaled display', async ({ page }) => {
    const { at } = await start(page);
    const v0 = await view(page);
    await send(page, at, [{ dy: -3, mode: 1 }, { dy: -80, wait: 250 }, { dy: -66.67, wait: 250 }]);
    await settle(page);
    const v1 = await view(page);
    expect(v1.ppm / v0.ppm).toBeCloseTo(Math.exp((3 * 16 + 80 + 66.67) * 0.0016), 5);
  });

  test('a mouse that gives small whole steps, one on its own at a time, still zooms', async ({ page }) => {
    const { at } = await start(page);
    const v0 = await view(page);
    await send(page, at, [{ dy: -4 }, { dy: -8, wait: 200 }, { dy: -4, wait: 200 }]);
    await page.waitForTimeout(150);
    await settle(page);
    const v1 = await view(page);
    expect(v1.ppm / v0.ppm).toBeCloseTo(Math.exp(16 * 0.0016), 6);
  });

  test('and shift with the wheel, which a browser turns sideways, does nothing', async ({ page }) => {
    const { at } = await start(page);
    const v0 = await view(page);
    const prevented = await send(page, at, [{ dx: 100, dy: 0, shift: true }]);
    await page.waitForTimeout(100);
    expect(prevented).toEqual([true]);
    expect(await view(page)).toEqual(v0);
  });
});

test.describe('during a tool', () => {
  test('a pan keeps the Line tool, its first point, its value boxes and its preview', async ({ page }) => {
    const { u } = await start(page);
    await u.press('l');
    await u.click({ x: -20, y: 0 });
    await u.move({ x: 40, y: 20 });
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('line');
    const boxes = await page.locator('.hud-field').count();
    expect(boxes).toBeGreaterThan(0);
    const before = await page.locator('.hud-field').first().boundingBox();
    const at = await u.screen({ x: 40, y: 20 });
    const v0 = await view(page);

    // About 60 px down and 30 px across: far enough to see, and the sketch stays on screen.
    const steps: Step[] = [1, 2, 4, 7, 10, 12, 10, 7, 4, 2, 1].map((d, i) => ({ dy: d, dx: d / 2, wait: i ? 8 : 0 }));
    await send(page, at, steps);
    await settle(page);
    const v1 = await view(page);
    expect(v1.cy).toBeLessThan(v0.cy);
    expect(v1.cx).toBeGreaterThan(v0.cx);
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('line');
    expect(await u.lines()).toHaveLength(0);
    await expect(page.locator('.hud-field')).toHaveCount(boxes);

    // The boxes went with the view, by exactly the pan.
    const after = await page.locator('.hud-field').first().boundingBox();
    expect(after && before ? Math.round(after.x - before.x) : null).toBe(-Math.round(sumOf(steps, 'dx')));
    expect(after && before ? Math.round(after.y - before.y) : null).toBe(-Math.round(sumOf(steps, 'dy')));

    // The preview is still drawn: the line from its first point, which moved with the view, to the cursor's old place.
    const first = await u.screen({ x: -20, y: 0 });
    const last = await u.screen({ x: 40, y: 20 });
    const mid = { x: Math.round((first.x + last.x) / 2), y: Math.round((first.y + last.y) / 2) };
    expect(mid.y).toBeLessThan(900);
    expect(mid.y).toBeGreaterThan(120);
    const bluish = await page.evaluate(([x, y]) => {
      const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      const g = canvas.getContext('2d') as CanvasRenderingContext2D;
      const d = g.getImageData(Math.round(x - box.left) - 2, Math.round(y - box.top) - 2, 5, 5).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 150 && d[i] < 110) return true;
      return false;
    }, [mid.x, mid.y]);
    expect(bluish).toBe(true);

    // And the tool finishes what it was doing: a click makes the line from the first point.
    await u.click({ x: 10, y: -30 });
    const [line] = await u.lines();
    expect(line).toBeTruthy();
    const s = await u.sketch();
    expect(s.points[line.a].x).toBeCloseTo(-20, 6);
    expect(s.points[line.a].y).toBeCloseTo(0, 6);
    expect(s.points[line.b].x).toBeCloseTo(10, 6);
    expect(s.points[line.b].y).toBeCloseTo(-30, 6);
  });

  test('a pinch during a tool zooms and leaves it', async ({ page }) => {
    const { u } = await start(page);
    await u.press('c');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 25, y: 0 });
    const at = await u.screen({ x: 25, y: 0 });
    const v0 = await view(page);
    await send(page, at, [-4, -6, -8, -6, -4].map((d, i) => ({ dy: d, ctrl: true, wait: i ? 8 : 0 })));
    await settle(page);
    expect((await view(page)).ppm).toBeGreaterThan(v0.ppm);
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('circle-center');
    await u.click({ x: 25, y: 0 });
    const [circle] = await u.curves('circle');
    expect(circle).toBeTruthy();
  });
});
