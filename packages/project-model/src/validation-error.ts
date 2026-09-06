/** Expected domain rejection; callers can distinguish it from infrastructure failures. */
export class ProjectValidationError extends Error {
  override name = "ProjectValidationError"
}

export class MixerValidationError extends ProjectValidationError {
  override name = "MixerValidationError"
}
