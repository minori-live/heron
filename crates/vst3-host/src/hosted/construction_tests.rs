//! Construction failures must retain native callbacks through complete teardown.

use super::*;
use std::{cell::RefCell, os::raw::c_char};

use heron_vst3_host_sys::{
    Steinberg::{
        FIDString, FUnknown, IBStream, IPlugView, IPluginFactory, PClassInfo, PFactoryInfo, TBool,
        TUID,
        Vst::{
            BusDirection, BusInfo, CtrlNumber, IAudioProcessor, IComponent, IComponentHandler,
            IMessage, IoMode, MediaType, ParamID, ParamValue, ProcessData, ProcessSetup,
            RoutingInfo, SpeakerArrangement,
        },
    },
    abi::{
        AudioProcessorVTable, ComponentHandlerVTable, ComponentVTable, ConnectionPointVTable,
        EditControllerVTable, FUnknownVTable, MidiMappingVTable, PluginBaseVTable,
        PluginFactoryVTable,
    },
    compat::as_int32,
    iid,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Failure {
    None,
    Layout,
    Activation,
    Handler,
}

#[derive(Clone, Copy)]
enum InterfaceKind {
    Factory,
    Component,
    Processor,
    Controller,
    ComponentConnection,
    ControllerConnection,
    MidiMapping,
}

#[repr(C)]
struct Interface<V: 'static> {
    vtable: &'static V,
    fixture: *const Fixture,
    kind: InterfaceKind,
}

struct State {
    failure: Failure,
    combined_controller: bool,
    handler: *mut IComponentHandler,
    handler_lifetime: std::sync::Weak<()>,
    module_lifetime: std::rc::Weak<Module>,
    events: Vec<&'static str>,
    callback_results: Vec<i32>,
    missing_handler: bool,
    missing_module: bool,
    controller_references: u32,
    hook_alive: bool,
    component_terminated_with_hook: bool,
    connection_dependent_midi: bool,
    connected: [bool; 2],
}

struct Fixture {
    factory: Interface<PluginFactoryVTable>,
    component: Interface<ComponentVTable>,
    processor: Interface<AudioProcessorVTable>,
    controller: Interface<EditControllerVTable>,
    component_connection: Interface<ConnectionPointVTable>,
    controller_connection: Interface<ConnectionPointVTable>,
    midi_mapping: Interface<MidiMappingVTable>,
    state: RefCell<State>,
}

impl Fixture {
    fn new(failure: Failure, combined_controller: bool) -> Box<Self> {
        let mut fixture = Box::new(Self {
            factory: Interface {
                vtable: &FACTORY,
                fixture: std::ptr::null(),
                kind: InterfaceKind::Factory,
            },
            component: Interface {
                vtable: &COMPONENT,
                fixture: std::ptr::null(),
                kind: InterfaceKind::Component,
            },
            processor: Interface {
                vtable: &PROCESSOR,
                fixture: std::ptr::null(),
                kind: InterfaceKind::Processor,
            },
            controller: Interface {
                vtable: &CONTROLLER,
                fixture: std::ptr::null(),
                kind: InterfaceKind::Controller,
            },
            component_connection: Interface {
                vtable: &CONNECTION,
                fixture: std::ptr::null(),
                kind: InterfaceKind::ComponentConnection,
            },
            controller_connection: Interface {
                vtable: &CONNECTION,
                fixture: std::ptr::null(),
                kind: InterfaceKind::ControllerConnection,
            },
            midi_mapping: Interface {
                vtable: &MIDI_MAPPING,
                fixture: std::ptr::null(),
                kind: InterfaceKind::MidiMapping,
            },
            state: RefCell::new(State {
                failure,
                combined_controller,
                handler: std::ptr::null_mut(),
                handler_lifetime: std::sync::Weak::new(),
                module_lifetime: std::rc::Weak::new(),
                events: Vec::new(),
                callback_results: Vec::new(),
                missing_handler: false,
                missing_module: false,
                controller_references: 0,
                hook_alive: false,
                component_terminated_with_hook: false,
                connection_dependent_midi: false,
                connected: [false; 2],
            }),
        });
        let address = std::ptr::from_ref(fixture.as_ref());
        fixture.factory.fixture = address;
        fixture.component.fixture = address;
        fixture.processor.fixture = address;
        fixture.controller.fixture = address;
        fixture.component_connection.fixture = address;
        fixture.controller_connection.fixture = address;
        fixture.midi_mapping.fixture = address;
        fixture
    }

