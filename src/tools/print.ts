// Print 1:1 [user]: paper, orientation and margins, a preview of the placement, then the browser's print.
import type { Sketch } from '../model/types';
import { layoutPrint, pageCss, PAPERS, previewMarkup, printPages, PRINT_OVERLAP, type Orientation, type PaperName } from '../io/print';
import { svgSheet } from '../io/svg';
import type { ToolContext } from './tool';

const DEFAULT_MARGIN = 10;
const PRINT_WARNING = 'Your browser controls the final scale. In its print dialog choose 100% or Actual size, not Fit to page, then check the 100 mm scale bar with a ruler before you rely on the print.';

const paperChoices = (Object.keys(PAPERS) as PaperName[]).map((value) => ({ value, label: PAPERS[value].label }));

function setPrintRoot(html: string, css: string): void {
  document.getElementById('print-root')?.remove();
  document.getElementById('print-page-style')?.remove();
  const style = document.createElement('style');
  style.id = 'print-page-style';
  style.textContent = css;
  const root = document.createElement('div');
  root.id = 'print-root';
  root.innerHTML = html;
  document.head.append(style);
  document.body.append(root);
}

export function openPrintDialog(ctx: ToolContext, sketches: Sketch[], show: { construction: boolean; projected: boolean; points: boolean }): void {
  let paper: { get(): string };
  let orientation: { get(): string };
  let margin: { get(): number };
  let dimensions: { get(): boolean };
  const preview = document.createElement('div');
  preview.className = 'print-preview';
  const summary = document.createElement('div');
  summary.className = 'print-summary';
  const options = () => ({ paper: paper.get() as PaperName, orientation: orientation.get() as Orientation, margin: margin.get() });
  const sheetNow = () => svgSheet(ctx.design, sketches, { ...show, dimensions: dimensions.get() });
  const refresh = (): void => {
    const sheet = sheetNow();
    const l = layoutPrint(sheet.box, options());
    d.setError(l.problem);
    d.setOkEnabled(!l.problem);
    preview.innerHTML = l.problem ? '' : previewMarkup(sheet, l);
    const pages = l.tiles.length;
    summary.textContent = l.problem ? '' : pages === 1 ? '1 page, centred at 1:1'
      : `${pages} pages (${l.cols} across, ${l.rows} down) at 1:1, overlapping ${PRINT_OVERLAP} mm, with alignment marks`;
  };
  const d = ctx.dialogs.open({
    title: 'Print 1:1',
    okLabel: 'Print',
    width: 340,
    onChange: refresh,
    onOk: () => {
      const sheet = sheetNow();
      const l = layoutPrint(sheet.box, options());
      if (l.problem) return false;
      setPrintRoot(printPages(sheet, l), pageCss(l));
      // After this dialog has closed, so a blocking print sheet does not sit over a stale one.
      queueMicrotask(() => window.print());
      return true;
    },
  });
  paper = d.select('Paper Size', paperChoices, 'A4');
  orientation = d.select('Orientation', [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }], 'portrait');
  margin = d.number('Margins (mm)', DEFAULT_MARGIN, { min: 0, step: 1 });
  dimensions = d.checkbox('Include Dimensions', false);
  d.custom(preview);
  d.custom(summary);
  const warn = d.note(PRINT_WARNING);
  warn.classList.add('print-warning');
  refresh();
}
