// Application state and command dispatch. Everything that changes the document passes through here.
import type { Constraint, Curve, Design, Dimension, Feature, Frame, Id, Layer, LineType, Plane, Point, Sketch, TextEntity, Vec2, Vec3 } from '../model/types';
import {
  addDimension, addLine, copySelection, curvePoints, deleteEntities, deleteSketch, getPointPos, literalExpression, newDesign, newSketch,
  pasteClipboard, toggleConstruction, type Clipboard,
} from '../model/document';
import {
  add3, cross3, dot3, fold, foldArrows, isFrame, len3, meetingLines, norm3, normalOf, planeFrame, PLANE_FRAMES, PLANE_NAMES, rollAngle, sameFrame,
  samePlane, scale3, sub3, tidyFrame, toPlane, toWorld, type Arrow,
} from '../model/frames';
import { isEmpty, seenFrom } from '../model/seen';
import { AXIS_X, AXIS_Y, ORIGIN } from '../model/types';
import { History } from '../model/history';
import {
  activeLayerOf, addLayer, layerById, moveToLayer, ownerLayer, planFreeze, pointLayer, refLayer, removeLayer, stampCrossLayer, type Freeze,
} from '../model/layers';
import { danglingNames, evaluateInDesign, keepLostValues, lastValues, measureDimension, refreshDriven, resolveAll, wouldCycle, drivenReference } from '../model/parameters';
import { boundingBox, sampleForRender } from '../geom/curves';
import { minDistanceBetween, shapeKey } from '../geom/min-distance';
import { setCutterFilter } from '../geom/modify';
import { findProfiles, type Profile } from '../geom/profiles';
import { boxAdd, emptyBox, type Box } from '../geom/vec';
import { createAutosave, deserialize, fingerprint, serialize, type Autosave } from '../io/project';
import { loadSvg, looksLikeSvg } from '../io/svg-data';
import { AXIS_REACH, isLinked, linkedCopy, projectAxis, projectPoint, syncProjections } from '../io/projection';
import { syncFrameEdges, textOutlines } from '../io/text';
import { layoutDimension } from '../render/dimensions';
import { analyzeSketch, brokenOf, solveSketch, unmetOf, wouldOverConstrain, type SolveOptions } from '../solver/bridge';
import { followLabels } from '../render/dimensions';
import { Renderer } from '../render/renderer';
import { COLORS, onCanvas } from '../render/style';
import { ThemeController } from './theme';
import { WheelGestures } from './wheel';
import type { Preview } from '../render/painter';
import { downloadText } from '../tools/download';
import { openSvgDialog } from '../tools/export-svg';
import { allEntries } from '../tools/menu';
import { openPrintDialog } from '../tools/print';
import { CONTEXT_ACTIONS, DOUBLE_CLICK, SKETCH_ACTIONS, TOOLS, type Overlay } from '../tools/registry';
import type {
  CommitOptions, CommitScope, MenuItem, PaletteRow, Tool, ToolContext, ToolDef, ToolPointer,
} from '../tools/tool';
import { Browser } from '../ui/browser';
import { LayersPanel } from '../ui/layers';
import { DialogHost } from '../ui/dialogs/dialog';
import { openRecoverDialog, RescueNote } from '../ui/dialogs/recover';
import { Hud } from '../ui/hud';
import { icon } from '../ui/icons';
import { MarkingMenu, type RadialItem } from '../ui/marking-menu';
import { Palette } from '../ui/palette';
import { StatusBar } from '../ui/status';
import { Toolbar } from '../ui/toolbar';
import { Toolbox } from '../ui/toolbox';
import {
  between, facing, FrameView, HOME, orbitBy, panBy as panCamera, planeAt, project, screenView, turn, zoomAt as zoomCamera, type Camera,
} from './camera';
import { boxSelect, hitOf, hitTest, textShape, visiblePoints, type Hit, type HitEnv, type HitOptions, type TextShape } from './hit';
import { isTextTarget, keyName, keyTable, type KeyBinding } from './keyboard';
import { Selection } from './selection';
import { applyInference, applyRimInference, localize, noInference, Snapper, type Inference } from './snap';
import { View } from './view';
import { CUBE_BOX, CUBE_HALF, CUBE_ICON, cubePick, targetName, targetNamed, targetPoint, targetTurn, visibleFaces, type CubeLayout, type CubeTarget, type Turn } from './viewcube';

/** How near a label (screen px) a click counts as picking that dimension. */
const SHOWN_DIM_PX = 26;

export interface Settings {
  grid: boolean;
  snap: boolean;
  showProfile: boolean;
  showPoints: boolean;
  showDimensions: boolean;
  showConstraints: boolean;
  showConstruction: boolean;
  showProjected: boolean;
  /** Lines where the planes of other visible sketches meet this one. */
  showPlanes: boolean;
  /** The active layer in Fusion status colours and every other in plain layer colour. Off: all in layer colour. */
  showConstrained: boolean;
  /** Construction and centerlines of other layers are not drawn. */
  constructionActiveOnly: boolean;
}

export interface SketchAnalysis {
  ok: boolean;
  /** -1 until analysed. */
  dof: number;
  freeCurves: Set<Id>;
  freePoints: Set<Id>;
  /** Constraints and dimensions the solver could not meet. */
  unsatisfied: Set<Id>;
  /** Curves touched by an unsatisfied constraint or dimension: these draw red. */
  badCurves: Set<Id>;
  /** Of those, the curves of a conflict that spans layers, which draw red on any layer. */
  crossCurves: Set<Id>;
  /** Links from moved geometry to a locked dependent that the move left unsatisfied. */
  brokenLinks: Set<Id>;
}

export type AppEvent = 'doc' | 'selection' | 'tool' | 'mode' | 'settings' | 'status' | 'cursor';

export interface Command {
  id: string;
  label: string;
  icon?: string;
  run(): void;
  disabled?(): string | null;
}

const CLICK_TRAVEL = 4;
/** The ViewCube's clearance from the canvas's edges, and from a panel it sits beside, in CSS px. */
const CUBE_MARGIN = 8;
const CUBE_GAP = 8;
const UI_KEY = 'sketch.ui';
/** A point of a Curvature curve moved this far (mm) on opening has changed; less is the rounding of a solve. */
const SETTLED = 1e-6;
/** Solves of a sketch on opening, each from the last, for it to stop moving. */
const SETTLE_ROUNDS = 3;
const pointMove = (a?: { x: number; y: number }, b?: { x: number; y: number }): number => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);

/** Fingerprint of the design as last saved, opened or started new, so a reload still knows whether anything is unsaved. */
const SAVED_KEY = 'sketch.saved';
/** Where an older version put its one rescued autosave. */
const OLD_RESCUED_KEY = 'sketch.autosave.rescued';

const emptyAnalysis = (): SketchAnalysis => ({
  ok: true, dof: -1, freeCurves: new Set(), freePoints: new Set(), unsatisfied: new Set(), badCurves: new Set(), crossCurves: new Set(), brokenLinks: new Set(),
});

/** Clear space round a fit, inside what the panels leave. */
const FIT_MARGIN = 40;

/** How long the camera takes to swing over a hinge, and to roll level after it, in ms. */
const SWING_MS = 340;
const ROLL_MS = 140;
/** Into and out of the Orbit view, and onto a sketch picked in it. */
const ORBIT_MS = 360;
const ORBIT_PROMPT = 'Orbit: drag to turn the view, click a sketch to edit it, Esc to go back';
/** Design mode is the Orbit view, with nothing to go back to. */
const DESIGN_PROMPT = 'Create a sketch, or click one to edit it; drag to turn the view';
const PICK_PROMPT = 'Select a plane for the sketch, or press Esc';
/** Commands the Orbit view opened from a sketch takes from the keyboard. Everything else waits until it closes. */
const ORBIT_KEYS = new Set(['orbit', 'escape', 'fit', 'undo', 'redo', 'save', 'open', 'new', 'print']);
const ARROWS: Arrow[] = ['up', 'down', 'left', 'right'];
/** How near a plane line (screen px) the cursor picks it: as near as a curve. */
const PLANE_LINE_PX = 6;
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Where a sketch is looked at in plan: the view's centre, in its coordinates, and zoom. */
type PlanView = { cx: number; cy: number; ppm: number };
const planOf = (v: PlanView): PlanView => ({ cx: v.cx, cy: v.cy, ppm: v.ppm });

/** What to say when expressions took over the value of a name that went away. */
const lostNote = (names: string[]): string => `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} gone: what used ${names.length === 1 ? 'it' : 'them'} keeps ${names.length === 1 ? 'its' : 'their'} last value as a number`;

export class App {
  design: Design = newDesign();
  history = new History(this.design);
  mode: 'design' | 'sketch' = 'design';
  activeId: Id | null = null;
  /** The plane the canvas looks straight at, in whose coordinates the view is: the active sketch's, in Sketch mode. */
  frame: Frame = planeFrame('XY');
  /** What the canvas shows in 3D: during a swing, and in the Orbit view, design mode's included. Null when it shows `frame` in plan. */
  scene: Camera | null = null;
  /** The sketch under the cursor in the Orbit view, drawn lit. */
  orbitHover: Id | null = null;
  /** The origin plane under the cursor while one is picked, drawn lit. */
  pickHover: Plane | null = null;
  /** The plane line under the cursor in Sketch mode, drawn lit. */
  planeHover: { p: Vec2; d: Vec2; ids: Id[] } | null = null;
  /** The face, edge or corner of the ViewCube under the cursor, by name, drawn lit. */
  cubeHover: string | null = null;
  readonly view = new View();
  readonly selection = new Selection();
  settings: Settings = {
    grid: true, snap: false, showProfile: true, showPoints: true, showDimensions: true, showConstraints: true,
    showConstruction: true, showProjected: true, showPlanes: true, showConstrained: true, constructionActiveOnly: true,
  };
  lineType: LineType = 'normal';
  hover: Hit | null = null;
  highlight: Id[] = [];
  /** Sketches whose dimensions show in design mode [ref browser Show Dimensions]. */
  dimensionsInDesign = new Set<Id>();
  /** Find Under-Constrained's filter: only what can still move is drawn. */
  hideConstrained = false;
  statusText = '';
  noteText = '';
  noteKind: 'info' | 'warn' = 'info';
  cursorWorld: Vec2 = { x: 0, y: 0 };
  inference: Inference | null = null;
  toolOptions: PaletteRow[] = [];
  lastTool: string | null = null;
  geomVersion = 0;
  /** Times Min Distance has been worked out: once per change of geometry or selection, and only for exactly two objects. */
  minDistanceRuns = 0;
  /** Times the time to solve has been taken: once per commit or drag step or first look at a sketch, however many solves that took. */
  solveRuns = 0;
  frames = 0;
  frameMs = 0;

  readonly commands = new Map<string, Command>();
  readonly tools = new Map<string, ToolDef>(TOOLS.map((t) => [t.meta.id, t]));
  readonly keys: KeyBinding[] = keyTable();
  private toolDef: ToolDef | null = null;
  private tool: Tool | null = null;
  private readonly ctx: ToolContext;
  private readonly listeners = new Map<AppEvent, (() => void)[]>();
  private readonly analyses = new Map<Id, SketchAnalysis>();
  /** Why the solver threw out the running commit's solve; the commit reverts on it. */
  private refusal: string | null = null;
  /** Sketches back from history and untouched since: a snapshot is the state, so nothing solves it again. */
  private restored = new Set<Id>();

  /** Line type a toggle asks of a curve: Normal/Centerline flips, like Normal/Construction [ref SKT-CENTERLINE-GEOMETRY]. */
  private toggleCenterline(): void {
    const ids = this.selectedCurves();
    if (ids.length) {
      this.commit('Normal/Centerline', ({ sketch }) => {
        for (const id of ids) {
          const c = sketch.curves[id];
          if (c && !c.projected) c.lineType = c.lineType === 'centerline' ? 'normal' : 'centerline';
        }
      });
    }
  }
  private readonly profiles = new Map<Id, Profile[]>();
  private readonly polylines = new Map<Id, Vec2[]>();
  private readonly textShapes = new Map<Id, TextShape>();
  private polylinePpm = 0;
  private labelAnchors = new Map<Id, Vec2>();
  /** Read for every curve of every frame, so kept apart from the design's list. */
  private readonly hiddenLayers = new Set<Id>();
  private readonly layerColors = new Map<Id, string>();
  /** Ids the running Delete asked for by name: those need no note about what went with them. */
  private deleting = new Set<Id>();
  private readonly snapper = new Snapper();
  private clipboard: Clipboard | null = null;
  private autosave!: Autosave;
  /** The history entry that matches the last save, open or new. Null when the design has changed in a way no entry records. */
  private saved: { history: History; rev: number } | null = null;
  private readonly rescueNote = new RescueNote();
  private frameRequested = false;
  /** The two objects the Measure tool has picked, when it has: they take the place of the selection for Min Distance. */
  private measured: Id[] | null = null;
  private minDistanceKey = '';
  private minDistanceValue: number | null = null;
  /** Time of the last solve of each sketch, in ms. Kept apart from the analysis, which a revert or an undo throws away. */
  private readonly solveMs = new Map<Id, number>();
  /** Dimensions and parameters whose expression names something that is not there, with what to say. */
  badNames = new Map<string, string>();
  /** The solves of the request running now, by sketch: a commit is one request however many solves it takes. */
  private request: Map<Id, number> | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  private pointer: ToolPointer | null = null;
  private press: { screen: Vec2; button: number } | null = null;
  private pan: Vec2 | null = null;
  private spaceHeld = false;
  /**
   * Open while the Orbit view is. `back`: the sketch it was opened from, to go back to. Null in design mode, which is
   * the Orbit view with nowhere to go back to.
   */
  private orbit: { back: (PlanView & { frame: Frame }) | null } | null = null;
  /**
   * Create Sketch and Redefine Sketch Plane: an origin plane is picked in the Orbit view, and `chosen` takes it.
   * `opened`: the pick opened the Orbit view from a sketch, so Esc goes back there.
   */
  private pick: { chosen: (plane: Plane, opened: boolean) => void; opened: boolean } | null = null;
  /** Which way design mode looked when a sketch was opened from it, for Finish Sketch to swing back out to. */
  private designTurn: { right: Vec3; up: Vec3 } = HOME;
  /** Design mode's camera is its own fit, looking this way, so a resize fits it again. Null once it is turned, zoomed or panned. */
  private homed: { right: Vec3; up: Vec3 } | null = null;
  /** Where each sketch was last looked at in plan this session. */
  private readonly views = new Map<Id, PlanView>();
  /** The last of those, or the one a reload restored: a new sketch opens there. */
  private planView: PlanView = { cx: 0, cy: 0, ppm: 4 };
  /** A drag or click in the Orbit view. */
  private orbitPress: { last: Vec2; travel: number } | null = null;
  /** How far the origin planes reach in the 3D view, in mm; set as each swing starts. */
  private reach = 50;
  /** The camera is swinging: input waits until it lands. */
  private swing: { land: () => void } | null = null;
  /** Where the ViewCube was last drawn, on the canvas, or null when there was no room for it. */
  private cube: CubeLayout | null = null;
  /** A press on the ViewCube: a click turns the camera to what was under it, a drag orbits. */
  private cubePress: { last: Vec2; travel: number; target: CubeTarget } | null = null;
  /** The canvas cursor from before the ViewCube took it, to give back. */
  private cubeCursor = '';
  private readonly cubeHome = document.createElement('button');
  /** Other sketches as the one on `frame` sees them, kept until that frame or they change. */
  private readonly seen = new Map<Id, { from: Sketch; view: Sketch }>();

  readonly canvas: HTMLCanvasElement;
  readonly stage: HTMLElement;
  /** What the active tool wants next, by the cursor [ref images, GUID-E8C8752F]. */
  private readonly tip = document.createElement('div');
  readonly renderer: Renderer;
  readonly hud: Hud;
  readonly dialogs: DialogHost;
  readonly toolbar: Toolbar;
  readonly palette: Palette;
  readonly browser: Browser;
  readonly layersPanel: LayersPanel;
  readonly statusBar: StatusBar;
  readonly toolbox: Toolbox;
  readonly marking: MarkingMenu;
  /** System, Light or Dark. A browser preference: never part of the design or its history. */
  readonly theme = new ThemeController(() => this.themeChanged());

  constructor(root: HTMLElement) {
    this.ctx = this.makeContext();
    this.registerCommands();

    const shell = document.createElement('div');
    shell.className = 'shell';
    root.append(shell);
    this.toolbar = new Toolbar(this);
    this.stage = document.createElement('div');
    this.stage.className = 'stage';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'canvas';
    this.canvas.tabIndex = 0;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    this.stage.append(this.canvas, overlay);
    this.tip.className = 'cursor-tip';
    overlay.append(this.tip);
    const home = document.createElement('button');
    home.className = 'home-view icon-btn';
    home.title = 'Home View';
    home.setAttribute('aria-label', 'Home View');
    home.innerHTML = icon('home');
    home.onclick = () => this.fit();
    const orbit = document.createElement('button');
    orbit.className = 'orbit-view icon-btn';
    orbit.title = 'Orbit View (V)';
    orbit.setAttribute('aria-label', 'Orbit View');
    orbit.setAttribute('aria-pressed', 'false');
    orbit.innerHTML = icon('orbit');
    orbit.onclick = () => this.run('orbit');
    this.on('mode', () => orbit.setAttribute('aria-pressed', String(!!this.orbit)));
    // The ViewCube's own Home, by its top left; placeCube puts it there.
    this.cubeHome.className = 'cube-home icon-btn';
    this.cubeHome.title = 'Home: isometric, from front right above';
    this.cubeHome.setAttribute('aria-label', 'ViewCube Home');
    this.cubeHome.innerHTML = icon('home');
    this.cubeHome.style.display = 'none';
    this.cubeHome.onclick = () => this.cubeGoHome();
    this.stage.append(home, orbit, this.cubeHome);
    this.statusBar = new StatusBar(this);
    shell.append(this.toolbar.root, this.stage, this.statusBar.root);

    this.hud = new Hud(overlay, this);
    this.dialogs = new DialogHost(this.stage, this);
    this.browser = new Browser(this);
    this.layersPanel = new LayersPanel(this);
    this.palette = new Palette(this);
    this.toolbox = new Toolbox(this);
    this.marking = new MarkingMenu(this);
    const left = document.createElement('div');
    left.className = 'left-column';
    left.append(this.browser.root, this.layersPanel.root);
    this.stage.append(left, this.palette.root, this.rescueNote.root);
    this.renderer = new Renderer(this.canvas, this);
    this.layersChanged();
    setCutterFilter((c) => !this.hiddenLayers.has(c.layer));

    this.selection.onChange(() => {
      this.tool?.selectionChanged?.();
      this.emit('selection');
      this.invalidate();
    });
    this.bindCanvas();
    this.bindKeys();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.watchDpr();
    this.resize();
    this.boot();
  }

