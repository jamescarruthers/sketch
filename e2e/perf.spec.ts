import { expect, test } from '@playwright/test';
import { SketchUser } from './helpers';

/** A chain of `n` joined lines, written straight into the autosave slot, as a reload would find it. */
function chainDesign(n: number, rise = 1.5): string {
  const points: Record<string, unknown> = {};
  const curves: Record<string, unknown> = {};
  const constraints: Record<string, unknown> = {};
  let id = 10;
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const a = `p${id++}`;
    const b = `p${id++}`;
    const l = `l${id++}`;
    const row = Math.floor(i / 40);
    const x = (i % 40) * 3 - 60;
    const y = row * 6 - 30;
    points[a] = { id: a, x, y, owner: l };
    points[b] = { id: b, x: x + 3, y: y + rise, owner: l };
    curves[l] = { id: l, type: 'line', lineType: 'normal', a, b };
    if (prev && i % 40 !== 0) {
      const k = `k${id++}`;
      constraints[k] = { id: k, type: 'coincident', refs: [prev, a] };
    }
    prev = b;
  }
  return JSON.stringify({
    version: 1, name: 'Perf', order: ['s1'], parameters: [], units: 'mm', nextId: id + 1,
    sketches: { s1: { id: 's1', name: 'Sketch1', plane: 'XY', visible: true, points, curves, constraints, dimensions: {}, features: {} } },
  });
}

/** `n` chained lines over three layers: each row is on the next layer, and depends on the row before. */
function layeredDesign(n: number): string {
  const design = JSON.parse(chainDesign(n)) as {
    version: number; layers: unknown[]; activeLayer: string; nextId: number;
    sketches: { s1: { curves: Record<string, { layer: string; a: string; b: string }>; constraints: Record<string, unknown> } };
  };
  const ids = ['ly1', 'ly2', 'ly3'];
  design.version = 2;
  design.layers = ids.map((id, i) => ({ id, name: `L${i + 1}`, color: '#336699', visible: true, locked: false }));
  design.activeLayer = 'ly1';
  const curves = Object.values(design.sketches.s1.curves);
  curves.forEach((c, i) => { c.layer = ids[Math.floor(i / 40) % 3]; });
  for (let i = 40; i < curves.length; i += 40) {
    if (curves[i].layer === 'ly1') continue;
    const k = `k${design.nextId++}`;
    design.sketches.s1.constraints[k] = { id: k, type: 'coincident', refs: [curves[i - 1].b, curves[i].a], dependentLayer: curves[i].layer };
  }
  return JSON.stringify(design);
}

test('a 500-curve drag on layers stays responsive', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await page.evaluate((text) => localStorage.setItem('sketch.autosave', text), layeredDesign(500));
  await page.reload();
  await page.waitForFunction(() => !!window.__sketch);
  await page.locator('.sketch-row').dblclick();
  await u.press('F6');
  expect((await u.lines()).length).toBe(500);
  const a = await u.screen({ x: -57, y: -30 + 0.75 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const started = Date.now();
  for (let i = 1; i <= 30; i++) await page.mouse.move(a.x + i * 2, a.y + i);
  await u.settle();
  const ms = Date.now() - started;
  await page.mouse.up();
  await u.settle();
  console.log(`500 curves on 3 layers: 30 drag events in ${ms} ms`);
  expect(ms / 30).toBeLessThan(33);
});

test('a 400-curve sketch stays responsive and repaints only on change', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await page.evaluate((text) => localStorage.setItem('sketch.autosave', text), chainDesign(400));
  await page.reload();
  await page.waitForFunction(() => !!window.__sketch);
  await page.locator('.sketch-row').dblclick();
  await u.press('F6');
  expect(await page.evaluate(() => window.__sketch.mode)).toBe('sketch');
  expect((await u.lines()).length).toBe(400);

  const samples = await page.evaluate(async () => {
    const out: number[] = [];
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      out.push(window.__sketch.frameMs);
    }
    return out;
  });
  const before = await page.evaluate(() => window.__sketch.frames);
  const a = await u.screen({ x: -57, y: -30 + 0.75 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const started = Date.now();
  for (let i = 1; i <= 30; i++) await page.mouse.move(a.x + i * 2, a.y + i);
  await u.settle();
  const ms = Date.now() - started;
  await page.mouse.up();
  await u.settle();
  const painted = (await page.evaluate(() => window.__sketch.frames)) - before;
  const frame = await page.evaluate(() => window.__sketch.frameMs);
  console.log(`idle frame ${Math.max(...samples).toFixed(1)} ms, 30 drag events in ${ms} ms, ${painted} frames, last frame ${frame.toFixed(1)} ms`);
  expect(ms / 30).toBeLessThan(33);
  await u.shot('perf-400');
});

test('opening and committing on 1100 curves stays quick', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), (async () => {
    await page.locator('[data-menu="file"]').click();
    await page.locator('.menu-item[data-item="Open..."]').click();
  })()]);
  const entered = Date.now();
  await chooser.setFiles({ name: 'chain.json', mimeType: 'application/json', buffer: Buffer.from(chainDesign(1100, 0), 'utf8') });
  await page.waitForFunction(() => window.__sketch.design().order.length > 0);
  await page.locator('.sketch-row').dblclick();
  await u.settle();
  expect(await page.evaluate(() => window.__sketch.analysis().dof)).toBeGreaterThan(0);
  const open = Date.now() - entered;
  await u.press('F6');
  const started = await u.sketch();
  expect(Object.keys(started.curves).length).toBe(1100);
  const [line, other] = await u.lines();
  const middle = (l: typeof line): { x: number; y: number } => ({ x: (started.points[l.a].x + started.points[l.b].x) / 2, y: (started.points[l.a].y + started.points[l.b].y) / 2 });
  await u.tool('Equal');
  await u.click(middle(line));
  const at = middle(other);
  await u.move(at);
  await u.settle();
  const commit = Date.now();
  const screen = await u.screen(at);
  await page.mouse.click(screen.x, screen.y);
  await u.settle();
  expect(Object.keys((await u.sketch()).constraints).length).toBe(Object.keys(started.constraints).length + 1);
  const took = Date.now() - commit;
  console.log(`1100 curves: enter ${open} ms, commit ${took} ms`);
  expect(open).toBeLessThan(1000);
  expect(took).toBeLessThan(1000);
});
