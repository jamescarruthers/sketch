//! A point that pulls the spline it is on. The modelling is explained in the crate docs.

use super::*;

/// Length of the hidden lever along the tangent. Its value does not matter, only that it is long.
const LEVER: f64 = 100.0;
/// Places a row is read at per span, looking for where a point could slide to.
const SLIDE_PER_SPAN: usize = 24;
/// Places tried for one point, nearest first.
const MAX_SLIDES: usize = 6;

impl B<'_> {
    /// Whether this point can move this spline at all.
    pub(super) fn can_pull(&self, s: &SplineCv) -> bool {
        !s.rational && s.pts.len() >= 2 && s.pts.iter().any(|&q| !self.s.fixed[self.pvar[q].0 as usize])
    }

    /// `point` on the spline: on the tangent at its foot, the foot a mix of the spline's own nearby
    /// points. `None` when none of those is free to move.
    pub(super) fn on_spline(&mut self, point: P, s: &SplineCv, owner: u32) -> Option<()> {
        let spline = s.vars;
        let curve = self.s.shape(spline);
        let t = curve.nearest(self.pos(point));
        let by_pull = curve.around(t);
        let free = |b: &Self, &i: &usize| !b.s.fixed[b.s.splines[spline].pts[i].0 as usize];
        let free_near: Vec<usize> = by_pull.iter().filter(|i| free(self, i)).copied().collect();
        if free_near.is_empty() {
            return None;
        }
        // Biggest share first keeps the running total of the mix away from zero.
        let w = curve.weights(&free_near, t);
        let mut order: Vec<usize> = (0..free_near.len()).collect();
        order.sort_by(|&a, &b| w[b].abs().total_cmp(&w[a].abs()));
        let idx: Vec<usize> = order.iter().map(|&k| free_near[k]).collect();

        let ends = self.constant((0.0, 1.0));
        let pts: Vec<P> = idx.iter().map(|&i| self.s.splines[spline].pts[i]).collect();
        let mut tee = pts[0];
        let (mut mixed, mut share) = (Vec::new(), Vec::new());
        for &q in &pts[1..] {
            let out = self.hidden(self.pos(tee));
            let r = self.new_var(0.0, true);
            self.rows(Eq::Lerp { out: out.0, a: tee.0, b: q.0, r, ends });
            self.rows(Eq::Lerp { out: out.1, a: tee.1, b: q.1, r, ends });
            mixed.push(out);
            share.push(r);
            tee = out;
        }
        let gee = self.hidden(self.pos(tee));
        let rows = [self.s.rows.len(), self.s.rows.len() + 1, self.s.rows.len() + 2];
        self.rows(Eq::HDist(gee, tee, LEVER));
        self.rows(Eq::VDist(gee, tee, 0.0));
        self.row(owner, Eq::PointLine(point, L(tee, gee), 0.0));
        self.s.dyns.push(Dyn::OnSpline {
            point,
            spline,
            idx,
            mixed,
            share,
            tee,
            gee,
            rows,
        });
        // With a value asked for, the spline's ends are tried before its interior.
        if self.mode.hold_interior {
            let n = s.pts.len();
            for &q in &s.pts[1..n.saturating_sub(1)] {
                let v = self.pvar[q];
                if !self.s.fixed[v.0 as usize] && !self.s.holds.contains(&v) && !self.s.targets.iter().any(|t| t.0 == v) {
                    self.s.holds.push(v);
                }
            }
        }
        Some(())
    }
}

impl Sys {
    /// A spline at the values of the moment.
    pub fn shape(&self, spline: usize) -> Curve {
        let s = &self.splines[spline];
        let at: Vec<Xy> = s.pts.iter().map(|&p| self.pos(p)).collect();
        // A draft of one point has no chord: as a control spline it is that point.
        if s.fit && at.len() >= 2 {
            let hs: Vec<Option<Xy>> = s.handles.iter().map(|h| h.map(|h| self.pos(h))).collect();
            Curve::fit(&at, s.closed, &hs)
        } else {
            Curve::control(&at, s.degree)
        }
    }