    fn module(&self) -> Rc<Module> {
        let factory = unsafe {
            // SAFETY: this fixture remains boxed until after Module and all its interfaces drop.
            ComPtr::from_raw(
                std::ptr::from_ref(&self.factory).cast_mut().cast(),
                "controlled factory",
            )
            .unwrap()
        };
        let module = Rc::new(Module::from_test_factory(factory));
        self.state.borrow_mut().module_lifetime = Rc::downgrade(&module);
        module
    }

    fn callback(&self) {
        let mut state = self.state.borrow_mut();
        // Only the callback allocation owns this sentinel. Detect premature
        // handler destruction without dereferencing freed memory.
        if state.handler_lifetime.upgrade().is_none() {
            state.missing_handler = true;
            return;
        }
        let result = unsafe {
            // SAFETY: the live sentinel proves the installed handler is still allocated.
            let table = *state.handler.cast::<*const ComponentHandlerVTable>();
            ((*table).restart_component)(state.handler, 0)
        };
        state.callback_results.push(result);
    }
}

unsafe fn fixture<'a, T>(this: *mut T) -> &'a Fixture {
    unsafe {
        // SAFETY: every controlled interface has the same header and its boxed fixture outlives it.
        &*(*this.cast::<Interface<FUnknownVTable>>()).fixture
    }
}

unsafe fn matches_id(requested: *const c_char, expected: TUID) -> bool {
    unsafe {
        // SAFETY: VST3 passes a complete 16-byte interface identifier.
        std::slice::from_raw_parts(requested, 16) == expected
    }
}

unsafe extern "system" fn query(
    this: *mut FUnknown,
    requested: *const c_char,
    output: *mut *mut c_void,
) -> i32 {
    unsafe {
        // SAFETY: caller supplies a live fixture interface and writable output pointer.
        let fixture = fixture(this);
        let kind = (*this.cast::<Interface<FUnknownVTable>>()).kind;
        let found = match kind {
            InterfaceKind::Component if matches_id(requested, iid::IAUDIO_PROCESSOR) => {
                std::ptr::from_ref(&fixture.processor).cast_mut().cast()
            }
            InterfaceKind::Component
                if fixture.state.borrow().combined_controller
                    && matches_id(requested, iid::IEDIT_CONTROLLER) =>
            {
                fixture.state.borrow_mut().controller_references += 1;
                std::ptr::from_ref(&fixture.controller).cast_mut().cast()
            }
            InterfaceKind::Component
                if fixture.state.borrow().connection_dependent_midi
                    && matches_id(requested, iid::ICONNECTION_POINT) =>
            {
                std::ptr::from_ref(&fixture.component_connection)
                    .cast_mut()
                    .cast()
            }
            InterfaceKind::Controller
                if fixture.state.borrow().connection_dependent_midi
                    && matches_id(requested, iid::ICONNECTION_POINT) =>
            {
                std::ptr::from_ref(&fixture.controller_connection)
                    .cast_mut()
                    .cast()
            }
            InterfaceKind::Controller
                if fixture.state.borrow().connection_dependent_midi
                    && matches_id(requested, iid::IMIDI_MAPPING) =>
            {
                std::ptr::from_ref(&fixture.midi_mapping).cast_mut().cast()
            }
            _ => std::ptr::null_mut(),
        };
        output.write(found);
        if found.is_null() { -2147467262 } else { 0 }
    }
}

unsafe extern "system" fn retain(_this: *mut FUnknown) -> u32 {
    1
}

