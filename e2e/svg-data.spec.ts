// Editable SVG, through the real menus: Save as SVG carries the design, File > Open reads it back, and a file
// that cannot be read leaves the design alone. Files are read from the download and written to the file chooser.
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { SketchUser, type Xy } from './helpers';
import type { Design, Id, Sketch } from '../src/model/types';
import { dataMarkup, decodeSvgData } from '../src/io/svg-data';
import { planeName } from '../src/model/frames';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { errors: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

const exitTool = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};

const dialog = (u: SketchUser, title: string): Locator => u.page.locator(`.dialog[data-dialog="${title}"]`);
const fieldRow = (d: Locator, label: string): Locator => d.locator('.form-row').filter({ has: d.page().locator(`.form-label:text-is("${label}")`) });
const selectInField = (d: Locator, label: string): Promise<void> => d.locator(`[data-field="${label}"] .select-toggle`).click();
const ok = async (u: SketchUser, d: Locator): Promise<void> => {
  await d.locator('.btn.primary').click();
  await u.settle();
};

/** A tool from a panel's menu, through its flyout if it has one. */
async function menu(u: SketchUser, panel: 'create' | 'modify' | 'constraints', label: string, flyout?: string): Promise<void> {
  await u.page.locator(`.panel[data-panel="${panel}"] .panel-name`).click();
  if (flyout) await u.page.locator(`.menu-item.flyout[data-item="${flyout}"]`).hover();
  await u.page.locator(`.menu-item[data-item="${label}"]`).click();
  await u.settle();
}

async function lineChain(u: SketchUser, ...pts: Xy[]): Promise<void> {
  await u.press('l');
  for (const p of pts) await u.click(p);
  await exitTool(u);
}

async function rectangle(u: SketchUser, a: Xy, b: Xy): Promise<void> {
  await u.press('r');
  await u.click(a);
  await u.click(b);
  await exitTool(u);
}

async function circle(u: SketchUser, c: Xy, rim: Xy): Promise<void> {
  await u.press('c');
  await u.click(c);
  await u.click(rim);
  await exitTool(u);
}

/** Dimension by picks, placing the label at `at` and typing the value. */
async function dimension(u: SketchUser, pick: Xy[], at: Xy, value: string): Promise<void> {
  await u.press('d');
  for (const p of pick) await u.click(p);
  await u.click(at);
  await u.page.keyboard.press('ControlOrMeta+a');
  await u.page.keyboard.type(value);
  await u.press('Enter');
  await exitTool(u);
}

// ---------------------------------------------------------------------------
// Layers

const row = (u: SketchUser, name: string): Locator => u.page.locator('.layer-row', { hasText: name });

async function addLayer(u: SketchUser, name: string, color: string): Promise<void> {
  await u.page.locator('[data-action="add-layer"]').click();
  await u.settle();
  const added = u.page.locator('.layer-row.active');
  await added.locator('.layer-name').dblclick();
  await added.locator('.layer-rename').fill(name);
  await u.page.keyboard.press('Enter');
  await u.settle();
  await u.page.locator('.layer-row.active .layer-swatch').fill(color);
  await u.settle();
}

const activate = async (u: SketchUser, name: string): Promise<void> => {
  await row(u, name).locator('.layer-name').click();
  await u.settle();
};

// ---------------------------------------------------------------------------
// A demanding design, built the way a user would

/** The tool buttons of the ribbon, or the Create menu when one is not pinned. */
async function pick(u: SketchUser, label: string, flyout?: string): Promise<void> {
  const pinned = u.page.locator(`.tool-btn[aria-label="${label}"]`);
  if (await pinned.count()) await pinned.first().click();
  else {
    await u.page.getByRole('button', { name: /^CREATE/ }).click();
    if (flyout) await u.page.locator(`.menu-item.flyout[data-item="${flyout}"]`).hover();
    await u.page.locator(`.menu-item[data-item="${label}"]`).click();
  }
  await u.settle();
}

const along = (a: Xy, b: Xy, t: number): Xy => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

async function finishSketch(u: SketchUser): Promise<void> {
  await u.page.locator('[data-action="palette-finish"]').click();
  await u.settle();
}

async function newSketchOn(u: SketchUser, plane: 'XY' | 'YZ'): Promise<void> {
  await u.newSketch(plane);
}

