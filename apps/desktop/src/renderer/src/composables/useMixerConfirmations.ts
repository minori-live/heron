import { i18n } from "../i18n"
import { useGlobalDialog } from "./useGlobalDialog"

/** Shared Mixer decisions; each document controller owns eligibility and mutations. */
export function useMixerConfirmations() {
  const { confirm } = useGlobalDialog()

  function confirmChannelDeletion(name: string): Promise<boolean> {
    const { t } = i18n.global
    return confirm({
      eyebrow: t("mixer.console.deleteChannel.eyebrow"),
      tone: "danger",
      title: t("mixer.console.deleteChannel.title"),
      description: t("mixer.console.deleteChannel.description", { name }),
      detail: t("mixer.console.deleteChannel.detail"),
      confirmLabel: t("mixer.console.deleteChannel.confirm"),
      destructive: true
    })
  }

  function confirmInstrumentReplacement(current: string, next: string): Promise<boolean> {
    const { t } = i18n.global
    return confirm({
      eyebrow: t("mixer.console.replaceInstrument.eyebrow"),
      tone: "warning",
      title: t("mixer.console.replaceInstrument.title"),
      description: t("mixer.console.replaceInstrument.description", { current, next }),
      detail: t("mixer.console.replaceInstrument.detail"),
      confirmLabel: t("mixer.console.replaceInstrument.confirm"),
      destructive: false
    })
  }

  return { confirmChannelDeletion, confirmInstrumentReplacement }
}
