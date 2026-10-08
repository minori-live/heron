//! Native regression: resizing Heron's hosted EQ must preserve visible control hit targets.
#![cfg(target_os = "windows")]

use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    path::PathBuf,
    rc::Rc,
    thread,
    time::{Duration, Instant},
};

use heron_audio_host::editor_platform::{
    NativeContainer, NativeContainerGeometry, NativeEditorWindowContext, NativeParentHandle,
    NativeUiContext,
};
use heron_vst3_host::{
    AudioLayout, ClassId, EditorParameterGesture, HostedPlugin, Module, PlugFrame, PlugView,
    PluginKind, ViewRect,
};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, RECT, WPARAM},
        UI::{
            HiDpi::{
                DPI_AWARENESS_CONTEXT, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForWindow,
                SetThreadDpiAwarenessContext,
            },
            Input::KeyboardAndMouse::{
                GetFocus, SetFocus, TME_CANCEL, TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent,
                VK_ESCAPE,
            },
            WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, DispatchMessageW, GW_CHILD, GetClassNameW,
                GetClientRect, GetWindow, IsWindow, IsWindowVisible, MSG, PM_REMOVE, PeekMessageW,
                SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER, SendMessageW,
                SetWindowPos, ShowWindow, TranslateMessage, WM_DPICHANGED, WM_KEYDOWN, WM_KEYUP,
                WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WS_CLIPCHILDREN, WS_EX_NOACTIVATE,
                WS_EX_TOOLWINDOW, WS_POPUP, WS_VISIBLE,
            },
        },
    },
    core::w,
};

const WM_MOUSELEAVE: u32 = 0x02a3;
thread_local! {
    static FRAME_TICKS: Cell<u32> = const { Cell::new(0) };
}

#[test]
#[ignore = "Requires a fresh Heron EQ.vst3 debug bundle and a Windows desktop/GPU session"]
fn hosted_eq_controls_follow_visible_positions_after_repeated_native_resizes() {
    let _dpi = DpiContext::new();
    let _ui = NativeUiContext::initialize().expect("initialize native editor UI thread");
    let parent = HiddenParent::new();
    // Match the Windows runtime's module retention while keeping each case a
    // fresh plug-in. Native background work may outlive a closed HWND, so no
    // case may unload the DLL before the suite's final editor has detached.
    let mut module_leases = Vec::new();
    let display_scale = unsafe {
        // SAFETY: the hidden parent is a live HWND owned by this test thread.
        f64::from(GetDpiForWindow(parent.0)) / 96.0
    };
    assert!(display_scale > 0.0, "the parent must report its actual DPI");

    for host_zoom in [1.0, 1.25] {
        let content_scale = display_scale * host_zoom;
        eprintln!(
            "native EQ display={display_scale}, host zoom={host_zoom}, content scale={content_scale}"
        );
        let mut editor = AttachedEditor::new(parent.0, content_scale, &mut module_leases);
        for (width, height) in [(1120, 760), (1500, 950), (1040, 700), (1120, 760)] {
            editor.resize(parent.0, width, height, content_scale);
            verify_controls(&editor, parent.0, width, height, content_scale);
        }
    }

    // Retain this same attachment so changing zoom cannot hide behind reopening.
    let mut editor = AttachedEditor::new(parent.0, display_scale, &mut module_leases);
    for host_zoom in [1.0, 1.25, 1.0] {
        let content_scale = display_scale * host_zoom;
        // Match Heron's set_zoom path: scale, read view size and resize only
        // the host container. The plug-in must resize its own child without onSize.
        editor.host_zoom(parent.0, 1120, 760, content_scale);
        verify_controls(&editor, parent.0, 1120, 760, content_scale);
        verify_cancellation(&editor, parent.0, content_scale);
        if host_zoom == 1.25 {
            verify_pinned_dpi(&editor, content_scale);
        }
    }
    // A distinct host path sends onSize immediately after a different scale,
    // before the queued native scale/resize work has run.
    for host_zoom in [1.25, 1.0] {
        let content_scale = display_scale * host_zoom;
        assert!(
            editor
                .view
                .set_content_scale_factor(content_scale as f32)
                .unwrap()
        );
        editor.resize(parent.0, 1120, 760, content_scale);
        verify_controls(&editor, parent.0, 1120, 760, content_scale);
        verify_cancellation(&editor, parent.0, content_scale);
    }
    verify_close_and_reopen(&mut editor, parent.0, display_scale);
}

