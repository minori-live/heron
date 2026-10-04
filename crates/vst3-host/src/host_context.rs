use std::{
    cell::RefCell,
    collections::HashMap,
    ffi::c_void,
    os::raw::c_char,
    path::{Path, PathBuf},
    rc::{Rc, Weak},
    sync::atomic::{AtomicU32, Ordering},
};

use heron_vst3_host_sys::{
    Steinberg::{
        FUnknown,
        Vst::{IHostApplication, IPlugInterfaceSupport},
        tresult, uint32,
    },
    abi::{FUnknownVTable, HostApplicationVTable, PlugInterfaceSupportVTable},
    iid,
};

#[cfg(target_os = "linux")]
use crate::frame::RunLoopInterface;
use crate::host_objects::{HostAttributeList, HostMessage};

thread_local! {
    // Factories can retain one process-global host context across several loads
    // of the same binary. Keep its address stable until the final Module drops.
    static MODULE_CONTEXTS: RefCell<HashMap<PathBuf, Weak<HostContext>>> = RefCell::default();
}

#[repr(C)]
pub(crate) struct HostContext {
    vtable: *const HostApplicationVTable,
    references: AtomicU32,
    plug_interface_support: PlugInterfaceSupportObject,
    #[cfg(target_os = "linux")]
    run_loop: RunLoopInterface,
}

#[repr(C)]
struct PlugInterfaceSupportObject {
    vtable: *const PlugInterfaceSupportVTable,
    owner: *const HostContext,
}

impl HostContext {
    pub(crate) fn for_module(binary_path: &Path) -> Rc<Self> {
        let key = binary_path
            .canonicalize()
            .unwrap_or_else(|_| binary_path.to_owned());
        MODULE_CONTEXTS.with(|contexts| {
            let mut contexts = contexts.borrow_mut();
            contexts.retain(|_, context| context.strong_count() != 0);
            if let Some(context) = contexts.get(&key).and_then(Weak::upgrade) {
                return context;
            }
            let context = Self::new();
            contexts.insert(key, Rc::downgrade(&context));
            context
        })
    }

    fn new() -> Rc<Self> {
        let mut context = Rc::new(Self {
            vtable: &HOST_APPLICATION_VTABLE,
            references: AtomicU32::new(1),
            plug_interface_support: PlugInterfaceSupportObject {
                vtable: &PLUG_INTERFACE_SUPPORT_VTABLE,
                owner: std::ptr::null(),
            },
            #[cfg(target_os = "linux")]
            run_loop: RunLoopInterface::new(),
        });
        let owner = Rc::as_ptr(&context);
        Rc::get_mut(&mut context)
            .expect("new host context has no other owners")
            .plug_interface_support
            .owner = owner;
        context
    }

    pub(crate) fn as_unknown(&self) -> *mut FUnknown {
        std::ptr::from_ref(self).cast_mut().cast()
    }

    #[cfg(target_os = "linux")]
    pub(crate) fn dispatch_run_loop(&self, now: std::time::Instant) -> Option<std::time::Instant> {
        self.run_loop.dispatch(now)
    }
}

