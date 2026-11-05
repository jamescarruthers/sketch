//! Crate-private equation IR.
//!
//! Every row of the system is held as an `Eq` rather than directly as an ezpz `Constraint` for
//! three reasons: variable ids have to be renumbered per component (ezpz indexes its values by id
//! directly), the outer iterations need to change constants between rounds, and ezpz does not
//! expose its Jacobian or matrix rank, so `dof` has to be computed from a copy of the residuals.
//! `Eq::eval` mirrors ezpz's residual formulas exactly and is generic so it can run on dual
//! numbers; `tests/analysis.rs` cross-checks the result against ezpz's own SVD analysis.

use kcl_ezpz::Constraint;
use kcl_ezpz::datatypes::inputs::{
    DatumCircle, DatumCircularArc, DatumDistance, DatumLineSegment, DatumPoint,
};
use kcl_ezpz::datatypes::{Angle, AngleKind};
use std::f64::consts::PI;
use std::ops::{Add, Div, Mul, Neg, Sub};

pub type V = u32;

#[derive(Clone, Copy, Debug, PartialEq, Hash)]
pub struct P(pub V, pub V);

impl std::cmp::Eq for P {}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct L(pub P, pub P);

impl L {
    pub fn rev(self) -> L {
        L(self.1, self.0)
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Eq {
    Fixed(V, f64),
    ScalarEqual(V, V),
    Coincident(P, P),
    Dist(P, P, f64),
    DistVar(P, P, V),
    /// p.x - q.x = d
    HDist(P, P, f64),
    /// p.y - q.y = d
    VDist(P, P, f64),
    /// Same Y.
    Horizontal(L),
    /// Same X.
    Vertical(L),
    Parallel(L, L),
    Perp(L, L),
    /// Signed angle from the first line's direction to the second's, radians.
    Angle(L, L, f64),
    EqualLen(L, L),
    Midpoint(L, P),
    /// Signed: positive when the point is left of the line's direction.
    PointLine(P, L, f64),
    Symmetric(L, P, P),
    ArcLength {
        c: P,
        a: P,
        b: P,
        len: f64,
    },
    /// Signed distance from the centre to the line equals r: centre left of the direction.
    LineTangent(L, P, V),
    /// `out = a + r (b - a)` on single variables, with `r` a constant. Written as a horizontal
    /// distance to a line through (a, ends.0) and (b, ends.1), where `ends` hold 0 and 1.
    Lerp {
        out: V,
        a: V,
        b: V,
        r: V,
        ends: P,
    },
}

fn vc(p: P) -> DatumPoint {
    DatumPoint::new_xy(p.0, p.1)
}
fn ln(l: L) -> DatumLineSegment {
    DatumLineSegment::new(vc(l.0), vc(l.1))
}

impl Eq {
    pub fn dim(&self) -> usize {
        match self {
            Eq::Coincident(..) | Eq::Midpoint(..) | Eq::Symmetric(..) | Eq::ArcLength { .. } => 2,
            _ => 1,
        }
    }

    /// Every variable the row depends on (may repeat when points are shared).
    pub fn vars(&self, out: &mut Vec<V>) {
        let mut p = |p: P| {
            out.push(p.0);
            out.push(p.1);
        };
        match *self {
            Eq::Fixed(v, _) => out.push(v),
            Eq::ScalarEqual(a, b) => out.extend([a, b]),
            Eq::Coincident(a, b) | Eq::Dist(a, b, _) => {
                p(a);
                p(b);
            }
            Eq::DistVar(a, b, r) => {
                p(a);
                p(b);
                out.push(r);
            }
            Eq::HDist(a, b, _) => out.extend([a.0, b.0]),
            Eq::VDist(a, b, _) => out.extend([a.1, b.1]),
            Eq::Horizontal(l) => out.extend([l.0.1, l.1.1]),
            Eq::Vertical(l) => out.extend([l.0.0, l.1.0]),
            Eq::Parallel(a, b) | Eq::Perp(a, b) | Eq::Angle(a, b, _) | Eq::EqualLen(a, b) => {
                p(a.0);
                p(a.1);
                p(b.0);
                p(b.1);
            }
            Eq::Midpoint(l, q) | Eq::PointLine(q, l, _) => {
                p(l.0);
                p(l.1);
                p(q);
            }
            Eq::Symmetric(l, a, b) => {
                p(l.0);
                p(l.1);
                p(a);
                p(b);
            }
            Eq::ArcLength { c, a, b, .. } => {
                p(c);
                p(a);
                p(b);
            }
            Eq::LineTangent(l, c, r) => {
                p(l.0);
                p(l.1);
                p(c);
                out.push(r);
            }
            Eq::Lerp { out: o, a, b, r, ends } => {
                out.extend([o, r, a, b, ends.0, ends.1]);
            }
        }
    }

    pub fn map(&self, f: &impl Fn(V) -> V) -> Eq {
        let p = |p: P| P(f(p.0), f(p.1));
        let l = |l: L| L(p(l.0), p(l.1));
        match *self {
            Eq::Fixed(v, x) => Eq::Fixed(f(v), x),
            Eq::ScalarEqual(a, b) => Eq::ScalarEqual(f(a), f(b)),
            Eq::Coincident(a, b) => Eq::Coincident(p(a), p(b)),
            Eq::Dist(a, b, d) => Eq::Dist(p(a), p(b), d),
            Eq::DistVar(a, b, r) => Eq::DistVar(p(a), p(b), f(r)),
            Eq::HDist(a, b, d) => Eq::HDist(p(a), p(b), d),
            Eq::VDist(a, b, d) => Eq::VDist(p(a), p(b), d),
            Eq::Horizontal(a) => Eq::Horizontal(l(a)),
            Eq::Vertical(a) => Eq::Vertical(l(a)),
            Eq::Parallel(a, b) => Eq::Parallel(l(a), l(b)),
            Eq::Perp(a, b) => Eq::Perp(l(a), l(b)),
            Eq::Angle(a, b, t) => Eq::Angle(l(a), l(b), t),
            Eq::EqualLen(a, b) => Eq::EqualLen(l(a), l(b)),
            Eq::Midpoint(a, q) => Eq::Midpoint(l(a), p(q)),
            Eq::PointLine(q, a, d) => Eq::PointLine(p(q), l(a), d),
            Eq::Symmetric(a, u, v) => Eq::Symmetric(l(a), p(u), p(v)),
            Eq::ArcLength { c, a, b, len } => Eq::ArcLength {
                c: p(c),
                a: p(a),
                b: p(b),
                len,
            },
            Eq::LineTangent(a, c, r) => Eq::LineTangent(l(a), p(c), f(r)),
            Eq::Lerp { out, a, b, r, ends } => Eq::Lerp {
                out: f(out),
                a: f(a),
                b: f(b),
                r: f(r),
                ends: p(ends),
            },
        }
    }

    pub fn lower(&self) -> Constraint {
        match *self {
            Eq::Fixed(v, x) => Constraint::Fixed(v, x),
            Eq::ScalarEqual(a, b) => Constraint::ScalarEqual(a, b),
            Eq::Coincident(a, b) => Constraint::PointsCoincident(vc(a), vc(b)),
            Eq::Dist(a, b, d) => Constraint::Distance(vc(a), vc(b), d),
            Eq::DistVar(a, b, r) => Constraint::DistanceVar(vc(a), vc(b), DatumDistance::new(r)),
            Eq::HDist(a, b, d) => Constraint::HorizontalDistance(vc(a), vc(b), d),
            Eq::VDist(a, b, d) => Constraint::VerticalDistance(vc(a), vc(b), d),
            Eq::Horizontal(l) => Constraint::Horizontal(ln(l)),
            Eq::Vertical(l) => Constraint::Vertical(ln(l)),
            Eq::Parallel(a, b) => Constraint::LinesAtAngle(ln(a), ln(b), AngleKind::Parallel),
            Eq::Perp(a, b) => Constraint::LinesAtAngle(ln(a), ln(b), AngleKind::Perpendicular),
            Eq::Angle(a, b, t) => {
                Constraint::LinesAtAngle(ln(a), ln(b), AngleKind::Other(Angle::from_radians(t)))
            }
            Eq::EqualLen(a, b) => Constraint::LinesEqualLength(ln(a), ln(b)),
            Eq::Midpoint(l, q) => Constraint::Midpoint(ln(l), vc(q)),
            Eq::PointLine(q, l, d) => Constraint::PointLineDistance(vc(q), ln(l), d),
            Eq::Symmetric(l, a, b) => Constraint::Symmetric(ln(l), vc(a), vc(b)),
            Eq::ArcLength { c, a, b, len } => Constraint::ArcLength(
                DatumCircularArc {
                    center: vc(c),
                    start: vc(a),
                    end: vc(b),
                },
                len,
            ),
            Eq::LineTangent(l, c, r) => Constraint::LineTangentToCircle(
                ln(l),
                DatumCircle {
                    center: vc(c),
                    radius: DatumDistance::new(r),
                },
            ),
            Eq::Lerp { out, a, b, r, ends } => Constraint::HorizontalPointLineDistance(
                DatumPoint::new_xy(out, r),
                DatumLineSegment::new(DatumPoint::new_xy(a, ends.0), DatumPoint::new_xy(b, ends.1)),
                0.0,
            ),
        }
    }

    /// Residuals, same formulas as ezpz's `Constraint::residual`, including its degeneracy guards.
    pub fn eval<T: Num>(&self, x: &impl Fn(V) -> T) -> [T; 2] {
        let z = T::c(0.0);
        let p = |p: P| (x(p.0), x(p.1));
        let sub = |a: (T, T), b: (T, T)| (a.0 - b.0, a.1 - b.1);
        let cross = |a: (T, T), b: (T, T)| a.0 * b.1 - a.1 * b.0;
        let dot = |a: (T, T), b: (T, T)| a.0 * b.0 + a.1 * b.1;
        let norm = |a: (T, T)| (a.0 * a.0 + a.1 * a.1).sqrt();
        let dir = |l: L| sub(p(l.1), p(l.0));
        match *self {
            Eq::Fixed(v, t) => [x(v) - T::c(t), z],
            Eq::ScalarEqual(a, b) => [x(a) - x(b), z],
            Eq::Coincident(a, b) => {
                let d = sub(p(a), p(b));
                [d.0, d.1]
            }
            Eq::Dist(a, b, d) => [norm(sub(p(a), p(b))) - T::c(d), z],
            Eq::DistVar(a, b, r) => [norm(sub(p(a), p(b))) - x(r), z],
            Eq::HDist(a, b, d) => [x(a.0) - x(b.0) - T::c(d), z],
            Eq::VDist(a, b, d) => [x(a.1) - x(b.1) - T::c(d), z],
            Eq::Horizontal(l) => [x(l.0.1) - x(l.1.1), z],
            Eq::Vertical(l) => [x(l.0.0) - x(l.1.0), z],
            Eq::Parallel(a, b) => [cross(dir(a), dir(b)), z],
            Eq::Perp(a, b) => [dot(dir(a), dir(b)), z],
            Eq::Angle(a, b, t) => {
                let (u, v) = (dir(a), dir(b));
                if norm(u).val() < 1e-4 || norm(v).val() < 1e-4 {
                    return [z, z];
                }
                let r = cross(u, v).atan2(dot(u, v)) - T::c(t);
                let turns = (r.val() / (2.0 * PI)).round();
                [r - T::c(turns * 2.0 * PI), z]
            }
            Eq::EqualLen(a, b) => [norm(dir(a)) - norm(dir(b)), z],
            Eq::Midpoint(l, q) => {
                let half = T::c(0.5);
                [
                    x(q.0) - x(l.0.0) * half - x(l.1.0) * half,
                    x(q.1) - x(l.0.1) * half - x(l.1.1) * half,
                ]
            }
            Eq::PointLine(q, l, d) => {
                let v = dir(l);
                let n = norm(v);
                if n.val() < 1e-4 {
                    return [z, z];
                }
                [cross(v, sub(p(q), p(l.0))) / n - T::c(d), z]
            }
            Eq::Symmetric(l, a, b) => {
                let v = dir(l);
                let w = sub(p(a), p(l.0));
                let t = dot(w, v) / dot(v, v);
                let proj = (v.0 * t, v.1 * t);
                let rej = sub(w, proj);
                let two = T::c(2.0);
                let refl = (w.0 - rej.0 * two, w.1 - rej.1 * two);
                let q = p(b);
                let o = p(l.0);
                [refl.0 - q.0 + o.0, refl.1 - q.1 + o.1]
            }
            Eq::ArcLength { c, a, b, len } => {
                let u = sub(p(a), p(c));
                let v = sub(p(b), p(c));
                let r2 = dot(u, u);
                if r2.val() < 1e-4 {
                    return [z, z];
                }
                let alpha = T::c(len) / r2.sqrt();
                [dot(u, v) / r2 - alpha.cos(), cross(u, v) / r2 - alpha.sin()]
            }
            Eq::LineTangent(l, c, r) => {
                let v = dir(l);
                let n = norm(v);
                if n.val() < 1e-4 {
                    return [z, z];
                }
                [cross(v, sub(p(c), p(l.1))) / n - x(r), z]
            }
            Eq::Lerp { out, a, b, r, ends } => {
                let (o, i) = (x(ends.0), x(ends.1));
                [x(out) - x(a) - (x(r) - o) * (x(b) - x(a)) / (i - o), z]
            }
        }
    }
}

pub trait Num:
    Copy
    + Add<Output = Self>
    + Sub<Output = Self>
    + Mul<Output = Self>
    + Div<Output = Self>
    + Neg<Output = Self>
{
    fn c(v: f64) -> Self;
    fn val(self) -> f64;
    fn sqrt(self) -> Self;
    fn sin(self) -> Self;
    fn cos(self) -> Self;
    fn atan2(self, x: Self) -> Self;
}

impl Num for f64 {
    fn c(v: f64) -> f64 {
        v
    }
    fn val(self) -> f64 {
        self
    }
    fn sqrt(self) -> f64 {
        f64::sqrt(self)
    }
    fn sin(self) -> f64 {
        f64::sin(self)
    }
    fn cos(self) -> f64 {
        f64::cos(self)
    }
    fn atan2(self, x: f64) -> f64 {
        f64::atan2(self, x)
    }
}

/// Forward-mode dual number: exact partial derivatives, so rank decisions don't depend on a
/// finite-difference step.
#[derive(Clone, Copy, Debug)]
pub struct Dual {
    pub v: f64,
    pub d: f64,
}

impl Add for Dual {
    type Output = Dual;
    fn add(self, o: Dual) -> Dual {
        Dual {
            v: self.v + o.v,
            d: self.d + o.d,
        }
    }
}
impl Sub for Dual {
    type Output = Dual;
    fn sub(self, o: Dual) -> Dual {
        Dual {
            v: self.v - o.v,
            d: self.d - o.d,
        }
    }
}
impl Mul for Dual {
    type Output = Dual;
    fn mul(self, o: Dual) -> Dual {
        Dual {
            v: self.v * o.v,
            d: self.d * o.v + self.v * o.d,
        }
    }
}
impl Div for Dual {
    type Output = Dual;
    fn div(self, o: Dual) -> Dual {
        Dual {
            v: self.v / o.v,
            d: (self.d * o.v - self.v * o.d) / (o.v * o.v),
        }
    }
}
impl Neg for Dual {
    type Output = Dual;
    fn neg(self) -> Dual {
        Dual {
            v: -self.v,
            d: -self.d,
        }
    }
}
impl Num for Dual {
    fn c(v: f64) -> Dual {
        Dual { v, d: 0.0 }
    }
    fn val(self) -> f64 {
        self.v
    }
    fn sqrt(self) -> Dual {
        let s = self.v.sqrt();
        // Matches ezpz: a zero distance contributes an empty Jacobian row.
        Dual {
            v: s,
            d: if s < 1e-4 { 0.0 } else { self.d / (2.0 * s) },
        }
    }
    fn sin(self) -> Dual {
        Dual {
            v: self.v.sin(),
            d: self.d * self.v.cos(),
        }
    }
    fn cos(self) -> Dual {
        Dual {
            v: self.v.cos(),
            d: -self.d * self.v.sin(),
        }
    }
    fn atan2(self, x: Dual) -> Dual {
        let n = self.v * self.v + x.v * x.v;
        Dual {
            v: self.v.atan2(x.v),
            d: if n == 0.0 {
                0.0
            } else {
                (self.d * x.v - self.v * x.d) / n
            },
        }
    }
}