fn verify_controls(editor: &AttachedEditor, _parent: HWND, width: u32, height: u32, scale: f64) {
    let child = editor.child();
    eprintln!(
        "native EQ logical={width}x{height}, content scale={scale}, child={:?}, frame ticks={}",
        client_extent(child),
        FRAME_TICKS.with(Cell::get)
    );
    diagnostic_window(child);

    let old_bypass = editor.value(1);
    editor.plugin.take_editor_parameter_gestures();
    click(child, physical(24.0, f64::from(height) - 20.0, scale));
    editor.wait_value(1, 1.0 - old_bypass, 1.0e-9);
    assert_balanced_gesture(editor.plugin.take_editor_parameter_gestures(), 1);

    editor.plugin.set_parameter_plain(104, 0.0, true).unwrap();
    pump_for(Duration::from_millis(80));
    // The graph has a 44-point top bar and a 40-point footer. Its
    // logarithmic 10 Hz..30 kHz plot leaves 42/28-point side gutters.
    let node_x = 42.0 + (1000.0_f64 / 10.0).ln() / 3000.0_f64.ln() * (f64::from(width) - 70.0);
    let node_y = f64::from(height) * 0.5 + 2.0;
    let plot_height = f64::from(height) - 148.0;
    let node_start = physical(node_x, node_y, scale);
    let node_end = physical(node_x, node_y - plot_height / 8.0, scale);
    drag(child, node_start, node_end);
    editor.wait_value(104, 3.0, 0.08);
    assert_balanced_gestures(
        editor.plugin.take_editor_parameter_gestures(),
        &[104],
        &[103, 104],
    );
    assert!(
        (editor.value(840) + 4.0).abs() < 1.0e-6,
        "band 24 was retargeted"
    );
    assert!(
        editor.value(0).abs() < 1.0e-6,
        "band drag changed global output"
    );
    assert!(
        (editor.value(103) - 1000.0).abs() < 2.0,
        "vertical drag changed frequency"
    );

    // A node drag selects band 1 and exposes its fixed bottom HUD.
    // The central Gain rotary changes 60 dB across 180 vertical points.
    let gain_knob = (f64::from(width) * 0.5 - 5.0, f64::from(height) - 140.0);
    let gain_start = physical(gain_knob.0, gain_knob.1, scale);
    let gain_end = physical(gain_knob.0, gain_knob.1 - 18.0, scale);
    let gain_before = editor.value(104);
    let frequency_before = editor.value(103);
    let q_before = editor.value(105);
    drag(child, gain_start, gain_end);
    editor.wait_value(104, gain_before + 6.0, 0.25);
    assert_balanced_gesture(editor.plugin.take_editor_parameter_gestures(), 104);
    assert!((editor.value(103) - frequency_before).abs() < 1.0e-6);
    assert!((editor.value(105) - q_before).abs() < 1.0e-6);
    assert!((editor.value(840) + 4.0).abs() < 1.0e-6);
}

fn verify_cancellation(editor: &AttachedEditor, parent: HWND, scale: f64) {
    let child = editor.child();
    // The previous Gain gesture clicked this same rotary. Let its double-click
    // interval expire so this independent gesture exercises drag cancellation.
    pump_for(Duration::from_millis(600));
    let gain_start = physical(555.0, 620.0, scale);
    let gain_end = physical(555.0, 602.0, scale);
    let retained_gain = editor.value(104);
    start_drag(child, gain_start, gain_end);
    editor.wait_value(104, retained_gain + 6.0, 0.25);
    escape(child);
    editor.wait_value(104, retained_gain, 1.0e-9);
    assert_balanced_gesture(editor.plugin.take_editor_parameter_gestures(), 104);
    late_pointer_does_not_write(editor, gain_end);

    // Real focus transfer drives Windows' WM_KILLFOCUS mapping. A node edit
    // must restore its initial values and relinquish its pointer ownership.
    editor.plugin.set_parameter_plain(104, 0.0, true).unwrap();
    pump_for(Duration::from_millis(80));
    let node_x = 42.0 + (1000.0_f64 / 10.0).ln() / 3000.0_f64.ln() * 1050.0;
    let node_start = physical(node_x, 382.0, scale);
    let node_end = physical(node_x, 305.5, scale);
    start_drag(child, node_start, node_end);
    editor.wait_value(104, 3.0, 0.08);
    focus(parent);
    editor.wait_value(104, 0.0, 1.0e-9);
    assert_balanced_gestures(
        editor.plugin.take_editor_parameter_gestures(),
        &[104],
        &[103, 104],
    );
    focus(child);
    late_pointer_does_not_write(editor, node_end);
}

