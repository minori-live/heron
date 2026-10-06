use std::{
    ffi::c_void,
    marker::PhantomData,
    ptr::NonNull,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    },
};

use heron_vst3_host_sys::{
    Steinberg::{
        IPluginBase,
        Vst::{
            self, IConnectionPoint, IEditController, IMidiMapping, IUnitInfo, ParameterInfo,
            ProgramListInfo, UnitInfo,
        },
    },
    compat::as_uint32,
};

use crate::{
    AudioLayout, ClassId, ComPtr, HostError, HostResult, Module, PluginKind, StereoProcessor,
    component_handler::{ComponentHandler, HandlerShared},
    output_parameter_bridge::{OutputParameterReader, output_parameter_bridge},
    stream::MemoryStream,
};

mod interfaces;
mod parameters;
mod processing_access;
mod processor_lease;
mod state;
mod transactions;

pub use interfaces::PlugView;
pub use processor_lease::ProcessorLease;

use interfaces::{
    check, component_table, connection_table, controller_parameter_flags, controller_parameter_ids,
    controller_table, create_controller, midi_mapping_table, optional_unit_string_result,
    unit_info_table, utf16_string, validate_controller_parameter_edit,
};
use processor_lease::ProcessorCell;

#[derive(Clone, Debug, PartialEq)]
pub struct HostedParameter {
    pub id: u32,
    pub title: String,
    pub short_title: String,
    pub units: String,
    pub step_count: i32,
    pub default_normalized: f64,
    pub normalized: f64,
    pub min_value: f64,
    pub max_value: f64,
    pub default_value: f64,
    pub value: f64,
    pub formatted: String,
    pub flags: u32,
    pub read_only: bool,
    pub hidden: bool,
    pub stepped: bool,
    pub automatable: bool,
    pub bypass: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostedUnit {
    pub id: i32,
    pub parent_id: i32,
    pub name: String,
    pub program_list_id: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostedProgramList {
    pub id: i32,
    pub name: String,
    pub programs: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostedUnitInfo {
    pub units: Vec<HostedUnit>,
    pub program_lists: Vec<HostedProgramList>,
    pub selected_unit_id: i32,
}

const MIDI_MAPPING_CHANNELS: usize = 16;
const MIDI_MAPPING_CONTROLLERS: usize = 131;
const MIDI_AFTERTOUCH: usize = 128;
const MIDI_PITCH_BEND: usize = 129;
const MIDI_PROGRAM_CHANGE: usize = 130;
const UNMAPPED_PARAMETER: u32 = u32::MAX;

struct MidiMappingTable {
    parameters: Box<[AtomicU32]>,
}

impl MidiMappingTable {
    fn query(controller: Option<&ComPtr<IEditController>>) -> HostResult<Self> {
        let parameters = (0..MIDI_MAPPING_CHANNELS * MIDI_MAPPING_CONTROLLERS)
            .map(|_| AtomicU32::new(UNMAPPED_PARAMETER))
            .collect::<Vec<_>>()
            .into_boxed_slice();
        let Some(mapping) = controller
            .map(|value| value.query_optional::<IMidiMapping>())
            .transpose()?
            .flatten()
        else {
            return Ok(Self { parameters });
        };
        let table = Self { parameters };
        table.refresh_mapping(&mapping);
        Ok(table)
    }

    fn refresh(&self, controller: Option<&ComPtr<IEditController>>) -> HostResult<()> {
        let Some(mapping) = controller
            .map(|value| value.query_optional::<IMidiMapping>())
            .transpose()?
            .flatten()
        else {
            for parameter in &self.parameters {
                parameter.store(UNMAPPED_PARAMETER, Ordering::Release);
            }
            return Ok(());
        };
        self.refresh_mapping(&mapping);
        Ok(())
    }

    fn refresh_mapping(&self, mapping: &ComPtr<IMidiMapping>) {
        let table = midi_mapping_table(mapping);
        for channel in 0..MIDI_MAPPING_CHANNELS {
            for controller in 0..MIDI_MAPPING_CONTROLLERS {
                let mut parameter = UNMAPPED_PARAMETER;
                let result = unsafe {
                    // SAFETY: the controller is live, the bus/channel/controller values are in
                    // the VST3 MIDI mapping range, and parameter is writable.
                    ((*table).get_midi_controller_assignment)(
                        mapping.as_ptr(),
                        0,
                        channel as i16,
                        controller as i16,
                        std::ptr::addr_of_mut!(parameter),
                    )
                };
                self.parameters[channel * MIDI_MAPPING_CONTROLLERS + controller].store(
                    if result == 0 {
                        parameter
                    } else {
                        UNMAPPED_PARAMETER
                    },
                    Ordering::Release,
                );
            }
        }
    }

    fn parameter(&self, channel: u8, controller: usize) -> Option<u32> {
        let index = usize::from(channel)
            .checked_mul(MIDI_MAPPING_CONTROLLERS)?
            .checked_add(controller)?;
        self.parameters
            .get(index)
            .map(|value| value.load(Ordering::Acquire))
            .filter(|value| *value != UNMAPPED_PARAMETER)
    }
}

pub struct HostedPlugin {
    processor: Box<ProcessorCell>,
    processor_lifetime: Arc<()>,
    midi_mapping: Arc<MidiMappingTable>,
    controller: Option<ComPtr<IEditController>>,
    connections: Option<ComponentConnections>,
    _handler: Option<Box<ComponentHandler>>,
    shared: Arc<HandlerShared>,
    output_parameter_reader: OutputParameterReader,
    controller_initialized: bool,
    class_id: ClassId,
    // Keep the module and its HostContext alive until every plug-in interface above is released.
    _module: Rc<Module>,
}

struct ComponentConnections {
    component: ComPtr<IConnectionPoint>,
    controller: ComPtr<IConnectionPoint>,
    component_connected: bool,
    controller_connected: bool,
}

/// Owns an initialized edit controller while `HostedPlugin` construction can
/// still fail before the host owns and installs a component handler.
struct InitializedController {
    controller: Option<ComPtr<IEditController>>,
    initialized_separately: bool,
}

impl InitializedController {
    fn new(controller: Option<ComPtr<IEditController>>, initialized_separately: bool) -> Self {
        Self {
            controller,
            initialized_separately,
        }
    }

    fn controller(&self) -> Option<&ComPtr<IEditController>> {
        self.controller.as_ref()
    }

    fn take(mut self) -> (Option<ComPtr<IEditController>>, bool) {
        let initialized_separately = self.initialized_separately;
        self.initialized_separately = false;
        (self.controller.take(), initialized_separately)
    }
}

impl Drop for InitializedController {
    fn drop(&mut self) {
        if self.initialized_separately {
            if let Some(controller) = &self.controller {
                unsafe {
                    // SAFETY: this guard owns the one successful initialize
                    // call and terminates it exactly once before ComPtr release.
                    ((*controller_table(controller)).base.terminate)(
                        controller.as_ptr().cast::<IPluginBase>(),
                    );
                }
            }
            self.initialized_separately = false;
        }
        self.controller.take();
    }
}

impl ComponentConnections {
    fn connect(
        component: ComPtr<IConnectionPoint>,
        controller: ComPtr<IConnectionPoint>,
    ) -> HostResult<Self> {
        let mut connections = Self {
            component,
            controller,
            component_connected: false,
            controller_connected: false,
        };
        connections.component_connected = true;
        check("IConnectionPoint::connect(component)", unsafe {
            // SAFETY: both retained connection points are initialized and live.
            ((*connection_table(&connections.component)).connect)(
                connections.component.as_ptr(),
                connections.controller.as_ptr(),
            )
        })?;
        connections.controller_connected = true;
        check("IConnectionPoint::connect(controller)", unsafe {
            // SAFETY: both retained connection points are initialized and live.
            ((*connection_table(&connections.controller)).connect)(
                connections.controller.as_ptr(),
                connections.component.as_ptr(),
            )
        })?;
        Ok(connections)
    }
}

impl Drop for ComponentConnections {
    fn drop(&mut self) {
        unsafe {
            // SAFETY: each attempted connect is cleaned up while both retained
            // peers live, including a rejected call with partial side effects.
            if self.controller_connected {
                ((*connection_table(&self.controller)).disconnect)(
                    self.controller.as_ptr(),
                    self.component.as_ptr(),
                );
            }
            if self.component_connected {
                ((*connection_table(&self.component)).disconnect)(
                    self.component.as_ptr(),
                    self.controller.as_ptr(),
                );
            }
        }
    }
}

impl HostedPlugin {
    pub fn create(
        module_path: impl AsRef<std::path::Path>,
        class_id: ClassId,
        sample_rate: f64,
        kind: PluginKind,
    ) -> HostResult<Self> {
        Self::create_with_layout(
            module_path,
            class_id,
            sample_rate,
            kind,
            AudioLayout::Stereo,
        )
    }

    pub fn create_with_layout(
        module_path: impl AsRef<std::path::Path>,
        class_id: ClassId,
        sample_rate: f64,
        kind: PluginKind,
        layout: AudioLayout,
    ) -> HostResult<Self> {
        Self::create_with_layout_and_aux_inputs(
            module_path,
            class_id,
            sample_rate,
            kind,
            layout,
            &[],
        )
    }

    pub fn create_with_layout_and_aux_inputs(
        module_path: impl AsRef<std::path::Path>,
        class_id: ClassId,
        sample_rate: f64,
        kind: PluginKind,
        layout: AudioLayout,
        active_aux_input_buses: &[u32],
    ) -> HostResult<Self> {
        Self::create_with_layout_aux_and_hook(
            module_path,
            class_id,
            sample_rate,
            kind,
            layout,
            active_aux_input_buses,
            |_, _| Ok(()),
        )
        .map(|(plugin, ())| plugin)
    }

    pub fn create_with_layout_and_hook<T>(
        module_path: impl AsRef<std::path::Path>,
        class_id: ClassId,
        sample_rate: f64,
        kind: PluginKind,
        layout: AudioLayout,
        hook: impl FnOnce(&Rc<Module>, *mut c_void) -> HostResult<T>,
    ) -> HostResult<(Self, T)> {
        Self::create_with_layout_aux_and_hook(
            module_path,
            class_id,
            sample_rate,
            kind,
            layout,
            &[],
            hook,
        )
    }

    pub fn create_with_layout_aux_and_hook<T>(
        module_path: impl AsRef<std::path::Path>,
        class_id: ClassId,
        sample_rate: f64,
        kind: PluginKind,
        layout: AudioLayout,
        active_aux_input_buses: &[u32],
        hook: impl FnOnce(&Rc<Module>, *mut c_void) -> HostResult<T>,
    ) -> HostResult<(Self, T)> {
        let module = Rc::new(Module::open(module_path)?);
        Self::create_from_module(
            module,
            class_id,
            sample_rate,
            kind,
            layout,
            active_aux_input_buses,
            hook,
        )
    }

    fn create_from_module<T>(
        module: Rc<Module>,
        class_id: ClassId,
        sample_rate: f64,
        kind: PluginKind,
        layout: AudioLayout,
        active_aux_input_buses: &[u32],
        hook: impl FnOnce(&Rc<Module>, *mut c_void) -> HostResult<T>,
    ) -> HostResult<(Self, T)> {
        let hook_module = Rc::clone(&module);
        let (mut processor, parameter_producer, hook_result) =
            StereoProcessor::create_with_parameter_queue_and_hook(
                module.clone(),
                class_id,
                sample_rate,
                kind,
                layout,
                move |component| hook(&hook_module, component),
            )?;
        let shared = HandlerShared::new(parameter_producer);
        let (controller, separate_controller) = create_controller(&module, &processor)?;
        let controller_lifecycle = InitializedController::new(controller, separate_controller);
        let parameter_ids = controller_lifecycle
            .controller()
            .map(controller_parameter_ids)
            .transpose()?
            .unwrap_or_default();
        let (output_parameter_writer, output_parameter_reader) =
            output_parameter_bridge(parameter_ids);
        processor.set_output_parameter_writer(output_parameter_writer);
        let midi_mapping = Arc::new(MidiMappingTable::query(None)?);
        let (controller, controller_initialized) = controller_lifecycle.take();
        // Install every native interface and callback in their final owner
        // before any setter can retain a handler and then reject preparation.
        let mut plugin = Self {
            processor: ProcessorCell::new(processor),
            processor_lifetime: Arc::new(()),
            midi_mapping,
            controller,
            connections: None,
            _handler: None,
            shared,
            output_parameter_reader,
            controller_initialized,
            class_id,
            _module: module,
        };
        if let Err(error) = plugin.finish_initialization(active_aux_input_buses) {
            // A hook may own an ARA document bound to the component. It must
            // retire while the failed candidate still owns that component.
            drop(hook_result);
            return Err(error);
        }
        Ok((plugin, hook_result))
    }

    fn finish_initialization(&mut self, active_aux_input_buses: &[u32]) -> HostResult<()> {
        if let Some(controller) = &self.controller {
            let mut handler = ComponentHandler::new(self.shared.clone());
            let callback = handler.as_interface();
            self._handler = Some(handler);
            check("IEditController::setComponentHandler", unsafe {
                // SAFETY: the initialized controller and stable callback are owned by self.
                // Even a rejected setter retains callback storage until complete native teardown.
                ((*controller_table(controller)).set_component_handler)(
                    controller.as_ptr(),
                    callback,
                )
            })?;
        }
        self.connections = if self.controller_initialized {
            match (
                self.processor.with_paused(|processor| {
                    processor.component().query_optional::<IConnectionPoint>()
                }),
                self.controller
                    .as_ref()
                    .ok_or(HostError::NullInterface("IEditController"))?
                    .query_optional::<IConnectionPoint>(),
            ) {
                (Ok(Some(component)), Ok(Some(controller))) => {
                    Some(ComponentConnections::connect(component, controller)?)
                }
                (Ok(_), Ok(_)) => None,
                (Err(error), _) | (_, Err(error)) => return Err(error),
            }
        } else {
            None
        };
        // Separate controllers can resolve MIDI assignments through their
        // component connection (including JUCE wrappers). Query only after
        // both connection points have been connected.
        self.midi_mapping.refresh(self.controller.as_ref())?;
        self.processor.with_paused(|processor| {
            processor.configure_aux_input_buses(active_aux_input_buses)?;
            processor.activate()
        })
    }

    pub fn mirror_parameters_to(&self, target: &Self) {
        self.shared.set_parameter_mirror(target.shared.clone());
    }

    /// Runs one controller-thread operation while no audio lease can enter `process`.
    pub fn with_processing_paused<T>(&self, action: impl FnOnce() -> T) -> T {
        self.processor.with_access_paused(action)
    }

    #[must_use]
    pub fn class_id(&self) -> ClassId {
        self.class_id
    }

    #[cfg(target_os = "linux")]
    pub fn dispatch_run_loop(&self, now: std::time::Instant) -> Option<std::time::Instant> {
        self._module.dispatch_run_loop(now)
    }

    #[must_use]
    pub fn processor_lease(&self) -> ProcessorLease {
        ProcessorLease {
            cell: NonNull::from(self.processor.as_ref()),
            midi_mapping: Arc::clone(&self.midi_mapping),
            _lifetime: Arc::clone(&self.processor_lifetime),
            _not_sync: PhantomData,
        }
    }

    /// Returns true while an audio graph can still dereference this plug-in's processor cell.
    ///
    /// The owner must first prevent new leases from being created. Once the count reaches one,
    /// no external lease remains that could clone itself, so dropping the stable cell is safe.
    #[must_use]
    pub fn has_outstanding_processor_leases(&self) -> bool {
        Arc::strong_count(&self.processor_lifetime) > 1
    }

    #[must_use]
    pub fn latency_samples(&self) -> u32 {
        self.processor
            .with_paused(|processor| processor.latency_samples())
    }

    #[must_use]
    pub fn tail_samples(&self) -> Option<u32> {
        self.processor
            .with_paused(|processor| processor.tail_samples())
    }

    #[must_use]
    pub fn take_restart_requests(&self) -> crate::Vst3RestartRequest {
        self.shared.take_restart_requests()
    }

    /// Drain parameter gestures reported by the native editor controller.
    pub fn take_editor_parameter_gestures(&self) -> Vec<crate::EditorParameterGesture> {
        self.shared.take_editor_gestures()
    }

    /// Drains requests sent through optional controller-to-host interfaces.
    pub fn take_host_requests(&self) -> Vec<crate::Vst3HostRequest> {
        self.shared.take_host_requests()
    }

    /// Applies a previously received bus activation request while processing is paused.
    pub fn set_bus_active(
        &self,
        media_type: i32,
        direction: i32,
        index: i32,
        active: bool,
    ) -> HostResult<()> {
        self.processor.with_paused_restart(|processor| {
            processor.set_bus_active(media_type, direction, index, active)
        })
    }

    /// Informs the optional VST3 presentation-latency interface about the time before the
    /// plug-in input arrives and after its output leaves, in session-rate samples.
    pub fn set_presentation_latency(
        &self,
        input_samples: u32,
        output_samples: u32,
    ) -> HostResult<()> {
        self.processor.with_paused(|processor| {
            processor.set_presentation_latency(input_samples, output_samples)
        })
    }

    /// Queries the optional controller-side unit and program hierarchy.
    pub fn unit_info(&self) -> HostResult<Option<HostedUnitInfo>> {
        let Some(unit_info) = self
            .controller
            .as_ref()
            .map(|controller| controller.query_optional::<IUnitInfo>())
            .transpose()?
            .flatten()
        else {
            return Ok(None);
        };
        let table = unit_info_table(&unit_info);
        // SAFETY: unit_info is live on its owning UI thread.
        let unit_count = unsafe { ((*table).get_unit_count)(unit_info.as_ptr()) };
        // SAFETY: unit_info is live on its owning UI thread.
        let list_count = unsafe { ((*table).get_program_list_count)(unit_info.as_ptr()) };
        if unit_count < 0 || list_count < 0 {
            return Err(HostError::InvalidPluginData {
                operation: "IUnitInfo count",
            });
        }

        let mut units = Vec::with_capacity(unit_count as usize);
        for index in 0..unit_count {
            // SAFETY: UnitInfo is an SDK POD fully initialized by getUnitInfo.
            let mut raw = unsafe { std::mem::MaybeUninit::<UnitInfo>::zeroed().assume_init() };
            // SAFETY: index is within getUnitCount and raw is writable.
            check("IUnitInfo::getUnitInfo", unsafe {
                ((*table).get_unit_info)(unit_info.as_ptr(), index, &mut raw)
            })?;
            units.push(HostedUnit {
                id: raw.id,
                parent_id: raw.parentUnitId,
                name: utf16_string(&raw.name),
                program_list_id: raw.programListId,
            });
        }

        let mut program_lists = Vec::with_capacity(list_count as usize);
        for index in 0..list_count {
            // SAFETY: ProgramListInfo is an SDK POD fully initialized by getProgramListInfo.
            let mut raw =
                unsafe { std::mem::MaybeUninit::<ProgramListInfo>::zeroed().assume_init() };
            // SAFETY: index is within getProgramListCount and raw is writable.
            check("IUnitInfo::getProgramListInfo", unsafe {
                ((*table).get_program_list_info)(unit_info.as_ptr(), index, &mut raw)
            })?;
            if raw.programCount < 0 {
                return Err(HostError::InvalidPluginData {
                    operation: "IUnitInfo program count",
                });
            }
            let mut programs = Vec::with_capacity(raw.programCount as usize);
            for program_index in 0..raw.programCount {
                let mut name = [0_u16; 128];
                // SAFETY: IDs and program index came from the plug-in; name is String128 storage.
                check("IUnitInfo::getProgramName", unsafe {
                    ((*table).get_program_name)(
                        unit_info.as_ptr(),
                        raw.id,
                        program_index,
                        name.as_mut_ptr(),
                    )
                })?;
                programs.push(utf16_string(&name));
            }
            program_lists.push(HostedProgramList {
                id: raw.id,
                name: utf16_string(&raw.name),
                programs,
            });
        }

        Ok(Some(HostedUnitInfo {
            units,
            program_lists,
            // SAFETY: unit_info remains live through snapshot construction.
            selected_unit_id: unsafe { ((*table).get_selected_unit)(unit_info.as_ptr()) },
        }))
    }

    pub fn select_unit(&self, unit_id: i32) -> HostResult<()> {
        let unit_info = self
            .controller
            .as_ref()
            .ok_or(HostError::NullInterface("IEditController"))?
            .query::<IUnitInfo>()?;
        // SAFETY: unit_info is live and unit_id is passed through as the SDK identifier type.
        check("IUnitInfo::selectUnit", unsafe {
            ((*unit_info_table(&unit_info)).select_unit)(unit_info.as_ptr(), unit_id)
        })
    }

    pub fn unit_for_bus(
        &self,
        media_type: i32,
        direction: i32,
        bus_index: i32,
        channel: i32,
    ) -> HostResult<Option<i32>> {
        let Some(unit_info) = self
            .controller
            .as_ref()
            .map(|controller| controller.query_optional::<IUnitInfo>())
            .transpose()?
            .flatten()
        else {
            return Ok(None);
        };
        let mut unit_id = 0;
        // SAFETY: unit_info is live and unit_id points to writable output storage.
        let result = unsafe {
            ((*unit_info_table(&unit_info)).get_unit_by_bus)(
                unit_info.as_ptr(),
                media_type,
                direction,
                bus_index,
                channel,
                &mut unit_id,
            )
        };
        if result == 0 {
            Ok(Some(unit_id))
        } else if result == 1 {
            Ok(None)
        } else {
            Err(HostError::Operation {
                operation: "IUnitInfo::getUnitByBus",
                result,
            })
        }
    }

    pub fn program_attribute(
        &self,
        list_id: i32,
        program_index: i32,
        attribute_id: &std::ffi::CStr,
    ) -> HostResult<Option<String>> {
        let unit_info = self
            .controller
            .as_ref()
            .ok_or(HostError::NullInterface("IEditController"))?
            .query::<IUnitInfo>()?;
        let mut value = [0_u16; 128];
        // SAFETY: unit_info and attribute ID are live and value is String128 storage.
        let result = unsafe {
            ((*unit_info_table(&unit_info)).get_program_info)(
                unit_info.as_ptr(),
                list_id,
                program_index,
                attribute_id.as_ptr(),
                value.as_mut_ptr(),
            )
        };
        optional_unit_string_result("IUnitInfo::getProgramInfo", result, &value)
    }

    pub fn program_pitch_name(
        &self,
        list_id: i32,
        program_index: i32,
        midi_pitch: i16,
    ) -> HostResult<Option<String>> {
        let unit_info = self
            .controller
            .as_ref()
            .ok_or(HostError::NullInterface("IEditController"))?
            .query::<IUnitInfo>()?;
        let table = unit_info_table(&unit_info);
        // SAFETY: unit_info is live and the program address is passed through unchanged.
        let supported = unsafe {
            ((*table).has_program_pitch_names)(unit_info.as_ptr(), list_id, program_index)
        };
        if supported == 1 {
            return Ok(None);
        }
        if supported != 0 {
            return Err(HostError::Operation {
                operation: "IUnitInfo::hasProgramPitchNames",
                result: supported,
            });
        }
        let mut name = [0_u16; 128];
        // SAFETY: unit_info is live and name is writable String128 storage.
        let result = unsafe {
            ((*table).get_program_pitch_name)(
                unit_info.as_ptr(),
                list_id,
                program_index,
                midi_pitch,
                name.as_mut_ptr(),
            )
        };
        optional_unit_string_result("IUnitInfo::getProgramPitchName", result, &name)
    }

    pub fn set_unit_program_data(
        &self,
        list_or_unit_id: i32,
        program_index: i32,
        data: &[u8],
    ) -> HostResult<()> {
        let unit_info = self
            .controller
            .as_ref()
            .ok_or(HostError::NullInterface("IEditController"))?
            .query::<IUnitInfo>()?;
        let mut stream = MemoryStream::from_slice(data);
        // SAFETY: unit_info and stream are live for this synchronous controller-thread call.
        check("IUnitInfo::setUnitProgramData", unsafe {
            ((*unit_info_table(&unit_info)).set_unit_program_data)(
                unit_info.as_ptr(),
                list_or_unit_id,
                program_index,
                stream.as_interface(),
            )
        })
    }

    pub fn apply_restart_requests(&mut self, request: crate::Vst3RestartRequest) -> HostResult<()> {
        if request.contains(crate::Vst3RestartRequest::RELOAD_COMPONENT) {
            return Err(HostError::UnsupportedOperation {
                operation: "restartComponent(kReloadComponent) requires instance reload",
            });
        }
        if request.contains(crate::Vst3RestartRequest::MIDI_CC_ASSIGNMENT_CHANGED) {
            self.midi_mapping.refresh(self.controller.as_ref())?;
        }
        if request.contains(crate::Vst3RestartRequest::PARAM_ID_MAPPING_CHANGED) {
            let parameter_ids = self
                .controller
                .as_ref()
                .map(controller_parameter_ids)
                .transpose()?
                .unwrap_or_default();
            let (writer, reader) = output_parameter_bridge(parameter_ids);
            self.processor
                .with_paused(|processor| processor.set_output_parameter_writer(writer));
            self.output_parameter_reader = reader;
        }
        if request.contains(crate::Vst3RestartRequest::IO_CHANGED)
            || request.contains(crate::Vst3RestartRequest::LATENCY_CHANGED)
        {
            self.processor
                .with_paused_restart(StereoProcessor::restart_processing)?;
        }
        Ok(())
    }

    pub fn flush_output_parameters(&mut self) -> HostResult<usize> {
        let Some(controller) = &self.controller else {
            return Ok(0);
        };
        let table = controller_table(controller);
        let applied = self.output_parameter_reader.drain(|id, value| {
            let result = unsafe {
                // SAFETY: the controller is live and this method only runs on its owning UI
                // thread. Output parameters update the controller without feeding the value back
                // into the processor's input queue.
                ((*table).set_parameter_normalized)(controller.as_ptr(), id, value)
            };
            if let Err(error) = crate::results::controller_sync_result(
                "IEditController::setParamNormalized(output)",
                result,
            ) {
                eprintln!("VST3 controller output synchronization rejected: {error}");
            }
        });
        Ok(applied)
    }

    pub fn parameters(&self) -> HostResult<Vec<HostedParameter>> {
        let Some(controller) = &self.controller else {
            return Ok(Vec::new());
        };
        let table = controller_table(controller);
        let count = unsafe {
            // SAFETY: controller is live on its owning UI thread.
            ((*table).parameter_count)(controller.as_ptr())
        }
        .max(0);
        let mut parameters = Vec::with_capacity(count as usize);
        for index in 0..count {
            let mut raw = std::mem::MaybeUninit::<ParameterInfo>::zeroed();
            check("IEditController::getParameterInfo", unsafe {
                // SAFETY: index is below parameter_count and raw is writable SDK storage.
                ((*table).parameter_info)(controller.as_ptr(), index, raw.as_mut_ptr())
            })?;
            let raw = unsafe {
                // SAFETY: a successful parameter_info call initialized the POD.
                raw.assume_init()
            };
            let normalized = unsafe {
                // SAFETY: controller is live and raw.id came from this controller.
                ((*table).parameter_normalized)(controller.as_ptr(), raw.id)
            };
            let min_value = unsafe {
                // SAFETY: Controller and parameter ID are valid for this call.
                ((*table).normalized_to_plain)(controller.as_ptr(), raw.id, 0.0)
            };
            let max_value = unsafe {
                // SAFETY: Controller and parameter ID are valid for this call.
                ((*table).normalized_to_plain)(controller.as_ptr(), raw.id, 1.0)
            };
            let default_value = unsafe {
                // SAFETY: Controller and parameter ID are valid for this call.
                ((*table).normalized_to_plain)(
                    controller.as_ptr(),
                    raw.id,
                    raw.defaultNormalizedValue,
                )
            };
            let value = unsafe {
                // SAFETY: Controller and parameter ID are valid for this call.
                ((*table).normalized_to_plain)(controller.as_ptr(), raw.id, normalized)
            };
            let mut text = [0_u16; 128];
            let string_result = unsafe {
                // SAFETY: controller is live, raw.id belongs to it, and text is writable String128 storage.
                ((*table).parameter_string)(
                    controller.as_ptr(),
                    raw.id,
                    normalized,
                    text.as_mut_ptr(),
                )
            };
            let flags = as_uint32(raw.flags);
            if flags & as_uint32(Vst::ParameterInfo_ParameterFlags_kIsHidden) != 0 {
                continue;
            }
            parameters.push(HostedParameter {
                id: raw.id,
                title: utf16_string(&raw.title),
                short_title: utf16_string(&raw.shortTitle),
                units: utf16_string(&raw.units),
                step_count: raw.stepCount,
                default_normalized: raw.defaultNormalizedValue,
                normalized,
                min_value,
                max_value,
                default_value,
                value,
                formatted: if string_result == 0 {
                    utf16_string(&text)
                } else {
                    String::new()
                },
                flags,
                read_only: flags & as_uint32(Vst::ParameterInfo_ParameterFlags_kIsReadOnly) != 0,
                hidden: flags & as_uint32(Vst::ParameterInfo_ParameterFlags_kIsHidden) != 0,
                stepped: raw.stepCount > 0,
                automatable: flags & as_uint32(Vst::ParameterInfo_ParameterFlags_kCanAutomate) != 0,
                bypass: flags & as_uint32(Vst::ParameterInfo_ParameterFlags_kIsBypass) != 0,
            });
        }
        Ok(parameters)
    }

    pub fn create_view(&self) -> HostResult<PlugView> {
        let controller = self
            .controller
            .as_ref()
            .ok_or(HostError::NullInterface("IEditController"))?;
        let view = unsafe {
            // SAFETY: controller is live and "editor" is the SDK-defined NUL-terminated view name.
            ((*controller_table(controller)).create_view)(controller.as_ptr(), c"editor".as_ptr())
        };
        let view = unsafe {
            // SAFETY: a non-null createView result transfers one owned IPlugView reference.
            ComPtr::from_raw(view, "IEditController::createView")?
        };
        Ok(PlugView { view })
    }
}

impl Drop for HostedPlugin {
    fn drop(&mut self) {
        self.connections.take();
        if let Some(controller) = &self.controller {
            unsafe {
                // SAFETY: controller is live; clearing the handler precedes handler release.
                ((*controller_table(controller)).set_component_handler)(
                    controller.as_ptr(),
                    std::ptr::null_mut(),
                );
            }
        }
        if self.controller_initialized {
            if let Some(controller) = &self.controller {
                unsafe {
                    // SAFETY: controller termination occurs once after views and handler are gone.
                    ((*controller_table(controller)).base.terminate)(
                        controller.as_ptr().cast::<IPluginBase>(),
                    );
                }
            }
            self.controller_initialized = false;
        }
        // Field drop order releases the processor and controller before the
        // handler, so even a rejected detach cannot leave a dangling callback
        // during their lifecycle teardown.
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "hosted/construction_tests.rs"]
mod construction_tests;
