use super::graph::{
    add, db_to_gain, graph_edges, scale, solo_audibility, topological_order, valid_db, valid_pan,
};
use super::*;

impl MixerGraph {
    /// Stable topological channel order, including non-audible scheduling
    /// dependencies such as plug-in side-chain sources.
    #[must_use]
    pub fn processing_order(&self) -> &[usize] {
        &self.order
    }

    pub fn new(
        sample_rate: u32,
        channels: Vec<ChannelSpec>,
        sends: Vec<SendSpec>,
    ) -> Result<Self, GraphError> {
        Self::new_with_dependencies(sample_rate, channels, sends, &[])
    }

    pub fn new_with_dependencies(
        sample_rate: u32,
        channels: Vec<ChannelSpec>,
        sends: Vec<SendSpec>,
        dependencies: &[(usize, usize)],
    ) -> Result<Self, GraphError> {
        if sample_rate == 0
            || channels
                .iter()
                .any(|channel| !valid_db(channel.gain_db) || !valid_pan(channel.pan))
            || sends.iter().any(|send| !valid_db(send.level_db))
        {
            return Err(GraphError::InvalidParameter);
        }
        let masters: Vec<_> = channels
            .iter()
            .enumerate()
            .filter_map(|(index, channel)| (channel.kind == ChannelKind::Master).then_some(index))
            .collect();
        let master = match masters.as_slice() {
            [] => return Err(GraphError::MissingMaster),
            [master] => *master,
            _ => return Err(GraphError::MultipleMasters),
        };
        if !channels
            .iter()
            .any(|channel| channel.kind == ChannelKind::Output)
        {
            return Err(GraphError::MissingOutput);
        }
        if channels.iter().any(|channel| match channel.kind {
            ChannelKind::Output => channel.hardware_output.is_none_or(|[left, right]| {
                left >= MAX_OUTPUT_CHANNELS || right >= MAX_OUTPUT_CHANNELS || left == right
            }),
            _ => channel.hardware_output.is_some(),
        }) {
            return Err(GraphError::InvalidOutput);
        }
        if channels.iter().any(|channel| match channel.input_bus {
            Some([left, right]) => {
                (channel.kind != ChannelKind::Audio && channel.kind != ChannelKind::Aux)
                    || left >= MAX_BUS_CHANNELS
                    || right >= MAX_BUS_CHANNELS
            }
            None => false,
        }) {
            return Err(GraphError::InvalidOutput);
        }
        let edges = graph_edges(&channels, &sends, dependencies)?;
        let order = topological_order(&edges)?;
        let (audible, output_audible, send_audible) = solo_audibility(&channels, &edges, &sends);
        let channel_runtime = channels
            .iter()
            .map(|channel| ChannelRuntime {
                gain: SmoothedValue::new(db_to_gain(channel.gain_db), sample_rate),
                pan: SmoothedValue::new(channel.pan, sample_rate),
                output_delay: StereoDelay::default(),
            })
            .collect();
        let send_runtime = sends
            .iter()
            .map(|send| SendRuntime {
                gain: SmoothedValue::new(db_to_gain(send.level_db), sample_rate),
                delay: StereoDelay::default(),
            })
            .collect();
        let mut sends_by_source = vec![Vec::new(); channels.len()];
        for (index, send) in sends.iter().enumerate() {
            sends_by_source[send.source].push(index);
        }
        let block_bus_count = channels
            .iter()
            .filter_map(|channel| channel.input_bus.map(|[left, right]| left.max(right)))
            .chain(channels.iter().filter_map(|channel| match channel.output {
                Some(RouteTarget::Bus(bus)) => Some(bus),
                Some(RouteTarget::StereoBus(bus)) => Some(bus + 1),
                Some(RouteTarget::Output(_) | RouteTarget::MonoOutput(_)) | None => None,
            }))
            .chain(sends.iter().filter_map(|send| match send.target {
                RouteTarget::Bus(bus) => Some(bus),
                RouteTarget::StereoBus(bus) => Some(bus + 1),
                RouteTarget::Output(_) | RouteTarget::MonoOutput(_) => None,
            }))
            .max()
            .map_or(0, |maximum| maximum + 1);
        Ok(Self {
            solo_upstream: vec![false; channels.len()],
            solo_downstream: vec![false; channels.len()],
            solo_edges: edges,
            accumulation: vec![[0.0, 0.0]; channels.len()],
            bus_accumulation: [0.0; MAX_BUS_CHANNELS],
            peaks: vec![ChannelPeak::default(); channels.len()],
            channels,
            sends,
            order,
            audible,
            output_audible,
            send_audible,
            channel_runtime,
            send_runtime,
            sends_by_source,
            master,
            block_bus_count,
            // Defer Level detection and scratch allocation to
            // `prepare_block_processing` so `process_frame` keeps a compact graph.
            block: None,
        })
    }

