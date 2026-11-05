// A design comes back as it was left, whatever shape it is in. An outline crossed by a value is a legal state,
// so it reloads, saves and opens like any other and can be edited back to simple. And whatever goes wrong on
// the way in, the app comes up and the saved work stays where it was. docs/AUDIT.md, round 7.
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { SketchUser, type Xy } from './helpers';
import { addConstraint, addDimension, addFitSpline, addLine, newDesign, newSketch } from '../src/model/document';
import { addLayer } from '../src/model/layers';
import { crossesItself, facesOf } from '../src/solver/faces';
import type { Design, Line, Sketch } from '../src/model/types';

const NEW_NOTE = 'could not be restored';

/** Everything the page threw or logged as an error. */
const watch = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
};

const chain = (d: Design, s: Sketch, pts: Xy[], closed = true): Line[] => {
  const n = closed ? pts.length : pts.length - 1;
  const ls = Array.from({ length: n }, (_, i) => addLine(d, s, pts[i], pts[(i + 1) % pts.length]));
  ls.forEach((l, i) => {
    if (i + 1 < n || closed) addConstraint(d, s, 'coincident', [l.b, ls[(i + 1) % n].a]);
  });
  return ls;
};

interface Scene { name: string; design: Design; cross: [string, number][]; back: [string, number][] }

function pulley(): Scene {
  const d = newDesign();
  const s = newSketch(d);
  const [v1, v2, rimR, wallR, base, wallL, rimL] = chain(d, s, [
    { x: -17, y: 33 }, { x: 0, y: 16 }, { x: 17, y: 33 }, { x: 29, y: 33 }, { x: 29, y: 0 }, { x: -29, y: 0 }, { x: -29, y: 33 },
  ]);
  for (const [t, l] of [['horizontal', rimR], ['vertical', wallR], ['horizontal', base], ['vertical', wallL], ['horizontal', rimL]] as const) addConstraint(d, s, t, [l.id]);
  addConstraint(d, s, 'equal', [v1.id, v2.id]);
  addConstraint(d, s, 'perpendicular', [v1.id, v2.id]);
  addConstraint(d, s, 'equal', [wallL.id, wallR.id]);
  addConstraint(d, s, 'midpoint', ['origin', base.id]);
  addConstraint(d, s, 'collinear', [rimL.id, rimR.id]);
  addDimension(d, s, 'distance', [base.a, base.b], 58, { name: 'B' });
  addDimension(d, s, 'distance', [wallR.a, wallR.b], 33, { name: 'h' });
  addDimension(d, s, 'distance', [v1.a, v2.b], 34, { name: 'g' });
  return { name: 'pulley', design: d, cross: [['B', 24]], back: [['B', 58]] };
}

function quad(): Scene {
  const d = newDesign();
  const s = newSketch(d);
  const q = [{ x: -5, y: -57 }, { x: 50, y: -26 }, { x: 22, y: 48 }, { x: -26, y: 8 }];
  const [a, b] = chain(d, s, q);
  addDimension(d, s, 'distance', [a.a, a.b], Math.hypot(55, 31), { name: 'A' });
  addDimension(d, s, 'distance', [b.a, b.b], Math.hypot(28, 74), { name: 'L' });
  return { name: 'quad', design: d, cross: [['L', 107], ['A', 50.1], ['L', 171.2], ['A', 35.1], ['L', 274]], back: [['L', 171.2], ['A', 50.1], ['L', 107], ['A', 63], ['L', 79]] };
}

function splineOutline(): Scene {
  const d = newDesign();
  const s = newSketch(d);
  const [left, bottom, wall] = chain(d, s, [{ x: 0, y: 30 }, { x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 30 }], false);
  addConstraint(d, s, 'coincident', [left.b, 'origin']);
  const fit = addFitSpline(d, s, [{ x: 70, y: 30 }, { x: 45, y: 46 }, { x: 25, y: 16 }, { x: 0, y: 30 }]);
  addConstraint(d, s, 'coincident', [wall.b, fit.pts[0]]);
  addConstraint(d, s, 'coincident', [fit.pts[fit.pts.length - 1], left.a]);
  addConstraint(d, s, 'vertical', [wall.id]);
  addConstraint(d, s, 'vertical', [left.id]);
  addConstraint(d, s, 'horizontal', [bottom.id]);
  addDimension(d, s, 'distance', [bottom.a, bottom.b], 70, { name: 'W' });
  addDimension(d, s, 'distance', [wall.a, wall.b], 30, { name: 'h' });
  return { name: 'spline outline', design: d, cross: [['W', 25]], back: [['W', 70]] };
}