unsafe extern "system" fn release(this: *mut FUnknown) -> u32 {
    unsafe {
        // SAFETY: interface storage is owned by the external fixture throughout construction.
        let fixture = fixture(this);
        let kind = (*this.cast::<Interface<FUnknownVTable>>()).kind;
        if matches!(kind, InterfaceKind::Controller) {
            let mut state = fixture.state.borrow_mut();
            state.controller_references -= 1;
            state.events.push("controller-release");
            state.missing_module |= state.module_lifetime.upgrade().is_none();
            drop(state);
            fixture.callback();
        }
        0
    }
}

unsafe extern "system" fn create_instance(
    this: *mut IPluginFactory,
    _class: FIDString,
    requested: FIDString,
    output: *mut *mut c_void,
) -> i32 {
    unsafe {
        // SAFETY: the requested controlled object and output remain valid for this call.
        let fixture = fixture(this);
        let object = if matches_id(requested, iid::ICOMPONENT) {
            std::ptr::from_ref(&fixture.component).cast_mut().cast()
        } else if matches_id(requested, iid::IEDIT_CONTROLLER) {
            fixture.state.borrow_mut().controller_references += 1;
            std::ptr::from_ref(&fixture.controller).cast_mut().cast()
        } else {
            std::ptr::null_mut()
        };
        output.write(object);
        if object.is_null() { -2147467262 } else { 0 }
    }
}

unsafe extern "system" fn initialize(this: *mut IPluginBase, _host: *mut FUnknown) -> i32 {
    unsafe {
        // SAFETY: this is one of the fixture's initialized native interfaces.
        let event = match (*this.cast::<Interface<FUnknownVTable>>()).kind {
            InterfaceKind::Component => "component-initialize",
            _ => "controller-initialize",
        };
        fixture(this).state.borrow_mut().events.push(event);
    }
    0
}

unsafe extern "system" fn terminate(this: *mut IPluginBase) -> i32 {
    unsafe {
        // SAFETY: native lifecycle calls only use interfaces retained by the fixture.
        let fixture = fixture(this);
        let component = matches!(
            (*this.cast::<Interface<FUnknownVTable>>()).kind,
            InterfaceKind::Component
        );
        let mut state = fixture.state.borrow_mut();
        state.events.push(if component {
            "component-terminate"
        } else {
            "controller-terminate"
        });
        if component {
            state.component_terminated_with_hook = state.hook_alive;
        }
        drop(state);
        fixture.callback();
    }
    0
}

unsafe extern "system" fn controller_id(this: *mut IComponent, id: *mut c_char) -> i32 {
    unsafe {
        // SAFETY: the SDK supplies writable storage for the 16-byte class identifier.
        if fixture(this).state.borrow().combined_controller {
            1
        } else {
            id.copy_from_nonoverlapping(ClassId::from_bytes([2; 16]).to_tuid().as_ptr(), 16);
            0
        }
    }
}

unsafe extern "system" fn bus_count(
    _this: *mut IComponent,
    media: MediaType,
    _direction: BusDirection,
) -> i32 {
    i32::from(media == as_int32(Vst::MediaTypes_kAudio))
}

unsafe extern "system" fn bus_info(
    _this: *mut IComponent,
    _media: MediaType,
    _direction: BusDirection,
    _index: i32,
    info: *mut BusInfo,
) -> i32 {
    unsafe {
        // SAFETY: the caller supplies writable SDK BusInfo storage for our mono main bus.
        info.write(std::mem::zeroed());
        (*info).channelCount = 1;
    }
    0
}

unsafe extern "system" fn arrange(
    _this: *mut IAudioProcessor,
    inputs: *mut SpeakerArrangement,
    _input_count: i32,
    outputs: *mut SpeakerArrangement,
    _output_count: i32,
) -> i32 {
    unsafe {
        // SAFETY: this mono effect is passed one live input and one live output arrangement.
        i32::from(*inputs != Vst::SpeakerArr::kMono || *outputs != Vst::SpeakerArr::kMono)
    }
}

