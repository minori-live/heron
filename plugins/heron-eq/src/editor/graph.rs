//! Interactive EQ plot. All response lines use the same evaluator as audio processing.

use std::{collections::BTreeSet, sync::Arc, time::Instant};

use heron_dsp_core::eq::{EqChannel, EqConfig};
use truce_iced::{
    Message,
    iced::{
        Color, Font, Pixels, Point, Rectangle, Renderer, Theme, alignment, keyboard, mouse,
        widget::canvas::{self, Event, Frame, Geometry, Path, Stroke, Text},
    },
};

use super::{
    EqMessage,
    geometry::{Plot, selection_rectangle},
    style::{self, band_color},
};
use crate::response::ResponseSnapshot;
use crate::telemetry::SpectrumSnapshot;

#[path = "graph_events.rs"]
mod events;
#[path = "graph_paint.rs"]
mod paint;
#[path = "graph_response.rs"]
mod response;
#[cfg(test)]
#[path = "graph_tests.rs"]
mod tests;

#[derive(Debug, Clone)]
pub enum GraphMessage {
    BeginDrag {
        id: u32,
        additive: bool,
        solo: bool,
    },
    Drag {
        frequency_ratio: f64,
        gain_delta: f64,
    },
    End,
    Add {
        frequency: f64,
        gain: f64,
    },
    Deselect,
    ContextMenu {
        id: u32,
        /// Logical window coordinates, including the canvas layout offset.
        position: Point,
    },
    ToggleEnabled(u32),
    Cancel,
    Q {
        id: u32,
        delta: f64,
    },
    SelectArea {
        ids: Vec<u32>,
        additive: bool,
    },
    Grab(f64),
}

#[derive(Debug, Default)]
pub struct GraphState {
    restore_revision: u64,
    drag: Option<Drag>,
    rectangle: Option<Point>,
    press: Option<Press>,
    position: Option<Point>,
    modifiers: keyboard::Modifiers,
    last_click: Option<(Instant, Point)>,
}

#[derive(Debug)]
struct Drag {
    start: Point,
    frequency: f64,
}

#[derive(Debug, Clone, Copy)]
enum Press {
    Background {
        start: Point,
        additive: bool,
    },
    Band {
        id: u32,
        start: Point,
        frequency: f64,
        additive: bool,
        solo: bool,
    },
}

pub struct Graph {
    pub restore_revision: u64,
    pub config: EqConfig,
    pub response_config: EqConfig,
    pub show_total_response: bool,
    pub output_pan_matrix: [[f64; 2]; 2],
    pub prepared: Option<Arc<ResponseSnapshot>>,
    pub selected: BTreeSet<u32>,
    pub spectrum: SpectrumSnapshot,
    pub pre: bool,
    pub post: bool,
    pub external: bool,
    pub range_db: f32,
    pub floor_db: f32,
    pub snap: bool,
    pub font: Font,
    pub channel: EqChannel,
    pub collisions: Vec<bool>,
}

impl Graph {
    fn hit(&self, plot: Plot, point: Point) -> Option<&heron_dsp_core::eq::EqBand> {
        self.config.bands.iter().rev().find(|band| {
            let distance = plot.visible_node(band.frequency_hz as f32, band.gain_db as f32) - point;
            distance.x.mul_add(distance.x, distance.y * distance.y) <= 144.0
        })
    }
}

impl canvas::Program<Message<EqMessage>> for Graph {
    type State = GraphState;

    fn draw(
        &self,
        state: &GraphState,
        renderer: &Renderer,
        _theme: &Theme,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> Vec<Geometry> {
        self.paint(state, renderer, bounds, cursor)
    }
    fn update(
        &self,
        state: &mut GraphState,
        event: &Event,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> Option<canvas::Action<Message<EqMessage>>> {
        self.on_event(state, event, bounds, cursor)
    }

    fn mouse_interaction(
        &self,
        state: &GraphState,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> mouse::Interaction {
        self.interaction(state, bounds, cursor)
    }
}

pub fn snap_frequency(frequency: f64, enabled: bool) -> f64 {
    if enabled {
        440.0 * 2.0_f64.powf((12.0 * (frequency / 440.0).log2()).round() / 12.0)
    } else {
        frequency
    }
}