fn verify_close_and_reopen(editor: &mut AttachedEditor, parent: HWND, scale: f64) {
    let child = editor.child();
    let start = physical(555.0, 620.0, scale);
    let end = physical(555.0, 611.0, scale);
    let previous = editor.value(104);
    start_drag(child, start, end);
    editor.wait_value(104, previous + 3.0, 0.25);
    let retained = editor.value(104);
    let retained_frequency = editor.value(103);
    let retained_q = editor.value(105);
    let present: Vec<_> = (0..24_u32)
        .map(|slot| {
            let id = 100 + slot * 32;
            (id, editor.value(id))
        })
        .collect();
    editor.close();
    assert_balanced_gesture(editor.plugin.take_editor_parameter_gestures(), 104);
    assert_eq!(
        editor.value(104),
        retained,
        "close ends an edit without rolling it back"
    );
    pump_until(
        || unsafe {
            // SAFETY: IsWindow permits querying the now-detached HWND without dereferencing it.
            !IsWindow(Some(child)).as_bool()
        },
        "detached native child destruction",
    );
    editor.open();
    editor.resize(parent, 1120, 760, scale);
    assert_eq!(editor.value(104), retained);
    assert!(editor.plugin.take_editor_parameter_gestures().is_empty());
    // HWND geometry and focus do not establish that the asynchronously
    // initialized GPU/UI has consumed input. Observe a reversible public
    // control before issuing the otherwise unobservable selection click;
    // queued clicks must not share the later Gain gesture's cursor position.
    let bypass = editor.value(1);
    for value in [1.0 - bypass, bypass] {
        click(editor.child(), physical(24.0, 740.0, scale));
        editor.wait_value(1, value, 1.0e-9);
        assert_balanced_gesture(editor.plugin.take_editor_parameter_gestures(), 1);
    }
    assert_eq!(editor.value(104), retained);
    assert_eq!(editor.value(103), retained_frequency);
    assert_eq!(editor.value(105), retained_q);
    for (id, value) in present {
        assert_eq!(
            editor.value(id),
            value,
            "readiness input changed band presence {id}"
        );
    }
    let node_x = 42.0 + (1000.0_f64 / 10.0).ln() / 3000.0_f64.ln() * 1050.0;
    click(
        editor.child(),
        physical(node_x, 382.0 - retained / 24.0 * 612.0, scale),
    );
    assert_eq!(
        editor.value(104),
        retained,
        "reselection must not mutate the retained gain"
    );
    assert!(editor.plugin.take_editor_parameter_gestures().is_empty());
    drag(editor.child(), start, end);
    editor.wait_value(104, retained + 3.0, 0.25);
    assert_balanced_gesture(editor.plugin.take_editor_parameter_gestures(), 104);
}

