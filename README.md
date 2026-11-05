# Sketch

A 2D parametric CAD sketcher that runs in the browser. It follows the Fusion Sketch environment as documented in `reference/`: draw geometry, add constraints and dimensions, and a solver keeps the sketch consistent. Output goes to SVG, DXF and 1:1 print.

The app is TypeScript with no UI framework. The solver is Rust, compiled to WebAssembly. Designs are autosaved in the browser and can be saved to a file. There is no server. Sketches sit on planes in 3D, and a sketch plane can be folded about a line onto a new one, but there are no solids.

## Prerequisites

- Node.js and npm
- Rust, with the wasm target: `rustup target add wasm32-unknown-unknown`
- wasm-pack: `cargo install wasm-pack`

`wasm-opt` is not needed; `solver/Cargo.toml` turns it off.

## Running

```sh
npm install
npm run wasm     # builds the solver into src/solver/pkg/
npm run dev      # dev server, http://localhost:5173
```

`npm run wasm` has to run once before `npm run dev`, and again after any change under `solver/`.

## Building and testing

| Command | What it does |
|---|---|
| `npm run build` | wasm, then `tsc --noEmit`, then `vite build` into `dist/` |
| `npx vitest run` (`npm test`) | TypeScript unit tests |
| `cargo test --release` (in `solver/`) | Rust solver tests |
| `npx playwright test` (`npm run e2e`) | Browser tests in Chromium. Starts its own dev server. Run `npx playwright install chromium` once first |

With `E2E_PREVIEW=1` the browser tests run against `dist/` instead of the dev server. `E2E_PORT` picks the port.

## Features