/** Everything the task names, over three sketches, on four layers. Leaves design mode with the XY plane. */
async function buildDesign(u: SketchUser): Promise<void> {
  const { page } = u;
  // Sketch 1. A rectangular pattern first, while there is nothing else for Select All to take.
  await rectangle(u, { x: -150, y: -20 }, { x: -140, y: -10 });
  await page.keyboard.press('ControlOrMeta+a');
  await u.tool('Rectangular Pattern');
  const pattern = dialog(u, 'Rectangular Pattern');
  await fieldRow(pattern, 'Quantity').first().locator('input').fill('3');
  await fieldRow(pattern, 'Distance').first().locator('input').fill('40');
  await ok(u, pattern);

  // User parameters: a length by expression, a text, and one that reads another.
  await menu(u, 'modify', 'Change Parameters');
  const params = dialog(u, 'Parameters');
  for (const [name, expr, unit] of [['span', '60 mm', ''], ['half', 'span / 2', ''], ['PartNo', "'AB-12 Größe'", 'text']]) {
    await params.locator('[data-action="add-parameter"]').click();
    const fresh = params.locator('.param-row').last();
    await fresh.locator('input').nth(0).fill(name);
    await fresh.locator('input').nth(0).press('Enter');
    const named = params.locator(`.param-row[data-param="${name}"]`);
    if (unit) await named.locator('select').selectOption(unit);
    await named.locator('input').nth(1).fill(expr);
    await named.locator('input').nth(1).press('Enter');
  }
  await ok(u, params);

  // A rectangle with two driving dimensions and a third that goes driven, one by expression.
  await rectangle(u, { x: -110, y: 10 }, { x: -70, y: 35 });
  await dimension(u, [{ x: -90, y: 35 }], { x: -90, y: 44 }, 'half + 10 mm');
  await dimension(u, [{ x: -70, y: 22 }], { x: -60, y: 22 }, '25');
  await u.press('d');
  await u.click({ x: -90, y: 10 });
  await u.click({ x: -90, y: 2 });
  await exitTool(u);

  // A fillet.
  await lineChain(u, { x: -150, y: -60 }, { x: -110, y: -60 }, { x: -110, y: -30 });
  await u.tool('Fillet');
  await u.click({ x: -110, y: -60 });
  await u.move({ x: -150, y: -20 });
  await page.keyboard.type('5');
  await u.press('Enter');

  // An offset.
  await rectangle(u, { x: -60, y: -60 }, { x: -20, y: -35 });
  await u.tool('Offset');
  await u.click({ x: -20, y: -47 });
  await u.move({ x: -10, y: -47 });
  await fieldRow(dialog(u, 'Offset'), 'Distance').locator('input').fill('5 mm');
  await u.move({ x: -10, y: -45 });
  await ok(u, dialog(u, 'Offset'));

  // A circle mirrored in a construction line.
  await circle(u, { x: 50, y: -40 }, { x: 60, y: -40 });
  await lineChain(u, { x: 30, y: -70 }, { x: 30, y: -10 });
  await u.click({ x: 30, y: -40 });
  await u.press('x');
  await exitTool(u);
  await u.tool('Mirror');
  const mirror = dialog(u, 'Mirror');
  await u.drag({ x: 38, y: -52 }, { x: 62, y: -28 });
  await selectInField(mirror, 'Mirror Line');
  await u.click({ x: 30, y: -60 });
  await ok(u, mirror);

  // Splines, a conic, and text that reads a text parameter and a dimension.
  await pick(u, 'Fit Point Spline', 'Spline');
  for (const p of [{ x: -110, y: 60 }, { x: -90, y: 75 }, { x: -70, y: 60 }, { x: -50, y: 75 }]) await u.click(p);
  await u.press('Enter');
  await exitTool(u);
  await pick(u, 'Control Point Spline', 'Spline');
  for (const p of [{ x: -60, y: 60 }, { x: -40, y: 80 }, { x: -20, y: 60 }, { x: 0, y: 80 }, { x: 20, y: 60 }, { x: 40, y: 80 }]) await u.click(p);
  await u.press('Enter');
  await exitTool(u);
  await pick(u, 'Conic Curve');
  await u.click({ x: -10, y: 10 });
  await u.click({ x: 50, y: 10 });
  await u.click({ x: 20, y: 50 });
  await u.move({ x: 20, y: 30 });
  await u.type('0.3');
  await u.press('Enter');
  await exitTool(u);
  await pick(u, 'Text');
  await u.click({ x: 50, y: -90 });
  await u.click({ x: 115, y: -65 });
  const text = dialog(u, 'Text');
  await text.locator('textarea').fill('No. {PartNo} w={d1}');
  await fieldRow(text, 'Height').locator('input').fill('8 mm');
  await ok(u, text);
  await exitTool(u);

  // A link across layers: the second line's end is tied to the first, which then moves to another layer.
  await lineChain(u, { x: 70, y: 20 }, { x: 95, y: 30 }, { x: 110, y: 70 });
  await addLayer(u, 'Target', '#e07a1f');
  await activate(u, 'Layer 1');
  await u.rightClick(along({ x: 70, y: 20 }, { x: 95, y: 30 }, 0.5));
  await page.locator('.marking-list .menu-item', { hasText: 'Move to Target' }).first().click();
  await u.settle();

  // A hidden layer with a circle on it, and a locked one with a line.
  await addLayer(u, 'Hidden <&> "x"', '#2fa84f');
  await circle(u, { x: 100, y: -50 }, { x: 108, y: -50 });
  await activate(u, 'Layer 1');
  await row(u, 'Hidden').locator('.layer-eye').click();
  await addLayer(u, 'Größe 🙂 ]]>', '#8844cc');
  await lineChain(u, { x: -20, y: -90 }, { x: 40, y: -85 });
  await row(u, 'Größe').locator('.layer-lock').click();
  await activate(u, 'Layer 1');
  await finishSketch(u);

  // Sketch 2, on another plane: not part of what the XY drawing shows.
  await newSketchOn(u, 'YZ');
  await rectangle(u, { x: -30, y: -20 }, { x: 30, y: 20 });
  await finishSketch(u);

  // Sketch 3: a linked projection of sketch 1, and a circle with a diameter.
  await newSketchOn(u, 'XY');
  await pick(u, 'Project', 'Project / Include');
  await u.click(along({ x: -110, y: 10 }, { x: -70, y: 10 }, 0.3));
  await u.click({ x: 60, y: -40 });
  await ok(u, dialog(u, 'Project'));
  await circle(u, { x: -75, y: 25 }, { x: -63, y: 25 });
  await dimension(u, [{ x: -63, y: 25 }], { x: -45, y: 40 }, '24');
  await finishSketch(u);
}


