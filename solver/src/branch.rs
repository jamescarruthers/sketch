//! Which branch of the geometry a solve is on. A guard here turns down a jump onto another branch and
//! nothing else: where the value goes by way of continuous steps, the geometry may go there too.

use std::f64::consts::{PI, TAU};

pub type Pt = (f64, f64);

/// Most an arc's sweep may change in one solve. Any more is another root, not this one moved: a real
/// change that large arrives over several steps, each a small one.
const MAX_SWEEP_STEP: f64 = PI / 2.0;
/// An arc this near a full turn has closed on itself.
const CLOSED: f64 = TAU - 0.05;
/// A loop this thin, as a share of its perimeter squared, has no side to be on.
const FLAT_LOOP: f64 = 1e-7;

/// Counter-clockwise from `a` to `b` about `c`, in 0 to a full turn.
pub fn sweep(c: Pt, a: Pt, b: Pt) -> f64 {
    let (u, v) = ((a.0 - c.0, a.1 - c.1), (b.0 - c.0, b.1 - c.1));
    let t = turn(u, v);
    if t < 0.0 { t + TAU } else { t }
}

/// The signed angle from direction `u` to direction `v`.
pub fn turn(u: Pt, v: Pt) -> f64 {
    (u.0 * v.1 - u.1 * v.0).atan2(u.0 * v.0 + u.1 * v.1)
}

/// Whether an arc that began this solve at `began` has jumped, or closed on itself.
pub fn arc_jumped(now: f64, began: f64) -> bool {
    now > CLOSED || (now - began).abs() > MAX_SWEEP_STEP
}

/// An arc edge of a loop: from corner `.0` to the next, about `.1`, counter-clockwise if `.2`.
pub type Bulge = (usize, Pt, bool);

/// The side a loop is on, or 0 when it is too thin to have one.
pub fn side(pts: &[Pt]) -> f64 {
    side_of(pts, &[])
}

/// The same with arc edges: the area is the outline's, chord polygon and arc segments together.
pub fn side_of(pts: &[Pt], bulges: &[Bulge]) -> f64 {
    let mut sum = 0.0;
    let mut round = 0.0;
    for (i, p) in pts.iter().enumerate() {
        let q = pts[(i + 1) % pts.len()];
        sum += p.0 * q.1 - q.0 * p.1;
        round += (q.0 - p.0).hypot(q.1 - p.1);
    }
    let mut area = sum / 2.0;
    for &(at, c, ccw) in bulges {
        let (p, q) = (pts[at], pts[(at + 1) % pts.len()]);
        let r = (p.0 - c.0).hypot(p.1 - c.1);
        let t = sweep(c, p, q) - if ccw { 0.0 } else { TAU };
        area += r * r * (t - t.sin()) / 2.0;
    }
    if area.abs() > FLAT_LOOP * round * round { area } else { 0.0 }
}

/// Whether a loop that began on the side `was` has left it. Going thin enough to have no side counts:
/// from there it could come back either way, and only this keeps it on its own side on any route.
pub fn loop_crossed(pts: &[Pt], was: f64) -> bool {
    side(pts) * was <= 0.0
}