unsafe extern "system" fn query_interface(
    this: *mut FUnknown,
    requested: *const c_char,
    output: *mut *mut c_void,
) -> tresult {
    if requested.is_null() || output.is_null() {
        return -2147024809;
    }
    let requested = unsafe {
        // SAFETY: VST3 queryInterface always supplies a 16-byte TUID.
        std::slice::from_raw_parts(requested, 16)
    };
    if requested == iid::FUNKNOWN || requested == iid::IHOST_APPLICATION {
        unsafe {
            // SAFETY: output is validated above and this is the same leading
            // interface pointer for FUnknown and IHostApplication.
            output.write(this.cast());
            add_ref(this);
        }
        0
    } else if requested == iid::IRUN_LOOP {
        #[cfg(target_os = "linux")]
        {
            let context = this.cast::<HostContext>();
            unsafe {
                // SAFETY: this is HostContext's leading interface and its run loop has the same
                // stable boxed lifetime.
                output.write((*context).run_loop.retain_interface().cast());
            }
            0
        }
        #[cfg(not(target_os = "linux"))]
        {
            unsafe {
                // SAFETY: output is writable as validated above.
                output.write(std::ptr::null_mut());
            }
            -2147467262
        }
    } else if requested == iid::IPLUG_INTERFACE_SUPPORT {
        let context = this.cast::<HostContext>();
        unsafe {
            // SAFETY: this is HostContext's leading interface and the embedded support object is
            // stable for the same lifetime.
            output.write(std::ptr::addr_of_mut!((*context).plug_interface_support).cast());
            add_ref(this);
        }
        0
    } else {
        unsafe {
            // SAFETY: output is validated above.
            output.write(std::ptr::null_mut());
        }
        -2147467262
    }
}

unsafe extern "system" fn support_query_interface(
    this: *mut FUnknown,
    requested: *const c_char,
    output: *mut *mut c_void,
) -> tresult {
    if this.is_null() {
        return -2147024809;
    }
    let support = this.cast::<PlugInterfaceSupportObject>();
    let owner = unsafe {
        // SAFETY: this is the embedded support interface of a live HostContext.
        (*support).owner
    };
    if owner.is_null() {
        return -2147467262;
    }
    unsafe {
        // SAFETY: owner remains live with the embedded support object.
        query_interface(owner.cast_mut().cast(), requested, output)
    }
}

unsafe extern "system" fn support_add_ref(this: *mut FUnknown) -> uint32 {
    let support = this.cast::<PlugInterfaceSupportObject>();
    let owner = unsafe {
        // SAFETY: this is the embedded support interface of a live HostContext.
        (*support).owner
    };
    unsafe {
        // SAFETY: owner remains live with the embedded support object.
        add_ref(owner.cast_mut().cast())
    }
}

unsafe extern "system" fn support_release(this: *mut FUnknown) -> uint32 {
    let support = this.cast::<PlugInterfaceSupportObject>();
    let owner = unsafe {
        // SAFETY: this is the embedded support interface of a live HostContext.
        (*support).owner
    };
    unsafe {
        // SAFETY: owner remains live with the embedded support object.
        release(owner.cast_mut().cast())
    }
}

unsafe extern "system" fn is_plug_interface_supported(
    _this: *mut IPlugInterfaceSupport,
    requested: *const c_char,
) -> tresult {
    if requested.is_null() {
        return -2147024809;
    }
    let requested = unsafe {
        // SAFETY: VST3 supplies a 16-byte interface TUID.
        std::slice::from_raw_parts(requested, 16)
    };
    let supported = [
        iid::ICOMPONENT,
        iid::IAUDIO_PROCESSOR,
        iid::IAUDIO_PRESENTATION_LATENCY,
        iid::IEDIT_CONTROLLER,
        iid::IMIDI_MAPPING,
        iid::IUNIT_INFO,
        iid::ICONNECTION_POINT,
        iid::IPLUG_VIEW,
        iid::IPLUG_VIEW_CONTENT_SCALE_SUPPORT,
        iid::IPROCESS_CONTEXT_REQUIREMENTS,
    ];
    if supported.iter().any(|iid| requested == iid) {
        0
    } else {
        1
    }
}

unsafe extern "system" fn add_ref(this: *mut FUnknown) -> uint32 {
    let context = this.cast::<HostContext>();
    unsafe {
        // SAFETY: this points to HostContext's leading interface.
        (*context).references.fetch_add(1, Ordering::Relaxed) + 1
    }
}

unsafe extern "system" fn release(this: *mut FUnknown) -> uint32 {
    let context = this.cast::<HostContext>();
    unsafe {
        // SAFETY: ownership remains with StereoProcessor. Plug-ins may balance
        // temporary references but cannot destroy the host-owned object.
        (*context)
            .references
            .fetch_sub(1, Ordering::Release)
            .saturating_sub(1)
    }
}