fn verify_pinned_dpi(editor: &AttachedEditor, scale: f64) {
    let child = editor.child();
    let original = editor.view.size().unwrap();
    let extent = client_extent(child);
    let mut suggested = RECT {
        left: 0,
        top: 0,
        right: extent.0 / 2,
        bottom: extent.1 / 2,
    };
    unsafe {
        // SAFETY: live child on this UI thread and writable suggested RECT
        // remain valid for the synchronous native message dispatch. This does
        // not alter the desktop or the HWND's actual monitor DPI.
        let dpi = GetDpiForWindow(child) + 96;
        SendMessageW(
            child,
            WM_DPICHANGED,
            Some(WPARAM((dpi | (dpi << 16)) as usize)),
            Some(LPARAM((&mut suggested as *mut RECT) as isize)),
        );
    }
    pump_for(Duration::from_millis(80));
    let current = editor.view.size().unwrap();
    assert_eq!(
        (current.right - current.left, current.bottom - current.top),
        (
            original.right - original.left,
            original.bottom - original.top
        ),
        "OS DPI suggestions must not replace the host's pinned content scale {scale}"
    );
    assert_eq!(
        client_extent(child),
        extent,
        "OS DPI suggestions must not resize the pinned child"
    );
}

fn assert_balanced_gesture(gestures: Vec<EditorParameterGesture>, parameter_id: u32) {
    assert_balanced_gestures(gestures, &[parameter_id], &[parameter_id]);
}

fn assert_balanced_gestures(
    gestures: Vec<EditorParameterGesture>,
    required: &[u32],
    allowed: &[u32],
) {
    let mut states = BTreeMap::<u32, (usize, bool)>::new();
    for gesture in &gestures {
        let id = match gesture {
            EditorParameterGesture::Begin { parameter_id }
            | EditorParameterGesture::Perform { parameter_id, .. }
            | EditorParameterGesture::End { parameter_id } => *parameter_id,
        };
        assert!(
            allowed.contains(&id),
            "the gesture retargeted parameter {id}: {gestures:?}"
        );
        match gesture {
            EditorParameterGesture::Begin { .. } => {
                assert!(
                    states.insert(id, (0, false)).is_none(),
                    "duplicate Begin for parameter {id}: {gestures:?}"
                );
            }
            EditorParameterGesture::Perform { .. } => {
                let (writes, ended) = states.get_mut(&id).unwrap_or_else(|| {
                    panic!("write before Begin for parameter {id}: {gestures:?}")
                });
                assert!(!*ended, "write after End for parameter {id}: {gestures:?}");
                *writes += 1;
            }
            EditorParameterGesture::End { .. } => {
                let (writes, ended) = states
                    .get_mut(&id)
                    .unwrap_or_else(|| panic!("End before Begin for parameter {id}: {gestures:?}"));
                assert!(
                    *writes > 0 && !*ended,
                    "duplicate or empty End for parameter {id}: {gestures:?}"
                );
                *ended = true;
            }
        }
    }
    for id in required {
        assert!(
            states.contains_key(id),
            "visible target {id} was not edited: {gestures:?}"
        );
    }
    assert!(
        states.values().all(|(writes, ended)| *writes > 0 && *ended),
        "all edited parameters need one complete host gesture: {gestures:?}"
    );
}

fn late_pointer_does_not_write(editor: &AttachedEditor, last: (i32, i32)) {
    let gain = editor.value(104);
    let frequency = editor.value(103);
    pointer(
        editor.child(),
        WM_MOUSEMOVE,
        (last.0 + 20, last.1 - 20),
        true,
    );
    pointer(
        editor.child(),
        WM_LBUTTONUP,
        (last.0 + 20, last.1 - 20),
        false,
    );
    pump_for(Duration::from_millis(80));
    assert_eq!(
        editor.value(104),
        gain,
        "late motion resumed a cancelled gain edit"
    );
    assert_eq!(
        editor.value(103),
        frequency,
        "late motion resumed a cancelled frequency edit"
    );
    assert!(
        editor.plugin.take_editor_parameter_gestures().is_empty(),
        "late input reopened host automation"
    );
}

struct AttachedEditor {
    view: PlugView,
    frame: Box<PlugFrame>,
    container: Rc<RefCell<NativeContainer>>,
    plugin: HostedPlugin,
    attached: bool,
}

