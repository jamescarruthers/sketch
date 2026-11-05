//! What the user feels: dragged geometry follows the cursor, unrelated geometry stays put, and no
//! branch flips over a 50 step drag.
mod common;
use common::*;
use sketch_solver::api::DragIn;
use std::f64::consts::{FRAC_PI_2, FRAC_PI_6, PI};

/// Drag a point along a straight path in `n` steps, asserting each solve succeeds.
fn sweep(d: &mut Doc, point: &str, to: (f64, f64), n: usize, mut check: impl FnMut(&Doc, usize)) {
    let from = d.p(point);
    for i in 1..=n {
        let t = i as f64 / n as f64;
        let o = d.drag(
            point,
            from.0 + (to.0 - from.0) * t,
            from.1 + (to.1 - from.1) * t,
        );
        assert!(o.ok, "step {i}: {o:?}");
        check(d, i);
    }
}

#[test]
fn free_end_reaches_target_and_nothing_else_moves() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 10., 0.).pt("c", 20., 5.);
    d.line("l", "a", "b").line("m", "b", "c");
    d.con("horizontal", &["l"]);
    let o = d.drag("c", 35., -7.);
    assert!(o.ok);
    near_p(d.p("c"), (35., -7.), 1e-9);
    near_p(d.p("a"), (0., 0.), 1e-9);
    near_p(d.p("b"), (10., 0.), 1e-9);
}

#[test]
fn unrelated_component_is_not_even_solved() {
    let mut d = Doc::new();
    d.seg("l", (0., 0.), (10., 0.))
        .seg("m", (0., 50.), (10., 55.));
    d.con("horizontal", &["m"]); // would move m, if it were solved
    let o = d.drag("lb", 20., 3.);
    assert!(o.ok);
    near_p(d.p("ma"), (0., 50.), 0.);
    near_p(d.p("mb"), (10., 55.), 0.);
}

#[test]
fn rectangle_corner_moves_its_neighbours_only_along_their_constrained_axis() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.)
        .pt("b", 20., 0.)
        .pt("c", 20., 10.)
        .pt("e", 0., 10.);
    d.line("s", "a", "b")
        .line("r", "b", "c")
        .line("t", "c", "e")
        .line("l", "e", "a");
    for h in ["s", "t"] {
        d.con("horizontal", &[h]);
    }
    for v in ["r", "l"] {
        d.con("vertical", &[v]);
    }
    let o = d.drag("c", 30., 25.);
    assert!(o.ok);
    near_p(d.p("c"), (30., 25.), 1e-9);
    near_p(d.p("b"), (30., 0.), 1e-6);
    near_p(d.p("e"), (0., 25.), 1e-6);
    near_p(d.p("a"), (0., 0.), 1e-6);
}

#[test]
fn free_geometry_sharing_a_component_stays_where_it_was() {
    // Two lines joined only through a point on the far side of the sketch. Dragging one end of
    // the first must not disturb the second.
    let mut d = Doc::new();
    d.pt("hub", 0., 0.)
        .pt("a", 10., 0.)
        .pt("b", 0., 10.)
        .pt("far", -10., -10.);
    d.line("l", "hub", "a")
        .line("m", "hub", "b")
        .line("n", "b", "far");
    d.con("perpendicular", &["l", "m"]);
    let before = d.p("far");
    let o = d.drag("a", 12., 1.);
    assert!(o.ok);
    near_p(d.p("a"), (12., 1.), 1e-9);
    near_p(d.p("far"), before, 1e-9);
    near(dot(d.p("hub"), d.p("a"), d.p("hub"), d.p("b")), 0., 1e-5);
    // Minimum-norm: the correction stays small, nothing jumps.
    assert!(d.dist("hub", "b") < 11.0 && d.dist("hub", "b") > 9.0);
}

#[test]
fn unreachable_target_goes_to_nearest_reachable_position() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 10., 0.).line("l", "a", "b");
    d.con("coincident", &["a", "origin"]);
    d.dim("distance", &["a", "b"], 10.);
    let o = d.drag("b", 30., 40.);
    assert!(o.ok);
    near_p(d.p("b"), (6., 8.), 1e-3);
}

