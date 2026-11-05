// Bundled OFL fonts. Separate from text.ts so that module stays free of bundler-only imports.
import interRegular from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import interItalic from '@fontsource/inter/files/inter-latin-400-italic.woff?url';
import interBoldItalic from '@fontsource/inter/files/inter-latin-700-italic.woff?url';
import monoRegular from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?url';
import monoBold from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff?url';
import monoItalic from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-italic.woff?url';
import monoBoldItalic from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-italic.woff?url';
import slabRegular from '@fontsource/zilla-slab/files/zilla-slab-latin-400-normal.woff?url';
import slabBold from '@fontsource/zilla-slab/files/zilla-slab-latin-700-normal.woff?url';
import slabItalic from '@fontsource/zilla-slab/files/zilla-slab-latin-400-italic.woff?url';
import slabBoldItalic from '@fontsource/zilla-slab/files/zilla-slab-latin-700-italic.woff?url';
import { registerFont } from './text';

/** Sans, mono and slab. Inter is the default for new text. */
export const BUNDLED_FAMILIES = ['Inter', 'JetBrains Mono', 'Zilla Slab'] as const;

const FILES: [string, boolean, boolean, string][] = [
  ['Inter', false, false, interRegular],
  ['Inter', true, false, interBold],
  ['Inter', false, true, interItalic],
  ['Inter', true, true, interBoldItalic],
  ['JetBrains Mono', false, false, monoRegular],
  ['JetBrains Mono', true, false, monoBold],
  ['JetBrains Mono', false, true, monoItalic],
  ['JetBrains Mono', true, true, monoBoldItalic],
  ['Zilla Slab', false, false, slabRegular],
  ['Zilla Slab', true, false, slabBold],
  ['Zilla Slab', false, true, slabItalic],
  ['Zilla Slab', true, true, slabBoldItalic],
];

/** Fetch and register every bundled font. Call once at startup; text draws after it resolves. */
export async function loadBundledFonts(fetchFile: typeof fetch = fetch): Promise<void> {
  await Promise.all(FILES.map(async ([family, bold, italic, url]) => {
    const res = await fetchFile(url);
    registerFont(family, bold, italic, await res.arrayBuffer());
  }));
}