    pub fn channel_count(&self) -> usize {
        self.channels.len()
    }

    pub fn channel_index(&self, id: &str) -> Option<usize> {
        self.channels.iter().position(|channel| channel.id == id)
    }

    pub fn send_index(&self, id: &str) -> Option<usize> {
        self.sends.iter().position(|send| send.id == id)
    }

    pub fn set_channel_gain(&mut self, index: usize, gain_db: f32) -> Result<(), GraphError> {
        if index >= self.channels.len() || !valid_db(gain_db) {
            return Err(GraphError::InvalidParameter);
        }
        self.channels[index].gain_db = gain_db;
        self.channel_runtime[index]
            .gain
            .set_target(db_to_gain(gain_db));
        Ok(())
    }

    pub fn set_channel_pan(&mut self, index: usize, pan: f32) -> Result<(), GraphError> {
        if index >= self.channels.len() || !valid_pan(pan) {
            return Err(GraphError::InvalidParameter);
        }
        self.channels[index].pan = pan;
        self.channel_runtime[index].pan.set_target(pan);
        Ok(())
    }

    pub fn set_send_level(&mut self, index: usize, level_db: f32) -> Result<(), GraphError> {
        if index >= self.sends.len() || !valid_db(level_db) {
            return Err(GraphError::InvalidParameter);
        }
        self.sends[index].level_db = level_db;
        self.send_runtime[index]
            .gain
            .set_target(db_to_gain(level_db));
        Ok(())
    }

    pub fn set_channel_muted(&mut self, index: usize, value: bool) -> Result<(), GraphError> {
        let channel = self
            .channels
            .get_mut(index)
            .ok_or(GraphError::InvalidParameter)?;
        channel.muted = value;
        Ok(())
    }

    pub fn set_channel_soloed(&mut self, index: usize, value: bool) -> Result<(), GraphError> {
        let channel = self
            .channels
            .get_mut(index)
            .ok_or(GraphError::InvalidParameter)?;
        channel.soloed = value;
        self.refresh_solo_audibility();
        Ok(())
    }

    pub fn set_send_enabled(&mut self, index: usize, value: bool) -> Result<(), GraphError> {
        let send = self
            .sends
            .get_mut(index)
            .ok_or(GraphError::InvalidParameter)?;
        send.enabled = value;
        Ok(())
    }

    /// The topology is a DAG. Two passes reuse the compile-time storage and never allocate.
    fn refresh_solo_audibility(&mut self) {
        let any_solo = self
            .channels
            .iter()
            .any(|channel| channel.kind != ChannelKind::Master && channel.soloed);
        if !any_solo {
            self.audible.fill(true);
            self.output_audible.fill(true);
            self.send_audible.fill(true);
            return;
        }
        for (index, channel) in self.channels.iter().enumerate() {
            let solo = channel.kind != ChannelKind::Master && channel.soloed;
            self.solo_upstream[index] = solo;
            self.solo_downstream[index] = solo;
        }
        for &source in self.order.iter().rev() {
            self.solo_upstream[source] |= self.solo_edges[source]
                .iter()
                .any(|&target| self.solo_upstream[target]);
        }
        for &source in &self.order {
            if self.solo_downstream[source] {
                for &target in &self.solo_edges[source] {
                    self.solo_downstream[target] = true;
                }
            }
        }
        let upstream = &self.solo_upstream;
        let downstream = &self.solo_downstream;
        let edge = |source: usize, target: usize| {
            (upstream[source] && upstream[target]) || (downstream[source] && downstream[target])
        };
        let route = |source: usize, target: RouteTarget| match target {
            RouteTarget::Output(target) | RouteTarget::MonoOutput(target) => edge(source, target),
            route @ (RouteTarget::Bus(_) | RouteTarget::StereoBus(_)) => {
                self.channels.iter().enumerate().any(|(target, channel)| {
                    channel
                        .input_bus
                        .is_some_and(|inputs| route.bus_contains(&inputs))
                        && edge(source, target)
                })
            }
        };
        for (index, channel) in self.channels.iter().enumerate() {
            self.audible[index] = upstream[index] || downstream[index];
            self.output_audible[index] = channel.output.is_none_or(|target| route(index, target));
        }
        for (index, send) in self.sends.iter().enumerate() {
            self.send_audible[index] = route(send.source, send.target);
        }
    }

