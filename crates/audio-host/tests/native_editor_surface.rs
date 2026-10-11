//! Windows plug-in surfaces must escape the owner's compositor and retain its lifecycle.
#![cfg(target_os = "windows")]

use std::cell::{Cell, RefCell};

use heron_audio_host::editor_platform::{
    NativeContainer, NativeContainerGeometry, NativeEditorWindowContext, NativeParentHandle,
};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Gdi::ClientToScreen,
        UI::{
            Input::KeyboardAndMouse::GetFocus,
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, DispatchMessageW, GW_OWNER, GWL_EXSTYLE, GWL_STYLE,
                GetWindow, GetWindowLongPtrW, GetWindowRect, IsWindow, IsWindowVisible, MSG,
                PM_REMOVE, PeekMessageW, SW_HIDE, SW_MINIMIZE, SW_RESTORE, SW_SHOWNOACTIVATE,
                SWP_NOACTIVATE, SWP_NOZORDER, SendMessageW, SetWindowPos, ShowWindow,
                TranslateMessage, WM_CLOSE, WS_CHILD, WS_EX_APPWINDOW, WS_EX_NOACTIVATE,
                WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_OVERLAPPEDWINDOW, WS_POPUP, WS_VISIBLE,
            },
        },
    },
    core::w,
};

thread_local! {
    static OWNER_CLOSE_REQUESTS: Cell<usize> = const { Cell::new(0) };
    static CLOSE_SURFACE: RefCell<Option<NativeContainer>> = const { RefCell::new(None) };
}
const OWNER_CLOSE_SUBCLASS: usize = 1;

#[test]
fn native_surface_retains_owner_geometry_visibility_focus_and_cleanup() {
    let owner = OwnerWindow::new();
    let parent = unsafe {
        // SAFETY: owner remains live until every container drops, on this same UI thread.
        NativeParentHandle::from_raw(owner.0.0 as usize).expect("non-null owner HWND")
    };
    let mut geometry = NativeContainerGeometry {
        x: 7,
        y: 60,
        parent_height: 420,
        frame_width: 460,
        frame_height: 320,
        content_width: 460,
        content_height: 320,
    };
    let mut container = NativeContainer::create_for_parent(parent, geometry, false)
        .expect("create native editor surface")
        .expect("Windows native editor surface");
    let surface = HWND(container.attach_handle());

    unsafe {
        // SAFETY: both HWNDs are live and belong to the current test thread.
        let style = GetWindowLongPtrW(surface, GWL_STYLE) as u32;
        assert_eq!(
            style & WS_CHILD.0,
            0,
            "a child surface is occluded by Electron's DirectComposition visual"
        );
        assert_ne!(style & WS_POPUP.0, 0, "native surface needs its own visual");
        assert_eq!(GetWindow(surface, GW_OWNER).unwrap(), owner.0);
        let extended_style = GetWindowLongPtrW(surface, GWL_EXSTYLE) as u32;
        assert_ne!(extended_style & WS_EX_TOOLWINDOW.0, 0);
        assert_eq!(extended_style & WS_EX_APPWINDOW.0, 0);
        assert_eq!(extended_style & WS_EX_TOPMOST.0, 0);
        assert_eq!(
            extended_style & WS_EX_NOACTIVATE.0,
            0,
            "plug-in controls must remain eligible for keyboard focus"
        );
        assert!(!IsWindowVisible(surface).as_bool());
    }

    owner.show(SW_SHOWNOACTIVATE);
    assert_visible(surface, true);
    assert_geometry(surface, owner.0, geometry);
    owner.move_to(120, 150);
    assert_geometry(surface, owner.0, geometry);

    geometry.x = 0;
    geometry.y = 96;
    geometry.frame_width = 430;
    geometry.frame_height = 280;
    geometry.content_width = 430;
    geometry.content_height = 280;
    container.resize(geometry);
    assert_geometry(surface, owner.0, geometry);

    owner.show(SW_HIDE);
    assert_visible(surface, false);
    owner.move_to(70, 85);
    owner.show(SW_SHOWNOACTIVATE);
    assert_visible(surface, true);
    assert_geometry(surface, owner.0, geometry);

    owner.show(SW_MINIMIZE);
    assert_visible(surface, false);
    owner.show(SW_RESTORE);
    assert_visible(surface, true);
    assert_geometry(surface, owner.0, geometry);

    container.focus();
    unsafe {
        // SAFETY: focus is queried on the same thread that owns both windows.
        assert_eq!(GetFocus(), surface);
    }
    let plugin_view = unsafe {
        // SAFETY: this child stands in for a plug-in view; the surface owns its lifetime.
        CreateWindowExW(
            Default::default(),
            w!("STATIC"),
            w!("Native plug-in view"),
            WS_CHILD | WS_VISIBLE,
            0,
            0,
            80,
            20,
            Some(surface),
            None,
            None,
            None,
        )
        .expect("create plug-in view fixture")
    };
    container.focus();
    unsafe {
        // SAFETY: the view is live, and GetFocus observes this test thread's focus.
        assert_eq!(
            GetFocus(),
            plugin_view,
            "focus must reach the plug-in controls"
        );
    }
    unsafe {
        // SAFETY: both windows are live; the owner fixture records close without destruction.
        SendMessageW(surface, WM_CLOSE, None, None);
        assert_eq!(OWNER_CLOSE_REQUESTS.get(), 1);
        assert!(IsWindow(Some(owner.0)).as_bool());
        assert!(IsWindow(Some(surface)).as_bool());
    }
    // The real owner close callback may detach and destroy the surface before
    // its original WM_CLOSE handler returns. Keep that reentrant path covered.
    CLOSE_SURFACE.with(|slot| *slot.borrow_mut() = Some(container));
    unsafe {
        // SAFETY: the owner remains alive while its callback drops the retained surface.
        SendMessageW(surface, WM_CLOSE, None, None);
        assert_eq!(OWNER_CLOSE_REQUESTS.get(), 2);
        // SAFETY: IsWindow accepts retired handles; the owner is still live.
        assert!(!IsWindow(Some(surface)).as_bool());
        assert!(!IsWindow(Some(plugin_view)).as_bool());
        assert!(IsWindow(Some(owner.0)).as_bool());
    }

    // These owner callbacks must remain safe after the surface state is freed.
    owner.move_to(30, 40);
    owner.show(SW_HIDE);
    owner.show(SW_SHOWNOACTIVATE);
    let replacement = NativeContainer::create_for_parent(parent, geometry, false)
        .expect("reopen native editor surface")
        .expect("replacement Windows surface");
    let replacement_surface = HWND(replacement.attach_handle());
    assert_visible(replacement_surface, true);
    owner.move_to(80, 100);
    assert_geometry(replacement_surface, owner.0, geometry);
    drop(replacement);
    owner.move_to(30, 40);
    owner.show(SW_HIDE);
}

