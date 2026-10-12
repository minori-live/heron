import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue"

export const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value))

export const easeInOut = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function usePrefersReducedMotion(): Ref<boolean> {
  const reduced = ref(false)
  let query: MediaQueryList | undefined
  const update = () => {
    reduced.value = query?.matches ?? false
  }
  onMounted(() => {
    query = window.matchMedia("(prefers-reduced-motion: reduce)")
    update()
    query.addEventListener("change", update)
  })
  onBeforeUnmount(() => query?.removeEventListener("change", update))
  return reduced
}

/**
 * Seconds of animation time that only advance while `target` is on screen, the
 * tab is visible, and the reader has not asked for reduced motion. A reduced
 * motion reader sees a single representative frame at `restTime`.
 */
export function useAnimationClock(
  target: Ref<HTMLElement | undefined>,
  reduced: Ref<boolean>,
  restTime = 0
): Ref<number> {
  const time = ref(restTime)
  let frame = 0
  let last = 0
  let visible = false
  let observer: IntersectionObserver | undefined

  const tick = (now: number) => {
    time.value += Math.min(0.1, (now - last) / 1000)
    last = now
    frame = requestAnimationFrame(tick)
  }
  const sync = () => {
    const running = frame !== 0
    const shouldRun = visible && !reduced.value && document.visibilityState === "visible"
    if (shouldRun && !running) {
      last = performance.now()
      frame = requestAnimationFrame(tick)
    } else if (!shouldRun && running) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    if (reduced.value) time.value = restTime
  }

  onMounted(() => {
    observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      sync()
    })
    if (target.value) observer.observe(target.value)
    document.addEventListener("visibilitychange", sync)
  })
  watch(reduced, sync)
  onBeforeUnmount(() => {
    observer?.disconnect()
    document.removeEventListener("visibilitychange", sync)
    cancelAnimationFrame(frame)
    frame = 0
  })
  return time
}

/**
 * Progress from 0 to 1 while `target` scrolls through the viewport. With
 * `mode: "leave"` it measures how far the element's top has moved past the top
 * of the viewport; with `mode: "through"` it measures the scrollable distance
 * of a tall element containing a sticky child.
 */
export function useScrollProgress(
  target: Ref<HTMLElement | undefined>,
  mode: "leave" | "through"
): Ref<number> {
  const progress = ref(0)
  let frame = 0

  const measure = () => {
    frame = 0
    const element = target.value
    if (!element) return
    const rect = element.getBoundingClientRect()
    const distance = mode === "leave" ? rect.height : rect.height - window.innerHeight
    progress.value = distance > 0 ? clamp(-rect.top / distance) : 0
  }
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(measure)
  }

  onMounted(() => {
    measure()
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
  })
  onBeforeUnmount(() => {
    window.removeEventListener("scroll", schedule)
    window.removeEventListener("resize", schedule)
    cancelAnimationFrame(frame)
  })
  return progress
}

/** Becomes true once `target` first enters the viewport, then stays true. */
export function useRevealOnce(
  target: Ref<HTMLElement | undefined>,
  threshold = 0.25
): Ref<boolean> {
  const shown = ref(false)
  let observer: IntersectionObserver | undefined
  onMounted(() => {
    observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          shown.value = true
          observer?.disconnect()
        }
      },
      { threshold }
    )
    if (target.value) observer.observe(target.value)
  })
  onBeforeUnmount(() => observer?.disconnect())
  return shown
}
