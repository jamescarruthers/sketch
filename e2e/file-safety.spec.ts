// A design is not thrown away by accident: unsaved changes ask first, a failed open changes nothing, and an autosave
// that cannot be restored is kept in a list that can be opened, downloaded and cleared. docs/AUDIT.md, round 8.
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { SketchUser } from './helpers';
import { addLine, newDesign, newSketch } from '../src/model/document';
import { serialize } from '../src/io/project';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { errors: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  const errors = (page as unknown as { errors: string[] }).errors.filter((e) => !e.includes('broken on purpose') && !e.includes('no longer validates'));
  expect(errors).toEqual([]);
});

const started = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  return u;
};

const line = async (u: SketchUser, a = { x: 0, y: 0 }, b = { x: 40, y: 0 }): Promise<void> => {
  await u.press('l');
  await u.click(a);
  await u.click(b);
  await u.press('Escape');
  await u.press('Escape');
};

/** A sketch with one line, drawn: dirty. */
const drawn = async (page: Page): Promise<SketchUser> => {
  const u = await started(page);
  await u.newSketch();
  await line(u);
  return u;
};

const dirty = (page: Page): Promise<boolean> => page.evaluate(() => window.__sketch.dirty);
const dlg = (page: Page, title: string): Locator => page.locator(`[data-dialog="${title}"]`);

const fileMenu = async (u: SketchUser, label: string): Promise<void> => {
  await u.page.locator('[data-menu="file"]').click();
  await u.settle();
  await u.page.locator(`.menu-item[data-item="${label}"]`).first().click();
  await u.settle();
};

/** Counts file choosers, so a test can tell "none was asked for" from "not yet". */
const watchChoosers = (page: Page): { count: number } => {
  const seen = { count: 0 };
  page.on('filechooser', () => { seen.count++; });
  return seen;
};

const project = (name: string, y = 0): string => {
  const d = newDesign(name);
  const s = newSketch(d);
  addLine(d, s, { x: 0, y }, { x: 25, y });
  return serialize(d);
};

const pick = async (u: SketchUser, name: string, content: string): Promise<void> => {
  const [chooser] = await Promise.all([u.page.waitForEvent('filechooser'), fileMenu(u, 'Open...')]);
  await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content, 'utf8') });
  await u.page.waitForTimeout(250);
  await u.settle();
};

/** File > New, answering Don't Save. */
const dlgSkip = async (page: Page): Promise<void> => {
  await page.locator('[data-menu="file"]').click();
  await page.locator('.menu-item[data-item="New"]').first().click();
  await dlg(page, 'Unsaved Changes').getByRole('button', { name: "Don't Save" }).click();
  await page.waitForTimeout(100);
};

const note = (page: Page): Promise<string> => page.evaluate(() => window.__sketch.note);