    /// The point against the curve as it is now, and the rows brought up to date. The mix's shares
    /// only shape the step; the constant in the last row makes the answer exact wherever they stop.
    pub(super) fn refresh_on_spline(&mut self, d: &Dyn) -> f64 {
        let Dyn::OnSpline { point, spline, idx, mixed, share, tee, gee, rows } = d else {
            return 0.0;
        };
        let curve = self.shape(*spline);
        let target = self.targets.iter().find(|t| t.0 == *point).map(|t| (t.1, t.2));
        let at = target.unwrap_or(self.pos(*point));
        let t = curve.nearest(at);
        let foot = curve.at(t);
        let d1 = curve.d1(t);
        let speed = norm(d1);
        if speed < 1e-12 {
            return 0.0;
        }
        let dir = (d1.0 / speed, d1.1 / speed);
        let w = curve.weights(idx, t);
        let total: f64 = w.iter().sum();
        let pts: Vec<P> = idx.iter().map(|&i| self.splines[*spline].pts[i]).collect();
        let mut value = self.pos(pts[0]);
        let mut sum = if total.abs() > 1e-9 { w[0] / total } else { 0.0 };
        for k in 1..pts.len() {
            let part = if total.abs() > 1e-9 { w[k] / total } else { 0.0 };
            let next = sum + part;
            let r = if next.abs() > 1e-9 && total.abs() > 1e-9 {
                part / next
            } else {
                self.vals[share[k - 1] as usize]
            };
            sum = next;
            self.vals[share[k - 1] as usize] = r;
            let q = self.pos(pts[k]);
            value = (value.0 + r * (q.0 - value.0), value.1 + r * (q.1 - value.1));
            let out = mixed[k - 1];
            self.vals[out.0 as usize] = value.0;
            self.vals[out.1 as usize] = value.1;
        }
        self.vals[gee.0 as usize] = value.0 + dir.0 * LEVER;
        self.vals[gee.1 as usize] = value.1 + dir.1 * LEVER;
        self.rows[rows[0]].eq = Eq::HDist(*gee, *tee, dir.0 * LEVER);
        self.rows[rows[1]].eq = Eq::VDist(*gee, *tee, dir.1 * LEVER);
        self.rows[rows[2]].eq = Eq::PointLine(*point, L(*tee, *gee), cross(dir, sub(foot, value)));
        norm(sub(self.pos(*point), foot))
    }

    /// Where each free point riding on a spline could go to meet a row on it, nearest along the curve
    /// first. The riding row is a tangent line, which meets only what is in front of it: from far
    /// along a curve it can miss what the curve itself still reaches. So each row on the point is
    /// read along the curve, with everything else where it is, and each place it crosses zero is a
    /// place to start the point from.
    pub fn slides(&self) -> Vec<(P, Vec<Xy>)> {
        let mut out = Vec::new();
        for d in &self.dyns {
            let Dyn::OnSamples { point, row, spline: Some(spline), .. } = d else {
                continue;
            };
            if !self.pulls.contains(point) || self.fixed[point.0 as usize] {
                continue;
            }
            let curve = self.shape(*spline);
            let t0 = curve.nearest(self.pos(*point));
            let n = curve.spans().max(1) * SLIDE_PER_SPAN;
            let mut roots: Vec<f64> = Vec::new();
            for (i, r) in self.rows.iter().enumerate() {
                let mut vars = Vec::new();
                r.eq.vars(&mut vars);
                if i == *row || !(vars.contains(&point.0) || vars.contains(&point.1)) {
                    continue;
                }
                let at = |t: f64| {
                    let q = curve.at(t);
                    let x = |v: V| {
                        if v == point.0 {
                            q.0
                        } else if v == point.1 {
                            q.1
                        } else {
                            self.vals[v as usize]
                        }
                    };
                    r.eq.eval::<f64>(&x)[0]
                };
                for k in 0..n {
                    let (mut lo, mut hi) = (k as f64 / n as f64, (k + 1) as f64 / n as f64);
                    let (mut a, b) = (at(lo), at(hi));
                    if a.is_nan() || b.is_nan() || a * b >= 0.0 {
                        continue;
                    }
                    for _ in 0..40 {
                        let mid = (lo + hi) / 2.0;
                        let m = at(mid);
                        if a * m <= 0.0 {
                            hi = mid;
                        } else {
                            (lo, a) = (mid, m);
                        }
                    }
                    roots.push((lo + hi) / 2.0);
                }
            }
            roots.sort_by(|a, b| (a - t0).abs().total_cmp(&(b - t0).abs()));
            roots.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            roots.truncate(MAX_SLIDES);
            if !roots.is_empty() {
                out.push((*point, roots.into_iter().map(|t| curve.at(t)).collect()));
            }
        }
        out
    }

    /// Rows of points that are on their spline to within `tol`, whatever its samples say. A point a
    /// pull left exactly on the curve sits off the chords between samples by their sagitta.
    pub fn on_true_curve(&self, tol: f64) -> Vec<usize> {
        let mut out = Vec::new();
        for d in &self.dyns {
            if let Dyn::OnSamples { point, row, spline: Some(spline), .. } = d
                && self.splines[*spline].pts.len() >= 2
            {
                let curve = self.shape(*spline);
                let p = self.pos(*point);
                if norm(sub(curve.at(curve.nearest(p)), p)) <= tol {
                    out.push(*row);
                }
            }
        }
        out
    }

    /// Rows whose point the curve as it now stands does not pass through.
    pub fn off_spline(&self, tol: f64) -> Vec<usize> {
        let mut out = Vec::new();
        for d in &self.dyns {
            if let Dyn::OnSpline { point, spline, rows, .. } = d {
                let curve = self.shape(*spline);
                let p = self.pos(*point);
                if norm(sub(curve.at(curve.nearest(p)), p)) > tol {
                    out.push(rows[2]);
                }
            }
        }
        out
    }
}
