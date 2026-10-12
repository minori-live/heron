//! Own a redirected Win32 surface separately from Chromium's composition HWND.
//!
//! A WGL plug-in child cannot reliably present through Chromium's unredirected
//! parent. An owned popup gives it its own DWM surface while Win32 keeps it in
//! the editor owner's window group, without making it globally topmost.

use std::{cell::Cell, rc::Rc};

use super::{
    CreateWindowExW, DefSubclassProc, DestroyWindow, GetClientRect, GetWindow, Hinstance, Hwnd,
    NativeContainerGeometry, Point, Rect, SWP_NOACTIVATE, SWP_NOZORDER, SetFocus, SetWindowPos,
    SetWindowSubclass, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, c_void,
};

const WS_POPUP: u32 = 0x8000_0000;
const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
const SWP_SHOWWINDOW: u32 = 0x0040;
const SWP_HIDEWINDOW: u32 = 0x0080;
const SWP_NOOWNERZORDER: u32 = 0x0200;
const WM_SIZE: u32 = 0x0005;
const WM_SETFOCUS: u32 = 0x0007;
const WM_CLOSE: u32 = 0x0010;
const WM_SHOWWINDOW: u32 = 0x0018;
const WM_WINDOWPOSCHANGED: u32 = 0x0047;
const WM_NCDESTROY: u32 = 0x0082;
const WM_DPICHANGED: u32 = 0x02E0;
const STATIC: [u16; 7] = [83, 84, 65, 84, 73, 67, 0];

type SubclassProc = unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize;

/// All access is confined to the owner HWND's UI thread. Rc also prevents this
/// surface from being sent to another thread; Cell permits nested Win32 calls.
pub(super) struct Surface {
    state: Rc<SurfaceState>,
}

struct SurfaceState {
    owner: Cell<Hwnd>,
    window: Cell<Hwnd>,
    geometry: Cell<NativeContainerGeometry>,
    owner_subclass: Cell<bool>,
    window_subclass: Cell<bool>,
    synchronizing: Cell<bool>,
}

impl Surface {
    pub(super) fn create(
        owner: Hwnd,
        instance: Hinstance,
        geometry: NativeContainerGeometry,
    ) -> Result<Self, String> {
        let surface = Self {
            state: Rc::new(SurfaceState {
                owner: Cell::new(owner),
                window: Cell::new(std::ptr::null_mut()),
                geometry: Cell::new(geometry),
                owner_subclass: Cell::new(false),
                window_subclass: Cell::new(false),
                synchronizing: Cell::new(false),
            }),
        };
        let _dpi = OwnerDpiContext::begin(owner);
        // The top-level surface must opt into mixed hosting itself, so legacy
        // DPI-unaware plug-in children retain the platform scaling fallback.
        let _hosting = super::EditorWindowContext::begin();
        let hwnd = unsafe {
            // SAFETY: STATIC is a built-in class; owner is retained by the editor.
            // With WS_POPUP, the parent argument establishes ownership, not a
            // child/compositor relationship. Start hidden until synchronization.
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                STATIC.as_ptr(),
                std::ptr::null(),
                WS_POPUP | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                0,
                0,
                extent(geometry.frame_width),
                extent(geometry.frame_height),
                owner,
                std::ptr::null_mut(),
                instance,
                std::ptr::null_mut(),
            )
        };
        if hwnd.is_null() {
            return Err(format!(
                "CreateWindowExW failed for plug-in editor surface: {}",
                std::io::Error::last_os_error()
            ));
        }
        surface.state.window.set(hwnd);
        let reference = Rc::as_ptr(&surface.state) as usize;
        let installed = unsafe {
            // SAFETY: the Rc allocation remains alive through subclass removal;
            // the reference is also a unique subclass ID for this attachment.
            SetWindowSubclass(hwnd, Some(surface_subclass), reference, reference)
        };
        if installed == 0 {
            return Err("could not observe plug-in editor surface lifecycle".into());
        }
        surface.state.window_subclass.set(true);
        let installed = unsafe {
            // SAFETY: same UI thread and retained state as the surface subclass.
            SetWindowSubclass(owner, Some(owner_subclass), reference, reference)
        };
        if installed == 0 {
            return Err("could not observe plug-in editor owner lifecycle".into());
        }
        surface.state.owner_subclass.set(true);
        surface.state.synchronize();
        Ok(surface)
    }

    pub(super) fn handle(&self) -> Hwnd {
        self.state.window.get()
    }

    pub(super) fn resize(&self, geometry: NativeContainerGeometry) {
        let state = Rc::clone(&self.state);
        state.geometry.set(geometry);
        state.synchronize();
    }

    pub(super) fn focus(&self) {
        let state = Rc::clone(&self.state);
        let hwnd = state.window.get();
        if hwnd.is_null() {
            return;
        }
        // SAFETY: the live same-thread surface may become active for native text
        // input. Owned-window activation does not create a topmost window.
        unsafe { SetActiveWindow(hwnd) };
        state.focus_plugin();
    }
}

