// Layers, through real mouse and keyboard. Results are read back from the read-only window.__sketch.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { constraintsOfType, pointAt, SketchUser, type Xy } from './helpers';
import type { Circle, Constraint, Design, Id, Line, Sketch } from '../src/model/types';

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

const row = (u: SketchUser, name: string): Locator => u.page.locator('.layer-row', { hasText: name });
const eye = (u: SketchUser, name: string): Locator => row(u, name).locator('.layer-eye');
const lock = (u: SketchUser, name: string): Locator => row(u, name).locator('.layer-lock');

async function addLayer(u: SketchUser, name?: string, color?: string): Promise<void> {
  await u.page.locator('[data-action="add-layer"]').click();
  await u.settle();
  const added = u.page.locator('.layer-row.active');
  if (name) {
    await added.locator('.layer-name').dblclick();
    await added.locator('.layer-rename').fill(name);
    await u.page.keyboard.press('Enter');
    await u.settle();
  }
  if (color) await u.page.locator('.layer-row.active .layer-swatch').fill(color);
  await u.settle();
}

const activate = async (u: SketchUser, name: string): Promise<void> => {
  await row(u, name).locator('.layer-name').click();
  await u.settle();
};

async function line(u: SketchUser, a: Xy, b: Xy): Promise<Line> {
  const before = new Set((await u.lines()).map((l) => l.id));
  await u.press('l');
  await u.click(a);
  await u.click(b);
  await exitTool(u);
  return (await u.lines()).find((l) => !before.has(l.id)) as Line;
}

async function circle(u: SketchUser, c: Xy, r: number): Promise<Circle> {
  await u.press('c');
  await u.click(c);
  await u.click({ x: c.x + r, y: c.y });
  await exitTool(u);
  return (await u.curves('circle')).at(-1) as Circle;
}

const mid = (a: Xy, b: Xy, t = 0.5): Xy => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const note = (u: SketchUser): Promise<string> => u.page.evaluate(() => window.__sketch.note);
const selection = (u: SketchUser): Promise<Id[]> => u.page.evaluate(() => window.__sketch.selection);
const look = (u: SketchUser, id: Id) => u.page.evaluate((c) => window.__sketch.appearance(c), id);
const layersOf = async (u: SketchUser) => (await u.design()).layers;
const layerId = async (u: SketchUser, name: string): Promise<Id> => (await layersOf(u)).find((l) => l.name === name)?.id as Id;
const cross = (s: Sketch): Constraint[] => Object.values(s.constraints).filter((k) => k.dependentLayer);

async function setPalette(u: SketchUser, label: string, on: boolean): Promise<void> {
  const box = u.page.locator('.palette-row', { hasText: label }).locator('input');
  if (on) await box.check();
  else await box.uncheck();
  await u.settle();
}

/** A menu entry from the right-click list. */
async function menuItem(u: SketchUser, at: Xy, item: string): Promise<void> {
  await u.rightClick(at);
  await u.page.locator('.marking-list .menu-item', { hasText: item }).first().click();
  await u.settle();
}

// ---------------------------------------------------------------------------
// The panel

