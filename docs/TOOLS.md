# Adding a tool

A tool is one new file under `src/tools/` and one line in `src/tools/registry.ts`. The toolbar, the
toolbox (S), the palette's type switcher, the marking menu's Repeat and the shortcut table are all
built from the tool's metadata. Read `src/tools/tool.ts` for the exact contract; `line.ts`,
`rectangle.ts`, `constraints.ts` and `dimension.ts` are working examples.

**Ids.** Every tool in SPEC section 6 already has an id, label, shortcut and icon in
`src/tools/menu.ts` and `src/ui/icons.ts`, and shows greyed until a tool registers that id. Use the
id from `menu.ts`; you should not need to edit the menu or draw an icon. Group ids in use: `line`,
`rectangle`, `circle`; use `arc`, `polygon`, `slot`, `spline`, `chamfer` for the others.

## Worked example: Midpoint Line

`src/tools/midpoint-line.ts`, complete:

```ts
import { addConstraint, addLine, addPoint } from '../model/document';
import { dist, sub } from '../geom/vec';
import { defineClickTool, previewStroke, radialLock, type ToolDef } from './tool';

export const midpointLineTool: ToolDef = defineClickTool({
  meta: { id: 'midpoint-line', label: 'Midpoint Line', panel: 'create', group: 'line' },
  steps: [
    { prompt: 'Click the midpoint of the line' },
    {
      prompt: 'Click an end of the line, or type its length',
      from: 0,                                   // direction inference starts at pick 0
      fields(s) {                                // HUD fields, rebuilt on every move
        const m = s.at(0);
        return [{ key: 'length', kind: 'length', value: 2 * dist(m, s.cursor.pos), at: s.cursor.pos, lock: radialLock(m, 2) }];
      },
    },
  ],
  preview(p, s) {                                // runs from the first pick on
    const m = s.at(0);
    const end = s.at(1);                         // at(i): pick i, or the live cursor
    p.line(sub(m, sub(end, m)), end, previewStroke(s.ctx.lineType));
    p.dot(m);
  },
  commit(c, s) {                                 // one undo step; solve and analysis run after
    const m = s.at(0);
    const end = s.at(1);
    const line = addLine(c.design, c.sketch, sub(m, sub(end, m)), end, c.curveOpts);
    const mid = addPoint(c.design, c.sketch, m, { owner: line.id });
    addConstraint(c.design, c.sketch, 'midpoint', [mid.id, line.id]);
    c.infer(mid.id, s.picks[0]);                 // whatever pick 0 snapped to becomes a constraint
    c.infer(line.b, s.picks[1], { segment: line.id });
    c.hudDimension('length', 'distance', [line.a, line.b]);  // locked HUD value -> driving dimension
  },
});
```

Then in `registry.ts`: import it and add `midpointLineTool,` to `TOOLS`. That is everything. Loop,
Esc (cancel, then exit), Enter (place typed values, then exit), HUD, prompts, zero-length rejection
and inference glyphs come from `defineClickTool`.

A step can also give `valid(s)` to reject a click with a message, and `snap(s)` for full inference
options (`previous`, `tangent`, `pointsOnly`, `exclude`). A slot variant is the same shape with a
third step. Use one `defineClickTool` per variant and share
the geometry in a helper (see `closedQuad` in `rectangle.ts`).

## The helpers

| You want | Use |
|---|---|
| N clicks then geometry | `defineClickTool` (`tool.ts`) |
| A constraint | `defineConstraintTool` (`constraint-tool.ts`): `count`, `accept`, `apply`, `prompts`, and `retry` to have a refused `apply` run once more another way, as H/V takes the other axis. Preselection, hover filtering, picking order and holding the heavier pick are done for you. `accept` decides what highlights |
| A dialog with picks | `defineDialogTool` (`dialog-tool.ts`): `build` adds rows and returns your state, `ok` commits, `preview` draws, `changed` validates |
| Anything else (trim, fillet, spline) | Write a `ToolDef` by hand: `{ meta, create(ctx, arg) { return { move, click, enter, escape, draw, ... } } }`. See `line.ts` |

Inside `commit(c, ...)` (`CommitScope`):

- `c.infer(pointId, placed, { segment, from })`: adds coincident, midpoint, quadrant, on-curve,
  tangent, H/V, perpendicular or parallel, whichever the click landed on. Pass `segment` when the
  point ends a line. **Call it after the geometry exists.**
- `c.inferRim(curveId, placed)`: for a curve with no stored point at the click (circle through an
  existing point).
- `c.hudDimension(fieldKey, kind, refs, { label })`: no-op unless that HUD field is locked. Goes
  Driven by itself if it would over-constrain.
- `c.dimension(kind, refs, init)`: dimension at the measured value, same Driven handling.
- `c.hold(...pointIds)`: keep points still in this commit's solve. A constraint tool holds its heavier pick by default, the first between equals, so a free object gives way whichever came first. Set `hold` in the spec where the pick order is the point, as in Equal. What hangs off a moved joint goes with it, whole (`bodies.ts`), so a seat moves only what it is about. Every commit ends with `checked`: a result cannot say OK with a row unmet.
- `c.curveOpts`: pass to `addLine` and friends, so the palette Linetype applies. Construction helpers
  pass `{ lineType: 'construction' }` instead.
