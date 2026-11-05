# Audit of the sketcher against the Fusion Sketch reference

Final audit by agent `final`, 31 Oct 2026, then updated by the fix round of the same day. Audited build: `dist/` of 31 Oct 02:13, newer than all of `src/`. Served on port 5701, driven in headless Chromium by real mouse and keyboard. The previous fix reports were not read. "Fixed" below means I watched it work.

## 1. Result summary

Updated after the fix round of the same day: a row changed only where the fix was watched working, the rest stand as audited. An independent check then found 3 P1 and 5 P2 in that build, closed in section 2 with the check's P3s. Three rechecks followed, closed there too, the last with one harness run on every build. No P1 or P2 is open. The wall outlet tutorial completes again. Of the 207 rows that failed or went untested in the first audit, 175 are fixed and seen working, and 15 are accepted by ruling. The other 5 Fixed rows were Match in the first audit: 4 regressed in the wall outlet tutorial, and C006 failed as soon as the pointer really paused. The owner's additions (layers, cross-layer constraints, SVG, DXF, Print 1:1) passed, and the four notes against them are closed.

| Verdict | First audit | Final |
|---|---:|---:|
| Match | 661 | 836 |
| of which Fixed, seen working this run | | 180 |
| of which Match, re-tested | | 347 |
| of which Match, carried from first audit, not re-tested | | 309 |
| Accepted (triage ruling) | | 15 |
| Partial | 115 | 11 |
| Wrong | 45 | 0 |
| Missing | 39 | 1 |
| Untested | 8 | 5 |
| N/A-3D | 56 | 56 |
| No claim | 10 | 10 |
| **Rows** | **934** | **934** |

- All 207 non-Match rows re-tested through the UI, plus every finding (section 5a).
- Match sample: 348 of 661 rows (53%), weighted to modify and constraints. 4 of the sampled rows had regressed, all in the wall outlet tutorial; they are fixed.
- Tutorials: T1 gear, T2 fork and T3 bracket complete with no Project step. T3 also passes in the free-line-first order that used to wreck it. T4 wall outlet completes at DOF 0 with radii 17 and 17, on the audit's geometry, at five bulge depths and in both arc pick orders (`e2e/fix-final.spec.ts`).
- Root-cause adversarial run: Parallel and Perpendicular on large rotations in both orders, Concentric on free arcs and ellipses, Tangent on circles, contradictions and collapse attempts all behaved. Length and size kept, and refusals are explained. A seat now also has to leave everything outside the curve alone; candidates are chosen by what the real solve does to the rest of the sketch (`src/solver/seat.test.ts`, "a seat leaves other geometry alone").
- A 4 minute soak gave 547 operations and 0 zero-length lines (19 in the first soak). Its two loose ends are both the soak's own doing, see section 6.
- No console error or page error in any run.

## 2. Open issues

No P1 or P2.

### P3

| Id | Source | Issue | Why it stays |
|---|---|---|---|
| CHK-P3-5 | Check round | A double-click where another layer's dimension is does nothing and says nothing. | Not a defect: SPEC says only the active layer shows dimensions, so nothing is there to double-click. No change. |
| OPEN-13 | C-F20, C324, W620 | Project sees what lies in the sketch's plane only: everything from a sketch on the same plane, and since 3D mode the lines of a sketch on another plane that lie in this one (where the planes meet), with its points on it. Geometry off the plane is not flattened onto it. | Flattening would need a projection direction and a link that survives the source moving off and on the plane. Folding about a line brings that line in linked, which is the case 3D mode needs. |
| OPEN-16 | C-F32, C103 | Ellipse axis value is the semi-axis. | The page does not say which. Centre to end matches the cursor and the dimension. |
| OPEN-17 | C-F36, C270 | No single line SHX fonts. | Needs stroke font data the project does not have, and open contours through layout, hit testing, DXF and SVG. Disproportionate. |
| OPEN-18 | C-F39, C292 | Exploded text stays fixed until UnFix. | The page says both. Kept fixed, with a note that says so. A referenced text parameter now survives Explode, as its Note requires. |
| OPEN-19 | M373 | Point to point coincident has no badge. | The page image and GUID-685B9D79 disagree. The Equal badge half (M390) is fixed. |
| OPEN-21 | M480 | No AutoConstrain settings beyond the slider. | Triage ruling on AutoConstrain. The named undo half (M471) is fixed. |
| OPEN-22 | M-F36, M531 | Add User Parameter is an inline row, not a dialog. | The row has the same fields, and the existing tests are written against it. |
| OPEN-23 | M535 | Bad expressions report correctly; what the video calls a problem depends on narration. | No audio or transcript to check against. |
| OPEN-25 | W674 | Look At is a fit. | Nothing to rotate in 2D. The other three rows (W669, W687, W729) are fixed. |
| OPEN-27 | W-P3-15, W742 | Polygon shows construction circle and glyphs. | C097 says the result shows them; only the video is clean. |
| OPEN-28 | W770 | Near the Y axis a circle centre snaps before the tutorial's H/V step. | The same page's tip asks for snapping. Cmd/Ctrl suppresses it. |
| OPEN-33 | CHK-P3-1 | A conflict is refused where it would break a shape, and applied in red where it would not: Perpendicular and Horizontal on the same fixed line behave differently. | The wording is now true for both. One behaviour would need a ruling on which, and red is what the over-constraint tests pin. |
| OPEN-34 | CHK-P3-3 | A click on an arc at a tangent contact with a circle may pick the circle. | Seen once by the check, and its log was overwritten. Not reproduced, so not changed. |
| OPEN-35 | CHK-P3-7 | A polygon held only by a horizontal dimension keeps its edge at 331 when set to 3.31, and turns to meet it. | Turning is a true solution with the free length held. A return to a value visited with nothing changed between is exact. |
| OPEN-36 | Check round | A free value that gave way stays given way: only an exact return along a run of value edits restores the old shape, and a triangle can go thin, though not over. | The trail is exact only along an unbroken run. Anything wider needs a stored rest shape. README Limitations. |
| OPEN-37 | Check round | Jumps are guarded for arcs and closed loops only, not splines, conics, ellipses or an open chain of lines folding on itself, and not in a drag. A spline can fold if its ends are brought close: width 80 to 40 on a spline-topped rectangle gives a 172 degree turn. A closed outline that crosses itself now gets a note. An open chain that folds gets nothing. | By ruling: what is reached continuously stands. A drag has a cursor to follow. |
| OPEN-38 | Recheck P3-4 | A refusal's reason can depend on pick order: Tangent on an S-curve with an inferred Parallel says "would collapse" one way, "no way was found to keep that arc" the other. Refusal is right; the first reason is not the cause. | Doubtful, by the recheck's own account. Which of several failures to name needs a ruling. |
| OPEN-39 | Recheck P3-5 | Equal on two arcs of a tangent chain changes both, with the note. A circle takes the change from a joined, slot or pattern arc whichever came first. | Holding one by pick order means a pick-aware hold in the solver, not a small change. README says what happens. |
| OPEN-40 | Recheck P3-7 | Undo after opening a hand-edited file whose values do not match its geometry reaches a state never shown. | Doubtful, not a normal path. |
| OPEN-42 | Recheck rounds | In seeded random runs through the bridge on the final build, 6 of 4,000 edits at x0.05 to x20 on triangles and quads were refused though a solution existed, on shapes earlier edits had squeezed nearly flat. At x0.7 to x1.6, 0 of 4,000. No simple outline turned over; 20 and 2 changes of side came on outlines already crossed, which nothing guards. The count before the sixth recheck round stopped a run at its first flip, so it is not comparable: on the same build that count reads 11 refused of 3,974. Radius edits: 5 of 2,400 refused, none false: 3 true collapses and 2 solver failures past 50 m. | The sketch stays as it was and the note says no way was found, which is true. These come from the loop guard, which the rulings keep. |
| OPEN-43 | Third recheck | Selection persists on objects that have been hidden. | Ruled to stay open. Not changed. |
| OPEN-52 | Round 5 | Hook order 11. | P3. Mostly a harness artefact: the R3 label was never placed. The build after applies Concentric with a note where the one before refused. Left. |
| OPEN-54 | Fifth recheck P3-5 | Rack length 96 to 48 folds teeth under the rim with no proper crossing: u1 goes (32, 20) to (42.7, 18.5), and no note says so. | Not cheap: the outline touches itself but does not cross. Left. |
| OPEN-56 | Eighth recheck | Curvature on a spline and arc whose ends touch but aren't joined leaves the ends 28.8 mm apart with the row reported met (needs snapping suppressed). | Open. |
| OPEN-57 | Eighth recheck | Curvature between a fit spline and a trimmed elliptical arc ignores the second pick silently. | Open. |
| OPEN-55 | Sixth recheck P3-5 | "Nothing else would meet that" is sometimes untrue, and a crossing was taken where a simple shape exists: quad A=35.1, B=274; notch B=22; hat T=70. All three were the same on the build before. | The note means every answer tried crossed, not that none exists. Left. |
| OPEN-53 | Fifth recheck P3-4 | A plate with no size dimensions drifts on a fillet radius edit. | No ruling needs it. Left. |
| OPEN-44 | Third recheck | A link to a locked layer stays red after Unlock. | Ruled to stay open. Not changed. |
| OPEN-45 | Fourth recheck F9 | A cam can end fully constrained on the wrong tangent branch: fr 15.59 against 36.37, nose sweep 262 against 120, on 4 of 22 orders. | Keeping a Tangent's side of the line and lowering the sweep limit for unnamed arcs was tried, and moved cam orders from 4 wrong to between 2 and 6 with new refusals. Not a contained change. The repro is `orders.mjs cam`, order 1: hv, tangent(fl, base), tangent(fl, nose), tangent(fr, nose), tangent(fr, base), then Fix base centre at the origin. |
| OPEN-46 | Fourth recheck S8 | Tails stay unrotated on a turning lever. | Ruled to stay. |
| OPEN-47 | Fourth recheck S8 | A drag stretches what a commit would carry. | Ruled to stay. |
| OPEN-48 | Fourth recheck S8 | H/V of two points ignores weight. | Ruled to stay. |
| OPEN-49 | Fourth recheck S8 | An arc slot's width note. | Ruled to stay. |
| OPEN-50 | Fourth recheck S8 | Inference near a quadrant. | Ruled to stay. |
| OPEN-51 | Fourth recheck S8 | A drag on a cam shares the move. | Ruled to stay. |
| OPEN-41 | Recheck P3-8 | A chain of 250 to 500 lines with unmet joins took 4 to 36 s to commit. | Doubtful: from a test file. A properly joined chain of 500 commits in under 0.3 s. |

### Closed in the fix round

Each has a regression test in `e2e/fix-final.spec.ts`, `e2e/fix-final-2.spec.ts`, `src/solver/seat.test.ts`, `src/geom/offset.test.ts`, `src/io/svg.test.ts`, `src/io/dxf.test.ts`, `solver/tests/free_values.rs`, `e2e/free-values.spec.ts` or `e2e/pause.spec.ts`. What was seen with the fix taken out:

- `e2e/fix-final.spec.ts` and `e2e/fix-final-2.spec.ts`: 44 of 45 fail. "typed past the limit with the box ticked" passes, because a second layer catches it.
- `solver/tests/free_values.rs` and `e2e/free-values.spec.ts` (OPEN-32), run before the fix went in: 11 of 13 and 3 of 3 fail. "what the constraints set still changes" and "a drag is left to the minimum-norm step" pass, as they should: they pin what the fix must not touch.
- The round's 48 unit tests, on the finished solver, in a scratch copy, one fix out at a time: 42 fail with one fix out.
- `e2e/pause.spec.ts` (PAUSE-1), run on the build before the fix: 41 of 114 fail, 19 each at 700 and 2000 ms and 3 of the 6 that pin the boxes which should still take a click. At 0 ms the workflows all pass, which is why this went unseen. Every press in the other specs came straight after the move: with a 700 ms pause before each press of `SketchUser.click`, `drag` and `doubleClick`, 87 of their 403 tests failed on that build and 2 failed in the fix round, both on the Slot width, which the owner has since ruled should place on a pause like every other click. Slot width was then added to `e2e/pause.spec.ts` at every wait: 6 of its 9 cases (700 and 2000 ms, three slots) failed with the exception still in, 0 ms passed, and all pass with `takesRest` removed.
- Two need two out. "moves the end legs, not the far end of the spline" and "moves the end legs of a longer spline on a slanted line" pass with OPEN-5's legs alone taken out, because the least disturbing seat is then the plain solve. They fail with the choice of seat out as well.
- Four pass with every seat fix out, so they prove nothing about a fix and stand as controls: "collinear with an anchored rectangle's edge stretches it no more than it must", "midpoint brings a free point to a joined line and leaves the line", "parallel between a rectangle's top and side is a contradiction and moves nothing", and "tangent where a hand-made corner arc meets its line recentres the arc and leaves both lines". The contradiction pins the solver's own rule that a failed component keeps its geometry, and in the corner arc test the dimensions leave the arc's centre as the only thing free. The midpoint and corner arc tests now each have a sibling that does fail: "midpoint on a free end with nothing held still leaves the rectangle" and "with lines free to move a corner arc still recentres, and neither line does". The anchored collinear has none.
- Strengthened so that they fail with the fix out: "rim to line holds a gap" and "rim to rim holds a gap", which stopped failing once OPEN-32 held the radii and now also check that the other side stays, and "a closed loop offset by exactly half its height has nothing left", which now includes a slot, the only shape found that reaches the fix (14,512 rectangle and polygon offsets did not).

| Id | Was | Now |
|---|---|---|
| OPEN-1 | Concentric on joined arcs dragged the rectangle shut; T4 failed | Joined arcs move the centre, ends stay. Same rule for every seat |
| OPEN-2 | Match Topology over the limit built zero-length lines | Clamped short of the limit, shown in the field, dimension and status. Regeneration goes through the guard |
| OPEN-3 | {Text1_text} printed literally | Referenced, and a Text unit for user parameters |
| OPEN-4 | Default fillet landed on the far side | Comes down until it is on the picks' side |
| OPEN-5 | Curvature swung the whole control spline | First legs move, far end stays |
| OPEN-6 | Dragging a held end onto an axis gave a false Over-Constrained | A snap counts only if the point got there |
| OPEN-7 | Stale layer notes | Any layer change clears them |
| OPEN-8 | Mirror Line and pattern Center ignored other layers silently | A message names the layer |
| OPEN-9 | SVG dropped centerlines, DXF kept them | Both keep them, with a Centerlines option, ticked |
| OPEN-10 | Esc left a browser right-click menu open | Esc closes it |
| OPEN-11 | Text and height undid as two steps | One step per Change Parameters |
| OPEN-12 | Parallel with a polygon edge second turned the first line | The polygon turns as a body |
| OPEN-14 | No spline manipulators from Move/Copy | Shown and hidden by a spline point, and they drag |
| OPEN-15 | Spline Degree a select only; no Setup Curvature Display | Two icons ahead of the list; a dialog |
| OPEN-20 | Tangent to a spline not touching refused silently | Says why |
| OPEN-24 | Offset glyph on the output only | On both |
| OPEN-26 | Export location always the download | Choose Location where the browser allows it |
| OPEN-29 | No + design tab | A + beside the name |
| OPEN-30 | A 500 mm line needed a zoom out first | The view fits to what lands off the canvas |
| OPEN-31 | A rim on an axis kept a point | No point, no badge |
| Stale prompt | The prompt at the cursor stayed after Esc until the mouse moved | Goes with the tool, on every tool; a step's prompt updates at once |
| OPEN-32 | A dimension on one edge changed values nothing tied to it: the radius of a circle with a rim point on the diagonal (9.898165 to 9.987659, 24.2 at ten times the width), an arc, the rectangle's height | A solve that is not a drag holds what the constraints leave free: radii and semi-axes, then everything outside the rows the edit needs, then line lengths. A drag is as it was |
| PAUSE-1 | C006 was marked Match from drags that pressed at once. Rest 600 ms and a press on a value box under the pointer went to the box: no arc from a Line end, and a lost click in 3-Point and Tangent Arc, Ellipse, Midpoint Line and any shape small enough to sit on its own boxes. A box that stayed put needed that same rest once the pointer came to it in small steps | A pause no longer changes what a press does. A box that follows the cursor or appeared under it leaves the press to the tool; one that stays put takes a click on arrival. The Slot width had been kept as an exception (`takesRest`); the owner ruled it out, so it and the rest timer are gone and the Slot widths are in `e2e/pause.spec.ts` at 0, 700 and 2000 ms |

### Closed in the check round

An independent check of the final build, 31 Oct 2026, found 3 P1, 5 P2 and 9 P3, all with every test passing. Each row below has its tests in `e2e/keep-shape.spec.ts`, with the variations (pick order, sizes, positions) that make them a class. Run against the build the check used, before any fix: 89 of the 123 tests fail, across every row below except the two marked as found here. The 34 that pass are controls and stand as such: the same cases with the heavy object first, or a press where a drag was the fault, which were right already. `solver/tests/branches.rs` has 6 more on the solver's side; they use `Input::branches`, which that build does not have.

| Id | Was | Cause | Now |
|---|---|---|---|
| CHK-P1-1 | Concentric, free circle then joined arc: the arc went from r 40.13, sweep 122 degrees to r 83.82, sweep 309 degrees, and its lines changed, with no message | The first pick was held, so the seat that moved the free circle lost a penalty to the one that recentred the arc. Nothing judged the arc's own shape | The lighter object gives way whichever came first. Rigid seats and whole bodies are tried before a reshape. A seat that sends an arc the long way round is turned down. Pinned on both sides, it is refused and says so |
| CHK-P1-2 | A radius 10x up looped the next arc (3.3 to 300.7 degrees), and the original value was then refused as "would collapse a line" | Only radii were held, so line lengths and arc chords drifted, and the solver landed on the nearest root, loop or not | Free line lengths and arc chords are held too. A solution that crosses a branch is turned down. Values are walked in steps where the direct solve fails. The original value returns the original state exactly |
| CHK-P1-3 | Coincident or Midpoint with a free line first resized the rectangle (44 x 32 to 143 x 65, 160 x 54.5). A filleted rectangle and a slot stretched the same way | Coincident between two points had no seat at all, and `merge_points` takes the first listed position. Midpoint held the free line, as for Concentric | Coincident has seats, in a world without the new constraint, which is what the two points being apart needs. Every pick that moves a joined body has whole-body seats |
| CHK-P2-1 | Coincident from a line end to a slot centre or arc end: refused as "would collapse", 12 of 12 | The same merge pulled the slot apart, and the guard reported the wreck as the reason | Applied, the line moves. The message is no longer reachable from this path |
| CHK-P2-2 | Slot length 230 took a free slot radius from 6.32 to 185.17, and it stayed | The Concentric step before it had already crushed the slot (24.04 to 2.75), and the value edit held radii alone, giving one up in a single jump | Concentric moves the slot whole. Free spans are held, and a value that loses one is walked. Slot and circle radii stay at every slot length, and the circle slides along its tangent line. In the report's sequence the Concentric step itself cannot keep every size, as a rigid slot and polygon leave the tangent chain too short: the free circle takes the change, with a note |
| CHK-P2-3 | Undo landed 370 mm from the recorded state, and gave slot length 9.00 for 8.77 | Undo restored the snapshot, then the first look at the status line solved it, and that solve seated a satisfied tangent to the other side | A restored sketch is analysed without being written to, until something changes it. Seats go only to what the solver's own rows report unmet |
| CHK-P2-4 | Free line lengths lost: Horizontal 29.01 to 15.89, Collinear 31.6 to 66.8, Parallel 31.5 to 20.7, radius 10x 1.88 to 463.72, Symmetry 31.2 to 2.1 | The seated line was not in Horizontal's keep list. What hung off a moved point stretched. Symmetry had no seat, and an arc's mirror pairing by nearest end asked for the complement | Tails go with the point they hang from. Symmetry seats. An arc always pairs start to end |
| CHK-P2-5 | A triangle flipped through a run of 10x edits, area 1958 to -22 | Closed loops were not guarded, and extending a side shared the move between its ends, dragging the third corner across | Loops are guarded. Where steps stall, one end goes out along the dimension alone. At or within 1% of a value already visited, the sketch starts from that state, so back at the start values the start shape returns |
| CHK-P3-1 | Perpendicular on a fixed line and a held one said "would collapse" | The refusal named the symptom | Leads with the conflict: "it conflicts with the sketch as it stands:" and then what meeting it would do |
| CHK-P3-2 | A Mirror window started within pick range of a curve did not start | A press on a curve was never a window | A drag makes it a window, a press with no drag is still a pick |
| CHK-P3-4 | Look At left a dimension under the ribbon | The fit was to geometry only | Dimension labels are in the fit |
| CHK-P3-6 | Symmetry ignored an unlike second pick in silence | No refuse handler | Says to pick another of the same kind |
| CHK-P3-8 | Two panels named CREATE on the SOLID tab during a sketch | Both came from the same builder | The one that holds Create Sketch is named SKETCH there |
| CHK-P3-9 | Dark toolbox hints at 4.35:1 | `--ink-3` in Dark | 4.5:1 or better |
| Failed solves | Found while fixing CHK-P1-1: a failed Concentric still moved a pinned arc's centre, as merged points are set before the solve | `merge_points` writes to the variable whether the solve works or not | A failed commit leaves the geometry as it came in, as the README says |
| Forced radii | Two tangent circles with a dimensioned gap changed a radius in silence, which is intended but was not said | Nothing reported it | It still changes, and the README still says so. A note says the constraints changed a radius. This applies to a constraint too: such a commit is applied with the note, not refused |

Tests changed because a finding contradicts them, with the assertion strengthened, not dropped:

- `src/solver/seat.test.ts`, "perpendicular in the middle of a joined chain keeps the far end of the chain where it is", now "... carries the free rest of the chain whole". It pinned the last line stretching while its free end stayed. CHK-P2-4 reports exactly that, on Parallel. It now pins that line's length and that it did not turn.
- `src/solver/seat.test.ts`, "horizontal on a line in a chain turns it and takes the neighbour's end with it, no further", now "... takes the neighbour with it, whole", for the same reason.
- `e2e/fix-final.spec.ts`, "OPEN-1: Concentric between a joined arc and a free circle leaves the rectangle in the app too". The last line pinned the arc's centre going to a free circle picked first, which is CHK-P1-1's rule the wrong way round. The rectangle assertions stand; the arc keeps its centre and the circle comes to it.

"a joined arc keeps its ends when it goes concentric with a free circle picked first" and its neighbours in `seat.test.ts` are unchanged and pass: they hold the circle explicitly, which the tool no longer does for a lighter pick, so they now pin what a caller's hold means.

### Closed in the recheck round

The sweep limit, the spline guard and spline leg holds below were overturned by the next section, which says why; their findings stay closed by other means. An independent recheck of the check round's build found 3 P1, 4 P2 and 8 P3. Two of the P1s and one P2 came from the machinery added in that round, and the rest were the old findings holding on the recorded case and failing on a neighbouring one. The tests are the `CHK2-` groups of `e2e/keep-shape.spec.ts`, and `solver/tests/branches.rs`. Run against the frozen build the recheck used: 84 of the 110 fail, in every row but the last two, which were found here and are covered through the Curvature tests; the other 26 are the same cases where that build was already right. 4 more tests guard a fault this round introduced and fixed, that a horizontal value turned a line, and pass on that build as they should. Random runs through the real bridge, not in the suite: 400 triangles and quads, 4,000 value edits at x0.05 to x20, none turned over; 300 arcs with lines joined by corners and tangents, 2,400 radius edits, none past its limit.

| Id | Was | Cause | Now |
|---|---|---|---|
| CHK2-P1-A | Going back to a visited value moved fixed geometry 25.83 mm, and 30.00 mm on a rectangle | The trail compared a list of what could change, which left out `fixed`, and trusted what it restored | The key is the sketch with values and positions taken out, so nothing has to be remembered to be listed. A state is also checked before it is restored: fixed, projected and locked points must be where they are now, and every row must hold at the values it was visited at |
| CHK2-P1-B | A radius took an arc to 236.5 and 307.7 degrees, and one that began at 185 to 313.9 | Not the half-turn test alone, as guessed. An arc's chord was what got held, so a radius had to change the sweep, and the limit was measured per solve, so a walk went round in steps. `free_spans` also dropped anything with an end outside the component | An arc's sweep is what is held: a radius scales it and what follows moves whole. The limit is from where the commit began, the larger of that and a half turn |
| CHK2-P1-C | A line dimension sent a Blend point to (304,-351), a spline joint 691 mm, and a 40 mm line to 697 | Nothing guarded a spline or held its shape, and a line with a free end shared the edit between its ends | A line with one free end moves that end alone. Spline legs and turns are held. A spline folding more than 90 degrees at a leg is turned down, and refused if nothing else is left. Conics likewise |
| CHK2-P2-A | Line 2 went 44.72 to 68.01 on a dimension on line 1, with `kept` reporting true | A far end in no row is in no component, so `free_spans` skipped its line. The same for X and Y parted by horizontal and vertical rows | On a commit a shape joins all it touches. A far end is first tried where it is, then with its joint. Pinned, the neighbour gives way, as it should. A drag keeps the small components |
| CHK2-P2-B | A triangle went 3000 to -2422.7 by a route that did not end on the start values | A loop thinner than the flat threshold had no side, so it could come back either way | A loop with a side may not enter the band where it has none, so it keeps that side on every route. In 4,000 random edits on 400 triangles and quads, none turned over |
| CHK2-P2-C | Geometry on another layer took the trail away: arc 40.5 to 8.6 degrees, triangle area 1958 to 5962 | `solveCommit` built a trail only without `opts.freeze`, and a template layer always sets it | The trail runs regardless, and locked points are checked with the fixed ones |
| CHK2-P2-D | Fillet on an offset's source dropped the offset silently | Deliberate since the first build: `detachFromFeatures` severs a feature rather than undoing the edit. SKT-OFFSET gives deleting the glyph as the way to break the link and says nothing of Fillet | Keeping the link across a change of topology is not a small change, so it still goes. A note now says so, for offsets and patterns. Undo brings it back |
| CHK2-P3-1 | A refusal stayed up after the next good edit | Notes cleared only on a timer | A commit clears the last note first |
| CHK2-P3-2 | Redo lost the red on dimensions, 3 unsatisfied to 1 | The restored analysis asked which rows the geometry breaks, not which conflict | It reports what a solve would, without writing |
| CHK2-P3-3 | A 3-point or tangent arc with its centre off the canvas changed the view mid-chain | `keepInView` counted the arc's centre as a point drawn | Arc centres do not count. A long line still brings the view out |
| Fixed rows | Curvature on a fit spline read as unmet at rest | The check of rows with no free variable ran before `refresh_dyns` set their constants | Checked after |
| Seats on value edits | A seat fired on a met tangent every commit, turning a spline whole | A sampled tangent never quite agrees with the analytic one, and nothing said the constraint was not new | A sketch as it was when last settled has no new constraint: a value edit seats dimensions only |

Left from the recheck, with what was seen, in the P3 table: its P3-4, P3-5, P3-7 and P3-8 as OPEN-38 to OPEN-41. Its P3-6 is covered by README Limitations, which now names slots.

### Closed in the second recheck round

The second recheck found the guards of the round before had overcorrected: 84 of 173 moderate edits on arcs past a half turn were refused, against 0 of 178 on the build before, a return to a start value among them. This round took machinery out. The rule now is continuity, not limits: a guard turns down a jump, and what a walk reaches by degrees stands. The tests are the `CHK3-` groups of `e2e/keep-shape.spec.ts`, and the last two describes of `src/solver/seat.test.ts`. Run against the frozen build the recheck used: 48 of the 58 fail; the other 10 are controls, cases that build got right. The rows' fixes are measured by the recheck's own sweeps on the final build: s3, s4, s5, s8, s9, s10, s12, s16, s17 and s18 refuse 0 edits, against 167 on the frozen build, and no arc reaches 350 degrees (the most is 345.6, a keyhole of gap 5, which its dimensions fix and the older build reaches too). The plain set refuses 0. The pair sequences, 119 + 95 logged: nothing outside the group moved, nothing collapsed, refused or red, undo and redo exact, only Equal and Symmetry changed a size, and the 2 no-ops are unlike Symmetry picks. Tuning fork, wall outlet, bracket and gear complete with no errors.

