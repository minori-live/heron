use super::{Chain, PluginAnalysisBlockPerformance, PluginAnalysisFailure};

impl Chain {
    /// Sweep supported callback sizes with a warmed sine excitation. Measurements
    /// exclude preparation, FFT, pacing and control work.
    pub(super) fn performance_scan(
        &mut self,
    ) -> Result<Vec<PluginAnalysisBlockPerformance>, PluginAnalysisFailure> {
        let selected = self.settings.block_size;
        let existing = std::mem::take(&mut self.times);
        let result = (|| {
            let mut points = Vec::new();
            for block_size in [64, 128, 256, 512, 1024] {
                self.settings.block_size = block_size;
                let count = block_size as usize * 64;
                let rate = f64::from(self.settings.sample_rate);
                let peak = 10_f64.powf(self.settings.level_dbfs / 20.0);
                let input: Vec<_> = (0..count)
                    .map(|i| {
                        peak * (std::f64::consts::TAU * self.settings.tone_hz * i as f64 / rate)
                            .sin()
                    })
                    .collect();
                self.capture(&input[..block_size as usize * 8], 0, 0, false)?;
                self.times.clear();
                self.capture(&input, 0, 0, true)?;
                let average = self.times.iter().sum::<f64>() / self.times.len().max(1) as f64;
                self.times.sort_by(f64::total_cmp);
                let percentile =
                    |q: f64| self.times[((self.times.len() - 1) as f64 * q).ceil() as usize];
                points.push(PluginAnalysisBlockPerformance {
                    block_size,
                    average_block_us: average,
                    p95_block_us: percentile(0.95),
                    p99_block_us: percentile(0.99),
                    maximum_block_us: percentile(1.0),
                    measured_blocks: self.times.len() as u32,
                });
            }
            Ok(points)
        })();
        self.settings.block_size = selected;
        self.times = existing;
        result
    }
}