unsafe extern "system" fn arrangement(
    _this: *mut IAudioProcessor,
    _direction: BusDirection,
    _index: i32,
    output: *mut SpeakerArrangement,
) -> i32 {
    unsafe {
        // SAFETY: output is writable SDK storage; our mono-only fixture never changes buses.
        output.write(Vst::SpeakerArr::kMono);
    }
    0
}

unsafe extern "system" fn set_active(this: *mut IComponent, active: TBool) -> i32 {
    unsafe {
        // SAFETY: this refers to the fixture's retained component.
        let mut state = fixture(this).state.borrow_mut();
        state.events.push(if active == 0 {
            "deactivate"
        } else {
            "activate"
        });
        i32::from(active != 0 && state.failure == Failure::Activation)
    }
}

unsafe extern "system" fn set_handler(
    this: *mut IEditController,
    handler: *mut IComponentHandler,
) -> i32 {
    unsafe {
        // SAFETY: Heron passes its live ComponentHandler allocation before exposing the plugin.
        let mut state = fixture(this).state.borrow_mut();
        if handler.is_null() {
            state.events.push("detach-rejected");
            return 1;
        }
        state.handler = handler;
        state.handler_lifetime = (*handler.cast::<ComponentHandler>()).callback_lifetime();
        i32::from(state.failure == Failure::Handler)
    }
}

unsafe extern "system" fn connect(
    this: *mut IConnectionPoint,
    _other: *mut IConnectionPoint,
) -> i32 {
    unsafe {
        // SAFETY: both connection interfaces belong to the live controlled fixture.
        let index = usize::from(matches!(
            (*this.cast::<Interface<FUnknownVTable>>()).kind,
            InterfaceKind::ControllerConnection
        ));
        fixture(this).state.borrow_mut().connected[index] = true;
    }
    0
}

unsafe extern "system" fn disconnect(
    this: *mut IConnectionPoint,
    _other: *mut IConnectionPoint,
) -> i32 {
    unsafe {
        // SAFETY: both interfaces remain live until after host disconnection.
        let index = usize::from(matches!(
            (*this.cast::<Interface<FUnknownVTable>>()).kind,
            InterfaceKind::ControllerConnection
        ));
        fixture(this).state.borrow_mut().connected[index] = false;
    }
    0
}

unsafe extern "system" fn midi_assignment(
    this: *mut IMidiMapping,
    _bus: i32,
    channel: i16,
    controller: CtrlNumber,
    parameter: *mut ParamID,
) -> i32 {
    unsafe {
        // SAFETY: parameter is writable SDK storage and this mapping belongs to the fixture.
        // The controller can resolve this assignment only after both peers connect.
        if fixture(this).state.borrow().connected == [true; 2] && channel == 0 && controller == 0 {
            parameter.write(77);
            0
        } else {
            1
        }
    }
}

macro_rules! stub {
    ($name:ident($($arg:ident: $ty:ty),*) -> $result:ty = $value:expr) => {
        unsafe extern "system" fn $name($($arg: $ty),*) -> $result { $value }
    };
}

