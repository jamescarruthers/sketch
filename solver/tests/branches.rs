//! A solve stays on the branch it began on and keeps what the rows leave free. `Input::branches`
//! names what must not turn over; a root on the far side of it is turned down, not taken.
mod common;
use common::*;
use sketch_solver::api::Branches;

const T: f64 = 1e-6;

/// A triangle with `top` free, its other two corners fixed, and both sides dimensioned.
fn triangle(top: (f64, f64), left: f64, right: f64) -> Doc {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 60., 0.).pt("c", top.0, top.1);
    d.fix("a").fix("b");
    d.line("left", "a", "c").line("right", "b", "c");
    d.dim("distance", &["a", "c"], left);
    d.dim("distance", &["b", "c"], right);
    d.input.branches = Branches {
        loops: vec![vec!["a".into(), "b".into(), "c".into()]],
        ..Branches::default()
    };
    d
}

#[test]
fn a_root_on_the_far_side_of_a_triangle_is_turned_down() {
    // From just above the base with the sides at their values, the nearest root can be underneath.
    let mut d = triangle((30., 0.5), 50., 50.);
    let out = d.solve();
    if out.ok {
        assert!(d.p("c").1 > 0., "a triangle that solved stayed up: {:?}", d.p("c"));
    } else {
        assert_eq!(out.crossed.as_deref(), Some("loop"));
        near_p(d.p("c"), (30., 0.5), T);
    }
}

#[test]
fn with_no_branches_named_nothing_is_turned_down() {
    let mut d = triangle((30., 40.), 50., 50.);
    d.input.branches = Branches::default();
    let out = d.solve();
    assert!(out.ok);
    assert_eq!(out.crossed, None);
}

#[test]
fn an_arc_that_loops_is_turned_down() {
    // The ends stay; a radius below half the chord's reach sends the centre across the chord.
    let mut d = Doc::new();
    d.pt("a", 40., 0.).pt("b", -40., 0.).pt("c", 0., -30.);
    d.fix("a").fix("b");
    d.arc("arc", "c", "a", "b");
    d.dim("radius", &["arc"], 41.);
    d.input.branches = Branches {
        arcs: vec![["c".into(), "a".into(), "b".into()]],
        ..Branches::default()
    };
    let out = d.solve();
    if !out.ok {
        assert_eq!(out.crossed.as_deref(), Some("arc"));
    }
    assert!(d.p("c").1 < 0., "the centre stayed on its side: {:?}", d.p("c"));
}

#[test]
fn a_value_too_far_to_reach_in_one_solve_says_it_kept_nothing() {
    // The bridge walks to such a value. Saying `kept` here would leave it where it landed.
    let mut d = Doc::new();
    d.pt("p0", -40., 0.).pt("p1", 0., 0.).pt("p2", 20., 20.).pt("p3", 20., 50.);
    d.pt("c", 0., 20.);
    d.line("in", "p0", "p1");
    d.arc("arc", "c", "p1", "p2");
    d.line("out", "p2", "p3");
    d.con("tangent", &["in", "arc"]);
    d.con("tangent", &["arc", "out"]);
    d.dim("radius", &["arc"], 2000.);
    let before = (d.dist("p0", "p1"), d.dist("p2", "p3"));
    let out = d.solve();
    let same = (d.dist("p0", "p1") - before.0).abs() < T && (d.dist("p2", "p3") - before.1).abs() < T;
    assert_eq!(out.kept, same);
}

#[test]
fn a_free_line_and_a_free_arc_keep_their_shapes_when_a_radius_moves_along_a_chain() {
    let mut d = Doc::new();
    d.pt("p0", -40., 0.).pt("p1", 0., 0.).pt("p2", 20., 20.).pt("p3", 20., 50.);
    d.pt("c", 0., 20.);
    d.line("in", "p0", "p1");
    d.arc("arc", "c", "p1", "p2");
    d.line("out", "p2", "p3");
    d.con("tangent", &["in", "arc"]);
    d.con("tangent", &["arc", "out"]);
    d.dim("radius", &["arc"], 26.);
    let before = (d.dist("p0", "p1"), d.dist("p2", "p3"));
    let out = d.solve();
    assert!(out.ok);
    assert!(out.kept, "every free span stayed");
    near(d.dist("p0", "p1"), before.0, T);
    near(d.dist("p2", "p3"), before.1, T);
    near(d.dist("c", "p1"), 26., T);
}

