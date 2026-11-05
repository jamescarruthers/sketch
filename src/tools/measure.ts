// Measure [Inspect]: pick any two visible points or curves on any layer, locked ones included, and the status bar
// reads their Min Distance. Nothing is selected and nothing in the design changes, so it adds no Undo step.
// Normal selection stays on the active layer; this is a read-only look at the others.
import type { Id } from '../model/types';
import { AXIS_X, AXIS_Y } from '../model/types';
import type { Hit, Tool, ToolContext, ToolDef } from './tool';

const PICK_FIRST = 'Measure: click a point or curve on any layer, then a second. Esc leaves';
const PICK_SECOND = 'Measure: click a second point or curve. A third click starts over. Esc leaves';

export const measureTool: ToolDef = {
  meta: { id: 'measure', label: 'Measure', panel: 'inspect', shortcut: 'I', readOnly: true, repeatable: false },
  create(ctx: ToolContext): Tool {
    let picks: Id[] = [];
    /** Points and curves that have a drawn shape; the axes and text have none. */
    const accept = (h: Hit): boolean =>
      (h.kind === 'point' || (h.kind === 'curve' && h.id !== AXIS_X && h.id !== AXIS_Y && ctx.sketch.curves[h.id]?.type !== 'text'));
    const under = (screen: { x: number; y: number }): Hit | null => ctx.hit(screen, { kinds: ['point', 'curve'], reserved: true, anyLayer: true, accept });
    const sync = (): void => {
      ctx.measure(picks);
      ctx.status(picks.length === 1 ? PICK_SECOND : PICK_FIRST);
    };
    return {
      start() {
        ctx.selection.clear();
        sync();
      },
      stop() {
        ctx.setHover(null);
      },
      move(e) {
        ctx.setHover(under(e.screen));
      },
      click(e) {
        const hit = under(e.screen);
        if (!hit) return;
        if (picks.length === 1 && picks[0] === hit.id) {
          ctx.message('Pick a second object', 'info');
          return;
        }
        picks = picks.length >= 2 ? [hit.id] : [...picks, hit.id];
        sync();
      },
      // Esc always leaves: there is nothing half done to cancel.
      escape: () => false,
      docChanged() {
        picks = picks.filter((id) => ctx.hitOf(id) !== null);
        sync();
      },
    };
  },
};