impl Drop for Surface {
    fn drop(&mut self) {
        let reference = Rc::as_ptr(&self.state) as usize;
        let owner = self.state.owner.replace(std::ptr::null_mut());
        if !owner.is_null() && self.state.owner_subclass.replace(false) {
            // SAFETY: removes this attachment's callback before releasing its Rc.
            unsafe { RemoveWindowSubclass(owner, Some(owner_subclass), reference) };
        }
        let hwnd = self.state.window.replace(std::ptr::null_mut());
        if !hwnd.is_null() {
            if self.state.window_subclass.replace(false) {
                // SAFETY: this same-thread window is still live until destruction.
                unsafe { RemoveWindowSubclass(hwnd, Some(surface_subclass), reference) };
            }
            // SAFETY: the surface exclusively owns this HWND; its plug-in view
            // has detached before NativeContainer is dropped.
            unsafe { DestroyWindow(hwnd) };
        }
    }
}

impl SurfaceState {
    fn synchronize(&self) {
        let owner = self.owner.get();
        let hwnd = self.window.get();
        if owner.is_null() || hwnd.is_null() || self.synchronizing.replace(true) {
            return;
        }
        let _reset = SynchronizingGuard(&self.synchronizing);
        let _dpi = OwnerDpiContext::begin(owner);
        let geometry = self.geometry.get();
        let mut origin = Point { x: 0, y: 0 };
        let mut client = Rect::default();
        let positioned = unsafe {
            // SAFETY: both HWNDs and output records are live on the owning thread.
            ClientToScreen(owner, &mut origin) != 0 && GetClientRect(owner, &mut client) != 0
        };
        if !positioned {
            return;
        }
        let available_width = client.right.saturating_sub(geometry.x).max(0);
        let available_height = client.bottom.saturating_sub(geometry.y).max(0);
        let visible = unsafe {
            // SAFETY: querying the owner does not mutate its lifetime.
            IsWindowVisible(owner) != 0 && IsIconic(owner) == 0
        } && available_width > 0
            && available_height > 0;
        // Clip to the current owner client area while Electron is still handling
        // a native resize. Its next layout supplies the final plug-in extent.
        let width = extent(geometry.frame_width).min(available_width.max(1));
        let height = extent(geometry.frame_height).min(available_height.max(1));
        let flags = SWP_NOACTIVATE
            | SWP_NOZORDER
            | SWP_NOOWNERZORDER
            | if visible {
                SWP_SHOWWINDOW
            } else {
                SWP_HIDEWINDOW
            };
        unsafe {
            // SAFETY: coordinates are in the owner's DPI context (physical pixels
            // for Electron's per-monitor-aware HWND). Win32 ownership maintains
            // ordering above the owner without raising it over another app.
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                origin.x.saturating_add(geometry.x),
                origin.y.saturating_add(geometry.y),
                width,
                height,
                flags,
            );
        }
    }

    fn focus_plugin(&self) {
        let hwnd = self.window.get();
        if hwnd.is_null() {
            return;
        }
        unsafe {
            // SAFETY: queries and focus changes stay in this surface's live HWND
            // subtree. Preserve an already focused native text/control child.
            let focused = GetFocus();
            if !focused.is_null() && IsChild(hwnd, focused) != 0 {
                return;
            }
            let child = GetWindow(hwnd, super::GW_CHILD);
            if !child.is_null() {
                SetFocus(child);
            } else if focused != hwnd {
                SetFocus(hwnd);
            }
        }
    }
}

struct SynchronizingGuard<'a>(&'a Cell<bool>);

impl Drop for SynchronizingGuard<'_> {
    fn drop(&mut self) {
        self.0.set(false);
    }
}

/// Win32 enters window procedures in that window's DPI context. Mirror the
/// owner's context for direct resize calls too, then restore the caller.
struct OwnerDpiContext(*mut c_void);

