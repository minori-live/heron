// PostgreSQL's extended query protocol has a 65,535-parameter limit. Keep MIDI
// statements comfortably below it and bound SQL construction for large imports.
export const MIDI_QUERY_PARAMETER_BUDGET = 16_384

export function* midiBatches<T>(
  values: readonly T[],
  parametersPerValue: number,
  fixedParameters = 0
): Generator<T[]> {
  const size = Math.floor((MIDI_QUERY_PARAMETER_BUDGET - fixedParameters) / parametersPerValue)
  for (let offset = 0; offset < values.length; offset += size) {
    yield values.slice(offset, offset + size)
  }
}
