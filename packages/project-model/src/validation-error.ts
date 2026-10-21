/** Expected domain rejection; callers can distinguish it from infrastructure failures. */
export class ProjectValidationError extends Error {
  override name = "ProjectValidationError"
}

export class MixerValidationError extends ProjectValidationError {
  override name = "MixerValidationError"
}

/** A region or baked plug-in edit was rejected because the track is frozen. */
export class TrackFrozenError extends ProjectValidationError {
  override name = "TrackFrozenError"

  constructor(readonly trackId: string) {
    super(`Track '${trackId}' is frozen`)
  }
}
