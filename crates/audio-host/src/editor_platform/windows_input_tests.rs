//! Witness mouse messages after the real native child resize/subclass chain.

use super::*;
use std::cell::RefCell;

const SPY_SUBCLASS_ID: usize = 2;
const STATIC: [u16; 7] = [83, 84, 65, 84, 73, 67, 0];

#[derive(Default)]
struct Spy {
    messages: RefCell<Vec<(Hwnd, u32, isize)>>,
}

unsafe extern "system" fn observe_plugin_input(
    hwnd: Hwnd,
    message: u32,
    wparam: usize,
    lparam: isize,
    _subclass_id: usize,
    reference_data: usize,
) -> isize {
    if matches!(message, WM_MOUSEMOVE | WM_LBUTTONDOWN | 0x0202) {
        let spy = unsafe {
            // SAFETY: the fixture owns this stable box until both child windows
            // and their subclass chains have been destroyed on this thread.
            &*(reference_data as *const Spy)
        };
        if let Ok(mut messages) = spy.messages.try_borrow_mut() {
            messages.push((hwnd, message, lparam));
        }
    }
    unsafe {
        // SAFETY: this callback is part of the live HWND's subclass chain.
        DefSubclassProc(hwnd, message, wparam, lparam)
    }
}

struct Fixture {
    parent: Hwnd,
    container: Option<Container>,
    children: Vec<Hwnd>,
    spy: Box<Spy>,
}

impl Fixture {
    fn new(platform_scaled: bool) -> Self {
        let instance = unsafe {
            // SAFETY: null requests the current process module handle.
            GetModuleHandleW(std::ptr::null())
        };
        let parent = unsafe {
            // SAFETY: STATIC is a terminated built-in class name. No WS_VISIBLE
            // bit is set, so this test creates no visible or interactive window.
            CreateWindowExW(
                0,
                STATIC.as_ptr(),
                std::ptr::null(),
                0,
                0,
                0,
                2000,
                1600,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                instance,
                std::ptr::null_mut(),
            )
        };
        assert!(!parent.is_null(), "hidden native parent window");
        let mut fixture = Self {
            parent,
            container: None,
            children: Vec::new(),
            spy: Box::default(),
        };
        fixture.container = Some(
            Container::create_with_parent(parent, instance, geometry(640, 480), platform_scaled)
                .expect("real Heron child container"),
        );
        fixture.add_plugin_child(640, 480);
        fixture
    }

    fn add_plugin_child(&mut self, width: u32, height: u32) -> Hwnd {
        let container = self.container.as_ref().unwrap();
        let instance = unsafe {
            // SAFETY: null requests the current process module handle.
            GetModuleHandleW(std::ptr::null())
        };
        let child = with_native_child_scale_context(container.platform_scaled, || unsafe {
            // SAFETY: the parent container HWND and terminated class name are
            // live. This child is also hidden and is destroyed by Fixture::drop.
            CreateWindowExW(
                0,
                STATIC.as_ptr(),
                std::ptr::null(),
                WS_CHILD,
                0,
                0,
                width as i32,
                height as i32,
                container.hwnd,
                std::ptr::null_mut(),
                instance,
                std::ptr::null_mut(),
            )
        });
        assert!(!child.is_null(), "hidden plug-in child");
        self.children.push(child);
        let moved = unsafe {
            // SAFETY: this same-thread child belongs to the live container. A
            // null insert-after means HWND_TOP; explicitly move replacement
            // children there so production GetWindow(GW_CHILD) selects them.
            SetWindowPos(
                child,
                std::ptr::null_mut(),
                0,
                0,
                width as i32,
                height as i32,
                SWP_NOACTIVATE,
            )
        };
        assert_ne!(moved, 0, "replacement plug-in child moved to front");
        let installed = unsafe {
            // SAFETY: Spy has a stable boxed address and outlives all child HWNDs.
            // Install BEFORE production resize, so Heron's subsequently installed
            // subclass ID1 forwards into this ID2 observer with its final LPARAM.
            SetWindowSubclass(
                child,
                Some(observe_plugin_input),
                SPY_SUBCLASS_ID,
                std::ptr::from_ref(self.spy.as_ref()) as usize,
            )
        };
        assert_ne!(installed, 0, "plug-in input observer subclass");
        child
    }

