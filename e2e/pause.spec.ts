// A pause must not change what a press does. The value boxes float where shapes are being placed, so
// each workflow here stops the pointer on its target, waits, and only then presses. `SketchUser.click`
// moves and presses at once, which hides anything that needs the pointer to stay put first.
import { expect, test, type Page } from '@playwright/test';
import { pointAt, SketchUser, type Xy } from './helpers';
import type { Curve, FitSpline, Line } from '../src/model/types';

const WAITS = [0, 700, 2000];

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { errors: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

const FLYOUT: Record<string, string> = {
  '3-Point Rectangle': 'Rectangle', 'Center Rectangle': 'Rectangle',
  '2-Point Circle': 'Circle', '3-Point Circle': 'Circle',
  '3-Point Arc': 'Arc', 'Center Point Arc': 'Arc', 'Tangent Arc': 'Arc',
  'Circumscribed Polygon': 'Polygon', 'Edge Polygon': 'Polygon', 'Fit Point Spline': 'Spline',
  'Center To Center Slot': 'Slot', 'Overall Slot': 'Slot', 'Center Point Slot': 'Slot',
};

const O: Xy = { x: 0, y: 0 };

/** A user who stops on each target for `wait` ms before pressing. */
class Pausing {
  constructor(readonly u: SketchUser, readonly wait: number) {}

  private get page(): Page { return this.u.page; }

  /** The pointer is where it should be: wait there. */
  async pause(): Promise<void> {
    await this.u.settle();
    if (this.wait) await this.page.waitForTimeout(this.wait);
  }

  async stopOn(p: Xy): Promise<void> {
    await this.u.move(p);
    await this.pause();
  }

  async press(): Promise<void> {
    await this.page.mouse.down();
    await this.page.mouse.up();
    await this.u.settle();
  }

  async click(p: Xy): Promise<void> {
    await this.stopOn(p);
    await this.press();
  }

  /** Press where the pointer stopped and drag away. */
  async dragTo(to: Xy): Promise<void> {
    await this.page.mouse.down();
    const b = await this.u.screen(to);
    await this.page.mouse.move(b.x, b.y, { steps: 8 });
    await this.u.settle();
    await this.page.mouse.up();
    await this.u.settle();
  }

  async drag(from: Xy, to: Xy): Promise<void> {
    await this.stopOn(from);
    await this.dragTo(to);
  }
}

/** Every press from here on, by what took it. */
const watchPresses = (page: Page): Promise<void> => page.evaluate(() => {
  const seen: string[] = [];
  (window as unknown as { presses: string[] }).presses = seen;
  window.addEventListener('pointerdown', (e) => seen.push((e.target as Element).tagName), true);
});

const presses = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { presses: string[] }).presses);

const expectAllOnCanvas = async (page: Page): Promise<void> => {
  const seen = await presses(page);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((t) => t !== 'CANVAS')).toEqual([]);
};

const start = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  return u;
};

const pick = async (u: SketchUser, label: string): Promise<void> => {
  await u.page.getByRole('button', { name: /^CREATE/ }).click();
  const flyout = FLYOUT[label];
  if (flyout) await u.page.locator(`.menu-item.flyout[data-item="${flyout}"]`).hover();
  await u.page.locator(`.menu-item[data-item="${label}"]`).click();
  await u.settle();
};

const count = async (u: SketchUser, type: Curve['type']): Promise<number> => (await u.curves(type)).length;

const leaveTool = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};

/** Two joined lines ending at (30, 25), with the Select tool back. */
const corner = async (u: SketchUser): Promise<void> => {
  await u.press('l');
  await u.click(O);
  await u.click({ x: 30, y: 0 });
  await u.click({ x: 30, y: 25 });
  await leaveTool(u);
};

const rectangle = async (u: SketchUser): Promise<void> => {
  await u.press('r');
  await u.click({ x: -30, y: -20 });
  await u.click({ x: 30, y: 20 });
  await leaveTool(u);
};

const selected = (u: SketchUser): Promise<string[]> => u.page.evaluate(() => window.__sketch.selection);

