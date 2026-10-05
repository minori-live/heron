//! macOS native-container keyboard regression. Run in a logged-in desktop:
//! `cargo run -p heron-audio-host --example native_editor_keyboard_smoke`.
//! This checks key-window eligibility and synthetic native text input. Actual
//! foreground activation needs a manual check in Electron. The entry point keeps
//! all AppKit operations on the process main thread.

#[cfg(target_os = "macos")]
fn main() {
    macos::run();
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("native editor keyboard smoke requires macOS");
}

#[cfg(target_os = "macos")]
mod macos {
    use heron_audio_host::editor_platform::{
        NativeContainer, NativeContainerGeometry, NativeParentHandle,
    };
    use std::ffi::{CStr, c_char, c_void};

    type Id = *mut c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Point {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        origin: Point,
        size: Point,
    }

    // Every call supplies the selector's concrete ABI. The smoke owns all
    // instances and executes on main; borrowed objects stay inside the pool.
    macro_rules! message {
        ($receiver:expr, $selector:literal, ($($value:expr => $arg:ty),*), $result:ty) => {{
            // SAFETY: each invocation uses the documented AppKit selector ABI;
            // receivers and arguments remain live for this main-thread call.
            unsafe {
                let function: unsafe extern "C" fn(Id, Id, $($arg),*) -> $result =
                    std::mem::transmute(objc_msgSend as *const ());
                function($receiver, sel_registerName($selector.as_ptr()), $($value),*)
            }
        }};
    }

    fn class(name: &CStr) -> Id {
        // SAFETY: name is a valid, null-terminated class name.
        let class = unsafe { objc_getClass(name.as_ptr()) };
        assert!(!class.is_null());
        class
    }

    pub(super) fn run() {
        let pool = message!(class(c"NSAutoreleasePool"), c"new", (), Id);
        message!(class(c"NSApplication"), c"sharedApplication", (), Id);
        let frame = Rect {
            origin: Point { x: 0.0, y: 0.0 },
            size: Point { x: 320.0, y: 200.0 },
        };
        let allocated = message!(class(c"NSWindow"), c"alloc", (), Id);
        let parent_window = message!(
            allocated,
            c"initWithContentRect:styleMask:backing:defer:",
            (frame => Rect, 1 => usize, 2 => usize, 0 => c_char),
            Id
        );
        assert!(!parent_window.is_null());
        message!(parent_window, c"setReleasedWhenClosed:", (0 => c_char), ());
        message!(parent_window, c"orderFront:", (std::ptr::null_mut() => Id), ());
        let parent_view = message!(parent_window, c"contentView", (), Id);
        // SAFETY: parent_window owns this content view and is retained until
        // the native container is dropped. All calls run on the AppKit thread.
        let parent = unsafe { NativeParentHandle::from_raw(parent_view as usize) }.unwrap();
        let container = NativeContainer::create_for_parent(
            parent,
            NativeContainerGeometry {
                x: 0,
                y: 0,
                parent_height: 200,
                frame_width: 320,
                frame_height: 200,
                content_width: 320,
                content_height: 200,
            },
            false,
        )
        .unwrap()
        .unwrap();
        let allocated = message!(class(c"NSTextField"), c"alloc", (), Id);
        let field = message!(allocated, c"initWithFrame:", (frame => Rect), Id);
        assert!(!field.is_null());
        message!(container.attach_handle(), c"addSubview:", (field => Id), ());

        container.focus();
        let child_window = message!(container.attach_handle(), c"window", (), Id);
        assert_eq!(
            message!(child_window, c"canBecomeKeyWindow", (), c_char),
            1,
            "plug-in surface must allow keyboard focus"
        );
        assert_eq!(
            message!(child_window, c"canBecomeMainWindow", (), c_char),
            0
        );
        assert!(!message!(field, c"currentEditor", (), Id).is_null());

        let chars = message!(class(c"NSString"), c"stringWithUTF8String:", (c"7".as_ptr() => *const c_char), Id);
        let number = message!(child_window, c"windowNumber", (), isize);
        let event = message!(
            class(c"NSEvent"),
            c"keyEventWithType:location:modifierFlags:timestamp:windowNumber:context:characters:charactersIgnoringModifiers:isARepeat:keyCode:",
            (
                10 => usize,
                Point { x: 0.0, y: 0.0 } => Point,
                0 => usize,
                0.0 => f64,
                number => isize,
                std::ptr::null_mut() => Id,
                chars => Id,
                chars => Id,
                0 => c_char,
                26 => u16
            ),
            Id
        );
        assert!(!event.is_null());
        message!(child_window, c"sendEvent:", (event => Id), ());
        let editor = message!(field, c"currentEditor", (), Id);
        let value = message!(editor, c"string", (), Id);
        let utf8 = message!(value, c"UTF8String", (), *const c_char);
        // SAFETY: UTF8String is owned by value and remains live inside this pool.
        assert_eq!(unsafe { CStr::from_ptr(utf8) }, c"7");

        drop(container);
        message!(field, c"release", (), ());
        message!(parent_window, c"close", (), ());
        message!(parent_window, c"release", (), ());
        message!(pool, c"drain", (), ());
        println!("native editor keyboard smoke passed (key eligibility and text input)");
    }

    #[link(name = "AppKit", kind = "framework")]
    unsafe extern "C" {}

    #[link(name = "objc")]
    unsafe extern "C" {
        fn objc_getClass(name: *const c_char) -> Id;
        fn sel_registerName(name: *const c_char) -> Id;
        fn objc_msgSend();
    }
}
