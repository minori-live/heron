//! All paths share a 16-unit canvas and rounded 1.5-unit strokes.

use truce_iced::iced::{
    Color, Point, Size,
    widget::canvas::{Frame, LineCap, LineJoin, Path, Stroke, path::Builder},
};

use super::Icon;

pub fn draw(frame: &mut Frame, icon: Icon, color: Color) {
    let path = Path::new(|builder| match icon {
        Icon::Power => {
            builder.move_to(p(4.5, 3.7));
            curve(builder, (1.5, 6.0), (1.7, 10.0), (4.6, 12.5));
            curve(builder, (7.1, 14.6), (11.0, 13.8), (12.9, 10.9));
            curve(builder, (14.5, 8.4), (13.7, 5.2), (11.5, 3.7));
            line(builder, &[(8.0, 1.5), (8.0, 7.5)]);
        }
        Icon::More => {
            for x in [3.0, 8.0, 13.0] {
                builder.circle(p(x, 8.0), 0.65);
            }
        }
        Icon::Spectrum => {
            for (x, top) in [(2.5, 9.0), (5.3, 5.0), (8.0, 7.5), (10.7, 2.5), (13.5, 6.5)] {
                line(builder, &[(x, 13.5), (x, top)]);
            }
        }
        Icon::Phase => {
            builder.move_to(p(1.5, 5.5));
            curve(builder, (4.0, 0.5), (5.5, 0.5), (8.0, 5.5));
            curve(builder, (10.5, 10.5), (12.0, 10.5), (14.5, 5.5));
            builder.move_to(p(1.5, 10.5));
            curve(builder, (4.0, 10.5), (4.0, 5.5), (7.0, 5.5));
            curve(builder, (10.0, 5.5), (10.0, 13.5), (14.5, 13.5));
        }
        Icon::Headphones => {
            builder.move_to(p(2.5, 8.0));
            builder.line_to(p(2.5, 7.0));
            curve(builder, (2.5, 0.7), (13.5, 0.7), (13.5, 7.0));
            builder.line_to(p(13.5, 8.0));
            builder.rectangle(p(2.0, 8.0), Size::new(3.5, 5.0));
            builder.rectangle(p(10.5, 8.0), Size::new(3.5, 5.0));
        }
        Icon::Trash => {
            line(builder, &[(2.5, 4.5), (13.5, 4.5)]);
            line(builder, &[(6.0, 4.5), (6.0, 2.0), (10.0, 2.0), (10.0, 4.5)]);
            polygon(
                builder,
                &[(4.0, 4.5), (4.5, 14.0), (11.5, 14.0), (12.0, 4.5)],
            );
            line(builder, &[(6.5, 7.0), (6.5, 11.5)]);
            line(builder, &[(9.5, 7.0), (9.5, 11.5)]);
        }
        Icon::Previous => line(builder, &[(10.0, 3.0), (5.0, 8.0), (10.0, 13.0)]),
        Icon::Next => line(builder, &[(6.0, 3.0), (11.0, 8.0), (6.0, 13.0)]),
        Icon::Close => {
            line(builder, &[(4.0, 4.0), (12.0, 12.0)]);
            line(builder, &[(4.0, 12.0), (12.0, 4.0)]);
        }
        Icon::Copy => {
            line(
                builder,
                &[
                    (10.0, 3.0),
                    (10.0, 2.0),
                    (2.0, 2.0),
                    (2.0, 10.0),
                    (3.0, 10.0),
                ],
            );
            builder.rectangle(p(5.0, 5.0), Size::new(9.0, 9.0));
        }
        Icon::Paste => {
            line(
                builder,
                &[
                    (5.5, 3.5),
                    (3.0, 3.5),
                    (3.0, 14.0),
                    (13.0, 14.0),
                    (13.0, 3.5),
                    (10.5, 3.5),
                ],
            );
            builder.rectangle(p(5.5, 1.5), Size::new(5.0, 4.0));
            line(builder, &[(6.0, 8.5), (10.0, 8.5)]);
            line(builder, &[(6.0, 11.0), (10.0, 11.0)]);
        }
        Icon::Duplicate => {
            line(builder, &[(6.0, 2.0), (14.0, 2.0), (14.0, 10.0)]);
            builder.rectangle(p(2.0, 5.0), Size::new(9.0, 9.0));
            line(builder, &[(4.5, 9.5), (8.5, 9.5)]);
            line(builder, &[(6.5, 7.5), (6.5, 11.5)]);
        }
        Icon::Split => {
            line(builder, &[(1.5, 8.0), (5.5, 8.0), (10.5, 3.5), (14.5, 3.5)]);
            line(builder, &[(5.5, 8.0), (10.5, 12.5), (14.5, 12.5)]);
            line(builder, &[(12.0, 1.5), (14.5, 3.5), (12.0, 5.5)]);
            line(builder, &[(12.0, 10.5), (14.5, 12.5), (12.0, 14.5)]);
        }
        Icon::Keyboard => {
            builder.rectangle(p(1.5, 3.5), Size::new(13.0, 9.0));
            for x in [4.0, 6.5, 9.0, 11.5] {
                line(builder, &[(x, 8.0), (x, 12.5)]);
            }
            for x in [3.2, 6.6, 10.0] {
                builder.rectangle(p(x, 3.5), Size::new(1.6, 4.5));
            }
        }
        Icon::Snowflake => {
            line(builder, &[(8.0, 1.5), (8.0, 14.5)]);
            line(builder, &[(2.4, 4.8), (13.6, 11.2)]);
            line(builder, &[(2.4, 11.2), (13.6, 4.8)]);
            line(builder, &[(6.0, 3.5), (8.0, 5.5), (10.0, 3.5)]);
            line(builder, &[(6.0, 12.5), (8.0, 10.5), (10.0, 12.5)]);
        }
        Icon::Volume | Icon::Mute => {
            polygon(
                builder,
                &[
                    (1.5, 6.0),
                    (4.5, 6.0),
                    (8.0, 3.0),
                    (8.0, 13.0),
                    (4.5, 10.0),
                    (1.5, 10.0),
                ],
            );
            if icon == Icon::Mute {
                line(builder, &[(2.0, 2.0), (14.0, 14.0)]);
            } else {
                builder.move_to(p(10.0, 5.5));
                curve(builder, (11.5, 6.5), (11.5, 9.5), (10.0, 10.5));
                builder.move_to(p(12.0, 3.5));
                curve(builder, (15.0, 5.5), (15.0, 10.5), (12.0, 12.5));
            }
        }
        Icon::Invert => {
            line(builder, &[(4.5, 2.5), (4.5, 7.5)]);
            line(builder, &[(2.0, 5.0), (7.0, 5.0)]);
            line(builder, &[(9.0, 11.0), (14.0, 11.0)]);
            line(builder, &[(2.0, 14.0), (14.0, 2.0)]);
            line(builder, &[(10.5, 2.0), (14.0, 2.0), (14.0, 5.5)]);
        }
        Icon::AutoGain => {
            line(builder, &[(4.0, 2.0), (4.0, 13.0)]);
            line(builder, &[(2.0, 4.0), (4.0, 2.0), (6.0, 4.0)]);
            line(builder, &[(12.0, 3.0), (12.0, 14.0)]);
            line(builder, &[(10.0, 12.0), (12.0, 14.0), (14.0, 12.0)]);
            line(builder, &[(2.0, 8.0), (14.0, 8.0)]);
        }
        Icon::Link => {
            builder.move_to(p(6.0, 5.5));
            builder.line_to(p(3.0, 8.5));
            curve(builder, (0.5, 11.0), (5.0, 15.5), (7.5, 13.0));
            builder.line_to(p(10.5, 10.0));
            builder.move_to(p(5.5, 6.0));
            builder.line_to(p(8.5, 3.0));
            curve(builder, (11.0, 0.5), (15.5, 5.0), (13.0, 7.5));
            builder.line_to(p(10.0, 10.5));
            line(builder, &[(5.5, 10.5), (10.5, 5.5)]);
        }
        Icon::Collision => {
            builder.move_to(p(1.5, 13.0));
            curve(builder, (3.5, 13.0), (3.5, 3.0), (6.0, 3.0));
            curve(builder, (8.5, 3.0), (8.5, 13.0), (10.5, 13.0));
            builder.move_to(p(5.5, 13.0));
            curve(builder, (7.5, 13.0), (7.5, 5.0), (10.0, 5.0));
            curve(builder, (12.5, 5.0), (12.5, 13.0), (14.5, 13.0));
        }
        Icon::Midi => {
            builder.circle(p(8.0, 8.0), 6.0);
            for (x, y) in [
                (4.0, 7.0),
                (6.0, 4.7),
                (10.0, 4.7),
                (12.0, 7.0),
                (8.0, 10.5),
            ] {
                builder.circle(p(x, y), 0.45);
            }
        }
    });
    frame.stroke(
        &path,
        Stroke::default()
            .with_color(color)
            .with_width(1.5)
            .with_line_cap(LineCap::Round)
            .with_line_join(LineJoin::Round),
    );
}

fn p(x: f32, y: f32) -> Point {
    Point::new(x, y)
}

fn line(builder: &mut Builder, points: &[(f32, f32)]) {
    if let Some(&(x, y)) = points.first() {
        builder.move_to(p(x, y));
        for &(x, y) in &points[1..] {
            builder.line_to(p(x, y));
        }
    }
}

fn polygon(builder: &mut Builder, points: &[(f32, f32)]) {
    line(builder, points);
    builder.close();
}

fn curve(builder: &mut Builder, first: (f32, f32), second: (f32, f32), end: (f32, f32)) {
    builder.bezier_curve_to(p(first.0, first.1), p(second.0, second.1), p(end.0, end.1));
}
