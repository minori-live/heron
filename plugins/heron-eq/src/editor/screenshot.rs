//! Manual native render evidence with actual processed audio and fit import.

use super::*;
use std::sync::Mutex;
use truce::core::PluginRuntime;
use truce::core::state::{hash_plugin_id, serialize_state};
use truce::prelude::{AudioBuffer, EventList};
use truce_iced::iced::{Point, widget::canvas::Text};

#[path = "screenshot_layout.rs"]
mod layout_check;

#[derive(Clone, serde::Serialize)]
pub(super) struct NodeLabelBounds {
    id: u32,
    circle_center: [f32; 2],
    ink_bounds: [f32; 4],
    ink_center_offset: [f32; 2],
}

static NODE_LABELS: Mutex<Vec<NodeLabelBounds>> = Mutex::new(Vec::new());
static NODE_DRAG_FRAMES: Mutex<Vec<serde_json::Value>> = Mutex::new(Vec::new());
static RESIZE_HIT_FRAMES: Mutex<Vec<serde_json::Value>> = Mutex::new(Vec::new());

pub(super) fn record_resize_frame(frame: serde_json::Value) {
    RESIZE_HIT_FRAMES
        .lock()
        .expect("native resize hit evidence")
        .push(frame);
}

pub(super) fn record_node_drag_frame(
    size: truce_iced::iced::Size,
    step: usize,
    hud: truce_iced::iced::Rectangle,
    painted: u8,
    frequency: f64,
    gain: f64,
    pending_values: usize,
) {
    NODE_DRAG_FRAMES
        .lock()
        .expect("native drag frame evidence")
        .push(serde_json::json!({
            "window": [size.width, size.height],
            "frame": step,
            "hud_bounds": [hud.x, hud.y, hud.width, hud.height],
            "painted_controls_mask": painted,
            "frequency_hz": frequency,
            "gain_db": gain,
            "pending_host_values": pending_values,
            "source": "actual UserInterface update/draw with delayed host settlement",
        }));
}

/// Measure the same shaped outlines used by Iced's native canvas text path.
/// These diagnostics belong to the manual render evidence, not production UI.
pub(super) fn record_node_label(id: u32, center: Point, text: &Text) {
    if let Some(bounds) = super::node_labels::ink_bounds(text) {
        assert!(
            (bounds.center_x() - center.x).abs() < 0.001
                && (bounds.center_y() - center.y).abs() < 0.001,
            "band {id} numeral must be centered on its circle: {bounds:?} vs {center:?}"
        );
        NODE_LABELS
            .lock()
            .expect("node label measurements")
            .push(NodeLabelBounds {
                id,
                circle_center: [center.x, center.y],
                ink_bounds: [bounds.x, bounds.y, bounds.width, bounds.height],
                ink_center_offset: [bounds.center_x() - center.x, bounds.center_y() - center.y],
            });
    }
}

