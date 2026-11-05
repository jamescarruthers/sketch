//! Curvature at a fit spline's end, and the curvature of whatever it is matched to. The modelling is
//! explained in the crate docs.

use super::*;

/// The handle lengths that leave a usable curve, as shares of the first chord: unit speed is a third.
const HANDLE_MIN: f64 = 1.0 / 8.0;
const HANDLE_MAX: f64 = 3.0 / 4.0;
/// How far the end's curvature may be from what it should be, as an absolute and as a share.
const KAPPA_ABS: f64 = 1e-6;
const KAPPA_SHARE: f64 = 1e-4;
/// How far the next fit point is nudged to read its effect, as a share of the chord.
const PROBE: f64 = 1e-5;

impl B<'_> {
    /// `end` of a fit spline matched to `target` through its active handle.
    pub(super) fn fit_curvature(&mut self, s: &SplineCv, end: usize, leg: L, target: Target, owner: u32) -> Option<()> {
        if s.closed || s.pts.len() < 2 {
            return None;
        }
        if self.mode.tangent_only {
            return Some(());
        }
        let at_start = s.pts[0] == end;
        let next = self.pvar[if at_start { s.pts[1] } else { s.pts[s.pts.len() - 2] }];
        let (e, handle) = (leg.0, leg.1);
        let (h_free, n_free) = (!self.s.fixed[handle.0 as usize], !self.s.fixed[next.0 as usize]);
        // A handle in the hand has its length from the cursor, so the next fit point carries the
        // curvature. With that pinned nothing can give but the joint, and the handle stays.
        let dragged = self.s.targets.iter().any(|t| t.0 == handle);
        if dragged && !n_free {
            self.s.targets.retain(|t| t.0 != handle);
        }
        let by_handle = {
            let fits = !self.mode.by_next && self.s.handle_for(s.vars, at_start, e, handle, next, target).is_some();
            h_free && ((fits && !dragged) || !n_free)
        };
        let row = self.s.rows.len();
        if by_handle {
            let a = norm(sub(self.pos(handle), self.pos(e)));
            self.row(owner, Eq::Dist(e, handle, a));
        } else {
            self.row(owner, Eq::PointLine(next, leg, 0.0));
        }
        self.s.dyns.push(Dyn::FitCurvature {
            row,
            spline: s.vars,
            at_start,
            e,
            handle,
            next,
            by_handle,
            target,
            prev: None,
        });
        Some(())
    }
}

impl Sys {
    /// Signed curvature wanted of a curve leaving `e` along `u`.
    pub fn target_kappa(&self, target: Target, u: Xy, e: Xy) -> Option<f64> {
        let side = |c: Xy| if cross(u, sub(c, e)) >= 0.0 { 1.0 } else { -1.0 };
        Some(match target {
            Target::Straight => 0.0,
            Target::Round(c, r) => side(self.pos(c)) / self.vals[r as usize].max(1e-9),
            Target::End { spline, at_start } => {
                let (v, k) = self.shape(spline).end(at_start)?;
                // Two curves leaving a joint opposite ways bend to the same side with opposite signs.
                if dot(u, v) < 0.0 { -k } else { k }
            }
            Target::Ellipse(el) => {
                let c = self.pos(el.c);
                let (a, b) = (self.vals[el.ra as usize], self.vals[el.rb as usize]);
                let major = sub(self.pos(el.major), c);
                let n = norm(major).max(1e-12);
                let d = sub(e, c);
                let (cos, sin) = (dot(d, major) / (n * a.max(1e-12)), cross(major, d) / (n * b.max(1e-12)));
                side(c) * a * b / (a * a * sin * sin + b * b * cos * cos).powf(1.5)
            }
            Target::Conic { end, leg, third, weight } => {
                let (o, v) = (self.pos(end), sub(self.pos(leg), self.pos(end)));
                let a = norm(v).max(1e-9);
                let k = cross(v, sub(self.pos(third), o)) / a / (2.0 * weight * weight * a * a);
                if dot(u, v) < 0.0 { -k } else { k }
            }
        })
    }

    /// The handle length that gives `target`, if there is one a usable curve can have. Across a
    /// handle's length only the speed at the end changes, so curvature goes as 1/length^2.
    fn handle_for(&self, spline: usize, at_start: bool, e: P, handle: P, next: P, target: Target) -> Option<f64> {
        let (u, now) = self.shape(spline).end(at_start)?;
        let k = self.target_kappa(target, u, self.pos(e))?;
        let a = norm(sub(self.pos(handle), self.pos(e)));
        let chord = norm(sub(self.pos(next), self.pos(e)));
        let wanted = now * a * a / k;
        (k != 0.0 && wanted > 0.0)
            .then(|| wanted.sqrt())
            .filter(|l| (HANDLE_MIN * chord..=HANDLE_MAX * chord).contains(l))
    }