  // -------------------------------------------------------------------------
  // Events

  on(event: AppEvent, fn: () => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
  }

  private emit(event: AppEvent): void {
    for (const fn of this.listeners.get(event) ?? []) fn();
  }

  invalidate = (): void => {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.frames++;
      // A drag moves geometry many times between frames; the readout follows once per frame.
      this.statusBar.refreshMinDistance();
      this.statusBar.refreshSolveTime();
      this.hud.position();
      const t0 = performance.now();
      this.renderer.render();
      this.frameMs = performance.now() - t0;
    });
  };

  /**
   * The Min Distance of the two selected objects, in mm; null for any other selection, for a selected thing with no
   * drawn shape (text, a dimension, a constraint glyph) and outside a sketch. Kept against the shape of the two
   * objects, so asking again costs nothing until one of them changes, and a drag elsewhere does not touch it.
   */
  minDistance(): number | null {
    const sketch = this.activeSketch;
    const ids = this.mode !== 'sketch' ? [] : this.measured ?? this.selection.ids();
    if (!sketch || ids.length !== 2) return null;
    const key = `${sketch.id}/${ids.map((id) => `${id}=${shapeKey(sketch, id)}`).sort().join('/')}`;
    if (key !== this.minDistanceKey) {
      this.minDistanceKey = key;
      this.minDistanceRuns++;
      try {
        this.minDistanceValue = minDistanceBetween(sketch, ids[0], ids[1])?.distance ?? null;
      } catch (e) {
        // A half-built object must not stop a commit that is only updating the status bar.
        console.error(e);
        this.minDistanceValue = null;
      }
    }
    return this.minDistanceValue;
  }

  /** Measure's picks: lit on the canvas and read on the status bar, and nothing is selected. Null when the tool is not running. */
  private setMeasured(ids: Id[] | null): void {
    this.measured = ids;
    this.highlight = ids ?? [];
    this.statusBar.refreshMinDistance();
    this.invalidate();
  }

  /** The canvas repaints at once, not on the next frame, so nothing shows in the old colours. */
  private themeChanged(): void {
    if (this.renderer && this.view.width > 0) this.renderer.render();
    this.invalidate();
  }

  /** A resolution query only fires once for its value, so re-arm on every change. */
  private watchDpr(): void {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => {
      this.resize();
      this.watchDpr();
    }, { once: true });
  }

  private resize(): void {
    const box = this.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.view.resize(box.width, box.height, dpr);
    this.canvas.width = Math.round(box.width * dpr);
    this.canvas.height = Math.round(box.height * dpr);
    // Design mode's own fit is fitted again; one the user has turned is left as it is.
    if (this.homed && this.orbit && !this.orbit.back && !this.swing) this.homeNow(this.homed);
    this.invalidate();
  }

  // -------------------------------------------------------------------------
  // Boot and persistence

  private boot(): void {
    this.autosave = createAutosave(localStorage, {
      delayMs: 250,
      onError: (e) => this.message(`Autosave failed: ${String(e)}`, 'warn'),
    });
    // An older version kept one copy under one key. It goes into the list, as its oldest.
    try {
      this.autosave.rescued.migrate(OLD_RESCUED_KEY);
    } catch (e) {
      console.error(e);
    }
    // A design the app starts on has nothing unsaved in it. One read back from the autosave is judged below.
    this.saved = { history: this.history, rev: this.history.rev };
    let lost: string | null = null;
    let tail: { label: string; run(): void } | null = null;
    try {
      const restored = this.autosave.load();
      if (restored) this.replaceDesign(restored, { clean: this.matchesLastSave(restored) });
      else if (this.autosave.stored()) throw new Error('The autosave no longer validates');
    } catch (e) {
      // What is stored may be the only copy of the work: it stays, and the app comes up anyway.
      console.error(e);
      const kept = this.autosave.keep();
      this.replaceDesign(newDesign());
      if (kept?.ok) {
        lost = 'The saved design could not be restored. A copy is kept under File > Recover Designs, and nothing has been written over the original.';
        tail = { label: 'Recover Designs...', run: () => this.showRecover() };
      } else {
        lost = 'The saved design could not be restored, and there is no room in this browser to keep a copy. It stays where it is and nothing has been written over it.';
      }
    }
    this.restoreUi();
    // Design mode is the Orbit view, at Home round what is shown. A sketch left open reopens instead, in plan.
    if (this.mode === 'design') {
      this.showDesign(null);
      this.status(DESIGN_PROMPT);
    }
    if (lost) {
      this.message(lost, 'warn');
      this.rescueNote.show(lost, tail);
    }
    window.addEventListener('pagehide', () => {
      this.autosave.flush();
      this.saveUi();
    });
    this.emit('doc');
    this.emit('mode');
    this.emit('tool');
    this.emit('settings');
    this.invalidate();
  }

  private saveUi(): void {
    // The Orbit view is not kept: a reload comes back to the plane it was opened from, or to design mode at Home.
    // There the view kept is the last sketch's, for the next new one.
    const { cx, cy, ppm } = this.orbit?.back ?? (this.mode === 'sketch' ? this.view : this.planView);
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        activeId: this.mode === 'sketch' ? this.activeId : null, frame: this.orbit?.back?.frame ?? this.frame, cx, cy, ppm, settings: this.settings,
      }));
    } catch {
      // Storage full or denied: the view is not worth a warning.
    }
  }

  private restoreUi(): void {
    try {
      const raw = localStorage.getItem(UI_KEY);
      const ui = raw ? (JSON.parse(raw) as { activeId: Id | null; frame?: unknown; plane?: Plane; cx: number; cy: number; ppm: number; settings: Settings }) : null;
      if (!ui) return;
      Object.assign(this.view, { cx: ui.cx, cy: ui.cy, ppm: ui.ppm });
      this.view.version++;
      this.planView = planOf(this.view);
      this.settings = { ...this.settings, ...ui.settings };
      // An older version kept the plane's name.
      if (isFrame(ui.frame)) this.frame = tidyFrame(ui.frame);
      else if (ui.plane && PLANE_FRAMES[ui.plane]) this.frame = planeFrame(ui.plane);
      this.planeChanged();
      if (ui.activeId && this.design.sketches[ui.activeId]) this.enterSketch(ui.activeId);
    } catch {
      try {
        localStorage.removeItem(UI_KEY);
      } catch {
        // Storage is blocked as well: there is nothing to clear.
      }
    }
  }

  /**
   * Make `design` the open one, all or nothing. What can fail is done first, before any state is touched; and if
   * the swap itself throws part way, the design, its history and the sketch being edited are put back as they were.
   * `clean`: the design is what a file holds, so there is nothing unsaved in it. `leave`: close the open sketch.
   */
  private replaceDesign(design: Design, opts: { clean?: boolean; leave?: boolean } = {}): string | null {
    this.hurry();
    const was = { design: this.design, history: this.history, saved: this.saved, sketch: this.mode === 'sketch' ? this.activeId : null };
    let moved: string[] = [];
    try {
      if (opts.leave) {
        this.endPick();
        this.leaveSketch();
      }
      // What a file holds, to know it by after a reload, whatever opening it goes on to change.
      const print = fingerprint(design);
      this.design = design;
      // Before the history, so the settled shape is the first thing in it.
      moved = this.settleCurvature(design);
      const history = new History(design);
      this.history = history;
      this.saved = opts.clean === false || moved.length > 0 ? null : { history, rev: history.rev };
      this.analyses.clear();
      this.solveMs.clear();
      this.restored.clear();
      this.afterDocSwap();
      if (opts.clean !== false) this.rememberSaved(print);
      // Another design: the views kept were of its sketches, and design mode goes Home round it.
      this.views.clear();
      if (this.mode === 'design' && this.orbit) this.homeNow(HOME);
    } catch (e) {
      this.design = was.design;
      this.history = was.history;
      this.saved = was.saved;
      this.analyses.clear();
      this.restored.clear();
      try {
        this.afterDocSwap();
        if (was.sketch && this.mode !== 'sketch') this.enterSketch(was.sketch);
      } catch (again) {
        console.error(again);
      }
      throw e;
    }
    const [dangling] = this.badNames.values();
    const curved = moved.length ? `The Curvature constraint moved the curve in ${moved.join(', ')} on opening. Save to keep it.` : null;
    const note = [curved, dangling].filter((n): n is string => !!n).join(' ');
    if (note) this.message(note, 'warn');
    return curved;
  }

  /**
   * A file from before a Curvature could reach G2 has the constraint and the old shape. A sketch whose
   * Curvature curves the solve moves takes the new shape now, so nothing can undo back to the old one, and
   * a later commit has nothing to jump for. Returns the names of the sketches that changed.
   */
  private settleCurvature(design: Design): string[] {
    const moved: string[] = [];
    for (const sketch of Object.values(design.sketches)) {
      const curves = Object.values(sketch.constraints).filter((k) => k.type === 'curvature').flatMap((k) => k.refs);
      if (curves.length === 0) continue;
      const copy = structuredClone(sketch);
      const freeze = this.freezeFor(sketch);
      let settled = true;
      for (let round = 0; round < SETTLE_ROUNDS && settled; round++) {
        const before = structuredClone(copy.points);
        const r = solveSketch(copy, { freeze });
        settled = r.ok && !r.refusal;
        if (Math.max(0, ...Object.values(copy.points).map((p) => pointMove(p, before[p.id]))) < SETTLED) break;
      }
      const own = curves.flatMap((id) => (sketch.curves[id] ? curvePoints(sketch.curves[id]) : []));
      if (settled && Math.max(0, ...own.map((id) => pointMove(copy.points[id], sketch.points[id]))) >= SETTLED) {
        design.sketches[sketch.id] = copy;
        moved.push(sketch.name);
      }
    }
    return moved;
  }

  // -------------------------------------------------------------------------
  // Unsaved changes

  /** Whether the design has changed since it was last saved, opened or started new. Undo does not clear it. */
  get dirty(): boolean {
    const s = this.saved;
    return !s || s.history !== this.history || s.rev !== this.history.rev;
  }

  /** The design is now what a file holds. `at` is the state to count as saved, when it is not the present one. */
  private markSaved(at?: { history: History; rev: number; print: string }): void {
    this.saved = at ? { history: at.history, rev: at.rev } : { history: this.history, rev: this.history.rev };
    this.rememberSaved(at?.print ?? fingerprint(this.design));
  }

  /** Kept across a reload, which restores the autosave and has to tell whether it is what a file holds. */
  private rememberSaved(print: string): void {
    try {
      localStorage.setItem(SAVED_KEY, print);
    } catch {
      // No room to say so: a reload then asks about changes it need not have.
    }
  }

  /** Whether a design read back from the autosave is the one last saved, by what was stored when that happened. */
  private matchesLastSave(design: Design): boolean {
    let print: string | null = null;
    try {
      print = localStorage.getItem(SAVED_KEY);
    } catch {
      // Blocked storage knows nothing of a save.
    }
    return print === null ? Object.keys(design.sketches).length === 0 : print === fingerprint(design);
  }

  /**
   * Run `proceed` once the unsaved changes are dealt with. With none it runs at once. Otherwise the app's own
   * dialog asks: Save downloads the project file and goes on, Don't Save goes on, Cancel runs `onCancel` and stops.
   */
  guardUnsaved(proceed: () => void, onCancel?: () => void): void {
    if (!this.dirty) {
      proceed();
      return;
    }
    let choice: 'save' | 'discard' | 'cancel' = 'cancel';
    const d = this.dialogs.open({
      title: 'Unsaved Changes',
      okLabel: 'Save',
      width: 340,
      onOk: () => {
        choice = 'save';
      },
      // After the dialog is gone, and still inside the click, so a file chooser may open.
      onClose: () => {
        if (choice === 'save') this.saveFile();
        if (choice === 'cancel') onCancel?.();
        else proceed();
      },
    });
    d.note(`${this.design.name} has changes that are not saved. Save them before you go on?`);
    d.footButton("Don't Save", () => {
      choice = 'discard';
      d.close();
    });
  }

  private afterDocSwap(): void {
    this.badNames = danglingNames(this.design);
    this.layersChanged();
    this.labelAnchors.clear();
    this.profiles.clear();
    this.dropCurveCaches();
    this.geomVersion++;
    if (this.activeId && !this.design.sketches[this.activeId]) this.leaveSketch();
    this.selection.retain((id) => this.exists(id));
    this.hover = null;
    this.tool?.docChanged?.();
    this.autosave?.schedule(this.design);
    this.emit('doc');
    this.emit('status');
    this.invalidate();
  }

  private exists(id: Id): boolean {
    const s = this.activeSketch;
    return !!s && hitOf(s, id) !== null && this.editable(id);
  }

  // -------------------------------------------------------------------------
  // Layers

  private layersChanged(): void {
    this.hiddenLayers.clear();
    this.layerColors.clear();
    for (const l of this.design.layers) {
      this.layerColors.set(l.id, l.color);
      if (!l.visible) this.hiddenLayers.add(l.id);
    }
  }

  get activeLayer(): Layer {
    return activeLayerOf(this.design);
  }

  layerColor(id: Id): string {
    const stored = this.layerColors.get(id);
    return stored === undefined ? COLORS.free : onCanvas(stored);
  }

  /** One undoable layer change. Geometry is untouched unless `fn` says so. */
  private changeLayers(label: string, fn: (d: Design) => void | boolean, coalesce?: string): void {
    // A note about a layer stops being true the moment layers change.
    this.clearNote();
    if (fn(this.design) === false) return;
    this.history.commit(this.design, { label, coalesce });
    this.afterDocSwap();
  }

  addLayer(): void {
    this.changeLayers('Add Layer', (d) => { addLayer(d); });
  }

  renameLayer(id: Id, name: string): void {
    const l = layerById(this.design, id);
    if (!l || !name.trim() || l.name === name.trim()) return;
    this.changeLayers('Rename Layer', () => { l.name = name.trim(); });
  }

  setLayerColor(id: Id, color: string): void {
    const l = layerById(this.design, id);
    if (l && l.color !== color) this.changeLayers('Layer Colour', () => { l.color = color; }, `layer-color:${id}`);
  }

  setActiveLayer(id: Id): void {
    const l = layerById(this.design, id);
    if (!l || id === this.design.activeLayer) return;
    this.hud.closeEditor();
    this.changeLayers('Set Active Layer', (d) => {
      d.activeLayer = id;
      // Drawing on a layer nobody can see would look like nothing happened.
      l.visible = true;
    }, 'active-layer');
  }

  setLayerVisible(id: Id, visible: boolean): void {
    const l = layerById(this.design, id);
    if (!l || l.visible === visible) return;
    if (!visible && id === this.design.activeLayer) {
      this.message('Make another layer active before hiding this one', 'warn');
      return;
    }
    this.changeLayers(visible ? 'Show Layer' : 'Hide Layer', () => { l.visible = visible; });
  }

  setLayerLocked(id: Id, locked: boolean): void {
    const l = layerById(this.design, id);
    if (!l || l.locked === locked) return;
    this.changeLayers(locked ? 'Lock Layer' : 'Unlock Layer', () => {
      l.locked = locked;
      if (!locked) this.relink(id);
      else if (id === this.design.activeLayer) {
        this.selection.clear();
        this.endTool();
      }
    });
  }

  /** A layer just unlocked: what was held off by its lock can follow now. */
  private relink(id: Id): void {
    for (const s of Object.values(this.design.sketches)) {
      const a = this.analyses.get(s.id);
      if (!a || ![...a.brokenLinks].some((k) => (s.constraints[k] ?? s.dimensions[k])?.dependentLayer === id)) continue;
      const here = this.design.activeLayer;
      const held = Object.values(s.points).filter((p) => pointLayer(s, p) === here).map((p) => p.id);
      this.analyse(s, { hold: held }, [id]);
      this.geometryMoved();
    }
  }

  reorderLayer(id: Id, to: number): void {
    const from = this.design.layers.findIndex((l) => l.id === id);
    if (from < 0 || from === to) return;
    this.changeLayers('Reorder Layers', (d) => {
      const [l] = d.layers.splice(from, 1);
      d.layers.splice(Math.max(0, Math.min(to, d.layers.length)), 0, l);
    });
  }

  deleteLayer(id: Id): void {
    if (this.design.layers.length < 2) {
      this.message('The last layer cannot be deleted', 'warn');
      return;
    }
    this.selection.clear();
    this.changeLayers('Delete Layer', (d) => removeLayer(d, id));
    this.analyses.clear();
    this.restored.clear();
    this.emit('status');
    this.invalidate();
  }

  /** Move to Layer [user]: the selection goes to `layer`, and so leaves the editable set. */
  moveSelectionToLayer(layer: Id): void {
    const target = layerById(this.design, layer);
    if (!target) return;
    if (target.locked) {
      this.message(`Layer "${target.name}" is locked`, 'warn');
      return;
    }
    const ids = this.withoutFrameEdges(this.selection.ids());
    this.selection.clear();
    this.commit('Move to Layer', ({ sketch }) => moveToLayer(sketch, ids, layer).length > 0);
  }

  private get lockedActive(): boolean {
    return this.activeLayer.locked;
  }

  private lockedNote(): string {
    return `Layer "${this.activeLayer.name}" is locked`;
  }

  /** Whether this id is on the active layer and that layer is open to edits. Reserved ids always are. */
  editable = (id: Id): boolean => {
    if (id === ORIGIN || id === AXIS_X || id === AXIS_Y) return true;
    if (this.lockedActive) return false;
    const s = this.activeSketch;
    if (!s) return false;
    const l = refLayer(s, id);
    return l === null || l === this.design.activeLayer;
  };

  /** Whether a constraint or dimension shows now: on its own layer, or anywhere once a link across layers breaks. */
  annotationShown(sketch: Sketch, k: Constraint | Dimension): boolean {
    const owner = ownerLayer(sketch, k);
    if (owner === null || owner === this.design.activeLayer) return true;
    return !!k.dependentLayer && this.analysisOf(sketch.id).unsatisfied.has(k.id);
  }

  featureShown(f: Feature): boolean {
    const s = this.activeSketch;
    if (!s) return false;
    const first = f.type === 'offset' ? f.outputs[0] : f.type === 'mirror' ? f.pairs[0]?.[1] : f.sources[0];
    const l = first ? refLayer(s, first) : null;
    return l === null || l === this.design.activeLayer;
  }

  pointVisible = (p: Point, sketch?: Sketch): boolean => {
    const s = sketch ?? this.activeSketch;
    const l = s ? pointLayer(s, p) : p.layer ?? null;
    return l === null || !this.hiddenLayers.has(l);
  };

  private freezeFor(sketch: Sketch, also?: Id[]): Freeze | null {
    return planFreeze(this.design, sketch, also);
  }

  newFile(): void {
    this.guardUnsaved(() => {
      try {
        this.replaceDesign(newDesign(), { leave: true });
      } catch (e) {
        console.error(e);
        this.message(`A new design could not be started: ${e instanceof Error ? e.message : String(e)}`, 'warn');
      }
    });
  }

  saveFile(): void {
    downloadText(`${this.design.name.replace(/[^\w.-]+/g, '_') || 'design'}.sketch.json`, serialize(this.design), 'application/json');
    this.markSaved();
  }

  /** What to call when a save the app cannot see finish, e.g. a download of an editable SVG, has been made. */
  savePoint(): () => void {
    const at = { history: this.history, rev: this.history.rev, print: fingerprint(this.design) };
    return () => this.markSaved(at);
  }

  openFile(): void {
    this.guardUnsaved(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.sketch.json,.svg,image/svg+xml';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) this.loadText(await file.text(), file.name);
      };
      input.click();
    });
  }

  /**
   * A project file, or an SVG that Save as SVG made with its data: the design is replaced as for either. Nothing
   * is touched until the whole file has been read and checked, and a failure at any point leaves the design, its
   * Undo and Redo exactly as they were. Whether anything unsaved may go is the caller's to have asked. Returns what
   * was said about why it could not be opened, or null when it was. `what` names it in that: a rescued copy is a copy.
   */
  loadText(text: string, fileName = '', what: 'file' | 'copy' = 'file'): string | null {
    const fail = (why: string): string => {
      this.message(why, 'warn');
      return why;
    };
    try {
      const r = looksLikeSvg(text, fileName) ? loadSvg(text) : deserialize(text);
      if (!r.ok) return fail(what === 'copy' ? `That copy could not be opened: ${r.error}` : r.error);
      const curved = this.replaceDesign(r.design, { leave: true });
      if (r.warnings.length) this.message([...r.warnings, ...(curved ? [curved] : [])].join('; '), 'warn');
      return null;
    } catch (e) {
      console.error(e);
      return fail(`That ${what} could not be opened: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Recover Designs

  showRecover(error?: string): void {
    const store = this.autosave.rescued;
    openRecoverDialog(this.dialogs, {
      list: () => store.list(),
      open: (id) => this.openRescued(id),
      download: (id) => {
        const text = store.read(id);
        const meta = store.list().find((e) => e.id === id);
        if (text === null) return;
        const stamp = meta?.at ? new Date(meta.at).toISOString().replace(/[:.]/g, '-') : 'earlier';
        downloadText(`recovered-${stamp}.txt`, text, 'text/plain');
      },
      remove: (id) => store.remove(id),
    }, error);
  }

  /** A rescued copy, through the same question as File > Open. A copy that will not open is left where it is. */
  private openRescued(id: string): void {
    const text = this.autosave.rescued.read(id);
    if (text === null) {
      this.showRecover('That copy is no longer there.');
      return;
    }
    this.guardUnsaved(() => {
      const why = this.loadText(text, '', 'copy');
      if (why) this.showRecover(why);
    }, () => this.showRecover());
  }

  // -------------------------------------------------------------------------
  // Mode

  get activeSketch(): Sketch | null {
    return this.activeId ? this.design.sketches[this.activeId] ?? null : null;
  }

  /**
   * Create Sketch: an origin plane is picked in the Orbit view, from design mode or from a sketch, which stays
   * open until one is. Esc goes back.
   */
  startSketch(): void {
    this.pickPlane(PICK_PROMPT, (plane) => this.createSketch(plane));
  }

  /**
   * Create Sketch on `plane`: one undoable command, then Sketch mode, the camera swinging round to face it. It opens
   * at the view the last sketch was looked at in, as the plan of design mode used to give it.
   */
  createSketch(plane: Plane): void {
    const s = newSketch(this.design, plane);
    this.history.commit(this.design, { label: 'Create Sketch' });
    this.autosave.schedule(this.design);
    this.enterSketch(s.id, this.orbit?.back ?? this.planView);
    this.emit('doc');
  }

  /** Edit a sketch. From the Orbit view the camera swings round to face it first. `at`: the view to open it at. */
  enterSketch(id: Id, at?: PlanView): void {
    this.hurry();
    if (this.swing) return;
    this.endPick();
    if (this.orbit && this.scene) {
      this.faceSketch(id, at);
      return;
    }
    if (at) {
      Object.assign(this.view, planOf(at));
      this.view.version++;
    }
    this.openSketch(id);
  }

  private openSketch(id: Id): void {
    const s = this.design.sketches[id];
    if (!s) return;
    this.mode = 'sketch';
    this.activeId = id;
    this.frame = structuredClone(s.frame);
    this.planeChanged();
    this.selection.clear();
    this.clearNote();
    this.lineType = 'normal';
    this.snapper.reset();
    if (syncFrameEdges(this.design, s)) this.forget(id);
    // Linked projections follow their sources, which may have changed since this sketch was last open.
    if (syncProjections(this.design, s)) {
      this.forget(id);
      this.geomVersion++;
      this.autosave.schedule(this.design);
    }
    this.emit('mode');
    this.emit('status');
    this.setTool('select');
    this.invalidate();
  }

  /** Back to design mode, the camera swinging out to the Orbit view. */
  finishSketch(): void {
    if (this.mode !== 'sketch') return;
    this.leaveSketch(true);
  }

  /** To design mode: `swing` out to the Orbit view from the plan, else there at once. */
  private leaveSketch(swing = false): void {
    this.hurry();
    const from = this.scene ?? facing(this.frame, this.view);
    if (this.mode === 'sketch' && this.activeId) this.remember(this.activeId, this.orbit?.back ?? this.view);
    this.stopTool();
    this.mode = 'design';
    this.activeId = null;
    this.selection.clear();
    this.clearNote();
    this.lineType = 'normal';
    this.planeHover = null;
    this.showDesign(swing ? from : null);
    if (!this.pick) this.status(DESIGN_PROMPT);
    this.emit('mode');
    this.emit('tool');
    this.emit('status');
    this.invalidate();
  }

  /** A sketch's plan view as it is left, for coming back to it, and for the next new sketch to open at. */
  private remember(id: Id, at: PlanView): void {
    this.planView = planOf(at);
    this.views.set(id, this.planView);
  }

  deleteSketch(id: Id): void {
    this.hurry();
    this.views.delete(id);
    if (this.activeId === id) this.leaveSketch();
    const names = lastValues(this.design);
    deleteSketch(this.design, id);
    const lost = keepLostValues(this.design, names);
    this.analyses.delete(id);
    this.history.commit(this.design, { label: 'Delete Sketch' });
    this.afterDocSwap();
    if (lost.length) this.message(lostNote(lost), 'warn');
  }

  /**
   * Redefine Sketch Plane: an origin plane is picked in the Orbit view, as for Create Sketch, and the sketch moves
   * to it. From the sketch itself the camera then swings round to face it on its new plane.
   */
  redefineSketchPlane(id: Id): void {
    const s = this.design.sketches[id];
    if (!s) return;
    this.pickPlane(`Select a plane for ${s.name}, or press Esc`, (plane, opened) => {
      this.redefinePlane(id, plane);
      const back = this.orbit?.back;
      const moved = this.design.sketches[id];
      if (back && moved && id === this.activeId) {
        // Its own coordinates did not change, so it comes back to the view it was left in, on the new plane.
        back.frame = structuredClone(moved.frame);
        if (opened) {
          this.faceSketch(id);
          return;
        }
      } else if (back && opened) {
        this.leaveOrbit();
        return;
      }
      this.status(this.mode === 'design' ? DESIGN_PROMPT : ORBIT_PROMPT);
    });
  }

  /** Move a sketch to another plane [ref GUID-3E407E01]. */
  redefinePlane(id: Id, plane: Plane): void {
    const s = this.design.sketches[id];
    if (!s || sameFrame(s.frame, PLANE_FRAMES[plane])) return;
    s.frame = planeFrame(plane);
    if (this.activeId === id) this.frame = planeFrame(plane);
    this.planeChanged();
    this.history.commit(this.design, { label: 'Redefine Sketch Plane' });
    this.afterDocSwap();
  }

  renameSketch(id: Id, name: string): void {
    const s = this.design.sketches[id];
    if (!s || !name.trim() || s.name === name) return;
    s.name = name.trim();
    this.history.commit(this.design, { label: 'Rename Sketch' });
    this.afterDocSwap();
  }

  setSketchVisible(id: Id, visible: boolean): void {
    const s = this.design.sketches[id];
    if (!s) return;
    s.visible = visible;
    this.history.commit(this.design, { label: 'Toggle Visibility' });
    this.afterDocSwap();
  }

  runSketchAction(actionId: string, sketch: Id): void {
    const action = SKETCH_ACTIONS.find((a) => a.id === actionId);
    if (action) action.run(this.ctx, sketch);
    else this.message('This action is not available yet', 'warn');
  }

  // -------------------------------------------------------------------------
  // 3D: fold, swing and orbit (docs/SPEC.md section 5)

  /** Whether the camera is swinging now. Input waits until it lands. */
  get swinging(): boolean {
    return this.swing !== null;
  }

  get orbiting(): boolean {
    return this.orbit !== null;
  }

  /** The selected line to fold about, with its ends in sketch coordinates, or why the arrow does nothing. */
  private hinge(arrow: Arrow): { id: Id; a: Vec2; b: Vec2 } | string {
    const s = this.activeSketch;
    if (this.mode !== 'sketch' || !s) return 'Open a sketch and select a line to fold about';
    if (this.press || this.activeToolId !== 'select' || this.hud.editing) return 'Finish the current tool first';
    const ids = this.selection.ids();
    const id = ids.length === 1 ? ids[0] : null;
    const c = id ? s.curves[id] : undefined;
    let line: { id: Id; a: Vec2; b: Vec2 } | null = null;
    if (id === AXIS_X) line = { id, a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
    else if (id === AXIS_Y) line = { id, a: { x: 0, y: 0 }, b: { x: 0, y: 1 } };
    else if (id && c?.type === 'line') line = { id, a: getPointPos(s, c.a), b: getPointPos(s, c.b) };
    if (!line) return 'Select one straight line to fold about';
    const pair = foldArrows(line.a, line.b);
    if (!pair) return 'That line has no length';
    if (!pair.includes(arrow)) return pair[0] === 'up' ? 'The line runs across the screen: use Up or Down' : 'The line runs up the screen: use Left or Right';
    return line;
  }

  /**
   * Fold the sketch plane a quarter turn about the selected line, the way the arrow points, and carry on
   * sketching on the new plane: a sketch already on it facing that way, or a new one. The line comes in
   * linked. The camera swings over the line, so the line stays where it was on screen.
   */
  private foldPlane(arrow: Arrow): void {
    const line = this.hinge(arrow);
    const from = this.activeSketch;
    const turned = typeof line === 'string' || !from ? null : fold(from.frame, line.a, line.b, arrow);
    if (typeof line === 'string' || !from || !turned) return;
    const root = this.hingeSource(from, line.id);
    const reuse = this.sketchOnPlane(turned.frame, from.id, root?.sketchId);
    const target = reuse ?? newSketch(this.design, turned.frame);
    const brought = this.bringHinge(target, from, line, root);
    if (!reuse || brought.changed) {
      this.history.commit(this.design, { label: reuse ? 'Project' : 'Create Sketch' });
      this.autosave.schedule(this.design);
    }
    this.forget(target.id);
    this.swingInto(target, turned.axis, Math.PI / 2, turned.pivot, !!reuse);
    if (brought.id) this.selection.set([brought.id]);
    this.emit('doc');
  }

  /**
   * Swing the camera about the line through `pivot` along `axis` by `angle`, onto `target`'s plane, and edit
   * it. `level`: the sketch has axes of its own, and a short roll after stands its y axis up.
   */
  private swingInto(target: Sketch, axis: Vec3, angle: number, pivot: Vec3, level: boolean): void {
    const start = facing(this.frame, this.view);
    const swung = turn(start, axis, angle, pivot);
    const n = normalOf(target.frame);
    const roll = level ? rollAngle(swung.right, target.frame.u, n) : 0;
    const end: Camera = level ? { right: { ...target.frame.u }, up: { ...target.frame.v }, centre: swung.centre, ppm: swung.ppm } : swung;
    if (this.activeId) this.remember(this.activeId, this.view);
    this.openSketch(target.id);
    const centre = toPlane(target.frame, end.centre);
    this.view.cx = centre.x;
    this.view.cy = centre.y;
    this.view.version++;
    const rolls = Math.abs(roll) > 1e-9;
    const ms = SWING_MS + (rolls ? ROLL_MS : 0);
    const split = SWING_MS / ms;
    this.play((t) => {
      if (t >= 1) return end;
      if (t < split) return turn(start, axis, angle * easeInOut(t / split), pivot);
      return turn(swung, n, roll * easeInOut((t - split) / (1 - split)));
    }, ms, () => {
      this.scene = null;
    });
  }

  /**
   * Where the planes of the other visible sketches meet this one: one infinite line per plane, in this
   * sketch's coordinates, with the sketches on it. None in design mode, in 3D, or with Other Planes off.
   */
  planeLines(): { p: Vec2; d: Vec2; ids: Id[] }[] {
    const s = this.activeSketch;
    if (!s || this.mode !== 'sketch' || this.scene || !this.settings.showPlanes) return [];
    const others = this.design.order.map((id) => this.design.sketches[id]).filter((k) => k && k.id !== s.id && k.visible);
    return meetingLines(this.frame, others).map(({ p, d, ids }) => ({ p, d, ids }));
  }

  /** The plane line under a canvas position, within the curve pick distance. */
  private planeLineAt(screen: Vec2): { p: Vec2; d: Vec2; ids: Id[] } | null {
    const lines = this.planeLines();
    if (!lines.length) return null;
    const w = this.view.toWorld(screen);
    const tol = this.view.px(PLANE_LINE_PX);
    let best: { line: { p: Vec2; d: Vec2; ids: Id[] }; gap: number } | null = null;
    for (const line of lines) {
      const gap = Math.abs((w.x - line.p.x) * line.d.y - (w.y - line.p.y) * line.d.x);
      if (gap < tol && (!best || gap < best.gap)) best = { line, gap };
    }
    return best?.line ?? null;
  }

  /** A plane line was clicked: swing about it onto that sketch, or ask which when several share the plane. */
  private goToPlane(line: { p: Vec2; d: Vec2; ids: Id[] }, screen: Vec2): void {
    if (line.ids.length === 1) {
      this.swingToSketch(line.ids[0], line);
      return;
    }
    this.marking.open(screen, [], line.ids.map((id) => ({
      id: `plane-${id}`, label: this.design.sketches[id]?.name ?? id, icon: 'sketch-node', run: () => this.swingToSketch(id, line),
    })));
  }

  /** Turn about where the two planes meet by the angle between them, to face `id`, and edit it. */
  private swingToSketch(id: Id, line: { p: Vec2; d: Vec2 }): void {
    const s = this.design.sketches[id];
    if (!s || !this.activeSketch || this.swing) return;
    const n0 = normalOf(this.frame);
    const n1 = normalOf(s.frame);
    const across = cross3(n0, n1);
    const angle = Math.atan2(len3(across), dot3(n0, n1));
    // About the point of the line nearest the middle of the view, so the turn stays on screen.
    const t = (this.view.cx - line.p.x) * line.d.x + (this.view.cy - line.p.y) * line.d.y;
    const pivot = toWorld(this.frame, { x: line.p.x + line.d.x * t, y: line.p.y + line.d.y * t });
    this.planeHover = null;
    this.swingInto(s, norm3(across), angle, pivot, true);
    this.emit('doc');
  }

  /** What a hinge links to: the line itself, or the source a projected line follows. Null for an axis. */
  private hingeSource(from: Sketch, id: Id): { sketchId: Id; curveId: Id } | null {
    const c = from.curves[id];
    if (!c || (c.projected && 'origin' in c.projected)) return null;
    if (isLinked(c) && this.design.sketches[c.projected.sketchId]?.curves[c.projected.curveId]) return { ...c.projected };
    return { sketchId: from.id, curveId: id };
  }

  /** A shown sketch on `frame`'s plane, facing the same way: the hinge's own first. */
  private sketchOnPlane(frame: Frame, not: Id, prefer?: Id): Sketch | null {
    const on = this.design.order.map((id) => this.design.sketches[id]).filter((s) => s && s.id !== not && s.visible && samePlane(s.frame, frame));
    return on.find((s) => s.id === prefer) ?? on[0] ?? null;
  }

  /**
   * The hinge in `target`: a linked projection of it, as Project makes, unless it is that sketch's own line
   * already. An axis comes in as the target's projected axis when it is one, else as a fixed construction line.
   */
  private bringHinge(target: Sketch, from: Sketch, line: { a: Vec2; b: Vec2 }, root: { sketchId: Id; curveId: Id } | null): { id: Id | null; changed: boolean } {
    const before = Object.keys(target.curves).length;
    const changed = (): boolean => Object.keys(target.curves).length !== before;
    if (root?.sketchId === target.id) return { id: root.curveId, changed: false };
    const source = root ? this.design.sketches[root.sketchId] : undefined;
    if (root && source) {
      const view = seenFrom(target.frame, source);
      const copy = view.curves[root.curveId] ? linkedCopy(this.design, target, view, root.curveId) : null;
      if (copy) return { id: copy.id, changed: changed() };
    }
    const a = toPlane(target.frame, toWorld(from.frame, line.a));
    const b = toPlane(target.frame, toWorld(from.frame, line.b));
    const axis = Math.abs(a.y) < 1e-9 && Math.abs(b.y) < 1e-9 ? 'x' : Math.abs(a.x) < 1e-9 && Math.abs(b.x) < 1e-9 ? 'y' : null;
    if (axis) {
      const there = Object.values(target.curves).find((k) => k.projected && 'origin' in k.projected && k.projected.origin === axis);
      return { id: (there ?? projectAxis(this.design, target, axis)).id, changed: changed() };
    }
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const k = AXIS_REACH / d;
    const copy = addLine(this.design, target, { x: a.x - (b.x - a.x) * k, y: a.y - (b.y - a.y) * k }, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, { lineType: 'construction' });
    copy.fixed = true;
    return { id: copy.id, changed: true };
  }

  /**
   * Move the camera along `path` (0 to 1) over `ms`, drawing every visible sketch in 3D, then `land`. At
   * once when the system asks for reduced motion, or when a command hurries it.
   */
  private play(path: (t: number) => Camera, ms: number, land: () => void): void {
    this.planeChanged();
    this.reach = this.reachOf();
    this.hover = null;
    this.tip.style.display = 'none';
    const finish = (): void => {
      this.swing = null;
      this.scene = path(1);
      land();
      this.planeChanged();
      this.emit('mode');
      this.emit('status');
      this.invalidate();
    };
    if (ms <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    const swing = { land: finish };
    this.swing = swing;
    const start = performance.now();
    this.scene = path(0);
    this.invalidate();
    const tick = (now: number): void => {
      // Hurried: it has landed already.
      if (this.swing !== swing) return;
      const t = Math.min(1, (now - start) / ms);
      if (t >= 1) {
        finish();
        return;
      }
      this.scene = path(t);
      this.renderer.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** A key, button or menu command does not wait for the camera: the swing lands at once, and the command goes on. */
  private hurry(): void {
    this.swing?.land();
  }

  /** The Orbit view from a sketch: every visible sketch in 3D, turned by dragging. Again to go back. Design mode is it already. */
  toggleOrbit(): void {
    this.hurry();
    if (this.orbit?.back) this.leaveOrbit();
    else if (!this.orbit) this.enterOrbit();
  }

  /** Open the Orbit view from the sketch, swinging out to `to` over `ms`: Home round everything shown, unless told otherwise. */
  private enterOrbit(to?: Camera, ms = ORBIT_MS): void {
    if (this.mode === 'sketch') this.setTool('select');
    const back = { frame: structuredClone(this.frame), cx: this.view.cx, cy: this.view.cy, ppm: this.view.ppm };
    if (this.mode === 'sketch' && this.activeId) this.remember(this.activeId, back);
    this.orbit = { back };
    const from = facing(this.frame, this.view);
    const end = to ?? this.homeCamera();
    this.status(ORBIT_PROMPT);
    this.play((t) => (t >= 1 ? end : between(from, end, easeInOut(t))), ms, () => {
      this.view.ppm = end.ppm;
    });
  }

  /** Back to the sketch the Orbit view was opened from, facing it. */
  private leaveOrbit(): void {
    const orbit = this.orbit;
    const back = orbit?.back;
    if (!orbit || !back || this.swing) return;
    this.endPick();
    const from = this.scene ?? facing(back.frame, back);
    const to = facing(back.frame, back);
    this.play((t) => between(from, to, easeInOut(t)), ORBIT_MS, () => {
      this.orbit = null;
      this.scene = null;
      this.orbitHover = null;
      this.frame = back.frame;
      Object.assign(this.view, { cx: back.cx, cy: back.cy, ppm: back.ppm });
      this.view.version++;
      this.canvas.style.cursor = this.activeToolId === 'select' || !this.activeToolId ? 'default' : 'crosshair';
      this.status(this.mode === 'design' ? DESIGN_PROMPT : '');
    });
  }

  /**
   * From the Orbit view, edit a sketch: the camera swings round to look straight at it. At `at` when given, else
   * as it was left: the view the Orbit view was opened from, or the last one it was looked at in. From design mode
   * a sketch not looked at yet opens at the last sketch's view, as design mode's plan used to give it, if any of it
   * shows there; otherwise, and from a sketch, it is fitted to it.
   */
  private faceSketch(id: Id, at?: PlanView): void {
    const s = this.design.sketches[id];
    const from = this.scene;
    const orbit = this.orbit;
    if (!s || !from || !orbit || this.swing) return;
    const back = orbit.back;
    const fromDesign = this.mode === 'design';
    if (fromDesign) this.designTurn = { right: { ...from.right }, up: { ...from.up } };
    this.orbit = null;
    this.orbitHover = null;
    this.homed = null;
    this.endPick();
    this.canvas.style.cursor = 'default';
    const kept = back && id === this.activeId && this.mode === 'sketch' && sameFrame(back.frame, s.frame) ? back : this.views.get(id);
    // Open first, so the fit leaves room for the Sketch Palette that comes with Sketch mode.
    this.openSketch(id);
    const box = this.sketchBox(s);
    let target = at ?? kept ?? (fromDesign && this.shows(this.planView, box) ? this.planView : undefined);
    if (!target) {
      const look = new View();
      look.resize(this.view.width, this.view.height, this.view.dpr);
      look.ppm = from.ppm;
      if (Number.isFinite(box.minX)) look.fit(box, FIT_MARGIN, this.covered());
      target = planOf(look);
    }
    const to = facing(s.frame, target);
    Object.assign(this.view, planOf(target));
    this.view.version++;
    this.play((t) => between(from, to, easeInOut(t)), ORBIT_MS, () => {
      this.scene = null;
    });
  }

  /** Whether any of `box` is on the canvas at `at`. An empty box shows anywhere. */
  private shows(at: PlanView, box: Box): boolean {
    if (!Number.isFinite(box.minX)) return true;
    const w = this.view.width / 2 / at.ppm;
    const h = this.view.height / 2 / at.ppm;
    return box.maxX >= at.cx - w && box.minX <= at.cx + w && box.maxY >= at.cy - h && box.minY <= at.cy + h;
  }

  /**
   * Design mode is the Orbit view, round everything shown: swung out to it from `from`, looking the way it looked
   * when a sketch was opened from it, or there at once. From the Orbit view of a sketch it stays as it is.
   */
  private showDesign(from: Camera | null): void {
    // Nothing to go back to now.
    if (this.pick) this.pick.opened = false;
    if (this.orbit && this.scene) {
      this.orbit.back = null;
      return;
    }
    this.orbit = { back: null };
    if (!from) {
      this.homeNow(this.designTurn);
      return;
    }
    const turnTo = this.designTurn;
    const to = this.homeCamera(turnTo);
    this.play((t) => between(from, to, easeInOut(t)), ORBIT_MS, () => {
      this.view.ppm = to.ppm;
      this.homed = turnTo;
    });
  }

  /** Straight to the fit round everything shown, looking along `turnTo`. */
  private homeNow(turnTo: { right: Vec3; up: Vec3 }): void {
    const to = this.homeCamera(turnTo);
    this.scene = to;
    // Curves are flattened for the zoom they are seen at.
    this.view.ppm = to.ppm;
    this.homed = turnTo;
    this.planeChanged();
    this.invalidate();
  }

  /** The corners of every shown sketch's extent in 3D, and the origin. */
  private sceneCorners(): Vec3[] {
    const pts: Vec3[] = [{ x: 0, y: 0, z: 0 }];
    for (const id of this.design.order) {
      const s = this.design.sketches[id];
      if (!s?.visible) continue;
      const b = this.sketchBox(s);
      if (!Number.isFinite(b.minX)) continue;
      for (const p of [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }]) pts.push(toWorld(s.frame, p));
    }
    return pts;
  }

  /** How far the origin planes reach: about half way to the furthest geometry, and 20 mm with none. */
  private reachOf(): number {
    return Math.max(20, 0.6 * Math.max(...this.sceneCorners().map((p) => Math.hypot(p.x, p.y, p.z))));
  }

  /** Round everything shown and the origin planes, looking along `turnTo`: isometric Home unless told otherwise. */
  private homeCamera(turnTo: { right: Vec3; up: Vec3 } = HOME): Camera {
    this.reach = this.reachOf();
    const r = this.reach;
    const pts = [...this.sceneCorners(), { x: r, y: 0, z: 0 }, { x: 0, y: r, z: 0 }, { x: 0, y: 0, z: r }, { x: r, y: r, z: 0 }, { x: 0, y: r, z: r }, { x: r, y: 0, z: r }];
    const lo = { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)), z: Math.min(...pts.map((p) => p.z)) };
    const hi = { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)), z: Math.max(...pts.map((p) => p.z)) };
    const centre = scale3(add3(lo, hi), 0.5);
    let ex = 0;
    let ey = 0;
    for (const p of pts) {
      const d = sub3(p, centre);
      ex = Math.max(ex, Math.abs(dot3(d, turnTo.right)));
      ey = Math.max(ey, Math.abs(dot3(d, turnTo.up)));
    }
    const cover = this.covered();
    const room = { w: this.view.width - cover.left - cover.right - FIT_MARGIN * 4, h: this.view.height - FIT_MARGIN * 4 };
    const ppm = ex < 1e-6 && ey < 1e-6 ? 4 : Math.min(room.w / (2 * Math.max(ex, 1e-6)), room.h / (2 * Math.max(ey, 1e-6)));
    const fitted = Math.min(1e5, Math.max(1e-3, ppm));
    // The panels cover the left: the middle of what is left moves right by half of it.
    const shift = (cover.left - cover.right) / 2 / fitted;
    return { right: { ...turnTo.right }, up: { ...turnTo.up }, centre: sub3(centre, scale3(turnTo.right, shift)), ppm: fitted };
  }

  // Picking a plane: Create Sketch and Redefine Sketch Plane

  get picking(): boolean {
    return this.pick !== null;
  }

  /**
   * Pick an origin plane in the Orbit view, for `chosen`: from design mode, or from a sketch, which opens the Orbit
   * view. The squares light under the cursor; sketch geometry is not picked meanwhile. Esc goes back.
   */
  private pickPlane(prompt: string, chosen: (plane: Plane, opened: boolean) => void): void {
    this.hurry();
    if (this.swing) return;
    const opened = !this.orbit || this.pick?.opened === true;
    if (!this.orbit) this.enterOrbit();
    this.pick = { chosen, opened };
    this.orbitHover = null;
    this.status(prompt);
    this.emit('mode');
    this.invalidate();
  }

  /** The pick is over: nothing lights, and the tip goes. */
  private endPick(): void {
    if (!this.pick) return;
    this.pick = null;
    this.pickHover = null;
    this.tip.style.display = 'none';
    this.emit('mode');
    this.invalidate();
  }

  /** Esc: back to where the pick started. */
  private cancelPick(): void {
    const pick = this.pick;
    if (!pick) return;
    this.endPick();
    if (pick.opened) this.leaveOrbit();
    else this.status(this.mode === 'design' ? DESIGN_PROMPT : ORBIT_PROMPT);
  }

  /** A click while picking: the plane under it, if any, is the one. */
  private pickAt(screen: Vec2): void {
    const pick = this.pick;
    const plane = this.planeUnder(screen);
    if (!pick || !plane) return;
    this.endPick();
    pick.chosen(plane, pick.opened);
  }

  /** The origin plane square under a canvas position in the 3D view, nearest the camera. */
  private planeUnder(screen: Vec2): Plane | null {
    return this.scene ? planeAt(this.scene, screen, this.view.width, this.view.height, this.reach) : null;
  }

  /** While picking, the square under the cursor lights and the tip by the cursor names it. */
  private hoverPick(screen: Vec2): void {
    const plane = this.planeUnder(screen);
    this.canvas.style.cursor = plane ? 'pointer' : 'grab';
    if (plane !== this.pickHover) {
      this.pickHover = plane;
      this.invalidate();
    }
    if (!plane) {
      this.tip.style.display = 'none';
      return;
    }
    const name = `${PLANE_NAMES[plane]} plane`;
    if (this.tip.dataset.key !== `pick|${name}`) {
      this.tip.dataset.key = `pick|${name}`;
      this.tip.innerHTML = `<span class="tip-icon">${icon('create-sketch')}</span>`;
      this.tip.append(name);
    }
    this.tip.style.display = 'flex';
    this.tip.style.transform = `translate(${Math.round(screen.x + 14)}px, ${Math.round(screen.y + 34)}px)`;
  }

  /** A point of an origin plane, in its coordinates, on the page through the 3D view, for tests. */
  private planeToClient(plane: Plane, p: Vec2): Vec2 | null {
    if (!this.scene || !PLANE_FRAMES[plane]) return null;
    const q = project(this.scene, toWorld(PLANE_FRAMES[plane], p), this.view.width, this.view.height);
    const box = this.canvas.getBoundingClientRect();
    return { x: q.x + box.left, y: q.y + box.top };
  }

  /** How far the faint origin planes reach in the 3D view, in mm: about half way to the furthest geometry. */
  sceneSize(): number {
    return this.reach;
  }

  /** The visible sketch whose geometry is under a canvas position in the 3D view, through the 2D hit test. */
  private sketchUnder(screen: Vec2): Id | null {
    const cam = this.scene;
    if (!cam) return null;
    const plain = screenView(this.view);
    const flip = (q: Vec2): Vec2 => ({ x: q.x, y: -q.y });
    for (const id of [...this.design.order].reverse()) {
      const s = this.design.sketches[id];
      if (!s?.visible) continue;
      const through = new FrameView(cam, s.frame, this.view);
      const points = Object.fromEntries(Object.entries(s.points).map(([k, p]) => [k, { ...p, ...flip(through.toScreen(p)) }]));
      const env: HitEnv = {
        sketch: { ...s, points }, view: plain, badges: [], labels: [],
        polyline: (c) => this.polyline(s, c).map((q) => flip(through.toScreen(q))),
        textShape: () => null,
        visible: this.curveVisible,
        pointVisible: (p) => this.pointVisible(p, s),
        showPoints: true,
      };
      try {
        if (hitTest(env, screen, { kinds: ['point', 'curve'] })) return id;
      } catch (e) {
        // A curve seen edge-on can have no shape to measure to: it is not under the cursor.
        console.warn(e);
      }
    }
    return null;
  }

  /** A sketch point's position on the page through the 3D view, for tests. */
  private sceneToClient(id: Id, p: Vec2): Vec2 | null {
    const s = this.design.sketches[id];
    if (!s || !this.scene) return null;
    const q = new FrameView(this.scene, s.frame, this.view).toScreen(p);
    const box = this.canvas.getBoundingClientRect();
    return { x: q.x + box.left, y: q.y + box.top };
  }

  // The ViewCube (src/app/viewcube.ts)

  /** Which way the camera looks, for the ViewCube: the 3D view's way, else straight at the sketch's plane. */
  cubeTurn(): Turn {
    const cam = this.scene ?? facing(this.frame, this.view);
    return { right: { ...cam.right }, up: { ...cam.up } };
  }

  /**
   * Where the ViewCube goes, as the frame is drawn: the canvas's top right, or left of the Sketch Palette and of any
   * other panel that would cover it there, with its Home icon just outside its top left. Null, and nothing shown,
   * when that would run into the panels on the left or off the canvas.
   */
  placeCube(): CubeLayout | null {
    const box = this.canvas.getBoundingClientRect();
    const rects = (selector: string): DOMRect[] => [...this.stage.querySelectorAll<HTMLElement>(selector)]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const top = box.top + CUBE_MARGIN;
    let right = box.right - CUBE_MARGIN;
    const wide = CUBE_BOX + CUBE_ICON;
    const meets = (r: DOMRect): boolean => r.left < right && r.right > right - wide && r.top < top + CUBE_BOX && r.bottom > top;
    const beside = rects('.palette, .dialog, .rescue-note, .toolbox');
    // Step left past each panel in the way until none is.
    for (let moved = true; moved;) {
      moved = false;
      for (const r of beside) {
        if (!meets(r)) continue;
        right = r.left - CUBE_GAP;
        moved = true;
      }
    }
    const room = right - wide >= box.left + CUBE_MARGIN && !rects('.left-column > *').some(meets);
    this.cube = room && box.width > 0 ? { x: right - CUBE_BOX / 2 - box.left, y: top + CUBE_BOX / 2 - box.top, half: CUBE_HALF } : null;
    const home = this.cubeHome.style;
    home.display = this.cube ? '' : 'none';
    if (this.cube) {
      home.left = `${right - wide - box.left}px`;
      home.top = `${top - box.top}px`;
    }
    if (!this.cube && this.cubeHover) this.cubeHover = null;
    return this.cube;
  }

  /** The face, edge or corner of the ViewCube under a canvas position, through its own projection. */
  private cubeUnder(screen: Vec2): CubeTarget | null {
    return this.cube ? cubePick(this.cubeTurn(), this.cube, screen) : null;
  }

  /**
   * The part of the ViewCube under the cursor lights, and the cube takes the cursor from the canvas: nothing under
   * it lights meanwhile. True while the cursor is on the cube.
   */
  private hoverCube(screen: Vec2): boolean {
    const target = this.cubeUnder(screen);
    const name = target ? targetName(target) : null;
    if (name !== this.cubeHover) {
      if (name && !this.cubeHover) this.cubeCursor = this.canvas.style.cursor;
      if (!name) this.canvas.style.cursor = this.cubeCursor;
      this.cubeHover = name;
      this.invalidate();
    }
    if (!name) return false;
    this.canvas.style.cursor = 'pointer';
    this.tip.style.display = 'none';
    if (this.orbitHover || this.pickHover || this.hover || this.planeHover || this.inference) {
      this.orbitHover = null;
      this.pickHover = null;
      this.hover = null;
      this.planeHover = null;
      this.inference = null;
      this.invalidate();
    }
    return true;
  }

  /** A drag on the ViewCube orbits, as one on the view does. From a sketch it opens the Orbit view first, looking the same way. */
  private cubeDrag(e: PointerEvent): void {
    const press = this.cubePress;
    if (!press) return;
    const dx = e.clientX - press.last.x;
    const dy = e.clientY - press.last.y;
    press.travel += Math.hypot(dx, dy);
    press.last = { x: e.clientX, y: e.clientY };
    if (press.travel < CLICK_TRAVEL) return;
    if (!this.orbit) this.enterOrbit(facing(this.frame, this.view), 0);
    if (!this.scene || this.swing) return;
    this.scene = orbitBy(this.scene, dx, dy);
    this.homed = null;
    this.cubeHover = null;
    this.invalidate();
  }

  /**
   * A click on the ViewCube: the camera swings round to look from there, about the middle of the view. From a
   * sketch, the Orbit view opens looking that way, round everything shown, as `V` opens it, so `V` or Esc goes back.
   */
  private turnTo(d: CubeTarget): void {
    this.hurry();
    if (this.swing) return;
    const turnTo = targetTurn(d, this.cubeTurn());
    this.cubeHover = null;
    if (!this.orbit || !this.scene) {
      this.enterOrbit(this.homeCamera(turnTo));
      return;
    }
    const from = this.scene;
    const to: Camera = { ...from, right: turnTo.right, up: turnTo.up };
    this.homed = null;
    this.play((t) => (t >= 1 ? to : between(from, to, easeInOut(t))), ORBIT_MS, () => {
      // It lands where it was going; nothing else changes.
    });
  }

  /** The ViewCube's Home: Home View in the Orbit view; from a sketch, the Orbit view at Home, as `V` opens it. */
  private cubeGoHome(): void {
    this.hurry();
    if (this.orbit) this.fit();
    else if (this.mode === 'sketch') this.enterOrbit();
  }

  /** The ViewCube for tests: where it is on the page, what is lit, and each label shown, with which way is up for it on screen. */
  private cubeOnPage(): CubeView | null {
    const cube = this.cube;
    if (!cube) return null;
    const box = this.canvas.getBoundingClientRect();
    const t = this.cubeTurn();
    const n = cross3(t.right, t.up);
    return {
      x: cube.x + box.left, y: cube.y + box.top, half: cube.half, size: CUBE_BOX, hover: this.cubeHover,
      faces: visibleFaces(t).map((f) => ({
        label: f.label, facing: dot3(f.n, n),
        up: { x: dot3(f.up, t.right), y: -dot3(f.up, t.up) }, right: { x: dot3(f.right, t.right), y: -dot3(f.right, t.up) },
      })),
    };
  }

  /** A page position that picks the named face, edge or corner, if it shows; a face's at (s, t) of it when given. */
  private cubeToClient(name: string, at?: { s: number; t: number }): Vec2 | null {
    const d = targetNamed(name);
    const p = d && this.cube ? targetPoint(this.cubeTurn(), this.cube, d, at) : null;
    if (!p) return null;
    const box = this.canvas.getBoundingClientRect();
    return { x: p.x + box.left, y: p.y + box.top };
  }

  // -------------------------------------------------------------------------
  // Tools

  get activeToolId(): string | null {
    return this.toolDef?.meta.id ?? null;
  }

  get activeToolDef(): ToolDef | null {
    return this.toolDef;
  }

  /** For UI rows from the registry. Only meaningful in sketch mode. */
  get toolContext(): ToolContext {
    return this.ctx;
  }

  private stopTool(): void {
    const t = this.tool;
    this.tool = null;
    this.toolDef = null;
    t?.stop?.();
    this.hud.clear();
    this.hud.check(null);
    this.hud.closeEditor();
    // The prompt beside the cursor goes with the tool, not with the next mouse move.
    this.tip.style.display = 'none';
    this.inference = null;
    this.hover = null;
    this.toolOptions = [];
    if (this.measured) this.setMeasured(null);
  }

  disabledReason(id: string): string | null {
    const entry = allEntries().find((e) => e.id === id);
    const def = this.tools.get(id);
    if (entry?.unavailable) return entry.unavailable;
    if (!def) return 'Not available yet';
    if (def.meta.id !== 'select' && !def.meta.readOnly && this.mode === 'sketch' && this.lockedActive) return this.lockedNote();
    const d = def.meta.disabled;
    if (typeof d === 'string') return d;
    if (d) return d(this.ctx);
    return this.mode === 'sketch' ? null : 'Open a sketch first';
  }

  /** Start a tool from the UI, keyboard or marking menu. */
  activate(id: string, arg?: unknown): void {
    this.hurry();
    if (this.orbit?.back) {
      this.message('Close the Orbit view first: press Esc or V', 'warn');
      return;
    }
    const reason = this.disabledReason(id);
    if (reason) {
      const label = allEntries().find((e) => e.id === id)?.label ?? id;
      this.message(`${label}: ${reason}`, 'warn');
      return;
    }
    this.setTool(id, arg);
  }

  private setTool(id: string, arg?: unknown): void {
    const def = this.tools.get(id);
    if (!def) return;
    this.stopTool();
    this.toolDef = def;
    const tool = def.create(this.ctx, arg);
    this.tool = tool;
    if (id !== 'select' && def.meta.repeatable !== false) this.lastTool = id;
    this.canvas.style.cursor = id === 'select' ? 'default' : 'crosshair';
    this.emit('tool');
    tool.start?.();
    this.invalidate();
  }

  private endTool(): void {
    if (this.mode === 'sketch') this.setTool('select');
  }

  private makeContext(): ToolContext {
    const app = this;
    return {
      get design() { return app.design; },
      get sketch() { return app.activeSketch as Sketch; },
      get view() { return app.view; },
      get lineType() { return app.lineType; },
      get pointer() { return app.pointer; },
      get hud() { return app.hud; },
      get selection() { return app.selection; },
      get dialogs() { return app.dialogs; },
      get analysis() { return app.analysisOf(app.activeId as Id); },
      palette: {
        options: (rows) => {
          this.toolOptions = rows;
          this.emit('tool');
        },
      },
      solver: {
        drag: (targets, hold) => {
          const sketch = this.activeSketch as Sketch;
          const r = solveSketch(sketch, { drag: targets, hold, freeze: this.freezeFor(sketch) });
          this.timeSolve(sketch.id, r.ms);
          if (r.refusal) this.message(`That move was stopped: ${r.refusal}`, 'warn');
          this.geometryMoved();
          return r;
        },
        wouldOverConstrain: (dim) => {
          const sketch = this.activeSketch as Sketch;
          return wouldOverConstrain(sketch, dim, this.freezeFor(sketch));
        },
      },
      hit: (screen, opts) => this.hitAt(screen, opts),
      others: () => this.otherSketches(),
      measure: (ids) => this.setMeasured(ids),
      savePoint: () => this.savePoint(),
      editable: this.editable,
      layerUnder: (screen) => this.layerUnder(screen),
      foreign: (hit) => {
        const l = refLayer(this.activeSketch as Sketch, hit.id);
        return l !== null && l !== this.design.activeLayer;
      },
      onActive: (hit) => refLayer(this.activeSketch as Sketch, hit.id) === this.design.activeLayer,
      hitOf: (id) => hitOf(this.activeSketch as Sketch, id),
      setHover: (hit) => {
        if (hit?.id === this.hover?.id) return;
        this.hover = hit;
        this.invalidate();
      },
      setHighlight: (ids) => {
        this.highlight = ids;
        this.invalidate();
      },
      status: (t) => this.status(t),
      message: (t, k) => this.message(t, k),
      clearNote: () => this.clearNote(),
      commit: (label, fn, opts) => this.commit(label, fn, opts),
      groupUndo: () => {
        const mark = this.history.mark();
        return { end: () => this.history.squash(mark), drop: () => this.restore(this.history.rewind()) };
      },
      revert: () => this.revert(),
      end: () => this.endTool(),
      finishSketch: () => this.finishSketch(),
      invalidate: this.invalidate,
      activate: (id, arg) => this.activate(id, arg),
      profiles: () => this.profilesOf(this.activeSketch as Sketch),
      boxSelect: (a, b, crossing) => boxSelect(this.hitEnv(), a, b, crossing),
      editDimension: (id) => this.editDimension(id),
      runDoubleClick: (hit) => {
        const h = DOUBLE_CLICK.find((d) => d.applies(this.ctx, hit));
        if (!h) return false;
        h.run(this.ctx, hit);
        return true;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Commit, solve, undo

  private markBad(sketch: Sketch, a: SketchAnalysis): void {
    a.badCurves.clear();
    a.crossCurves.clear();
    for (const id of a.unsatisfied) {
      const k = sketch.constraints[id] ?? sketch.dimensions[id];
      for (const ref of k?.refs ?? []) {
        const curve = sketch.curves[ref] ? ref : sketch.points[ref]?.owner;
        if (!curve) continue;
        a.badCurves.add(curve);
        if (k.dependentLayer) a.crossCurves.add(curve);
      }
    }
  }

  /**
   * Solve for geometry with every layer that must not move frozen, then measure freedom with none
   * of them frozen: dof, colours and the Status line are never what a lock makes them look like.
   * `also` are layers this solve may move besides the active one.
   */
  private analyse(sketch: Sketch, opts: SolveOptions = {}, also?: Id[], looking = false): SketchAnalysis {
    const freeze = this.freezeFor(sketch, also);
    const r = solveSketch(sketch, { ...opts, analyze: !freeze, freeze });
    this.timeSolve(sketch.id, r.ms);
    const free = freeze ? analyzeSketch(sketch) : r;
    const broken = freeze ? brokenOf(sketch, freeze.broken) : [];
    const a: SketchAnalysis = {
      ok: r.ok && broken.length === 0, dof: free.dof, freeCurves: free.freeCurves, freePoints: free.freePoints,
      unsatisfied: new Set([...r.unsatisfied, ...broken]), badCurves: new Set(), crossCurves: new Set(), brokenLinks: new Set(broken),
    };
    if (r.error) console.warn('solver:', r.error);
    if (r.refusal && !looking) this.refusal ??= r.refusal;
    this.markBad(sketch, a);
    this.analyses.set(sketch.id, a);
    this.profiles.delete(sketch.id);
    // Last, with the answer in place: a note repaints the status, and the status asks for this analysis.
    // Looking at a sketch is not a commit, and has nothing to tell.
    if (r.notes && !looking) this.message(r.notes[0], 'warn');
    return a;
  }

  /** A solve of `id` took `ms`. Inside a request it adds to the request's total, else it is the whole of the latest. */
  private timeSolve(id: Id, ms: number): void {
    if (this.request) this.request.set(id, (this.request.get(id) ?? 0) + ms);
    else this.takeTime(id, ms);
  }

  private takeTime(id: Id, ms: number): void {
    this.solveMs.set(id, ms);
    this.solveRuns++;
  }

  /** Runs `fn` as one request: the readout takes the sum of its solves, refused or not, when it is over. */
  private timed<T>(fn: () => T): T {
    if (this.request) return fn();
    this.request = new Map();
    try {
      return fn();
    } finally {
      for (const [id, ms] of this.request) this.takeTime(id, ms);
      this.request = null;
      this.invalidate();
    }
  }

  /** Time of the last solve of the sketch being edited, in ms; null in design mode and before anything has solved it. */
  solveTime(): number | null {
    return this.mode === 'sketch' && this.activeId ? this.solveMs.get(this.activeId) ?? null : null;
  }

  analysisOf(id: Id | null): SketchAnalysis {
    if (!id) return emptyAnalysis();
    const cached = this.analyses.get(id);
    if (cached) return cached;
    const s = this.design.sketches[id];
    if (!s) return emptyAnalysis();
    return this.restored.has(id) ? this.inspect(s) : this.analyse(s, {}, undefined, true);
  }

  /** Something in the sketch changed: the next look at it solves it. */
  private forget(id: Id): void {
    this.analyses.delete(id);
    this.restored.delete(id);
  }

  /** The analysis of a sketch that is to stay exactly as it is. Writes nothing. */
  private inspect(sketch: Sketch): SketchAnalysis {
    const free = analyzeSketch(sketch);
    const freeze = this.freezeFor(sketch);
    const broken = freeze ? brokenOf(sketch, freeze.broken) : [];
    const unsatisfied = new Set(unmetOf(sketch, { freeze }));
    const a: SketchAnalysis = {
      ok: unsatisfied.size === 0 && broken.length === 0, dof: free.dof, freeCurves: free.freeCurves, freePoints: free.freePoints,
      unsatisfied: new Set([...unsatisfied, ...broken]), badCurves: new Set(), crossCurves: new Set(), brokenLinks: new Set(broken),
    };
    this.markBad(sketch, a);
    this.analyses.set(sketch.id, a);
    this.profiles.delete(sketch.id);
    return a;
  }

  private sketchesOfDimensions(ids: Id[]): Id[] {
    return this.design.order.filter((s) => ids.some((d) => this.design.sketches[s].dimensions[d]));
  }

  /**
   * The full update: dimensions resolve, geometry solves, driven dimensions re-measure, and anything
   * that referenced a driven value resolves again. A later sketch can depend on an earlier one, so
   * this also solves every sketch whose dimension values moved.
   */
  private recompute(active: Id | null, hold: Id[] = []): void {
    // Other sketches can solve here too, when a value they use changed: what they look like from this one goes.
    this.seen.clear();
    const live = active ? this.design.sketches[active] : null;
    if (live) syncProjections(this.design, live);
    // A value that changed moves what it dimensions, on whichever layer that is.
    const layersOf = (s: Sketch, ids: Id[]): Id[] => ids.flatMap((d) => {
      const l = s.dimensions[d] ? ownerLayer(s, s.dimensions[d]) : null;
      return l ? [l] : [];
    });
    const first = resolveAll(this.design);
    const touched = new Set<Id>(this.sketchesOfDimensions(first.changed));
    if (active) touched.add(active);
    for (const id of touched) {
      const s = this.design.sketches[id];
      this.analyse(s, id === active && hold.length ? { hold } : {}, layersOf(s, first.changed));
    }
    for (let pass = 0; pass < 3; pass++) {
      for (const id of touched) refreshDriven(this.design.sketches[id]);
      const next = resolveAll(this.design);
      this.badNames = danglingNames(this.design);
      if (pass === 0 && next.errors.length) this.message(this.badNames.get(next.errors[0].name) ?? next.errors[0].error.message, 'warn');
      if (next.changed.length === 0) break;
      const again = this.sketchesOfDimensions(next.changed);
      again.forEach((id) => touched.add(id));
      for (const id of again) this.analyse(this.design.sketches[id], {}, layersOf(this.design.sketches[id], next.changed));
    }
    this.geometryMoved();
  }

  private geometryMoved(): void {
    this.geomVersion++;
    this.dropCurveCaches();
    this.profiles.clear();
    if (this.activeSketch) this.labelAnchors = followLabels(this.activeSketch, this.labelAnchors);
    this.invalidate();
  }

  commit(label: string, fn: (c: CommitScope) => void | boolean, opts: CommitOptions = {}): boolean {
    return this.timed(() => this.applyCommit(label, fn, opts));
  }

  private applyCommit(label: string, fn: (c: CommitScope) => void | boolean, opts: CommitOptions): boolean {
    const sketch = this.activeSketch;
    if (!sketch) return false;
    if (this.lockedActive) {
      this.revert();
      this.message(this.lockedNote(), 'warn');
      return false;
    }
    const links = [...Object.values(sketch.constraints), ...Object.values(sketch.dimensions)].filter((k) => k.dependentLayer).map((k) => k.id);
    const linked = Object.values(sketch.features).filter((f) => f.type !== 'mirror').map((f) => f.id);
    const known = new Set(Object.keys(sketch.points));
    const names = lastValues(this.design);
    // What was said about the last change says nothing about this one.
    this.clearNote();
    const holds: Id[] = [];
    const deferred: (() => void)[] = [];
    let selectAfter: Id[] | null = null;
    const app = this;
    const scope: CommitScope = {
      get design() { return app.design; },
      get sketch() { return sketch; },
      get curveOpts() { return { lineType: app.lineType }; },
      infer: (point, placed, o) => applyInference(this.design, sketch, point, localize(this.design, sketch, placed.inference), o),
      inferRim: (curve, placed) => applyRimInference(this.design, sketch, curve, localize(this.design, sketch, placed.inference)),
      hudDimension: (key, kind, refs, init = {}) => {
        const lock = this.hud.locked(key);
        if (lock) deferred.push(() => this.addMeasured(sketch, kind, refs, { ...init, expression: lock.expression }));
      },
      dimension: (kind, refs, init = {}) => {
        deferred.push(() => this.addMeasured(sketch, kind, refs, init));
      },
      hold: (...points) => holds.push(...points),
      select: (...ids) => { selectAfter = ids; },
    };
    let verdict: void | boolean;
    try {
      verdict = fn(scope);
    } catch (e) {
      console.error(e);
      this.revert();
      this.message(`${label} failed: ${e instanceof Error ? e.message : String(e)}`, 'warn');
      return false;
    }
    if (verdict === false) {
      this.revert();
      return false;
    }
    this.refusal = null;
    this.restored.delete(sketch.id);
    syncFrameEdges(this.design, sketch);
    stampCrossLayer(sketch, this.design.activeLayer);
    if (deferred.length) {
      this.analyse(sketch, holds.length ? { hold: holds } : {});
      for (const d of deferred) d();
      stampCrossLayer(sketch, this.design.activeLayer);
    }
    const gone = keepLostValues(this.design, names);
    this.recompute(sketch.id, holds);
    if (this.refusal) {
      const why = this.refusal;
      this.refusal = null;
      this.revert();
      this.message(`${label} was not applied: ${why}.`, 'warn');
      return false;
    }
    const after = this.analysisOf(sketch.id);
    const lost = links.filter((id) => !sketch.constraints[id] && !sketch.dimensions[id] && !this.deleting.has(id)).length;
    const heldBy = [...after.unsatisfied].flatMap((id) => {
      const d = sketch.dimensions[id];
      const layer = d ? layerById(this.design, ownerLayer(sketch, d) ?? '') : null;
      return d && layer?.locked ? [`Layer "${layer.name}" is locked and holds the geometry, so ${d.name} cannot take effect until it is unlocked`] : [];
    });
    if (gone.length && !after.brokenLinks.size && !after.unsatisfied.size) this.message(lostNote(gone), 'warn');
    else if (heldBy.length) this.message(heldBy[0], 'warn');
    else if (after.brokenLinks.size) {
      const id = (sketch.constraints[[...after.brokenLinks][0]] ?? sketch.dimensions[[...after.brokenLinks][0]])?.dependentLayer;
      this.message(`Layer "${(id ? layerById(this.design, id)?.name : null) ?? '?'}" is locked, so it stayed put and the link to it is shown in red`, 'warn');
    } else if (after.unsatisfied.size) this.message('Over-constrained: conflicts are shown in red. Undo or delete one.', 'warn');
    else if (lost) this.message(`Removed ${lost === 1 ? 'a cross-layer constraint' : `${lost} cross-layer constraints`}: what it referenced is gone. The other side stays where it is.`, 'warn');
    else if (linked.some((id) => !sketch.features[id] && !this.deleting.has(id))) this.message(`${label} changed what an offset or pattern was made from, so that link is gone: what it made stays where it is and no longer follows`, 'warn');
    this.history.commit(this.design, { label, coalesce: opts.coalesce });
    this.autosave.schedule(this.design);
    this.keepInView(sketch, known);
    if (selectAfter) this.selection.set(selectAfter);
    this.selection.retain((id) => this.exists(id));
    this.emit('doc');
    this.emit('status');
    return true;
  }

  /** Something just made that lands off the canvas, a 500 mm line typed in at the default zoom: bring it in. */
  private keepInView(sketch: Sketch, known: Set<Id>): void {
    const box = this.canvas.getBoundingClientRect();
    // An arc's centre is where the maths puts it. What was drawn is the arc, and that is on the canvas.
    const centres = new Set(Object.values(sketch.curves).flatMap((c) => (c.type === 'arc' ? [c.c] : [])));
    const off = Object.values(sketch.points).some((p) => {
      if (known.has(p.id) || p.projected || centres.has(p.id)) return false;
      const s = this.view.toScreen(p);
      return s.x < 0 || s.y < 0 || s.x > box.width || s.y > box.height;
    });
    if (off) this.fit();
  }

  /** A driving dimension at the measured value or a typed expression; Driven when it would over-constrain. */
  private addMeasured(sketch: Sketch, kind: Parameters<typeof addDimension>[2], refs: Id[], init: Parameters<typeof addDimension>[5] = {}): void {
    const probe = {
      id: '__new', kind, refs, name: '', expression: '', value: 0, driving: true, label: init?.label ?? { x: 0, y: 0 },
      variant: init?.variant,
    };
    const measured = measureDimension(sketch, probe);
    if (measured === null) return;
    const typed = init?.expression ? evaluateInDesign(this.design, init.expression, kind === 'angle' ? 'angle' : 'length') : null;
    const value = typed?.ok ? typed.value : measured;
    const over = wouldOverConstrain(sketch, { ...probe, value }, this.freezeFor(sketch));
    if (over) {
      addDimension(this.design, sketch, kind, refs, measured, { ...init, driving: false, expression: literalExpression(kind, measured) });
      this.message('That value would over-constrain the sketch, so the dimension is Driven');
    } else addDimension(this.design, sketch, kind, refs, value, init);
  }

  revert(): void {
    this.design = this.history.current();
    this.restored = new Set(this.design.order);
    this.layersChanged();
    this.labelAnchors.clear();
    this.dropCurveCaches();
    this.profiles.clear();
    this.analyses.clear();
    this.geomVersion++;
    this.invalidate();
  }

  undo(): void {
    this.restore(this.history.undo());
  }

  redo(): void {
    this.restore(this.history.redo());
  }

  private restore(design: Design | null): void {
    if (!design) return;
    this.hud.closeEditor();
    this.clearNote();
    this.design = design;
    this.restored = new Set(design.order);
    this.analyses.clear();
    this.afterDocSwap();
  }

  editDimension(id: Id): void {
    const sketch = this.activeSketch;
    const d = sketch?.dimensions[id];
    if (!sketch || !d) return;
    if (!d.driving) {
      this.message('A driven dimension is read only');
      return;
    }
    const prompt = this.statusText;
    this.status('Type a value or expression, then press Enter');
    this.hud.edit({
      at: d.label,
      kind: d.kind === 'angle' ? 'angle' : 'length',
      initial: d.expression,
      name: d.name,
      accept: (expression, value) => {
        const cycle = wouldCycle(this.design, d.name, expression);
        if (cycle) {
          this.message(`Circular reference: ${cycle.join(' > ')}`, 'warn');
          return false;
        }
        if (!(value > 0)) {
          this.message('A dimension must be greater than zero', 'warn');
          return false;
        }
        const driven = d.feature || d.kind === 'tangentLine' || d.kind === 'tangentRounds' ? drivenReference(this.design, expression) : null;
        if (driven) {
          this.message(`This dimension cannot reference the Driven dimension ${driven}`, 'warn');
          return false;
        }
        this.commit('Edit Dimension', ({ sketch: s }) => {
          s.dimensions[id].expression = expression;
        });
        this.status(prompt);
        return true;
      },
      cancel: () => this.status(prompt),
    });
  }

  // -------------------------------------------------------------------------
  // Geometry caches

  curveVisible = (c: Curve): boolean => {
    if (this.hiddenLayers.has(c.layer)) return false;
    if (c.lineType !== 'normal' && this.settings.constructionActiveOnly && c.layer !== this.design.activeLayer) return false;
    if (c.projected && !this.settings.showProjected) return false;
    // Hide fully constrained geometry while finding what is not [ref SKT-FIND-UNDERCONSTRAINED].
    if (this.hideConstrained && this.activeId && this.activeSketch?.curves[c.id] && !this.analysisOf(this.activeId).freeCurves.has(c.id)) return false;
    return c.lineType === 'normal' || this.settings.showConstruction;
  };

  polyline(sketch: Sketch, c: Curve): Vec2[] {
    if (this.polylinePpm !== this.view.ppm) {
      this.polylines.clear();
      this.polylinePpm = this.view.ppm;
    }
    let pts = this.polylines.get(c.id);
    if (!pts) {
      pts = sampleForRender(sketch, c, this.view.ppm);
      this.polylines.set(c.id, pts);
    }
    return pts;
  }

  private dropCurveCaches(): void {
    this.polylines.clear();
    this.textShapes.clear();
  }

  /** Glyph outlines of a text, shared by drawing and hit testing. Nothing is kept until the font loads. */
  textShape(sketch: Sketch, c: TextEntity): TextShape | null {
    let shape = this.textShapes.get(c.id);
    if (!shape) {
      const outlines = textOutlines(c, sketch, { design: this.design });
      if (!outlines.length) return null;
      shape = textShape(outlines);
      this.textShapes.set(c.id, shape);
    }
    return shape;
  }

  /** Cached per solve: this is the slow query. */
  profilesOf(sketch: Sketch): Profile[] {
    let p = this.profiles.get(sketch.id);
    if (!p) {
      // Regions belong to the layer being worked on. Template geometry is plain lines.
      const here = this.design.activeLayer;
      const scoped = this.design.layers.length < 2 ? sketch
        : { ...sketch, curves: Object.fromEntries(Object.entries(sketch.curves).filter(([, c]) => c.layer === here)) };
      p = findProfiles(scoped);
      this.profiles.set(sketch.id, p);
    }
    return p;
  }

  /** `templates`: other layers can be picked too, as references. */
  hitEnv(other?: Sketch, templates = false): HitEnv {
    const sketch = other ?? (this.activeSketch as Sketch);
    const { badges, labels } = other ? { badges: [], labels: [] } : this.renderer.layouts(sketch);
    const env: HitEnv = {
      sketch, view: this.view, badges, labels,
      polyline: (c) => this.polyline(sketch, c),
      textShape: (c) => this.textShape(sketch, c),
      visible: this.curveVisible,
      pointVisible: (p) => this.pointVisible(p, sketch),
      showPoints: this.settings.showPoints,
    };
    if (!other && !templates) env.pickable = this.editable;
    return env;
  }

  /**
   * Sketches the active one can see, as it sees them, in its coordinates: shown, and on its plane, or with
   * lines lying in it (src/model/seen.ts). In design mode, what the plane looked at shows of each.
   */
  otherSketches(): Sketch[] {
    const out: Sketch[] = [];
    for (const id of this.design.order) {
      const s = this.design.sketches[id];
      if (!s || s.id === this.activeId || !s.visible) continue;
      const view = this.seenOf(s);
      if (!isEmpty(view)) out.push(view);
    }
    return out;
  }

  private seenOf(s: Sketch): Sketch {
    const kept = this.seen.get(s.id);
    if (kept?.from === s) return kept.view;
    const view = seenFrom(this.frame, s);
    this.seen.set(s.id, { from: s, view });
    return view;
  }

  /** The plane looked at changed, or sketches may have moved: what was kept in the old coordinates goes. */
  private planeChanged(): void {
    this.seen.clear();
    this.dropCurveCaches();
    this.profiles.clear();
  }

  /** Picks by constraint and dimension tools reach other sketches too [ref auto-project]. */
  private get picksElsewhere(): boolean {
    const meta = this.toolDef?.meta;
    return !!meta && (meta.id === 'dimension' || (meta.panel === 'constraints' && meta.id !== 'fix' && meta.id !== 'autoconstrain'));
  }

  private foreignHit(screen: Vec2): { sketch: Sketch; hit: Hit } | null {
    for (const sketch of this.otherSketches()) {
      const hit = hitTest(this.hitEnv(sketch), screen, {
        kinds: ['point', 'curve'], accept: (h) => h.kind === 'point' || sketch.curves[h.id]?.type !== 'text',
      });
      if (hit) return { sketch, hit };
    }
    return null;
  }

  /** The cursor is on another sketch's geometry and nothing here: project it, for the click to land on. */
  private projectUnder(screen: Vec2): void {
    if (!this.picksElsewhere || !this.activeSketch || this.hitAt(screen)) return;
    const found = this.foreignHit(screen);
    if (!found) return;
    const { sketch: from, hit } = found;
    this.commit('Project', ({ design, sketch }) => {
      if (hit.kind === 'point') projectPoint(design, sketch, from, hit.id);
      else linkedCopy(design, sketch, from, hit.id);
    });
  }

  /** The name of the other layer whose geometry is under the cursor, for a tool that cannot take it to say so. */
  private layerUnder(screen: Vec2): string | null {
    const s = this.activeSketch;
    if (!s) return null;
    const hit = hitTest(this.hitEnv(undefined, true), screen, { kinds: ['point', 'curve'] });
    if (!hit) return null;
    const id = refLayer(s, hit.id);
    return id && id !== this.design.activeLayer ? layerById(this.design, id)?.name ?? null : null;
  }

  private hitAt(screen: Vec2, opts?: HitOptions): Hit | null {
    if (opts?.sketch) return hitTest(this.hitEnv(opts.sketch), screen, opts);
    if (!this.activeSketch) return null;
    const templates = opts?.anyLayer || (this.picksElsewhere && !opts?.editableOnly && !this.lockedActive);
    return hitTest(this.hitEnv(undefined, templates), screen, opts);
  }

  // -------------------------------------------------------------------------
  // HUD and dialog hosts

  pointerScreen(): Vec2 | null {
    return this.pointer?.screen ?? null;
  }

  pointerHeld(): boolean {
    return !!this.press;
  }

  hudChanged(): void {
    if (this.pointer) this.tool?.move?.({ ...this.pointer, button: -1, dragging: false });
    this.invalidate();
  }

  dialogChanged(): void {
    if (this.dialogs.current) this.tip.style.display = 'none';
    this.invalidate();
  }

  status(text: string): void {
    this.statusText = text;
    this.emit('status');
    if (this.pointer && this.tip.style.display !== 'none') this.placeTip(this.pointer.screen);
  }

  message(text: string, kind: 'info' | 'warn' = 'info'): void {
    this.noteText = text;
    this.noteKind = kind;
    this.emit('status');
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => {
      this.noteText = '';
      this.emit('status');
    }, 5000);
  }

  /** A note is about what just happened: the next thing the user does makes it stale. */
  private clearNote(): void {
    if (!this.noteText) return;
    this.noteText = '';
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.emit('status');
  }

  setSetting(key: keyof Settings, value: boolean): void {
    this.settings[key] = value;
    this.dropCurveCaches();
    this.hover = null;
    this.emit('settings');
    this.invalidate();
  }

  setLineType(lineType: LineType): void {
    const ids = this.selectedCurves();
    if (ids.length) {
      this.commit('Change Linetype', ({ sketch }) => {
        for (const id of ids) {
          const c = sketch.curves[id];
          if (c && !c.projected && !(c.type === 'line' && c.frameOf)) c.lineType = c.lineType === lineType ? 'normal' : lineType;
        }
      });
      this.emit('settings');
      return;
    }
    this.lineType = this.lineType === lineType ? 'normal' : lineType;
    this.emit('settings');
  }

  selectedCurves(): Id[] {
    const s = this.activeSketch;
    return s ? this.selection.ids().filter((id) => s.curves[id]) : [];
  }

  /** A frame edge stands for its text in whole-entity commands. */
  private withoutFrameEdges(ids: Id[]): Id[] {
    const s = this.activeSketch as Sketch;
    return [...new Set(ids.map((id) => {
      const c = s.curves[id];
      return c?.type === 'line' && c.frameOf ? c.frameOf : id;
    }))];
  }

  // -------------------------------------------------------------------------
  // Commands

  private command(id: string, label: string, run: () => void, disabled?: () => string | null): void {
    this.commands.set(id, { id, label, run, disabled });
  }

  run(id: string): void {
    this.hurry();
    if (id.startsWith('tool:')) {
      this.activate(id.slice(5));
      return;
    }
    const c = this.commands.get(id);
    if (!c) return;
    const reason = c.disabled?.();
    if (reason) this.message(`${c.label}: ${reason}`, 'warn');
    else c.run();
  }

  private registerCommands(): void {
    const needSketch = (): string | null => (this.mode === 'sketch' ? null : 'Open a sketch first');
    this.command('undo', 'Undo', () => this.undo());
    this.command('redo', 'Redo', () => this.redo());
    this.command('select-all', 'Select All', () => this.selectAll(), needSketch);
    this.command('copy', 'Copy', () => this.copy(), needSketch);
    this.command('cut', 'Cut', () => this.cut(), needSketch);
    this.command('paste', 'Paste', () => this.paste(), needSketch);
    this.command('delete', 'Delete', () => this.deleteSelection(), needSketch);
    this.command('toggle-construction', 'Normal/Construction', () => this.toggleConstruction(), needSketch);
    this.command('fit', 'Look At', () => this.fit());
    this.command('toolbox', 'Toolbox', () => this.toolbox.open());
    this.command('finish-sketch', 'Finish Sketch', () => this.finishSketch(), needSketch);
    // From the SOLID tab mid-sketch too: the sketch stays open until a plane is picked, and Esc goes back to it.
    this.command('create-sketch', 'Create Sketch', () => this.startSketch());
    this.command('compute', 'Compute Sketch', () => this.computeSketch(), needSketch);
    this.command('repeat', 'Repeat', () => { if (this.lastTool) this.activate(this.lastTool); });
    this.command('new', 'New', () => this.newFile());
    this.command('open', 'Open', () => this.openFile());
    this.command('save', 'Save', () => this.saveFile());
    this.command('recover', 'Recover Designs', () => this.showRecover());
    const needGeometry = (): string | null => (this.fileSketches().length ? null : 'Create a sketch first');
    this.command('save-svg', 'Save as SVG', () => openSvgDialog(this.ctx, this.fileSketches()), needGeometry);
    this.command('print', 'Print', () => this.openPrint(), needGeometry);
    this.command('enter', 'Enter', () => this.enter());
    this.command('escape', 'Escape', () => this.escape());
    this.command('hud-next', 'Next Field', () => this.hud.tab(false));
    this.command('hud-prev', 'Previous Field', () => this.hud.tab(true));
    this.command('orbit', 'Orbit View', () => this.toggleOrbit(), () => (this.mode === 'design' ? 'design mode is the Orbit view already' : null));
    for (const arrow of ARROWS) {
      const label = `Fold ${arrow[0].toUpperCase()}${arrow.slice(1)}`;
      this.command(`fold-${arrow}`, label, () => this.foldPlane(arrow), () => {
        const line = this.hinge(arrow);
        return typeof line === 'string' ? line : null;
      });
    }
  }

  /**
   * What the File menu exports: the open sketch, or in design mode the shown sketches on one plane, that of the
   * sketch last edited, else of the last one shown.
   */
  private fileSketches(): Sketch[] {
    const s = this.activeSketch;
    if (s) return [s];
    // In their own coordinates, so only those that share a frame: the others would not line up.
    const shown = this.design.order.map((id) => this.design.sketches[id]).filter((k) => k && k.visible);
    const frame = shown.some((k) => sameFrame(k.frame, this.frame)) ? this.frame : shown.at(-1)?.frame;
    return frame ? shown.filter((k) => sameFrame(k.frame, frame)) : [];
  }

  private openPrint(): void {
    const { showConstruction: construction, showProjected: projected, showPoints: points } = this.settings;
    openPrintDialog(this.ctx, this.fileSketches(), { construction, projected, points });
  }

  computeSketch(): void {
    const s = this.activeSketch;
    if (s) {
      this.timed(() => this.recompute(s.id));
      this.emit('status');
    }
  }

  private selectAll(): void {
    const s = this.activeSketch as Sketch;
    this.selection.set(this.withoutFrameEdges(Object.values(s.curves).filter((c) => this.curveVisible(c) && this.editable(c.id)).map((c) => c.id)));
  }

  private copy(): void {
    if (!this.selection.size) return;
    this.clipboard = copySelection(this.activeSketch as Sketch, this.withoutFrameEdges(this.selection.ids()));
    const copied = this.clipboard.curves.length;
    this.message(`Copied ${copied} ${copied === 1 ? 'curve' : 'curves'}`);
  }

  private cut(): void {
    this.copy();
    this.deleteSelection();
  }

  /** Paste around the cursor, keeping the clipboard's shape; works across sketches [ref]. */
  private paste(): void {
    const clip = this.clipboard;
    if (!clip) return;
    const box = emptyBox();
    for (const p of clip.points) boxAdd(box, p);
    const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const target = this.pointer?.world ?? centre;
    const offset = { x: target.x - centre.x, y: target.y - centre.y };
    let ids: Id[] = [];
    this.commit('Paste', (c) => {
      ids = pasteClipboard(c.design, c.sketch, clip, { offset }).curves;
    });
    this.selection.set(ids);
  }

  deleteSelection(): void {
    const ids = this.withoutFrameEdges(this.selection.ids().filter((id) => id !== 'origin'));
    if (!ids.length) return;
    this.selection.clear();
    this.deleting = new Set(ids);
    this.commit('Delete', ({ sketch }) => {
      deleteEntities(sketch, ids);
    });
    this.deleting = new Set();
  }

  private toggleConstruction(): void {
    const s = this.activeSketch as Sketch;
    const ids = this.selectedCurves().filter((id) => (s.curves[id] as { frameOf?: Id }).frameOf === undefined);
    if (ids.length) {
      this.commit('Normal/Construction', ({ sketch }) => toggleConstruction(sketch, ids));
    } else this.message('Select geometry first');
  }

  sketchBox(sketch: Sketch): Box {
    const box = emptyBox();
    for (const c of Object.values(sketch.curves)) {
      const b = boundingBox(sketch, c);
      boxAdd(box, { x: b.minX, y: b.minY });
      boxAdd(box, { x: b.maxX, y: b.maxY });
    }
    for (const p of Object.values(sketch.points)) if (p.explicit) boxAdd(box, p);
    return box;
  }

  fit(): void {
    this.hurry();
    if (this.orbit && this.scene) {
      const from = this.scene;
      const to = this.homeCamera();
      this.play((t) => between(from, to, easeInOut(t)), ORBIT_MS, () => {
        this.view.ppm = to.ppm;
        if (this.orbit && !this.orbit.back) this.homed = HOME;
      });
      return;
    }
    // Only Sketch mode is in plan: design mode is the Orbit view.
    const s = this.activeSketch;
    const box = s ? this.sketchBox(s) : null;
    // A dimension is read at its label, which can sit well outside what it measures.
    if (box && s) for (const d of Object.values(s.dimensions)) if (!d.feature) boxAdd(box, d.label);
    if (box && Number.isFinite(box.minX)) this.view.fit(box, FIT_MARGIN, this.covered());
    else this.view.fit({ minX: -50, minY: -50, maxX: 50, maxY: 50 });
    this.invalidate();
  }

  /** How much of the canvas's left and right the floating panels take, if that leaves room to draw in. */
  private covered(): { left: number; right: number } {
    const box = this.canvas.getBoundingClientRect();
    const reach = (selector: string, side: 'left' | 'right'): number => {
      const r = this.stage.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      if (!r || r.width === 0) return 0;
      return side === 'left' ? Math.max(0, r.right - box.left) : Math.max(0, box.right - r.left);
    };
    const cover = { left: reach('.browser', 'left'), right: reach('.palette', 'right') };
    return box.width - cover.left - cover.right > box.width / 3 ? cover : { left: 0, right: 0 };
  }

  /** Zoom to one curve and light it, for Find Under-Constrained. */
  focusEntity(id: Id): void {
    const s = this.activeSketch;
    if (!s) return;
    const c = s.curves[id];
    const box = emptyBox();
    if (c) {
      const b = boundingBox(s, c);
      boxAdd(box, { x: b.minX, y: b.minY });
      boxAdd(box, { x: b.maxX, y: b.maxY });
    } else if (s.points[id]) boxAdd(box, getPointPos(s, id));
    if (Number.isFinite(box.minX)) this.view.fit(box, 160);
    this.selection.set([id]);
    this.invalidate();
  }

  deleteEntity(id: Id): void {
    this.commit('Delete', ({ sketch }) => {
      deleteEntities(sketch, [id]);
    });
  }

  /** Key entry points. Also reachable from the check button and the toolbar. */
  enter(): void {
    if (this.hud.editing) {
      this.hud.acceptEditor();
      return;
    }
    if (this.dialogs.current) {
      this.dialogs.current.ok();
      return;
    }
    const handled = this.tool?.enter?.() ?? false;
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (!handled) this.endTool();
    this.invalidate();
  }

  escape(): void {
    if (this.pick) {
      this.cancelPick();
      return;
    }
    if (this.orbit?.back) {
      this.leaveOrbit();
      return;
    }
    if (this.marking.isOpen) {
      this.marking.close();
      return;
    }
    if (this.hud.editing) {
      this.hud.cancelEditor();
      return;
    }
    if (this.hud.dropFocused()) return;
    if (this.dialogs.current) {
      this.dialogs.current.cancel();
      return;
    }
    const handled = this.tool?.escape?.() ?? false;
    if (!handled) this.endTool();
    this.invalidate();
  }

  // -------------------------------------------------------------------------
  // Input

  private placeTip(screen: Vec2): void {
    const meta = this.toolDef?.meta;
    const on = !!meta && meta.id !== 'select' && !this.dialogs.current;
    this.tip.style.display = on ? 'flex' : 'none';
    if (!on || !meta) return;
    // The first sentence is what to do; the status bar has the rest.
    const prompt = this.statusText.split('. ')[0];
    const text = `${meta.id}|${prompt}`;
    if (this.tip.dataset.key !== text) {
      this.tip.dataset.key = text;
      this.tip.innerHTML = `<span class="tip-icon">${icon(meta.icon ?? meta.id)}</span>`;
      this.tip.append(prompt);
    }
    this.tip.style.transform = `translate(${Math.round(screen.x + 14)}px, ${Math.round(screen.y + 34)}px)`;
  }

  private makePointer(e: MouseEvent, button: number): ToolPointer {
    const box = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - box.left, y: e.clientY - box.top };
    const world = this.view.toWorld(screen);
    const mod = e.metaKey || e.ctrlKey;
    let snapped = noInference(world);
    const opts = this.tool?.snap?.() ?? null;
    if (opts && !mod && this.activeSketch) {
      const sketch = this.activeSketch;
      snapped = this.snapper.resolve({
        sketch, view: this.view, gridSnap: this.settings.snap, others: this.otherSketches(),
        polyline: (c, s) => this.polyline(s, c), visible: this.curveVisible, pointVisible: this.pointVisible,
      }, world, opts);
    }
    const travelled = this.press ? Math.hypot(screen.x - this.press.screen.x, screen.y - this.press.screen.y) : 0;
    return {
      screen, world, snapped, button, shift: e.shiftKey, alt: e.altKey, mod,
      dragging: !!this.press && travelled >= CLICK_TRAVEL,
    };
  }

  /** Tool preview and overlays, after the document and before the inference glyph. */
  drawToolLayer(p: Preview, overlays: Overlay[]): void {
    for (const o of overlays) o(this.ctx, p);
    this.tool?.draw?.(p);
  }

  private showInference(p: ToolPointer): void {
    // A tool that snaps only some of the time, like Select dragging a point, would otherwise repaint every move.
    if (p.snapped.kind === 'none' && p.snapped.guides.length === 0 && this.inference?.kind === 'none') return;
    this.inference = this.tool?.snap ? p.snapped : null;
  }

  private bindCanvas(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // Focus is managed on pointerdown; the default would pull it out of a HUD field mid-expression.
    c.addEventListener('mousedown', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      // The marking menu does not depend on where the camera is: a right-click lands the swing at once.
      if (e.button === 2) this.hurry();
      if (this.swing) return;
      c.setPointerCapture(e.pointerId);
      // The ViewCube takes a left press on it before the canvas does, in either mode and while a plane is picked.
      if (e.button === 0 && !this.spaceHeld && !this.press) {
        const box = c.getBoundingClientRect();
        const target = this.cubeUnder({ x: e.clientX - box.left, y: e.clientY - box.top });
        if (target) {
          this.cubePress = { last: { x: e.clientX, y: e.clientY }, travel: 0, target };
          return;
        }
      }
      if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
        this.pan = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }
      if (this.orbit) {
        if (e.button === 0) this.orbitPress = { last: { x: e.clientX, y: e.clientY }, travel: 0 };
        // Design mode keeps its marking menu; not while a plane is picked.
        if (e.button === 2 && !this.orbit.back && !this.pick) {
          const box = c.getBoundingClientRect();
          this.openMarkingMenu({ x: e.clientX - box.left, y: e.clientY - box.top });
        }
        return;
      }
      if (e.button === 2) {
        const p = this.makePointer(e, 2);
        this.pointer = p;
        this.openMarkingMenu(p.screen);
        return;
      }
      if (e.button !== 0) return;
      if (this.interceptForHud(e)) return;
      this.clearNote();
      if (this.mode === 'sketch' && this.lockedActive) this.message(this.lockedNote(), 'warn');
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.press = { screen: { x: e.clientX - c.getBoundingClientRect().left, y: e.clientY - c.getBoundingClientRect().top }, button: 0 };
      const p = this.makePointer(e, 0);
      this.pointer = p;
      this.tool?.down?.(p);
      this.invalidate();
    });
    c.addEventListener('pointermove', (e) => {
      if (this.swing) return;
      if (this.cubePress) {
        this.cubeDrag(e);
        return;
      }
      if (this.pan) {
        if (this.orbit && this.scene) {
          this.scene = panCamera(this.scene, e.clientX - this.pan.x, e.clientY - this.pan.y);
          this.homed = null;
        } else this.view.panBy(e.clientX - this.pan.x, e.clientY - this.pan.y);
        this.pan = { x: e.clientX, y: e.clientY };
        this.invalidate();
        return;
      }
      if (!this.press && !this.orbitPress) {
        const box = c.getBoundingClientRect();
        if (this.hoverCube({ x: e.clientX - box.left, y: e.clientY - box.top })) return;
      }
      if (this.orbit) {
        this.orbitMove(e);
        return;
      }
      const p = this.makePointer(e, this.press ? 0 : -1);
      this.pointer = p;
      this.cursorWorld = p.snapped.pos;
      const before = this.inference;
      this.showInference(p);
      this.tool?.move?.(p);
      this.placeTip(p.screen);
      this.hoverPlane(p.screen);
      if (this.picksElsewhere && !this.hover && !this.press) {
        const found = this.foreignHit(p.screen);
        if (found) {
          this.hover = found.hit;
          this.invalidate();
        }
      }
      this.emit('cursor');
      // Hover changes repaint through setHover. Plain mouse travel in select repaints nothing.
      const selecting = this.activeToolId === 'select' || !this.tool?.draw;
      if (this.press || !selecting || before !== this.inference) this.invalidate();
    });
    c.addEventListener('pointerup', (e) => {
      if (this.cubePress && e.button === 0) {
        const press = this.cubePress;
        this.cubePress = null;
        if (press.travel < CLICK_TRAVEL) this.turnTo(press.target);
        return;
      }
      if (this.pan) {
        this.pan = null;
        return;
      }
      if (this.orbit) {
        const box = c.getBoundingClientRect();
        const screen = { x: e.clientX - box.left, y: e.clientY - box.top };
        if (e.button === 2) {
          if (this.marking.isOpen) this.marking.flick(screen);
          return;
        }
        const press = this.orbitPress;
        this.orbitPress = null;
        if (press && press.travel < CLICK_TRAVEL && !this.swing) {
          // While a plane is picked only the planes take a click.
          if (this.pick) this.pickAt(screen);
          else {
            const id = this.sketchUnder(screen);
            if (id) this.faceSketch(id);
          }
        }
        return;
      }
      if (this.swing) return;
      if (e.button === 2) {
        this.marking.flick({ x: e.clientX - c.getBoundingClientRect().left, y: e.clientY - c.getBoundingClientRect().top });
        return;
      }
      if (!this.press) return;
      const p = this.makePointer(e, 0);
      const wasDrag = p.dragging;
      this.pointer = p;
      this.tool?.up?.(p);
      this.press = null;
      // A plane line takes a click that no geometry does, the axes included.
      const near = !wasDrag && this.activeToolId === 'select' ? this.planeLineAt(p.screen) : null;
      const plane = near && !this.hitAt(p.screen) ? near : null;
      if (plane) {
        this.goToPlane(plane, p.screen);
        this.invalidate();
        return;
      }
      if (!wasDrag) this.projectUnder(p.screen);
      if (!wasDrag) this.tool?.click?.(p);
      this.showInference(p);
      this.invalidate();
    });
    c.addEventListener('pointerleave', () => {
      this.tip.style.display = 'none';
      if (this.pickHover || this.cubeHover) {
        if (this.cubeHover) this.canvas.style.cursor = this.cubeCursor;
        this.pickHover = null;
        this.cubeHover = null;
        this.invalidate();
      }
      if (this.press) return;
      this.inference = null;
      this.hover = null;
      this.invalidate();
    });
    c.addEventListener('dblclick', (e) => {
      if (this.swing || this.orbit) return;
      const p = this.makePointer(e, 0);
      this.tool?.dblclick?.(p);
      this.invalidate();
    });
    // A mouse wheel zooms, a two-finger drag pans, a pinch zooms: see wheel.ts. Nothing here touches the
    // tool, so a preview in progress stays where it is and goes on with the view.
    const wheel = new WheelGestures((a) => {
      if (this.orbit && this.scene) {
        const { width, height } = this.view;
        this.scene = a.kind === 'zoom' ? zoomCamera(this.scene, a.at, a.factor, width, height) : panCamera(this.scene, a.dx, a.dy);
        // Curves are flattened for the zoom they are seen at.
        this.view.ppm = this.scene.ppm;
        this.homed = null;
      } else if (a.kind === 'zoom') this.view.zoomAt(a.at, a.factor);
      else this.view.panBy(a.dx, a.dy);
      this.invalidate();
    });
    c.addEventListener('wheel', (e) => {
      // Always ours: the page must not scroll, zoom, or go back on a swipe.
      e.preventDefault();
      if (this.swing) return;
      const box = c.getBoundingClientRect();
      wheel.feed(e, { x: e.clientX - box.left, y: e.clientY - box.top });
    }, { passive: false });
  }

  /** With Select idle, a plane line under the cursor lights, and the tip names the sketches on it. */
  private hoverPlane(screen: Vec2): void {
    const near = !this.press && this.activeToolId === 'select' ? this.planeLineAt(screen) : null;
    const line = near && !this.hitAt(screen) ? near : null;
    if (line !== this.planeHover && line?.ids.join() !== this.planeHover?.ids.join()) {
      this.planeHover = line;
      this.invalidate();
    }
    if (!line) return;
    const names = line.ids.map((id) => this.design.sketches[id]?.name ?? id).join(', ');
    this.tip.dataset.key = `plane|${names}`;
    this.tip.innerHTML = `<span class="tip-icon">${icon('sketch-node')}</span>`;
    this.tip.append(`${names}: click to go there`);
    this.tip.style.display = 'flex';
    this.tip.style.transform = `translate(${Math.round(screen.x + 14)}px, ${Math.round(screen.y + 34)}px)`;
  }

  /** A drag in the Orbit view turns it; plain travel lights the sketch, or while picking the plane, under the cursor. */
  private orbitMove(e: PointerEvent): void {
    const press = this.orbitPress;
    if (press && this.scene) {
      const dx = e.clientX - press.last.x;
      const dy = e.clientY - press.last.y;
      press.travel += Math.hypot(dx, dy);
      press.last = { x: e.clientX, y: e.clientY };
      if (press.travel >= CLICK_TRAVEL) {
        this.scene = orbitBy(this.scene, dx, dy);
        this.orbitHover = null;
        this.pickHover = null;
        this.homed = null;
        this.tip.style.display = 'none';
        this.invalidate();
      }
      return;
    }
    const box = this.canvas.getBoundingClientRect();
    if (this.pick) {
      this.hoverPick({ x: e.clientX - box.left, y: e.clientY - box.top });
      return;
    }
    const id = this.sketchUnder({ x: e.clientX - box.left, y: e.clientY - box.top });
    this.canvas.style.cursor = id ? 'pointer' : 'grab';
    if (id !== this.orbitHover) {
      this.orbitHover = id;
      this.invalidate();
    }
  }

  /** Canvas press with a value box open: insert a clicked dimension's name, or accept the editor. */
  private interceptForHud(e: PointerEvent): boolean {
    const focused = this.hud.focused();
    if (focused && this.activeSketch) {
      const box = this.canvas.getBoundingClientRect();
      const hit = this.hitAt({ x: e.clientX - box.left, y: e.clientY - box.top }, { kinds: ['dimension'] });
      if (hit) {
        const d = this.activeSketch.dimensions[hit.id];
        if (d && this.hud.insertName(d.name)) {
          e.preventDefault();
          return true;
        }
      }
      const shown = this.shownDimensionAt({ x: e.clientX - box.left, y: e.clientY - box.top });
      if (shown && this.hud.insertName(shown)) {
        e.preventDefault();
        return true;
      }
    }
    if (this.hud.editing) {
      this.hud.acceptEditor();
      return true;
    }
    return false;
  }

  /** A dimension of another sketch under the cursor, shown through the browser's Show Dimensions [ref]. */
  private shownDimensionAt(screen: Vec2): string | null {
    for (const id of this.dimensionsInDesign) {
      const s = this.design.sketches[id];
      if (!s || s === this.activeSketch || !sameFrame(s.frame, this.frame)) continue;
      for (const d of Object.values(s.dimensions)) {
        const at = layoutDimension(this.design, s, d, this.view)?.label;
        if (at && Math.hypot(this.view.toScreen(at).x - screen.x, this.view.toScreen(at).y - screen.y) < SHOWN_DIM_PX) return d.name;
      }
    }
    return null;
  }

  private openMarkingMenu(screen: Vec2): void {
    const hit = this.activeSketch ? this.hitAt(screen, { reserved: true, editableOnly: true }) : null;
    const radial: RadialItem[] = [];
    const list: MenuItem[] = [];
    if (this.mode === 'design') {
      radial.push({ id: 'create-sketch', label: 'Create Sketch', icon: 'create-sketch', run: () => this.run('create-sketch') });
      if (this.history.canUndo) radial.push({ id: 'undo', label: 'Undo', icon: 'undo', run: () => this.undo() });
      if (this.history.canRedo) radial.push({ id: 'redo', label: 'Redo', icon: 'redo', run: () => this.redo() });
      // The workspace menus [ref GUID-88CC0E51].
      list.push({ id: 'menu-sketch', label: 'Sketch: Create Sketch', icon: 'create-sketch', run: () => this.run('create-sketch') });
      list.push({ id: 'menu-new', label: 'File: New Design', run: () => this.run('new') });
      list.push({ id: 'menu-home', label: 'View: Home View', run: () => this.fit() });
    } else {
      const entry = this.lastTool ? this.tools.get(this.lastTool)?.meta : null;
      if (entry) radial.push({ id: 'repeat', label: `Repeat ${entry.label}`, icon: entry.icon ?? entry.id, run: () => this.run('repeat') });
      radial.push({ id: 'finish-sketch', label: 'Finish Sketch', icon: 'finish-sketch', run: () => this.finishSketch() });
      if (this.selection.size || hit) {
        radial.push({
          id: 'delete', label: 'Delete', icon: 'delete',
          run: () => {
            if (hit && !this.selection.has(hit.id)) this.selection.set([hit.id]);
            this.deleteSelection();
          },
        });
      }
      radial.push({ id: 'undo', label: 'Undo', icon: 'undo', run: () => this.undo() });
      radial.push({ id: 'redo', label: 'Redo', icon: 'redo', run: () => this.redo() });
      radial.push({ id: 'tool-line', label: 'Line', icon: 'line', run: () => this.activate('line') });
      radial.push({ id: 'tool-dimension', label: 'Sketch Dimension', icon: 'dimension', run: () => this.activate('dimension') });
      if (hit?.kind === 'curve' || this.selectedCurves().length) {
        radial.push({
          id: 'toggle-construction', label: 'Normal/Construction', icon: 'construction',
          run: () => {
            if (hit?.kind === 'curve' && !this.selection.has(hit.id)) this.selection.set([hit.id]);
            this.toggleConstruction();
          },
        });
      }
      list.push({ id: 'menu-finish', label: 'Sketch: Finish Sketch', icon: 'finish-sketch', run: () => this.finishSketch() });
      list.push(...(this.tool?.menu?.(hit) ?? []));
      if (hit?.kind === 'curve' || this.selectedCurves().length) {
        list.push({
          id: 'toggle-centerline', label: 'Normal/Centerline', icon: 'centerline',
          run: () => {
            if (hit?.kind === 'curve' && !this.selection.has(hit.id)) this.selection.set([hit.id]);
            this.toggleCenterline();
          },
        });
      }
      for (const a of CONTEXT_ACTIONS) {
        if (a.applies(this.ctx, hit)) list.push({ id: a.id, label: a.labelFor?.(this.ctx, hit) ?? a.label, icon: a.icon, run: () => a.run(this.ctx, hit) });
      }
      if (hit?.kind === 'curve' || hit?.kind === 'point' || this.selection.size) {
        list.push({
          id: 'fix-unfix', label: 'Fix/UnFix', icon: 'fix',
          run: () => {
            if (hit && !this.selection.has(hit.id)) this.selection.set([hit.id]);
            this.activate('fix');
          },
        });
      }
      if (this.selection.size) {
        for (const id of ['coincident', 'tangent', 'equal', 'parallel', 'perpendicular']) {
          const t = this.tools.get(id)?.meta;
          if (t) list.push({ id: `constraint-${id}`, label: t.label, icon: t.icon ?? id, run: () => this.activate(id) });
        }
      }
      if (hit) list.push({ id: 'find-in-browser', label: 'Find in Browser', run: () => this.browser.find(this.activeId as Id) });
      if (!hit) {
        for (const id of ['circle-center', 'rect-2pt', 'spline-fit', 'project', 'offset']) {
          const t = this.tools.get(id)?.meta;
          if (t) list.push({ id: `tool-${id}`, label: t.label, icon: t.icon ?? id, run: () => this.activate(id) });
        }
      }
      if (!hit && this.clipboard) list.push({ id: 'paste', label: 'Paste', icon: 'paste', run: () => this.run('paste') });
      if (this.selection.size) list.push({ id: 'copy', label: 'Copy', icon: 'copy', run: () => this.run('copy') });
      if (hit?.kind === 'curve' || hit?.kind === 'point' || this.selectedCurves().length) {
        for (const l of this.design.layers) {
          if (l.id === this.design.activeLayer) continue;
          list.push({
            id: `move-to-layer-${l.id}`, label: `Move to ${l.name}`,
            run: () => {
              if (hit && !this.selection.has(hit.id)) this.selection.set([hit.id]);
              this.moveSelectionToLayer(l.id);
            },
          });
        }
      }
    }
    this.marking.open(screen, radial, list);
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (this.swing) {
        // A command lands the swing at once and goes on; anything else waits for it.
        const bound = this.keys.some((b) => b.key === keyName(e));
        if (!bound || isTextTarget(e.target)) {
          if (!isTextTarget(e.target)) e.preventDefault();
          return;
        }
        this.hurry();
      }
      if (e.key === ' ' && !isTextTarget(e.target)) {
        this.spaceHeld = true;
        e.preventDefault();
        return;
      }
      if (e.key === 'Meta' || e.key === 'Control') this.remakePointer(e);
      if (this.toolbox.isOpen) return;
      const name = keyName(e);
      const binding = this.keys.find((b) => b.key === name);
      const inText = isTextTarget(e.target);
      if (inText && !binding?.always) return;
      // Enter in a multi-line box is a new line [ref SKT-REF-TEXT-DIALOG]. Cmd/Ctrl+Enter still accepts.
      if (name === 'enter' && e.target instanceof HTMLTextAreaElement) return;
      if (!inText && this.routeToHud(e)) return;
      if (binding?.command.startsWith('hud-') && !this.hud.active) return;
      // In a dialog or a menu the arrows are its own; in the Orbit view of a sketch most keys wait for it to close.
      const inDialog = e.target instanceof Element && !!e.target.closest('[role="dialog"], .popup-menu');
      if (binding?.command.startsWith('fold-') && (inDialog || this.dialogs.current || this.marking.isOpen || this.pick)) return;
      if (this.orbit?.back && !(binding && ORBIT_KEYS.has(binding.command))) return;
      if (binding) {
        e.preventDefault();
        this.run(binding.command);
        return;
      }
      if (this.tool?.key?.(e)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.spaceHeld = false;
      if (e.key === 'Meta' || e.key === 'Control') this.remakePointer(e);
    });
    window.addEventListener('blur', () => { this.spaceHeld = false; });
  }

  /** Cmd/Ctrl suppresses inference at once, without waiting for the mouse to move. */
  private remakePointer(e: KeyboardEvent): void {
    if (!this.pointer) return;
    const box = this.canvas.getBoundingClientRect();
    const fake = new MouseEvent('pointermove', {
      clientX: this.pointer.screen.x + box.left, clientY: this.pointer.screen.y + box.top,
      metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
    });
    const p = this.makePointer(fake, this.press ? 0 : -1);
    this.pointer = p;
    this.showInference(p);
    this.tool?.move?.(p);
    this.invalidate();
  }

  /** While value fields show, plain typing goes to the first field [ref]. */
  private routeToHud(e: KeyboardEvent): boolean {
    if (!this.hud.active || e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.key.length !== 1 || e.key === ' ') return false;
    return this.hud.focusFirst();
  }

  /** Read-only view for tests: every call returns copies. Never mutate through this. */
  debugHandle(): SketchDebug {
    const app = this;
    const clone = <T,>(v: T): T => structuredClone(v);
    return {
      get mode() { return app.mode; },
      get activeId() { return app.activeId; },
      get tool() { return app.activeToolId; },
      get frames() { return app.frames; },
      get frameMs() { return app.frameMs; },
      get minDistanceRuns() { return app.minDistanceRuns; },
      get solveRuns() { return app.solveRuns; },
      get status() { return app.statusText; },
      get note() { return app.noteText; },
      get lineType() { return app.lineType; },
      get selection() { return app.selection.ids(); },
      get dirty() { return app.dirty; },
      get highlight() { return [...app.highlight]; },
      get canUndo() { return app.history.canUndo; },
      get canRedo() { return app.history.canRedo; },
      get view() { return { cx: app.view.cx, cy: app.view.cy, ppm: app.view.ppm, width: app.view.width, height: app.view.height, dpr: app.view.dpr }; },
      design: () => clone(app.design),
      sketch: () => (app.activeSketch ? clone(app.activeSketch) : null),
      toScreen: (x, y) => {
        const s = app.view.toScreen({ x, y });
        const box = app.canvas.getBoundingClientRect();
        return { x: s.x + box.left, y: s.y + box.top };
      },
      toWorld: (x, y) => {
        const box = app.canvas.getBoundingClientRect();
        return app.view.toWorld({ x: x - box.left, y: y - box.top });
      },
      analysis: () => {
        const a = app.analysisOf(app.activeId);
        return {
          ok: a.ok, dof: a.dof, freeCurves: [...a.freeCurves], freePoints: [...a.freePoints],
          unsatisfied: [...a.unsatisfied], badCurves: [...a.badCurves],
        };
      },
      profiles: () => (app.activeSketch ? app.profilesOf(app.activeSketch).length : 0),
      inference: () => (app.inference ? clone(app.inference) : null),
      get settings() { return { ...app.settings }; },
      appearance: (id) => app.renderer.appearance(id),
      badges: () => (app.activeSketch ? app.renderer.layouts(app.activeSketch).badges.map((b) => ({ ...b })) : []),
      labels: () => (app.activeSketch ? app.renderer.layouts(app.activeSketch).labels.map((l) => l.id) : []),
      drawnPoints: () => (app.activeSketch ? app.renderer.drawnPoints(app.activeSketch) : []),
      textOutlines: (id, text) => {
        const c = app.activeSketch?.curves[id];
        if (c?.type !== 'text') return [];
        return textOutlines(text === undefined ? c : { ...c, text }, app.activeSketch as Sketch, { design: app.design });
      },
      flushAutosave: () => app.autosave.flush(),
      get frame() { return clone(app.frame); },
      get scene() { return app.scene ? clone(app.scene) : null; },
      get swinging() { return app.swinging; },
      get orbiting() { return app.orbiting; },
      get picking() { return app.picking; },
      get pickHover() { return app.pickHover; },
      get planeSize() { return app.sceneSize(); },
      planeToScreen: (plane, x, y) => app.planeToClient(plane, { x, y }),
      seen: () => app.otherSketches().map((s) => ({
        id: s.id,
        curves: Object.values(s.curves).filter((c) => app.curveVisible(c)).map((c) => c.id),
        points: visiblePoints(s, app.curveVisible, (p) => app.pointVisible(p, s)).map((p) => p.id),
      })),
      sceneToScreen: (id, x, y) => app.sceneToClient(id, { x, y }),
      planeLines: () => app.planeLines().map((l) => ({ p: { ...l.p }, d: { ...l.d }, sketches: [...l.ids] })),
      cube: () => app.cubeOnPage(),
      cubeToScreen: (name, at) => app.cubeToClient(name, at),
    };
  }
}

export interface SketchDebug {
  readonly mode: string;
  readonly activeId: Id | null;
  readonly tool: string | null;
  readonly frames: number;
  /** Paint time of the last frame. */
  readonly frameMs: number;
  /** How often Min Distance has been worked out. */
  readonly minDistanceRuns: number;
  /** How often the time to solve has been taken: once per request, not per solve. */
  readonly solveRuns: number;
  readonly status: string;
  readonly note: string;
  readonly lineType: LineType;
  readonly selection: Id[];
  /** Changed since the last save, open or new. */
  readonly dirty: boolean;
  /** Ids lit without being selected: a dialog's picks, Measure's two. */
  readonly highlight: Id[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly view: { cx: number; cy: number; ppm: number; width: number; height: number; dpr: number };
  design(): Design;
  sketch(): Sketch | null;
  toScreen(x: number, y: number): Vec2;
  toWorld(x: number, y: number): Vec2;
  analysis(): { ok: boolean; dof: number; freeCurves: Id[]; freePoints: Id[]; unsatisfied: Id[]; badCurves: Id[] };
  profiles(): number;
  inference(): Inference | null;
  readonly settings: Settings;
  /** How a curve of the active sketch is drawn, or null when it is not. */
  appearance(id: Id): { color: string; width: number; dash: number[] } | null;
  badges(): { constraint: Id; type: string; x: number; y: number; cross?: boolean }[];
  /** Dimension ids with a label on the canvas. */
  labels(): Id[];
  /** Point ids of the active sketch drawn as a status dot. */
  drawnPoints(): Id[];
  /** Glyph outlines of a text entity, sketch mm; `text` lays out other wording in the same frame. */
  textOutlines(id: Id, text?: string): Vec2[][];
  flushAutosave(): void;
  /** The plane the canvas looks straight at. */
  readonly frame: Frame;
  /** The 3D camera while the canvas shows 3D, else null. */
  readonly scene: Camera | null;
  /** The camera is swinging between planes or views. */
  readonly swinging: boolean;
  /** The Orbit view is open: always in design mode, and from a sketch with V. */
  readonly orbiting: boolean;
  /** An origin plane is being picked, for Create Sketch or Redefine Sketch Plane. */
  readonly picking: boolean;
  /** The plane square lit under the cursor while picking. */
  readonly pickHover: Plane | null;
  /** How far the origin plane squares reach in the 3D view, in mm. */
  readonly planeSize: number;
  /** Where a point of an origin plane, in its coordinates, shows on the page in the 3D view, or null outside it. */
  planeToScreen(plane: Plane, x: number, y: number): Vec2 | null;
  /** What each other visible sketch shows of itself here: the curves and the points drawn and pickable. */
  seen(): { id: Id; curves: Id[]; points: Id[] }[];
  /** Where a sketch point shows on the page in the 3D view, or null outside it. */
  sceneToScreen(sketch: Id, x: number, y: number): Vec2 | null;
  /** The plane lines drawn in Sketch mode: a point, a unit direction and the sketches on each. */
  planeLines(): { p: Vec2; d: Vec2; sketches: Id[] }[];
  /** The ViewCube as last drawn, or null when there was no room for it. */
  cube(): CubeView | null;
  /** A page position that picks a face, edge or corner of the ViewCube by name (`top`, `front-right`, `top-front-right`), if it shows. */
  cubeToScreen(name: string, at?: { s: number; t: number }): Vec2 | null;
}

export interface CubeView {
  /** Its centre on the page, half its edge and the square it takes, in CSS px. */
  x: number;
  y: number;
  half: number;
  size: number;
  /** What is lit under the cursor. */
  hover: string | null;
  /** The faces shown, nearest square-on first: how square-on, and which way their labels' right and up run on screen, Y down. */
  faces: { label: string; facing: number; right: Vec2; up: Vec2 }[];
}

