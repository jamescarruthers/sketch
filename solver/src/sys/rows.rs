//! Constraints and dimensions other than tangent and curvature.

use super::*;

impl B<'_> {
    pub(super) fn collinear(&mut self, l: L, m: L, owner: u32) {
        for p in [m.0, m.1] {
            if p != l.0 && p != l.1 {
                self.row(owner, Eq::PointLine(p, l, 0.0));
            }
        }
    }

    pub(super) fn symmetric_pairs(
        &mut self,
        a: usize,
        b: usize,
        axis: L,
        variant: Option<i64>,
    ) -> Option<Pairs> {
        let mirror = |s: &Self, p: (f64, f64)| {
            let o = s.pos(axis.0);
            let d = s.dir(axis);
            let w = sub(p, o);
            let t = dot(w, d) / dot(d, d).max(1e-18);
            (2.0 * (o.0 + d.0 * t) - p.0, 2.0 * (o.1 + d.1 * t) - p.1)
        };
        let swap = |s: &Self, a0: usize, b0: usize, b1: usize| -> bool {
            if let Some(v) = variant {
                return v & 1 == 1;
            }
            let m = mirror(s, s.pos(s.pvar[a0]));
            let (p0, p1) = (s.pos(s.pvar[b0]), s.pos(s.pvar[b1]));
            norm(sub(m, p1)) < norm(sub(m, p0))
        };
        Some(match (self.curves[a].clone(), self.curves[b].clone()) {
            (Cv::Line { a: a0, b: a1 }, Cv::Line { a: b0, b: b1 }) => {
                let p = if swap(self, a0, b0, b1) {
                    vec![(a0, b1), (a1, b0)]
                } else {
                    vec![(a0, b0), (a1, b1)]
                };
                (p, vec![])
            }
            (Cv::Circle { c: c0, r: r0 }, Cv::Circle { c: c1, r: r1 }) => {
                (vec![(c0, c1)], vec![(r0, r1)])
            }
            (
                Cv::Arc {
                    c: c0,
                    a: a0,
                    b: a1,
                    ..
                },
                Cv::Arc {
                    c: c1,
                    a: b0,
                    b: b1,
                    ..
                },
            ) => {
                // Reflection reverses orientation, so a counter-clockwise arc's start maps to the
                // mirror arc's end unless the geometry says otherwise.
                let p = if swap(self, a0, b0, b1) {
                    vec![(c0, c1), (a0, b1), (a1, b0)]
                } else {
                    vec![(c0, c1), (a0, b0), (a1, b1)]
                };
                (p, vec![])
            }
            (
                Cv::Ellipse {
                    c: c0,
                    major: m0,
                    minor: n0,
                    ..
                },
                Cv::Ellipse {
                    c: c1,
                    major: m1,
                    minor: n1,
                    ..
                },
            ) => (vec![(c0, c1), (m0, m1), (n0, n1)], vec![]),
            (Cv::Spline(s0), Cv::Spline(s1)) if s0.pts.len() == s1.pts.len() => {
                let last = s0.pts.len() - 1;
                let rev = swap(self, s0.pts[0], s1.pts[0], s1.pts[last]);
                let mut p: Vec<(usize, usize)> = (0..=last)
                    .map(|i| (s0.pts[i], s1.pts[if rev { last - i } else { i }]))
                    .collect();
                for i in 0..s0.handles.len().min(s1.handles.len()) {
                    let j = if rev { s1.handles.len() - 1 - i } else { i };
                    if let (Some(h0), Some(h1)) = (s0.handles[i], s1.handles[j]) {
                        p.push((h0, h1));
                    }
                }
                (p, vec![])
            }
            _ => return None,
        })
    }

    pub(super) fn constraint(
        &mut self,
        k: &ConstraintIn,
        owner: u32,
        conflict: Option<&(usize, usize)>,
    ) -> Option<()> {
        let r = &k.refs;
        match (k.kind.as_str(), r.len()) {
            ("coincident", 2) => {
                if let Some(&(a, b)) = conflict {
                    self.row(owner, Eq::Coincident(self.pvar[a], self.pvar[b]));
                } else if self.pidx(&r[0]).is_some() && self.pidx(&r[1]).is_some() {
                    // Merged in `merge_points`.
                } else if let (Some(p), Some(c)) = (self.pidx(&r[0]), self.cidx(&r[1])) {
                    self.on_curve(p, c, owner)?;
                } else if let (Some(c), Some(p)) = (self.cidx(&r[0]), self.pidx(&r[1])) {
                    self.on_curve(p, c, owner)?;
                } else {
                    return None;
                }
            }
            ("horizontal", 1) => {
                let l = self.line(self.cidx(&r[0])?)?;
                self.row(owner, Eq::Horizontal(l));
            }
            ("vertical", 1) => {
                let l = self.line(self.cidx(&r[0])?)?;
                self.row(owner, Eq::Vertical(l));
            }
            ("horizontal", 2) => {
                let (p, q) = (self.pvar[self.pidx(&r[0])?], self.pvar[self.pidx(&r[1])?]);
                self.row(owner, Eq::Horizontal(L(p, q)));
            }
            ("vertical", 2) => {
                let (p, q) = (self.pvar[self.pidx(&r[0])?], self.pvar[self.pidx(&r[1])?]);
                self.row(owner, Eq::Vertical(L(p, q)));
            }
            ("parallel", 2) => {
                let (a, b) = (self.line(self.cidx(&r[0])?)?, self.line(self.cidx(&r[1])?)?);
                self.row(owner, Eq::Parallel(a, b));
            }
            ("perpendicular", 2) => {
                let (a, b) = (self.cidx(&r[0])?, self.cidx(&r[1])?);
                match (self.line(a), self.line(b)) {
                    (Some(l), Some(m)) => self.row(owner, Eq::Perp(l, m)),
                    (Some(l), None) => {
                        let (c, _) = self.circ(b)?;
                        self.row(owner, Eq::PointLine(c, l, 0.0));
                    }
                    (None, Some(l)) => {
                        let (c, _) = self.circ(a)?;
                        self.row(owner, Eq::PointLine(c, l, 0.0));
                    }
                    _ => return None,
                }
            }
            ("tangent", 2) => {
                self.tangent(self.cidx(&r[0])?, self.cidx(&r[1])?, k.variant, owner)?;
            }
            ("equal", 2) => {
                let (a, b) = (self.cidx(&r[0])?, self.cidx(&r[1])?);
                if let (Some(l), Some(m)) = (self.line(a), self.line(b)) {
                    self.row(owner, Eq::EqualLen(l, m));
                } else {
                    let (r0, r1) = (self.circ(a)?.1, self.circ(b)?.1);
                    self.row(owner, Eq::ScalarEqual(r0, r1));
                }
            }
            ("midpoint", 2) => {
                let (p, c) = self
                    .pidx(&r[0])
                    .zip(self.cidx(&r[1]))
                    .or_else(|| self.pidx(&r[1]).zip(self.cidx(&r[0])))?;
                self.midpoint(p, c, owner)?;
            }
            ("concentric", 2) => {
                if let Some(&(a, b)) = conflict {
                    self.row(owner, Eq::Coincident(self.pvar[a], self.pvar[b]));
                } else {
                    self.center_of(&r[0])?;
                    self.center_of(&r[1])?;
                }
            }
            ("collinear", 2) => {
                let (a, b) = (self.line(self.cidx(&r[0])?)?, self.line(self.cidx(&r[1])?)?);
                self.collinear(a, b, owner);
            }
            ("symmetric", 3) => {
                let axis = self.line(self.cidx(&r[2])?)?;
                if let (Some(a), Some(b)) = (self.pidx(&r[0]), self.pidx(&r[1])) {
                    self.row(owner, Eq::Symmetric(axis, self.pvar[a], self.pvar[b]));
                } else {
                    let (a, b) = (self.cidx(&r[0])?, self.cidx(&r[1])?);
                    let (pts, scalars) = self.symmetric_pairs(a, b, axis, k.variant)?;
                    for (p, q) in pts {
                        self.row(owner, Eq::Symmetric(axis, self.pvar[p], self.pvar[q]));
                    }
                    for (u, v) in scalars {
                        self.row(owner, Eq::ScalarEqual(u, v));
                    }
                }
            }
            ("curvature", 2) => {
                self.curvature(self.cidx(&r[0])?, self.cidx(&r[1])?, k.variant, owner)?;
            }
            ("offsetCopy", 2) => {
                let (p, q) = (self.pvar[self.pidx(&r[0])?], self.pvar[self.pidx(&r[1])?]);
                self.row(owner, Eq::HDist(q, p, k.dx.unwrap_or(0.0)));
                self.row(owner, Eq::VDist(q, p, k.dy.unwrap_or(0.0)));
            }
            ("rotatedCopy", 3) => {
                let c = self.pvar[self.pidx(&r[0])?];
                let (p, q) = (self.pvar[self.pidx(&r[1])?], self.pvar[self.pidx(&r[2])?]);
                self.row(owner, Eq::Angle(L(c, p), L(c, q), k.angle.unwrap_or(0.0)));
                self.row(owner, Eq::EqualLen(L(c, p), L(c, q)));
            }
            _ => return None,
        }
        Some(())
    }

    pub(super) fn midpoint(&mut self, p: usize, c: usize, owner: u32) -> Option<()> {
        let pp = self.pvar[p];
        match self.curves[c] {
            Cv::Line { a, b } => {
                self.row(owner, Eq::Midpoint(L(self.pvar[a], self.pvar[b]), pp));
            }
            Cv::Arc { c: ci, a, b, r } => {
                // On the circle and equidistant from both ends has two solutions, the arc's
                // midpoint and its antipode. Seeding the point inside the sweep picks the first,
                // and continuity keeps it.
                let (cp, ap, bp) = (self.pvar[ci], self.pvar[a], self.pvar[b]);
                let (o, s, e) = (self.pos(cp), self.pos(ap), self.pos(bp));
                let (t0, mut t1) = ((s.1 - o.1).atan2(s.0 - o.0), (e.1 - o.1).atan2(e.0 - o.0));
                if t1 < t0 {
                    t1 += 2.0 * PI;
                }
                let at = self.pos(pp);
                let mut t = (at.1 - o.1).atan2(at.0 - o.0);
                if t < t0 {
                    t += 2.0 * PI;
                }
                if t > t1 && !self.s.fixed[pp.0 as usize] {
                    let tm = (t0 + t1) / 2.0;
                    let rv = self.s.vals[r as usize];
                    self.s.vals[pp.0 as usize] = o.0 + rv * tm.cos();
                    self.s.vals[pp.1 as usize] = o.1 + rv * tm.sin();
                }
                self.row(owner, Eq::DistVar(cp, pp, r));
                self.row(owner, Eq::EqualLen(L(ap, pp), L(bp, pp)));
            }
            _ => return None,
        }
        Some(())
    }

    pub(super) fn dimension(&mut self, d: &DimensionIn, owner: u32) -> Option<()> {
        let r = &d.refs;
        let v = d.value;
        if !v.is_finite() || r.is_empty() {
            return None;
        }
        match d.kind.as_str() {
            "distance" => {
                if r.len() == 1 {
                    let l = self.line(self.cidx(&r[0])?)?;
                    self.row(owner, Eq::Dist(l.0, l.1, v));
                } else if let (Some(p), Some(q)) = (self.pidx(&r[0]), self.pidx(r.get(1)?)) {
                    self.row(owner, Eq::Dist(self.pvar[p], self.pvar[q], v));
                } else {
                    return self.point_line_dim(r, v, d.variant, owner);
                }
            }
            "horizontal" | "vertical" => {
                let (p, q) = self.two_points(r)?;
                let horizontal = d.kind == "horizontal";
                let (a, b) = (self.pos(p), self.pos(q));
                let delta = if horizontal { b.0 - a.0 } else { b.1 - a.1 };
                let s = match d.variant {
                    Some(k) => {
                        if k & 1 == 0 {
                            1.0
                        } else {
                            -1.0
                        }
                    }
                    None => {
                        if delta < 0.0 {
                            -1.0
                        } else {
                            1.0
                        }
                    }
                };
                let eq = if horizontal {
                    Eq::HDist(q, p, s * v)
                } else {
                    Eq::VDist(q, p, s * v)
                };
                self.row(owner, eq);
            }
            "pointLine" => return self.point_line_dim(r, v, d.variant, owner),
            "lineLine" => {
                let (a, b) = (self.cidx(&r[0])?, self.cidx(r.get(1)?)?);
                let (l, m) = (self.line(a)?, self.line(b)?);
                // Measure from the movable line's end onto the other line.
                let (p, base) = if b < 2 { (l.0, m) } else { (m.0, l) };
                self.signed_point_line(p, base, v, d.variant, owner);
            }
            "angle" => {
                let (a, b) = (self.cidx(&r[0])?, self.cidx(r.get(1)?)?);
                let (l, mut m) = (self.line(a)?, self.line(b)?);
                let k = d.variant.unwrap_or(0);
                if k & 1 == 1 {
                    m = m.rev();
                }
                let (u, w) = (self.dir(l), self.dir(m));
                let now = cross(u, w).atan2(dot(u, w));
                let negative = if k & 6 != 0 { k & 4 != 0 } else { now < 0.0 };
                let s = if negative { -1.0 } else { 1.0 };
                self.row(owner, Eq::Angle(l, m, s * v));
            }
            "radius" | "diameter" => {
                let target = if d.kind == "diameter" { v / 2.0 } else { v };
                if r.len() == 2 {
                    // Revolve diameter: [centerline, point], twice the distance from the axis.
                    let (c, p) = self
                        .cidx(&r[0])
                        .zip(self.pidx(&r[1]))
                        .or_else(|| self.cidx(&r[1]).zip(self.pidx(&r[0])))?;
                    let l = self.line(c)?;
                    self.signed_point_line(self.pvar[p], l, target, d.variant, owner);
                } else {
                    let (_, rv) = self.circ(self.cidx(&r[0])?)?;
                    self.row(owner, Eq::Fixed(rv, target));
                }
            }
            "arcLength" => {
                let Cv::Arc { c, a, b, .. } = self.curves[self.cidx(&r[0])?] else {
                    return None;
                };
                let (c, a, b) = (self.pvar[c], self.pvar[a], self.pvar[b]);
                self.row(owner, Eq::ArcLength { c, a, b, len: v });
            }
            "tangentLine" => {
                // A hidden point on the rim, on the radius square to the line: net one equation.
                let (c, rv) = self.circ(self.cidx(&r[0])?)?;
                let l = self.line(self.cidx(r.get(1)?)?)?;
                let along = self.dir(l);
                let len = norm(along).max(1e-12);
                let n = (-along.1 / len, along.0 / len);
                let centre = self.pos(c);
                let off = dot(n, sub(centre, self.pos(l.0)));
                let toward = if off >= 0.0 { -1.0 } else { 1.0 };
                let rim = if d.variant.unwrap_or(0) & 1 == 1 {
                    -toward
                } else {
                    toward
                };
                let radius = self.s.vals[rv as usize];
                let seed = (centre.0 + n.0 * rim * radius, centre.1 + n.1 * rim * radius);
                let t = self.hidden(seed);
                self.row(owner, Eq::DistVar(c, t, rv));
                self.row(owner, Eq::Perp(L(c, t), l));
                let s = if dot(n, sub(seed, self.pos(l.0))) >= 0.0 {
                    1.0
                } else {
                    -1.0
                };
                self.row(owner, Eq::PointLine(t, l, s * v));
            }
            "tangentRounds" => {
                // Hidden points on both rims, on the line of centres: four variables, five rows.
                let (c1, r1) = self.circ(self.cidx(&r[0])?)?;
                let (c2, r2) = self.circ(self.cidx(r.get(1)?)?)?;
                let (p, q) = (self.pos(c1), self.pos(c2));
                let u = sub(q, p);
                let len = norm(u).max(1e-12);
                let u = (u.0 / len, u.1 / len);
                let k = d.variant.unwrap_or(0);
                let s1 = if k & 1 == 1 { -1.0 } else { 1.0 };
                let s2 = if k & 2 == 2 { 1.0 } else { -1.0 };
                let (ra, rb) = (self.s.vals[r1 as usize], self.s.vals[r2 as usize]);
                let t1 = self.hidden((p.0 + u.0 * s1 * ra, p.1 + u.1 * s1 * ra));
                let t2 = self.hidden((q.0 + u.0 * s2 * rb, q.1 + u.1 * s2 * rb));
                self.row(owner, Eq::DistVar(c1, t1, r1));
                self.row(owner, Eq::DistVar(c2, t2, r2));
                self.row(owner, Eq::PointLine(t1, L(c1, c2), 0.0));
                self.row(owner, Eq::PointLine(t2, L(c1, c2), 0.0));
                self.row(owner, Eq::Dist(t1, t2, v));
            }
            "ellipseAxis" => {
                let e = self.ell(self.cidx(&r[0])?)?;
                let axis = if d.variant.unwrap_or(0) & 1 == 0 {
                    e.major
                } else {
                    e.minor
                };
                self.row(owner, Eq::Dist(e.c, axis, v));
            }
            _ => return None,
        }
        Some(())
    }

    pub(super) fn two_points(&self, r: &[String]) -> Option<(P, P)> {
        if r.len() == 1 {
            let l = self.line(self.cidx(&r[0])?)?;
            return Some((l.0, l.1));
        }
        Some((
            self.pvar[self.pidx(&r[0])?],
            self.pvar[self.pidx(r.get(1)?)?],
        ))
    }

    pub(super) fn point_line_dim(
        &mut self,
        r: &[String],
        v: f64,
        variant: Option<i64>,
        owner: u32,
    ) -> Option<()> {
        let (p, c) = self
            .pidx(r.first()?)
            .zip(self.cidx(r.get(1)?))
            .or_else(|| self.pidx(r.get(1)?).zip(self.cidx(r.first()?)))?;
        let l = self.line(c)?;
        self.signed_point_line(self.pvar[p], l, v, variant, owner);
        Some(())
    }

    pub(super) fn signed_point_line(
        &mut self,
        p: P,
        l: L,
        v: f64,
        variant: Option<i64>,
        owner: u32,
    ) {
        let s = match variant {
            Some(k) => {
                if k & 1 == 0 {
                    1.0
                } else {
                    -1.0
                }
            }
            None => {
                if cross(self.dir(l), sub(self.pos(p), self.pos(l.0))) < 0.0 {
                    -1.0
                } else {
                    1.0
                }
            }
        };
        self.row(owner, Eq::PointLine(p, l, s * v));
    }
}