impl AttachedEditor {
    fn new(parent: HWND, scale: f64, module_leases: &mut Vec<Rc<Module>>) -> Self {
        let bundle =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/bundles/Heron EQ.vst3");
        let class = "8A8341D5CA36B6C9A9572788F40EBB9F"
            .parse::<ClassId>()
            .unwrap();
        let (plugin, module_lease) = HostedPlugin::create_with_layout_and_hook(
            bundle,
            class,
            48_000.0,
            PluginKind::Effect,
            AudioLayout::Stereo,
            |module, _| Ok(Rc::clone(module)),
        )
        .expect("load packaged native Heron EQ");
        module_leases.push(module_lease);
        assert!(
            !plugin
                .parameters()
                .unwrap()
                .iter()
                .any(|parameter| parameter.id == 6),
            "the packaged EQ must not expose the retired Character parameter"
        );
        for (id, value) in [
            (100, 1.0),
            (103, 1000.0),
            (836, 1.0),
            (839, 6000.0),
            (840, -4.0),
            // The two active slots have a valid stable audio order before input.
            (855, 1.0),
        ] {
            plugin.set_parameter_plain(id, value, true).unwrap();
        }
        let view = plugin.create_view().expect("create real native EQ view");
        assert!(view.set_content_scale_factor(scale as f32).unwrap());
        let size = view.size().unwrap();
        let parent_handle = unsafe {
            // SAFETY: parent remains live on this thread until every attachment drops.
            NativeParentHandle::from_raw(parent.0 as usize).unwrap()
        };
        let container = Rc::new(RefCell::new(
            NativeContainer::create_for_parent(parent_handle, geometry(size), false)
                .unwrap()
                .expect("Windows native container"),
        ));
        let callback_container = Rc::clone(&container);
        let frame = PlugFrame::new(move |raw_view, mut requested| {
            callback_container.borrow_mut().resize(geometry(requested));
            unsafe {
                // SAFETY: the frame callback receives its attached live VST3 view.
                PlugView::on_size_raw(raw_view, &mut requested).is_ok()
            }
        });
        let mut result = Self {
            view,
            frame,
            container,
            plugin,
            attached: false,
        };
        result.open();
        result
    }

    fn open(&mut self) {
        assert!(!self.attached);
        unsafe {
            // SAFETY: frame/container belong to this guard and outlive the attachment.
            self.view.set_frame(self.frame.as_interface()).unwrap();
            self.view
                .attach(self.container.borrow().attach_handle(), c"HWND")
                .unwrap();
        }
        self.attached = true;
        pump_for(Duration::from_millis(150));
        let size = self.view.size().unwrap();
        assert_eq!(
            client_extent(self.child()),
            (size.right - size.left, size.bottom - size.top),
            "native child must occupy the VST3 physical view"
        );
        focus(self.child());
    }

    fn close(&mut self) {
        if self.attached {
            self.view.removed();
            self.attached = false;
        }
        unsafe {
            // SAFETY: revoke the plug-in's frame reference before releasing its owner.
            let _ = self.view.set_frame(std::ptr::null_mut());
        }
        // Windows close is posted. Drain it while the module still owns its code.
        pump_for(Duration::from_millis(100));
    }

    fn resize(&mut self, parent: HWND, width: u32, height: u32, scale: f64) {
        let mut size = ViewRect {
            left: 0,
            top: 0,
            right: (f64::from(width) * scale).round() as i32,
            bottom: (f64::from(height) * scale).round() as i32,
        };
        self.view.constrain_size(&mut size).unwrap();
        self.view.on_size(&mut size).unwrap();
        self.resize_container(parent, size);
    }

    fn host_zoom(&mut self, parent: HWND, width: u32, height: u32, scale: f64) {
        assert!(self.view.set_content_scale_factor(scale as f32).unwrap());
        let size = self.view.size().unwrap();
        assert_eq!(
            (size.right - size.left, size.bottom - size.top),
            physical(f64::from(width), f64::from(height), scale),
            "host zoom must report the current logical size at the new physical scale"
        );
        self.resize_container(parent, size);
    }

    fn resize_container(&mut self, parent: HWND, size: ViewRect) {
        unsafe {
            // SAFETY: the hidden parent is live and sizes are bounded test fixtures.
            SetWindowPos(
                parent,
                None,
                0,
                0,
                size.right,
                size.bottom,
                SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE,
            )
            .unwrap();
        }
        self.container.borrow_mut().resize(geometry(size));
        // Host onSize is queued until a native render tick; wait for that actual
        // HWND resize rather than assuming the COM callback rendered immediately.
        let target = (size.right, size.bottom);
        pump_until(
            || client_extent(self.child()) == target,
            "native child resize",
        );
        pump_for(Duration::from_millis(80));
    }

