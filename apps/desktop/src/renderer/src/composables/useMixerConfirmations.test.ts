import { afterEach, describe, expect, it } from "vitest"
import { i18n, setAppLocale } from "../i18n"
import { useGlobalDialog } from "./useGlobalDialog"
import { useMixerConfirmations } from "./useMixerConfirmations"

const dialogs = useGlobalDialog()

afterEach(() => {
  dialogs.dismissDialog()
  setAppLocale("en-US")
})

describe("shared Mixer confirmations", () => {
  it("cancels channel deletion on dismiss and only accepts the confirm action", async () => {
    const { confirmChannelDeletion } = useMixerConfirmations()
    const cancelled = confirmChannelDeletion("Vocal")
    expect(dialogs.activeDialog.value?.description).toContain("Vocal")
    expect(dialogs.activeDialog.value?.actions[0]?.kind).toBe("danger")
    dialogs.dismissDialog()
    await expect(cancelled).resolves.toBe(false)

    const accepted = confirmChannelDeletion("Guitar")
    expect(dialogs.activeDialog.value?.description).toContain("Guitar")
    dialogs.selectDialogAction("confirm")
    await expect(accepted).resolves.toBe(true)
  })

  it("uses the current language when an existing controller asks to replace an instrument", async () => {
    setAppLocale("en-US")
    const { confirmInstrumentReplacement } = useMixerConfirmations()
    const originalTitle = i18n.global.t("mixer.console.replaceInstrument.title")
    setAppLocale("zh-cmn-Hans-CN")
    const pending = confirmInstrumentReplacement("Piano", "Organ")
    expect(dialogs.activeDialog.value?.title).not.toBe(originalTitle)
    expect(dialogs.activeDialog.value?.description).toContain("Piano")
    expect(dialogs.activeDialog.value?.description).toContain("Organ")
    expect(dialogs.activeDialog.value?.actions[0]?.kind).toBe("primary")
    dialogs.selectDialogAction("cancel")
    await expect(pending).resolves.toBe(false)
  })
})