function bowTie(): Design {
  const d = newDesign();
  const s = newSketch(d);
  const [, b] = chain(d, s, [{ x: -30, y: -20 }, { x: 30, y: 20 }, { x: 30, y: -20 }, { x: -30, y: 20 }]);
  addDimension(d, s, 'distance', [b.a, b.b], 40, { name: 'L' });
  return d;
}

const file = async (u: SketchUser, label: string): Promise<void> => {
  await u.page.locator('[data-menu="file"]').click();
  await u.settle();
  await u.page.locator(`.menu-item[data-item="${label}"]`).first().click();
  await u.settle();
};

const openFile = async (u: SketchUser, name: string, content: string): Promise<void> => {
  const [chooser] = await Promise.all([u.page.waitForEvent('filechooser'), (async () => {
    await file(u, 'Open...');
    // Unsaved work asks before it is replaced: these tests mean to replace it.
    const ask = u.page.locator('[data-dialog="Unsaved Changes"]');
    if (await ask.count()) await ask.getByRole('button', { name: "Don't Save" }).click();
  })()]);
  await chooser.setFiles({ name, mimeType: name.endsWith('.svg') ? 'image/svg+xml' : 'application/json', buffer: Buffer.from(content, 'utf8') });
  await u.page.waitForTimeout(300);
  await u.settle();
};

const saveProject = async (u: SketchUser): Promise<string> => {
  const [download] = await Promise.all([u.page.waitForEvent('download'), file(u, 'Save')]);
  return readFileSync(await download.path(), 'utf8');
};

const saveSvg = async (u: SketchUser): Promise<string> => {
  await file(u, 'Save as SVG...');
  await u.page.locator('[data-dialog="Save as SVG"]').getByRole('button', { name: 'OK' }).click();
  await u.settle();
  const [download] = await Promise.all([
    u.page.waitForEvent('download'),
    u.page.locator('[data-dialog="Save SVG"]').getByRole('button', { name: 'Save' }).click(),
  ]);
  return readFileSync(await download.path(), 'utf8');
};

const editSketch = async (u: SketchUser): Promise<void> => {
  if (await u.page.evaluate(() => window.__sketch.mode) === 'sketch') return;
  await u.page.locator('.sketch-row').first().dblclick();
  await expect(u.page.locator('.tab.active')).toHaveText('SKETCH');
  await u.settle();
};

const setValue = async (u: SketchUser, name: string, value: number): Promise<void> => {
  await u.page.locator('.panel[data-panel="modify"] .panel-name').click();
  await u.page.locator('.menu-item[data-item="Change Parameters"]').click();
  await u.settle();
  const d: Locator = u.page.locator('[data-dialog="Parameters"]');
  const inputs = d.locator('input');
  let row = -1;
  for (let i = 0; i < await inputs.count(); i++) if (await inputs.nth(i).inputValue() === name) row = i;
  expect(row).toBeGreaterThanOrEqual(0);
  await inputs.nth(row + 1).click();
  await u.page.keyboard.press('ControlOrMeta+a');
  await u.page.keyboard.type(String(value));
  await u.page.keyboard.press('Tab');
  await u.settle();
  await d.locator('.btn.primary').click();
  await u.settle();
  await u.press('Escape');
};

const crossed = async (u: SketchUser): Promise<boolean> => {
  const d = await u.design();
  return d.order.some((id) => facesOf(d.sketches[id]).some((f) => crossesItself(d.sketches[id], f)));
};

/** The texts in the rescued list, newest first. */
const rescuedText = (page: Page): Promise<(string | null)[]> => page.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('sketch.rescued') ?? '[]') as { id: string }[];
  return list.map((e) => localStorage.getItem(`sketch.rescued.${e.id}`));
});

const note = (u: SketchUser): Promise<string> => u.page.evaluate(() => window.__sketch.note);

