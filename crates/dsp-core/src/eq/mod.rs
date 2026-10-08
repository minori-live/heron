//! Heron's equalizer model and allocation-free prepared signal processors.
//!
//! Bell and shelf bands at transition slope 12 use the same RBJ Q convention as
//! the EQ fitter. A shelf's Q is resonance, not the cookbook shelf-slope S.
//! Steeper bells/shelves split gain between cascaded sections. Cut slope is the
//! Butterworth order times 6; intermediate values morph adjacent orders and are
//! transition controls, not a claim of an exact fractional asymptotic exponent.
//! All designs and FFT plans are prepared outside the audio callback.

mod coefficients;
mod config;
mod convolution;
mod processor;
mod response;

pub use config::{
    BRICKWALL_SLOPE, EqBand, EqChannel, EqConfig, EqError, EqShape, LinearPhaseResolution,
    MAX_EQ_BANDS, ProcessingMode,
};
pub use processor::EqProcessor;
pub use response::{EqResponse, EqResponseMatrix};

#[cfg(test)]
mod tests;