#[test]
#[ignore = "manual native screenshot and portable host-state generation"]
fn render_fit_and_full_native_editors() {
    layout_check::reset();
    let directory = std::path::PathBuf::from("../../out/eq-native");
    NODE_DRAG_FRAMES
        .lock()
        .expect("native drag frame evidence")
        .clear();
    RESIZE_HIT_FRAMES
        .lock()
        .expect("native resize hit evidence")
        .clear();
    std::fs::create_dir_all(&directory).expect("output directory");

    let mut empty = fitted_preset();
    empty.config.bands.clear();
    empty.config.output_gain_db = 0.0;
    let (empty_params, _) = processed_fixture(&empty);
    let (fit_params, _) = processed_fixture(&fitted_preset());
    let (full_params, _) = processed_fixture(&full_preset());
    save_host_state(&directory, "fit", &fit_params);
    save_host_state(&directory, "full", &full_params);

    render_scene::<0>(&directory, "empty", empty_params.clone());
    render_scene::<15>(&directory, "paused-add", empty_params.clone());
    render_scene::<14>(&directory, "paused-drag", empty_params);
    render_scene::<0>(&directory, "three-bands", fit_params.clone());
    render_scene::<1>(&directory, "fit", fit_params.clone());
    render_scene::<1>(&directory, "selected", fit_params.clone());
    render_scene::<0>(&directory, "bands24", full_params.clone());
    render_scene::<1>(&directory, "full", full_params.clone());
    render_scene::<3>(&directory, "full-analyzer", fit_params.clone());
    render_scene::<4>(&directory, "output", fit_params.clone());
    render_scene::<5>(&directory, "context-menu", fit_params.clone());
    render_scene::<8>(&directory, "processing-mode", full_params.clone());
    render_scene::<9>(&directory, "numeric-frequency", fit_params.clone());
    render_scene::<10>(&directory, "midi-learn", fit_params.clone());
    render_scene::<12>(&directory, "tools", fit_params.clone());
    render_scene::<16>(&directory, "match-notice", fit_params.clone());
    render_scene::<17>(&directory, "dismissed-tools-notice", fit_params);

    // The same selected control surface stays at lower center at both extremes.
    // Scene 13 exercises real runtime input/draw and retained-tree transitions.
    let mut fixed = fitted_preset();
    fixed.config.bands[1].frequency_hz = 40.0;
    fixed.config.bands[1].gain_db = -12.0;
    let (low_params, _) = processed_fixture(&fixed);
    render_scene::<13>(&directory, "fixed-panel-low", low_params);
    fixed.config.bands[1].frequency_hz = 18_000.0;
    fixed.config.bands[1].gain_db = 12.0;
    let (high_params, _) = processed_fixture(&fixed);
    render_scene::<1>(&directory, "fixed-panel-high", high_params);

    // A separated row of all stable numbers makes both single- and double-digit
    // centering visible without another node or a floating panel covering them.
    let mut numbered = fitted_preset();
    numbered.config.processing_mode = ProcessingMode::ZeroLatency;
    numbered.config.output_gain_db = 0.0;
    numbered.config.bands = (1..=24)
        .map(|id| heron_dsp_core::eq::EqBand {
            id,
            frequency_hz: 25.0 * 800.0_f64.powf(f64::from(id - 1) / 23.0),
            gain_db: if id % 2 == 0 { 4.0 } else { -4.0 },
            ..Default::default()
        })
        .collect();
    let (numbered_params, _) = processed_fixture(&numbered);
    render_scene::<0>(&directory, "node-labels", numbered_params);

    let scenes = [
        ("empty", 0, "none"),
        (
            "paused-add",
            1,
            "band added while audio/host cache is paused",
        ),
        ("paused-drag", 1, "band dragged while host cache is delayed"),
        ("three-bands", 3, "none"),
        ("selected", 3, "selected band"),
        ("bands24", 24, "none"),
        ("full-analyzer", 3, "analyzer"),
        ("output", 3, "output"),
        ("context-menu", 3, "band actions"),
        ("processing-mode", 24, "processing mode"),
        ("numeric-frequency", 3, "frequency text entry"),
        ("midi-learn", 3, "MIDI learn"),
        ("tools", 3, "tools"),
        ("match-notice", 3, "match feedback without an open menu"),
        (
            "dismissed-tools-notice",
            3,
            "feedback retained after tools dismissal",
        ),
        (
            "fixed-panel-low",
            3,
            "fixed lower-center panel on low-frequency cut",
        ),
        (
            "fixed-panel-high",
            3,
            "fixed lower-center panel on high-frequency boost",
        ),
        ("node-labels", 24, "separated stable band numbers"),
    ];
    let manifest: Vec<_> = scenes
        .into_iter()
        .flat_map(|(name, bands, panel)| {
            [(1120, 760, ""), (1040, 700, "-minimum")].map(|(width, height, suffix)| {
                serde_json::json!({
                    "file": format!("{name}{suffix}.png"),
                    "width": width,
                    "height": height,
                    "bands": bands,
                    "panel": panel,
                    "sample_rate": 48000,
                    "source": "native processor-fed telemetry",
                })
            })
        })
        .collect();
    std::fs::write(
        directory.join("scenes.json"),
        serde_json::to_vec_pretty(&manifest).expect("scene manifest JSON"),
    )
    .expect("scene manifest file");
    std::fs::write(
        directory.join("layout-bounds.json"),
        serde_json::to_vec_pretty(&layout_check::measurements())
            .expect("actual widget bounds JSON"),
    )
    .expect("actual widget bounds file");
    std::fs::write(
        directory.join("node-drag-frames.json"),
        serde_json::to_vec_pretty(&*NODE_DRAG_FRAMES.lock().expect("native drag frame evidence"))
            .expect("native drag frame JSON"),
    )
    .expect("native drag frame evidence file");
    std::fs::write(
        directory.join("resize-hit-frames.json"),
        serde_json::to_vec_pretty(
            &*RESIZE_HIT_FRAMES
                .lock()
                .expect("native resize hit evidence"),
        )
        .expect("native resize hit frame JSON"),
    )
    .expect("native resize hit frame evidence file");
}