/** The whole of the UI, not the half that was built when something threw. */
const uiIsUp = async (u: SketchUser): Promise<void> => {
  await u.page.waitForFunction(() => !!window.__sketch, null, { timeout: 8000 });
  await expect(u.page.locator('[data-menu="file"]')).toBeVisible();
  if (await u.page.evaluate(() => window.__sketch.mode) === 'sketch') await expect(u.page.locator('.tab.active')).toHaveText('SKETCH');
  else await expect(u.page.getByRole('button', { name: 'Create Sketch' }).first()).toBeVisible();
};

/** Open a scene, then cross it through the UI as a user would. */
const crossedBy = async (page: Page, scene: Scene): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  await openFile(u, 'scene.sketch.json', JSON.stringify(scene.design));
  await editSketch(u);
  for (const [name, v] of scene.cross) await setValue(u, name, v);
  expect(await crossed(u)).toBe(true);
  return u;
};

const editedBack = async (u: SketchUser, scene: Scene): Promise<void> => {
  await editSketch(u);
  for (const [name, v] of scene.back) await setValue(u, name, v);
  expect(await crossed(u)).toBe(false);
  expect(await note(u)).not.toContain('crosses itself');
};

test.describe('a crossed outline comes back', () => {
  for (const make of [pulley, quad, splineOutline]) {
    const scene = make();
    test(`${scene.name}: reload, twice, then edit it back to simple`, async ({ page }) => {
      const errors = watch(page);
      const u = await crossedBy(page, make());
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => window.__sketch.flushAutosave());
        await page.reload();
        await uiIsUp(u);
        expect(await crossed(u)).toBe(true);
      }
      await editedBack(u, make());
      expect(errors).toEqual([]);
    });

    test(`${scene.name}: save a project, open it in a new tab, then edit it back to simple`, async ({ page, browser, baseURL }) => {
      const u = await crossedBy(page, make());
      const text = await saveProject(u);
      // A new browser profile, so what is opened is the file and not the autosave this tab left behind.
      const tab = await (await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })).newPage();
      const errors = watch(tab);
      const v = new SketchUser(tab);
      await v.open();
      await uiIsUp(v);
      await openFile(v, 'crossed.sketch.json', text);
      await uiIsUp(v);
      expect(await crossed(v)).toBe(true);
      await editedBack(v, make());
      expect(errors).toEqual([]);
    });

    test(`${scene.name}: save an SVG, open it in a new tab, then edit it back to simple`, async ({ page, browser, baseURL }) => {
      const u = await crossedBy(page, make());
      const text = await saveSvg(u);
      // A new browser profile, so what is opened is the file and not the autosave this tab left behind.
      const tab = await (await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })).newPage();
      const errors = watch(tab);
      const v = new SketchUser(tab);
      await v.open();
      await uiIsUp(v);
      await openFile(v, 'crossed.svg', text);
      await uiIsUp(v);
      expect(await crossed(v)).toBe(true);
      await editedBack(v, make());
      expect(errors).toEqual([]);
    });
  }

  test('opening one says nothing about commits nobody made', async ({ page }) => {
    const errors = watch(page);
    const u = await crossedBy(page, pulley());
    const text = await saveProject(u);
    await page.evaluate(() => window.__sketch.flushAutosave());
    await page.reload();
    await uiIsUp(u);
    expect(await note(u)).toBe('');
    await openFile(u, 'crossed.sketch.json', text);
    expect(await note(u)).toBe('');
    expect(errors).toEqual([]);
  });

  test('a note from opening is shown once, and looking at the sketch does not bring it back', async ({ page }) => {
    const errors = watch(page);
    const u = await crossedBy(page, pulley());
    const saved = JSON.parse(await saveProject(u)) as Design;
    const s = Object.values(saved.sketches)[0];
    s.constraints.gone = { id: 'gone', type: 'coincident', refs: ['nothing', 'nowhere'] } as unknown as Sketch['constraints'][string];
    await openFile(u, 'dangling.sketch.json', JSON.stringify(saved));
    expect(await note(u)).toContain('Dropped constraint gone');
    await page.waitForFunction(() => window.__sketch.note === '', null, { timeout: 7000 });
    await editSketch(u);
    await u.move({ x: 5, y: 5 });
    await u.settle();
    expect(await u.analysis()).toBeTruthy();
    expect(await note(u)).toBe('');
    expect(errors).toEqual([]);
  });
});

