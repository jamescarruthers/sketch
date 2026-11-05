//! dof, freePoints, freeCurves, and conflict reporting. Every system here is also checked against
//! ezpz's own dense-SVD classification.
mod common;
use common::*;
use sketch_solver::analysis::ezpz_free_points;
use sketch_solver::api::Output;
use std::collections::BTreeSet;

fn analyze(d: &mut Doc) -> Output {
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    let mine: BTreeSet<_> = o.free_points.clone().unwrap().into_iter().collect();
    let svd: BTreeSet<_> = ezpz_free_points(&d.input).into_iter().collect();
    // ezpz reports nothing at all for a system with no rows.
    if !d.input.constraints.is_empty() || !d.input.dimensions.is_empty() {
        assert_eq!(mine, svd, "own analysis disagrees with ezpz SVD");
    }
    o
}

fn free_p(o: &Output) -> Vec<&str> {
    o.free_points
        .as_ref()
        .unwrap()
        .iter()
        .map(String::as_str)
        .collect()
}
fn free_c(o: &Output) -> Vec<&str> {
    o.free_curves
        .as_ref()
        .unwrap()
        .iter()
        .map(String::as_str)
        .collect()
}

#[test]
fn isolated_point_and_line() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.)
        .pt("b", 3., 1.)
        .pt("c", 9., 9.)
        .line("l", "a", "b");
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(6));
    assert_eq!(free_p(&o), ["a", "b", "c"]);
    assert_eq!(free_c(&o), ["l"]);
}

#[test]
fn circle_counts_radius() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.).circle("k", "c", 4.);
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(3));
    assert_eq!(free_c(&o), ["k"]);

    d.con("coincident", &["c", "origin"]);
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(1));
    assert!(free_p(&o).is_empty(), "centre is pinned, only r is free");
    assert_eq!(free_c(&o), ["k"]);

    d.dim("diameter", &["k"], 12.);
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(0));
    assert!(free_c(&o).is_empty());
}

#[test]
fn arc_has_five_dof_not_six() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("a", 10., 0.)
        .pt("b", 0., 10.)
        .arc("r", "c", "a", "b");
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(5));
}

#[test]
fn ellipse_has_five_dof() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 0.)
        .pt("n", 0., 10.)
        .ellipse("e", "c", "m", "n");
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(5));
}

#[test]
fn rotation_about_fixed_point_is_one_dof_with_two_free_variables() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 7., 7.).line("l", "a", "b");
    d.con("coincident", &["a", "origin"]);
    d.dim("distance", &["a", "b"], 10.);
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(1));
    assert_eq!(free_p(&o), ["b"]);
    assert_eq!(free_c(&o), ["l"]);
}

#[test]
fn freedom_is_per_point_not_per_component() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 10., 0.).pt("c", 10., 8.);
    d.line("l", "a", "b").line("m", "b", "c");
    d.con("coincident", &["a", "origin"]);
    d.con("horizontal", &["l"]);
    d.dim("distance", &["a", "b"], 10.);
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(2));
    assert_eq!(free_p(&o), ["c"]);
    assert_eq!(free_c(&o), ["m"]);
}

#[test]
fn line_sliding_along_itself_is_free_in_one_axis() {
    let mut d = Doc::new();
    d.pt("a", 0., 3.).pt("b", 10., 3.).line("l", "a", "b");
    d.con("horizontal", &["l"]);
    d.dim("vertical", &["origin", "a"], 3.);
    d.dim("distance", &["a", "b"], 10.);
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(1));
    assert_eq!(free_p(&o), ["a", "b"]);
}

#[test]
fn coincident_merge_reports_every_member() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 0., 0.).pt("c", 0., 0.);
    d.con("coincident", &["a", "b"]);
    d.con("coincident", &["b", "c"]);
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(2));
    assert_eq!(free_p(&o), ["a", "b", "c"]);
}

#[test]
fn redundant_but_consistent_constraints_do_not_go_negative() {
    let mut d = Doc::new();
    d.seg("l", (0., 0.), (10., 0.))
        .seg("m", (0., 5.), (10., 5.));
    d.con("horizontal", &["l"]);
    d.con("horizontal", &["m"]);
    d.con("parallel", &["l", "m"]);
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(6));
}