fn fitted_preset() -> Preset {
    Preset::parse(include_str!("../../tests/fixtures/fit-preset.json"))
        .expect("shared fitted preset fixture")
}

fn full_preset() -> Preset {
    let mut preset = fitted_preset();
    preset.config.processing_mode = ProcessingMode::LinearPhase;
    preset.config.linear_phase_resolution = LinearPhaseResolution::Low;
    for id in 4..=24 {
        preset.config.bands.push(heron_dsp_core::eq::EqBand {
            id,
            frequency_hz: 30.0 * 600.0_f64.powf(f64::from(id - 4) / 20.0),
            gain_db: f64::from(id % 5) - 2.0,
            ..Default::default()
        });
    }
    preset
}

fn processed_fixture(preset: &Preset) -> (Arc<EqParams>, crate::EqDspState) {
    let params = Arc::new(EqParams::default());
    for (id, value) in params.normalized_values(&preset.config) {
        params.set_normalized(id, value);
    }
    let mut state = crate::EqDspState::default();
    state.reset(&params, 48000.0);
    let mut random = 123456789u32;
    let input: Vec<_> = (0..32768)
        .map(|index| {
            random ^= random << 13;
            random ^= random >> 17;
            random ^= random << 5;
            let noise = (random as f32 / u32::MAX as f32 - 0.5) * 0.12;
            let phase = std::f32::consts::TAU * index as f32 / 48000.0;
            noise + 0.035 * (phase * 250.0).sin() + 0.045 * (phase * 2400.0).sin()
        })
        .collect();
    let mut left = vec![0.0; input.len()];
    let mut right = left.clone();
    let inputs = [input.as_slice(), input.as_slice()];
    let mut outputs = [left.as_mut_slice(), right.as_mut_slice()];
    let mut buffer = AudioBuffer::from_slices_checked(&inputs, &mut outputs, input.len());
    state.process(&params, &mut buffer, &EventList::with_capacity(0));
    (params, state)
}

fn save_host_state(directory: &std::path::Path, name: &str, params: &EqParams) {
    let (ids, values) = params.collect_values();
    let binary = serialize_state(
        hash_plugin_id(crate::Plugin::info().clap_id),
        &ids,
        &values,
        &[],
        &params.serialize_persist(),
    );
    std::fs::write(directory.join(format!("{name}.state")), binary).expect("native host state");
}

struct EvidenceScene<const SCENE: u8>(EqUi);

impl<const SCENE: u8> IcedPlugin<EqParams> for EvidenceScene<SCENE> {
    type Message = EqMessage;

