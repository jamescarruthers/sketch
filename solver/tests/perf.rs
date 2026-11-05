//! 500-curve drag step. Run with `cargo test --release --test perf -- --nocapture`.
mod common;
use common::*;
use sketch_solver::solve::solve;
use std::time::Instant;

/// Chained lines joined by coincidents, zig-zagging, with a mix of constraints. All one component.
pub fn chain(n: usize) -> Doc {
    let mut d = Doc::new();
    let at = |i: usize| (i as f64 * 10.0, if i.is_multiple_of(2) { 0.0 } else { 6.0 });
    for i in 0..n {
        let (a, b) = (at(i), at(i + 1));
        d.pt(&format!("a{i}"), a.0, a.1)
            .pt(&format!("b{i}"), b.0, b.1);
        d.line(&format!("l{i}"), &format!("a{i}"), &format!("b{i}"));
        if i > 0 {
            d.con("coincident", &[&format!("b{}", i - 1), &format!("a{i}")]);
        }
        let (l, a0, b0) = (format!("l{i}"), format!("a{i}"), format!("b{i}"));
        match i % 8 {
            0 => {
                let len = (10.0f64.powi(2) + 6.0f64.powi(2)).sqrt();
                d.dim("distance", &[&a0, &b0], len);
            }
            1 => {
                d.con("equal", &[&l, &format!("l{}", i - 1)]);
            }
            3 => {
                d.con("parallel", &[&l, &format!("l{}", i - 2)]);
            }
            5 => {
                d.dim("horizontal", &[&a0, &b0], 10.);
            }
            7 => {
                d.con("equal", &[&l, &format!("l{}", i - 3)]);
            }
            _ => {}
        }
    }
    d.con("coincident", &["a0", "origin"]);
    d
}

fn bench(d: &mut Doc, point: &str, step: (f64, f64), n: usize) -> (f64, f64, usize) {
    let (x, y) = d.p(point);
    let mut times = Vec::new();
    let mut iters = 0;
    for k in 1..=n {
        let t = k as f64;
        let dragged = (x + step.0 * t, y + step.1 * t);
        d.input.drag = vec![sketch_solver::api::DragIn {
            point: point.into(),
            x: dragged.0,
            y: dragged.1,
        }];
        let start = Instant::now();
        let o = solve(&d.input);
        times.push(start.elapsed().as_secs_f64() * 1000.0);
        assert!(o.ok, "{o:?}");
        iters += o.iterations;
        d.input.drag.clear();
        d.apply(&o);
    }
    times.sort_by(f64::total_cmp);
    (times[times.len() / 2], *times.last().unwrap(), iters / n)
}

#[test]
fn drag_500_curves() {
    let mut d = chain(500);
    assert_eq!(d.input.curves.len(), 500);
    let t = Instant::now();
    let o = d.analyze();
    println!(
        "analyze 500 curves: {:?}, dof {:?}, ok {}, solve iterations {}",
        t.elapsed(),
        o.dof,
        o.ok,
        o.iterations
    );
    assert!(o.ok, "{:?}", o.unsatisfied);

    if let Ok(path) = std::env::var("DUMP_CHAIN") {
        std::fs::write(path, serde_json::to_string(&d.input).unwrap()).unwrap();
    }
    let (median, worst, it) = bench(&mut d, "a250", (0.3, 0.2), 60);
    println!("drag middle point: median {median:.2} ms, worst {worst:.2} ms, {it} iterations");
    let (m2, w2, i2) = bench(&mut d, "b499", (0.3, -0.2), 60);
    println!("drag far end: median {m2:.2} ms, worst {w2:.2} ms, {i2} iterations");
    if !cfg!(debug_assertions) {
        assert!(median < 16.0, "median {median} ms");
    }
}

/// Every line has a length and an angle to the previous one, so the whole 500-curve chain moves
/// rigidly, and every variable changes on every step.
fn rigid_chain(n: usize, anchored: bool) -> Doc {
    let mut d = chain_points(n);
    for i in 0..n {
        let (a, b) = (format!("a{i}"), format!("b{i}"));
        d.dim("distance", &[&a, &b], (136.0f64).sqrt());
        if i > 0 && !(anchored && i % 25 == 0) {
            let t = if i.is_multiple_of(2) { -1.0 } else { 1.0 } * 2.0 * (0.6f64).atan();
            d.dim(
                "angle",
                &[&format!("l{}", i - 1), &format!("l{i}")],
                t.abs(),
            );
        }
    }
    if anchored {
        d.con("coincident", &["a0", "origin"]);
    }
    d
}

fn chain_points(n: usize) -> Doc {
    let mut d = Doc::new();
    let at = |i: usize| (i as f64 * 10.0, if i.is_multiple_of(2) { 0.0 } else { 6.0 });
    for i in 0..n {
        let (a, b) = (at(i), at(i + 1));
        d.pt(&format!("a{i}"), a.0, a.1)
            .pt(&format!("b{i}"), b.0, b.1);
        d.line(&format!("l{i}"), &format!("a{i}"), &format!("b{i}"));
        if i > 0 {
            d.con("coincident", &[&format!("b{}", i - 1), &format!("a{i}")]);
        }
    }
    d
}

#[test]
fn drag_500_curves_rigid_body() {
    let mut d = rigid_chain(500, false);
    let o = d.analyze();
    assert!(o.ok, "{:?}", o.unsatisfied);
    assert_eq!(o.dof, Some(3));
    if let Ok(path) = std::env::var("DUMP_RIGID") {
        std::fs::write(path, serde_json::to_string(&d.input).unwrap()).unwrap();
    }
    let (median, worst, it) = bench(&mut d, "a250", (0.5, 0.5), 60);
    println!("rigid 500: median {median:.2} ms, worst {worst:.2} ms, {it} iterations");
    if !cfg!(debug_assertions) {
        assert!(median < 16.0, "median {median} ms");
    }
}

#[test]
fn drag_500_curves_unreachable_target() {
    let mut d = rigid_chain(500, true);
    let t = Instant::now();
    let o = d.analyze();
    println!("analyze anchored 500: {:?}, dof {:?}", t.elapsed(), o.dof);
    assert!(o.ok, "{:?}", o.unsatisfied);
    let (median, worst, it) = bench(&mut d, "b499", (0.0, 30.0), 20);
    println!("unreachable 500: median {median:.2} ms, worst {worst:.2} ms, {it} iterations");
}
