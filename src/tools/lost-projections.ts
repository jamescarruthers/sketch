// Manage Lost Projections and Break Link [ref GUID-850061C4, GUID-AFD7EB76]: a projected curve can be
// cut free of its source, and one whose source is gone can be linked to another, freed or deleted.
import type { Curve, Id } from '../model/types';
import { deleteEntities } from '../model/document';
import { isLinked, isLost } from '../io/projection';
import type { Dialog } from '../ui/dialogs/dialog';
import { COLORS } from '../render/style';
import type { ContextAction, Overlay } from './registry';
import type { Hit, Tool, ToolContext, ToolDef } from './tool';

const curveOf = (ctx: ToolContext, hit: Hit | null): Curve | undefined => (hit?.kind === 'curve' ? ctx.sketch.curves[hit.id] : undefined);

const lostCurves = (ctx: ToolContext): Curve[] => Object.values(ctx.sketch.curves).filter((c) => isLost(ctx.design, c, ctx.sketch));

/** Curves to show over the fade while the dialog has Fade Other Geometry on. */
let fading: Id[] | null = null;

export const lostProjectionsOverlay: Overlay = (ctx, p) => {
  if (!fading) return;
  p.raw((g) => {
    g.fillStyle = COLORS.fade;
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  });
  const curves = fading.map((id) => ctx.sketch.curves[id]).filter((c) => c);
  p.curves(ctx.sketch, curves, { color: COLORS.lost, width: 2.4 });
};

function breakLinks(ctx: ToolContext, ids: Id[]): boolean {
  return ctx.commit('Break Link', ({ sketch }) => {
    for (const id of ids) delete sketch.curves[id]?.projected;
  });
}

function createManager(ctx: ToolContext): Tool {
  let dialog: Dialog | null = null;
  let relinking: Id | null = null;
  const list = document.createElement('div');
  list.className = 'lost-list';

  const sourceAt = (screen: { x: number; y: number }): { sketch: Id; curve: Id } | null => {
    const wanted = relinking ? ctx.sketch.curves[relinking] : undefined;
    if (!wanted) return null;
    for (const s of ctx.others()) {
      const hit = ctx.hit(screen, { sketch: s, kinds: ['curve'] });
      if (hit && s.curves[hit.id]?.type === wanted.type) return { sketch: s.id, curve: hit.id };
    }
    return null;
  };

  const button = (label: string, action: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.dataset.action = action;
    b.onclick = run;
    return b;
  };

  const render = (): void => {
    const lost = lostCurves(ctx);
    list.replaceChildren();
    if (fading) fading = lost.map((c) => c.id);
    if (!lost.length) list.textContent = 'No projections are lost';
    for (const c of lost) {
      const row = document.createElement('div');
      row.className = 'lost-row';
      row.dataset.curve = c.id;
      const name = document.createElement('span');
      name.textContent = `${c.type} ${c.id}`;
      row.append(
        name,
        button('Re-Link', 'relink', () => {
          relinking = c.id;
          ctx.status('Click the curve to link this projection to');
        }),
        button('Break Link', 'break-link', () => {
          breakLinks(ctx, [c.id]);
          render();
        }),
        button('Delete Geometry', 'delete-geometry', () => {
          ctx.commit('Delete Geometry', ({ sketch }) => { deleteEntities(sketch, [c.id]); });
          render();
        }),
      );
      list.append(row);
    }
    ctx.setHighlight(lost.map((c) => c.id));
    ctx.invalidate();
  };

  return {
    start() {
      const d = ctx.dialogs.open({
        title: 'Manage Lost Projections',
        width: 420,
        onOk: () => true,
        onClose: () => {
          if (dialog) {
            dialog = null;
            ctx.end();
          }
        },
      });
      dialog = d;
      d.custom(list);
      const fade = d.checkbox('Fade Other Geometry', false);
      fade.row.addEventListener('change', () => {
        fading = fade.get() ? lostCurves(ctx).map((c) => c.id) : null;
        ctx.invalidate();
      });
      d.button('Break Link All', () => {
        breakLinks(ctx, lostCurves(ctx).map((c) => c.id));
        render();
      });
      d.button('Delete All', () => {
        const ids = lostCurves(ctx).map((c) => c.id);
        ctx.commit('Delete Geometry', ({ sketch }) => { deleteEntities(sketch, ids); });
        render();
      });
      render();
      ctx.status('Choose what to do with each lost projection');
    },
    stop() {
      fading = null;
      ctx.setHighlight([]);
      ctx.setHover(null);
      const d = dialog;
      dialog = null;
      d?.close();
    },
    click(e) {
      const target = relinking;
      const found = sourceAt(e.screen);
      if (!target || !found) return;
      relinking = null;
      ctx.commit('Re-Link', ({ sketch }) => {
        const c = sketch.curves[target];
        if (c) c.projected = { sketchId: found.sketch, curveId: found.curve };
      });
      ctx.message('Linked');
      render();
    },
    enter() {
      dialog?.ok();
      return true;
    },
    escape() {
      if (relinking) {
        relinking = null;
        return true;
      }
      dialog?.cancel();
      return true;
    },
    docChanged: render,
  };
}

export const lostProjectionsTool: ToolDef = {
  meta: { id: 'lost-projections', label: 'Manage Lost Projections', panel: 'create', repeatable: false },
  create: createManager,
};

export const breakLinkAction: ContextAction = {
  id: 'break-link',
  label: 'Break Link',
  applies: (ctx, hit) => {
    const c = curveOf(ctx, hit);
    return !!c && isLinked(c);
  },
  run: (ctx, hit) => { breakLinks(ctx, [(hit as Hit).id]); },
};

export const manageLostAction: ContextAction = {
  id: 'manage-lost-projections',
  label: 'Manage Lost Projections',
  applies: (ctx, hit) => {
    const c = curveOf(ctx, hit);
    return !!c && isLost(ctx.design, c, ctx.sketch);
  },
  run: (ctx) => ctx.activate('lost-projections'),
};
