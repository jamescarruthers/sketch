// The time to solve on the status bar, through real mouse and keyboard. Times vary from run to run, so these check
// the wording, that a time is positive, and when the readout is there at all, never a particular number of ms.
// `solveRuns` says a time was taken, since two solves can give the same reading. A sketch is loaded from the
// autosave slot where the test needs one with a dimension in it already.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SketchUser, pointAt, type Xy } from './helpers';
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

const SHOTS = process.env.SOLVE_TIME_SHOTS;
const shot = async (page: Page, name: string): Promise<void> => {
  if (SHOTS) await page.locator('.statusbar').screenshot({ path: `${SHOTS}/${name}.png` });
};

const readout = (page: Page): Locator => page.locator('.status-solve');
const measure = (page: Page): Locator => page.locator('.status-measure');
/** The wording itself: it is there when the readout has room, and gone, whole, when it has not. */
const wording = (page: Page): Locator => page.locator('.status-solve-text');
const text = async (page: Page): Promise<string> => (await readout(page).textContent()) ?? '';
const WORDING = /^Solve (<0\.1|\d{1,2}\.\d|\d{2,}) ms$/;

/** The ms the readout says; `<0.1` is a time too short for the clock to resolve, which is still above nothing. */
async function shown(page: Page): Promise<number> {
  const t = await text(page);
  expect(t).toMatch(WORDING);
  const ms = t.includes('<') ? 0.05 : Number(/[\d.]+/.exec(t)?.[0]);
  expect(ms).toBeGreaterThan(0);
  return ms;
}

const runs = (u: SketchUser): Promise<number> => u.page.evaluate(() => window.__sketch.solveRuns);

const leave = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};

const panels: Record<string, 'create' | 'modify' | 'constraints'> = {
  Coincident: 'constraints', 'Horizontal/Vertical': 'constraints',
};

async function tool(u: SketchUser, label: string): Promise<void> {
  await u.page.locator(`.panel[data-panel="${panels[label] ?? 'create'}"] .panel-name`).click();
  await u.page.locator(`.menu-item[data-item="${label}"]`).click();
  await u.settle();
}

const pick = async (u: SketchUser, label: string, ...picks: Xy[]): Promise<void> => {
  await tool(u, label);
  for (const p of picks) await u.click(p);
  await leave(u);
};

const start = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  return u;
};

/** Two lines, a length on the first and two loose points, and a second sketch with a line, as a reload finds them. */
const DESIGN = {
  version: 1, name: 'Solve time', order: ['s1', 's2'], parameters: [], units: 'mm', nextId: 40,
  sketches: {
    s1: {
      id: 's1', name: 'Sketch1', plane: 'XY', visible: true,
      points: {
        p1: { id: 'p1', x: -40, y: 10, owner: 'l1' }, p2: { id: 'p2', x: 40, y: 10, owner: 'l1' },
        p3: { id: 'p3', x: -40, y: -30, owner: 'l2' }, p4: { id: 'p4', x: 20, y: -20, owner: 'l2' },
        e1: { id: 'e1', x: -8, y: 2, explicit: true }, e2: { id: 'e2', x: 8, y: -8, explicit: true },
      },
      curves: {
        l1: { id: 'l1', type: 'line', lineType: 'normal', a: 'p1', b: 'p2' },
        l2: { id: 'l2', type: 'line', lineType: 'normal', a: 'p3', b: 'p4' },
      },
      constraints: {},
      dimensions: {
        d1: { id: 'd1', kind: 'distance', refs: ['p1', 'p2'], name: 'd1', expression: '80 mm', value: 80, driving: true, label: { x: 0, y: 30 } },
      },
      features: {},
    },
    s2: {
      id: 's2', name: 'Sketch2', plane: 'XY', visible: true,
      points: { q1: { id: 'q1', x: -20, y: 0, owner: 'm1' }, q2: { id: 'q2', x: 20, y: 5, owner: 'm1' } },
      curves: { m1: { id: 'm1', type: 'line', lineType: 'normal', a: 'q1', b: 'q2' } },
      constraints: {}, dimensions: {}, features: {},
    },
  },
};

