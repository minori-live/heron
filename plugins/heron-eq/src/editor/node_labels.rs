//! Center the visible numeral, rather than its font's advance and line boxes.

use std::cell::RefCell;

use truce_iced::iced::{
    Color, Font, Pixels, Point, Rectangle, Size, Vector, alignment,
    widget::canvas::{Path, Text},
};

struct LabelOffsets {
    font: Font,
    size: f32,
    offsets: [Vector; 24],
}

thread_local! {
    static OFFSETS: RefCell<Option<LabelOffsets>> = const { RefCell::new(None) };
}

pub(super) fn text(id: u32, center: Point, color: Color, font: Font, size: f32) -> Text {
    let offset = OFFSETS.with(|offsets| {
        let mut offsets = offsets.borrow_mut();
        if offsets
            .as_ref()
            .is_none_or(|cache| cache.font != font || cache.size != size)
        {
            *offsets = Some(LabelOffsets {
                font,
                size,
                offsets: std::array::from_fn(|index| {
                    let number =
                        base_text(index as u32 + 1, Point::ORIGIN, Color::BLACK, font, size);
                    ink_bounds(&number).map_or(Vector::ZERO, |bounds| {
                        Vector::new(bounds.center_x(), bounds.center_y())
                    })
                }),
            });
        }
        offsets
            .as_ref()
            .and_then(|cache| {
                id.checked_sub(1)
                    .and_then(|index| cache.offsets.get(index as usize))
            })
            .copied()
            .unwrap_or(Vector::ZERO)
    });
    // All measurements and offsets are logical canvas coordinates. The native
    // renderer retains font rasterization and applies the window's DPI scaling.
    base_text(id, center - offset, color, font, size)
}

fn base_text(id: u32, position: Point, color: Color, font: Font, size: f32) -> Text {
    Text {
        content: id.to_string(),
        position,
        color,
        font,
        size: Pixels(size),
        align_x: alignment::Horizontal::Center.into(),
        align_y: alignment::Vertical::Center,
        ..Text::default()
    }
}

/// Use the same shaped outlines and exact curve extrema as Iced Text::draw_with.
pub(super) fn ink_bounds(text: &Text) -> Option<Rectangle> {
    let mut bounds = None;
    text.draw_with(|path, _| extend_ink_bounds(&mut bounds, &path));
    bounds
}

fn extend_ink_bounds(bounds: &mut Option<Rectangle>, path: &Path) {
    use truce_iced::iced::widget::canvas::path::lyon_path::{
        Event,
        geom::{CubicBezierSegment, QuadraticBezierSegment},
        math::Box2D,
    };
    for event in path.raw().iter() {
        let ink = match event {
            Event::Begin { at } => Box2D::new(at, at),
            Event::Line { from, to } => Box2D::from_points([from, to]),
            Event::Quadratic { from, ctrl, to } => {
                QuadraticBezierSegment { from, ctrl, to }.bounding_box()
            }
            Event::Cubic {
                from,
                ctrl1,
                ctrl2,
                to,
            } => CubicBezierSegment {
                from,
                ctrl1,
                ctrl2,
                to,
            }
            .bounding_box(),
            Event::End { .. } => continue,
        };
        let ink = Rectangle::new(
            Point::new(ink.min.x, ink.min.y),
            Size::new(ink.max.x - ink.min.x, ink.max.y - ink.min.y),
        );
        *bounds = Some(bounds.map_or(ink, |current| current.union(&ink)));
    }
}
