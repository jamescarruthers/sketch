//! The DogLeg step in ezpz, on systems small enough to know the answer to.
use kcl_ezpz::datatypes::inputs::DatumPoint;
use kcl_ezpz::{Config, Constraint, ConstraintRequest, IdGenerator, solve};

fn req(c: Constraint) -> ConstraintRequest {
    ConstraintRequest::highest_priority(c)
}

/// Q 4 from P at the origin, with Q guessed at `(x, y)`.
fn on_a_circle(x: f64, y: f64, cfg: Config) -> Vec<f64> {
    let mut ids = IdGenerator::default();
    let p = DatumPoint::new(&mut ids);
    let q = DatumPoint::new(&mut ids);
    let reqs = [
        req(Constraint::Fixed(p.id_x(), 0.0)),
        req(Constraint::Fixed(p.id_y(), 0.0)),
        req(Constraint::Distance(p, q, 4.0)),
    ];
    let guess = vec![
        (p.id_x(), 0.0),
        (p.id_y(), 0.0),
        (q.id_x(), x),
        (q.id_y(), y),
    ];
    solve(&reqs, guess, cfg).unwrap().final_values().to_vec()
}

#[test]
fn full_steps_are_gauss_newton() {
    let gn = on_a_circle(4.39, 4.38, Config::default());
    let dl = on_a_circle(4.39, 4.38, Config::default().with_dogleg(true));
    assert_eq!(gn, dl);
}

/// Q 4 from each of two points 7.9 apart, guessed almost on the line between them.
fn nearly_tangent(cfg: Config) -> Vec<f64> {
    let mut ids = IdGenerator::default();
    let p = DatumPoint::new(&mut ids);
    let r = DatumPoint::new(&mut ids);
    let q = DatumPoint::new(&mut ids);
    let reqs = [
        req(Constraint::Fixed(p.id_x(), 0.0)),
        req(Constraint::Fixed(p.id_y(), 0.0)),
        req(Constraint::Fixed(r.id_x(), 7.9)),
        req(Constraint::Fixed(r.id_y(), 0.0)),
        req(Constraint::Distance(p, q, 4.0)),
        req(Constraint::Distance(r, q, 4.0)),
    ];
    let guess = vec![
        (p.id_x(), 0.0),
        (p.id_y(), 0.0),
        (r.id_x(), 7.9),
        (r.id_y(), 0.0),
        (q.id_x(), 3.95),
        (q.id_y(), 0.001),
    ];
    solve(&reqs, guess, cfg).unwrap().final_values().to_vec()
}

#[test]
fn an_overshoot_is_turned_down() {
    // A step tolerance this wide ends the solve at the first step.
    let one = Config::default().with_step_tolerance(1e6);
    assert!(nearly_tangent(one)[5] > 100.0);
    assert!(nearly_tangent(one.with_dogleg(true))[5] < 1.0);
    let done = nearly_tangent(Config::default().with_dogleg(true));
    let to = |x: f64| (done[4] - x).hypot(done[5]);
    assert!((to(0.0) - 4.0).abs() < 1e-7 && (to(7.9) - 4.0).abs() < 1e-7, "{done:?}");
}

#[test]
fn an_inconsistent_system_is_a_least_squares_result() {
    let mut ids = IdGenerator::default();
    let x = ids.next_id();
    let reqs = [req(Constraint::Fixed(x, 1.0)), req(Constraint::Fixed(x, 2.0))];
    let cfg = Config::default().with_dogleg(true);
    let out = solve(&reqs, vec![(x, 0.0)], cfg).unwrap();
    assert!((out.final_values()[0] - 1.5).abs() < 1e-6);
    assert!(out.is_unsatisfied());
}

#[test]
fn every_trial_counts() {
    // Rejections alone use up a budget of one.
    let cfg = Config::default().with_dogleg(true).with_max_iterations(1);
    let mut ids = IdGenerator::default();
    let p = DatumPoint::new(&mut ids);
    let q = DatumPoint::new(&mut ids);
    let reqs = [
        req(Constraint::Fixed(p.id_x(), 0.0)),
        req(Constraint::Fixed(p.id_y(), 0.0)),
        req(Constraint::Distance(p, q, 4.0)),
    ];
    let guess = vec![(p.id_x(), 0.0), (p.id_y(), 0.0), (q.id_x(), 0.01), (q.id_y(), 0.0)];
    assert!(solve(&reqs, guess, cfg).is_err());
}
