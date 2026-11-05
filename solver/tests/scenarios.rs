//! Tutorial scenarios from docs/SPEC.md section 9, built the way the tools build them.
mod common;
use common::*;
use std::f64::consts::{FRAC_PI_4, PI};

/// The wall outlet up to the end of Activity 1 (reference GUID-087596A4): outer centre rectangle,
/// construction mirror line, screw circle, upper cutout, and its mirror image.
fn outlet_sketched() -> Doc {
    let mut d = Doc::new();
    // Center Rectangle from the origin: four lines, H/V, two construction diagonals with their
    // midpoint at the origin. Rough size, not to dimension.
    d.pt("o1", -30., 45.)
        .pt("o2", 30., 45.)
        .pt("o3", 30., -45.)
        .pt("o4", -30., -45.);
    d.line("top", "o1", "o2")
        .line("right", "o2", "o3")
        .line("bottom", "o3", "o4")
        .line("left", "o4", "o1");
    d.con("horizontal", &["top"]);
    d.con("horizontal", &["bottom"]);
    d.con("vertical", &["right"]);
    d.con("vertical", &["left"]);
    d.line("diag1", "o1", "o3").line("diag2", "o2", "o4");
    d.con("midpoint", &["origin", "diag1"]);
    d.con("midpoint", &["origin", "diag2"]);

    // Construction line between the midpoints of the two sides.
    d.pt("ml", -30., 0.)
        .pt("mr", 30., 0.)
        .line("mirror", "ml", "mr");
    d.con("midpoint", &["ml", "left"]);
    d.con("midpoint", &["mr", "right"]);

    // Circle at the origin.
    d.pt("hole", 0., 0.).circle("screw", "hole", 8.);
    d.con("coincident", &["hole", "origin"]);

    // Cutout rectangle, 2-Point Rectangle: separate end points joined by coincidents.
    let corners = [
        ("tl", -10., 38.),
        ("tr", 10., 38.),
        ("br", 10., 14.),
        ("bl", -10., 14.),
    ];
    for (n, x, y) in corners {
        d.pt(&format!("{n}1"), x, y).pt(&format!("{n}2"), x, y);
    }
    d.line("ct", "tl1", "tr1")
        .line("cr", "tr2", "br1")
        .line("cb", "br2", "bl1")
        .line("cl", "bl2", "tl2");
    for n in ["tl", "tr", "br", "bl"] {
        d.con("coincident", &[&format!("{n}1"), &format!("{n}2")]);
    }
    d.con("horizontal", &["ct"]);
    d.con("horizontal", &["cb"]);
    d.con("vertical", &["cr"]);
    d.con("vertical", &["cl"]);

    // Two 3-point arcs on the corners, bulging outwards. Counter-clockwise from a to b, so the
    // left arc runs top to bottom and the right arc bottom to top.
    d.pt("lc", 4., 26.)
        .pt("la", -10., 38.)
        .pt("lb", -10., 14.)
        .arc("arcL", "lc", "la", "lb");
    d.con("coincident", &["la", "tl1"]);
    d.con("coincident", &["lb", "bl1"]);
    d.pt("rc", -4., 26.)
        .pt("ra", 10., 14.)
        .pt("rb", 10., 38.)
        .arc("arcR", "rc", "ra", "rb");
    d.con("coincident", &["ra", "br1"]);
    d.con("coincident", &["rb", "tr1"]);

    // Mirror: 12 objects (6 curves and 6 points), about the construction line.
    let m = |d: &mut Doc, n: &str, x: f64, y: f64| {
        d.pt(&format!("{n}m"), x, -y);
    };
    for (n, x, y) in corners {
        m(&mut d, &format!("{n}1"), x, y);
        m(&mut d, &format!("{n}2"), x, y);
    }
    d.line("ctm", "tl1m", "tr1m")
        .line("crm", "tr2m", "br1m")
        .line("cbm", "br2m", "bl1m")
        .line("clm", "bl2m", "tl2m");
    d.pt("lcm", 4., -26.)
        .pt("lam", -10., -38.)
        .pt("lbm", -10., -14.)
        .arc("arcLm", "lcm", "lbm", "lam");
    d.pt("rcm", -4., -26.)
        .pt("ram", 10., -14.)
        .pt("rbm", 10., -38.)
        .arc("arcRm", "rcm", "rbm", "ram");
    for (a, b) in [
        ("ct", "ctm"),
        ("cr", "crm"),
        ("cb", "cbm"),
        ("cl", "clm"),
        ("arcL", "arcLm"),
        ("arcR", "arcRm"),
    ] {
        d.con("symmetric", &[a, b, "mirror"]);
    }
    d
}