test.describe('unsaved changes', () => {
  test('a new session is clean, any change makes it dirty, and Open then asks', async ({ page }) => {
    const u = await started(page);
    const choosers = watchChoosers(page);
    expect(await dirty(page)).toBe(false);
    await u.newSketch();
    expect(await dirty(page)).toBe(true);
    await fileMenu(u, 'Open...');
    const d = dlg(page, 'Unsaved Changes');
    await expect(d).toBeVisible();
    await expect(d.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(d.getByRole('button', { name: "Don't Save" })).toBeVisible();
    await expect(d.locator('.btn', { hasText: 'Cancel' })).toBeVisible();
    expect(choosers.count).toBe(0);
  });

  test('Cancel changes nothing: the design, the history and the dirty flag stay', async ({ page }) => {
    const u = await drawn(page);
    const choosers = watchChoosers(page);
    const before = await u.design();
    await fileMenu(u, 'Open...');
    await dlg(page, 'Unsaved Changes').locator('.btn', { hasText: 'Cancel' }).click();
    await u.settle();
    await expect(dlg(page, 'Unsaved Changes')).toHaveCount(0);
    expect(choosers.count).toBe(0);
    expect(await u.design()).toEqual(before);
    expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(true);
    expect(await dirty(page)).toBe(true);
  });

  test("Don't Save goes on to the file chooser and opens without saving", async ({ page }) => {
    const u = await drawn(page);
    const downloads: string[] = [];
    page.on('download', (dl) => downloads.push(dl.suggestedFilename()));
    await fileMenu(u, 'Open...');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      dlg(page, 'Unsaved Changes').getByRole('button', { name: "Don't Save" }).click(),
    ]);
    await chooser.setFiles({ name: 'a.sketch.json', mimeType: 'application/json', buffer: Buffer.from(project('Opened'), 'utf8') });
    await page.waitForTimeout(250);
    expect((await u.design()).name).toBe('Opened');
    expect(downloads).toEqual([]);
    expect(await dirty(page)).toBe(false);
  });

  test('Save downloads the design, then opens', async ({ page }) => {
    const u = await drawn(page);
    await fileMenu(u, 'Open...');
    const [download, chooser] = await Promise.all([
      page.waitForEvent('download'),
      page.waitForEvent('filechooser'),
      dlg(page, 'Unsaved Changes').getByRole('button', { name: 'Save', exact: true }).click(),
    ]);
    const saved = readFileSync(await download.path(), 'utf8');
    expect(JSON.parse(saved).sketches).toBeTruthy();
    expect(Object.keys(JSON.parse(saved).sketches)).toHaveLength(1);
    await chooser.setFiles({ name: 'a.sketch.json', mimeType: 'application/json', buffer: Buffer.from(project('After save'), 'utf8') });
    await page.waitForTimeout(250);
    expect((await u.design()).name).toBe('After save');
  });

  test('a design that was saved, opened or is new asks nothing', async ({ page }) => {
    const u = await drawn(page);
    const choosers = watchChoosers(page);
    await Promise.all([page.waitForEvent('download'), fileMenu(u, 'Save')]);
    expect(await dirty(page)).toBe(false);
    await pick(u, 'b.sketch.json', project('Second'));
    await expect(dlg(page, 'Unsaved Changes')).toHaveCount(0);
    expect(choosers.count).toBe(1);
    expect((await u.design()).name).toBe('Second');
    expect(await dirty(page)).toBe(false);
    // New, with something to lose or not, asks only when changed.
    await fileMenu(u, 'New');
    await expect(page.locator('.dialog')).toHaveCount(0);
    expect(Object.keys((await u.design()).sketches)).toHaveLength(0);
    expect(await dirty(page)).toBe(false);
  });

  test('a change after a save is dirty again, and Undo does not make it clean', async ({ page }) => {
    const u = await drawn(page);
    await Promise.all([page.waitForEvent('download'), fileMenu(u, 'Save')]);
    expect(await dirty(page)).toBe(false);
    await line(u, { x: 0, y: 10 }, { x: 30, y: 10 });
    expect(await dirty(page)).toBe(true);
    await page.keyboard.press('ControlOrMeta+z');
    await u.settle();
    expect(await dirty(page)).toBe(true);
  });

  test('a reload knows whether what it restores is saved', async ({ page }) => {
    const u = await drawn(page);
    await Promise.all([page.waitForEvent('download'), fileMenu(u, 'Save')]);
    await page.evaluate(() => window.__sketch.flushAutosave());
    await page.reload();
    await page.waitForFunction(() => !!window.__sketch);
    expect((await u.design()).order).toHaveLength(1);
    expect(await dirty(page)).toBe(false);
    await line(u, { x: 0, y: 12 }, { x: 30, y: 12 });
    await page.evaluate(() => window.__sketch.flushAutosave());
    await page.reload();
    await page.waitForFunction(() => !!window.__sketch);
    expect(await dirty(page)).toBe(true);
    // Opened or started new, it is saved by definition, and a reload says so too.
    await dlgSkip(page);
    await page.evaluate(() => window.__sketch.flushAutosave());
    await page.reload();
    await page.waitForFunction(() => !!window.__sketch);
    expect(await dirty(page)).toBe(false);
  });

  test('File > New and the + beside the name ask, and Cancel keeps the design', async ({ page }) => {
    const u = await drawn(page);
    const before = await u.design();
    await fileMenu(u, 'New');
    await expect(dlg(page, 'Unsaved Changes')).toBeVisible();
    await dlg(page, 'Unsaved Changes').locator('.btn', { hasText: 'Cancel' }).click();
    expect(await u.design()).toEqual(before);
    await page.getByRole('button', { name: 'New Design' }).click();
    await expect(dlg(page, 'Unsaved Changes')).toBeVisible();
    await dlg(page, 'Unsaved Changes').getByRole('button', { name: "Don't Save" }).click();
    await u.settle();
    expect(Object.keys((await u.design()).sketches)).toHaveLength(0);
    expect(await dirty(page)).toBe(false);
  });

  test('Save as SVG with the editable data clears it; without the data it does not', async ({ page }) => {
    const u = await drawn(page);
    const saveSvg = async (editable: boolean): Promise<void> => {
      await fileMenu(u, 'Save as SVG...');
      const d = dlg(page, 'Save as SVG');
      const box = d.locator('.form-row', { hasText: 'Include editable data' }).locator('input');
      if (editable) await box.check();
      else await box.uncheck();
      await d.getByRole('button', { name: 'OK' }).click();
      await u.settle();
      await Promise.all([page.waitForEvent('download'), dlg(page, 'Save SVG').getByRole('button', { name: 'Save' }).click()]);
      await u.settle();
    };
    await saveSvg(false);
    expect(await dirty(page)).toBe(true);
    await saveSvg(true);
    expect(await dirty(page)).toBe(false);
  });
});

