use super::*;
use truce_iced::iced::{
    Padding,
    widget::{Stack, float, opaque},
};

impl EqUi {
    pub(super) fn view_editor<'a>(
        &'a self,
        params: &'a ParamCache<EqParams>,
    ) -> Element<'a, Message<EqMessage>> {
        self.observe_state_restore();
        let active = self.active_params();
        let mut model = self.model.borrow_mut();
        if self
            .expected
            .borrow()
            .iter()
            .all(|(id, value)| (active.get_normalized(*id).unwrap_or(0.0) - value).abs() < 1.0e-9)
        {
            self.expected.borrow_mut().clear();
            model.synchronize(active.snapshot());
            model.synchronize_extras(read_extras(&active));
        }
        let live = active.telemetry.spectrum();
        self.last_sequence.set(active.telemetry.sequence());
        let mut spectrum = self
            .frozen_display
            .clone()
            .unwrap_or_else(|| active.telemetry.display_spectrum());
        let projection = self.response_preview.borrow_mut().project(
            &model.config,
            model.extras,
            active.telemetry.sample_rate(),
            live.auto_gain_db,
            model.solo.is_some(),
            active.telemetry.stereo_output(),
        );
        self.last_preview_revision.set(projection.revision);
        spectrum.sample_rate = projection.sample_rate;
        let collisions = if self.collision {
            matching::collisions(&live, &live.external_db)
        } else {
            Vec::new()
        };
        let graph = Canvas::new(Graph {
            restore_revision: self.last_restore_revision.get(),
            config: model.config.clone(),
            response_config: projection.config,
            show_total_response: projection.show_total_response,
            output_pan_matrix: projection.pan,
            prepared: projection.prepared,
            selected: model.selected.clone(),
            spectrum,
            pre: self.pre,
            post: self.post,
            external: self.external,
            range_db: f32::from(self.range),
            floor_db: -f32::from(self.floor),
            snap: self.piano,
            font: params.font(),
            channel: self.channel,
            collisions,
        })
        .width(Length::Fill)
        .height(Length::Fill);
        let mut plot = Stack::new()
            .push(graph)
            .width(Length::Fill)
            .height(Length::Fill);
        // Keep the HUD in the base tree: Iced clears runtime overlays after a
        // captured graph event, so a Float would disappear on each drag frame.
        // Its layout and pointer origin must also stay fixed during rotary edits.
        if model.focused().is_some() {
            plot = plot.push(
                container(opaque(controls::inspector(self, &model)))
                    .center_x(Length::Fill)
                    .align_bottom(Length::Fill)
                    .padding(Padding {
                        bottom: 42.0,
                        ..Padding::ZERO
                    }),
            );
        }
        if let Some(panel) = self.panel_for_view() {
            let context = self.context_menu;
            plot = plot.push(
                float(popovers::view(
                    self,
                    &model,
                    panel,
                    projection.pending,
                    projection.failed,
                ))
                .translate(move |bounds, viewport| {
                    if matches!(panel, Panel::BandActions | Panel::Midi) && context.is_none() {
                        overlays::band_menu(bounds, viewport)
                    } else {
                        overlays::menu(bounds, viewport, panel, context)
                    }
                }),
            );
        }
        if let Some(notice) = &self.notice {
            plot = plot.push(
                container(opaque(notice::view(notice)))
                    .center_x(Length::Fill)
                    .align_top(Length::Fill)
                    .padding(Padding {
                        top: 8.0,
                        ..Padding::ZERO
                    }),
            );
        }
        let content = Column::new()
            .push(chrome::top(self))
            .push(
                container(plot)
                    .id("heron-eq-graph")
                    .width(Length::Fill)
                    .height(Length::Fill),
            )
            .push(chrome::bottom(
                self,
                &model,
                live.output_peak,
                active.telemetry.processing_pending() || projection.pending,
                active.telemetry.processing_error().is_some() || projection.failed,
            ));
        let colors = style::palette();
        let content = container(content)
            .width(Length::Fill)
            .height(Length::Fill)
            .style(move |_| container::Style {
                background: Some(colors.canvas.into()),
                text_color: Some(colors.text),
                ..Default::default()
            })
            .into();
        if self.notice.is_some() {
            notice::intercept_escape(content)
        } else {
            content
        }
    }
}
