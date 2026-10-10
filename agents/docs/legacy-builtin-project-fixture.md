# Legacy built-in project fixture

`packages/project-db/src/__tests__/fixtures/legacy-builtins/` retains a Studio
project exported by Heron 0.6.4 code at commit
`3bb8209aaaccce6fb5ab1e27e725c58a8cc0e5e6`, before the plug-in repositories were
separated. It is an intentionally generated compatibility sample, not an
existing user's historical project or evidence that the desktop UI was exercised.

The generator ran the archived `ProjectDatabase.create`, `applyCommand`,
`savePluginStates`, and `dumpTo` implementations. The archived contracts,
project model, database schema, and migrations were used too. The project keeps
the original database's seeded metronome, adds Gain to Audio 1, and adds Sine on
an instrument channel. Their descriptors retain the original built-in IDs and
VST3 class IDs, with relative bundle paths that require resolution by the current
installed catalog. Gain and Sine descriptor fields are explicit fixture inputs;
they were not captured by probing a historical packaged application.

The component state samples were generated separately from the same commit's
original plug-in Rust code using Truce 6.3.0 `Params::set_plain` and
`truce::core::state::snapshot_plugin`. They use the same serialized envelope as
Truce's VST3 component state. No controller-specific state was added.

| Plug-in   | Nondefault state                                                 |
| --------- | ---------------------------------------------------------------- |
| Gain      | Gain −12 dB                                                      |
| Sine      | Output −9 dB; attack 17 ms; release 250 ms                       |
| Metronome | Output −7 dB; accent tone 2400 Hz; beat tone 700 Hz; decay 65 ms |

The generator validates the Git tree hashes of all three archived workspace
packages before executing them; installed `node_modules` directories are excluded.
`provenance.json` records those tree hashes, the source commit, dependency versions, and checksums
of the component samples, the raw original-code archive, and its gzip container.
PGlite 0.5.8 and Drizzle ORM 0.45.3 came from the unchanged locked dependencies.
Only third-party dependencies were shared with the installed workspace; the
archived `@heron/contracts` and `@heron/project-model` aliases resolved to the
archived source tree. The 41,956,352-byte PGlite archive is losslessly compressed
for repository storage. The generator does not substitute a SQL reconstruction.

To regenerate using a complete isolated source checkout:

```sh
legacy_source_dir="$(mktemp -d)"
git archive 3bb8209aaaccce6fb5ab1e27e725c58a8cc0e5e6 | tar -x -C "$legacy_source_dir"
cd "$legacy_source_dir"
mise exec -- pnpm install --frozen-lockfile --ignore-scripts
```

From the current repository, run the fixture generator with the locked `tsx`
CLI supplied by Vite. Pass the archived source directory above and a temporary
output directory; compare its state samples and project contents before replacing
the committed fixture. PGlite archive bytes contain database internals and are
not required to regenerate to the same digest.

```sh
tsx_cli="$(node --input-type=module -e 'import { createRequire } from "node:module"; const r = createRequire(import.meta.url); console.log(createRequire(r.resolve("vite", { paths: ["./apps/desktop"] })).resolve("tsx/cli"))')"
node "$tsx_cli" packages/project-db/src/__tests__/fixtures/legacy-builtins/generate.ts \
  --source "$legacy_source_dir" --output /tmp/heron-legacy-builtins-regenerated
```

To open the sample through the desktop's normal Studio path, expand the exact
original-code archive to a `.hrs` file:

```sh
gzip -dc packages/project-db/src/__tests__/fixtures/legacy-builtins/legacy-builtins-0.6.4.hrs.gz \
  > /tmp/heron-legacy-builtins-0.6.4.hrs
```

`legacy-builtins.test.ts` opens the committed archive with the current database
API and verifies all three stable identities and every opaque state byte. It then
saves an unrelated project note and reopens the new archive to ensure the state
survives another save. Native plug-in restoration, sound, editor opening, and
catalog relocation belong to the host integration acceptance checks; this
database regression does not claim to verify those behaviors.
