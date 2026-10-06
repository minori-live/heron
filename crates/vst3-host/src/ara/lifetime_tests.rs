//! The retained ARA provider must keep its VST3 module initialized.

use std::{cell::RefCell, ffi::c_void, rc::Rc};

use heron_vst3_host_sys::{
    Steinberg::{FIDString, FUnknown, IPluginFactory, PClassInfo, PFactoryInfo},
    abi::{FUnknownVTable, PluginFactoryVTable},
};

use crate::{ClassId, ComPtr, Module};

#[derive(Default)]
struct State {
    module: std::rc::Weak<Module>,
    provider_released_with_live_module: bool,
    releases: Vec<&'static str>,
}

#[repr(C)]
struct ProviderVTable {
    base: FUnknownVTable,
    get_factory: unsafe extern "system" fn(*mut Provider) -> *const c_void,
}

#[repr(C)]
struct Provider {
    vtable: &'static ProviderVTable,
    state: Rc<RefCell<State>>,
}

#[repr(C)]
struct Factory {
    vtable: &'static PluginFactoryVTable,
    provider: *mut Provider,
    state: Rc<RefCell<State>>,
}

unsafe extern "system" fn query(
    _this: *mut FUnknown,
    _iid: FIDString,
    output: *mut *mut c_void,
) -> i32 {
    // SAFETY: the ABI caller provides writable output storage.
    unsafe { *output = std::ptr::null_mut() };
    -1
}

unsafe extern "system" fn retain(_this: *mut FUnknown) -> u32 {
    1
}

unsafe extern "system" fn release_provider(this: *mut FUnknown) -> u32 {
    // SAFETY: provider storage stays boxed until all wrappers are released.
    let provider = unsafe { &*this.cast::<Provider>() };
    let mut state = provider.state.borrow_mut();
    state.provider_released_with_live_module = state.module.upgrade().is_some();
    state.releases.push("provider");
    0
}

unsafe extern "system" fn release_factory(this: *mut FUnknown) -> u32 {
    // SAFETY: factory storage stays boxed until Module has been released.
    unsafe { &*this.cast::<Factory>() }
        .state
        .borrow_mut()
        .releases
        .push("module factory");
    0
}

unsafe extern "system" fn get_factory(this: *mut Provider) -> *const c_void {
    // The bridge only stores this opaque sentinel; it does not dereference it.
    this.cast()
}

unsafe extern "system" fn create_instance(
    this: *mut IPluginFactory,
    _class: FIDString,
    _iid: FIDString,
    output: *mut *mut c_void,
) -> i32 {
    // SAFETY: the controlled factory and writable output are live for the call.
    unsafe { *output = (*this.cast::<Factory>()).provider.cast() };
    0
}

unsafe extern "system" fn factory_info(
    _this: *mut IPluginFactory,
    _info: *mut PFactoryInfo,
) -> i32 {
    1
}

unsafe extern "system" fn class_count(_this: *mut IPluginFactory) -> i32 {
    0
}

unsafe extern "system" fn class_info(
    _this: *mut IPluginFactory,
    _index: i32,
    _info: *mut PClassInfo,
) -> i32 {
    1
}

static PROVIDER: ProviderVTable = ProviderVTable {
    base: FUnknownVTable {
        query_interface: query,
        add_ref: retain,
        release: release_provider,
    },
    get_factory,
};
static FACTORY: PluginFactoryVTable = PluginFactoryVTable {
    base: FUnknownVTable {
        query_interface: query,
        add_ref: retain,
        release: release_factory,
    },
    get_factory_info: factory_info,
    count_classes: class_count,
    get_class_info: class_info,
    create_instance,
};

#[test]
fn cached_ara_provider_keeps_module_live_through_reuse_and_final_release() {
    let state = Rc::new(RefCell::new(State::default()));
    let mut provider = Box::new(Provider {
        vtable: &PROVIDER,
        state: Rc::clone(&state),
    });
    let mut factory = Box::new(Factory {
        vtable: &FACTORY,
        provider: std::ptr::from_mut(provider.as_mut()),
        state: Rc::clone(&state),
    });
    let module = Rc::new(Module::from_test_factory(unsafe {
        // SAFETY: the boxed factory implements IPluginFactory and outlives Module.
        ComPtr::from_raw(std::ptr::from_mut(factory.as_mut()).cast(), "test factory").unwrap()
    }));
    let module_lifetime = Rc::downgrade(&module);
    state.borrow_mut().module = module_lifetime.clone();
    let cached = Rc::new(
        module
            .create_ara_main_factory(ClassId::from_bytes([1; 16]))
            .unwrap(),
    );
    drop(module);
    assert!(
        module_lifetime.upgrade().is_some(),
        "cached provider outlived its module"
    );

    let reloaded = Rc::clone(&cached);
    drop(cached);
    assert!(module_lifetime.upgrade().is_some());
    assert_eq!(
        reloaded.factory_ptr(),
        std::ptr::from_ref(provider.as_ref()).cast()
    );
    drop(reloaded);

    assert!(module_lifetime.upgrade().is_none());
    let state = state.borrow();
    assert!(state.provider_released_with_live_module);
    assert_eq!(state.releases, ["provider", "module factory"]);
}