    fn new(params: Arc<EqParams>) -> Self {
        let mut ui = EqUi::new(params);
        ui.model.get_mut().selected.clear();
        if matches!(SCENE, 1 | 5 | 9 | 10 | 13 | 16 | 17) {
            ui.model.get_mut().selected.insert(2);
        }
        ui.panel = match SCENE {
            3 => Some(Panel::Analyzer),
            4 => Some(Panel::Output),
            5 => Some(Panel::BandActions),
            8 => Some(Panel::Processing),
            10 => Some(Panel::Midi),
            12 => Some(Panel::Tools),
            _ => None,
        };
        if SCENE == 5 {
            ui.context_menu = Some(truce_iced::iced::Point::new(590.0, 280.0));
        }
        if SCENE == 9 {
            ui.numeric_edit = Some(Number::Frequency);
            ui.drafts.insert(Number::Frequency, "2.4k".to_owned());
        }
        if matches!(SCENE, 14 | 15) {
            let model = ui.model.get_mut();
            model.add(1000.0, 0.0).expect("room for paused edit");
            if SCENE == 14 {
                model.begin();
                model.drag(2.0, 6.0);
            }
            ui.expected
                .replace(ui.params.normalized_values(&model.config));
        }
        if SCENE == 16 {
            ui.notify(
                "Play audio or freeze a spectrum before matching the sidechain.",
                true,
            );
        }
        if SCENE == 17 {
            ui.panel = Some(Panel::Tools);
            ui.notify("The 24-band limit has been reached.", true);
            ui.dismiss_panels();
        }
        // A one-shot native screenshot must wait for the same asynchronous FIR
        // target used by the live editor, rather than recording its first pending frame.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            let model = ui.model.borrow();
            let telemetry = &ui.params.telemetry;
            let projection = ui.response_preview.borrow_mut().project(
                &model.config,
                model.extras,
                telemetry.sample_rate(),
                telemetry.spectrum().auto_gain_db,
                model.solo.is_some(),
                telemetry.stereo_output(),
            );
            assert!(
                !projection.failed,
                "native evidence response preparation failed"
            );
            if !projection.pending {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "native evidence response preparation timed out"
            );
            drop(model);
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        Self(ui)
    }

    fn update(
        &mut self,
        message: Message<EqMessage>,
        params: &ParamCache<EqParams>,
        context: &PluginContext<EqParams>,
    ) -> Task<Message<EqMessage>> {
        self.0.update(message, params, context)
    }

    fn view<'a>(&'a self, params: &'a ParamCache<EqParams>) -> Element<'a, Message<EqMessage>> {
        if SCENE == 13 {
            layout_check::checked_with_drag(self.0.view(params))
        } else {
            layout_check::checked(self.0.view(params))
        }
    }

    fn theme(&self) -> truce_iced::iced::Theme {
        self.0.theme()
    }
}

fn render_scene<const SCENE: u8>(directory: &std::path::Path, name: &str, params: Arc<EqParams>) {
    for (size, suffix) in [((1120, 760), ""), ((1040, 700), "-minimum")] {
        NODE_LABELS.lock().expect("node label measurements").clear();
        let mut editor = IcedEditor::<EqParams, EvidenceScene<SCENE>>::new(params.clone(), size);
        let erased: Arc<dyn Params> = params.clone();
        let (pixels, width, height) = editor.screenshot(erased).expect("native scene screenshot");
        assert_eq!((width, height), size, "native evidence dimensions");
        truce::core::screenshot::save_png(
            &directory.join(format!("{name}{suffix}.png")),
            &pixels,
            width,
            height,
        );
        let labels = NODE_LABELS.lock().expect("node label measurements").clone();
        std::fs::write(
            directory.join(format!("{name}{suffix}-labels.json")),
            serde_json::to_vec_pretty(&labels).expect("native node label bounds JSON"),
        )
        .expect("native node label bounds file");
    }
}