One fault of this round's own was caught only by those pairs: a free line brought to a polygon vertex stretched, because a curve that moved whole was taken for a tail. Its regression test is "a free line to a polygon vertex in the mixed scene" in `e2e/keep-shape.spec.ts`, the check's mixed scene through the real UI, 4 layouts in both pick orders. With the fix out all 8 fail, line `l33` going 38.25 to 65.00; with it in all 8 pass. The other tests added for it, on a chain, a closed profile and a lone polygon, pass with the fix out too, so they are guards.

| Id | Was | Cause | Now |
|---|---|---|---|
| CHK3-P1-1 | A value on a line joined to a locked layer did nothing, and the label read 128 on a 40 mm span, status clean | A commit with holds dropped every component holding none. With the far corner frozen, the line's component had none, so it went unsolved and `ok` stayed true | Only a drag leaves components out. And past every path, `checked` tests each row against the geometry: a result cannot say OK with one unmet. It gets the plain solve, or goes back red |
| CHK3-P2-1 | Arcs past a half turn refused 84 of 173 edits, a DOF 0 D-shape refused its own start value | A hard limit on sweep from the commit's start, applied again to what the trail restored | No limit. Sweep is held as a preference, and gives way along a walk. Only a jump in one solve, or an arc closing on itself, is turned down. A state from the trail goes through no such check |
| CHK3-P1-2 | A dimension between a spline's ends swung the spline, by up to 40 mm on a 25% edit | Spline leg holds came first | Leg holds are gone. The ends move and interior points stay, and lines at the ends move whole. A free-ended line beside a Blend still moves only that end |
| CHK3-P2-2 | A spline's start value and a closing line were refused | The fold guard | Gone, with the holds. The doubtful case, width 80 to 40 direct with a 172 degree turn at the spline end, is now applied: a walk reaches it continuously, so the rule says apply, as the older build did. It is a real fold, and README says a spline can fold |
| CHK3-P2-3, P3-1 | An anchored chain changed its free neighbour, and a tail on an anchored rectangle swung | Tails had two rules, one for seats and one in the solver, and neither saw an anchored chain | One: `carryTails`, after the solve, for values and constraints. A tail moves whole with its joint, keeping length and direction. A pinned far end, or a constraint or dimension to the rest of the sketch, makes it not a tail, and it gives way |
| CHK3-P1-3 | Tangent on a rough stadium took the other arc from 204 to 23 degrees | Nothing looked at arcs the constraint was not about | A move that sends a non-picked arc over a half turn or a quarter turn away is a failed candidate, and the next is tried |
| CHK3-P3-2 | "Changed 2 radii" on a return to the start value | A return reported what the solve in it reported | A return reports nothing |

Removed in this round: from the solver, `Branches::from`, `left`, the sweep ceiling, the chain and spline fold guard, spline leg and turn spans, components joined by shapes, and the `loose` and far-end-stays tier. From the bridge and seats, `withTails`, the exemption for splines a constraint names, and a separate one-end function: the free-end candidate and the last resort are now one `oneEnd`. Kept because a failing test needs them: the walk, which D-shapes and every past-half-turn edit go through; one end alone, without which plain triangle edits were refused; the walk with one end anchored, tried out and put back when a plain trapezoid refused x0.56; line and sweep span holds; the loop guard.

### Closed in the third recheck round

The third recheck found that round's fixes had held and brought 3 P1 and 2 P2 regressions, the third round to trade one defect for another. So the method changed as well as the code. One harness ran on each build: every checker sweep, R1 to R5 with seeds, the 213 pairs, the plain edits, the tutorials, three random runs, and a new corpus of 14 ordinary shapes with 1,418 measured steps. It ran on both earlier builds first, as baselines, and after every substantive change. A fix counted as done only if no row was worse than the better baseline, apart from what a ruling overturned. Those rows are listed below the table.

| Id | Was | Cause | Now |
|---|---|---|---|
| R1 | Four tangents on a rough link took a 60.83 line to 10.73, moved 52.23 mm, no note. A 3.72 mm move existed. Shortest line over 9 seeds fell as far as 1.8 | Candidates were judged on what they did to curves other than the constraint's own, a first pick was worth more than any amount of travel, and a body seat won without being compared | Every candidate is scored across the whole sketch, on motion and sizes. Within one body, letting the first pick go costs little in a move under 0.4 of what keeping it takes; between two bodies the first pick stays. A `plain` solve that holds nothing but the rows is a candidate. A sweep changed by over 60 degrees or a free line under half its length is a failed candidate, used only if nothing else meets the constraint, and then with a note. All 24 orders on the link and the stadium stay under 14 mm |
| R2 | An ear on a rectangle's side: width 80 to 200 took its lines from 36.06 to 22.36, 20, 36.06, 111.8, the apex 30 mm inside at 120. The same on roofs, a hexagon bay, an unanchored rectangle | The previous round took out components joined by shapes, so an end no row mentions had no variable in the solve and its length could not be held. The guard saw only one cycle per spanning-tree join, so the ear was not guarded | Shape-joined components are back, for commits only: `components(sys, whole)`. A shape on several points that all moved by one vector translates whole (`settlePieces`). The loops guarded are every bounded face |
| R3 | A tail with its own dimension took 40 down to 37.09 and 33.18 on an undimensioned rectangle height. The same with an arc tail, Fix on a tail's midpoint, a mirrored tail | `carryTails` ran after the solve and ruled out a piece with rows in it, so those rows shared in the solve | The body rule in `bodies.ts`, from the graph of constraints, dimensions, expressions and coincidences. A body is left out of the solve and put back on its joint unrotated. `carryTails` is gone |
| R4 | A triangle hanging off a corner refused width 120 as "would turn over", though 90, 100, 110, 120 worked | The loop was in the solve and the guard, moved by a corner it was only joined to | A body, whatever is in it |
| R5 | Degree 1 spline: offset gap 0.136 to 5.546, Text on path kept the first leg's angle, Blend had a wrong second pole. Degree 2 `d2` wrong, so the comb never changed side. Trim moved (-10, 30) to (-8.68, 31.09) | `deBoor` returned the first control point for degree 0. Offset and Trim refit a polyline as a curve | `deBoor` looks the span up. Offset of a degree 1 spline is its legs, corner to corner. Trim and Extend leave a polyline's corners exactly where they were |
| R6 | The bar stayed 1247 px wide: Min Distance cut below 865 px and gone at 700 | The shell's one column took the width of the ribbon | The column can shrink. The prompt, note and coordinates give way and the readout does not, down to 560 px tested |
| R7 | README said the readout follows a changed dimension | A double-click edit moves the selection to the dimension | README corrected |

Rulings applied without a code change. A U shape closed by an arc has to give somewhere, so a symmetric side change stands. Silent folds stay in OPEN-37. OPEN-43 and OPEN-44 are new.

Removed in this round: `carryTails` and `tailFrom`, the `curvesAt` map, and the spanning-tree `loopsOf`. Restored: shape-joined components, for commits, because Ruling B needs a far end in the solve. The `loose` and far-end-stays tier stays out: `settlePieces` does that job. Added: `bodies.ts`, the `plain` solve, `upheaval`, `wrecked`, `cheapest`, and `turnedOver`, which applies the solver's loop test across a seat, which the solver cannot see. `flipped` now takes a small change that happens to pass a half turn as a small change.

| Harness row | Build 2 | Build 3 | Final |
|---|---:|---:|---:|
| Ordinary shapes: refused | 64 | 50 | 62 |
| Ordinary shapes: moved over 25 mm | 122 | 111 | 98 |
| Ordinary shapes: a free line under half | 4 | 14 | 0 |
| Ordinary shapes: a loop turned over | 3 | 6 | 0 |
| Ordinary shapes: sweep changed over 60 degrees | 5 | 19 | 5 |
| Ordinary shapes: a neighbour changed over 5% | 176 | 169 | 155 |
| Ordinary shapes: step in red or dishonest | 8 | 5 | 5 |
| Ordinary shapes: returns off by over 5 mm | 32 | 0 | 0 |
| Ordinary shapes: returns refused | 11 | 0 | 0 |
| R1 shortest line, worst of 11 | 56.06 | 5.87 | 59.2 |
| R1 largest move, mm | 20.57 | 56.28 | 7.25 |
| R2 worst length change, % | 0.0 | 210.0 | 0.0 |
| R3 height at 120 | 40 | 33.18 | 40 |
| R3 tail turn at 120, rad | 1.196 | 0.0 | 0.0 |
| R4 refusals of 3 | 0 | 2 | 0 |
| 213 pairs: bystander, unsat, not ok, undo | 0 | 0 | 0 |
| Plain edits refused of 770 | 0 | 0 | 0 |
| Random moderate refused of 4,000 | 3 | 1 | 0 |
| Random x0.05 to x20 refused of 4,000 | 57 | 44 | 62 |
| Random a loop turned over | 0 | 0 | 0 |
| Checker scripts, REFUSED | 266 | 10 | 4 |
| Checker scripts, no way | 298 | 20 | 12 |
| Checker scripts, turn over | 7 | 10 | 7 |
| Checker scripts, unsat | 81 | 85 | 79 |
| Checker scripts, FAIL | 15 | 15 | 15 |
| Checker scripts, crash | 0 | 0 | 0 |

Worse than the better baseline, each by a ruling or a measure of its own:

- Refused more: Horizontal on a roof line (4 rows) and Parallel on ear lines (8). Each would flatten or turn over a face. Ruling on every face. Build 3 applied them, with a line at 0.1 of itself and a loop turned over.
- Random runs at x0.05 to x20: 62 refused of 4,000, against 44 and 57. Shape-joined components are back, which Build 2 also had. All 62 are "would turn over". 15 are above 5 m, and the rest are on triangles earlier edits squeezed nearly flat. At x0.7 to x1.6 it is 0 of 4,000, against 1 and 3.
- A keyhole's tangents move more, 6 rows over 25 mm against 0 on Build 3. There the arc swung 130 degrees instead. That is a failed candidate now, so the stem widens. Ruling on small moves.
- Value edits with a sweep over 60 degrees: 4 against 2 and 3, and 2 more over 10 mm. Where a line used to give a little, it now holds and the arc takes the change: a D, a keyhole, a stadium's radius at x0.7. Continuity for values is as ruled, with no sweep limit.
- Notes: 3 on Concentric and 1 on Tangent that had none. Ruling on small moves: a large change gets a note. One seed of R1 reads a radius note, as on Build 2.
- R1 seed 1 moved 7.25 mm against 5.85 on Build 2. All 11 are under 8 mm, against up to 20.57 and 56.28.
- Equal: more neighbours change than on Build 3, where 18 Equals never applied: the click after a refused Parallel was lost. Against Build 2, 2 rows are worse on a flag and 2 on a bay. The flag's second pick now changes, as the prompt says, and takes its opposite side with it; Build 2 changed the first. The bay's Equal moves 7.3 mm and changes a neighbour by 8%, where it moved 13.7.

### Closed in the sixth recheck round

A short round on the crossing change of the round before. The harness on the final build changed no row against the frozen one.

| Id | Was | Cause | Now |
|---|---|---|---|
| P1-1 | A design with a crossed outline killed the app on reload and on open, with `Maximum call stack size exceeded`. Only File > New recovered it, and that discarded the work | Analysis posted its notes before it stored its answer. A note repaints the status, the status asks for the analysis, and a crossed outline had a note on every solve, a solve of nothing included. A boot that threw then stayed half built | The answer is stored first. Reading a sketch is silent, and a solve that asks for nothing has no note. An error on the way in leaves the app up with a note. A file that fails leaves the open design. An autosave that fails or no longer validates is copied aside and nothing empty is saved over it |
| P3-3 | The first value edit on a drawn bow tie gave no note | A face was the counter-clockwise walk of a loop, and a bow tie whose lobes balance has none. This is also why it did not crash | It is taken as it is, since it crosses. Anything else that flat is no face |
| P3-1 | Deleting a row with a bad expression left the error, with OK disabled | The check held the row that had gone | A delete clears both: every row is rebuilt from what is stored |
| P3-2 | Delete then Cancel left an empty Undo step | Cancel was a commit | Cancel goes back to the design as the dialog found it and leaves no step, also at the depth limit |
| P3-4 | A parameter feeding a dimension on a locked layer read 60 over geometry at 50, with a generic Over-constrained | | The note says the locked layer holds it |
| P3-5 | | | Open: OPEN-55 |

### Closed in the fifth recheck round

A short round on the frozen round 5 build. The keyhole Tangent seed in OPEN-52 was not a defect: of 120 tangents, 113 were the same, 6 larger by 2.2 to 5.3 mm, 1 smaller by 17.9, and none refused.

| Id | Was | Cause | Now |
|---|---|---|---|
| P1-1 | After "Free lines gave way" the status read Constrained, DOF 0, where Compute Sketch said 2 | The analysis came from the walk that held the reversed lines, temporary rows and all | A commit that held anything no row asks for, or moved on after its solve, is analysed afresh. The corpus now checks DOF and free curves against a fresh analysis after every commit |
| P2-3 | 1100 curves: drag release, file open and a constraint commit went from about 200 to about 1500 ms | Round 5 made a world for every Coincident and Midpoint just to ask if it offered a seat, quadratic in the sketch | Ask what is unmet first: almost nothing is, and only that gets seats. No guard changed |
| P2-5 | Deleting a user parameter threw, and the row stayed | The rows' refreshers ran against the list one shorter | They are dropped before the delete |
| P2-4 | Coincident of a free arc's centre on an edge resized the arc | The seat moved the centre alone | A centre is its round: it goes whole |
| P2-2 | A crossed outline was refused as turning over, and each way out was refused | It stayed in the loop guard, with an area that means nothing | A crossed outline is left out of the guards. Edits go through with a note while it stays crossed, and it can come out |
| P2-1 | F8 failed on keys not exactly centred | An arc's sweep was held before the walls, and off centre that could be met by sliding the key | An arc ending on a free wall gives way with the lengths, up to 20 degrees of sweep a step |
| P3-9 | Change Parameters edited dimensions on other layers | | Those rows are read only and say why. A user parameter feeding one still drives it |
| P3-3 | A chamfer begun at a vertex left a stray chord | The next click placed it at the default size | A click on what makes the corner does not place it |
| P3-7 | A note stayed after opening Parameters, changing nothing, OK | | OK with no edits clears it |
| P3-8 | A line closed by a fit spline showed no profile | The duplicate check took a two-point line's end for its middle, and that is on the spline | It uses the true middle |
| P3-2 | A forced turn-over passed silently | | A note. P3-5, a rack's teeth folded under a rim without crossing, is not cheap to detect and is OPEN-54 |

| Harness row | Round 5 build | Final |
|---|---:|---:|
| Ordinary shapes: refused | 54 | 54 |
| Ordinary shapes: moved over 25 mm | 103 | 103 |
| Ordinary shapes: a free line under half | 0 | 0 |
| Ordinary shapes: a loop turned over | 0 | 0 |
| Ordinary shapes: sweep changed over 60 degrees | 3 | 3 |
| Ordinary shapes: a neighbour changed over 5% | 167 | 167 |
| Ordinary shapes: returns off by over 5 mm | 0 | 0 |
| R1 largest move, mm | 7.25 | 7.25 |
| R2 worst length change, % | 0.0 | 0.0 |
| 213 pairs: bystander, unsat, not ok, undo | 0 | 0 |
| Plain edits refused of 770 | 0 | 0 |
| Random x0.7 to x1.6 refused of 4,000 | 0 | 0 |
| Random x0.05 to x20 refused of 4,000 | 9 | 11 |
| Random flips | 0 | 12 |
| Checker scripts: REFUSED | 4 | 4 |
| Checker scripts: no way | 8 | 8 |
| Checker scripts: turn over | 0 | 0 |
| Checker scripts: unsat | 79 | 79 |
| Checker scripts: crash | 0 | 0 |
| Fresh parts: refused | 12 | 6 |
| Fresh parts: flips | 0 | 0 |
| Fresh parts: unsat | 3 | 3 |
| Fresh parts: dishonest | 1 | 1 |
| Orders: refused | 3 | 3 |
| Orders: flips | 0 | 0 |
| Orders: miss | 11 | 11 |
| Orders: unsat | 8 | 8 |
| Orders: cam wrong branch of 22 | 4 | 4 |
| Matrix: refused of 466 | 0 | 0 |
| Matrix: lighter object not the one moved | 27 | 27 |
| Matrix: large-change note | 1 | 1 |
| Matrix: undo mismatch | 0 | 0 |

Worse than the round 5 build: random flips 12 against 0, and random refusals at x0.05 to x20, 11 against 9. All 11 flips at the extreme range were on quads whose outline already crossed before the edit, and the one at x0.7 to x1.6 was on a quad: that is the ruling on crossed outlines. No ruling covers the two more refusals, and their cause was not traced.

| Timing, median of alternating runs, ms | Build 4 | Final | Ratio |
|---|---:|---:|---:|
| 1100 curves: file open | 189 | 181 | 0.96 |
| 1100 curves: drag release | 201 | 218 | 1.09 |
| 1100 curves: constraint commit | 268 | 282 | 1.05 |
| 506 curves: drag release | 58 | 70 | 1.19 |
| 1100 curves: drag step | 183 | 183 | 1.00 |

### Closed in the fourth recheck round

The fourth recheck found the solver core sound on fresh parts: 554 value edits with no flip, every return and Undo exact. What it found was targeted and mostly older than the solver work. The gate from the round before gained the check's fresh parts, its order runs and its who-gives-way matrix, baselined on Build 4.

| Id | Was | Cause | Now |
|---|---|---|---|
| F1 | Fillet with both picks nearer the corner than the contact deleted the long sides: edges 6 and 6, not 74 and 34 | `trimToContact` compared the pick with the contact point | It compares the pick with the corner: the arm from the corner toward the pick stays, and the pick decides only where the curves cross. Line and line, line and arc, arc and arc, crossing lines, picks both sides of the contact. Chamfer already read the corner |
| F2 | A dead name was reused, so `d1/2` rebound to a new radius and a hole jumped from x 40 to 3 | `nextDimensionName` took the lowest free number | `Design.names` only goes up and is saved. An old file starts past every name it shows or asks for. Whatever used a name that goes keeps its last value as a number, exactly, with one note. Undo restores the expressions. A file that already dangles opens, its label in the error colour and a note naming it. Change Parameters refuses to delete a parameter in use, and its names use the same counter |
| F3 | A pulley's bore at 20 reversed a rim and the V poked 23 mm out, in silence | Nothing looked at outlines, only at chord areas | A simple outline that comes to run through itself is a failed candidate, tested on real curves, flattened, on faces, on commits. A value tries a walk, a plain walk, then a plain walk with the lines that turned back kept short and pointing the same way, with a note if that works. If every answer crosses it stands with a note. An outline with a spline counts: that much of OPEN-37 is closed |
| F4 | Parallel on a teardrop and the last H/V on a hook were refused although valid shapes existed | The guard used the chord polygon | A face's side is its true area on both sides of the wasm boundary. A D now has a side at all |
| F5 | Midpoint between a free arc's end and an edge was refused as a flip | The check ran before the arc, a body, had come along with its joint | The check waits for the body |
| F6 | Midpoint from a slot's end centre to a free arc resized both | The row counted the point as a rider of the curve, so the rigid seat took the point along and met nothing | A point constraint's seats are made as if the row were not there yet. This also ended the shared moves of S2 |
| F7 | Equal changed the first pick when the second had a long way to go | The half-length failure applied to the line meant to change | Pick order is the rule for Equal. A wreck there is said, not avoided. Bystanders stay exactly: Equal(32.3, edge 40) leaves a height of 30 at 30 |
| F8 | A keyway without Symmetry slid 16 mm to hold a wall's length at R 32.5 | Free lengths outranked position | On a value edit, as many walls of a closed profile as can stay on their lines do, arc sweeps first and free lengths last, and that answer is taken if it moves less and leaves no line under half. Limited to value edits and to the smaller move after the gate showed the plain rule moved a link 79 mm |
| S1 | H/V gave up at the nearer axis, and a flat loop was called turned over | | `retry` tries the other axis once. `crossed` says `flat` |
| S2 | Coincident onto a line could share the move | See F6 | The lighter object moves alone |
| S3 | Fillet dropped a corner's Symmetry in silence | | A note |
| S4 | Fit left geometry under the palette | | Fit works in what the panels leave |
| S5 | A refused note stayed after re-entering the same value | | It clears |
| S6 | The bar overflowed by 17 px at 360 px | | The sketch state shrinks |

Tried and left: F9. See OPEN-45.

| Harness row | Build 3 | Build 4 | Final |
|---|---:|---:|---:|
| Ordinary shapes: refused | 50 | 62 | 54 |
| Ordinary shapes: moved over 25 mm | 111 | 98 | 103 |
| Ordinary shapes: a free line under half | 14 | 0 | 0 |
| Ordinary shapes: a loop turned over | 6 | 0 | 0 |
| Ordinary shapes: sweep changed over 60 degrees | 19 | 5 | 3 |
| Ordinary shapes: a neighbour changed over 5% | 169 | 155 | 167 |
| Ordinary shapes: returns off by over 5 mm | 0 | 0 | 0 |
| R1 shortest line, worst of 11 | 5.87 | 59.2 | 59.2 |
| R1 largest move, mm | 56.28 | 7.25 | 7.25 |
| R2 worst length change, % | 210.0 | 0.0 | 0.0 |
| R3 height at 120 | 33.18 | 40 | 40 |
| 213 pairs: bystander, unsat, not ok, undo | 0 | 0 | 0 |
| Plain edits refused of 770 | 0 | 0 | 0 |
| Random x0.7 to x1.6 refused of 4,000 | 1 | 0 | 0 |
| Random x0.05 to x20 refused of 4,000 | 44 | 62 | 9 |
| Random flips | 0 | 0 | 0 |
| Checker scripts: REFUSED | 10 | 4 | 4 |
| Checker scripts: no way | 20 | 12 | 8 |
| Checker scripts: turn over | 10 | 7 | 0 |
| Checker scripts: unsat | 85 | 79 | 79 |
| Checker scripts: crash | 0 | 0 | 0 |
| Fresh parts: refused | - | 23 | 12 |
| Fresh parts: flips | - | 0 | 0 |
| Fresh parts: unsat | - | 3 | 3 |
| Fresh parts: dishonest | - | 1 | 1 |
| Orders: refused | - | 4 | 3 |
| Orders: flips | - | 0 | 0 |
| Orders: miss | - | 12 | 11 |
| Orders: unsat | - | 7 | 8 |
| Orders: cam wrong branch of 22 | - | 4 | 4 |
| Matrix: refused of 466 | - | 2 | 0 |
| Matrix: bystander | - | 0 | 0 |
| Matrix: lighter object not the one moved | - | 25 | 27 |
| Matrix: large-change note | - | 2 | 1 |
| Matrix: undo mismatch | - | 0 | 0 |

Worse than the better baseline:

- Orders in red: 8 steps against 7. Hook order 11 ends with its last Horizontal in red, where Build 4 applied it. The red is honest. Not ruled for, and left.
- Matrix, the lighter object not the one moved: 27 against 25. Equal goes by pick order now, by the ruling on Equal.
- Neighbours changed: 167 against 155. Horizontal on a roof line now tries Vertical instead of refusing (4 rows, ruling S1). Value edits on a rectangle with an ear or a roof let a wall's length go where it used to move further (F8).
- Moved over 25 mm: 103 against 98. Parallel on a teardrop applies instead of being refused (4 rows, F4). The roof's Vertical (2 rows, S1).
- One keyhole seed, Tangent: 16.9 mm against 9.1, a line at 0.71. No ruling covers it and the cause was not traced.
- Against Build 3 alone, the rows from round 4 stand as listed there.

## 3. Deliberate differences

| Item | Ruling and what the app does |
|---|---|
| Fillet and Chamfer drop the adjacent dimension (M565, M578) | GUID-6A2AE9D9: fillet "deletes the 500 mm dimension". Height dropped, width kept. Trim and Extend keep theirs at the new length. |
| Over-constraining dimension (M513, M525) | Automatically Driven with a note, no dialog. |
| Trim and Extend (M544, M546) | Real intersections only; the step-by-step page wins. Whole line goes if nothing crosses. |
| Dimension order (M492) | Place first, then value. Typing before placing is ignored. |
| Fit spline curvature (M365) | Real G2 with lines, arcs, circles, ellipses, conic ends and fit or control splines, with a handle at that end; with a line, a natural end too. Measured both sides by the app's own curve: fit and arc 0.0333333 (1/30), 0.0250000 after the radius goes to 40, fit and fit 0.0287185, fit and control 0.0237037, control and fit 0.0346832, fit and ellipse 0.0093750, fit and conic 0.0166667, fit with handle and line 0. Control splines as before: 0.0568 against 1/R 0.0568 with an arc, 0.0289 both sides between two. The Curvature tool warns only when neither curve can steer: a conic, or a two point control spline. Every steered target is checked on the real curve after the solve; 1,500 random control spline joints showed 14 reported met that were not, before that check. A handle dragged at a G2 end reaches the cursor with G2 held, through the UI, and Undo is exact. |
| AutoConstrain (M450, M456) | A local rules engine, labelled in the dialog, not cloud AI. Start Over and three different tiles are in. Editing dimensions in the canvas during the dialog is not. |
| Slice, 3D Sketch palette rows (W644, W650, W655, W677, W684) | Omitted: 2D app. |
| N/A-3D | 56 rows, out of scope. Not visibly marked unavailable, except Project's Bodies filter and greyed mesh entries. |
| Line tool: an arc from an end point is placed on mouse release (C006, W818) | Owner's ruling, confirmed as Fusion's own behaviour: press on the end point just placed, drag, and the arc is made when the button comes up. The fork tutorial's wording ("drag right for tangent arc; click to finish", `sketch_fork_activity2`) reads as a click to finish; the app does not wait for one, and the code is as it was. |

Shortcuts from outside the reference, kept by ruling: L, R, C, P, T, O, M, X, F6, the arrow keys (fold the plane) and V (Orbit view), both added with 3D mode by the owner's request, Cmd/Ctrl+A, Cmd/Ctrl+X, Cmd/Ctrl+Z and Y, Delete, Cmd/Ctrl+Enter, Cmd/Ctrl+P. The reference names only S, D and Cmd/Ctrl+C and V.

## 4. User additions

Standard: the decision list. All observed through the UI.