test.describe('a failed open', () => {
  /** Two lines, then one Undo: there is something to undo and something to redo. */
  const withHistory = async (page: Page): Promise<SketchUser> => {
    const u = await started(page);
    await u.newSketch();
    await line(u, { x: 0, y: 0 }, { x: 40, y: 0 });
    await line(u, { x: 0, y: 10 }, { x: 40, y: 10 });
    await page.keyboard.press('ControlOrMeta+z');
    await u.settle();
    return u;
  };

  /** The SVG the app itself saves for a project, taken on a page of its own so that this one keeps its history. */
  const svgOf = async (page: Page, projectText: string): Promise<string> => {
    // A context of its own: this page's autosave must not reach the one that makes the file.
    const context = await (page.context().browser() as Browser).newContext({ baseURL: 'http://localhost:' + (process.env.E2E_PORT ?? 5199) });
    const other = await context.newPage();
    const v = await started(other);
    await pick(v, 'x.sketch.json', projectText);
    await other.locator('.sketch-row').first().dblclick();
    await fileMenu(v, 'Save as SVG...');
    await dlg(other, 'Save as SVG').getByRole('button', { name: 'OK' }).click();
    const [download] = await Promise.all([other.waitForEvent('download'), dlg(other, 'Save SVG').getByRole('button', { name: 'Save' }).click()]);
    const svg = readFileSync(await download.path(), 'utf8');
    await context.close();
    return svg;
  };

  /** Everything undo and redo would show, walked and walked back. */
  const walk = async (page: Page): Promise<unknown[]> => page.evaluate(async () => {
    const settle = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const key = (shift: boolean): void => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, ctrlKey: true, shiftKey: shift, bubbles: true }));
    };
    const seen: unknown[] = [window.__sketch.design()];
    let undone = 0;
    while (window.__sketch.canUndo) {
      key(false);
      await settle();
      seen.push(window.__sketch.design());
      undone++;
    }
    for (let i = 0; i < undone; i++) {
      key(true);
      await settle();
    }
    seen.push(window.__sketch.design());
    return seen;
  });

  const throwOnce = (page: Page, how: 'clone' | 'dom'): Promise<void> => page.evaluate((mode) => {
    if (mode === 'clone') {
      const real = window.structuredClone;
      window.structuredClone = ((_v: unknown, _o?: StructuredSerializeOptions) => {
        window.structuredClone = real;
        throw new Error('broken on purpose');
      }) as typeof structuredClone;
    } else {
      // Partway: after the design has been swapped, while the interface is told.
      const real = Element.prototype.replaceChildren;
      Element.prototype.replaceChildren = function replaceChildren(this: Element, ..._nodes: (Node | string)[]) {
        Element.prototype.replaceChildren = real;
        throw new Error('broken on purpose');
      };
    }
  }, how);

  for (const kind of ['project', 'svg'] as const) {
    for (const how of ['clone', 'dom'] as const) {
      test(`${kind} file, a throw ${how === 'clone' ? 'before the swap' : 'partway through'}: design, undo and redo are as they were`, async ({ page }) => {
        const u = await withHistory(page);
        const before = await u.design();
        const canRedo = await page.evaluate(() => window.__sketch.canRedo);
        expect(canRedo).toBe(true);
        const content = kind === 'project' ? project('Incoming') : await svgOf(page, project('Incoming'));
        // Arm after the dialog, so only the open itself meets the throw.
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser'),
          (async () => {
            await fileMenu(u, 'Open...');
            await dlg(page, 'Unsaved Changes').getByRole('button', { name: "Don't Save" }).click();
          })(),
        ]);
        await throwOnce(page, how);
        await chooser.setFiles({ name: kind === 'project' ? 'in.sketch.json' : 'in.svg', mimeType: kind === 'project' ? 'application/json' : 'image/svg+xml', buffer: Buffer.from(content, 'utf8') });
        await page.waitForTimeout(300);
        await u.settle();
        expect(await note(page)).toContain('could not be opened');
        expect(await u.design()).toEqual(before);
        expect(await page.evaluate(() => window.__sketch.mode)).toBe('sketch');
        expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(true);
        expect(await page.evaluate(() => window.__sketch.canRedo)).toBe(true);
        expect(await dirty(page)).toBe(true);
        const trail = await walk(page);
        // Undo steps back through the same two states it had, and Redo returns to where it was.
        expect(trail).toHaveLength(4);
        expect(trail[0]).toEqual(before);
        expect(Object.keys((trail[2] as { sketches: object }).sketches)).toHaveLength(0);
        expect(trail[trail.length - 1]).toEqual(before);
        // And the step that was undone before the open is still there to redo.
        await page.keyboard.press('ControlOrMeta+Shift+z');
        await u.settle();
        const after = await u.design();
        expect(Object.values(after.sketches).flatMap((s) => Object.keys(s.curves))).toHaveLength(2);
      });
    }
  }

  test('a file that does not parse changes nothing either', async ({ page }) => {
    const u = await withHistory(page);
    const before = await u.design();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      (async () => {
        await fileMenu(u, 'Open...');
        await dlg(page, 'Unsaved Changes').getByRole('button', { name: "Don't Save" }).click();
      })(),
    ]);
    await chooser.setFiles({ name: 'bad.sketch.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1', 'utf8') });
    await page.waitForTimeout(250);
    expect(await u.design()).toEqual(before);
    expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(true);
    expect(await page.evaluate(() => window.__sketch.canRedo)).toBe(true);
  });
});

