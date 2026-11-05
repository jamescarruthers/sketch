import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// SVG, DXF and Print are true colours on white whatever the theme. Nothing under src/io may so much as
// import the palette, the theme or the style module, so no theme can reach them.
describe('output does not know about the theme', () => {
  const files = readdirSync('src/io').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('is a real list', () => {
    expect(files).toEqual(expect.arrayContaining(['svg.ts', 'dxf.ts', 'print.ts']));
  });

  for (const file of files) {
    it(`${file} imports nothing of the palette, the theme or the canvas style`, () => {
      const imports = [...readFileSync(`src/io/${file}`, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const from of imports) expect(from, `${file} imports ${from}`).not.toMatch(/render\/(style|palette|tokens)|app\/theme|ui\/tokens|\.css/);
    });
  }

  it('and no stored setting, document, or file carries a theme', () => {
    expect(readFileSync('src/model/types.ts', 'utf8')).not.toMatch(/theme/i);
    expect(readFileSync('src/io/project.ts', 'utf8')).not.toMatch(/theme/i);
  });
});
