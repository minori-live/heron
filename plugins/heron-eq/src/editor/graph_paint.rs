//! EQ plot rendering, spectra and hover feedback.

use super::super::node_labels;
use super::super::spectrum_plot::{self, Appearance};
use super::response::{response_path, total_db};
use super::*;

impl Graph {
    fn grid(&self, frame: &mut Frame, plot: Plot) {
        let colors = style::palette();
        frame.fill_rectangle(Point::ORIGIN, frame.size(), colors.canvas);
        for hz in [
            10.0, 20.0, 50.0, 100.0, 200.0, 500.0, 1000.0, 2000.0, 5000.0, 10_000.0, 20_000.0,
            30_000.0,
        ] {
            let x = plot.frequency_x(hz);
            frame.stroke(
                &Path::line(
                    Point::new(x, plot.bounds.y),
                    Point::new(x, plot.bounds.y + plot.bounds.height),
                ),
                Stroke::default().with_color(alpha(colors.border, 0.45)),
            );
            label(
                frame,
                if hz >= 1000.0 {
                    format!("{}k", hz / 1000.0)
                } else {
                    format!("{hz:.0}")
                },
                Point::new(x, plot.bounds.y + plot.bounds.height + 8.0),
                colors.text_subtle,
                self.font,
                alignment::Horizontal::Center,
            );
        }
        for multiplier in [-1.0, -0.5, 0.0, 0.5, 1.0] {
            let db = self.range_db * multiplier;
            let y = plot.gain_y(db);
            frame.stroke(
                &Path::line(
                    Point::new(plot.bounds.x, y),
                    Point::new(plot.bounds.x + plot.bounds.width, y),
                ),
                Stroke::default().with_color(if multiplier == 0.0 {
                    colors.border_strong
                } else {
                    alpha(colors.border, 0.45)
                }),
            );
            label(
                frame,
                format!("{db:+.0}"),
                Point::new(plot.bounds.x - 8.0, y - 5.0),
                colors.text_subtle,
                self.font,
                alignment::Horizontal::Right,
            );
        }
        label(
            frame,
            "dB".to_owned(),
            Point::new(8.0, 6.0),
            colors.text_subtle,
            self.font,
            alignment::Horizontal::Left,
        );
        frame.fill_text(Text {
            content: "dBFS".into(),
            position: Point::new(frame.size().width - 3.0, 2.0),
            size: Pixels(9.0),
            color: colors.text_subtle,
            font: self.font,
            align_x: alignment::Horizontal::Right.into(),
            ..Text::default()
        });
        for db in [-30.0, -60.0, -90.0, -120.0, -150.0] {
            if db < self.floor_db {
                continue;
            }
            let y = plot.spectrum_y(db, self.floor_db);
            frame.stroke(
                &Path::line(
                    Point::new(plot.bounds.x + plot.bounds.width, y),
                    Point::new(plot.bounds.x + plot.bounds.width + 4.0, y),
                ),
                Stroke::default().with_color(alpha(colors.border_strong, 0.6)),
            );
            frame.fill_text(Text {
                content: format!("{db:.0}"),
                position: Point::new(frame.size().width - 3.0, y - 5.0),
                size: Pixels(10.0),
                color: colors.text_subtle,
                font: self.font,
                align_x: alignment::Horizontal::Right.into(),
                ..Text::default()
            });
        }
    }

    fn spectrum(&self, frame: &mut Frame, plot: Plot, values: &[f32], appearance: Appearance) {
        spectrum_plot::draw(
            frame,
            plot,
            &self.spectrum.frequency_hz,
            values,
            self.floor_db,
            appearance,
        );
    }

    fn spectrum_legend(&self, frame: &mut Frame, plot: Plot) {
        let colors = style::palette();
        let mut x = plot.bounds.x + 12.0;
        let y = plot.bounds.y + 20.0;
        for (visible, name, color) in [
            (self.pre, "Pre", style::spectrum_pre()),
            (self.post, "Post", style::spectrum_post()),
            (self.external, "Ext", colors.midi),
            (self.show_total_response, "EQ", colors.action),
        ] {
            if visible {
                frame.stroke(
                    &Path::line(Point::new(x, y), Point::new(x + 18.0, y)),
                    Stroke::default().with_color(color).with_width(1.5),
                );
                label(
                    frame,
                    name.into(),
                    Point::new(x + 24.0, y - 5.0),
                    color,
                    self.font,
                    alignment::Horizontal::Left,
                );
                x += 78.0;
            }
        }
    }