test.describe('a bow tie drawn that way', () => {
  test('every value edit says it still crosses, the first as well', async ({ page }) => {
    const errors = watch(page);
    const u = new SketchUser(page);
    await u.open();
    await openFile(u, 'bow.sketch.json', JSON.stringify(bowTie()));
    await editSketch(u);
    expect(await crossed(u)).toBe(true);
    for (const v of [60, 70, 55]) {
      await setValue(u, 'L', v);
      expect(await note(u)).toContain('still crosses itself');
    }
    expect(errors).toEqual([]);
  });
});

test.describe('whatever goes wrong on the way in', () => {
  /** Throws from inside the swap to a stored design, once, at boot: the page has no handle yet. */
  const breakBoot = (page: Page): Promise<unknown> => page.addInitScript(() => {
    const real = window.structuredClone;
    window.structuredClone = ((v: unknown, o?: StructuredSerializeOptions) => {
      const sketches = (v as { sketches?: object } | null)?.sketches;
      if (sessionStorage.getItem('break') && !window.__sketch && sketches && Object.keys(sketches).length) {
        sessionStorage.removeItem('break');
        throw new Error('broken on purpose');
      }
      return real(v, o);
    }) as typeof structuredClone;
  });

  test('a throw while restoring the autosave leaves a working UI and the autosave in place', async ({ page }) => {
    const errors = watch(page);
    await breakBoot(page);
    const u = await crossedBy(page, quad());
    await page.evaluate(() => window.__sketch.flushAutosave());
    const before = await page.evaluate(() => localStorage.getItem('sketch.autosave'));
    expect(before).toBeTruthy();
    await page.evaluate(() => sessionStorage.setItem('break', '1'));
    await page.reload();
    await uiIsUp(u);
    expect(await note(u)).toContain(NEW_NOTE);
    expect((await u.design()).order).toEqual([]);
    // Nothing the empty design does on its way out may reach the stored one.
    await page.evaluate(() => window.__sketch.flushAutosave());
    expect(await page.evaluate(() => localStorage.getItem('sketch.autosave'))).toBe(before);
    expect(await rescuedText(page)).toEqual([before]);
    // The tools work, and what was there comes back once whatever broke has gone.
    await u.newSketch();
    await u.tool('Line');
    await u.press('Escape');
    expect(errors.filter((e) => !e.includes('broken on purpose'))).toEqual([]);
    await page.evaluate(() => window.__sketch.flushAutosave());
    await page.evaluate(() => localStorage.setItem('sketch.autosave', localStorage.getItem(`sketch.rescued.${JSON.parse(localStorage.getItem('sketch.rescued') as string)[0].id}`) as string));
    await page.goto('about:blank');
    await page.goto('/');
    await uiIsUp(u);
    expect(await crossed(u)).toBe(true);
  });

  test('an autosave that no longer reads is not written over', async ({ page }) => {
    const errors = watch(page);
    const u = new SketchUser(page);
    await u.open();
    await page.evaluate(() => localStorage.setItem('sketch.autosave', '{"version":999,"unfinished'));
    await page.reload();
    await uiIsUp(u);
    expect(await note(u)).toContain(NEW_NOTE);
    await page.evaluate(() => window.__sketch.flushAutosave());
    await page.reload();
    await uiIsUp(u);
    expect(await page.evaluate(() => localStorage.getItem('sketch.autosave'))).toBe('{"version":999,"unfinished');
    expect(errors.filter((e) => !e.includes('no longer validates'))).toEqual([]);
  });

  test('a throw while opening a file keeps the design that was open', async ({ page }) => {
    const errors = watch(page);
    const u = await crossedBy(page, pulley());
    const was = (await u.design()).order;
    const text = JSON.stringify(quad().design);
    await page.evaluate(() => {
      const real = window.structuredClone;
      window.structuredClone = ((v: unknown, o?: StructuredSerializeOptions) => {
        window.structuredClone = real;
        void v;
        void o;
        throw new Error('broken on purpose');
      }) as typeof structuredClone;
    });
    await openFile(u, 'quad.sketch.json', text);
    await uiIsUp(u);
    expect(await note(u)).toContain('could not be opened');
    expect((await u.design()).order).toEqual(was);
    await editSketch(u);
    await setValue(u, 'B', 58);
    expect(errors.filter((e) => !e.includes('broken on purpose'))).toEqual([]);
  });
});

