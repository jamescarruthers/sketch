// Dialog-driven tools (Mirror, patterns, offset, text...). The tool owns a Dialog; canvas clicks go
// to whichever selection field is active, window selects included [ref Mirror tutorial].
import type { Id } from '../model/types';
import type { Dialog } from '../ui/dialogs/dialog';
import type { Hit, Preview, SnapOptions, Tool, ToolContext, ToolDef, ToolMeta, ToolPointer } from './tool';
import { createBoxSelect } from './select';

export interface DialogToolSpec<S> {
  meta: ToolMeta;
  title: string;
  /**
   * Add rows to the dialog and return whatever the other callbacks need, usually the fields. `arg`
   * is what `ctx.activate(id, arg)` passed, e.g. a feature to edit.
   */
  build(ctx: ToolContext, dialog: Dialog, arg: unknown): S;
  /** Apply on OK, normally one `ctx.commit`. Return false to keep the dialog open. */
  ok(ctx: ToolContext, state: S, dialog: Dialog): void | boolean;
  /** Live preview on the canvas. */
  preview?(p: Preview, ctx: ToolContext, state: S): void;
  /** A control changed: validate, `dialog.setError`, `dialog.setOkEnabled`. */
  changed?(ctx: ToolContext, state: S, dialog: Dialog): void;
  /** The document changed under the dialog (undo, redo). Selection fields are already pruned. */
  docChanged?(ctx: ToolContext, state: S, dialog: Dialog): void;
  /** Cancel, Esc or the close button. */
  cancel?(ctx: ToolContext, state: S): void;
  /** Canvas click before it reaches the selection fields; return true to consume it. */
  click?(ctx: ToolContext, state: S, e: ToolPointer): boolean;
  /** Snap the cursor for `move` and `click`: Move's Point to Point picks. Null, or omitted, for no snapping. */
  snap?(ctx: ToolContext, state: S): SnapOptions | null;
  /** Pointer travel over the canvas, e.g. to read a side from the mouse. */
  move?(ctx: ToolContext, state: S, e: ToolPointer): void;
  /** Canvas press; return true to own the gesture (a manipulator): `drag` then `release` follow. */
  press?(ctx: ToolContext, state: S, e: ToolPointer): boolean;
  drag?(ctx: ToolContext, state: S, e: ToolPointer): void;
  release?(ctx: ToolContext, state: S, e: ToolPointer): void;
  /** What a window select hands the active field, given the ids it accepted. */
  windowIds?(ctx: ToolContext, state: S, ids: Id[]): Id[];
  /** Dialog width in pixels. */
  width?: number;
}

export function defineDialogTool<S>(spec: DialogToolSpec<S>): ToolDef {
  return {
    meta: spec.meta,
    create(ctx, arg) {
      let dialog: Dialog | null = null;
      let state: S | null = null;
      let gesture = false;
      /** A manipulator press that never travelled still fires `click`; this swallows it. */
      let ownedPress = false;
      const box = createBoxSelect(ctx, (a, b, crossing) => {
        const field = dialog?.activeField();
        if (!field) return [];
        return ctx.boxSelect(a, b, crossing).filter((id) => {
          const h = ctx.hitOf(id);
          return !!h && field.options.accept(h);
        });
      });
      const hover = (screen: { x: number; y: number }): Hit | null => {
        const field = dialog?.activeField();
        return field ? ctx.hit(screen, { reserved: true, accept: field.options.accept }) : null;
      };
      const sync = (): void => {
        ctx.setHighlight(dialog?.allFieldIds() ?? []);
        const prompt = dialog?.activeField()?.options.prompt;
        if (prompt) ctx.status(prompt);
        ctx.invalidate();
      };
      const tool: Tool = {
        start() {
          const d = ctx.dialogs.open({
            title: spec.title,
            width: spec.width,
            onOk: () => spec.ok(ctx, state as S, d),
            onCancel: () => {
              if (state !== null) spec.cancel?.(ctx, state);
            },
            onClose: () => {
              if (dialog) {
                dialog = null;
                ctx.end();
              }
            },
            onChange: () => {
              if (state !== null) spec.changed?.(ctx, state, d);
              sync();
            },
          });
          dialog = d;
          state = spec.build(ctx, d, arg);
          spec.changed?.(ctx, state, d);
          sync();
          if (!dialog?.activeField()?.options.prompt) ctx.status(`${spec.title}: select in the canvas, then OK`);
        },
        stop() {
          box.cancel();
          ctx.setHighlight([]);
          ctx.setHover(null);
          const d = dialog;
          dialog = null;
          d?.close();
        },
        snap() {
          return state !== null ? spec.snap?.(ctx, state) ?? null : null;
        },
        move(e) {
          if (gesture) {
            if (state !== null) spec.drag?.(ctx, state, e);
            ctx.invalidate();
            return;
          }
          if (state !== null) spec.move?.(ctx, state, e);
          if (box.move(e)) return;
          ctx.setHover(hover(e.screen));
        },
        down(e) {
          if (e.button === 0 && state !== null && spec.press?.(ctx, state, e)) {
            gesture = true;
            ownedPress = true;
            return;
          }
          // On a curve too: a press with no drag is still a pick, and only a drag makes it a window.
          if (e.button === 0) box.begin(e);
        },
        up(e) {
          if (gesture) {
            gesture = false;
            if (state !== null) spec.release?.(ctx, state, e);
            return;
          }
          const ids = box.end(e);
          if (ids?.length) dialog?.activeField()?.pickMany(state !== null && spec.windowIds ? spec.windowIds(ctx, state, ids) : ids);
        },
        click(e) {
          if (ownedPress) {
            ownedPress = false;
            return;
          }
          if (state !== null && spec.click?.(ctx, state, e)) return;
          const hit = hover(e.screen);
          const field = dialog?.activeField();
          if (hit) field?.pick(hit.id);
          else if (field) {
            const layer = ctx.layerUnder(e.screen);
            if (layer) ctx.message(`${field.options.label} takes geometry on the active layer. That is on layer "${layer}".`, 'warn');
          }
        },
        enter() {
          dialog?.ok();
          return true;
        },
        escape() {
          dialog?.cancel();
          return true;
        },
        draw(p) {
          box.draw(p);
          if (state !== null && dialog) spec.preview?.(p, ctx, state);
        },
        docChanged() {
          dialog?.retainFields((id) => ctx.hitOf(id) !== null);
          if (dialog && state !== null) spec.docChanged?.(ctx, state, dialog);
        },
      };
      return tool;
    },
  };
}
