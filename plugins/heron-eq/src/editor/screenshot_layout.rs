//! Inspect the actual editor's laid-out widgets without rebuilding its composition.

use std::sync::Mutex;

use super::*;
use core::{
    Clipboard, Rectangle, Shell, Size, Vector, Widget,
    layout::{self, Layout},
    mouse, overlay, renderer,
    widget::{Id, Operation, Tree},
};
use truce_iced::iced::{Renderer, Theme, widget::core};

#[derive(Clone, serde::Serialize)]
pub(super) struct EditorBounds {
    window_width: f32,
    window_height: f32,
    top: [f32; 4],
    graph: [f32; 4],
    footer: [f32; 4],
}

static MEASUREMENTS: Mutex<Vec<EditorBounds>> = Mutex::new(Vec::new());

pub(super) fn reset() {
    MEASUREMENTS.lock().expect("layout measurements").clear();
}

pub(super) fn measurements() -> Vec<EditorBounds> {
    MEASUREMENTS.lock().expect("layout measurements").clone()
}

pub(super) fn checked<'a>(
    content: Element<'a, Message<EqMessage>>,
) -> Element<'a, Message<EqMessage>> {
    Element::new(LayoutChecked {
        content,
        probe_drag: Cell::new(false),
    })
}

pub(super) fn checked_with_drag<'a>(
    content: Element<'a, Message<EqMessage>>,
) -> Element<'a, Message<EqMessage>> {
    Element::new(LayoutChecked {
        content,
        probe_drag: Cell::new(true),
    })
}

struct LayoutChecked<'a> {
    content: Element<'a, Message<EqMessage>>,
    probe_drag: Cell<bool>,
}

#[derive(Default)]
struct BoundsOperation {
    top: Option<Rectangle>,
    graph: Option<Rectangle>,
    footer: Option<Rectangle>,
}

impl Operation for BoundsOperation {
    fn traverse(&mut self, operate: &mut dyn FnMut(&mut dyn Operation)) {
        operate(self);
    }

    fn container(&mut self, id: Option<&Id>, bounds: Rectangle) {
        if id == Some(&Id::new("heron-eq-topbar")) {
            self.top = Some(bounds);
        } else if id == Some(&Id::new("heron-eq-graph")) {
            self.graph = Some(bounds);
        } else if id == Some(&Id::new("heron-eq-footer")) {
            self.footer = Some(bounds);
        }
    }
}

impl BoundsOperation {
    fn verify(self, window: Size) {
        let top = self.top.expect("actual editor top bar bounds");
        let graph = self.graph.expect("actual editor graph bounds");
        let footer = self.footer.expect("actual editor footer bounds");
        let near = |actual: f32, expected: f32| (actual - expected).abs() < 0.5;
        assert!(top.height <= 44.5, "top bar consumed {} pixels", top.height);
        assert!(
            footer.height <= 40.5,
            "footer consumed {} pixels",
            footer.height
        );
        assert!(near(top.y, 0.0));
        assert!(near(top.height, 44.0));
        assert!(near(graph.y, 44.0));
        assert!(
            near(graph.height, window.height - 84.0),
            "graph height {} must retain the window between compact bars",
            graph.height
        );
        assert!(near(footer.y, window.height - 40.0));
        assert!(near(footer.height, 40.0));
        assert!(near(graph.width, window.width));
        assert!(near(top.width, window.width));
        assert!(near(footer.width, window.width));
        let rectangle = |bounds: Rectangle| [bounds.x, bounds.y, bounds.width, bounds.height];
        MEASUREMENTS
            .lock()
            .expect("layout measurements")
            .push(EditorBounds {
                window_width: window.width,
                window_height: window.height,
                top: rectangle(top),
                graph: rectangle(graph),
                footer: rectangle(footer),
            });
    }
}