    fn responses(&self, frame: &mut Frame, plot: Plot) {
        let colors = style::palette();
        for band in &self.config.bands {
            if !band.enabled {
                continue;
            }
            let scaled = self
                .response_config
                .bands
                .iter()
                .find(|scaled| scaled.id == band.id)
                .unwrap_or(band);
            let line = response_path(plot, |frequency| {
                scaled.magnitude_db(self.spectrum.sample_rate, frequency)
            });
            let selected = self.selected.contains(&band.id);
            frame.stroke(
                &line,
                Stroke::default()
                    .with_color(alpha(
                        band_color(band.id.saturating_sub(1) as usize),
                        if selected { 0.75 } else { 0.28 },
                    ))
                    .with_width(if selected { 1.6 } else { 1.0 }),
            );
        }
        let response = |frequency| {
            total_db(
                &self.response_config,
                self.prepared.as_deref(),
                self.spectrum.sample_rate,
                frequency,
                self.channel,
                self.output_pan_matrix,
                self.show_total_response,
            )
        };
        let line = response(1000.0)
            .map(|_| response_path(plot, |frequency| response(frequency).unwrap_or(f64::NAN)));
        if let Some(line) = line {
            frame.stroke(
                &line,
                Stroke::default()
                    .with_color(if self.response_config.bypass {
                        colors.text_subtle
                    } else {
                        Color::from_rgb8(238, 226, 175)
                    })
                    .with_width(2.4),
            );
        }
        for band in &self.config.bands {
            let center = plot.visible_node(band.frequency_hz as f32, band.gain_db as f32);
            let color = band_color(band.id.saturating_sub(1) as usize);
            let selected = self.selected.contains(&band.id);
            if selected {
                frame.stroke(
                    &Path::circle(center, 12.0),
                    Stroke::default()
                        .with_color(alpha(color, 0.55))
                        .with_width(1.0),
                );
            }
            frame.fill(
                &Path::circle(center, 7.5),
                if band.enabled { color } else { colors.control },
            );
            frame.stroke(
                &Path::circle(center, 7.5),
                Stroke::default()
                    .with_color(if selected { colors.text } else { color })
                    .with_width(1.5),
            );
            let number = node_labels::text(
                band.id,
                center,
                if band.enabled {
                    colors.canvas
                } else {
                    colors.text_muted
                },
                self.font,
                11.0,
            );
            #[cfg(test)]
            super::super::screenshot::record_node_label(band.id, center, &number);
            frame.fill_text(number);
        }
    }

    pub(super) fn paint(
        &self,
        state: &GraphState,
        renderer: &Renderer,
        bounds: Rectangle,
        cursor: mouse::Cursor,
    ) -> Vec<Geometry> {
        let mut frame = Frame::new(renderer, bounds.size());
        let plot = Plot::new(bounds.size(), self.range_db);
        self.grid(&mut frame, plot);
        let colors = style::palette();
        if self.external {
            for (index, &collision) in self.collisions.iter().enumerate() {
                if !collision {
                    continue;
                }
                if let (Some(&frequency), Some(&next)) = (
                    self.spectrum.frequency_hz.get(index),
                    self.spectrum.frequency_hz.get(index + 1),
                ) {
                    let x = plot.frequency_x(frequency);
                    frame.fill_rectangle(
                        Point::new(x, plot.bounds.y),
                        truce_iced::iced::Size::new(
                            (plot.frequency_x(next) - x).max(1.0),
                            plot.bounds.height,
                        ),
                        alpha(colors.warning, 0.07),
                    );
                }
            }
        }
        if self.pre {
            self.spectrum(
                &mut frame,
                plot,
                &self.spectrum.pre_db,
                Appearance {
                    color: style::spectrum_pre(),
                    width: 0.9,
                    fill_alpha: 0.0,
                },
            );
        }
        if self.external {
            self.spectrum(
                &mut frame,
                plot,
                &self.spectrum.external_db,
                Appearance {
                    color: colors.midi,
                    width: 1.0,
                    fill_alpha: 0.025,
                },
            );
        }
        if self.post {
            self.spectrum(
                &mut frame,
                plot,
                &self.spectrum.post_db,
                Appearance {
                    color: style::spectrum_post(),
                    width: 1.35,
                    fill_alpha: 0.065,
                },
            );
        }
        self.responses(&mut frame, plot);
        self.spectrum_legend(&mut frame, plot);
        if let (Some(start), Some(end)) = (state.rectangle, state.position) {
            let rectangle = selection_rectangle(start, end);
            let path = Path::rectangle(rectangle.position(), rectangle.size());
            frame.fill(&path, alpha(colors.action, 0.12));
            frame.stroke(&path, Stroke::default().with_color(colors.focus));
        }
        if let Some(position) = cursor
            .position_in(bounds)
            .filter(|point| plot.contains(*point))
            && self.hit(plot, position).is_none()
        {
            frame.stroke(
                &Path::line(
                    Point::new(position.x, plot.bounds.y),
                    Point::new(position.x, plot.bounds.y + plot.bounds.height),
                ),
                Stroke::default().with_color(alpha(colors.focus, 0.3)),
            );
            label(
                &mut frame,
                format!("{:.0} Hz", plot.x_frequency(position.x)),
                Point::new(position.x, plot.bounds.y + 4.0),
                colors.text_muted,
                self.font,
                alignment::Horizontal::Center,
            );
        }
        if self.config.bands.is_empty() {
            label(
                &mut frame,
                "+  Double-click".to_owned(),
                Point::new(plot.bounds.center_x(), plot.bounds.center_y() + 32.0),
                colors.text_muted,
                self.font,
                alignment::Horizontal::Center,
            );
        }
        let maximum = self.spectrum.sample_rate * 0.499;
        if maximum < 30_000.0 {
            let x = plot.frequency_x(maximum as f32);
            frame.fill_rectangle(
                Point::new(x, plot.bounds.y),
                truce_iced::iced::Size::new(
                    (plot.bounds.x + plot.bounds.width - x).max(0.0),
                    plot.bounds.height,
                ),
                alpha(colors.surface, 0.5),
            );
        }
        if self.snap {
            piano(&mut frame, plot, self.font, bounds.height);
        }
        if let Some(position) = cursor
            .position_in(bounds)
            .filter(|point| plot.contains(*point))
            && let Some(band) = self.hit(plot, position)
        {
            self.tooltip(&mut frame, plot, position, band);
        }
        vec![frame.into_geometry()]
    }

