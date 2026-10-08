//! The selected-band surface stays at lower center, independent of its values.
use super::{Panel, band_controls, chrome, geometry::Plot};
use truce_iced::iced::{Point, Rectangle, Size, Vector};

fn graph_bounds(original: Rectangle, viewport: Rectangle) -> Rectangle {
    Rectangle {
        x: original.x,
        y: original.y,
        width: viewport.width,
        height: (viewport.y + viewport.height - original.y - chrome::BOTTOM_HEIGHT).max(1.0),
    }
}

fn control_bounds(graph: Rectangle) -> Rectangle {
    Rectangle {
        height: (graph.height - 32.0).max(1.0),
        ..graph
    }
}

fn clamp_panel(point: Point, panel: Rectangle, graph: Rectangle) -> Vector {
    let margin = 10.0;
    let x = point.x.clamp(
        graph.x + margin,
        (graph.x + graph.width - panel.width - margin).max(graph.x + margin),
    );
    let y = point.y.clamp(
        graph.y + margin,
        (graph.y + graph.height - panel.height - margin).max(graph.y + margin),
    );
    Vector::new(x - panel.x, y - panel.y)
}

pub fn band_menu(original: Rectangle, viewport: Rectangle) -> Vector {
    let controls = control_bounds(graph_bounds(original, viewport));
    // Separate menu children preserve both the HUD position and its widget tree.
    let hud_top = controls.y + controls.height - band_controls::HEIGHT - 10.0;
    clamp_panel(
        Point::new(
            controls.center_x() - original.width / 2.0,
            hud_top - original.height - 12.0,
        ),
        original,
        controls,
    )
}

pub fn menu(
    original: Rectangle,
    viewport: Rectangle,
    panel: Panel,
    context: Option<Point>,
) -> Vector {
    let graph = graph_bounds(original, viewport);
    let point = context.unwrap_or_else(|| {
        let x = match panel {
            Panel::Processing => graph.x + 45.0,
            Panel::Analyzer => graph.x + (graph.width - original.width) * 0.58,
            _ => graph.x + graph.width - original.width - 14.0,
        };
        let y = if matches!(panel, Panel::Tools) {
            graph.y + 12.0
        } else {
            graph.y + graph.height - original.height - 12.0
        };
        Point::new(x, y)
    });
    let plot = Plot::new(Size::new(graph.width, graph.height), 12.0).bounds;
    clamp_panel(
        point,
        original,
        Rectangle::new(Point::new(graph.x + plot.x, graph.y + plot.y), plot.size()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floating_band_menus_stay_above_normal_selected_controls() {
        for (width, height) in [(1120.0, 760.0), (1040.0, 700.0)] {
            let viewport = Rectangle::new(Point::ORIGIN, Size::new(width, height));
            let original = Rectangle::new(
                Point::new(0.0, chrome::TOP_HEIGHT),
                Size::new(band_controls::WIDTH, band_controls::HEIGHT),
            );
            let hud_top = height - chrome::BOTTOM_HEIGHT - 42.0 - band_controls::HEIGHT;
            let popup = Rectangle::new(original.position(), Size::new(444.0, 276.0));
            let menu_offset = band_menu(popup, viewport);
            assert!(popup.y + menu_offset.y + popup.height + 12.0 <= hud_top);
            let offset = menu(
                popup,
                viewport,
                Panel::BandActions,
                Some(Point::new(width - 1.0, height - 1.0)),
            );
            assert!(popup.y + offset.y + popup.height <= height - chrome::BOTTOM_HEIGHT - 42.0);
            assert!(popup.x + offset.x + popup.width <= width - 38.0);
        }
    }
}
