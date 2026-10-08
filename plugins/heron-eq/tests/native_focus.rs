//! Heron's native focus interruption must survive a message pumped during a frame.
#![cfg(target_os = "windows")]

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use baseview::{Event, EventStatus, Window, WindowEvent, WindowHandler, WindowOpenOptions};
use heron_audio_host::editor_platform::{NativeEditorWindowContext, NativeUiContext};
use raw_window_handle_05::{HasRawWindowHandle, RawWindowHandle, Win32WindowHandle};
use windows::{
    Win32::{
        Foundation::HWND,
        UI::{
            Input::KeyboardAndMouse::{GetFocus, SetFocus},
            WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, DispatchMessageW, MSG, PM_REMOVE, PeekMessageW,
                TranslateMessage, WS_CLIPCHILDREN, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
                WS_VISIBLE,
            },
        },
    },
    core::w,
};

#[derive(Clone, Debug, PartialEq, Eq)]
enum Callback {
    FrameStarted,
    FrameFinished,
    Focus { focused: bool, during_frame: bool },
}

#[derive(Default)]
struct Probe {
    armed: AtomicBool,
    callbacks: Mutex<Vec<Callback>>,
    focus_transfers: Mutex<Option<(bool, bool)>>,
}

struct Handler {
    parent: usize,
    probe: Arc<Probe>,
    during_frame: bool,
}

impl WindowHandler for Handler {
    fn on_frame(&mut self, window: &mut Window) {
        if !self.probe.armed.swap(false, Ordering::AcqRel) {
            return;
        }
        self.during_frame = true;
        self.probe
            .callbacks
            .lock()
            .unwrap()
            .push(Callback::FrameStarted);
        let RawWindowHandle::Win32(child) = window.raw_window_handle() else {
            return;
        };
        let parent = HWND(self.parent as *mut _);
        let child = HWND(child.hwnd);
        let transfers = unsafe {
            // SAFETY: both HWNDs belong to this UI thread and remain live through
            // the callback. SetFocus synchronously re-enters the child window
            // procedure while baseview still owns this handler's mutable borrow.
            let _ = SetFocus(Some(parent));
            let lost = GetFocus() == parent;
            let _ = SetFocus(Some(child));
            (lost, GetFocus() == child)
        };
        *self.probe.focus_transfers.lock().unwrap() = Some(transfers);
        self.probe
            .callbacks
            .lock()
            .unwrap()
            .push(Callback::FrameFinished);
        self.during_frame = false;
    }

    fn on_event(&mut self, _: &mut Window, event: Event) -> EventStatus {
        let focused = match event {
            Event::Window(WindowEvent::Focused) => true,
            Event::Window(WindowEvent::Unfocused) => false,
            _ => return EventStatus::Ignored,
        };
        self.probe.callbacks.lock().unwrap().push(Callback::Focus {
            focused,
            during_frame: self.during_frame,
        });
        EventStatus::Captured
    }
}

#[test]
fn native_focus_interruption_is_delivered_once_after_the_active_frame() {
    let _ui = NativeUiContext::initialize().expect("initialize native editor UI thread");
    let parent = Parent::new();
    let probe = Arc::new(Probe::default());
    let builder_probe = Arc::clone(&probe);
    let parent_address = parent.0.0 as usize;
    let child = Window::open_parented(
        &parent,
        WindowOpenOptions::new().with_title("Heron focus interruption regression"),
        move |_| Handler {
            parent: parent_address,
            probe: builder_probe,
            during_frame: false,
        },
    );
    let mut window = NativeWindow {
        child,
        _parent: parent,
    };
    let RawWindowHandle::Win32(child) = window.child.raw_window_handle() else {
        panic!("native editor must have a Windows child handle");
    };
    let child = HWND(child.hwnd);
    unsafe {
        // SAFETY: establish actual keyboard focus on the live test child before
        // arming a frame; these initialization events are outside the regression.
        let _ = SetFocus(Some(child));
    }
    pump_until(
        || unsafe {
            // SAFETY: query focus on the UI thread that owns the live child.
            GetFocus() == child
        },
        "initial child keyboard focus",
    );
    probe.callbacks.lock().unwrap().clear();

    probe.armed.store(true, Ordering::Release);
    pump_until(
        || probe.focus_transfers.lock().unwrap().is_some(),
        "focus transfer within on_frame",
    );

    let focus_transfers = *probe.focus_transfers.lock().unwrap();
    let callbacks = probe.callbacks.lock().unwrap().clone();
    assert_eq!(focus_transfers, Some((true, true)));
    assert_eq!(
        callbacks,
        vec![
            Callback::FrameStarted,
            Callback::FrameFinished,
            Callback::Focus {
                focused: false,
                during_frame: false
            },
            Callback::Focus {
                focused: true,
                during_frame: false
            },
        ],
        "native loss/gain must remain ordered, occur exactly once and follow the frame borrow",
    );
    window.close();
}

struct Parent(HWND);

impl Parent {
    fn new() -> Self {
        let _hosting = NativeEditorWindowContext::begin();
        Self(unsafe {
            // SAFETY: the built-in STATIC class creates an off-screen parent
            // owned by this UI thread; showing it does not activate another app.
            CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("Heron native focus regression"),
                WS_POPUP | WS_CLIPCHILDREN | WS_VISIBLE,
                -32_000,
                -32_000,
                500,
                400,
                None,
                None,
                None,
                None,
            )
            .expect("create native focus parent")
        })
    }
}

// SAFETY: Parent owns this HWND until Drop and is only used on its UI thread.
unsafe impl HasRawWindowHandle for Parent {
    fn raw_window_handle(&self) -> RawWindowHandle {
        let mut handle = Win32WindowHandle::empty();
        handle.hwnd = self.0.0;
        RawWindowHandle::Win32(handle)
    }
}

impl Drop for Parent {
    fn drop(&mut self) {
        unsafe {
            // SAFETY: parent remains live on its UI thread; Windows also
            // destroys any child left attached after an assertion failure.
            let _ = DestroyWindow(self.0);
        }
    }
}

struct NativeWindow {
    child: baseview::WindowHandle,
    _parent: Parent,
}

impl NativeWindow {
    fn close(&mut self) {
        self.child.close();
        pump_until(|| !self.child.is_open(), "native focus child destruction");
    }
}

impl Drop for NativeWindow {
    fn drop(&mut self) {
        // Closing posts a native message. The parent remains alive until Drop
        // returns and provides synchronous child cleanup if the test panics.
        self.child.close();
        pump_once();
    }
}

fn pump_once() {
    let mut message = MSG::default();
    for _ in 0..256 {
        unsafe {
            // SAFETY: retrieve and dispatch only this test UI thread's messages.
            if !PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                break;
            }
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
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
        thread::yield_now();
    }
}
