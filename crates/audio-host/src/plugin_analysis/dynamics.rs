use super::*;

impl Chain {
    pub(super) fn dynamics(
        &mut self,
        route: StereoRoute,
    ) -> Result<PluginAnalysisDynamics, PluginAnalysisFailure> {
        let rate = f64::from(self.settings.sample_rate);
        let hz = self.settings.tone_hz;
        let measurement = (rate * self.settings.ramp_seconds) as usize;
        let mut ramp = Vec::new();
        self.settle()?;
        let mut level = self.settings.ramp_start_dbfs;
        while level <= self.settings.ramp_end_dbfs + 1e-9 {
            let peak = 10_f64.powf(level / 20.0);
            let input: Vec<f64> = (0..measurement)
                .map(|index| peak * (std::f64::consts::TAU * hz * index as f64 / rate).sin())
                .collect();
            let output = self.capture_route(&input, route, 0, false)?;
            let maximum = output
                .iter()
                .map(|frame| route.measure(*frame).abs())
                .fold(0.0_f64, f64::max);
            ramp.push(PluginAnalysisDynamicsPoint {
                input_dbfs: level,
                output_dbfs: 20.0 * maximum.max(1e-12).log10(),
            });
            if level >= self.settings.ramp_end_dbfs {
                break;
            }
            level = (level + self.settings.ramp_step_db).min(self.settings.ramp_end_dbfs);
        }
        // Retain plugin history during the ramp and each envelope transition.
        let segment_seconds = self.settings.dynamics_seconds;
        self.settle()?;
        let mut input = Vec::new();
        for (level, seconds) in self
            .settings
            .dynamics_levels_dbfs
            .into_iter()
            .zip(segment_seconds)
        {
            let segment = (rate * seconds) as usize;
            let peak = 10_f64.powf(level / 20.0);
            input.extend(
                (0..segment)
                    .map(|index| peak * (std::f64::consts::TAU * hz * index as f64 / rate).sin()),
            );
        }
        let output = self.capture_route(&input, route, 0, false)?;
        let measured: Vec<f64> = output.iter().map(|frame| route.measure(*frame)).collect();
        let points = 400usize;
        let bin = measured.len().div_ceil(points).max(1);
        let mut time_seconds = Vec::new();
        let mut input_envelope = Vec::new();
        let mut output_envelope = Vec::new();
        for index in 0..points {
            let start = index * bin;
            if start >= measured.len() {
                break;
            }
            let end = (start + bin).min(measured.len());
            time_seconds.push(start as f64 / rate);
            input_envelope.push(
                input[start..end]
                    .iter()
                    .map(|value| value.abs())
                    .fold(0.0_f64, f64::max),
            );
            output_envelope.push(
                measured[start..end]
                    .iter()
                    .map(|value| value.abs())
                    .fold(0.0_f64, f64::max),
            );
        }
        Ok(PluginAnalysisDynamics {
            channel: route.index(),
            ramp,
            time_seconds,
            input_envelope,
            output_envelope,
            segment_seconds,
        })
    }
}