    pub fn set_channel_output_delay(
        &mut self,
        index: usize,
        frames: usize,
    ) -> Result<(), GraphError> {
        let Some(runtime) = self.channel_runtime.get_mut(index) else {
            return Err(GraphError::InvalidOutput);
        };
        runtime.output_delay.set_frames(frames);
        Ok(())
    }

    pub fn set_send_delay(&mut self, index: usize, frames: usize) -> Result<(), GraphError> {
        let Some(runtime) = self.send_runtime.get_mut(index) else {
            return Err(GraphError::InvalidSend);
        };
        runtime.delay.set_frames(frames);
        Ok(())
    }

    pub fn clear_delays(&mut self) {
        for runtime in &mut self.channel_runtime {
            runtime.output_delay.clear();
        }
        for runtime in &mut self.send_runtime {
            runtime.delay.clear();
        }
    }

    /// Allocates the scratch storage used by [`Self::process_block_with_sources`].
    ///
    /// Call this while building the graph, before publishing it to a real-time
    /// thread. Processing a block never grows these buffers. Also detects and
    /// caches the SIMD [`fearless_simd::Level`] here (outside the real-time path).
    pub fn prepare_block_processing(&mut self, maximum_frames: usize) {
        self.block = Some(Box::new(BlockProcessingState {
            simd_level: simd::detect_level(),
            capacity: maximum_frames,
            bus_count: self.block_bus_count,
            bus_accumulation: vec![0.0; self.block_bus_count.saturating_mul(maximum_frames)],
            master_gains: vec![0.0; maximum_frames],
            master_pans: vec![0.0; maximum_frames],
            channel_gains: vec![0.0; maximum_frames],
            channel_pans: vec![0.0; maximum_frames],
            send_gains: vec![0.0; maximum_frames],
            post_pan: vec![[0.0, 0.0]; self.channels.len().saturating_mul(maximum_frames)],
            post_fader: vec![[0.0, 0.0]; maximum_frames],
            send_tap: vec![[0.0, 0.0]; maximum_frames],
        }));
    }

    pub fn process_frame(&mut self, audio_inputs: &[StereoFrame]) -> HardwareOutputFrame {
        self.accumulation.fill([0.0, 0.0]);
        self.bus_accumulation.fill(0.0);
        for (input_index, channel_index) in self
            .channels
            .iter()
            .enumerate()
            .filter_map(|(index, channel)| (channel.kind == ChannelKind::Audio).then_some(index))
            .enumerate()
        {
            if let Some(input) = audio_inputs.get(input_index) {
                self.accumulation[channel_index] = *input;
            }
        }
        self.process_accumulated(&mut |_, frame| frame)
    }

    pub fn process_frame_with_sources(
        &mut self,
        channel_sources: &[StereoFrame],
        processor: &mut impl FnMut(usize, StereoFrame) -> StereoFrame,
    ) -> HardwareOutputFrame {
        self.accumulation.fill([0.0, 0.0]);
        self.bus_accumulation.fill(0.0);
        for (target, source) in self.accumulation.iter_mut().zip(channel_sources) {
            *target = *source;
        }
        self.process_accumulated(processor)
    }

