// The tool framework. docs/TOOLS.md is the guide; this file is the contract.
//
// A tool is a ToolDef: metadata plus `create(ctx)`, which returns event handlers. Most drawing tools
// use defineClickTool, which turns a list of click steps into the state machine, HUD and looping.
import type { Curve, Design, Dimension, DimensionKind, Id, LineType, Sketch, Vec2 } from '../model/types';
import type { CurveOpts, DimensionInit } from '../model/document';
import type { Profile } from '../geom/profiles';
import type { SolveResult } from '../solver/bridge';
import type { Hit, HitOptions } from '../app/hit';
import { noInference, type ApplyOptions, type Inference, type SnapOptions } from '../app/snap';
import type { SketchAnalysis } from '../app/app';
import type { Selection } from '../app/selection';
import type { View } from '../app/view';
import type { Preview, Stroke } from '../render/painter';
import type { DialogHost } from '../ui/dialogs/dialog';
import { dist } from '../geom/vec';
import { COLORS } from '../render/style';

export type { Inference, SnapOptions, Hit, HitOptions, Preview, Stroke };

export type Panel = 'create' | 'modify' | 'constraints' | 'automate' | 'inspect' | 'select';

export interface ToolMeta {
  /** Stable id. Must match the entry in src/tools/menu.ts so the tool lands in its menu slot. */
  id: string;
  label: string;
  panel: Panel;
  /** Sibling types: tools sharing a group are offered in the palette's Feature Options [ref]. */
  group?: string;
  /** Single letter from the keyboard map, e.g. 'L'. */
  shortcut?: string;
  /** Name in src/ui/icons.ts. Defaults to `id`. */
  icon?: string;
  /** A reason means greyed out with that tooltip. */
  disabled?: string | ((ctx: ToolContext) => string | null);
  /** The tool changes nothing in the design, so a locked active layer does not stop it: Measure. */
  readOnly?: boolean;
  /** False when the tool does not make sense to offer as Repeat, like select. Default true. */
  repeatable?: boolean;
}

export interface ToolPointer {
  screen: Vec2;
  /** Raw cursor in sketch mm. */
  world: Vec2;
  /** Resolved by the tool's `snap()` options; kind 'none' when the tool has no `snap`. */
  snapped: Inference;
  button: number;
  shift: boolean;
  alt: boolean;
  /** Cmd or Ctrl. */
  mod: boolean;
  /** True on `move` while a button is held and the pointer travelled past the click threshold. */
  dragging: boolean;
}

/** Event handlers. Every member is optional. */
export interface Tool {
  start?(): void;
  /** Always called when the tool ends. Clear whatever `start` set up. */
  stop?(): void;
  /** Inference options for the next pointer event. Return null for no snapping. */
  snap?(): SnapOptions | null;
  move?(e: ToolPointer): void;
  down?(e: ToolPointer): void;
  up?(e: ToolPointer): void;
  /** Press and release without travel. */
  click?(e: ToolPointer): void;
  dblclick?(e: ToolPointer): void;
  /** Return false, or omit, to end the tool. */
  enter?(): boolean;
  /** Cancel the current action and return true; return false, or omit, to end the tool. */
  escape?(): boolean;
  /** Keys not in the global table, while no input has focus. Return true when consumed. */
  key?(e: KeyboardEvent): boolean;
  /** Draw on the preview layer. Runs on every frame the canvas repaints. */
  draw?(p: Preview): void;
  /** Items to add to the marking menu, shown first. */
  menu?(hit: Hit | null): MenuItem[];
  /** The document changed under the tool (undo, redo). Re-read everything by id. */
  docChanged?(): void;
  selectionChanged?(): void;
}

export interface ToolDef {
  meta: ToolMeta;
  /** `arg` comes from `ctx.activate(id, arg)`, e.g. the pattern a glyph double-click should edit. */
  create(ctx: ToolContext, arg?: unknown): Tool;
}

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  disabled?: string | null;
  checked?: boolean;
  run(): void;
}

/** One value box on the heads-up display. */
export interface HudField {
  key: string;
  /** Short label, e.g. 'W'. Optional. */
  label?: string;
  kind: 'length' | 'angle' | 'number';
  /** Live value in mm, radians or a plain number. */
  value: number;
  /** Where to float it, in sketch mm. */
  at: Vec2;
  /** How a typed value moves the cursor. Applied in field order; omit for informational fields. */
  lock?: (p: Vec2, value: number) => Vec2;
}