#[test]
fn a_span_a_row_settles_is_not_one_to_hold() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 40., 0.).line("l", "a", "b");
    d.dim("distance", &["a", "b"], 90.);
    let out = d.solve();
    assert!(out.ok);
    assert!(out.kept);
    near(d.dist("a", "b"), 90., T);
}

#[test]
fn a_drag_keeps_its_components_small_and_moves_no_neighbour_it_need_not() {
    let mut d = Doc::new();
    d.pt("a", -50., -10.).pt("b", -10., 20.).pt("c", 30., 0.);
    d.line("one", "a", "b").line("two", "b", "c");
    d.dim("distance", &["a", "b"], 50.);
    d.input.drag.push(sketch_solver::api::DragIn { point: "a".into(), x: -60., y: -20. });
    assert!(d.solve().ok);
    near_p(d.p("c"), (30., 0.), T);
}

#[test]
fn a_radius_scales_its_arc_and_what_follows_moves_whole() {
    let mut d = Doc::new();
    d.pt("p0", -40., 0.).pt("p1", 0., 0.).pt("p2", 20., 20.).pt("p3", 20., 50.);
    d.pt("c", 0., 20.);
    d.line("in", "p0", "p1");
    d.arc("arc", "c", "p1", "p2");
    d.line("out", "p2", "p3");
    d.con("tangent", &["in", "arc"]);
    d.con("tangent", &["arc", "out"]);
    d.dim("radius", &["arc"], 30.);
    let out = d.solve();
    assert!(out.ok && out.kept);
    let (c, a, b) = (d.p("c"), d.p("p1"), d.p("p2"));
    let dot = (a.0 - c.0) * (b.0 - c.0) + (a.1 - c.1) * (b.1 - c.1);
    near(dot, 0., 1e-3);
}

fn arc_on_a_fixed_chord(start: (f64, f64)) -> Doc {
    let mut d = Doc::new();
    d.pt("a", 40., 0.).pt("b", -40., 0.).pt("c", start.0, start.1);
    d.fix("a").fix("b");
    d.arc("arc", "c", "a", "b");
    d
}

#[test]
fn a_loop_may_not_go_so_thin_it_has_no_side() {
    use sketch_solver::branch::{loop_crossed, side};
    let began = side(&[(0., 0.), (60., 0.), (30., 40.)]);
    assert!(!loop_crossed(&[(0., 0.), (60., 0.), (30., 0.01)], began), "thin is allowed");
    assert!(loop_crossed(&[(0., 0.), (60., 0.), (30., 0.)], began), "flat is not: it has no side");
    assert!(loop_crossed(&[(0., 0.), (60., 0.), (30., -5.)], began), "over is not");
    assert!(!loop_crossed(&[(0., 0.), (10., 0.), (-20., 1100.)], began), "a needle is not flat");
}

#[test]
fn an_arc_past_a_half_turn_may_go_further_by_a_small_step() {
    // Fixed ends, sweep about 215 degrees: a shorter radius or a longer one is just this arc moved.
    for r in [41., 46.] {
        let mut d = arc_on_a_fixed_chord((0., 14.));
        d.dim("radius", &["arc"], r);
        d.input.branches = Branches {
            arcs: vec![["c".into(), "a".into(), "b".into()]],
            ..Branches::default()
        };
        let out = d.solve();
        assert!(out.ok, "radius {r}");
        near(d.dist("c", "a"), r, T);
    }
}

