//! Same retained native UI across live resize transitions, with real hit events.

use super::*;
use iced_runtime::user_interface::{Cache, UserInterface};
use truce_iced::iced::widget::core;

#[path = "resize_pixels.rs"]
mod pixels;

#[derive(Default)]
struct HitBounds {
    controls: ControlsBounds,
    buttons: Vec<Rectangle>,
    popup: Option<Rectangle>,
    popup_close: Option<Rectangle>,
}

impl Operation for HitBounds {
    fn traverse(&mut self, operate: &mut dyn FnMut(&mut dyn Operation)) {
        operate(self);
    }

    fn container(&mut self, id: Option<&Id>, bounds: Rectangle) {
        self.controls.container(id, bounds);
        if bounds.width == 444.0 && bounds.height > 100.0 {
            self.popup = Some(bounds);
        }
        if bounds.size() != Size::new(28.0, 28.0) {
            return;
        }
        if self
            .controls
            .hud
            .is_some_and(|hud| hud.contains(bounds.center()))
            && !self.buttons.contains(&bounds)
        {
            // Tooltip and its Button both expose the same hit rectangle through
            // operate(); keep one physical target for each action in the HUD.
            self.buttons.push(bounds);
        } else if self.popup_close.is_none()
            && self
                .popup
                .is_some_and(|popup| popup.contains(bounds.center()))
        {
            self.popup_close = Some(bounds);
        }
    }
}

struct Frames<'a> {
    source: &'a Harness,
    ui: EqUi,
    params: ParamCache<EqParams>,
    cache: Cache,
    renderer: &'a mut Renderer,
    size: Size,
    previous_size: Option<Size>,
}

impl Frames<'_> {
    fn frame(
        &mut self,
        label: &str,
        event: impl FnOnce(&HitBounds) -> (Point, Vec<Event>),
    ) -> Vec<EqMessage> {
        let cache = std::mem::replace(&mut self.cache, Cache::new());
        let mut messages = Vec::new();
        let (bounds, pointer, painted, pixel_bounds) = {
            let mut frame = UserInterface::build(
                self.ui.view_editor(&self.params),
                self.size,
                cache,
                self.renderer,
            );
            let mut bounds = HitBounds::default();
            frame.operate(self.renderer, &mut bounds);
            let hud = bounds.controls.hud.expect("selected HUD survives resizing");
            assert_eq!(hud.center_x(), self.size.width * 0.5);
            assert_eq!(
                hud.y + hud.height,
                self.size.height - chrome::BOTTOM_HEIGHT - 42.0
            );
            let (pointer, mut events) = event(&bounds);
            if self.previous_size != Some(self.size) {
                events.insert(
                    0,
                    Event::Window(truce_iced::iced::window::Event::Resized(self.size)),
                );
            }
            events.push(Event::Window(
                truce_iced::iced::window::Event::RedrawRequested(std::time::Instant::now()),
            ));
            frame.update(
                &events,
                mouse::Cursor::Available(pointer),
                self.renderer,
                &mut core::clipboard::Null,
                &mut messages,
            );
            knobs::reset_paint_trace();
            frame.draw(
                self.renderer,
                &self.ui.theme(),
                &core::renderer::Style {
                    text_color: style::palette().text,
                },
                mouse::Cursor::Available(pointer),
            );
            let painted = knobs::painted_controls();
            assert_eq!(painted, 7, "all selected controls paint after resize");
            let pixel_bounds =
                if matches!(label, "resized-band-power-click" | "resized-popup-close") {
                    Some(pixels::verify(
                        self.renderer,
                        self.size,
                        label,
                        hud,
                        *bounds.buttons.first().expect("drawn band power button"),
                        self.ui.model.borrow().focused().unwrap().enabled,
                    ))
                } else {
                    None
                };
            self.cache = frame.into_cache();
            (bounds, pointer, painted, pixel_bounds)
        };
        self.previous_size = Some(self.size);
        let intents: Vec<_> = messages
            .into_iter()
            .map(|message| {
                let Message::Plugin(intent) = message else {
                    panic!("unexpected native resize intent")
                };
                intent
            })
            .collect();
        let hud = bounds.controls.hud.unwrap();
        screenshot::record_resize_frame(serde_json::json!({
            "window": [self.size.width, self.size.height],
            "event": label,
            "pointer": [pointer.x, pointer.y],
            "hud_bounds": [hud.x, hud.y, hud.width, hud.height],
            "power_bounds": bounds.buttons.first().map(|button|
                [button.x, button.y, button.width, button.height]),
            "hud_button_bounds": bounds.buttons.iter().map(|button|
                [button.x, button.y, button.width, button.height]).collect::<Vec<_>>(),
            "painted_controls_mask": painted,
            "gpu_pixel_bounds": pixel_bounds,
            "intents": intents.iter().map(|intent| format!("{intent:?}")).collect::<Vec<_>>(),
            "source": "same retained UserInterface cache, resize then native pointer update/draw",
        }));
        for intent in &intents {
            dispatch(&mut self.ui, self.source, intent.clone());
        }
        intents
    }

    fn close_popup(&mut self) {
        let size = self.size;
        let intents = self.frame("resized-popup-close", |bounds| {
            let popup = bounds.popup.expect("open popup retains its widget state");
            let close = bounds
                .popup_close
                .expect("actual popup close button bounds");
            // Float's children operate in their original layout coordinates.
            // The production placement translates both its draw and hit cursor.
            let pointer = close.center() + overlays::band_menu(popup, Rectangle::with_size(size));
            click(pointer)
        });
        assert!(matches!(intents.as_slice(), [EqMessage::DismissPanels]));
        assert!(self.ui.panel.is_none());
    }
}