- **Create:** line and arc chains, midpoint line, three rectangles, five circles, three arcs, three polygons, ellipse, five slots, fit point and control point splines, conic, point, text in a frame or on a path, Project, Mirror, rectangular and circular patterns.
- **Modify:** Fillet, Chamfer, Trim, Extend, Break, Scale, Offset (with Match Topology), Move/Copy (Free Move, or Point to Point from a start point to a snapped target on any layer; Set Pivot to turn about a chosen point), Blend Curve, Change Parameters.
- **Constraints:** Coincident, Horizontal/Vertical, Tangent, Equal, Parallel, Perpendicular, Fix/UnFix, Midpoint, Concentric, Collinear, Symmetry, Curvature. Inference adds them while drawing.
- **Dimensions:** linear, aligned, angular, radial, diameter, arc length, ellipse axis, tangent, Driven and driving, with expressions over parameters and other dimensions. User parameters can be mm, degrees, no unit or text, and `{name}` in text reads any of them.
- **AutoConstrain:** a local rules engine, not a cloud service.
- **Layers:** colour, hide, lock, order. Only the active layer is editable; other layers are templates that can be snapped to, and that constraints and dimensions can reference one way.
- **Several sketches** in a design, on the XY, YZ and ZX planes, or on planes folded from them.
- **3D mode:** select one straight line and press an arrow key: the camera swings a quarter turn over the line, the way the arrow points, and you carry on sketching on the new plane, in a new sketch or the one already there. The line comes in as a linked projection, so new lines join its ends, and the opposite arrow swings back. Only what lies in the plane you are on shows of the other sketches, and a cyan line across the view marks where each other sketch's plane meets yours: hover it to see which sketch, click it to swing round onto that sketch (Sketch Palette > Other Planes hides it). The Orbit view (`V`, or the button beside Home View) shows every sketch in 3D: drag to turn it, Home View for isometric, click a sketch to edit it, `V` or Esc to go back.
- **Export:** SVG in true millimetres with one group per layer, multi-layer DXF, and Print at 1:1 with tiling. None of it depends on the theme: true colours on white.
- **Editable SVG:** Save as SVG can carry the whole design in the file's `<metadata>`, and File > Open reads such an SVG back as a fully editable design, as it would a project file. "Include editable data" is ticked by default; untick it for a drawing with no data in it, which then has no metadata and none of the hidden layers or construction. A line in the dialog says what the file will carry, with counts (`Includes 2 hidden layers and 14 construction lines.`), and follows the options. The data is the whole design, hidden layers and construction geometry included, not only what is drawn, so anyone you send the file to can open and edit all of it: untick it to share the drawing alone. Only that embedded design is read: edits made to the SVG in another editor are not read back, an SVG without the data does not open (there is no import of other SVGs), and a program that writes its own SVG may drop the data. A truncated or altered file is reported and nothing is loaded.
- **Unsaved changes:** the design is dirty after any change since it was last saved, opened or started new. File > Open, File > New (and the + beside the name) and Recover Designs > Open then ask first, in the app's own dialog: Save, Don't Save or Cancel. A saved design asks nothing. A file that cannot be opened, for any reason and at any point, leaves the design and its Undo and Redo as they were.
- **Recover Designs:** an autosave that cannot be restored is kept, not overwritten: up to five copies, newest first, each with its time and size. File > Recover Designs... lists them with Open, Download (the raw text) and Delete, and a boot that put one aside says so with a button to it. With no room for a copy the original stays where it is and the app says so.
- **Measure:** Inspect > Measure, or `I`, reads the Min Distance between any two visible points or curves on any layer, locked ones included, without selecting them and without an Undo step. Hidden layers are never offered.
- **Min Distance:** select any two points or curves and the status bar reads `Min Distance: 12.34 mm`, in the design's units: the gap between a line and a circle, two points, an arc and an ellipse, a spline and a line. It measures the drawn shape, so a line is its segment and an arc only its sweep, and it is 0 where the two touch or cross. It follows a drag, Undo, Redo and a value changed in Change Parameters with the two still selected. Double-clicking a dimension to edit it moves the selection to the dimension, so the readout clears. It clears for any other number of objects.
- **Time to solve:** the status bar reads `Solve 3.2 ms` beside Under-Constrained, Constrained or Over-Constrained: how long the last solve of the open sketch took on the main thread, with one decimal under 100 ms and whole milliseconds from there. A constraint, a dimension or a value changed in Change Parameters counts as one request, however many tries the solver needed, and a refused one shows the time it took. During a drag it follows each step. It is empty in design mode, and Undo and Redo leave it as it was, since they solve nothing. On a narrow window it is the first thing to go, before the prompt and the coordinates give way, and Min Distance stays.
- **Dark Mode:** File > Theme, with System (the default, follows the OS and changes with it), Light and Dark. It covers the whole interface and the canvas. Fully constrained lines are near-white in Dark and every other status colour has a counterpart; a layer colour too dark to read on the dark canvas is drawn lighter, and stays as set in the data and the swatch. The choice is kept in this browser and is not part of the design.
- **Trackpad:** a two-finger drag pans, also in the middle of a tool, and a pinch zooms at the cursor. A mouse wheel zooms, as before. They arrive as the same `wheel` event, so the app tells them apart by the pattern of the events, and takes anything it cannot tell for a wheel.

The tools and how to add one are described in `docs/TOOLS.md`. `docs/SPEC.md` is the design, and `docs/AUDIT.md` is the claim-by-claim check against the reference.

## Keyboard

| Key | Action |
|---|---|
| L | Line |
| R | 2-Point Rectangle |
| C | Center Diameter Circle |
| P | Project |
| D | Sketch Dimension |
| T | Trim |
| O | Offset |
| M | Move/Copy |
| I | Measure |
| X | Normal/Construction |
| S | Toolbox |
| F6 | Fit (Look At); isometric Home in the Orbit view |
| Arrow keys | Fold the sketch plane about the selected line |
| V | Orbit view |
| Enter | Place typed values, or finish the tool |
| Esc | Cancel the current step, then leave the tool |
| Tab, Shift+Tab | Next or previous value field |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Shift+Z, Ctrl+Y | Redo |
| Cmd/Ctrl+A | Select all |
| Cmd/Ctrl+C, X, V | Copy, cut, paste |
| Delete, Backspace | Delete |
| Cmd/Ctrl+P | Print |
| Cmd/Ctrl+Enter | Finish |

Hold Cmd/Ctrl while moving to suppress snapping. Right-click opens the marking menu.

Navigation: mouse wheel zoom at the cursor, trackpad two-finger drag to pan, pinch to zoom, middle-button drag or Space+drag to pan, F6 to fit. In the Orbit view a left drag turns the view.