- Return `false` to abandon: the document reverts and no undo step is made.

`ctx.commit(label, fn)` is the only way to change the document from a tool. Never mutate it outside
one, except live drag frames through `ctx.solver.drag(targets, hold)`, which you finish with
`ctx.commit('Drag', () => undefined)` or undo with `ctx.revert()`.

HUD fields: `{ key, label?, kind: 'length' | 'angle' | 'number', value, at, lock? }`. `lock(p, v)`
says how a typed value moves the cursor (`radialLock`, `angleLock`). A field with no `lock` is read
with `ctx.hud.locked(key)?.value`, like a polygon's side count. The first field takes typing; Tab
moves on. A box that stays put takes a click; one under the cursor or following it leaves every press
to the tool, however long the pointer waited first: a pause never changes what a press does.

Colours: never write one. Take them from `COLORS` (`render/style.ts`: `COLORS.preview`, `.construction`,
`.selected`, `.dotHole`, and the rest) or from `previewStroke(ctx.lineType)`, read at the moment you draw,
because the theme can change between frames, and a module-level `const` would keep Light's. For a shared
stroke object use getters, as `CONSTRUCTION` in `kit.ts` does. A new colour is a new `--c-*` token in
`src/ui/tokens.css`, in both themes, and a key in `PALETTE_KEYS`; `src/render/palette.test.ts` fails if a
literal is left in the code or a token is missing from one theme.

Preview (`p` in `preview`/`draw`): `line`, `poly`, `circle`, `arc`, `dot`, `text`, `measure`,
`dimension`, `curves(sketchCopy, curves)`, `raw`. Positions are sketch mm, weights are screen pixels.
`preview()` from `geom/modify.ts` gives a sketch copy to draw with `p.curves`.

Palette: `ctx.palette.options([{ key, label, kind, value, onChange }])` adds Feature Options rows
while the tool runs. Sibling tools in a `group` appear there automatically.

## Dialogs

```ts
export const mirrorTool = defineDialogTool<State>({
  meta: { id: 'mirror', label: 'Mirror', panel: 'create' },
  title: 'Mirror',
  build(ctx, d) {
    const objects = d.selection({ label: 'Objects', accept: (h) => h.kind === 'curve', initial: ctx.selection.ids() });
    const axis = d.selection({ label: 'Mirror Line', accept: isLine, multiple: false });
    return { objects, axis };
  },
  changed(ctx, s, d) { d.setError(null); },
  preview(p, ctx, s) { /* live preview */ },
  ok(ctx, s) { ctx.commit('Mirror', (c) => { /* ... */ }); },
});
```

`Dialog` (`src/ui/dialogs/dialog.ts`) gives `number`, `text`, `expression` (red on a bad value,
`.value()` resolves it), `select`, `checkbox`, `slider`, `button`, `section`, `note`, `custom` and
`selection`. A selection row has the Select toggle and the X that clears it [ref Mirror]. OK stays
disabled until each selection field has `min` picks (default 1). Canvas clicks and window selects go
to the active field. Each `Field` has `get`, `set` and `row`.