    fn resize(&mut self, width: u32, height: u32) -> Hwnd {
        let container = self.container.as_mut().unwrap();
        container.resize(geometry(width, height));
        let child = container.attached_view;
        assert!(!child.is_null());
        let mut rect = Rect::default();
        let found = unsafe {
            // SAFETY: the resize selected this live direct child HWND.
            GetClientRect(child, &mut rect)
        };
        assert_ne!(found, 0);
        assert_eq!(
            (rect.right - rect.left, rect.bottom - rect.top),
            (width as i32, height as i32),
            "production resize changed the real HWND extent"
        );
        child
    }

    fn assert_messages(&self, child: Hwnd, point: (i16, i16), expected: (i16, i16)) {
        self.spy.messages.borrow_mut().clear();
        for message in [WM_MOUSEMOVE, WM_LBUTTONDOWN, 0x0202] {
            unsafe {
                // SAFETY: SendMessage executes synchronously on this same owning
                // test thread. LPARAM encodes a normal signed Win32 client point.
                SendMessageW(child, message, 0, packed(point))
            };
        }
        let expected = packed(expected);
        assert_eq!(
            *self.spy.messages.borrow(),
            vec![
                (child, WM_MOUSEMOVE, expected),
                (child, WM_LBUTTONDOWN, expected),
                (child, 0x0202, expected)
            ],
            "the plug-in callback must receive the intended client-space point"
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for child in self.children.drain(..) {
            unsafe {
                // SAFETY: each HWND is owned by this fixture/current thread, and
                // destroying it removes subclasses before the Spy box is freed.
                DestroyWindow(child);
            }
        }
        drop(self.container.take());
        unsafe {
            // SAFETY: children/container were destroyed first; parent is owned
            // exclusively by this fixture and remains hidden throughout the test.
            DestroyWindow(self.parent);
        }
    }
}

fn geometry(width: u32, height: u32) -> NativeContainerGeometry {
    NativeContainerGeometry {
        x: 24,
        y: 40,
        parent_height: 1600,
        frame_width: width,
        frame_height: height,
        content_width: width,
        content_height: height,
    }
}

fn packed((x, y): (i16, i16)) -> isize {
    ((u32::from(y as u16) << 16) | u32::from(x as u16)) as isize
}

#[test]
fn native_reflow_mouse_coordinates_remain_identity_after_growth_shrink_and_same_extent_repeat() {
    let _context = EditorWindowContext::begin();
    let mut fixture = Fixture::new(false);
    for (width, height) in [
        (1280, 960),
        (1280, 960),
        (480, 360),
        (480, 360),
        (1040, 700),
    ] {
        let child = fixture.resize(width, height);
        fixture.assert_messages(child, (240, 160), (240, 160));
        fixture.assert_messages(child, (-40, -20), (-40, -20));
    }
}

#[test]
fn scaled_fallback_maps_original_content_and_preserves_mapping_on_same_extent_repeat() {
    let _context = EditorWindowContext::begin();
    let mut fixture = Fixture::new(true);
    for (width, height, point, expected) in [
        (1280, 960, (240, 160), (120, 80)),
        (1280, 960, (240, 160), (120, 80)),
        (960, 720, (300, 180), (200, 120)),
        (960, 720, (300, 180), (200, 120)),
        (1920, 1440, (300, 180), (100, 60)),
    ] {
        let child = fixture.resize(width, height);
        fixture.assert_messages(child, point, expected);
    }
}

#[test]
fn replacement_child_at_existing_extent_starts_with_its_own_mouse_coordinates() {
    let _context = EditorWindowContext::begin();
    for platform_scaled in [false, true] {
        let mut fixture = Fixture::new(platform_scaled);
        let old = fixture.resize(1280, 960);
        fixture.assert_messages(
            old,
            (240, 160),
            if platform_scaled {
                (120, 80)
            } else {
                (240, 160)
            },
        );
        // Keep the old HWND alive to avoid handle reuse; explicitly move the
        // new child to the front to represent the replacement plug-in window.
        let replacement = fixture.add_plugin_child(1280, 960);
        assert_ne!(replacement, old);
        assert_eq!(fixture.resize(1280, 960), replacement);
        fixture.assert_messages(replacement, (240, 160), (240, 160));
        assert_eq!(fixture.resize(1280, 960), replacement);
        fixture.assert_messages(replacement, (-40, -20), (-40, -20));
    }
}

#[link(name = "user32")]
unsafe extern "system" {
    fn SendMessageW(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize) -> isize;
}