for (const wait of WAITS) {
  test.describe(`after ${wait} ms`, () => {
    test.describe('C006 pause over a point, click and drag for an arc segment', () => {
      test('the pointer never leaves the end just placed', async ({ page }) => {
        const u = await start(page);
        const p = new Pausing(u, wait);
        await u.press('l');
        await u.click(O);
        await u.click({ x: 30, y: 0 });
        await p.pause();
        await watchPresses(page);
        await p.dragTo({ x: 45, y: 15 });
        expect(await count(u, 'arc')).toBe(1);
        await expectAllOnCanvas(page);
      });

      test('a mouse event with no travel, then the value boxes on the end, then the press', async ({ page }) => {
        const u = await start(page);
        const p = new Pausing(u, wait);
        await u.press('l');
        await u.click(O);
        await u.click({ x: 30, y: 0 });
        await p.pause();
        await u.move({ x: 30, y: 0 });
        await u.settle();
        await expect(page.locator('.hud-field[data-key="length"]')).toHaveCount(1);
        await watchPresses(page);
        await p.dragTo({ x: 45, y: 15 });
        expect(await count(u, 'arc')).toBe(1);
        await expectAllOnCanvas(page);
      });

      test('away and back to the end', async ({ page }) => {
        const u = await start(page);
        const p = new Pausing(u, wait);
        await u.press('l');
        await u.click(O);
        await u.click({ x: 30, y: 0 });
        await u.move({ x: 60, y: 30 });
        await watchPresses(page);
        await p.drag({ x: 30, y: 0 }, { x: 45, y: 15 });
        expect(await count(u, 'arc')).toBe(1);
        await expectAllOnCanvas(page);
      });

      test('a chain started on the end of a line curves straight off it', async ({ page }) => {
        const u = await start(page);
        const p = new Pausing(u, wait);
        await corner(u);
        await u.press('l');
        await u.click({ x: 30, y: 25 });
        await u.move({ x: 60, y: 60 });
        await watchPresses(page);
        await p.drag({ x: 30, y: 25 }, { x: 15, y: 40 });
        expect(await count(u, 'arc')).toBe(1);
        await expectAllOnCanvas(page);
      });

      test('the arc is tangent and joined, and the chain carries on', async ({ page }) => {
        const u = await start(page);
        const p = new Pausing(u, wait);
        await u.press('l');
        await u.click({ x: 0, y: 40 });
        await u.click(O);
        await u.move({ x: 2, y: -20 });
        await p.drag(O, { x: 20, y: 0 });
        const s = await u.sketch();
        const [arc] = await u.curves('arc');
        expect(arc).toBeTruthy();
        expect(Object.values(s.constraints).some((k) => k.type === 'tangent' && k.refs.includes(arc.id))).toBe(true);
        await p.click({ x: 20, y: 40 });
        expect(await count(u, 'line')).toBe(2);
      });
    });

    test.describe('the next click of a tool', () => {
      // Name, tool by key or menu label, the clicks, and what they leave.
      const CLICKS: [string, string, Xy[], Curve['type'], number][] = [
        ['Line, a long segment', 'l', [O, { x: 40, y: 25 }], 'line', 1],
        ['Line, a short segment up the box', 'l', [O, { x: 0, y: 4 }], 'line', 1],
        ['Line, a short segment down the box', 'l', [O, { x: 1, y: -4 }], 'line', 1],
        ['Rectangle', 'r', [O, { x: 40, y: 25 }], 'line', 4],
        ['Rectangle on its own boxes', 'r', [{ x: -60, y: -10 }, { x: -50, y: 0 }], 'line', 4],
        ['3-Point Rectangle on its own boxes', '3-Point Rectangle', [O, { x: 10, y: 0 }, { x: 10, y: 5 }], 'line', 4],
        ['Center Rectangle on its own boxes', 'Center Rectangle', [O, { x: 6, y: 3 }], 'line', 6],
        ['Circle', 'c', [O, { x: 30, y: 0 }], 'circle', 1],
        ['Circle on its own box', 'c', [O, { x: 8, y: 0 }], 'circle', 1],
        ['2-Point Circle on its own box', '2-Point Circle', [O, { x: 10, y: 0 }], 'circle', 1],
        ['3-Point Arc, whose radius box rides on the cursor', '3-Point Arc', [O, { x: 40, y: 0 }, { x: 20, y: 15 }], 'arc', 1],
        ['3-Point Arc on its own box', '3-Point Arc', [O, { x: 12, y: 0 }, { x: 6, y: 3 }], 'arc', 1],
        ['Center Point Arc', 'Center Point Arc', [O, { x: 30, y: 0 }, { x: 0, y: 30 }], 'arc', 1],
        ['Center Point Arc on its own box', 'Center Point Arc', [O, { x: 8, y: 0 }, { x: 0, y: 8 }], 'arc', 1],
        ['Ellipse', 'Ellipse', [O, { x: 30, y: 0 }, { x: 0, y: 15 }], 'ellipse', 1],
        ['Midpoint Line', 'Midpoint Line', [O, { x: 2, y: 3 }], 'line', 1],
        ['Polygon on its own box', 'Circumscribed Polygon', [O, { x: 6, y: 3 }], 'line', 6],
        ['Edge Polygon on its own box', 'Edge Polygon', [O, { x: 10, y: 0 }, { x: 5, y: 8 }], 'line', 6],
        // The width box is centred on the cursor, so a pause on the click point is a pause under it.
        ['Center To Center Slot, its width', 'Center To Center Slot', [{ x: -40, y: 40 }, { x: 0, y: 40 }, { x: -20, y: 55 }], 'arc', 2],
        ['Overall Slot, its width', 'Overall Slot', [{ x: -40, y: 40 }, { x: 0, y: 40 }, { x: -20, y: 55 }], 'arc', 2],
        ['Center Point Slot, its width', 'Center Point Slot', [{ x: -20, y: 40 }, { x: 0, y: 40 }, { x: -10, y: 52 }], 'arc', 2],
      ];

      for (const [name, tool, points, type, want] of CLICKS) {
        test(name, async ({ page }) => {
          const u = await start(page);
          const p = new Pausing(u, wait);
          if (tool.length === 1) await u.press(tool);
          else await pick(u, tool);
          await watchPresses(page);
          for (const q of points) await p.click(q);
          expect(await count(u, type)).toBe(want);
          await expectAllOnCanvas(page);
        });
      }

      test('Tangent Arc, whose radius box rides on the cursor', async ({ page }) => {
        const u = await start(page);
        const p = new Pausing(u, wait);
        await corner(u);
        await pick(u, 'Tangent Arc');
        await watchPresses(page);
        await p.click({ x: 30, y: 25 });
        await p.click({ x: 15, y: 40 });
        expect(await count(u, 'arc')).toBe(1);
        await expectAllOnCanvas(page);
      });

      test('Circle on its own box, reached by a slow hand', async ({ page }) => {
        const u = await start(page);
        const p = new Pausing(u, wait);
        await u.press('c');
        await u.click(O);
        await u.move({ x: 25, y: 0 });
        const to = await u.screen({ x: 8, y: 0 });
        await page.mouse.move(to.x, to.y, { steps: 68 });
        await p.pause();
        await watchPresses(page);
        await p.press();
        expect(await count(u, 'circle')).toBe(1);
        await expectAllOnCanvas(page);
      });

      test('Line closes on its start', async ({ page }) => {
        const u = await start(page);
        const p = new Pausing(u, wait);
        await u.press('l');
        await u.click(O);
        await u.click({ x: 30, y: 0 });
        await u.click({ x: 30, y: 25 });
        await watchPresses(page);
        await p.click(O);
        expect(await count(u, 'line')).toBe(3);
        await expectAllOnCanvas(page);
      });

      test('a typed value still lets the next click place the segment', async ({ page }) => {
        const u = await start(page);
        const p = new Pausing(u, wait);
        await u.press('l');
        await u.click(O);
        await u.move({ x: 30, y: 10 });
        await u.type('50');
        await watchPresses(page);
        await p.click({ x: 30, y: 10 });
        const [l] = await u.lines();
        const s = await u.sketch();
        const b = pointAt(s, l.b);
        expect(Math.hypot(b.x, b.y)).toBeCloseTo(50, 3);
        await expectAllOnCanvas(page);
      });
    });

    test.describe('Select', () => {
      test('a click picks a line', async ({ page }) => {
        const u = await start(page);
        await corner(u);
        await watchPresses(page);
        await new Pausing(u, wait).click({ x: 15, y: 0 });
        expect(await selected(u)).toHaveLength(1);
        await expectAllOnCanvas(page);
      });

      test('a point drags', async ({ page }) => {
        const u = await start(page);
        await corner(u);
        await watchPresses(page);
        await new Pausing(u, wait).drag({ x: 30, y: 25 }, { x: 50, y: 40 });
        const s = await u.sketch();
        expect(Object.values(s.points).some((q) => Math.abs(q.x - 50) < 1e-6 && Math.abs(q.y - 40) < 1e-6)).toBe(true);
        await expectAllOnCanvas(page);
      });

      test('a curve drags', async ({ page }) => {
        const u = await start(page);
        await u.press('l');
        await u.click({ x: 10, y: 10 });
        await u.click({ x: 40, y: 10 });
        await leaveTool(u);
        await watchPresses(page);
        await new Pausing(u, wait).drag({ x: 25, y: 10 }, { x: 25, y: 30 });
        const [l] = await u.lines() as Line[];
        expect(pointAt(await u.sketch(), l.a).y).toBeCloseTo(30, 3);
        await expectAllOnCanvas(page);
      });

      test('a window starts on empty canvas', async ({ page }) => {
        const u = await start(page);
        await rectangle(u);
        await watchPresses(page);
        await new Pausing(u, wait).drag({ x: -40, y: -30 }, { x: 40, y: 30 });
        expect(await selected(u)).toHaveLength(4);
        await expectAllOnCanvas(page);
      });

      test('a double click picks the chain', async ({ page }) => {
        const u = await start(page);
        await rectangle(u);
        const on = { x: 0, y: -20 };
        await watchPresses(page);
        await new Pausing(u, wait).stopOn(on);
        const s = await u.screen(on);
        await page.mouse.dblclick(s.x, s.y);
        await u.settle();
        expect(await selected(u)).toHaveLength(4);
        await expectAllOnCanvas(page);
      });

      test('a spline handle drags', async ({ page }) => {
        const u = await start(page);
        await pick(u, 'Fit Point Spline');
        for (const q of [{ x: -30, y: 10 }, { x: 0, y: 10 }, { x: 30, y: 10 }]) await u.click(q);
        await u.press('Enter');
        await u.press('Escape');
        await u.rightClick({ x: 0, y: 10 });
        await page.locator('.menu-item[data-item="spline-handle-on"]').click();
        await u.settle();
        let s = await u.sketch();
        const spline = Object.values(s.curves).find((c): c is FitSpline => c.type === 'fitSpline') as FitSpline;
        const handle = spline.handles[1] as string;
        const h = pointAt(s, handle);
        await u.press('Escape');
        await watchPresses(page);
        await new Pausing(u, wait).drag(h, { x: h.x, y: 30 });
        s = await u.sketch();
        expect(pointAt(s, handle).y).toBeCloseTo(30, 3);
        await expectAllOnCanvas(page);
      });
    });

    test.describe('Sketch Dimension', () => {
      test('pick, place, type, then the next dimension', async ({ page }) => {
        const u = await start(page);
        const p = new Pausing(u, wait);
        await corner(u);
        await u.press('d');
        await watchPresses(page);
        await p.click({ x: 15, y: 0 });
        await p.click({ x: 15, y: -15 });
        await expect(page.locator('.hud-field.editor input')).toBeFocused();
        await page.keyboard.type('50');
        await u.press('Enter');
        await p.click({ x: 50, y: 12 });
        await p.click({ x: 72, y: 12 });
        await expect(page.locator('.hud-field.editor input')).toBeFocused();
        await page.keyboard.type('30 mm');
        await u.press('Enter');
        expect(Object.keys((await u.sketch()).dimensions)).toHaveLength(2);
        await expectAllOnCanvas(page);
      });

      test('a press on the canvas accepts the open editor', async ({ page }) => {
        const u = await start(page);
        await corner(u);
        await u.press('d');
        await u.click({ x: 15, y: 0 });
        await u.click({ x: 15, y: -15 });
        await watchPresses(page);
        await new Pausing(u, wait).click({ x: -40, y: 40 });
        await expect(page.locator('.hud-field.editor')).toHaveCount(0);
        expect(Object.keys((await u.sketch()).dimensions)).toHaveLength(1);
        await expectAllOnCanvas(page);
      });

      test('a double click on a dimension opens it', async ({ page }) => {
        const u = await start(page);
        await corner(u);
        await u.press('d');
        await u.click({ x: 15, y: 0 });
        await u.click({ x: 15, y: -15 });
        await page.keyboard.type('50');
        await u.press('Enter');
        await leaveTool(u);
        const [dim] = Object.values((await u.sketch()).dimensions);
        await new Pausing(u, wait).stopOn(dim.label);
        const s = await u.screen(dim.label);
        await page.mouse.dblclick(s.x, s.y);
        await u.settle();
        await expect(page.locator('.hud-field.editor input')).toBeFocused();
      });
    });
  });
}