stub!(factory_info(_this: *mut IPluginFactory, _info: *mut PFactoryInfo) -> i32 = 1);
stub!(class_count(_this: *mut IPluginFactory) -> i32 = 0);
stub!(class_info(_this: *mut IPluginFactory, _index: i32, _info: *mut PClassInfo) -> i32 = 1);
stub!(io_mode(_this: *mut IComponent, _mode: IoMode) -> i32 = 0);
stub!(routing(_this: *mut IComponent, _input: *mut RoutingInfo, _output: *mut RoutingInfo) -> i32 = 1);
stub!(activate_bus(_this: *mut IComponent, _media: MediaType, _direction: BusDirection, _index: i32, _active: TBool) -> i32 = 0);
stub!(component_state(_this: *mut IComponent, _stream: *mut IBStream) -> i32 = 0);
stub!(sample_size(_this: *mut IAudioProcessor, _size: i32) -> i32 = 0);
stub!(samples(_this: *mut IAudioProcessor) -> u32 = 0);
stub!(setup(_this: *mut IAudioProcessor, _setup: *mut ProcessSetup) -> i32 = 0);
stub!(processing(_this: *mut IAudioProcessor, _active: TBool) -> i32 = 0);
stub!(process(_this: *mut IAudioProcessor, _data: *mut ProcessData) -> i32 = 0);
stub!(controller_state(_this: *mut IEditController, _stream: *mut IBStream) -> i32 = 0);
stub!(parameter_count(_this: *mut IEditController) -> i32 = 0);
stub!(parameter_info(_this: *mut IEditController, _index: i32, _info: *mut ParameterInfo) -> i32 = 1);
stub!(parameter_string(_this: *mut IEditController, _id: ParamID, _value: ParamValue, _text: *mut u16) -> i32 = 1);
stub!(parse_parameter(_this: *mut IEditController, _id: ParamID, _text: *mut u16, _value: *mut ParamValue) -> i32 = 1);
stub!(convert_parameter(_this: *mut IEditController, _id: ParamID, value: ParamValue) -> ParamValue = value);
stub!(parameter_value(_this: *mut IEditController, _id: ParamID) -> ParamValue = 0.0);
stub!(set_parameter(_this: *mut IEditController, _id: ParamID, _value: ParamValue) -> i32 = 0);
stub!(create_view(_this: *mut IEditController, _name: FIDString) -> *mut IPlugView = std::ptr::null_mut());
stub!(notify(_this: *mut IConnectionPoint, _message: *mut IMessage) -> i32 = 1);

const UNKNOWN: FUnknownVTable = FUnknownVTable {
    query_interface: query,
    add_ref: retain,
    release,
};
const BASE: PluginBaseVTable = PluginBaseVTable {
    base: UNKNOWN,
    initialize,
    terminate,
};
static FACTORY: PluginFactoryVTable = PluginFactoryVTable {
    base: UNKNOWN,
    get_factory_info: factory_info,
    count_classes: class_count,
    get_class_info: class_info,
    create_instance,
};
static COMPONENT: ComponentVTable = ComponentVTable {
    base: BASE,
    get_controller_class_id: controller_id,
    set_io_mode: io_mode,
    get_bus_count: bus_count,
    get_bus_info: bus_info,
    get_routing_info: routing,
    activate_bus,
    set_active,
    set_state: component_state,
    get_state: component_state,
};
static PROCESSOR: AudioProcessorVTable = AudioProcessorVTable {
    base: UNKNOWN,
    set_bus_arrangements: arrange,
    get_bus_arrangement: arrangement,
    can_process_sample_size: sample_size,
    latency_samples: samples,
    setup_processing: setup,
    set_processing: processing,
    process,
    tail_samples: samples,
};
static CONTROLLER: EditControllerVTable = EditControllerVTable {
    base: BASE,
    set_component_state: controller_state,
    set_state: controller_state,
    get_state: controller_state,
    parameter_count,
    parameter_info,
    parameter_string,
    parameter_from_string: parse_parameter,
    normalized_to_plain: convert_parameter,
    plain_to_normalized: convert_parameter,
    parameter_normalized: parameter_value,
    set_parameter_normalized: set_parameter,
    set_component_handler: set_handler,
    create_view,
};

static CONNECTION: ConnectionPointVTable = ConnectionPointVTable {
    base: UNKNOWN,
    connect,
    disconnect,
    notify,
};

static MIDI_MAPPING: MidiMappingVTable = MidiMappingVTable {
    base: UNKNOWN,
    get_midi_controller_assignment: midi_assignment,
};

struct Hook<'a>(&'a Fixture);

impl Drop for Hook<'_> {
    fn drop(&mut self) {
        let mut state = self.0.state.borrow_mut();
        state.hook_alive = false;
        state.events.push("hook-drop");
    }
}