unsafe extern "system" fn get_name(_this: *mut IHostApplication, name: *mut u16) -> tresult {
    if name.is_null() {
        return -2147024809;
    }
    let encoded = "Heron\0".encode_utf16();
    for (index, value) in encoded.enumerate() {
        unsafe {
            // SAFETY: VST3 String128 provides at least 128 UTF-16 elements.
            name.add(index).write(value);
        }
    }
    0
}

unsafe extern "system" fn create_instance(
    _this: *mut IHostApplication,
    class_id: *mut c_char,
    interface_id: *mut c_char,
    output: *mut *mut c_void,
) -> tresult {
    if class_id.is_null() || interface_id.is_null() || output.is_null() {
        return -2147024809;
    }
    let class_id = unsafe {
        // SAFETY: VST3 createInstance always supplies a 16-byte class TUID.
        std::slice::from_raw_parts(class_id, 16)
    };
    let interface_id = unsafe {
        // SAFETY: VST3 createInstance always supplies a 16-byte interface TUID.
        std::slice::from_raw_parts(interface_id, 16)
    };
    let instance = if class_id == iid::IMESSAGE && interface_id == iid::IMESSAGE {
        HostMessage::into_raw().cast()
    } else if class_id == iid::IATTRIBUTE_LIST && interface_id == iid::IATTRIBUTE_LIST {
        HostAttributeList::into_raw().cast()
    } else {
        std::ptr::null_mut()
    };
    unsafe {
        // SAFETY: output was validated above and receives one owned reference
        // for supported host-created objects.
        output.write(instance);
    }
    if instance.is_null() { -2147467262 } else { 0 }
}

static HOST_APPLICATION_VTABLE: HostApplicationVTable = HostApplicationVTable {
    base: FUnknownVTable {
        query_interface,
        add_ref,
        release,
    },
    get_name,
    create_instance,
};