    fn child(&self) -> HWND {
        let container = HWND(self.container.borrow().attach_handle());
        unsafe {
            // SAFETY: the attached child container is live on the test UI thread.
            GetWindow(container, GW_CHILD).expect("attached EQ child HWND")
        }
    }

    fn value(&self, id: u32) -> f64 {
        self.plugin
            .parameters()
            .unwrap()
            .into_iter()
            .find(|parameter| parameter.id == id)
            .unwrap()
            .value
    }

    fn wait_value(&self, id: u32, expected: f64, tolerance: f64) {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            pump_once();
            let actual = self.value(id);
            if (actual - expected).abs() <= tolerance {
                return;
            }
            if Instant::now() >= deadline {
                diagnostic_window(self.child());
                panic!(
                    "parameter {id}: expected {expected}, got {actual}; view={:?}; host gestures={:?}",
                    self.view
                        .size()
                        .map(|rect| (rect.left, rect.top, rect.right, rect.bottom)),
                    self.plugin.take_editor_parameter_gestures(),
                );
            }
            thread::sleep(Duration::from_millis(2));
        }
    }
}

impl Drop for AttachedEditor {
    fn drop(&mut self) {
        self.close();
    }
}

fn geometry(size: ViewRect) -> NativeContainerGeometry {
    let width = (size.right - size.left).max(1) as u32;
    let height = (size.bottom - size.top).max(1) as u32;
    NativeContainerGeometry {
        x: 0,
        y: 0,
        parent_height: height,
        frame_width: width,
        frame_height: height,
        content_width: width,
        content_height: height,
    }
}

fn client_extent(hwnd: HWND) -> (i32, i32) {
    let mut rect = RECT::default();
    unsafe {
        // SAFETY: hwnd is live; rect is writable output storage.
        GetClientRect(hwnd, &mut rect).unwrap();
    }
    (rect.right - rect.left, rect.bottom - rect.top)
}

fn physical(x: f64, y: f64, scale: f64) -> (i32, i32) {
    ((x * scale).round() as i32, (y * scale).round() as i32)
}

fn pointer(hwnd: HWND, message: u32, point: (i32, i32), held: bool) {
    let packed = u32::from(point.0 as i16 as u16) | (u32::from(point.1 as i16 as u16) << 16);
    unsafe {
        // SAFETY: the real EQ child HWND is live; coordinates fit LPARAM's signed words.
        SendMessageW(
            hwnd,
            message,
            Some(WPARAM(usize::from(held))),
            Some(LPARAM(packed as isize)),
        );
        if message == WM_MOUSEMOVE {
            // A hidden window is outside the OS cursor's real hit target.
            // Baseview requests TME_LEAVE on entry, which can synthesize a
            // leave immediately after our injected move. Cancel that tracking
            // and remove its already-queued leave for this HWND only. Keep
            // actual mouse/button dispatch and widget hit-testing unchanged.
            let mut tracking = TRACKMOUSEEVENT {
                cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                dwFlags: TME_CANCEL | TME_LEAVE,
                hwndTrack: hwnd,
                dwHoverTime: 0,
            };
            let _ = TrackMouseEvent(&mut tracking);
            let mut leave = MSG::default();
            let _ = PeekMessageW(
                &mut leave,
                Some(hwnd),
                WM_MOUSELEAVE,
                WM_MOUSELEAVE,
                PM_REMOVE,
            );
        }
    }
    pump_for(Duration::from_millis(25));
}

fn click(hwnd: HWND, point: (i32, i32)) {
    pointer(hwnd, WM_MOUSEMOVE, point, false);
    pointer(hwnd, WM_LBUTTONDOWN, point, true);
    pointer(hwnd, WM_LBUTTONUP, point, false);
}

fn drag(hwnd: HWND, from: (i32, i32), to: (i32, i32)) {
    start_drag(hwnd, from, to);
    pointer(hwnd, WM_LBUTTONUP, to, false);
}