export interface HudLock { value: number; expression: string }

export interface ValueEditor {
  at: Vec2;
  kind: 'length' | 'angle' | 'number';
  initial: string;
  /** Dimension name, for the pill under the field. */
  name?: string;
  /** Return false to keep the editor open, e.g. on a rejected value. */
  accept(expression: string, value: number): boolean | void;
  cancel(): void;
}

export interface HudApi {
  /** Show these fields, keeping anything already typed. Call on each move with live values. */
  set(fields: HudField[]): void;
  clear(): void;
  /** Move to the next step of a multi-click tool: fields go, typed values stay readable by `locked`. */
  advance(): void;
  /** Typed value of a field, or null if it is still live. */
  locked(key: string): HudLock | null;
  /** Any field holds a valid typed value. */
  hasLocks(): boolean;
  /** No field holds text that fails to parse. */
  valid(): boolean;
  /** Run a cursor position through every locked field's `lock`. */
  apply(p: Vec2): Vec2;
  /** The check icon that ends a chain [ref]. Null hides it. */
  check(at: Vec2 | null, onClick?: () => void): void;
  /** One-shot value box for dimensions. */
  edit(editor: ValueEditor): void;
  closeEditor(): void;
}

/** A click: position plus the inference it landed on. */
export interface Placed { pos: Vec2; inference: Inference }

export const placedAt = (pos: Vec2): Placed => ({ pos, inference: noInference(pos) });

/**
 * The argument of `ctx.commit`. Build geometry with src/model/document.ts against `design` and
 * `sketch`; the framework solves, runs the driven-dimension pass and records one undo step after.
 */
export interface CommitScope {
  readonly design: Design;
  readonly sketch: Sketch;
  /** Pass to addLine, addArc etc. so geometry honours the palette Linetype. */
  readonly curveOpts: CurveOpts;
  /** Add the constraints this click implied (coincident, midpoint, tangent, H/V...) to a placed point. */
  infer(point: Id, placed: Placed, opts?: ApplyOptions): void;
  /** Same for a curve with no stored point at the click: a circle through an existing point. */
  inferRim(curve: Id, placed: Placed): void;
  /** If the HUD field `key` is locked, add a driving dimension with the typed expression. */
  hudDimension(key: string, kind: DimensionKind, refs: Id[], init?: DimensionInit): void;
  /** Add a dimension at the measured value. Becomes Driven if it would over-constrain [ref]. */
  dimension(kind: DimensionKind, refs: Id[], init?: DimensionInit): void;
  /** Keep these points in place during the solve. Constraint tools hold the first pick. */
  hold(...points: Id[]): void;
  /** Replace the selection once the commit lands. */
  select(...ids: Id[]): void;
}

export interface CommitOptions {
  /** Consecutive commits with the same key inside 800 ms merge into one undo step. */
  coalesce?: string;
}

export interface SolverApi {
  /** One drag frame, `analyze: false`. Mutates the live sketch; finish with `commit` or `revert`. */
  drag(targets: { point: Id; x: number; y: number }[], hold?: Id[]): SolveResult;
  /** Would this dimension over-constrain the sketch, with other layers held as a commit would hold them. */
  wouldOverConstrain(dim: Dimension): boolean;
}

export interface PaletteRow {
  key: string;
  label: string;
  kind: 'checkbox' | 'select' | 'number' | 'button';
  value?: boolean | number | string;
  options?: { value: string; label: string }[];
  /** On a select: the usual values as buttons ahead of the list [ref SKT-REF-SPLINE-DEGREE-CONTROL]. */
  quick?: { value: string; label: string; title: string }[];
  onChange(value: boolean | number | string): void;
}

export interface PaletteApi {
  /** Extra Feature Options rows for the active tool. Cleared when the tool ends. */
  options(rows: PaletteRow[]): void;
}