    /// Processes channel-major source buffers as one graph block.
    ///
    /// `channel_sources` contains `channel_count * frame_count` frames, with
    /// each channel occupying one contiguous `frame_count` slice. The processor
    /// callback is invoked once per graph channel, so format adapters can call
    /// block-oriented plug-in APIs without per-sample ABI crossings.
    pub fn process_block_with_sources(
        &mut self,
        channel_sources: &mut [StereoFrame],
        output: &mut [HardwareOutputFrame],
        processor: &mut impl FnMut(usize, &mut [StereoFrame], &[StereoFrame]),
    ) -> Result<(), GraphError> {
        let frame_count = output.len();
        let required_sources = self.channels.len().saturating_mul(frame_count);
        let prepared = self
            .block
            .as_ref()
            .is_some_and(|block| frame_count <= block.capacity);
        if !prepared || channel_sources.len() < required_sources {
            output.fill([0.0; MAX_OUTPUT_CHANNELS]);
            return Err(GraphError::InvalidBlock);
        }
        if frame_count == 0 {
            return Ok(());
        }

        // Destructure so block scratch can be mutated alongside channel/send runtimes
        // without overlapping borrows through `self`.
        let MixerGraph {
            channels,
            sends,
            order,
            audible,
            output_audible,
            send_audible,
            channel_runtime,
            send_runtime,
            peaks,
            sends_by_source,
            master,
            block,
            ..
        } = self;
        let block = block
            .as_mut()
            .expect("prepare_block_processing checked above");

        output.fill([0.0; MAX_OUTPUT_CHANNELS]);
        let used_bus_samples = block.bus_count.saturating_mul(frame_count);
        block.bus_accumulation[..used_bus_samples].fill(0.0);
        block.post_pan[..required_sources].fill([0.0, 0.0]);

        let master_muted = channels[*master].muted;
        channel_runtime[*master]
            .gain
            .fill_next(&mut block.master_gains[..frame_count]);
        if master_muted {
            block.master_gains[..frame_count].fill(0.0);
        }
        channel_runtime[*master]
            .pan
            .fill_next(&mut block.master_pans[..frame_count]);
        let mut master_pre = [0.0_f32; 2];
        let mut master_post = [0.0_f32; 2];
        let simd_level = block.simd_level;

        for &index in order.iter() {
            if index == *master {
                continue;
            }
            let start = index * frame_count;
            let end = start + frame_count;
            if let Some([left, right]) = channels[index].input_bus {
                simd::add_buses_into_stereo(
                    simd_level,
                    &mut channel_sources[start..end],
                    &block.bus_accumulation,
                    left,
                    right,
                    frame_count,
                );
            }
            processor(
                index,
                &mut channel_sources[start..end],
                &block.post_pan[..required_sources],
            );

            simd::peak_abs_stereo(
                simd_level,
                &channel_sources[start..end],
                &mut peaks[index].pre,
            );

            let muted = channels[index].muted;
            let output_route = channels[index].output;
            let hardware_output = channels[index].hardware_output;
            let silenced = muted || !audible[index];
            channel_runtime[index]
                .gain
                .fill_next(&mut block.channel_gains[..frame_count]);
            if silenced {
                block.channel_gains[..frame_count].fill(0.0);
            }
            channel_runtime[index]
                .pan
                .fill_next(&mut block.channel_pans[..frame_count]);

            for frame in 0..frame_count {
                let source_index = start + frame;
                let pre = channel_sources[source_index];
                let post_fader = scale(pre, block.channel_gains[frame]);
                let post = balance_stereo(post_fader, block.channel_pans[frame]);
                block.post_fader[frame] = post_fader;
                block.post_pan[source_index] = post;
            }

            for &send_index in &sends_by_source[index] {
                if !sends[send_index].enabled || !send_audible[send_index] {
                    continue;
                }
                let tap = sends[send_index].tap;
                let target = sends[send_index].target;
                send_runtime[send_index]
                    .gain
                    .fill_next(&mut block.send_gains[..frame_count]);
                let delay_empty = send_runtime[send_index].delay.is_empty();
                if delay_empty {
                    for frame in 0..frame_count {
                        let source = match tap {
                            SendTap::Pre => channel_sources[start + frame],
                            SendTap::Post => block.post_fader[frame],
                            SendTap::PostPan => block.post_pan[start + frame],
                        };
                        block.send_tap[frame] = scale(source, block.send_gains[frame]);
                    }
                    Self::route_block_tap(
                        target,
                        frame_count,
                        simd_level,
                        &mut block.bus_accumulation,
                        channel_sources,
                        &block.send_tap[..frame_count],
                    );
                } else {
                    for frame in 0..frame_count {
                        let source = match tap {
                            SendTap::Pre => channel_sources[start + frame],
                            SendTap::Post => block.post_fader[frame],
                            SendTap::PostPan => block.post_pan[start + frame],
                        };
                        let sent = scale(source, block.send_gains[frame]);
                        let sent = send_runtime[send_index].delay.process(sent);
                        Self::route_frame_tap(
                            target,
                            frame_count,
                            frame,
                            sent,
                            &mut block.bus_accumulation,
                            channel_sources,
                        );
                    }
                }
            }

            simd::peak_abs_stereo(
                simd_level,
                &block.post_pan[start..end],
                &mut peaks[index].post,
            );

            if let Some(route) = output_route.filter(|_| output_audible[index]) {
                let delay_empty = channel_runtime[index].output_delay.is_empty();
                if delay_empty {
                    // Copy post-pan into send-tap scratch so bus accumulation can
                    // borrow mutably without overlapping `post_pan`.
                    block.send_tap[..frame_count].copy_from_slice(&block.post_pan[start..end]);
                    Self::route_block_tap(
                        route,
                        frame_count,
                        simd_level,
                        &mut block.bus_accumulation,
                        channel_sources,
                        &block.send_tap[..frame_count],
                    );
                } else {
                    for frame in 0..frame_count {
                        let routed = channel_runtime[index]
                            .output_delay
                            .process(block.post_pan[start + frame]);
                        Self::route_frame_tap(
                            route,
                            frame_count,
                            frame,
                            routed,
                            &mut block.bus_accumulation,
                            channel_sources,
                        );
                    }
                }
            }

            if let Some([left, right]) = hardware_output {
                for (frame, hardware_frame) in output.iter_mut().enumerate() {
                    let post = block.post_pan[start + frame];
                    master_pre[0] = master_pre[0].max(post[0].abs());
                    master_pre[1] = master_pre[1].max(post[1].abs());
                    let mastered = balance_stereo(
                        scale(post, block.master_gains[frame]),
                        block.master_pans[frame],
                    );
                    master_post[0] = master_post[0].max(mastered[0].abs());
                    master_post[1] = master_post[1].max(mastered[1].abs());
                    hardware_frame[left] += mastered[0];
                    hardware_frame[right] += mastered[1];
                }
            }
        }
        peaks[*master].pre = [
            peaks[*master].pre[0].max(master_pre[0]),
            peaks[*master].pre[1].max(master_pre[1]),
        ];
        peaks[*master].post = [
            peaks[*master].post[0].max(master_post[0]),
            peaks[*master].post[1].max(master_post[1]),
        ];
        Ok(())
    }

