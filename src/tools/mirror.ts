// Mirror [ref SKT-CREATE-MIRROR, GUID-087596A4]: Objects and a straight Mirror Line, live preview, OK.
import type { Id } from '../model/types';
import { AXIS_X, AXIS_Y } from '../model/types';
import { coincidentClasses, curvePoints } from '../model/document';
import { mirror, mirrorPreview } from '../geom/modify';
import { COLORS } from '../render/style';
import type { SelectionField } from '../ui/dialogs/dialog';
import { defineDialogTool } from './dialog-tool';
import type { Hit, ToolContext, ToolDef } from './tool';

interface State { objects: SelectionField; axis: SelectionField }

const isCurve = (ctx: ToolContext, h: Hit): boolean => h.kind === 'curve' && !!ctx.sketch.curves[h.id];

/** A Point tool point [ref SKT-CREATE-MIRROR]. */
const isLoosePoint = (ctx: ToolContext, h: Hit): boolean => h.kind === 'point' && !!ctx.sketch.points[h.id]?.explicit;

const isStraight = (ctx: ToolContext, h: Hit): boolean =>
  h.kind === 'curve' && (h.id === AXIS_X || h.id === AXIS_Y || ctx.sketch.curves[h.id]?.type === 'line');

/**
 * A window takes the sketch points of what it encloses as well, as the tutorial's "12 objects" does:
 * 6 curves and their 6 shared corners and centres. One id stands for each coincident group.
 */
function withPoints(ctx: ToolContext, ids: Id[]): Id[] {
  const rep = coincidentClasses(ctx.sketch);
  const seen = new Map<Id, Id>();
  for (const id of ids) {
    const c = ctx.sketch.curves[id];
    if (!c) continue;
    for (const p of curvePoints(c)) if (ctx.sketch.points[p] && !seen.has(rep(p))) seen.set(rep(p), p);
  }
  return [...ids, ...seen.values()];
}

export const mirrorTool: ToolDef = defineDialogTool<State>({
  meta: { id: 'mirror', label: 'Mirror', panel: 'create' },
  title: 'Mirror',
  build(ctx, d) {
    const objects = d.selection({
      label: 'Objects',
      prompt: 'Select sketch geometry to mirror',
      accept: (h: Hit) => isCurve(ctx, h) || isLoosePoint(ctx, h),
      initial: ctx.selection.ids().filter((id) => ctx.sketch.curves[id] || ctx.sketch.points[id]?.explicit),
    });
    const axis = d.selection({ label: 'Mirror Line', prompt: 'Select the mirror line', accept: (h: Hit) => isStraight(ctx, h), multiple: false });
    if (objects.ids().length) axis.activate();
    ctx.selection.clear();
    return { objects, axis };
  },
  changed(_ctx, s, d) {
    const line = s.axis.ids()[0];
    const clash = !!line && s.objects.ids().includes(line);
    d.setError(clash ? 'The mirror line cannot also be an object' : null);
    if (clash) d.setOkEnabled(false);
  },
  windowIds: (ctx, _s, ids) => withPoints(ctx, ids),
  click(ctx, s, e) {
    // [ref] The mirror line can't have curvature: say so rather than ignore the click.
    if (!s.axis.active) return false;
    const hit = ctx.hit(e.screen, { kinds: ['curve'] });
    if (hit && !isStraight(ctx, hit)) ctx.message('The mirror line must be straight', 'warn');
    return false;
  },
  preview(p, ctx, s) {
    const [line] = s.axis.ids();
    if (!line) return;
    for (const poly of mirrorPreview(ctx.sketch, s.objects.ids(), line) ?? []) p.poly(poly, false, { color: COLORS.preview, width: 1.5, dash: [6, 4] });
  },
  ok(ctx, s) {
    const ids = s.objects.ids();
    const [line] = s.axis.ids();
    return ctx.commit('Mirror', (c) => mirror(c.design, c.sketch, ids, line).created.length > 0);
  },
});