/** Reload into the design above and open its first sketch. */
async function loaded(page: Page, row = 0): Promise<SketchUser> {
  const u = new SketchUser(page);
  await u.open();
  await page.evaluate((t) => localStorage.setItem('sketch.autosave', t), JSON.stringify(DESIGN));
  await page.reload();
  await page.waitForFunction(() => !!window.__sketch);
  await page.locator('.sketch-row').nth(row).dblclick();
  await u.settle();
  await expect(page.locator('.tab.active')).toHaveText('SKETCH');
  return u;
}

const onLine = (s: Sketch, id: Id, t = 0.5): Xy => {
  const l = s.curves[id] as Line;
  const [a, b] = [pointAt(s, l.a), pointAt(s, l.b)];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};

// ---------------------------------------------------------------------------

test.describe('when it shows', () => {
  test('opening a saved sketch solves it, and that is its time', async ({ page }) => {
    await loaded(page);
    await shown(page);
  });

  test('a constraint takes one time and shows it', async ({ page }) => {
    const u = await loaded(page);
    const s = await u.sketch();
    const before = await runs(u);
    await pick(u, 'Horizontal/Vertical', onLine(s, 'l2'));
    expect(await runs(u)).toBe(before + 1);
    await shown(page);
    // It sits beside the sketch state, not instead of it.
    await expect(page.locator('.status-state')).toContainText('Constrained');
    await shot(page, 'after-constraint');
  });

  test('a dimension edit takes one time and shows it', async ({ page }) => {
    const u = await loaded(page);
    const before = await runs(u);
    await u.doubleClick({ x: 0, y: 30 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('60');
    await u.press('Enter');
    await leave(u);
    expect(((await u.sketch()).dimensions.d1).value).toBeCloseTo(60, 6);
    expect(await runs(u)).toBe(before + 1);
    await shown(page);
  });

  test('a new dimension is one request, though it solves more than once', async ({ page }) => {
    const u = await loaded(page);
    const before = await runs(u);
    await u.press('d');
    await u.click(onLine(await u.sketch(), 'l2'));
    await u.click({ x: -10, y: -40 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('55');
    await u.press('Enter');
    await leave(u);
    expect(Object.keys((await u.sketch()).dimensions)).toHaveLength(2);
    expect(await runs(u)).toBe(before + 1);
    await shown(page);
  });

  test('it updates live during a drag, with the button still down', async ({ page }) => {
    const u = await loaded(page);
    const s = await u.sketch();
    const from = pointAt(s, 'p4');
    const start = await u.screen(from);
    await u.move(from);
    await u.settle();
    const before = await runs(u);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 30, { steps: 6 });
    await u.settle();
    // Still dragging: no commit has happened, and the steps already have a time.
    expect(await runs(u)).toBeGreaterThan(before);
    await shown(page);
    await shot(page, 'during-drag');
    const mid = await runs(u);
    await page.mouse.move(start.x + 80, start.y + 10, { steps: 6 });
    await u.settle();
    expect(await runs(u)).toBeGreaterThan(mid);
    await shown(page);
    await page.mouse.up();
    await u.settle();
    expect(pointAt(await u.sketch(), 'p4').x).toBeGreaterThan(from.x);
    await shown(page);
  });

  test('a refused edit still takes a time and shows it', async ({ page }) => {
    const u = await loaded(page);
    const before = await runs(u);
    const sketch = await u.sketch();
    // Joining a line's own ends would collapse it: the edit is thrown out.
    await pick(u, 'Coincident', pointAt(sketch, 'p3'), pointAt(sketch, 'p4'));
    expect(await page.evaluate(() => window.__sketch.note)).toMatch(/not applied/);
    expect(Object.values((await u.sketch()).constraints)).toEqual([]);
    expect(await runs(u)).toBe(before + 1);
    await shown(page);
  });

  test('Undo solves nothing, so the time stays as it was', async ({ page }) => {
    const u = await loaded(page);
    await pick(u, 'Horizontal/Vertical', onLine(await u.sketch(), 'l2'));
    await shown(page);
    const was = { text: await text(page), runs: await runs(u) };
    await u.press('ControlOrMeta+z');
    expect(Object.values((await u.sketch()).constraints)).toEqual([]);
    expect(await text(page)).toBe(was.text);
    expect(await runs(u)).toBe(was.runs);
  });

  test('none in design mode, and back when the sketch is opened again', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: -30, y: 0 });
    await u.click({ x: 30, y: 0 });
    await leave(u);
    await shown(page);
    const was = await text(page);
    await page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await u.settle();
    await expect(page.locator('.tab.active')).not.toHaveText('SKETCH');
    await expect(readout(page)).toHaveText('');
    await expect(readout(page)).toBeHidden();
    await page.locator('.sketch-row').dblclick();
    await u.settle();
    // The last solve of that sketch is still its time.
    expect(await text(page)).toBe(was);
  });

  test('none with no sketch open', async ({ page }) => {
    const u = new SketchUser(page);
    await u.open();
    await expect(readout(page)).toHaveText('');
    await expect(readout(page)).toBeHidden();
  });
});

