import type { HeronDesktopApi, HeronSplashApi, HeronPluginAnalysisApi } from "@heron/contracts"

declare global {
  interface Window {
    heron: HeronDesktopApi
    heronPluginAnalysis: HeronPluginAnalysisApi
    heronSplash: HeronSplashApi
  }
}

export {}
