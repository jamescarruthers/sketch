// Every tool and extension in the app. Adding a tool: one file under src/tools/, one line here.
import type { Hit } from '../app/hit';
import type { Id } from '../model/types';
import type { MenuItem, PaletteRow, Preview, ToolContext, ToolDef } from './tool';
import { circleTools } from './circle';
import { constraintTools, fixOverlay } from './constraints';
import { dimensionTool } from './dimension';
import { deleteCoincident, editDimensionAction, toggleDriven } from './context';
import { breakLinkAction, lostProjectionsOverlay, lostProjectionsTool, manageLostAction } from './lost-projections';
import { lineTool } from './line';
import { midpointLineTool } from './midpoint-line';
import { rectangleTools } from './rectangle';
import { selectTool } from './select';
import { arcTools } from './arc';
import { tangentCircleTools } from './tangent-circle';
import { polygonTools } from './polygon';
import { ellipseTools } from './ellipse';
import { filletTool } from './fillet';
import { chamferTools } from './chamfer';
import { trimTools } from './trim';
import { scaleTool } from './scale';
import { addOffsetDimensionAction, offsetTool } from './offset';
import { blendTool } from './blend';
import { measureTool } from './measure';
import { moveTool } from './move';
import { parametersTool } from './parameters';
import { mirrorTool } from './mirror';
import { editPatternOnGlyph, patternTools } from './pattern';
import { autoConstrainOverlay, autoConstrainTools } from './autoconstrain';
import { exportDxfAction } from './export-dxf';
import { exportSvgAction } from './export-svg';
import { slotTools } from './slot';
import { conicTools } from './conic';
import { pointTools } from './point';
import { SPLINE_CONTEXT_ACTIONS, SPLINE_SELECTION_OPTIONS, splineOverlay, splineTools } from './spline';
import { editTextOnDoubleClick, explodeTextAction, textTools } from './text';
import { projectTools } from './project';

export const TOOLS: ToolDef[] = [
  selectTool,
  lineTool,
  midpointLineTool,
  ...rectangleTools,
  ...circleTools,
  dimensionTool,
  ...constraintTools,
  ...arcTools,
  ...tangentCircleTools,
  ...polygonTools,
  ...ellipseTools,
  filletTool,
  ...chamferTools,
  ...trimTools,
  scaleTool,
  offsetTool,
  blendTool,
  moveTool,
  parametersTool,
  mirrorTool,
  ...patternTools,
  ...autoConstrainTools,
  ...slotTools,
  ...conicTools,
  ...pointTools,
  ...splineTools,
  ...textTools,
  ...projectTools,
  lostProjectionsTool,
  measureTool,
  // Add tools above this line.
];

/** Marking-menu entries that depend on what was right-clicked, e.g. Explode Text, Delete Coincident. */
export interface ContextAction {
  id: string;
  label: string;
  /** When the wording depends on what was right-clicked. */
  labelFor?(ctx: ToolContext, hit: Hit | null): string;
  icon?: string;
  /** `hit` is what the cursor was on, or null on empty canvas. */
  applies(ctx: ToolContext, hit: Hit | null): boolean;
  run(ctx: ToolContext, hit: Hit | null): void;
}

export const CONTEXT_ACTIONS: ContextAction[] = [
  editDimensionAction,
  toggleDriven,
  deleteCoincident,
  addOffsetDimensionAction,
  breakLinkAction,
  manageLostAction,
  ...SPLINE_CONTEXT_ACTIONS,
  explodeTextAction,
  // Add context actions above this line.
];

/** Double-click on something other than a curve or a dimension, e.g. a pattern glyph, text. */
export interface DoubleClickHandler {
  applies(ctx: ToolContext, hit: Hit): boolean;
  run(ctx: ToolContext, hit: Hit): void;
}

export const DOUBLE_CLICK: DoubleClickHandler[] = [
  editPatternOnGlyph,
  editTextOnDoubleClick,
  // Add double-click handlers above this line.
];

/** Actions from the browser's sketch menu. `export-dxf` is listed in src/ui/browser.ts. */
export interface SketchAction {
  id: string;
  run(ctx: ToolContext, sketch: Id): void;
}

export const SKETCH_ACTIONS: SketchAction[] = [
  exportDxfAction,
  exportSvgAction,
  // Add sketch actions above this line.
];

/** Extra rows for the palette's contextual section when the selection matches, e.g. Curvature Comb. */
export interface SelectionOptions {
  rows(ctx: ToolContext): PaletteRow[];
}

export const SELECTION_OPTIONS: SelectionOptions[] = [
  SPLINE_SELECTION_OPTIONS,
  // Add selection palette rows above this line.
];

/** Persistent canvas drawing outside any tool, e.g. curvature combs, offset glyphs. Sketch mode only. */
export type Overlay = (ctx: ToolContext, p: Preview) => void;

export const OVERLAYS: Overlay[] = [
  autoConstrainOverlay,
  lostProjectionsOverlay,
  splineOverlay,
  fixOverlay,
  // Add overlays above this line.
];

export type { MenuItem };
