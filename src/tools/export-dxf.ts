// Export DXF [ref GUID-BC1A5C26]: settings, then a name, then the browser's download.
import type { Design, Id } from '../model/types';
import { exportDxf } from '../io/dxf';
import { askNameAndSave } from './download';
import type { SketchAction } from './registry';
import type { ToolContext } from './tool';

const UNITS: { value: Design['units']; label: string }[] = [
  { value: 'mm', label: 'Millimeter' }, { value: 'cm', label: 'Centimeter' }, { value: 'm', label: 'Meter' },
  { value: 'in', label: 'Inch' }, { value: 'ft', label: 'Foot' },
];

export const exportDxfAction: SketchAction = {
  id: 'export-dxf',
  run(ctx: ToolContext, id: Id) {
    const sketch = ctx.design.sketches[id];
    if (!sketch) return;
    let read: () => string = () => '';
    const d = ctx.dialogs.open({
      title: 'Export DXF',
      onOk: () => {
        const text = read();
        // After this dialog has closed: only one is open at a time.
        queueMicrotask(() => askNameAndSave(ctx, 'Save DXF', sketch.name, '.dxf', 'application/dxf', text));
        return true;
      },
    });
    const unit = d.select('Unit', UNITS, ctx.design.units);
    d.section('Visible Geometry');
    const points = d.checkbox('Points', false);
    const projected = d.checkbox('Projected Geometry', false);
    const construction = d.checkbox('Construction Geometry', false);
    const centerlines = d.checkbox('Centerlines', true);
    read = () => exportDxf(sketch, {
      units: unit.get() as Design['units'], points: points.get(), projected: projected.get(),
      construction: construction.get(), centerlines: centerlines.get(), design: ctx.design,
    });
  },
};