/// Activity 2 (GUID-E8C8752F): concentric, vertical to the circle centre, equal.
fn outlet_constrained() -> Doc {
    let mut d = outlet_sketched();
    d.con("concentric", &["arcL", "arcR"]);
    d.con("vertical", &["hole", "lc"]);
    d.con("equal", &["arcL", "arcR"]);
    d
}

/// Activity 3 (GUID-0A723EF7): the six dimensions.
fn outlet_dimensioned() -> Doc {
    let mut d = outlet_constrained();
    d.dim("distance", &["top"], 70.);
    d.dim("distance", &["right"], 114.);
    d.dim("diameter", &["screw"], 12.);
    d.dim("lineLine", &["cb", "mirror"], 11.);
    d.dim("lineLine", &["ct", "cb"], 28.);
    d.dim("radius", &["arcL"], 17.);
    d
}

#[test]
fn wall_outlet_dof_after_each_activity() {
    let mut d = outlet_sketched();
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    // 2 outer sizes + r + cutout (4 + left arc centre 1 + right arc centre 1).
    assert_eq!(o.dof, Some(9), "{:?}", o.free_points);

    let mut d = outlet_constrained();
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    // Concentric removes 1 net, not 2: both arc centres are already on the cutout's horizontal
    // mid-line, so its Y equation is redundant. Vertical and equal remove 1 each. That leaves
    // outer 2, r 1, cutout half-width, top, bottom.
    assert_eq!(o.dof, Some(6), "{:?}", o.free_points);
}

#[test]
fn wall_outlet_ends_fully_defined() {
    let mut d = outlet_dimensioned();
    let o = d.analyze();
    println!("{o:?}");
    assert!(o.ok, "{o:?}");
    assert!(o.unsatisfied.is_empty());
    assert_eq!(
        o.dof,
        Some(0),
        "free: {:?} {:?}",
        o.free_points,
        o.free_curves
    );
    assert_eq!(
        o.free_curves.as_ref().unwrap().len(),
        0,
        "{:?}",
        o.free_curves
    );
    assert_eq!(
        o.free_points.as_ref().unwrap().len(),
        0,
        "{:?}",
        o.free_points
    );

    // Measured against the tutorial's numbers.
    near(d.dist("o1", "o2"), 70., 1e-6);
    near(d.dist("o2", "o3"), 114., 1e-6);
    near_p(d.p("o2"), (35., 57.), 1e-6);
    near(d.r("screw"), 6., 1e-6);
    near(d.p("bl1").1, 11., 1e-6);
    near(d.p("tl1").1, 39., 1e-6);
    near(d.dist("lc", "la"), 17., 1e-6);
    near(d.dist("rc", "ra"), 17., 1e-6);
    near(d.p("lc").0, 0., 1e-6);
    near(d.p("lc").1, 25., 1e-6);
    let half = (17.0f64.powi(2) - 14.0f64.powi(2)).sqrt();
    near(d.p("tr1").0, half, 1e-6);
    near(d.p("tl1").0, -half, 1e-6);
    // The mirrored half.
    near_p(d.p("tl1m"), (-half, -39.), 1e-6);
    near_p(d.p("lcm"), (0., -25.), 1e-6);
    near(d.dist("lcm", "lam"), 17., 1e-6);
    near(d.dist("rcm", "ram"), 17., 1e-6);
}

#[test]
fn wall_outlet_is_order_independent() {
    // Dimensions typed first, constraints last, the order a user may well do it in.
    let mut d = outlet_sketched();
    d.dim("distance", &["top"], 70.);
    d.dim("distance", &["right"], 114.);
    d.solve();
    d.dim("diameter", &["screw"], 12.);
    d.solve();
    d.con("concentric", &["arcL", "arcR"]);
    d.solve();
    d.con("vertical", &["hole", "lc"]);
    d.solve();
    d.con("equal", &["arcL", "arcR"]);
    d.solve();
    d.dim("lineLine", &["cb", "mirror"], 11.);
    d.solve();
    d.dim("lineLine", &["ct", "cb"], 28.);
    d.solve();
    d.dim("radius", &["arcL"], 17.);
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    assert_eq!(o.dof, Some(0));
}

#[test]
fn wall_outlet_cannot_be_dragged() {
    let mut d = outlet_dimensioned();
    d.solve();
    let before = d.p("tr1");
    let o = d.drag("tr1", 50., 80.);
    assert!(o.ok, "{o:?}");
    near_p(d.p("tr1"), before, 1e-5);
}