#[test]
fn an_arc_closing_on_itself_has_jumped() {
    use sketch_solver::branch::arc_jumped;
    assert!(!arc_jumped(5.0, 4.5), "past a half turn and going on is no jump");
    assert!(arc_jumped(6.27, 6.1), "all but shut");
    assert!(arc_jumped(0.1, 3.0), "the other way round in one go");
}

/// A rectangle's right edge pinned by its rows, and an ear on it no row mentions.
fn eared(width: f64) -> Doc {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 60., 0.).pt("c", 60., 40.).pt("e", 90., 20.);
    d.fix("a");
    d.line("low", "a", "b").line("side", "b", "c");
    d.line("up", "c", "e").line("down", "e", "b");
    d.con("horizontal", &["low"]);
    d.con("vertical", &["side"]);
    d.dim("distance", &["a", "b"], width);
    d.dim("distance", &["b", "c"], 40.);
    d
}

#[test]
fn an_end_no_row_mentions_is_part_of_the_shape_it_is_on() {
    let mut d = eared(100.);
    let out = d.solve();
    assert!(out.ok);
    assert!(out.kept);
    near(d.dist("c", "e"), 1300_f64.sqrt(), T);
    near(d.dist("e", "b"), 1300_f64.sqrt(), T);
}

#[test]
fn a_drag_leaves_an_end_no_row_mentions_out_of_its_component() {
    let mut d = eared(60.);
    d.input.dimensions.clear();
    let out = d.drag("c", 60., 50.);
    assert!(out.ok);
    near_p(d.p("e"), (90., 20.), T);
}

#[test]
fn a_plain_solve_holds_no_length_and_moves_less() {
    let mut kept = eared(100.);
    assert!(kept.solve().ok);
    let mut plain = eared(100.);
    plain.input.plain = true;
    assert!(plain.solve().ok);
    near_p(plain.p("e"), (90., 20.), T);
    assert!(plain.dist("c", "e") < kept.dist("c", "e"));
}

#[test]
fn a_loop_with_an_arc_has_the_area_of_its_outline() {
    use sketch_solver::branch::side_of;
    // A half disc of radius 10 on the chord from (-10, 0) to (10, 0), going round under it.
    let chord = [(-10., 0.), (10., 0.)];
    let half = std::f64::consts::PI * 50.;
    let under = side_of(&chord, &[(1, (0., 0.), true)]);
    near(under.abs(), half, 1e-9);
    assert_eq!(under.signum(), side_of(&[(0., 0.), (10., 0.), (0., 10.)], &[]).signum());
    near(side_of(&chord, &[(1, (0., 0.), false)]), -under, 1e-9);
    assert_eq!(side_of(&chord, &[]), 0., "no arc, no area");
}

#[test]
fn a_loop_that_would_go_flat_says_flat() {
    let mut d = triangle((30., 40.), 50., 50.);
    d.input.dimensions.clear();
    d.line("base", "a", "b");
    d.con("coincident", &["c", "base"]);
    let out = d.solve();
    assert!(!out.ok);
    assert_eq!(out.crossed.as_deref(), Some("flat"));
}

#[test]
fn a_wall_of_a_closed_profile_stays_on_its_line_before_it_keeps_its_length() {
    let mut d = Doc::new();
    d.pt("o", 0., 0.).pt("a", 10., 0.).pt("b", 10., 8.).pt("c", 0., 8.);
    d.pt("t", 5., 12.);
    d.fix("o").fix("a");
    d.line("floor", "o", "a").line("right", "a", "b").line("left", "c", "o");
    d.line("up", "b", "t").line("down", "t", "c");
    d.con("vertical", &["right"]);
    d.con("vertical", &["left"]);
    d.dim("distance", &["b", "t"], 8.);
    d.input.walls = vec![["a".into(), "b".into()], ["c".into(), "o".into()]];
    let out = d.solve();
    assert!(out.ok);
    near(d.p("b").0, 10., T);
    near(d.p("c").0, 0., T);
}