#[test]
fn unreachable_target_on_a_line_keeps_the_free_axis() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 10., 0.).line("l", "a", "b");
    d.con("coincident", &["a", "origin"]);
    d.con("horizontal", &["l"]);
    let o = d.drag("b", 25., 9.);
    assert!(o.ok);
    near_p(d.p("b"), (25., 0.), 1e-6);
}

#[test]
fn fully_constrained_point_does_not_move() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 10., 0.).line("l", "a", "b");
    d.con("coincident", &["a", "origin"]);
    d.con("horizontal", &["l"]);
    d.dim("distance", &["a", "b"], 10.);
    d.solve();
    let o = d.drag("b", 3., 40.);
    assert!(o.ok);
    near_p(d.p("b"), (10., 0.), 1e-6);
}

#[test]
fn dragging_a_fixed_point_does_nothing() {
    let mut d = Doc::new();
    d.pt("a", 2., 3.).fix("a");
    let o = d.drag("a", 30., 40.);
    assert!(o.ok);
    near_p(d.p("a"), (2., 3.), 0.);
}

#[test]
fn coincident_group_follows_the_drag() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.)
        .pt("b", 0., 0.)
        .pt("x", 10., 0.)
        .pt("y", 0., 10.);
    d.line("l", "a", "x").line("m", "b", "y");
    d.con("coincident", &["a", "b"]);
    let o = d.drag("b", 3., 3.);
    assert!(o.ok);
    near_p(d.p("a"), (3., 3.), 1e-9);
    near_p(d.p("x"), (10., 0.), 1e-9);
}

#[test]
fn hold_keeps_the_first_selection_as_reference() {
    // Two free points, a vertical constraint between them. The held point stays, the other moves.
    let mut d = Doc::new();
    d.pt("ref", 0., 0.).pt("other", 7., 9.);
    d.con("vertical", &["ref", "other"]);
    d.input.hold = vec!["ref".into()];
    let o = d.solve();
    assert!(o.ok);
    near_p(d.p("ref"), (0., 0.), 1e-7);
    near(d.p("other").0, 0., 1e-6);

    let mut d = Doc::new();
    d.pt("ref", 0., 0.).pt("other", 7., 9.);
    d.con("vertical", &["ref", "other"]);
    d.input.hold = vec!["other".into()];
    d.solve();
    near_p(d.p("other"), (7., 9.), 1e-7);
    near(d.p("ref").0, 7., 1e-6);
}

#[test]
fn hold_that_conflicts_with_drag_gives_way_to_drag() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 10., 0.).line("l", "a", "b");
    d.dim("distance", &["a", "b"], 10.);
    d.input.hold = vec!["a".into()];
    d.input.drag = vec![DragIn {
        point: "b".into(),
        x: 30.,
        y: 0.,
    }];
    let o = sketch_solver::solve::solve(&d.input);
    assert!(o.ok, "{o:?}");
    near_p(
        o.points.get("b").map(|p| (p[0], p[1])).unwrap(),
        (30., 0.),
        1e-9,
    );
}

#[test]
fn hold_with_conflict_alone_is_dropped() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 5., 0.);
    d.fix("b");
    d.con("coincident", &["a", "b"]);
    d.input.hold = vec!["a".into()];
    let o = d.solve();
    assert!(o.ok);
    near_p(d.p("a"), (5., 0.), 1e-9);
}

// --- no branch flips across 50 steps ---

#[test]
fn line_circle_tangent_keeps_side() {
    let mut d = Doc::new();
    d.pt("a", -20., 0.).pt("b", 20., 0.).line("l", "a", "b");
    d.pt("c", 0., 6.).circle("k", "c", 6.);
    d.con("coincident", &["a", "origin"]);
    d.con("tangent", &["l", "k"]);
    d.solve();
    let s0 = side(d.p("c"), d.p("a"), d.p("b")).signum();
    sweep(&mut d, "b", (-5., 30.), 50, |d, i| {
        let s = side(d.p("c"), d.p("a"), d.p("b"));
        assert_eq!(s.signum(), s0, "step {i}");
        near(s.abs(), d.r("k"), 1e-6);
    });
}

