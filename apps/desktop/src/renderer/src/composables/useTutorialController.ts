import { readonly, shallowRef } from "vue"

const studioBasicsRequest = shallowRef(0)

export function useTutorialController() {
  function requestStudioBasics(): void {
    studioBasicsRequest.value += 1
  }

  return {
    studioBasicsRequest: readonly(studioBasicsRequest),
    requestStudioBasics
  }
}
