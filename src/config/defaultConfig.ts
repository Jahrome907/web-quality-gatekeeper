import { createRequire } from "node:module";
import type { Config } from "./schema.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

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
    userAgent: `wqg/${pkg.version}`,
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
  screenshotGallery: {
    enabled: true,
    maxScreenshotsPerPath: 20
  },
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