#[test]
fn circle_stays_on_its_side_when_the_centre_is_pulled_through_the_line() {
    let mut d = Doc::new();
    d.pt("a", -20., 0.).pt("b", 20., 0.).line("l", "a", "b");
    d.fix("a").fix("b");
    d.pt("c", 0., 6.).circle("k", "c", 6.);
    d.con("tangent", &["l", "k"]);
    d.solve();
    let from = d.p("c");
    for i in 1..=50 {
        d.drag("c", from.0, from.1 - i as f64 * 0.5);
        assert!(
            d.r("k") >= 0.0,
            "step {i}: radius went negative: {}",
            d.r("k")
        );
        assert!(d.p("c").1 >= 0.0, "step {i}: crossed the line");
    }
}

#[test]
fn circle_circle_external_stays_external() {
    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .circle("a", "c1", 8.)
        .pt("c2", 11., 0.)
        .circle("b", "c2", 3.);
    d.con("coincident", &["c1", "origin"]);
    d.dim("radius", &["a"], 8.);
    d.dim("radius", &["b"], 3.);
    d.con("tangent", &["a", "b"]);
    d.solve();
    sweep(&mut d, "c2", (-3., 14.), 50, |d, i| {
        near(d.dist("c1", "c2"), 11., 1e-3);
        let _ = i;
    });
}

#[test]
fn circle_circle_internal_stays_internal() {
    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .circle("a", "c1", 10.)
        .pt("c2", 7., 0.)
        .circle("b", "c2", 3.);
    d.con("coincident", &["c1", "origin"]);
    d.dim("radius", &["a"], 10.);
    d.dim("radius", &["b"], 3.);
    d.con("tangent", &["a", "b"]);
    d.solve();
    sweep(&mut d, "c2", (-7., 1.), 50, |d, _| {
        near(d.dist("c1", "c2"), 7., 1e-3);
    });
}

#[test]
fn circle_circle_with_free_radii_does_not_change_kind() {
    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .circle("a", "c1", 5.)
        .pt("c2", 8., 0.)
        .circle("b", "c2", 3.);
    d.fix("c1");
    d.con("tangent", &["a", "b"]);
    d.solve();
    sweep(&mut d, "c2", (2., 40.), 50, |d, i| {
        let (ra, rb) = (d.r("a"), d.r("b"));
        near(d.dist("c1", "c2"), ra + rb, 1e-5);
        assert!(ra > 0.0 && rb > 0.0, "step {i}");
    });
}

#[test]
fn line_arc_tangent_at_shared_point_keeps_side() {
    let mut d = Doc::new();
    d.pt("p", -20., 0.).pt("q", 0., 0.).line("l", "p", "q");
    d.pt("c", 0., 10.).pt("e", 10., 10.).arc("r", "c", "q", "e");
    d.fix("p");
    d.con("tangent", &["l", "r"]);
    d.solve();
    let s0 = side(d.p("c"), d.p("p"), d.p("q")).signum();
    sweep(&mut d, "e", (14., 30.), 50, |d, i| {
        let s = side(d.p("c"), d.p("p"), d.p("q"));
        assert_eq!(s.signum(), s0, "step {i}");
        near(d.dist("c", "q"), s.abs(), 1e-5);
        near(d.dist("c", "q"), d.dist("c", "e"), 1e-5);
    });
}