#[test]
fn hidden_helpers_add_no_dof() {
    // Free circle-circle tangent uses a hidden contact point.
    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .circle("a", "c1", 5.)
        .pt("c2", 8., 0.)
        .circle("b", "c2", 3.);
    d.con("tangent", &["a", "b"]);
    assert_eq!(analyze(&mut d).dof, Some(5));

    // Point on ellipse.
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 0.)
        .pt("n", 0., 10.)
        .ellipse("e", "c", "m", "n")
        .pt("p", 20., 0.);
    d.con("coincident", &["p", "e"]);
    assert_eq!(analyze(&mut d).dof, Some(6));
}

#[test]
fn ellipse_fully_defined_goes_to_zero() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 3.)
        .pt("n", -3., 10.)
        .ellipse("e", "c", "m", "n");
    d.con("coincident", &["c", "origin"]);
    d.con("horizontal", &["c", "m"]);
    d.dimv("ellipseAxis", &["e"], 20., 0);
    d.dimv("ellipseAxis", &["e"], 10., 1);
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(0));
    assert!(free_c(&o).is_empty());
}

#[test]
fn point_on_spline_removes_one_dof_and_is_one_way() {
    let samples: Vec<[f64; 2]> = (0..=50)
        .map(|i| [i as f64, (i as f64 * 0.1).sin()])
        .collect();
    let mut d = Doc::new();
    d.pt("s0", 0., 0.).pt("s1", 25., 1.).pt("s2", 50., 0.);
    d.spline("s", &["s0", "s1", "s2"], 2, samples);
    d.pt("p", 20., 3.);
    d.con("coincident", &["p", "s"]);
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    assert_eq!(o.dof, Some(6 + 1));
}

#[test]
fn conflict_two_dimensions_on_one_line() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 15., 0.).line("l", "a", "b");
    let x = d.dim("distance", &["a", "b"], 10.);
    let y = d.dim("distance", &["a", "b"], 20.);
    let o = d.solve();
    assert!(!o.ok);
    assert!(
        o.unsatisfied.contains(&x) && o.unsatisfied.contains(&y),
        "{o:?}"
    );
    near_p(d.p("b"), (15., 0.), 1e-9);
}

#[test]
fn conflict_horizontal_and_vertical_on_nonzero_line_with_length() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 5., 5.).line("l", "a", "b");
    let h = d.con("horizontal", &["l"]);
    let v = d.con("vertical", &["l"]);
    let k = d.dim("distance", &["a", "b"], 7.);
    let o = d.solve();
    assert!(!o.ok);
    assert!(
        [&h, &v, &k].iter().any(|i| o.unsatisfied.contains(i)),
        "{o:?}"
    );
}

#[test]
fn conflict_between_two_fixed_points() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 5., 5.);
    d.fix("a").fix("b");
    let k = d.con("coincident", &["a", "b"]);
    let o = d.solve();
    assert_eq!(o.unsatisfied, vec![k]);
    near_p(d.p("a"), (0., 0.), 0.);
    near_p(d.p("b"), (5., 5.), 0.);
}

#[test]
fn dimension_on_fully_fixed_geometry_is_checked_not_solved() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 5., 0.);
    d.fix("a").fix("b");
    let k = d.dim("distance", &["a", "b"], 7.);
    let o = d.solve();
    assert_eq!(o.unsatisfied, vec![k]);
}

#[test]
fn a_conflict_does_not_touch_other_components() {
    let mut d = Doc::new();
    d.seg("l", (0., 0.), (15., 0.));
    d.dim("distance", &["la", "lb"], 10.);
    d.dim("distance", &["la", "lb"], 20.);
    d.seg("m", (0., 50.), (10., 53.));
    d.con("horizontal", &["m"]);
    let o = d.solve();
    assert!(!o.ok);
    near(d.p("ma").1, d.p("mb").1, 1e-6);
    near_p(d.p("lb"), (15., 0.), 1e-9);
}

#[test]
fn unknown_reference_is_reported_and_does_not_block_the_rest() {
    let mut d = Doc::new();
    d.seg("l", (0., 0.), (10., 3.));
    d.con("horizontal", &["l"]);
    let k = d.con("horizontal", &["nope"]);
    let o = d.solve();
    assert_eq!(o.unsatisfied, vec![k]);
    near(d.p("la").1, d.p("lb").1, 1e-6);
}

