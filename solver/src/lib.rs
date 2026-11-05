//! Sketch constraint solver: the document model mapped onto `kcl-ezpz`, unmodified but for a DogLeg trial in `vendor/`.
//!
//! One wasm entry point, [`solve`], takes and returns JSON (docs/SPEC.md section 4). Native code
//! and tests use [`solve::solve`] directly.
//!
//! # Variables
//!
//! Coincident point pairs and concentric centres are union-found onto one pair of ezpz variables,
//! the first-listed point's position wins. Circles have a radius variable, and so do arcs, kept by
//! `DistanceVar` from the centre to both ends, so equal and tangent treat them alike. Ellipses
//! have a variable per semi-axis. Fixed variables stay in the system as `Fixed` rows but don't
//! connect components: each component gets its own copy.
//!
//! # Mapping
//!
//! | Constraint | Rows |
//! |---|---|
//! | coincident pt/pt | shared variables |
//! | coincident pt/line | `PointLineDistance` 0, on the infinite line |
//! | coincident pt/circle or arc | `DistanceVar` to the radius, on the full circle, not the sweep |
//! | coincident pt/ellipse | two-circle construction, see below |
//! | coincident pt/spline | outer iteration on `samples`, then a pull where that cannot do it |
//! | horizontal, vertical | `Horizontal`, `Vertical`, on a line or two points |
//! | parallel, perpendicular | `LinesAtAngle` |
//! | perpendicular line/circle | radial: `PointLineDistance` of the centre, 0 |
//! | equal | `LinesEqualLength`, or `ScalarEqual` on radius variables |
//! | midpoint line | `Midpoint` |
//! | midpoint arc | on the circle + equal chords to both ends; seeded inside the sweep |
//! | concentric | shared centre variables |
//! | collinear | `PointLineDistance` 0 for each end not shared with the first line |
//! | symmetric | `Symmetric` per point pair; `ScalarEqual` on circle radii |
//! | offsetCopy | `HorizontalDistance` + `VerticalDistance` |
//! | rotatedCopy | `LinesAtAngle` + `LinesEqualLength`, both from the centre |
//! | tangent | see below |
//! | curvature | see below |
//!
//! | Dimension | Rows |
//! |---|---|
//! | distance | `Distance` |
//! | horizontal, vertical | `HorizontalDistance`, `VerticalDistance`, signed |
//! | pointLine, lineLine | `PointLineDistance`, signed. lineLine measures one end of the second line (of the non-axis line, when one is an axis): parallelism is not implied |
//! | angle | `LinesAtAngle`, signed |
//! | radius, diameter | `Fixed` on the radius variable |
//! | diameter [line, point] | `PointLineDistance` of half the value |
//! | arcLength | `ArcLength` |
//! | ellipseAxis | `Distance` centre to the axis end: the value is a semi-axis |
//! | tangentLine | hidden point on the rim, radial and square to the line, `PointLineDistance` from it |
//! | tangentRounds | hidden point on each rim, both on the line of centres, `Distance` between them |
//!
//! # Branches
//!
//! Rows with a side are all signed: signed distances, signed angles, and no
//! `CircleTangentToCircle`, whose branch is re-chosen by smallest residual on every evaluation. The side is picked once per solve from `variant` or, without one,
//! from the incoming geometry, which is stable because the incoming geometry satisfies the row.
//!
//! | Where | `variant` |
//! |---|---|
//! | tangent line/circle | bit 0: 0 centre left of a->b, 1 right |
//! | tangent circle/circle | bit 0: 0 external, 1 internal |
//! | tangent or curvature with a spline | bit 0: end of the first ref, bit 1: end of the second. 0 start, 1 end |
//! | symmetric curves | bit 0: swap the end-point pairing |
//! | horizontal, vertical dimension | bit 0: 0 q after p, 1 q before p |
//! | pointLine, lineLine, [line, point] diameter | bit 0: 0 left of the line, 1 right |
//! | angle dimension | bit 0: measure to the reversed second line. bit 1 force positive, bit 2 force negative |
//! | ellipseAxis | bit 0: 0 major, 1 minor |
//! | tangentLine | bit 0: 0 the rim facing the line, 1 the far rim |
//! | tangentRounds | bit 0, bit 1: the same for the first and second ref, facing each other when 0 |
//!
//! # Hidden helpers, for what ezpz lacks
//!
//! **Tangent with a contact point.** Where both curves already pass through one point, by a shared
//! end or point-on-curve, the native tangent row is the wrong model: tangent plus "contact is on
//! both" has a double root, so the contact slides to first order, the Jacobian drops rank, a
//! spurious dof appears and Gauss-Newton turns linear. Tangency there is only the direction at
//! that point: radius perpendicular to the line, or the two radii collinear.
//!
//! **Tangent with no contact point.** Line and circle use `LineTangentToCircle`, ordered for the
//! side. Two circles use a hidden point T on both, with both radii to T aligned, opposite for
//! external. Both are one equation net, and T's position isn't a dof.
//!
//! **Ellipse, two-way.** A point P on an ellipse takes its major-axis coordinate from a hidden O on
//! the major circle and its minor-axis coordinate from a hidden I on the minor circle, O and I on
//! one ray from the centre: 4 hidden variables, 5 rows, net one equation on P, and P can push the
//! ellipse. The tangent direction at P comes from a second such construction at t + 90 degrees,
//! whose point P' gives the conjugate diameter: c->P' is parallel to the tangent at P. That costs
//! 6 more hidden variables and 6 more rows and, unlike intersecting the tangent with an axis, has
//! no singular position. A tangency without a contact seeds P at the ellipse point nearest the
//! other curve. Elliptical arc ends are held on the ellipse the same way.
//!
//! **Spline tangent, end only.** A spline is tangent at an end, through the leg there: the first
//! or last control leg, a conic's leg to its vertex, or a fit point's handle. If the end isn't
//! already on the other curve a row puts it there, so tangency to a line or circle is two
//! equations rather than a sliding contact. The direction row is a signed angle, so a leg can't
//! fold back into a cusp. **One-way**: a fit spline end with no active handle has no variable that
//! controls its direction, so the leg is a constant taken from `samples` and the other curve aligns
//! to the spline. To make it two-way the UI must activate a handle, and Tangent and Curvature do.
//!
//! **Point on spline, riding.** The point stays on the tangent line of `samples` at its nearest
//! foot, moved between solve rounds. No spline variable is in the row, so the spline drives the
//! point. Samples are constants within a solve, so the bridge re-samples and re-solves when a
//! spline's own points or handles move. This is the first build of every solve, so a sketch riding
//! happily solves exactly as it would with no pull in the crate. The row is a tangent line, so a
//! value the curve reaches further on can be out of its reach: an unmet row is read along the curve
//! and the point tried from each place it crosses zero before anything pulls. The spline is free of the row:
//! a value between its ends moves those ends and leaves its interior points where they are.
//!
//! **Point on spline, pulling.** A second build, in [`solve::solve`], for what riding cannot do: a
//! drag of the point itself, a drag that stopped short, or a row left unmet. ezpz has no row for
//! a linear mix, and needs none: `HorizontalPointLineDistance` on a line through (a, 0) and (b, 1)
//! reads `x - a - y (b - a)`, and with `y` a constant that is `x = a + y (b - a)`, on single
//! variables. That is [`eq::Eq::Lerp`], one row per axis. A chain of them makes a hidden point T,
//! the spline's nearby points mixed by how far the curve moves per unit of each: B-spline basis
//! values, or a fit spline's cardinal functions with its chords held. A hidden G sits a lever
//! from T along the tangent, and the point is on line T-G, at the constant distance that puts that
//! line through the true foot. Chain and lever are 2k rows on 2k hidden variables for k points of
//! the spline, the last row is one net equation, and the spline is in it. Between rounds the foot,
//! the shares and the constant are read off the curve at the current values
//! ([`spline::Curve`], the same curve as `src/geom/spline.ts`), so the mix only shapes the step and
//! the answer is exact: the shares can be wrong by the pull of a chord or a far point without the
//! point ending up off the curve. A spline with all its nearby points fixed has nothing to give and
//! keeps the riding row. A conic is not a linear mix of anything and rides. With a value
//! asked for, a build with the interior points held is tried too, and taken unless its ends travel
//! over three times as far as letting the interior move would.
//!
//! **Curvature, control splines.** With a line, the first three control points go on the line,
//! which is exact: the end has zero curvature and is tangent. With an arc or another control
//! spline, tangency plus the third control point at signed offset `h = k a^2 / f` from the end leg,
//! where a is the leg length and f comes from the clamped uniform knots. `h` depends on a, so it is
//! an outer iteration, on a secant because the leg shortens as h grows. It is two-way.
//!
//! **Curvature, fit splines.** A natural end has zero curvature, always, and no variable to change
//! that: G2 with a line holds as it stands, and anything else needs the handle that Tangent and
//! Curvature activate. With a handle of length a along unit T, the end's second derivative is
//! `6 D / h^2 - (4 d0 + 2 d1) / h`, for chord D of length h, and curvature is
//! `cross(T, 6 D / h^2 - 2 d1 / h) / (3 a / h)^2`. `d0` is along T, so it drops out, and `d1`
//! depends on `d0` only along T too: the top does not depend on a. So curvature goes exactly as
//! `1 / a^2`, one row `Distance` from the end to the handle gives it in closed form, and no fit
//! point moves. That needs a handle between 1/8 and 3/4 of the chord, and a spline already bending
//! the right way. Otherwise the row is `PointLineDistance` of the next fit point from the leg, its
//! constant found by a secant on the real curvature, seeded by a nudge. Either way the point the
//! row steers is put in place before the row is solved, so the row does not pull the joint and the
//! curve on the far side of it. The row is chosen per build, from the geometry coming in. A build
//! that sticks or leaves the real curvature unmet settles tangent alone first, since a long turn of
//! the leg swings what the row ties to it, then tries again from there, by the next fit point if
//! it must. Failing that the component keeps its input geometry and the constraint is reported: its
//! row is met by construction, so the real curve is what is asked. A handle being dragged has its
//! length from the cursor, so the next fit point carries the curvature; with that pinned, the
//! handle stays.
//!
//! The target is the other curve's real signed curvature, read at the current values, with the sign
//! the two curves share at the joint: a radius, zero for a line, an ellipse's at the joint, a conic's
//! end, or the other spline's end. A control spline matched to one of these takes the same target
//! through its third control point, and answers to the same check of the real curve. Which of two
//! splines steers: the first ref, if it can. A
//! conic never steers, and with a line, an arc or another conic it stays tangent only. Nor does a
//! fit spline end with no handle, against a curve that has a curvature of its own.
//!
//! # Analysis
//!
//! ezpz's `FreedomAnalysis` lists free variables but not the rank, so it cannot give `dof`, and it
//! runs a dense SVD. [`analysis`] computes both by sparse elimination instead; `tests/freedom.rs`
//! checks it against ezpz's own result on every system there. See [`mod@solve`] for the drag
//! strategy and why ezpz's priorities are not used.

pub mod analysis;
pub mod branch;
pub mod api;
pub mod eq;
pub mod solve;
pub mod spline;
pub mod sys;

use wasm_bindgen::prelude::wasm_bindgen;

/// Take the DogLeg step in place of Gauss-Newton. A trial: see [`solve::set_dogleg`].
#[wasm_bindgen]
pub fn set_dogleg(on: bool) {
    solve::set_dogleg(on);
}

/// Whether solves take the DogLeg step.
#[wasm_bindgen]
pub fn dogleg() -> bool {
    solve::dogleg()
}

#[wasm_bindgen]
/// `solve(json) -> json`, the wasm entry point.
pub fn solve(json: &str) -> String {
    let out = match serde_json::from_str::<api::Input>(json) {
        Ok(input) => solve::solve(&input),
        Err(e) => api::Output {
            ok: false,
            error: Some(format!("bad input: {e}")),
            ..Default::default()
        },
    };
    serde_json::to_string(&out).unwrap_or_else(|e| format!("{{\"ok\":false,\"error\":\"{e}\"}}"))
}
