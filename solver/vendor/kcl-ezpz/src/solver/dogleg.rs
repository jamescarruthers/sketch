//! Powell's dog leg, a trust-region alternative to `solve_gauss_newton`, off unless
//! `Config::with_dogleg` asks for it.
//!
//! The Gauss-Newton step is the same one: same matrix, same LU, same lambda, so it is still the
//! minimum-norm step. The steepest-descent step is `-alpha Jᵀr`, which is in the row space of `J`
//! too. So is everything between them, and no step here moves along the free directions to first
//! order. The radius starts infinite, so while full steps lower the cost this is Gauss-Newton.
use faer::{
    ColRef,
    prelude::Solve,
    sparse::{SparseColMatRef, linalg::solvers::Lu},
};

use crate::{Config, NonLinearSystemError};

use super::{Model, newton::SuccessfulSolve};

/// A step that earned less than this share of what the linear model promised shrinks the radius.
const SHRINK_BELOW: f64 = 0.25;
/// A step on the boundary that earned more than this share grows it.
const GROW_ABOVE: f64 = 0.75;
/// What the radius becomes, as a share of a step that was turned down.
const SHRINK_BY: f64 = 0.5;
const GROW_BY: f64 = 3.0;

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn inf_norm(a: &[f64]) -> f64 {
    a.iter().map(|x| x.abs()).fold(0.0, libm::fmax)
}

/// The point on the dog leg `0 -> h_sd -> h_gn` a distance `radius` from the start.
/// `h_sd` is the shorter, `h_gn` is the longer, and `radius` is between them.
fn on_the_leg(h_sd: &[f64], h_gn: &[f64], radius: f64, step: &mut [f64]) {
    let diff: Vec<f64> = h_gn.iter().zip(h_sd).map(|(g, s)| g - s).collect();
    let (aa, dd, ad) = (dot(h_sd, h_sd), dot(&diff, &diff), dot(h_sd, &diff));
    let room = radius * radius - aa;
    let root = libm::sqrt(ad * ad + dd * room);
    // The two forms avoid cancelling on either sign of `ad`.
    let beta = if ad <= 0.0 {
        (root - ad) / dd
    } else {
        room / (ad + root)
    };
    for ((out, s), d) in step.iter_mut().zip(h_sd).zip(&diff) {
        *out = s + beta * d;
    }
}

impl Model<'_> {
    #[inline(never)]
    pub(crate) fn solve_dogleg(
        &mut self,
        current_values: &mut [f64],
        config: Config,
    ) -> Result<SuccessfulSolve, NonLinearSystemError> {
        let m = self.layout.total_num_residuals;
        let n = current_values.len();

        let mut residual = vec![0.0; m];
        let mut trial_residual = vec![0.0; m];
        let mut trial_values = vec![0.0; n];
        let mut step = vec![0.0; n];
        let mut h_sd = vec![0.0; n];
        let mut h_gn = vec![0.0; n];

        let mut radius = f64::INFINITY;
        // Every trial counts, taken or turned down, so an iteration budget means what it did.
        let mut trials = 0;

        self.residual(current_values, &mut residual);
        while trials < config.max_iterations {
            self.refresh_jacobian(current_values);

            let largest_absolute_elem = residual
                .iter()
                .map(|x| x.abs())
                .reduce(libm::fmax)
                .ok_or(NonLinearSystemError::EmptySystemNotAllowed)?;
            if largest_absolute_elem <= config.convergence_tolerance {
                return Ok(SuccessfulSolve { iterations: trials });
            }

            let j = SparseColMatRef::new(self.jc.sym.as_ref(), &self.jc.vals);
            let jtj = j.transpose().to_col_major()? * j;
            let a = jtj + &self.lambda_i;
            let b = j.transpose() * -ColRef::from_slice(&residual);
            let factored = Lu::try_new_with_symbolic(self.lu_symbolic.clone(), a.as_ref())?;
            let d = factored.solve(&b);
            assert_eq!(
                d.nrows(),
                current_values.len(),
                "the `d` column must be the same size as the number of variables."
            );
            for (out, d) in h_gn.iter_mut().zip(d.iter()) {
                *out = *d;
            }
            let h_gn_norm = libm::sqrt(dot(&h_gn, &h_gn));
            if !h_gn_norm.is_finite() {
                return Err(NonLinearSystemError::DidNotConverge);
            }

            // `b` is `-g`, so the Cauchy step is `alpha b`.
            let j_b = j * b.as_ref();
            let g_squared = b.squared_norm_l2();
            let j_b_squared = j_b.squared_norm_l2();
            let alpha = if j_b_squared > 0.0 {
                g_squared / j_b_squared
            } else {
                0.0
            };
            let alpha = if alpha.is_finite() { alpha } else { 0.0 };
            for (out, b) in h_sd.iter_mut().zip(b.iter()) {
                *out = alpha * b;
            }
            let h_sd_norm = alpha * libm::sqrt(g_squared);

            let cost = dot(&residual, &residual) / 2.0;
            let current_inf_norm = inf_norm(current_values);
            let step_threshold = config.step_tolerance * (current_inf_norm + config.step_tolerance);

            // Trials from this point, all on the same `J` and the same solve.
            loop {
                if trials == config.max_iterations {
                    return Err(NonLinearSystemError::DidNotConverge);
                }
                let this_iteration = trials;
                trials += 1;

                if h_gn_norm <= radius {
                    step.copy_from_slice(&h_gn);
                } else if h_sd_norm >= radius {
                    let scale = radius / h_sd_norm;
                    for (out, s) in step.iter_mut().zip(&h_sd) {
                        *out = s * scale;
                    }
                } else {
                    on_the_leg(&h_sd, &h_gn, radius, &mut step);
                }
                let step_norm = libm::sqrt(dot(&step, &step));

                for ((out, x), s) in trial_values.iter_mut().zip(&*current_values).zip(&step) {
                    *out = x + s;
                }
                self.residual(&trial_values, &mut trial_residual);
                let trial_cost = dot(&trial_residual, &trial_residual) / 2.0;

                // What the linear model promised: F(x) - |r + J h|^2 / 2.
                let j_h = j * ColRef::from_slice(&step);
                let linear_cost = residual
                    .iter()
                    .zip(j_h.iter())
                    .map(|(r, jh)| (r + jh) * (r + jh))
                    .sum::<f64>()
                    / 2.0;
                let predicted = cost - linear_cost;
                let actual = cost - trial_cost;
                let gain = actual / predicted;
                let accepted = trial_cost.is_finite() && actual > 0.0;

                if !accepted || gain < SHRINK_BELOW {
                    radius = SHRINK_BY * step_norm;
                } else if gain > GROW_ABOVE && step_norm >= 0.99 * radius {
                    radius *= GROW_BY;
                }

                if accepted {
                    current_values.copy_from_slice(&trial_values);
                    std::mem::swap(&mut residual, &mut trial_residual);
                }

                // The existing small-step exit, and with it a radius that has collapsed: a local
                // minimum of the cost, perhaps not zero, so a least-squares result, and whether
                // the system was consistent is for `unsatisfied` to say.
                let stationary = !accepted && predicted <= f64::EPSILON * cost;
                if inf_norm(&step) <= step_threshold || stationary {
                    return Ok(SuccessfulSolve {
                        iterations: this_iteration,
                    });
                }
                if accepted {
                    break;
                }
            }
        }
        Err(NonLinearSystemError::DidNotConverge)
    }
}