// ---------------------------------------------------------------------------
// Files in and out

const fileMenu = async (u: SketchUser, item: string): Promise<void> => {
  await u.page.locator('[data-menu="file"]').click();
  await u.page.locator(`.menu-item[data-item="${item}"]`).click();
  await u.settle();
};

/** File > Save as SVG, ticked or not as given, then the name dialog's Save: the file's text. */
async function saveSvg(u: SketchUser, opts: { data?: boolean } = {}): Promise<string> {
  await fileMenu(u, 'Save as SVG...');
  const d = dialog(u, 'Save as SVG');
  const box = d.locator('.form-row', { hasText: 'Include editable data' }).locator('input');
  if (opts.data === false) await box.uncheck();
  await d.getByRole('button', { name: 'OK' }).click();
  await u.settle();
  const waiting = u.page.waitForEvent('download');
  await dialog(u, 'Save SVG').getByRole('button', { name: 'Save' }).click();
  return readFileSync(await (await waiting).path(), 'utf8');
}

/** File > Save: the project file's name and text. */
async function saveProject(u: SketchUser): Promise<{ name: string; text: string }> {
  const waiting = u.page.waitForEvent('download');
  await fileMenu(u, 'Save');
  const file = await waiting;
  return { name: file.suggestedFilename(), text: readFileSync(await file.path(), 'utf8') };
}

/** Unsaved work asks before it is replaced: these tests mean to replace it, so Don't Save. Nothing is asked of a saved design. */
async function letGo(u: SketchUser): Promise<void> {
  const ask = u.page.locator('[data-dialog="Unsaved Changes"]');
  await u.settle();
  if (await ask.count()) await ask.getByRole('button', { name: "Don't Save" }).click();
  await u.settle();
}

/** File > Open... with a file of this name and content, as the browser's chooser would hand it over. */
async function openFile(u: SketchUser, name: string, content: string): Promise<void> {
  const [chooser] = await Promise.all([u.page.waitForEvent('filechooser'), (async () => {
    await u.page.locator('[data-menu="file"]').click();
    await u.page.locator('.menu-item[data-item="Open..."]').click();
    await letGo(u);
  })()]);
  await chooser.setFiles({ name, mimeType: name.endsWith('.svg') ? 'image/svg+xml' : 'application/json', buffer: Buffer.from(content, 'utf8') });
  await u.settle();
}

const noteOf = (u: SketchUser): Promise<string> => u.page.evaluate(() => window.__sketch.note);

/** The embedded design as a file holds it, checked and decoded by the app's own reader. */
function payloadOf(svg: string): Design {
  const m = /<sketch:design ([^>]*)>([^<]*)<\/sketch:design>/.exec(svg);
  if (!m) throw new Error('no embedded data');
  const attrs = Object.fromEntries([...m[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
  const r = decodeSvgData({ format: attrs.format, encoding: attrs.encoding, bytes: attrs.bytes, crc32: attrs.crc32, text: m[2] });
  if (!r.ok) throw new Error(r.error);
  return JSON.parse(r.json) as Design;
}

const METADATA = /\n {2}<metadata>[\s\S]*?<\/metadata>/;
const dataText = (svg: string): string => /<sketch:design [^>]*>([^<]*)</.exec(svg)?.[1] ?? '';

/** The svg with its data swapped for that of `design`: another design, an older one, a newer one. */
const withDesign = (svg: string, design: unknown): string => svg.replace(METADATA, `\n  ${dataMarkup(design as Design)}`);

/** A small design, drawn by hand: a rectangle with a dimension, and a second layer. */
async function simpleDesign(u: SketchUser): Promise<void> {
  await rectangle(u, { x: -40, y: -20 }, { x: 40, y: 20 });
  await dimension(u, [{ x: 0, y: 20 }], { x: 0, y: 30 }, '80');
}

const newPage = async (browser: Browser, baseURL: string | undefined): Promise<{ u: SketchUser; errors: string[]; close: () => Promise<void> }> => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const u = new SketchUser(page);
  await u.open();
  return { u, errors, close: () => context.close() };
};

/** DOF, solver verdict and the palette's status, for each sketch in turn, entered as a user would. */
async function statusOfEverySketch(u: SketchUser): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const id of (await u.design()).order) {
    await u.page.locator(`.sketch-row[data-sketch="${id}"]`).dblclick();
    await u.settle();
    const a = await u.analysis();
    out.push({
      id, dof: a.dof, ok: a.ok, unsatisfied: [...a.unsatisfied].sort(), free: [...a.freeCurves].sort(), badCurves: [...a.badCurves].sort(),
      status: await u.statusLine(), bar: await u.page.evaluate(() => window.__sketch.status),
    });
    await finishSketch(u);
  }
  return out;
}