| Feature | Result | Evidence |
|---|---|---|
| Layer panel | Pass | Named, colour, hide, lock, drag reorder both ways, add, delete. Delete sends geometry to the layer below; last layer's delete is disabled. Undo and redo one step each across a mixed run. Lock and hide survive reload. |
| Design-wide, migration | Pass | Layers shared across sketches; deleting one moves geometry in both. Version 1 save opens on Layer 1, looks as before, drags. |
| Only active layer editable | Pass | Other layer: no select, drag, delete, trim, fillet; window, crossing, Select All and chain ignore it; clicks pass through to active geometry. Snaps to end, midpoint, quadrant and centre, and lines start from it. |
| Lock | Pass | Active locked: selection, drawing, drag, delete all blocked with `Layer "Work" is locked`. Locked layer still snaps, prints and exports. |
| Hidden | Pass | Not drawn, hit, or snapped, including in another sketch. Dropped from SVG, DXF, print and bounds. Hiding moved nothing. Active layer cannot be hidden; it says so. |
| Show Constrained Lines | Pass | Default on. On: active has status colour, glyphs, dimensions, free-end dots; others plain with those hidden. Off: every layer in its colour. Single layer as before. |
| Construction active-layer-only | Pass | On hides it on other layers, off shows it dashed, separate from Show Construction. |
| Cross-layer constraints | Pass | Parallel, Perpendicular, Equal, Collinear, Tangent, Coincident, Midpoint, H/V, Concentric on arc and ellipse, Sketch Dimension: either order, active moves, other stays. Inference adds a real constraint. Distinct yellow glyph. Hover shows only in those tools. Contradiction refused with a reason. |
| One-way following | Pass | Rotating the reference rotates the dependent. Locked dependent holds, constraint red, message; on unlock it follows. Deleting the reference removes the constraint with a message, dependent stays; undo restores. Status same locked or not. |
| Save as SVG | Pass | File menu and right-click. Rendered in Chromium and rsvg: 202 x 117 mm against a CSS 100 mm ruler (202.005, 117.004), circle 40.001, ellipse 30.001 x 16.000, line 100. True line, circle, arc, ellipse elements. Dashes 2.1 1.5 and 4.2 1.2 0.9 1.2. One group per layer in order and colour, Inkscape labels. Options work. |
| Editable SVG | Pass | Save as SVG has "Include editable data", ticked, with a note that the data is the whole design, hidden layers and construction included. The design rides in `<metadata>` as the project JSON in base64 with a format, a length and a CRC-32, in the namespace `urn:sketch-cad:design`; the drawn elements are the same with or without it, and the Light, Dark and System exports are still the same bytes. File > Open takes `.svg` and replaces the design as for a project file: no prompt for unsaved work, the design's own name, File > Save writes `<name>.sketch.json`, autosave keeps it, undo history starts empty (a project file does not store it either). The app has no other way to open a file, so no drag and drop to cover. A demanding design (three sketches on XY, YZ and XY, four layers with one hidden and one locked, a cross-layer constraint, mirror, rectangular pattern, offset, fillet, fit and control splines, a conic, text reading a text parameter and a dimension, a linked projection, user parameters with expressions, a driven dimension, construction geometry) was saved, the app reloaded in a fresh browser with empty storage and the file opened: the design is deep-equal, every sketch has the same DOF, verdict and status, a spline point drags, a dimension changed by double-click moves what depends on it, and undo puts it back; saving again gives the same bytes. Unticked: no data, the same drawing, and opening says why. An SVG from elsewhere, a truncated or altered one, a newer format or design version, plain text, JSON or broken markup in an `.svg`, an entity declaration, and data that does not validate each give a message, leave the design as it was and log nothing; a version 1 design inside goes through the migration. A file with `<script>`, event attributes, `<image>`, `<use>`, a style `@import`, `foreignObject` and a stylesheet link, with and without valid data, runs nothing and fetches nothing, and the same probes do see an `<img onerror>` set through `innerHTML` (checked, and checked again by making the reader do exactly that). Re-formatted by `xmllint --format`, `xmllint --c14n` and a Python `minidom` pretty-print it still opens. `rsvg-convert` draws the file with the data byte for byte as the one without; its own `-f svg` output drops the metadata and so opens only to say there is no data. Inkscape was not installed, so not tried. Limits: only the embedded design is read, edits made in another editor are not read back, and an SVG with the data holds the whole design, so sending it sends hidden layers and construction too. |
| Multi-layer DXF | Pass | Named layers with nearest ACI, spaces become underscores, hidden left out; option layers `Layer_1_POINTS`, `_CONSTRUCTION`. Read by my parser, not CAD software. |
| Print 1:1 | Pass | File menu and Cmd+P. Paper list, orientation, preview, warning. PDF rendered at 10 px/mm: 100.0 mm line, 100.0 mm bar, page 209.9 x 297.1 (point rounding). Landscape 297 wide. Hidden out, locked in. |
| Tiled print | Pass | 400 x 300 mm on A4: 6 pages, 3 x 2, labels, marks. Overlap strips of neighbours match at zero shift (9 pixels of 1302 differ). Rectangle edges reassemble exactly: 84.9 + 400 - 360 = 124.9 mm against 125.1 measured (stroke width), 118.9 + 300 - 254 = 164.9 against 164.9. Bar 100.0 on every page. |
| Undo and redo with layers | Pass | 8 steps back and forward through add, rename, draw, hide, activate, lock, delete. |
| Trim across layers | Pass | Active line cut at another layer's line, which stays. Hidden layers do not cut. |
| Copy and paste | Pass | Paste lands on the active layer; Select All copies active only; locked refuses with a message. |
| Dark Mode | Pass | File > Theme: System, Light, Dark, current one ticked. System follows the OS and changes with it; the choice is in `localStorage` only (not in the file, not an undo step, no history entry) and survives a reload; storage that throws costs only the memory of it. `data-theme` is set before first paint, checked with the app's scripts blocked. Ribbon, panels, menus, marking menu, toolbox, plane picker, dialogs, HUD fields, tooltips, status bar, icons and the canvas (background, grid, axes, line statuses, glyphs, dimensions, selection, previews, snaps, window selection, manipulators) all follow it, from `src/ui/tokens.css`. Fully constrained lines are `#eef1f4`; free, over-constrained, construction, projected, fixed and cross-layer each have a Dark colour, at least 3:1 on the canvas and at least 15 apart (CIE76) from every other status colour. Text is at least 4.5:1 in Dark for every pair the app draws (`src/render/palette.test.ts` lists them, lowest 4.62). A layer colour under 3:1 on the canvas is drawn lighter with its hue kept; the swatch and the data keep the colour set. Light was compared with the build from before the change, screenshot against screenshot. 25 states (selection, previews, tools, dialogs, menus, design mode) are byte for byte identical. Of 14 more, 8 are identical, 5 differ in 5 pixels by at most 2 of 255 at the edge of a layer swatch (the new build differs from itself by as much between runs), and the File menu differs by its new Theme row. SVG, DXF and the print page, exported from Light, Dark and System under a dark OS, are the same bytes. |
| Trackpad and pinch | Pass, simulated | A two-finger drag pans (also in the Line tool, keeping its first point, value boxes and preview), a pinch zooms at the cursor, a mouse wheel zooms as before. Tested with dispatched `WheelEvent`s shaped like trackpad, pinch and mouse sequences, with real gaps between them; no trackpad was attached, so how a given device reports itself is not tested. The page does not scroll, and `overscroll-behavior: none` stops a sideways swipe from going Back. What the rule can get wrong is in section 6. |
| Min Distance | Pass | Owner addition, not in `reference/`, so no citation. Two selected objects show `Min Distance: 12.34 mm` on the status bar between the note and the sketch state, in design units (`in` checked: `1.118 in`); one, three, none, a dimension among the two, a third pick, Escape, a click away, Finish Sketch and design mode give none. Real mouse, Shift-click, window select: line and circle (gap to the rim), two points, a line that stops short of a circle (from its end), an arc whose full circle is nearer (the arc's end point), crossing lines and a line inside a circle (0 and the gap to the rim), concentric circles (difference of radii). Live: mid-drag with the button down, Undo and Redo, Change Parameters with both selected, a dimension typed into the label, a rim-to-line tangent dimension. Another layer and a locked layer cannot be picked, so nothing is measured. Worked out only for exactly two objects and only when one of them changed (`minDistanceRuns`: no run on mouse moves, none for a drag of a third object, never more than one per frame in a drag); a 1000-curve sketch gives the right gap. The bar keeps its other items where they are as the value appears at 1440 x 900, 1100 x 700 and 900 x 600 with no overflow; legible in Light and Dark (contrast over 7). Accuracy: points, lines, arcs, circles are closed forms, hand-worked cases to 1e-9 relative at scales 1e-4, 1 and 1e6; ellipses, splines and conics are a search seeded from the app's flattening, 1e-8 on hand-worked cases at those scales and, on 5,850 random pairs of every type against a brute force that shares no method with it, never above it by more than 1.4e-14 mm (one pair was lower by 4e-3: a crossing the brute force stepped over). Not found by any test: text (no readout by design), axes (not selectable). A degree 1 control spline is read as a polyline, segment by segment. |
| Time to solve | Pass | Owner addition, not in `reference/`, so no citation. `Solve 3.2 ms` on the status bar between Min Distance and the sketch state: one decimal under 100 ms, whole from 100, `<0.1` when too short to show. Main-thread wall time of one request, taken at `solveSketch` and nowhere else: a constraint, a dimension edit and a new dimension (which solves more than once) each take exactly one reading (`solveRuns`), a refused edit still shows its time, a drag shows a reading on every step with the button down, Undo solves nothing so the figure stays, and design mode and no sketch open show none. The bar keeps every other item where it is as the figure changes (1440 x 900, 1100 x 700, and for figures from 3.2 to 1234 ms); with Min Distance showing the readout is the first to go as the window narrows (swept 1200 px to 560 px in steps of 20: until it goes, the prompt, Min Distance, state and coordinates are the same width as with it removed, and Min Distance is never clipped); legible in Light and Dark (contrast over 4.5). Times are not asserted, only the wording and that they are positive. Not tested: a sketch that has never been solved in the session, which the browser panel's status makes hard to reach (it solves every sketch on load). |
| Multiple sketches | Pass | As above; hidden layers do not snap from another sketch. |
| Pattern and mirror | Pass | Objects from other layers are not taken; output stays on the active layer. |
| AutoConstrain | Pass | Dimensions the active layer only; other layer unmoved. |

## 4a. Round 8: file safety, Move/Copy, Measure, and the SVG line

Owner additions, not in `reference/`, except where a row says so. Tests: `e2e/file-safety.spec.ts`, `e2e/move-measure.spec.ts`, `e2e/svg-embed.spec.ts`, `src/io/rescue.test.ts`, `src/io/svg-data.test.ts` ("what an editable SVG will carry"), `src/io/project.test.ts`. Each was written first and failed first.

| Feature | Result | Evidence |
|---|---|---|
| Unsaved changes | Pass | Dirty after any commit, Undo or Redo since the last save, open or new; Undo does not clean it. File > Save and a save of an editable SVG clear it; an SVG without the data does not. File > Open, File > New, the + beside the name and Recover Designs > Open ask with the app's own dialog, Unsaved Changes: Save (downloads, then goes on), Don't Save, Cancel (nothing changes). A saved design asks nothing. Routes not covered, and why: dropping a file on the window (the app takes no drop), closing the tab (the autosave keeps the work; a browser prompt is not the app's dialog). Earlier rows that clicked a New confirm (W928, OPEN-29) now meet this dialog or none. |
| A failed open | Pass | A file that does not parse, a project and an SVG whose swap throws before anything changes (`structuredClone` made to throw) and one whose swap throws part way (`replaceChildren` made to throw while the interface is told): design, `canUndo`, `canRedo`, Undo and Redo back and forward, the open sketch and the dirty flag are as they were. Before this, a throw part way rebuilt the old design with an empty history. |
| Rescued autosaves | Pass | Up to five, newest first, each with time and size; a second failure is a second copy; the same text is not kept twice. Full by count: the oldest goes only if the new one then fits. Full by quota: nothing is lost, the original autosave is not written over, and the boot note says no copy was kept. Old `sketch.autosave.rescued` moves into the list on boot. File > Recover Designs...: Open (through the Unsaved Changes prompt; a copy that fails says so, keeps the design and the copy), Download (the raw text), Delete, an empty state. A boot that rescues something shows a note with a button to the dialog. The quota cases are in `src/io/rescue.test.ts` with a fake store; the browser's own quota was not filled. |
| Move/Copy: Move Type and Set Pivot | Pass | Free Move as before. Point to Point: Start Point, then Target Point, each snapped, the target on another layer included and nothing added to it; the selection moves by the vector in one commit and one Undo step; Create Copy leaves the original. Set Pivot: Z Angle and the rotate handle turn about the picked point, and the default stays the centre of the bounding box. Constraints behave as Free Move has them (same `moveCopy`). The page named for the tool, GUID-685B9D79, is about coincident constraints and has no Move Type list, and `SKT-SKETCH-MODIFY-TOOLS` says only "specify the new location", so the modes follow Fusion's dialog and no new key was added. |
| Measure | Pass | Inspect > Measure and `I`. Two picks on any visible layer, locked ones included, hidden layers never; both lit, neither selected; `Min Distance: ...` through `formatValue`; a third pick starts over; Esc leaves and clears. No Undo step, the design unchanged, the Sketch Palette text unchanged, usable on a locked active layer. Normal selection of another layer's object still selects nothing. |
| Line under Include editable data | Pass | `Includes 2 hidden layers and 5 construction lines.` from the design as it is, following Construction Geometry and the data tick; `No editable data: the file holds only what is drawn.` when unticked, and then the file has no `<metadata>`, no hidden layer name, no dash and no long base64 run (unit and browser tests). Read at 360 px and in Dark. |
| New dialogs at 360 px and in Dark | Pass | Unsaved Changes, Recover Designs, the boot note and Save as SVG fit a 360 px window (a dialog now stops at the window's edge and starts at its left on a narrow one) and read in both themes; asserted by position and background luminance, and looked at. |

## 5. Full coverage

### 5a. Findings

| Finding | First priority | Final | Observed |
|---|---|---|---|
| C-F1 | P1 | Fixed | Path text picked by letters, dialog, Explode, Move/Copy, window. |
| C-F2 | P1 | Fixed | Clicks kept, tangent, no conflict. |
| C-F3 | P1 | Fixed | Tab reaches the second field: polygon, rectangle, line, ellipse, slot. |
| C-F4 | P2 | Fixed | Angle field. |
| C-F5 | P2 | Fixed | d1 50 between end points. |
| C-F6 | P2 | Fixed | Handles on selection, drag bends, one undo. |
| C-F7 | P2 | Fixed | 1 to 9. |
| C-F8 | P2 | Fixed | Rho held; default 0.5. |
| C-F9 | P2 | Fixed | Enter is a new line; wraps; reflows. |
| C-F10 | P2 | Fixed | 9 points, pivot, edges pick. |
| C-F11 | P2 | Fixed | Parameters shown and editable, and referenced as {Text1_text}. |
| C-F12 | P2 | Fixed | Local horizontal, labels apart. |
| C-F13 | P2 | Fixed | Glyph at centre. |
| C-F14 | P2 | Fixed | Letters answer. |
| C-F15 | P2 | Fixed | Menu item; diameter default. |
| C-F16 | P2 | Fixed | Point projected. |
| C-F17 | P2 | Fixed | Break Link, Manage Lost Projections. |
| C-F18 | P2 | Fixed | Same circle twice ignored. |
| C-F19 | P3 | Fixed | Rows present. |
| C-F20 | P3 | Partial | OPEN-13. |
| C-F21 | P3 | Fixed | On Create menu. |
| C-F22 | P3 | Fixed | Mid-line and rim. |
| C-F23 | P3 | Fixed | Aligned end tangent. |
| C-F24 | P3 | Fixed | Check, conic Enter and corner tangent; degree icons and the Setup dialog too. |
| C-F25 | P3 | Fixed | Handles from Move/Copy. |
| C-F26 | P3 | Fixed | Parallel on slot sides. |
| C-F27 | P3 | Fixed | Symbol shows. |
| C-F28 | P3 | Fixed | Arc preview. |
| C-F29 | P3 | Fixed | No staircases. |
| C-F30 | P3 | Fixed | Prompt. |
| C-F31 | P3 | Fixed | Lines stay, note. |
| C-F32 | P3 | Partial | OPEN-16. |
| C-F33 | P3 | Fixed | Mirror and pattern take points. |
| C-F34 | P3 | Fixed | OK waits; dashed orange. |
| C-F35 | P3 | Fixed | Suggestions. |
| C-F36 | P3 | Missing | OPEN-17. |
| C-F37 | P3 | Fixed | Icons. |
| C-F38 | P3 | Fixed | Over the top. |
| C-F39 | P3 | Partial | OPEN-18. |
| C-F40 | P3 | Fixed | Tracks selection. |
| M-F1 | P1 | Fixed | All quadrants, slanted. |
| M-F2 | P1 | Fixed | All chamfer types. |
| M-F3 | P1 | Fixed | Arc kept to its sweep; default radius stays on the picks' side. |
| M-F4 | P1 | Fixed | Free arcs and ellipses travel whole; joined arcs move their centre. |
| M-F5 | P1 | Fixed | Lengths kept, both orders. |
| M-F8 | P1 | Fixed | Refused with a reason, both orders. |
| M-F6 | P2 | Accepted | Fillet, Chamfer by ruling. Trim, Extend keep dims. |
| M-F7 | P2 | Fixed | Radii kept. |
| M-F9 | P2 | Accepted | Ruling; fit-line real G2. |
| M-F11 | P2 | Fixed | Follows the mouse. |
| M-F12 | P2 | Fixed | Centre or tangent. |
| M-F13 | P2 | Accepted | Ruling. |
| M-F14 | P2 | Fixed | Side kept. |
| M-F15 | P2 | Fixed | Unlocks. |
| M-F16 | P2 | Fixed | Stops short of the limit, one value everywhere, guard on regeneration. |
| M-F17 | P2 | Accepted | Ruling. |
| M-F20 | P2 | Accepted | Start Over and tiles in; canvas edits out by ruling. |
| M-F21 | P2 | Fixed | Ellipse, spline. |
| M-F22 | P2 | Fixed | Clear labels. |
| M-F10 | P3 | Fixed | 12 tools. |
| M-F18 | P3 | Fixed | Point moves. |
| M-F19 | P3 | Fixed | Rim on an axis keeps no point. |
| M-F23 | P3 | Fixed | T end held. |
| M-F24 | P3 | Fixed | X, concentric, axis preview. |
| M-F25 | P3 | Fixed | No [ref]. |
| M-F26 | P3 | Fixed | Palette, Automate, and the Undo button names the step. |
| M-F27 | P3 | Fixed | A field that stays put takes a click. One following the cursor, or that appeared under it, is reached by typing or Tab. |
| M-F28 | P3 | Fixed | Hides geometry. |
| M-F29 | P3 | Fixed | Line and circle. |
| M-F30 | P3 | Accepted | Dimension order by ruling; Scale fixed. |
| M-F31 | P3 | Fixed | Red, pill, Toggle Driving. |
| M-F32 | P3 | Fixed | Adds nothing, says so. |
| M-F33 | P3 | Fixed | Line first works. |
| M-F34 | P3 | Fixed | Driven refused; too large says so. |
| M-F35 | P3 | Fixed | Works in another sketch. |
| M-F36 | P3 | Partial | Blend clean; parameter row OPEN-22. |
| M-F37 | P3 | Fixed | Order. |
| M-F38 | P3 | Fixed | Stays joined. |
| W-P1-1 | P1 | Fixed | Both orders; T3 DOF 0 both ways. |
| W-P2-1 | P2 | Fixed | T1, T3 with no Project. |
| W-P2-2 | P2 | Fixed | Tangent inference on the bracket. |
| W-P2-3 | P2 | Fixed | Black, dashed. |
| W-P2-4 | P2 | Fixed | One Esc. |
| W-P2-5 | P2 | Fixed | Placed on axis. |
| W-P2-6 | P2 | Fixed | Node and rim. |
| W-P3-1 | P3 | Accepted | Ruling. |
| W-P3-2 | P3 | Fixed | SOLID reachable. |
| W-P3-3 | P3 | Fixed | XZ, XY (Top). |
| W-P3-4 | P3 | Fixed | Home View. |
| W-P3-5 | P3 | Fixed | Midpoint. |
| W-P3-6 | P3 | Fixed | Notes clear, the layer ones too. |
| W-P3-7 | P3 | Fixed | Lock hidden. |
| W-P3-8 | P3 | Fixed | Tips, prompts. |
| W-P3-9 | P3 | Fixed | Two glyphs. |
| W-P3-10 | P3 | Fixed | Duplicate refused. |
| W-P3-11 | P3 | Fixed | Degree sign. |
| W-P3-12 | P3 | Partial | Tools and list added; OPEN-25. |
| W-P3-13 | P3 | Fixed | Midpoint. |
| W-P3-14 | P3 | Fixed | Redefine. |
| W-P3-15 | P3 | Partial | OPEN-27. |
| W-P3-16 | P3 | Fixed | Icon at cursor. |
| W-P3-17 | P3 | Fixed | Axis numbers. |
| W-P3-18 | P3 | Fixed | + beside the name. |
| W-P3-19 | P3 | Fixed | Icons. |

### 5b. Claims

Id is this audit's row number. `carried` means the first audit's Match stands, not re-tested.

| Id | Source page | Claim | First | Final | Evidence |
|---|---|---|---|---|---|
| C000 | SKT-CREATE-LINES | Create > Line opens tool; click places first end point | Match | Match | Line chain, typed length and angle, arc by drag. |
| C001 | SKT-CREATE-LINES | Click second point places segment | Match | Match | Line chain, typed length and angle, arc by drag. |
| C002 | SKT-CREATE-LINES | Specify length and angle values, then click | Match | Match | Line chain, typed length and angle, arc by drag. |
| C003 | SKT-CREATE-LINES | Tab reaches angle when length was not typed | Wrong | Fixed | Tab then 45: line at 45 deg, length stays with the cursor (44.72). |
| C004 | SKT-CREATE-LINES | Enter after typed value places the point | Match | carried | Not re-tested. Typed 25 + Enter placed it; chain continued; second typed 10 + Enter also placed |
| C005 | SKT-CREATE-LINES | Repeat step 3 for additional straight segments | Match | Match | Line chain, typed length and angle, arc by drag. |
| C006 | SKT-CREATE-LINES | Pause over a point, click and drag for arc segment | Match | Fixed | PAUSE-1. Marked Match on drags with no pause; a real one put the press in the Length box on the end point. Arc by drag after 0, 700 and 2000 ms. |
| C007 | SKT-CREATE-LINES | Click start point closes the profile | Match | carried | Not re-tested. 4 lines, 4 coincidents, profiles=1; chain ended, tool stayed |
| C008 | SKT-CREATE-LINES | Click Check icon completes the chain | Match | carried | Not re-tested. .hud-check clicked: status back to start, tool still Line |
| C009 | SKT-CREATE-LINES | Repeat steps 2-5 for another line | Match | carried | Not re-tested. New chain after check, not joined to the old one |
| C010 | SKT-CREATE-LINES | Press Enter completes the tool | Match | carried | Not re-tested. Enter with no typed value: tool=select |
| C011 | SKT-CREATE-LINES | Result shows lines, construction, constraints, dimensions | Match | carried | Not re-tested. Screens line-snaps, line-typed-after |
| C012 | SKT-CREATE-LINES | Tip: switch Line types in palette while active | Match | carried | Not re-tested. Palette Type row Line/Midpoint Line; click switches tool; in-progress chain ends, placed segments stay |
| C013 | SKT-CREATE-LINES | Tip: arc is tangent to previous segment | Match | Match | Line chain, typed length and angle, arc by drag. |
| C014 | SKT-CREATE-LINES | Tip: move to opposite side flips arc | Match | carried | Not re-tested. One drag from above to below the line: arc ended on the lower side (flip-a, flip-b) |
| C015 | SKT-CREATE-LINES | Tip: specify a radius before creating additional segments | Match | carried | Not re-tested. Typed 15 during drag: r=15, dimension d1 radius 15 mm |
| C016 | SKT-CREATE-LINES | Tip: object snap symbols near geometry and logical constraints added | Match | carried | Not re-tested. Coincident/midpoint/on-axis badges; origin click + axis click produce coincident constraints; H/V added on axis-free lines |
| C017 | SKT-CREATE-LINES | Tip: snap symbol also shown when snapping to the sketch grid | Partial | Fixed | Snap on: blue + symbol at grid point (35,20), inference grid. |
| C018 | SKT-CREATE-MIDPOINT-LINES | Create > Midpoint Line, click to specify midpoint | Match | Match | Midpoint Line. |
| C019 | SKT-CREATE-MIDPOINT-LINES | Click to place end of line | Match | carried | Not re-tested. (-20,-20)-(20,-20) from midpoint (0,-20) end (20,-20) |
| C020 | SKT-CREATE-MIDPOINT-LINES | Specify length value, then click | Match | Match | Midpoint Line. |
| C021 | SKT-CREATE-MIDPOINT-LINES | Specify angle value, then click | Missing | Fixed | Midpoint Line 40, Tab, 30: length 40, angle 30, both dimensioned. |
| C022 | SKT-CREATE-MIDPOINT-LINES | Press Enter completes the tool | Match | Match | Midpoint Line. |
| C023 | SKT-CREATE-MIDPOINT-LINES | Tip: switch Line types while Midpoint Line active | Match | carried | Not re-tested. Palette to Line works, tool=line |
| C024 | SKT-CREATE-MIDPOINT-LINES | Repeat without leaving tool | Match | carried | Not re-tested. Second midpoint line placed without reselecting |
| C025 | SKT-SKETCH-CREATE-LINES | Line tool creates connected lines and arcs | Match | Match | Line chain, typed length and angle, arc by drag. |
| C026 | SKT-SKETCH-CREATE-LINES | Geometry can be construction | Match | carried | Not re-tested. Palette Construction on: line[construction] |
| C027 | SKT-SKETCH-CREATE-LINES | Palette type switch without returning to toolbar | Match | carried | Not re-tested. Tested Line and Midpoint Line both ways |
| C028 | SKT-SKETCH-CREATE-LINES | Midpoint Line: specify length and angle | Missing | Fixed | As C021. |
| C029 | SKT-CREATE-ARCS | 3-Point: click first end point | Match | Match | Arcs and circles re-driven through other repros. |
| C030 | SKT-CREATE-ARCS | 3-Point: specify a distance, then click second end | Match | carried | Not re-tested. Typed 40: arc ends 40 apart, dim d1 distance 40 mm |
| C031 | SKT-CREATE-ARCS | 3-Point: click third point on arc | Match | Match | Arcs and circles re-driven through other repros. |
| C032 | SKT-CREATE-ARCS | 3-Point: repeat without leaving tool | Match | carried | Not re-tested. Second arc placed; a radius field is also offered (typed 50 gave r=50, dim) |
| C033 | SKT-CREATE-ARCS | 3-Point: Enter completes tool | Match | carried | Not re-tested. tool=select; a pending first click is dropped |
| C034 | SKT-CREATE-ARCS | Center Point: click center, first end | Match | carried | Not re-tested. Center (0,0), start (30,0) |
| C035 | SKT-CREATE-ARCS | Center Point: click second point | Match | carried | Not re-tested. Sweep tracks cursor; went past 180 to 270 ccw without flipping |
| C036 | SKT-CREATE-ARCS | Center Point: specify angle value | Match | carried | Not re-tested. Typed 90: end at (0,30); dim 90 deg plus two construction radii |
| C037 | SKT-CREATE-ARCS | Center Point: repeat, Enter | Match | carried | Not re-tested. Three arcs in one activation; Enter ends |
| C038 | SKT-CREATE-ARCS | Tangent: first end point coincides with geometry that gets the tangent | Partial | Fixed | Tangent Arc starts mid-line and on a circle rim, tangent recorded each time. |
| C039 | SKT-CREATE-ARCS | Tangent: click second point | Match | Match | Arcs and circles re-driven through other repros. |
| C040 | SKT-CREATE-ARCS | Tangent: specify radius value | Match | carried | Not re-tested. Typed 30: r=30, dim d1 radius 30 mm |
| C041 | SKT-CREATE-ARCS | Tangent: repeat steps, Enter | Match | carried | Not re-tested. Chained second arc off first arc end; Enter ends |
| C042 | SKT-CREATE-ARCS | Tip: switch Arc types while any arc tool active | Match | carried | Not re-tested. All three buttons in Feature Options; switch mid-step resets pending picks |
| C043 | SKT-CREATE-ARCS | Tip: snapping adds logical constraints | Match | carried | Not re-tested. Arc ends on line ends: coincident; center at origin: coincident |
| C044 | SKT-SKETCH-CREATE-ARCS | Three arc tools listed; as sketch or construction geometry | Match | Match | Arcs and circles re-driven through other repros. |
| C045 | SKT-SKETCH-CREATE-ARCS | Center Point Arc defined by center and 2 ends, or angle | Match | carried | Not re-tested. As above |
| C046 | SKT-SKETCH-CREATE-ARCS | Tangent Arc maintains tangency at each end | Partial | Fixed | Landing along the next line gives tangent at both ends (2 tangents). Not aligned: start only, which is the geometry. |
| C047 | SKT-CREATE-CIRCLES | Center Diameter: click center | Match | Match | Arcs and circles re-driven through other repros. |
| C048 | SKT-CREATE-CIRCLES | Center Diameter: specify diameter, click | Match | carried | Not re-tested. Typed 40, click far away: c=(10,10) r=20, dim diameter 40 mm |
| C049 | SKT-CREATE-CIRCLES | Center Diameter: Enter after typing places it | Match | Match | Arcs and circles re-driven through other repros. |
| C050 | SKT-CREATE-CIRCLES | Center Diameter: repeat, Enter ends | Match | carried | Not re-tested. Two circles; Enter with no value ends |
| C051 | SKT-CREATE-CIRCLES | 2-Point: click first point, second point | Match | Match | Arcs and circles re-driven through other repros. |
| C052 | SKT-CREATE-CIRCLES | 2-Point: specify diameter value, click | Match | carried | Not re-tested. Typed 30: r=15, direction from cursor, dim |
| C053 | SKT-CREATE-CIRCLES | 2-Point: repeat, Enter | Match | carried | Not re-tested. OK |
| C054 | SKT-CREATE-CIRCLES | 3-Point: three clicks, preview | Match | carried | Not re-tested. c=(0,0) r=20; circle3-preview3 |
| C055 | SKT-CREATE-CIRCLES | 3-Point: collinear error | Match | carried | Not re-tested. "The three points must not be in a line", step retained |
| C056 | SKT-CREATE-CIRCLES | 2-Tangent: select 2 lines | Match | Match | Arcs and circles re-driven through other repros. |
| C057 | SKT-CREATE-CIRCLES | 2-Tangent: click to place, centre tracks | Match | Match | Arcs and circles re-driven through other repros. |
| C058 | SKT-CREATE-CIRCLES | 2-Tangent: specify radius, click | Match | carried | Not re-tested. Typed 10: r=10 tangent to both, dim radius 10 mm; typed + Enter also works |
| C059 | SKT-CREATE-CIRCLES | 2-Tangent: repeat, Enter | Match | carried | Not re-tested. Selection resets to 0 of 2; Enter ends |
| C060 | SKT-CREATE-CIRCLES | 2-Tangent: parallel lines | Partial | Fixed | Typed 5 between parallels: r stays 20, lines stay, note says the distance sets the radius. |
| C061 | SKT-CREATE-CIRCLES | 3-Tangent: select 3 lines | Match | carried | Not re-tested. Incircle c=(0,5.953) r=25.953, 3 tangents, committed on third pick |
| C062 | SKT-CREATE-CIRCLES | 3-Tangent: repeat, Enter | Match | carried | Not re-tested. Selection resets, Enter ends |
| C063 | SKT-CREATE-CIRCLES | Note: window selection of lines | Match | carried | Not re-tested. Drag over 3 lines made the circle; 2-Tangent likewise |
| C064 | SKT-CREATE-CIRCLES | Tip: switch Circle types | Match | carried | Not re-tested. All five in palette, each switch verified mid-step |
| C065 | SKT-CREATE-CIRCLES | Tip: snapping adds constraints | Match | carried | Not re-tested. Center on origin, rim through a line end, rim on a midpoint: coincident/midpoint |
| C066 | SKT-CREATE-CIRCLES | Tip: use construction and snap points to place center | Match | carried | Not re-tested. Center snapped to origin and points |
| C067 | SKT-SKETCH-CREATE-CIRCLES | Five circle tools; sketch or construction | Match | Match | Arcs and circles re-driven through other repros. |
| C068 | SKT-SKETCH-CREATE-CIRCLES | Each overview definition | Match | carried | Not re-tested. Same behaviour as SKT-CREATE-CIRCLES rows |
| C069 | SKT-CREATE-RECTANGLES | 2-Point: first corner, opposite corner | Match | Match | Rectangles and polygons. |
| C070 | SKT-CREATE-RECTANGLES | 2-Point: specify length and width, click | Match | carried | Not re-tested. 40/25 at cursor quadrant, dims 40 and 25 |
| C071 | SKT-CREATE-RECTANGLES | 2-Point: specify length only | Match | carried | Not re-tested. Typed W=15, H from cursor |
| C072 | SKT-CREATE-RECTANGLES | 2-Point: specify width only | Wrong | Fixed | Tab then 15 sets H=15, W follows cursor. |
| C073 | SKT-CREATE-RECTANGLES | 2-Point: typed + Enter places rectangle | Match | carried | Not re-tested. Also with no mouse move after first click: (0,0)-(20,10) |
| C074 | SKT-CREATE-RECTANGLES | 2-Point: repeat, Enter | Match | carried | Not re-tested. OK |
| C075 | SKT-CREATE-RECTANGLES | 3-Point: first, second corner, third corner | Match | Match | Rectangles and polygons. |
| C076 | SKT-CREATE-RECTANGLES | 3-Point: typed length and width | Match | carried | Not re-tested. 30 then 10 each with click; dims 30 and 10 |
| C077 | SKT-CREATE-RECTANGLES | 3-Point: repeat, Enter | Match | carried | Not re-tested. OK |
| C078 | SKT-CREATE-RECTANGLES | Center: center, corner | Match | Match | Rectangles and polygons. |
| C079 | SKT-CREATE-RECTANGLES | Center: typed length and width | Match | carried | Not re-tested. 30 x 10 about center, dims |
| C080 | SKT-CREATE-RECTANGLES | Center: repeat, Enter | Match | carried | Not re-tested. OK |
| C081 | SKT-CREATE-RECTANGLES | Tip: switch Rectangle types | Match | carried | Not re-tested. All 3 in palette, mid-step switch verified |
| C082 | SKT-CREATE-RECTANGLES | Tip: snapping adds constraints | Match | carried | Not re-tested. Corner on corner: coincident; start on edge midpoint: midpoint |
| C083 | SKT-SKETCH-CREATE-RECTANGLES | Three tools, sketch or construction | Match | Match | Rectangles and polygons. |
| C084 | SKT-SKETCH-CREATE-RECTANGLES | Width/height values | Match | carried | Not re-tested. See SKT-CREATE-RECTANGLES; invalid "abc" flags field red and refuses |
| C085 | SKT-CREATE-POLYGONS | Circumscribed: click center | Match | Match | Rectangles and polygons. |
| C086 | SKT-CREATE-POLYGONS | Circumscribed: specify radius of circle | Match | carried | Not re-tested. Typed 20: edge midpoints on r=20 (11.09,16.64 is r=20) |
| C087 | SKT-CREATE-POLYGONS | Circumscribed: Tab from radius to sides | Wrong | Fixed | Tab then 7: 7 sides, radius from cursor. |
| C088 | SKT-CREATE-POLYGONS | Circumscribed: specify number of sides | Match | carried | Not re-tested. 8 sides |
| C089 | SKT-CREATE-POLYGONS | Circumscribed: move to orient | Match | carried | Not re-tested. Edge midpoint faces cursor (angle 56.3°) |
| C090 | SKT-CREATE-POLYGONS | Circumscribed: click, repeat, Enter | Match | carried | Not re-tested. Sides remembered; Enter ends |
| C091 | SKT-CREATE-POLYGONS | Inscribed: same sequence; vertices on circle | Match | Match | Rectangles and polygons. |
| C092 | SKT-CREATE-POLYGONS | Edge: click first point | Match | Match | Rectangles and polygons. |
| C093 | SKT-CREATE-POLYGONS | Edge: length, Tab, angle, Enter or click | Match | carried | Not re-tested. 20 Tab 30 Enter: edge (0,0)-(17.32,10) |
| C094 | SKT-CREATE-POLYGONS | Edge: specify sides | Match | Match | Rectangles and polygons. |
| C095 | SKT-CREATE-POLYGONS | Edge: move to choose side, click | Match | Match | Rectangles and polygons. |
| C096 | SKT-CREATE-POLYGONS | Edge: repeat, Enter | Match | carried | Not re-tested. OK |
| C097 | SKT-CREATE-POLYGONS | Result shows construction, constraints, dimensions | Partial | Fixed | Badges laid out clear of each other; 12 on a hexagon, no staircase. |
| C098 | SKT-CREATE-POLYGONS | Tip: switch Polygon types | Match | carried | Not re-tested. All 3, mid-step verified |
| C099 | SKT-CREATE-POLYGONS | Prompt text accurate | Partial | Fixed | Prompt reads "Type the number of sides, move to the side...". |
| C100 | SKT-SKETCH-CREATE-POLYGONS | Three tools, sketch or construction | Match | Match | Rectangles and polygons. |
| C101 | SKT-SKETCH-CREATE-POLYGONS | Definitions match | Match | carried | Not re-tested. As above |
| C102 | SKT-CREATE-ELLIPSE | Click center | Match | Match | Ellipse. |
| C103 | SKT-CREATE-ELLIPSE | Specify length of the axis | Partial | Partial | P3. Unchanged: typed 40 gives 40 centre to end (semi-axis). Page ambiguous. |
| C104 | SKT-CREATE-ELLIPSE | Tab from length to angle | Match | carried | Not re-tested. After typing; P1 F3 applies if length untyped |
| C105 | SKT-CREATE-ELLIPSE | Specify angle of axis | Match | carried | Not re-tested. 30 deg: major at (34.64,20), dim |
| C106 | SKT-CREATE-ELLIPSE | Enter or click places first axis point | Match | carried | Not re-tested. Both |
| C107 | SKT-CREATE-ELLIPSE | Specify length, then Enter | Match | Match | Ellipse. |
| C108 | SKT-CREATE-ELLIPSE | Or click a second point along ellipse | Match | Match | Ellipse. |
| C109 | SKT-CREATE-ELLIPSE | Repeat, Enter | Match | carried | Not re-tested. OK; point beyond axis refused with message |
| C110 | SKT-CREATE-ELLIPSE | Tip: snapping adds constraints | Match | carried | Not re-tested. Center at origin, rim point on line midpoint: midpoint added |
| C111 | SKT-SKETCH-CREATE-ELLIPSES | Ellipse as sketch or construction | Match | Match | Ellipse. |
| C112 | SKT-SKETCH-CREATE-ELLIPSES | Center, major axis, point on ellipse | Match | Match | Ellipse. |
| C113 | SKT-CREATE-SLOTS | Center To Center: click center, distance, Tab, angle, click | Match | Match | Slots. |
| C114 | SKT-CREATE-SLOTS | Center To Center: width value, click | Match | Match | Slots. |
| C115 | SKT-CREATE-SLOTS | Center To Center: click width | Match | carried | Not re-tested. Width from cursor |
| C116 | SKT-CREATE-SLOTS | Center To Center: repeat, Enter | Match | carried | Not re-tested. OK |
| C117 | SKT-CREATE-SLOTS | Example image: tangent and parallel glyphs | Partial | Fixed | Slot now has a parallel constraint on its sides. |
| C118 | SKT-CREATE-SLOTS | Example image: 15° measured to a local horizontal | Partial | Fixed | 15.0 deg arc drawn at the slot on a short local horizontal, labels apart. |
| C119 | SKT-CREATE-SLOTS | Overall: end points, distance, Tab, angle, click | Match | Match | Slots. |
| C120 | SKT-CREATE-SLOTS | Overall: width, click | Match | Match | Slots. |
| C121 | SKT-CREATE-SLOTS | Overall example image: 50.00 dimension end to end, end points with midpoint glyphs | Wrong | Fixed | Overall Slot: d1 = 50 between real end points, 2 midpoints. |
| C122 | SKT-CREATE-SLOTS | Overall: repeat, Enter | Match | carried | Not re-tested. OK; too-wide refused |
| C123 | SKT-CREATE-SLOTS | Center Point: center, distance, Tab, angle, click, width | Match | Match | Slots. |
| C124 | SKT-CREATE-SLOTS | Center Point: repeat, Enter | Match | carried | Not re-tested. OK |
| C125 | SKT-CREATE-SLOTS | 3 Point Arc: center, distance, click | Match | Match | Slots. |
| C126 | SKT-CREATE-SLOTS | 3 Point Arc: click point on arc | Partial | Fixed | Arc previewed before the width step. |
| C127 | SKT-CREATE-SLOTS | 3 Point Arc: width, click | Match | carried | Not re-tested. Typed 20: arcs r=15/35, caps r=10, 2 concentric |
| C128 | SKT-CREATE-SLOTS | 3 Point Arc: repeat, Enter | Match | carried | Not re-tested. OK; radius can be typed |
| C129 | SKT-CREATE-SLOTS | Center Point Arc: center, distance, click | Match | Match | Slots. |
| C130 | SKT-CREATE-SLOTS | Center Point Arc: angle between ends, click | Partial | Fixed | Arc previewed during the angle step; 180 typed, slot built. |
| C131 | SKT-CREATE-SLOTS | Center Point Arc: width, click | Match | carried | Not re-tested. Ø20, R25, 180°, dof 0 |
| C132 | SKT-CREATE-SLOTS | Center Point Arc: repeat, Enter | Match | carried | Not re-tested. OK |
| C133 | SKT-CREATE-SLOTS | Tip: switch Slot types | Match | carried | Not re-tested. All 5 in palette, mid-step verified |
| C134 | SKT-CREATE-SLOTS | Tip: snapping adds constraints | Match | carried | Not re-tested. Slot end on origin: coincident |
| C135 | SKT-SKETCH-CREATE-SLOTS | Five tools, sketch or construction | Match | Match | Slots. |
| C136 | SKT-SKETCH-CREATE-SLOTS | Width or diameter of the slot arcs | Match | carried | Not re-tested. Single value is the diameter |
| C137 | SKT-SKETCH-CREATE-SLOTS | 3 Point Arc: third point or center arc radius | Match | carried | Not re-tested. Typed R=40 |
| C138 | SKT-SKETCH-CREATE-SLOTS | Overall: start and end of slot centerline | Partial | Fixed | As C121. |
| C139 | SKT-CREATE-SPLINES | Fit: click first, next, continue | Match | Match | Splines; degree change alters shape as stated. |
| C140 | SKT-CREATE-SPLINES | Fit: click start point closes | Match | Match | Splines; degree change alters shape as stated. |
| C141 | SKT-CREATE-SPLINES | Fit: Check icon completes | Match | carried | Not re-tested. Spline stored, tool stays |
| C142 | SKT-CREATE-SPLINES | Fit: repeat, Enter ends | Match | carried | Not re-tested. OK; Enter with pending points finishes the spline first, then a second Enter ends the tool |
| C143 | SKT-CREATE-SPLINES | Fit: GIF check icon only after spline is usable | Partial | Fixed | No check after 1 point; check after 2. |
| C144 | SKT-CREATE-SPLINES | Control: optional Spline Degree before placing | Partial | Fixed | Degree 3 and 5 buttons ahead of the list of 1 to 9. |
| C145 | SKT-CREATE-SPLINES | Control: first, next, continue, Check | Match | Match | Splines; degree change alters shape as stated. |
| C146 | SKT-CREATE-SPLINES | Control: repeat, Enter | Match | carried | Not re-tested. OK; degree 3 kept for the next spline |
| C147 | SKT-CREATE-SPLINES | Control: fewer than 3 points | Match | carried | Not re-tested. Warns, spline not made |
| C148 | SKT-CREATE-SPLINES | Edit: Select spline displays curvature handles | Wrong | Fixed | Selecting the spline or a fit point shows two-ended green handles. |
| C149 | SKT-CREATE-SPLINES | Edit: drag handle end adjusts curvature | Partial | Fixed | Handle shows on selection, dragging it bends the spline, one undo reverts. |
| C150 | SKT-CREATE-SPLINES | Right-click: Open/Close Spline Curve (fit only) | Match | carried | Not re-tested. Close and Open both worked |
| C151 | SKT-CREATE-SPLINES | Right-click: Insert Spline Fit Point | Match | carried | Not re-tested. pts +1, shape kept near pick |
| C152 | SKT-CREATE-SPLINES | Right-click: Insert Spline Control Point | Match | carried | Not re-tested. n=4→5 |
| C153 | SKT-CREATE-SPLINES | Right-click: Toggle Curvature Display | Match | carried | Not re-tested. Comb drawn; fit-comb-on.png |
| C154 | SKT-CREATE-SPLINES | Setup Curvature Display dialog: Density, Scale | Partial | Fixed | Setup Curvature Display dialog from the right-click menu: Density, Scale. |
| C155 | SKT-CREATE-SPLINES | Fit: Activate Curvature Handle | Match | carried | Not re-tested. Marking menu on fit point; handles count 1 |
| C156 | SKT-CREATE-SPLINES | Fit: Deactivate Curvature Handle | Match | carried | Not re-tested. handles count 0 |
| C157 | SKT-CREATE-SPLINES | Change Spline Degree drop-down | Partial | Fixed | Drop-down 1 to 9; 2 and 9 applied, undo restores. |
| C158 | SKT-CREATE-SPLINES | Increase degree adds control points | Match | Match | Splines; degree change alters shape as stated. |
| C159 | SKT-CREATE-SPLINES | Decrease degree lowers control points; alters shape | Match | Match | Splines; degree change alters shape as stated. |
| C160 | SKT-CREATE-SPLINES | Tip: drag from end of line/arc/spline creates tangent (fit spline) | Match | Match | Splines; degree change alters shape as stated. |
| C161 | SKT-CREATE-SPLINES | Tip: same drag with Control Point Spline | Wrong | Fixed | Clicks kept, tangent recorded, no over-constraint, both a vertical and a horizontal line. |
| C162 | SKT-CREATE-SPLINES | Tip: snapping adds constraints | Match | carried | Not re-tested. Spline ends on line ends: coincident |
| C163 | SKT-CREATE-SPLINES | Tip: Move/Copy select a spline point shows or hides all manipulators | Missing | Fixed | In Move/Copy a fit point click shows that spline's handles, a second click hides them, and a handle drags. |
| C164 | SKT-CREATE-SPLINES | Tip: Move/Copy drag keeps point on the plane | N/A-3D | N/A-3D | 2D app: nothing can leave the plane; the handles do not exist (F25) |
| C165 | SKT-CREATE-SPLINES | Palette switch between spline types | Match | carried | Not re-tested. Works; pending points dropped |
| C166 | SKT-SKETCH-CREATE-SPLINES | Fit and Control tools, open or closed | Match | Match | Splines; degree change alters shape as stated. |
| C167 | SKT-SKETCH-CREATE-SPLINES | Control spline passes through first and last only | Match | carried | Not re-tested. cp-done: curve hits ends only |
| C168 | SKT-SKETCH-CREATE-SPLINES | Control points pull curve | Match | carried | Not re-tested. Degree change and frame shown; drag not quantified |
| C169 | SKT-SKETCH-CREATE-SPLINES | Control splines offer no handles | Match | carried | Not re-tested. Menu has no handle items |
| C170 | SKT-SKETCH-CREATE-SPLINES | GIF: frame shown after completion when selected | Match | carried | Not re-tested. Dashed frame on selection |
| C171 | SKT-REF-SPLINE-DEGREE-CONTROL | Degree options while tool active in palette | Match | Match | Splines; degree change alters shape as stated. |
| C172 | SKT-REF-SPLINE-DEGREE-CONTROL | Degree 5 default | Match | carried | Not re-tested. Row value 5 on fresh load |
| C173 | SKT-REF-SPLINE-DEGREE-CONTROL | Degree 5 and 3 evaluated differently | Match | carried | Not re-tested. Same control points give different curves (cp-done vs cp-deg3) |
| C174 | SKT-REF-SPLINE-DEGREE-CONTROL | Degree-3 curvature bumps shown in comb | Untested | Untested | Comb not compared numerically with spline-degree-5-3.png. Degree 3 itself works. |
| C175 | SKT-REF-SPLINE-DEGREE-CONTROL | Change Spline Degree in palette on selected spline | Partial | Fixed | As C157. |
| C176 | SKT-REF-SPLINE-DEGREE-CONTROL | Icons for the two degree options | Partial | Fixed | As C144. |
| C177 | SKT-REF-SPLINE-DEGREE-CONTROL | Increase/decrease changes control point count | Match | carried | Not re-tested. As SKT-CREATE-SPLINES |
| C178 | SKT-CREATE-CONIC-CURVE | Click first end, second end | Match | Match | Conic and Point. |
| C179 | SKT-CREATE-CONIC-CURVE | Click vertex point | Match | Match | Conic and Point. |
| C180 | SKT-CREATE-CONIC-CURVE | Drag Rho handle | Wrong | Fixed | Dragged to 0.8, moved away, Enter: rho 0.8 stored. |
| C181 | SKT-CREATE-CONIC-CURVE | Specify exact Rho | Match | carried | Not re-tested. 0.3 + Enter: rho=0.3 |
| C182 | SKT-CREATE-CONIC-CURVE | Default Rho | Wrong | Fixed | Enter straight after the vertex stores 0.5. |
| C183 | SKT-CREATE-CONIC-CURVE | Press Enter completes the tool | Partial | Fixed | One Enter commits and leaves the tool. |
| C184 | SKT-CREATE-CONIC-CURVE | Curve, end points, vertex display | Match | carried | Not re-tested. conic-res: vertex dot and dashed guides persist |
| C185 | SKT-CREATE-CONIC-CURVE | Tip: snapping adds constraints | Match | carried | Not re-tested. End on line end: coincident |
| C186 | SKT-SKETCH-CREATE-CONIC-CURVES | Curve driven by endpoints and Rho | Match | Match | Conic and Point. |
| C187 | SKT-SKETCH-CREATE-CONIC-CURVES | Elliptical, parabolic, hyperbolic by Rho | Match | carried | Not re-tested. Shape visibly varies; conic-rho vs conic-res. Not measured against the formula |
| C188 | SKT-SKETCH-CREATE-CONIC-CURVES | Use guidelines to create a tangency constraint | Partial | Fixed | Vertex on a line corner: 2 tangents. |
| C189 | SKT-SKETCH-CREATE-CONIC-CURVES | Construction option | Match | carried | Not re-tested. cn16 conic[construction] |
| C190 | SKT-CREATE-POINT | Click creates point | Match | Match | Conic and Point. |
| C191 | SKT-CREATE-POINT | Snap to grid | Match | carried | Not re-tested. Snap on: (33.1,31.2)→(35,30) |
| C192 | SKT-CREATE-POINT | Snap to geometry | Match | Match | Conic and Point. |
| C193 | SKT-CREATE-POINT | Continue clicking, Enter | Match | carried | Not re-tested. OK |
| C194 | SKT-SKETCH-CREATE-POINTS | Points as construction geometry | Match | carried | Not re-tested. Survive deletion, not in profiles |
| C195 | SKT-SKETCH-CREATE-POINTS | Connect the dots with entities | Match | carried | Not re-tested. Line snapped to projected and explicit points |
| C196 | SKT-SKETCH-CREATE-POINTS | Hole features, construction planes | N/A-3D | N/A-3D | Needs 3D; not in app |
| C197 | SKT-CREATE-MIRROR | Create > Mirror opens dialog | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C198 | SKT-CREATE-MIRROR | Select geometry to mirror | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C199 | SKT-CREATE-MIRROR | Click Mirror Line in dialog | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C200 | SKT-CREATE-MIRROR | Select line or axis | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C201 | SKT-CREATE-MIRROR | Click OK | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C202 | SKT-CREATE-MIRROR | Tip: construction or regular line | Match | carried | Not re-tested. Both |
| C203 | SKT-CREATE-MIRROR | Tip: mirror line cannot have curvature | Match | carried | Not re-tested. Arc refused: "The mirror line must be straight" |
| C204 | SKT-CREATE-MIRROR | Mirror sketch points | Partial | Fixed | Point picked, mirrored, symmetric constraint. |
| C205 | SKT-CREATE-CIRCULAR-PATTERN | Create > Circular Pattern dialog | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C206 | SKT-CREATE-CIRCULAR-PATTERN | Select geometry, Center Point | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C207 | SKT-CREATE-CIRCULAR-PATTERN | Full: evenly around circle | Match | carried | Not re-tested. q3: 0, 120, 240° |
| C208 | SKT-CREATE-CIRCULAR-PATTERN | Angle: total angle in one direction | Match | carried | Not re-tested. 90° q4 preview at 0, 30, 60, 90 |
| C209 | SKT-CREATE-CIRCULAR-PATTERN | Symmetric: about the original | Match | carried | Not re-tested. ±45 q4 positions |
| C210 | SKT-CREATE-CIRCULAR-PATTERN | Drag angle handle or type | Match | carried | Not re-tested. Handle drag 180→90 deg |
| C211 | SKT-CREATE-CIRCULAR-PATTERN | Drag quantity handle or type | Match | carried | Not re-tested. Handle 3→6 |
| C212 | SKT-CREATE-CIRCULAR-PATTERN | OK | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C213 | SKT-CREATE-CIRCULAR-PATTERN | Double-click glyph at the center of the pattern | Wrong | Fixed | Glyph at the pattern centre opens the dialog; double-click on the source does not. |
| C214 | SKT-CREATE-CIRCULAR-PATTERN | Edit dialog, OK updates | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C215 | SKT-CREATE-CIRCULAR-PATTERN | Tip: uncheck instance box suppresses | Match | carried | Not re-tested. 6→5 instances |
| C216 | SKT-CREATE-CIRCULAR-PATTERN | Tip: uncheck Suppress removes boxes | Match | carried | Not re-tested. Boxes gone in canvas |
| C217 | SKT-CREATE-CIRCULAR-PATTERN | Pattern sketch points | Partial | Fixed | Point picked and patterned. |
| C218 | SKT-CREATE-RECTANGULAR-PATTERN | Create > Rectangular Pattern dialog | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C219 | SKT-CREATE-RECTANGULAR-PATTERN | Select geometry | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C220 | SKT-CREATE-RECTANGULAR-PATTERN | Optional direction lines | Match | carried | Not re-tested. Line used for Direction 1 and for Direction 2 |
| C221 | SKT-CREATE-RECTANGULAR-PATTERN | Extent: copies along overall distance | Match | carried | Not re-tested. q3 d20: 0, 10, 20 |
| C222 | SKT-CREATE-RECTANGULAR-PATTERN | Spacing: each copy at distance | Match | carried | Not re-tested. q4 s60 preview and result |
| C223 | SKT-CREATE-RECTANGULAR-PATTERN | Quantity: drag or type | Match | carried | Not re-tested. Handle 3→9 |
| C224 | SKT-CREATE-RECTANGULAR-PATTERN | Distance: drag or type | Match | carried | Not re-tested. Arrow 20→40 |
| C225 | SKT-CREATE-RECTANGULAR-PATTERN | One Direction | Match | carried | Not re-tested. Default |
| C226 | SKT-CREATE-RECTANGULAR-PATTERN | Symmetric | Match | carried | Not re-tested. q3 extent d20: -20,-10,0,10,20 |
| C227 | SKT-CREATE-RECTANGULAR-PATTERN | OK | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C228 | SKT-CREATE-RECTANGULAR-PATTERN | Double-click glyph next to the original | Match | carried | Not re-tested. Opened; q 3→2 updated |
| C229 | SKT-CREATE-RECTANGULAR-PATTERN | Tip: uncheck instance box suppresses | Match | carried | Not re-tested. suppressed ["1,0"], instance gone |
| C230 | SKT-CREATE-RECTANGULAR-PATTERN | Tip: uncheck Suppress removes boxes | Match | carried | Not re-tested. rp-s2 |
| C231 | SKT-SKETCH-CREATE-MIRRORS-PATTERNS | Mirror adds a Symmetry constraint | Match | Match | Mirror and patterns; pattern re-opens from its glyph. |
| C232 | SKT-SKETCH-CREATE-MIRRORS-PATTERNS | Identical patterns of sketch or construction geometry | Match | carried | Not re-tested. Mirror and circular pattern of construction curves stayed construction |
| C233 | SKT-SKETCH-CREATE-MIRRORS-PATTERNS | Mirror only works for sketch geometry | Match | carried | Not re-tested. Only curves accepted |
| C234 | SKT-SKETCH-CREATE-MIRRORS-PATTERNS | Rectangular one or two directions; suppress | Match | carried | Not re-tested. As page rows |
| C235 | SKT-SKETCH-CREATE-MIRRORS-PATTERNS | Circular around center; suppress | Match | carried | Not re-tested. As page rows |
| C236 | SKT-SKETCH-CREATE-MIRRORS-PATTERNS | Image: arrows, quantity handle, check boxes | Match | carried | Not re-tested. rp-1 matches rectangular-pattern.png |
| C237 | SKT-CREATE-TEXT | Create > Text opens dialog | Match | Match | Text frame and path, Explode with undo and redo. |
| C238 | SKT-CREATE-TEXT | Select Text from Type dropdown | Match | carried | Not re-tested. Text, Text On Path |
| C239 | SKT-CREATE-TEXT | Click first corner, opposite corner | Match | Match | Text frame and path, Explode with undo and redo. |
| C240 | SKT-CREATE-TEXT | OK needs both corners | Partial | Fixed | OK disabled after one corner, enabled after two. |
| C241 | SKT-CREATE-TEXT | Rotation handle or angle | Match | carried | Not re-tested. Handle drag and Angle field |
| C242 | SKT-CREATE-TEXT | Click snap point to change rotation pivot | Wrong | Fixed | Clicked frame centre at 30 deg: frame stays, status stays; 60 deg turned about that centre. |
| C243 | SKT-CREATE-TEXT | Enter text in Text box | Match | Match | Text frame and path, Explode with undo and redo. |
| C244 | SKT-CREATE-TEXT | Enter more than one line | Wrong | Fixed | Enter adds a line, dialog stays open. |
| C245 | SKT-CREATE-TEXT | Curly braces for expression | Match | carried | Not re-tested. {d1}→30, {2*d1}→60 |
| C246 | SKT-CREATE-TEXT | Reference a text parameter | Missing | Fixed | {Text1_text} reads the other text and follows it. Add User Parameter has a Text unit; {PartNumber} works. A loop stops with braces. A deleted text does not renumber the others. |
| C247 | SKT-CREATE-TEXT | Type a parameter name and select it | Missing | Fixed | Typing {d lists d1; picking inserts it. |
| C248 | SKT-CREATE-TEXT | Font | Match | carried | Not re-tested. Inter, JetBrains Mono, Zilla Slab render differently |
| C249 | SKT-CREATE-TEXT | Typeface bold, italic | Match | carried | Not re-tested. Both render |
| C250 | SKT-CREATE-TEXT | Height | Match | Match | Text frame and path, Explode with undo and redo. |
| C251 | SKT-CREATE-TEXT | Character Spacing | Match | carried | Not re-tested. 50% widens |
| C252 | SKT-CREATE-TEXT | Flip horizontal, vertical | Match | carried | Not re-tested. Both render |
| C253 | SKT-CREATE-TEXT | Alignment horizontal and vertical | Match | carried | Not re-tested. All combinations tried render |
| C254 | SKT-CREATE-TEXT | Text displays inside the text frame | Wrong | Fixed | Wraps inside the frame; dimensioned wider, it reflowed from more rows to 2. |
| C255 | SKT-CREATE-TEXT | New text model parameter in Parameters dialog | Missing | Fixed | Text1_text and Text1_height listed; editing them changed the text. |
| C256 | SKT-CREATE-TEXT | Text On Path: select from dropdown | Match | Match | Text frame and path, Explode with undo and redo. |
| C257 | SKT-CREATE-TEXT | Text On Path: click curve | Match | Match | Text frame and path, Explode with undo and redo. |
| C258 | SKT-CREATE-TEXT | Text On Path: placement, fit, flip, alignment | Match | carried | Not re-tested. All render; compared with GIF frames |
| C259 | SKT-CREATE-TEXT | Text On Path: text adapts when path changes | Match | carried | Not re-tested. tp-moved |
| C260 | SKT-CREATE-TEXT | Tip: dimension and constrain the frame | Partial | Fixed | Dimension took the top edge (120); Tangent took the bottom edge and a circle. |
| C261 | SKT-CREATE-TEXT | GIF: orange dashed frame always shown | Partial | Fixed | Dashed orange, shown when not selected. |
| C262 | SKT-CREATE-TEXT | Tip: on a circle use Move/Copy to rotate text | Wrong | Fixed | Text on circle picked by letter, Move/Copy Z Angle rotated it along the circle. |
| C263 | SKT-CREATE-TEXT | Tip: single line font warning for Emboss | N/A-3D | N/A-3D | Emboss needs 3D |
| C264 | SKT-REF-TEXT-DIALOG | Type options | Match | Match | Text frame and path, Explode with undo and redo. |
| C265 | SKT-REF-TEXT-DIALOG | Text, multi-line | Wrong | Fixed | As C244. |
| C266 | SKT-REF-TEXT-DIALOG | Curly braces | Match | carried | Not re-tested. Numeric parameters and expressions |
| C267 | SKT-REF-TEXT-DIALOG | Image: wrap inside frame | Wrong | Fixed | As C254. |
| C268 | SKT-REF-TEXT-DIALOG | Path, Text On Path only | Match | carried | Not re-tested. Row hidden for Text |
| C269 | SKT-REF-TEXT-DIALOG | Font list | Match | Match | Text frame and path, Explode with undo and redo. |
| C270 | SKT-REF-TEXT-DIALOG | Single line fonts at top with SHX suffix | Missing | Missing | P3. Fonts: Inter, JetBrains Mono, Zilla Slab. No SHX. |
| C271 | SKT-REF-TEXT-DIALOG | Bold, Italic buttons | Partial | Fixed | Icon buttons. |
| C272 | SKT-REF-TEXT-DIALOG | Height in units | Match | carried | Not re-tested. Expression field |
| C273 | SKT-REF-TEXT-DIALOG | Character spacing percent, 0% default | Match | carried | Not re-tested. 0 default |
| C274 | SKT-REF-TEXT-DIALOG | Placement above, below, Text On Path only | Match | carried | Not re-tested. Compared with placement GIF |
| C275 | SKT-REF-TEXT-DIALOG | Fit to Path | Match | carried | Not re-tested. Compared with GIF |
| C276 | SKT-REF-TEXT-DIALOG | Flip icons | Partial | Fixed | Icon buttons. |
| C277 | SKT-REF-TEXT-DIALOG | Alignment icons, Vertical Text type only | Partial | Fixed | Icon choices. |
| C278 | SKT-REF-TEXT-DIALOG | text-frame GIF: 9 snap points on frame | Missing | Fixed | 9 snap points visible on the frame. |
| C279 | SKT-SKETCH-CREATE-TEXT | Text in frame or along path | Match | Match | Text frame and path, Explode with undo and redo. |
| C280 | SKT-SKETCH-CREATE-TEXT | Text profile usable as 3D | N/A-3D | N/A-3D | Extrude/Emboss absent |
| C281 | SKT-SKETCH-CREATE-TEXT | Rotation handle | Match | carried | Not re-tested. Yes |
| C282 | SKT-SKETCH-CREATE-TEXT | Snap point pivot | Wrong | Fixed | As C242. |
| C283 | SKT-SKETCH-CREATE-TEXT | Dimension and constrain frame | Partial | Fixed | As C260. |
| C284 | SKT-SKETCH-CREATE-TEXT | Modify path, text adjusts | Match | carried | Not re-tested. Yes |
| C285 | SKT-SKETCH-CREATE-TEXT | Move/Copy on circle | Wrong | Fixed | As C262. |
| C286 | SKT-SKETCH-CREATE-TEXT | Two parameters automatically created | Missing | Fixed | As C255. |
| C287 | SKT-SKETCH-CREATE-TEXT | Image: text on circle reads over the top | Partial | Fixed | Reads over the top from nine o clock. |
| C288 | SKT-EXPLODE-TEXT | Right-click the text | Wrong | Fixed | Right-click on a letter offers Explode Text. |
| C289 | SKT-EXPLODE-TEXT | Select Explode Text | Match | Match | Text frame and path, Explode with undo and redo. |
| C290 | SKT-EXPLODE-TEXT | Converts to fixed sketch geometry | Match | Match | Text frame and path, Explode with undo and redo. |
| C291 | SKT-EXPLODE-TEXT | Text and height parameters deleted on explode | Untested | Fixed | After Explode, both parameters gone from the dialog. |
| C292 | SKT-EXPLODE-TEXT | Tip: modify like regular geometry | Partial | Partial | P3. Exploded curves stay fixed until UnFix. The page also says "fixed sketch geometry", so it contradicts itself. |
| C293 | SKT-EXPLODE-TEXT | Undo and redo | Match | Match | Text frame and path, Explode with undo and redo. |
| C294 | SKT-EXPLODE-TEXT | Double-click to edit before explode | Match | carried | Not re-tested. Frame edge only; letters miss |
| C295 | SKT-CONSTRUCTION-GEOMETRY | Palette Construction: new geometry is construction | Match | Match | Linetypes, dash styles. |
| C296 | SKT-CONSTRUCTION-GEOMETRY | Selected geometry: palette option | Match | Match | Linetypes, dash styles. |
| C297 | SKT-CONSTRUCTION-GEOMETRY | Right-click Normal/Construction | Match | Match | Linetypes, dash styles. |
| C298 | SKT-CONSTRUCTION-GEOMETRY | Construction not part of boundaries | Match | carried | Not re-tested. Bisector as construction: profiles 2→1 |
| C299 | SKT-CONSTRUCTION-GEOMETRY | Linetype button reflects selection | Partial | Fixed | Construction button active only when a construction curve is selected. |
| C300 | SKT-CONSTRUCTION-GEOMETRY | Dashed orange look | Match | Match | Linetypes, dash styles. |
| C301 | SKT-CENTERLINE-GEOMETRY | Palette Centerline: new geometry is centerline | Match | Match | Linetypes, dash styles. |
| C302 | SKT-CENTERLINE-GEOMETRY | Selected geometry: palette option | Match | carried | Not re-tested. To centerline and back |
| C303 | SKT-CENTERLINE-GEOMETRY | Right-click Normal/Centerline | Missing | Fixed | Marking menu lists Normal/Centerline. |
| C304 | SKT-CENTERLINE-GEOMETRY | Centerline included in boundaries | Match | Match | Linetypes, dash styles. |
| C305 | SKT-CENTERLINE-GEOMETRY | Revolve picks centerline | N/A-3D | N/A-3D | No Revolve in app |
| C306 | SKT-CENTERLINE-GEOMETRY | Dimension adds diameter automatically | Partial | Fixed | Centerline to point: diameter 71 either order; to a line: diameter 60. |
| C307 | SKT-CENTERLINE-GEOMETRY | Dash-dot look | Match | Match | Linetypes, dash styles. |
| C308 | GUID-850061C4 Project | Create > Project/Include > Project dialog | Match | Match | Project, purple, lost link shown orange. |
| C309 | GUID-850061C4 Project | Selection Filter choice | Missing | Fixed | Selection Filter row, Bodies disabled. |
| C310 | GUID-850061C4 Project | Select bodies or faces | N/A-3D | N/A-3D | No bodies or faces |
| C311 | GUID-850061C4 Project | Select edges (curves of another sketch) | Match | Match | Project, purple, lost link shown orange. |
| C312 | GUID-850061C4 Project | Select points | Missing | Fixed | Sketch point picked ("1 selected"), projected as a point. |
| C313 | GUID-850061C4 Project | Uncheck Projection Link | Match | carried | Not re-tested. line[fixed], no link |
| C314 | GUID-850061C4 Project | OK or Enter | Match | Match | Project, purple, lost link shown orange. |
| C315 | GUID-850061C4 Project | Purple display | Match | Match | Project, purple, lost link shown orange. |
| C316 | GUID-850061C4 Project | Show Projected Geometries toggle | Match | carried | Not re-tested. pj-hidden |
| C317 | GUID-850061C4 Project | Lost link: yellow warning in Timeline | N/A-3D | N/A-3D | No Timeline |
| C318 | GUID-850061C4 Project | Lost link: highlighted orange or yellow | Match | Match | Project, purple, lost link shown orange. |
| C319 | GUID-850061C4 Project | Manage Lost Projections: dialog, Re-Link, Break Link, Delete Geometry | Missing | Fixed | Dialog from a lost curve: Re-Link, Break Link, Delete Geometry. |
| C320 | GUID-850061C4 Project | Fade Other Geometry, Delete All, Break Link All | Missing | Fixed | Fade Other Geometry, Break Link All, Delete All present. |
| C321 | GUID-850061C4 Project | Tip: Bodies filter closed profiles | N/A-3D | N/A-3D | No bodies |
| C322 | GUID-850061C4 Project | Isoparametric lost-link lines | N/A-3D | N/A-3D | Needs surfaces |
| C323 | GUID-6EE7B230 Project reference | Copies of sketch entities into active sketch | Match | carried | Not re-tested. Yes, same plane |
| C324 | GUID-6EE7B230 Project reference | Sketches on another plane | Partial | Partial | P3. 3D mode: from a sketch on another plane, the XY sketch's lines lying in this plane and its points on it are shown and pickable (`e2e/fold.spec.ts`); the rest is not projected onto the plane. |
| C325 | GUID-6EE7B230 Project reference | Project work geometry (origin axes) | Match | carried | Not re-tested. Long construction line ±100 |
| C326 | GUID-6EE7B230 Project reference | Projected geometry locked | Match | Match | Project, purple, lost link shown orange. |
| C327 | GUID-6EE7B230 Project reference | Sketch on planar face auto-projects edges | N/A-3D | N/A-3D | No faces |
| C328 | GUID-6EE7B230 Project reference | Geometry field | Partial | Fixed | Geometry row. |
| C329 | GUID-6EE7B230 Project reference | Selection Filter | Missing | Fixed | Selection Filter row. |
| C330 | GUID-6EE7B230 Project reference | Projection Link associative | Match | carried | Not re-tested. Source moved: copy followed on re-entry |
| C331 | GUID-6EE7B230 Project reference | Unlink non-associative | Match | carried | Not re-tested. fixed line did not follow |
| C332 | GUID-AFD7EB76 Break link (video) | Right-click projected curve shows Break Link | Missing | Fixed | Break Link in the marking menu. |
| C333 | GUID-AFD7EB76 Break link (video) | Modify curves after break | Missing | Fixed | After Break Link the circle took a new diameter. |
| C334 | GUID-AFD7EB76 Break link (video) | Video: Project dialog with Geometry and Selection Filter | Partial | Fixed | Dialog has Selection Filter and Geometry. |
| C335 | SKT-SKETCH-CREATE-PROJECT-INCLUDE | Lists Project | Match | Match | Project, purple, lost link shown orange. |
| C336 | SKT-SKETCH-CREATE-PROJECT-INCLUDE | Lists Intersect, Include 3D, Project To Surface, Intersection Curve, Isoparametric | Match | carried | Not re-tested. All in flyout, greyed, tooltip "Needs 3D geometry" |
| C337 | SKT-SKETCH-CREATE-PROJECT-INCLUDE | Project filters and link | Partial | Fixed | As C309, C312. |
| C338 | SKT-SKETCH-CREATE-PROJECT-INCLUDE | Intersect from a sketch curve crossing the plane | N/A-3D | N/A-3D | Greyed. Sketches sit on planes in 3D and there is an Orbit view, but no Intersect: only points and lines lying in the plane show |
| C339 | SKT-SKETCH-CREATE-PROJECT-INCLUDE | Spun Profile | N/A-3D | N/A-3D | Greyed |
| C340 | SKT-SKETCH-CREATE-PROJECT-INCLUDE | Include 3D, Project To Surface, Intersection Curve, Isoparametric text | N/A-3D | N/A-3D | Greyed |
| C341 | SKT-FIT-CURVE-TO-MESH-SECTION | All steps | N/A-3D | N/A-3D | Needs mesh; greyed, tooltip |
| C342 | SKT-FIT-CURVE-TO-MESH-SECTION | Menu path Create > Fit Curves To Mesh Section | Partial | Fixed | Fit Curves To Mesh Section on the Create menu, greyed. |
| C343 | SKT-SKETCH-CREATE-FIT-CURVE-MESH-SECTION | Tool description | N/A-3D | N/A-3D | Needs mesh; greyed |
| C344 | SKT-INCLUDE-3D-GEOMETRY | All steps | N/A-3D | N/A-3D | Greyed, tooltip |
| C345 | SKT-INTERSECTION-CURVE | All steps | N/A-3D | N/A-3D | Greyed, tooltip |
| C346 | SKT-ISOPARAMETRIC-CURVE | All steps | N/A-3D | N/A-3D | Greyed, tooltip |
| C347 | SKT-PROJECT-SPUN-PROFILE | All steps; GIFs show 3D body | N/A-3D | N/A-3D | Greyed, tooltip |
| C348 | SKT-PROJECT-TO-SURFACE | All steps | N/A-3D | N/A-3D | Greyed, tooltip |
| C349 | GUID-58ECBE5C Intersect | All steps | N/A-3D | N/A-3D | Greyed, tooltip |
| C350 | GUID-68DA2AC2 Intersect dialog | Dialog fields | N/A-3D | N/A-3D | Tool greyed; dialog not reachable |
| C351 | GUID-D707ABAC Project to Surface dialog | Dialog fields | N/A-3D | N/A-3D | Tool greyed |
| C352 | GUID-E54D2246 Intersection Curve dialog | Dialog fields | N/A-3D | N/A-3D | Tool greyed |
| M353 | SKT-CONSTRAINTS | Panel lists 12 tools in the stated order | Match | Match | H/V two points, line, Coincident forms and the 12-tool list all re-driven. |
| M354 | SKT-CONSTRAINTS | H/V: a single line, or two points, whichever axis is closer | Match | Match | H/V two points, line, Coincident forms and the 12-tool list all re-driven. |
| M355 | SKT-CONSTRAINTS | Coincident: point on line, point to point, point on curve | Match | Match | H/V two points, line, Coincident forms and the 12-tool list all re-driven. |
| M356 | SKT-CONSTRAINTS | Tangent: curve and another object touch at one point | Partial | Fixed | r stays 20 with line or circle; the free side moves. |
| M357 | SKT-CONSTRAINTS | Equal: when one size changes the others adjust | Match | Match | Equal lines match; line with circle refused. |
| M358 | SKT-CONSTRAINTS | Parallel: two lines extend in same direction | Partial | Fixed | Length kept in every case, both orders. |
| M359 | SKT-CONSTRAINTS | Perpendicular: 90 degrees | Partial | Fixed | As M358. |
| M360 | SKT-CONSTRAINTS | Fix/UnFix locks size and location | Match | Match | Fix holds under drag, tool again unfixes. |
| M361 | SKT-CONSTRAINTS | Midpoint: point or object to midpoint of another object | Partial | Fixed | Circle centre and line midpoint both accepted. |
| M362 | SKT-CONSTRAINTS | Concentric: two or more arcs, circles, ellipses | Wrong | Fixed | Joined arcs: the centre moves, the ends and the rectangle stay. Free arcs, ellipses and circles travel whole as before. e2e/fix-final.spec.ts. |
| M363 | SKT-CONSTRAINTS | Collinear: two or more objects; line and rectangle edge | Match | Match | Collinear and Perpendicular with a rectangle edge: second object moves, length kept. |
| M364 | SKT-CONSTRAINTS | Symmetry: two or more objects about an axis | Partial | Fixed | Ellipse mirrored whole; fit spline body pick mirrored all points. |
| M365 | SKT-CONSTRAINTS | Curvature: spline and sketch curve, G2 | Partial | Fixed | Fit spline reaches true G2 with arc, circle, ellipse, conic end and fit or control spline, by its end handle or next fit point, and with a line with or without a handle. Fit and arc 0.0333333 against 1/30. Point on spline pulls the spline: a drag of 15 mm reached the cursor to 1e-4 mm and the curve to 1e-3 mm on every step. src/solver/spline-limits.test.ts, solver/tests/spline_limits.rs. |
| M366 | All 12 SKT-CONSTRAIN-* | "Note: tools only available in the Sketch contextual tab" | Match | Match | H/V two points, line, Coincident forms and the 12-tool list all re-driven. |
| M367 | All 12 SKT-CONSTRAIN-* | "The X constraint icon displays next to the cursor" (12 claims, one row) | Missing | Fixed | All 12 tools: icon and prompt beside the cursor. |
| M368 | SKT-CONSTRAIN-COINCIDENT | Tool then pick two points: snap together | Match | Match | Point-to-point by tool and by preselect. |
| M369 | SKT-CONSTRAIN-COINCIDENT | Preselect then tool | Match | Match | Point-to-point by tool and by preselect. |
| M370 | SKT-CONSTRAIN-COINCIDENT | Point and line, either order | Match | Match | Point-to-point by tool and by preselect. |
| M371 | SKT-CONSTRAIN-COINCIDENT | Point and curve | Partial | Fixed | Point moved to the circle, r stays 20, either order. |
| M372 | SKT-CONSTRAIN-COINCIDENT | Valid pick highlights on hover | Match | carried | Not re-tested. Ring on the point (c-coin-hover1.png); same point ineligible second time |
| M373 | SKT-CONSTRAIN-COINCIDENT | "A constraint badge displays" | Partial | Partial | P3. Point to point shows no badge, as before. The page image and GUID-685B9D79 disagree. |
| M374 | SKT-CONSTRAIN-COLLINEAR | Tool then pick; geometry on same line | Match | Match | Collinear and Perpendicular with a rectangle edge: second object moves, length kept. |
| M375 | SKT-CONSTRAIN-COLLINEAR | Badge next to geometry | Match | carried | Not re-tested. Badge on both lines (c2-col.png) |
| M376 | SKT-CONSTRAIN-COLLINEAR | Two or more, preselect | Match | carried | Not re-tested. Three lines all reach y=30 |
| M377 | SKT-CONSTRAIN-CONCENTRIC | Circles snap to same centre | Match | Match | Concentric circles: second moved to first, radii kept. |
| M378 | SKT-CONSTRAIN-CONCENTRIC | Arcs snap to same centre | Wrong | Fixed | Attached arcs: rectangle stays 44 wide, second centre lands on the first, radius changes. Free arc: r20 kept, both orders. |
| M379 | SKT-CONSTRAIN-CONCENTRIC | Ellipses snap to same centre | Wrong | Fixed | Ellipse 30/15 kept, both orders. |
| M380 | SKT-CONSTRAIN-CONCENTRIC | Badge | Match | carried | Not re-tested. Badge on both (c2-conc.png) |
| M381 | SKT-CONSTRAIN-CURVATURE | Control spline chained to line: G2 | Match | Match | Still G2. The first legs move and the far end stays: (70,25) kept. |
| M382 | SKT-CONSTRAIN-CURVATURE | Fit spline chained to line: G2 | Wrong | Fixed | No warning; end curvature 0 measured from exported Bezier. |
| M383 | SKT-CONSTRAIN-CURVATURE | Spline to spline | Partial | Fixed | Two control splines: curvature 0.0289 on both sides, computed from poles. Fit pair: G1 with a note (ruling). |
| M384 | SKT-CONSTRAIN-CURVATURE | Spline and "a regular sketch curve" other than a line | Untested | Fixed | Control spline with arc: 0.0568 against 1/R 0.0568. Fit spline with arc: G1 with a note. |
| M385 | SKT-CONSTRAIN-CURVATURE | "chained" required | Match | Match | Unchained line refused. |
| M386 | SKT-CONSTRAIN-CURVATURE | Badge | Match | carried | Not re-tested. Badge shown (c3-curv-ctl.png) |
| M387 | SKT-CONSTRAIN-EQUAL | Second matches size of first selected | Match | Match | Equal lines match; line with circle refused. |
| M388 | SKT-CONSTRAIN-EQUAL | Similar objects only | Match | Match | Equal lines match; line with circle refused. |
| M389 | SKT-CONSTRAIN-EQUAL | Preselect several | Match | carried | Not re-tested. r10, r20, r30 became 10, 10, 10 |
| M390 | SKT-CONSTRAIN-EQUAL | Badge | Partial | Fixed | Badge sits on the rim, within 2 px. |
| M391 | SKT-CONSTRAIN-FIX-UNFIX | Size and location locked | Match | Match | Fix holds under drag, tool again unfixes. |
| M392 | SKT-CONSTRAIN-FIX-UNFIX | Geometry turns green | Match | carried | Not re-tested. c2-fix-line.png, c2-fix-pt.png |
| M393 | SKT-CONSTRAIN-FIX-UNFIX | Tool again then click unfixes | Match | Match | Fix holds under drag, tool again unfixes. |
| M394 | SKT-CONSTRAIN-FIX-UNFIX | Preselect | Match | carried | Not re-tested. Two rect sides fixed, tool exits |
| M395 | SKT-CONSTRAIN-HORIZONTAL-VERTICAL | Line snaps to nearer axis | Match | Match | Line snapped to the nearer axis. |
| M396 | SKT-CONSTRAIN-HORIZONTAL-VERTICAL | Two points | Match | Match | H/V two points, line, Coincident forms and the 12-tool list all re-driven. |
| M397 | SKT-CONSTRAIN-HORIZONTAL-VERTICAL | Several preselected lines | Match | carried | Not re-tested. Both constrained |
| M398 | SKT-CONSTRAIN-HORIZONTAL-VERTICAL | Badge | Match | carried | Not re-tested. c-hv-after.png |
| M399 | SKT-CONSTRAIN-HORIZONTAL-VERTICAL | Re-applying | Partial | Fixed | No duplicate; "That is already horizontal". |
| M400 | SKT-CONSTRAIN-MIDPOINT | Point then line, line then point, preselect | Match | Match | Midpoint point-line and arc. |
| M401 | SKT-CONSTRAIN-MIDPOINT | Arc midpoint | Match | Match | Midpoint point-line and arc. |
| M402 | SKT-CONSTRAIN-MIDPOINT | "or object" | Partial | Fixed | As M361. |
| M403 | SKT-CONSTRAIN-MIDPOINT | Badge | Match | carried | Not re-tested. Triangle badge (c2-mid.png) |
| M404 | SKT-CONSTRAIN-PARALLEL | Tool and preselect | Partial | Fixed | As M358. |
| M405 | SKT-CONSTRAIN-PARALLEL | Badge | Match | Match | Glyph on both lines. |
| M406 | SKT-CONSTRAIN-PERPENDICULAR | Tool and preselect | Partial | Fixed | As M358. |
| M407 | SKT-CONSTRAIN-PERPENDICULAR | Line with polygon edge | Match | Match | Collinear and Perpendicular with a rectangle edge: second object moves, length kept. |
| M408 | SKT-CONSTRAIN-PERPENDICULAR | Badge | Match | Match | Glyph on both lines. |
| M409 | SKT-CONSTRAIN-SYMMETRY | Geometry, then line of symmetry | Match | Match | Circles mirrored, r 15 both. |
| M410 | SKT-CONSTRAIN-SYMMETRY | Circles match and mirror | Match | Match | Circles mirrored, r 15 both. |
| M411 | SKT-CONSTRAIN-SYMMETRY | Preselect | Partial | Fixed | Line selected first: circles mirrored across the line. |
| M412 | SKT-CONSTRAIN-SYMMETRY | Ellipses and splines | Missing | Fixed | As M364. |
| M413 | SKT-CONSTRAIN-TANGENT | Line and circle | Partial | Fixed | Circle kept r20, line moved tangent. |
| M414 | SKT-CONSTRAIN-TANGENT | Circle and circle | Partial | Fixed | Both stay r20, one translates. |
| M415 | SKT-CONSTRAIN-TANGENT | Arc and line at shared end | Match | Match | Tangent arc to line, ellipse to line. |
| M416 | SKT-CONSTRAIN-TANGENT | Ellipse and line | Match | Match | Tangent arc to line, ellipse to line. |
| M417 | SKT-CONSTRAIN-TANGENT | Spline and line | Partial | Fixed | Refused with a message saying the end must be on the other curve first. |
| M418 | SKT-CONSTRAIN-TANGENT | Badge | Match | carried | Not re-tested. c-tan-after.png |
| M419 | GUID-685B9D79 | Free line and spline ends are white dots | Match | carried | Not re-tested. c3-dots.png |
| M420 | GUID-685B9D79 | Point to point: no dot or icon | Match | carried | Not re-tested. c2-p2p.png |
| M421 | GUID-685B9D79 | Point to curve shows coincident icon | Match | carried | Not re-tested. c-coin-pointline.png |
| M422 | GUID-685B9D79 | Spline internal fit points grey | Match | carried | Not re-tested. c3-dots.png |
| M423 | GUID-685B9D79 | Select point, right-click, Delete Coincident | Match | Match | Delete Coincident in the menu, undo restores. |
| M424 | GUID-BF6D00B3 (video) | Vertical/horizontal applied while drawing | Match | carried | Not re-tested. Horizontal recorded; on the Y axis a point-on-axis is recorded instead of a vertical |
| M425 | GUID-BF6D00B3 (video) | Start on origin is coincident | Match | carried | Not re-tested. coincident origin,p3 |
| M426 | GUID-BF6D00B3 (video) | Parallel applied by hovering an earlier line | Match | Match | Parallel inference by hover, tangent arc by drag, midpoint inference. |
| M427 | GUID-BF6D00B3 (video) | Perpendicular while drawing | Match | carried | Not re-tested. Inference reported perpendicular on the chained line |
| M428 | GUID-BF6D00B3 (video) | Drag from line end makes tangent arc | Match | Match | Parallel inference by hover, tangent arc by drag, midpoint inference. |
| M429 | GUID-BF6D00B3 (video) | Line off arc end is tangent | Match | carried | Not re-tested. tangent:a21,l27 |
| M430 | GUID-BF6D00B3 (video) | Line to a line's midpoint adds midpoint constraint | Match | Match | Parallel inference by hover, tangent arc by drag, midpoint inference. |
| M431 | GUID-BF6D00B3 (video) | Closing the loop gives a shaded profile | Match | carried | Not re-tested. profiles()=1 (l-v-done.png) |
| M432 | GUID-BF6D00B3 (video) | Constraints hold on drag | Match | carried | Not re-tested. Drag kept coincident, tangent; shape not torn. No narration, so intended result inferred |
| M433 | GUID-BF6D00B3 (video) | Glyph style during drawing | Untested | Untested | Video frames too small; no side by side made. |
| M434 | SKT-FULLY-DEFINE | Constraints plus dimensions fully constrain | Match | Match | DOF 0, #111111. |
| M435 | SKT-FULLY-DEFINE | Red lock in Browser when fully constrained | Match | carried | Not re-tested. d-finished.png |
| M436 | SKT-FULLY-DEFINE | Colour changes to black | Match | Match | DOF 0, #111111. |
| M437 | SKT-FULLY-DEFINE | Individual curve can be fully constrained | Match | carried | Not re-tested. Offset output and fully-held lines go black (o-done.png) |
| M438 | SKT-FULLY-DEFINE | Position by Fix, origin, dimension to origin | Match | carried | Not re-tested. All three reduced DOF; Fix to DOF 0 |
| M439 | SKT-FULLY-DEFINE | Browser icon for unconstrained | Partial | Fixed | Free sketch icon has blue dashed corners and a pencil stroke. |
| M440 | SKT-FIND-UNDERCONSTRAINED | Status at top updates | Match | Match | Finder lists free rows. |
| M441 | SKT-FIND-UNDERCONSTRAINED | Click lists entities | Match | Match | Finder lists free rows. |
| M442 | SKT-FIND-UNDERCONSTRAINED | Select row highlights and zooms | Match | carried | Not re-tested. ppm 4 to 22.05, centred, selected (d-find-sel.png) |
| M443 | SKT-FIND-UNDERCONSTRAINED | X deletes entity | Match | carried | Not re-tested. Curve removed, list updates |
| M444 | SKT-FIND-UNDERCONSTRAINED | X not for points | Match | carried | Not re-tested. Point row has none |
| M445 | SKT-FIND-UNDERCONSTRAINED | Hide fully constrained geometry | Missing | Fixed | Hide Fully Constrained hides the geometry (fix glyph stays). |
| M446 | SKT-FIND-UNDERCONSTRAINED | Add constraints while active; list updates | Partial | Fixed | List stays open and shows free items only; X and edits update it. |
| M447 | SKT-FIND-UNDERCONSTRAINED | Compute Sketch | Match | carried | Not re-tested. Button runs, status correct; no visible feedback |
| M448 | SKT-FIND-UNDERCONSTRAINED | AutoConstrain in Sketch Palette | Missing | Fixed | AutoConstrain link in the palette opens the dialog. |
| M449 | SKT-AUTO-CONSTRAIN-CONCEPT | Generates a list of result options | Partial | Fixed | Balanced, With reference dimensions, Sizes only: different counts. |
| M450 | SKT-AUTO-CONSTRAIN-CONCEPT | Uses AI | Partial | Accepted | Ruling: local rules engine, labelled in the dialog. |
| M451 | SKT-AUTO-CONSTRAIN-CONCEPT | Tile shows totals, hover shows added | Match | carried | Not re-tested. Tooltip "Adds 0 constraints and 10 dimensions. Totals 9 and 10." (via title attribute, not hovered visually) |
| M452 | SKT-AUTO-CONSTRAIN-CONCEPT | Selected tile previews purple | Match | carried | Not re-tested. a-run.png |
| M453 | SKT-AUTO-CONSTRAIN-CONCEPT | Icon shows if fully constrained | Match | carried | Not re-tested. Lock flips with slider |
| M454 | SKT-AUTO-CONSTRAIN-CONCEPT | Generate more adds two | Match | carried | Not re-tested. 3 to 5, then disabled |
| M455 | SKT-AUTO-CONSTRAIN-CONCEPT | Start Over after editing dimensions | Missing | Fixed | Start Over regenerates. There is nothing to start over from, since canvas edits are out (M456). |
| M456 | SKT-AUTO-CONSTRAIN-CONCEPT | Edit dimensions in canvas | Missing | Accepted | Ruling: Start Over and tile variety, no more. Double-click on a dimension still does nothing here. |
| M457 | SKT-AUTO-CONSTRAIN-CONCEPT | Datum: three ways | Match | carried | Not re-tested. More > Set Datum, preselect, From Datum all work |
| M458 | SKT-AUTO-CONSTRAIN-CONCEPT | Finish with AutoConstrain in Finish menu | Match | Match | AutoConstrain dialog, OK adds, one undo reverts. |
| M459 | SKT-AUTO-CONSTRAIN | First result selected by default | Match | Match | AutoConstrain dialog, OK adds, one undo reverts. |
| M460 | SKT-AUTO-CONSTRAIN | Click results to review | Match | carried | Not re-tested. Active moves |
| M461 | SKT-AUTO-CONSTRAIN | Slider, Reduce, Add | Match | carried | Not re-tested. 10 to 7 to 8 to 5 dims |
| M462 | SKT-AUTO-CONSTRAIN | Modify Geometry with Tolerance | Match | carried | Not re-tested. Rough rect squared up, DOF 0. Effect of unchecked state on same sketch not compared |
| M463 | SKT-AUTO-CONSTRAIN | Delete in canvas, then Refresh | Match | carried | Not re-tested. Dim removed, Refresh button, excluded stays (a4-deleted.png) |
| M464 | SKT-AUTO-CONSTRAIN | OK applies | Match | Match | AutoConstrain dialog, OK adds, one undo reverts. |
| M465 | SKT-AUTO-CONSTRAIN | Set datum aligns dims | Match | carried | Not re-tested. Dims measured to corner (a2-datum.png). Dialog sits over the right of the canvas and blocked a pick at (60,40) |
| M466 | SKT-AUTO-CONSTRAIN | Sketch > Automate > AutoConstrain | Partial | Fixed | Automate panel lists AutoConstrain and AutoConstrain From Datum. |
| M467 | SKT-FINISH-WITH-AUTO-CONSTRAIN | Menu item | Match | Match | AutoConstrain dialog, OK adds, one undo reverts. |
| M468 | SKT-FINISH-WITH-AUTO-CONSTRAIN | "Constraining your sketch..." | Match | carried | Not re-tested. a-finish-run.png |
| M469 | SKT-FINISH-WITH-AUTO-CONSTRAIN | Cancel finishes without applying | Match | carried | Not re-tested. Mode design, dims 0 |
| M470 | SKT-FINISH-WITH-AUTO-CONSTRAIN | Returns to Design with constraints shown | Match | carried | Not re-tested. 8 constraints, 4 dims |
| M471 | SKT-FINISH-WITH-AUTO-CONSTRAIN | Undo Finish with AutoConstrain from undo menu | Partial | Fixed | The Undo button names the step it would undo, from the same commit label: "Undo Line" seen. |
| M472 | SKT-FINISH-WITH-AUTO-CONSTRAIN | Not available at 0 entities | Match | carried | Not re-tested. Disabled, tooltip "The sketch is empty" |
| M473 | SKT-FINISH-WITH-AUTO-CONSTRAIN | Not available over 250 entities | Untested | Fixed | 260 curves: both entries greyed, "handles up to 250 entities". |
| M474 | SKT-FINISH-WITH-AUTO-CONSTRAIN | Personal use, offline, 3D sketch | N/A-3D | N/A-3D | No licence, network, or 3D sketches in the app; not marked in UI |
| M475 | SKT-FINISH-WITH-AUTO-CONSTRAIN | Failure notification | Untested | Untested | No way to force a failure through the UI. |
| M476 | REF-AUTO-CONSTRAIN | Constraints and Dimensions counts | Match | Match | AutoConstrain dialog, OK adds, one undo reverts. |
| M477 | REF-AUTO-CONSTRAIN | Tooltip with totals | Match | Match | AutoConstrain dialog, OK adds, one undo reverts. |
| M478 | REF-AUTO-CONSTRAIN | Lock and unlock status | Match | Match | AutoConstrain dialog, OK adds, one undo reverts. |
| M479 | REF-AUTO-CONSTRAIN | Minus, plus, slider | Match | Match | AutoConstrain dialog, OK adds, one undo reverts. |
| M480 | REF-AUTO-CONSTRAIN | Modify Geometry, tolerance slider and custom settings | Partial | Partial | P3. Tolerance slider only, no custom settings. |
| M481 | REF-AUTO-CONSTRAIN | Datum | Match | carried | Not re-tested. Purple "Datum" marker |
| M482 | SKT-CREATE-DIMENSIONS | Create > Sketch Dimension | Match | Match | Dimension by menu and D; in, expressions, double-click edit. |
| M483 | SKT-CREATE-DIMENSIONS | Single line linear | Partial | Fixed | Mouse above: horizontal 40; beside: vertical 30; near line: aligned 50. |
| M484 | SKT-CREATE-DIMENSIONS | Parallel lines linear | Match | Match | Dimension by menu and D; in, expressions, double-click edit. |
| M485 | SKT-CREATE-DIMENSIONS | Two points linear | Match | carried | Not re-tested. H, V, aligned by placement |
| M486 | SKT-CREATE-DIMENSIONS | Non-parallel lines angular | Match | carried | Not re-tested. Vertically opposite gives same angle. The 45 degree sector was not placed |
| M487 | SKT-CREATE-DIMENSIONS | Circles diameter | Match | Match | Dimension by menu and D; in, expressions, double-click edit. |
| M488 | SKT-CREATE-DIMENSIONS | Arcs radius | Match | carried | Not re-tested. R25 |
| M489 | SKT-CREATE-DIMENSIONS | Enter value | Match | Match | Dimension by menu and D; in, expressions, double-click edit. |
| M490 | SKT-CREATE-DIMENSIONS | Click existing dimension to reference | Match | carried | Not re-tested. Inserts d1 |
| M491 | SKT-CREATE-DIMENSIONS | Mathematical expression with parameters | Match | carried | Not re-tested. d1+10; Width/2 |
| M492 | SKT-CREATE-DIMENSIONS | Order: value, Enter, then click to place | Partial | Accepted | Ruling M-F30: place first, then value. Typing before placing is ignored. |
| M493 | SKT-CREATE-DIMENSIONS | Repeat; Esc or another tool ends | Match | carried | Not re-tested. Tool stays; Esc clears picks then exits; L switches |
| M494 | SKT-CREATE-DIMENSIONS | Constrained geometry black | Match | Match | DOF 0, #111111. |
| M495 | SKT-CREATE-DIMENSIONS | Double-click edit | Match | Match | Dimension by menu and D; in, expressions, double-click edit. |
| M496 | SKT-CREATE-DIMENSIONS | Toggle Driven menu | Match | carried | Not re-tested. Present |
| M497 | SKT-CREATE-DIMENSIONS | Driving-only expression goes static, not recovered | Match | carried | Not re-tested. d1+10 became 50 mm, stayed on toggling back |
| M498 | SKT-CREATE-DIMENSIONS | Expression referencing a Driven survives | Match | carried | Not re-tested. d2*2 kept |
| M499 | SKT-CREATE-DIMENSIONS | Select Toggle Driving | Wrong | Fixed | Reads Toggle Driving on a Driven, Toggle Driven on a Driving. |
| M500 | SKT-CREATE-DIMENSIONS | Reference driven by click and name | Match | carried | Not re-tested. d2 inserted; d3 follows |
| M501 | SKT-CREATE-DIMENSIONS | Not referenceable in Offset dims | Wrong | Fixed | OK disabled, "An offset cannot reference the Driven dimension d2". |
| M502 | SKT-CREATE-DIMENSIONS | Not referenceable in Tangent dims | Missing | Fixed | Refused: "A tangent dimension cannot reference the Driven dimension d3". |
| M503 | SKT-CREATE-DIMENSIONS | Right-click: Radius or Diameter | Match | carried | Not re-tested. Works; check mark shows |
| M504 | SKT-CREATE-DIMENSIONS | Right-click: Driven or Driving | Match | carried | Not re-tested. Driven dim made |
| M505 | SKT-CREATE-DIMENSIONS | Right-click: Pick Circle/Arc Center or Tangent | Missing | Fixed | Menu has Pick Circle/Arc Center and Tangent; tangent 10 holds. |
| M506 | SKT-CREATE-DIMENSIONS | Browser Show Dimensions | Partial | Fixed | Show Dimensions on another sketch while editing. |
| M507 | SKT-CREATE-DIMENSIONS | Reference across sketches | Partial | Fixed | Clicking the other sketch label inserted d1; d1*2 = 80 by name too. |
| M508 | SKT-CREATE-DIMENSIONS | Dimensions animation: gray preview, fx prefix, red while invalid | Partial | Fixed | Red while invalid, as typed. |
| M509 | SKT-SKETCH-CREATE-DIMENSIONS | Select then click to place | Match | carried | Not re-tested. Preview follows cursor |
| M510 | SKT-SKETCH-CREATE-DIMENSIONS | Sketch and construction geometry | Match | carried | Not re-tested. Construction line dimensioned |
| M511 | SKT-SKETCH-CREATE-DIMENSIONS | Driving by default | Match | Match | Dimension by menu and D; in, expressions, double-click edit. |
| M512 | SKT-SKETCH-CREATE-DIMENSIONS | Over-constraining becomes Driven automatically | Match | Match | Third dim Driven in parentheses. |
| M513 | SKT-SKETCH-CREATE-DIMENSIONS | "you can choose to make a dimension Driven" | Partial | Accepted | Ruling M-F13: automatic Driven with a note. Observed. |
| M514 | SKT-SKETCH-CREATE-DIMENSIONS | Parentheses | Match | Match | Third dim Driven in parentheses. |
| M515 | SKT-SKETCH-CREATE-DIMENSIONS | Driven updates automatically | Match | carried | Not re-tested. 20 to 30 on drag |
| M516 | SKT-SKETCH-CREATE-DIMENSIONS | Read-only in Parameters, parens, grey | Match | carried | Not re-tested. f-params.png |
| M517 | SKT-SKETCH-CREATE-DIMENSIONS | Reference in modeling features | N/A-3D | N/A-3D | No features; not marked |
| M518 | GUID-3C4D29F6 (video) | Hover then place; line dim 115, 85 between points | Match | carried | Not re-tested. Equivalent flow |
| M519 | GUID-3C4D29F6 (video) | Angular on slanted edge | Match | carried | Not re-tested. 60 deg applied |
| M520 | GUID-3C4D29F6 (video) | Radius, Ø with leader | Match | carried | Not re-tested. e-circ-arc.png, f-dia-rad.png |
| M521 | GUID-3C4D29F6 (video) | Double-click to change, geometry updates | Match | Match | Dimension by menu and D; in, expressions, double-click edit. |
| M522 | GUID-3C4D29F6 (video) | Input tooltip "d21 : 111.69 mm" | Missing | Fixed | Pill "d1 : 50.00 mm" under the field. |
| M523 | GUID-27529A4E (video) | Dimension between curves, hole to edge, hole to hole | Match | Match | Dimension by menu and D; in, expressions, double-click edit. |
| M524 | GUID-27529A4E (video) | Slanted line: H/V or aligned by mouse position | Partial | Fixed | As M483. |
| M525 | GUID-27529A4E (video) | Over-constrain dialog OK/Cancel | Missing | Accepted | Ruling M-F13. |
| M526 | GUID-27529A4E (video) | Driven by right-click, 17.32 and 120 deg shown in parens | Match | carried | Not re-tested. f-driven-new.png |
| M527 | GUID-27529A4E (video) | Radius to Diameter on a tangent arc via menu | Match | carried | Not re-tested. Same menu |
| M528 | GUID-27529A4E (video) | Dimension to a body edge | N/A-3D | N/A-3D | No bodies; not marked |
| M529 | GUID-715E7B9F (video) | Arithmetic in field | Match | Match | Dimension by menu and D; in, expressions, double-click edit. |
| M530 | GUID-715E7B9F (video) | Red text for incomplete expression | Wrong | Fixed | "10+" goes red at once, clears on "5". |
| M531 | GUID-715E7B9F (video) | Add User Parameter Width | Partial | Partial | P3. Add User Parameter is an inline row, not a dialog. |
| M532 | GUID-715E7B9F (video) | Width/2 gives fx: 150 | Match | carried | Not re-tested. v150 and geometry resized |
| M533 | GUID-715E7B9F (video) | Referencing another dimension | Match | Match | Dimension by menu and D; in, expressions, double-click edit. |
| M534 | GUID-715E7B9F (video) | Change Width, sketch updates | Match | carried | Not re-tested. 150 to 125 live in dialog |
| M535 | GUID-715E7B9F (video) | Problem indication | Partial | Partial | P3. "Unknown name nosuch", red, nothing applied. Narration still unavailable. |
| M536 | SKT-SKETCH-MODIFY-TOOLS | Panel lists 12 tools | Partial | Fixed | Order Fillet, Chamfer, Trim, Extend, Break, Scale, Offset, Blend, Move/Copy, Parameters. |
| M537 | SKT-SKETCH-MODIFY-TOOLS | Fillet: 2 intersecting lines | Wrong | Fixed | R20 in all four quadrants, slanted too. |
| M538 | SKT-SKETCH-MODIFY-TOOLS | Fillet: point at 2 intersecting lines | Match | Match | Fillet at vertex R8, parallel lines R12.5. |
| M539 | SKT-SKETCH-MODIFY-TOOLS | Fillet: 2 parallel lines | Match | Match | Fillet at vertex R8, parallel lines R12.5. |
| M540 | SKT-SKETCH-MODIFY-TOOLS | Fillet: line and arc that intersect | Wrong | Fixed | Default radius comes down until the fillet is on the side the picks mean: inside the circle and above the line for the audit's picks. |
| M541 | SKT-SKETCH-MODIFY-TOOLS | Fillet: 2 circular arcs that intersect | Match | Match | Works. Default radius now stays on the side of the picks. |
| M542 | SKT-SKETCH-MODIFY-TOOLS | Equal Distance Chamfer: vertex, extended intersection | Match | Match | Chamfer vertex, extended, equal, distance-angle. |
| M543 | SKT-SKETCH-MODIFY-TOOLS | Chamfer: intersection | Wrong | Fixed | All three chamfer types on crossing lines. |
| M544 | SKT-SKETCH-MODIFY-TOOLS | Trim to nearest extended intersection | Wrong | Accepted | Ruling M-F17: real intersections. |
| M545 | SKT-SKETCH-MODIFY-TOOLS | Trim preview and click | Match | carried | Not re-tested. Red segment |
| M546 | SKT-SKETCH-MODIFY-TOOLS | Extend to nearest extended intersection | Wrong | Accepted | Ruling M-F17. |
| M547 | SKT-SKETCH-MODIFY-TOOLS | Extend preview and click | Match | carried | Not re-tested. Dashed ghost |
| M548 | SKT-SKETCH-MODIFY-TOOLS | Break into segments, preview | Match | carried | Not re-tested. Red markers |
| M549 | SKT-SKETCH-MODIFY-TOOLS | Sketch Scale | Match | carried | Not re-tested. See SKT-SCALE |
| M550 | SKT-SKETCH-MODIFY-TOOLS | Offset one or both sides | Match | carried | Not re-tested. See SKT-OFFSET |
| M551 | SKT-SKETCH-MODIFY-TOOLS | Match Topology | Missing | Fixed | Over the limit the distance stops just short of it: height 10 gives just under 5, four lines, none under 0.01 mm. Dialog field, note, dimension and status agree. |
| M552 | SKT-SKETCH-MODIFY-TOOLS | Association removed by Delete on glyph | Match | Match | Glyph selected, Delete, output stays, source moves alone. |
| M553 | SKT-SKETCH-MODIFY-TOOLS | Any geometry, one selection at a time | Match | carried | Not re-tested. Second pick replaces |
| M554 | SKT-SKETCH-MODIFY-TOOLS | Offset glyph on original and offset | Partial | Fixed | Glyph on the output and on the original. |
| M555 | SKT-SKETCH-MODIFY-TOOLS | Blend highlight and preview, end by pointer | Match | carried | Not re-tested. Near and far give different previews |
| M556 | SKT-SKETCH-MODIFY-TOOLS | Move/Copy selects then specifies location | Partial | Fixed | Joined geometry stays joined. One side, X move: exact. Two sides, X and Y: solver compromise, corners off by up to 3 mm. |
| M557 | SKT-SKETCH-MODIFY-TOOLS | Move off plane to 3D sketch | N/A-3D | N/A-3D | No 3D; not marked |
| M558 | SKT-SKETCH-MODIFY-TOOLS | Change Parameters | Match | carried | Not re-tested. Dialog works |
| M559 | SKT-ADD-FILLETS | Pick first, hover second shows preview | Match | carried | Not re-tested. Dashed arc on valid case (m-fx-NE-hover.png) |
| M560 | SKT-ADD-FILLETS | Drag radius handle | Match | carried | Not re-tested. R12 to R39.3 |
| M561 | SKT-ADD-FILLETS | Specify radius | Match | carried | Not re-tested. 15 typed. Clicking the field does nothing (F27) |
| M562 | SKT-ADD-FILLETS | Enter ends | Match | Match | Trim line, circle, drag, delete; Extend refusal reads plainly. |
| M563 | SKT-ADD-FILLETS | Arc and radius dimension display | Match | carried | Not re-tested. m-f-v-done.png |
| M564 | SKT-ADD-FILLETS | Initial radius proportional to smaller | Partial | Fixed | R20 on crossing lines, no halving to 0.08. |
| M565 | SKT-ADD-FILLETS | Existing constraints and dimensions kept | Wrong | Accepted | Ruling M-F6: "deletes the 500 mm dimension". Height dropped, 60 kept. |
| M566 | SKT-ADD-CHAMFERS | Equal: vertex preview, line then line | Match | Match | Chamfer vertex, extended, equal, distance-angle. |
| M567 | SKT-ADD-CHAMFERS | Equal: handle, value, Enter | Match | carried | Not re-tested. 22 by drag, 8 typed |
| M568 | SKT-ADD-CHAMFERS | Equal: second driven by first, fx prefix | Match | Match | Chamfer vertex, extended, equal, distance-angle. |
| M569 | SKT-ADD-CHAMFERS | Equal: dimension placement as in image | Partial | Fixed | Labels clear of the lines, corner shown. |
| M570 | SKT-ADD-CHAMFERS | Distance and angle: handles, values | Match | Match | Chamfer vertex, extended, equal, distance-angle. |
| M571 | SKT-ADD-CHAMFERS | Distance and angle: dimensions display | Partial | Fixed | Angle has an arc, separate from the distance. |
| M572 | SKT-ADD-CHAMFERS | Two distance: first move adjusts both | Match | carried | Not re-tested. 12/12 to 22/22, then 27/22 |
| M573 | SKT-ADD-CHAMFERS | Two distance: independent | Match | carried | Not re-tested. Edit first left second |
| M574 | SKT-ADD-CHAMFERS | Preview proportional to smaller | Match | carried | Not re-tested. 12 from 60 |
| M575 | SKT-ADD-CHAMFERS | Valid selection highlight | Match | carried | Not re-tested. Hover |
| M576 | SKT-ADD-CHAMFERS | Switch type in palette while active | Match | carried | Not re-tested. Equal to Two Distance kept the corner |
| M577 | SKT-ADD-CHAMFERS | Object snaps add logical constraints | Untested | Untested | Chamfer pick flow shows no snapping to judge. |
| M578 | SKT-ADD-CHAMFERS | Existing dimensions kept | Wrong | Accepted | Ruling M-F6. |
| M579 | SKT-TRIM-EXTEND | Trim hover preview | Match | carried | Not re-tested. t-hover.png |
| M580 | SKT-TRIM-EXTEND | Click trims to next intersection; continue | Match | Match | Trim line, circle, drag, delete; Extend refusal reads plainly. |
| M581 | SKT-TRIM-EXTEND | Enter ends | Match | carried | Not re-tested.  |
| M582 | SKT-TRIM-EXTEND | Drag across segments | Match | Match | Trim line, circle, drag, delete; Extend refusal reads plainly. |
| M583 | SKT-TRIM-EXTEND | No intersection deletes | Match | Match | Trim line, circle, drag, delete; Extend refusal reads plainly. |
| M584 | SKT-TRIM-EXTEND | Extend preview, click, continue, Enter | Match | carried | Not re-tested. Line, arc, spline |
| M585 | SKT-TRIM-EXTEND | No intersection cannot extend | Match | Match | Trim line, circle, drag, delete; Extend refusal reads plainly. |
| M586 | SKT-TRIM-EXTEND | Constraints after trim | Partial | Fixed | T end keeps a coincident on the kept piece. A midpoint that no longer holds is replaced. |
| M587 | SKT-TRIM-EXTEND | Dimensions after trim or extend | Wrong | Fixed | Trim d1 to 50, Extend to 60, references kept. |
| M588 | SKT-BREAK | Preview on hover | Partial | Fixed | Red X at each end. |
| M589 | SKT-BREAK | Click breaks; continue; Enter | Match | Match | Break line, dim 80 kept, "Nothing crosses this curve". |
| M590 | SKT-BREAK | Circle into arcs with constraints | Partial | Fixed | Broken circle has concentric plus equal. |
| M591 | SKT-BREAK | Dimensions kept | Match | Match | Break line, dim 80 kept, "Nothing crosses this curve". |
| M592 | SKT-BREAK | Nothing crossing | Match | Match | Break line, dim 80 kept, "Nothing crosses this curve". |
| M593 | SKT-SCALE | Select, more, then point | Partial | Fixed | Point field takes the next click. |
| M594 | SKT-SCALE | Factor or handle | Match | Match | Scale 2: rect, circle, d1 60. |
| M595 | SKT-SCALE | OK or Enter | Match | carried | Not re-tested. Both |
| M596 | SKT-SCALE | Scaled geometry | Match | Match | Scale 2: rect, circle, d1 60. |
| M597 | SKT-OFFSET | Dialog on tool | Match | Match | Offset chain, Two Sides. |
| M598 | SKT-OFFSET | Curve, chain, profile | Match | Match | Offset chain, Two Sides. |
| M599 | SKT-OFFSET | Side by pointer | Partial | Fixed | Chosen side kept on the way to OK. |
| M600 | SKT-OFFSET | One Side, Two Sides, Symmetric | Match | Match | Offset chain, Two Sides. |
| M601 | SKT-OFFSET | OK; geometry, dims, glyph display | Match | Match | Offset chain, Two Sides. |
| M602 | SKT-OFFSET | Valid selections highlight | Match | carried | Not re-tested. o-hover.png |
| M603 | SKT-OFFSET | Ellipse near axis gives ellipse | Match | Match | Near axis ellipse, away fit spline. |
| M604 | SKT-OFFSET | Axis displays in preview, near axis only | Wrong | Fixed | Axis in the preview near it, absent away. |
| M605 | SKT-OFFSET | Ellipse away gives oval | Match | Match | Near axis ellipse, away fit spline. |
| M606 | SKT-OFFSET | Delete glyph removes association | Match | Match | Glyph selected, Delete, output stays, source moves alone. |
| M607 | SKT-OFFSET | Delete dimension unlocks distance | Wrong | Fixed | Dimension deleted: output drags, offset stays linked. |
| M608 | SKT-OFFSET | Add Offset Dimension | Match | carried | Not re-tested. Menu appears after deletion, 10 mm |
| M609 | SKT-OFFSET | Distance beyond inward limit | Partial | Fixed | "That distance is too large", dialog stays. |
| M610 | SKT-BLEND-CURVE | Modify > Blend Curve | Match | Match | Blend G1 and G2 (curvature constraints added; not measured). |
| M611 | SKT-BLEND-CURVE | Palette type G1, G2 | Match | Match | Blend G1 and G2 (curvature constraints added; not measured). |
| M612 | SKT-BLEND-CURVE | First then second, continuity at joins | Match | Match | Blend G1 and G2 (curvature constraints added; not measured). |
| M613 | SKT-BLEND-CURVE | Closer to end you want | Match | carried | Not re-tested. bl-hover-near.png, bl-hover-far.png |
| M614 | SKT-BLEND-CURVE | Click again to deselect | Match | carried | Not re-tested. Prompt reset |
| M615 | SKT-BLEND-CURVE | Result look in animation | Partial | Fixed | No poles, badges at the joins. |
| M616 | SKT-BLEND-CURVE | Blend to edges | N/A-3D | N/A-3D | No bodies; not marked |
| W617 | SKT-3D-SKETCH | Sketch can be created on a plane; create geometry in relation to XY, YZ, ZX | Match | Match | Mode flow and D key during tutorials. |
| W618 | SKT-3D-SKETCH | Sketches can use planar faces / arbitrary 3D points | N/A-3D | N/A-3D | No bodies. Not visibly marked: the picker simply offers only the 3 planes. |
| W619 | SKT-3D-SKETCH | Sketches comprise lines, circles, arcs, points, splines | Match | carried | Not re-tested. All drawn in e5.mjs and exported. |
| W620 | SKT-3D-SKETCH | Can project edges onto the sketch plane | Partial | Partial | P3. What lies in the plane only, as C324: the same plane, and lines where another plane meets it. A fold brings its hinge in linked. |
| W621 | SKT-3D-SKETCH | Parameters, constraints, dimensions fully define geometry | Match | carried | Not re-tested. All four tutorials reached DOF 0; `fx:` linked dimension works. |
| W622 | SKT-3D-SKETCH | Open profile: connected geometry with no closed boundary, not shaded | Match | carried | Not re-tested. e3: `profiles()`=0 with open L; no fill in e2-04-open.png. |
| W623 | SKT-3D-SKETCH | Closed profile shaded blue | Match | Match | Mode flow and D key during tutorials. |
| W624 | SKT-3D-SKETCH | Open/closed uses: surface, thin extrude, loft, cut (GIFs) | N/A-3D | N/A-3D | No 3D tools. Not visibly marked. |
| W625 | SKT-3D-SKETCH | Browser icon for unconstrained sketch | Partial | Fixed | Blue dashed corners and pencil stroke. |
| W626 | SKT-3D-SKETCH | Browser icon for fully constrained sketch | Partial | Fixed | Grey corners plus red lock. |
| W627 | SKT-3D-SKETCH | Constrained geometry cannot move when dragged | Match | Match | Mode flow and D key during tutorials. |
| W628 | SKT-3D-SKETCH | Unconstrained geometry free to move | Match | Match | Mode flow and D key during tutorials. |
| W629 | SKT-3D-SKETCH | GIF: geometry turns black segment by segment as constrained | Match | carried | Not re-tested. Partial black seen per curve during T3, T4 dimensions. |
| W630 | SKT-3D-SKETCH | Sketch geometry: solid blue when unconstrained | Match | Match | Mode flow and D key during tutorials. |
| W631 | SKT-3D-SKETCH | Sketch geometry contributes to profile | Match | carried | Not re-tested. e3. |
| W632 | SKT-3D-SKETCH | Construction: dashed orange when unconstrained | Match | Match | Mode flow and D key during tutorials. |
| W633 | SKT-3D-SKETCH | Construction: does not contribute to profile | Match | carried | Not re-tested. e3: `profiles()` 1 to 0 on conversion. |
| W634 | SKT-3D-SKETCH | Centerline: dashed orange centerline when unconstrained | Match | Match | Mode flow and D key during tutorials. |
| W635 | SKT-3D-SKETCH | Centerline contributes to profile | Match | carried | Not re-tested. e3: `profiles()` stays 1; e2-07 shaded. |
| W636 | SKT-3D-SKETCH | Projection: purple geometry | Match | Match | Mode flow and D key during tutorials. |
| W637 | SKT-3D-SKETCH | Projection contributes to profile | Match | carried | Not re-tested. e5: closed profile using a projected edge gave `profiles()`=1. |
| W638 | SKT-3D-SKETCH | Projection updates when reference changes | Match | carried | Not re-tested. x2: source dimension 30 to 50, projected line moved from y=30 to y=50. |
| W639 | SKT-3D-SKETCH | Fixed geometry: sketch, construction or centerline; green | Match | Match | Mode flow and D key during tutorials. |
| W640 | SKT-3D-SKETCH | Fixed contributes to profile | Match | carried | Not re-tested. x3: fixed normal side kept `profiles()`=1; a fixed construction side is not shaded. |
| W641 | SKT-3D-SKETCH | Fix/Unfix unlocks fixed geometry | Match | Match | Mode flow and D key during tutorials. |
| W642 | SKT-3D-SKETCH | Constrained geometry displays black ("Any geometry") | Wrong | Fixed | #111111 with dash kept, construction and centerline. |
| W643 | SKT-3D-SKETCH | 2D sketch restricted to selected plane | Match | carried | Not re-tested. No 3D input exists. |
| W644 | SKT-3D-SKETCH | 3D Sketch enabled removes planar restriction | Missing | Accepted | Ruling: 3D Sketch omitted, 2D app. |
| W645 | SKT-3D-SKETCH | 3D Sketch Manipulator: plane, axis, rotation handle | N/A-3D | N/A-3D | Depends on 3D Sketch. Not visibly marked. |
| W646 | SKT-3D-SKETCH | Sketch contextual tab displays on create or edit | Match | Match | Mode flow and D key during tutorials. |
| W647 | SKT-3D-SKETCH | Contains create, modify, constrain tools | Match | carried | Not re-tested. CREATE, MODIFY, CONSTRAINTS panels. |
| W648 | SKT-3D-SKETCH | Can still reach other tabs while sketching; invoking a 3D tool finishes the sketch | Wrong | Fixed | SOLID reachable while sketching; Line works there. |
| W649 | SKT-3D-SKETCH | Sketch Palette displays on create or edit | Match | Match | Mode flow and D key during tutorials. |
| W650 | SKT-3D-SKETCH | Palette rows list | Partial | Accepted | Ruling: Slice and 3D Sketch omitted. |
| W651 | SKT-3D-SKETCH | Pages list / Related pages | No claim | No claim | Navigation only. |
| W652 | SKT-CREATE-3D-SKETCH | Solid tab > Create Sketch | Match | Match | Mode flow and D key during tutorials. |
| W653 | SKT-CREATE-3D-SKETCH | Valid selections: origin planes | Match | Match | Mode flow and D key during tutorials. |
| W654 | SKT-CREATE-3D-SKETCH | Valid selections: work planes, planar faces | N/A-3D | N/A-3D | None exist. Not visibly marked. |
| W655 | SKT-CREATE-3D-SKETCH | Optional: Palette, check 3D Sketch | Missing | Accepted | Ruling. |
| W656 | SKT-CREATE-3D-SKETCH | On the toolbar select a sketch tool | Match | Match | Mode flow and D key during tutorials. |
| W657 | SKT-CREATE-3D-SKETCH | Manipulator at (0,0,0); switch plane; rotate; axis restriction; manipulator origin shifts | N/A-3D | N/A-3D | Needs 3D Sketch. Not visibly marked. |
| W658 | SKT-CREATE-3D-SKETCH | Click to place points; type rotation and distance | Match | carried | Not re-tested. 2D equivalent: Line HUD length/angle shown (t2-17). |
| W659 | SKT-CREATE-3D-SKETCH | Finish Sketch on the toolbar | Match | Match | Mode flow and D key during tutorials. |
| W660 | SKT-CREATE-3D-SKETCH | XY default active plane; left-click manipulator plane | N/A-3D | N/A-3D | Manipulator absent. |
| W661 | SKT-CREATE-3D-SKETCH | Up Arrow locks Z | N/A-3D | N/A-3D | Keypress does nothing (not in key table). |
| W662 | SKT-CREATE-3D-SKETCH | Alt cycles planes; Tab cycles rotation handles | N/A-3D | N/A-3D | Alt unbound. Tab moves HUD fields here instead, which is the normal 2D binding. |
| W663 | SKT-CREATE-3D-SKETCH | Right-click: Reset Triad Orientation, Show Rotation Handles, Show Planes | N/A-3D | N/A-3D | Not in the marking menu. |
| W664 | SKT-REF-3D-SKETCH-SUPPORTED-CMD | Line, Arc, Spline, Rectangle, Circle, Ellipse, Point, Text, Conic Curve exist as sketch tools | Match | carried | Not re-tested. All in CREATE menu; Line, Arc, Spline, Rectangle, Circle, Ellipse, Point used. Text and Conic were only confirmed present, not exercised here. 3D use N/A-3D. |
| W665 | SKT-REF-3D-SKETCH-SUPPORTED-CONSTRAINT | H/V, Coincident, Tangent, Equal, Parallel, Perpendicular, Fix/Unfix, Midpoint, Concentric, Collinear exist | Match | carried | Not re-tested. All on the ribbon; H/V, Tangent, Equal, Parallel, Perpendicular, Fix, Concentric used in this audit. 3D use N/A-3D. |
| W666 | GUID-4183A4B7 | Palette displays on create or edit | Match | Match | Mode flow and D key during tutorials. |
| W667 | GUID-4183A4B7 | Contextual: Line active lists Line types | Match | Match | Mode flow and D key during tutorials. |
| W668 | GUID-4183A4B7 | Contextual: slot active lists all slot types | Match | carried | Not re-tested. All 5 listed (e2). Circle, Rectangle, Arc, Spline likewise. |
| W669 | GUID-4183A4B7 | Spline selected lists Normal/Construction and Curvature Comb | Partial | Fixed | Selected curves list Normal/Construction, and a spline Curvature Comb, in Feature Options. |
| W670 | GUID-4183A4B7 | Control Point Spline selected: Change Spline Degree | Match | Match | Mode flow and D key during tutorials. |
| W671 | GUID-4183A4B7 | Linetype converts selected geometry | Match | carried | Not re-tested. T4 construction, e1 centerline, `x` key toggles. |
| W672 | GUID-4183A4B7 | Construction: creates construction geometry | Match | Match | Mode flow and D key during tutorials. |
| W673 | GUID-4183A4B7 | Centerline: creates centerline geometry | Match | Match | Mode flow and D key during tutorials. |
| W674 | GUID-4183A4B7 | Look At rotates camera to sketch plane | Partial | Partial | P3. Look At fits (ppm 4 to 60). No rotation needed in 2D. |
| W675 | GUID-4183A4B7 | Sketch Grid toggles | Match | carried | Not re-tested. e2-11-off-SketchGrid. |
| W676 | GUID-4183A4B7 | Snap toggles grid snap | Match | Match | Mode flow and D key during tutorials. |
| W677 | GUID-4183A4B7 | Slice | Missing | Accepted | Ruling. |
| W678 | GUID-4183A4B7 | Show Profile | Match | carried | Not re-tested. e2-11-off-ShowProfile. |
| W679 | GUID-4183A4B7 | Show Points | Match | carried | Not re-tested. e2-11-off-ShowPoints. |
| W680 | GUID-4183A4B7 | Show Dimensions | Match | carried | Not re-tested. e2-11-off-ShowDimensions. |
| W681 | GUID-4183A4B7 | Show Constraints | Partial | Fixed | Lock glyph hidden with Show Constraints off. |
| W682 | GUID-4183A4B7 | Show Construction Geometries | Match | Match | Mode flow and D key during tutorials. |
| W683 | GUID-4183A4B7 | Show Projected Geometries | Match | carried | Not re-tested. x2-07-proj-hidden. |
| W684 | GUID-4183A4B7 | 3D Sketch | Missing | Accepted | Ruling. |
| W685 | GUID-91E892FC | Sketch overview: sketches drive 3D bodies; links | No claim | No claim | Description and links only. |
| W686 | SKT-FINISH-SKETCH | Sketch tab > Finish Sketch | Match | Match | Mode flow and D key during tutorials. |
| W687 | SKT-FINISH-SKETCH | Right-click, Sketch > Finish Sketch | Partial | Fixed | "Sketch: Finish Sketch" in the marking menu list, as well as the ring item. |
| W688 | SKT-FINISH-SKETCH | Finish menu > Finish with AutoConstrain | Match | Match | Mode flow and D key during tutorials. |
| W689 | SKT-FINISH-SKETCH | Not available for personal use | No claim | No claim | Licence note. |
| W690 | GUID-0EEF7073 | Create Sketch appears in Solid | Match | carried | Not re-tested.  |
| W691 | GUID-0EEF7073 | Also Surface, Form, Sheet Metal, Base Feature tabs | N/A-3D | N/A-3D | Only SOLID exists. Not visibly marked. |
| W692 | GUID-0EEF7073 | Reveals Sketch tab with default tools; constraints visible | Match | carried | Not re-tested. 01-sketch.png vs toolbar/design-sketch.png. |
| W693 | GUID-0EEF7073 | Tab and Finish Sketch highlighted blue | Match | carried | Not re-tested. Blue tab and pale blue Finish panel. |
| W694 | GUID-0EEF7073 | Select plane; valid selections | Match | carried | Not re-tested. Origin planes. Others N/A-3D. |
| W695 | GUID-0EEF7073 | Note: selecting an existing sketch entity or browser node edits that sketch, no new sketch | Wrong | Fixed | Browser node and rim click both edit that sketch. |
| W696 | GUID-0EEF7073 | Right-click sketch node > Edit Sketch | Match | Match | Mode flow and D key during tutorials. |
| W697 | GUID-0EEF7073 | ...or in the timeline | N/A-3D | N/A-3D | No timeline. Not visibly marked. |
| W698 | Copy a sketch | Target sketch must be active | Match | carried | Not re-tested. Paste in Design says "Paste: Open a sketch first". |
| W699 | Copy a sketch | Active sketch: tab and green Finish Sketch | Match | carried | Not re-tested.  |
| W700 | Copy a sketch | Shift-click to multi-select | Match | Match | Window select, copy, Finish, paste in a new sketch, undo. |
| W701 | Copy a sketch | Window select | Match | Match | Window select, copy, Finish, paste in a new sketch, undo. |
| W702 | Copy a sketch | Right-click selected > Copy | Match | carried | Not re-tested. Note "Copied 2 curves". Menu is shorter than reference. P3-12. |
| W703 | Copy a sketch | Cmd+C | Match | Match | Window select, copy, Finish, paste in a new sketch, undo. |
| W704 | Copy a sketch | Ctrl+C | Match | carried | Not re-tested. Note "Copied 1 curves" (x3). Grammar slip. |
| W705 | Copy a sketch | Right-click empty canvas > Paste | Match | carried | Not re-tested. Pasted around the click point; constraints and dimensions come too. |
| W706 | Copy a sketch | Cmd+V | Match | Match | Window select, copy, Finish, paste in a new sketch, undo. |
| W707 | Copy a sketch | Ctrl+V | Match | carried | Not re-tested. Same. |
| W708 | Copy a sketch | Optionally move the copies | Match | carried | Not re-tested. Paste leaves them selected; Move/Copy and drag available. x3: dragged pasted line by (20,20); M opened Move/Copy with "1 selected". |
| W709 | Copy a sketch | Copy to a different sketch: copy, Finish | Match | Match | Window select, copy, Finish, paste in a new sketch, undo. |
| W710 | Copy a sketch | New sketch or existing via Edit Sketch; paste | Match | carried | Not re-tested. S1 to new S2; S2 into existing S1 (17 to 22 curves). Undo reverted. |
| W711 | Copy a sketch | Double-click node in timeline | N/A-3D | N/A-3D | No timeline. |
| W712 | GUID-BC1A5C26 | Right-click sketch name > Export DXF | Match | Match | Export DXF: dialog, options, valid file, parsed. |
| W713 | GUID-BC1A5C26 | Settings dialog displays | Match | Match | Export DXF: dialog, options, valid file, parsed. |
| W714 | GUID-BC1A5C26 | Select a unit type | Match | carried | Not re-tested. Inch export: 40 mm written as 1.5748. |
| W715 | GUID-BC1A5C26 | Default is the design's unit | Match | carried | Not re-tested. Millimeter preselected. Other design units not tested: no UI found to change them. |
| W716 | GUID-BC1A5C26 | Points checkbox | Match | Match | Export DXF: dialog, options, valid file, parsed. |
| W717 | GUID-BC1A5C26 | Projected Geometry checkbox | Match | Match | Export DXF: dialog, options, valid file, parsed. |
| W718 | GUID-BC1A5C26 | Construction Geometry checkbox | Match | Match | Export DXF: dialog, options, valid file, parsed. |
| W719 | GUID-BC1A5C26 | OK opens save dialog | Match | Match | Export DXF: dialog, options, valid file, parsed. |
| W720 | GUID-BC1A5C26 | Enter a new name | Match | carried | Not re-tested. a, b, c.dxf (no doubled extension). |
| W721 | GUID-BC1A5C26 | Specify a location | Partial | Fixed | Choose Location in the save dialog where the browser has a save picker. Elsewhere it is the download, a browser limit. |
| W722 | GUID-BC1A5C26 | Save | Match | Match | Export DXF: dialog, options, valid file, parsed. |
| W723 | GUID-BC1A5C26 | Tip: laser cutting | No claim | No claim | Advice. |
| W724 | GUID-BC1A5C26 | Tip: body face edges auto-projected | N/A-3D | N/A-3D |  |
| W725 | GUID-BC1A5C26 | Save to a Fusion project | N/A-3D | N/A-3D | Cloud. Not visibly marked. |
| W726 | GUID-3E407E01 (video, no transcript) | Delete a feature, sketch plane lost, warning | N/A-3D | N/A-3D | Needs bodies. Frames: Deletion Warning, then "The sketch plane is lost". |
| W727 | GUID-3E407E01 (video) | Timeline right-click > Redefine Sketch Plane; dialog with Plane field; pick; OK | Missing | Fixed | Redefine Sketch Plane moves to YZ; undo restores. |
| W728 | GUID-88CC0E51 (video, no transcript) | Create Sketch via toolbar in empty design; plane picker with tooltip "Select a plane or planar face" | Match | Match | Mode flow and D key during tutorials. |
| W729 | GUID-88CC0E51 (video) | Right-click marking menu lists workspace menus incl. Sketch | Partial | Fixed | Design right-click also has a list with Sketch, File and View entries. |
| W730 | GUID-88CC0E51 (video) | Sketch palette on entry; Center Rectangle at origin | Match | carried | Not re-tested.  |
| W731 | GUID-88CC0E51 (video) | Sketches folder in browser gets new node; multiple sketches | Match | Match | Mode flow and D key during tutorials. |
| W732 | GUID-88CC0E51 (video) | Choosing plane by 3D orientation, orbiting | N/A-3D | N/A-3D | Status kept. The Orbit view (`V`) orbits and picks a sketch to edit; planes are still chosen in the fixed picker or by folding about a line, not by orientation. |
| W733 | GUID-88CC0E51 (video) | Construction planes at unique angles | N/A-3D | N/A-3D | Not visibly marked. |
| W734 | GUID-88CC0E51 (video) | Slice hides geometry | N/A-3D | N/A-3D | No bodies. Row is absent, P3-1. |
| W735 | GUID-88CC0E51 (video) | New sketch on an existing sketch face / projected edges | Partial | Fixed | 2D analogue needs no Project step now. |
| W736 | GUID-422FB3ED (video, no transcript) | Slides: sketches are the foundation; offset; linked to original | Match | carried | Not re-tested. Link: x2 projection follows source. Offset itself is out of my scope. |
| W737 | GUID-422FB3ED (video) | Polygon centred on origin; circle at origin | Match | carried | Not re-tested. v1. |
| W738 | GUID-422FB3ED (video) | H/V on top edge rotates polygon level | Match | carried | Not re-tested. Vertices to (±17.9,31). Regular hexagon kept. |
| W739 | GUID-422FB3ED (video) | Drag a vertex: polygon scales | Match | carried | Not re-tested. x from 17.9 to 28.7, still regular. |
| W740 | GUID-422FB3ED (video) | Drag circle rim to resize | Match | carried | Not re-tested.  |
| W741 | GUID-422FB3ED (video) | Ø30 and 32 give fully constrained | Match | carried | Not re-tested. DOF 0 black. |
| W742 | GUID-422FB3ED (video) | Hexagon appearance | Partial | Partial | P3. Construction circle and 12 glyphs remain; video is clean. |
| W743 | GUID-422FB3ED (video) | Empty-canvas marking menu with tools (Circle, Rectangle, Spline, Project, Offset, Line, Dimension, Stop Sketch) | Partial | Fixed | Ring plus Circle, Rectangle, Spline, Project, Offset list. |
| W744 | GUID-422FB3ED (video) | Extrude, Revolve, several features from one sketch | N/A-3D | N/A-3D | Multiple closed profiles in a sketch do show. Reasons need narration. |
| W745 | GUID-5FBF8139 (video, no transcript) | Two lines, each with 50 dimension | Match | carried | Not re-tested. v1. |
| W746 | GUID-5FBF8139 (video) | Click other dimension while editing: "fx: 50.00" link | Match | carried | Not re-tested. Editor gets `d1`, label reads "fx: 50.00" (v1-04). Editing d1 to 70 moved both. |
| W747 | GUID-5FBF8139 (video) | Equal instead of link | Match | carried | Not re-tested. Second line 50. |
| W748 | GUID-5FBF8139 (video) | Position by 50 from left / 50 from right / midpoint; change 100 to 125 | Match | carried | Not re-tested. All three run with 100 to 125. Midpoint stays centred; left dimension stays 30 from left; right dimension stays 30 from right (values 30 instead of 50 to avoid the midpoint snap). |
| W749 | GUID-5FBF8139 (video) | Why each is preferred | Untested | Untested | Narration. |
| W750 | GUID-962B7698 | Tutorials index: four tutorials and what each covers | No claim | No claim | Each is covered below. "rely on automatic constraints" confirmed in T2. |
| W751 | GUID-8A74B516 | T1 overview: hollow cylinder, gear teeth, pockets | No claim | No claim | Overview. 2D parts done in full, 3D stopped. |
| W752 | GUID-9C55293D | 1a Create Sketch, select XZ plane | Partial | Fixed | Picker reads XY (Top), YZ, XZ. |
| W753 | GUID-9C55293D | 1b entering sketch shows Sketch tab and Palette | Match | Match | Tutorial re-walked end to end. |
| W754 | GUID-9C55293D | 1c Sketch > Create > Center Diameter Circle | Match | Match | Tutorial re-walked end to end. |
| W755 | GUID-9C55293D | 1d hover origin, cursor snaps | Match | Match | Tutorial re-walked end to end. |
| W756 | GUID-9C55293D | 1e-g click, drag away, click again | Match | Match | Tutorial re-walked end to end. |
| W757 | GUID-9C55293D | 2a-b Sketch Dimension, click edge | Match | Match | Tutorial re-walked end to end. |
| W758 | GUID-9C55293D | 2c "Click again to place the dimension" | Partial | Fixed | Click on the X axis places; 62 applied. |
| W759 | GUID-9C55293D | 2d-e Type 62 mm, Enter | Match | Match | Tutorial re-walked end to end. |
| W760 | GUID-9C55293D | 2f Finish Sketch | Match | Match | Tutorial re-walked end to end. |
| W761 | GUID-9C55293D | Tip: Home View next to the ViewCube | Missing | Fixed | Home View button. ViewCube is N/A. |
| W762 | GUID-9C55293D | 3 Press Pull, Extrude 8 mm | N/A-3D | N/A-3D | Stop point. |
| W763 | GUID-9C55293D | 4a-b Create Sketch, top of cylinder | Match | Match | Tutorial re-walked end to end. |
| W764 | GUID-9C55293D | 4c-d centre on origin | Match | Match | Tutorial re-walked end to end. |
| W765 | GUID-9C55293D | 4e Click, drag, type 56 mm in the Diameter field | Match | Match | Tutorial re-walked end to end. |
| W766 | GUID-9C55293D | 4f Enter | Match | Match | Tutorial re-walked end to end. |
| W767 | GUID-9C55293D | 4g Finish | Match | Match | Tutorial re-walked end to end. |
| W768 | GUID-9C55293D | 5 Press Pull 22 mm | N/A-3D | N/A-3D | Stop point. |
| W769 | GUID-E24C20F4 | 1a-b Create Sketch on base top | Match | Match | Tutorial re-walked end to end. |
| W770 | GUID-E24C20F4 | 1c-d Center Diameter Circle, click centre | Partial | Partial | P3. Unchanged: near Y axis it snaps with a coincident before the H/V step. |
| W771 | GUID-E24C20F4 | 1e type 4 mm | Match | Match | Tutorial re-walked end to end. |
| W772 | GUID-E24C20F4 | 1f "Press Enter twice" | Match | Match | Tutorial re-walked end to end. |
| W773 | GUID-E24C20F4 | 2a H/V tool | Match | Match | Tutorial re-walked end to end. |
| W774 | GUID-E24C20F4 | 2b click circle centre, click face centre; aligned | Match | Match | Tutorial re-walked end to end. |
| W775 | GUID-E24C20F4 | 2c Esc finishes constraint | Match | Match | Tutorial re-walked end to end. |
| W776 | GUID-E24C20F4 | Image 1-25: vertical glyph on both points | Partial | Fixed | Glyph on each point. |
| W777 | GUID-E24C20F4 | 3a-b Dimension centre then origin | Match | Match | Tutorial re-walked end to end. |
| W778 | GUID-E24C20F4 | 3c Drag right, click to place | Match | Match | Tutorial re-walked end to end. |
| W779 | GUID-E24C20F4 | 3d-e 25.4 mm, Enter | Match | Match | Tutorial re-walked end to end. |
| W780 | GUID-E24C20F4 | Note: profile shown black when fully defined | Match | Match | Tutorial re-walked end to end. |
| W781 | GUID-E24C20F4 | 4a Circular Pattern opens dialog | Match | Match | Tutorial re-walked end to end. |
| W782 | GUID-E24C20F4 | 4b Select next to Objects, pick circle | Match | Match | Tutorial re-walked end to end. |
| W783 | GUID-E24C20F4 | 4c Select next to Center Point, pick centre | Match | Match | Tutorial re-walked end to end. |
| W784 | GUID-E24C20F4 | 4d Type 6 in Quantity | Match | Match | Tutorial re-walked end to end. |
| W785 | GUID-E24C20F4 | 4e OK | Match | Match | Tutorial re-walked end to end. |
| W786 | GUID-E24C20F4 | Prompts in images ("Select sketch curves to pattern.", "Click to select sketch point or circular arc.", "Place center point", "Specify diameter of circle") | Partial | Fixed | Field-specific prompts. |
| W787 | GUID-E24C20F4 | 4f Finish | Match | Match | Tutorial re-walked end to end. |
| W788 | GUID-E24C20F4 | 5 Press Pull | N/A-3D | N/A-3D | Stop point. |
| W789 | GUID-45636CFB | 1a-b new sketch on base top | Match | Match | Tutorial re-walked end to end. |
| W790 | GUID-45636CFB | 1c 3-Point Arc | Match | Match | Tutorial re-walked end to end. |
| W791 | GUID-45636CFB | 1d-e click centres of two circles (other sketch) | Wrong | Fixed | Centres in the other sketch snap and project, no Project step. |
| W792 | GUID-45636CFB | 1f third point near inside edge | Match | Match | Tutorial re-walked end to end. |
| W793 | GUID-45636CFB | Image 1-38: arc end order | Partial | Fixed | Prompts in order, shown at the cursor too. |
| W794 | GUID-45636CFB | 2a-c Tangent, click arc, click inside edge | Wrong | Fixed | Tangent click on the other sketch circle projects it; R+d = 28.000000. |
| W795 | GUID-45636CFB | 2d Esc | Match | Match | Tutorial re-walked end to end. |
| W796 | GUID-45636CFB | 3 Circular pattern of six arcs | Match | Match | Tutorial re-walked end to end. |
| W797 | GUID-45636CFB | 3f Finish | Match | Match | Tutorial re-walked end to end. |
| W798 | GUID-45636CFB | 4 Press Pull | N/A-3D | N/A-3D | Stop point. |
| W799 | GUID-2CE698ED | T1 conclusion | No claim | No claim | Summary. |
| W800 | GUID-E8BB984B | Fork overview and prerequisites; File > New Design | Match | Match | Tutorial re-walked end to end. |
| W801 | Fork activity1 | Solid > Create > Create Sketch on XY | Match | Match | Tutorial re-walked end to end. |
| W802 | Fork activity1 | Orbit as necessary | N/A-3D | N/A-3D | Fixed 2D picker. Not visibly marked. |
| W803 | Fork activity1 | 3 rectangle tools with listed behaviour | Match | Match | Tutorial re-walked end to end. |
| W804 | Fork activity1 | Identify the origin: circle with two quadrants shaded | Match | Match | Tutorial re-walked end to end. |
| W805 | Fork activity1 | "Click Solid > Create > Rectangle > Center Rectangle" | Wrong | Fixed | SOLID menu reachable. |
| W806 | Fork activity1 | Click origin, drag, click | Match | Match | Tutorial re-walked end to end. |
| W807 | Fork activity1 | 5 circle tools | Match | Match | Tutorial re-walked end to end. |
| W808 | Fork activity1 | 2-Point Circle lower-left, lower-right corners | Partial | Fixed | Midpoint constraint added. |
| W809 | Fork activity1 | Summary: gray glyphs represent constraints | Match | Match | Tutorial re-walked end to end. |
| W810 | Fork activity2 | Sketch still open, or right-click Sketch1 > Edit Sketch | Match | Match | Tutorial re-walked end to end. |
| W811 | Fork activity2 | Click Line, click upper left corner | Match | Match | Tutorial re-walked end to end. |
| W812 | Fork activity2 | Up-left 45 deg, click | Match | Match | Tutorial re-walked end to end. |
| W813 | Fork activity2 | Up, click: vertical | Match | Match | Tutorial re-walked end to end. |
| W814 | Fork activity2 | Right, click: horizontal | Match | Match | Tutorial re-walked end to end. |
| W815 | Fork activity2 | Click Line again, click where you left off | Match | Match | Tutorial re-walked end to end. |
| W816 | Fork activity2 | Down, click: vertical | Match | Match | Tutorial re-walked end to end. |
| W817 | Fork activity2 | Click and hold on end of line | Match | Match | Tutorial re-walked end to end. |
| W818 | Fork activity2 | Drag right for tangent arc; click to finish | Match | Match | Tutorial re-walked end to end. |
| W819 | Fork activity2 | Up, click: vertical line, tangent to arc | Match | Match | Tutorial re-walked end to end. |
| W820 | Fork activity2 | "Click where you left off" with chain active | Partial | Fixed | Note clears on next action. |
| W821 | Fork activity2 | Right, click | Match | Match | Tutorial re-walked end to end. |
| W822 | Fork activity2 | Down, click | Match | Match | Tutorial re-walked end to end. |
| W823 | Fork activity2 | Down-left, click upper right corner | Match | Match | Tutorial re-walked end to end. |
| W824 | Fork activity2 | Drag an end of a line or arc to adjust | Match | Match | Tutorial re-walked end to end. |
| W825 | Fork conclusion | Finished fork | Match | carried | Not re-tested. t2-23 vs s2-fork-created: same shape with handle, circle, fork. |
| W826 | GUID-420D81EA | Tip: S opens Toolbox to search | Match | carried | Not re-tested. Palette opens, filter works, Enter runs tool (t4-02). |
| W827 | GUID-AB8D9509 | Create new design with + tab | Partial | Fixed | A + beside the design name starts a new design, with the same confirmation as File > New. |
| W828 | GUID-AB8D9509 | Create Sketch, Top (XY) | Match | Match | Tutorial re-walked end to end. |
| W829 | GUID-AB8D9509 | Line, origin, click end | Match | Match | Tutorial re-walked end to end. |
| W830 | GUID-AB8D9509 | First line roughly 500 mm | Partial | Fixed | A typed 500 mm line lands off the canvas, and the view fits to bring it in. |
| W831 | GUID-AB8D9509 | Continue lines; automatic constraints may differ | Match | Match | Tutorial re-walked end to end. |
| W832 | GUID-AB8D9509 | Esc exits tool | Partial | Fixed | One Esc leaves the tool. |
| W833 | GUID-AB8D9509 | 3a Perpendicular on 3 corner pairs | Wrong | Fixed | Either order, line kept; T3 ended DOF 0 both ways. |
| W834 | GUID-AB8D9509 | 3b H/V on two lower lines | Partial | Fixed | "That is already horizontal", no duplicates. |
| W835 | GUID-AB8D9509 | 3c Equal on two pairs | Match | Match | Tutorial re-walked end to end. |
| W836 | GUID-AB8D9509 | Esc exits | Match | Match | Tutorial re-walked end to end. |
| W837 | GUID-AB8D9509 | 4a Dimension lower line, click off, 500, Enter | Match | Match | Tutorial re-walked end to end. |
| W838 | GUID-AB8D9509 | 4b Angle: bottom line and angled line, 45 | Partial | Fixed | 45.0 degree sign. |
| W839 | GUID-AB8D9509 | 4c Aligned upper right 100 | Match | Match | Tutorial re-walked end to end. |
| W840 | GUID-AB8D9509 | Esc | Match | Match | Tutorial re-walked end to end. |
| W841 | GUID-AB8D9509 | Final image | Match | Match | Tutorial re-walked end to end. |
| W842 | GUID-6A2AE9D9 | 1a select, Shift, select; right-click; Normal/Construction | Match | Match | Tutorial re-walked end to end. |
| W843 | GUID-6A2AE9D9 | Note: construction not in profiles; dashed | Match | Match | Tutorial re-walked end to end. |
| W844 | GUID-6A2AE9D9 | 1b Center Diameter, select midpoint; triangle appears | Match | Match | Tutorial re-walked end to end. |
| W845 | GUID-6A2AE9D9 | "Drag the circle to the edge. A Tangent constraint appears" | Missing | Fixed | Tangent inferred, r=50 committed, DOF 0 kept. |
| W846 | GUID-6A2AE9D9 | 1c repeat at top | Missing | Fixed | As W845. |
| W847 | GUID-6A2AE9D9 | 1d Esc | Match | Match | Tutorial re-walked end to end. |
| W848 | GUID-6A2AE9D9 | 2a Fillet, select the two intersection points | Match | Match | Tutorial re-walked end to end. |
| W849 | GUID-6A2AE9D9 | 2b-c 100 mm, Enter | Match | Match | Tutorial re-walked end to end. |
| W850 | GUID-6A2AE9D9 | Note: fillets made together have equal radius | Match | Match | Tutorial re-walked end to end. |
| W851 | GUID-6A2AE9D9 | Note: create separately for different radii | Match | Match | Tutorial re-walked end to end. |
| W852 | GUID-6A2AE9D9 | Note: it deletes the 500 mm dimension | Match | Match | Tutorial re-walked end to end. |
| W853 | GUID-6A2AE9D9 | 2d Finish | Match | Match | Tutorial re-walked end to end. |
| W854 | GUID-6A2AE9D9 | 3 Press Pull, 50 mm | N/A-3D | N/A-3D | Stop point. |
| W855 | GUID-6A2AE9D9 | "Select the three profiles" | Match | Match | Tutorial re-walked end to end. |
| W856 | GUID-6A2AE9D9 | Note: one sketch, many profiles | Match | Match | Tutorial re-walked end to end. |
| W857 | GUID-6A2AE9D9 | 4a new sketch on the surface | Match | Match | Tutorial re-walked end to end. |
| W858 | GUID-6A2AE9D9 | 4b Line: left centre point, near middle, near upper centre; Esc | Wrong | Fixed | Centre picks across sketches, one Esc. |
| W859 | GUID-6A2AE9D9 | 4c Convert with Shift; right-click | Match | Match | Tutorial re-walked end to end. |
| W860 | GUID-6A2AE9D9 | 4d Parallel pairs (line/edge) | Match | Match | Tutorial re-walked end to end. |
| W861 | GUID-6A2AE9D9 | Note: construction lines turn black | Wrong | Fixed | Black dashes. |
| W862 | GUID-AEFB2074 | 1 first circle: snap to left end, 50 mm, Enter | Match | Match | Tutorial re-walked end to end. |
| W863 | GUID-AEFB2074 | Midpoint of horizontal, triangle glyph | Match | Match | Tutorial re-walked end to end. |
| W864 | GUID-AEFB2074 | Intersection of the construction lines | Match | Match | Tutorial re-walked end to end. |
| W865 | GUID-AEFB2074 | Midpoint of angled line | Match | Match | Tutorial re-walked end to end. |
| W866 | GUID-AEFB2074 | Right end of angled line | Match | Match | Tutorial re-walked end to end. |
| W867 | GUID-AEFB2074 | 2 Equal in pairs; note about pairs | Match | Match | Tutorial re-walked end to end. |
| W868 | GUID-AEFB2074 | 2 Finish | Match | Match | Tutorial re-walked end to end. |
| W869 | GUID-AEFB2074 | 3 Press Pull, Cut; note on CMD/CTRL adding profiles | N/A-3D | N/A-3D | Stop. |
| W870 | GUID-52E8728C | T3 conclusion | No claim | No claim | Summary. |
| W871 | GUID-EFAC0B74 | Fully defined: cannot drag; blue to black | Partial | Fixed | As W642. |
| W872 | GUID-087596A4 | 1 new design, Create Sketch | Match | Match | Tutorial re-walked end to end. |
| W873 | GUID-087596A4 | ViewCube Top, click top plane | N/A-3D | N/A-3D | No ViewCube. XY picked in fixed picker, labelled XY not Top. |
| W874 | GUID-087596A4 | 2 Center Rectangle via Create | Match | Match | Tutorial re-walked end to end. |
| W875 | GUID-087596A4 | Tip: S key | Match | Match | Tutorial re-walked end to end. |
| W876 | GUID-087596A4 | Click origin and sketch | Match | Match | Tutorial re-walked end to end. |
| W877 | GUID-087596A4 | 3a Line; 3b midpoint icon on hover | Match | Match | Tutorial re-walked end to end. |
| W878 | GUID-087596A4 | 3c ribbon Select | Match | Match | Tutorial re-walked end to end. |
| W879 | GUID-087596A4 | 3d click line | Match | Match | Tutorial re-walked end to end. |
| W880 | GUID-087596A4 | 3e Palette > Options > Construction | Match | Match | Tutorial re-walked end to end. |
| W881 | GUID-087596A4 | 3f Esc deselects; click empty deselects | Match | Match | Tutorial re-walked end to end. |
| W882 | GUID-087596A4 | 4 circle at origin | Match | Match | Tutorial re-walked end to end. |
| W883 | GUID-087596A4 | 5a-b 2-Point Rectangle above circle | Match | Match | Tutorial re-walked end to end. |
| W884 | GUID-087596A4 | 5c-e Select, Shift-click verticals, Construction | Match | Match | Tutorial re-walked end to end. |
| W885 | GUID-087596A4 | 6a-c 3-Point Arc, first and second points | Match | Match | Tutorial re-walked end to end. |
| W886 | GUID-087596A4 | 6d third, not at the centre | Match | Match | Tutorial re-walked end to end. |
| W887 | GUID-087596A4 | "Placing the point exactly at the center creates a constraint automatically" | Missing | Fixed | Midpoint inference, constraint added. |
| W888 | GUID-087596A4 | 6e repeat | Match | Match | Tutorial re-walked end to end. |
| W889 | GUID-087596A4 | 7a Mirror | Match | Match | Tutorial re-walked end to end. |
| W890 | GUID-087596A4 | 7b window drag; "12 objects" | Match | Match | Tutorial re-walked end to end. |
| W891 | GUID-087596A4 | Note: preselection, X to cancel | Match | Match | Tutorial re-walked end to end. |
| W892 | GUID-087596A4 | 7c-d Select next to Mirror Line, pick | Match | Match | Tutorial re-walked end to end. |
| W893 | GUID-087596A4 | 7e preview, OK | Match | Match | Tutorial re-walked end to end. |
| W894 | GUID-E8C8752F | Mirror gives associativity | Match | Match | Tutorial re-walked end to end. |
| W895 | GUID-E8C8752F | Concentric, H/V, Equal icon follows the cursor | Missing | Fixed | As M367. |
| W896 | GUID-E8C8752F | 1 Concentric, left arc, right arc: right moves | Match | Fixed | Right arc centre moves to the left arc's; left arc, rectangle and ends unmoved, with Mirror in place, both orders, five bulges. |
| W897 | GUID-E8C8752F | Concentric symbol appears | Match | Match | Tutorial re-walked end to end. |
| W898 | GUID-E8C8752F | 2 H/V circle centre then arcs centre: arcs move | Match | Fixed | Arcs centre reaches x=0, ends stay on the corners. |
| W899 | GUID-E8C8752F | Note: first selection is the reference | Match | Match | Tutorial re-walked end to end. |
| W900 | GUID-E8C8752F | 3 Equal left arc, right arc | Match | Fixed | Equal applies with no refusal, radii agree. |
| W901 | GUID-0A723EF7 | 1a step text repeats Concentric | No claim | No claim | Doc error in the heading; ignored. |
| W902 | GUID-0A723EF7 | Hide constraints with Show Constraints | Match | Match | Mode flow and D key during tutorials. |
| W903 | GUID-0A723EF7 | D key starts Sketch Dimension | Match | Match | Mode flow and D key during tutorials. |
| W904 | GUID-0A723EF7 | Sketch Dimension icon follows the cursor | Missing | Fixed | As M367. |
| W905 | GUID-0A723EF7 | Top edge 70 | Match | Match | Tutorial re-walked end to end. |
| W906 | GUID-0A723EF7 | Right edge 114 | Match | Match | Tutorial re-walked end to end. |
| W907 | GUID-0A723EF7 | Note: cutouts may look too large | Match | Match | Tutorial re-walked end to end. |
| W908 | GUID-0A723EF7 | Circle Ø12 | Match | Match | Tutorial re-walked end to end. |
| W909 | GUID-0A723EF7 | Bottom edge then construction line, 11 | Match | Match | Tutorial re-walked end to end. |
| W910 | GUID-0A723EF7 | Top edge then bottom edge, 28 | Match | Match | Tutorial re-walked end to end. |
| W911 | GUID-0A723EF7 | Arc 17 only; second arc and mirror follow | Match | Fixed | R17 on one arc: all four arcs 17. |
| W912 | GUID-0A723EF7 | Sketch fully defined, black | Partial | Fixed | DOF 0, Constrained, in 10 runs: five bulges, two pick orders. |
| W913 | GUID-0A723EF7 | Show Constraints back on | Match | Match | Tutorial re-walked end to end. |
| W914 | GUID-0A723EF7 | Finish Sketch on the Palette | Match | Match | Tutorial re-walked end to end. |
| W915 | GUID-91BE0A20 | Conclusion | No claim | No claim | Summary; final state reached. |
| W916 | Mode flow | Enter by ribbon icon or CREATE menu | Match | Match | Mode flow and D key during tutorials. |
| W917 | Mode flow | Esc cancels the plane picker | Partial | Fixed | Picker prompt clears. |
| W918 | Mode flow | Finish by toolbar, palette, marking ring | Match | Match | Mode flow and D key during tutorials. |
| W919 | Mode flow | Re-edit by menu and double-click | Match | Match | Mode flow and D key during tutorials. |
| W920 | Mode flow | Switch sketch without finishing | Match | carried | Not re-tested. Edit Sketch on Sketch1 from inside Sketch3. |
| W921 | Mode flow | Multiple sketches: inactive ones grey | Match | Match | Mode flow and D key during tutorials. |
| W922 | Mode flow | Hide/show, including active and hidden-edit | Match | carried | Not re-tested. Eye works. Editing a hidden sketch shows it while active and leaves `visible:false`. |
| W923 | Mode flow | Rename, delete, undo of both | Match | carried | Not re-tested. m1. Deleting the active sketch drops to Design; undo restores it without re-entering. |
| W924 | Mode flow | Tool keys in Design mode | Match | carried | Not re-tested. "Line: Open a sketch first". |
| W925 | Mode flow | Undo/redo across create, draw, dimension, finish, second sketch, re-edit | Match | carried | Not re-tested. m2: every undo state equals its snapshot; redo ends byte-equal. Finish and Edit are not undo steps. While in S1, undo edits S2 content, then removes S2, without changing mode. |
| W926 | Mode flow | Undo mid line chain | Match | carried | Not re-tested. Removes last segment; chain continues. |
| W927 | Mode flow | Reload | Match | carried | Not re-tested. Autosave restores design and active sketch; undo stack is cleared. |
| W928 | Mode flow | File > Save, New (confirm), Open | Match | carried | Not re-tested. `Untitled.sketch.json`; Open restored an equal document. |
| W929 | Soak | 10 min mixed real input, 1,575 ops, seed 7 | Match | Match | Soak seed 11, 4 min: 0 console errors, 0 zero-length lines. See section 6 for the drift note. |
| W930 | Soak | Drift in fully constrained sketch | Match | Match | Soak seed 11, 4 min: 0 console errors, 0 zero-length lines. See section 6 for the drift note. |
| W931 | Soak | Undo divergence | Match | Match | Soak seed 11, 4 min: 0 console errors, 0 zero-length lines. See section 6 for the drift note. |
| W932 | Soak | Reload consistency | Match | Match | Soak seed 11, 4 min: 0 console errors, 0 zero-length lines. See section 6 for the drift note. |
| W933 | Soak | Degenerate geometry | Wrong | Fixed | 4 min soak: 547 ops, 0 zero-length lines. |

## 6. How this was tested, and what wasn't

- All 207 non-Match rows and all findings re-run from their original repros, then varied. Headless Chromium, 1440 x 900, one browser at a time, real mouse and keyboard; `window.__sketch` read only. Screenshots were looked at. Scripts, logs and shots are in the session scratchpad under `audit-final/`.
- After the check round: the check's 213 pair sequences (118 on Parallel, Perpendicular, Collinear, Equal, Tangent and Concentric, 95 on Midpoint, Coincident, Horizontal/Vertical and Symmetry), both pick orders, on its mixed scene: nothing outside the picked objects' group moved, nothing collapsed, nothing refused or left red, undo exact in all. Only Equal and Symmetry changed a size, as they must. 13 of the first 118 changed fewer sizes than before and none more.
- After the recheck round, on the final build: the same pair sequences, 119 + 95 logged, with the same result, and the 2 Symmetry unlike picks as no-ops. Tuning fork, wall outlet, bracket and gear scripts complete with no errors. One recheck item withdrawn on measurement: the dependent line it reported going 28.49 to 34.99 was drawn at 34.99, so this build holds it and the earlier one had shortened it.
- Tutorials driven from the page text. T1 and T3 written fresh, with no Project step. T2 and T4 ported from the first audit's scripts, with arc picks corrected to the arc's true sweep. 3D steps skipped; sketches on faces became sketches on the same plane. T2 was driven by the SKETCH tab; the SOLID route was checked separately.
- Measured, not read: SVG in Chromium and rsvg; PDF rendered with pdftoppm at 10 px/mm; curvature from exported Beziers and from poles.
- Soak: 4 minutes, seed 11, 547 operations, 0 zero-length lines, 0 console errors. It logged 21 "drift" events of 1.5 mm and one Mirror step that timed out. Both were replayed on the audited build with the same seed and a check after every operation, and came back at the same operations.
  - Drift: not the solver. Op 52 sets d1 to 63 and restores 60. Ops 54 and 55 are the soak's random Undo, and the second takes the restore back, so d1 is 63 in the sketch not being edited, and every later check finds the same 1.5 mm. Nothing else ever changed that sketch. With the random Undo off, seed 11 on the fixed build: largest drift 8e-9 mm over 11 edit-and-restore rounds. With it on, seed 23 on the fixed build: 620 operations, 0 zero-length lines, and the only 3 changes to that sketch are at a random Undo.
  - Mirror: not the app. The soak picks a line's middle without checking it is on the canvas. At op 218 that was (-69, 130), behind the ribbon, so the click pressed Horizontal/Vertical, which ends Mirror as any tool change does, and the soak then waited for a dialog that had gone. The same happened at op 278 of the control run, on the AutoConstrain button.

- After the third recheck round: the harness above, in `scratchpad/round4/`, on the build with these fixes and on both earlier frozen builds. New permanent tests: `src/solver/corpus.test.ts` puts 14 shapes on 3 seeds through each constraint in either pick order, the tangents in every order, and each dimension to x0.7 to x1.6 and back, and fails on both earlier builds. `src/solver/bodies.test.ts` covers the body rule. The CHK4 group in `e2e/keep-shape.spec.ts` drives R1 to R6 and 8 more shapes with a real mouse. 27 of its 35 tests fail on Build 3; the other 8 are the value-and-back shapes, which guard what already worked. Final runs from clean: 1,024 unit tests in 34 files, 162 solver tests, clippy clean, 941 browser tests in 19.9 minutes at 2 workers.
- After the fourth recheck round: the harness above with the check's 23 fresh parts, its 80 order runs, its 466-row who-gives-way matrix and its pulley, hook and fillet probes added, baselined on Build 4. `src/solver/corpus.test.ts` now has 21 shapes, `src/solver/outlines.test.ts` and `src/model/names.test.ts` are new, and the CHK5 group in `e2e/keep-shape.spec.ts` drives what needs the UI. On Build 4's source, 35 of the unit tests fail. Final runs from clean: 1,156 unit tests in 36 files, 165 solver tests, clippy clean, 971 browser tests in 19.2 minutes at 2 workers.
- After the sixth recheck round: final runs on the final wasm, 1,180 unit tests in 36 files, 165 solver tests, clippy clean, 995 browser tests in 18.5 minutes at 2 workers, then the harness, baselined on the frozen build: 0 rows changed. `e2e/reopen.spec.ts` is new, and its 18 tests fail on the frozen build. The random runs no longer stop at a flip, so every build sees the same 4,000 edits, and a flip counts only where the outline was simple before the edit. The same frozen source reads both ways: with the stop 3,974 edits, 11 refused, 11 flips; without it 4,000 edits, 6 refused, 0 flips, and 20 changes of side on outlines already crossed.
- After the fifth recheck round: final runs from clean on the final wasm, 1,173 unit tests in 36 files, 165 solver tests, clippy clean, 977 browser tests in 19.4 minutes at 2 workers, then the harness. The corpus now compares DOF and free curves with a fresh analysis after every commit.

Not tested or limited:

- Chromium only. Cmd and Ctrl are synthetic key events on headless Mac.
- No comparison with real Fusion. "Different" means different from the pages, images and video frames.
- No video audio or transcript. Rows that rest on narration stay Untested or are noted.
- 309 Match rows are carried from the first audit, not re-tested. Pages with Match rows but no sampled row: SKT-SKETCH-CREATE-POINTS, SKT-REF-3D-SKETCH-SUPPORTED-CMD, SKT-REF-3D-SKETCH-SUPPORTED-CONSTRAINT, GUID-422FB3ED, GUID-5FBF8139, Fork conclusion, GUID-420D81EA.
- Real print through a browser print dialog was not done. PDFs came from Chromium's print path with `window.print` stubbed. The browser's own dialog scale is the user's setting, as the warning says.
- DXF checked by my own parser, not opened in CAD software. ezdxf is not installed.
- Trackpad pan and pinch were never run on a trackpad. `e2e/trackpad.spec.ts` and `src/app/wheel.test.ts` dispatch `WheelEvent`s in the shapes the documented behaviour gives. The rule reads a burst by `ctrlKey`, `deltaMode`, a sideways `deltaX`, fractional steps and spacing, and can be wrong in these ways: a wheel that sends small whole steps in quick succession (a spun free-wheeling mouse, or macOS acceleration) is read as a trackpad and pans; a trackpad drag whose first step is 50 px or more, or whose first two steps are more than 40 ms apart, zooms for that burst; a mouse with a tilt wheel pans sideways; a wheel notch under 50 px (a display scaled past 200%) is held 40 ms before it zooms. Safari reports a pinch as gesture events, not `wheel`, and is not handled. Real Windows precision touchpads, Linux touchpads and the Magic Mouse were not tried.
- Dark Mode was looked at in headless Chromium only, with the OS emulated through `prefers-color-scheme`. Forced-colours mode and a high-contrast OS theme are not handled.
- Blend G2 was checked by constraint only. Curvature comb degree 3 not compared with the image. AutoConstrain failure notification not forced. All at one zoom and DPR 1.
