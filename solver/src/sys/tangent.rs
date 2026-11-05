//! Tangent and curvature, per pair of curve kinds. The modelling is explained in the crate docs.

use super::*;

impl B<'_> {
    pub(super) fn aligned(&mut self, owner: u32, a: L, b: L) {
        let (u, v) = (self.dir(a), self.dir(b));
        let t = if dot(u, v) >= 0.0 { 0.0 } else { PI };
        self.row(owner, Eq::Angle(a, b, t));
    }

    pub(super) fn dir(&self, l: L) -> (f64, f64) {
        sub(self.pos(l.1), self.pos(l.0))
    }

    /// End of a spline used for tangency: `variant` wins, then the end at the contact point, then
    /// the end nearest the other curve.
    pub(super) fn spline_end(
        &self,
        c: usize,
        other: usize,
        variant: Option<bool>,
    ) -> Option<usize> {
        let Cv::Spline(s) = &self.curves[c] else {
            return None;
        };
        let (first, last) = (s.pts.first().copied()?, s.pts.last().copied()?);
        if let Some(v) = variant {
            return Some(if v { last } else { first });
        }
        let on = self.points_on(other);
        if on.contains(&self.root_of(first)) {
            return Some(first);
        }
        if on.contains(&self.root_of(last)) {
            return Some(last);
        }
        let (d0, d1) = (
            self.dist_to_curve(self.pos(self.pvar[first]), other),
            self.dist_to_curve(self.pos(self.pvar[last]), other),
        );
        Some(if d1 < d0 { last } else { first })
    }

    pub(super) fn dist_to_curve(&self, p: (f64, f64), c: usize) -> f64 {
        match self.shape(c) {
            Some(Shape::Line(l)) => {
                let d = self.dir(l);
                cross(d, sub(p, self.pos(l.0))).abs() / norm(d).max(1e-12)
            }
            Some(Shape::Circ(cp, r)) => {
                (norm(sub(p, self.pos(cp))) - self.s.vals[r as usize]).abs()
            }
            Some(Shape::Ell(e)) => {
                let t = self.ell_param(e, p);
                norm(sub(p, self.ell_at(e, t)))
            }
            _ => {
                let Cv::Spline(s) = &self.curves[c] else {
                    return f64::INFINITY;
                };
                let a = self.pos(self.pvar[s.pts[0]]);
                let b = self.pos(self.pvar[*s.pts.last().unwrap()]);
                norm(sub(p, a)).min(norm(sub(p, b)))
            }
        }
    }

    /// The tangent leg at a spline end: first/last control leg, or the fit point's handle. Without
    /// an active handle a fit spline has no variable that controls its end direction, so the leg
    /// is a constant direction taken from `samples` and the mapping is one-way: the other curve
    /// aligns to the spline.
    pub(super) fn spline_leg(&mut self, c: usize, end: usize) -> Option<(P, L)> {
        let Cv::Spline(s) = self.curves[c].clone() else {
            return None;
        };
        let e = self.pvar[end];
        let at_start = s.pts[0] == end;
        let i = if at_start { 0 } else { s.pts.len() - 1 };
        let other = if at_start {
            s.pts.get(1)
        } else {
            s.pts.len().checked_sub(2).map(|k| &s.pts[k])
        };
        if s.fit {
            if let Some(Some(h)) = s.handles.get(i) {
                return Some((e, L(e, self.pvar[*h])));
            }
            let dir = self.samples_end_dir(&s, at_start)?;
            let at = self.pos(e);
            let a = self.constant(at);
            let b = self.constant((at.0 + dir.0, at.1 + dir.1));
            return Some((e, L(a, b)));
        }
        Some((e, L(e, self.pvar[*other?])))
    }

    pub(super) fn samples_end_dir(&self, s: &SplineCv, at_start: bool) -> Option<(f64, f64)> {
        let idx = s.samples?;
        let pts = &self.s.samples[idx];
        let (a, b) = if at_start {
            (pts[0], pts[1])
        } else {
            (pts[pts.len() - 1], pts[pts.len() - 2])
        };
        let d = (b[0] - a[0], b[1] - a[1]);
        let n = norm(d);
        (n > 1e-12).then_some((d.0 / n, d.1 / n))
    }

    pub(super) fn tangent(
        &mut self,
        a: usize,
        b: usize,
        variant: Option<i64>,
        owner: u32,
    ) -> Option<()> {
        let (sa, sb) = (self.shape(a)?, self.shape(b)?);
        // Canonical order: line, circle, ellipse, spline.
        let rank = |s: &Shape| match s {
            Shape::Line(_) => 0,
            Shape::Circ(..) => 1,
            Shape::Ell(_) => 2,
            Shape::Spl => 3,
        };
        if rank(&sa) > rank(&sb) {
            let v = variant.map(|v| {
                if rank(&sa) == 3 {
                    ((v & 1) << 1) | ((v >> 1) & 1)
                } else {
                    v
                }
            });
            return self.tangent(b, a, v, owner);
        }
        let contact = self.contact(a, b);
        match (sa, sb) {
            (Shape::Line(l), Shape::Line(m)) => {
                self.row(owner, Eq::PointLine(m.0, l, 0.0));
                self.row(owner, Eq::PointLine(m.1, l, 0.0));
            }
            (Shape::Line(l), Shape::Circ(c, r)) => match contact {
                // With a shared point the native row plus |c - p| = r has a double root: the
                // contact can slide to first order, which reports a spurious dof and converges
                // linearly. Radius perpendicular to the line at the contact has neither problem.
                Some(root) => {
                    let p = self.pvar[root];
                    self.row(owner, Eq::Perp(l, L(c, p)));
                }
                None => {
                    let left = match variant {
                        Some(v) => v & 1 == 0,
                        None => cross(self.dir(l), sub(self.pos(c), self.pos(l.1))) >= 0.0,
                    };
                    let dl = if left { l } else { l.rev() };
                    self.row(owner, Eq::LineTangent(dl, c, r));
                }
            },
            (Shape::Circ(c1, r1), Shape::Circ(c2, r2)) => {
                let t = match contact {
                    Some(root) => self.pvar[root],
                    None => {
                        let internal = self.internal_tangent(c1, r1, c2, r2, variant);
                        let at = self.tangent_seed(c1, r1, c2, r2, internal);
                        let t = self.hidden(at);
                        self.row(owner, Eq::DistVar(c1, t, r1));
                        self.row(owner, Eq::DistVar(c2, t, r2));
                        t
                    }
                };
                let internal = match (contact, variant) {
                    (Some(_), Some(v)) => v & 1 == 1,
                    (Some(_), None) => {
                        dot(
                            sub(self.pos(t), self.pos(c1)),
                            sub(self.pos(t), self.pos(c2)),
                        ) > 0.0
                    }
                    (None, _) => self.internal_tangent(c1, r1, c2, r2, variant),
                };
                let angle = if internal { 0.0 } else { PI };
                self.row(owner, Eq::Angle(L(c1, t), L(c2, t), angle));
            }
            (Shape::Line(l), Shape::Ell(e)) => {
                let lp = self.pos(l.0);
                let d = self.dir(l);
                let score = move |p: (f64, f64)| (cross(d, sub(p, lp)) / norm(d).max(1e-12)).abs();
                let (p, o, i) = self.ell_contact(e, b, contact, score);
                if contact.is_none() {
                    self.row(owner, Eq::PointLine(p, l, 0.0));
                }
                let conj = self.ell_conjugate(e, o, i, owner);
                self.row(owner, Eq::Parallel(l, L(e.c, conj)));
            }
            (Shape::Circ(c, r), Shape::Ell(e)) => {
                let cp = self.pos(c);
                let rv = self.s.vals[r as usize];
                let score = move |p: (f64, f64)| (norm(sub(p, cp)) - rv).abs();
                let (p, o, i) = self.ell_contact(e, b, contact, score);
                if contact.is_none() {
                    self.row(owner, Eq::DistVar(c, p, r));
                }
                let conj = self.ell_conjugate(e, o, i, owner);
                self.row(owner, Eq::Perp(L(c, p), L(e.c, conj)));
            }
            (Shape::Ell(e1), Shape::Ell(e2)) => {
                let (c2, u2, v2, a2, b2) = self.ell_frame(e2);
                let score = move |p: (f64, f64)| {
                    let d = sub(p, c2);
                    let (x, y) = (dot(d, u2) / a2, dot(d, v2) / b2);
                    (x.hypot(y) - 1.0).abs()
                };
                let (p, o1, i1) = self.ell_contact(e1, a, contact, score);
                let (o2, i2) = self.ell_point_rows(e2, p, b, Some(owner));
                let (j1, j2) = (
                    self.ell_conjugate(e1, o1, i1, owner),
                    self.ell_conjugate(e2, o2, i2, owner),
                );
                self.row(owner, Eq::Parallel(L(e1.c, j1), L(e2.c, j2)));
            }
            (Shape::Line(l), Shape::Spl) => {
                let end = self.spline_end(b, a, variant.map(|v| v & 2 != 0))?;
                let (e, leg) = self.spline_leg(b, end)?;
                self.end_on_line(e, l, a, owner);
                self.aligned(owner, leg, l);
            }
            (Shape::Circ(c, r), Shape::Spl) => {
                let end = self.spline_end(b, a, variant.map(|v| v & 2 != 0))?;
                let (e, leg) = self.spline_leg(b, end)?;
                if !self.points_on(a).contains(&self.root_of(end)) {
                    self.row(owner, Eq::DistVar(c, e, r));
                }
                self.row(owner, Eq::Perp(leg, L(c, e)));
            }
            (Shape::Ell(el), Shape::Spl) => {
                let end = self.spline_end(b, a, variant.map(|v| v & 2 != 0))?;
                let (e, leg) = self.spline_leg(b, end)?;
                let (o, i) = self.ell_point_rows(el, e, a, Some(owner));
                let conj = self.ell_conjugate(el, o, i, owner);
                self.row(owner, Eq::Parallel(leg, L(el.c, conj)));
            }
            (Shape::Spl, Shape::Spl) => {
                let e1 = self.spline_end(a, b, variant.map(|v| v & 1 != 0))?;
                let e2 = self.spline_end(b, a, variant.map(|v| v & 2 != 0))?;
                let (p1, leg1) = self.spline_leg(a, e1)?;
                let (p2, leg2) = self.spline_leg(b, e2)?;
                if p1 != p2 {
                    self.row(owner, Eq::Coincident(p1, p2));
                }
                self.aligned(owner, leg1, leg2);
            }
            _ => return None,
        }
        Some(())
    }

    pub(super) fn end_on_line(&mut self, e: P, l: L, line: usize, owner: u32) {
        let on: Vec<P> = self.points_on(line).iter().map(|&r| self.pvar[r]).collect();
        if !on.contains(&e) {
            self.row(owner, Eq::PointLine(e, l, 0.0));
        }
    }

    pub(super) fn internal_tangent(
        &self,
        c1: P,
        r1: V,
        c2: P,
        r2: V,
        variant: Option<i64>,
    ) -> bool {
        if let Some(v) = variant {
            return v & 1 == 1;
        }
        let d = norm(sub(self.pos(c1), self.pos(c2)));
        let (a, b) = (self.s.vals[r1 as usize], self.s.vals[r2 as usize]);
        (d - (a - b).abs()).abs() < (d - (a + b)).abs()
    }

    pub(super) fn tangent_seed(&self, c1: P, r1: V, c2: P, r2: V, internal: bool) -> (f64, f64) {
        let (p1, p2) = (self.pos(c1), self.pos(c2));
        let (a, b) = (self.s.vals[r1 as usize], self.s.vals[r2 as usize]);
        let d = sub(p2, p1);
        let n = norm(d);
        let u = if n > 1e-9 {
            (d.0 / n, d.1 / n)
        } else {
            (1.0, 0.0)
        };
        let s = if internal && a < b { -a } else { a };
        (p1.0 + u.0 * s, p1.1 + u.1 * s)
    }

    /// Whether a spline has something at this end that steers its curvature: the next two control
    /// points, or a fit spline's handle.
    fn steers(&self, c: usize, other: usize, variant: Option<bool>) -> Option<bool> {
        let Cv::Spline(s) = self.curves[c].clone() else {
            return Some(false);
        };
        if s.rational || s.closed {
            return Some(false);
        }
        if !s.fit {
            return Some(s.pts.len() >= 3);
        }
        let end = self.spline_end(c, other, variant)?;
        let i = if s.pts[0] == end { 0 } else { s.pts.len() - 1 };
        Some(matches!(s.handles.get(i), Some(Some(_))))
    }

    /// What a spline end's curvature is to match on `other`, if that can be read.
    fn target_on(&mut self, other: usize, sc: usize, variant: Option<bool>) -> Option<Target> {
        if self.line(other).is_some() {
            return Some(Target::Straight);
        }
        if let Some((c, r)) = self.circ(other) {
            return Some(Target::Round(c, r));
        }
        if let Some(e) = self.ell(other) {
            return Some(Target::Ellipse(e));
        }
        let Cv::Spline(t) = self.curves[other].clone() else {
            return None;
        };
        let end = self.spline_end(other, sc, variant)?;
        let at_start = t.pts[0] == end;
        if t.rational {
            let rho = t.rho?;
            let far = if at_start { t.pts[2] } else { t.pts[0] };
            return Some(Target::Conic {
                end: self.pvar[end],
                leg: self.pvar[t.pts[1]],
                third: self.pvar[far],
                weight: rho / (1.0 - rho),
            });
        }
        Some(Target::End { spline: t.vars, at_start })
    }

    /// Curvature continuity. Includes tangency.
    pub(super) fn curvature(
        &mut self,
        a: usize,
        b: usize,
        variant: Option<i64>,
        owner: u32,
    ) -> Option<()> {
        let spline = |c: usize| matches!(self.curves[c], Cv::Spline(_));
        let both = spline(a) && spline(b);
        let (mut sc, mut other) = if spline(a) {
            (a, b)
        } else if spline(b) {
            (b, a)
        } else {
            return None;
        };
        // The ref order says which bit is which end, whichever of the two ends up steering.
        let bit = |c: usize| variant.map(|v| if both && c == b { v & 2 != 0 } else { v & 1 != 0 });
        if both && !self.steers(sc, other, bit(sc))? && self.steers(other, sc, bit(other))? {
            (sc, other) = (other, sc);
        }
        let Cv::Spline(s) = self.curves[sc].clone() else {
            return None;
        };
        let controlled = !s.fit && !s.rational && s.pts.len() >= 3;
        if controlled && let Some(l) = self.line(other) {
            let end = self.spline_end(sc, other, bit(sc))?;
            let (e, leg) = self.spline_leg(sc, end)?;
            self.end_on_line(e, l, other, owner);
            self.row(owner, Eq::PointLine(leg.1, l, 0.0));
            let third = self.third_point(&s, end);
            self.row(owner, Eq::PointLine(third, l, 0.0));
            return Some(());
        }
        let tangent_variant = variant.map(|v| {
            if both {
                v
            } else if sc == a {
                v & 1
            } else {
                (v & 1) << 1
            }
        });
        self.tangent(a, b, tangent_variant, owner)?;
        if !self.steers(sc, other, bit(sc))? {
            return Some(());
        }
        let end = self.spline_end(sc, other, bit(sc))?;
        let (e, leg) = self.spline_leg(sc, end)?;
        let Some(target) = self.target_on(other, sc, if both { bit(other) } else { None }) else {
            return Some(());
        };
        if s.fit {
            return self.fit_curvature(&s, end, leg, target, owner);
        }
        let third = self.third_point(&s, end);
        let factor = curvature_factor(s.degree, s.pts.len());
        let row = self.s.rows.len();
        let end2 = match &self.curves[other] {
            Cv::Spline(t) if !t.fit && !t.rational && t.pts.len() >= 3 => Some(t.clone()),
            _ => None,
        };
        let (kappa, sign) = if let Some((c, r)) = self.circ(other) {
            let side = cross(self.dir(leg), sub(self.pos(c), self.pos(e)));
            (Kappa::Radius(r), if side >= 0.0 { 1.0 } else { -1.0 })
        } else if let Some(t) = end2 {
            let e2 = self.spline_end(other, sc, bit(other))?;
            let (p2, leg2) = self.spline_leg(other, e2)?;
            let third2 = self.third_point(&t, e2);
            let side = cross(self.dir(leg), sub(self.pos(third), self.pos(e)));
            let kappa = Kappa::Spline {
                end: p2,
                leg: leg2.1,
                third: third2,
                factor: curvature_factor(t.degree, t.pts.len()),
            };
            (kappa, if side >= 0.0 { 1.0 } else { -1.0 })
        } else {
            (Kappa::Signed(target), 1.0)
        };
        let real = matches!(kappa, Kappa::Signed(_)).then_some((s.vars, s.pts[0] == end));
        if real.is_some() && self.mode.tangent_only {
            return Some(());
        }
        self.row(owner, Eq::PointLine(third, leg, 0.0));
        self.s.dyns.push(Dyn::Curvature {
            row,
            end: e,
            leg: leg.1,
            sign,
            factor,
            kappa,
            prev: None,
            real,
        });
        Some(())
    }

    pub(super) fn third_point(&self, s: &SplineCv, end: usize) -> P {
        let i = if s.pts[0] == end { 2 } else { s.pts.len() - 3 };
        self.pvar[s.pts[i]]
    }
}
