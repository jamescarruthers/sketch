// Acts like a user: real mouse and keyboard on the canvas, addressed in sketch coordinates.
// `window.__sketch` is read only and is used for assertions and coordinate conversion, nothing else.
import { expect, type Page } from '@playwright/test';
import type { Curve, Design, Id, Line, Plane, Sketch } from '../src/model/types';

export interface Xy { x: number; y: number }

export class SketchUser {
  constructor(readonly page: Page) {}

  async open(opts: { keep?: boolean } = {}): Promise<void> {
    await this.page.goto('/');
    if (!opts.keep) {
      await this.page.evaluate(() => localStorage.clear());
      await this.page.reload();
    }
    await this.page.waitForFunction(() => !!window.__sketch);
  }

  /** Create Sketch, then a click on an origin plane's square in the Orbit view: a new sketch on it, landed and open. */
  async newSketch(plane: Plane = 'XY'): Promise<void> {
    await this.landed();
    await this.page.getByRole('button', { name: 'Create Sketch' }).first().click();
    await this.pickPlane(plane);
    await expect(this.page.locator('.tab.active')).toHaveText('SKETCH');
    await this.settle();
  }

  /** Wait for the camera to stop swinging. */
  async landed(): Promise<void> {
    await this.page.waitForFunction(() => !window.__sketch.swinging);
    await this.settle();
  }

  /** Where a point of an origin plane, in its coordinates, shows on the page in the 3D view. */
  async planeScreen(plane: Plane, x: number, y: number): Promise<Xy> {
    const at = await this.page.evaluate(([p, px, py]) => window.__sketch.planeToScreen(p as Plane, px as number, py as number), [plane, x, y] as const);
    if (!at) throw new Error('not in the 3D view');
    return at;
  }

  /**
   * While a plane is picked: click inside `plane`'s square, at a point no other square is in front of from Home
   * (4/5 of the way along each side), checking it lights first. Waits for the swing that follows.
   */
  async pickPlane(plane: Plane): Promise<void> {
    await this.landed();
    expect(await this.page.evaluate(() => window.__sketch.picking)).toBe(true);
    const size = await this.page.evaluate(() => window.__sketch.planeSize);
    const at = await this.planeScreen(plane, size * 0.8, size * 0.8);
    await this.page.mouse.move(at.x, at.y, { steps: 2 });
    await this.settle();
    expect(await this.page.evaluate(() => window.__sketch.pickHover)).toBe(plane);
    await this.page.mouse.down();
    await this.page.mouse.up();
    await this.landed();
  }

  async screen(p: Xy): Promise<Xy> {
    return this.page.evaluate(([x, y]) => window.__sketch.toScreen(x, y), [p.x, p.y]);
  }

  /** Let pending frames land, so layouts and DOM match the document. */
  async settle(): Promise<void> {
    await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  async move(p: Xy): Promise<void> {
    const s = await this.screen(p);
    await this.page.mouse.move(s.x, s.y, { steps: 3 });
  }

  async click(p: Xy, opts: { shift?: boolean } = {}): Promise<void> {
    await this.move(p);
    await this.settle();
    if (opts.shift) await this.page.keyboard.down('Shift');
    await this.page.mouse.down();
    await this.page.mouse.up();
    if (opts.shift) await this.page.keyboard.up('Shift');
    await this.settle();
  }

  async doubleClick(p: Xy): Promise<void> {
    await this.move(p);
    const s = await this.screen(p);
    await this.page.mouse.dblclick(s.x, s.y);
    await this.settle();
  }

  async rightClick(p: Xy): Promise<void> {
    const s = await this.screen(p);
    await this.page.mouse.move(s.x, s.y);
    await this.page.mouse.click(s.x, s.y, { button: 'right' });
    await this.settle();
  }

  async drag(from: Xy, to: Xy, steps = 8): Promise<void> {
    await this.move(from);
    await this.settle();
    await this.page.mouse.down();
    const b = await this.screen(to);
    await this.page.mouse.move(b.x, b.y, { steps });
    await this.settle();
    await this.page.mouse.up();
    await this.settle();
  }

  /** Zoom out at the centre of the canvas with the wheel. */
  async wheelOut(amount: number): Promise<void> {
    const s = await this.screen({ x: 0, y: 0 });
    await this.page.mouse.move(s.x, s.y);
    await this.page.mouse.wheel(0, amount);
    await this.settle();
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
    await this.settle();
  }

  async type(text: string): Promise<void> {
    await this.page.keyboard.type(text);
    await this.settle();
  }

  /** Pick a tool from the ribbon or its menu, as a user would. */
  async tool(label: string): Promise<void> {
    const pinned = this.page.locator('.tool-btn').filter({ has: this.page.locator('svg') }).and(this.page.locator(`[aria-label="${label}"]`));
    if (await pinned.count()) {
      await pinned.first().click();
    } else {
      await this.page.getByRole('button', { name: /^CREATE/ }).click();
      const flyout = FLYOUTS[label];
      if (flyout) await this.page.locator(`.menu-item.flyout[data-item="${flyout}"]`).hover();
      await this.page.locator(`.menu-item[data-item="${label}"]`).click();
    }
    await this.settle();
  }

  sketch(): Promise<Sketch> {
    return this.page.evaluate(() => window.__sketch.sketch() as Sketch);
  }

  design(): Promise<Design> {
    return this.page.evaluate(() => window.__sketch.design());
  }

  analysis() {
    return this.page.evaluate(() => window.__sketch.analysis());
  }

  async lines(): Promise<Line[]> {
    const s = await this.sketch();
    return Object.values(s.curves).filter((c): c is Line => c.type === 'line');
  }

  async curves(type?: Curve['type']): Promise<Curve[]> {
    const s = await this.sketch();
    return Object.values(s.curves).filter((c) => !type || c.type === type);
  }

  async statusLine(): Promise<string> {
    return (await this.page.locator('.palette-status').textContent()) ?? '';
  }

  async shot(name: string): Promise<void> {
    await this.settle();
    await this.page.screenshot({ path: `test-results/shots/${name}.png` });
  }
}

const FLYOUTS: Record<string, string> = {
  '2-Point Rectangle': 'Rectangle', '3-Point Rectangle': 'Rectangle', 'Center Rectangle': 'Rectangle',
  'Center Diameter Circle': 'Circle', '2-Point Circle': 'Circle', '3-Point Circle': 'Circle',
};

export const pointAt = (s: Sketch, id: Id): Xy => (id === 'origin' ? { x: 0, y: 0 } : s.points[id]);

export function constraintsOfType(s: Sketch, type: string): number {
  return Object.values(s.constraints).filter((k) => k.type === type).length;
}
