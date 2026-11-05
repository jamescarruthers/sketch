import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './ui/tokens.css';
import './ui/styles.css';
import { App, type SketchDebug } from './app/app';
import { regenerateDerived } from './geom/offset';
import { loadBundledFonts } from './io/fonts';
import { initSolver, setDerivedRegenerator } from './solver/bridge';

declare global {
  interface Window {
    /** Read-only handle for tests and debugging. */
    __sketch: SketchDebug;
  }
}

async function main(): Promise<void> {
  await initSolver();
  setDerivedRegenerator(regenerateDerived);
  const app = new App(document.getElementById('app') as HTMLElement);
  window.__sketch = app.debugHandle();
  // Text outlines are empty until the fonts land, so repaint when they do.
  void loadBundledFonts().then(() => app.invalidate());
}

void main();