    fn tooltip(
        &self,
        frame: &mut Frame,
        plot: Plot,
        pointer: Point,
        band: &heron_dsp_core::eq::EqBand,
    ) {
        let colors = style::palette();
        let width = 232.0_f32.min(plot.bounds.width);
        let left = (pointer.x - width * 0.5)
            .clamp(plot.bounds.x, plot.bounds.x + plot.bounds.width - width);
        let top = (pointer.y - 36.0).clamp(
            plot.bounds.y,
            plot.bounds.y + (plot.bounds.height - 26.0).max(0.0),
        );
        let position = Point::new(left, top);
        let panel = Path::rounded_rectangle(
            position,
            truce_iced::iced::Size::new(width, 26.0),
            4.0.into(),
        );
        frame.fill(&panel, colors.surface);
        frame.stroke(&panel, Stroke::default().with_color(colors.border_strong));
        label(
            frame,
            format!(
                "{:.0} Hz    {:+.1} dB    Q {:.2}",
                band.frequency_hz, band.gain_db, band.q
            ),
            Point::new(left + width * 0.5, top + 7.0),
            colors.text,
            self.font,
            alignment::Horizontal::Center,
        );
    }
}

fn label(
    frame: &mut Frame,
    content: String,
    position: Point,
    color: Color,
    font: Font,
    alignment: alignment::Horizontal,
) {
    frame.fill_text(Text {
        content,
        position,
        color,
        font,
        size: Pixels(11.0),
        align_x: alignment.into(),
        ..Text::default()
    });
}

fn alpha(mut color: Color, alpha: f32) -> Color {
    color.a = alpha;
    color
}

fn piano(frame: &mut Frame, plot: Plot, font: Font, height: f32) {
    let colors = style::palette();
    let y = height - 13.0;
    for note in 0..=127_u8 {
        let frequency = 440.0 * 2.0_f32.powf((f32::from(note) - 69.0) / 12.0);
        if !(10.0..=30_000.0).contains(&frequency) {
            continue;
        }
        let x = plot.frequency_x(frequency / 2.0_f32.powf(1.0 / 24.0));
        let end = plot.frequency_x(frequency * 2.0_f32.powf(1.0 / 24.0));
        let black = matches!(note % 12, 1 | 3 | 6 | 8 | 10);
        frame.fill_rectangle(
            Point::new(x, y),
            truce_iced::iced::Size::new((end - x - 0.5).max(0.5), 12.0),
            if black {
                colors.control
            } else {
                alpha(colors.text_muted, 0.35)
            },
        );
        if note % 12 == 0 {
            label(
                frame,
                format!("C{}", i16::from(note) / 12 - 1),
                Point::new((x + end) / 2.0, y - 11.0),
                colors.text_subtle,
                font,
                alignment::Horizontal::Center,
            );
        }
    }
}