test.describe('the boxes that should take a click still do', () => {
  /** A box that stays put, reached the way a hand reaches it: in small steps, through its border. */
  const creepOnto = async (u: SketchUser, key: string): Promise<void> => {
    const page = u.page;
    const box = await page.locator(`.hud-field[data-key="${key}"] input`).boundingBox();
    expect(box).not.toBeNull();
    const { x, y, height } = box as { x: number; y: number; height: number };
    await page.mouse.move(x - 12, y + height / 2);
    await page.mouse.move(x + 20, y + height / 2, { steps: 32 });
    await u.settle();
  };

  const lineUnderWay = async (page: Page): Promise<SketchUser> => {
    const u = await start(page);
    await u.press('l');
    await u.click(O);
    await u.move({ x: 80, y: 30 });
    return u;
  };

  for (const wait of WAITS) {
    test(`the angle box after ${wait} ms on it`, async ({ page }) => {
      const u = await lineUnderWay(page);
      await creepOnto(u, 'angle');
      if (wait) await page.waitForTimeout(wait);
      await page.mouse.down();
      await page.mouse.up();
      await expect(page.locator('.hud-field[data-key="angle"] input')).toBeFocused();
      expect(await u.lines()).toHaveLength(0);
    });
  }

  const filletPicked = async (page: Page): Promise<SketchUser> => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: -40, y: 20 });
    await u.click({ x: 0, y: 20 });
    await u.click({ x: 0, y: 60 });
    await leaveTool(u);
    await page.locator('.panel[data-panel="modify"] .panel-name').click();
    await page.locator('.menu-item[data-item="Fillet"]').click();
    await u.settle();
    await u.click({ x: 0, y: 20 });
    return u;
  };

  test('the Fillet radius box, which is placed once and never moved', async ({ page }) => {
    const u = await filletPicked(page);
    await creepOnto(u, 'r');
    await page.waitForTimeout(700);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('.hud-field[data-key="r"] input')).toBeFocused();
  });

  test('the Fillet radius box after the fillet handle was dragged', async ({ page }) => {
    const u = await filletPicked(page);
    const input = page.locator('.hud-field[data-key="r"] input');
    const before = await input.inputValue();
    const box = await page.locator('.hud-field[data-key="r"]').boundingBox();
    const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };
    // The handle is at the middle of the arc, 40 px back from the box along the corner's bisector.
    const handle = { x: x + width / 2 - 28.3, y: y + height / 2 - 28.3 };
    await page.mouse.move(handle.x, handle.y, { steps: 3 });
    await u.settle();
    await page.mouse.down();
    await page.mouse.move(handle.x - 24, handle.y - 24, { steps: 8 });
    await u.settle();
    await page.mouse.up();
    await u.settle();
    expect(await input.inputValue()).not.toBe(before);
    await creepOnto(u, 'r');
    await page.mouse.down();
    await page.mouse.up();
    await expect(input).toBeFocused();
  });

  test('the angle box after a zoom in the middle of the tool', async ({ page }) => {
    const u = await lineUnderWay(page);
    await page.mouse.wheel(0, -120);
    await u.settle();
    await u.move({ x: 60, y: 20 });
    await u.move({ x: 60, y: 25 });
    await creepOnto(u, 'angle');
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('.hud-field[data-key="angle"] input')).toBeFocused();
    expect(await u.lines()).toHaveLength(0);
  });
});