test.describe('save as svg', () => {
  test('the dialog offers editable data, ticked, and says what it holds', async ({ page }) => {
    const u = new SketchUser(page);
    await u.open();
    await u.newSketch();
    await simpleDesign(u);
    await fileMenu(u, 'Save as SVG...');
    const d = dialog(u, 'Save as SVG');
    await expect(d.locator('.form-row', { hasText: 'Include editable data' }).locator('input')).toBeChecked();
    await expect(d).toContainText('whole design');
    await expect(d).toContainText('hidden layers');
    await expect(d).toContainText('construction');
    await u.shot('svg-data-dialog');
  });

  test('unticked: no data in the file, the same drawing, and it opens only to say why', async ({ page }) => {
    const u = new SketchUser(page);
    await u.open();
    await u.newSketch();
    await simpleDesign(u);
    await addLayer(u, 'Gone', '#2fa84f');
    await lineChain(u, { x: 60, y: -60 }, { x: 90, y: -40 });
    await activate(u, 'Layer 1');
    await row(u, 'Gone').locator('.layer-eye').click();
    await finishSketch(u);
    const withData = await saveSvg(u);
    const without = await saveSvg(u, { data: false });
    expect(withData).toContain('<sketch:design');
    expect(without).not.toMatch(/sketch:design|<metadata|urn:sketch/);
    expect(without).not.toContain(dataText(withData));
    expect(withData.replace(METADATA, '')).toBe(without);

    const before = await u.design();
    await openFile(u, 'plain.svg', without);
    expect(await noteOf(u)).toMatch(/no editable data/i);
    expect(await u.design()).toEqual(before);
    await expect(page.locator('.sketch-row')).toHaveCount(1);
    // And the file with data still opens, so it was the data and not the app.
    await openFile(u, 'with.svg', withData);
    expect(await u.design()).toEqual(before);
  });
});

