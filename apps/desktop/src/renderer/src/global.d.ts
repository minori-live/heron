import type {
  HeronDesktopApi,
  HeronSplashApi,
  HeronPluginAnalysisApi,
  HeronPluginAnalysisEqFitApi
} from "@heron/contracts"

declare global {
  interface Window {
    heron: HeronDesktopApi
    heronPluginAnalysis: HeronPluginAnalysisApi
    heronPluginAnalysisEqFit: HeronPluginAnalysisEqFitApi
    heronSplash: HeronSplashApi
  }
}

export {}
