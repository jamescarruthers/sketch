import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDLED_FAMILIES, loadBundledFonts } from './fonts';
import { fontFamilies } from './text';

describe('bundled fonts', () => {
  it('fetches and registers every weight and style', async () => {
    const urls: string[] = [];
    const fetchFile = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const rel = url.slice(url.indexOf('node_modules/'));
      const b = readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)));
      return new Response(b);
    }) as typeof fetch;
    await loadBundledFonts(fetchFile);
    expect(urls.length).toBe(12);
    expect(new Set(urls).size).toBe(12);
    expect(fontFamilies()).toEqual([...BUNDLED_FAMILIES]);
  });
});