export interface ToolContext {
  readonly design: Design;
  /** The active sketch. Objects can be replaced by any solve: re-read by id, never hold them. */
  readonly sketch: Sketch;
  readonly view: View;
  /** Palette Linetype for new geometry. */
  readonly lineType: LineType;
  /** Last pointer event, for tools started by keyboard. */
  readonly pointer: ToolPointer | null;
  readonly hud: HudApi;
  readonly selection: Selection;
  readonly dialogs: DialogHost;
  readonly palette: PaletteApi;
  readonly solver: SolverApi;
  /** Cached result of the last analysis of the active sketch. */
  readonly analysis: SketchAnalysis;
  hit(screen: Vec2, opts?: HitOptions): Hit | null;
  /**
   * Other visible sketches as this one sees them, in its coordinates, ids unchanged: those on its plane,
   * and the lines of others that lie in it (src/model/seen.ts). Pick from these, not from the design.
   */
  others(): Sketch[];
  /** Show the Min Distance of these two objects on the status bar, and light them, without selecting them. Null or empty clears it. */
  measure(ids: Id[] | null): void;
  /** Capture the design as it is, and return what to call once a file made from it has been saved: that counts the design as saved. */
  savePoint(): () => void;
  /** Whether this id is on the active layer, and that layer is unlocked. Others are template geometry. */
  editable(id: Id): boolean;
  /** Whether a pick is on a layer other than the active one. The origin and axes are on none. */
  foreign(hit: Hit): boolean;
  /** Whether a pick is on the active layer. */
  onActive(hit: Hit): boolean;
  /** The hit a stored id corresponds to, or null. */
  hitOf(id: Id): Hit | null;
  /** The name of the other layer whose geometry is under the cursor, or null. */
  layerUnder(screen: Vec2): string | null;
  /** Light up one entity as hovered. */
  setHover(hit: Hit | null): void;
  /** Light up ids as selected without touching the selection, for dialog fields. */
  setHighlight(ids: Id[]): void;
  /** Status bar prompt. */
  status(prompt: string): void;
  /** Transient note in the status bar. */
  message(text: string, kind?: 'info' | 'warn'): void;
  clearNote(): void;
  /**
   * The one way to change the document. `fn` mutates through the scope; return false to abandon
   * (the document reverts and no undo step is made). Returns whether a step was recorded.
   */
  commit(label: string, fn: (c: CommitScope) => void | boolean, opts?: CommitOptions): boolean;
  /** Throw away live changes since the last commit, e.g. a cancelled drag. */
  revert(): void;
  /** Start counting commits as one undo step, for a dialog of several edits: `end` keeps them, `drop` undoes them and leaves no step. */
  groupUndo(): { end(): void; drop(): void };
  /** End this tool, back to select. */
  end(): void;
  /** Finish the sketch, back to design mode. */
  finishSketch(): void;
  /** Ask for a repaint. Pointer and HUD events repaint anyway. */
  invalidate(): void;
  /** Start another tool, optionally handing it an argument. */
  activate(toolId: string, arg?: unknown): void;
  /** Closed regions of the active sketch, cached per solve. Use this, not findProfiles. */
  profiles(): Profile[];
  /** Window (or crossing) contents between two sketch positions. */
  boxSelect(a: Vec2, b: Vec2, crossing: boolean): Id[];
  /** Open the value editor on a dimension [ref: double-click]. */
  editDimension(id: Id): void;
  /** Run a registered double-click handler for this hit. True if one took it. */
  runDoubleClick(hit: Hit): boolean;
}

// ---------------------------------------------------------------------------
// Click tools: a declarative step list instead of a state machine.

export interface ClickState {
  readonly ctx: ToolContext;
  /** Index of the step waiting for its click. */
  readonly step: number;
  /** Clicks so far. */
  readonly picks: readonly Placed[];
  /** The live cursor, HUD locks applied. */
  readonly cursor: Placed;
  /** Position of pick i, or the cursor when it is not placed yet. */
  at(i: number): Vec2;
  /** Pick i, or the cursor when it is not placed yet. */
  placed(i: number): Placed;
}

export interface ClickStep {
  /** Status bar text while waiting for this click. */
  prompt: string;
  /** Index of the pick this click's segment starts from, to enable direction inference. */
  from?: number;
  /** Full inference options, for when `from` is not enough. Takes precedence over it. */
  snap?(s: ClickState): SnapOptions;
  /** HUD fields while this step is live. Rebuilt on every move. */
  fields?(s: ClickState): HudField[];
  /** Reject a click: return a message, or false. Coincident picks are already rejected. */
  valid?(s: ClickState): boolean | string;
}

export interface ClickToolSpec {
  meta: ToolMeta;
  steps: ClickStep[];
  /** Draw the shape so far; runs from the first pick on. */
  preview?(p: Preview, s: ClickState): void;
  /** Build the geometry. `s.picks` holds one Placed per step. */
  commit(c: CommitScope, s: ClickState): void | boolean;
  /** Label of the undo step. Defaults to meta.label. */
  label?: string;
  /** Extra palette rows or other setup. */
  start?(ctx: ToolContext): void;
}

