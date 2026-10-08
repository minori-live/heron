//! Shared coordinate rules for EQ gestures and drawing.

use truce_iced::iced::{Point, Rectangle, Size};

pub const MIN_HZ: f32 = 10.0;
pub const MAX_HZ: f32 = 30_000.0;
pub const TOP_GUTTER: f32 = 32.0;

#[derive(Debug, Clone, Copy)]
pub struct Plot {
    pub bounds: Rectangle,
    pub range_db: f32,
}

impl Plot {
    pub fn new(size: Size, range_db: f32) -> Self {
        Self {
            bounds: Rectangle {
                x: 42.0,
                y: TOP_GUTTER,
                width: (size.width - 70.0).max(1.0),
                height: (size.height - TOP_GUTTER - 32.0).max(1.0),
            },
            range_db,
        }
    }

    pub fn frequency_x(self, frequency: f32) -> f32 {
        self.bounds.x
            + ((frequency.clamp(MIN_HZ, MAX_HZ) / MIN_HZ).ln() / (MAX_HZ / MIN_HZ).ln())
                * self.bounds.width
    }

    pub fn x_frequency(self, x: f32) -> f32 {
        let position = ((x - self.bounds.x) / self.bounds.width).clamp(0.0, 1.0);
        MIN_HZ * (MAX_HZ / MIN_HZ).powf(position)
    }

    pub fn gain_y(self, gain: f32) -> f32 {
        self.bounds.y + (0.5 - gain / (2.0 * self.range_db)) * self.bounds.height
    }

    pub fn y_gain(self, y: f32) -> f32 {
        ((0.5 - (y - self.bounds.y) / self.bounds.height) * 2.0 * self.range_db).clamp(-30.0, 30.0)
    }

    pub fn spectrum_y(self, db: f32, floor_db: f32) -> f32 {
        self.bounds.y + (1.0 - ((db - floor_db) / -floor_db).clamp(0.0, 1.0)) * self.bounds.height
    }

    pub fn node(self, frequency: f32, gain: f32) -> Point {
        Point::new(self.frequency_x(frequency), self.gain_y(gain))
    }

    pub fn visible_node(self, frequency: f32, gain: f32) -> Point {
        let point = self.node(frequency, gain);
        Point::new(
            point.x,
            point
                .y
                .clamp(self.bounds.y, self.bounds.y + self.bounds.height),
        )
    }

    pub fn contains(self, point: Point) -> bool {
        self.bounds.contains(point)
    }
}

pub fn selection_rectangle(start: Point, end: Point) -> Rectangle {
    Rectangle {
        x: start.x.min(end.x),
        y: start.y.min(end.y),
        width: (start.x - end.x).abs(),
        height: (start.y - end.y).abs(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dragging_to_edges_clamps_to_supported_frequency_and_gain() {
        let plot = Plot::new(Size::new(1000.0, 500.0), 30.0);
        assert!((plot.x_frequency(-200.0) - MIN_HZ).abs() < 0.001);
        assert!((plot.x_frequency(2000.0) - MAX_HZ).abs() < 0.01);
        assert!((plot.y_gain(-200.0) - 30.0).abs() < 0.001);
        assert!((plot.y_gain(2000.0) + 30.0).abs() < 0.001);
        for frequency in [20.0, 50.0, 1000.0, 20_000.0] {
            assert!(
                (plot.x_frequency(plot.frequency_x(frequency)) / frequency - 1.0).abs() < 0.0001
            );
        }
    }

    #[test]
    fn gain_unit_has_an_independent_top_gutter_above_gain_labels_and_curves() {
        let plot = Plot::new(Size::new(1040.0, 616.0), 12.0);
        assert_eq!(plot.gain_y(12.0), TOP_GUTTER);
        assert!(6.0 + 16.0 < plot.gain_y(12.0) - 5.0);
        assert_eq!(plot.bounds.y + plot.bounds.height, 616.0 - 32.0);
    }

    #[test]
    fn rubber_band_selection_works_in_both_directions() {
        let rectangle = selection_rectangle(Point::new(300.0, 100.0), Point::new(100.0, 300.0));
        assert!(rectangle.contains(Point::new(200.0, 200.0)));
        assert!(!rectangle.contains(Point::new(80.0, 200.0)));
    }
}
