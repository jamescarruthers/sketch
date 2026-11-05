import { expect, test } from '@playwright/test';
import { SketchUser } from './helpers';

test('boots, creates a sketch, draws a rectangle', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const u = new SketchUser(page);
  await u.open();
  await u.shot('smoke-design');
  await page.getByRole('button', { name: 'Create Sketch' }).first().click();
  await u.shot('smoke-plane');
  await page.locator('.plane[data-plane="XY"] polygon').click();
  await u.settle();
  await u.shot('smoke-sketch');
  await u.press('r');
  await u.click({ x: 10, y: 10 });
  await u.move({ x: 50, y: 40 });
  await u.shot('smoke-rect-live');
  await u.click({ x: 50, y: 40 });
  await u.press('Escape');
  await u.shot('smoke-rect');
  expect((await u.lines()).length).toBe(4);
  expect(errors).toEqual([]);
});
