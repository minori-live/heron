# ADR-0019: Plugin Analysis waveform sample coordinates

- Status: Accepted
- Date: 2026-10-04
- Owners: project maintainers
- Scope: current Plugin Analysis report and renderer
- Related: [PR #193](https://github.com/minori-live/heron/pull/193),
  [ADR-0016](0016-plugin-analysis.md),
  [ADR-0011](0011-protocol-owns-the-wire-shape.md)

## Context

Oscilloscope reports retain at most 400 regularly spaced points per waveform.
Latency is measured in original audio samples. Treating that latency as an
index into a downsampled trace misaligns the waveshaping display. Nominal tone
duration cannot recover the exact spacing because generation rounds the period
to whole samples and retention rounds its stride independently.

## Decision

The Rust-owned oscilloscope report includes a positive `sample_stride`: the
number of original audio samples between retained points. Input and output
share the same stride and starting instant. `delay_samples` remains in original
audio samples. `duration_seconds` describes the full captured interval, including
any time after its final retained point.

The renderer places point `i` at `i * sample_stride / sample_rate` seconds.
Waveshaping pairs each retained input with output at the measured or manually
selected delay. It linearly interpolates output when the delay falls between
retained points and omits positions outside the captured output. Each comparison
report uses its own rate, stride and measured delay.

This adds a required field to the existing volatile native report contract and
its generated TypeScript declarations. Native and renderer code ship together;
reports are not persisted, so there is no project migration or old-report
fallback. Runtime ownership, publication and failure semantics are unchanged.

## Alternatives rejected

- Deriving spacing from nominal duration and array length loses the exact sample
  coordinates after period and stride rounding.
- Rounding latency to a display index introduces avoidable phase error for delays
  smaller than the stride.
- Retaining every captured sample increases report size without helping the
  bounded display; interpolation does not claim to recover discarded detail.

## Consequences

Delay controls continue to show audio samples. Downsampled visual traces use
linear approximation between retained points, including near waveform edges.
An alignment with no overlapping captured points produces an empty trace instead
of inventing an endpoint. Native report producers must publish the actual stride.

## Verification

Native tests verify retained waveform samples and stride after period rounding.
Renderer tests verify time coordinates, fractional-delay alignment, separate
comparison coordinates, and omission of non-overlapping output. Generated wire
declaration checks keep both TypeScript consumers aligned with the Rust report.

## Reconsider when

Reports become persistent or independently versioned, or measurement displays
need nonuniform timestamps or signal reconstruction beyond linear interpolation.