struct OwnerWindow(HWND);

impl OwnerWindow {
    fn new() -> Self {
        let _context = NativeEditorWindowContext::begin();
        let hwnd = unsafe {
            // SAFETY: STATIC is a system class; strings are static and there is no payload.
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("Heron native editor surface test"),
                WS_OVERLAPPEDWINDOW,
                30,
                40,
                500,
                460,
                None,
                None,
                None,
                None,
            )
            .expect("create owner fixture")
        };
        OWNER_CLOSE_REQUESTS.set(0);
        unsafe {
            // SAFETY: fixture callback has no borrowed state and remains installed until Drop.
            assert!(SetWindowSubclass(hwnd, Some(owner_close), OWNER_CLOSE_SUBCLASS, 0).as_bool());
        }
        Self(hwnd)
    }

    fn show(&self, command: windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD) {
        unsafe {
            // SAFETY: this guard owns a live window on the current thread.
            let _ = ShowWindow(self.0, command);
        }
        pump_messages();
    }

    fn move_to(&self, x: i32, y: i32) {
        unsafe {
            // SAFETY: this guard owns a live window and dimensions remain positive.
            SetWindowPos(self.0, None, x, y, 500, 460, SWP_NOACTIVATE | SWP_NOZORDER)
                .expect("move owner fixture");
        }
        pump_messages();
    }
}

impl Drop for OwnerWindow {
    fn drop(&mut self) {
        unsafe {
            // SAFETY: every native surface has dropped before the fixture owner.
            let _ = RemoveWindowSubclass(self.0, Some(owner_close), OWNER_CLOSE_SUBCLASS);
            let _ = DestroyWindow(self.0);
        }
    }
}

unsafe extern "system" fn owner_close(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _reference_data: usize,
) -> LRESULT {
    if message == WM_CLOSE {
        OWNER_CLOSE_REQUESTS.set(OWNER_CLOSE_REQUESTS.get() + 1);
        let closing = CLOSE_SURFACE.with(|slot| slot.borrow_mut().take());
        drop(closing);
        return LRESULT(0);
    }
    unsafe {
        // SAFETY: this fixture forwards the live HWND's original subclass message unchanged.
        DefSubclassProc(hwnd, message, wparam, lparam)
    }
}

fn assert_visible(hwnd: HWND, visible: bool) {
    unsafe {
        // SAFETY: every caller retains its container while querying this handle.
        assert_eq!(IsWindowVisible(hwnd).as_bool(), visible);
    }
}

fn assert_geometry(surface: HWND, owner: HWND, geometry: NativeContainerGeometry) {
    let mut origin = POINT::default();
    let mut bounds = RECT::default();
    unsafe {
        // SAFETY: both handles are live; origin and bounds are valid writable outputs.
        assert!(ClientToScreen(owner, &mut origin).as_bool());
        GetWindowRect(surface, &mut bounds).expect("native surface bounds");
    }
    assert_eq!(
        (bounds.left, bounds.top),
        (origin.x + geometry.x, origin.y + geometry.y)
    );
    assert_eq!(
        (bounds.right - bounds.left, bounds.bottom - bounds.top),
        (geometry.frame_width as i32, geometry.frame_height as i32)
    );
}

fn pump_messages() {
    let mut message = MSG::default();
    unsafe {
        // SAFETY: this thread dispatches messages only while its fixture windows are live.
        while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}