impl Widget<Message<EqMessage>, Theme, Renderer> for LayoutChecked<'_> {
    fn size(&self) -> Size<Length> {
        self.content.as_widget().size()
    }

    fn size_hint(&self) -> Size<Length> {
        self.content.as_widget().size_hint()
    }

    fn children(&self) -> Vec<Tree> {
        vec![Tree::new(&self.content)]
    }

    fn diff(&self, tree: &mut Tree) {
        tree.diff_children(std::slice::from_ref(&self.content));
    }

    fn layout(
        &mut self,
        tree: &mut Tree,
        renderer: &Renderer,
        limits: &layout::Limits,
    ) -> layout::Node {
        let node = self
            .content
            .as_widget_mut()
            .layout(&mut tree.children[0], renderer, limits);
        let mut bounds = BoundsOperation::default();
        self.content.as_widget_mut().operate(
            &mut tree.children[0],
            Layout::new(&node),
            renderer,
            &mut bounds,
        );
        bounds.verify(node.size());
        // The upstream offscreen renderer sends no window events. Initialize the
        // normal first redraw so enabled controls are not drawn as Disabled.
        let mut messages = Vec::new();
        self.content.as_widget_mut().update(
            &mut tree.children[0],
            &redraw_event(),
            Layout::new(&node),
            mouse::Cursor::Unavailable,
            renderer,
            &mut core::clipboard::Null,
            &mut Shell::new(&mut messages),
            &Rectangle::new(core::Point::ORIGIN, node.size()),
        );
        assert!(
            messages.is_empty(),
            "initial redraw must not edit parameters"
        );
        node
    }

    fn draw(
        &self,
        tree: &Tree,
        renderer: &mut Renderer,
        theme: &Theme,
        style: &renderer::Style,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        viewport: &Rectangle,
    ) {
        if self.probe_drag.replace(false) {
            super::super::tests::verify_widget_drag(renderer, layout.bounds().size());
            super::NODE_LABELS
                .lock()
                .expect("node label measurements")
                .clear();
        }
        self.content.as_widget().draw(
            &tree.children[0],
            renderer,
            theme,
            style,
            layout,
            cursor,
            viewport,
        );
    }

    fn operate(
        &mut self,
        tree: &mut Tree,
        layout: Layout<'_>,
        renderer: &Renderer,
        operation: &mut dyn Operation,
    ) {
        self.content
            .as_widget_mut()
            .operate(&mut tree.children[0], layout, renderer, operation);
    }

    fn update(
        &mut self,
        tree: &mut Tree,
        event: &Event,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        renderer: &Renderer,
        clipboard: &mut dyn Clipboard,
        shell: &mut Shell<'_, Message<EqMessage>>,
        viewport: &Rectangle,
    ) {
        self.content.as_widget_mut().update(
            &mut tree.children[0],
            event,
            layout,
            cursor,
            renderer,
            clipboard,
            shell,
            viewport,
        );
    }

    fn mouse_interaction(
        &self,
        tree: &Tree,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        viewport: &Rectangle,
        renderer: &Renderer,
    ) -> mouse::Interaction {
        self.content.as_widget().mouse_interaction(
            &tree.children[0],
            layout,
            cursor,
            viewport,
            renderer,
        )
    }

    fn overlay<'a>(
        &'a mut self,
        tree: &'a mut Tree,
        layout: Layout<'a>,
        renderer: &Renderer,
        viewport: &Rectangle,
        translation: Vector,
    ) -> Option<overlay::Element<'a, Message<EqMessage>, Theme, Renderer>> {
        self.content
            .as_widget_mut()
            .overlay(
                &mut tree.children[0],
                layout,
                renderer,
                viewport,
                translation,
            )
            .map(initialized_overlay)
    }
}

fn redraw_event() -> Event {
    Event::Window(truce_iced::iced::window::Event::RedrawRequested(
        std::time::Instant::now(),
    ))
}

fn initialized_overlay<'a>(
    content: overlay::Element<'a, Message<EqMessage>, Theme, Renderer>,
) -> overlay::Element<'a, Message<EqMessage>, Theme, Renderer> {
    overlay::Element::new(Box::new(InitialOverlay { content }))
}

struct InitialOverlay<'a> {
    content: overlay::Element<'a, Message<EqMessage>, Theme, Renderer>,
}

impl core::Overlay<Message<EqMessage>, Theme, Renderer> for InitialOverlay<'_> {
    fn layout(&mut self, renderer: &Renderer, bounds: Size) -> layout::Node {
        let node = self.content.as_overlay_mut().layout(renderer, bounds);
        let mut messages = Vec::new();
        self.content.as_overlay_mut().update(
            &redraw_event(),
            Layout::new(&node),
            mouse::Cursor::Unavailable,
            renderer,
            &mut core::clipboard::Null,
            &mut Shell::new(&mut messages),
        );
        assert!(
            messages.is_empty(),
            "initial overlay redraw must not edit parameters"
        );
        node
    }

    fn draw(
        &self,
        renderer: &mut Renderer,
        theme: &Theme,
        style: &renderer::Style,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
    ) {
        self.content
            .as_overlay()
            .draw(renderer, theme, style, layout, cursor);
    }

    fn operate(&mut self, layout: Layout<'_>, renderer: &Renderer, operation: &mut dyn Operation) {
        self.content
            .as_overlay_mut()
            .operate(layout, renderer, operation);
    }

    fn update(
        &mut self,
        event: &Event,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        renderer: &Renderer,
        clipboard: &mut dyn Clipboard,
        shell: &mut Shell<'_, Message<EqMessage>>,
    ) {
        self.content
            .as_overlay_mut()
            .update(event, layout, cursor, renderer, clipboard, shell);
    }

    fn mouse_interaction(
        &self,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        renderer: &Renderer,
    ) -> mouse::Interaction {
        self.content
            .as_overlay()
            .mouse_interaction(layout, cursor, renderer)
    }

    fn overlay<'a>(
        &'a mut self,
        layout: Layout<'a>,
        renderer: &Renderer,
    ) -> Option<overlay::Element<'a, Message<EqMessage>, Theme, Renderer>> {
        self.content
            .as_overlay_mut()
            .overlay(layout, renderer)
            .map(initialized_overlay)
    }

    fn index(&self) -> f32 {
        self.content.as_overlay().index()
    }
}