#[test]
fn arc_arc_tangent_at_shared_point_keeps_kind() {
    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .pt("a", 10., 0.)
        .pt("j", 0., 10.)
        .arc("r", "c1", "a", "j");
    d.pt("c2", 0., 16.)
        .pt("b", 6., 16.)
        .arc("s", "c2", "b", "j");
    d.fix("c1");
    d.con("tangent", &["r", "s"]);
    d.solve();
    sweep(&mut d, "b", (10., 18.), 50, |d, _| {
        near(
            d.dist("c1", "c2"),
            d.dist("c1", "j") + d.dist("c2", "j"),
            1e-5,
        );
    });
}

#[test]
fn angle_dimension_keeps_sign() {
    let mut d = Doc::new();
    d.pt("o", 0., 0.).pt("a", 10., 0.).pt("b", 8., 5.);
    d.line("l", "o", "a").line("m", "o", "b");
    d.fix("o");
    d.dim("angle", &["l", "m"], FRAC_PI_6);
    d.solve();
    sweep(&mut d, "a", (-6., 9.), 50, |d, _| {
        let (a, b) = (d.p("a"), d.p("b"));
        let t = (a.0 * b.1 - a.1 * b.0).atan2(a.0 * b.0 + a.1 * b.1);
        near(t, FRAC_PI_6, 1e-6);
    });
}

#[test]
fn point_line_dimension_keeps_side() {
    let mut d = Doc::new();
    d.seg("l", (0., 0.), (10., 0.)).pt("p", 5., 3.);
    d.dim("pointLine", &["p", "l"], 4.);
    d.solve();
    sweep(&mut d, "lb", (-5., 8.), 50, |d, _| {
        near(side(d.p("p"), d.p("la"), d.p("lb")), 4., 1e-6);
    });
}

#[test]
fn horizontal_dimension_keeps_sign() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", -5., 3.);
    d.dim("horizontal", &["a", "b"], 5.);
    d.solve();
    sweep(&mut d, "a", (30., 20.), 50, |d, _| {
        near(d.p("b").0 - d.p("a").0, -5., 1e-6);
    });
}

#[test]
fn triangle_does_not_fold_through() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 10., 0.).pt("c", 5., 8.);
    d.line("x", "a", "b")
        .line("y", "b", "c")
        .line("z", "c", "a");
    d.fix("a").fix("b");
    d.dim("distance", &["b", "c"], 9.433981132);
    d.dim("distance", &["c", "a"], 9.433981132);
    d.solve();
    let start = d.p("c");
    for i in 0..50 {
        // Cursor wanders below the base; the fully determined apex stays.
        d.drag("c", 5. + i as f64 * 0.2, 8. - i as f64 * 0.5);
        near_p(d.p("c"), start, 1e-5);
    }
}

#[test]
fn spline_leg_tangent_does_not_cusp() {
    let mut d = Doc::new();
    d.pt("a", -10., 0.).pt("j", 0., 0.).line("l", "a", "j");
    d.pt("s1", 5., 1.).pt("s2", 10., 4.).pt("s3", 15., 0.);
    d.spline("s", &["j", "s1", "s2", "s3"], 3, vec![]);
    d.fix("a");
    d.con("tangent", &["l", "s"]);
    d.solve();
    sweep(&mut d, "j", (2., 12.), 50, |d, i| {
        near(cross(d.p("a"), d.p("j"), d.p("j"), d.p("s1")), 0., 1e-3);
        assert!(
            dot(d.p("a"), d.p("j"), d.p("j"), d.p("s1")) > 0.0,
            "step {i}"
        );
    });
}

#[test]
fn arc_midpoint_stays_inside_sweep() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("a", 10., 0.)
        .pt("b", 0., 10.)
        .arc("r", "c", "a", "b")
        .pt("q", 7., 7.);
    d.fix("c");
    d.con("midpoint", &["q", "r"]);
    d.solve();
    sweep(&mut d, "b", (-3., 12.), 50, |d, _| {
        let (a, b, q) = (d.p("a"), d.p("b"), d.p("q"));
        let mid = (a.0 + b.0, a.1 + b.1);
        assert!(mid.0 * q.0 + mid.1 * q.1 > 0.0);
        near(d.dist("c", "q"), d.dist("c", "a"), 1e-5);
    });
}

