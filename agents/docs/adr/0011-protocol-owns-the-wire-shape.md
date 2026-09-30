# ADR-0011: Let the protocol crate own the wire shape

- Status: Accepted
- Date: 2026-09-30
- Owners: project maintainers
- Scope: current implementation; the Live hierarchy that extends the graph remains in ADR-0004
- Related: [ADR-0001](0001-runtime-ownership-and-transactions.md),
  [Architecture](../architecture.md), pull request #176

## Context

One concept was declared two to four times across the native side and joined by
hand-written converters:

- `audio-engine` carried a parallel set of `Native*` models beside
  `dsp-runtime::protocol`. `NativeAudioEngineConfig` and `AudioEngineConfig` had
  identical names, order and types for every field; `ApplicationCaptureLogicalTarget`
  was declared identically in two crates; thirteen more pairs differed only in the
  wrapper around one field.
- `audio-host/src/runtime/wire_adapters.rs` existed to map between them, and six
  of its converters reduced to identity functions once the types were compared.
- `audio-plugin` declared a plug-in identity set used by no crate.
- `main/audio-host/wire/*.ts` mirrored the Rust protocol with `interface`s and no
  link to the structs it described, so a field renamed on either side compiled on
  both and failed only when a user opened a project.

The Live milestone extends the graph — channels, sends, plug-ins, MIDI clips — so
the cost of the duplication falls on the work that is about to start.

## Decision

`crates/dsp-runtime/src/protocol` is the single source of truth for every type
that crosses the native boundary or is persisted. Three layers own the rest, and
a value belongs to exactly one of them:

| Layer     | Form                                                 | Owner                   | Serde  |
| --------- | ---------------------------------------------------- | ----------------------- | ------ |
| Wire      | String ids, `Option`, wire tags                      | `dsp-runtime::protocol` | Yes    |
| Resolved  | Indices, port tokens, processor handles, generations | `audio-engine`          | **No** |
| Real-time | Fixed-size arrays, atomics, ring buffers             | `dsp-core`              | No     |

The resolved layer is load-bearing, not a second copy: the wire identifies a
channel by id and the engine addresses it by index, and `AudioPluginProcessorHandle`
cannot be serialised at all. What is forbidden is a resolved type whose _fields_
restate a wire type's fields. Engine types are named for their layer —
`ResolvedMixerGraph`, `ResolvedPluginInstance`, `DecodedMidiEvent` — so a
`Native*` name in the engine is a defect rather than a style preference, and
`Native*` means the napi DTOs in `dsp-node` and nothing else.

`audio-engine` gains no serde dependency. Serialisation belongs to the protocol
crate; an encoded shape appearing beside the protocol's is the failure this
decision exists to prevent.

The TypeScript declarations under `main/audio-host/wire/generated/` are generated
from these types by `mise run codegen:wire-types` and checked in. The Rust types
own the shape; the generated files are an artifact, and a regenerate-and-diff
gate fails the build when a Rust change has not been exported.

## Alternatives rejected

### Keep the mirrors and generate the converters

A derive or macro would have removed the typing without removing the concepts.
Each new wire field would still be a second field to declare, and the two
declarations could still disagree about a name or a type.

### Move the resolved types into the protocol crate

The engine's resolved state carries atomics and trait objects that cannot be
serialised, and importing them into the wire crate would make the persisted
surface depend on the runtime's. It would also erase the distinction that makes
the wire format reviewable on its own.

### Hand-write the TypeScript mirror and rely on review

It was the status quo, and the fixture added in this change is what finally made
drift detectable. Generation makes the check structural rather than sampled.

## Consequences

Adding a Live field means changing the protocol type and re-running the export;
the engine sees it through `Resolved*` only if the engine needs it. The graph
family has not moved yet: `ResolvedMixerGraph` still restates the wire fields
because it carries resolved identity, and replacing it is a separate change with
its own risk to the build path.

`main/audio-host/wire/graph.ts` is generated output; editing it reintroduces the
copy it replaced. `binary.ts` and `telemetry.ts` stay hand-written because the
first carries the attachment chunking logic and the second describes a positional
tuple.

## Verification

- `scripts/native-mirror-policy.test.ts` fails when `audio-engine` declares a
  `Native*` type again, or when it gains a serde dependency.
- `mise run codegen:wire-types:check` regenerates the declarations and fails on a
  diff; `check:static` runs it.
- `crates/dsp-runtime/tests/fixtures/audio-host-messagepack.json` carries a fully
  populated graph whose bytes and exact key set are asserted from both Rust and
  TypeScript, so a wire change that is not intentional fails in both languages.

## Reconsider when

A generated binding proves insufficient for a boundary that needs runtime
validation the fixture cannot express, or the resolved layer grows fields that
the wire already carries, which would mean the two layers should merge rather
than stay separate.