impl OwnerDpiContext {
    fn begin(owner: Hwnd) -> Self {
        unsafe {
            // SAFETY: owner is live and these changes apply only to this thread.
            let context = GetWindowDpiAwarenessContext(owner);
            Self(if context.is_null() {
                std::ptr::null_mut()
            } else {
                SetThreadDpiAwarenessContext(context)
            })
        }
    }
}

impl Drop for OwnerDpiContext {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: balances the successful context switch on this UI thread.
            unsafe { SetThreadDpiAwarenessContext(self.0) };
        }
    }
}

fn extent(value: u32) -> i32 {
    value.clamp(1, i32::MAX as u32) as i32
}

/// # Safety
/// `reference_data` must identify the live Rc allocation installed by Surface.
unsafe fn retain_state(reference_data: usize) -> Rc<SurfaceState> {
    let pointer = reference_data as *const SurfaceState;
    // SAFETY: the installed subclass guarantees one live Surface-owned Rc at
    // callback entry. Retain before calling Win32/Electron, which can close and
    // drop the Surface synchronously while this callback is still unwinding.
    unsafe { Rc::increment_strong_count(pointer) };
    // SAFETY: the increment above transfers exactly one reference to this guard.
    unsafe { Rc::from_raw(pointer) }
}

unsafe extern "system" fn owner_subclass(
    hwnd: Hwnd,
    message: u32,
    wparam: usize,
    lparam: isize,
    subclass_id: usize,
    reference_data: usize,
) -> isize {
    // SAFETY: this callback is installed only with a live SurfaceState reference.
    let state = unsafe { retain_state(reference_data) };
    if message == WM_NCDESTROY {
        state.owner.set(std::ptr::null_mut());
        state.owner_subclass.set(false);
        // SAFETY: sever this callback before the owner HWND can be recycled.
        unsafe { RemoveWindowSubclass(hwnd, Some(owner_subclass), subclass_id) };
    }
    // SAFETY: forward the original message through the live subclass chain. The
    // retained Rc remains valid even if this destroys the entire editor.
    let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
    if matches!(
        message,
        WM_WINDOWPOSCHANGED | WM_SHOWWINDOW | WM_SIZE | WM_DPICHANGED
    ) {
        state.synchronize();
    }
    result
}

unsafe extern "system" fn surface_subclass(
    hwnd: Hwnd,
    message: u32,
    wparam: usize,
    lparam: isize,
    subclass_id: usize,
    reference_data: usize,
) -> isize {
    // SAFETY: this callback is installed only with a live SurfaceState reference.
    let state = unsafe { retain_state(reference_data) };
    if message == WM_CLOSE {
        let owner = state.owner.get();
        if !owner.is_null() {
            // SAFETY: request the owner's normal close/plug-in-detach workflow;
            // do not independently destroy an HWND with an attached native view.
            unsafe { SendMessageW(owner, WM_CLOSE, 0, 0) };
        }
        return 0;
    }
    if message == WM_NCDESTROY {
        state.window.set(std::ptr::null_mut());
        state.window_subclass.set(false);
        // SAFETY: remove our callback while hwnd still denotes this surface.
        unsafe { RemoveWindowSubclass(hwnd, Some(surface_subclass), subclass_id) };
    }
    // SAFETY: forwards the unchanged message to the next subclass/window proc.
    let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
    if message == WM_SETFOCUS {
        state.focus_plugin();
    }
    result
}

#[link(name = "comctl32")]
unsafe extern "system" {
    fn RemoveWindowSubclass(hwnd: Hwnd, procedure: Option<SubclassProc>, subclass_id: usize)
    -> i32;
}

#[link(name = "user32")]
unsafe extern "system" {
    fn ClientToScreen(hwnd: Hwnd, point: *mut Point) -> i32;
    fn IsWindowVisible(hwnd: Hwnd) -> i32;
    fn IsIconic(hwnd: Hwnd) -> i32;
    fn IsChild(parent: Hwnd, hwnd: Hwnd) -> i32;
    fn GetFocus() -> Hwnd;
    fn SetActiveWindow(hwnd: Hwnd) -> Hwnd;
    fn SendMessageW(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize) -> isize;
    fn GetWindowDpiAwarenessContext(hwnd: Hwnd) -> *mut c_void;
    fn SetThreadDpiAwarenessContext(context: *mut c_void) -> *mut c_void;
}
