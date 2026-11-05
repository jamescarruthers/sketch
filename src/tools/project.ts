// Project: pick curves in other visible sketches this one can see (on the same plane, or lying in it), or
// the origin axes, and copy them into this sketch as locked purple geometry [ref GUID-850061C4]. [adapt]:
// no 3D bodies or faces here.
import type { Id } from '../model/types';
import { AXIS_X, AXIS_Y } from '../model/types';
import { projectAxis, projectCurve, projectPoint } from '../io/projection';
import { seenFrom } from '../model/seen';
import type { Hit, Tool, ToolContext, ToolDef } from './tool';

/** A pick: a curve or point of another sketch, or an origin axis (sketch ''). */
interface Pick { sketch: Id; curve: Id; point?: boolean }

const key = (p: Pick): string => `${p.sketch}:${p.curve}`;

function create(ctx: ToolContext): Tool {
  const picked: Pick[] = [];
  let link = true;

  const dialog = ctx.dialogs.open({
    title: 'Project',
    onOk() {
      const copies = picked.length;
      const done = ctx.commit('Project', (c) => {
        for (const p of picked) {
          if (!p.sketch) {
            const axis = p.curve === AXIS_X ? 'x' : 'y';
            const exists = Object.values(c.sketch.curves).some((k) => k.projected && 'origin' in k.projected && k.projected.origin === axis);
            if (!exists) projectAxis(c.design, c.sketch, axis);
          } else if (p.point) {
            const from = c.design.sketches[p.sketch];
            if (from) projectPoint(c.design, c.sketch, seenFrom(c.sketch.frame, from), p.curve, link);
          } else {
            const source = c.design.sketches[p.sketch];
            const from = source ? seenFrom(c.sketch.frame, source) : undefined;
            const already = Object.values(c.sketch.curves).some((k) => k.projected && 'curveId' in k.projected && k.projected.curveId === p.curve);
            if (from && !(link && already)) projectCurve(c.design, c.sketch, from, p.curve, link);
          }
        }
      });
      if (done) ctx.message(`Projected ${copies} ${copies === 1 ? 'curve' : 'curves'}`);
      return done;
    },
    onClose() {
      ctx.end();
    },
    onChange: () => sync(),
  });
  // No bodies here, so the filter has the one useful setting [ref GUID-6EE7B230]: Bodies shows, greyed.
  const filter = dialog.select('Selection Filter', [{ value: 'entities', label: 'Specified Entities' }, { value: 'bodies', label: 'Bodies' }], 'entities');
  (filter.row.querySelector('option[value="bodies"]') as HTMLOptionElement).disabled = true;
  const count = document.createElement('span');
  count.className = 'form-note';
  dialog.row('Geometry', count);
  const linkField = dialog.checkbox('Projection Link', true);
  dialog.button('Clear selection', () => {
    picked.length = 0;
    sync();
  });

  function sync(): void {
    link = linkField.get();
    count.textContent = picked.length ? `${picked.length} selected` : 'Click curves or points of other sketches, or an origin axis';
    dialog.setOkEnabled(picked.length > 0);
    ctx.setHighlight(picked.map((p) => p.curve));
    ctx.invalidate();
  }

  /** What the cursor is over: a curve in another sketch of this plane, else an origin axis. */
  const hitAt = (screen: { x: number; y: number }): { pick: Pick; hit: Hit } | null => {
    for (const s of ctx.others()) {
      // A point sits on top of whatever it lies on, including an axis.
      const point = ctx.hit(screen, { sketch: s, kinds: ['point'] });
      if (point && s.points[point.id]) return { pick: { sketch: s.id, curve: point.id, point: true }, hit: point };
      const hit = ctx.hit(screen, { sketch: s, kinds: ['curve'] });
      if (hit && s.curves[hit.id]?.type !== 'text') return { pick: { sketch: s.id, curve: hit.id }, hit };
    }
    const axis = ctx.hit(screen, { reserved: true, kinds: ['curve'], accept: (h) => h.id === AXIS_X || h.id === AXIS_Y });
    return axis ? { pick: { sketch: '', curve: axis.id }, hit: axis } : null;
  };

  return {
    start() {
      sync();
      ctx.status('Project: click curves or points in other sketches or an origin axis, then OK');
    },
    stop() {
      ctx.setHighlight([]);
      ctx.setHover(null);
      dialog.close();
    },
    move(e) {
      ctx.setHover(hitAt(e.screen)?.hit ?? null);
    },
    click(e) {
      const found = hitAt(e.screen);
      if (!found) return;
      const i = picked.findIndex((p) => key(p) === key(found.pick));
      if (i >= 0) picked.splice(i, 1);
      else picked.push(found.pick);
      sync();
    },
    enter() {
      dialog.ok();
      return true;
    },
    escape() {
      dialog.cancel();
      return true;
    },
  };
}

export const projectTool: ToolDef = {
  meta: { id: 'project', label: 'Project', panel: 'create', shortcut: 'P' },
  create,
};

export const projectTools: ToolDef[] = [projectTool];
