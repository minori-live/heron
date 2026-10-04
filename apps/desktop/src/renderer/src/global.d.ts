import type { HeronDesktopApi, HeronSplashApi, HeronDoctorApi } from "@heron/contracts"

declare global {
  interface Window {
    heron: HeronDesktopApi
    heronDoctor: HeronDoctorApi
    heronSplash: HeronSplashApi
  }
}

export {}