fn click(pointer: Point) -> (Point, Vec<Event>) {
    (
        pointer,
        vec![
            Event::Mouse(mouse::Event::CursorMoved { position: pointer }),
            Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)),
            Event::Mouse(mouse::Event::ButtonReleased(mouse::Button::Left)),
        ],
    )
}

pub(super) fn verify_retained_resize(renderer: &mut Renderer) {
    use core::Renderer as _;

    let source = Harness::new();
    let mut ui = fit_ui(&source);
    dispatch(&mut ui, &source, EqMessage::Select(1));
    let mut frames = Frames {
        source: &source,
        ui,
        params: ParamCache::new(source.params.clone()),
        cache: Cache::new(),
        renderer,
        size: Size::new(1120.0, 760.0),
        previous_size: None,
    };
    let mut previous_power = None;
    for size in [
        Size::new(1120.0, 760.0),
        Size::new(1440.0, 980.0),
        Size::new(1040.0, 700.0),
    ] {
        frames.size = size;
        if frames.ui.panel.is_some() {
            frames.close_popup();
        }
        let enabled = frames.ui.model.borrow().focused().unwrap().enabled;
        let mut current_power = None;
        let intents = frames.frame("resized-band-power-click", |bounds| {
            let power = *bounds.buttons.first().expect("real band power button");
            current_power = Some(power);
            click(power.center())
        });
        assert!(matches!(intents.as_slice(), [EqMessage::BandEnabled(value)] if *value != enabled));
        assert_eq!(
            frames.ui.model.borrow().focused().unwrap().enabled,
            !enabled
        );
        assert_eq!(frames.ui.model.borrow().selected, BTreeSet::from([1]));
        if let Some(previous) = previous_power {
            assert_ne!(
                previous,
                current_power.unwrap(),
                "the clicked button genuinely moved"
            );
        }
        previous_power = current_power;

        let gain = frames.ui.model.borrow().focused().unwrap().gain_db;
        let mut origin = None;
        let intents = frames.frame("resized-gain-press", |bounds| {
            let pointer = bounds
                .controls
                .gain
                .expect("real resized gain rotary")
                .center();
            origin = Some(pointer);
            (
                pointer,
                vec![
                    Event::Mouse(mouse::Event::CursorMoved { position: pointer }),
                    Event::Mouse(mouse::Event::ButtonPressed(mouse::Button::Left)),
                ],
            )
        });
        assert!(matches!(
            intents.as_slice(),
            [EqMessage::KnobAt(
                _,
                knobs::KnobMessage::Begin(Number::Gain)
            )]
        ));
        let pointer = origin.unwrap() - Vector::new(0.0, 12.0);
        let intents = frames.frame("resized-gain-motion", |_| {
            (
                pointer,
                vec![Event::Mouse(mouse::Event::CursorMoved {
                    position: pointer,
                })],
            )
        });
        assert!(matches!(
            intents.as_slice(),
            [EqMessage::KnobAt(
                _,
                knobs::KnobMessage::Change(Number::Gain, _)
            )]
        ));
        assert!((frames.ui.model.borrow().focused().unwrap().gain_db - gain - 4.0).abs() < 1e-7);
        let intents = frames.frame("resized-gain-release", |_| {
            (
                pointer,
                vec![Event::Mouse(mouse::Event::ButtonReleased(
                    mouse::Button::Left,
                ))],
            )
        });
        assert!(matches!(
            intents.as_slice(),
            [EqMessage::KnobAt(_, knobs::KnobMessage::End)]
        ));
        assert!(!frames.ui.model.borrow().has_gesture());
        assert!(frames.ui.edited.is_empty());

        let mut options_bounds = None;
        let intents = frames.frame("resized-band-options-click", |bounds| {
            let target = *bounds.buttons.get(2).expect("real band options button");
            options_bounds = Some(target);
            click(target.center())
        });
        assert!(
            matches!(intents.as_slice(), [EqMessage::Menu(Panel::BandActions)]),
            "the actual resized options button must open band actions at {size:?}: target={options_bounds:?}, actual={intents:?}"
        );
        assert_eq!(frames.ui.panel, Some(Panel::BandActions));
    }
    frames.close_popup();
    let events = source.events.lock().unwrap();
    for id in [crate::params::BAND_BASE + 1, crate::params::BAND_BASE + 4] {
        for kind in ['b', 'e'] {
            assert_eq!(
                events
                    .iter()
                    .filter(|(event, param)| *event == kind && *param == id)
                    .count(),
                3,
                "one balanced host gesture per resized control interaction"
            );
        }
    }
    frames
        .renderer
        .reset(Rectangle::with_size(Size::new(1120.0, 760.0)));
}