fn start_drag(hwnd: HWND, from: (i32, i32), to: (i32, i32)) {
    pointer(hwnd, WM_MOUSEMOVE, from, false);
    pointer(hwnd, WM_LBUTTONDOWN, from, true);
    pointer(hwnd, WM_MOUSEMOVE, to, true);
}

fn escape(hwnd: HWND) {
    for (message, bits) in [(WM_KEYDOWN, 0x0001_0001), (WM_KEYUP, 0xc001_0001_u32)] {
        unsafe {
            // SAFETY: real child on this UI thread; LPARAM carries the Escape scan code.
            SendMessageW(
                hwnd,
                message,
                Some(WPARAM(usize::from(VK_ESCAPE.0))),
                Some(LPARAM(bits as isize)),
            );
        }
        pump_for(Duration::from_millis(25));
    }
}

fn focus(hwnd: HWND) {
    unsafe {
        // SAFETY: the off-screen parent/child are live on this native UI thread.
        let _ = SetFocus(Some(hwnd));
    }
    pump_for(Duration::from_millis(80));
    assert_eq!(
        unsafe {
            // SAFETY: query this test thread's focus after the real transfer.
            GetFocus()
        },
        hwnd,
        "native focus transfer must succeed"
    );
}

fn pump_once() {
    let mut message = MSG::default();
    for _ in 0..256 {
        unsafe {
            // SAFETY: this pumps only messages owned by the current native UI thread.
            if !PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                break;
            }
            if message.message == 0x0402 {
                FRAME_TICKS.with(|ticks| ticks.set(ticks.get() + 1));
            } else if message.message == WM_MOUSELEAVE {
                eprintln!("native queued mouse-leave hwnd={:?}", message.hwnd);
            }
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

fn diagnostic_window(hwnd: HWND) {
    let mut class = [0_u16; 128];
    unsafe {
        // SAFETY: live child HWND and writable class-name storage on its UI thread.
        let length = GetClassNameW(hwnd, &mut class).max(0) as usize;
        eprintln!(
            "native child class={}, visible={}, dpi={}, focus={:?}",
            String::from_utf16_lossy(&class[..length]),
            IsWindowVisible(hwnd).as_bool(),
            GetDpiForWindow(hwnd),
            GetFocus(),
        );
    }
}

fn pump_for(duration: Duration) {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        pump_once();
        thread::sleep(Duration::from_millis(2));
    }
}

fn pump_until(mut ready: impl FnMut() -> bool, description: &str) {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        pump_once();
        if ready() {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {description}"
        );
        thread::sleep(Duration::from_millis(2));
    }
}

struct HiddenParent(HWND);

impl HiddenParent {
    fn new() -> Self {
        let _hosting = NativeEditorWindowContext::begin();
        let parent = unsafe {
            // SAFETY: built-in STATIC class; the window stays far off-screen,
            // has no taskbar entry and never activates on show or resize.
            CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("Heron EQ resize regression"),
                WS_POPUP | WS_CLIPCHILDREN | WS_VISIBLE,
                -32_000,
                -32_000,
                2200,
                1500,
                None,
                None,
                None,
                None,
            )
            .unwrap()
        };
        unsafe {
            // SAFETY: keep Windows' visible/focusable lifecycle while the
            // entire window remains outside the desktop's usable coordinates.
            let _ = ShowWindow(parent, SW_SHOWNOACTIVATE);
        }
        Self(parent)
    }
}

impl Drop for HiddenParent {
    fn drop(&mut self) {
        unsafe {
            // SAFETY: every plug-in view and container has already detached on this thread.
            let _ = DestroyWindow(self.0);
        }
    }
}

struct DpiContext(DPI_AWARENESS_CONTEXT);

impl DpiContext {
    fn new() -> Self {
        Self(unsafe {
            // SAFETY: changes only this test thread, and Drop restores its previous context.
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
        })
    }
}

impl Drop for DpiContext {
    fn drop(&mut self) {
        if !self.0.0.is_null() {
            unsafe {
                // SAFETY: restore the DPI context saved on this same test thread.
                SetThreadDpiAwarenessContext(self.0);
            }
        }
    }
}
