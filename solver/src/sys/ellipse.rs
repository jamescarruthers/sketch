//! Ellipses in ezpz terms: the two-circle construction and the conjugate point.

use super::*;

impl B<'_> {
    /// Point-on-ellipse by the two-circle construction: hidden O on the major circle and I on the
    /// minor circle, on one ray from the centre; P takes its major-axis coordinate from O and its
    /// minor-axis coordinate from I. 4 hidden variables, 5 rows: exactly one equation on P, and it
    /// is two-way (the point can drive the ellipse).
    pub(super) fn ell_point_rows(
        &mut self,
        e: Ell,
        p: P,
        curve: usize,
        owner: Option<u32>,
    ) -> (P, P) {
        if let Some(h) = self.ell_pts.get(&(p, curve)) {
            return *h;
        }
        let t = self.ell_param(e, self.pos(p));
        let (o, i) = self.ell_hidden(e, t);
        self.ell_rows(e, o, i, p, owner);
        self.ell_pts.insert((p, curve), (o, i));
        (o, i)
    }

    /// Centre, unit major, unit minor, semi-axes.
    pub(super) fn ell_frame(&self, e: Ell) -> Frame {
        let c = self.pos(e.c);
        let u = sub(self.pos(e.major), c);
        let v = sub(self.pos(e.minor), c);
        let (a, b) = (norm(u).max(1e-9), norm(v).max(1e-9));
        (c, (u.0 / a, u.1 / a), (v.0 / b, v.1 / b), a, b)
    }

    pub(super) fn ell_param(&self, e: Ell, p: (f64, f64)) -> f64 {
        let (c, u, v, a, b) = self.ell_frame(e);
        let d = sub(p, c);
        (dot(d, v) / b).atan2(dot(d, u) / a)
    }

    pub(super) fn ell_at(&self, e: Ell, t: f64) -> (f64, f64) {
        let (c, u, v, a, b) = self.ell_frame(e);
        let (x, y) = (a * t.cos(), b * t.sin());
        (c.0 + u.0 * x + v.0 * y, c.1 + u.1 * x + v.1 * y)
    }

    pub(super) fn ell_hidden(&mut self, e: Ell, t: f64) -> (P, P) {
        let (c, u, v, a, b) = self.ell_frame(e);
        let ray = (u.0 * t.cos() + v.0 * t.sin(), u.1 * t.cos() + v.1 * t.sin());
        let o = self.hidden((c.0 + ray.0 * a, c.1 + ray.1 * a));
        let i = self.hidden((c.0 + ray.0 * b, c.1 + ray.1 * b));
        (o, i)
    }

    pub(super) fn ell_rows(&mut self, e: Ell, o: P, i: P, p: P, owner: Option<u32>) {
        let eqs = [
            Eq::DistVar(e.c, o, e.ra),
            Eq::DistVar(e.c, i, e.rb),
            Eq::Angle(L(e.c, o), L(e.c, i), 0.0),
            Eq::Parallel(L(o, p), L(e.c, e.minor)),
            Eq::Parallel(L(i, p), L(e.c, e.major)),
        ];
        for eq in eqs {
            self.s.rows.push(Row { eq, owner });
        }
    }

    /// The conjugate point P' at parameter t + 90 degrees: c -> P' is parallel to the tangent at
    /// the point at parameter t. It is a second two-circle construction whose ray is perpendicular
    /// to the first, so there is no singularity at the axis ends, unlike intersecting the tangent
    /// with an axis.
    pub(super) fn ell_conjugate(&mut self, e: Ell, o: P, i: P, owner: u32) -> P {
        let (co, ci) = (
            sub(self.pos(o), self.pos(e.c)),
            sub(self.pos(i), self.pos(e.c)),
        );
        let c = self.pos(e.c);
        let o2 = self.hidden((c.0 - co.1, c.1 + co.0));
        let i2 = self.hidden((c.0 - ci.1, c.1 + ci.0));
        let t = self.ell_param_of_ray(e, co);
        let p2 = self.ell_at(e, t + PI / 2.0);
        let p2 = self.hidden(p2);
        self.row(owner, Eq::Perp(L(e.c, o), L(e.c, o2)));
        self.ell_rows(e, o2, i2, p2, Some(owner));
        p2
    }

    pub(super) fn ell_param_of_ray(&self, e: Ell, ray: (f64, f64)) -> f64 {
        let (_, u, v, _, _) = self.ell_frame(e);
        dot(ray, v).atan2(dot(ray, u))
    }

    pub(super) fn ell_closest(&self, e: Ell, score: impl Fn((f64, f64)) -> f64) -> f64 {
        let n = 128;
        let mut best = (f64::INFINITY, 0.0);
        for k in 0..n {
            let t = k as f64 / n as f64 * 2.0 * PI;
            let s = score(self.ell_at(e, t));
            if s < best.0 {
                best = (s, t);
            }
        }
        best.1
    }

    /// Point on the ellipse where a tangency touches: the existing contact point, or a hidden one
    /// seeded at the ellipse point nearest the other curve, which picks the near side stably.
    pub(super) fn ell_contact(
        &mut self,
        e: Ell,
        curve: usize,
        contact: Option<usize>,
        score: impl Fn((f64, f64)) -> f64,
    ) -> (P, P, P) {
        if let Some(root) = contact {
            let p = self.pvar[root];
            let (o, i) = self.ell_point_rows(e, p, curve, None);
            return (p, o, i);
        }
        let t = self.ell_closest(e, score);
        let at = self.ell_at(e, t);
        let p = self.hidden(at);
        let (o, i) = self.ell_point_rows(e, p, curve, None);
        (p, o, i)
    }
}