test.describe('open an svg', () => {
  test('a demanding design comes back equal, solved the same, and editable; saving again changes nothing', async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const u = new SketchUser(page);
    await u.open();
    await u.newSketch();
    await buildDesign(u);

    // The design really has what the task names.
    const built = await u.design();
    const sketches = built.order.map((id) => built.sketches[id]);
    const all = <T>(pick: (s: (typeof sketches)[number]) => T[]): T[] => sketches.flatMap(pick);
    expect(sketches.map((s) => planeName(s.frame))).toEqual(['XY', 'YZ', 'XY']);
    expect(built.layers.map((l) => [l.name, l.visible, l.locked])).toEqual([
      ['Größe 🙂 ]]>', true, true], ['Hidden <&> "x"', false, false], ['Target', true, false], ['Layer 1', true, false],
    ]);
    expect(built.activeLayer).toBe('layer-1');
    expect(all((s) => Object.values(s.constraints)).some((k) => k.dependentLayer)).toBe(true);
    expect(all((s) => Object.values(s.features)).map((f) => f.type).sort()).toEqual(['mirror', 'offset', 'rectPattern']);
    const types = new Set(all((s) => Object.values(s.curves)).map((c) => c.type));
    for (const t of ['arc', 'fitSpline', 'controlSpline', 'conic', 'text', 'circle']) expect(types.has(t as never)).toBe(true);
    expect(all((s) => Object.values(s.curves)).some((c) => c.projected)).toBe(true);
    expect(all((s) => Object.values(s.curves)).some((c) => c.lineType === 'construction')).toBe(true);
    expect(all((s) => Object.values(s.dimensions)).some((m) => !m.driving)).toBe(true);
    expect(all((s) => Object.values(s.dimensions)).some((m) => /half/.test(m.expression))).toBe(true);
    expect(built.parameters.map((p) => [p.name, p.unit])).toEqual([['span', 'mm'], ['half', 'mm'], ['PartNo', 'text']]);

    const statuses = await statusOfEverySketch(u);
    const design = await u.design();
    const svg = await saveSvg(u);
    expect(payloadOf(svg)).toEqual(design);

    // A new browser, with nothing stored, opens the file.
    const fresh = await newPage(browser, baseURL);
    try {
      const v = fresh.u;
      expect(await v.design()).toMatchObject({ order: [], parameters: [] });
      await openFile(v, 'Untitled.svg', svg);
      expect(await noteOf(v)).toBe('');
      const opened = await v.design();
      expect(opened).toEqual(design);
      expect(await v.page.evaluate(() => window.__sketch.canUndo)).toBe(false);
      expect(await statusOfEverySketch(v)).toEqual(statuses);
      expect(await v.design()).toEqual(design);

      // Saving it again gives the same data and the same drawing.
      const again = await saveSvg(v);
      expect(payloadOf(again)).toEqual(payloadOf(svg));
      expect(dataText(again)).toBe(dataText(svg));
      expect(again.replace(METADATA, '')).toBe(svg.replace(METADATA, ''));
      expect(again).toBe(svg);

      // And it can be edited: drag a free point, change a dimension and see what hangs on it follow, then undo.
      const first = design.order[0];
      await v.page.locator(`.sketch-row[data-sketch="${first}"]`).dblclick();
      await v.settle();
      const s1 = await v.sketch();
      const spline = Object.values(s1.curves).find((c) => c.type === 'fitSpline');
      if (spline?.type !== 'fitSpline') throw new Error('no fit spline');
      const tip = s1.points[spline.pts[3]];
      await v.drag({ x: tip.x, y: tip.y }, { x: tip.x + 10, y: tip.y + 10 });
      const dragged = (await v.sketch()).points[spline.pts[3]];
      expect(dragged.x).toBeCloseTo(tip.x + 10, 0);
      expect(dragged.y).toBeCloseTo(tip.y + 10, 0);

      const width = Object.values(s1.dimensions).find((m) => m.expression === 'half + 10 mm');
      const driven = Object.values(s1.dimensions).find((m) => !m.driving);
      if (!width || !driven) throw new Error('no width or driven dimension');
      const rectWidth = (): Promise<number> => v.sketch().then((s) => {
        const xs = Object.values(s.curves)
          .filter((c) => c.type === 'line' && [c.a, c.b].every((id) => s.points[id].x > -125 && s.points[id].x < -40 && s.points[id].y >= 10 && s.points[id].y <= 35))
          .flatMap((c) => (c.type === 'line' ? [s.points[c.a].x, s.points[c.b].x] : []));
        return Math.max(...xs) - Math.min(...xs);
      });
      expect(await rectWidth()).toBeCloseTo(40, 3);
      const textId = Object.values(s1.curves).find((c) => c.type === 'text')?.id as Id;
      const outlines = (): Promise<string> => v.page.evaluate((id) => JSON.stringify(window.__sketch.textOutlines(id)), textId);
      const wording = await outlines();
      await v.doubleClick(width.label as Xy);
      await v.page.keyboard.press('ControlOrMeta+a');
      await v.page.keyboard.type('50');
      await v.press('Enter');
      const after = await v.sketch();
      expect(after.dimensions[width.id].value).toBeCloseTo(50, 6);
      expect(after.dimensions[driven.id].value).toBeCloseTo(50, 6);
      expect(await rectWidth()).toBeCloseTo(50, 3);
      expect(await outlines()).not.toBe(wording);
      expect((await v.analysis()).unsatisfied).toEqual([]);

      await v.press('ControlOrMeta+z');
      expect((await v.sketch()).dimensions[width.id].expression).toBe('half + 10 mm');
      expect(await rectWidth()).toBeCloseTo(40, 3);
      expect(await outlines()).toBe(wording);
      await v.press('ControlOrMeta+z');
      await finishSketch(v);
      expect(await v.design()).toEqual(design);
      expect(fresh.errors).toEqual([]);
    } finally {
      await fresh.close();
    }
  });
});