#[test]
fn wall_outlet_dimension_edit_propagates_through_mirror() {
    let mut d = outlet_dimensioned();
    d.solve();
    let id = d
        .input
        .dimensions
        .iter()
        .find(|k| k.kind == "radius")
        .unwrap()
        .id
        .clone();
    d.set_dim(&id, 20.);
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    assert_eq!(o.dof, Some(0));
    near(d.dist("rcm", "ram"), 20., 1e-6);
}

fn bracket() -> Doc {
    // Reference GUID-AB8D9509 images: an L, from the origin along the bottom to the elbow, up the
    // 45 degree leg, across the end, back down the upper edge, along the top, down the left edge.
    let mut d = Doc::new();
    d.pt("a", 0., 0.)
        .pt("b", 480., 10.)
        .pt("c", 820., 340.)
        .pt("e", 760., 410.);
    d.pt("f", 430., 110.).pt("g", 10., 95.);
    d.line("bottom", "a", "b")
        .line("slant", "b", "c")
        .line("end", "c", "e");
    d.line("upper", "e", "f")
        .line("top", "f", "g")
        .line("back", "g", "a");
    d.con("coincident", &["a", "origin"]);
    d.con("perpendicular", &["back", "bottom"]);
    d.con("perpendicular", &["slant", "end"]);
    d.con("perpendicular", &["end", "upper"]);
    d.con("horizontal", &["bottom"]);
    d.con("horizontal", &["top"]);
    d.con("equal", &["bottom", "slant"]);
    d.con("equal", &["back", "end"]);
    d
}

#[test]
fn bracket_fully_defined() {
    let mut d = bracket();
    assert_eq!(d.analyze().dof, Some(3));
    d.dim("distance", &["bottom"], 500.);
    d.dim("angle", &["bottom", "slant"], FRAC_PI_4);
    d.dim("distance", &["end"], 100.);
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    assert_eq!(o.dof, Some(0), "{:?}", o.free_points);
    near_p(d.p("b"), (500., 0.), 1e-6);
    let s = 500.0 * FRAC_PI_4.cos();
    near_p(d.p("c"), (500. + s, s), 1e-6);
    near(d.dist("c", "e"), 100., 1e-6);
    near(d.dist("g", "a"), 100., 1e-6);
    near_p(d.p("g"), (0., 100.), 1e-6);
    // Upper edge stays parallel to the slant, at 100.
    near(cross(d.p("b"), d.p("c"), d.p("f"), d.p("e")), 0., 1e-5);
    near(side(d.p("f"), d.p("b"), d.p("c")).abs(), 100., 1e-6);
    near(d.p("f").1, 100., 1e-6);
}

#[test]
fn bracket_dimension_edit_keeps_shape() {
    let mut d = bracket();
    d.dim("distance", &["bottom"], 500.);
    let id = d.dim("angle", &["bottom", "slant"], FRAC_PI_4);
    d.dim("distance", &["end"], 100.);
    d.solve();
    d.set_dim(&id, PI / 3.0);
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    assert_eq!(o.dof, Some(0));
    let (b, c) = (d.p("b"), d.p("c"));
    near((c.1 - b.1).atan2(c.0 - b.0), PI / 3.0, 1e-6);
}

/// Gear pattern: a 4 mm circle a dimensioned distance above the origin, and a circular pattern of
/// six. Each instance is a rotatedCopy of the source centre about the pattern centre plus an equal
/// radius, feature-owned, as the Circular Pattern tool emits them.
fn pattern() -> (Doc, String) {
    let mut d = Doc::new();
    d.pt("c", 0., 25.).circle("hole", "c", 2.1);
    d.con("vertical", &["origin", "c"]);
    d.dim("diameter", &["hole"], 4.);
    let id = d.dim("distance", &["origin", "c"], 25.4);
    for i in 1..6 {
        let t = i as f64 * PI / 3.0;
        let (name, circle) = (format!("c{i}"), format!("hole{i}"));
        d.pt(&name, -25.0 * t.sin(), 25.0 * t.cos())
            .circle(&circle, &name, 2.0);
        d.rotated("origin", "c", &name, t);
        d.con("equal", &["hole", &circle]);
    }
    (d, id)
}

#[test]
fn circular_pattern_of_six() {
    let (mut d, id) = pattern();
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    assert_eq!(o.dof, Some(0), "{:?}", o.free_points);
    for r in [25.4, 40.0, 12.5] {
        d.set_dim(&id, r);
        let o = d.analyze();
        assert!(o.ok, "{o:?}");
        assert_eq!(o.dof, Some(0));
        for i in 1..6 {
            let t = PI / 2.0 + i as f64 * PI / 3.0;
            near_p(d.p(&format!("c{i}")), (r * t.cos(), r * t.sin()), 1e-6);
            near(d.r(&format!("hole{i}")), 2.0, 1e-6);
        }
    }
}