static PLUG_INTERFACE_SUPPORT_VTABLE: PlugInterfaceSupportVTable = PlugInterfaceSupportVTable {
    base: FUnknownVTable {
        query_interface: support_query_interface,
        add_ref: support_add_ref,
        release: support_release,
    },
    is_plug_interface_supported,
};

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    use heron_vst3_host_sys::{Steinberg::Linux::IRunLoop, abi::RunLoopVTable};

    #[test]
    fn analysis_clone_keeps_module_callbacks_alive_until_the_last_owner() {
        let binary_path = std::env::current_exe().unwrap();
        let original = HostContext::for_module(&binary_path);
        let alias = binary_path
            .parent()
            .unwrap()
            .join(".")
            .join(binary_path.file_name().unwrap());
        let measurement = HostContext::for_module(&alias);
        let factory_context = measurement.as_unknown();
        let lifetime = Rc::downgrade(&measurement);
        assert_eq!(factory_context, original.as_unknown());
        let mut support = std::ptr::null_mut();
        unsafe {
            // SAFETY: measurement owns the context and support is writable storage.
            assert_eq!(
                query_interface(
                    factory_context,
                    iid::IPLUG_INTERFACE_SUPPORT.as_ptr(),
                    &mut support
                ),
                0
            );
        }

        // Analysis destroys its clone while the lab instance keeps the module
        // loaded. A factory's retained interface must still address live storage.
        drop(measurement);
        assert!(lifetime.upgrade().is_some());
        let mut name = [0_u16; 128];
        unsafe {
            // SAFETY: the original module retains the shared host context.
            let table = *factory_context.cast::<*const HostApplicationVTable>();
            assert_eq!(
                ((*table).get_name)(factory_context.cast(), name.as_mut_ptr()),
                0
            );
            // The embedded support interface must point back to the final Rc
            // allocation, including after the creating module has gone away.
            let mut identity = std::ptr::null_mut();
            assert_eq!(
                support_query_interface(
                    support.cast(),
                    iid::IHOST_APPLICATION.as_ptr(),
                    &mut identity
                ),
                0
            );
            assert_eq!(identity, factory_context.cast());
            release(identity.cast());
            support_release(support.cast());
        }
        assert_eq!(&name[..6], &[72, 101, 114, 111, 110, 0]);
        drop(original);
        assert!(
            lifetime.upgrade().is_none(),
            "the cache must not retain a module context"
        );
    }

    #[test]
    fn distinct_modules_do_not_share_callbacks() {
        let first = HostContext::for_module(Path::new("first-plugin-binary"));
        let second = HostContext::for_module(Path::new("second-plugin-binary"));
        assert_ne!(first.as_unknown(), second.as_unknown());
    }

    unsafe fn release_created(object: *mut c_void) {
        let unknown = object.cast::<FUnknown>();
        let vtable = unsafe {
            // SAFETY: createInstance returned a live VST3 object with an FUnknown prefix.
            *unknown.cast::<*const FUnknownVTable>()
        };
        unsafe {
            // SAFETY: createInstance returned exactly one owned reference.
            ((*vtable).release)(unknown);
        }
    }

    #[test]
    fn creates_mandatory_vst3_message_objects() {
        let context = HostContext::new();
        let application = context.as_unknown().cast();
        for interface_id in [iid::IMESSAGE, iid::IATTRIBUTE_LIST] {
            let mut object = std::ptr::null_mut();
            let result = unsafe {
                // SAFETY: the IDs and output storage satisfy createInstance's ABI contract.
                create_instance(
                    application,
                    interface_id.as_ptr().cast_mut(),
                    interface_id.as_ptr().cast_mut(),
                    &mut object,
                )
            };
            assert_eq!(result, 0);
            assert!(!object.is_null());
            unsafe {
                // SAFETY: the successful call returned one owned reference.
                release_created(object);
            }
        }
    }

    #[test]
    fn rejects_unknown_host_objects_without_returning_a_pointer() {
        let context = HostContext::new();
        let mut object = std::ptr::without_provenance_mut(1);
        let result = unsafe {
            // SAFETY: the IDs and output storage satisfy createInstance's ABI contract.
            create_instance(
                context.as_unknown().cast(),
                iid::ICOMPONENT.as_ptr().cast_mut(),
                iid::ICOMPONENT.as_ptr().cast_mut(),
                &mut object,
            )
        };
        assert_eq!(result, -2147467262);
        assert!(object.is_null());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn exposes_module_lifetime_run_loop_service() {
        let binary_path = std::env::current_exe().unwrap();
        let original = HostContext::for_module(&binary_path);
        let context = HostContext::for_module(&binary_path);
        let mut run_loop = std::ptr::null_mut::<c_void>();
        let result = unsafe {
            // SAFETY: the context is live and run_loop is writable interface output storage.
            query_interface(context.as_unknown(), iid::IRUN_LOOP.as_ptr(), &mut run_loop)
        };
        assert_eq!(result, 0);
        drop(context);
        let run_loop = run_loop.cast::<IRunLoop>();
        assert!(!run_loop.is_null());
        let table = unsafe {
            // SAFETY: successful queryInterface returned the IRunLoop interface.
            *run_loop.cast::<*const RunLoopVTable>()
        };
        let mut identity = std::ptr::null_mut::<c_void>();
        let identity_result = unsafe {
            // SAFETY: the run loop is live and identity is writable interface output storage.
            ((*table).base.query_interface)(run_loop.cast(), iid::FUNKNOWN.as_ptr(), &mut identity)
        };
        assert_eq!(identity_result, 0);
        assert_eq!(identity.cast::<IRunLoop>(), run_loop);
        unsafe {
            // SAFETY: these calls balance the two successful queryInterface calls above.
            ((*table).base.release)(identity.cast());
            ((*table).base.release)(run_loop.cast());
        }
        drop(original);
    }
}