## Architecture

| Path | Contents |
|---|---|
| `src/model/` | The document: points, curves, constraints, dimensions, features, layers, parameters, history, sketch frames and folds (`frames.ts`), what one sketch sees of another (`seen.ts`). Plain data, no UI |
| `src/geom/` | Curve maths: intersection, minimum distance, fillet, trim, offset, splines, profiles, AutoConstrain rules |
| `src/solver/` | `bridge.ts` maps the document to the wasm solver and guards each solve; `seat.ts` is the pre-step for a new constraint |
| `solver/` | The Rust crate |
| `src/app/` | Application state, input, snapping, hit testing, view, the 3D camera (`camera.ts`) |
| `src/tools/` | One file per tool, built on `defineClickTool`, `defineConstraintTool` and `defineDialogTool`. `registry.ts` lists them |
| `src/render/` | Canvas 2D drawing, dimension and glyph layout, and the canvas palette read from `tokens.css` |
| `src/ui/` | Toolbar, palette, browser, layers panel, dialogs, HUD fields. `tokens.css` holds every colour, Light and Dark |
| `src/io/` | Project files, SVG (and the design embedded in it), DXF, print, text outlines, projection |

Every change goes through a commit: a tool mutates the document inside `ctx.commit`, the sketch re-solves, and the result becomes one undo step. Undo restores a snapshot.

## Solver