#[test]
fn ellipse_tangent_line_stays_on_near_side() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 0.)
        .pt("n", 0., 10.)
        .ellipse("e", "c", "m", "n");
    d.fix("c").fix("m").fix("n");
    d.pt("a", -30., 10.).pt("b", 30., 10.).line("l", "a", "b");
    d.con("tangent", &["l", "e"]);
    d.solve();
    sweep(&mut d, "b", (32., 2.), 50, |d, i| {
        let (a, b) = (d.p("a"), d.p("b"));
        let h = side((0., 0.), a, b);
        assert!(h < 0.0, "step {i}: line went past the centre");
        let l = (b.0 - a.0).hypot(b.1 - a.1);
        let n = (-(b.1 - a.1) / l, (b.0 - a.0) / l);
        near((400. * n.0 * n.0 + 100. * n.1 * n.1).sqrt(), h.abs(), 1e-5);
    });
}

#[test]
fn dragging_a_point_on_a_circle_slides_it() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.).circle("k", "c", 10.).pt("p", 10., 0.);
    d.fix("c");
    d.dim("radius", &["k"], 10.);
    d.con("coincident", &["p", "k"]);
    d.solve();
    for i in 1..=50 {
        let t = i as f64 / 50.0 * FRAC_PI_2;
        let o = d.drag("p", 10.5 * t.cos(), 10.5 * t.sin());
        assert!(o.ok);
        let q = d.p("p");
        near(q.1.atan2(q.0), t, 1e-3);
    }
}

#[test]
fn dragging_a_point_on_a_spline_slides_along_it() {
    let samples: Vec<[f64; 2]> = (0..=200)
        .map(|i| {
            let x = i as f64 * 0.1;
            [x, (x * 0.5).sin() * 5.0]
        })
        .collect();
    let mut d = Doc::new();
    d.pt("s0", 0., 0.)
        .pt("s1", 7., 5.)
        .pt("s2", 14., -2.)
        .pt("s3", 20., 0.);
    d.spline("s", &["s0", "s1", "s2", "s3"], 3, samples);
    d.fix("s0").fix("s1").fix("s2").fix("s3");
    d.pt("p", 2., 0.84);
    d.con("coincident", &["p", "s"]);
    d.solve();
    for i in 1..=50 {
        let x = 2. + i as f64 * 0.3;
        let o = d.drag("p", x, (x * 0.5).sin() * 5.0 + 0.2);
        assert!(o.ok, "{o:?}");
        let q = d.p("p");
        near(q.1, (q.0 * 0.5).sin() * 5.0, 2e-3);
        assert!((q.0 - x).abs() < 0.5, "step {i}, {q:?}");
    }
}

#[test]
fn large_single_jump_does_not_invert_a_rectangle_with_dimensions() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.)
        .pt("b", 20., 0.)
        .pt("c", 20., 10.)
        .pt("e", 0., 10.);
    d.line("s", "a", "b")
        .line("r", "b", "c")
        .line("t", "c", "e")
        .line("l", "e", "a");
    for h in ["s", "t"] {
        d.con("horizontal", &[h]);
    }
    for v in ["r", "l"] {
        d.con("vertical", &[v]);
    }
    d.dim("horizontal", &["a", "b"], 20.);
    d.dim("vertical", &["b", "c"], 10.);
    let o = d.drag("c", 500., -300.);
    assert!(o.ok);
    near(d.p("b").0 - d.p("a").0, 20., 1e-6);
    near(d.p("c").1 - d.p("b").1, 10., 1e-6);
    near_p(d.p("c"), (500., -300.), 1e-6);
}

#[test]
fn rotation_arm_full_turn_in_small_steps() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 10., 0.).line("l", "a", "b");
    d.fix("a");
    d.dim("distance", &["a", "b"], 10.);
    for i in 1..=50 {
        let t = i as f64 / 50.0 * 2.0 * PI;
        d.drag("b", 12. * t.cos(), 12. * t.sin());
        let q = d.p("b");
        near(q.0.hypot(q.1), 10., 1e-6);
        let e = (q.1.atan2(q.0) - t).rem_euclid(2.0 * PI);
        assert!(e.min(2.0 * PI - e) < 1e-2, "step {i}");
    }
}