/// The contract behind `wouldOverConstrain`, exercised here on the raw solver.
fn over_constrains(d: &Doc, kind: &str, refs: &[&str], value: f64) -> bool {
    let mut t = d.clone();
    let id = t.dim(kind, refs, value);
    if !t.clone().solve().ok {
        return true;
    }
    t.set_dim(&id, value + 0.01_f64.max(value.abs() * 1e-3));
    !t.solve().ok
}

#[test]
fn would_over_constrain() {
    let mut d = Doc::new();
    d.seg("l", (0., 0.), (10., 0.));
    assert!(
        !over_constrains(&d, "distance", &["la", "lb"], 10.),
        "first dimension on a free line"
    );
    d.dim("distance", &["la", "lb"], 10.);
    d.solve();
    assert!(
        over_constrains(&d, "distance", &["la", "lb"], 10.),
        "duplicate dimension"
    );
}

#[test]
fn would_over_constrain_redundant_through_other_constraints() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.)
        .pt("b", 10., 0.)
        .pt("c", 10., 5.)
        .pt("e", 0., 5.);
    d.line("t", "e", "c")
        .line("b0", "a", "b")
        .line("l", "a", "e")
        .line("r", "b", "c");
    d.con("horizontal", &["t"]);
    d.con("horizontal", &["b0"]);
    d.con("vertical", &["l"]);
    d.con("vertical", &["r"]);
    d.dim("distance", &["e", "c"], 10.);
    d.solve();
    assert!(
        over_constrains(&d, "distance", &["a", "b"], 10.),
        "opposite side of a rectangle"
    );
    assert!(
        !over_constrains(&d, "distance", &["a", "e"], 5.),
        "the other side is free"
    );
}

#[test]
fn tangency_at_a_constrained_contact_has_no_spurious_dof() {
    // Line end on a circle by point-on-curve, then tangent. The double-root form reports one more.
    let mut d = Doc::new();
    d.seg("l", (10., 0.), (10., 12.))
        .pt("c", 0., 0.)
        .circle("k", "c", 10.);
    d.con("coincident", &["la", "k"]);
    d.con("tangent", &["l", "k"]);
    assert_eq!(analyze(&mut d).dof, Some(4 + 3 - 2));

    // Two circles through a common point, then tangent.
    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .circle("a", "c1", 5.)
        .pt("c2", 8., 0.)
        .circle("b", "c2", 3.)
        .pt("p", 5., 0.);
    d.con("coincident", &["p", "a"]);
    d.con("coincident", &["p", "b"]);
    d.con("tangent", &["a", "b"]);
    assert_eq!(analyze(&mut d).dof, Some(3 + 3 + 2 - 3));

    // Line end on an ellipse, then tangent.
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 0.)
        .pt("n", 0., 10.)
        .ellipse("e", "c", "m", "n");
    d.seg("l", (0., 10.), (15., 10.));
    d.con("coincident", &["la", "e"]);
    d.con("tangent", &["l", "e"]);
    assert_eq!(analyze(&mut d).dof, Some(5 + 4 - 2));
}

#[test]
fn spline_tangent_dof() {
    let mut d = Doc::new();
    d.pt("a", -10., 0.).pt("j", 0., 0.).line("l", "a", "j");
    d.pt("s1", 5., 1.).pt("s2", 10., 4.).pt("s3", 15., 0.);
    d.spline("s", &["j", "s1", "s2", "s3"], 3, vec![]);
    let free = analyze(&mut d).dof.unwrap();
    d.con("tangent", &["l", "s"]);
    assert_eq!(
        analyze(&mut d).dof,
        Some(free - 1),
        "shared end: tangent is one equation"
    );
}

#[test]
fn circular_pattern_source_moves_all_copies() {
    let mut d = Doc::new();
    d.pt("c", 0., 25.)
        .pt("q", -21.65, 12.5)
        .pt("r", -21.65, -12.5);
    d.rotated("origin", "c", "q", std::f64::consts::FRAC_PI_3);
    d.rotated("origin", "q", "r", std::f64::consts::FRAC_PI_3);
    let o = analyze(&mut d);
    assert_eq!(o.dof, Some(2), "only the source point is free");
}