const has = (tool: string): boolean => {
  try {
    execFileSync('which', [tool], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** What the simple design saves as, and the design itself. */
async function simpleSvg(u: SketchUser): Promise<{ svg: string; design: Design }> {
  await u.newSketch();
  await simpleDesign(u);
  await finishSketch(u);
  return { svg: await saveSvg(u), design: await u.design() };
}

test.describe('a file that cannot be read leaves the design as it was', () => {
  const foreign = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="#000"/></svg>\n';
  const rawMarkup = (text: string, over: Record<string, string> = {}): string => {
    const bytes = Buffer.from(text, 'utf8');
    const a = { format: '1', encoding: 'base64', bytes: String(bytes.length), crc32: crc32(bytes).toString(16).padStart(8, '0'), ...over };
    return `<metadata><sketch:design xmlns:sketch="urn:sketch-cad:design" format="${a.format}" encoding="${a.encoding}" bytes="${a.bytes}" crc32="${a.crc32}">${bytes.toString('base64')}</sketch:design></metadata>`;
  };

  test('each says why, and nothing is changed or logged', async ({ page }) => {
    const u = new SketchUser(page);
    await u.open();
    const { svg, design } = await simpleSvg(u);
    const middle = Math.floor(dataText(svg).length / 2);
    const flipped = dataText(svg).slice(0, middle) + (dataText(svg)[middle] === 'A' ? 'B' : 'A') + dataText(svg).slice(middle + 1);
    const cases: [string, string, string, RegExp][] = [
      ['foreign SVG', 'drawing.svg', foreign, /no editable data/i],
      ['truncated data', 'cut.svg', svg.replace(dataText(svg), dataText(svg).slice(0, Math.floor(dataText(svg).length * 0.6))), /cut short/i],
      ['the file cut off inside the data', 'cut2.svg', svg.slice(0, svg.indexOf('</sketch:design>') - 100), /cut short or damaged/i],
      ['altered data', 'edited.svg', svg.replace(dataText(svg), flipped), /damaged.*checksum/i],
      ['altered checksum', 'edited2.svg', svg.replace(/crc32="[0-9a-f]+"/, 'crc32="00000000"'), /damaged.*checksum/i],
      ['a future format', 'future.svg', svg.replace('format="1"', 'format="2"'), /newer version of Sketch \(data format 2\)/i],
      ['a future design', 'future2.svg', withDesign(svg, { ...design, version: 99 }), /newer version of Sketch \(design version 99\)/i],
      ['an unknown encoding', 'enc.svg', svg.replace('encoding="base64"', 'encoding="rot13"'), /encoding/i],
      ['a design that does not load', 'bad.svg', withDesign(svg, { version: 2, name: 'x' }), /could not be opened: Missing sketches/i],
      ['data that is not JSON', 'text.svg', svg.replace(METADATA, `\n  ${rawMarkup('this is not a design')}`), /could not be opened: Not valid JSON/i],
      ['a design with a dangling curve', 'dangling.svg', withDesign(svg, (() => {
        const d = JSON.parse(JSON.stringify(design)) as Design;
        const sketch = d.sketches[d.order[0]];
        const line = Object.values(sketch.curves).find((c) => c.type === 'line');
        if (line?.type === 'line') line.a = 'nowhere';
        return d;
      })()), /could not be opened: .*nowhere/i],
      ['plain text in an .svg', 'notes.svg', 'just some words, not markup', /not a valid SVG/i],
      ['JSON in an .svg', 'project.svg', JSON.stringify(design), /not a valid SVG/i],
      ['a broken tag', 'broken.svg', '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>', /not a valid SVG/i],
      ['XML that is not SVG', 'other.svg', '<html xmlns="http://www.w3.org/1999/xhtml"><body>hi</body></html>', /not a valid SVG/i],
      ['an entity declaration', 'entity.svg', '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg"><title>&b;</title></svg>', /entities/i],
      ['an empty file', 'empty.svg', '', /not a valid SVG/i],
      ['a project file with something wrong', 'x.sketch.json', 'not json', /Not valid JSON/],
    ];
    for (const [what, name, content, message] of cases) {
      await openFile(u, name, content);
      expect(await noteOf(u), what).toMatch(message);
      expect(await u.design(), what).toEqual(design);
      await expect(page.locator('.sketch-row'), what).toHaveCount(1);
      await expect(page.locator('.dialog'), what).toHaveCount(0);
    }
  });

  test('an older design in a file goes through the existing migration', async ({ page }) => {
    const u = new SketchUser(page);
    await u.open();
    const { svg, design } = await simpleSvg(u);
    const old = JSON.parse(JSON.stringify(design)) as Record<string, unknown> & Design;
    old.version = 1 as never;
    delete (old as Partial<Design>).layers;
    delete (old as Partial<Design>).activeLayer;
    for (const s of Object.values(old.sketches)) {
      // A version 1 sketch names its plane: frames came with version 3.
      delete (s as Partial<Sketch>).frame;
      (s as unknown as { plane: string }).plane = 'XY';
      for (const c of Object.values(s.curves)) delete (c as { layer?: string }).layer;
      for (const p of Object.values(s.points)) delete p.layer;
    }
    await fileMenu(u, 'New');
    await letGo(u);
    await expect(page.locator('.sketch-row')).toHaveCount(0);
    await openFile(u, 'old.svg', withDesign(svg, old));
    expect(await noteOf(u)).toBe('');
    const opened = await u.design();
    expect(opened.version).toBe(3);
    expect(opened.layers.map((l) => l.name)).toEqual(['Layer 1']);
    expect(Object.values(opened.sketches[opened.order[0]].curves).every((c) => c.layer === 'layer-1')).toBe(true);
    await expect(page.locator('.sketch-row')).toHaveCount(1);
  });
});

test.describe('an opened svg is untrusted input', () => {
  const evil = 'http://evil.test';
  const hostile = (): string => `<?xml-stylesheet href="${evil}/sheet.css" type="text/css"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="window.__pwned = 'root onload'" onclick="window.__pwned = 'root click'" width="10mm" height="10mm" viewBox="0 0 10 10">
  <script>window.__pwned = 'inline script'; fetch('${evil}/fetch'); document.title = 'pwned'</script>
  <script href="${evil}/script.js"/>
  <script xlink:href="${evil}/script2.js"/>
  <style>@import url(${evil}/import.css); rect { fill: url(${evil}/paint.svg#p); background: url(${evil}/bg.png) }</style>
  <image href="${evil}/image.png" xlink:href="${evil}/image2.png" onload="window.__pwned = 'image'" onerror="window.__pwned = 'image error'"/>
  <use href="${evil}/use.svg#a" xlink:href="${evil}/use2.svg#a" onload="window.__pwned = 'use'"/>
  <a href="javascript:window.__pwned = 'link'"><rect width="9" height="9" onmouseover="window.__pwned = 'rect'" onfocus="window.__pwned = 'focus'" style="fill:url(${evil}/f.svg)"/></a>
  <feImage href="${evil}/fe.png"/>
  <foreignObject width="9" height="9"><div xmlns="http://www.w3.org/1999/xhtml"><iframe src="${evil}/frame.html"></iframe><img src="${evil}/i.png" onerror="window.__pwned = 'img'" onload="window.__pwned = 'img'"/><script>window.__pwned = 'html script'</script></div></foreignObject>
  <animate attributeName="href" to="javascript:window.__pwned = 'animate'" begin="0s"/>
  <set attributeName="onload" to="window.__pwned = 'set'"/>
  METADATA
</svg>
`;

  /** Records every request to the made-up host, and answers it, so that a fetch shows as a hit and not as a console error. */
  async function watch(page: Page): Promise<string[]> {
    const hits: string[] = [];
    await page.route(`${evil}/**`, async (route) => {
      hits.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    });
    page.on('request', (r) => { if (r.url().includes('evil.test')) hits.push(`seen ${r.url()}`); });
    return hits;
  }

  test('the probes would see a script, a handler and a fetch', async ({ page }) => {
    const u = new SketchUser(page);
    await u.open();
    const hits = await watch(page);
    await page.evaluate((host) => {
      const d = document.createElement('div');
      d.innerHTML = `<img src="${host}/i.png" onerror="window.__pwned = 'img'" onload="window.__pwned = 'img'">`;
      document.body.append(d);
    }, evil);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBe('img');
    expect(hits.length).toBeGreaterThan(0);
  });

  for (const withData of [false, true]) {
    test(`${withData ? 'with' : 'without'} valid data nothing runs and nothing is fetched`, async ({ page }) => {
      const u = new SketchUser(page);
      await u.open();
      const { svg, design } = await simpleSvg(u);
      const hits = await watch(page);
      const scripts = await page.evaluate(() => document.scripts.length);
      const embedded = await page.evaluate(() => document.querySelectorAll('iframe, image, use, foreignObject, feImage, svg[onload]').length);
      const title = await page.title();
      const file = hostile().replace('METADATA', withData ? dataMarkup(design) : '');
      expect(file).toContain(withData ? 'sketch:design' : '<script>');
      expect(svg).toContain('sketch:design');

      // A fresh design, so that opening is seen to do something.
      await fileMenu(u, 'New');
      await letGo(u);
      await expect(page.locator('.sketch-row')).toHaveCount(0);
      const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
      await openFile(u, 'hostile.svg', file);
      await page.waitForTimeout(500);
      if (withData) {
        expect(await u.design()).toEqual(design);
        expect(await noteOf(u)).toBe('');
      } else {
        expect(await noteOf(u)).toMatch(/no editable data/i);
        await expect(page.locator('.sketch-row')).toHaveCount(0);
      }
      expect(await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBeUndefined();
      expect(hits).toEqual([]);
      expect(await page.title()).toBe(title);
      expect(await page.evaluate(() => document.scripts.length)).toBe(scripts);
      expect(await page.evaluate(() => document.querySelectorAll('iframe, image, use, foreignObject, feImage, svg[onload]').length)).toBe(embedded);
      expect(await page.evaluate(() => document.documentElement.outerHTML.includes('evil.test'))).toBe(false);
      if (!withData) expect(await page.evaluate(() => document.querySelectorAll('*').length)).toBe(nodes);
    });
  }
});

test.describe('another tool re-formats the file', () => {
  test('xmllint, a pretty-printing Python pass and a canonical rewrite leave the design openable', async ({ page }, info) => {
    const u = new SketchUser(page);
    await u.open();
    const { svg, design } = await simpleSvg(u);
    // Squeezed onto one line first, as another tool might have left it, so that every pass has something to change.
    const squeezed = svg.replace(/>\s+</g, '><');
    expect(squeezed).not.toBe(svg);
    const source = info.outputPath('source.svg');
    writeFileSync(source, squeezed);
    const python = `import sys, xml.dom.minidom; sys.stdout.write(xml.dom.minidom.parse(sys.argv[1]).toprettyxml(indent='      '))`;
    const passes: [string, () => string][] = [];
    if (has('xmllint')) {
      passes.push(['xmllint --format', () => execFileSync('xmllint', ['--format', source], { encoding: 'utf8' })]);
      passes.push(['xmllint --c14n', () => execFileSync('xmllint', ['--c14n', source], { encoding: 'utf8' })]);
    }
    if (has('python3')) passes.push(['python3 minidom toprettyxml', () => execFileSync('python3', ['-I', '-c', python, source], { encoding: 'utf8' })]);
    const tools = [...['xmllint', 'python3', 'rsvg-convert', 'inkscape'].map((t) => `${t}: ${has(t) ? 'available' : 'not installed'}`)];
    info.annotations.push({ type: 'tools', description: tools.join(', ') });
    console.log(`reformatting tools: ${tools.join(', ')}`);
    expect(passes.length, 'at least one re-formatter is needed').toBeGreaterThan(0);

    for (const [name, run] of passes) {
      const out = run();
      expect(out, name).not.toBe(squeezed);
      expect(out, name).toContain('sketch:design');
      // An empty design first, so that the open is seen to do the restoring.
      await fileMenu(u, 'New');
      await letGo(u);
      await expect(page.locator('.sketch-row')).toHaveCount(0);
      await openFile(u, 'reformatted.svg', out);
      expect(await noteOf(u), name).toBe('');
      expect(await u.design(), name).toEqual(design);
    }
  });

  test('a viewer draws the file the same with the data as without', async ({ page }, info) => {
    test.skip(!has('rsvg-convert'), 'rsvg-convert is not installed');
    const u = new SketchUser(page);
    await u.open();
    await u.newSketch();
    await simpleDesign(u);
    await finishSketch(u);
    const withData = info.outputPath('with.svg');
    const without = info.outputPath('without.svg');
    writeFileSync(withData, await saveSvg(u));
    writeFileSync(without, await saveSvg(u, { data: false }));
    const render = (file: string): Buffer => execFileSync('rsvg-convert', ['-f', 'png', file]);
    const a = render(withData);
    expect(a.length).toBeGreaterThan(100);
    expect(a.equals(render(without))).toBe(true);
    // rsvg writes a new SVG of its own, which is a viewer's export and not an edit of ours: what happens to the data is recorded.
    const rewritten = info.outputPath('rewritten.svg');
    writeFileSync(rewritten, execFileSync('rsvg-convert', ['-f', 'svg', withData]));
    const text = readFileSync(rewritten, 'utf8');
    await openFile(u, 'rewritten.svg', text);
    const note = await noteOf(u);
    console.log(`rsvg-convert -f svg keeps the data: ${text.includes('sketch:design')}; File > Open says: ${note || '(opened)'}`);
    expect(text.includes('sketch:design') ? note === '' : /no editable data/i.test(note)).toBe(true);
  });
});

test.describe('after opening an svg', () => {
  test('the name, File > Save, autosave and unsaved work go as they do for a project file', async ({ browser, baseURL }) => {
    const seed = await newPage(browser, baseURL);
    let svg: string;
    let design: Design;
    try {
      ({ svg, design } = await simpleSvg(seed.u));
    } finally {
      await seed.close();
    }
    const renamed = { ...design, name: 'Größe 🙂 part' };
    const files: Record<string, [string, string]> = {
      svg: ['named.svg', withDesign(svg, renamed)],
      project: ['named.sketch.json', JSON.stringify(renamed, null, 2)],
    };
    const seen: Record<string, unknown> = {};
    for (const [kind, [name, content]] of Object.entries(files)) {
      const p = await newPage(browser, baseURL);
      try {
        const v = p.u;
        // Unsaved work: the open asks, and with Don't Save does not keep it, for either kind of file.
        await v.newSketch();
        await lineChain(v, { x: -20, y: -20 }, { x: 20, y: 30 });
        await finishSketch(v);
        const unsaved = await v.design();
        await openFile(v, name, content);
        await expect(p.u.page.locator('.dialog')).toHaveCount(0);
        const opened = await v.design();
        expect(opened).toEqual(renamed);
        expect(opened).not.toEqual(unsaved);
        expect(await v.page.evaluate(() => window.__sketch.canUndo)).toBe(false);
        const title = await v.page.locator('.doc-title').first().textContent();

        const saved = await saveProject(v);
        expect(JSON.parse(saved.text)).toEqual(renamed);
        await v.page.evaluate(() => window.__sketch.flushAutosave());
        const stored = await v.page.evaluate(() => localStorage.getItem('sketch.autosave'));
        expect(JSON.parse(stored as string)).toEqual(renamed);
        await v.page.reload();
        await v.page.waitForFunction(() => !!window.__sketch);
        expect(await v.design()).toEqual(renamed);
        seen[kind] = { title, file: saved.name, text: saved.text, stored };
        expect(title).toContain('Größe 🙂 part');
        expect(saved.name).toBe(`${renamed.name.replace(/[^\w.-]+/g, '_')}.sketch.json`);
        expect(p.errors).toEqual([]);
      } finally {
        await p.close();
      }
    }
    expect(seen.svg).toEqual(seen.project);
  });
});
