import type { Config } from "./schema.js";

export const defaultConfig: Config = {
  timeouts: {
    navigationMs: 30000,
    actionMs: 10000,
    waitAfterLoadMs: 1000
  },
  playwright: {
    viewport: {
      width: 1280,
      height: 720
    },
    userAgent: "wqg/0.1.0",
    locale: "en-US",
    colorScheme: "light"
  },
  screenshots: [
    {
      name: "home",
      path: "/",
      fullPage: true
    }
  ],
  lighthouse: {
    budgets: {
      performance: 0.8,
      lcpMs: 2500,
      cls: 0.1,
      tbtMs: 200
    },
    formFactor: "desktop"
  },
  visual: {
    threshold: 0.01
  },
  toggles: {
    a11y: true,
    perf: true,
    visual: true
  }
};