#[test]
fn rigid_body_about_a_pivot_follows_an_unreachable_cursor() {
    // Ten lines with lengths and angles, pinned at one end: a single rotation dof.
    let mut d = Doc::new();
    for i in 0..=10usize {
        d.pt(
            &format!("p{i}"),
            i as f64 * 10.0,
            if i.is_multiple_of(2) { 0.0 } else { 6.0 },
        );
    }
    for i in 0..10 {
        d.line(&format!("l{i}"), &format!("p{i}"), &format!("p{}", i + 1));
        d.dim(
            "distance",
            &[&format!("p{i}"), &format!("p{}", i + 1)],
            136.0f64.sqrt(),
        );
        if i > 0 {
            d.dim(
                "angle",
                &[&format!("l{}", i - 1), &format!("l{i}")],
                2.0 * 0.6f64.atan(),
            );
        }
    }
    d.con("coincident", &["p0", "origin"]);
    assert_eq!(d.analyze().dof, Some(1));
    for k in 1..=20 {
        let t = k as f64 * 0.05;
        let o = d.drag("p10", 120. * t.cos(), 120. * t.sin());
        assert!(o.ok, "{o:?}");
        let e = d.p("p10");
        assert!((e.1.atan2(e.0) - t).abs() < 0.02, "step {k}: {e:?}");
        near(e.0.hypot(e.1), 100., 1e-5);
    }
}

#[test]
fn spline_arc_tangent_holds_over_a_drag() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("a", 0., 10.)
        .pt("j", 10., 0.)
        .arc("r", "c", "j", "a");
    d.pt("s1", 10., -5.).pt("s2", 13., -8.).pt("s3", 20., -8.);
    d.spline("s", &["j", "s1", "s2", "s3"], 3, vec![]);
    d.fix("c");
    d.con("tangent", &["s", "r"]);
    d.solve();
    sweep(&mut d, "a", (-8., 6.), 50, |d, _| {
        near(dot(d.p("j"), d.p("s1"), d.p("c"), d.p("j")), 0., 1e-4);
    });
}

#[test]
fn spline_spline_tangent_does_not_cusp_over_a_drag() {
    let mut d = Doc::new();
    d.pt("a0", 0., 0.)
        .pt("a1", 3., 4.)
        .pt("a2", 6., 4.)
        .pt("j", 10., 0.);
    d.pt("b1", 14., -4.).pt("b2", 17., -2.).pt("b3", 20., 0.);
    d.spline("s", &["a0", "a1", "a2", "j"], 3, vec![]);
    d.spline("t", &["j", "b1", "b2", "b3"], 3, vec![]);
    d.con("tangent", &["s", "t"]);
    d.solve();
    sweep(&mut d, "a2", (4., 9.), 50, |d, i| {
        near(cross(d.p("a2"), d.p("j"), d.p("j"), d.p("b1")), 0., 1e-3);
        assert!(
            dot(d.p("a2"), d.p("j"), d.p("j"), d.p("b1")) > 0.0,
            "step {i}"
        );
    });
}

#[test]
fn group_drag_moves_every_target() {
    let mut d = Doc::new();
    d.seg("l", (0., 0.), (10., 0.));
    d.dim("distance", &["la", "lb"], 10.);
    d.input.drag = vec![
        DragIn {
            point: "la".into(),
            x: 5.,
            y: 5.,
        },
        DragIn {
            point: "lb".into(),
            x: 15.,
            y: 5.,
        },
    ];
    let o = sketch_solver::solve::solve(&d.input);
    assert!(o.ok);
    d.apply(&o);
    near_p(d.p("la"), (5., 5.), 1e-7);
    near_p(d.p("lb"), (15., 5.), 1e-7);
}
