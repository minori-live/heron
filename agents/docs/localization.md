# Desktop localization

The desktop application ships English (`en-US`) and Simplified Chinese
(`zh-cmn-Hans-CN`) catalogs in `apps/desktop/src/locales/`. Both catalogs must
contain the same keys and interpolation parameters, including messages selected
by command ID or runtime state.

## Rendering messages

- Use `useI18n()` in Vue components. Derive translated option arrays and status
  labels in `computed` so that changing the application language updates them.
- Translate complete phrases with named parameters; avoid joining translated
  fragments with English word order. Use Vue I18n plural messages for counts.
- Include accessible names, tooltips, empty states, validation messages, and
  failure fallbacks in the catalog. Shared UI primitives receive translated
  labels from their desktop callers.
- Stores use the renderer's `i18n.global.t`. Translate derived warnings inside
  their computed getter. Event-time errors follow the existing store convention
  and are translated when the error occurs.
- Keep device names, project and user-defined profile names, plug-in metadata,
  aliases, parameter keys, and protocol identifiers intact. Translate built-in
  transform profile display names by ID through `midiTransformProfileLabel`.
- Generated track, channel, and recording names use the language at creation time.
  Once saved they are user data and are not renamed when the language changes.
- Cached plug-in compatibility reports retain their diagnostics. The renderer maps
  known Heron fallback reasons to translations and preserves unknown vendor details.
- Key signature display names translate the complete major/minor phrase while
  retaining pitch spelling and stable selection values.
- Shared curve editors receive localized instructions, hints, and value text as
  well as axis labels. Loading buttons and dialogs must override English default
  spinner and close-button labels.
- The splash receives the saved locale in startup progress snapshots; see
  [startup language](#startup-progress-language). Independent analysis windows
  localize both their visible title and their document/window title.
- Compiled effect graphs translate known native labels, node kinds, plug-in states,
  and signal widths while retaining channel and port identifiers.
- Benchmark views translate known scenario IDs and retain supplied descriptions
  for unknown scenarios. The native report and protocol remain unchanged.

## Dates and numbers

Pass the selected language through `intlLocale` before calling JavaScript Intl
or locale-aware formatting methods. The persisted Chinese identifier is not
accepted by Intl; it maps to `zh-Hans-CN` for formatting. Keep the persisted
identifier and the separate Reka locale mapping unchanged.

## Validation

`pnpm --filter @heron/desktop test:unit` includes catalog parity and placeholder
checks, literal translation-reference checks, dynamic command/state coverage,
and a scan for untranslated static Vue text, bound label/template literals, and
missing translation props on shared dialogs, loading buttons, and curve editors. Its explicit
exceptions cover units, protocol examples, compact control abbreviations,
product names, and required trademark notices.

The static scan skips call expressions and does not prove that arbitrary TypeScript expressions or
externally supplied data are localized. Review those separately, and test
language switching for computed labels and options. Locale-changing tests must
restore English afterward.

## Startup progress language

`StartupProgressSnapshot` carries the required `AppLocale` used to translate its
labels. Main reads saved language before the initial snapshot and retains it in
every update. Splash applies that locale to document language, fonts and window
title; before its first snapshot it uses the existing English default. Its narrow
preload remains a read-only progress subscription, with current snapshot replay
on reload. It does not read application settings, infer language from copy or
change trusted URL policy. Main/preload/splash ship together, without mixed-version
process support. Producers and fixtures must keep language and translated copy
aligned. [Application preferences](application-preferences.md) owns persisted locale.
