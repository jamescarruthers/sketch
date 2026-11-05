// The rest of the last audit's open list, one regression test each, in id order.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { constraintsOfType, pointAt, SketchUser, type Xy } from './helpers';
import type { Arc, Circle, ControlSpline, FitSpline, Line, UserParameter } from '../src/model/types';

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

const exitTool = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};

async function menu(u: SketchUser, panel: 'create' | 'modify' | 'constraints', label: string, flyout?: string): Promise<void> {
  await u.page.locator(`.panel[data-panel="${panel}"] .panel-name`).click();
  if (flyout) await u.page.locator(`.menu-item.flyout[data-item="${flyout}"]`).hover();
  await u.page.locator(`.menu-item[data-item="${label}"]`).click();
  await u.settle();
}

const dialog = (u: SketchUser, title: string): Locator => u.page.locator(`.dialog[data-dialog="${title}"]`);
const rowOf = (d: Locator, label: string): Locator => d.locator('.form-row').filter({ has: d.page().locator(`.form-label:text-is("${label}")`) });
const ok = async (u: SketchUser, d: Locator): Promise<void> => {
  await d.locator('.btn.primary').click();
  await u.settle();
};
const note = (u: SketchUser): Promise<string> => u.page.evaluate(() => window.__sketch.note);
const addLayer = async (u: SketchUser): Promise<void> => {
  await u.page.locator('[data-action="add-layer"]').click();
  await u.settle();
};
const layerRow = (u: SketchUser, name: string): Locator => u.page.locator('.layer-row', { hasText: name });

async function line(u: SketchUser, a: Xy, b: Xy): Promise<void> {
  await u.press('l');
  await u.click(a);
  await u.click(b);
  await exitTool(u);
}

async function rectangle(u: SketchUser, a: Xy, b: Xy): Promise<void> {
  await u.press('r');
  await u.click(a);
  await u.click(b);
  await exitTool(u);
}

async function arc3(u: SketchUser, a: Xy, b: Xy, m: Xy): Promise<void> {
  await menu(u, 'create', '3-Point Arc', 'Arc');
  await u.click(a);
  await u.click(b);
  await u.click(m);
  await exitTool(u);
}

async function text(u: SketchUser, a: Xy, b: Xy, body: string): Promise<void> {
  await menu(u, 'create', 'Text');
  await u.click(a);
  await u.click(b);
  const d = dialog(u, 'Text');
  await d.locator('textarea').fill(body);
  await rowOf(d, 'Height').locator('input').fill('10');
  await ok(u, d);
  await exitTool(u);
}

async function spline(u: SketchUser, tool: string, pts: Xy[]): Promise<void> {
  await menu(u, 'create', tool, 'Spline');
  for (const p of pts) await u.click(p);
  await u.press('Enter');
  await exitTool(u);
}

const ids = (u: SketchUser, type: string): Promise<string[]> => u.curves(type as never).then((c) => c.map((x) => x.id));

