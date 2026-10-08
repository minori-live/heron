use super::*;

impl EqUi {
    fn graph(&mut self, message: GraphMessage) -> bool {
        let params = self.active_params();
        match message {
            GraphMessage::BeginDrag { id, additive, solo } => {
                self.dismiss_panels();
                let model = self.model.get_mut();
                model.select(id, additive && !model.selected.contains(&id));
                model.begin();
                self.transient_solo = solo;
                if solo {
                    model.solo = Some(id);
                    self.publish_solo(Some(id));
                }
                self.drafts.clear();
                true
            }
            GraphMessage::Drag {
                frequency_ratio,
                gain_delta,
            } => {
                self.model.get_mut().drag(frequency_ratio, gain_delta);
                let maximum = (params.telemetry.sample_rate() * 0.499).min(30_000.0);
                for band in &mut self.model.get_mut().config.bands {
                    band.frequency_hz = band.frequency_hz.min(maximum);
                }
                self.model.get_mut().has_gesture()
            }
            GraphMessage::End => {
                let model = self.model.get_mut();
                model.end();
                if self.transient_solo {
                    model.solo = None;
                    self.publish_solo(None);
                    self.transient_solo = false;
                }
                false
            }
            GraphMessage::Add { frequency, gain } => {
                let mut added = None;
                self.change(|model| {
                    added = model.add(frequency, gain);
                });
                if added.is_none() {
                    self.notify("The 24-band limit has been reached.", true);
                }
                false
            }
            GraphMessage::Q { id, delta } => {
                self.change(|model| model.wheel_q(id, delta));
                false
            }
            GraphMessage::SelectArea { ids, additive } => {
                self.dismiss_panels();
                let model = self.model.get_mut();
                if !additive {
                    model.selected.clear();
                }
                model.selected.extend(ids);
                self.drafts.clear();
                false
            }
            GraphMessage::Grab(frequency) => {
                let spectrum = self
                    .frozen
                    .clone()
                    .unwrap_or_else(|| params.telemetry.spectrum());
                if let Some(peak) = matching::nearest_peak(&spectrum, frequency) {
                    self.change(|model| {
                        model.add(peak, 0.0);
                    });
                } else {
                    self.notify(
                        "Play audio or freeze a spectrum before grabbing a peak.",
                        true,
                    );
                }
                false
            }
            GraphMessage::Deselect => {
                self.model.get_mut().end();
                self.model.get_mut().solo = None;
                self.publish_solo(None);
                self.transient_solo = false;
                self.dismiss_panels();
                self.model.get_mut().selected.clear();
                self.drafts.clear();
                false
            }
            GraphMessage::ContextMenu { id, position } => {
                self.cancel_gesture();
                self.model.get_mut().select(id, false);
                self.dismiss_panels();
                self.panel = Some(Panel::BandActions);
                self.context_menu = Some(position);
                false
            }
            GraphMessage::ToggleEnabled(id) => {
                self.change(|model| {
                    if let Some(band) = model.config.bands.iter_mut().find(|band| band.id == id) {
                        band.enabled = !band.enabled;
                    }
                });
                false
            }
            GraphMessage::Cancel => {
                self.cancel_gesture();
                false
            }
        }
    }

    fn key(&mut self, event: keyboard::Event, context: &PluginContext<EqParams>) {
        let keyboard::Event::KeyPressed { key, modifiers, .. } = event else {
            return;
        };
        if self.numeric_edit.is_some() && key != keyboard::Key::Named(keyboard::key::Named::Escape)
        {
            return;
        }
        let message = match key {
            keyboard::Key::Named(keyboard::key::Named::Escape) if self.notice.is_some() => {
                Some(EqMessage::DismissNotice)
            }
            keyboard::Key::Named(keyboard::key::Named::Escape) => Some(EqMessage::Cancel),
            keyboard::Key::Named(keyboard::key::Named::Delete)
            | keyboard::Key::Named(keyboard::key::Named::Backspace) => Some(EqMessage::Delete),
            keyboard::Key::Character(value) if modifiers.command() || modifiers.control() => {
                match value.to_lowercase().as_str() {
                    "d" => Some(EqMessage::Duplicate),
                    "c" => Some(EqMessage::CopyBands),
                    "v" => Some(EqMessage::PasteBands),
                    _ => None,
                }
            }
            _ => None,
        };
        if let Some(message) = message {
            self.handle(message, context);
        }
    }

