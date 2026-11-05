// Midpoint Line [ref SKT-CREATE-MIDPOINT-LINES]: click the middle, click an end, symmetric about the middle.
import { addConstraint, addLine, addPoint } from '../model/document';
import { add, dist, sub } from '../geom/vec';
import { relativeAngleLock, unsignedAngle, X_AXIS } from './kit';
import { defineClickTool, previewStroke, radialLock, type ToolDef } from './tool';

export const midpointLineTool: ToolDef = defineClickTool({
  meta: { id: 'midpoint-line', label: 'Midpoint Line', panel: 'create', group: 'line' },
  steps: [
    { prompt: 'Click the midpoint of the line' },
    {
      prompt: 'Click an end of the line, or type its length and angle',
      from: 0,
      fields(s) {
        const m = s.at(0);
        const { view } = s.ctx;
        return [
          { key: 'length', kind: 'length', value: 2 * dist(m, s.cursor.pos), at: s.cursor.pos, lock: radialLock(m, 2) },
          {
            key: 'angle', kind: 'angle', value: unsignedAngle(X_AXIS, sub(s.cursor.pos, m)),
            at: add(m, { x: view.px(48), y: view.px(-16) }), lock: relativeAngleLock(m, X_AXIS),
          },
        ];
      },
    },
  ],
  preview(p, s) {
    const m = s.at(0);
    const end = s.at(1);
    p.line(sub(m, sub(end, m)), end, previewStroke(s.ctx.lineType));
    p.dot(m);
  },
  commit(c, s) {
    const m = s.at(0);
    const end = s.at(1);
    const line = addLine(c.design, c.sketch, sub(m, sub(end, m)), end, c.curveOpts);
    const mid = addPoint(c.design, c.sketch, m, { owner: line.id });
    addConstraint(c.design, c.sketch, 'midpoint', [mid.id, line.id]);
    c.infer(mid.id, s.picks[0]);
    c.infer(line.b, s.picks[1], { segment: line.id });
    c.hudDimension('length', 'distance', [line.a, line.b]);
    c.hudDimension('angle', 'angle', ['axis-x', line.id], { label: add(m, { x: s.ctx.view.px(60), y: s.ctx.view.px(14) }) });
  },
});
