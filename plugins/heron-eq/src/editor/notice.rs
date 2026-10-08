//! One dismissible operation notice, independent of parameter controls/menus.
use super::{
    EqMessage,
    icons::{self, Icon},
    style,
};
use core::{
    Clipboard, Rectangle, Shell, Size, Vector, Widget,
    layout::{self, Layout},
    mouse, overlay, renderer,
    widget::{Operation, Tree, tree},
};
use truce_iced::{
    Message,
    iced::{
        Alignment, Element, Event, Length, Renderer, Theme, keyboard,
        widget::{Row, container, core, text},
    },
};

pub(super) struct Notice {
    pub text: String,
    pub error: bool,
}

pub(super) fn view(notice: &Notice) -> Element<'_, Message<EqMessage>> {
    let colors = style::palette();
    container(
        Row::new()
            .push(
                text(&notice.text)
                    .size(12)
                    .color(if notice.error {
                        colors.danger
                    } else {
                        colors.text
                    })
                    .width(Length::Fill),
            )
            .push(icons::button(
                Icon::Close,
                "Dismiss notification · Esc",
                EqMessage::DismissNotice,
                false,
            ))
            .spacing(12)
            .align_y(Alignment::Center),
    )
    .id("heron-eq-notice")
    .width(Length::Fixed(490.0))
    .padding(10)
    .style(style::panel)
    .into()
}

/// Dismiss before a focused input or active canvas can consume Escape. The
/// wrapped tree stays identical when the notice appears or disappears.
pub(super) fn intercept_escape<'a>(
    content: Element<'a, Message<EqMessage>>,
) -> Element<'a, Message<EqMessage>> {
    Element::new(EscapeFirst { content })
}

fn dismiss_escape(event: &Event, shell: &mut Shell<'_, Message<EqMessage>>) -> bool {
    if matches!(
        event,
        Event::Keyboard(keyboard::Event::KeyPressed {
            key: keyboard::Key::Named(keyboard::key::Named::Escape),
            ..
        })
    ) {
        shell.publish(Message::Plugin(EqMessage::DismissNotice));
        shell.capture_event();
        true
    } else {
        false
    }
}

struct EscapeFirst<'a> {
    content: Element<'a, Message<EqMessage>>,
}

impl Widget<Message<EqMessage>, Theme, Renderer> for EscapeFirst<'_> {
    fn tag(&self) -> tree::Tag {
        self.content.as_widget().tag()
    }

    fn state(&self) -> tree::State {
        self.content.as_widget().state()
    }

    fn children(&self) -> Vec<Tree> {
        self.content.as_widget().children()
    }

    fn diff(&self, tree: &mut Tree) {
        self.content.as_widget().diff(tree);
    }

    fn size(&self) -> Size<Length> {
        self.content.as_widget().size()
    }

    fn size_hint(&self) -> Size<Length> {
        self.content.as_widget().size_hint()
    }

    fn layout(
        &mut self,
        tree: &mut Tree,
        renderer: &Renderer,
        limits: &layout::Limits,
    ) -> layout::Node {
        self.content.as_widget_mut().layout(tree, renderer, limits)
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
        self.content
            .as_widget()
            .draw(tree, renderer, theme, style, layout, cursor, viewport);
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
            .operate(tree, layout, renderer, operation);
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
        if dismiss_escape(event, shell) {
            return;
        }
        self.content.as_widget_mut().update(
            tree, event, layout, cursor, renderer, clipboard, shell, viewport,
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
        self.content
            .as_widget()
            .mouse_interaction(tree, layout, cursor, viewport, renderer)
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
            .overlay(tree, layout, renderer, viewport, translation)
            .map(intercept_overlay)
    }
}

// The native runtime updates overlays before the base widget. Intercept their
// nested layers too, so focused popup fields obey the same dismissal priority.
fn intercept_overlay<'a>(
    content: overlay::Element<'a, Message<EqMessage>, Theme, Renderer>,
) -> overlay::Element<'a, Message<EqMessage>, Theme, Renderer> {
    overlay::Element::new(Box::new(EscapeOverlay { content }))
}

struct EscapeOverlay<'a> {
    content: overlay::Element<'a, Message<EqMessage>, Theme, Renderer>,
}

impl core::Overlay<Message<EqMessage>, Theme, Renderer> for EscapeOverlay<'_> {
    fn layout(&mut self, renderer: &Renderer, bounds: Size) -> layout::Node {
        self.content.as_overlay_mut().layout(renderer, bounds)
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
        if dismiss_escape(event, shell) {
            return;
        }
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
            .map(intercept_overlay)
    }

    fn index(&self) -> f32 {
        self.content.as_overlay().index()
    }
}
