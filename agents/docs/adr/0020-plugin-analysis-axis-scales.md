# ADR-0020: Plugin Analysis axis units and scale floors

- Status: Accepted
- Date: 2026-10-05
- Owners: project maintainers
- Scope: current renderer display and plot gestures
- Related: [ADR-0016](0016-plugin-analysis.md), [ADR-0017](0017-plugin-analysis-comparison.md)

## Context

Automatic domains and repeated zoom can amplify numerical noise into apparently
large responses. Bare phase and amplitude ticks also leave their units unclear.

## Decision

Every Plugin Analysis plot declares both axis units. Ticks show those units,
including degrees for phase, dBFS for dynamics and spectral energy, samples for
block size, and FS for linear signal amplitude (1 FS is amplitude 1.0).

The desktop presentation owns minimum grid steps by unit: 1 Hz, 1 dB/dBc/dBFS,
1°, 0.01%, 0.01 FS, 0.01 ms, 0.001 s, 0.1 μs and 1 sample. Shared UI applies
these floors to automatic, explicit and gesture-derived domains, retaining at
least eight minimum steps on x and six on y. Log frequency domains cannot pan
below 1 Hz. Phase retains its existing minimum automatic range of −3° to +3°.
Linear ticks use rounded intervals and decimal formatting based on their step.

Measurement values, retained reports and comparison curves are preserved.
Only renderer display domains are constrained; no protocol or persistence changes.

## Alternatives rejected

Keeping only a floating point epsilon prevents division by zero but still makes
noise dominate plots. Fixed domains for all plots would hide meaningful large
responses, so domains continue expanding with the measurements.

## Consequences

Units remain visible while zooming and numerical residue has a readable context.
Users cannot magnify below the declared display resolution; small measurements
remain in the data and are drawn without rounding.

## Verification

Check unit mapping, near-zero domains, repeated wheel/rectangle zoom, frequency
panning and explicit heatmap domains at the shared UI and presentation boundaries.

## Reconsider when

A measurement workflow needs finer display resolution or another physical unit.
