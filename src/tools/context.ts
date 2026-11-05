// Marking-menu entries that act on what was right-clicked.
import type { Id } from '../model/types';
import { deleteEntities } from '../model/document';
import { toggleDriven as flipDriven } from '../model/parameters';
import type { Hit, ToolContext } from './tool';
import type { ContextAction } from './registry';

const dimensionOf = (ctx: ToolContext, hit: Hit | null) => (hit?.kind === 'dimension' ? ctx.sketch.dimensions[hit.id] : undefined);

export const editDimensionAction: ContextAction = {
  id: 'edit-dimension',
  label: 'Edit Dimension',
  applies: (ctx, hit) => !!dimensionOf(ctx, hit)?.driving,
  run: (ctx, hit) => ctx.editDimension((hit as Hit).id),
};

/** Toggle Driven / Toggle Driving [ref SKT-CREATE-DIMENSIONS]. */
export const toggleDriven: ContextAction = {
  id: 'toggle-driven',
  label: 'Toggle Driven',
  labelFor: (ctx, hit) => (dimensionOf(ctx, hit)?.driving === false ? 'Toggle Driving' : 'Toggle Driven'),
  applies: (ctx, hit) => !!dimensionOf(ctx, hit) && !dimensionOf(ctx, hit)?.feature,
  run(ctx, hit) {
    const id = (hit as Hit).id;
    ctx.commit('Toggle Driven', ({ design, sketch }) => flipDriven(design, sketch, id));
  },
};

/** Coincidents touching a point. */
const coincidentsAt = (ctx: ToolContext, id: Id): Id[] =>
  Object.values(ctx.sketch.constraints).filter((k) => k.type === 'coincident' && k.refs.includes(id)).map((k) => k.id);

/** [ref: select the point, right-click, Delete Coincident]. */
export const deleteCoincident: ContextAction = {
  id: 'delete-coincident',
  label: 'Delete Coincident',
  applies: (ctx, hit) => hit?.kind === 'point' && coincidentsAt(ctx, hit.id).length > 0,
  run(ctx, hit) {
    const ids = coincidentsAt(ctx, (hit as Hit).id);
    ctx.commit('Delete Coincident', ({ sketch }) => {
      deleteEntities(sketch, ids);
    });
  },
};
