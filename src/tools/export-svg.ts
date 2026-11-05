// Save as SVG [user]: the DXF options plus dimensions and the editable data, then a name, then the browser's download.
import type { Id, Sketch } from '../model/types';
import { embedSentence, embedSummary, exportSvg, SVG_TOLERANCE, type SvgOptions } from '../io/svg';
import { askNameAndSave } from './download';
import type { SketchAction } from './registry';
import type { ToolContext } from './tool';

export function openSvgDialog(ctx: ToolContext, sketches: Sketch[]): void {
  let read: () => string = () => '';
  let editable = true;
  let refresh: () => void = () => undefined;
  const d = ctx.dialogs.open({
    title: 'Save as SVG',
    onOk: () => {
      const text = read();
      // A file with the whole design in it is a save of the design; one with only the drawing is not.
      const done = editable ? ctx.savePoint() : undefined;
      // After this dialog has closed: only one is open at a time.
      queueMicrotask(() => askNameAndSave(ctx, 'Save SVG', sketches[0]?.name ?? 'sketch', '.svg', 'image/svg+xml', text, done));
      return true;
    },
    onChange: () => refresh(),
  });

  d.section('Visible Geometry');
  const points = d.checkbox('Points', false);
  const projected = d.checkbox('Projected Geometry', false);
  const construction = d.checkbox('Construction Geometry', false);
  const centerlines = d.checkbox('Centerlines', true);
  const dimensions = d.checkbox('Include Dimensions', false);
  d.section('Editable Data');
  const data = d.checkbox('Include editable data', true);
  const summary = d.note('');
  summary.classList.add('embed-summary');
  d.note('The data holds the whole design, including hidden layers and construction geometry, not only what is drawn. Untick it to share the drawing alone.');
  const options = (): SvgOptions => ({
    points: points.get(), projected: projected.get(), construction: construction.get(), centerlines: centerlines.get(), dimensions: dimensions.get(), data: data.get(),
  });
  // What the file carries beyond the drawing, said as it will be, so nobody sends it unaware.
  refresh = () => {
    editable = data.get();
    summary.textContent = editable ? embedSentence(embedSummary(ctx.design, sketches, options())) : 'No editable data: the file holds only what is drawn.';
  };
  refresh();
  d.note(`Real millimetres. One group per visible layer. Splines and conics are cubic Béziers within ${SVG_TOLERANCE} mm.`);
  read = () => exportSvg(ctx.design, sketches, options());
}

export const exportSvgAction: SketchAction = {
  id: 'export-svg',
  run(ctx: ToolContext, id: Id) {
    const sketch = ctx.design.sketches[id];
    if (sketch) openSvgDialog(ctx, [sketch]);
  },
};