    /// Brings the row up to date. Returns how far its constant moved.
    pub(super) fn refresh_fit_curvature(&mut self, i: usize) -> f64 {
        let Dyn::FitCurvature { row, spline, at_start, e, handle, next, by_handle, target, prev } = self.dyns[i] else {
            return 0.0;
        };
        if by_handle {
            let Some(wanted) = self.handle_for(spline, at_start, e, handle, next, target) else {
                return 0.0;
            };
            let Eq::Dist(_, _, now) = &mut self.rows[row].eq else {
                return 0.0;
            };
            let moved = (wanted - *now).abs();
            *now = wanted;
            let (o, v) = (self.pos(e), sub(self.pos(handle), self.pos(e)));
            let a = norm(v);
            if a > 1e-9 {
                self.place(handle, (o.0 + v.0 / a * wanted, o.1 + v.1 / a * wanted));
            }
            return moved;
        }
        let v = sub(self.pos(handle), self.pos(e));
        let a = norm(v);
        if a < 1e-9 {
            return 0.0;
        }
        let Some((u, now)) = self.shape(spline).end(at_start) else {
            return 0.0;
        };
        let Some(k) = self.target_kappa(target, u, self.pos(e)) else {
            return 0.0;
        };
        let was = sub(self.pos(next), self.pos(e));
        let chord = norm(was).max(1e-9);
        let at = cross(v, was) / a;
        let step = PROBE * chord;
        let nudge = (-v.1 / a * step, v.0 / a * step);
        let keep = self.pos(next);
        self.vals[next.0 as usize] = keep.0 + nudge.0;
        self.vals[next.1 as usize] = keep.1 + nudge.1;
        let probed = self.shape(spline).end(at_start).map(|p| p.1);
        self.vals[next.0 as usize] = keep.0;
        self.vals[next.1 as usize] = keep.1;
        let probe = (probed.unwrap_or(now) - now) / step;
        // The leg and the chord both give a little as the point moves, so the round before says more
        // about the next step than the nudge can.
        let slope = match prev {
            Some((y, was)) if (at - y).abs() > 1e-9 && (now - was) / (at - y) * probe > 0.0 => (now - was) / (at - y),
            _ => probe,
        };
        if slope.abs() < 1e-12 {
            return 0.0;
        }
        let wanted = at + ((k - now) / slope).clamp(-chord, chord);
        if let Dyn::FitCurvature { prev, .. } = &mut self.dyns[i] {
            *prev = Some((at, now));
        }
        let Eq::PointLine(_, _, y) = &mut self.rows[row].eq else {
            return 0.0;
        };
        let moved = (wanted - *y).abs();
        *y = wanted;
        self.place(next, (keep.0 - v.1 / a * (wanted - at), keep.1 + v.0 / a * (wanted - at)));
        moved
    }

    /// Puts what a row steers where the row wants it before the row is solved, so the row asks
    /// nothing of the leg and the joint it shares with the other curve. A small move stays small.
    fn place(&mut self, p: P, at: Xy) {
        if !self.fixed[p.0 as usize] && !self.fixed[p.1 as usize] && !self.targets.iter().any(|t| t.0 == p) {
            self.vals[p.0 as usize] = at.0;
            self.vals[p.1 as usize] = at.1;
        }
    }

    /// Rows of a spline end steered to a target whose real curvature is not what it should be, or
    /// cannot be read, and whether any could still be tried another way. Each of these rows is met
    /// by a constant from the last round, so being met says nothing.
    pub fn curvature_unmet(&self) -> (Vec<usize>, bool) {
        let (mut out, mut again) = (Vec::new(), false);
        for d in &self.dyns {
            let (row, spline, at_start, e, target, retry) = match *d {
                Dyn::FitCurvature { row, spline, at_start, e, next, by_handle, target, .. } => {
                    (row, spline, at_start, e, target, by_handle && !self.fixed[next.0 as usize])
                }
                Dyn::Curvature { row, end, real: Some((spline, at_start)), kappa: Kappa::Signed(t), .. } => {
                    (row, spline, at_start, end, t, false)
                }
                _ => continue,
            };
            let off = self.shape(spline).end(at_start).and_then(|(u, now)| {
                let k = self.target_kappa(target, u, self.pos(e))?;
                Some((now - k).abs() > KAPPA_ABS + KAPPA_SHARE * k.abs())
            });
            if off.unwrap_or(true) {
                out.push(row);
                again |= retry;
            }
        }
        (out, again)
    }
}