The solver is [`kcl-ezpz`](https://crates.io/crates/kcl-ezpz) 0.2.18, used as an unmodified dependency, with a mapping layer in `solver/src/`. ezpz is a sparse Gauss-Newton solver with a fixed Tikhonov term. It was chosen because it is small, compiles to wasm, and is fast enough for a live drag: on 500 curves a drag step takes about 2 ms in the native solver test and at most about 5 ms in the browser. Rows ezpz lacks, such as tangency with a contact point, ellipses and splines, are built from hidden helper points. `solver/src/lib.rs` documents each mapping.

A numeric solver takes the cheapest path, which for a large correction means a shorter line or a bigger circle. `src/solver/` deals with that:

- **Seat.** Before a new constraint is solved, one object is moved to where the constraint already holds. Of two objects the lighter gives way, whichever was picked first: a free curve before a joined one, a small body before a large one, anything before something pinned. First pick stays only between equals. In Equal the pick order says which one changes, as far as the sketch allows: a free circle takes the change from a joined arc whichever came first, and two arcs in a tangent chain both move, with a note. A curve with nothing attached moves rigidly, and a whole body moves rigidly in preference to a change of shape. Only when nothing rigid will do does a joined curve give way some other way: an arc moves its centre. Candidates are tried with the real solver. One that leaves the rest alone wins. Otherwise the choice is across the whole sketch: how far anything went, and how far any length or radius changed. Between two bodies the first pick stays. Within one body there is no rigid move to make, so it is let go if that takes less than 0.4 of the travel. A sweep changed by more than 60 degrees or a free line left with under half its length is a failed candidate, taken only if nothing else meets the constraint, and then a note says so.
- **Guards.** After any solve, a line, radius or axis that collapsed, a point thrown out of the sketch, or an offset that could no longer be regenerated, puts the sketch back and says why. So does a jump onto another branch of the same geometry: an arc whose sweep changes by more than a quarter turn in one solve or closes on itself, or a closed loop that turns over or goes flat. A loop means every bounded face of the lines and arcs, so two loops sharing an edge are each guarded, and its side is the true area of its outline, arcs and all. An outline that was simple and comes to run through itself is a failed answer too. That is the only limit on a shape: what can be reached by continuous steps is allowed. A solve that fails leaves the sketch as it came in.
- **Bodies.** One rule, for values and constraints alike. Anything joined to the rest of the sketch at one point and tied to it by nothing else is a body, whatever is in it: a line, a tail with dimensions of its own, an arc, a loop, a triangle. These are found from the graph of constraints, dimensions, expressions and coincidences, not from curve types. A commit solves the rest without the body and then carries it with its joint, keeping its shape and orientation. If it has an unmet row of its own, something fixed, projected or locked in it, or any tie to the rest, it is not a body: it stays in the solve and the lighter side gives way.
- **Shapes on several points.** A shape joined at two or more points that all moved by one vector translates whole by that vector. Otherwise its line lengths are held where a solution exists.
- **Walls of a closed profile.** On a value edit, a line of a closed profile stays on the line it is on and gives up its length, if that moves the sketch less than keeping the length would. A keyway's walls lengthen when the radius grows: the key does not slide.
- **Last check.** After every commit, whatever path it took, every constraint and dimension is checked against the geometry. A result that says OK with a row unmet gets the plain solve, or goes back and shows red.

A new value on a line with one end free moves that end and nothing else. Otherwise it is first solved straight there, preferring to hold every radius, line length and arc sweep the constraints leave free, so a radius scales its arc. Where that cannot meet the value, the shape gives way along a walk of steps, each solved from the last, so an arc can go past a half turn if that is where the value leads, and a fully constrained sketch takes the root continuous with where it was. If that stops, the dimension's ends are tried going alone, then one end anchored while the rest follow by steps, and if nothing reaches the value the sketch stays as it was and says so. A dimension between a spline's ends moves the ends and leaves its interior points where they are, and a point riding on the spline goes with the curve. Going back to a value the sketch has already been at, with nothing else changed since, restores that state exactly, and a value within 1% of one starts from that state. A state is checked before it is restored: fixed, projected and locked geometry must be where it is now, and every row must hold at the values it was visited at; otherwise the value is solved like any other. Undo and Redo bring back the snapshot as it was, and nothing solves it again.

## Limitations

- **Solutions are local.** Gauss-Newton finds a nearby solution, not a chosen one. Where a seat cannot satisfy a constraint outright, and holding free values still cannot, the rest of the correction spreads over whatever is free. Jumps are guarded for arcs and for closed loops of lines and arcs, not for splines, conics, ellipses or an open chain of lines folding back on itself. A spline in a closed outline that folds through the outline gets a note; one that folds on its own in an open chain gets nothing. A closed loop that was already flat when the edit began has no side to keep.
- **Free values hold on a commit, not in a drag.** A dimension or constraint leaves radii, semi-axes, free line lengths and arc sweeps alone where it can, as a preference, and they give way where the constraints will not let them stay. Where sizes cannot all stay, as with two tangent circles whose centres are dimensioned apart, the first keeps its size and the next takes the change, and a note says a radius changed; past 32 sizes none is kept. Line lengths that give way, such as a rectangle's diagonal, are not reported. A drag still shares its correction and has no branch guard: a radius moves by under 0.0001 mm in a 25 mm drag of 30 mouse events, and by 0.04 mm in a 565 mm one.
- **A free value that gave way stays given way.** A triangle side stretched past its neighbour pulls the third side out, and that length is then the free value to hold. Only a return to or near a value already visited, with nothing changed between, restores the old shape: the same edits with another change among them keep the new length. A polygon or slot held only by a horizontal dimension turns to meet a smaller value and keeps its own size, for the same reason, and past a point the value is refused.
- **A closed loop can go thin. It does not go over, and it says if it crosses itself.** A triangle held by its free length may go thin on its way to a value. A simple outline does not turn over on any route: it may not go flat, so the value is met some other way or refused. An outline that would run through itself is tried every other way first, undimensioned lines giving way, with a note if they do. If every answer it tries crosses, it is applied with a note saying the outline now crosses itself. A simple shape can still exist that it did not find, so that note can overstate. That is judged on commits, not in a drag. An outline that already crosses is not guarded at all: edits on it go through, with a note while it stays crossed, and an edit can bring it back, possibly the other way round. A forced move that turns a closed shape over, such as a corner made coincident with a fixed point across the base, stands with a note. Under extreme swings a value that could be met is sometimes refused all the same (about 1 edit in 670 at x0.05 to x20, none in 4,000 at x0.7 to x1.6), and the note says no way was found.
- **A point on a curve has no position of its own to hold.** When the curve moves the point goes to the nearest place on it, and a line ending there changes length.
- **Arc points follow the full circle.** A point on an arc is on the circle, not on the sweep.
- **G2 needs something to steer at that end.** Fit and control splines reach G2 with lines, arcs, circles, ellipses, other fit or control splines and the end of a conic. Measured at the joint with the app's own curve maths, this side against that side: fit and arc 0.0333333 against 0.0333333 (1/30), the same after the radius goes to 40 (0.0250000 each) and through a drag of a fit point, fit and fit 0.0287185 each, fit and control 0.0237037 each, control and fit 0.0346832 each, fit and ellipse 0.0093750 each, fit and conic 0.0166667 each, fit and line with a handle 0 each. A fit spline steers with the handle at that end, which Tangent and Curvature activate, and a natural end with no handle has zero curvature for good: it is G2 with a line and stays tangent with anything curved. No fit point moves when the handle's length can do it, between 1/8 and 3/4 of the first chord. Otherwise the next fit point moves off the tangent, by as much as it takes, up to a chord per solve round. A conic never steers, so a conic with a line, an arc or another conic stays at G1, and so does a closed fit spline. A handle dragged at a G2 end goes to the cursor and the next fit point carries the curvature; with that point pinned the handle stays, and so does the joint. A handle cannot turn off the tangent unless the other curve can turn with it. Every G2 steered to a target is checked on the real curve after the solve, so a G2 that nothing can reach, or that the solve did not finish reaching, is reported and the geometry stays as it was. A file saved with a fit spline at G1 against something curved has its handle already: it reaches G2 as it opens, with a note naming the sketch. The design is then unsaved, and the new shape is where Undo stops.
- **A point on a spline rides first, and pulls only where it must.** It slides along the curve and follows it, and the spline ignores it, as long as that leaves every row met. Dragging the point itself, a drag that stops short, or a row that riding leaves unmet, such as a fixed point or a value the curve cannot meet where it is, moves the spline: to the cursor to within 1e-4 mm, and on the curve to within 1e-3 mm, over 30 steps of a 15 mm drag. Once it rides again on the commit it sits on the chords between the spline's samples, 0.005 mm off the curve in the one measured. A value the point can meet by sliding on the curve moves only the point, however far along the curve that is. A value that cannot be met that way tries the spline's ends first and leaves its interior points where they are, unless that sends the ends more than three times as far as letting the interior move. A drag moves the nearest points, ends or not: up to four on a fit spline and one span on a control spline. A fixed spline and a conic do not move, and the point only slides. A Fix on a point on a spline counts against the spline's freedom. Tangent on a fit spline end with no active handle is still one-way: the end has no variable for its direction, and the tools activate a handle whenever a curve touches that end.
- **Tangency to a spline is at an end only.**
- **Failed components keep their input geometry.** A conflict in one part never moves another part, but what is in conflict stays where it was. A constraint with no solution that keeps a shape is refused and says why; one that conflicts with what is already there and breaks no shape is applied and shown in red. Those are two behaviours for one kind of problem.
- **Ellipses are constrained by their axis points**, which costs several hidden variables per point on the ellipse.
- **Min Distance reads two objects: the selection, or the two Measure picks.** Selection is on the active layer only, so two selected objects are always from it; Measure is how to read a gap to another layer. Text, a dimension and a constraint glyph have no readout: two selected with one of those in them show none, and Measure does not offer text. Lines, arcs, circles, points and the origin are exact; ellipses, splines and conics are found by search. Together they agreed with a brute-force check to 1e-13 mm or better on 5,850 random pairs. A search is not a proof: it starts from at most 128 places, so two curves with more separate near approaches than that could be read a little long. It is the straight-line gap between the shapes, not a gap round or through anything.
- **Planes, not solids.** Each sketch is 2D on its own plane. Extrude, bodies, 3D sketches, Slice and a 3D solver are out of scope, and nothing links planes but linked projections. Project takes geometry that lies in the sketch's plane: everything from a sketch on the same plane, and the lines where another plane meets it. The views are orthographic only. SVG, DXF and Print stay in each sketch's own coordinates.
- **Text** uses the bundled Inter, JetBrains Mono and Zilla Slab. There are no single line (SHX) fonts.
- Tested in Chromium only. A pinch is read from `wheel` events with `ctrlKey` (Chrome, Edge, Firefox); Safari's gesture events are not handled.