test.describe('how it reads', () => {
  test('it reads as Solve, a number and ms', async ({ page }) => {
    const u = await start(page);
    await u.press('r');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 50, y: 40 });
    await leave(u);
    await shown(page);
    expect(await text(page)).toMatch(/^Solve /);
    expect(await text(page)).toMatch(/ ms$/);
  });
});

test.describe('the bar does not shift', () => {
  for (const size of [{ width: 1440, height: 900 }, { width: 1100, height: 700 }]) {
    test(`at ${size.width} x ${size.height}: the other items keep their place and nothing overflows`, async ({ page }) => {
      await page.setViewportSize(size);
      const u = await loaded(page);
      const box = async (sel: string) => page.locator(sel).evaluate((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const items = ['.status-state', '.status-coords', '.status-measure', '.status-solve', '.statusbar'];
      const read = async () => Object.fromEntries(await Promise.all(items.map(async (s) => [s, await box(s)])));
      // Empty first, as it is in design mode, then with a time: no item moves.
      await wording(page).evaluate((e) => { e.textContent = ''; });
      const before = await read();
      // A drag changes nothing the state says, so any move of the rest is the readout's doing.
      await u.drag(pointAt(await u.sketch(), 'p4'), { x: 30, y: -25 });
      await shown(page);
      const mid = await read();
      // Empty it has no height of its own, so its top moves; where it sits across and how wide it is does not.
      for (const sel of items) expect([mid[sel].x, mid[sel].w], sel).toEqual([before[sel].x, before[sel].w]);
      // And at every width of figures the readout can take.
      const seen: Record<string, number> = {};
      for (const ms of [3.2, 9.9, 12.4, 99.9, 100, 1234]) {
        await page.evaluate((v) => {
          (document.querySelector('.status-solve-text') as HTMLElement).textContent = v;
        }, ms >= 100 ? `Solve ${ms} ms` : `Solve ${ms.toFixed(1)} ms`);
        const now = await read();
        for (const sel of items) expect([now[sel].x, now[sel].w], `${sel} at ${ms}`).toEqual([before[sel].x, before[sel].w]);
        seen[String(ms)] = await readout(page).evaluate((e) => e.scrollWidth - e.clientWidth);
        expect(seen[String(ms)], `overflow at ${ms}`).toBeLessThanOrEqual(0);
      }
      const fits = await page.evaluate(() => {
        const bar = document.querySelector('.statusbar') as HTMLElement;
        return bar.scrollWidth - bar.clientWidth;
      });
      expect(fits).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('width, with Min Distance', () => {
  /** Two points picked together: Min Distance reads. */
  async function twoPicked(u: SketchUser): Promise<void> {
    const s = await u.sketch();
    await u.click(pointAt(s, 'e1'));
    await u.click(pointAt(s, 'e2'), { shift: true });
  }

  test('at 1440 px both read at once, the readout between Min Distance and the state, none overlapping', async ({ page }) => {
    const u = await loaded(page);
    await pick(u, 'Horizontal/Vertical', onLine(await u.sketch(), 'l2'));
    await shown(page);
    await twoPicked(u);
    await expect(measure(page)).toContainText('Min Distance');
    await shown(page);
    const b = await page.evaluate(() => ['.status-measure', '.status-solve', '.status-state', '.status-coords'].map((q) => {
      const r = (document.querySelector(q) as HTMLElement).getBoundingClientRect();
      return { x: r.x, right: r.right };
    }));
    for (let i = 1; i < b.length; i++) expect(b[i].x).toBeGreaterThanOrEqual(b[i - 1].right);
    await shot(page, 'with-min-distance');
  });

  for (const width of [1100, 865, 700, 560]) {
    test(`at ${width} px the bar stays inside and Min Distance can be read`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      const u = await loaded(page);
      await pick(u, 'Horizontal/Vertical', onLine(await u.sketch(), 'l2'));
      await twoPicked(u);
      await expect(measure(page)).toContainText('Min Distance');
      const bar = await page.locator('.statusbar').boundingBox();
      const reading = await measure(page).boundingBox();
      expect(bar?.width).toBeLessThanOrEqual(width);
      expect((reading?.x ?? 0) + (reading?.width ?? 0)).toBeLessThanOrEqual(width);
      expect(await measure(page).evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      const overflow = await page.evaluate(() => {
        const bar = document.querySelector('.statusbar') as HTMLElement;
        return bar.scrollWidth - bar.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(0);
      if (await wording(page).isVisible()) {
        // Both there: the readout clips nothing and does not touch Min Distance.
        await shown(page);
        expect(await readout(page).evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
        const r = await readout(page).boundingBox();
        expect(r?.x ?? 0).toBeGreaterThanOrEqual((reading?.x ?? 0) + (reading?.width ?? 0));
      }
      await shot(page, `narrow-${width}`);
    });
  }

  test('the readout gives way first: until it has gone the rest are as they are without it', async ({ page }) => {
    const u = await loaded(page);
    await pick(u, 'Horizontal/Vertical', onLine(await u.sketch(), 'l2'));
    await twoPicked(u);
    await expect(measure(page)).toContainText('Min Distance');
    const layout = (): Promise<Record<string, { w: number; clipped: boolean }>> => page.evaluate(() => Object.fromEntries(
      ['prompt', 'note', 'measure', 'state', 'coords'].map((n) => {
        const e = document.querySelector(`.status-${n}`) as HTMLElement;
        return [n, { w: e.getBoundingClientRect().width, clipped: e.scrollWidth > e.clientWidth }];
      }),
    ));
    let showing = 0;
    let gone = 0;
    for (let width = 1200; width >= 560; width -= 20) {
      await page.setViewportSize({ width, height: 700 });
      await u.settle();
      const visible = await wording(page).isVisible();
      const with_ = await layout();
      const style = await page.addStyleTag({ content: '.status-solve { display: none !important; }' });
      const without = await layout();
      await style.evaluate((e) => (e as Element).remove());
      for (const n of Object.keys(with_)) {
        // The note takes up whatever room is left, so it is only the others whose width says anything.
        if (n !== 'note') expect(with_[n].w, `${n} at ${width}`).toBeCloseTo(without[n].w, 0);
        expect(with_[n].clipped, `${n} clipped at ${width}`).toBe(without[n].clipped);
      }
      // Min Distance is never cut, and the readout is never there when the others have been squeezed for it.
      expect(with_.measure.clipped, `Min Distance at ${width}`).toBe(false);
      if (visible) {
        showing++;
        expect(with_.coords.w, `coordinates at ${width}`).toBeGreaterThanOrEqual(189.5);
        expect(await readout(page).evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
        await shown(page);
      } else gone++;
    }
    expect(showing).toBeGreaterThan(3);
    expect(gone).toBeGreaterThan(3);
  });
});

test.describe('Light and Dark', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`legible in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const u = await loaded(page);
      await pick(u, 'Horizontal/Vertical', onLine(await u.sketch(), 'l2'));
      await shown(page);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
      const contrast = await page.evaluate(() => {
        const lum = (css: string): number => {
          const c = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
          c.fillStyle = css;
          c.fillRect(0, 0, 1, 1);
          const [r, g, b] = Array.from(c.getImageData(0, 0, 1, 1).data).map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const fg = getComputedStyle(document.querySelector('.status-solve') as HTMLElement).color;
        const bg = getComputedStyle(document.querySelector('.statusbar') as HTMLElement).backgroundColor;
        const [a, b] = [lum(fg), lum(bg)];
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(contrast).toBeGreaterThan(4.5);
      await shot(page, `theme-${scheme}`);
    });
  }
});