test.describe('the Parameters dialog', () => {
  const withParameter = async (page: Page): Promise<{ u: SketchUser; d: Locator }> => {
    const design = newDesign();
    const s = newSketch(design);
    addLine(design, s, { x: 0, y: 0 }, { x: 40, y: 0 });
    design.parameters.push({ name: 'a', expression: '10', value: 10, comment: '', unit: 'mm' }, { name: 'b', expression: '20', value: 20, comment: '', unit: 'mm' });
    const u = new SketchUser(page);
    await u.open();
    await openFile(u, 'params.sketch.json', JSON.stringify(design));
    await editSketch(u);
    await u.page.locator('.panel[data-panel="modify"] .panel-name').click();
    await u.page.locator('.menu-item[data-item="Change Parameters"]').click();
    await u.settle();
    return { u, d: page.locator('[data-dialog="Parameters"]') };
  };

  test('deleting the row with a bad expression clears the error and OK works', async ({ page }) => {
    const errors = watch(page);
    const { u, d } = await withParameter(page);
    const row = d.locator('.param-row[data-param="a"]');
    await row.locator('input').nth(1).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('1+');
    await page.keyboard.press('Tab');
    await u.settle();
    await expect(d.locator('.btn.primary')).toBeDisabled();
    await row.locator('.param-delete').click();
    await u.settle();
    await expect(d.locator('.param-delete')).toHaveCount(1);
    await expect(d).not.toContainText('Unexpected end of expression');
    await expect(d.locator('.btn.primary')).toBeEnabled();
    await d.locator('.btn.primary').click();
    await u.settle();
    await expect(d).toHaveCount(0);
    expect((await u.design()).parameters.map((p) => p.name)).toEqual(['b']);
    expect(errors).toEqual([]);
  });

  test('Delete then Cancel leaves everything as it was and no Undo step', async ({ page }) => {
    const errors = watch(page);
    const { u, d } = await withParameter(page);
    expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(false);
    await d.locator('.param-row[data-param="a"] .param-delete').click();
    await u.settle();
    await d.locator('.btn', { hasText: 'Cancel' }).click();
    await u.settle();
    await expect(d).toHaveCount(0);
    expect((await u.design()).parameters.map((p) => p.name)).toEqual(['a', 'b']);
    expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(false);
    expect(errors).toEqual([]);
  });
});

test.describe('a dimension on a locked layer', () => {
  test('a parameter that cannot reach the geometry says the layer holds it', async ({ page }) => {
    const errors = watch(page);
    const design = newDesign();
    const s = newSketch(design);
    const layer = addLayer(design);
    const l = addLine(design, s, { x: 0, y: 0 }, { x: 50, y: 0 });
    design.activeLayer = design.layers[design.layers.length - 1].id;
    addDimension(design, s, 'distance', [l.a, l.b], 50, { name: 'd1', expression: 'p' });
    design.parameters.push({ name: 'p', expression: '50', value: 50, comment: '', unit: 'mm' });
    layer.locked = true;
    const u = new SketchUser(page);
    await u.open();
    await openFile(u, 'locked.sketch.json', JSON.stringify(design));
    await editSketch(u);
    await page.locator('.panel[data-panel="modify"] .panel-name').click();
    await page.locator('.menu-item[data-item="Change Parameters"]').click();
    await u.settle();
    const d = page.locator('[data-dialog="Parameters"]');
    await d.locator('.param-row[data-param="p"] input').nth(1).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('60');
    await page.keyboard.press('Tab');
    await u.settle();
    await d.locator('.btn.primary').click();
    await u.settle();
    const said = await note(u);
    expect(said).toContain(`Layer "${layer.name}" is locked`);
    expect(said).not.toContain('Over-constrained');
    expect(errors).toEqual([]);
  });
});