test.describe('panel', () => {
  test('add, rename inline, colour, eye, lock, click to activate: each undoable and saved', async ({ page }) => {
    const u = await start(page);
    await expect(page.locator('.layer-row')).toHaveCount(1);
    await expect(page.locator('.layer-row.active')).toContainText('Layer 1');

    await addLayer(u, 'Holes', '#ff0000');
    await expect(page.locator('.layer-row')).toHaveCount(2);
    await expect(page.locator('.layer-row').first()).toContainText('Holes');
    await expect(page.locator('.layer-row.active')).toContainText('Holes');
    let d: Design = await u.design();
    expect(d.layers.map((l) => [l.name, l.color])).toEqual([['Holes', '#ff0000'], ['Layer 1', '#5f7186']]);
    expect(d.activeLayer).toBe(d.layers[0].id);

    await activate(u, 'Layer 1');
    await expect(page.locator('.layer-row.active')).toContainText('Layer 1');
    await eye(u, 'Holes').click();
    await lock(u, 'Holes').click();
    await u.settle();
    d = await u.design();
    expect(d.layers[0]).toMatchObject({ visible: false, locked: true });
    await expect(row(u, 'Holes').locator('.layer-eye')).toHaveAttribute('aria-label', 'Show Holes');
    await expect(row(u, 'Holes').locator('.layer-lock')).toHaveAttribute('aria-label', 'Unlock Holes');

    // Saved with the design.
    await page.evaluate(() => window.__sketch.flushAutosave());
    await page.reload();
    await page.waitForFunction(() => !!window.__sketch);
    await expect(page.locator('.layer-row')).toHaveCount(2);
    expect((await u.design()).layers[0]).toMatchObject({ name: 'Holes', color: '#ff0000', visible: false, locked: true });

    // Undoable, one step each.
    await lock(u, 'Holes').click();
    await u.press('Control+z');
    expect((await u.design()).layers[0].locked).toBe(true);
    await u.press('Control+Shift+z');
    expect((await u.design()).layers[0].locked).toBe(false);
  });

  test('add, rename, colour, activate and delete undo one by one', async ({ page }) => {
    const u = await start(page);
    await page.locator('[data-action="add-layer"]').click();
    await u.settle();
    expect((await layersOf(u)).length).toBe(2);
    await u.press('Control+z');
    expect((await layersOf(u)).length).toBe(1);
    expect((await u.design()).activeLayer).toBe((await layersOf(u))[0].id);
    await u.press('Control+Shift+z');
    expect((await layersOf(u)).length).toBe(2);
    await row(u, 'Layer 2').locator('.layer-name').dblclick();
    await page.locator('.layer-rename').fill('Renamed');
    await page.keyboard.press('Enter');
    await u.settle();
    expect((await layersOf(u))[0].name).toBe('Renamed');
    await u.press('Control+z');
    expect((await layersOf(u))[0].name).toBe('Layer 2');
  });

  test('a rename cancelled with Esc changes nothing', async ({ page }) => {
    const u = await start(page);
    await row(u, 'Layer 1').locator('.layer-name').dblclick();
    await page.locator('.layer-rename').fill('Nope');
    await page.keyboard.press('Escape');
    await u.settle();
    expect((await layersOf(u))[0].name).toBe('Layer 1');
    expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(true); // Create Sketch
  });

  test('drag to reorder, both ways, and the top of the list draws last', async ({ page }) => {
    const u = await start(page);
    await addLayer(u, 'B');
    await addLayer(u, 'C');
    const names = async (): Promise<string[]> => (await layersOf(u)).map((l) => l.name);
    expect(await names()).toEqual(['C', 'B', 'Layer 1']);
    const dragTo = async (from: string, to: string, after: boolean): Promise<void> => {
      const a = await row(u, from).locator('.layer-name').boundingBox();
      const b = await row(u, to).boundingBox();
      if (!a || !b) throw new Error('no row');
      await page.mouse.move(a.x + 5, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + 5, b.y + (after ? b.height - 2 : 2), { steps: 6 });
      await page.mouse.up();
      await u.settle();
    };
    await dragTo('C', 'Layer 1', true);
    expect(await names()).toEqual(['B', 'Layer 1', 'C']);
    await dragTo('C', 'B', false);
    expect(await names()).toEqual(['C', 'B', 'Layer 1']);
    await dragTo('Layer 1', 'B', false);
    expect(await names()).toEqual(['C', 'Layer 1', 'B']);
    // A drag is not a click: the active layer stayed.
    await expect(page.locator('.layer-row.active')).toContainText('C');
    await u.press('Control+z');
    expect(await names()).toEqual(['C', 'B', 'Layer 1']);
  });

  test('deleting sends geometry to the layer below; the last layer cannot go', async ({ page }) => {
    const u = await start(page);
    await addLayer(u, 'Top');
    const l = await line(u, { x: 10, y: 10 }, { x: 40, y: 25 });
    await row(u, 'Top').locator('.layer-delete').click();
    await u.settle();
    const d = await u.design();
    expect(d.layers.map((x) => x.name)).toEqual(['Layer 1']);
    expect(d.activeLayer).toBe(d.layers[0].id);
    expect((await u.sketch()).curves[l.id].layer).toBe(d.layers[0].id);
    await expect(row(u, 'Layer 1').locator('.layer-delete')).toBeDisabled();
    await u.press('Control+z');
    expect((await u.sketch()).curves[l.id].layer).toBe(await layerId(u, 'Top'));
  });

  test('Move to Layer from the right-click menu takes the selection and undoes', async ({ page }) => {
    const u = await start(page);
    const a = await line(u, { x: 10, y: 10 }, { x: 40, y: 25 });
    const b = await line(u, { x: 10, y: 40 }, { x: 40, y: 55 });
    await addLayer(u, 'Target');
    await activate(u, 'Layer 1');
    await u.click(mid({ x: 10, y: 10 }, { x: 40, y: 25 }));
    await u.click(mid({ x: 10, y: 40 }, { x: 40, y: 55 }), { shift: true });
    expect(await selection(u)).toHaveLength(2);
    await menuItem(u, mid({ x: 10, y: 10 }, { x: 40, y: 25 }), 'Move to Target');
    const target = await layerId(u, 'Target');
    const s = await u.sketch();
    expect(s.curves[a.id].layer).toBe(target);
    expect(s.curves[b.id].layer).toBe(target);
    expect(await selection(u)).toEqual([]);
    await u.press('Control+z');
    expect((await u.sketch()).curves[a.id].layer).toBe(await layerId(u, 'Layer 1'));
  });

  test('Move to Layer from a right-click with nothing selected takes what is under the cursor, and refuses a locked target', async ({ page }) => {
    const u = await start(page);
    const a = await line(u, { x: 10, y: 10 }, { x: 40, y: 25 });
    await addLayer(u, 'Target');
    await lock(u, 'Target').click();
    await activate(u, 'Layer 1');
    await menuItem(u, mid({ x: 10, y: 10 }, { x: 40, y: 25 }), 'Move to Target');
    expect(await note(u)).toContain('locked');
    expect((await u.sketch()).curves[a.id].layer).toBe(await layerId(u, 'Layer 1'));
    await lock(u, 'Target').click();
    await menuItem(u, mid({ x: 10, y: 10 }, { x: 40, y: 25 }), 'Move to Target');
    expect((await u.sketch()).curves[a.id].layer).toBe(await layerId(u, 'Target'));
  });

  test('moving part of a constrained pair turns the constraint cross-layer, owned where it was', async ({ page }) => {
    const u = await start(page);
    const a = await line(u, { x: 10, y: 10 }, { x: 40, y: 25 });
    await u.press('l');
    await u.click({ x: 40, y: 25 });
    await u.click({ x: 60, y: 60 });
    await exitTool(u);
    await addLayer(u, 'Target');
    await activate(u, 'Layer 1');
    await menuItem(u, mid({ x: 10, y: 10 }, { x: 40, y: 25 }), 'Move to Target');
    const s = await u.sketch();
    expect(s.curves[a.id].layer).toBe(await layerId(u, 'Target'));
    expect(cross(s).map((k) => k.dependentLayer)).toEqual([await layerId(u, 'Layer 1')]);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('an old saved design opens on a default Layer 1 and looks as it did', async ({ page }) => {
    const u = new SketchUser(page);
    await u.open();
    const v1 = {
      version: 1, name: 'Old', order: ['s1'], parameters: [], units: 'mm', nextId: 20,
      sketches: {
        s1: {
          id: 's1', name: 'Sketch1', plane: 'XY', visible: true,
          points: { p1: { id: 'p1', x: 10, y: 10, owner: 'l1' }, p2: { id: 'p2', x: 40, y: 25, owner: 'l1' } },
          curves: { l1: { id: 'l1', type: 'line', lineType: 'normal', a: 'p1', b: 'p2' } },
          constraints: {}, dimensions: {}, features: {},
        },
      },
    };
    await page.evaluate((text) => localStorage.setItem('sketch.autosave', text), JSON.stringify(v1));
    await page.reload();
    await page.waitForFunction(() => !!window.__sketch);
    await page.locator('.sketch-row').dblclick();
    await u.settle();
    const d = await u.design();
    expect(d.version).toBe(3);
    expect(d.layers.map((l) => l.name)).toEqual(['Layer 1']);
    expect((await u.sketch()).curves.l1.layer).toBe(d.layers[0].id);
    expect(await look(u, 'l1')).toMatchObject({ color: '#0a84d6' });
  });
});

// ---------------------------------------------------------------------------
// Only the active layer can be edited

test.describe('template geometry', () => {
  const A = { x: 10, y: 10 };
  const B = { x: 40, y: 25 };

  async function template(u: SketchUser): Promise<Line> {
    const l = await line(u, A, B);
    await addLayer(u, 'Work');
    return l;
  }

  test('clicks pass through it: no hover, no selection, no drag', async ({ page }) => {
    const u = await start(page);
    const t = await template(u);
    await u.move(mid(A, B));
    await u.settle();
    await u.click(mid(A, B));
    expect(await selection(u)).toEqual([]);
    await u.click(A);
    expect(await selection(u)).toEqual([]);
    await u.drag(mid(A, B), { x: 70, y: 70 });
    await u.drag(A, { x: 70, y: 70 });
    const s = await u.sketch();
    expect(pointAt(s, t.a)).toMatchObject(A);
    expect(pointAt(s, t.b)).toMatchObject(B);
    expect(await selection(u)).toEqual([]);
  });

  test('a click on it goes through to active geometry underneath', async ({ page }) => {
    const u = await start(page);
    await template(u);
    const w = await line(u, { x: 10, y: 40 }, { x: 60, y: 15 });
    // Where the two cross, the pick is the work line, whichever is nearer.
    const t = 30 / 50;
    await u.click({ x: 10 + 50 * t, y: 40 - 25 * t });
    expect(await selection(u)).toEqual([w.id]);
  });

  test('window, crossing, Select All and chain select ignore it', async ({ page }) => {
    const u = await start(page);
    await template(u);
    const w = await line(u, { x: 10, y: 40 }, { x: 40, y: 55 });
    // A chain running from the work line onto a template end stops at the layer.
    await u.drag({ x: 0, y: 0 + 70 }, { x: 60, y: 2 });
    expect(await selection(u)).toEqual([w.id]);
    await u.press('Escape');
    await u.drag({ x: 60, y: 2 }, { x: 0, y: 70 });
    expect(await selection(u)).toEqual([w.id]);
    await u.press('Escape');
    await u.press('Control+a');
    expect(await selection(u)).toEqual([w.id]);
    await u.press('Escape');
    await u.press('l');
    await u.click({ x: 40, y: 55 });
    await u.click(B);
    await exitTool(u);
    await u.doubleClick({ x: 15, y: 42.5 });
    const s = await u.sketch();
    const here = await layerId(u, 'Work');
    for (const id of await selection(u)) expect(s.curves[id].layer).toBe(here);
    expect((await selection(u)).length).toBe(2);
  });

  test('it cannot be deleted, trimmed, filleted or dimensioned on its own', async ({ page }) => {
    const u = await start(page);
    const t = await template(u);
    const w = await line(u, { x: 10, y: 40 }, { x: 60, y: 15 });
    await u.click(mid(A, B));
    await u.press('Delete');
    expect((await u.sketch()).curves[t.id]).toBeTruthy();

    await u.press('t');
    await u.click({ x: 15, y: 12.5 });
    await exitTool(u);
    let s = await u.sketch();
    expect(pointAt(s, (s.curves[t.id] as Line).a)).toMatchObject(A);
    expect(Object.keys(s.curves)).toHaveLength(2);

    await u.tool('Fillet');
    await u.click(A);
    await exitTool(u);
    s = await u.sketch();
    expect((await u.curves('arc')).length).toBe(0);

    // Trimming the active line against it is fine: it cuts, and stays.
    await u.press('t');
    await u.click({ x: 58, y: 16 });
    await exitTool(u);
    s = await u.sketch();
    expect(pointAt(s, (s.curves[t.id] as Line).a)).toMatchObject(A);
    expect(s.curves[w.id]).toBeTruthy();
  });

  test('right-click on it offers nothing that would edit it', async ({ page }) => {
    const u = await start(page);
    const t = await template(u);
    await u.rightClick(mid(A, B));
    await expect(page.locator('[data-id="delete"], .marking-item[data-item="Delete"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect((await u.sketch()).curves[t.id]).toBeTruthy();
  });

  test('it can be snapped to, and picked up from', async ({ page }) => {
    const u = await start(page);
    const t = await template(u);
    await u.press('l');
    await u.move(B);
    await u.settle();
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).toBe('point');
    await u.click(B);
    await u.click({ x: 70, y: 30 });
    await exitTool(u);
    const s = await u.sketch();
    const k = cross(s)[0];
    expect(k.type).toBe('coincident');
    expect(k.refs).toContain(t.b);
    expect(k.dependentLayer).toBe(await layerId(u, 'Work'));
    expect(pointAt(s, t.b)).toMatchObject(B);
  });

  test('a new line can end on a point along it, or at its midpoint, and it stays put', async ({ page }) => {
    const u = await start(page);
    const t = await template(u);
    await u.press('l');
    await u.click({ x: 20, y: 60 });
    await u.click(mid(A, B));
    await exitTool(u);
    const s = await u.sketch();
    expect(cross(s).map((k) => k.type)).toEqual(['midpoint']);
    expect(pointAt(s, t.a)).toMatchObject(A);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('AutoConstrain ties down the active layer only', async ({ page }) => {
    const u = await start(page);
    const t = await template(u);
    await line(u, { x: 10, y: 40 }, { x: 40, y: 55 });
    await line(u, { x: 40, y: 55 }, { x: 70, y: 40 });
    await page.locator('.palette-link', { hasText: 'AutoConstrain' }).click();
    await u.settle();
    const d = page.locator('.dialog[data-dialog="AutoConstrain"]');
    await expect(d.locator('.auto-tile').first()).toBeVisible();
    await d.getByRole('button', { name: 'OK' }).click();
    await u.settle();
    const s = await u.sketch();
    const all = [...Object.values(s.constraints), ...Object.values(s.dimensions)];
    expect(all.length).toBeGreaterThan(1);
    expect(all.filter((k) => k.refs.some((r) => [t.id, t.a, t.b].includes(r)))).toEqual([]);
    expect(pointAt(s, t.a)).toMatchObject(A);
  });

  test('Find Under-Constrained lists only the active layer', async ({ page }) => {
    const u = await start(page);
    await template(u);
    const w = await line(u, { x: 10, y: 40 }, { x: 40, y: 55 });
    await page.locator('.palette-link', { hasText: 'Find Under-Constrained' }).click();
    await u.settle();
    await expect(page.locator('.finder-row')).toHaveCount(1);
    await expect(page.locator('.finder-row')).toContainText(w.id);
  });
});

// ---------------------------------------------------------------------------
// Lock

test.describe('lock', () => {
  const A = { x: 10, y: 10 };
  const B = { x: 40, y: 25 };

  test('blocks selection, editing and drawing on the active layer with a message', async ({ page }) => {
    const u = await start(page);
    const l = await line(u, A, B);
    await u.click(mid(A, B));
    expect(await selection(u)).toEqual([l.id]);
    await lock(u, 'Layer 1').click();
    await u.settle();
    expect(await selection(u)).toEqual([]);
    await u.click(mid(A, B));
    expect(await selection(u)).toEqual([]);
    expect(await note(u)).toContain('locked');

    await u.drag(mid(A, B), { x: -40, y: 70 });
    expect(pointAt(await u.sketch(), l.a)).toMatchObject(A);

    await u.press('Control+a');
    expect(await selection(u)).toEqual([]);

    await u.press('l');
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('select');
    expect(await note(u)).toContain('locked');
    await u.click({ x: 60, y: 60 });
    expect(Object.keys((await u.sketch()).curves)).toHaveLength(1);

    await u.press('x');
    await u.press('Delete');
    expect((await u.sketch()).curves[l.id].lineType).toBe('normal');
  });

  test('locking the active layer ends a running tool', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click(A);
    await lock(u, 'Layer 1').click();
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('select');
    expect(Object.keys((await u.sketch()).curves)).toHaveLength(0);
  });

  test('a locked layer can still be snapped to and stays put', async ({ page }) => {
    const u = await start(page);
    const t = await line(u, A, B);
    await addLayer(u, 'Work');
    await lock(u, 'Layer 1').click();
    await u.settle();
    await u.press('l');
    await u.click(B);
    await u.click({ x: 70, y: 30 });
    await exitTool(u);
    const s = await u.sketch();
    expect(cross(s)).toHaveLength(1);
    expect(pointAt(s, t.b)).toMatchObject(B);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('locking cannot make a sketch look constrained: dof and Status read as if nothing were held', async ({ page }) => {
    const u = await start(page);
    const l = await line(u, A, B);
    const free = await u.analysis();
    await expect.poll(() => u.statusLine()).toContain('Under-Constrained');
    await lock(u, 'Layer 1').click();
    await page.locator('.palette-link', { hasText: 'Compute Sketch' }).click();
    await u.settle();
    const held = await u.analysis();
    expect(held.dof).toBe(free.dof);
    expect(held.freeCurves).toEqual(free.freeCurves);
    expect(await u.statusLine()).toContain('Under-Constrained');
    // The status colour too: free blue, not black.
    expect(await look(u, l.id)).toMatchObject({ color: '#0a84d6' });
  });

  test('a second layer locked: dof still counts it, however it is held', async ({ page }) => {
    const u = await start(page);
    await line(u, A, B);
    await addLayer(u, 'Work');
    await line(u, { x: 10, y: 40 }, { x: 40, y: 55 });
    const before = (await u.analysis()).dof;
    expect(before).toBe(8);
    await lock(u, 'Layer 1').click();
    await page.locator('.palette-link', { hasText: 'Compute Sketch' }).click();
    await u.settle();
    expect((await u.analysis()).dof).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Hidden

test.describe('hidden layer', () => {
  const A = { x: 10, y: 10 };
  const B = { x: 40, y: 25 };

  test('is not drawn, not hit and not snapped', async ({ page }) => {
    const u = await start(page);
    const t = await line(u, A, B);
    await page.locator('.layer-row', { hasText: 'Layer 1' }).locator('.layer-eye').click();
    expect(await note(u)).toContain('another layer active');
    await addLayer(u, 'Work');
    await eye(u, 'Layer 1').click();
    await u.settle();
    expect(await look(u, t.id)).toBeNull();
    await u.press('l');
    await u.move(B);
    await u.settle();
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).not.toBe('point');
    await u.click(B);
    await u.click({ x: 70, y: 30 });
    await exitTool(u);
    const s = await u.sketch();
    expect(cross(s)).toEqual([]);
    expect(Object.keys(s.constraints)).toHaveLength(0);
    await u.press('Control+a');
    expect((await selection(u))).not.toContain(t.id);
  });

  test('an explicit point on it is not snapped to', async ({ page }) => {
    const u = await start(page);
    await page.getByRole('button', { name: /^CREATE/ }).click();
    await page.locator('.menu-item[data-item="Point"]').click();
    await u.settle();
    await u.click({ x: 30, y: 30 });
    await exitTool(u);
    await addLayer(u, 'Work');
    await eye(u, 'Layer 1').click();
    await u.settle();
    await u.press('l');
    await u.move({ x: 30, y: 30 });
    await u.settle();
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).not.toBe('point');
  });

  test('trim does not cut against it', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 30, y: 10 }, { x: 30, y: 50 });
    await addLayer(u, 'Work');
    const w = await line(u, { x: 10, y: 22 }, { x: 60, y: 37 });
    await eye(u, 'Layer 1').click();
    await u.settle();
    await u.press('t');
    await u.click({ x: 20, y: 25 });
    await exitTool(u);
    expect((await u.sketch()).curves[w.id]).toBeUndefined();
  });

  test('stays in the solver: hiding changes no geometry, and it still follows', async ({ page }) => {
    const u = await start(page);
    const a = await line(u, A, B);
    await addLayer(u, 'Dep');
    await u.press('l');
    await u.click(B);
    await u.click({ x: 70, y: 40 });
    await exitTool(u);
    const dep = (await u.lines()).find((l) => l.id !== a.id) as Line;
    await activate(u, 'Layer 1');
    const before = await u.sketch();
    const dof = (await u.analysis()).dof;
    await eye(u, 'Dep').click();
    await page.locator('.palette-link', { hasText: 'Compute Sketch' }).click();
    await u.settle();
    const after = await u.sketch();
    expect(after.points).toEqual(before.points);
    expect((await u.analysis()).dof).toBe(dof);

    await u.drag(B, { x: 45, y: 35 });
    const moved = await u.sketch();
    expect(moved.points[dep.a].x).toBeCloseTo(45, 3);
    expect(moved.points[dep.a].y).toBeCloseTo(35, 3);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Colour

test.describe('colour', () => {
  const FREE = '#0a84d6';
  const ORANGE = '#e8730c';

  test('a single layer looks as it always did, with every toggle at its default', async ({ page }) => {
    const u = await start(page);
    const free = await line(u, { x: 10, y: 10 }, { x: 40, y: 25 });
    await u.press('r');
    await u.click({ x: -60, y: 20 });
    await u.click({ x: -20, y: 45 });
    await exitTool(u);
    await page.locator('.type-btn[aria-label="Construction"]').click();
    await u.settle();
    await u.press('l');
    await u.click({ x: 10, y: 50 });
    await u.click({ x: 40, y: 65 });
    await exitTool(u);
    const dashed = (await u.lines()).at(-1) as Line;
    expect(await look(u, free.id)).toEqual({ color: FREE, width: 1.6, dash: [] });
    expect(await look(u, dashed.id)).toEqual({ color: ORANGE, width: 1.3, dash: [7, 5] });
    expect((await page.evaluate(() => window.__sketch.badges())).length).toBeGreaterThan(0);
    expect((await page.evaluate(() => window.__sketch.drawnPoints())).length).toBeGreaterThan(0);
  });

  test('Show Constrained Lines: on, the active layer has status colour and glyphs and other layers are plain', async ({ page }) => {
    const u = await start(page);
    await addLayer(u, 'Red', '#ff0000');
    await u.press('r');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 40, y: 30 });
    await exitTool(u);
    const red = await u.lines();
    const redBadges = (await page.evaluate(() => window.__sketch.badges())).length;
    expect(redBadges).toBeGreaterThan(0);
    await u.press('d');
    await u.click({ x: 25, y: 10 });
    await u.click({ x: 25, y: 0 + 2 });
    await page.keyboard.press('Enter');
    await u.settle();
    await exitTool(u);
    const redDims = await page.evaluate(() => window.__sketch.labels());
    expect(redDims).toHaveLength(1);
    await addLayer(u, 'Green', '#00aa00');
    const green = await line(u, { x: -60, y: 20 }, { x: -20, y: 45 });

    expect(await look(u, green.id)).toEqual({ color: FREE, width: 1.6, dash: [] });
    for (const l of red) expect(await look(u, l.id)).toEqual({ color: '#ff0000', width: 1.6, dash: [] });
    expect(await page.evaluate(() => window.__sketch.badges())).toEqual([]);
    expect(await page.evaluate(() => window.__sketch.labels())).toEqual([]);
    const dots = await page.evaluate(() => window.__sketch.drawnPoints());
    expect(dots.sort()).toEqual([green.a, green.b].sort());

    await activate(u, 'Red');
    expect(await look(u, green.id)).toEqual({ color: '#00aa00', width: 1.6, dash: [] });
    expect(await look(u, red[0].id)).toMatchObject({ color: FREE });
    expect((await page.evaluate(() => window.__sketch.badges())).length).toBe(redBadges);
    expect(await page.evaluate(() => window.__sketch.labels())).toEqual(redDims);
  });

  test('Show Constrained Lines off: every layer in its colour, dashes kept; hover, selection and red still show', async ({ page }) => {
    const u = await start(page);
    await addLayer(u, 'Red', '#ff0000');
    const a = await line(u, { x: 10, y: 10 }, { x: 40, y: 25 });
    await page.locator('.type-btn[aria-label="Construction"]').click();
    await u.settle();
    await u.press('l');
    await u.click({ x: 10, y: 50 });
    await u.click({ x: 40, y: 65 });
    await exitTool(u);
    await page.locator('.type-btn[aria-label="Construction"]').click();
    const dashed = (await u.lines()).at(-1) as Line;
    await addLayer(u, 'Blue', '#0000ff');
    const b = await line(u, { x: -60, y: 20 }, { x: -20, y: 45 });
    await setPalette(u, 'Show Constrained Lines', false);
    expect(await look(u, b.id)).toEqual({ color: '#0000ff', width: 1.6, dash: [] });
    expect(await look(u, a.id)).toEqual({ color: '#ff0000', width: 1.6, dash: [] });
    await setPalette(u, 'Construction: Active Layer Only', false);
    expect(await look(u, dashed.id)).toEqual({ color: '#ff0000', width: 1.3, dash: [7, 5] });

    // The active layer's glyphs and points are still there to work with.
    expect((await page.evaluate(() => window.__sketch.drawnPoints())).sort()).toEqual([b.a, b.b].sort());

    // Selection still shows, drawn over the layer colour, and the layer colour comes back.
    await u.click(mid({ x: -60, y: 20 }, { x: -20, y: 45 }));
    expect(await selection(u)).toEqual([b.id]);
  });

  test('a red conflict shows on the active layer with Show Constrained Lines off', async ({ page }) => {
    const u = await start(page);
    await addLayer(u, 'Blue', '#0000ff');
    const a = await line(u, { x: 10, y: 10 }, { x: 40, y: 30 });
    await setPalette(u, 'Show Constrained Lines', false);
    expect(await look(u, a.id)).toMatchObject({ color: '#0000ff' });
    // Fix the line, then an impossible horizontal between its ends.
    await u.click(mid({ x: 10, y: 10 }, { x: 40, y: 30 }));
    await u.tool('Fix/UnFix');
    await exitTool(u);
    await u.tool('Horizontal/Vertical');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 40, y: 30 });
    await exitTool(u);
    expect((await u.analysis()).unsatisfied.length).toBeGreaterThan(0);
    expect(await look(u, a.id)).toMatchObject({ color: '#d9272e' });
  });

  test('Construction: Active Layer Only hides it elsewhere, off shows it, and Show Construction still hides all', async ({ page }) => {
    const u = await start(page);
    await page.locator('.type-btn[aria-label="Construction"]').click();
    await u.settle();
    const c = await line(u, { x: 10, y: 10 }, { x: 40, y: 25 });
    await page.locator('.type-btn[aria-label="Centerline"]').click();
    await u.settle();
    const d = await line(u, { x: 10, y: 30 }, { x: 40, y: 45 });
    await page.locator('.type-btn[aria-label="Centerline"]').click();
    await u.settle();
    await addLayer(u, 'Work');
    const own = await line(u, { x: -60, y: 20 }, { x: -20, y: 45 });
    await page.locator('.type-btn[aria-label="Construction"]').click();
    await u.settle();
    const mine = await line(u, { x: -60, y: -20 }, { x: -20, y: -45 });

    expect(await look(u, c.id)).toBeNull();
    expect(await look(u, d.id)).toBeNull();
    expect(await look(u, mine.id)).not.toBeNull();
    expect(await page.locator('.palette-row', { hasText: 'Construction: Active Layer Only' }).locator('input').isChecked()).toBe(true);

    await setPalette(u, 'Construction: Active Layer Only', false);
    expect(await look(u, c.id)).toMatchObject({ dash: [7, 5], color: '#5f7186' });
    expect(await look(u, d.id)).toMatchObject({ dash: [14, 4, 3, 4] });

    await setPalette(u, 'Show Construction Geometries', false);
    expect(await look(u, c.id)).toBeNull();
    expect(await look(u, mine.id)).toBeNull();
    expect(await look(u, own.id)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cross-layer constraints

const near = (a: Xy, b: Xy): void => {
  expect(a.x).toBeCloseTo(b.x, 4);
  expect(a.y).toBeCloseTo(b.y, 4);
};

async function pick(u: SketchUser, label: string): Promise<void> {
  await u.tool(label);
}

test.describe('cross-layer constraints', () => {
  const dirOf = (s: Sketch, l: Line): Xy => {
    const a = pointAt(s, l.a);
    const b = pointAt(s, l.b);
    return { x: b.x - a.x, y: b.y - a.y };
  };
  const cross2 = (a: Xy, b: Xy): number => (a.x * b.y - a.y * b.x) / Math.hypot(a.x, a.y) / Math.hypot(b.x, b.y);
  const dot2 = (a: Xy, b: Xy): number => (a.x * b.x + a.y * b.y) / Math.hypot(a.x, a.y) / Math.hypot(b.x, b.y);

  /** Reference line on Layer 1, work line on Work, active. */
  async function pair(u: SketchUser): Promise<{ ref: Line; work: Line; r0: Xy; r1: Xy; w0: Xy; w1: Xy }> {
    const r0 = { x: 10, y: 10 };
    const r1 = { x: 50, y: 25 };
    const w0 = { x: 15, y: 45 };
    const w1 = { x: 45, y: 70 };
    const ref = await line(u, r0, r1);
    await addLayer(u, 'Work');
    const work = await line(u, w0, w1);
    return { ref, work, r0, r1, w0, w1 };
  }

  for (const order of ['reference first', 'active first'] as const) {
    const first = <T,>(ref: T, work: T): [T, T] => (order === 'reference first' ? [ref, work] : [work, ref]);

    test(`parallel, ${order}: the active line moves, the other stays`, async ({ page }) => {
      const u = await start(page);
      const t = await pair(u);
      await pick(u, 'Parallel');
      for (const at of first(mid(t.r0, t.r1, 0.3), mid(t.w0, t.w1, 0.3))) await u.click(at);
      await exitTool(u);
      const s = await u.sketch();
      near(pointAt(s, t.ref.a), t.r0);
      near(pointAt(s, t.ref.b), t.r1);
      expect(cross2(dirOf(s, t.ref), dirOf(s, s.curves[t.work.id] as Line))).toBeCloseTo(0, 6);
      const [k] = cross(s);
      expect(k.dependentLayer).toBe(await layerId(u, 'Work'));
      expect((await u.analysis()).unsatisfied).toEqual([]);
    });

    test(`perpendicular, ${order}`, async ({ page }) => {
      const u = await start(page);
      const t = await pair(u);
      await pick(u, 'Perpendicular');
      for (const at of first(mid(t.r0, t.r1, 0.3), mid(t.w0, t.w1, 0.3))) await u.click(at);
      await exitTool(u);
      const s = await u.sketch();
      near(pointAt(s, t.ref.a), t.r0);
      near(pointAt(s, t.ref.b), t.r1);
      expect(dot2(dirOf(s, t.ref), dirOf(s, t.work))).toBeCloseTo(0, 6);
    });

    test(`equal, ${order}: only the active line changes length`, async ({ page }) => {
      const u = await start(page);
      const t = await pair(u);
      await pick(u, 'Equal');
      for (const at of first(mid(t.r0, t.r1, 0.3), mid(t.w0, t.w1, 0.3))) await u.click(at);
      await exitTool(u);
      const s = await u.sketch();
      near(pointAt(s, t.ref.a), t.r0);
      near(pointAt(s, t.ref.b), t.r1);
      const len = (l: Line): number => Math.hypot(dirOf(s, l).x, dirOf(s, l).y);
      expect(len(t.work)).toBeCloseTo(len(t.ref), 5);
    });

    test(`collinear, ${order}`, async ({ page }) => {
      const u = await start(page);
      const t = await pair(u);
      await pick(u, 'Collinear');
      for (const at of first(mid(t.r0, t.r1, 0.3), mid(t.w0, t.w1, 0.3))) await u.click(at);
      await exitTool(u);
      const s = await u.sketch();
      near(pointAt(s, t.ref.a), t.r0);
      near(pointAt(s, t.ref.b), t.r1);
      const off = { x: pointAt(s, t.work.a).x - t.r0.x, y: pointAt(s, t.work.a).y - t.r0.y };
      expect(cross2(dirOf(s, t.ref), off)).toBeCloseTo(0, 5);
    });

    test(`coincident point to point, ${order}`, async ({ page }) => {
      const u = await start(page);
      const t = await pair(u);
      await pick(u, 'Coincident');
      for (const at of first(t.r1, t.w0)) await u.click(at);
      await exitTool(u);
      const s = await u.sketch();
      near(pointAt(s, t.ref.b), t.r1);
      near(pointAt(s, t.work.a), t.r1);
    });

    test(`coincident point on curve, ${order}`, async ({ page }) => {
      const u = await start(page);
      const t = await pair(u);
      await pick(u, 'Coincident');
      for (const at of first(mid(t.r0, t.r1, 0.3), t.w0)) await u.click(at);
      await exitTool(u);
      const s = await u.sketch();
      near(pointAt(s, t.ref.a), t.r0);
      near(pointAt(s, t.ref.b), t.r1);
      const off = { x: pointAt(s, t.work.a).x - t.r0.x, y: pointAt(s, t.work.a).y - t.r0.y };
      expect(cross2(dirOf(s, t.ref), off)).toBeCloseTo(0, 5);
    });

    test(`concentric, ${order}`, async ({ page }) => {
      const u = await start(page);
      const c0 = { x: -40, y: 30 };
      const ref = await circle(u, c0, 12);
      await addLayer(u, 'Work');
      const work = await circle(u, { x: 30, y: 30 }, 8);
      await pick(u, 'Concentric');
      for (const at of first({ x: c0.x + 12, y: c0.y }, { x: 38, y: 30 })) await u.click(at);
      await exitTool(u);
      const s = await u.sketch();
      near(pointAt(s, ref.c), c0);
      near(pointAt(s, work.c), c0);
      expect((s.curves[ref.id] as Circle).r).toBeCloseTo(12, 6);
      expect((s.curves[work.id] as Circle).r).toBeCloseTo(8, 6);
    });

    test(`tangent, ${order}`, async ({ page }) => {
      const u = await start(page);
      const c0 = { x: -40, y: 30 };
      const ref = await circle(u, c0, 12);
      await addLayer(u, 'Work');
      const w0 = { x: 10, y: 10 };
      const w1 = { x: 40, y: 60 };
      const work = await line(u, w0, w1);
      await pick(u, 'Tangent');
      for (const at of first({ x: c0.x + 12, y: c0.y }, mid(w0, w1, 0.3))) await u.click(at);
      await exitTool(u);
      const s = await u.sketch();
      near(pointAt(s, ref.c), c0);
      expect((s.curves[ref.id] as Circle).r).toBeCloseTo(12, 6);
      const a = pointAt(s, work.a);
      const n = { x: -dirOf(s, work).y, y: dirOf(s, work).x };
      const l = Math.hypot(n.x, n.y);
      expect(Math.abs(((c0.x - a.x) * n.x + (c0.y - a.y) * n.y) / l)).toBeCloseTo(12, 4);
    });

    test(`midpoint, ${order}`, async ({ page }) => {
      const u = await start(page);
      const t = await pair(u);
      await pick(u, 'Midpoint');
      for (const at of first(mid(t.r0, t.r1, 0.3), t.w0)) await u.click(at);
      await exitTool(u);
      const s = await u.sketch();
      near(pointAt(s, t.ref.a), t.r0);
      near(pointAt(s, t.ref.b), t.r1);
      near(pointAt(s, t.work.a), mid(t.r0, t.r1));
    });

    test(`horizontal between two points, ${order}`, async ({ page }) => {
      const u = await start(page);
      const t = await pair(u);
      await pick(u, 'Horizontal/Vertical');
      for (const at of first(t.r1, t.w1)) await u.click(at);
      await exitTool(u);
      const s = await u.sketch();
      near(pointAt(s, t.ref.b), t.r1);
      const dx = Math.abs(pointAt(s, t.work.b).x - t.r1.x);
      const dy = Math.abs(pointAt(s, t.work.b).y - t.r1.y);
      expect(Math.min(dx, dy)).toBeCloseTo(0, 5);
    });

    test(`sketch dimension, ${order}: the active point goes to the value`, async ({ page }) => {
      const u = await start(page);
      const t = await pair(u);
      await pick(u, 'Sketch Dimension');
      for (const at of first(t.r1, t.w0)) await u.click(at);
      await u.click({ x: 65, y: 60 });
      await page.keyboard.type('30');
      await page.keyboard.press('Enter');
      await u.settle();
      await exitTool(u);
      const s = await u.sketch();
      near(pointAt(s, t.ref.a), t.r0);
      near(pointAt(s, t.ref.b), t.r1);
      const [dim] = Object.values(s.dimensions);
      expect(dim.dependentLayer).toBe(await layerId(u, 'Work'));
      const a = pointAt(s, t.work.a);
      const m = dim.kind === 'distance' ? Math.hypot(a.x - t.r1.x, a.y - t.r1.y) : dim.kind === 'horizontal' ? Math.abs(a.x - t.r1.x) : Math.abs(a.y - t.r1.y);
      expect(m).toBeCloseTo(30, 4);
      expect(await page.evaluate(() => window.__sketch.labels())).toEqual([dim.id]);
    });
  }

  test('symmetry about a line on another layer: the active side moves', async ({ page }) => {
    const u = await start(page);
    const axis = await line(u, { x: 20, y: 5 }, { x: 20, y: 70 });
    const placed = await u.sketch();
    const axis0 = pointAt(placed, axis.a);
    const axis1 = pointAt(placed, axis.b);
    await addLayer(u, 'Work');
    const a = await line(u, { x: 0, y: 20 }, { x: 10, y: 40 });
    const b = await line(u, { x: 30, y: 25 }, { x: 45, y: 50 });
    await pick(u, 'Symmetry');
    await u.click({ x: 5, y: 30 });
    await u.click({ x: 37.5, y: 37.5 });
    await u.click({ x: 20, y: 50 });
    await exitTool(u);
    const s = await u.sketch();
    near(pointAt(s, axis.a), axis0);
    near(pointAt(s, axis.b), axis1);
    expect(cross(s)).toHaveLength(1);
    expect(s.curves[a.id]).toBeTruthy();
    expect(s.curves[b.id]).toBeTruthy();
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('a reference pick needs an active-layer partner: two template objects, or one alone, are not valid', async ({ page }) => {
    const u = await start(page);
    const r0 = { x: 10, y: 10 };
    const r1 = { x: 40, y: 25 };
    await line(u, r0, r1);
    await line(u, { x: 10, y: 40 }, { x: 40, y: 60 });
    await addLayer(u, 'Work');
    await line(u, { x: -60, y: 20 }, { x: -20, y: 45 });

    await pick(u, 'Parallel');
    await u.click(mid(r0, r1));
    await u.click(mid({ x: 10, y: 40 }, { x: 40, y: 60 }));
    await exitTool(u);
    expect(Object.keys((await u.sketch()).constraints)).toHaveLength(0);

    await pick(u, 'Horizontal/Vertical');
    await u.click(mid(r0, r1));
    await exitTool(u);
    expect(Object.keys((await u.sketch()).constraints)).toHaveLength(0);

    await pick(u, 'Sketch Dimension');
    await u.click(mid(r0, r1));
    await u.click({ x: 40, y: -20 });
    await page.keyboard.press('Enter');
    await u.settle();
    expect(await note(u)).toContain('active layer');
    await exitTool(u);
    expect(Object.keys((await u.sketch()).dimensions)).toHaveLength(0);

    // Fix is an edit, so it does not reach another layer at all.
    await pick(u, 'Fix/UnFix');
    await u.click(mid(r0, r1));
    await exitTool(u);
    const s = await u.sketch();
    expect(Object.values(s.curves).some((c) => c.fixed)).toBe(false);
  });

  test('another layer hovers as valid only in constraint tools and Sketch Dimension', async ({ page }) => {
    const u = await start(page);
    const r0 = { x: 10, y: 10 };
    const r1 = { x: 40, y: 25 };
    const ref = await line(u, r0, r1);
    await addLayer(u, 'Work');
    await line(u, { x: -60, y: 20 }, { x: -20, y: 45 });
    const shot = async (): Promise<string> => {
      const box = await u.screen(mid(r0, r1));
      const png = await page.screenshot({ clip: { x: box.x - 8, y: box.y - 8, width: 16, height: 16 } });
      return png.toString('base64');
    };
    await u.move({ x: 60, y: 60 });
    await u.settle();
    const plain = await shot();
    await u.move(mid(r0, r1));
    await u.settle();
    expect(await shot()).toBe(plain);
    await pick(u, 'Parallel');
    await u.move(mid(r0, r1));
    await u.settle();
    expect(await shot()).not.toBe(plain);
    await exitTool(u);
    await pick(u, 'Trim');
    await u.move(mid(r0, r1));
    await u.settle();
    await exitTool(u);
    expect((await u.sketch()).curves[ref.id]).toBeTruthy();
  });

  test('has a distinct glyph, shows on its owner only, and is deleted from there', async ({ page }) => {
    const u = await start(page);
    const t = await pair(u);
    await pick(u, 'Parallel');
    await u.click(mid(t.r0, t.r1, 0.3));
    await u.click(mid(t.w0, t.w1, 0.3));
    await exitTool(u);
    const s0 = await u.sketch();
    const [k] = cross(s0);
    const glyphs = await page.evaluate(() => window.__sketch.badges());
    expect(glyphs.find((g) => g.constraint === k.id)?.cross).toBe(true);

    await activate(u, 'Layer 1');
    expect((await page.evaluate(() => window.__sketch.badges())).find((g) => g.constraint === k.id)).toBeUndefined();

    await activate(u, 'Work');
    const g = (await page.evaluate(() => window.__sketch.badges())).find((b) => b.constraint === k.id) as { x: number; y: number };
    const box = await page.locator('canvas.canvas').boundingBox();
    if (!box) throw new Error('no canvas');
    await page.mouse.move(box.x + g.x, box.y + g.y);
    await u.settle();
    await page.mouse.down();
    await page.mouse.up();
    await u.settle();
    expect(await selection(u)).toEqual([k.id]);
    await u.press('Delete');
    expect(cross(await u.sketch())).toEqual([]);
    const s = await u.sketch();
    near(pointAt(s, t.ref.a), t.r0);
    await u.press('Control+z');
    expect(cross(await u.sketch())).toHaveLength(1);
  });

  test('a point-to-point join across layers has a glyph too, or it could not be deleted', async ({ page }) => {
    const u = await start(page);
    const t = await line(u, { x: 10, y: 10 }, { x: 40, y: 25 });
    await addLayer(u, 'Work');
    await u.press('l');
    await u.click({ x: 40, y: 25 });
    await u.click({ x: 70, y: 30 });
    await exitTool(u);
    const [k] = cross(await u.sketch());
    expect(k.refs).toContain(t.b);
    expect((await page.evaluate(() => window.__sketch.badges())).filter((g) => g.constraint === k.id && g.cross)).toHaveLength(1);
  });

  test('Status is the whole sketch: a dependent line pinned to a free reference is not fully constrained', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 10, y: 10 }, { x: 40, y: 25 });
    await addLayer(u, 'Work');
    await u.press('l');
    await u.click({ x: 40, y: 25 });
    await u.click({ x: 70, y: 30 });
    await exitTool(u);
    expect((await u.analysis()).dof).toBe(6);
    expect(await u.statusLine()).toContain('Under-Constrained');
  });
});

// ---------------------------------------------------------------------------
// Following

test.describe('following', () => {
  const A0 = { x: -60, y: 20 };
  const A1 = { x: -30, y: 40 };
  const B1 = { x: 6, y: 25 };
  const C1 = { x: 30, y: 50 };

  /** A on Layer 1; B on Layer B, starting at A's end; C on Layer C, starting at B's end. */
  async function chainOf(u: SketchUser): Promise<{ a: Line; b: Line; c: Line }> {
    const a = await line(u, A0, A1);
    await addLayer(u, 'Layer B');
    const seen = new Set([a.id]);
    await u.press('l');
    await u.click(A1);
    await u.click(B1);
    await exitTool(u);
    const b = (await u.lines()).find((l) => !seen.has(l.id)) as Line;
    seen.add(b.id);
    await addLayer(u, 'Layer C');
    await u.press('l');
    await u.click(B1);
    await u.click(C1);
    await exitTool(u);
    const c = (await u.lines()).find((l) => !seen.has(l.id)) as Line;
    return { a, b, c };
  }

  test('moving A takes B with it, and C through B', async ({ page }) => {
    const u = await start(page);
    const t = await chainOf(u);
    await activate(u, 'Layer 1');
    await u.drag(A1, { x: -25, y: 55 });
    const s = await u.sketch();
    near(pointAt(s, t.a.b), { x: -25, y: 55 });
    near(pointAt(s, t.b.a), { x: -25, y: 55 });
    near(pointAt(s, t.c.a), pointAt(s, t.b.b));
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('the link is one-way: moving B leaves A alone, and C follows', async ({ page }) => {
    const u = await start(page);
    const t = await chainOf(u);
    await activate(u, 'Layer B');
    await u.drag(B1, { x: 12, y: 15 });
    const s = await u.sketch();
    near(pointAt(s, t.a.a), A0);
    near(pointAt(s, t.a.b), A1);
    near(pointAt(s, t.b.a), A1);
    near(pointAt(s, t.b.b), { x: 12, y: 15 });
    near(pointAt(s, t.c.a), { x: 12, y: 15 });
  });

  test('moving the far end of a chain moves nothing upstream', async ({ page }) => {
    const u = await start(page);
    const t = await chainOf(u);
    await u.drag(C1, { x: 40, y: 60 });
    const s = await u.sketch();
    near(pointAt(s, t.a.b), A1);
    near(pointAt(s, t.b.b), B1);
    near(pointAt(s, t.c.b), { x: 40, y: 60 });
  });

  test('a layer with no link holds still', async ({ page }) => {
    const u = await start(page);
    const t = await chainOf(u);
    await addLayer(u, 'Apart');
    const apart = await line(u, { x: 30, y: -30 }, { x: 60, y: -20 });
    await activate(u, 'Layer 1');
    await u.drag(A1, { x: -25, y: 55 });
    const s = await u.sketch();
    near(pointAt(s, apart.a), { x: 30, y: -30 });
    near(pointAt(s, apart.b), { x: 60, y: -20 });
    near(pointAt(s, t.b.a), { x: -25, y: 55 });
  });

  test('a dimension on the reference moves the dependent too', async ({ page }) => {
    const u = await start(page);
    const t = await chainOf(u);
    await activate(u, 'Layer 1');
    await pick(u, 'Sketch Dimension');
    await u.click(mid(A0, A1));
    await u.click({ x: -80, y: 70 });
    await page.keyboard.type('60');
    await page.keyboard.press('Enter');
    await u.settle();
    await exitTool(u);
    const s = await u.sketch();
    const a = pointAt(s, t.a.a);
    const b = pointAt(s, t.a.b);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(60, 4);
    near(pointAt(s, t.b.a), b);
  });

  test('a locked dependent holds, the link goes red with a message, and unlocking lets it follow', async ({ page }) => {
    const u = await start(page);
    const t = await chainOf(u);
    await activate(u, 'Layer 1');
    await lock(u, 'Layer B').click();
    await u.settle();
    const before = await u.sketch();
    await u.drag(A1, { x: -25, y: 55 });
    const s = await u.sketch();
    near(pointAt(s, t.a.b), { x: -25, y: 55 });
    expect(s.points[t.b.a]).toEqual(before.points[t.b.a]);
    expect(s.points[t.b.b]).toEqual(before.points[t.b.b]);
    // Not locked, but downstream of what did not move: it stays too.
    expect(s.points[t.c.b]).toEqual(before.points[t.c.b]);
    expect(await note(u)).toContain('Layer B');
    expect(await note(u)).toContain('locked');
    const a = await u.analysis();
    const k = Object.values(s.constraints).find((c) => c.refs.includes(t.b.a)) as Constraint;
    expect(a.unsatisfied).toContain(k.id);
    expect(a.badCurves).toContain(t.a.id);
    expect(await look(u, t.a.id)).toMatchObject({ color: '#d9272e' });
    expect(await look(u, t.b.id)).toMatchObject({ color: '#d9272e' });
    const glyph = (await page.evaluate(() => window.__sketch.badges())).find((g) => g.constraint === k.id);
    expect(glyph?.cross).toBe(true);
    await expect(page.locator('.palette-status')).toContainText('Over-Constrained');

    await lock(u, 'Layer B').click();
    await u.settle();
    const healed = await u.sketch();
    near(pointAt(healed, t.b.a), { x: -25, y: 55 });
    near(pointAt(healed, t.a.b), { x: -25, y: 55 });
    expect((await u.analysis()).unsatisfied).toEqual([]);
    await expect(page.locator('.palette-status')).not.toContainText('Over-Constrained');
  });

  test('a locked layer never moves, whatever is dragged', async ({ page }) => {
    const u = await start(page);
    const t = await chainOf(u);
    await lock(u, 'Layer 1').click();
    await activate(u, 'Layer B');
    await u.drag(A1, { x: 0, y: 70 });
    const s = await u.sketch();
    near(pointAt(s, t.a.a), A0);
    near(pointAt(s, t.a.b), A1);
    near(pointAt(s, t.b.a), A1);
  });

  test('deleting a referenced object removes the constraint with a message; the dependent stays where it is', async ({ page }) => {
    const u = await start(page);
    const t = await chainOf(u);
    await activate(u, 'Layer 1');
    const before = await u.sketch();
    await u.click(mid(A0, A1));
    await u.press('Delete');
    const s = await u.sketch();
    expect(s.curves[t.a.id]).toBeUndefined();
    expect(s.points[t.b.a]).toEqual(before.points[t.b.a]);
    expect(s.points[t.b.b]).toEqual(before.points[t.b.b]);
    expect(cross(s).filter((k) => k.refs.includes(t.b.a))).toEqual([]);
    expect(await note(u)).toContain('cross-layer');
    await u.press('Control+z');
    expect(cross(await u.sketch())).toHaveLength(2);
  });

  test('deleting a layer with links merges them, and nothing moves', async ({ page }) => {
    const u = await start(page);
    const t = await chainOf(u);
    await activate(u, 'Layer 1');
    const before = await u.sketch();
    await row(u, 'Layer B').locator('.layer-delete').click();
    await u.settle();
    const s = await u.sketch();
    expect(s.points).toEqual(before.points);
    const here = await layerId(u, 'Layer 1');
    expect(s.curves[t.b.id].layer).toBe(here);
    expect(cross(s).filter((k) => k.type === 'coincident').map((k) => k.refs).flat()).not.toContain(t.b.a);
    expect(constraintsOfType(s, 'coincident')).toBe(Object.keys(before.constraints).length);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('a value that changes moves a dimension on another layer, with no link between them', async ({ page }) => {
    const u = await start(page);
    await line(u, A0, A1);
    await pick(u, 'Sketch Dimension');
    await u.click(mid(A0, A1));
    await u.click({ x: -80, y: 70 });
    await page.keyboard.press('Enter');
    await u.settle();
    await exitTool(u);
    await addLayer(u, 'Work');
    const w = await line(u, { x: 10, y: 12 }, { x: 30, y: 33 });
    await pick(u, 'Sketch Dimension');
    await u.click(mid({ x: 10, y: 12 }, { x: 30, y: 33 }));
    await u.click({ x: 50, y: 5 });
    await page.keyboard.type('d1 * 2');
    await page.keyboard.press('Enter');
    await u.settle();
    await exitTool(u);
    const length = (s: Sketch): number => Math.hypot(pointAt(s, w.a).x - pointAt(s, w.b).x, pointAt(s, w.a).y - pointAt(s, w.b).y);
    expect(length(await u.sketch())).toBeCloseTo(2 * Math.hypot(30, 20), 3);
    await activate(u, 'Layer 1');
    await u.doubleClick({ x: -80, y: 70 });
    await page.keyboard.type('50');
    await page.keyboard.press('Enter');
    await u.settle();
    expect(length(await u.sketch())).toBeCloseTo(100, 3);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });
});