    fn route_frame_tap(
        target: RouteTarget,
        frame_count: usize,
        frame: usize,
        sent: StereoFrame,
        bus_accumulation: &mut [f32],
        channel_sources: &mut [StereoFrame],
    ) {
        match target {
            RouteTarget::Bus(bus) => {
                bus_accumulation[bus * frame_count + frame] += (sent[0] + sent[1]) * 0.5;
            }
            RouteTarget::StereoBus(bus) => {
                bus_accumulation[bus * frame_count + frame] += sent[0];
                bus_accumulation[(bus + 1) * frame_count + frame] += sent[1];
            }
            RouteTarget::MonoOutput(target_channel) => {
                add(
                    &mut channel_sources[target_channel * frame_count + frame],
                    [(sent[0] + sent[1]) * 0.5; 2],
                );
            }
            RouteTarget::Output(target_channel) => {
                add(
                    &mut channel_sources[target_channel * frame_count + frame],
                    sent,
                );
            }
        }
    }

    fn route_block_tap(
        target: RouteTarget,
        frame_count: usize,
        simd_level: fearless_simd::Level,
        bus_accumulation: &mut [f32],
        channel_sources: &mut [StereoFrame],
        tap: &[StereoFrame],
    ) {
        match target {
            RouteTarget::Bus(bus) => {
                let bus_start = bus * frame_count;
                simd::accumulate_stereo_to_bus(
                    simd_level,
                    &mut bus_accumulation[bus_start..bus_start + frame_count],
                    tap,
                    0.5,
                );
            }
            RouteTarget::StereoBus(bus) => {
                simd::accumulate_stereo_to_stereo_bus(
                    simd_level,
                    bus_accumulation,
                    tap,
                    bus,
                    bus + 1,
                    frame_count,
                );
            }
            RouteTarget::MonoOutput(target_channel) => {
                let target_start = target_channel * frame_count;
                for frame in 0..frame_count {
                    add(
                        &mut channel_sources[target_start + frame],
                        [(tap[frame][0] + tap[frame][1]) * 0.5; 2],
                    );
                }
            }
            RouteTarget::Output(target_channel) => {
                let target_start = target_channel * frame_count;
                for frame in 0..frame_count {
                    add(&mut channel_sources[target_start + frame], tap[frame]);
                }
            }
        }
    }