test.describe('recovered designs', () => {
  const GARBAGE = (n: number): string => `{"version":999,"unfinished":${n}`;
  const rescued = (page: Page): Promise<{ id: string; at: number | null; size: number }[]> =>
    page.evaluate(() => JSON.parse(localStorage.getItem('sketch.rescued') ?? '[]'));

  /** Plant a stored design that cannot be restored and boot on it. */
  const bootOn = async (page: Page, stored: string): Promise<void> => {
    await page.evaluate((text) => localStorage.setItem('sketch.autosave', text), stored);
    await page.reload();
    await page.waitForFunction(() => !!window.__sketch);
  };

  test('each failed boot is kept as a copy of its own, newest first, with a time and a size', async ({ page }) => {
    await started(page);
    await bootOn(page, GARBAGE(1));
    await bootOn(page, GARBAGE(2));
    const list = await rescued(page);
    expect(list).toHaveLength(2);
    expect(list.every((e) => typeof e.at === 'number' && e.size > 0)).toBe(true);
    const texts = await page.evaluate((ids) => ids.map((id) => localStorage.getItem(`sketch.rescued.${id}`)), list.map((e) => e.id));
    expect(texts).toEqual([GARBAGE(2), GARBAGE(1)]);
  });

  test('a boot that rescues something says so, with a button to the dialog', async ({ page }) => {
    const u = await started(page);
    await bootOn(page, GARBAGE(1));
    const banner = page.locator('.rescue-note');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('could not be restored');
    await banner.getByRole('button', { name: 'Recover Designs...' }).click();
    await expect(dlg(page, 'Recover Designs')).toBeVisible();
    await expect(dlg(page, 'Recover Designs').locator('.rescue-row')).toHaveCount(1);
    void u;
  });

  test('holds five at most, and the empty state says so', async ({ page }) => {
    const u = await started(page);
    await fileMenu(u, 'Recover Designs...');
    await expect(dlg(page, 'Recover Designs').locator('.rescue-empty')).toBeVisible();
    await expect(dlg(page, 'Recover Designs').locator('.rescue-row')).toHaveCount(0);
    await dlg(page, 'Recover Designs').locator('.btn.primary', { hasText: 'Close' }).click();
    for (let i = 1; i <= 6; i++) await bootOn(page, GARBAGE(i));
    const list = await rescued(page);
    expect(list).toHaveLength(5);
    const first = await page.evaluate((id) => localStorage.getItem(`sketch.rescued.${id}`), list[0].id);
    expect(first).toBe(GARBAGE(6));
  });

  test('the old single copy is moved into the list on boot', async ({ page }) => {
    await started(page);
    await page.evaluate((text) => localStorage.setItem('sketch.autosave.rescued', text), GARBAGE(7));
    await page.reload();
    await page.waitForFunction(() => !!window.__sketch);
    expect(await page.evaluate(() => localStorage.getItem('sketch.autosave.rescued'))).toBeNull();
    const list = await rescued(page);
    expect(list).toHaveLength(1);
    expect(await page.evaluate((id) => localStorage.getItem(`sketch.rescued.${id}`), list[0].id)).toBe(GARBAGE(7));
  });

  test('Download gives the raw text; Delete removes it; a copy that cannot be opened says so and stays', async ({ page }) => {
    const u = await started(page);
    await bootOn(page, GARBAGE(3));
    await u.newSketch();
    await line(u);
    const before = await u.design();
    await fileMenu(u, 'Recover Designs...');
    const d = dlg(page, 'Recover Designs');
    const [download] = await Promise.all([page.waitForEvent('download'), d.locator('.rescue-row [data-action="download"]').click()]);
    expect(readFileSync(await download.path(), 'utf8')).toBe(GARBAGE(3));
    // Open: the design is dirty, so it asks first; then the copy fails and nothing changes.
    await d.locator('.rescue-row [data-action="open"]').click();
    await u.settle();
    await dlg(page, 'Unsaved Changes').getByRole('button', { name: "Don't Save" }).click();
    await u.settle();
    expect(await note(page)).toContain('could not be opened');
    expect(await u.design()).toEqual(before);
    expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(true);
    expect(await rescued(page)).toHaveLength(1);
    // The dialog is back, and Delete clears the copy.
    await dlg(page, 'Recover Designs').locator('.rescue-row [data-action="delete"]').click();
    await expect(dlg(page, 'Recover Designs').locator('.rescue-empty')).toBeVisible();
    expect(await rescued(page)).toHaveLength(0);
  });

  test('Open on a good copy goes through the unsaved prompt, and Cancel there changes nothing', async ({ page }) => {
    const u = await started(page);
    const good = project('Rescued');
    await page.evaluate((text) => {
      localStorage.setItem('sketch.rescued', JSON.stringify([{ id: 'x1', at: Date.now() - 60000, size: text.length }]));
      localStorage.setItem('sketch.rescued.x1', text);
    }, good);
    await u.newSketch();
    await line(u);
    const before = await u.design();
    await fileMenu(u, 'Recover Designs...');
    await dlg(page, 'Recover Designs').locator('[data-action="open"]').click();
    await dlg(page, 'Unsaved Changes').locator('.btn', { hasText: 'Cancel' }).click();
    await u.settle();
    expect(await u.design()).toEqual(before);
    await dlg(page, 'Recover Designs').locator('[data-action="open"]').click();
    await dlg(page, 'Unsaved Changes').getByRole('button', { name: "Don't Save" }).click();
    await u.settle();
    expect((await u.design()).name).toBe('Rescued');
    expect(await rescued(page)).toHaveLength(1);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the dialogs fit a 360 px window and read in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 360, height: 640 });
      const u = await started(page);
      await bootOn(page, GARBAGE(1));
      await u.newSketch();
      await line(u);
      for (const [open, title] of [['Recover Designs...', 'Recover Designs'], ['Open...', 'Unsaved Changes']] as const) {
        await fileMenu(u, open);
        const d = dlg(page, title);
        await expect(d).toBeVisible();
        const box = (await d.boundingBox()) as { x: number; y: number; width: number; height: number };
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(360);
        expect(box.y + box.height).toBeLessThanOrEqual(640);
        const bg = await d.evaluate((el) => getComputedStyle(el).backgroundColor);
        const [r, g, b] = (bg.match(/\d+/g) ?? []).map(Number);
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (scheme === 'dark') expect(lum).toBeLessThan(0.3);
        else expect(lum).toBeGreaterThan(0.7);
        // No control is pushed past the dialog's edge.
        const over = await d.evaluate((el) => [...el.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().right > el.getBoundingClientRect().right + 0.5).length);
        expect(over).toBe(0);
        await d.getByRole('button', { name: /^(Close|Cancel)$/ }).first().click();
        await u.settle();
      }
    });
  }
});
