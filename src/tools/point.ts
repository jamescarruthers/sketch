// Point: explicit sketch points, one per click [ref SKT-CREATE-POINT].
import { addPoint } from '../model/document';
import { defineClickTool, type ToolDef } from './tool';

export const pointTool: ToolDef = defineClickTool({
  meta: { id: 'point', label: 'Point', panel: 'create' },
  steps: [{ prompt: 'Click to place a point. Enter finishes' }],
  commit(c, s) {
    const p = addPoint(c.design, c.sketch, s.at(0), { explicit: true });
    c.infer(p.id, s.picks[0]);
  },
});

export const pointTools: ToolDef[] = [pointTool];
