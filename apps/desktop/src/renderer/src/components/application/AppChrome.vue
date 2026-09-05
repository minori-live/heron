<script setup lang="ts">
import type {
  ApplicationCommandId,
  ApplicationWindowCommandId,
  DesktopPlatform
} from "@heron/contracts"
import type { UiMenubarMenu } from "@heron/ui"
import { computed } from "vue"
import { storeToRefs } from "pinia"
import AppTitleBar from "./AppTitleBar.vue"
import ApplicationUpdateNotice from "./ApplicationUpdateNotice.vue"
import { useApplicationWindowStore } from "../../stores/applicationWindow"
import { useProjectStore } from "../../stores/project"

defineProps<{
  platform: DesktopPlatform
  menus: UiMenubarMenu[]
}>()

const emit = defineEmits<{
  command: [command: ApplicationCommandId]
}>()

const projectStore = useProjectStore()
const applicationWindowStore = useApplicationWindowStore()
const { hasUnsavedChanges, session } = storeToRefs(projectStore)
const projectName = computed(() => session.value?.configuration.name ?? null)

function executeWindowCommand(command: ApplicationWindowCommandId): void {
  if (command === "window.close") {
    emit("command", command)
    return
  }
  void applicationWindowStore.execute(command)
}
</script>

<template>
  <div class="grid h-full w-full grid-rows-[38px_minmax(0,1fr)] overflow-hidden bg-ui-canvas">
    <AppTitleBar
      :platform="platform"
      :menus="menus"
      :project-name="projectName"
      :dirty="hasUnsavedChanges"
      @command="emit('command', $event)"
      @window-command="executeWindowCommand"
    />
    <div class="ui-fill-available flex flex-col overflow-hidden">
      <ApplicationUpdateNotice />
      <div class="ui-fill-available flex-1 overflow-hidden"><slot /></div>
    </div>
  </div>
</template>
