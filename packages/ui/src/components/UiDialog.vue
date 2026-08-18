<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger
} from "reka-ui"

const open = defineModel<boolean>({ default: false })
const props = withDefaults(
  defineProps<{
    eyebrow?: string
    title: string
    description?: string
    size?: "sm" | "md" | "lg"
    modal?: boolean
    closeLabel?: string
    dismissible?: boolean
    reserveCloseSpace?: boolean
  }>(),
  {
    eyebrow: undefined,
    description: undefined,
    size: "md",
    modal: true,
    closeLabel: "Close dialog",
    dismissible: true,
    reserveCloseSpace: false
  }
)

defineSlots<{
  default?(): unknown
  header?(): unknown
  actions?(): unknown
  trigger?(): unknown
}>()

const sizeClasses = {
  sm: "max-w-[28rem]",
  md: "max-w-[38rem]",
  lg: "max-w-[56rem]"
} as const
</script>

<template>
  <DialogRoot v-model:open="open" :modal="props.modal">
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[var(--ui-z-overlay)] bg-ui-overlay [backdrop-filter:blur(3px)]"
      />
      <DialogContent
        class="ui-dialog fixed left-1/2 top-1/2 z-[var(--ui-z-dialog)] grid max-h-[min(46rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border border-solid border-ui-border rounded-ui-lg bg-ui-surface text-ui-text shadow-ui-lg [transform:translate(-50%,-50%)]"
        :class="sizeClasses[props.size]"
        :data-size="props.size"
        @escape-key-down="props.dismissible ? undefined : $event.preventDefault()"
        @pointer-down-outside="props.dismissible ? undefined : $event.preventDefault()"
        @interact-outside="props.dismissible ? undefined : $event.preventDefault()"
      >
        <header
          class="ui-dialog__header flex min-w-0 items-start justify-between gap-ui-4 border-b border-b-solid border-ui-border px-ui-6 py-ui-5"
        >
          <slot name="header">
            <div class="grid min-w-0 gap-ui-2">
              <span
                v-if="props.eyebrow"
                class="text-ui-xs font-600 text-ui-text-subtle leading-ui-normal [font-family:var(--ui-type-family-data)] [letter-spacing:var(--ui-type-tracking-wider)] uppercase"
              >
                {{ props.eyebrow }}
              </span>
              <DialogTitle class="m-0 text-ui-xl font-600 leading-ui-tight">
                {{ props.title }}
              </DialogTitle>
              <DialogDescription
                v-if="props.description"
                class="m-0 text-ui-sm text-ui-text-muted leading-ui-normal"
              >
                {{ props.description }}
              </DialogDescription>
            </div>
          </slot>
          <div
            v-if="props.dismissible || props.reserveCloseSpace"
            class="inline-grid h-[var(--ui-control-sm)] min-w-[var(--ui-control-sm)] w-[var(--ui-control-sm)] place-items-center"
            data-dialog-part="close-slot"
          >
            <DialogClose
              v-if="props.dismissible"
              class="ui-dialog__close inline-grid h-full w-full cursor-pointer place-items-center border border-solid border-transparent rounded-ui-md bg-transparent p-0 text-ui-xl text-ui-text-muted"
              :aria-label="props.closeLabel"
            >
              <span aria-hidden="true">×</span>
            </DialogClose>
          </div>
        </header>
        <div
          class="ui-dialog__body min-h-0 min-w-0 overflow-auto p-ui-6 [overscroll-behavior:contain] [scrollbar-gutter:stable]"
          tabindex="0"
        >
          <slot />
        </div>
        <footer
          v-if="$slots.actions"
          class="ui-dialog__actions flex flex-wrap justify-end gap-ui-3 border-t border-t-solid border-ui-border px-ui-6 py-ui-4"
        >
          <slot name="actions" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.ui-dialog__close:hover {
  color: var(--ui-color-text);
  background: var(--ui-color-surface-hover);
}

.ui-dialog__body:focus-visible {
  outline: var(--ui-focus-width) solid var(--ui-color-focus);
  outline-offset: calc(var(--ui-focus-width) * -1);
}

@media (max-width: 30rem) {
  .ui-dialog {
    width: calc(100vw - 1rem);
    max-height: calc(100dvh - 1rem);
  }

  .ui-dialog__header,
  .ui-dialog__body,
  .ui-dialog__actions {
    padding-right: var(--ui-space-4);
    padding-left: var(--ui-space-4);
  }

  .ui-dialog__actions > * {
    flex: 1 1 auto;
  }
}
</style>