For a dialog with no tool (Export DXF), `ctx.dialogs.open({ title, onOk })`. `noCancel` leaves a dialog with only OK (Recover Designs),
and `footButton(label, run)` adds a button beside OK (Don't Save). A dialog tool can take snapped points from the canvas: give
`defineDialogTool` a `snap(ctx, state)` that returns `SnapOptions` while a pick is wanted and null otherwise, and read `e.snapped.pos` in
`click` (Move/Copy's Point to Point and Set Pivot do). Snapping then reaches other layers and other sketches; nothing is projected.

A tool that only reads, like Measure, sets `readOnly: true` in its meta so a locked active layer does not disable it, picks with
`ctx.hit(screen, { anyLayer: true })` to take what is shown on every layer, and hands its two picks to `ctx.measure(ids)` for the
status bar's Min Distance without touching the selection. A save the app cannot see finish (a download of an editable SVG) tells the
app with `ctx.savePoint()`: call what it returns once the file has been handed over, and the design counts as saved.

## Extension points in `registry.ts`

| List | For |
|---|---|
| `CONTEXT_ACTIONS` | Marking-menu entries by hit: Explode Text, Add Offset Dimension |
| `DOUBLE_CLICK` | Double-click on a feature glyph or text. Open a tool with `ctx.activate(id, arg)`; it reaches `create(ctx, arg)` and `build(ctx, d, arg)` |
| `SKETCH_ACTIONS` | Browser menu actions. `export-dxf` is already listed in the menu |
| `SELECTION_OPTIONS` | Palette rows for the selection: Curvature Comb, Change Spline Degree |
| `OVERLAYS` | Persistent canvas drawing: combs, instance checkboxes |

Pattern, offset and mirror features already get a selectable glyph: a `Hit` of kind `feature` whose
id is the feature's. Delete dissolves it through `deleteEntities`.

## Facts that catch people out

- Curves and sketches can be replaced by any solve, undo or regeneration. Hold ids, never objects,
  and re-read from `ctx.sketch` (or `c.sketch` inside a commit). A tool's `docChanged` runs after
  undo and redo, so drop or re-read what it held there.
- Picks are `Hit`s: `{ kind: 'point' | 'curve' | 'dimension' | 'constraint' | 'feature', id, pos }`.
  `ctx.hit(screen, { accept, reserved: true, kinds, sketch })` returns the best acceptable one;
  `reserved` includes the origin and the axes, whose ids are `origin`, `axis-x`, `axis-y`.
- Other sketches come from `ctx.others()`: the visible ones as this sketch sees them, in its
  coordinates, with their own ids (SPEC section 5, 3D mode). A sketch on another plane shows only the
  lines lying in this one. Pick from these, and pass one to `projectCurve`, `linkedCopy` or
  `projectPoint` as `from`; never read another sketch's points out of `ctx.design`, whose coordinates
  are its own. Inside a commit, `seenFrom(c.sketch.frame, sketch)` from `model/seen.ts` gives the same.
- The arrow keys and `V` are taken by the global key table (fold and Orbit view), so a tool's `key`
  never sees them.
- The lines where other planes meet the sketch (Other Planes) are drawn by the renderer and clicked
  only while Select is idle with nothing else under the cursor. They are not `Hit`s: `ctx.hit` never
  returns them and nothing snaps to them.
- `curvePoints(curve)` and `getPointPos` come from `model/document.ts`; arcs run counter-clockwise
  from `a` to `b`, so a clockwise arc swaps its ends (see `placeArc` in `line.ts`).
- `tangentArc`, in `line.ts`, and `endTangent`, `curveEndingAt`, in `app/snap.ts`, solve the
  end-of-curve cases.
- Solver: `drag` takes points only. To drag a whole curve pass all its points. For a circle rim set
  `r` and hold the centre. Don't make zero-length lines, or a distance dimension between coincident
  points. A failed component keeps its input geometry.
- Tools with a `draw` repaint on every mouse move. A tool without one repaints through `ctx.setHover`
  or `ctx.invalidate()`.
- `findProfiles` is slow: use `ctx.profiles()`, which caches per solve, not per frame.
- Status text goes through `ctx.status`, warnings through `ctx.message(text, 'warn')`, and `ctx.clearNote()` ends one.

## Layers

`ctx.hit` only returns the active layer, so a tool that picks through it needs nothing else. New
geometry lands on the active layer, and a commit stamps any constraint that spans layers. Three things
to know: a tool that walks from a pick, like a chain, filters with `ctx.editable(id)`; constraint tools
and Sketch Dimension see other layers too, and tell them apart with `ctx.foreign(hit)` and
`ctx.onActive(hit)`; never call `solveSketch` directly on the live sketch, go through `ctx.solver` or a
commit, which freeze what must not move. See SPEC section 9.

## Testing

`e2e/helpers.ts` drives real mouse and keyboard in sketch coordinates. `window.__sketch` is a
read-only handle for assertions: `design()`, `sketch()`, `analysis()`, `selection`, `tool`, `status`,
`inference()`, `appearance(id)`, `badges()`, `labels()`, `drawnPoints()`, `textOutlines(id, text)`,
`frames`, `dirty` (unsaved changes) and `highlight` (ids lit without being selected) and `minDistanceRuns` (how often the status bar's Min
Distance was worked out). For 3D mode: `frame` (the plane looked at), `scene` (the 3D camera, or null in plan), `swinging`,
`orbiting` (always in design mode, which is the Orbit view), `seen()` (what each other sketch shows here), `planeLines()` (the Other Planes lines drawn now) and `sceneToScreen(sketch, x, y)` (where a point is in the 3D view); wait
for `swinging` to be false after an arrow, `V`, Finish Sketch or a plane pick, as `e2e/fold.spec.ts` does (`u.landed()`). Picking a plane for
Create Sketch or Redefine Sketch Plane: `picking`, `pickHover` (the square lit), `planeSize` (the squares' size in mm) and
`planeToScreen(plane, x, y)` (where a point of an origin plane, in its coordinates, is in the 3D view). The ViewCube: `cube()` (where it
is on the page, what is lit, and each face shown with which way its label's right and up run on screen) and `cubeToScreen(name, at)` (a
page position that picks `top`, `front-right`, `top-front-right` and so on, through the cube's own projection; a face's at `(s, t)` of it),
as `e2e/viewcube.spec.ts` uses them. `u.newSketch(plane)` clicks Create
Sketch and then `u.pickPlane(plane)`, which clicks inside that square, 4/5 of the way along each side, where nothing is in front of it
from Home. Never change state through it.

The status bar's Min Distance reads the selection, not the tool, so a tool needs nothing to take part:
select two objects and it shows. (Measure is the one that reads its own two picks, through `ctx.measure`.) A tool that moves geometry should do it through `ctx.solver.drag` or a
commit, as always, and the readout follows.