    pub(super) fn handle(&mut self, message: EqMessage, context: &PluginContext<EqParams>) {
        self.ensure_session(context);
        self.handle_state_restore(context);
        let revision = self.params.telemetry.state_restore_revision();
        let message = match message {
            EqMessage::GraphAt(source, message) if source == revision => EqMessage::Graph(message),
            EqMessage::KnobAt(source, message) if source == revision => EqMessage::Knob(message),
            EqMessage::GraphAt(..) | EqMessage::KnobAt(..) => return,
            message => message,
        };
        self.synchronize();
        let params = self.active_params();
        let before = {
            let model = self.model.borrow();
            (model.config.clone(), model.extras)
        };
        let mut keep_open = false;
        match message {
            EqMessage::GraphAt(..) | EqMessage::KnobAt(..) => return,
            EqMessage::Graph(message) => keep_open = self.graph(message),
            EqMessage::Menu(panel) => {
                self.toggle_panel(panel);
                return;
            }
            EqMessage::DismissPanels => {
                self.dismiss_panels();
                return;
            }
            EqMessage::DismissNotice => {
                self.notice = None;
                return;
            }
            EqMessage::Knob(message) => keep_open = self.knob(message),
            EqMessage::Draft(field, value) => {
                self.drafts.insert(field, value);
                return;
            }
            EqMessage::Submit(field) => {
                if let Some(value) = self
                    .drafts
                    .get(&field)
                    .and_then(|value| parse_number(value))
                {
                    if matches!(field, Number::Frequency | Number::Gain | Number::Q) {
                        self.step_knob(field, value);
                    } else if field == Number::Slope {
                        self.change(|model| {
                            model.edit_selected(|band| {
                                if band_controls::has_cut_slope(band.shape) {
                                    band.slope_db_oct = value;
                                }
                            })
                        });
                    } else {
                        self.change(|model| model.number(field, value));
                    }
                    self.numeric_edit = None;
                } else {
                    self.notify("Enter a valid number, then press Enter.", true);
                    return;
                }
            }
            EqMessage::Select(id) => {
                self.dismiss_panels();
                self.model.get_mut().selected.clear();
                self.model.get_mut().select(id, false);
                self.drafts.clear();
            }
            EqMessage::Shape(shape) => self.change(|model| model.shape(shape)),
            EqMessage::Slope(slope) => self.change(|model| {
                model.edit_selected(|band| {
                    if band_controls::has_cut_slope(band.shape) {
                        band.slope_db_oct = slope;
                    }
                })
            }),
            EqMessage::Channel(channel) => self.change(|model| model.channel(channel)),
            EqMessage::Mode(mode) => self.change(|model| model.config.processing_mode = mode),
            EqMessage::Resolution(resolution) => {
                self.change(|model| model.config.linear_phase_resolution = resolution)
            }
            EqMessage::Learn(field) => {
                let id = if field == Number::Output {
                    Some(0)
                } else {
                    self.model.get_mut().focused().map(|band| {
                        crate::params::BAND_BASE
                            + (band.id - 1) * crate::params::BAND_STRIDE
                            + match field {
                                Number::Frequency => 3,
                                Number::Gain => 4,
                                Number::Q => 5,
                                _ => 3,
                            }
                    })
                };
                if params.telemetry.learning() == id {
                    params.telemetry.set_learning(None);
                } else {
                    params.telemetry.set_learning(id);
                    self.notify(
                        "Move a MIDI controller to assign it to this parameter.",
                        false,
                    );
                }
            }
            EqMessage::ForgetMidi => {
                if let Some(band) = self.model.get_mut().focused() {
                    for offset in 1..=7 {
                        params.midi_bindings.clear(
                            crate::params::BAND_BASE
                                + (band.id - 1) * crate::params::BAND_STRIDE
                                + offset,
                        );
                    }
                }
                params.telemetry.set_learning(None);
            }
            EqMessage::LearnParam(id) => {
                params
                    .telemetry
                    .set_learning((params.telemetry.learning() != Some(id)).then_some(id));
                self.notify(
                    "Move a MIDI controller to assign it to this parameter.",
                    false,
                );
            }
            EqMessage::ForgetGlobalMidi => {
                for id in 0..=10 {
                    params.midi_bindings.clear(id);
                }
                params.telemetry.set_learning(None);
            }
            EqMessage::BandEnabled(enabled) => {
                self.change(|model| model.edit_selected(|band| band.enabled = enabled))
            }
            EqMessage::SplitChannels(first, second) => {
                let mut result = Ok(0);
                self.change(|model| {
                    result = model.split_selected(first, second);
                });
                match result {
                    Err(_) => self.notify(
                        "Splitting all selected stereo bands would exceed the 24-band limit.",
                        true,
                    ),
                    Ok(0) => self.notify("Select stereo bands to split their channels.", true),
                    Ok(count) => self.notify(format!("Split {count} stereo bands."), false),
                };
            }
            EqMessage::Delete => self.change(Model::remove_selected),
            EqMessage::Duplicate => self.change(Model::duplicate_selected),
            EqMessage::CopyBands => {
                match band_clipboard::copy(self.model.get_mut()) {
                    Ok(()) => self.notify("Selected bands copied.", false),
                    Err(error) => self.notify(error, true),
                };
                return;
            }
            EqMessage::PasteBands => match Preset::paste() {
                Ok(preset) => {
                    let mut result = Ok(0);
                    let rate = params.telemetry.sample_rate();
                    self.change(|model| {
                        result = band_clipboard::append(model, preset, rate);
                    });
                    match result {
                        Ok(count) => self.notify(format!("Pasted {count} bands."), false),
                        Err(error) => self.notify(error, true),
                    };
                }
                Err(error) => self.notify(error, true),
            },
            EqMessage::Solo => {
                let model = self.model.get_mut();
                let selected = model.focused().map(|band| band.id);
                model.solo = if model.solo == selected {
                    None
                } else {
                    selected
                };
                let solo = model.solo;
                self.publish_solo(solo);
            }
            EqMessage::Cancel => {
                self.cancel_gesture();
            }
            EqMessage::Pre => self.pre = !self.pre,
            EqMessage::Post => self.post = !self.post,
            EqMessage::External => self.external = !self.external,
            EqMessage::Freeze => {
                if self.frozen.is_some() {
                    self.frozen = None;
                    self.frozen_display = None;
                } else {
                    let (raw, display) = params.telemetry.spectrum_pair();
                    self.frozen = Some(raw);
                    self.frozen_display = Some(display);
                }
            }
            EqMessage::Piano => self.piano = !self.piano,
            EqMessage::Range(range) => self.range = range,
            EqMessage::ViewChannel(channel) => {
                self.channel = channel;
                let mut config = params.telemetry.analyzer_config();
                config.channel = channel;
                if params.telemetry.set_analyzer(config).is_err() {
                    self.notify("Analyzer channel could not be changed.", true);
                }
            }
            EqMessage::Analyzer => {
                self.toggle_panel(Panel::Analyzer);
                return;
            }
            EqMessage::SpectrumFloor(floor) => self.floor = floor,
            EqMessage::Collision => self.collision = !self.collision,
            EqMessage::AnalyzerResolution(resolution) => {
                let mut config = params.telemetry.analyzer_config();
                config.resolution = resolution;
                if params.telemetry.set_analyzer(config).is_err() {
                    self.notify("Analyzer settings could not be changed.", true);
                }
            }
            EqMessage::AnalyzerSpeed(speed) => {
                let mut config = params.telemetry.analyzer_config();
                config.speed = speed;
                if params.telemetry.set_analyzer(config).is_err() {
                    self.notify("Analyzer settings could not be changed.", true);
                }
            }
            EqMessage::AnalyzerTilt(tilt) => {
                let mut config = params.telemetry.analyzer_config();
                config.tilt_db_oct = tilt;
                if params.telemetry.set_analyzer(config).is_err() {
                    self.notify("Analyzer settings could not be changed.", true);
                }
            }
            EqMessage::Match => {
                self.notice = None;
                let source = self
                    .frozen
                    .clone()
                    .unwrap_or_else(|| params.telemetry.spectrum());
                let mut reference = source.clone();
                reference.post_db = reference.external_db.clone();
                match matching::fit(&source, &reference) {
                    Ok((mut config, residual)) => {
                        let count = config.bands.len();
                        let sample_rate = params.telemetry.sample_rate();
                        let maximum = (sample_rate * 0.499).min(30_000.0);
                        for band in &mut config.bands {
                            band.frequency_hz = band.frequency_hz.min(maximum);
                        }
                        if config.validate(sample_rate).is_err() {
                            self.notify(
                                "The reference could not be matched at this sample rate.",
                                true,
                            );
                            return;
                        }
                        if !self.change_result(|model| {
                            model.config = config;
                            model.extras = Extras::default();
                        }) {
                            return;
                        }
                        self.model.get_mut().selected.clear();
                        self.model.get_mut().end();
                        self.model.get_mut().solo = None;
                        self.publish_solo(None);
                        self.transient_solo = false;
                        self.notify(
                            format!(
                                "Sidechain matched with {count} bands. Residual {residual:.2} dB."
                            ),
                            false,
                        );
                    }
                    Err(error) => {
                        self.notify(error, true);
                        return;
                    }
                }
            }
            EqMessage::GainScale(value) => {
                self.model.get_mut().begin();
                self.model.get_mut().extras.gain_scale = value;
                keep_open = true;
            }
            EqMessage::EndControl => self.model.get_mut().end(),
            EqMessage::PhaseInvert(value) => self.change(|model| model.extras.phase_invert = value),
            EqMessage::AutoGain(value) => self.change(|model| model.extras.auto_gain = value),
            EqMessage::PanMode(mode) => self.change(|model| model.extras.output_pan_mode = mode),
            EqMessage::OutputMute(mute) => self.change(|model| model.extras.output_mute = mute),
            EqMessage::Pan(value) => {
                self.model.get_mut().begin();
                self.model.get_mut().extras.output_pan = value;
                keep_open = true;
            }
            EqMessage::Bypass => self.change(|model| model.config.bypass = !model.config.bypass),
            EqMessage::Key(event) => {
                self.key(event, context);
                return;
            }
        }
        if self.model.get_mut().focused().is_none()
            && self
                .panel
                .is_some_and(|panel| matches!(panel, Panel::BandActions | Panel::Midi))
        {
            self.dismiss_panels();
        }
        let changed = {
            let model = self.model.borrow();
            model.config != before.0 || model.extras != before.1
        };
        if changed || !self.expected.borrow().is_empty() {
            self.apply(context, keep_open);
        } else if !keep_open {
            // Selection, a late motion after recall, or a redundant release
            // cannot rewrite dormant host slots through a full-config publish.
            self.close_edits(context);
        }
    }
}
