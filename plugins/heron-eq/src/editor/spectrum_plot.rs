//! Display spectra use monotone cubic segments, retaining measured extrema.
//! This is editor-only geometry; neither audio nor EQ Match uses these paths.
use super::geometry::Plot;
use truce_iced::iced::{
    Color, Point,
    widget::canvas::{Frame, Path, Stroke},
};

#[derive(Clone, Copy)]
pub struct Appearance {
    pub color: Color,
    pub width: f32,
    pub fill_alpha: f32,
}

pub fn draw(
    frame: &mut Frame,
    plot: Plot,
    frequencies: &[f32],
    values: &[f32],
    floor_db: f32,
    appearance: Appearance,
) {
    if frequencies.len() != values.len() {
        return;
    }
    let mut points = Vec::<Point>::with_capacity(frequencies.len());
    for (&frequency, &value) in frequencies.iter().zip(values) {
        if !(10.0..=30_000.0).contains(&frequency) || !value.is_finite() {
            continue;
        }
        let point = Point::new(
            plot.frequency_x(frequency),
            plot.spectrum_y(value, floor_db),
        );
        if points.last().is_none_or(|previous| point.x > previous.x) {
            points.push(point);
        }
    }
    let (Some(&first), Some(&last)) = (points.first(), points.last()) else {
        return;
    };
    let trace = |builder: &mut truce_iced::iced::widget::canvas::path::Builder| {
        builder.move_to(first);
        for index in 0..points.len().saturating_sub(1) {
            let [control_a, control_b, end] = segment(&points, index);
            builder.bezier_curve_to(control_a, control_b, end);
        }
    };
    if appearance.fill_alpha > 0.0 {
        let bottom = plot.bounds.y + plot.bounds.height;
        let fill = Path::new(|builder| {
            trace(builder);
            builder.line_to(Point::new(last.x, bottom));
            builder.line_to(Point::new(first.x, bottom));
            builder.close();
        });
        frame.fill(
            &fill,
            Color {
                a: appearance.fill_alpha,
                ..appearance.color
            },
        );
    }
    frame.stroke(
        &Path::new(trace),
        Stroke::default()
            .with_color(appearance.color)
            .with_width(appearance.width),
    );
}

fn secant(a: Point, b: Point) -> f32 {
    (b.y - a.y) / (b.x - a.x)
}

fn tangent(points: &[Point], index: usize) -> f32 {
    if index == 0 {
        return secant(points[0], points[1]);
    }
    if index + 1 == points.len() {
        return secant(points[index - 1], points[index]);
    }
    let previous = secant(points[index - 1], points[index]);
    let next = secant(points[index], points[index + 1]);
    if previous == 0.0 || next == 0.0 || previous.is_sign_positive() != next.is_sign_positive() {
        return 0.0;
    }
    let left = points[index].x - points[index - 1].x;
    let right = points[index + 1].x - points[index].x;
    let w1 = 2.0 * right + left;
    let w2 = right + 2.0 * left;
    (w1 + w2) / (w1 / previous + w2 / next)
}

fn segment(points: &[Point], index: usize) -> [Point; 3] {
    let start = points[index];
    let end = points[index + 1];
    let third = (end.x - start.x) / 3.0;
    let low = start.y.min(end.y);
    let high = start.y.max(end.y);
    [
        Point::new(
            start.x + third,
            (start.y + tangent(points, index) * third).clamp(low, high),
        ),
        Point::new(
            end.x - third,
            (end.y - tangent(points, index + 1) * third).clamp(low, high),
        ),
        end,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounded_spectrum_retains_narrow_peaks_without_inventing_extrema() {
        let points = [
            Point::new(0.0, 90.0),
            Point::new(1.0, 80.0),
            Point::new(5.0, 10.0),
            Point::new(6.0, 80.0),
            Point::new(10.0, 80.0),
            Point::new(11.0, 110.0),
        ];
        assert_eq!(tangent(&points, 2), 0.0);
        for index in 0..points.len() - 1 {
            let start = points[index];
            let [a, b, end] = segment(&points, index);
            for step in 0..=100 {
                let t = step as f32 / 100.0;
                let u = 1.0 - t;
                let y = u.powi(3) * start.y
                    + 3.0 * u.powi(2) * t * a.y
                    + 3.0 * u * t.powi(2) * b.y
                    + t.powi(3) * end.y;
                assert!(y >= start.y.min(end.y) - 1.0e-4);
                assert!(y <= start.y.max(end.y) + 1.0e-4);
            }
            assert_eq!(end, points[index + 1]);
        }
    }
}