#[test]
fn rejected_construction_keeps_callbacks_and_module_alive_through_native_teardown() {
    for failure in [Failure::Layout, Failure::Activation, Failure::Handler] {
        for combined in [false, true] {
            let fixture = Fixture::new(failure, combined);
            let result = HostedPlugin::create_from_module(
                fixture.module(),
                ClassId::from_bytes([1; 16]),
                48_000.0,
                PluginKind::Effect,
                if failure == Failure::Layout {
                    AudioLayout::Stereo
                } else {
                    AudioLayout::Mono
                },
                &[],
                |_, _| {
                    fixture.state.borrow_mut().hook_alive = true;
                    Ok(Hook(&fixture))
                },
            );
            let error = match result {
                Ok(_) => panic!("controlled {failure:?} rejection was accepted"),
                Err(error) => error,
            };
            match failure {
                Failure::None => unreachable!(),
                Failure::Layout => assert!(matches!(
                    error,
                    HostError::InvalidArgument {
                        operation: "main audio input layout"
                    }
                )),
                Failure::Activation => assert!(matches!(
                    error,
                    HostError::Operation {
                        operation: "setActive(true)",
                        result: 1
                    }
                )),
                Failure::Handler => assert!(matches!(
                    error,
                    HostError::Operation {
                        operation: "IEditController::setComponentHandler",
                        result: 1
                    }
                )),
            }
            let state = fixture.state.borrow();
            assert!(
                !state.missing_handler,
                "{failure:?}, combined={combined}: handler was released before native teardown"
            );
            assert!(
                !state.missing_module,
                "module unloaded before controller release"
            );
            assert!(
                !state.component_terminated_with_hook,
                "hook must retire before component"
            );
            assert_eq!(
                state
                    .events
                    .iter()
                    .filter(|&&event| event == "component-terminate")
                    .count(),
                1
            );
            assert_eq!(
                state
                    .events
                    .iter()
                    .filter(|&&event| event == "controller-terminate")
                    .count(),
                usize::from(!combined)
            );
            assert_eq!(
                state.callback_results,
                vec![0; if combined { 2 } else { 3 }]
            );
            assert!(state.handler_lifetime.upgrade().is_none());
            assert!(state.module_lifetime.upgrade().is_none());
        }
    }
}

#[test]
fn loaded_mono_plugin_retains_callbacks_and_module_until_last_native_release() {
    for combined in [false, true] {
        let fixture = Fixture::new(Failure::None, combined);
        let (plugin, ()) = HostedPlugin::create_from_module(
            fixture.module(),
            ClassId::from_bytes([1; 16]),
            48_000.0,
            PluginKind::Effect,
            AudioLayout::Mono,
            &[],
            |_, _| Ok(()),
        )
        .expect("mono-only fixture must load in mono mode");
        assert!(fixture.state.borrow().module_lifetime.upgrade().is_some());
        drop(plugin);

        let state = fixture.state.borrow();
        assert!(!state.missing_handler);
        assert!(
            !state.missing_module,
            "module unloaded before controller release"
        );
        assert_eq!(
            state
                .events
                .iter()
                .filter(|&&event| event == "component-terminate")
                .count(),
            1
        );
        assert_eq!(
            state
                .events
                .iter()
                .filter(|&&event| event == "controller-terminate")
                .count(),
            usize::from(!combined)
        );
        assert_eq!(
            state
                .events
                .iter()
                .filter(|&&event| event == "deactivate")
                .count(),
            1
        );
        assert_eq!(
            state.callback_results,
            vec![0; if combined { 2 } else { 3 }]
        );
        assert!(state.handler_lifetime.upgrade().is_none());
        assert!(state.module_lifetime.upgrade().is_none());
    }
}

#[test]
fn constructed_plugin_resolves_midi_assignments_after_connecting_both_peers() {
    let fixture = Fixture::new(Failure::None, false);
    fixture.state.borrow_mut().connection_dependent_midi = true;
    let (plugin, ()) = HostedPlugin::create_from_module(
        fixture.module(),
        ClassId::from_bytes([1; 16]),
        48_000.0,
        PluginKind::Effect,
        AudioLayout::Mono,
        &[],
        |_, _| Ok(()),
    )
    .expect("connected mono fixture should load");

    assert_eq!(plugin.midi_mapping.parameter(0, 0), Some(77));
    drop(plugin);
    assert_eq!(fixture.state.borrow().connected, [false; 2]);
}