test.describe('OPEN-2: Match Topology over its limit', () => {
  test('clamps in the dialog, the dimension and the status, and no segment collapses', async ({ page }) => {
    const u = await start(page);
    await rectangle(u, { x: 0, y: 0 }, { x: 40, y: 10 });
    await u.tool('Offset');
    await u.click({ x: 20, y: 10 });
    await u.move({ x: 20, y: 5 });
    const d = dialog(u, 'Offset');
    await rowOf(d, 'Distance').locator('input').fill('8 mm');
    await rowOf(d, 'Match Topology').locator('input').check();
    await u.settle();
    const shown = await rowOf(d, 'Distance').locator('input').inputValue();
    expect(parseFloat(shown)).toBeLessThan(5);
    expect(parseFloat(shown)).toBeGreaterThan(4.9);
    await expect(d.locator('.offset-limit')).toContainText('Match Topology limits');
    await d.locator('.btn.primary').hover();
    await page.keyboard.press('Enter');
    await u.settle();
    const s = await u.sketch();
    const lines = Object.values(s.curves).filter((c): c is Line => c.type === 'line');
    expect(lines.length).toBe(8);
    for (const l of lines) {
      expect(Math.hypot(pointAt(s, l.a).x - pointAt(s, l.b).x, pointAt(s, l.a).y - pointAt(s, l.b).y)).toBeGreaterThan(0.009);
    }
    const dim = Object.values(s.dimensions)[0];
    expect(dim.value).toBeCloseTo(parseFloat(shown), 6);
    expect(parseFloat(dim.expression)).toBeCloseTo(parseFloat(shown), 6);
    expect(await u.statusLine()).not.toContain('Over');
    expect(await note(u)).toContain('Match Topology limits');
  });

  test('typed past the limit with the box already ticked: the same on Enter', async ({ page }) => {
    const u = await start(page);
    await rectangle(u, { x: 0, y: 0 }, { x: 40, y: 10 });
    await u.tool('Offset');
    await u.click({ x: 20, y: 10 });
    await u.move({ x: 20, y: 5 });
    const d = dialog(u, 'Offset');
    await rowOf(d, 'Match Topology').locator('input').check();
    await rowOf(d, 'Distance').locator('input').fill('12 mm');
    await d.locator('.btn.primary').hover();
    await page.keyboard.press('Enter');
    await u.settle();
    const s = await u.sketch();
    const dim = Object.values(s.dimensions)[0];
    expect(dim.value).toBeLessThan(5);
    expect(parseFloat(dim.expression)).toBeCloseTo(dim.value, 6);
    expect(await note(u)).toContain('Match Topology limits');
    expect(await u.statusLine()).not.toContain('Over');
  });

  test('a source dimension that would collapse an offset is refused, and says why', async ({ page }) => {
    const u = await start(page);
    await rectangle(u, { x: 0, y: 0 }, { x: 40, y: 10 });
    await u.press('d');
    await u.click({ x: 40, y: 5 });
    await u.click({ x: 55, y: 5 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('10');
    await u.press('Enter');
    await exitTool(u);
    await u.tool('Offset');
    await u.click({ x: 20, y: 10 });
    await u.move({ x: 20, y: 5 });
    const d = dialog(u, 'Offset');
    await rowOf(d, 'Distance').locator('input').fill('4 mm');
    await d.locator('.btn.primary').hover();
    await page.keyboard.press('Enter');
    await u.settle();
    const before = await u.sketch();
    const height = Object.values(before.dimensions).find((m) => m.value === 10);
    await u.doubleClick(height?.label as Xy);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('6');
    await u.press('Enter');
    await u.settle();
    expect(await note(u)).toContain('collapse');
    const s = await u.sketch();
    expect(Object.values(s.curves).filter((c) => c.type === 'line').length).toBe(8);
  });
});

test.describe('OPEN-3: text parameters', () => {
  test('{Text1_text} in another text reads the first text, and follows it', async ({ page }) => {
    const u = await start(page);
    await text(u, { x: -60, y: 30 }, { x: 0, y: 50 }, 'Hi');
    await text(u, { x: -60, y: -20 }, { x: 20, y: 0 }, 'X={Text1_text}');
    const [, second] = await ids(u, 'text');
    const outlines = (id: string, t?: string) => page.evaluate(([c, v]) => window.__sketch.textOutlines(c as string, v), [id, t]);
    expect(await outlines(second)).toEqual(await outlines(second, 'X=Hi'));
    expect(await outlines(second)).not.toEqual(await outlines(second, 'X=Yo'));
    await menu(u, 'modify', 'Change Parameters');
    const d = dialog(u, 'Parameters');
    const box = d.locator('.param-row[data-param="Text1_text"] input').first();
    await box.fill('Yo');
    await box.press('Enter');
    await ok(u, d);
    expect(await outlines(second)).toEqual(await outlines(second, 'X=Yo'));
  });

  test('a user parameter with the Text unit goes into text, and two that name each other stay as written', async ({ page }) => {
    const u = await start(page);
    await menu(u, 'modify', 'Change Parameters');
    const d = dialog(u, 'Parameters');
    await d.locator('[data-action="add-parameter"]').click();
    const row = d.locator('.param-row[data-param="p1"]');
    await row.locator('input').nth(0).fill('PartNumber');
    await row.locator('input').nth(0).press('Enter');
    const user = d.locator('.param-row[data-param="PartNumber"]');
    await user.locator('select').selectOption('text');
    await user.locator('input').nth(1).fill("'AB-12'");
    await user.locator('input').nth(1).press('Enter');
    await expect(user.locator('.param-value')).toHaveText('AB-12');
    await ok(u, d);
    const parameter = (await u.design()).parameters[0] as UserParameter;
    expect(parameter.unit).toBe('text');
    await text(u, { x: -60, y: 2 }, { x: 20, y: 30 }, 'Part {PartNumber}');
    await text(u, { x: -60, y: 40 }, { x: 20, y: 70 }, 'a{Text3_text}');
    await text(u, { x: -60, y: -40 }, { x: 20, y: -10 }, 'b{Text2_text}');
    const [first, a] = await ids(u, 'text');
    const outlines = (id: string, t?: string) => page.evaluate(([c, v]) => window.__sketch.textOutlines(c as string, v), [id, t]);
    expect(await outlines(first)).toEqual(await outlines(first, 'Part AB-12'));
    // a -> b -> a: the loop stops where it comes back, with braces in the text, not hanging.
    expect((await outlines(a)).length).toBeGreaterThan((await outlines(a, 'ab')).length);
  });

  test('deleting a text leaves {Text2_text} meaning the same text', async ({ page }) => {
    const u = await start(page);
    await text(u, { x: -60, y: 30 }, { x: 0, y: 50 }, 'One');
    await text(u, { x: -60, y: -20 }, { x: 0, y: 0 }, 'Two');
    await text(u, { x: -60, y: -60 }, { x: 20, y: -30 }, '{Text2_text}');
    const [first, , third] = await ids(u, 'text');
    await u.drag({ x: -66, y: 24 }, { x: 6, y: 56 });
    expect(await page.evaluate(() => window.__sketch.selection)).toContain(first);
    await u.press('Delete');
    expect((await ids(u, 'text')).length).toBe(2);
    const outlines = (id: string, t?: string) => page.evaluate(([c, v]) => window.__sketch.textOutlines(c as string, v), [id, t]);
    expect(await outlines(third)).toEqual(await outlines(third, 'Two'));
  });
});

test('OPEN-4: the default fillet radius lands inside the corner of a line and an arc', async ({ page }) => {
  const u = await start(page);
  await line(u, { x: -60, y: 12 }, { x: 60, y: 12 });
  await arc3(u, { x: -35, y: -25 }, { x: 30, y: -25 }, { x: 3, y: 40 });
  await menu(u, 'modify', 'Fillet');
  await u.click({ x: 5, y: 12 });
  await u.click({ x: 3, y: 40 });
  await u.press('Enter');
  await exitTool(u);
  const s = await u.sketch();
  const arcs = Object.values(s.curves).filter((c): c is Arc => c.type === 'arc');
  const big = arcs.reduce((p, q) => (Math.hypot(pointAt(s, p.a).x - pointAt(s, p.c).x, pointAt(s, p.a).y - pointAt(s, p.c).y) > Math.hypot(pointAt(s, q.a).x - pointAt(s, q.c).x, pointAt(s, q.a).y - pointAt(s, q.c).y) ? p : q));
  const small = arcs.find((a) => a.id !== big.id) as Arc;
  const c = pointAt(s, small.c);
  const m = pointAt(s, big.c);
  const r = Math.hypot(pointAt(s, big.a).x - m.x, pointAt(s, big.a).y - m.y);
  expect(c.y).toBeGreaterThan(12);
  expect(Math.hypot(c.x - m.x, c.y - m.y)).toBeLessThan(r);
});

test('OPEN-5: Curvature on a control spline moves its first legs, and its far end stays', async ({ page }) => {
  const u = await start(page);
  await line(u, { x: -40, y: 20 }, { x: -5, y: 22 });
  const pts = [{ x: -5, y: 22 }, { x: 10, y: 30 }, { x: 25, y: 35 }, { x: 40, y: 30 }, { x: 55, y: 20 }, { x: 70, y: 25 }];
  await spline(u, 'Control Point Spline', pts);
  await menu(u, 'constraints', 'Curvature');
  await u.click({ x: -22.5, y: 21 });
  await u.click({ x: -5, y: 22 });
  await exitTool(u);
  const s = await u.sketch();
  const sp = Object.values(s.curves).find((c): c is ControlSpline => c.type === 'controlSpline') as ControlSpline;
  expect(constraintsOfType(s, 'curvature')).toBe(1);
  const end = pointAt(s, sp.pts[5]);
  expect(end.x).toBeCloseTo(70, 1);
  expect(end.y).toBeCloseTo(25, 1);
  expect(await u.statusLine()).not.toContain('Over');
});

test('OPEN-6: dragging a joined end held by another layer onto an axis adds nothing and stays Under-Constrained', async ({ page }) => {
  const u = await start(page);
  await line(u, { x: 20, y: 20 }, { x: 50, y: 30 });
  await addLayer(u);
  await line(u, { x: 20, y: 20 }, { x: -30, y: 40 });
  const before = await u.sketch();
  await u.drag({ x: 20, y: 20 }, { x: 20, y: 0 }, 6);
  const s = await u.sketch();
  expect(Object.keys(s.constraints).length).toBe(Object.keys(before.constraints).length);
  expect(await u.statusLine()).not.toContain('Over');
  expect((await u.analysis()).unsatisfied).toEqual([]);
});

test('OPEN-7: a note about a layer goes when the layer changes', async ({ page }) => {
  const u = await start(page);
  await addLayer(u);
  await layerRow(u, 'Layer 2').locator('.layer-eye').click();
  await u.settle();
  expect(await note(u)).toContain('Make another layer active');
  await layerRow(u, 'Layer 1').locator('.layer-name').click();
  await u.settle();
  expect(await note(u)).toBe('');
  await layerRow(u, 'Layer 1').locator('.layer-lock').click();
  await u.settle();
  await u.click({ x: 10, y: 10 });
  expect(await note(u)).toContain('locked');
  await layerRow(u, 'Layer 1').locator('.layer-lock').click();
  await u.settle();
  expect(await note(u)).toBe('');
});

test('OPEN-8: Mirror Line and pattern Center Point say so when the pick is on another layer', async ({ page }) => {
  const u = await start(page);
  await line(u, { x: -50, y: 0 }, { x: 50, y: 40 });
  await menu(u, 'create', 'Point');
  await u.click({ x: -60, y: -30 });
  await exitTool(u);
  await addLayer(u);
  await line(u, { x: 10, y: -40 }, { x: 30, y: -40 });
  await u.tool('Mirror');
  await u.click({ x: 20, y: -40 });
  await dialog(u, 'Mirror').locator('[data-field="Mirror Line"] .select-toggle').click();
  await u.click({ x: 25, y: 30 });
  expect(await note(u)).toContain('Layer 1');
  await page.locator('.dialog .btn:has-text("Cancel")').click();
  await u.settle();
  await menu(u, 'create', 'Circular Pattern');
  await u.click({ x: 20, y: -40 });
  await dialog(u, 'Circular Pattern').locator('[data-field="Center Point"] .select-toggle').click();
  await u.click({ x: -60, y: -30 });
  expect(await note(u)).toContain('Layer 1');
  await page.locator('.dialog .btn:has-text("Cancel")').click();
});

test('OPEN-9: both export dialogs offer Centerlines, ticked', async ({ page }) => {
  const u = await start(page);
  await line(u, { x: 0, y: 0 }, { x: 40, y: 0 });
  const id = (await u.sketch()).id;
  for (const [item, title] of [['Export DXF', 'Export DXF'], ['Save as SVG', 'Save as SVG']]) {
    await page.locator(`.sketch-row[data-sketch="${id}"], .sketch-row`).first().click({ button: 'right' });
    await page.locator(`.popup-menu [data-item="${item}"]`).click();
    await expect(rowOf(dialog(u, title), 'Centerlines').locator('input')).toBeChecked();
    await page.locator('.dialog .btn:has-text("Cancel")').click();
    await u.settle();
  }
});

test('OPEN-10: Esc closes a browser right-click menu', async ({ page }) => {
  const u = await start(page);
  await page.locator('.sketch-row').first().click({ button: 'right' });
  await expect(page.locator('.popup-menu')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.popup-menu')).toHaveCount(0);
  await u.settle();
  expect(await page.evaluate(() => window.__sketch.mode)).toBe('sketch');
});

test('OPEN-11: text and height changed in one Change Parameters undo as one step', async ({ page }) => {
  const u = await start(page);
  await text(u, { x: -60, y: 2 }, { x: 20, y: 30 }, 'Hi');
  const [id] = await ids(u, 'text');
  const height = ((await u.sketch()).curves[id] as { height: number }).height;
  await menu(u, 'modify', 'Change Parameters');
  const d = dialog(u, 'Parameters');
  const box = d.locator('.param-row[data-param="Text1_text"] input').first();
  await box.fill('Yo');
  await box.press('Enter');
  const h = d.locator('.param-row[data-param="Text1_height"] input').first();
  await h.fill('20 mm');
  await h.press('Enter');
  await ok(u, d);
  await page.waitForTimeout(900);
  let t = (await u.sketch()).curves[id] as { text: string; height: number };
  expect([t.text, t.height]).toEqual(['Yo', 20]);
  await page.keyboard.press('ControlOrMeta+z');
  await u.settle();
  t = (await u.sketch()).curves[id] as { text: string; height: number };
  expect([t.text, t.height]).toEqual(['Hi', height]);
});

test('OPEN-12: Parallel with a polygon edge second leaves the first line and turns the polygon', async ({ page }) => {
  const u = await start(page);
  await menu(u, 'create', 'Inscribed Polygon', 'Polygon');
  await u.click({ x: 40, y: 0 });
  await u.click({ x: 62, y: 9 });
  await exitTool(u);
  await line(u, { x: -60, y: -30 }, { x: -20, y: -30 });
  let s = await u.sketch();
  const free = Object.values(s.curves).filter((c): c is Line => c.type === 'line' && pointAt(s, c.a).y === -30)[0];
  const edge = Object.values(s.curves).find((c): c is Line => c.type === 'line' && c.lineType === 'normal' && c.id !== free.id) as Line;
  const mid = { x: (pointAt(s, edge.a).x + pointAt(s, edge.b).x) / 2, y: (pointAt(s, edge.a).y + pointAt(s, edge.b).y) / 2 };
  const size = Math.hypot(pointAt(s, edge.a).x - pointAt(s, edge.b).x, pointAt(s, edge.a).y - pointAt(s, edge.b).y);
  await menu(u, 'constraints', 'Parallel');
  await u.click({ x: -40, y: -30 });
  await u.click(mid);
  await exitTool(u);
  s = await u.sketch();
  expect(pointAt(s, free.a)).toMatchObject({ x: expect.closeTo(-60, 3), y: expect.closeTo(-30, 3) });
  expect(pointAt(s, free.b)).toMatchObject({ x: expect.closeTo(-20, 3), y: expect.closeTo(-30, 3) });
  expect(pointAt(s, edge.a).y).toBeCloseTo(pointAt(s, edge.b).y, 3);
  expect(Math.hypot(pointAt(s, edge.a).x - pointAt(s, edge.b).x, pointAt(s, edge.a).y - pointAt(s, edge.b).y)).toBeCloseTo(size, 3);
});

test('OPEN-14: in Move/Copy a spline point shows its manipulators, a second click hides them, and a handle drags', async ({ page }) => {
  const u = await start(page);
  await spline(u, 'Fit Point Spline', [{ x: -40, y: 0 }, { x: -10, y: 25 }, { x: 20, y: 5 }, { x: 45, y: 30 }]);
  await u.page.mouse.move(5, 5);
  await menu(u, 'modify', 'Move/Copy');
  await u.page.mouse.move(5, 5);
  const box = { x: 400, y: 200, width: 600, height: 500 };
  const look = async (): Promise<Buffer> => {
    await u.page.mouse.move(5, 5);
    await u.settle();
    return page.screenshot({ clip: box });
  };
  const hidden = await look();
  await u.click({ x: -10, y: 25 });
  const shown = await look();
  expect(shown.equals(hidden)).toBe(false);
  await expect(dialog(u, 'Move/Copy').locator('[data-field="Objects"] .select-count')).not.toContainText('1 selected');
  await u.click({ x: -10, y: 25 });
  expect((await look()).equals(hidden)).toBe(true);
  await u.click({ x: -10, y: 25 });

  // The handle is drawn green: find its far end on the canvas and drag it.
  const at = await u.screen({ x: -10, y: 25 });
  const tip = await page.evaluate(([cx, cy]) => {
    const c = document.querySelector('canvas.canvas') as HTMLCanvasElement;
    const box = c.getBoundingClientRect();
    const scale = c.width / box.width;
    const data = (c.getContext('2d') as CanvasRenderingContext2D).getImageData((cx - box.left - 90) * scale, (cy - box.top - 90) * scale, 180 * scale, 180 * scale);
    let best = { x: 0, y: 0, r: 0 };
    for (let y = 0; y < data.height; y++) {
      for (let x = 0; x < data.width; x++) {
        const i = (y * data.width + x) * 4;
        if (Math.abs(data.data[i] - 26) > 10 || Math.abs(data.data[i + 1] - 158) > 10 || Math.abs(data.data[i + 2] - 75) > 10) continue;
        const r = Math.hypot(x / scale - 90, y / scale - 90);
        if (r > best.r && r < 90) best = { x: cx - 90 + x / scale, y: cy - 90 + y / scale, r };
      }
    }
    return best;
  }, [at.x, at.y]);
  expect(tip.r).toBeGreaterThan(5);
  const [dx, dy] = [(tip.x - at.x) / tip.r, (tip.y - at.y) / tip.r];
  await page.mouse.move(tip.x - dx * 3, tip.y - dy * 3, { steps: 2 });
  await u.settle();
  await page.mouse.down();
  await page.mouse.move(at.x - dy * 40, at.y + dx * 40, { steps: 6 });
  await u.settle();
  await page.mouse.up();
  await u.settle();
  const [sp] = (await u.curves('fitSpline')) as FitSpline[];
  expect(sp.handles[1]).not.toBeNull();
  await page.locator('.dialog .btn:has-text("Cancel")').click();
});

test('OPEN-15: Spline Degree has its two icons, and Setup Curvature Display is a dialog', async ({ page }) => {
  const u = await start(page);
  await menu(u, 'create', 'Control Point Spline', 'Spline');
  await expect(page.locator('.degree-btn')).toHaveCount(2);
  await page.locator('.degree-btn[aria-label="Degree 3"]').click();
  for (const p of [{ x: -40, y: 0 }, { x: -10, y: 25 }, { x: 20, y: 5 }, { x: 45, y: 30 }]) await u.click(p);
  await u.press('Enter');
  await exitTool(u);
  const [sp] = await u.curves('controlSpline');
  expect((sp as ControlSpline).degree).toBe(3);
  await u.rightClick({ x: -40, y: 0 });
  await page.locator('.marking-list [data-item="spline-comb-setup"]').click();
  const d = dialog(u, 'Setup Curvature Display');
  await expect(rowOf(d, 'Density').locator('input')).toHaveCount(1);
  await expect(rowOf(d, 'Scale').locator('input')).toHaveCount(1);
  await ok(u, d);
});

test('OPEN-18: exploding text says it is fixed, and a referenced text parameter survives', async ({ page }) => {
  const u = await start(page);
  await text(u, { x: -60, y: 30 }, { x: 0, y: 50 }, 'Hi');
  await text(u, { x: -60, y: -20 }, { x: 20, y: 0 }, 'X={Text1_text}');
  const [first, second] = await ids(u, 'text');
  await u.rightClick({ x: -56, y: 34 });
  await page.locator('.marking-list [data-item="explode-text"]').click();
  await u.settle();
  expect(await note(u)).toContain('Fix/UnFix');
  expect((await u.sketch()).curves[first]).toBeUndefined();
  const outlines = (id: string, t?: string) => page.evaluate(([c, v]) => window.__sketch.textOutlines(c as string, v), [id, t]);
  expect(await outlines(second)).toEqual(await outlines(second, 'X=Hi'));
});

test('OPEN-19: the Equal badge sits on a circle\'s rim', async ({ page }) => {
  const u = await start(page);
  await u.press('c');
  await u.click({ x: -30, y: 10 });
  await u.click({ x: -15, y: 10 });
  await u.click({ x: 30, y: 10 });
  await u.click({ x: 45, y: 10 });
  await exitTool(u);
  await menu(u, 'constraints', 'Equal');
  await u.click({ x: -15, y: 10 });
  await u.click({ x: 45, y: 10 });
  await exitTool(u);
  const s = await u.sketch();
  const circles = Object.values(s.curves).filter((c): c is Circle => c.type === 'circle');
  const badges = (await page.evaluate(() => window.__sketch.badges())).filter((b) => b.type === 'equal');
  expect(badges.length).toBe(2);
  const canvas = (await page.locator('canvas.canvas').boundingBox()) as { x: number; y: number };
  const screens = await Promise.all(circles.map(async (c) => ({ at: await u.screen(pointAt(s, c.c)), rim: Math.abs((await u.screen({ x: pointAt(s, c.c).x + c.r, y: 0 })).x - (await u.screen({ x: pointAt(s, c.c).x, y: 0 })).x) })));
  for (const b of badges) {
    const gaps = screens.map((c) => Math.abs(Math.hypot(b.x + canvas.x - c.at.x, b.y + canvas.y - c.at.y) - c.rim));
    expect(Math.min(...gaps)).toBeLessThan(2);
  }
});

test('OPEN-20: Tangent between a spline and a line it does not touch says why', async ({ page }) => {
  const u = await start(page);
  await spline(u, 'Fit Point Spline', [{ x: -40, y: 0 }, { x: -10, y: 25 }, { x: 20, y: 5 }]);
  await line(u, { x: 40, y: 40 }, { x: 80, y: 40 });
  await menu(u, 'constraints', 'Tangent');
  await u.click({ x: 60, y: 40 });
  // Just off a fit point, so the pick lands on the curve and not on the point.
  await u.click({ x: -38.6, y: 1.55 });
  expect(await note(u)).toContain('at its end');
  await exitTool(u);
});

test('OPEN-21: the Undo button names what it would undo', async ({ page }) => {
  const u = await start(page);
  await line(u, { x: 0, y: 0 }, { x: 40, y: 10 });
  await expect(page.locator('.icon-btn[aria-label="Undo"]')).toHaveAttribute('title', 'Undo Line');
});

test('OPEN-24: an offset shows its glyph on the original and on the output', async ({ page }) => {
  const u = await start(page);
  await line(u, { x: -40, y: 0 }, { x: 40, y: 0 });
  await u.tool('Offset');
  await u.click({ x: 0, y: 0 });
  await u.move({ x: 0, y: 10 });
  const d = dialog(u, 'Offset');
  await d.locator('.btn.primary').hover();
  await page.keyboard.press('Enter');
  await u.settle();
  expect((await page.evaluate(() => window.__sketch.badges())).filter((b) => b.type === 'offset').length).toBe(2);
});

test('OPEN-25: the palette lists Normal/Construction for a selected spline; the right-click lists work there too', async ({ page }) => {
  const u = await start(page);
  await spline(u, 'Fit Point Spline', [{ x: -40, y: 0 }, { x: -10, y: 25 }, { x: 20, y: 5 }]);
  await page.keyboard.press('ControlOrMeta+a');
  await u.settle();
  await expect(page.locator('.palette-row', { hasText: 'Normal/Construction' })).toHaveCount(1);
  await page.locator('.palette-row', { hasText: 'Normal/Construction' }).locator('button').click();
  await u.settle();
  expect((await u.curves('fitSpline'))[0].lineType).toBe('construction');
  await u.rightClick({ x: 70, y: 70 });
  await page.locator('.marking-list [data-item="menu-finish"]').click();
  await u.settle();
  expect(await page.evaluate(() => window.__sketch.mode)).toBe('design');
  await u.rightClick({ x: 70, y: 70 });
  await expect(page.locator('.marking-list [data-item="menu-sketch"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
});

test('OPEN-26: where the browser allows it, saving can ask for a location', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { saved: string[]; showSaveFilePicker: unknown }).saved = [];
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async (o: { suggestedName: string }) => ({
      createWritable: async () => ({
        write: async (t: string) => { (window as unknown as { saved: string[] }).saved.push(`${o.suggestedName}:${t.length}`); },
        close: async () => undefined,
      }),
    });
  });
  const u = await start(page);
  await line(u, { x: 0, y: 0 }, { x: 40, y: 0 });
  await page.locator('.sketch-row').first().click({ button: 'right' });
  await page.locator('.popup-menu [data-item="Save as SVG"]').click();
  await ok(u, dialog(u, 'Save as SVG'));
  const d = dialog(u, 'Save SVG');
  await rowOf(d, 'Choose Location').locator('input').check();
  await ok(u, d);
  await page.waitForFunction(() => (window as unknown as { saved: string[] }).saved.length > 0);
});

test('OPEN-29: the + beside the design name starts a new design', async ({ page }) => {
  const u = await start(page);
  await line(u, { x: 0, y: 0 }, { x: 40, y: 0 });
  await page.getByRole('button', { name: 'New Design' }).click();
  await u.page.locator('[data-dialog="Unsaved Changes"]').getByRole('button', { name: "Don't Save" }).click();
  await u.settle();
  expect(Object.keys((await u.design()).sketches).length).toBe(0);
});

test('OPEN-30: a 500 mm line typed in at the default zoom comes into view', async ({ page }) => {
  const u = await start(page);
  await u.press('l');
  await u.click({ x: 0, y: 0 });
  await u.move({ x: 60, y: 0 });
  await u.type('500');
  await u.press('Enter');
  await exitTool(u);
  const s = await u.sketch();
  const l = Object.values(s.curves)[0] as Line;
  expect(Math.abs(pointAt(s, l.b).x)).toBeCloseTo(500, 3);
  const end = await u.screen(pointAt(s, l.b));
  const box = (await page.locator('canvas.canvas').boundingBox()) as { width: number; height: number };
  expect(end.x).toBeGreaterThan(0);
  expect(end.x).toBeLessThan(box.width);
});

test('OPEN-31: a circle rim clicked on an axis keeps no rim point', async ({ page }) => {
  const u = await start(page);
  await u.press('c');
  await u.click({ x: 40, y: 15 });
  await u.click({ x: 49, y: 0 });
  await exitTool(u);
  const s = await u.sketch();
  expect(Object.keys(s.points).length).toBe(1);
  expect(Object.keys(s.constraints).length).toBe(0);
});

test.describe('Prompts go with the tool', () => {
  const STEPS: [string, () => (u: SketchUser) => Promise<void>][] = [
    ['Center Diameter Circle', () => (u) => menu(u, 'create', 'Center Diameter Circle', 'Circle')],
    ['Line', () => (u) => u.press('l')],
    ['2-Point Rectangle', () => (u) => u.press('r')],
    ['Ellipse', () => (u) => menu(u, 'create', 'Ellipse')],
    ['Tangent', () => (u) => menu(u, 'constraints', 'Tangent')],
    ['Sketch Dimension', () => (u) => u.press('d')],
  ];
  for (const [name, open] of STEPS) {
    test(`${name}: Escape twice clears the prompt at the cursor with no mouse move`, async ({ page }) => {
      const u = await start(page);
      await open()(u);
      await u.move({ x: 10, y: 10 });
      await expect(page.locator('.cursor-tip')).toBeVisible();
      await u.click({ x: 10, y: 10 });
      await u.press('Escape');
      await u.press('Escape');
      await u.settle();
      await expect(page.locator('.cursor-tip')).toBeHidden();
      await expect(page.locator('.hud-field')).toHaveCount(0);
      expect(await page.evaluate(() => window.__sketch.tool)).toBe('select');
    });
  }

  test('one Escape at a later step shows the first step\'s prompt straight away', async ({ page }) => {
    const u = await start(page);
    await menu(u, 'create', 'Center Diameter Circle', 'Circle');
    await u.move({ x: 10, y: 10 });
    await u.click({ x: 10, y: 10 });
    await u.move({ x: 20, y: 10 });
    await expect(page.locator('.cursor-tip')).toContainText('type the diameter');
    await u.press('Escape');
    await expect(page.locator('.cursor-tip')).not.toContainText('type the diameter');
    await expect(page.locator('.cursor-tip')).toBeVisible();
  });
});