    fn process_accumulated(
        &mut self,
        processor: &mut impl FnMut(usize, StereoFrame) -> StereoFrame,
    ) -> HardwareOutputFrame {
        let mut hardware_output = [0.0; MAX_OUTPUT_CHANNELS];
        let master = &self.channels[self.master];
        let master_gate = if master.muted { 0.0 } else { 1.0 };
        let master_gain = self.channel_runtime[self.master].gain.next() * master_gate;
        let master_pan = self.channel_runtime[self.master].pan.next();
        let mut master_pre = [0.0_f32, 0.0_f32];
        let mut master_post = [0.0_f32, 0.0_f32];

        for &index in &self.order {
            if index == self.master {
                continue;
            }
            let channel = &self.channels[index];
            if let Some([left, right]) = channel.input_bus {
                self.accumulation[index][0] += self.bus_accumulation[left];
                self.accumulation[index][1] += self.bus_accumulation[right];
            }
            let pre = processor(index, self.accumulation[index]);
            self.peaks[index].pre = [
                self.peaks[index].pre[0].max(pre[0].abs()),
                self.peaks[index].pre[1].max(pre[1].abs()),
            ];
            let gate = if channel.muted || !self.audible[index] {
                0.0
            } else {
                1.0
            };
            let post_fader = scale(pre, self.channel_runtime[index].gain.next() * gate);
            let post = balance_stereo(post_fader, self.channel_runtime[index].pan.next());

            for &send_index in &self.sends_by_source[index] {
                let send = &self.sends[send_index];
                if !send.enabled || !self.send_audible[send_index] {
                    continue;
                }
                let tap = match send.tap {
                    SendTap::Pre => pre,
                    SendTap::Post => post_fader,
                    SendTap::PostPan => post,
                };
                let sent = scale(tap, self.send_runtime[send_index].gain.next());
                let sent = self.send_runtime[send_index].delay.process(sent);
                match send.target {
                    RouteTarget::Bus(bus) => {
                        self.bus_accumulation[bus] += (sent[0] + sent[1]) * 0.5;
                    }
                    RouteTarget::StereoBus(bus) => {
                        self.bus_accumulation[bus] += sent[0];
                        self.bus_accumulation[bus + 1] += sent[1];
                    }
                    RouteTarget::MonoOutput(output) => add(
                        &mut self.accumulation[output],
                        [(sent[0] + sent[1]) * 0.5; 2],
                    ),
                    RouteTarget::Output(output) => add(&mut self.accumulation[output], sent),
                }
            }

            self.peaks[index].post = [
                self.peaks[index].post[0].max(post[0].abs()),
                self.peaks[index].post[1].max(post[1].abs()),
            ];
            if let Some(output) = channel.output.filter(|_| self.output_audible[index]) {
                let routed = self.channel_runtime[index].output_delay.process(post);
                match output {
                    RouteTarget::Bus(bus) => {
                        self.bus_accumulation[bus] += (routed[0] + routed[1]) * 0.5;
                    }
                    RouteTarget::StereoBus(bus) => {
                        self.bus_accumulation[bus] += routed[0];
                        self.bus_accumulation[bus + 1] += routed[1];
                    }
                    RouteTarget::MonoOutput(output) => add(
                        &mut self.accumulation[output],
                        [(routed[0] + routed[1]) * 0.5; 2],
                    ),
                    RouteTarget::Output(output) => add(&mut self.accumulation[output], routed),
                }
            }
            if let Some([left, right]) = channel.hardware_output {
                master_pre[0] = master_pre[0].max(post[0].abs());
                master_pre[1] = master_pre[1].max(post[1].abs());
                let mastered = balance_stereo(scale(post, master_gain), master_pan);
                master_post[0] = master_post[0].max(mastered[0].abs());
                master_post[1] = master_post[1].max(mastered[1].abs());
                hardware_output[left] += mastered[0];
                hardware_output[right] += mastered[1];
            }
        }
        self.peaks[self.master].pre = [
            self.peaks[self.master].pre[0].max(master_pre[0]),
            self.peaks[self.master].pre[1].max(master_pre[1]),
        ];
        self.peaks[self.master].post = [
            self.peaks[self.master].post[0].max(master_post[0]),
            self.peaks[self.master].post[1].max(master_post[1]),
        ];
        hardware_output
    }

    pub fn write_peaks(&mut self, target: &mut [ChannelPeak]) {
        for (target, peak) in target.iter_mut().zip(&self.peaks) {
            *target = *peak;
        }
        self.peaks.fill(ChannelPeak::default());
    }
}