const SAME_SPOT = 1e-6;

export function defineClickTool(spec: ClickToolSpec): ToolDef {
  return {
    meta: spec.meta,
    create(ctx) {
      const picks: Placed[] = [];
      let raw: Placed = placedAt({ x: 0, y: 0 });
      let cursor: Placed = raw;
      const state: ClickState = {
        ctx,
        get step() { return picks.length; },
        picks,
        get cursor() { return cursor; },
        at: (i) => (picks[i] ?? cursor).pos,
        placed: (i) => picks[i] ?? cursor,
      };
      const step = (): ClickStep => spec.steps[picks.length];
      const prompt = (): void => ctx.status(step().prompt);

      const refresh = (): void => {
        const fields = step().fields;
        if (!fields) {
          cursor = raw;
          return;
        }
        cursor = raw;
        ctx.hud.set(fields(state));
        const pos = ctx.hud.apply(raw.pos);
        cursor = dist(pos, raw.pos) > 1e-9 ? placedAt(pos) : raw;
        ctx.hud.set(fields(state));
      };
      const reset = (): void => {
        picks.length = 0;
        ctx.hud.clear();
        prompt();
      };
      const place = (): void => {
        if (!ctx.hud.valid()) {
          ctx.message('That value is not valid', 'warn');
          return;
        }
        if (picks.some((p) => dist(p.pos, cursor.pos) < SAME_SPOT)) {
          ctx.message('Pick a different point', 'warn');
          return;
        }
        const verdict = step().valid?.(state) ?? true;
        if (verdict !== true) {
          ctx.message(typeof verdict === 'string' ? verdict : 'Not a valid point here', 'warn');
          return;
        }
        picks.push(cursor);
        if (picks.length < spec.steps.length) {
          ctx.hud.advance();
          refresh();
          prompt();
          return;
        }
        const done = ctx.commit(spec.label ?? spec.meta.label, (c) => spec.commit(c, state));
        if (!done) picks.pop();
        else reset();
      };

      return {
        start() {
          ctx.selection.clear();
          spec.start?.(ctx);
          prompt();
        },
        stop() {
          ctx.hud.clear();
        },
        snap() {
          const { from, snap } = step();
          if (snap) return snap(state);
          return from === undefined ? {} : { from: picks[from].pos };
        },
        move(e) {
          raw = { pos: e.snapped.pos, inference: e.snapped };
          refresh();
        },
        click(e) {
          raw = { pos: e.snapped.pos, inference: e.snapped };
          refresh();
          place();
        },
        enter() {
          if (picks.length === 0 || !ctx.hud.hasLocks()) return false;
          refresh();
          place();
          return true;
        },
        escape() {
          if (picks.length === 0 && !ctx.hud.hasLocks()) return false;
          reset();
          return true;
        },
        draw(p) {
          if (picks.length > 0) spec.preview?.(p, state);
        },
        docChanged: reset,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Small geometry helpers shared by tools.

/** Field helper: a length measured from `origin` along the cursor direction. */
export function radialLock(origin: Vec2, scale = 1): (p: Vec2, v: number) => Vec2 {
  return (p, v) => {
    const d = Math.hypot(p.x - origin.x, p.y - origin.y);
    const u = d > 1e-9 ? { x: (p.x - origin.x) / d, y: (p.y - origin.y) / d } : { x: 1, y: 0 };
    return { x: origin.x + (u.x * v) / scale, y: origin.y + (u.y * v) / scale };
  };
}

/** Field helper: an angle from +X about `origin`, keeping the cursor distance. */
export function angleLock(origin: Vec2): (p: Vec2, v: number) => Vec2 {
  return (p, v) => {
    const d = Math.hypot(p.x - origin.x, p.y - origin.y) || 1;
    return { x: origin.x + Math.cos(v) * d, y: origin.y + Math.sin(v) * d };
  };
}

/** Screen-space stroke for the palette Linetype, for previews. */
export function previewStroke(lineType: LineType): Stroke {
  if (lineType === 'construction') return { color: COLORS.construction, dash: [7, 5] };
  if (lineType === 'centerline') return { color: COLORS.construction, dash: [14, 4, 3, 4] };
  return { color: COLORS.preview };
}

export type { Curve };
